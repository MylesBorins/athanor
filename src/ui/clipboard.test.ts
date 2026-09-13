import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { copyToClipboard, formatPresetCopyText } from "./clipboard.js"
import type { ModelEntry } from "../types/index.js"
import { execSync } from "child_process"

vi.mock("child_process", () => ({
  execSync: vi.fn()
}))

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

function mlxEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "mlx-1",
    slug: "qwen-vlm",
    path: "/models/qwen",
    runtime: "mlx",
    mlxFlavor: "vlm",
    source: { type: "local" },
    port: 8082,
    publish: true,
    addedAt: 0,
    ...overrides
  }
}

describe("copyToClipboard", () => {
  let origPlatform: PropertyDescriptor | undefined

  beforeEach(() => {
    origPlatform = Object.getOwnPropertyDescriptor(process, "platform")
    vi.mocked(execSync).mockReset()
  })

  afterEach(() => {
    if (origPlatform) {
      Object.defineProperty(process, "platform", origPlatform)
    }
  })

  it("copies on darwin via pbcopy", () => {
    Object.defineProperty(process, "platform", { value: "darwin" })
    expect(copyToClipboard("sample text")).toBe(true)
    expect(execSync).toHaveBeenCalledWith("pbcopy", { input: "sample text", timeout: 2000 })
  })

  it("copies on win32 via clip", () => {
    Object.defineProperty(process, "platform", { value: "win32" })
    expect(copyToClipboard("sample text")).toBe(true)
    expect(execSync).toHaveBeenCalledWith("clip", { input: "sample text", timeout: 2000 })
  })

  it("copies on linux via wl-copy when available", () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    expect(copyToClipboard("sample text")).toBe(true)
    expect(execSync).toHaveBeenCalledWith("wl-copy", { input: "sample text", timeout: 2000 })
  })

  it("falls back to xclip on linux when wl-copy fails", () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error("wl-copy missing")
    })
    expect(copyToClipboard("sample text")).toBe(true)
    expect(execSync).toHaveBeenCalledWith("xclip -selection clipboard", { input: "sample text", timeout: 2000 })
  })

  it("falls back to xsel on linux when both wl-copy and xclip fail", () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    vi.mocked(execSync)
      .mockImplementationOnce(() => { throw new Error("wl-copy missing") })
      .mockImplementationOnce(() => { throw new Error("xclip missing") })

    expect(copyToClipboard("sample text")).toBe(true)
    expect(execSync).toHaveBeenCalledWith("xsel -b", { input: "sample text", timeout: 2000 })
  })

  it("returns false on linux when all clipboard tools fail", () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("clipboard tool failed")
    })
    expect(copyToClipboard("sample text")).toBe(false)
  })

  it("returns false when pbcopy fails on darwin", () => {
    Object.defineProperty(process, "platform", { value: "darwin" })
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error("pbcopy failed")
    })
    expect(copyToClipboard("sample text")).toBe(false)
  })
})

describe("formatPresetCopyText", () => {
  it("formats a clean audit report containing model metadata and all effective keys for llama.cpp", () => {
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
    expect(text).toContain("Recreate Formula:")
    expect(text).toContain("  athanor formula llama-3-8b set temp=0.7")
  })

  it("formats audit report for MLX with flavor and formula", () => {
    const entry = mlxEntry({
      formula: {
        runtime: "mlx",
        mlx: {
          maxTokens: 500,
          temp: 0.8
        }
      }
    })
    const effective = {
      maxTokens: 500,
      temp: 0.8
    }
    const text = formatPresetCopyText(entry, effective)
    expect(text).toContain("Model: qwen-vlm")
    expect(text).toContain("Runtime: mlx-vlm (Port 8082)")
    expect(text).toContain("Effective Settings:")
    expect(text).toContain("  max-tokens: 500 (*)")
    expect(text).toContain("  temp: 0.8 (*)")
    expect(text).toContain("Recreate Formula:")
    expect(text).toContain("  athanor formula qwen-vlm set max-tokens=500 temp=0.8")
  })
})
