import type { ActiveInstance, ModelEntry } from "../types/index.js"

export function compareModelsByRecentUse(
  a: ModelEntry,
  b: ModelEntry,
  runningIds?: ReadonlySet<string>
): number {
  const aRunning = runningIds?.has(a.id) ? 1 : 0
  const bRunning = runningIds?.has(b.id) ? 1 : 0
  if (aRunning !== bRunning) return bRunning - aRunning

  const aLastUsed = a.lastUsedAt ?? 0
  const bLastUsed = b.lastUsedAt ?? 0
  if (aLastUsed !== bLastUsed) return bLastUsed - aLastUsed

  const aAdded = a.addedAt ?? 0
  const bAdded = b.addedAt ?? 0
  if (aAdded !== bAdded) return bAdded - aAdded

  return a.slug.localeCompare(b.slug)
}

export function sortModelsByRecentUse(
  models: ModelEntry[],
  instances: ActiveInstance[] = []
): ModelEntry[] {
  const runningIds = new Set(instances.map(i => i.id))
  return [...models].sort((a, b) => compareModelsByRecentUse(a, b, runningIds))
}
