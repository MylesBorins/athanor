import * as fs from "fs"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { DEFAULT_CONFIG, loadConfig, saveConfig, PATHS, type Config } from "./index.js"

describe("Config", () => {
  let stashed: string | null = null

  beforeEach(() => {
    if (fs.existsSync(PATHS.config)) {
      stashed = fs.readFileSync(PATHS.config, "utf8")
      fs.unlinkSync(PATHS.config)
    }
  })

  afterEach(() => {
    try { fs.unlinkSync(PATHS.config) } catch { /* not present */ }
    if (stashed !== null) {
      fs.writeFileSync(PATHS.config, stashed, "utf8")
      stashed = null
    }
  })

  describe("loadConfig defaults", () => {
    it("returns default port range", () => {
      const c = loadConfig()
      expect(c.portRange.min).toBe(8081)
      expect(c.portRange.max).toBe(8099)
    })

    it("enables pi sync by default", () => {
      expect(loadConfig().enablePiSync).toBe(true)
    })

    it("defaults supervisor policy to single-active", () => {
      expect(loadConfig().supervisor.policy).toBe("single-active")
    })

    it("defaults control api to disabled", () => {
      expect(loadConfig().controlApi.enabled).toBe(false)
    })

    it("defaults router to enabled, bound to 127.0.0.1:8080", () => {
      const r = loadConfig().router
      expect(r.enabled).toBe(true)
      expect(r.host).toBe("127.0.0.1")
      expect(r.port).toBe(8080)
      expect(r.drainTimeoutMs).toBe(30_000)
    })

    it("exposes default mlx and llama knobs", () => {
      const c = loadConfig()
      expect(c.mlx.prefillStepSize).toBe(2048)
      expect(c.mlx.promptCacheSize).toBe(32768)
      expect(c.mlx.contextWindow).toBe(32768)
      expect(c.mlx.maxTokens).toBe(4096)
      expect(c.llama.nGpuLayers).toBe(999)
      expect(c.llama.ctxSize).toBe(0)
      expect(c.llama.batchSize).toBe(2048)
      expect(c.llama.ubatchSize).toBe(512)
    })
  })

  describe("saveConfig / round-trip", () => {
    it("persists custom values", () => {
      const custom: Config = {
        ...DEFAULT_CONFIG,
        enablePiSync: false,
        portRange: { min: 9000, max: 9010 },
        mlx: { ...DEFAULT_CONFIG.mlx, prefillStepSize: 512 },
        llama: { ...DEFAULT_CONFIG.llama, ctxSize: 8192 }
      }
      saveConfig(custom)
      const loaded = loadConfig()
      expect(loaded.enablePiSync).toBe(false)
      expect(loaded.portRange).toEqual({ min: 9000, max: 9010 })
      expect(loaded.mlx.prefillStepSize).toBe(512)
      expect(loaded.llama.ctxSize).toBe(8192)
    })

    it("merges partial user config over defaults", () => {
      fs.writeFileSync(
        PATHS.config,
        JSON.stringify({ enablePiSync: false }),
        "utf8"
      )
      const loaded = loadConfig()
      expect(loaded.enablePiSync).toBe(false)
      expect(loaded.portRange).toEqual(DEFAULT_CONFIG.portRange)
      expect(loaded.supervisor.policy).toBe("single-active")
    })

    it("does not overwrite a malformed config file with defaults", () => {
      const original = "{not-json"
      const spy = vi.spyOn(console, "error").mockImplementation(() => {})
      fs.writeFileSync(PATHS.config, original, "utf8")

      const loaded = loadConfig()

      expect(loaded).toEqual(DEFAULT_CONFIG)
      expect(fs.readFileSync(PATHS.config, "utf8")).toBe(original)
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    it("falls back per-section when nested config objects are malformed", () => {
      fs.writeFileSync(
        PATHS.config,
        JSON.stringify({
          mlx: "oops",
          router: { port: 9090 },
          enablePiSync: false
        }),
        "utf8"
      )

      const loaded = loadConfig()

      expect(loaded.enablePiSync).toBe(false)
      expect(loaded.router.port).toBe(9090)
      expect(loaded.mlx).toEqual(DEFAULT_CONFIG.mlx)
    })

    it("sanitizes invalid numeric config values back to defaults", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {})
      fs.writeFileSync(
        PATHS.config,
        JSON.stringify({
          portRange: { min: 9005, max: 9000 },
          mlx: { promptCacheSize: -1, decodeConcurrency: 0 },
          llama: { ctxSize: -10, threads: 0, nGpuLayers: -1 },
          supervisor: { maxConcurrent: 0, startupTimeoutMs: -1 },
          controlApi: { port: 70000 },
          router: { port: 0, drainTimeoutMs: -5 }
        }),
        "utf8"
      )
      const loaded = loadConfig()
      expect(loaded.portRange).toEqual(DEFAULT_CONFIG.portRange)
      expect(loaded.mlx.promptCacheSize).toBe(DEFAULT_CONFIG.mlx.promptCacheSize)
      expect(loaded.mlx.decodeConcurrency).toBe(DEFAULT_CONFIG.mlx.decodeConcurrency)
      expect(loaded.llama.ctxSize).toBe(DEFAULT_CONFIG.llama.ctxSize)
      expect(loaded.llama.nGpuLayers).toBe(DEFAULT_CONFIG.llama.nGpuLayers)
      expect(loaded.supervisor.maxConcurrent).toBe(DEFAULT_CONFIG.supervisor.maxConcurrent)
      expect(loaded.supervisor.startupTimeoutMs).toBe(DEFAULT_CONFIG.supervisor.startupTimeoutMs)
      expect(loaded.controlApi.port).toBe(DEFAULT_CONFIG.controlApi.port)
      expect(loaded.router.port).toBe(DEFAULT_CONFIG.router.port)
      expect(loaded.router.drainTimeoutMs).toBe(DEFAULT_CONFIG.router.drainTimeoutMs)
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    it("sanitizes invalid enum/string fields back to defaults", () => {
      fs.writeFileSync(
        PATHS.config,
        JSON.stringify({
          supervisor: { policy: "bogus" },
          controlApi: { host: "" },
          router: { host: "" },
          modelDirs: { mlx: "", llama: "" },
          enablePiSync: "yes"
        }),
        "utf8"
      )
      const loaded = loadConfig()
      expect(loaded.supervisor.policy).toBe(DEFAULT_CONFIG.supervisor.policy)
      expect(loaded.controlApi.host).toBe(DEFAULT_CONFIG.controlApi.host)
      expect(loaded.router.host).toBe(DEFAULT_CONFIG.router.host)
      expect(loaded.modelDirs).toEqual(DEFAULT_CONFIG.modelDirs)
      expect(loaded.enablePiSync).toBe(DEFAULT_CONFIG.enablePiSync)
    })
  })
})
