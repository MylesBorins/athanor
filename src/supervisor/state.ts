import * as fs from "fs"
import type { ActiveInstance } from "../types/index.js"
import { PATHS, ensureBaseDirs } from "../config/index.js"

export interface PersistedRouter {
  pid: number
  host: string
  port: number
  startedAt: number
}

interface PersistedStateFile {
  version: 1
  instances?: ActiveInstance[]
  router?: PersistedRouter
}

function atomicWrite(filepath: string, data: string): void {
  const tmp = filepath + ".tmp"
  fs.writeFileSync(tmp, data, "utf8")
  fs.renameSync(tmp, filepath)
}

function loadState(): PersistedStateFile {
  try {
    if (!fs.existsSync(PATHS.state)) return { version: 1, instances: [] }
    const raw = JSON.parse(fs.readFileSync(PATHS.state, "utf8"))
    if (!raw || typeof raw !== "object") return { version: 1, instances: [] }
    return raw as PersistedStateFile
  } catch {
    return { version: 1, instances: [] }
  }
}

function saveState(next: PersistedStateFile): void {
  ensureBaseDirs()
  atomicWrite(PATHS.state, JSON.stringify(next, null, 2))
}

export function loadPersistedInstances(): ActiveInstance[] {
  const raw = loadState()
  return Array.isArray(raw.instances) ? raw.instances : []
}

export function getPersistedRouter(): PersistedRouter | undefined {
  const raw = loadState()
  return raw.router && typeof raw.router === "object" ? raw.router : undefined
}

export function savePersistedInstances(instances: ActiveInstance[]): void {
  const raw = loadState()
  saveState({ ...raw, version: 1, instances })
}

export function savePersistedRouter(router: PersistedRouter): void {
  const raw = loadState()
  saveState({ ...raw, version: 1, router })
}

export function clearPersistedRouter(): void {
  const raw = loadState()
  saveState({ ...raw, version: 1, router: undefined })
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
