import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import type { ActiveInstance, ModelEntry, RuntimeType } from "../types/index.js"
import { loadConfig } from "../config/index.js"
import { listModels } from "../registry/index.js"
import { runtimeModelId } from "../adapters/index.js"

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
// pointing at the router port. The split exists because pi's provider
// compat flags differ by runtime: mlx_lm/vlm don't accept the
// developer role, llama-server does. Per-model athanor-* providers
// are cleared in router mode so the /model picker isn't cluttered
// with duplicates; the legacy `athanor-router` aggregator (if present
// from an older install) is cleared the same way, because both
// constants share this prefix.
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
  compat?: Record<string, unknown>
  [key: string]: unknown
}

interface PiProviderConfig {
  baseUrl?: string
  api?: string
  apiKey?: string
  headers?: Record<string, string>
  authHeader?: boolean
  compat?: Record<string, unknown>
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

function runtimeLabel(entry: ModelEntry): string {
  if (entry.runtime === "mlx" && entry.mlxFlavor === "vlm") return "mlx-vlm"
  return entry.runtime
}

function displayNameFor(entry: ModelEntry): string {
  return `[${runtimeLabel(entry)}] ${entry.slug} (athanor)`
}

function providerFor(entry: ModelEntry, instance?: ActiveInstance): PiProviderConfig {
  return {
    baseUrl: baseUrlFor(entry.port),
    api: "openai-completions",
    // Both mlx_lm.server and llama-server accept (and ignore) any token.
    // pi requires the field to be present.
    apiKey: "athanor",
    // Local OpenAI-compatible servers typically don't speak the
    // developer role or reasoning_effort. Pi's own docs recommend
    // these flags for Ollama/vLLM/SGLang; mlx_lm.server and
    // llama-server are in the same family.
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false
    },
    models: [{
      id: modelIdFor(entry),
      name: displayNameFor(entry),
      input: ["text"]
    }],
    // Informational fields. pi ignores unknown keys; we round-trip
    // them so users can see what athanor wrote.
    athanorId: entry.id,
    athanorRuntime: entry.runtime,
    athanorStatus: instance?.status ?? "idle"
  }
}

function readModelsFile(): PiModelsFile {
  if (!fs.existsSync(PI_MODELS_PATH)) return {}
  try {
    const parsed = JSON.parse(fs.readFileSync(PI_MODELS_PATH, "utf8"))
    return (parsed && typeof parsed === "object") ? parsed : {}
  } catch (err) {
    console.error(`Failed to read pi models config: ${err}`)
    return {}
  }
}

function readSettingsFile(): PiSettings {
  if (!fs.existsSync(PI_SETTINGS_PATH)) return {}
  try {
    const parsed = JSON.parse(fs.readFileSync(PI_SETTINGS_PATH, "utf8"))
    return (parsed && typeof parsed === "object") ? parsed : {}
  } catch (err) {
    console.error(`Failed to read pi settings: ${err}`)
    return {}
  }
}

export interface SyncInputs {
  activeDefault?: ActiveInstance
  instances?: ActiveInstance[]
}

// Per-runtime compat flags. MLX (both mlx_lm and mlx_vlm) rejects the
// developer role; llama-server accepts it when the chat template does.
// reasoning_effort is not honoured by either engine today.
function compatFor(runtime: RuntimeType): Record<string, unknown> {
  if (runtime === "mlx") {
    return { supportsDeveloperRole: false, supportsReasoningEffort: false }
  }
  return { supportsReasoningEffort: false }
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
    compat: compatFor(runtime),
    models: entries.map(e => ({
      id: modelIdFor(e),
      name: displayNameFor(e),
      input: ["text"]
    })),
    athanorRouter: true,
    athanorRuntime: runtime
  }
}

function providerNameForRuntime(runtime: RuntimeType): string {
  return runtime === "llama.cpp" ? ATHANOR_LLAMA_PROVIDER : ATHANOR_MLX_PROVIDER
}

export function syncPi(inputs: SyncInputs = {}): void {
  const config = loadConfig()
  if (!config.enablePiSync) return

  const entries = listModels()
  const instances = inputs.instances ?? []
  const instanceById = new Map(instances.map(i => [i.id, i]))

  syncModels(entries, instanceById, config.router)
  syncSettings(entries, inputs.activeDefault, config.router)
}

function syncModels(
  entries: ModelEntry[],
  instanceById: Map<string, ActiveInstance>,
  router: { enabled: boolean; host: string; port: number }
): void {
  const existing = readModelsFile()
  const existingProviders = (existing.providers && typeof existing.providers === "object")
    ? existing.providers
    : {}

  // Preserve every non-athanor provider verbatim. The prefix is the
  // only marker we have (pi provider config has no metadata field).
  const next: Record<string, PiProviderConfig> = {}
  for (const [name, cfg] of Object.entries(existingProviders)) {
    if (!name.startsWith(ATHANOR_PROVIDER_PREFIX)) next[name] = cfg
  }

  if (router.enabled) {
    // Router mode: one aggregator per runtime, no per-model entries.
    // The compat block differs between mlx and llama.cpp, which is why
    // we don't share a single provider. Providers with no exposed
    // members are suppressed so the /model picker isn't cluttered.
    const baseUrl = `http://${router.host}:${router.port}/v1`
    const exposed = entries.filter(e => e.publish)
    const mlxEntries = exposed.filter(e => e.runtime === "mlx")
    const llamaEntries = exposed.filter(e => e.runtime === "llama.cpp")
    if (mlxEntries.length > 0) {
      next[ATHANOR_MLX_PROVIDER] = runtimeRouterProviderFor(mlxEntries, "mlx", baseUrl)
    }
    if (llamaEntries.length > 0) {
      next[ATHANOR_LLAMA_PROVIDER] = runtimeRouterProviderFor(llamaEntries, "llama.cpp", baseUrl)
    }
  } else {
    for (const entry of entries) {
      if (!entry.publish) continue
      next[providerNameFor(entry)] = providerFor(entry, instanceById.get(entry.id))
    }
  }

  const out: PiModelsFile = { ...existing, providers: next }
  ensureDir(PI_MODELS_PATH)
  atomicWrite(PI_MODELS_PATH, JSON.stringify(out, null, 2))
}

function syncSettings(
  entries: ModelEntry[],
  active: ActiveInstance | undefined,
  router: { enabled: boolean }
): void {
  if (!active) return
  const entry = entries.find(e => e.id === active.id)
  if (!entry) return
  const settings = readSettingsFile()
  settings.defaultProvider = router.enabled
    ? providerNameForRuntime(entry.runtime)
    : providerNameFor(entry)
  settings.defaultModel = modelIdFor(entry)
  ensureDir(PI_SETTINGS_PATH)
  atomicWrite(PI_SETTINGS_PATH, JSON.stringify(settings, null, 2))
}

export function getPiDir(): string {
  return PI_DIR
}

export const PI_PATHS = { models: PI_MODELS_PATH, settings: PI_SETTINGS_PATH }
