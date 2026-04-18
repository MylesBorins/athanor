import { describe, it, expect } from "vitest"
import { PullAbortedError, runHfDownload, splitHfChunks } from "./download.js"

describe("splitHfChunks", () => {
  it("splits on newlines", () => {
    expect(splitHfChunks("a\nb\nc\n")).toEqual(["a", "b", "c"])
  })

  it("splits on carriage returns (tqdm progress frames)", () => {
    // hf download emits progress as \r rewrites on a single 'line'.
    // We want each frame to surface to the callback, not be buffered.
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
    // A condensed example of what `hf download` pushes to stderr during
    // a large MLX pull: tqdm banner + sibling-by-sibling progress frames.
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

describe("runHfDownload abort", () => {
  it("rejects with PullAbortedError when the signal is already aborted", async () => {
    // Pre-aborted signal short-circuits before we ever spawn hf, so
    // this test is hermetic (doesn't require hf to be installed).
    const ctl = new AbortController()
    ctl.abort()
    await expect(
      runHfDownload({ repo: "example/repo", localDir: "/tmp/athanor-abort-test", signal: ctl.signal })
    ).rejects.toBeInstanceOf(PullAbortedError)
  })
})
