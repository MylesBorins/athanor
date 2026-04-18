import * as fs from "fs"
import type {
  ModelEntry,
  Registry,
  RuntimeType
} from "../types/index.js"
import { PATHS, ensureBaseDirs, loadConfig } from "../config/index.js"

function emptyRegistry(): Registry {
  return { version: 1, models: [] }
}

function atomicWrite(filepath: string, data: string): void {
  const tmp = filepath + ".tmp"
  fs.writeFileSync(tmp, data, "utf8")
  fs.renameSync(tmp, filepath)
}

export function loadRegistry(): Registry {
  try {
    if (!fs.existsSync(PATHS.registry)) return emptyRegistry()
    const raw = JSON.parse(fs.readFileSync(PATHS.registry, "utf8"))
    if (!raw || typeof raw !== "object") return emptyRegistry()
    if (!Array.isArray(raw.models)) return emptyRegistry()
    return { version: 1, models: raw.models as ModelEntry[] }
  } catch (err) {
    console.error(`Failed to load registry: ${err}`)
    return emptyRegistry()
  }
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
