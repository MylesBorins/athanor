import * as fs from "fs"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
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

    it("defaults router to disabled, bound to 127.0.0.1:8080", () => {
      const r = loadConfig().router
      expect(r.enabled).toBe(false)
      expect(r.host).toBe("127.0.0.1")
      expect(r.port).toBe(8080)
      expect(r.drainTimeoutMs).toBe(30_000)
    })

    it("exposes default mlx and llama knobs", () => {
      const c = loadConfig()
      expect(c.mlx.prefillStepSize).toBe(256)
      expect(c.llama.nGpuLayers).toBe(999)
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
  })
})
