import * as fs from "fs"
import type {
  LlamaConfig,
  MlxConfig,
  RuntimePreset,
  RuntimeType
} from "../types/index.js"
import { PATHS } from "../config/index.js"

// Recipes are named, opinionated presets. A recipe can carry mlx,
// llama, or both sections; when applied to a specific model only the
// matching runtime's section is used.
export interface Recipe {
  name: string
  description: string
  mlx?: Partial<MlxConfig>
  llama?: Partial<LlamaConfig>
  source?: "builtin" | "user"
}

// Keep recipe intent tight and each setting justifiable. These are
// starting points, not magic numbers. Users can override via their
// own ~/.athanor/recipes.json or via `athanor preset set`.
const BUILTINS: Recipe[] = [
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

function readUserRecipes(): Recipe[] {
  if (!fs.existsSync(PATHS.recipes)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(PATHS.recipes, "utf8"))
    const list = Array.isArray(parsed) ? parsed : parsed?.recipes
    if (!Array.isArray(list)) return []
    return list
      .filter(r => r && typeof r.name === "string")
      .map((r): Recipe => ({
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

// User-defined recipes with the same name as a built-in override the
// built-in entirely. Order in listRecipes(): user wins, then builtins
// not shadowed.
export function listRecipes(): Recipe[] {
  const user = readUserRecipes()
  const taken = new Set(user.map(r => r.name))
  return [
    ...user,
    ...BUILTINS.filter(r => !taken.has(r.name))
  ]
}

export function findRecipe(name: string): Recipe | undefined {
  return listRecipes().find(r => r.name === name)
}

// Produces a preset for a specific runtime from a recipe. Built-ins are
// explicit, stored presets; clearing a preset is a separate action.
export function recipeToPreset(
  recipe: Recipe,
  runtime: RuntimeType
): RuntimePreset | undefined {
  if (runtime === "mlx") {
    if (!recipe.mlx || Object.keys(recipe.mlx).length === 0) return undefined
    return { runtime: "mlx", mlx: { ...recipe.mlx } }
  }
  if (!recipe.llama || Object.keys(recipe.llama).length === 0) return undefined
  return { runtime: "llama.cpp", llama: { ...recipe.llama } }
}

export function saveUserRecipe(recipe: Recipe): void {
  const recipes = readUserRecipes()
  const idx = recipes.findIndex(r => r.name === recipe.name)
  const cleanRecipe: Recipe = {
    name: recipe.name,
    description: recipe.description || "",
    mlx: recipe.mlx,
    llama: recipe.llama,
    source: "user"
  }
  if (idx >= 0) {
    recipes[idx] = cleanRecipe
  } else {
    recipes.push(cleanRecipe)
  }
  const tmp = PATHS.recipes + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(recipes, null, 2), "utf8")
  fs.renameSync(tmp, PATHS.recipes)
}

export function deleteUserRecipe(name: string): boolean {
  const recipes = readUserRecipes()
  const filtered = recipes.filter(r => r.name !== name)
  if (filtered.length === recipes.length) return false
  const tmp = PATHS.recipes + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(filtered, null, 2), "utf8")
  fs.renameSync(tmp, PATHS.recipes)
  return true
}
