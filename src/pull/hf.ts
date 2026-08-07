import * as os from "os"
import * as path from "path"
import type { ModelEntry } from "../types/index.js"
import {
  materializeRegistryEntry,
  pullToMaterializeInput
} from "../registry/materialize.js"
import { getModelDirs } from "../config/index.js"
import {
  fetchRepoInfo,
  inferRuntimeFromRepo,
  listGgufFiles
} from "./api.js"
import { runHfDownload, resolveMlxSnapshot, type ProgressEvent } from "./download.js"
import { detectMlxCapabilities } from "../discovery/scanner.js"

export { fetchRepoInfo, inferRuntimeFromRepo, listGgufFiles } from "./api.js"

function expandHome(p: string): string {
  return p.replace(/^~/, os.homedir())
}

export interface PullOptions {
  repo: string
  file?: string
  revision?: string
  onLine?: (line: string) => void
  // Structured progress stream from the huggingface_hub sidecar.
  // Consumers render their own progress UI from these events.
  onEvent?: (event: ProgressEvent) => void
  // See DownloadOptions.signal — aborting SIGTERM/SIGKILLs the
  // sidecar and rejects with PullAbortedError. No registry entry
  // is written on abort.
  signal?: AbortSignal
}

export interface PullResult {
  entry: ModelEntry
}

export async function pull(opts: PullOptions): Promise<PullResult> {
  const info = await fetchRepoInfo(opts.repo, opts.revision)
  const runtime = inferRuntimeFromRepo(info)
  if (!runtime) {
    throw new Error(
      `Could not infer runtime for ${opts.repo}; specify --file <name.gguf> for llama.cpp`
    )
  }

  let file = opts.file
  if (runtime === "llama.cpp" && !file) {
    const ggufs = listGgufFiles(info)
    if (ggufs.length === 1) file = ggufs[0]!.rfilename
    else {
      throw new Error(
        `Multiple GGUF files in ${opts.repo}; specify --file <name.gguf>. Available: ${ggufs.map(g => g.rfilename).join(", ")}`
      )
    }
  }

  const dirs = getModelDirs()
  const localDir = runtime === "mlx"
    ? expandHome(dirs.mlx)
    : path.join(expandHome(dirs.llama), opts.repo.replace("/", "--"))

  const downloadedPath = await runHfDownload({
    repo: opts.repo,
    localDir,
    file,
    revision: opts.revision,
    onLine: opts.onLine,
    onEvent: opts.onEvent,
    signal: opts.signal
  })

  const resolvedPath = runtime === "llama.cpp"
    ? path.join(localDir, file!)
    : downloadedPath ?? resolveMlxSnapshot(localDir, opts.repo, opts.revision)

  if (runtime === "mlx" && !resolvedPath) {
    throw new Error(`Downloaded ${opts.repo}, but could not resolve its local HF snapshot path`)
  }
  const materializedPath = resolvedPath!

  // resolvedPath for MLX points at snapshots/<hash>/ — that's where
  // config.json lives and what detectMlxCapabilities expects.
  const mlxCapabilities = runtime === "mlx" ? detectMlxCapabilities(materializedPath) : undefined

  return {
    entry: materializeRegistryEntry(
      pullToMaterializeInput(opts.repo, file, opts.revision, runtime, materializedPath, mlxCapabilities)
    ).entry
  }
}
