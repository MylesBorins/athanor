import * as fs from "fs"
import { describe, it, expect, beforeEach } from "vitest"
import { cmdFlavor } from "./commands.js"
import { getModel, upsertModel } from "../registry/index.js"
import { PATHS } from "../config/index.js"
import type { ModelEntry } from "../types/index.js"

function mlxEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "x/y",
    slug: "y",
    path: "/m/y",
    runtime: "mlx",
    source: { type: "hf", repo: "x/y" },
    port: 8081,
    publish: true,
    piAlias: "y",
    addedAt: 1,
    mlxFlavor: "lm",
    ...overrides
  }
}

describe("cmdFlavor", () => {
  beforeEach(() => {
    try { fs.unlinkSync(PATHS.registry) } catch { /* not present */ }
  })

  it("flips mlxFlavor on an mlx entry", () => {
    upsertModel(mlxEntry())
    cmdFlavor("y", "vlm")
    expect(getModel("y")!.mlxFlavor).toBe("vlm")
  })

  it("accepts id and slug", () => {
    upsertModel(mlxEntry({ mlxFlavor: "vlm" }))
    cmdFlavor("x/y", "lm")
    expect(getModel("y")!.mlxFlavor).toBe("lm")
  })

  it("rejects unknown values", () => {
    upsertModel(mlxEntry())
    expect(() => cmdFlavor("y", "bogus")).toThrow(/lm or vlm/)
    expect(getModel("y")!.mlxFlavor).toBe("lm")
  })

  it("rejects non-mlx entries", () => {
    upsertModel(mlxEntry({
      id: "g",
      slug: "g",
      runtime: "llama.cpp",
      mlxFlavor: undefined
    }))
    expect(() => cmdFlavor("g", "vlm")).toThrow(/only applies to mlx/)
    expect(getModel("g")!.mlxFlavor).toBeUndefined()
  })

  it("throws on unknown slug", () => {
    expect(() => cmdFlavor("nope", "lm")).toThrow(/unknown model/)
  })
})
