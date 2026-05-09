import * as fs from "fs"
import * as path from "path"
import { PATHS } from "../config/index.js"
import type { SearchSelectionHint } from "./hf.js"

const CACHE_DIR = path.join(PATHS.base, "cache")
const REPO_HINTS_PATH = path.join(CACHE_DIR, "search-repo-hints.json")
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface CachedHintEntry {
  hint: SearchSelectionHint
  updatedAt: number
}

interface RepoHintCacheFile {
  version: 1
  repos: Record<string, CachedHintEntry>
}

function atomicWrite(filepath: string, data: string): void {
  const tmp = filepath + ".tmp"
  fs.writeFileSync(tmp, data, "utf8")
  fs.renameSync(tmp, filepath)
}

function loadCacheFile(): RepoHintCacheFile {
  try {
    if (!fs.existsSync(REPO_HINTS_PATH)) return { version: 1, repos: {} }
    const raw = JSON.parse(fs.readFileSync(REPO_HINTS_PATH, "utf8")) as Partial<RepoHintCacheFile>
    if (!raw || typeof raw !== "object" || !raw.repos || typeof raw.repos !== "object") {
      return { version: 1, repos: {} }
    }
    return { version: 1, repos: raw.repos }
  } catch {
    return { version: 1, repos: {} }
  }
}

function saveCacheFile(cache: RepoHintCacheFile): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  atomicWrite(REPO_HINTS_PATH, JSON.stringify(cache, null, 2))
}

export function loadRepoHintCache(): Record<string, SearchSelectionHint> {
  const now = Date.now()
  const cache = loadCacheFile()
  const out: Record<string, SearchSelectionHint> = {}
  for (const [repo, entry] of Object.entries(cache.repos)) {
    if (!entry || typeof entry !== "object") continue
    if (typeof entry.updatedAt !== "number") continue
    if (now - entry.updatedAt > MAX_AGE_MS) continue
    out[repo] = entry.hint
  }
  return out
}

export function saveRepoHint(repo: string, hint: SearchSelectionHint): void {
  const cache = loadCacheFile()
  cache.repos[repo] = { hint, updatedAt: Date.now() }
  saveCacheFile(cache)
}
