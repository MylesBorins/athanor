import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { PassThrough } from "node:stream"
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

const copyToClipboardMock = vi.fn().mockReturnValue(true)
vi.mock("./clipboard.js", async () => {
  const actual = await vi.importActual<typeof import("./clipboard.js")>("./clipboard.js")
  return {
    ...actual,
    copyToClipboard: (...args: any[]) => copyToClipboardMock(...args)
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
import { upsertModel } from "../registry/index.js"
import type { ModelEntry } from "../types/index.js"
import { supervisor } from "../supervisor/index.js"
import { saveUserFormula } from "../presets/recipes.js"
import * as editPresets from "../presets/edit.js"

function getHandler(): (input: string, key: any) => void {
  const calls = useInputMock.mock.calls
  return calls[calls.length - 1][0]
}

describe("PresetEditor getNextStandardCtx", () => {
  it("cycles to next larger standard value when going right", () => {
    expect(getNextStandardCtx("4096", "right")).toBe(8192)
    expect(getNextStandardCtx("2048", "right")).toBe(4096)
    expect(getNextStandardCtx("32768", "right")).toBe(65536)
    expect(getNextStandardCtx("65536", "right")).toBe(98304)
    expect(getNextStandardCtx("98304", "right")).toBe(131072)
    expect(getNextStandardCtx("524288", "right")).toBe(524288)
  })

  it("cycles to next smaller standard value when going left", () => {
    expect(getNextStandardCtx("4096", "left")).toBe(2048)
    expect(getNextStandardCtx("8192", "left")).toBe(4096)
    expect(getNextStandardCtx("98304", "left")).toBe(65536)
    expect(getNextStandardCtx("2048", "left")).toBe(2048)
  })

  it("moves to closest larger standard value when current is non-standard going right", () => {
    expect(getNextStandardCtx("3000", "right")).toBe(4096)
    expect(getNextStandardCtx("5000", "right")).toBe(8192)
    expect(getNextStandardCtx("150000", "right")).toBe(163840)
    expect(getNextStandardCtx("600000", "right")).toBe(524288)
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
    expect(getNextSlotSize("5", "left")).toBe(4)
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
    expect(getNextGpuLayer("40", "left")).toBe(32)
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
    expect(getNextRepeatLastN("50", "left")).toBe(32)
    expect(getNextRepeatLastN("50", "right")).toBe(64)
    expect(getNextRepeatLastN("invalid", "right")).toBe(64)
  })
})

describe("PresetEditor cycleFloat", () => {
  it("cycles float values with step and bounds", () => {
    expect(cycleFloat("0.7", "right", 0.1, 0.0, 2.0, 0.0)).toBe(0.8)
    expect(cycleFloat("0.7", "left", 0.1, 0.0, 2.0, 0.0)).toBe(0.6)
    expect(cycleFloat("2.0", "right", 0.1, 0.0, 2.0, 0.0)).toBe(2.0)
    expect(cycleFloat("0.0", "left", 0.1, 0.0, 2.0, 0.0)).toBe(0.0)
    expect(cycleFloat("0.05", "left", 0.1, 0.0, 2.0, 0.0)).toBe(0.0)
    expect(cycleFloat("1.95", "right", 0.1, 0.0, 2.0, 0.0)).toBe(2.0)
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
    expect(getNextFlashAttn("off", "right")).toBe("off")
    expect(getNextFlashAttn("invalid", "right")).toBe("auto")
  })
})

describe("PresetEditor getNextSpeculativeMode", () => {
  it("cycles speculative modes correctly", () => {
    expect(getNextSpeculativeMode("auto", "right")).toBe("enabled")
    expect(getNextSpeculativeMode("enabled", "right")).toBe("disabled")
    expect(getNextSpeculativeMode("disabled", "left")).toBe("enabled")
    expect(getNextSpeculativeMode("auto", "left")).toBe("auto")
    expect(getNextSpeculativeMode("disabled", "right")).toBe("disabled")
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

describe("PresetEditor component rendering and keyboard interaction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    copyToClipboardMock.mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("handles model not found state gracefully", async () => {
    const { PresetEditor } = await import("./PresetEditor.js")
    const onClose = vi.fn()
    const stream = new PassThrough()

    const output = ink.renderToString(
      React.createElement(PresetEditor, {
        entryId: "nonexistent/Model",
        onClose
      })
    )
    expect(output).toContain("model not found")

    const app = ink.render(
      React.createElement(PresetEditor, {
        entryId: "nonexistent/Model",
        onClose
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 40))

    expect(useInputMock).toHaveBeenCalled()

    getHandler()("", { escape: true })
    expect(onClose).toHaveBeenCalledWith("")
    app.unmount()
  })

  it("supports MLX Simple Mode navigation, compound knobs, and edit buffer", async () => {
    const testMlxModel: ModelEntry = {
      id: "mlx-community/Qwen2.5-7B",
      slug: "qwen2-5-7b",
      path: "/fake/path/qwen-simple",
      runtime: "mlx",
      source: { type: "hf", repo: "mlx-community/Qwen2.5-7B" },
      port: 18080,
      publish: true,
      addedAt: Date.now(),
      mlxFlavor: "lm",
      mlxCapabilities: ["vlm"]
    }
    upsertModel(testMlxModel)

    const { PresetEditor } = await import("./PresetEditor.js")
    const onClose = vi.fn()
    const stream = new PassThrough()

    const output = ink.renderToString(
      React.createElement(PresetEditor, {
        entryId: "mlx-community/Qwen2.5-7B",
        onClose
      })
    )
    expect(output).toContain("Formula editor [SIMPLE]")
    expect(output).toContain("qwen2-5-7b")
    expect(output).toContain("vision tower detected")

    const app = ink.render(
      React.createElement(PresetEditor, {
        entryId: "mlx-community/Qwen2.5-7B",
        onClose
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 40))

    // Cursor 0: Context Window
    getHandler()("", { rightArrow: true })
    await new Promise(r => setTimeout(r, 20))
    getHandler()("", { leftArrow: true })
    await new Promise(r => setTimeout(r, 20))

    // Open edit buffer on contextWindow with return
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 20))
    // In edit buffer: left and right cycle standard context
    getHandler()("", { rightArrow: true })
    getHandler()("", { leftArrow: true })
    // Type numeric characters
    getHandler()("8", {})
    getHandler()("1", {})
    // Non-numeric ignored for numeric field
    getHandler()("z", {})
    // Backspace
    getHandler()("", { backspace: true })
    // Cancel with escape
    getHandler()("", { escape: true })
    await new Promise(r => setTimeout(r, 20))

    // Open edit buffer again and commit with return
    getHandler()("", { return: true })
    getHandler()("", { rightArrow: true })
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 20))

    // Cursor 1: KV Cache
    getHandler()("", { downArrow: true })
    await new Promise(r => setTimeout(r, 20))
    getHandler()("", { rightArrow: true })
    getHandler()("", { leftArrow: true })
    // 'u' resets KV cache
    getHandler()("u", {})
    await new Promise(r => setTimeout(r, 20))

    // Cursor 2: Speculative decoding
    getHandler()("", { downArrow: true })
    await new Promise(r => setTimeout(r, 20))
    getHandler()("", { rightArrow: true })
    getHandler()("", { leftArrow: true })
    // 'u' resets speculative decoding
    getHandler()("u", {})
    await new Promise(r => setTimeout(r, 20))

    // Cursor 3: Sampling mode
    getHandler()("", { downArrow: true })
    await new Promise(r => setTimeout(r, 20))
    getHandler()("", { rightArrow: true })
    getHandler()("", { leftArrow: true })
    // 'u' on sampling mode does nothing
    getHandler()("u", {})
    await new Promise(r => setTimeout(r, 20))

    // Down arrow past items clamps
    getHandler()("", { downArrow: true })
    getHandler()("", { downArrow: true })

    // Up arrow navigates back to 0 and clamps at 0
    getHandler()("", { upArrow: true })
    getHandler()("", { upArrow: true })
    getHandler()("", { upArrow: true })
    getHandler()("", { upArrow: true })

    app.unmount()
  })

  it("handles formula save dialog, autocomplete, badge rendering, and cancellation", async () => {
    const testMlxModel: ModelEntry = {
      id: "mlx-community/Qwen2.5-Save",
      slug: "qwen-save",
      path: "/fake/path/qwen-save",
      runtime: "mlx",
      source: { type: "hf", repo: "mlx-community/Qwen2.5-Save" },
      port: 18082,
      publish: true,
      addedAt: Date.now()
    }
    upsertModel(testMlxModel)

    const { PresetEditor } = await import("./PresetEditor.js")
    const onClose = vi.fn()
    const stream = new PassThrough()

    const app = ink.render(
      React.createElement(PresetEditor, {
        entryId: "mlx-community/Qwen2.5-Save",
        onClose
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 40))

    // Open save formula dialog with 's'
    getHandler()("s", {})
    await new Promise(r => setTimeout(r, 20))

    // Cycle names up and down
    getHandler()("", { downArrow: true })
    getHandler()("", { upArrow: true })

    // Tab autocomplete
    getHandler()("", { backspace: true })
    getHandler()("c", {})
    getHandler()("o", {})
    getHandler()("", { tab: true })

    // Clear buffer to test empty name validation
    for (let i = 0; i < 30; i++) {
      getHandler()("", { backspace: true })
    }
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 20))

    // Type a new formula name
    getHandler()("t", {})
    getHandler()("e", {})
    getHandler()("s", {})
    getHandler()("t", {})
    getHandler()("-", {})
    getHandler()("f", {})

    // Commit save
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 20))

    // Open dialog again and cancel with escape
    getHandler()("s", {})
    await new Promise(r => setTimeout(r, 20))
    getHandler()("", { escape: true })

    expect(useInputMock).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    app.unmount()
  })

  it("exercises flavor toggle, clipboard copying, two-tap clear, custom formula deletion, and hotkeys", async () => {
    const testMlxModel: ModelEntry = {
      id: "mlx-community/Qwen2.5-Actions",
      slug: "qwen-actions",
      path: "/fake/path/qwen-actions",
      runtime: "mlx",
      source: { type: "hf", repo: "mlx-community/Qwen2.5-Actions" },
      port: 18083,
      publish: true,
      addedAt: Date.now(),
      mlxFlavor: "lm",
      mlxCapabilities: []
    }
    upsertModel(testMlxModel)

    // Spy on supervisor to simulate model running
    vi.spyOn(supervisor, "list").mockReturnValue([
      {
        id: "mlx-community/Qwen2.5-Actions",
        pid: 9999,
        port: 18083,
        entry: testMlxModel,
        status: "running"
      } as any
    ])

    const { PresetEditor } = await import("./PresetEditor.js")
    const onClose = vi.fn()
    const stream = new PassThrough()

    const app = ink.render(
      React.createElement(PresetEditor, {
        entryId: "mlx-community/Qwen2.5-Actions",
        onClose
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 40))

    // Toggle MLX flavor with 'v' when model has no vision tower and is running
    getHandler()("v", {})
    await new Promise(r => setTimeout(r, 20))
    // Toggle back to 'lm'
    getHandler()("v", {})
    await new Promise(r => setTimeout(r, 20))

    // Clipboard copy with 'y' (success)
    copyToClipboardMock.mockReturnValue(true)
    getHandler()("y", {})
    expect(copyToClipboardMock).toHaveBeenCalled()

    // Clipboard copy with 'y' (failure)
    copyToClipboardMock.mockReturnValue(false)
    getHandler()("y", {})

    // Number hotkeys 1-7
    getHandler()("1", {})
    await new Promise(r => setTimeout(r, 20))
    getHandler()("2", {})
    await new Promise(r => setTimeout(r, 20))
    getHandler()("9", {})

    // Clear formula: single 'c' triggers confirm notice
    getHandler()("c", {})
    await new Promise(r => setTimeout(r, 20))
    // Reset confirm notice with arrow key
    getHandler()("", { downArrow: true })
    await new Promise(r => setTimeout(r, 20))
    // Clear formula: double 'c' confirms clear
    getHandler()("c", {})
    getHandler()("c", {})
    await new Promise(r => setTimeout(r, 20))

    // Delete formula with 'd' when no user formula exists
    getHandler()("d", {})
    await new Promise(r => setTimeout(r, 20))

    // Create user formula and delete it with 'd'
    saveUserFormula({
      name: "delete-me",
      description: "temporary",
      source: "user"
    })
    getHandler()("d", {})
    await new Promise(r => setTimeout(r, 20))

    // Close with escape
    getHandler()("", { escape: true })
    expect(onClose).toHaveBeenCalled()

    app.unmount()
  })

  it("exercises Advanced Mode scrolling, category headers, cyclable keys, and unsetting", async () => {
    const testMlxModel: ModelEntry = {
      id: "mlx-community/Qwen2.5-Advanced",
      slug: "qwen-advanced",
      path: "/fake/path/qwen-advanced",
      runtime: "mlx",
      source: { type: "hf", repo: "mlx-community/Qwen2.5-Advanced" },
      port: 18084,
      publish: true,
      addedAt: Date.now()
    }
    upsertModel(testMlxModel)

    const { PresetEditor } = await import("./PresetEditor.js")
    const onClose = vi.fn()
    const stream = new PassThrough()

    const app = ink.render(
      React.createElement(PresetEditor, {
        entryId: "mlx-community/Qwen2.5-Advanced",
        onClose
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 40))

    // Switch to Advanced mode with Tab
    getHandler()("", { tab: true })
    await new Promise(r => setTimeout(r, 40))

    // Scroll down past MAX_VISIBLE_KEYS (8 items) to exercise windowing and indicators
    for (let i = 0; i < 10; i++) {
      getHandler()("", { downArrow: true })
    }
    await new Promise(r => setTimeout(r, 40))

    // Scroll back up
    for (let i = 0; i < 10; i++) {
      getHandler()("", { upArrow: true })
    }
    await new Promise(r => setTimeout(r, 20))

    // Open edit buffer on first key with return
    getHandler()("", { return: true })
    getHandler()("", { rightArrow: true })
    getHandler()("", { leftArrow: true })
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 20))

    // Unset key in advanced mode with 'u'
    getHandler()("u", {})
    await new Promise(r => setTimeout(r, 20))

    // Test edit error handling when setFormulaFields throws
    vi.spyOn(editPresets, "setFormulaFields").mockImplementationOnce(() => {
      throw new Error("simulated set error")
    })
    getHandler()("", { return: true })
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 20))

    // Test unset error handling when unsetFormulaFields throws
    vi.spyOn(editPresets, "unsetFormulaFields").mockImplementationOnce(() => {
      throw new Error("simulated unset error")
    })
    getHandler()("u", {})
    await new Promise(r => setTimeout(r, 20))

    // Switch back to simple mode with Tab
    getHandler()("", { tab: true })
    await new Promise(r => setTimeout(r, 40))

    expect(useInputMock).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    app.unmount()
  })

  it("exercises llama-specific compound and advanced cyclable knobs", async () => {
    const testLlamaModel: ModelEntry = {
      id: "unsloth/Qwen3-GGUF:model.gguf",
      slug: "qwen3-gguf",
      path: "/fake/path/qwen-llama.gguf",
      runtime: "llama.cpp",
      source: { type: "hf", repo: "unsloth/Qwen3-GGUF", file: "model.gguf" },
      port: 18085,
      publish: true,
      addedAt: Date.now(),
      reasoningEffort: { enum: ["low", "medium", "high"], templateDefault: "medium", athanorDefault: "medium" }
    }
    upsertModel(testLlamaModel)

    const { PresetEditor } = await import("./PresetEditor.js")
    const onClose = vi.fn()
    const stream = new PassThrough()

    const app = ink.render(
      React.createElement(PresetEditor, {
        entryId: "unsloth/Qwen3-GGUF:model.gguf",
        onClose
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 40))

    // Simple mode: cycle context
    getHandler()("", { rightArrow: true })
    getHandler()("", { leftArrow: true })

    // Open edit buffer on ctxSize for llama
    getHandler()("", { return: true })
    getHandler()("", { rightArrow: true })
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 20))

    // Down to gpuOffload knob
    getHandler()("", { downArrow: true })
    // Return on gpuOffload opens edit buffer on nGpuLayers
    getHandler()("", { return: true })
    getHandler()("", { rightArrow: true })
    getHandler()("", { leftArrow: true })
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 20))

    // Down to kvCache knob -> unset with 'u' (unsets cacheTypeK, cacheTypeV)
    getHandler()("", { downArrow: true })
    getHandler()("u", {})
    await new Promise(r => setTimeout(r, 20))

    // Down to speculative knob -> unset with 'u' (unsets speculativeMode, specType, specDraftNgl, specDraftModel)
    getHandler()("", { downArrow: true })
    getHandler()("u", {})
    await new Promise(r => setTimeout(r, 20))

    // Down to reasoningEffort compound knob -> cycle options
    getHandler()("", { downArrow: true })
    getHandler()("", { rightArrow: true })
    getHandler()("", { leftArrow: true })

    // Switch to Advanced Mode
    getHandler()("", { tab: true })
    await new Promise(r => setTimeout(r, 40))

    // In advanced mode, navigate and test editing various cyclable keys
    const allLlamaKeys = editPresets.listKeys("llama.cpp")

    const testKeyCycle = async (jsonName: string) => {
      const idx = allLlamaKeys.findIndex(k => k.jsonName === jsonName)
      if (idx >= 0) {
        for (let i = 0; i < allLlamaKeys.length; i++) getHandler()("", { upArrow: true })
        for (let i = 0; i < idx; i++) getHandler()("", { downArrow: true })
        getHandler()("", { return: true })
        getHandler()("", { rightArrow: true })
        getHandler()("", { leftArrow: true })
        getHandler()("", { return: true })
        await new Promise(r => setTimeout(r, 10))
      }
    }

    await testKeyCycle("temp")
    await testKeyCycle("topP")
    await testKeyCycle("topK")
    await testKeyCycle("minP")
    await testKeyCycle("parallel")
    await testKeyCycle("nGpuLayers")
    await testKeyCycle("specType")
    await testKeyCycle("repeatPenalty")
    await testKeyCycle("presencePenalty")
    await testKeyCycle("frequencyPenalty")
    await testKeyCycle("repeatLastN")
    await testKeyCycle("cacheTypeK")
    await testKeyCycle("flashAttn")
    await testKeyCycle("speculativeMode")
    await testKeyCycle("reasoningEffort")

    expect(useInputMock).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    app.unmount()
  })

  it("exercises kvBits cycling in edit buffer for MLX", async () => {
    const testKvModel: ModelEntry = {
      id: "mlx-community/KvTest",
      slug: "kv-test",
      path: "/fake/path/qwen-kv",
      runtime: "mlx",
      source: { type: "hf", repo: "mlx-community/KvTest" },
      port: 18087,
      publish: true,
      addedAt: Date.now()
    }
    upsertModel(testKvModel)

    const { PresetEditor } = await import("./PresetEditor.js")
    const onClose = vi.fn()
    const stream = new PassThrough()

    const app = ink.render(
      React.createElement(PresetEditor, {
        entryId: "mlx-community/KvTest",
        onClose
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 40))

    // Switch to advanced mode
    getHandler()("", { tab: true })
    await new Promise(r => setTimeout(r, 40))

    const allKeys = editPresets.listKeys("mlx")
    const kvIdx = allKeys.findIndex(k => k.jsonName === "kvBits")
    if (kvIdx >= 0) {
      for (let i = 0; i < kvIdx; i++) getHandler()("", { downArrow: true })
      getHandler()("", { return: true })
      getHandler()("", { rightArrow: true })
      getHandler()("", { leftArrow: true })
      getHandler()("5", {})
      getHandler()("", { leftArrow: true })
      getHandler()("", { rightArrow: true })
      getHandler()("", { return: true })
    }

    expect(useInputMock).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    app.unmount()
  })

  it("resets clear confirmation after timer expires", async () => {
    vi.useFakeTimers()

    const testModel: ModelEntry = {
      id: "mlx-community/TimerModel",
      slug: "timer-model",
      path: "/fake/path/qwen-timer",
      runtime: "mlx",
      source: { type: "hf", repo: "mlx-community/TimerModel" },
      port: 18088,
      publish: true,
      addedAt: Date.now()
    }
    upsertModel(testModel)

    const { PresetEditor } = await import("./PresetEditor.js")
    const onClose = vi.fn()
    const stream = new PassThrough()

    const app = ink.render(
      React.createElement(PresetEditor, {
        entryId: "mlx-community/TimerModel",
        onClose
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await vi.advanceTimersByTimeAsync(40)

    // Press 'c' to initiate confirmation
    getHandler()("c", {})

    // Advance timers by 3500ms
    await vi.advanceTimersByTimeAsync(3500)

    // Press 'c' again - this should NOT confirm clear, but start confirmation again
    getHandler()("c", {})

    expect(useInputMock).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    app.unmount()
    vi.useRealTimers()
  })
})
