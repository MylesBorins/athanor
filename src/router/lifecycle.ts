import { spawn } from "child_process"
import { loadConfig } from "../config/index.js"
import { supervisor } from "../supervisor/index.js"
import { listModels } from "../registry/index.js"
import { recoverLiveInstances } from "../supervisor/reconcile.js"
import {
  clearPersistedRouter,
  getPersistedRouter,
  pidAlive,
  savePersistedRouter,
  type PersistedRouter
} from "../supervisor/state.js"

function shouldManageIngress(): boolean {
  return loadConfig().router.enabled
}

function currentRouterProcess(): PersistedRouter | undefined {
  const persisted = getPersistedRouter()
  if (!persisted) return undefined
  if (!pidAlive(persisted.pid)) {
    clearPersistedRouter()
    return undefined
  }
  return persisted
}

function currentEntrypoint(): { cmd: string; args: string[] } {
  const script = process.argv[1]
  if (!script) throw new Error("cannot determine current athanor entrypoint")
  return {
    cmd: process.execPath,
    args: [...process.execArgv, script, "__router_service"]
  }
}

export function ensureIngress(): PersistedRouter | undefined {
  if (!shouldManageIngress()) return undefined

  const existing = currentRouterProcess()
  if (existing) return existing

  const { cmd, args } = currentEntrypoint()
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ATHANOR_ROUTER_SERVICE: "1" }
  })
  if (!child.pid) throw new Error("failed to start detached router service")
  child.unref()

  const router = {
    pid: child.pid,
    host: loadConfig().router.host,
    port: loadConfig().router.port,
    startedAt: Date.now()
  }
  savePersistedRouter(router)
  return router
}

export async function stopIngressIfIdle(stopInProcess: () => Promise<void>): Promise<void> {
  if (!shouldManageIngress()) return
  const recovered = await recoverLiveInstances(listModels(), supervisor.list())
  if (recovered.length > 0) return

  const persisted = currentRouterProcess()
  if (!persisted) {
    await stopInProcess()
    return
  }

  try { process.kill(persisted.pid, "SIGTERM") } catch { /* already gone */ }
  clearPersistedRouter()
}

export function reconcileIngressForCurrentState(): void {
  if (!shouldManageIngress()) {
    clearPersistedRouter()
    return
  }
  // Ingress is part of normal athanor operation: keep it available
  // while the app is active, and leave the detached companion running
  // across UI exits when models remain active.
  ensureIngress()
  if (getPersistedRouter() && !currentRouterProcess()) clearPersistedRouter()
}
