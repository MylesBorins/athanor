import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { parsePromptCacheBytes } from "./promptCacheBytes.js"
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
  recipes: path.join(CONFIG_BASE, "recipes.json"),
  telemetry: path.join(CONFIG_BASE, "telemetry.json")
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
// port. When enabled (the default), pi-agent sees up to two aggregator
// providers — `athanor-mlx` and `athanor-llama` — both pointing at the
// router and each carrying the compat flags that runtime needs. Model-
// switching inside pi triggers on-demand supervisor.start() for the
// selected entry. 127.0.0.1-only, same posture as the control API.
export interface RouterConfig {
  enabled: boolean
  port: number
  host: string
  // Max time supervisor.stop waits for in-flight router streams targeting
  // the model to drain before SIGTERM. 0 disables waiting.
  drainTimeoutMs: number
  // Log every inbound request (method, path, model field, status, latency)
  // to ~/.athanor/logs/router.log. Off by default.
  verbose: boolean
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

function mergedSection<T extends object>(
  value: unknown,
  fallback: T
): T {
  return isRecord(value) ? { ...fallback, ...value as Partial<T> } : { ...fallback }
}

export const DEFAULT_CONFIG: Config = {
  portRange: { min: 40880, max: 40979 },
  enablePiSync: true,
  modelDirs: {
    mlx: "~/.cache/huggingface/hub",
    llama: "~/.models"
  },
  mlx: {
    // Matches mlx_lm.server's own default so the flag is suppressed
    // when no recipe/preset overrides it.
    prefillStepSize: 2048,
    promptCacheSize: 32768,
    decodeConcurrency: 1,
    contextWindow: 32768,
    // Per-response output cap. mlx_lm.server's own default is 512;
    // 4096 is a more useful baseline for chat/coding workflows.
    maxTokens: 4096,
    // Human-friendly UI input is supported, but config schema is bytes.
    // Defaults to 0 to let mlx_lm.server choose its own cap.
    promptCacheBytes: 0,
    // Sampling defaults — server uses these as per-request fall-backs.
    temp: 0,
    topP: 1,
    topK: 0,
    minP: 0,
    promptConcurrency: 8
  },
  llama: {
    nGpuLayers: 999,
    // 32768 is a safe default for Apple Silicon — ctxSize:0 loads the model's
    // native context window which can exhaust unified memory before inference
    // starts. Recipes and per-model presets can override this.
    ctxSize: 32768,
    // Match llama-server's own defaults (batch-size: 2048, ubatch-size: 512)
    // so athanor does not silently degrade prompt-processing throughput.
    batchSize: 2048,
    ubatchSize: 512,
    parallel: 1,
    speculativeMode: "auto"
  },
  supervisor: {
    policy: "single-active",
    maxConcurrent: 1,
    startupTimeoutMs: 120_000,
    healthPollIntervalMs: 500
  },
  controlApi: {
    enabled: false,
    port: 40878,
    host: "127.0.0.1"
  },
  router: {
    enabled: true,
    port: 40879,
    host: "127.0.0.1",
    drainTimeoutMs: 30_000,
    verbose: false
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
  if (!positiveNumber(next.mlx.contextWindow)) {
    console.error("Invalid config.mlx.contextWindow; using default")
    next.mlx.contextWindow = DEFAULT_CONFIG.mlx.contextWindow
  }
  if (!positiveNumber(next.mlx.maxTokens)) {
    console.error("Invalid config.mlx.maxTokens; using default")
    next.mlx.maxTokens = DEFAULT_CONFIG.mlx.maxTokens
  }
  if (typeof next.mlx.promptCacheBytes !== "number" || !Number.isFinite(next.mlx.promptCacheBytes) || next.mlx.promptCacheBytes < 0) {
    console.error("Invalid config.mlx.promptCacheBytes; using default")
    next.mlx.promptCacheBytes = DEFAULT_CONFIG.mlx.promptCacheBytes
  }
  if (!positiveNumber(next.mlx.decodeConcurrency)) {
    console.error("Invalid config.mlx.decodeConcurrency; using default")
    next.mlx.decodeConcurrency = DEFAULT_CONFIG.mlx.decodeConcurrency
  }
  if (!nonNegativeNumber(next.mlx.temp)) {
    console.error("Invalid config.mlx.temp; using default")
    next.mlx.temp = DEFAULT_CONFIG.mlx.temp
  }
  if (!nonNegativeNumber(next.mlx.topP)) {
    console.error("Invalid config.mlx.topP; using default")
    next.mlx.topP = DEFAULT_CONFIG.mlx.topP
  }
  if (!nonNegativeNumber(next.mlx.topK)) {
    console.error("Invalid config.mlx.topK; using default")
    next.mlx.topK = DEFAULT_CONFIG.mlx.topK
  }
  if (!nonNegativeNumber(next.mlx.minP)) {
    console.error("Invalid config.mlx.minP; using default")
    next.mlx.minP = DEFAULT_CONFIG.mlx.minP
  }
  if (!positiveNumber(next.mlx.promptConcurrency)) {
    console.error("Invalid config.mlx.promptConcurrency; using default")
    next.mlx.promptConcurrency = DEFAULT_CONFIG.mlx.promptConcurrency
  }

  if (!nonNegativeNumber(next.llama.nGpuLayers)) {
    console.error("Invalid config.llama.nGpuLayers; using default")
    next.llama.nGpuLayers = DEFAULT_CONFIG.llama.nGpuLayers
  }
  if (!nonNegativeNumber(next.llama.ctxSize)) {
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
  if (next.llama.temp !== undefined && !nonNegativeNumber(next.llama.temp)) {
    console.error("Invalid config.llama.temp; removing")
    delete next.llama.temp
  }
  if (next.llama.topP !== undefined && !nonNegativeNumber(next.llama.topP)) {
    console.error("Invalid config.llama.topP; removing")
    delete next.llama.topP
  }
  if (next.llama.topK !== undefined && !nonNegativeNumber(next.llama.topK)) {
    console.error("Invalid config.llama.topK; removing")
    delete next.llama.topK
  }
  if (next.llama.minP !== undefined && !nonNegativeNumber(next.llama.minP)) {
    console.error("Invalid config.llama.minP; removing")
    delete next.llama.minP
  }
  if (next.llama.repeatPenalty !== undefined && !nonNegativeNumber(next.llama.repeatPenalty)) {
    console.error("Invalid config.llama.repeatPenalty; removing")
    delete next.llama.repeatPenalty
  }
  if (next.llama.presencePenalty !== undefined && !nonNegativeNumber(next.llama.presencePenalty)) {
    console.error("Invalid config.llama.presencePenalty; removing")
    delete next.llama.presencePenalty
  }
  if (next.llama.frequencyPenalty !== undefined && !nonNegativeNumber(next.llama.frequencyPenalty)) {
    console.error("Invalid config.llama.frequencyPenalty; removing")
    delete next.llama.frequencyPenalty
  }
  if (
    next.llama.repeatLastN !== undefined &&
    (typeof next.llama.repeatLastN !== "number" || !Number.isInteger(next.llama.repeatLastN) || next.llama.repeatLastN < -1)
  ) {
    console.error("Invalid config.llama.repeatLastN; removing")
    delete next.llama.repeatLastN
  }
  if (next.llama.specType !== undefined && typeof next.llama.specType !== "string") {
    console.error("Invalid config.llama.specType; removing")
    delete next.llama.specType
  }
  if (next.llama.specDraftNMax !== undefined && !positiveNumber(next.llama.specDraftNMax)) {
    console.error("Invalid config.llama.specDraftNMax; removing")
    delete next.llama.specDraftNMax
  }
  if (next.llama.specDraftNMin !== undefined && !positiveNumber(next.llama.specDraftNMin)) {
    console.error("Invalid config.llama.specDraftNMin; removing")
    delete next.llama.specDraftNMin
  }
  if (next.llama.specDraftPSplit !== undefined && !nonNegativeNumber(next.llama.specDraftPSplit)) {
    console.error("Invalid config.llama.specDraftPSplit; removing")
    delete next.llama.specDraftPSplit
  }
  if (next.llama.specDraftPMin !== undefined && !nonNegativeNumber(next.llama.specDraftPMin)) {
    console.error("Invalid config.llama.specDraftPMin; removing")
    delete next.llama.specDraftPMin
  }
  if (next.llama.specDraftModel !== undefined && typeof next.llama.specDraftModel !== "string") {
    console.error("Invalid config.llama.specDraftModel; removing")
    delete next.llama.specDraftModel
  }
  if (next.llama.specDraftNgl !== undefined && !nonNegativeNumber(next.llama.specDraftNgl)) {
    console.error("Invalid config.llama.specDraftNgl; removing")
    delete next.llama.specDraftNgl
  }
  if (
    next.llama.speculativeMode !== undefined &&
    next.llama.speculativeMode !== "auto" &&
    next.llama.speculativeMode !== "enabled" &&
    next.llama.speculativeMode !== "disabled"
  ) {
    console.error("Invalid config.llama.speculativeMode; using default")
    next.llama.speculativeMode = DEFAULT_CONFIG.llama.speculativeMode
  }

  // threads was removed in favour of llama-server auto-detection.
  // Purge it from any on-disk config so it does not bleed through
  // deepMerge into the effective config or the `athanor show` display.
  delete (next.llama as unknown as Record<string, unknown>).threads

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
  if (typeof next.router.verbose !== "boolean") next.router.verbose = DEFAULT_CONFIG.router.verbose
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
  if (!fs.existsSync(CONFIG_PATH)) {
    try { saveConfig(DEFAULT_CONFIG) } catch { /* non-writable home */ }
    return DEFAULT_CONFIG
  }
  try {
    const data = fs.readFileSync(CONFIG_PATH, "utf8")
    const parsed = JSON.parse(data) as unknown
    const loaded = isRecord(parsed) ? parsed as Partial<Config> : {}
    const merged = deepMerge(DEFAULT_CONFIG, loaded)
    const normalized: Config = {
      ...DEFAULT_CONFIG,
      ...merged,
      portRange: mergedSection(merged.portRange, DEFAULT_CONFIG.portRange),
      modelDirs: mergedSection(merged.modelDirs, DEFAULT_CONFIG.modelDirs),
      mlx: mergedSection(merged.mlx, DEFAULT_CONFIG.mlx),
      llama: mergedSection(merged.llama, DEFAULT_CONFIG.llama),
      supervisor: mergedSection(merged.supervisor, DEFAULT_CONFIG.supervisor),
      controlApi: mergedSection(merged.controlApi, DEFAULT_CONFIG.controlApi),
      router: mergedSection(merged.router, DEFAULT_CONFIG.router)
    }

    // Support human-friendly promptCacheBytes like "8gb" / "4096mb".
    // Internal representation is always bytes.
    if ("promptCacheBytes" in normalized.mlx) {
      try {
        const parsedBytes = parsePromptCacheBytes((normalized as unknown as Record<string, unknown>).promptCacheBytes)
        if (parsedBytes !== undefined) normalized.mlx.promptCacheBytes = parsedBytes
      } catch (e) {
        console.error(`Invalid config.mlx.promptCacheBytes; using default: ${e}`)
        normalized.mlx.promptCacheBytes = DEFAULT_CONFIG.mlx.promptCacheBytes
      }
    }

    return sanitizeConfig(normalized)
  } catch (err) {
    console.error(`Failed to load config: ${err}`)
  }
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
