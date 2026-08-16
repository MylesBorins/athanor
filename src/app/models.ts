import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import type { ActiveInstance, ModelEntry } from "../types/index.js"
import { ingestDiscovered, type IngestReport } from "../discovery/ingest.js"
import { pull, type PullOptions, type PullResult } from "../pull/hf.js"
import {
  getModel,
  removeModel,
  setModelFlavor,
  setModelFormula,
  setModelPreset,
  setModelPublish
} from "../registry/index.js"
import { loadConfig } from "../config/index.js"
import { supervisor } from "../supervisor/index.js"
import { syncPi } from "../sync/pi.js"
import { ensureIngress, reconcileIngressForCurrentState, stopIngressIfIdle } from "../router/lifecycle.js"
import { stopRouter } from "../router/server.js"
import { detectMachineProfile } from "../machine/profile.js"
import { buildStartPreflight, type StartPreflight } from "./preflight.js"

export interface StartModelResult {
  entry: ModelEntry
  instance?: ActiveInstance
  preflight?: StartPreflight
  warned?: boolean
}

export interface StopModelResult {
  stoppedAll: boolean
  entry?: ModelEntry
  stopped: boolean
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
export async function startModel(idOrSlug: string, opts?: { confirm?: boolean }): Promise<StartModelResult> {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const preflight = buildStartPreflight(entry, detectMachineProfile())
  if ((preflight.shouldWarn || preflight.shouldStrongWarn) && !opts?.confirm) {
    return { entry, preflight, warned: true }
  }
  const instance = await supervisor.start(entry)
  await ensureIngress()
  syncPi({ activeDefault: instance, instances: supervisor.list() })
  return { entry, instance, preflight }
}

export async function stopModel(idOrSlug?: string, opts?: { drain?: boolean }): Promise<StopModelResult> {
  if (!idOrSlug || idOrSlug === "--all") {
    // Stopping all instances does not change publish state. Re-sync pi
    // with an empty running set, but leave provider emission driven by
    // the registry's persistent `publish` flags.
    const stopped = await supervisor.stopAll(opts)
    await stopIngressIfIdle(stopRouter)
    syncPi({ instances: [] })
    return { stoppedAll: true, stopped }
  }
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const stopped = await supervisor.stop(entry.id, opts)
  await stopIngressIfIdle(stopRouter)
  syncPi({ instances: supervisor.list() })
  return { stoppedAll: false, entry, stopped }
}

export async function restartModel(idOrSlug: string, opts?: { confirm?: boolean }): Promise<StartModelResult> {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const preflight = buildStartPreflight(entry, detectMachineProfile())
  if ((preflight.shouldWarn || preflight.shouldStrongWarn) && !opts?.confirm) {
    return { entry, preflight, warned: true }
  }
  const instance = await supervisor.restart(entry)
  await ensureIngress()
  syncPi({ activeDefault: instance, instances: supervisor.list() })
  return { entry, instance, preflight }
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

export function setFormula(idOrSlug: string, formula: ModelEntry["formula"]): ModelEntry {
  const entry = setModelFormula(idOrSlug, formula)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  syncPi({ instances: supervisor.list() })
  return entry
}

export const setPreset = setFormula

function realpathIfExists(p: string): string | null {
  try { return fs.realpathSync(p) } catch { return null }
}

function isInside(parent: string, child: string): boolean {
  const realParent = realpathIfExists(parent) ?? path.resolve(parent)
  const realChild = realpathIfExists(child) ?? path.resolve(child)
  const rel = path.relative(realParent, realChild)
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
}

function removePathRecursive(target: string): void {
  fs.rmSync(target, { recursive: true, force: true })
}

function removeHfSnapshotFromEntry(entry: ModelEntry): boolean {
  const targetPath = entry.path
  if (!fs.existsSync(targetPath)) return false

  const config = loadConfig()
  const hubRoot = path.join(os.homedir(), ".cache", "huggingface", "hub")
  const configuredRoot = realpathIfExists(config.modelDirs.mlx.replace(/^~/, os.homedir()))
  const resolvedHubRoot = configuredRoot ?? realpathIfExists(hubRoot) ?? hubRoot
  const resolvedTarget = realpathIfExists(targetPath) ?? targetPath

  if (entry.runtime === "mlx") {
    if (!isInside(resolvedHubRoot, resolvedTarget) && !isInside(resolvedHubRoot, targetPath)) {
      throw new Error(`refusing to remove snapshot outside HF cache: ${targetPath}`)
    }
    // If target is inside a models--org--repo directory, remove the entire model directory
    const parsed = path.resolve(targetPath)
    const parts = parsed.split(path.sep)
    const modelDirIdx = parts.findIndex(p => p.startsWith("models--"))
    if (modelDirIdx >= 0) {
      const modelRepoDir = parts.slice(0, modelDirIdx + 1).join(path.sep)
      if (isInside(resolvedHubRoot, modelRepoDir) || path.resolve(resolvedHubRoot) === path.dirname(modelRepoDir)) {
        removePathRecursive(modelRepoDir)
        return true
      }
    }
    removePathRecursive(resolvedTarget)
    return true
  }

  if (entry.source.type === "hf" && entry.source.file) {
    // Single-file GGUF in HF cache: remove the underlying blob and the snapshot file
    if (resolvedTarget && resolvedTarget !== targetPath && fs.existsSync(resolvedTarget)) {
      removePathRecursive(resolvedTarget)
    }
    if (fs.existsSync(targetPath)) {
      removePathRecursive(targetPath)
    }
    try {
      const snapshotDir = path.dirname(targetPath)
      if (fs.existsSync(snapshotDir) && fs.readdirSync(snapshotDir).length === 0) {
        fs.rmdirSync(snapshotDir)
      }
    } catch {
      // ignore rmdir cleanup errors
    }
    return true
  }

  return false
}

function removeLocalModelPath(entry: ModelEntry): boolean {
  const target = realpathIfExists(entry.path) ?? entry.path
  if (!fs.existsSync(target)) return false
  removePathRecursive(target)
  return true
}

export function deleteModelFromDisk(idOrSlug: string): ModelEntry {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)

  const running = supervisor.list().some(i => i.id === entry.id || i.slug === entry.slug)
  if (running) {
    throw new Error(`cannot delete model "${entry.slug}" while it is running; stop it first with 'athanor stop ${entry.slug}'`)
  }

  const removedPath = entry.source.type === "local"
    ? removeLocalModelPath(entry)
    : removeHfSnapshotFromEntry(entry)

  if (!removedPath) {
    throw new Error(`could not remove files from disk for ${entry.slug}; registry entry left intact`)
  }

  if (!removeModel(entry.id)) throw new Error(`unknown model: ${entry.id}`)
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
export async function syncPiNow(activeDefault?: ActiveInstance): Promise<void> {
  await reconcileIngressForCurrentState()
  syncPi({ activeDefault, instances: supervisor.list() })
}
