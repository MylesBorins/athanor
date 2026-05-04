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
    mlx: { prefillStepSize: 512, promptCacheSize: 16384, decodeConcurrency: 1 },
    llama: { ctxSize: 16384, batchSize: 512, ubatchSize: 256, parallel: 1, threads: 8, nGpuLayers: 999 },
    source: "builtin"
  },
  {
    name: "fast",
    description: "Lower latency, smaller context. May forget earlier turns sooner.",
    mlx: { prefillStepSize: 256, promptCacheSize: 8192, decodeConcurrency: 1 },
    llama: { ctxSize: 8192, batchSize: 256, ubatchSize: 128, parallel: 1, threads: 8, nGpuLayers: 999 },
    source: "builtin"
  },
  {
    name: "quality",
    description: "Larger context for more stable long reasoning. Slightly higher memory use.",
    mlx: { prefillStepSize: 512, promptCacheSize: 32768, decodeConcurrency: 1 },
    llama: { ctxSize: 32768, batchSize: 512, ubatchSize: 256, parallel: 1, threads: 8, nGpuLayers: 999 },
    source: "builtin"
  },
  {
    name: "long-context",
    description: "Maximum context for large documents and long conversations. May be slow or unstable on 16 GB Macs.",
    mlx: { prefillStepSize: 512, promptCacheSize: 65536, decodeConcurrency: 1 },
    llama: { ctxSize: 65536, batchSize: 512, ubatchSize: 256, parallel: 1, threads: 8, nGpuLayers: 999 },
    source: "builtin"
  },
  {
    name: "coding",
    description: "Optimized for multi-file and agent workflows with larger context.",
    mlx: { prefillStepSize: 512, promptCacheSize: 32768, decodeConcurrency: 1 },
    llama: { ctxSize: 32768, batchSize: 512, ubatchSize: 256, parallel: 1, threads: 8, nGpuLayers: 999 },
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
