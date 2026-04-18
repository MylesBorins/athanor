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
import { updateModel } from "../registry/index.js"
import { awaitIdle } from "./inflight.js"

export class Supervisor {
  private instances = new Map<string, ActiveInstance>()

  constructor() {
    this.reattach()
  }

  private reattach(): void {
    const persisted = loadPersistedInstances()
    for (const inst of persisted) {
      if (pidAlive(inst.pid)) {
        this.instances.set(inst.id, { ...inst, status: "running" })
      }
    }
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

    const { cmd, args } = buildCommandFor(entry)
    const stdoutLog = openLogFile(entry.slug, process.pid)
    try {
      const proc = spawn(cmd, args, {
        detached: true,
        stdio: ["ignore", stdoutLog.fd, stdoutLog.fd]
      })
      fs.closeSync(stdoutLog.fd)
      if (!proc.pid) {
        throw new Error(`Failed to spawn ${cmd}`)
      }
      proc.unref()

      const instance: ActiveInstance = {
        id: entry.id,
        slug: entry.slug,
        runtime: entry.runtime,
        port: entry.port,
        pid: proc.pid,
        startedAt: Date.now(),
        status: "starting",
        logFile: logFilePath(entry.slug, proc.pid)
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
        this.persist()
        updateModel(entry.id, { lastUsedAt: Date.now() })
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

  async stop(id: string): Promise<void> {
    const inst = this.instances.get(id)
    if (!inst) return
    // Wait briefly for any router-proxied streams targeting this model
    // to finish, so SSE clients aren't cut mid-token. Bounded by
    // config.router.drainTimeoutMs (0 disables). No-op when the router
    // is idle or not running.
    const cfg = loadConfig()
    if (cfg.router.drainTimeoutMs > 0) await awaitIdle(id, cfg.router.drainTimeoutMs)
    await this.killPid(inst.pid)
    this.instances.delete(id)
    this.persist()
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.instances.keys()]) await this.stop(id)
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
