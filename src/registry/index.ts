import * as fs from "fs"
import * as path from "path"
import type {
  ModelEntry,
  Registry,
  RuntimeType
} from "../types/index.js"
import { PATHS, ensureBaseDirs, loadConfig } from "../config/index.js"

function emptyRegistry(): Registry {
  return { version: 1, models: [] }
}

/** Canonical on-disk path for dedup: resolve symlinks, strip trailing slashes. */
export function normalizeModelPath(modelPath: string): string {
  const trimmed = modelPath.replace(/\/+$/, "") || modelPath
  try {
    return fs.realpathSync(trimmed)
  } catch {
    return path.resolve(trimmed)
  }
}

function atomicWrite(filepath: string, data: string): void {
  const tmp = filepath + ".tmp"
  fs.writeFileSync(tmp, data, "utf8")
  fs.renameSync(tmp, filepath)
}

function readRegistryFromDisk(): Registry {
  if (!fs.existsSync(PATHS.registry)) return emptyRegistry()
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(PATHS.registry, "utf8"))
  } catch (err) {
    throw new Error(`Failed to load registry: ${err}`)
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("Failed to load registry: expected a JSON object")
  }
  if (!Array.isArray((raw as { models?: unknown }).models)) {
    throw new Error("Failed to load registry: expected models to be an array")
  }
  return { version: 1, models: (raw as { models: ModelEntry[] }).models }
}

function parseOrgRepoDir(dirName: string): { org: string; repo: string } | null {
  const firstSep = dirName.indexOf("--")
  if (firstSep < 0) return null
  const org = dirName.slice(0, firstSep)
  const repo = dirName.slice(firstSep + 2)
  if (!org || !repo) return null
  return { org, repo }
}

function inferHfGgufSourceFromPath(modelPath: string): { repo: string; file: string } | null {
  const parts = normalizeModelPath(modelPath).split(path.sep).filter(Boolean)
  const snapshotsIdx = parts.lastIndexOf("snapshots")
  if (snapshotsIdx < 2 || snapshotsIdx + 2 !== parts.length - 1) return null
  const modelDir = parts[snapshotsIdx - 1]
  if (!modelDir?.startsWith("models--")) return null
  const parsed = parseOrgRepoDir(modelDir.slice("models--".length))
  if (!parsed) return null
  const file = parts[parts.length - 1]!
  if (!file.endsWith(".gguf")) return null
  return { repo: `${parsed.org}/${parsed.repo}`, file }
}

function upgradeLocalSourceFromPath(entry: ModelEntry): boolean {
  if (entry.source.type !== "local" || entry.runtime !== "llama.cpp") return false
  const inferred = inferHfGgufSourceFromPath(entry.path)
  if (!inferred) return false
  entry.source = { type: "hf", repo: inferred.repo, file: inferred.file }
  entry.id = `${inferred.repo}:${inferred.file}`
  return true
}

function pickDuplicatePrimary(a: ModelEntry, b: ModelEntry): [ModelEntry, ModelEntry] {
  if (a.source.type === "hf" && b.source.type !== "hf") return [a, b]
  if (b.source.type === "hf" && a.source.type !== "hf") return [b, a]
  return a.addedAt <= b.addedAt ? [a, b] : [b, a]
}

function mergeUserOwnedFields(primary: ModelEntry, donor: ModelEntry): void {
  if (!primary.preset && donor.preset) primary.preset = donor.preset
  if (!primary.tags?.length && donor.tags?.length) primary.tags = [...donor.tags]
  if (primary.mlxFlavor === undefined && donor.mlxFlavor !== undefined) {
    primary.mlxFlavor = donor.mlxFlavor
  }
  if (primary.publish && !donor.publish) primary.publish = donor.publish
  if (
    (!primary.piAlias || primary.piAlias === primary.slug) &&
    donor.piAlias &&
    donor.piAlias !== donor.slug
  ) {
    primary.piAlias = donor.piAlias
  }
}

function mergeDuplicateEntries(primary: ModelEntry, donor: ModelEntry): void {
  if (donor.source.type === "hf" && primary.source.type === "local") {
    primary.id = donor.id
    primary.source = donor.source
  }
  if (donor.sizeBytes !== undefined && primary.sizeBytes !== donor.sizeBytes) {
    primary.sizeBytes = donor.sizeBytes
  }
  if (donor.runtime === "mlx" && donor.mlxCapabilities !== undefined) {
    if (donor.mlxCapabilities.length > 0) primary.mlxCapabilities = [...donor.mlxCapabilities]
    else delete primary.mlxCapabilities
  }
  if (donor.architectureFamily !== undefined) primary.architectureFamily = donor.architectureFamily
  if (donor.trainedContextLength !== undefined) primary.trainedContextLength = donor.trainedContextLength
  if (donor.quantization !== undefined) primary.quantization = donor.quantization
  if (donor.paramCount !== undefined) primary.paramCount = donor.paramCount
  if (donor.isMoe !== undefined) primary.isMoe = donor.isMoe
  if (donor.activeParams !== undefined) primary.activeParams = donor.activeParams
  if (donor.metadataSource !== undefined) primary.metadataSource = donor.metadataSource
  mergeUserOwnedFields(primary, donor)
}

/** Collapse registry rows that share the same normalized path. */
export function deduplicateRegistry(reg: Registry = readRegistryFromDisk()): Registry {
  let changed = false
  for (const entry of reg.models) {
    if (upgradeLocalSourceFromPath(entry)) changed = true
  }

  const groups = new Map<string, ModelEntry[]>()
  for (const entry of reg.models) {
    const key = normalizeModelPath(entry.path)
    const list = groups.get(key)
    if (list) list.push(entry)
    else groups.set(key, [entry])
  }

  const merged: ModelEntry[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]!)
      continue
    }
    changed = true
    let primary = group[0]!
    for (let i = 1; i < group.length; i++) {
      const [nextPrimary, donor] = pickDuplicatePrimary(primary, group[i]!)
      primary = nextPrimary
      mergeDuplicateEntries(primary, donor)
    }
    merged.push(primary)
  }

  if (changed) {
    reg.models = merged
    saveRegistry(reg)
  }
  return reg
}

export function loadRegistry(): Registry {
  return deduplicateRegistry(readRegistryFromDisk())
}

export function saveRegistry(registry: Registry): void {
  ensureBaseDirs()
  atomicWrite(PATHS.registry, JSON.stringify(registry, null, 2))
}

export function listModels(): ModelEntry[] {
  return loadRegistry().models
}

export function getModel(idOrSlug: string): ModelEntry | undefined {
  const models = listModels()
  return models.find(m => m.id === idOrSlug || m.slug === idOrSlug)
}

export function upsertModel(entry: ModelEntry): ModelEntry {
  const reg = loadRegistry()
  const idx = reg.models.findIndex(m => m.id === entry.id)
  if (idx >= 0) {
    reg.models[idx] = entry
  } else {
    reg.models.push(entry)
  }
  saveRegistry(reg)
  return entry
}

export function updateModel(
  idOrSlug: string,
  patch: Partial<ModelEntry>
): ModelEntry | undefined {
  const reg = loadRegistry()
  const idx = reg.models.findIndex(
    m => m.id === idOrSlug || m.slug === idOrSlug
  )
  if (idx < 0) return undefined
  const merged: ModelEntry = { ...reg.models[idx]!, ...patch }
  reg.models[idx] = merged
  saveRegistry(reg)
  return merged
}

export function setModelPublish(idOrSlug: string, publish: boolean): ModelEntry | undefined {
  return updateModel(idOrSlug, { publish })
}

export function setModelFlavor(
  idOrSlug: string,
  mlxFlavor: ModelEntry["mlxFlavor"]
): ModelEntry | undefined {
  return updateModel(idOrSlug, { mlxFlavor })
}

export function setModelPreset(
  idOrSlug: string,
  preset: ModelEntry["preset"]
): ModelEntry | undefined {
  return updateModel(idOrSlug, { preset })
}

export function touchModelLastUsed(idOrSlug: string, at = Date.now()): ModelEntry | undefined {
  return updateModel(idOrSlug, { lastUsedAt: at })
}

export function removeModel(idOrSlug: string): boolean {
  const reg = loadRegistry()
  const before = reg.models.length
  reg.models = reg.models.filter(
    m => m.id !== idOrSlug && m.slug !== idOrSlug
  )
  if (reg.models.length === before) return false
  saveRegistry(reg)
  return true
}

export function slugify(input: string): string {
  const last = input.split("/").pop() ?? input
  const base = last
    .toLowerCase()
    .replace(/\.(gguf|safetensors|bin)$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return base || "model"
}

export function uniqueSlug(desired: string, taken: Set<string>): string {
  if (!taken.has(desired)) return desired
  let n = 2
  while (taken.has(`${desired}-${n}`)) n++
  return `${desired}-${n}`
}

export function allocatePort(
  taken: Set<number>,
  range?: { min: number; max: number }
): number {
  const cfg = range ?? loadConfig().portRange
  for (let p = cfg.min; p <= cfg.max; p++) {
    if (!taken.has(p)) return p
  }
  throw new Error(
    `No free port in range ${cfg.min}-${cfg.max}. Expand portRange in config.`
  )
}

export interface RegistrySnapshot {
  ids: Set<string>
  slugs: Set<string>
  ports: Set<number>
  paths: Set<string>
}

export function snapshot(reg: Registry = loadRegistry()): RegistrySnapshot {
  return {
    ids: new Set(reg.models.map(m => m.id)),
    slugs: new Set(reg.models.map(m => m.slug)),
    ports: new Set(reg.models.map(m => m.port)),
    paths: new Set(reg.models.map(m => m.path))
  }
}

export function defaultPiAlias(slug: string): string {
  return slug
}

export function makeId(runtime: RuntimeType, source: ModelEntry["source"], path: string): string {
  if (source.type === "hf") {
    const rev = source.revision ? `@${source.revision}` : ""
    const file = source.file ? `:${source.file}` : ""
    return `${source.repo}${rev}${file}`
  }
  return `local:${runtime}:${path}`
}
