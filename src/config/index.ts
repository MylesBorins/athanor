import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import type {
  LlamaConfig,
  MlxConfig,
  SupervisorPolicy
} from "../types/index.js"

const CONFIG_BASE = process.env.ATHANOR_HOME ?? path.join(os.homedir(), ".athanor")
const CONFIG_PATH = path.join(CONFIG_BASE, "config.json")

export const PATHS = {
  base: CONFIG_BASE,
  config: CONFIG_PATH,
  registry: path.join(CONFIG_BASE, "models.json"),
  state: path.join(CONFIG_BASE, "state.json"),
  logsDir: path.join(CONFIG_BASE, "logs"),
  // User-defined recipes. Never written by the app — only read. Users
  // edit this file directly; scan / pull / sync leave it alone.
  recipes: path.join(CONFIG_BASE, "recipes.json")
}

export interface PortRange {
  min: number
  max: number
}

export interface SupervisorConfig {
  policy: SupervisorPolicy
  maxConcurrent: number
  startupTimeoutMs: number
  healthPollIntervalMs: number
}

export interface ControlApiConfig {
  enabled: boolean
  port: number
  host: string
}

// OpenAI-compatible proxy that fronts every exposed model on a single
// port. When enabled, pi-agent sees up to two aggregator providers —
// `athanor-mlx` and `athanor-llama` — both pointing at the router and
// each carrying the compat flags that runtime needs. Model-switching
// inside pi triggers on-demand supervisor.start() for the selected
// entry. Off by default and 127.0.0.1-only, same posture as the
// control API.
export interface RouterConfig {
  enabled: boolean
  port: number
  host: string
  // Max time supervisor.stop waits for in-flight router streams targeting
  // the model to drain before SIGTERM. 0 disables waiting.
  drainTimeoutMs: number
}

export interface Config {
  portRange: PortRange
  enablePiSync: boolean
  modelDirs: {
    mlx: string
    llama: string
  }
  mlx: MlxConfig
  llama: LlamaConfig
  supervisor: SupervisorConfig
  controlApi: ControlApiConfig
  router: RouterConfig
}

export const DEFAULT_CONFIG: Config = {
  portRange: { min: 8081, max: 8099 },
  enablePiSync: true,
  modelDirs: {
    mlx: "~/.cache/huggingface/hub",
    llama: "~/.models"
  },
  mlx: {
    prefillStepSize: 512,
    promptCacheSize: 32768,
    decodeConcurrency: 1
  },
  llama: {
    nGpuLayers: 999,
    threads: 8,
    ctxSize: 32768,
    batchSize: 512,
    ubatchSize: 256,
    parallel: 1
  },
  supervisor: {
    policy: "single-active",
    maxConcurrent: 1,
    startupTimeoutMs: 120_000,
    healthPollIntervalMs: 500
  },
  controlApi: {
    enabled: false,
    port: 8079,
    host: "127.0.0.1"
  },
  router: {
    enabled: true,
    port: 8080,
    host: "127.0.0.1",
    drainTimeoutMs: 30_000
  }
}

function expandHome(dir: string): string {
  return dir.replace(/^~/, os.homedir())
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function validPort(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 65535
}

function positiveNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0
}

function nonNegativeNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0
}

function sanitizeConfig(config: Config): Config {
  const next: Config = {
    ...config,
    modelDirs: { ...config.modelDirs },
    portRange: { ...config.portRange },
    mlx: { ...config.mlx },
    llama: { ...config.llama },
    supervisor: { ...config.supervisor },
    controlApi: { ...config.controlApi },
    router: { ...config.router }
  }

  if (!validPort(next.portRange.min) || !validPort(next.portRange.max)
      || next.portRange.min > next.portRange.max) {
    console.error("Invalid config.portRange; using defaults")
    next.portRange = { ...DEFAULT_CONFIG.portRange }
  }

  if (!positiveNumber(next.mlx.prefillStepSize)) {
    console.error("Invalid config.mlx.prefillStepSize; using default")
    next.mlx.prefillStepSize = DEFAULT_CONFIG.mlx.prefillStepSize
  }
  if (!positiveNumber(next.mlx.promptCacheSize)) {
    console.error("Invalid config.mlx.promptCacheSize; using default")
    next.mlx.promptCacheSize = DEFAULT_CONFIG.mlx.promptCacheSize
  }
  if (!positiveNumber(next.mlx.decodeConcurrency)) {
    console.error("Invalid config.mlx.decodeConcurrency; using default")
    next.mlx.decodeConcurrency = DEFAULT_CONFIG.mlx.decodeConcurrency
  }

  if (!nonNegativeNumber(next.llama.nGpuLayers)) {
    console.error("Invalid config.llama.nGpuLayers; using default")
    next.llama.nGpuLayers = DEFAULT_CONFIG.llama.nGpuLayers
  }
  if (!positiveNumber(next.llama.threads)) {
    console.error("Invalid config.llama.threads; using default")
    next.llama.threads = DEFAULT_CONFIG.llama.threads
  }
  if (!positiveNumber(next.llama.ctxSize)) {
    console.error("Invalid config.llama.ctxSize; using default")
    next.llama.ctxSize = DEFAULT_CONFIG.llama.ctxSize
  }
  if (!positiveNumber(next.llama.batchSize)) {
    console.error("Invalid config.llama.batchSize; using default")
    next.llama.batchSize = DEFAULT_CONFIG.llama.batchSize
  }
  if (!positiveNumber(next.llama.ubatchSize)) {
    console.error("Invalid config.llama.ubatchSize; using default")
    next.llama.ubatchSize = DEFAULT_CONFIG.llama.ubatchSize
  }
  if (!positiveNumber(next.llama.parallel)) {
    console.error("Invalid config.llama.parallel; using default")
    next.llama.parallel = DEFAULT_CONFIG.llama.parallel
  }

  const policies = new Set(["single-active", "multi-active-lru", "manual"])
  if (!policies.has(next.supervisor.policy)) {
    console.error("Invalid config.supervisor.policy; using default")
    next.supervisor.policy = DEFAULT_CONFIG.supervisor.policy
  }
  if (!positiveNumber(next.supervisor.maxConcurrent)) {
    console.error("Invalid config.supervisor.maxConcurrent; using default")
    next.supervisor.maxConcurrent = DEFAULT_CONFIG.supervisor.maxConcurrent
  }
  if (!positiveNumber(next.supervisor.startupTimeoutMs)) {
    console.error("Invalid config.supervisor.startupTimeoutMs; using default")
    next.supervisor.startupTimeoutMs = DEFAULT_CONFIG.supervisor.startupTimeoutMs
  }
  if (!positiveNumber(next.supervisor.healthPollIntervalMs)) {
    console.error("Invalid config.supervisor.healthPollIntervalMs; using default")
    next.supervisor.healthPollIntervalMs = DEFAULT_CONFIG.supervisor.healthPollIntervalMs
  }

  if (typeof next.controlApi.host !== "string" || next.controlApi.host.length === 0) {
    console.error("Invalid config.controlApi.host; using default")
    next.controlApi.host = DEFAULT_CONFIG.controlApi.host
  }
  if (!validPort(next.controlApi.port)) {
    console.error("Invalid config.controlApi.port; using default")
    next.controlApi.port = DEFAULT_CONFIG.controlApi.port
  }

  if (typeof next.router.host !== "string" || next.router.host.length === 0) {
    console.error("Invalid config.router.host; using default")
    next.router.host = DEFAULT_CONFIG.router.host
  }
  if (!validPort(next.router.port)) {
    console.error("Invalid config.router.port; using default")
    next.router.port = DEFAULT_CONFIG.router.port
  }
  if (!nonNegativeNumber(next.router.drainTimeoutMs)) {
    console.error("Invalid config.router.drainTimeoutMs; using default")
    next.router.drainTimeoutMs = DEFAULT_CONFIG.router.drainTimeoutMs
  }

  if (typeof next.enablePiSync !== "boolean") next.enablePiSync = DEFAULT_CONFIG.enablePiSync
  if (typeof next.controlApi.enabled !== "boolean") next.controlApi.enabled = DEFAULT_CONFIG.controlApi.enabled
  if (typeof next.router.enabled !== "boolean") next.router.enabled = DEFAULT_CONFIG.router.enabled
  if (typeof next.modelDirs.mlx !== "string" || next.modelDirs.mlx.length === 0) {
    next.modelDirs.mlx = DEFAULT_CONFIG.modelDirs.mlx
  }
  if (typeof next.modelDirs.llama !== "string" || next.modelDirs.llama.length === 0) {
    next.modelDirs.llama = DEFAULT_CONFIG.modelDirs.llama
  }

  return next
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  type Bag = Record<string, unknown>
  const src = (base ?? {}) as Bag
  const ov = (override ?? {}) as Bag
  const out: Bag = Array.isArray(base) ? [...(base as unknown[])] as unknown as Bag : { ...src }
  for (const key of Object.keys(ov)) {
    const b = src[key]
    const o = ov[key]
    if (o && typeof o === "object" && !Array.isArray(o) && b && typeof b === "object") {
      out[key] = deepMerge(b as object, o as Partial<object>)
    } else if (o !== undefined) {
      out[key] = o
    }
  }
  return out as T
}

export function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, "utf8")
      const parsed = JSON.parse(data) as unknown
      const loaded = isRecord(parsed) ? parsed as Partial<Config> : {}
      return sanitizeConfig(deepMerge(DEFAULT_CONFIG, loaded))
    }
  } catch (err) {
    console.error(`Failed to load config: ${err}`)
  }
  try { saveConfig(DEFAULT_CONFIG) } catch { /* non-writable home */ }
  return DEFAULT_CONFIG
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_BASE, { recursive: true })
  const tmp = CONFIG_PATH + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), "utf8")
  fs.renameSync(tmp, CONFIG_PATH)
}

export function getModelDirs(): { mlx: string; llama: string } {
  const config = loadConfig()
  return {
    mlx: expandHome(config.modelDirs.mlx),
    llama: expandHome(config.modelDirs.llama)
  }
}

export function ensureBaseDirs(): void {
  fs.mkdirSync(CONFIG_BASE, { recursive: true })
  fs.mkdirSync(PATHS.logsDir, { recursive: true })
}
