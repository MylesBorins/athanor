import { describe, expect, it, vi, beforeEach } from "vitest"
import React from "react"
import * as ink from "ink"

const useInputMock = vi.fn()
vi.mock("ink", async () => {
  const actual = await vi.importActual<typeof import("ink")>("ink")
  return {
    ...actual,
    useInput: (handler: any, opts: any) => {
      useInputMock(handler, opts)
    }
  }
})

import {
  getNextStandardCtx,
  getNextSlotSize,
  getNextGpuLayer,
  getNextSpecType,
  getNextRepeatLastN,
  getNextCacheType,
  getNextFlashAttn,
  getNextSpeculativeMode,
  cycleFloat,
  CYCLABLE_KEYS
} from "./PresetEditor.js"

describe("PresetEditor getNextStandardCtx", () => {
  it("cycles to next larger standard value when going right", () => {
    expect(getNextStandardCtx("4096", "right")).toBe(8192)
    expect(getNextStandardCtx("2048", "right")).toBe(4096)
    expect(getNextStandardCtx("32768", "right")).toBe(65536)
    expect(getNextStandardCtx("65536", "right")).toBe(98304) // 96k
    expect(getNextStandardCtx("98304", "right")).toBe(131072) // 128k
    expect(getNextStandardCtx("524288", "right")).toBe(524288) // clamp at maximum 512k
  })

  it("cycles to next smaller standard value when going left", () => {
    expect(getNextStandardCtx("4096", "left")).toBe(2048)
    expect(getNextStandardCtx("8192", "left")).toBe(4096)
    expect(getNextStandardCtx("98304", "left")).toBe(65536) // 96k -> 64k
    expect(getNextStandardCtx("2048", "left")).toBe(2048) // clamp at minimum
  })

  it("moves to closest larger standard value when current is non-standard going right", () => {
    expect(getNextStandardCtx("3000", "right")).toBe(4096)
    expect(getNextStandardCtx("5000", "right")).toBe(8192)
    expect(getNextStandardCtx("150000", "right")).toBe(163840) // 150k -> 160k
    expect(getNextStandardCtx("600000", "right")).toBe(524288) // too large -> 512k
  })

  it("moves to closest smaller standard value when current is non-standard going left", () => {
    expect(getNextStandardCtx("3000", "left")).toBe(2048)
    expect(getNextStandardCtx("5000", "left")).toBe(4096)
    expect(getNextStandardCtx("1000", "left")).toBe(2048)
  })

  it("defaults to 4096 if current value is invalid", () => {
    expect(getNextStandardCtx("", "right")).toBe(4096)
    expect(getNextStandardCtx("foo", "left")).toBe(4096)
  })
})

describe("PresetEditor getNextSlotSize", () => {
  it("cycles slots correctly", () => {
    expect(getNextSlotSize("4", "right")).toBe(8)
    expect(getNextSlotSize("4", "left")).toBe(2)
    expect(getNextSlotSize("64", "right")).toBe(64)
    expect(getNextSlotSize("1", "left")).toBe(1)
    expect(getNextSlotSize("5", "right")).toBe(8)
    expect(getNextSlotSize("invalid", "right")).toBe(1)
  })
})

describe("PresetEditor getNextGpuLayer", () => {
  it("cycles GPU layers correctly", () => {
    expect(getNextGpuLayer("32", "right")).toBe(48)
    expect(getNextGpuLayer("32", "left")).toBe(16)
    expect(getNextGpuLayer("999", "right")).toBe(999)
    expect(getNextGpuLayer("0", "left")).toBe(0)
    expect(getNextGpuLayer("40", "right")).toBe(48)
    expect(getNextGpuLayer("invalid", "right")).toBe(0)
  })
})

describe("PresetEditor getNextSpecType", () => {
  it("cycles speculative decoding types", () => {
    expect(getNextSpecType("none", "right")).toBe("draft")
    expect(getNextSpecType("draft-simple", "left")).toBe("draft")
    expect(getNextSpecType("ngram-simple", "right")).toBe("ngram-simple")
    expect(getNextSpecType("none", "left")).toBe("none")
    expect(getNextSpecType("invalid", "right")).toBe("none")
  })
})

describe("PresetEditor getNextRepeatLastN", () => {
  it("cycles repeat last n values correctly", () => {
    expect(getNextRepeatLastN("64", "right")).toBe(128)
    expect(getNextRepeatLastN("64", "left")).toBe(32)
    expect(getNextRepeatLastN("0", "left")).toBe(-1)
    expect(getNextRepeatLastN("-1", "left")).toBe(-1)
    expect(getNextRepeatLastN("4096", "right")).toBe(4096)
    expect(getNextRepeatLastN("invalid", "right")).toBe(64)
  })
})

describe("PresetEditor cycleFloat", () => {
  it("cycles float values with step and bounds", () => {
    expect(cycleFloat("0.7", "right", 0.1, 0.0, 2.0, 0.0)).toBe(0.8)
    expect(cycleFloat("0.7", "left", 0.1, 0.0, 2.0, 0.0)).toBe(0.6)
    expect(cycleFloat("2.0", "right", 0.1, 0.0, 2.0, 0.0)).toBe(2.0)
    expect(cycleFloat("0.0", "left", 0.1, 0.0, 2.0, 0.0)).toBe(0.0)
    expect(cycleFloat("0.95", "right", 0.05, 0.0, 1.0, 1.0)).toBe(1.0)
    expect(cycleFloat("0.95", "left", 0.05, 0.0, 1.0, 1.0)).toBe(0.9)
    expect(cycleFloat("invalid", "right", 0.1, 0.0, 2.0, 1.0)).toBe(1.0)
  })
})

describe("PresetEditor getNextCacheType", () => {
  it("cycles cache types correctly", () => {
    expect(getNextCacheType("f16", "right")).toBe("q8_0")
    expect(getNextCacheType("q8_0", "right")).toBe("q4_0")
    expect(getNextCacheType("q8_0", "left")).toBe("f16")
    expect(getNextCacheType("f32", "right")).toBe("f32")
    expect(getNextCacheType("f16", "left")).toBe("f16")
    expect(getNextCacheType("invalid", "right")).toBe("f16")
  })
})

describe("PresetEditor getNextFlashAttn", () => {
  it("cycles flash attention modes correctly", () => {
    expect(getNextFlashAttn("auto", "right")).toBe("on")
    expect(getNextFlashAttn("on", "right")).toBe("off")
    expect(getNextFlashAttn("off", "left")).toBe("on")
    expect(getNextFlashAttn("auto", "left")).toBe("auto")
    expect(getNextFlashAttn("invalid", "right")).toBe("auto")
  })
})

describe("PresetEditor getNextSpeculativeMode", () => {
  it("cycles speculative modes correctly", () => {
    expect(getNextSpeculativeMode("auto", "right")).toBe("enabled")
    expect(getNextSpeculativeMode("enabled", "right")).toBe("disabled")
    expect(getNextSpeculativeMode("disabled", "left")).toBe("enabled")
    expect(getNextSpeculativeMode("auto", "left")).toBe("auto")
    expect(getNextSpeculativeMode("invalid", "right")).toBe("auto")
  })
})

describe("CYCLABLE_KEYS", () => {
  it("includes all sampling, penalty, and cache keys", () => {
    expect(CYCLABLE_KEYS).toContain("temp")
    expect(CYCLABLE_KEYS).toContain("topP")
    expect(CYCLABLE_KEYS).toContain("topK")
    expect(CYCLABLE_KEYS).toContain("minP")
    expect(CYCLABLE_KEYS).toContain("repeatPenalty")
    expect(CYCLABLE_KEYS).toContain("presencePenalty")
    expect(CYCLABLE_KEYS).toContain("frequencyPenalty")
    expect(CYCLABLE_KEYS).toContain("repeatLastN")
    expect(CYCLABLE_KEYS).toContain("cacheTypeK")
    expect(CYCLABLE_KEYS).toContain("cacheTypeV")
    expect(CYCLABLE_KEYS).toContain("flashAttn")
    expect(CYCLABLE_KEYS).toContain("specDraftCacheTypeK")
    expect(CYCLABLE_KEYS).toContain("specDraftCacheTypeV")
    expect(CYCLABLE_KEYS).toContain("speculativeMode")
  })
})

import { upsertModel } from "../registry/index.js"
import type { ModelEntry } from "../types/index.js"

describe("PresetEditor component rendering and keyboard interaction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("handles model not found state gracefully", async () => {
    const { PresetEditor } = await import("./PresetEditor.js")
    const onClose = vi.fn()

    const output = ink.renderToString(
      React.createElement(PresetEditor, {
        entryId: "nonexistent/Model",
        onClose
      })
    )

    expect(output).toContain("model not found")
    expect(useInputMock).toHaveBeenCalled()
    const capturedHandler = useInputMock.mock.calls[0][0]

    capturedHandler("", { escape: true })
    expect(onClose).toHaveBeenCalledWith("")
  })

  it("renders MLX model, edits contextWindow, cycles knobs, saves recipe, copies, and clears", async () => {
    const testMlxModel: ModelEntry = {
      id: "mlx-community/Qwen2.5",
      slug: "qwen2-5",
      path: "/fake/path/qwen",
      runtime: "mlx",
      source: { type: "hf", repo: "mlx-community/Qwen2.5" },
      port: 18080,
      publish: true,
      addedAt: Date.now(),
      mlxFlavor: "lm",
      mlxCapabilities: ["vlm"]
    }
    upsertModel(testMlxModel)

    const { PresetEditor } = await import("./PresetEditor.js")
    const onClose = vi.fn()

    const output = ink.renderToString(
      React.createElement(PresetEditor, {
        entryId: "mlx-community/Qwen2.5",
        onClose
      })
    )

    expect(output).toContain("Formula editor [SIMPLE]")
    expect(output).toContain("qwen2-5")
    expect(output).toContain("vision tower detected")
    expect(useInputMock).toHaveBeenCalled()
    const capturedHandler = useInputMock.mock.calls[0][0]

    // Cycle compound knob in simple mode
    capturedHandler("", { rightArrow: true })
    capturedHandler("", { leftArrow: true })

    // Open edit buffer on contextWindow (cursor is 0)
    capturedHandler("", { return: true })
    // Cycle standard context left and right
    capturedHandler("", { leftArrow: true })
    capturedHandler("", { rightArrow: true })
    // Type in edit buffer
    capturedHandler("0", {})
    capturedHandler("", { backspace: true })
    // Cancel edit
    capturedHandler("", { escape: true })

    // Open edit buffer again and commit
    capturedHandler("", { return: true })
    capturedHandler("", { rightArrow: true })
    capturedHandler("", { return: true })

    // Unset kvCache in simple mode
    capturedHandler("", { downArrow: true })
    capturedHandler("u", {})

    // Toggle MLX flavor with 'v'
    capturedHandler("v", {})

    // Copy to clipboard
    capturedHandler("y", {})

    // Save recipe dialog
    capturedHandler("s", {})
    // Cycle formula names in save dialog
    capturedHandler("", { downArrow: true })
    capturedHandler("", { upArrow: true })
    // Type name
    capturedHandler("a", {})
    capturedHandler("", { backspace: true })
    // Commit save
    capturedHandler("", { return: true })

    // Open save dialog and cancel with Escape
    capturedHandler("s", {})
    capturedHandler("", { escape: true })

    // Switch to Advanced mode with Tab
    capturedHandler("", { tab: true })
    // Navigate in advanced mode
    capturedHandler("", { downArrow: true })
    capturedHandler("", { upArrow: true })
    // Open edit buffer on advanced row
    capturedHandler("", { return: true })
    capturedHandler("", { rightArrow: true })
    capturedHandler("", { leftArrow: true })
    capturedHandler("", { return: true })
    // Unset key in advanced mode with 'u'
    capturedHandler("u", {})

    // Clear confirmation with 'c'
    capturedHandler("c", {})
    // Reset confirmation by pressing an arrow key
    capturedHandler("", { downArrow: true })
    // Two-tap confirm clear
    capturedHandler("c", {})
    capturedHandler("c", {})

    // Delete formula
    capturedHandler("d", {})

    // Close editor with escape
    capturedHandler("", { escape: true })
    expect(onClose).toHaveBeenCalled()
  })

  it("renders llama.cpp model and exercises llama-specific compound and advanced knobs", async () => {
    const testLlamaModel: ModelEntry = {
      id: "unsloth/Qwen3-GGUF:model.gguf",
      slug: "qwen3-gguf",
      path: "/fake/path/model.gguf",
      runtime: "llama.cpp",
      source: { type: "hf", repo: "unsloth/Qwen3-GGUF", file: "model.gguf" },
      port: 18081,
      publish: true,
      addedAt: Date.now(),
      reasoningEffort: { enum: ["low", "medium", "high"], templateDefault: "medium", athanorDefault: "medium" }
    }
    upsertModel(testLlamaModel)

    const { PresetEditor } = await import("./PresetEditor.js")
    const onClose = vi.fn()

    const output = ink.renderToString(
      React.createElement(PresetEditor, {
        entryId: "unsloth/Qwen3-GGUF:model.gguf",
        onClose
      })
    )

    expect(output).toContain("Formula editor [SIMPLE]")
    expect(output).toContain("qwen3-gguf")
    const capturedHandler = useInputMock.mock.calls[0][0]

    // Simple mode: navigate down to gpuOffload knob and open edit buffer
    capturedHandler("", { downArrow: true })
    capturedHandler("", { return: true })
    capturedHandler("", { rightArrow: true })
    capturedHandler("", { leftArrow: true })
    capturedHandler("", { return: true })

    // Unset kvCache for llama (cacheTypeK, cacheTypeV)
    capturedHandler("", { downArrow: true })
    capturedHandler("u", {})

    // Tab to Advanced mode
    capturedHandler("", { tab: true })
    capturedHandler("", { downArrow: true })
    capturedHandler("", { return: true })
    capturedHandler("", { rightArrow: true })
    capturedHandler("", { return: true })

    capturedHandler("", { escape: true })
    expect(onClose).toHaveBeenCalled()
  })
})


