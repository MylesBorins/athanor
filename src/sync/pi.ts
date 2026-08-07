import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import type { ActiveInstance, ModelEntry, RuntimeType } from "../types/index.js"
import type { LlamaConfig, MlxConfig } from "../types/index.js"
import { loadConfig } from "../config/index.js"
import { listModels } from "../registry/index.js"
import { mergedConfigFor, runtimeModelId } from "../adapters/index.js"
import { piDisplayNameFor } from "../registry/display.js"

// pi-agent stores both models and settings under ~/.pi/agent/.
// Schema reference: docs/models.md and docs/settings.md in the
// @mariozechner/pi-coding-agent package.
const PI_DIR = process.env.PI_HOME ?? path.join(os.homedir(), ".pi")
const PI_MODELS_PATH = path.join(PI_DIR, "agent", "models.json")
const PI_SETTINGS_PATH = path.join(PI_DIR, "agent", "settings.json")

// Each athanor-managed model becomes its own pi provider named
// `athanor-<runtime>-<slug>`. A pi provider has exactly one baseUrl
// and each athanor model runs on its own stable port, so one
// provider per model is required. The runtime segment keeps the
// backing engine obvious in pi's /model picker and in the JSON file.
//
// When `config.router.enabled` is true, pi instead sees up to two
// aggregating providers — `athanor-mlx` and `athanor-llama` — both
// pointing at the router port. The split keeps the backing engine
// obvious in pi's /model picker and in the JSON file. Per-model
// athanor-* providers are cleared in router mode so the /model picker
// isn't cluttered with duplicates; the legacy `athanor-router` aggregator
// (if present from an older install) is cleared the same way, because
// both constants share this prefix.
export const ATHANOR_PROVIDER_PREFIX = "athanor-"
export const ATHANOR_MLX_PROVIDER = "athanor-mlx"
export const ATHANOR_LLAMA_PROVIDER = "athanor-llama"

function runtimeTag(entry: ModelEntry): string {
  return entry.runtime === "llama.cpp" ? "llama" : "mlx"
}

interface PiModelConfig {
  id: string
  name?: string
  reasoning?: boolean
  input?: ("text" | "image")[]
  contextWindow?: number
  maxTokens?: number
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number }
  [key: string]: unknown
}

interface PiProviderConfig {
  baseUrl?: string
  api?: string
  apiKey?: string
  compat?: Record<string, boolean>
  headers?: Record<string, string>
  authHeader?: boolean
  models?: PiModelConfig[]
  [key: string]: unknown
}

interface PiModelsFile {
  providers?: Record<string, PiProviderConfig>
  [key: string]: unknown
}

interface PiSettings {
  defaultProvider?: string
  defaultModel?: string
  [key: string]: unknown
}

function readJsonFile<T extends Record<string, unknown>>(filepath: string, label: string): T {
  if (!fs.existsSync(filepath)) return {} as T
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(filepath, "utf8")) as unknown
  } catch (err) {
    throw new Error(`Failed to read ${label}: ${err}`, { cause: err })
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Failed to read ${label}: expected a JSON object`)
  }
  return parsed as T
}

function atomicWrite(filepath: string, data: string): void {
  const tmp = filepath + ".tmp"
  fs.writeFileSync(tmp, data, "utf8")
  fs.renameSync(tmp, filepath)
}

function ensureDir(filepath: string): void {
  fs.mkdirSync(path.dirname(filepath), { recursive: true })
}

function baseUrlFor(port: number): string {
  return `http://127.0.0.1:${port}/v1`
}

function providerNameFor(entry: ModelEntry): string {
  return `${ATHANOR_PROVIDER_PREFIX}${runtimeTag(entry)}-${entry.slug}`
}

function modelIdFor(entry: ModelEntry): string {
  // Must equal what the runtime was launched with so the OpenAI-
  // compatible server recognises the request. See
  // runtimeModelId() in src/adapters/index.ts.
  return runtimeModelId(entry)
}

function contextWindowFor(entry: ModelEntry): number | undefined {
  const merged = mergedConfigFor(entry)
  const raw = entry.runtime === "mlx"
    ? (merged as MlxConfig).contextWindow
    : (merged as LlamaConfig).ctxSize
  // pi-agent rejects non-positive values. For llama.cpp, ctxSize=0 means
  // "load from model" rather than a literal zero-token context window, so
  // omit the field when athanor does not have a concrete positive value.
  return Number.isFinite(raw) && raw > 0 ? raw : undefined
}

function compatForRuntime(runtime: RuntimeType): Record<string, boolean> {
  return runtime === "mlx"
    ? { supportsDeveloperRole: false, supportsReasoningEffort: false }
    : { supportsReasoningEffort: false }
}

function inputForEntry(entry: ModelEntry): Array<"text" | "image"> {
  return entry.runtime === "mlx" && entry.mlxFlavor === "vlm"
    ? ["text", "image"]
    : ["text"]
}

function providerFor(entry: ModelEntry, instance?: ActiveInstance): PiProviderConfig {
  return {
    baseUrl: baseUrlFor(entry.port),
    api: "openai-completions",
    // Both mlx_lm.server and llama-server accept (and ignore) any token.
    // pi requires the field to be present.
    apiKey: "athanor",
    compat: compatForRuntime(entry.runtime),
    models: [{
      id: modelIdFor(entry),
      name: piDisplayNameFor(entry),
      input: inputForEntry(entry),
      contextWindow: contextWindowFor(entry)
    }],
    // Informational fields. pi ignores unknown keys; we round-trip
    // them so users can see what athanor wrote.
    athanorId: entry.id,
    athanorRuntime: entry.runtime,
    athanorStatus: instance?.status ?? "idle"
  }
}

function readModelsFile(): PiModelsFile {
  return readJsonFile<PiModelsFile>(PI_MODELS_PATH, "pi models config")
}

function readSettingsFile(): PiSettings {
  return readJsonFile<PiSettings>(PI_SETTINGS_PATH, "pi settings")
}

export interface SyncInputs {
  activeDefault?: ActiveInstance
  instances?: ActiveInstance[]
}

function runtimeRouterProviderFor(
  entries: ModelEntry[],
  runtime: RuntimeType,
  routerBaseUrl: string
): PiProviderConfig {
  return {
    baseUrl: routerBaseUrl,
    api: "openai-completions",
    apiKey: "athanor",
    compat: compatForRuntime(runtime),
    models: entries.map(e => ({
      id: modelIdFor(e),
      name: piDisplayNameFor(e),
      input: inputForEntry(e),
      contextWindow: contextWindowFor(e)
    })),
    athanorRouter: true,
    athanorRuntime: runtime
  }
}

function providerNameForRuntime(runtime: RuntimeType): string {
  return runtime === "llama.cpp" ? ATHANOR_LLAMA_PROVIDER : ATHANOR_MLX_PROVIDER
}

// Re-emit only athanor's namespace into pi's config files. Non-athanor
// providers/settings must round-trip untouched. This function is the
// sole writer for athanor-managed pi state.
export function syncPi(inputs: SyncInputs = {}): void {
  const config = loadConfig()
  if (!config.enablePiSync) return

  const entries = listModels()
  const instances = inputs.instances ?? []
  const instanceById = new Map(instances.map(i => [i.id, i]))
  const existingModels = readModelsFile()
  const existingSettings = readSettingsFile()

  const emitted = syncModels(existingModels, entries, instanceById, config.router)
  syncSettings(existingSettings, entries, inputs.activeDefault, emitted, config.router)
}

// Provider emission follows one of two mutually exclusive shapes:
// router off => one provider per published model
// router on  => up to two runtime aggregators (mlx, llama.cpp)
// Never emit both shapes in the same sync.
function syncModels(
  existing: PiModelsFile,
  entries: ModelEntry[],
  instanceById: Map<string, ActiveInstance>,
  router: { enabled: boolean; host: string; port: number }
): Map<string, Set<string>> {
  const existingProviders = (existing.providers && typeof existing.providers === "object")
    ? existing.providers
    : {}

  // Preserve every non-athanor provider verbatim. The prefix is the
  // only marker we have (pi provider config has no metadata field).
  const next: Record<string, PiProviderConfig> = {}
  for (const [name, cfg] of Object.entries(existingProviders)) {
    if (!name.startsWith(ATHANOR_PROVIDER_PREFIX)) next[name] = cfg
  }

  const emitted = new Map<string, Set<string>>()

  if (router.enabled) {
    // Router mode: one aggregator per runtime, no per-model entries.
    // We keep two providers because the runtime segment keeps the
    // backing engine obvious in pi's /model picker and in the JSON file.
    // Providers with no exposed members are suppressed so the /model
    // picker isn't cluttered.
    const baseUrl = `http://${router.host}:${router.port}/v1`
    const exposed = entries.filter(e => e.publish)
    const mlxEntries = exposed.filter(e => e.runtime === "mlx")
    const llamaEntries = exposed.filter(e => e.runtime === "llama.cpp")
    if (mlxEntries.length > 0) {
      next[ATHANOR_MLX_PROVIDER] = runtimeRouterProviderFor(mlxEntries, "mlx", baseUrl)
      emitted.set(ATHANOR_MLX_PROVIDER, new Set(mlxEntries.map(modelIdFor)))
    }
    if (llamaEntries.length > 0) {
      next[ATHANOR_LLAMA_PROVIDER] = runtimeRouterProviderFor(llamaEntries, "llama.cpp", baseUrl)
      emitted.set(ATHANOR_LLAMA_PROVIDER, new Set(llamaEntries.map(modelIdFor)))
    }
  } else {
    for (const entry of entries) {
      if (!entry.publish) continue
      const name = providerNameFor(entry)
      next[name] = providerFor(entry, instanceById.get(entry.id))
      emitted.set(name, new Set([modelIdFor(entry)]))
    }
  }

  const out: PiModelsFile = { ...existing, providers: next }
  ensureDir(PI_MODELS_PATH)
  atomicWrite(PI_MODELS_PATH, JSON.stringify(out, null, 2))
  return emitted
}

// Settings writes are intentionally narrow: only defaultProvider and
// defaultModel are touched, and only when a caller supplies an active
// default instance. Absent an active default, settings are left alone.
function syncSettings(
  existing: PiSettings,
  entries: ModelEntry[],
  active: ActiveInstance | undefined,
  emitted: Map<string, Set<string>>,
  router: { enabled: boolean }
): void {
  const settings = { ...existing }
  let changed = false

  const clearAthanorDefault = (): void => {
    if (!String(settings.defaultProvider ?? "").startsWith(ATHANOR_PROVIDER_PREFIX)) return
    if (settings.defaultProvider !== undefined) {
      delete settings.defaultProvider
      changed = true
    }
    if (settings.defaultModel !== undefined) {
      delete settings.defaultModel
      changed = true
    }
  }

  if (active) {
    const entry = entries.find(e => e.id === active.id)
    if (entry) {
      const provider = router.enabled
        ? providerNameForRuntime(entry.runtime)
        : providerNameFor(entry)
      const model = modelIdFor(entry)
      if (emitted.get(provider)?.has(model)) {
        if (settings.defaultProvider !== provider) {
          settings.defaultProvider = provider
          changed = true
        }
        if (settings.defaultModel !== model) {
          settings.defaultModel = model
          changed = true
        }
      } else {
        clearAthanorDefault()
      }
    }
  } else if (String(settings.defaultProvider ?? "").startsWith(ATHANOR_PROVIDER_PREFIX)) {
    const provider = String(settings.defaultProvider)
    const model = typeof settings.defaultModel === "string" ? settings.defaultModel : undefined
    if (!model || !emitted.get(provider)?.has(model)) clearAthanorDefault()
  }

  if (!changed) return
  ensureDir(PI_SETTINGS_PATH)
  atomicWrite(PI_SETTINGS_PATH, JSON.stringify(settings, null, 2))
}

export function getPiDir(): string {
  return PI_DIR
}

export const PI_PATHS = { models: PI_MODELS_PATH, settings: PI_SETTINGS_PATH }
