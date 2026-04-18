import { describe, it, expect, vi, afterEach } from "vitest"

describe("startRouter", () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock("../config/index.js")
  })

  it("is a no-op when router.enabled is false (default)", async () => {
    vi.doMock("../config/index.js", async () => {
      const real: any = await vi.importActual("../config/index.js")
      return {
        ...real,
        loadConfig: () => ({
          ...real.DEFAULT_CONFIG,
          router: { enabled: false, host: "127.0.0.1", port: 0 }
        })
      }
    })
    const { startRouter } = await import("./server.js")
    expect(startRouter()).toBeNull()
  })

  it("starts a server when enabled and stops cleanly", async () => {
    // Bind to ephemeral port 0 so the test does not collide with a
    // locally-running athanor. stopRouter() resolves only after the
    // server's close callback fires, so if this test hangs the close
    // path is broken.
    vi.doMock("../config/index.js", async () => {
      const real: any = await vi.importActual("../config/index.js")
      return {
        ...real,
        loadConfig: () => ({
          ...real.DEFAULT_CONFIG,
          router: { enabled: true, host: "127.0.0.1", port: 0 }
        })
      }
    })
    const { startRouter, stopRouter } = await import("./server.js")
    const server = startRouter()
    expect(server).not.toBeNull()
    await new Promise<void>(resolve => server!.once("listening", () => resolve()))
    await stopRouter()
    // Second stop must be a no-op, not throw.
    await stopRouter()
  })
})
