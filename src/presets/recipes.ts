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
    description: "Global defaults (no overrides).",
    source: "builtin"
  },
  {
    name: "fast",
    description: "Latency-first. Smaller context and caches, more batch throughput.",
    mlx: { decodeConcurrency: 2, promptCacheSize: 512, prefillStepSize: 512 },
    llama: { ctxSize: 8192, batchSize: 256, ubatchSize: 128, parallel: 2 },
    source: "builtin"
  },
  {
    name: "quality",
    description: "Longer context and larger prompt cache. Slower, more accurate long outputs.",
    mlx: { decodeConcurrency: 1, promptCacheSize: 4096, prefillStepSize: 128 },
    llama: { ctxSize: 16384, batchSize: 128, ubatchSize: 64, parallel: 1 },
    source: "builtin"
  },
  {
    name: "long-context",
    description: "Maximum context for RAG / long docs. Uses more memory.",
    mlx: { promptCacheSize: 8192, prefillStepSize: 128, decodeConcurrency: 1 },
    llama: { ctxSize: 65536, batchSize: 128, ubatchSize: 64, parallel: 1 },
    source: "builtin"
  },
  {
    name: "coding",
    description: "Balanced for coding assistants: wide context, modest parallelism.",
    mlx: { promptCacheSize: 4096, prefillStepSize: 256, decodeConcurrency: 2 },
    llama: { ctxSize: 32768, batchSize: 256, ubatchSize: 128, parallel: 2 },
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

// Produces a preset for a specific runtime from a recipe. Returns
// undefined if the recipe has nothing to say about that runtime
// (applying `balanced` to an mlx model, for instance, clears the
// preset).
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
