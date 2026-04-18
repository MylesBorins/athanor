import * as fs from "fs"
import * as path from "path"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const PI_DIR = process.env.PI_HOME!
const PI_MODELS = path.join(PI_DIR, "agent", "models.json")
const PI_SETTINGS = path.join(PI_DIR, "agent", "settings.json")

function stash(p: string): string | null {
  if (!fs.existsSync(p)) return null
  const s = fs.readFileSync(p, "utf8")
  fs.unlinkSync(p)
  return s
}

function restore(p: string, s: string | null): void {
  try { fs.unlinkSync(p) } catch { /* not present */ }
  if (s !== null) {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, s, "utf8")
  }
}

describe("pi sync (provider-per-model)", () => {
  let stashedModels: string | null = null
  let stashedSettings: string | null = null

  beforeEach(() => {
    stashedModels = stash(PI_MODELS)
    stashedSettings = stash(PI_SETTINGS)
    vi.resetModules()
  })

  afterEach(() => {
    restore(PI_MODELS, stashedModels)
    restore(PI_SETTINGS, stashedSettings)
  })

  it("emits one provider per published model in pi's schema", async () => {
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [
        {
          id: "mlx-community/Qwen3-32B-4bit", slug: "qwen3-32b", path: "/cache/snap", runtime: "mlx",
          source: { type: "hf", repo: "mlx-community/Qwen3-32B-4bit" },
          port: 8081, publish: true, piAlias: "qwen3-32b", addedAt: 0
        },
        {
          id: "b.gguf", slug: "b", path: "/m/b.gguf", runtime: "llama.cpp",
          source: { type: "local" },
          port: 8082, publish: false, addedAt: 0
        }
      ]
    }))
    const { syncPi } = await import("./pi.js")
    syncPi({ instances: [] })
    const written = JSON.parse(fs.readFileSync(PI_MODELS, "utf8"))
    expect(Object.keys(written.providers)).toEqual(["athanor-mlx-qwen3-32b"])
    const prov = written.providers["athanor-mlx-qwen3-32b"]
    expect(prov.baseUrl).toBe("http://127.0.0.1:8081/v1")
    expect(prov.api).toBe("openai-completions")
    expect(prov.apiKey).toBe("athanor")
    expect(prov.compat.supportsDeveloperRole).toBe(false)
    expect(prov.compat.supportsReasoningEffort).toBe(false)
    expect(prov.models).toHaveLength(1)
    // MLX HF-sourced models must use the repo id as the pi model id so
    // mlx_lm.server recognises the request's `model` field.
    expect(prov.models[0].id).toBe("mlx-community/Qwen3-32B-4bit")
    expect(prov.models[0].name).toContain("[mlx]")
  })

  it("preserves non-athanor providers on rewrite", async () => {
    fs.mkdirSync(path.dirname(PI_MODELS), { recursive: true })
    fs.writeFileSync(
      PI_MODELS,
      JSON.stringify({
        providers: {
          "my-openrouter": {
            baseUrl: "https://openrouter.ai/api/v1",
            api: "openai-completions",
            apiKey: "OPENROUTER_API_KEY",
            models: [{ id: "some/model" }]
          },
          "athanor-stale": {
            baseUrl: "http://127.0.0.1:9999/v1",
            models: [{ id: "stale" }]
          }
        }
      })
    )
    vi.doMock("../registry/index.js", () => ({ listModels: () => [] }))
    const { syncPi } = await import("./pi.js")
    syncPi({ instances: [] })
    const written = JSON.parse(fs.readFileSync(PI_MODELS, "utf8"))
    expect(Object.keys(written.providers)).toEqual(["my-openrouter"])
    expect(written.providers["my-openrouter"].baseUrl).toBe("https://openrouter.ai/api/v1")
  })

  it("pi model id matches what each runtime accepts", async () => {
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [
        // MLX HF: repo id wins (mlx_lm.server matches this literally).
        { id: "mlx-community/Foo", slug: "foo", path: "/cache/snap", runtime: "mlx",
          source: { type: "hf", repo: "mlx-community/Foo" }, port: 8081,
          publish: true, piAlias: "ignored-for-mlx-hf", addedAt: 0 },
        // MLX local: filesystem path wins.
        { id: "local-mlx", slug: "local", path: "/models/local-mlx", runtime: "mlx",
          source: { type: "local" }, port: 8082,
          publish: true, addedAt: 0 },
        // llama.cpp: piAlias wins (llama-server is launched with --alias).
        { id: "g.gguf", slug: "raw", path: "/m/g.gguf", runtime: "llama.cpp",
          source: { type: "local" }, port: 8083,
          publish: true, piAlias: "nice-name", addedAt: 0 },
        // llama.cpp with no piAlias: falls back to slug.
        { id: "h.gguf", slug: "bare", path: "/m/h.gguf", runtime: "llama.cpp",
          source: { type: "local" }, port: 8084,
          publish: true, addedAt: 0 }
      ]
    }))
    const { syncPi } = await import("./pi.js")
    syncPi({ instances: [] })
    const p = JSON.parse(fs.readFileSync(PI_MODELS, "utf8")).providers
    expect(p["athanor-mlx-foo"].models[0].id).toBe("mlx-community/Foo")
    expect(p["athanor-mlx-local"].models[0].id).toBe("/models/local-mlx")
    expect(p["athanor-llama-raw"].models[0].id).toBe("nice-name")
    expect(p["athanor-llama-bare"].models[0].id).toBe("bare")
  })

  it("records the active instance status on the provider", async () => {
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [
        { id: "mlx-community/A", slug: "a", path: "/cache/a", runtime: "mlx",
          source: { type: "hf", repo: "mlx-community/A" }, port: 8081,
          publish: true, piAlias: "a", addedAt: 0 }
      ]
    }))
    const { syncPi } = await import("./pi.js")
    const inst = {
      id: "mlx-community/A", slug: "a", runtime: "mlx" as const, port: 8081,
      pid: 123, startedAt: 0, status: "running" as const,
      logFile: "/tmp/a.log"
    }
    syncPi({ activeDefault: inst, instances: [inst] })
    const written = JSON.parse(fs.readFileSync(PI_MODELS, "utf8"))
    expect(written.providers["athanor-mlx-a"].athanorStatus).toBe("running")
    const settings = JSON.parse(fs.readFileSync(PI_SETTINGS, "utf8"))
    expect(settings.defaultProvider).toBe("athanor-mlx-a")
    expect(settings.defaultModel).toBe("mlx-community/A")
  })

  it("leaves settings alone when no active default is given", async () => {
    fs.mkdirSync(path.dirname(PI_SETTINGS), { recursive: true })
    fs.writeFileSync(PI_SETTINGS, JSON.stringify({
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-20250514",
      theme: "dark"
    }))
    vi.doMock("../registry/index.js", () => ({ listModels: () => [] }))
    const { syncPi } = await import("./pi.js")
    syncPi({ instances: [] })
    const settings = JSON.parse(fs.readFileSync(PI_SETTINGS, "utf8"))
    expect(settings.defaultProvider).toBe("anthropic")
    expect(settings.defaultModel).toBe("claude-sonnet-4-20250514")
    expect(settings.theme).toBe("dark")
  })

  it("preserves unrelated keys when writing settings", async () => {
    fs.mkdirSync(path.dirname(PI_SETTINGS), { recursive: true })
    fs.writeFileSync(PI_SETTINGS, JSON.stringify({
      theme: "dark",
      compaction: { enabled: true, reserveTokens: 16384 }
    }))
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [
        { id: "mlx-community/A", slug: "a", path: "/cache/a", runtime: "mlx",
          source: { type: "hf", repo: "mlx-community/A" }, port: 8081,
          publish: true, piAlias: "a", addedAt: 0 }
      ]
    }))
    const { syncPi } = await import("./pi.js")
    const inst = {
      id: "mlx-community/A", slug: "a", runtime: "mlx" as const, port: 8081,
      pid: 1, startedAt: 0, status: "running" as const, logFile: "/tmp/x"
    }
    syncPi({ activeDefault: inst, instances: [inst] })
    const settings = JSON.parse(fs.readFileSync(PI_SETTINGS, "utf8"))
    expect(settings.theme).toBe("dark")
    expect(settings.compaction.reserveTokens).toBe(16384)
    expect(settings.defaultProvider).toBe("athanor-mlx-a")
  })

  it("labels mlx-vlm models as [mlx-vlm] in the display name", async () => {
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [
        { id: "mlx-community/Qwen2.5-VL-7B-Instruct-4bit",
          slug: "qwen2-5-vl-7b-instruct-4bit",
          path: "/m/v", runtime: "mlx",
          source: { type: "hf", repo: "mlx-community/Qwen2.5-VL-7B-Instruct-4bit" },
          port: 8090, publish: true, piAlias: "qwen2-5-vl-7b-instruct-4bit",
          mlxFlavor: "vlm", addedAt: 0 }
      ]
    }))
    const { syncPi, ATHANOR_PROVIDER_PREFIX } = await import("./pi.js")
    syncPi({ instances: [] })
    const out = JSON.parse(fs.readFileSync(PI_MODELS, "utf8"))
    const providerName = `${ATHANOR_PROVIDER_PREFIX}mlx-qwen2-5-vl-7b-instruct-4bit`
    expect(out.providers[providerName]).toBeDefined()
    expect(out.providers[providerName].models[0].name)
      .toBe("[mlx-vlm] qwen2-5-vl-7b-instruct-4bit (athanor)")
  })

  it("short-circuits when enablePiSync is false", async () => {
    vi.doMock("../config/index.js", async () => {
      const real: any = await vi.importActual("../config/index.js")
      return { ...real, loadConfig: () => ({ ...real.DEFAULT_CONFIG, enablePiSync: false }) }
    })
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [
        { id: "r1", slug: "a", path: "/m/a", runtime: "mlx",
          source: { type: "hf", repo: "r1" }, port: 8081,
          publish: true, piAlias: "a", addedAt: 0 }
      ]
    }))
    const { syncPi } = await import("./pi.js")
    syncPi({ instances: [] })
    expect(fs.existsSync(PI_MODELS)).toBe(false)
    expect(fs.existsSync(PI_SETTINGS)).toBe(false)
  })
})
