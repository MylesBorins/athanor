import type { ActiveInstance, ModelEntry } from "../types/index.js"
import { probeHealth, probeRuntimeModelId } from "../adapters/health.js"

export async function recoverLiveInstances(
  entries: ModelEntry[],
  persisted: ActiveInstance[]
): Promise<ActiveInstance[]> {
  const recovered = [...persisted]
  const trackedIds = new Set(persisted.map(inst => inst.id))

  for (const entry of entries) {
    if (trackedIds.has(entry.id)) continue
    if (!(await probeHealth(entry.runtime, entry.port, 400))) continue
    if (!(await probeRuntimeModelId(entry, 800))) continue
    recovered.push({
      id: entry.id,
      slug: entry.slug,
      runtime: entry.runtime,
      port: entry.port,
      pid: -1,
      startedAt: Date.now(),
      status: "running",
      logFile: ""
    })
    trackedIds.add(entry.id)
  }

  return recovered
}
