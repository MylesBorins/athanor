import { describe, it, expect } from "vitest"
import {
  buildCommandFor,
  getAdapter,
  inferRuntime,
  mergedConfigFor,
  runtimes
} from "./index.js"
import { MlxAdapter } from "./mlx.js"
import { LlamaAdapter } from "./llama.js"
import { mlxEntry, llamaEntry } from "./__fixtures.js"

describe("adapters registry", () => {
  it("exposes both runtimes", () => {
    expect(runtimes.mlx).toBeInstanceOf(MlxAdapter)
    expect(runtimes["llama.cpp"]).toBeInstanceOf(LlamaAdapter)
    expect(getAdapter("mlx").type).toBe("mlx")
    expect(getAdapter("llama.cpp").type).toBe("llama.cpp")
  })

  describe("inferRuntime", () => {
    it("returns llama.cpp for .gguf paths", () => {
      expect(inferRuntime("/x/y.gguf")).toBe("llama.cpp")
    })
    it("returns mlx for paths with mlx token", () => {
      expect(inferRuntime("/x/Qwen-MLX-4bit")).toBe("mlx")
    })
    it("returns undefined for unknown", () => {
      expect(inferRuntime("/x/mystery")).toBeUndefined()
    })
  })

  describe("mergedConfigFor / buildCommandFor", () => {
    it("merges mlx preset overrides on top of global defaults", () => {
      const entry = mlxEntry({
        preset: { runtime: "mlx", mlx: { decodeConcurrency: 4 } }
      })
      const merged = mergedConfigFor(entry) as { decodeConcurrency: number }
      expect(merged.decodeConcurrency).toBe(4)
      const cmd = buildCommandFor(entry)
      expect(cmd.args).toContain("--decode-concurrency")
      expect(cmd.args[cmd.args.indexOf("--decode-concurrency") + 1]).toBe("4")
    })

    it("merges llama preset overrides on top of global defaults", () => {
      const entry = llamaEntry({
        preset: { runtime: "llama.cpp", llama: { ctxSize: 16384 } }
      })
      const merged = mergedConfigFor(entry) as { ctxSize: number }
      expect(merged.ctxSize).toBe(16384)
    })
  })
})
