import { spawn } from "child_process"
import { loadConfig } from "../config/index.js"
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

async function routerHealthy(host: string, port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}:${port}/health`)
    return res.ok
  } catch {
    return false
  }
}

async function currentRouterProcess(): Promise<PersistedRouter | undefined> {
  const persisted = getPersistedRouter()
  if (!persisted) return undefined
  if (!pidAlive(persisted.pid)) {
    clearPersistedRouter()
    return undefined
  }
  if (!(await routerHealthy(persisted.host, persisted.port))) {
    clearPersistedRouter()
    return undefined
  }
  return persisted
}

async function waitForRouterHealthy(host: string, port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await routerHealthy(host, port)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`router did not become healthy on http://${host}:${port} within ${timeoutMs}ms`)
}

function currentEntrypoint(): { cmd: string; args: string[] } {
  const script = process.argv[1]
  if (!script) throw new Error("cannot determine current athanor entrypoint")
  return {
    cmd: process.execPath,
    args: [...process.execArgv, script, "__router_service"]
  }
}

export async function ensureIngress(): Promise<PersistedRouter | undefined> {
  if (!shouldManageIngress()) return undefined

  const existing = await currentRouterProcess()
  if (existing) return existing

  const cfg = loadConfig().router
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
    host: cfg.host,
    port: cfg.port,
    startedAt: Date.now()
  }
  await waitForRouterHealthy(router.host, router.port)
  savePersistedRouter(router)
  return router
}

export async function stopIngressIfIdle(stopInProcess: () => Promise<void>): Promise<void> {
  if (!shouldManageIngress()) return
  if (process.env.ATHANOR_TUI_ACTIVE === "1") return
  const recovered = await recoverLiveInstances(listModels(), [])
  if (recovered.length > 0) return

  const persisted = await currentRouterProcess()
  if (!persisted) {
    await stopInProcess()
    return
  }

  try { process.kill(persisted.pid, "SIGTERM") } catch { /* already gone */ }
  clearPersistedRouter()
}

export async function reconcileIngressForCurrentState(): Promise<void> {
  const persisted = getPersistedRouter()
  if (!shouldManageIngress()) {
    if (persisted && pidAlive(persisted.pid) && await routerHealthy(persisted.host, persisted.port)) {
      try { process.kill(persisted.pid, "SIGTERM") } catch { /* already gone */ }
    }
    clearPersistedRouter()
    return
  }
  // Ingress is part of normal athanor operation: keep it available
  // while the app is active, and leave the detached companion running
  // across UI exits when models remain active.
  await ensureIngress()
  if (persisted && !(await currentRouterProcess())) clearPersistedRouter()
}
