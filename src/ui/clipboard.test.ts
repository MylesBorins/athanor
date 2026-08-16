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
  it("formats a clean audit report containing model metadata and all effective keys", () => {
    const entry = llamaEntry({
      preset: {
        runtime: "llama.cpp",
        llama: {
          temp: 0.7
        }
      }
    })
    const effective = {
      ctxSize: 65536,
      nGpuLayers: 999,
      batchSize: 2048,
      ubatchSize: 512,
      parallel: 1,
      temp: 0.7
    }
    const text = formatPresetCopyText(entry, effective)
    expect(text).toContain("Model: llama-3-8b")
    expect(text).toContain("Runtime: llama.cpp (Port 8081)")
    expect(text).toContain("Effective Settings:")
    expect(text).toContain("  ctx-size: 65536")
    expect(text).toContain("  temp: 0.7 (*)")
    expect(text).toContain("Recreate Preset:")
    expect(text).toContain("  athanor preset llama-3-8b set temp=0.7")
  })
})
