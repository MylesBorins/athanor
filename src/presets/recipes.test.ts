import * as fs from "fs"
import * as path from "path"
import { describe, it, expect, afterEach, beforeEach } from "vitest"
import {
  deleteUserFormula,
  deleteUserRecipe,
  findFormula,
  findMatchingFormula,
  findMatchingRecipe,
  findRecipe,
  formulaToRuntime,
  listFormulas,
  listRecipes,
  readUserFormulas,
  recipeToPreset,
  saveUserFormula,
  saveUserRecipe
} from "./recipes.js"
import { loadRegistry, saveRegistry } from "../registry/index.js"
import { PATHS } from "../config/index.js"
import type { ModelEntry } from "../types/index.js"

function stash(p: string): string | null {
  if (!fs.existsSync(p)) return null
  const s = fs.readFileSync(p, "utf8")
  fs.unlinkSync(p)
  return s
}

function restore(p: string, s: string | null): void {
  try { fs.unlinkSync(p) } catch { /* not present */ }
  if (s !== null) {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, s, "utf8")
  }
}

describe("listFormulas", () => {
  it("includes core built-in formulas", () => {
    const names = listFormulas().map(r => r.name)
    expect(names).toContain("balanced")
    expect(names).toContain("fast")
    expect(names).toContain("long-context")
    expect(names).toContain("q8-kv")
    expect(names).toContain("thinking")
    expect(names).toContain("instruct")
    expect(names).toContain("mtp")
  })

  it("marks the source of built-in formulas", () => {
    const r = findFormula("fast")!
    expect(r.source).toBe("builtin")
  })
})

describe("user formulas and migration", () => {
  let stashedFormulas: string | null = null
  let stashedRecipes: string | null = null

  beforeEach(() => {
    stashedFormulas = stash(PATHS.formulas)
    stashedRecipes = stash(PATHS.recipes)
  })

  afterEach(() => {
    restore(PATHS.formulas, stashedFormulas)
    restore(PATHS.recipes, stashedRecipes)
  })

  it("loads user formulas from ~/.athanor/formulas.json", () => {
    fs.mkdirSync(path.dirname(PATHS.formulas), { recursive: true })
    fs.writeFileSync(PATHS.formulas, JSON.stringify([
      { name: "tiny", description: "my tiny", llama: { ctxSize: 2048 } }
    ]))
    const tiny = findFormula("tiny")!
    expect(tiny.source).toBe("user")
    expect(tiny.llama?.ctxSize).toBe(2048)
  })

  it("automatically migrates legacy recipes.json to formulas.json when formulas.json is missing", () => {
    fs.mkdirSync(path.dirname(PATHS.recipes), { recursive: true })
    fs.writeFileSync(PATHS.recipes, JSON.stringify([
      { name: "legacy-tune", description: "from recipes.json", llama: { temp: 0.4 } }
    ]))

    expect(fs.existsSync(PATHS.formulas)).toBe(false)
    const formulas = readUserFormulas()
    expect(formulas.map(f => f.name)).toContain("legacy-tune")
    expect(fs.existsSync(PATHS.formulas)).toBe(true)

    const migrated = JSON.parse(fs.readFileSync(PATHS.formulas, "utf8"))
    expect(migrated[0].name).toBe("legacy-tune")
  })

  it("user formulas override built-ins of the same name", () => {
    fs.mkdirSync(path.dirname(PATHS.formulas), { recursive: true })
    fs.writeFileSync(PATHS.formulas, JSON.stringify([
      { name: "fast", description: "override", llama: { ctxSize: 1 } }
    ]))
    const fast = findFormula("fast")!
    expect(fast.source).toBe("user")
    expect(fast.description).toBe("override")
    expect(fast.llama?.ctxSize).toBe(1)
  })

  it("accepts the wrapped { formulas: [...] } form", () => {
    fs.mkdirSync(path.dirname(PATHS.formulas), { recursive: true })
    fs.writeFileSync(PATHS.formulas, JSON.stringify({
      formulas: [{ name: "wrap", description: "w" }]
    }))
    expect(findFormula("wrap")?.source).toBe("user")
  })

  it("saves user formulas with saveUserFormula and allows deleting with deleteUserFormula", () => {
    saveUserFormula({ name: "custom-1", description: "my custom", llama: { temp: 0.5 } })
    const r1 = findFormula("custom-1")!
    expect(r1.source).toBe("user")
    expect(r1.llama?.temp).toBe(0.5)

    const deleted = deleteUserFormula("custom-1")
    expect(deleted).toBe(true)
    expect(findFormula("custom-1")).toBeUndefined()
  })

  it("ignores malformed files silently", () => {
    fs.mkdirSync(path.dirname(PATHS.formulas), { recursive: true })
    fs.writeFileSync(PATHS.formulas, "not json {{{")
    // Still resolves built-ins.
    expect(findFormula("fast")?.source).toBe("builtin")
  })
})

describe("formulaToRuntime", () => {
  it("produces an mlx runtime formula when applied to an mlx entry", () => {
    const p = formulaToRuntime(findFormula("fast")!, "mlx")!
    expect(p.runtime).toBe("mlx")
  })

  it("produces a llama runtime formula when applied to a llama entry", () => {
    const p = formulaToRuntime(findFormula("fast")!, "llama.cpp")!
    expect(p.runtime).toBe("llama.cpp")
  })

  it("ships explicit built-in context bands", () => {
    expect(findFormula("fast")?.mlx?.promptCacheSize).toBe(8192)
    expect(findFormula("balanced")?.mlx?.promptCacheSize).toBe(65536)
    expect(findFormula("long-context")?.mlx?.promptCacheSize).toBe(131072)

    expect(findFormula("fast")?.llama?.ctxSize).toBe(8192)
    expect(findFormula("balanced")?.llama?.ctxSize).toBe(65536)
    expect(findFormula("long-context")?.llama?.ctxSize).toBe(131072)
  })

  it("keeps mlx and llama context bands aligned across built-ins", () => {
    for (const name of ["fast", "balanced", "long-context"]) {
      const formula = findFormula(name)!
      expect(formula.mlx?.promptCacheSize).toBe(formula.llama?.ctxSize)
    }
  })
})

describe("findMatchingFormula and model registry fallback", () => {
  let stashedRegistry: string | null = null

  beforeEach(() => {
    stashedRegistry = stash(PATHS.registry)
  })

  afterEach(() => {
    restore(PATHS.registry, stashedRegistry)
  })

  it("finds matching formula from model formula", () => {
    const entry: ModelEntry = {
      id: "test",
      slug: "test",
      path: "/test",
      runtime: "llama.cpp",
      source: { type: "local" },
      port: 8000,
      publish: true,
      addedAt: 0,
      formula: {
        runtime: "llama.cpp",
        llama: {
          temp: 1.0,
          topP: 0.95,
          topK: 20,
          minP: 0,
          presencePenalty: 0.0,
          repeatPenalty: 1.0
        }
      }
    }
    const match = findMatchingFormula(entry)
    expect(match?.name).toBe("thinking")
  })

  it("seamlessly reads legacy preset from models.json and writes formula on save", () => {
    fs.mkdirSync(path.dirname(PATHS.registry), { recursive: true })
    const legacyEntry = {
      id: "legacy-entry",
      slug: "legacy-entry",
      path: "/models/legacy.gguf",
      runtime: "llama.cpp",
      source: { type: "local" },
      port: 8089,
      preset: {
        runtime: "llama.cpp",
        llama: { ctxSize: 32768, cacheTypeK: "q8_0", cacheTypeV: "q8_0" }
      },
      publish: true,
      addedAt: 100
    }
    fs.writeFileSync(PATHS.registry, JSON.stringify({ version: 1, models: [legacyEntry] }))

    const loaded = loadRegistry()
    expect(loaded.models[0]!.formula).toBeDefined()
    expect(loaded.models[0]!.formula?.runtime).toBe("llama.cpp")

    saveRegistry(loaded)
    const rawSaved = JSON.parse(fs.readFileSync(PATHS.registry, "utf8"))
    expect(rawSaved.models[0].formula).toBeDefined()
    expect(rawSaved.models[0].preset).toBeUndefined()
  })
})
