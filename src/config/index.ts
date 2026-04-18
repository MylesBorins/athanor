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
    prefillStepSize: 256,
    promptCacheSize: 1024,
    decodeConcurrency: 1
  },
  llama: {
    nGpuLayers: 999,
    threads: 10,
    ctxSize: 12288,
    batchSize: 128,
    ubatchSize: 64,
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
    enabled: false,
    port: 8080,
    host: "127.0.0.1",
    drainTimeoutMs: 30_000
  }
}

function expandHome(dir: string): string {
  return dir.replace(/^~/, os.homedir())
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base }
  for (const key of Object.keys(override || {})) {
    const b = (base as any)?.[key]
    const o = (override as any)[key]
    if (o && typeof o === "object" && !Array.isArray(o) && b && typeof b === "object") {
      out[key] = deepMerge(b, o)
    } else if (o !== undefined) {
      out[key] = o
    }
  }
  return out
}

export function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, "utf8")
      const loaded = JSON.parse(data) as Partial<Config>
      return deepMerge(DEFAULT_CONFIG, loaded)
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
