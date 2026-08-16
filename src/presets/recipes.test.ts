import * as fs from "fs"
import { describe, it, expect, afterEach, beforeEach } from "vitest"
import { deleteUserRecipe, findRecipe, listRecipes, recipeToPreset, saveUserRecipe } from "./recipes.js"
import { PATHS } from "../config/index.js"

function stash(p: string): string | null {
  if (!fs.existsSync(p)) return null
  const s = fs.readFileSync(p, "utf8")
  fs.unlinkSync(p)
  return s
}

function restore(p: string, s: string | null): void {
  try { fs.unlinkSync(p) } catch { /* not present */ }
  if (s !== null) {
    fs.mkdirSync(require("path").dirname(p), { recursive: true })
    fs.writeFileSync(p, s, "utf8")
  }
}

describe("listRecipes", () => {
  it("includes core built-in recipes", () => {
    const names = listRecipes().map(r => r.name)
    expect(names).toContain("balanced")
    expect(names).toContain("fast")
    expect(names).toContain("long-context")
    expect(names).toContain("thinking")
    expect(names).toContain("instruct")
    expect(names).toContain("mtp")
  })

  it("marks the source of built-in recipes", () => {
    const r = findRecipe("fast")!
    expect(r.source).toBe("builtin")
  })
})

describe("user recipes", () => {
  let stashed: string | null = null
  beforeEach(() => { stashed = stash(PATHS.recipes) })
  afterEach(() => { restore(PATHS.recipes, stashed) })

  it("loads user recipes from ~/.athanor/recipes.json", () => {
    fs.mkdirSync(require("path").dirname(PATHS.recipes), { recursive: true })
    fs.writeFileSync(PATHS.recipes, JSON.stringify([
      { name: "tiny", description: "my tiny", llama: { ctxSize: 2048 } }
    ]))
    const tiny = findRecipe("tiny")!
    expect(tiny.source).toBe("user")
    expect(tiny.llama?.ctxSize).toBe(2048)
  })

  it("user recipes override built-ins of the same name", () => {
    fs.mkdirSync(require("path").dirname(PATHS.recipes), { recursive: true })
    fs.writeFileSync(PATHS.recipes, JSON.stringify([
      { name: "fast", description: "override", llama: { ctxSize: 1 } }
    ]))
    const fast = findRecipe("fast")!
    expect(fast.source).toBe("user")
    expect(fast.description).toBe("override")
    expect(fast.llama?.ctxSize).toBe(1)
  })

  it("accepts the wrapped { recipes: [...] } form", () => {
    fs.mkdirSync(require("path").dirname(PATHS.recipes), { recursive: true })
    fs.writeFileSync(PATHS.recipes, JSON.stringify({
      recipes: [{ name: "wrap", description: "w" }]
    }))
    expect(findRecipe("wrap")?.source).toBe("user")
  })

  it("saves user recipes with saveUserRecipe and allows deleting with deleteUserRecipe", () => {
    saveUserRecipe({ name: "custom-1", description: "my custom", llama: { temp: 0.5 } })
    const r1 = findRecipe("custom-1")!
    expect(r1.source).toBe("user")
    expect(r1.llama?.temp).toBe(0.5)

    const deleted = deleteUserRecipe("custom-1")
    expect(deleted).toBe(true)
    expect(findRecipe("custom-1")).toBeUndefined()
  })

  it("ignores malformed files silently", () => {
    fs.mkdirSync(require("path").dirname(PATHS.recipes), { recursive: true })
    fs.writeFileSync(PATHS.recipes, "not json {{{")
    // Still resolves built-ins.
    expect(findRecipe("fast")?.source).toBe("builtin")
  })
})

describe("recipeToPreset", () => {
  it("produces an mlx preset when applied to an mlx entry", () => {
    const p = recipeToPreset(findRecipe("fast")!, "mlx")!
    expect(p.runtime).toBe("mlx")
  })
  it("produces a llama preset when applied to a llama entry", () => {
    const p = recipeToPreset(findRecipe("fast")!, "llama.cpp")!
    expect(p.runtime).toBe("llama.cpp")
  })

  it("ships explicit built-in context bands", () => {
    expect(findRecipe("fast")?.mlx?.promptCacheSize).toBe(8192)
    expect(findRecipe("balanced")?.mlx?.promptCacheSize).toBe(65536)
    expect(findRecipe("long-context")?.mlx?.promptCacheSize).toBe(131072)

    expect(findRecipe("fast")?.llama?.ctxSize).toBe(8192)
    expect(findRecipe("balanced")?.llama?.ctxSize).toBe(65536)
    expect(findRecipe("long-context")?.llama?.ctxSize).toBe(131072)
  })

  it("keeps mlx and llama context bands aligned across built-ins", () => {
    for (const name of ["fast", "balanced", "long-context"]) {
      const recipe = findRecipe(name)!
      expect(recipe.mlx?.promptCacheSize).toBe(recipe.llama?.ctxSize)
    }
  })
})
