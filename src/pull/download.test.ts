import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { EventEmitter } from "events"
import { PullAbortedError, runHfDownload, resolveMlxSnapshot, splitHfChunks } from "./download.js"
import { resolvePythonForHf } from "./resolve-python.js"
import { spawn } from "child_process"

vi.mock("./resolve-python.js", () => ({
  resolvePythonForHf: vi.fn(() => "/usr/bin/python3")
}))

vi.mock("child_process", () => ({
  spawn: vi.fn()
}))

describe("splitHfChunks", () => {
  it("splits on newlines", () => {
    expect(splitHfChunks("a\nb\nc\n")).toEqual(["a", "b", "c"])
  })

  it("splits on carriage returns (tqdm progress frames)", () => {
    const chunk =
      "Downloading: 0%\r" +
      "Downloading: 25%\r" +
      "Downloading: 50%\r" +
      "Downloading: 75%\r" +
      "Downloading: 100%\n"
    expect(splitHfChunks(chunk)).toEqual([
      "Downloading: 0%",
      "Downloading: 25%",
      "Downloading: 50%",
      "Downloading: 75%",
      "Downloading: 100%"
    ])
  })

  it("splits on mixed \\r\\n and lone \\r", () => {
    const chunk = "one\r\ntwo\rthree\nfour"
    expect(splitHfChunks(chunk)).toEqual(["one", "two", "three", "four"])
  })

  it("drops empty and whitespace-only fragments", () => {
    expect(splitHfChunks("\r\n\n\r  \nhello\n")).toEqual(["hello"])
  })

  it("returns an empty list for empty or whitespace-only input", () => {
    expect(splitHfChunks("")).toEqual([])
    expect(splitHfChunks("\r\n\r\n")).toEqual([])
    expect(splitHfChunks("   \t   ")).toEqual([])
  })

  it("trims each resulting line", () => {
    expect(splitHfChunks("  padded  \n\tstart\t")).toEqual(["padded", "start"])
  })

  it("handles a realistic hf download chunk", () => {
    const chunk =
      "Fetching 12 files:   0%|          | 0/12 [00:00<?, ?it/s]\r" +
      "model-00001-of-00003.safetensors:   0%|          | 0.00/4.96G [00:00<?, ?B/s]\r" +
      "model-00001-of-00003.safetensors:  10%|▉         | 512M/4.96G [00:05<00:45, 102MB/s]\r" +
      "model-00001-of-00003.safetensors: 100%|██████████| 4.96G/4.96G [00:48<00:00, 103MB/s]\n" +
      "Fetching 12 files:   8%|▊         | 1/12 [00:48<08:48, 48.0s/it]\n"
    const out = splitHfChunks(chunk)
    expect(out.length).toBe(5)
    expect(out[0]).toMatch(/Fetching 12 files:\s+0%/)
    expect(out[3]).toMatch(/100%/)
  })
})

describe("resolveMlxSnapshot", () => {
  const tmpDir = path.join(process.env.ATHANOR_HOME!, "resolve-mlx-test")

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it("resolves candidate via refs hash when snapshot directory exists", () => {
    const modelDir = path.join(tmpDir, "models--mlx-community--test-model")
    const refDir = path.join(modelDir, "refs")
    const snapDir = path.join(modelDir, "snapshots", "hash123")
    fs.mkdirSync(refDir, { recursive: true })
    fs.mkdirSync(snapDir, { recursive: true })
    fs.writeFileSync(path.join(refDir, "main"), "hash123\n")

    const resolved = resolveMlxSnapshot(tmpDir, "mlx-community/test-model")
    expect(resolved).toBe(snapDir)
  })

  it("resolves via specific revision ref", () => {
    const modelDir = path.join(tmpDir, "models--mlx-community--test-rev")
    const refDir = path.join(modelDir, "refs")
    const snapDir = path.join(modelDir, "snapshots", "revhash456")
    fs.mkdirSync(refDir, { recursive: true })
    fs.mkdirSync(snapDir, { recursive: true })
    fs.writeFileSync(path.join(refDir, "v2"), "revhash456\n")

    const resolved = resolveMlxSnapshot(tmpDir, "mlx-community/test-rev", "v2")
    expect(resolved).toBe(snapDir)
  })

  it("resolves direct snapshot directory when named after revision", () => {
    const modelDir = path.join(tmpDir, "models--mlx-community--direct-snap")
    const snapDir = path.join(modelDir, "snapshots", "v1.0")
    fs.mkdirSync(snapDir, { recursive: true })

    const resolved = resolveMlxSnapshot(tmpDir, "mlx-community/direct-snap", "v1.0")
    expect(resolved).toBe(snapDir)
  })

  it("returns null when no snapshot exists", () => {
    const resolved = resolveMlxSnapshot(tmpDir, "mlx-community/nonexistent")
    expect(resolved).toBeNull()
  })
})

describe("runHfDownload", () => {
  const localDir = path.join(process.env.ATHANOR_HOME!, "download-test")

  beforeEach(() => {
    vi.mocked(resolvePythonForHf).mockReturnValue("/usr/bin/python3")
  })

  it("rejects with PullAbortedError when the signal is already aborted", async () => {
    const ctl = new AbortController()
    ctl.abort()
    await expect(
      runHfDownload({ repo: "example/repo", localDir, signal: ctl.signal })
    ).rejects.toBeInstanceOf(PullAbortedError)
  })

  it("rejects when no Python interpreter is found", async () => {
    vi.mocked(resolvePythonForHf).mockReturnValueOnce(null)
    await expect(
      runHfDownload({ repo: "example/repo", localDir })
    ).rejects.toThrow("no Python interpreter found")
  })

  it("spawns python, parses NDJSON events, and resolves with path on exit 0", async () => {
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    const proc = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      kill: vi.fn()
    })
    vi.mocked(spawn).mockReturnValueOnce(proc as any)

    const events: any[] = []
    const lines: string[] = []
    const downloadPromise = runHfDownload({
      repo: "mlx-community/Qwen",
      localDir,
      onEvent: ev => events.push(ev),
      onLine: line => lines.push(line)
    })

    // Emit valid progress event, non-JSON line, and done event
    stdout.emit("data", Buffer.from(JSON.stringify({ type: "progress", file: "a.bin", done: 10, total: 100, rate: 5, elapsed: 1, unit: "B" }) + "\n"))
    stdout.emit("data", Buffer.from("raw unstructured line\n"))
    stdout.emit("data", Buffer.from(JSON.stringify({ type: "done", path: "/cache/model" }) + "\n"))

    // Emit stderr line
    stderr.emit("data", Buffer.from("stderr warning\n"))

    // Exit cleanly
    proc.emit("exit", 0)

    const result = await downloadPromise
    expect(result).toBe("/cache/model")
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe("progress")
    expect(events[1].type).toBe("done")
    expect(lines).toContain("raw unstructured line")
    expect(lines).toContain("stderr warning")
  })

  it("handles in-flight abort signal by killing process and rejecting with PullAbortedError", async () => {
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    const killFn = vi.fn()
    const proc = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      kill: killFn
    })
    vi.mocked(spawn).mockReturnValueOnce(proc as any)

    const ctl = new AbortController()
    const downloadPromise = runHfDownload({
      repo: "mlx-community/Qwen",
      localDir,
      signal: ctl.signal
    })

    ctl.abort()
    expect(killFn).toHaveBeenCalledWith("SIGTERM")

    proc.emit("exit", null)
    await expect(downloadPromise).rejects.toBeInstanceOf(PullAbortedError)
  })

  it("rejects with last error or stderr fallback on non-zero exit code", async () => {
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    const proc = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      kill: vi.fn()
    })
    vi.mocked(spawn).mockReturnValueOnce(proc as any)

    const downloadPromise = runHfDownload({
      repo: "mlx-community/Qwen",
      localDir
    })

    stdout.emit("data", Buffer.from(JSON.stringify({ type: "error", message: "model repo not found" }) + "\n"))
    proc.emit("exit", 1)

    await expect(downloadPromise).rejects.toThrow("model repo not found")
  })

  it("rejects with process error event", async () => {
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    const proc = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      kill: vi.fn()
    })
    vi.mocked(spawn).mockReturnValueOnce(proc as any)

    const downloadPromise = runHfDownload({
      repo: "mlx-community/Qwen",
      localDir
    })

    proc.emit("error", new Error("spawn ENOENT"))
    await expect(downloadPromise).rejects.toThrow("spawn ENOENT")
  })
})
