import type { ModelEntry } from "../types/index.js"

/** TUI / advisory labels: hub repo is primary, slug is secondary context. */
export function modelListParts(m: ModelEntry): { primary: string; secondary?: string } {
  if (m.source.type === "hf") {
    return { primary: m.source.repo, secondary: m.slug }
  }
  return { primary: m.slug }
}

export function modelDisplayLabel(m: ModelEntry): string {
  const { primary, secondary } = modelListParts(m)
  if (secondary && secondary !== primary) return `${primary} · ${secondary}`
  return primary
}

export function runtimeLabelFor(entry: ModelEntry): string {
  if (entry.runtime === "mlx" && entry.mlxFlavor === "vlm") return "mlx-vlm"
  return entry.runtime
}

/** pi provider model `name` — advisory; `/model` lists by runtime `id`. */
export function piDisplayNameFor(entry: ModelEntry): string {
  const { primary } = modelListParts(entry)
  return `[${runtimeLabelFor(entry)}] ${primary} (athanor)`
}
