import { spawn } from "child_process"
import * as fs from "fs"
import type { ActiveInstance, ModelEntry } from "../types/index.js"
import { buildCommandFor, getAdapter } from "../adapters/index.js"
import { waitForHealthy, probeHealth } from "../adapters/health.js"
import { loadConfig } from "../config/index.js"
import { openLogFile, logFilePath } from "./logs.js"
import { decide } from "./policies.js"
import {
  loadPersistedInstances,
  pidAlive,
  savePersistedInstances
} from "./state.js"
import { listModels, touchModelLastUsed } from "../registry/index.js"
import { awaitIdle } from "./inflight.js"
import { recoverLiveInstances } from "./reconcile.js"

export class Supervisor {
  private instances = new Map<string, ActiveInstance>()

  constructor() {
    this.reattach()
  }

  private reattach(): void {
    const persisted = loadPersistedInstances()
    for (const inst of persisted) {
      if (inst.pid > 0 && pidAlive(inst.pid)) {
        this.instances.set(inst.id, { ...inst, status: "running" })
      }
    }
    void recoverLiveInstances(listModels(), [...this.instances.values()]).then(recovered => {
      this.instances = new Map(recovered.map(inst => [inst.id, inst]))
      this.persist()
    })
    this.persist()
  }

  private persist(): void {
    savePersistedInstances([...this.instances.values()])
  }

  list(): ActiveInstance[] {
    return [...this.instances.values()]
  }

  get(id: string): ActiveInstance | undefined {
    return this.instances.get(id)
  }

  async start(entry: ModelEntry): Promise<ActiveInstance> {
    const existing = this.instances.get(entry.id)
    if (existing && pidAlive(existing.pid)) return existing

    const cfg = loadConfig()
    const { stopBeforeStart } = decide(
      cfg.supervisor.policy,
      cfg.supervisor.maxConcurrent,
      this.list(),
      entry
    )
    for (const id of stopBeforeStart) await this.stop(id)

    if (await probeHealth(entry.runtime, entry.port, 500)) {
      throw new Error(
        `Port ${entry.port} already in use by another process; stop it or reassign the model's port.`
      )
    }

    const { cmd, args, env: adapterEnv } = buildCommandFor(entry)
    const stdoutLog = openLogFile(entry.slug, process.pid)
    try {
      const proc = spawn(cmd, args, {
        detached: true,
        stdio: ["ignore", stdoutLog.fd, stdoutLog.fd],
        // Adapter env is layered onto the parent env so runtime-specific
        // switches (HF_HUB_OFFLINE for MLX, etc.) take effect without
        // dropping PATH or other inherited vars the binaries need.
        env: adapterEnv ? { ...process.env, ...adapterEnv } : process.env
      })
      fs.closeSync(stdoutLog.fd)
      if (!proc.pid) {
        throw new Error(`Failed to spawn ${cmd}`)
      }
      proc.unref()

      const now = Date.now()
      const instance: ActiveInstance = {
        id: entry.id,
        slug: entry.slug,
        runtime: entry.runtime,
        port: entry.port,
        pid: proc.pid,
        startedAt: now,
        status: "starting",
        logFile: logFilePath(entry.slug, proc.pid),
        spawnStartedAt: now,
        spawnedAt: now
      }
      try {
        fs.renameSync(stdoutLog.path, instance.logFile)
      } catch {
        instance.logFile = stdoutLog.path
      }
      this.instances.set(entry.id, instance)
      this.persist()

      try {
        await waitForHealthy(entry.runtime, entry.port, {
          timeoutMs: cfg.supervisor.startupTimeoutMs,
          intervalMs: cfg.supervisor.healthPollIntervalMs
        })
        instance.status = "running"
        instance.healthyAt = Date.now()
        this.persist()
        touchModelLastUsed(entry.id, Date.now())
        return instance
      } catch (err) {
        instance.status = "error"
        instance.exitReason = String(err)
        this.persist()
        await this.killPid(proc.pid)
        throw err
      }
    } catch (err) {
      try { fs.closeSync(stdoutLog.fd) } catch { /* already closed */ }
      throw err
    }
  }

  async stop(id: string): Promise<boolean> {
    const inst = this.instances.get(id)
    if (!inst) return false
    // Wait briefly for any router-proxied streams targeting this model
    // to finish, so SSE clients aren't cut mid-token. Bounded by
    // config.router.drainTimeoutMs (0 disables). No-op when the router
    // is idle or not running.
    const cfg = loadConfig()
    if (cfg.router.drainTimeoutMs > 0) await awaitIdle(id, cfg.router.drainTimeoutMs)
    await this.killPid(inst.pid)
    this.instances.delete(id)
    this.persist()
    return true
  }

  async stopAll(): Promise<boolean> {
    const ids = [...this.instances.keys()]
    if (ids.length === 0) return false
    for (const id of ids) await this.stop(id)
    return true
  }

  async restart(entry: ModelEntry): Promise<ActiveInstance> {
    await this.stop(entry.id)
    return this.start(entry)
  }

  private async killPid(pid: number, timeoutMs = 5000): Promise<void> {
    if (!pidAlive(pid)) return
    try { process.kill(pid, "SIGTERM") } catch { /* already gone */ }
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100))
      if (!pidAlive(pid)) return
    }
    try { process.kill(pid, "SIGKILL") } catch { /* raced with exit */ }
  }
}

export const supervisor = new Supervisor()

export { getAdapter }
