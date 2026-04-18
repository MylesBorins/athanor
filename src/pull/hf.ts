import * as os from "os"
import * as path from "path"
import type { ModelEntry, RuntimeType } from "../types/index.js"
import {
  allocatePort,
  loadRegistry,
  saveRegistry,
  slugify,
  snapshot,
  uniqueSlug
} from "../registry/index.js"
import { getModelDirs } from "../config/index.js"
import {
  fetchRepoInfo,
  inferRuntimeFromRepo,
  listGgufFiles
} from "./api.js"
import { runHfDownload, resolveMlxSnapshot } from "./download.js"
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
  // See DownloadOptions.inherit — when true, `hf`'s native progress bar
  // renders directly to the terminal. Appropriate for CLI, not TUI.
  inherit?: boolean
  // See DownloadOptions.signal — aborting will SIGTERM/SIGKILL the hf
  // child and reject with PullAbortedError. No registry entry is
  // written on abort.
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

  await runHfDownload({
    repo: opts.repo,
    localDir,
    file,
    revision: opts.revision,
    onLine: opts.onLine,
    inherit: opts.inherit,
    signal: opts.signal
  })

  const resolvedPath = runtime === "llama.cpp"
    ? path.join(localDir, file!)
    : resolveMlxSnapshot(localDir, opts.repo) ?? localDir

  return {
    entry: upsertRegistryEntry(opts.repo, file, opts.revision, runtime, resolvedPath)
  }
}

function upsertRegistryEntry(
  repo: string,
  file: string | undefined,
  revision: string | undefined,
  runtime: RuntimeType,
  resolvedPath: string
): ModelEntry {
  const reg = loadRegistry()
  const snap = snapshot(reg)
  const id = file ? `${repo}:${file}` : repo
  // resolvedPath for MLX points at snapshots/<hash>/ — that's where
  // config.json lives and what detectMlxCapabilities expects.
  const mlxCapabilities = runtime === "mlx" ? detectMlxCapabilities(resolvedPath) : undefined
  const existing = reg.models.find(m => m.id === id)
  if (existing) {
    existing.path = resolvedPath
    if (mlxCapabilities) existing.mlxCapabilities = mlxCapabilities
    saveRegistry(reg)
    return existing
  }
  const slug = uniqueSlug(
    slugify(file ? path.basename(file, ".gguf") : repo),
    snap.slugs
  )
  const port = allocatePort(snap.ports)
  const entry: ModelEntry = {
    id,
    slug,
    path: resolvedPath,
    runtime,
    source: { type: "hf", repo, revision, file },
    port,
    publish: true,
    piAlias: slug,
    addedAt: Date.now(),
    ...(mlxCapabilities && mlxCapabilities.length > 0 ? { mlxCapabilities } : {})
  }
  reg.models.push(entry)
  saveRegistry(reg)
  return entry
}
