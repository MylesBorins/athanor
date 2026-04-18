import { describe, it, expect } from "vitest"
import {
  buildCommandFor,
  getAdapter,
  inferRuntime,
  mergedConfigFor,
  resolveByRuntimeModelId,
  runtimeModelId,
  runtimes
} from "./index.js"
import type { ModelEntry } from "../types/index.js"
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

  describe("resolveByRuntimeModelId", () => {
    // Router-side reverse lookup: given whatever pi-agent puts in a
    // request body's `model` field, find the athanor entry that will
    // accept it. Must match the same computation syncPi uses so the
    // `id`s synthesised into pi's catalog round-trip correctly.
    const entries: ModelEntry[] = [
      mlxEntry({ id: "mlx-community/Qwen3-32B-4bit", slug: "qwen3-32b",
        source: { type: "hf", repo: "mlx-community/Qwen3-32B-4bit" }, publish: true }),
      mlxEntry({ id: "local-vlm", slug: "local-vlm", path: "/models/local-vlm",
        source: { type: "local" }, publish: true }),
      llamaEntry({ id: "llama-raw", slug: "raw", piAlias: "nice-name", publish: true }),
      llamaEntry({ id: "llama-bare", slug: "bare", publish: true, piAlias: undefined }),
      mlxEntry({ id: "hidden", slug: "hidden",
        source: { type: "hf", repo: "author/hidden-repo" }, publish: false })
    ]

    it("matches by runtime model id (primary)", () => {
      expect(resolveByRuntimeModelId(entries, "mlx-community/Qwen3-32B-4bit")?.slug).toBe("qwen3-32b")
      expect(resolveByRuntimeModelId(entries, "/models/local-vlm")?.slug).toBe("local-vlm")
      expect(resolveByRuntimeModelId(entries, "nice-name")?.slug).toBe("raw")
      expect(resolveByRuntimeModelId(entries, "bare")?.slug).toBe("bare")
    })

    it("falls back to slug and then id", () => {
      expect(resolveByRuntimeModelId(entries, "qwen3-32b")?.id).toBe("mlx-community/Qwen3-32B-4bit")
      expect(resolveByRuntimeModelId(entries, "llama-raw")?.slug).toBe("raw")
    })

    it("ignores unexposed entries even if their id matches", () => {
      expect(resolveByRuntimeModelId(entries, "author/hidden-repo")).toBeUndefined()
      expect(resolveByRuntimeModelId(entries, "hidden")).toBeUndefined()
    })

    it("returns undefined for unknown or empty input", () => {
      expect(resolveByRuntimeModelId(entries, "nope")).toBeUndefined()
      expect(resolveByRuntimeModelId(entries, "")).toBeUndefined()
    })

    it("runtimeModelId matches the resolver's primary key exactly", () => {
      for (const e of entries.filter(x => x.publish)) {
        expect(resolveByRuntimeModelId(entries, runtimeModelId(e))?.id).toBe(e.id)
      }
    })
  })
})
