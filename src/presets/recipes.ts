import * as fs from "fs"
import type {
  Formula,
  LlamaConfig,
  MlxConfig,
  ModelEntry,
  RuntimeFormula,
  RuntimePreset,
  RuntimeType
} from "../types/index.js"
import { PATHS } from "../config/index.js"

export type { Formula, Recipe } from "../types/index.js"

// Built-in formulas are named, opinionated runtime configurations.
// A formula can carry mlx, llama, or both sections; when applied to a
// specific model only the matching runtime's section is used.
export const BUILTIN_FORMULAS: Formula[] = [
  {
    name: "balanced",
    description: "Recommended default. Good for most chat, coding, and agent workflows.",
    mlx: { prefillStepSize: 2048, promptCacheSize: 65536, decodeConcurrency: 1, contextWindow: 65536, maxTokens: 4096, promptCacheBytes: 16 * 1024 ** 3 },
    llama: { ctxSize: 65536, batchSize: 2048, ubatchSize: 512, parallel: 1, nGpuLayers: 999 },
    source: "builtin"
  },
  {
    name: "fast",
    description: "Lower latency, smaller context. May forget earlier turns sooner.",
    mlx: { prefillStepSize: 256, promptCacheSize: 8192, decodeConcurrency: 1, contextWindow: 8192, maxTokens: 2048, promptCacheBytes: 12 * 1024 ** 3 },
    llama: { ctxSize: 8192, batchSize: 256, ubatchSize: 128, parallel: 1, nGpuLayers: 999 },
    source: "builtin"
  },
  {
    name: "long-context",
    description: "Maximum context for large documents and long conversations (128K context with Q8_0 KV cache and Flash Attention).",
    mlx: { prefillStepSize: 2048, promptCacheSize: 131072, decodeConcurrency: 1, contextWindow: 131072, maxTokens: 8192, promptCacheBytes: 20 * 1024 ** 3 },
    llama: { ctxSize: 131072, batchSize: 2048, ubatchSize: 512, parallel: 1, nGpuLayers: 999, cacheTypeK: "q8_0", cacheTypeV: "q8_0", flashAttn: "on" },
    source: "builtin"
  },
  {
    name: "q8-kv",
    description: "Quantized Q8_0 KV cache with Flash Attention to reduce memory footprint at large contexts.",
    llama: { cacheTypeK: "q8_0", cacheTypeV: "q8_0", flashAttn: "on" },
    source: "builtin"
  },
  {
    name: "thinking",
    description: "Reasoning/thinking model sampling (Qwen/DeepSeek recommended: temp=1.0, topP=0.95, topK=20).",
    mlx: { temp: 1.0, topP: 0.95, topK: 20, minP: 0 },
    llama: { temp: 1.0, topP: 0.95, topK: 20, minP: 0, presencePenalty: 0.0, repeatPenalty: 1.0 },
    source: "builtin"
  },
  {
    name: "instruct",
    description: "Standard instruct model sampling (temp=0.7, topP=0.80, topK=20, presencePenalty=1.5).",
    mlx: { temp: 0.7, topP: 0.80, topK: 20, minP: 0 },
    llama: { temp: 0.7, topP: 0.80, topK: 20, minP: 0, presencePenalty: 1.5, repeatPenalty: 1.0 },
    source: "builtin"
  },
  {
    name: "mtp",
    description: "Multi-Token Prediction speculative decoding (requires an MTP-capable GGUF model).",
    llama: { specType: "draft-mtp", specDraftNgl: 999 },
    source: "builtin"
  }
]

export const BUILTINS = BUILTIN_FORMULAS

function parseFormulaFile(filepath: string): Formula[] {
  if (!fs.existsSync(filepath)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(filepath, "utf8"))
    const list = Array.isArray(parsed) ? parsed : (parsed?.formulas || parsed?.recipes)
    if (!Array.isArray(list)) return []
    return list
      .filter(r => r && typeof r.name === "string")
      .map((r): Formula => ({
        name: r.name,
        description: typeof r.description === "string" ? r.description : "",
        mlx: r.mlx && typeof r.mlx === "object" ? r.mlx : undefined,
        llama: r.llama && typeof r.llama === "object" ? r.llama : undefined,
        source: "user"
      }))
  } catch {
    return []
  }
}

export function readUserFormulas(): Formula[] {
  // If formulas.json exists, load it directly
  if (fs.existsSync(PATHS.formulas)) {
    return parseFormulaFile(PATHS.formulas)
  }
  // Migration fallback: if legacy recipes.json exists and formulas.json doesn't,
  // load recipes.json and save to formulas.json
  if (fs.existsSync(PATHS.recipes)) {
    const legacy = parseFormulaFile(PATHS.recipes)
    if (legacy.length > 0) {
      try {
        const tmp = PATHS.formulas + ".tmp"
        fs.writeFileSync(tmp, JSON.stringify(legacy, null, 2), "utf8")
        fs.renameSync(tmp, PATHS.formulas)
      } catch {
        // Fall back to reading in memory if write fails
      }
    }
    return legacy
  }
  return []
}

export const readUserRecipes = readUserFormulas

// User-defined formulas with the same name as a built-in override the
// built-in entirely. Order in listFormulas(): user wins, then builtins
// not shadowed.
export function listFormulas(): Formula[] {
  const user = readUserFormulas()
  const taken = new Set(user.map(r => r.name))
  return [
    ...user,
    ...BUILTIN_FORMULAS.filter(r => !taken.has(r.name))
  ]
}

export const listRecipes = listFormulas

export function findFormula(name: string): Formula | undefined {
  return listFormulas().find(r => r.name === name)
}

export const findRecipe = findFormula

export function findMatchingFormula(
  entry: ModelEntry,
  formulas: Formula[] = listFormulas()
): Formula | undefined {
  const active = entry.formula ?? entry.preset
  if (!active) return undefined
  for (const r of formulas) {
    if (active.runtime === "llama.cpp" && r.llama && Object.keys(r.llama).length > 0) {
      const p = active.llama as Record<string, unknown>
      const rec = r.llama as Record<string, unknown>
      const pKeys = Object.keys(p).filter(k => p[k] !== undefined)
      const rKeys = Object.keys(rec).filter(k => rec[k] !== undefined)
      if (pKeys.length === rKeys.length && pKeys.every(k => p[k] === rec[k])) {
        return r
      }
    }
    if (active.runtime === "mlx" && r.mlx && Object.keys(r.mlx).length > 0) {
      const p = active.mlx as Record<string, unknown>
      const rec = r.mlx as Record<string, unknown>
      const pKeys = Object.keys(p).filter(k => p[k] !== undefined)
      const rKeys = Object.keys(rec).filter(k => rec[k] !== undefined)
      if (pKeys.length === rKeys.length && pKeys.every(k => p[k] === rec[k])) {
        return r
      }
    }
  }
  return undefined
}

export const findMatchingRecipe = findMatchingFormula

// Produces a runtime formula for a specific runtime from a named formula template.
export function formulaToRuntime(
  formula: Formula,
  runtime: RuntimeType
): RuntimeFormula | undefined {
  if (runtime === "mlx") {
    if (!formula.mlx || Object.keys(formula.mlx).length === 0) return undefined
    return { runtime: "mlx", mlx: { ...formula.mlx } }
  }
  if (!formula.llama || Object.keys(formula.llama).length === 0) return undefined
  return { runtime: "llama.cpp", llama: { ...formula.llama } }
}

export const recipeToPreset = formulaToRuntime

export function saveUserFormula(formula: Formula): void {
  const formulas = readUserFormulas()
  const idx = formulas.findIndex(r => r.name === formula.name)
  const cleanFormula: Formula = {
    name: formula.name,
    description: formula.description || "",
    mlx: formula.mlx,
    llama: formula.llama,
    source: "user"
  }
  if (idx >= 0) {
    formulas[idx] = cleanFormula
  } else {
    formulas.push(cleanFormula)
  }
  const tmp = PATHS.formulas + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(formulas, null, 2), "utf8")
  fs.renameSync(tmp, PATHS.formulas)
}

export const saveUserRecipe = saveUserFormula

export function deleteUserFormula(name: string): boolean {
  const formulas = readUserFormulas()
  const filtered = formulas.filter(r => r.name !== name)
  if (filtered.length === formulas.length) return false
  const tmp = PATHS.formulas + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(filtered, null, 2), "utf8")
  fs.renameSync(tmp, PATHS.formulas)
  return true
}

export const deleteUserRecipe = deleteUserFormula
