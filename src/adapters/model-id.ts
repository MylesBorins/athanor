import type { ModelEntry } from "../types/index.js"

// Identifier the runtime accepts in OpenAI-compatible requests. Must
// match exactly what each runtime was launched with.
export function runtimeModelId(entry: ModelEntry): string {
  if (entry.runtime === "mlx") {
    if (entry.source.type === "hf") return entry.source.repo
    return entry.path
  }
  if (entry.piAlias && entry.piAlias !== entry.slug) return entry.piAlias
  if (entry.source.type === "hf") return entry.id
  return entry.piAlias ?? entry.slug
}
