import * as http from "http"
import type { AddressInfo } from "net"
import { describe, it, expect, vi, afterEach } from "vitest"

async function startUpstream(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ data: [{ id: "mlx-community/A" }] }))
      return
    }
    if (req.url === "/v1/chat/completions") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
  }
}

describe("startRouter", () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock("../config/index.js")
    vi.doUnmock("../registry/index.js")
    vi.doUnmock("../supervisor/index.js")
  })

  it("is a no-op when router.enabled is false", async () => {
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
    await stopRouter()
  })

  it("reconciles a live target before rejecting the request", async () => {
    const upstream = await startUpstream()
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
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [{
        id: "mlx-community/A",
        slug: "a",
        path: "/cache/a",
        runtime: "mlx",
        source: { type: "hf", repo: "mlx-community/A" },
        port: upstream.port,
        publish: true,
        addedAt: 0
      }]
    }))
    const start = vi.fn(async () => {
      throw new Error("should not start when a live target is already serving")
    })
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: {
        get: () => undefined,
        list: () => [],
        start,
        stop: vi.fn(),
        stopAll: vi.fn(),
        restart: vi.fn()
      }
    }))

    const { startRouter, stopRouter } = await import("./server.js")
    const server = startRouter()
    await new Promise<void>(resolve => server!.once("listening", () => resolve()))
    const address = server!.address() as AddressInfo
    const res = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mlx-community/A", messages: [{ role: "user", content: "hi" }] })
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(start).not.toHaveBeenCalled()
    await stopRouter()
    await upstream.close()
  })
})
