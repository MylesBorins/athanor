import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("ingress lifecycle", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })))
  })

  afterEach(() => {
    vi.doUnmock("../config/index.js")
    vi.doUnmock("../supervisor/index.js")
    vi.doUnmock("../supervisor/state.js")
    vi.doUnmock("child_process")
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("starts a detached ingress companion when ingress management is enabled", async () => {
    const savePersistedRouter = vi.fn()
    vi.doMock("../config/index.js", async () => ({
      DEFAULT_CONFIG: {},
      loadConfig: () => ({ router: { enabled: true, host: "127.0.0.1", port: 40879 } })
    }))
    vi.doMock("../supervisor/index.js", async () => ({
      supervisor: { list: () => [] }
    }))
    vi.doMock("../supervisor/state.js", async () => ({
      getPersistedRouter: () => undefined,
      pidAlive: () => false,
      clearPersistedRouter: vi.fn(),
      savePersistedRouter
    }))
    vi.doMock("child_process", async (importOriginal) => ({ ...await importOriginal() as object,
      spawn: vi.fn(() => ({ pid: 4321, unref: vi.fn() }))
    }))

    const { ensureIngress } = await import("./lifecycle.js")
    const router = await ensureIngress()
    expect(router?.pid).toBe(4321)
    expect(savePersistedRouter).toHaveBeenCalledWith(expect.objectContaining({ pid: 4321, port: 40879 }))
  })

  it("does nothing when ingress management is disabled", async () => {
    const savePersistedRouter = vi.fn()
    vi.doMock("../config/index.js", async () => ({
      DEFAULT_CONFIG: {},
      loadConfig: () => ({ router: { enabled: false, host: "127.0.0.1", port: 40879 } })
    }))
    vi.doMock("../supervisor/index.js", async () => ({
      supervisor: { list: () => [] }
    }))
    vi.doMock("../supervisor/state.js", async () => ({
      getPersistedRouter: () => undefined,
      pidAlive: () => false,
      clearPersistedRouter: vi.fn(),
      savePersistedRouter
    }))
    vi.doMock("child_process", async (importOriginal) => ({ ...await importOriginal() as object,
      spawn: vi.fn(() => ({ pid: 4321, unref: vi.fn() }))
    }))

    const { ensureIngress } = await import("./lifecycle.js")
    await expect(ensureIngress()).resolves.toBeUndefined()
    expect(savePersistedRouter).not.toHaveBeenCalled()
  })

  it("reuses an already-running persisted ingress instead of spawning another", async () => {
    const spawn = vi.fn()
    vi.doMock("../config/index.js", async () => ({
      DEFAULT_CONFIG: {},
      loadConfig: () => ({ router: { enabled: true, host: "127.0.0.1", port: 40879 } })
    }))
    vi.doMock("../supervisor/index.js", async () => ({
      supervisor: { list: () => [] }
    }))
    vi.doMock("../supervisor/state.js", async () => ({
      getPersistedRouter: () => ({ pid: 777, host: "127.0.0.1", port: 40879, startedAt: 1 }),
      pidAlive: () => true,
      clearPersistedRouter: vi.fn(),
      savePersistedRouter: vi.fn()
    }))
    vi.doMock("child_process", async (importOriginal) => ({ ...await importOriginal() as object, spawn }))

    const { ensureIngress } = await import("./lifecycle.js")
    await expect(ensureIngress()).resolves.toEqual({ pid: 777, host: "127.0.0.1", port: 40879, startedAt: 1 })
    expect(spawn).not.toHaveBeenCalled()
  })

  it("respawns when persisted router pid is live but the health endpoint is not", async () => {
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchMock)
    const spawn = vi.fn(() => ({ pid: 4321, unref: vi.fn() }))
    const clearPersistedRouter = vi.fn()
    const savePersistedRouter = vi.fn()
    vi.doMock("../config/index.js", async () => ({
      DEFAULT_CONFIG: {},
      loadConfig: () => ({ router: { enabled: true, host: "127.0.0.1", port: 40879 } })
    }))
    vi.doMock("../supervisor/index.js", async () => ({
      supervisor: { list: () => [] }
    }))
    vi.doMock("../supervisor/state.js", async () => ({
      getPersistedRouter: () => ({ pid: 777, host: "127.0.0.1", port: 40879, startedAt: 1 }),
      pidAlive: () => true,
      clearPersistedRouter,
      savePersistedRouter
    }))
    vi.doMock("child_process", async (importOriginal) => ({ ...await importOriginal() as object, spawn }))

    const { ensureIngress } = await import("./lifecycle.js")
    await expect(ensureIngress()).resolves.toEqual(expect.objectContaining({ pid: 4321, port: 40879 }))
    expect(clearPersistedRouter).toHaveBeenCalled()
    expect(spawn).toHaveBeenCalled()
    expect(savePersistedRouter).toHaveBeenCalledWith(expect.objectContaining({ pid: 4321, port: 40879 }))
  })

  it("stops the ingress when the last model has stopped", async () => {
    const stopInProcess = vi.fn(async () => {})
    const clearPersistedRouter = vi.fn()
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true as never)
    vi.doMock("../config/index.js", async () => ({
      DEFAULT_CONFIG: {},
      loadConfig: () => ({ router: { enabled: true, host: "127.0.0.1", port: 40879 } })
    }))
    vi.doMock("../supervisor/index.js", async () => ({
      supervisor: { list: () => [] }
    }))
    vi.doMock("../registry/index.js", async () => ({
      listModels: () => []
    }))
    vi.doMock("../supervisor/reconcile.js", async () => ({
      recoverLiveInstances: async () => []
    }))
    vi.doMock("../supervisor/state.js", async () => ({
      getPersistedRouter: () => ({ pid: 555, host: "127.0.0.1", port: 40879, startedAt: 1 }),
      pidAlive: () => true,
      clearPersistedRouter,
      savePersistedRouter: vi.fn()
    }))

    const { stopIngressIfIdle } = await import("./lifecycle.js")
    await stopIngressIfIdle(stopInProcess)
    expect(kill).toHaveBeenCalledWith(555, "SIGTERM")
    expect(clearPersistedRouter).toHaveBeenCalled()
    expect(stopInProcess).not.toHaveBeenCalled()
  })

  it("does not stop ingress when reconciliation finds a live model", async () => {
    const stopInProcess = vi.fn(async () => {})
    const clearPersistedRouter = vi.fn()
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true as never)
    vi.doMock("../config/index.js", async () => ({
      DEFAULT_CONFIG: {},
      loadConfig: () => ({ router: { enabled: true, host: "127.0.0.1", port: 40879 } })
    }))
    vi.doMock("../supervisor/index.js", async () => ({
      supervisor: { list: () => [] }
    }))
    vi.doMock("../registry/index.js", async () => ({
      listModels: () => [{ id: "a" }]
    }))
    vi.doMock("../supervisor/reconcile.js", async () => ({
      recoverLiveInstances: async () => [{ id: "a" }]
    }))
    vi.doMock("../supervisor/state.js", async () => ({
      getPersistedRouter: () => ({ pid: 555, host: "127.0.0.1", port: 40879, startedAt: 1 }),
      pidAlive: () => true,
      clearPersistedRouter,
      savePersistedRouter: vi.fn()
    }))

    const { stopIngressIfIdle } = await import("./lifecycle.js")
    await stopIngressIfIdle(stopInProcess)
    expect(kill).not.toHaveBeenCalled()
    expect(clearPersistedRouter).not.toHaveBeenCalled()
    expect(stopInProcess).not.toHaveBeenCalled()
  })

  it("does not let stale in-memory supervisor entries suppress idle ingress shutdown", async () => {
    const stopInProcess = vi.fn(async () => {})
    const clearPersistedRouter = vi.fn()
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true as never)
    vi.doMock("../config/index.js", async () => ({
      DEFAULT_CONFIG: {},
      loadConfig: () => ({ router: { enabled: true, host: "127.0.0.1", port: 40879 } })
    }))
    vi.doMock("../registry/index.js", async () => ({
      listModels: () => []
    }))
    vi.doMock("../supervisor/reconcile.js", async () => ({
      recoverLiveInstances: async (_entries: unknown[], persisted: unknown[]) => {
        expect(persisted).toEqual([])
        return []
      }
    }))
    vi.doMock("../supervisor/state.js", async () => ({
      getPersistedRouter: () => ({ pid: 555, host: "127.0.0.1", port: 40879, startedAt: 1 }),
      pidAlive: () => true,
      clearPersistedRouter,
      savePersistedRouter: vi.fn()
    }))

    const { stopIngressIfIdle } = await import("./lifecycle.js")
    await stopIngressIfIdle(stopInProcess)
    expect(kill).toHaveBeenCalledWith(555, "SIGTERM")
    expect(clearPersistedRouter).toHaveBeenCalled()
    expect(stopInProcess).not.toHaveBeenCalled()
  })

  it("clears stale ingress state during reconciliation", async () => {
    const clearPersistedRouter = vi.fn()
    vi.doMock("../config/index.js", async () => ({
      DEFAULT_CONFIG: {},
      loadConfig: () => ({ router: { enabled: true, host: "127.0.0.1", port: 40879 } })
    }))
    vi.doMock("../supervisor/index.js", async () => ({
      supervisor: { list: () => [] }
    }))
    vi.doMock("../supervisor/state.js", async () => ({
      getPersistedRouter: () => ({ pid: 555, host: "127.0.0.1", port: 40879, startedAt: 1 }),
      pidAlive: () => false,
      clearPersistedRouter,
      savePersistedRouter: vi.fn()
    }))
    vi.doMock("child_process", async (importOriginal) => ({ ...await importOriginal() as object,
      spawn: vi.fn(() => ({ pid: 4321, unref: vi.fn() }))
    }))

    const { reconcileIngressForCurrentState } = await import("./lifecycle.js")
    await reconcileIngressForCurrentState()
    expect(clearPersistedRouter).toHaveBeenCalled()
  })

  it("stops a healthy detached router when router management is disabled", async () => {
    const clearPersistedRouter = vi.fn()
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true as never)
    vi.doMock("../config/index.js", async () => ({
      DEFAULT_CONFIG: {},
      loadConfig: () => ({ router: { enabled: false, host: "127.0.0.1", port: 40879 } })
    }))
    vi.doMock("../supervisor/index.js", async () => ({
      supervisor: { list: () => [] }
    }))
    vi.doMock("../supervisor/state.js", async () => ({
      getPersistedRouter: () => ({ pid: 555, host: "127.0.0.1", port: 40879, startedAt: 1 }),
      pidAlive: () => true,
      clearPersistedRouter,
      savePersistedRouter: vi.fn()
    }))

    const { reconcileIngressForCurrentState } = await import("./lifecycle.js")
    await reconcileIngressForCurrentState()
    expect(kill).toHaveBeenCalledWith(555, "SIGTERM")
    expect(clearPersistedRouter).toHaveBeenCalled()
  })
})
