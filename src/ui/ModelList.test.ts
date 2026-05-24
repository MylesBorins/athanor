import { describe, expect, it } from "vitest"
import { formatModelSize, modelListParts } from "./ModelList.js"
import type { ModelEntry } from "../types/index.js"

describe("ModelList formatModelSize", () => {
  it("formats model size in GiB", () => {
    expect(formatModelSize(10 * 1024 * 1024 * 1024)).toBe("10.0G")
    expect(formatModelSize(1536 * 1024 * 1024)).toBe("1.5G")
  })

  it("returns empty string when size is missing", () => {
    expect(formatModelSize(undefined)).toBe("")
    expect(formatModelSize(0)).toBe("")
  })
})

describe("modelListParts", () => {
  it("includes hf repo alongside slug for hub-backed entries", () => {
    const entry = {
      slug: "qwen3-6-27b-gguf-qwen3-6-27b-q4-k-m",
      source: { type: "hf", repo: "unsloth/Qwen3.6-27B-GGUF", file: "Qwen3.6-27B-Q4_K_M.gguf" }
    } as ModelEntry
    expect(modelListParts(entry)).toEqual({
      slug: "qwen3-6-27b-gguf-qwen3-6-27b-q4-k-m",
      repo: "unsloth/Qwen3.6-27B-GGUF"
    })
  })

  it("returns slug only for local entries", () => {
    const entry = { slug: "my-model", source: { type: "local" } } as ModelEntry
    expect(modelListParts(entry)).toEqual({ slug: "my-model" })
  })
})
