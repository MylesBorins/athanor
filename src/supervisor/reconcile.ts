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

  const promises = entries.map(async (entry) => {
    if (trackedIds.has(entry.id)) return null
    if (!(await probeHealth(entry.runtime, entry.port, 400))) return null
    if (!(await probeRuntimeModelId(entry, 800))) return null
    const pid = await pidForPort(entry.port)
    return {
      id: entry.id,
      slug: entry.slug,
      runtime: entry.runtime,
      port: entry.port,
      pid,
      startedAt: Date.now(),
      status: "running" as const,
      logFile: ""
    }
  })

  const results = await Promise.all(promises)
  for (const res of results) {
    if (res && !trackedIds.has(res.id)) {
      recovered.push(res)
      trackedIds.add(res.id)
    }
  }

  return recovered
}
