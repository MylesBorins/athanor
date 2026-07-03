import { describe, it, expect, beforeEach } from "vitest"
import { LlamaAdapter } from "./llama.js"
import type { LlamaConfig } from "../types/index.js"
import { llamaEntry } from "./__fixtures.js"

const llama: LlamaConfig = {
  nGpuLayers: 999,
  ctxSize: 12288,
  batchSize: 128,
  ubatchSize: 64,
  parallel: 1
}

describe("LlamaAdapter", () => {
  let adapter: LlamaAdapter
  beforeEach(() => { adapter = new LlamaAdapter() })

  it("builds the llama-server command with all flags and --alias", () => {
    const entry = llamaEntry({
      path: "/models/model.gguf",
      port: 8091,
      piAlias: "test-gguf"
    })
    const { cmd, args } = adapter.buildCommand(entry, llama)
    expect(cmd).toBe("llama-server")
    expect(args).toEqual([
      "-m", "/models/model.gguf",
      "--alias", "test-gguf",
      "--port", "8091",
      "--host", "127.0.0.1",
      "--n-gpu-layers", "999",
      "--ctx-size", "12288",
      "--batch-size", "128",
      "--ubatch-size", "64",
      "--parallel", "1"
    ])
  })

  it("falls back to slug when piAlias is not set", () => {
    const entry = llamaEntry({ piAlias: undefined, slug: "raw" })
    const { args } = adapter.buildCommand(entry, llama)
    const i = args.indexOf("--alias")
    expect(args[i + 1]).toBe("raw")
  })

  it("uses registry id as alias for hf gguf with default piAlias", () => {
    const entry = llamaEntry({
      id: "unsloth/Qwen3.6-27B-GGUF:Qwen3.6-27B-Q4_K_M.gguf",
      slug: "qwen3-6-27b-q4-k-m",
      piAlias: "qwen3-6-27b-q4-k-m",
      source: { type: "hf", repo: "unsloth/Qwen3.6-27B-GGUF", file: "Qwen3.6-27B-Q4_K_M.gguf" }
    })
    const { args } = adapter.buildCommand(entry, llama)
    const i = args.indexOf("--alias")
    expect(args[i + 1]).toBe("unsloth/Qwen3.6-27B-GGUF:Qwen3.6-27B-Q4_K_M.gguf")
  })

  it("returns the llama.cpp health url", () => {
    expect(adapter.healthUrl(9000)).toBe("http://127.0.0.1:9000/health")
  })
})
