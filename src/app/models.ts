import type { ActiveInstance, ModelEntry } from "../types/index.js"
import { ingestDiscovered, type IngestReport } from "../discovery/ingest.js"
import { pull, type PullOptions, type PullResult } from "../pull/hf.js"
import {
  getModel,
  removeModel,
  setModelFlavor,
  setModelPreset,
  setModelPublish
} from "../registry/index.js"
import { supervisor } from "../supervisor/index.js"
import { syncPi } from "../sync/pi.js"

export interface StartModelResult {
  entry: ModelEntry
  instance: ActiveInstance
}

export interface StopModelResult {
  stoppedAll: boolean
  entry?: ModelEntry
}

export function scanModelsAndReport(): IngestReport {
  return ingestDiscovered()
}

export async function pullModel(opts: PullOptions): Promise<PullResult> {
  return pull(opts)
}

// Thin application service layer. Common operator flows should come
// through here so registry/supervisor mutations and downstream pi sync
// stay coupled in one place. This is a convention boundary rather than
// a hard transaction system, so new mutation paths should prefer this
// module over calling syncPi() ad hoc.
export async function startModel(idOrSlug: string): Promise<StartModelResult> {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const instance = await supervisor.start(entry)
  syncPi({ activeDefault: instance, instances: supervisor.list() })
  return { entry, instance }
}

export async function stopModel(idOrSlug?: string): Promise<StopModelResult> {
  if (!idOrSlug || idOrSlug === "--all") {
    // Stopping all instances does not change publish state. Re-sync pi
    // with an empty running set, but leave provider emission driven by
    // the registry's persistent `publish` flags.
    await supervisor.stopAll()
    syncPi({ instances: [] })
    return { stoppedAll: true }
  }
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  await supervisor.stop(entry.id)
  syncPi({ instances: supervisor.list() })
  return { stoppedAll: false, entry }
}

export async function restartModel(idOrSlug: string): Promise<StartModelResult> {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const instance = await supervisor.restart(entry)
  syncPi({ activeDefault: instance, instances: supervisor.list() })
  return { entry, instance }
}

export function setPublished(idOrSlug: string, publish: boolean): ModelEntry {
  const entry = setModelPublish(idOrSlug, publish)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  syncPi({ instances: supervisor.list() })
  return entry
}

export function setFlavor(idOrSlug: string, mlxFlavor: ModelEntry["mlxFlavor"]): ModelEntry {
  const entry = setModelFlavor(idOrSlug, mlxFlavor)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  syncPi({ instances: supervisor.list() })
  return entry
}

export function setPreset(idOrSlug: string, preset: ModelEntry["preset"]): ModelEntry {
  const entry = setModelPreset(idOrSlug, preset)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  syncPi({ instances: supervisor.list() })
  return entry
}

export function removeModelEntry(idOrSlug: string): void {
  if (!removeModel(idOrSlug)) throw new Error(`unknown model: ${idOrSlug}`)
  syncPi({ instances: supervisor.list() })
}

// Escape hatch for callers that need a direct re-emit without another
// state mutation (for example after config changes that affect pi sync
// shape). Prefer the higher-level operations above for normal flows.
export function syncPiNow(activeDefault?: ActiveInstance): void {
  syncPi({ activeDefault, instances: supervisor.list() })
}
