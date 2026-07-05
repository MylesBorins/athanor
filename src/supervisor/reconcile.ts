import { execFile } from "child_process"
import { promisify } from "util"
import type { ActiveInstance, ModelEntry } from "../types/index.js"
import { probeHealth, probeRuntimeModelId } from "../adapters/health.js"

const execFileAsync = promisify(execFile)

async function pidForPort(port: number): Promise<number> {
  // Skip in test environments — lsof can crash vitest workers
  if (process.env["VITEST"]) return -1
  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${port}`], { timeout: 1000 })
    const pid = parseInt(stdout.trim().split("\n")[0] ?? "", 10)
    return Number.isFinite(pid) && pid > 0 ? pid : -1
  } catch {
    return -1
  }
}

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
      pid: await pidForPort(entry.port),
      startedAt: Date.now(),
      status: "running",
      logFile: ""
    })
    trackedIds.add(entry.id)
  }

  return recovered
}
