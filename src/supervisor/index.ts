import { spawn } from "child_process"
import * as fs from "fs"
import type { ActiveInstance, ModelEntry } from "../types/index.js"
import { buildCommandFor, getAdapter } from "../adapters/index.js"
import { waitForHealthy, probeHealth, probeRuntimeModelId } from "../adapters/health.js"
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
  private readyPromise: Promise<void>
  private pendingStarts = new Map<string, Promise<ActiveInstance>>()
  private startAbortControllers = new Map<string, AbortController>()

  constructor() {
    this.readyPromise = this.reattach()
  }

  async ready(): Promise<void> {
    await this.readyPromise
  }

  private async reattach(): Promise<void> {
    const persisted = loadPersistedInstances()
    const entries = listModels()
    const validPersisted = await this.recoverPersistedInstances(entries, persisted)
    this.instances = new Map(validPersisted.map(inst => [inst.id, inst]))
    this.persist()
    const recovered = await recoverLiveInstances(entries, validPersisted)
    this.instances = new Map(recovered.map(inst => [inst.id, inst]))
    this.persist()
  }

  private unmanagedInstanceError(entry: Pick<ModelEntry, "slug" | "port">): Error {
    return new Error(
      `cannot manage ${entry.slug}: model is serving on :${entry.port} but athanor does not know its PID`
    )
  }

  private async ensureStartable(entry: ModelEntry): Promise<ActiveInstance | undefined> {
    const existing = this.instances.get(entry.id)
    if (!existing) return undefined
    if (pidAlive(existing.pid)) return existing
    if (await probeHealth(entry.runtime, entry.port, 400)) {
      throw this.unmanagedInstanceError(entry)
    }
    this.instances.delete(entry.id)
    this.persist()
  }

  private async recoverPersistedInstances(
    entries: ModelEntry[],
    persisted: ActiveInstance[]
  ): Promise<ActiveInstance[]> {
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    const recovered: ActiveInstance[] = []
    for (const inst of persisted) {
      if (!pidAlive(inst.pid)) continue
      const entry = byId.get(inst.id)
      if (!entry) continue
      if (!(await probeHealth(entry.runtime, entry.port, 400))) continue
      if (!(await probeRuntimeModelId(entry, 800))) continue
      recovered.push({ ...inst, status: "running" })
    }
    return recovered
  }

  private syncWithPersistedState(): void {
    const persisted = loadPersistedInstances()
    const persistedMap = new Map(persisted.map(inst => [inst.id, inst]))
    
    // Remove any memory instances that are no longer in persisted state
    for (const id of this.instances.keys()) {
      if (!persistedMap.has(id)) {
        this.instances.delete(id)
      }
    }
    
    // Add or update instances from persisted state
    for (const inst of persisted) {
      this.instances.set(inst.id, inst)
    }
  }

  private persist(): void {
    savePersistedInstances([...this.instances.values()])
  }

  list(): ActiveInstance[] {
    this.syncWithPersistedState()
    return [...this.instances.values()]
  }

  get(id: string): ActiveInstance | undefined {
    this.syncWithPersistedState()
    return this.instances.get(id)
  }

  async start(entry: ModelEntry): Promise<ActiveInstance> {
    await this.ready()
    this.syncWithPersistedState()
    const existing = await this.ensureStartable(entry)
    if (existing) return existing
    const pending = this.pendingStarts.get(entry.id)
    if (pending) return pending

    const controller = new AbortController()
    this.startAbortControllers.set(entry.id, controller)

    const run = this.startInternal(entry, controller.signal)
    this.pendingStarts.set(entry.id, run)
    try {
      return await run
    } finally {
      if (this.pendingStarts.get(entry.id) === run) {
        this.pendingStarts.delete(entry.id)
        this.startAbortControllers.delete(entry.id)
      }
    }
  }

  private async startInternal(entry: ModelEntry, abortSignal: AbortSignal): Promise<ActiveInstance> {
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

      let spawnError: Error | null = null
      proc.on("error", err => {
        spawnError = err
      })

      if (!proc.pid) {
        const detail = spawnError ? `: ${(spawnError as Error).message}` : ""
        throw new Error(`Failed to execute '${cmd}'${detail}`)
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

      const spawnPromise = new Promise<never>((_, reject) => {
        if (spawnError) {
          reject(new Error(`Failed to execute '${cmd}': ${(spawnError as Error).message}`))
        } else {
          proc.once("error", err => {
            reject(new Error(`Failed to execute '${cmd}': ${err.message}`))
          })
        }
      })

      try {
        await Promise.race([
          waitForHealthy(entry.runtime, entry.port, {
            timeoutMs: cfg.supervisor.startupTimeoutMs,
            intervalMs: cfg.supervisor.healthPollIntervalMs,
            abort: abortSignal
          }),
          spawnPromise
        ])
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

  async stop(id: string, opts?: { drain?: boolean }): Promise<boolean> {
    await this.ready()
    this.syncWithPersistedState()
    const abortCtrl = this.startAbortControllers.get(id)
    if (abortCtrl) {
      abortCtrl.abort()
    }
    const inst = this.instances.get(id)
    if (!inst) return false
    if (!pidAlive(inst.pid)) {
      if (await probeHealth(inst.runtime, inst.port, 400)) {
        // Port is still responding but we have no valid PID — athanor lost
        // track of the process (e.g. pid:-1 persisted after a crash). Evict
        // the entry so stop/restart can proceed; the orphaned process will
        // either exit on its own or the user can kill it manually.
        console.error(
          `warning: ${inst.slug} appears to be serving on :${inst.port} but athanor lost its PID — evicting from state`
        )
      }
      this.instances.delete(id)
      this.persist()
      return true
    }
    // Wait briefly for any router-proxied streams targeting this model
    // to finish, so SSE clients aren't cut mid-token. Bounded by
    // config.router.drainTimeoutMs (0 disables). No-op when the router
    // is idle or not running.
    const cfg = loadConfig()
    if (opts?.drain !== false && cfg.router.drainTimeoutMs > 0) {
      await awaitIdle(id, cfg.router.drainTimeoutMs)
    }
    await this.killPid(inst.pid)
    this.instances.delete(id)
    this.persist()
    return true
  }

  async stopAll(opts?: { drain?: boolean }): Promise<boolean> {
    await this.ready()
    const ids = [...this.instances.keys()]
    if (ids.length === 0) return false
    for (const id of ids) await this.stop(id, opts)
    return true
  }

  async restart(entry: ModelEntry): Promise<ActiveInstance> {
    await this.ready()
    await this.stop(entry.id)
    return this.start(entry)
  }

  private async killPid(pid: number, timeoutMs = 5000): Promise<void> {
    if (!Number.isInteger(pid) || pid <= 0) return
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
