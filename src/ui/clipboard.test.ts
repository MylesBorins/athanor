import { describe, it, expect } from "vitest"
import { formatPresetCopyText } from "./clipboard.js"
import type { ModelEntry } from "../types/index.js"

function llamaEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "llama-1",
    slug: "llama-3-8b",
    path: "/models/llama.gguf",
    runtime: "llama.cpp",
    source: { type: "local" },
    port: 8081,
    publish: true,
    addedAt: 0,
    ...overrides
  }
}

describe("formatPresetCopyText", () => {
  it("formats a complete athanor preset set command containing all effective keys", () => {
    const entry = llamaEntry()
    const effective = {
      ctxSize: 65536,
      nGpuLayers: 999,
      batchSize: 2048,
      ubatchSize: 512,
      parallel: 1,
      temp: 0.7,
      topP: 0.95,
      topK: 20,
      minP: 0,
      repeatPenalty: 1.0,
      presencePenalty: 0.0,
      frequencyPenalty: 0.0,
      repeatLastN: 64
    }
    const text = formatPresetCopyText(entry, effective)
    expect(text).toContain("athanor preset llama-3-8b set")
    expect(text).toContain("ctx-size=65536")
    expect(text).toContain("n-gpu-layers=999")
    expect(text).toContain("temp=0.7")
    expect(text).toContain("top-p=0.95")
    expect(text).toContain("repeat-penalty=1")
  })
})
