import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"

export interface DownloadOptions {
  repo: string
  localDir: string
  file?: string
  revision?: string
  onLine?: (line: string) => void
  // When true, inherit stdio so `hf` paints its native tqdm progress bar
  // directly to the user's terminal. `onLine` is ignored in this mode.
  inherit?: boolean
  // Aborts the in-flight download. We SIGTERM the child and, if it has
  // not exited after a brief grace period, escalate to SIGKILL so a
  // stuck `hf` (or one of its subprocesses) cannot linger as an orphan.
  signal?: AbortSignal
}

export class PullAbortedError extends Error {
  constructor() {
    super("pull aborted")
    this.name = "PullAbortedError"
  }
}

// `hf download` is a tqdm-based CLI: progress frames are emitted as \r
// rewrites on a single "line" and only newline-terminate at stage
// boundaries. Splitting only on \n collapses every intra-stage frame
// into a single buffered string, so callers see nothing stream until
// tqdm finally emits a \n. Split on either and drop blanks.
export function splitHfChunks(text: string): string[] {
  return text.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 0)
}

export function runHfDownload(opts: DownloadOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) { reject(new PullAbortedError()); return }
    fs.mkdirSync(opts.localDir, { recursive: true })
    const args = ["download", opts.repo]
    if (opts.file) args.push(opts.file)
    if (opts.revision) args.push("--revision", opts.revision)
    if (opts.file) args.push("--local-dir", opts.localDir)
    const proc = spawn("hf", args, {
      stdio: opts.inherit
        ? ["ignore", "inherit", "inherit"]
        : ["ignore", "pipe", "pipe"]
    })
    if (!opts.inherit) {
      const emit = (b: Buffer): void => {
        for (const l of splitHfChunks(b.toString())) opts.onLine?.(l)
      }
      proc.stdout?.on("data", emit)
      proc.stderr?.on("data", emit)
    }

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
      else if (code === 0) resolve()
      else reject(new Error(`hf exited with code ${code}`))
    })
  })
}

export function resolveMlxSnapshot(hubDir: string, repo: string): string | null {
  const modelDir = path.join(hubDir, `models--${repo.replace("/", "--")}`)
  const refsMain = path.join(modelDir, "refs", "main")
  try {
    if (fs.existsSync(refsMain)) {
      const hash = fs.readFileSync(refsMain, "utf8").trim()
      const candidate = path.join(modelDir, "snapshots", hash)
      if (fs.existsSync(candidate)) return candidate
    }
  } catch { /* fall through */ }
  return null
}
