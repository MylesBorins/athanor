import * as fs from "fs"
import type { ActiveInstance } from "../types/index.js"
import { PATHS, ensureBaseDirs } from "../config/index.js"

function atomicWrite(filepath: string, data: string): void {
  const tmp = filepath + ".tmp"
  fs.writeFileSync(tmp, data, "utf8")
  fs.renameSync(tmp, filepath)
}

export function loadPersistedInstances(): ActiveInstance[] {
  try {
    if (!fs.existsSync(PATHS.state)) return []
    const raw = JSON.parse(fs.readFileSync(PATHS.state, "utf8"))
    if (!Array.isArray(raw?.instances)) return []
    return raw.instances as ActiveInstance[]
  } catch {
    return []
  }
}

export function savePersistedInstances(instances: ActiveInstance[]): void {
  ensureBaseDirs()
  atomicWrite(
    PATHS.state,
    JSON.stringify({ version: 1, instances }, null, 2)
  )
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
