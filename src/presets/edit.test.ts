import { describe, it, expect } from "vitest"
import { parseKvTokens, setPresetFields, unsetPresetFields, listKeys } from "./edit.js"
import type { ModelEntry } from "../types/index.js"

function mlxEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "a", slug: "a", path: "/m/a", runtime: "mlx",
    source: { type: "hf", repo: "a" }, port: 8081,
    publish: true, addedAt: 0, ...overrides
  }
}

function llamaEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "b", slug: "b", path: "/m/b.gguf", runtime: "llama.cpp",
    source: { type: "local" }, port: 8082,
    publish: true, addedAt: 0, ...overrides
  }
}

describe("parseKvTokens", () => {
  it("parses tokens of the form key=value", () => {
    expect(parseKvTokens(["ctx-size=32768", "n-gpu-layers=48"]))
      .toEqual([["ctx-size", "32768"], ["n-gpu-layers", "48"]])
  })
  it("tolerates values containing additional equal signs", () => {
    expect(parseKvTokens(["x=a=b=c"])).toEqual([["x", "a=b=c"]])
  })
  it("throws on tokens without =", () => {
    expect(() => parseKvTokens(["bare"])).toThrow(/expected key=value/)
  })
})

describe("setPresetFields", () => {
  it("accepts flag-style and JSON-style aliases", () => {
    const p = setPresetFields(llamaEntry(), [
      ["ctx-size", "32768"],
      ["nGpuLayers", "48"],
      ["ngl", "32"]
    ])
    expect(p.runtime).toBe("llama.cpp")
    if (p.runtime !== "llama.cpp") throw new Error()
    expect(p.llama.ctxSize).toBe(32768)
    // Last write wins (ngl is an alias for nGpuLayers).
    expect(p.llama.nGpuLayers).toBe(32)
  })

  it("merges on top of an existing preset rather than replacing it", () => {
    const entry = llamaEntry({
      preset: { runtime: "llama.cpp", llama: { ctxSize: 8192, parallel: 4 } }
    })
    const p = setPresetFields(entry, [["parallel", "2"]])
    if (p.runtime !== "llama.cpp") throw new Error()
    expect(p.llama).toEqual({ ctxSize: 8192, parallel: 2 })
  })

  it("switches runtime preset when entry runtime changes", () => {
    const entry = mlxEntry({
      preset: { runtime: "llama.cpp", llama: { ctxSize: 1 } }
    })
    const p = setPresetFields(entry, [["decode-concurrency", "4"]])
    expect(p.runtime).toBe("mlx")
    if (p.runtime !== "mlx") throw new Error()
    expect(p.mlx.decodeConcurrency).toBe(4)
  })

  it("rejects unknown keys and non-numeric values", () => {
    expect(() => setPresetFields(llamaEntry(), [["not-a-key", "1"]]))
      .toThrow(/unknown llama.cpp preset key/)
    expect(() => setPresetFields(llamaEntry(), [["ctx-size", "not-a-number"]]))
      .toThrow(/expected a number/)
  })

  it("rejects keys from the wrong runtime", () => {
    expect(() => setPresetFields(mlxEntry(), [["ctx-size", "4"]]))
      .toThrow(/unknown mlx preset key/)
  })
})

describe("unsetPresetFields", () => {
  it("removes named keys and keeps others", () => {
    const entry = llamaEntry({
      preset: { runtime: "llama.cpp", llama: { ctxSize: 8192, parallel: 4 } }
    })
    const p = unsetPresetFields(entry, ["parallel"])!
    if (p.runtime !== "llama.cpp") throw new Error()
    expect(p.llama).toEqual({ ctxSize: 8192 })
  })

  it("returns undefined when all keys are removed", () => {
    const entry = llamaEntry({
      preset: { runtime: "llama.cpp", llama: { ctxSize: 8192 } }
    })
    expect(unsetPresetFields(entry, ["ctx-size"])).toBeUndefined()
  })

  it("returns undefined when the entry has no matching preset", () => {
    expect(unsetPresetFields(llamaEntry(), ["ctx-size"])).toBeUndefined()
  })
})

describe("listKeys", () => {
  it("scopes keys by runtime", () => {
    const mlx = listKeys("mlx").map(k => k.jsonName)
    const llama = listKeys("llama.cpp").map(k => k.jsonName)
    expect(mlx).toContain("decodeConcurrency")
    expect(mlx).not.toContain("ctxSize")
    expect(llama).toContain("ctxSize")
    expect(llama).not.toContain("decodeConcurrency")
  })
})
