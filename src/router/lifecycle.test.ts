import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

describe("router lifecycle", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock("../config/index.js")
    vi.doUnmock("../supervisor/index.js")
    vi.doUnmock("../supervisor/state.js")
    vi.doUnmock("child_process")
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
})
