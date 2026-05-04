import { getModel } from "../registry/index.js"
import { setPreset } from "../app/models.js"
import { findRecipe, listRecipes, recipeToPreset } from "../presets/recipes.js"
import { listKeys, parseKvTokens, setPresetFields, unsetPresetFields } from "../presets/edit.js"
import { style } from "./style.js"
import { dim, head, info, ok } from "./shared.js"

export function cmdPresetShow(idOrSlug: string): void {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  head(`preset: ${entry.slug}`)
  if (!entry.preset) { console.log("  " + dim("(none)")); return }
  console.log(JSON.stringify(entry.preset, null, 2)
    .split("\n").map(l => "  " + l).join("\n"))
}

export function cmdPresetSet(idOrSlug: string, tokens: string[]): void {
  if (tokens.length === 0) throw new Error("expected one or more key=value pairs")
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const preset = setPresetFields(entry, parseKvTokens(tokens))
  setPreset(entry.id, preset)
  ok(`${style.bold(entry.slug)} preset updated ${dim(`(${tokens.length} field${tokens.length === 1 ? "" : "s"})`)}`)
  info(`restart to apply: ${style.bold(`athanor restart ${entry.slug}`)}`)
}

export function cmdPresetUnset(idOrSlug: string, keys: string[]): void {
  if (keys.length === 0) throw new Error("expected one or more keys")
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const preset = unsetPresetFields(entry, keys)
  setPreset(entry.id, preset)
  ok(`${style.bold(entry.slug)} preset ${preset ? "updated" : "cleared"}`)
}

export function cmdPresetClear(idOrSlug: string): void {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  setPreset(entry.id, undefined)
  ok(`${style.bold(entry.slug)} preset cleared`)
}

export function cmdPresetApply(idOrSlug: string, recipeName: string): void {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const recipe = findRecipe(recipeName)
  if (!recipe) throw new Error(`unknown recipe: ${recipeName}. Try 'athanor recipes'`)
  const preset = recipeToPreset(recipe, entry.runtime)
  setPreset(entry.id, preset)
  const tag = preset ? style.bold(recipeName) : `${style.bold(recipeName)} ${dim("(no-op for " + entry.runtime + ")")}`
  ok(`${style.bold(entry.slug)} ← recipe ${tag}`)
  if (preset) info(`restart to apply: ${style.bold(`athanor restart ${entry.slug}`)}`)
}

export function cmdRecipes(): void {
  const recipes = listRecipes()
  head(`recipes (${recipes.length})`)
  const widest = Math.max(...recipes.map(r => r.name.length))
  for (const r of recipes) {
    const tag = r.source === "user" ? style.magenta(" [user]") : style.gray(" [builtin]")
    console.log(`  ${style.bold(r.name.padEnd(widest))}${tag}  ${dim(r.description)}`)
  }
  console.log()
  head("tunable keys")
  for (const rt of ["mlx", "llama.cpp"] as const) {
    console.log(`  ${style.cyan(rt)}`)
    for (const k of listKeys(rt)) {
      console.log(`    ${style.bold(k.aliases[0]!.padEnd(22))} ${dim(k.help)}`)
    }
  }
}
