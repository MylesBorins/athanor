import { getModel } from "../registry/index.js"
import { setFormula } from "../app/models.js"
import {
  deleteUserFormula,
  findFormula,
  formulaToRuntime,
  listFormulas,
  saveUserFormula,
  type Formula
} from "../presets/recipes.js"
import { listKeys, parseKvTokens, setFormulaFields, unsetFormulaFields } from "../presets/edit.js"
import { style } from "./style.js"
import { dim, head, info, ok } from "./shared.js"

export function cmdFormulaShow(idOrSlug: string): void {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  head(`formula: ${entry.slug}`)
  const active = entry.formula ?? entry.preset
  if (!active) { console.log("  " + dim("(none)")); return }
  console.log(JSON.stringify(active, null, 2)
    .split("\n").map(l => "  " + l).join("\n"))
}

export const cmdPresetShow = cmdFormulaShow

export function cmdFormulaSet(idOrSlug: string, tokens: string[]): void {
  if (tokens.length === 0) throw new Error("expected one or more key=value pairs")
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const formula = setFormulaFields(entry, parseKvTokens(tokens))
  setFormula(entry.id, formula)
  ok(`${style.bold(entry.slug)} formula updated ${dim(`(${tokens.length} field${tokens.length === 1 ? "" : "s"})`)}`)
  info(`restart to apply: ${style.bold(`athanor restart ${entry.slug}`)}`)
}

export const cmdPresetSet = cmdFormulaSet

export function cmdFormulaUnset(idOrSlug: string, keys: string[]): void {
  if (keys.length === 0) throw new Error("expected one or more keys")
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const formula = unsetFormulaFields(entry, keys)
  setFormula(entry.id, formula)
  ok(`${style.bold(entry.slug)} formula ${formula ? "updated" : "cleared"}`)
}

export const cmdPresetUnset = cmdFormulaUnset

export function cmdFormulaClear(idOrSlug: string): void {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  setFormula(entry.id, undefined)
  ok(`${style.bold(entry.slug)} formula cleared`)
}

export const cmdPresetClear = cmdFormulaClear

export function cmdFormulaApply(idOrSlug: string, formulaName: string): void {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const formula = findFormula(formulaName)
  if (!formula) throw new Error(`unknown formula: ${formulaName}. Try 'athanor formulas'`)
  const runtimeFormula = formulaToRuntime(formula, entry.runtime)
  setFormula(entry.id, runtimeFormula)
  const tag = runtimeFormula ? style.bold(formulaName) : `${style.bold(formulaName)} ${dim("(no-op for " + entry.runtime + ")")}`
  ok(`${style.bold(entry.slug)} ← formula ${tag}`)
  if (runtimeFormula) info(`restart to apply: ${style.bold(`athanor restart ${entry.slug}`)}`)
}

export const cmdPresetApply = cmdFormulaApply

export function cmdFormulaSave(idOrSlug: string, formulaName: string, description?: string): void {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const active = entry.formula ?? entry.preset
  if (!active) throw new Error(`model "${entry.slug}" has no custom formula configured to save. Tune fields first with "athanor formula ${entry.slug} set ..."`)

  const formula: Formula = {
    name: formulaName,
    description: description || `Saved formula from ${entry.slug}`,
    mlx: active.runtime === "mlx" ? active.mlx : undefined,
    llama: active.runtime === "llama.cpp" ? active.llama : undefined,
    source: "user"
  }
  saveUserFormula(formula)
  ok(`saved formula from ${style.bold(entry.slug)} as ${style.bold(formulaName)} in ~/.athanor/formulas.json`)
}

export const cmdPresetSave = cmdFormulaSave

export function cmdFormulasDelete(formulaName: string): void {
  const deleted = deleteUserFormula(formulaName)
  if (!deleted) throw new Error(`unknown user formula: ${formulaName}`)
  ok(`formula ${style.bold(formulaName)} removed from ~/.athanor/formulas.json`)
}

export const cmdRecipeDelete = cmdFormulasDelete

export function cmdFormulas(): void {
  const formulas = listFormulas()
  head(`formulas (${formulas.length})`)
  const widest = Math.max(...formulas.map(r => r.name.length))
  for (const r of formulas) {
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

export const cmdRecipes = cmdFormulas
