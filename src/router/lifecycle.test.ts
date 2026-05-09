import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("router lifecycle", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock("../config/index.js")
    vi.doUnmock("../supervisor/index.js")
    vi.doUnmock("../supervisor/state.js")
    vi.doUnmock("child_process")
    vi.restoreAllMocks()
  })

  it("starts a detached router companion when router mode is enabled and models are active", async () => {
    const savePersistedRouter = vi.fn()
    vi.doMock("../config/index.js", async () => ({
      DEFAULT_CONFIG: {},
      loadConfig: () => ({ router: { enabled: true, host: "127.0.0.1", port: 8080 } })
    }))
    vi.doMock("../supervisor/index.js", async () => ({
      supervisor: { list: () => [{ id: "a" }] }
    }))
    vi.doMock("../supervisor/state.js", async () => ({
      getPersistedRouter: () => undefined,
      pidAlive: () => false,
      clearPersistedRouter: vi.fn(),
      savePersistedRouter
    }))
    vi.doMock("child_process", async () => ({
      spawn: vi.fn(() => ({ pid: 4321, unref: vi.fn() }))
    }))

    const { ensureRouterForActiveModels } = await import("./lifecycle.js")
    const router = ensureRouterForActiveModels()
    expect(router?.pid).toBe(4321)
    expect(savePersistedRouter).toHaveBeenCalledWith(expect.objectContaining({ pid: 4321, port: 8080 }))
  })

  it("does nothing when no models are active", async () => {
    const savePersistedRouter = vi.fn()
    vi.doMock("../config/index.js", async () => ({
      DEFAULT_CONFIG: {},
      loadConfig: () => ({ router: { enabled: true, host: "127.0.0.1", port: 8080 } })
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
    vi.doMock("child_process", async () => ({
      spawn: vi.fn(() => ({ pid: 4321, unref: vi.fn() }))
    }))

    const { ensureRouterForActiveModels } = await import("./lifecycle.js")
    expect(ensureRouterForActiveModels()).toBeUndefined()
    expect(savePersistedRouter).not.toHaveBeenCalled()
  })

  it("reuses an already-running persisted router instead of spawning another", async () => {
    const spawn = vi.fn()
    vi.doMock("../config/index.js", async () => ({
      DEFAULT_CONFIG: {},
      loadConfig: () => ({ router: { enabled: true, host: "127.0.0.1", port: 8080 } })
    }))
    vi.doMock("../supervisor/index.js", async () => ({
      supervisor: { list: () => [{ id: "a" }] }
    }))
    vi.doMock("../supervisor/state.js", async () => ({
      getPersistedRouter: () => ({ pid: 777, host: "127.0.0.1", port: 8080, startedAt: 1 }),
      pidAlive: () => true,
      clearPersistedRouter: vi.fn(),
      savePersistedRouter: vi.fn()
    }))
    vi.doMock("child_process", async () => ({ spawn }))

    const { ensureRouterForActiveModels } = await import("./lifecycle.js")
    expect(ensureRouterForActiveModels()).toEqual({ pid: 777, host: "127.0.0.1", port: 8080, startedAt: 1 })
    expect(spawn).not.toHaveBeenCalled()
  })

  it("stops the router when the last model has stopped", async () => {
    const stopInProcess = vi.fn(async () => {})
    const clearPersistedRouter = vi.fn()
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true as never)
    vi.doMock("../config/index.js", async () => ({
      DEFAULT_CONFIG: {},
      loadConfig: () => ({ router: { enabled: true, host: "127.0.0.1", port: 8080 } })
    }))
    vi.doMock("../supervisor/index.js", async () => ({
      supervisor: { list: () => [] }
    }))
    vi.doMock("../supervisor/state.js", async () => ({
      getPersistedRouter: () => ({ pid: 555, host: "127.0.0.1", port: 8080, startedAt: 1 }),
      pidAlive: () => true,
      clearPersistedRouter,
      savePersistedRouter: vi.fn()
    }))

    const { stopRouterIfIdle } = await import("./lifecycle.js")
    await stopRouterIfIdle(stopInProcess)
    expect(kill).toHaveBeenCalledWith(555, "SIGTERM")
    expect(clearPersistedRouter).toHaveBeenCalled()
    expect(stopInProcess).not.toHaveBeenCalled()
  })

  it("clears stale router state during reconciliation", async () => {
    const clearPersistedRouter = vi.fn()
    vi.doMock("../config/index.js", async () => ({
      DEFAULT_CONFIG: {},
      loadConfig: () => ({ router: { enabled: true, host: "127.0.0.1", port: 8080 } })
    }))
    vi.doMock("../supervisor/index.js", async () => ({
      supervisor: { list: () => [] }
    }))
    vi.doMock("../supervisor/state.js", async () => ({
      getPersistedRouter: () => ({ pid: 555, host: "127.0.0.1", port: 8080, startedAt: 1 }),
      pidAlive: () => false,
      clearPersistedRouter,
      savePersistedRouter: vi.fn()
    }))
    vi.doMock("child_process", async () => ({
      spawn: vi.fn(() => ({ pid: 4321, unref: vi.fn() }))
    }))

    const { reconcileRouterForCurrentState } = await import("./lifecycle.js")
    reconcileRouterForCurrentState()
    expect(clearPersistedRouter).toHaveBeenCalled()
  })
})
