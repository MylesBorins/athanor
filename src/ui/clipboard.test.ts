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
  it("formats an athanor preset set command when preset overrides exist", () => {
    const entry = llamaEntry({
      preset: {
        runtime: "llama.cpp",
        llama: {
          ctxSize: 65536,
          temp: 0.7,
          repeatPenalty: 1.1
        }
      }
    })
    const text = formatPresetCopyText(entry, { ctxSize: 65536, temp: 0.7, repeatPenalty: 1.1 })
    expect(text).toBe("athanor preset llama-3-8b set ctx-size=65536 temp=0.7 repeat-penalty=1.1")
  })

  it("falls back to JSON formatting of effective config when no preset overrides exist", () => {
    const entry = llamaEntry()
    const effective = { ctxSize: 65536, nGpuLayers: 999 }
    const text = formatPresetCopyText(entry, effective)
    expect(text).toBe(JSON.stringify(effective, null, 2))
  })
})
