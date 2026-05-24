import * as fs from "fs"
import { beforeEach, describe, expect, it } from "vitest"
import { PATHS } from "../config/index.js"
import { deduplicateRegistry, listModels } from "./index.js"
import type { ModelEntry } from "../types/index.js"

function reset(): void {
  try { fs.unlinkSync(PATHS.registry) } catch { /* not present */ }
}

function writeRegistry(models: ModelEntry[]): void {
  fs.mkdirSync(PATHS.base, { recursive: true })
  fs.writeFileSync(PATHS.registry, JSON.stringify({ version: 1, models }, null, 2))
}

describe("deduplicateRegistry", () => {
  beforeEach(reset)

  it("merges entries sharing a path, preferring hf source and preserving user fields", () => {
    writeRegistry([
      {
        id: "unsloth/Qwen3.6-27B-GGUF:Qwen3.6-27B-Q4_K_M.gguf",
        slug: "qwen3-6-27b-gguf-qwen3-6-27b-q4-k-m",
        path: "/models/unsloth--Qwen3.6-27B-GGUF/Qwen3.6-27B-Q4_K_M.gguf",
        runtime: "llama.cpp",
        source: { type: "hf", repo: "unsloth/Qwen3.6-27B-GGUF", file: "Qwen3.6-27B-Q4_K_M.gguf" },
        port: 8081,
        publish: true,
        piAlias: "qwen3-6-27b-gguf-qwen3-6-27b-q4-k-m",
        addedAt: 1
      },
      {
        id: "/models/unsloth--Qwen3.6-27B-GGUF/Qwen3.6-27B-Q4_K_M.gguf",
        slug: "qwen3-6-27b-q4-k-m",
        path: "/models/unsloth--Qwen3.6-27B-GGUF/Qwen3.6-27B-Q4_K_M.gguf",
        runtime: "llama.cpp",
        source: { type: "local" },
        port: 8082,
        publish: false,
        piAlias: "custom-alias",
        tags: ["coder"],
        preset: { runtime: "llama.cpp", llama: { ctxSize: 8192 } },
        sizeBytes: 15_000_000_000,
        quantization: "Q4_K_M",
        addedAt: 2
      }
    ])

    deduplicateRegistry()
    const models = listModels()
    expect(models).toHaveLength(1)
    const entry = models[0]!
    expect(entry.port).toBe(8081)
    expect(entry.slug).toBe("qwen3-6-27b-gguf-qwen3-6-27b-q4-k-m")
    expect(entry.source.type).toBe("hf")
    expect(entry.publish).toBe(false)
    expect(entry.piAlias).toBe("custom-alias")
    expect(entry.tags).toEqual(["coder"])
    expect(entry.preset).toEqual({ runtime: "llama.cpp", llama: { ctxSize: 8192 } })
    expect(entry.sizeBytes).toBe(15_000_000_000)
    expect(entry.quantization).toBe("Q4_K_M")
  })

  it("upgrades local llama entries in org--repo pull folders to hf source on load", () => {
    writeRegistry([
      {
        id: "/models/unsloth--Qwen3.6-27B-GGUF/Qwen3.6-27B-Q4_K_M.gguf",
        slug: "qwen3-6-27b-q4-k-m",
        path: "/models/unsloth--Qwen3.6-27B-GGUF/Qwen3.6-27B-Q4_K_M.gguf",
        runtime: "llama.cpp",
        source: { type: "local" },
        port: 8081,
        publish: true,
        addedAt: 1
      }
    ])

    deduplicateRegistry()
    const entry = listModels()[0]!
    expect(entry.source.type).toBe("hf")
    expect((entry.source as { type: "hf"; repo: string }).repo).toBe("unsloth/Qwen3.6-27B-GGUF")
    expect(entry.id).toBe("unsloth/Qwen3.6-27B-GGUF:Qwen3.6-27B-Q4_K_M.gguf")
  })
})
