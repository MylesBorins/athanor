import * as fs from "fs"
import type { FSWatcher } from "fs"
import type { ModelEntry } from "../types/index.js"
import { getModelDirs } from "../config/index.js"
import { ingestDiscovered } from "./ingest.js"

// Watches the HuggingFace hub cache (and the llama models dir, if
// distinct) for new model snapshots and re-ingests them without the
// user having to press `s`. fs.watch is fsevents-backed on macOS and
// cheap; we watch non-recursively on the top level — every new HF
// snapshot first appears as a `models--<org>--<repo>/` directory
// there, and subsequent events (refs/main rename, snapshot blobs
// landing) also bubble up via the coalesced parent events.
//
// Events are debounced because `hf download` generates a burst of
// rename events. The debounce window also covers the case where the
// scanner would reject an in-progress snapshot (no `refs/main` yet):
// a later event from the same download triggers another scan and the
// ingest completes then.

// Minimal fs.watch-compatible signature. The ESM fs namespace can't
// be spied on directly (vitest limitation), so we accept a factory
// override in tests that returns a fake FSWatcher and captures the
// listener for deterministic firing.
export type WatchFactory = (dir: string, listener: () => void) => FSWatcher

export interface WatcherOptions {
  debounceMs?: number
  // Test seam. Production passes the live ingest function.
  ingest?: typeof ingestDiscovered
  // Test seam. Default wraps fs.watch.
  watchFactory?: WatchFactory
  // Called with the directory that fs.watch refused to attach to
  // (missing dir, permission, unsupported fs). Default logs to stderr.
  onError?: (dir: string, err: Error) => void
}

export interface Watcher {
  stop(): void
}

const DEFAULT_DEBOUNCE_MS = 1500

export function startCacheWatcher(
  onAdded: (added: ModelEntry[]) => void,
  opts: WatcherOptions = {}
): Watcher {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const ingest = opts.ingest ?? ingestDiscovered
  const watchFactory = opts.watchFactory
    ?? ((dir, listener) => fs.watch(dir, { persistent: false }, listener))
  const onError = opts.onError ?? ((dir, err) => {
    console.error(`athanor: cache watcher could not attach to ${dir}: ${err.message}`)
  })

  const dirs = getModelDirs()
  // Dedupe when mlx and llama point at the same path (common on
  // default config before the user sets up a llama dir).
  const targets = Array.from(new Set([dirs.mlx, dirs.llama].filter(Boolean)))

  const watchers: FSWatcher[] = []
  let pending: NodeJS.Timeout | null = null
  let stopped = false

  const runScan = (): void => {
    if (stopped) return
    try {
      const rep = ingest()
      if (rep.added.length > 0) onAdded(rep.added)
    } catch (err) {
      // Scanner failures shouldn't crash the TUI. Surface once and
      // keep watching — the next burst may succeed (e.g. download
      // completed, refs/main appeared).
      console.error(`athanor: watcher scan failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const schedule = (): void => {
    if (stopped) return
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => { pending = null; runScan() }, debounceMs)
  }

  for (const dir of targets) {
    if (!fs.existsSync(dir)) continue
    try {
      const w = watchFactory(dir, () => schedule())
      w.on("error", err => onError(dir, err as Error))
      watchers.push(w)
    } catch (err) {
      onError(dir, err as Error)
    }
  }

  return {
    stop(): void {
      stopped = true
      if (pending) { clearTimeout(pending); pending = null }
      for (const w of watchers) {
        try { w.close() } catch { /* already closed */ }
      }
      watchers.length = 0
    }
  }
}
