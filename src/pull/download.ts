import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"
import { resolvePythonForHf } from "./resolve-python.js"

// Events emitted by the hf_pull.py sidecar. The shape mirrors
// tqdm.format_dict plus a small state machine envelope (resolving →
// begin → progress* → end, then a final done or error).
export type ProgressEvent =
  | { type: "resolving"; repo: string; revision?: string | null }
  | { type: "begin"; file: string; total: number | null; unit: string }
  | { type: "progress"; file: string; done: number; total: number | null; rate: number | null; elapsed: number; unit: string }
  | { type: "end"; file: string; done: number; total: number | null; unit: string }
  | { type: "done"; path: string }
  | { type: "error"; message: string }

export interface DownloadOptions {
  repo: string
  localDir: string
  file?: string
  revision?: string
  // Free-form stderr lines from the sidecar (warnings, tracebacks).
  // Structured progress is delivered via onEvent instead.
  onLine?: (line: string) => void
  // Structured progress stream. Preferred way to render a UI.
  onEvent?: (event: ProgressEvent) => void
  // Aborts the in-flight download. SIGTERM first, SIGKILL after a
  // grace period so a stuck Python child cannot linger as an orphan.
  signal?: AbortSignal
}

export class PullAbortedError extends Error {
  constructor() {
    super("pull aborted")
    this.name = "PullAbortedError"
  }
}

// Kept for stderr parsing. huggingface_hub occasionally writes
// tqdm-style warning lines to stderr even with a custom tqdm_class;
// split on \r or \n and drop empties so each frame surfaces once.
export function splitHfChunks(text: string): string[] {
  return text.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 0)
}

function resolveSidecarScript(): string {
  // Same layout in dev (src/pull/*.ts executed via tsx) and prod
  // (dist/pull/*.js after tsc + postbuild copy). hf_pull.py lives
  // next to this module in both cases.
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "hf_pull.py"
  )
}

export function runHfDownload(opts: DownloadOptions): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) { reject(new PullAbortedError()); return }
    fs.mkdirSync(opts.localDir, { recursive: true })

    const python = resolvePythonForHf()
    if (!python) {
      reject(new Error(
        "no Python interpreter found. Install huggingface_hub with: " +
        "uv tool install huggingface_hub (or pipx install huggingface_hub)"
      ))
      return
    }

    const payload = JSON.stringify({
      repo: opts.repo,
      revision: opts.revision ?? null,
      file: opts.file ?? null,
      // snapshot_download writes to local_dir when set, otherwise
      // into ~/.cache/huggingface/hub. MLX pulls keep the classic
      // cache layout so scanner + external hf tools stay consistent;
      // GGUF pulls use local_dir for a flat file.
      local_dir: opts.file ? opts.localDir : null
    })

    const proc = spawn(python, [resolveSidecarScript(), payload], {
      stdio: ["ignore", "pipe", "pipe"]
    })

    // NDJSON on stdout: buffer by line, JSON-parse, deliver to
    // onEvent. Anything that fails to parse falls through to onLine
    // so it isn't silently dropped.
    let stdoutBuf = ""
    let lastError: string | null = null
    let resolvedPath: string | null = null
    proc.stdout?.on("data", (b: Buffer) => {
      stdoutBuf += b.toString()
      for (;;) {
        const nl = stdoutBuf.indexOf("\n")
        if (nl < 0) break
        const line = stdoutBuf.slice(0, nl).trim()
        stdoutBuf = stdoutBuf.slice(nl + 1)
        if (!line) continue
        try {
          const ev = JSON.parse(line) as ProgressEvent
          if (ev.type === "error") lastError = ev.message
          if (ev.type === "done") resolvedPath = ev.path
          opts.onEvent?.(ev)
        } catch {
          opts.onLine?.(line)
        }
      }
    })
    proc.stderr?.on("data", (b: Buffer) => {
      for (const l of splitHfChunks(b.toString())) opts.onLine?.(l)
    })

    let aborted = false
    let killTimer: NodeJS.Timeout | null = null
    const onAbort = (): void => {
      if (aborted) return
      aborted = true
      try { proc.kill("SIGTERM") } catch { /* already dead */ }
      killTimer = setTimeout(() => {
        try { proc.kill("SIGKILL") } catch { /* already dead */ }
      }, 3000)
      killTimer.unref()
    }
    if (opts.signal) opts.signal.addEventListener("abort", onAbort, { once: true })

    proc.on("error", err => {
      if (killTimer) clearTimeout(killTimer)
      opts.signal?.removeEventListener("abort", onAbort)
      reject(err)
    })
    proc.on("exit", code => {
      if (killTimer) clearTimeout(killTimer)
      opts.signal?.removeEventListener("abort", onAbort)
      if (aborted) reject(new PullAbortedError())
      else if (code === 0) resolve(resolvedPath)
      else reject(new Error(lastError ?? `hf_pull exited with code ${code}`))
    })
  })
}

export function resolveMlxSnapshot(hubDir: string, repo: string, revision?: string): string | null {
  const modelDir = path.join(hubDir, `models--${repo.replace("/", "--")}`)
  const refs = [revision, "main"].filter((v): v is string => typeof v === "string" && v.length > 0)
  try {
    for (const ref of refs) {
      const refPath = path.join(modelDir, "refs", ref)
      if (fs.existsSync(refPath)) {
        const hash = fs.readFileSync(refPath, "utf8").trim()
        const candidate = path.join(modelDir, "snapshots", hash)
        if (fs.existsSync(candidate)) return candidate
      }
      const directSnapshot = path.join(modelDir, "snapshots", ref)
      if (fs.existsSync(directSnapshot)) return directSnapshot
    }
  } catch { /* fall through */ }
  return null
}
