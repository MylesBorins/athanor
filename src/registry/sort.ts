import type { ActiveInstance, ModelEntry } from "../types/index.js"

export function compareModelsByRunningThenSlug(
  a: ModelEntry,
  b: ModelEntry,
  runningIds?: ReadonlySet<string>
): number {
  const aRunning = runningIds?.has(a.id) ? 1 : 0
  const bRunning = runningIds?.has(b.id) ? 1 : 0
  if (aRunning !== bRunning) return bRunning - aRunning
  return a.slug.localeCompare(b.slug)
}

export function sortModelsByRunningThenSlug(
  models: ModelEntry[],
  instances: ActiveInstance[] = []
): ModelEntry[] {
  const runningIds = new Set(instances.map(i => i.id))
  return [...models].sort((a, b) => compareModelsByRunningThenSlug(a, b, runningIds))
}

export function compareModelsByRecentUse(
  a: ModelEntry,
  b: ModelEntry,
  runningIds?: ReadonlySet<string>
): number {
  const byStable = compareModelsByRunningThenSlug(a, b, runningIds)
  if (byStable !== 0) return byStable

  const aLastUsed = a.lastUsedAt ?? 0
  const bLastUsed = b.lastUsedAt ?? 0
  if (aLastUsed !== bLastUsed) return bLastUsed - aLastUsed

  const aAdded = a.addedAt ?? 0
  const bAdded = b.addedAt ?? 0
  if (aAdded !== bAdded) return bAdded - aAdded

  return 0
}

export function sortModelsByRecentUse(
  models: ModelEntry[],
  instances: ActiveInstance[] = []
): ModelEntry[] {
  const runningIds = new Set(instances.map(i => i.id))
  return [...models].sort((a, b) => compareModelsByRecentUse(a, b, runningIds))
}
