import { describe, expect, it } from "vitest"
import { modelDisplayLabel, modelListParts, piDisplayNameFor } from "./display.js"
import type { ModelEntry } from "../types/index.js"

describe("modelListParts", () => {
  it("uses hf repo as primary and slug as secondary", () => {
    const entry = {
      slug: "qwen3-6-27b-gguf-qwen3-6-27b-q4-k-m",
      source: { type: "hf", repo: "unsloth/Qwen3.6-27B-GGUF", file: "Qwen3.6-27B-Q4_K_M.gguf" }
    } as ModelEntry
    expect(modelListParts(entry)).toEqual({
      primary: "unsloth/Qwen3.6-27B-GGUF",
      secondary: "qwen3-6-27b-gguf-qwen3-6-27b-q4-k-m"
    })
  })

  it("returns slug only for local entries", () => {
    const entry = { slug: "my-model", source: { type: "local" } } as ModelEntry
    expect(modelListParts(entry)).toEqual({ primary: "my-model" })
  })
})

describe("modelDisplayLabel", () => {
  it("joins primary and secondary for hf entries", () => {
    const entry = {
      slug: "qwen3-32b",
      source: { type: "hf", repo: "mlx-community/Qwen3-32B-4bit" }
    } as ModelEntry
    expect(modelDisplayLabel(entry)).toBe("mlx-community/Qwen3-32B-4bit · qwen3-32b")
  })
})

describe("piDisplayNameFor", () => {
  it("uses hf repo in the pi display name for llama gguf entries", () => {
    const entry = {
      slug: "qwen3-6-27b-q4-k-m",
      runtime: "llama.cpp",
      source: { type: "hf", repo: "unsloth/Qwen3.6-27B-GGUF", file: "Qwen3.6-27B-Q4_K_M.gguf" }
    } as ModelEntry
    expect(piDisplayNameFor(entry)).toBe(
      "[llama.cpp] unsloth/Qwen3.6-27B-GGUF (athanor)"
    )
  })

  it("labels mlx-vlm models distinctly", () => {
    const entry = {
      slug: "qwen2-5-vl-7b-instruct-4bit",
      runtime: "mlx",
      mlxFlavor: "vlm",
      source: { type: "hf", repo: "mlx-community/Qwen2.5-VL-7B-Instruct-4bit" }
    } as ModelEntry
    expect(piDisplayNameFor(entry)).toBe(
      "[mlx-vlm] mlx-community/Qwen2.5-VL-7B-Instruct-4bit (athanor)"
    )
  })
})
