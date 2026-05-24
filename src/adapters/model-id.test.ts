import { describe, expect, it } from "vitest"
import { runtimeModelId } from "./model-id.js"
import { llamaEntry, mlxEntry } from "./__fixtures.js"

describe("runtimeModelId", () => {
  it("uses hf repo for mlx hub models", () => {
    expect(runtimeModelId(mlxEntry())).toBe("mlx-community/Test-4bit")
  })

  it("uses registry id for hf gguf when piAlias is the default slug", () => {
    expect(runtimeModelId(llamaEntry({
      id: "unsloth/Qwen3.6-27B-GGUF:Qwen3.6-27B-Q4_K_M.gguf",
      slug: "qwen3-6-27b-q4-k-m",
      piAlias: "qwen3-6-27b-q4-k-m",
      source: { type: "hf", repo: "unsloth/Qwen3.6-27B-GGUF", file: "Qwen3.6-27B-Q4_K_M.gguf" }
    }))).toBe("unsloth/Qwen3.6-27B-GGUF:Qwen3.6-27B-Q4_K_M.gguf")
  })

  it("respects a custom llama piAlias", () => {
    expect(runtimeModelId(llamaEntry({ slug: "raw", piAlias: "nice-name" }))).toBe("nice-name")
  })

  it("falls back to slug for local llama without piAlias", () => {
    expect(runtimeModelId(llamaEntry({ piAlias: undefined, slug: "raw" }))).toBe("raw")
  })
})
