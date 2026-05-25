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

async function mockDirectPiSyncShape(): Promise<void> {
  vi.doMock("../config/index.js", async () => {
    const real: any = await vi.importActual("../config/index.js")
    return {
      ...real,
      loadConfig: () => ({
        ...real.DEFAULT_CONFIG,
        router: { ...real.DEFAULT_CONFIG.router, enabled: false }
      })
    }
  })
}

describe("pi sync", () => {
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

  it("emits ingress-backed providers by default", async () => {
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
    const { syncPi, ATHANOR_MLX_PROVIDER } = await import("./pi.js")
    syncPi({ instances: [] })
    const written = JSON.parse(fs.readFileSync(PI_MODELS, "utf8"))
    expect(Object.keys(written.providers)).toEqual([ATHANOR_MLX_PROVIDER])
    const prov = written.providers[ATHANOR_MLX_PROVIDER]
    expect(prov.baseUrl).toBe("http://127.0.0.1:8080/v1")
    expect(prov.api).toBe("openai-completions")
    expect(prov.apiKey).toBe("athanor")
    expect(prov.models).toHaveLength(1)
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

  it("syncs contextWindow from effective merged runtime config when router mode is disabled", async () => {
    await mockDirectPiSyncShape()
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [
        { id: "mlx-community/A", slug: "a", path: "/cache/a", runtime: "mlx",
          source: { type: "hf", repo: "mlx-community/A" }, port: 8081,
          publish: true, addedAt: 0 },
        { id: "b.gguf", slug: "b", path: "/m/b.gguf", runtime: "llama.cpp",
          source: { type: "local" }, port: 8082,
          publish: true, addedAt: 0 }
      ]
    }))
    const { syncPi } = await import("./pi.js")
    syncPi({ instances: [] })
    const p = JSON.parse(fs.readFileSync(PI_MODELS, "utf8")).providers
    expect(p["athanor-mlx-a"].models[0].contextWindow).toBe(32768)
    expect(p["athanor-llama-b"].models[0].contextWindow).toBe(32768)
  })

  it("prefers explicit preset overrides over defaults when router mode is disabled", async () => {
    await mockDirectPiSyncShape()
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [
        { id: "mlx-community/A", slug: "a", path: "/cache/a", runtime: "mlx",
          source: { type: "hf", repo: "mlx-community/A" }, port: 8081,
          publish: true, addedAt: 0,
          preset: { runtime: "mlx", mlx: { contextWindow: 32768 } } },
        { id: "b.gguf", slug: "b", path: "/m/b.gguf", runtime: "llama.cpp",
          source: { type: "local" }, port: 8082,
          publish: true, addedAt: 0,
          preset: { runtime: "llama.cpp", llama: { ctxSize: 8192 } } }
      ]
    }))
    const { syncPi } = await import("./pi.js")
    syncPi({ instances: [] })
    const p = JSON.parse(fs.readFileSync(PI_MODELS, "utf8")).providers
    expect(p["athanor-mlx-a"].models[0].contextWindow).toBe(32768)
    expect(p["athanor-llama-b"].models[0].contextWindow).toBe(8192)
  })

  it("pi model id matches what each runtime accepts when router mode is disabled", async () => {
    await mockDirectPiSyncShape()
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [
        { id: "mlx-community/Foo", slug: "foo", path: "/cache/snap", runtime: "mlx",
          source: { type: "hf", repo: "mlx-community/Foo" }, port: 8081,
          publish: true, piAlias: "ignored-for-mlx-hf", addedAt: 0 },
        { id: "local-mlx", slug: "local", path: "/models/local-mlx", runtime: "mlx",
          source: { type: "local" }, port: 8082,
          publish: true, addedAt: 0 },
        { id: "g.gguf", slug: "raw", path: "/m/g.gguf", runtime: "llama.cpp",
          source: { type: "local" }, port: 8083,
          publish: true, piAlias: "nice-name", addedAt: 0 },
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

  it("uses registry id as pi model id for hf gguf with default piAlias when router mode is disabled", async () => {
    await mockDirectPiSyncShape()
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [
        { id: "unsloth/Qwen3.6-27B-GGUF:Qwen3.6-27B-Q4_K_M.gguf",
          slug: "qwen3-6-27b-q4-k-m", path: "/m/q.gguf", runtime: "llama.cpp",
          source: { type: "hf", repo: "unsloth/Qwen3.6-27B-GGUF", file: "Qwen3.6-27B-Q4_K_M.gguf" },
          port: 8081, publish: true, piAlias: "qwen3-6-27b-q4-k-m", addedAt: 0 }
      ]
    }))
    const { syncPi } = await import("./pi.js")
    syncPi({ instances: [] })
    const p = JSON.parse(fs.readFileSync(PI_MODELS, "utf8")).providers
    expect(p["athanor-llama-qwen3-6-27b-q4-k-m"].models[0].id)
      .toBe("unsloth/Qwen3.6-27B-GGUF:Qwen3.6-27B-Q4_K_M.gguf")
    expect(p["athanor-llama-qwen3-6-27b-q4-k-m"].models[0].name)
      .toBe("[llama.cpp] unsloth/Qwen3.6-27B-GGUF (athanor)")
  })

  it("records the active instance status on the provider when router mode is disabled", async () => {
    await mockDirectPiSyncShape()
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

  it("preserves unrelated keys when writing settings when router mode is disabled", async () => {
    await mockDirectPiSyncShape()
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

  it("labels mlx-vlm models as [mlx-vlm] in the display name when router mode is disabled", async () => {
    await mockDirectPiSyncShape()
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
      .toBe("[mlx-vlm] mlx-community/Qwen2.5-VL-7B-Instruct-4bit (athanor)")
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

  it("emits per-runtime aggregator providers when router is enabled", async () => {
    vi.doMock("../config/index.js", async () => {
      const real: any = await vi.importActual("../config/index.js")
      return {
        ...real,
        loadConfig: () => ({
          ...real.DEFAULT_CONFIG,
          router: { enabled: true, host: "127.0.0.1", port: 8080 }
        })
      }
    })
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [
        { id: "mlx-community/A", slug: "a", path: "/cache/a", runtime: "mlx",
          source: { type: "hf", repo: "mlx-community/A" }, port: 8081,
          publish: true, piAlias: "a", addedAt: 0 },
        { id: "b.gguf", slug: "b", path: "/m/b.gguf", runtime: "llama.cpp",
          source: { type: "local" }, port: 8082,
          publish: true, piAlias: "bee", addedAt: 0 },
        { id: "hidden", slug: "h", path: "/m/h", runtime: "mlx",
          source: { type: "hf", repo: "x/hidden" }, port: 8083,
          publish: false, addedAt: 0 }
      ]
    }))
    const { syncPi, ATHANOR_MLX_PROVIDER, ATHANOR_LLAMA_PROVIDER } =
      await import("./pi.js")
    syncPi({ instances: [] })
    const written = JSON.parse(fs.readFileSync(PI_MODELS, "utf8"))
    expect(Object.keys(written.providers).sort())
      .toEqual([ATHANOR_LLAMA_PROVIDER, ATHANOR_MLX_PROVIDER])

    const mlx = written.providers[ATHANOR_MLX_PROVIDER]
    expect(mlx.baseUrl).toBe("http://127.0.0.1:8080/v1")
    expect(mlx.api).toBe("openai-completions")
    expect(mlx.models.map((m: { id: string }) => m.id)).toEqual(["mlx-community/A"])
    expect(mlx.athanorRouter).toBe(true)
    expect(mlx.athanorRuntime).toBe("mlx")

    const llama = written.providers[ATHANOR_LLAMA_PROVIDER]
    expect(llama.baseUrl).toBe("http://127.0.0.1:8080/v1")
    expect(llama.models.map((m: { id: string }) => m.id)).toEqual(["bee"])
    expect(llama.athanorRuntime).toBe("llama.cpp")
  })

  it("omits a runtime's provider when no exposed entries use it", async () => {
    vi.doMock("../config/index.js", async () => {
      const real: any = await vi.importActual("../config/index.js")
      return {
        ...real,
        loadConfig: () => ({
          ...real.DEFAULT_CONFIG,
          router: { enabled: true, host: "127.0.0.1", port: 8080 }
        })
      }
    })
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [
        { id: "mlx-community/A", slug: "a", path: "/cache/a", runtime: "mlx",
          source: { type: "hf", repo: "mlx-community/A" }, port: 8081,
          publish: true, piAlias: "a", addedAt: 0 }
      ]
    }))
    const { syncPi, ATHANOR_MLX_PROVIDER } = await import("./pi.js")
    syncPi({ instances: [] })
    const written = JSON.parse(fs.readFileSync(PI_MODELS, "utf8"))
    expect(Object.keys(written.providers)).toEqual([ATHANOR_MLX_PROVIDER])
  })

  it("router mode points defaultProvider at the active model's runtime provider", async () => {
    vi.doMock("../config/index.js", async () => {
      const real: any = await vi.importActual("../config/index.js")
      return {
        ...real,
        loadConfig: () => ({
          ...real.DEFAULT_CONFIG,
          router: { enabled: true, host: "127.0.0.1", port: 8080 }
        })
      }
    })
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [
        { id: "mlx-community/A", slug: "a", path: "/cache/a", runtime: "mlx",
          source: { type: "hf", repo: "mlx-community/A" }, port: 8081,
          publish: true, piAlias: "a", addedAt: 0 }
      ]
    }))
    const { syncPi, ATHANOR_MLX_PROVIDER } = await import("./pi.js")
    const inst = {
      id: "mlx-community/A", slug: "a", runtime: "mlx" as const, port: 8081,
      pid: 1, startedAt: 0, status: "running" as const, logFile: "/tmp/x"
    }
    syncPi({ activeDefault: inst, instances: [inst] })
    const settings = JSON.parse(fs.readFileSync(PI_SETTINGS, "utf8"))
    expect(settings.defaultProvider).toBe(ATHANOR_MLX_PROVIDER)
    expect(settings.defaultModel).toBe("mlx-community/A")
  })

  it("clears any legacy athanor-router provider on sync", async () => {
    vi.doMock("../config/index.js", async () => {
      const real: any = await vi.importActual("../config/index.js")
      return {
        ...real,
        loadConfig: () => ({
          ...real.DEFAULT_CONFIG,
          router: { enabled: true, host: "127.0.0.1", port: 8080 }
        })
      }
    })
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [
        { id: "b.gguf", slug: "b", path: "/m/b.gguf", runtime: "llama.cpp",
          source: { type: "local" }, port: 8082, publish: true, addedAt: 0 }
      ]
    }))
    fs.mkdirSync(path.dirname(PI_MODELS), { recursive: true })
    fs.writeFileSync(PI_MODELS, JSON.stringify({
      providers: {
        "athanor-router": { baseUrl: "http://old", models: [] },
        "openai": { baseUrl: "https://api.openai.com/v1" }
      }
    }))
    const { syncPi, ATHANOR_LLAMA_PROVIDER } = await import("./pi.js")
    syncPi({ instances: [] })
    const written = JSON.parse(fs.readFileSync(PI_MODELS, "utf8"))
    expect(Object.keys(written.providers).sort())
      .toEqual([ATHANOR_LLAMA_PROVIDER, "openai"])
  })
})
