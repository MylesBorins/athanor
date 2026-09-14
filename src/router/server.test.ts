import * as http from "http"
import type { AddressInfo } from "net"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
        ready: vi.fn(async () => {}),
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

  it("counts tokens from an SSE stream during a proxy request", async () => {
    const upstream = await new Promise<{ port: number; close: () => Promise<void> }>(resolve => {
      const server = http.createServer((req, res) => {
        if (req.url === "/v1/models") {
          res.writeHead(200, { "content-type": "application/json" })
          res.end(JSON.stringify({ data: [{ id: "mlx-community/A" }] }))
          return
        }
        if (req.url === "/v1/chat/completions") {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "connection": "keep-alive"
          })
          res.write("data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n")
          res.write("data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n")
          res.write("data: [DONE]\n\n")
          res.end()
          return
        }
        res.writeHead(404)
        res.end()
      })
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as AddressInfo).port
        resolve({
          port,
          close: () => new Promise<void>((resClose, rej) => server.close(err => err ? rej(err) : resClose()))
        })
      })
    })

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
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: {
        ready: vi.fn(async () => {}),
        get: () => ({ port: upstream.port }),
        list: () => [],
        start: vi.fn(),
        stop: vi.fn(),
        stopAll: vi.fn(),
        restart: vi.fn()
      }
    }))

    const { getLiveRouterStats } = await import("../supervisor/metrics.js")
    const { startRouter, stopRouter } = await import("./server.js")
    const { clearTelemetryHistory, loadTelemetryHistory } = await import("../supervisor/telemetry.js")
    clearTelemetryHistory()

    const server = startRouter()
    await new Promise<void>(resListen => server!.once("listening", resListen))
    const address = server!.address() as AddressInfo

    const res = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mlx-community/A", messages: [{ role: "user", content: "hi" }], stream: true })
    })

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain("hello")
    expect(text).toContain("world")

    const stats = getLiveRouterStats("mlx-community/A")
    expect(stats).not.toBeNull()
    expect(stats!.tokens).toBe(2)

    // Wait for the asynchronous telemetry record to be saved
    await new Promise(r => setTimeout(r, 200))
    const history = loadTelemetryHistory()
    expect(history.length).toBe(1)
    expect(history[0]?.modelId).toBe("mlx-community/A")
    expect(history[0]?.generatedTokens).toBe(2)

    await stopRouter()
    await upstream.close()
  })

  it("handles reasoning_effort in proxy: validates, injects default, and strips for unsupported", async () => {
    let lastUpstreamBody: any = null
    const upstream = await new Promise<{ port: number; close: () => Promise<void> }>(resolve => {
      const server = http.createServer((req, res) => {
        let body = ""
        req.on("data", chunk => { body += chunk })
        req.on("end", () => {
          try { lastUpstreamBody = JSON.parse(body) } catch {}
          res.writeHead(200, { "content-type": "application/json" })
          res.end(JSON.stringify({ ok: true }))
        })
      })
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as AddressInfo).port
        resolve({
          port,
          close: () => new Promise<void>((resClose, rej) => server.close(err => err ? rej(err) : resClose()))
        })
      })
    })

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
      listModels: () => [
        {
          id: "unsloth/Qwen3.8-27B-GGUF:Qwen3.8-27B-Q4_K_M.gguf",
          slug: "qwen3.8",
          path: "/models/qwen3.8.gguf",
          runtime: "llama.cpp",
          source: { type: "hf", repo: "unsloth/Qwen3.8-27B-GGUF" },
          port: upstream.port,
          publish: true,
          addedAt: 0,
          capabilities: ["reasoning_effort"],
          reasoningEffort: {
            enum: ["xhigh", "medium", "low"],
            templateDefault: "xhigh",
            athanorDefault: "medium"
          },
          formula: {
            runtime: "llama.cpp",
            llama: { reasoningEffort: "medium" }
          }
        },
        {
          id: "plain-llama",
          slug: "plain-llama",
          path: "/models/plain.gguf",
          runtime: "llama.cpp",
          source: { type: "local" },
          port: upstream.port,
          publish: true,
          addedAt: 0
        }
      ]
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: {
        ready: vi.fn(async () => {}),
        get: () => ({ port: upstream.port }),
        list: () => [],
        start: vi.fn(),
        stop: vi.fn(),
        stopAll: vi.fn(),
        restart: vi.fn()
      }
    }))

    const { startRouter, stopRouter } = await import("./server.js")
    const server = startRouter()
    await new Promise<void>(resListen => server!.once("listening", resListen))
    const address = server!.address() as AddressInfo

    // 1. Invalid reasoning_effort on Qwen3.8 should return 400 Bad Request
    const resInvalid = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.8",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: "high"
      })
    })
    expect(resInvalid.status).toBe(400)
    const errBody = await resInvalid.json() as { error: string }
    expect(errBody.error).toMatch(/invalid reasoning_effort "high"/)

    // 2. Omitted reasoning_effort on Qwen3.8 should have formula default injected
    lastUpstreamBody = null
    const resOmitted = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.8",
        messages: [{ role: "user", content: "hi" }]
      })
    })
    expect(resOmitted.status).toBe(200)
    expect(lastUpstreamBody?.reasoning_effort).toBe("medium")

    // 3. Valid reasoning_effort on Qwen3.8 should be forwarded
    lastUpstreamBody = null
    const resValid = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.8",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: "low"
      })
    })
    expect(resValid.status).toBe(200)
    expect(lastUpstreamBody?.reasoning_effort).toBe("low")

    // 4. Unsupported model: client reasoning_effort is stripped
    lastUpstreamBody = null
    const resStrip = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "plain-llama",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: "medium"
      })
    })
    expect(resStrip.status).toBe(200)
    expect(lastUpstreamBody?.reasoning_effort).toBeUndefined()

    await stopRouter()
    await upstream.close()
  })

  it("handles /health and unknown 404 routes correctly", async () => {
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
    const server = startRouter({ silent: true })
    await new Promise<void>(resListen => server!.once("listening", resListen))
    const address = server!.address() as AddressInfo

    // GET /health
    const resHealth = await fetch(`http://127.0.0.1:${address.port}/health`)
    expect(resHealth.status).toBe(200)
    expect(await resHealth.text()).toBe("ok")

    // GET /unknown -> 404
    const resNotFound = await fetch(`http://127.0.0.1:${address.port}/unknown`)
    expect(resNotFound.status).toBe(404)

    // POST /v1/chat/completions with empty body -> 400
    const resEmpty = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: ""
    })
    expect(resEmpty.status).toBe(400)

    // POST /v1/chat/completions with missing model -> 400
    const resNoModel = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] })
    })
    expect(resNoModel.status).toBe(400)

    // POST /v1/chat/completions with unknown model -> 404
    const resUnknownModel = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "non-existent-model" })
    })
    expect(resUnknownModel.status).toBe(404)

    await stopRouter()
  })

  it("handles upstream failure retry returning 503 when target resolution fails", async () => {
    vi.doMock("../config/index.js", async () => {
      const real: any = await vi.importActual("../config/index.js")
      return {
        ...real,
        loadConfig: () => ({
          ...real.DEFAULT_CONFIG,
          router: { enabled: true, host: "127.0.0.1", port: 0, verbose: true }
        })
      }
    })

    vi.doMock("../registry/index.js", () => ({
      listModels: () => [{
        id: "mlx-community/FailModel",
        slug: "fail-model",
        path: "/cache/fail",
        runtime: "mlx",
        source: { type: "hf", repo: "mlx-community/FailModel" },
        port: 18999,
        publish: true,
        addedAt: 0
      }]
    }))

    let started = false
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: {
        ready: vi.fn(async () => {}),
        get: () => {
          if (!started) return { port: 18999 }
          return undefined
        },
        list: () => [],
        start: vi.fn(async () => {
          started = true
          throw new Error("retry start failed")
        }),
        stop: vi.fn(async () => {
          started = true
        }),
        stopAll: vi.fn(),
        restart: vi.fn()
      }
    }))

    const { startRouter, stopRouter } = await import("./server.js")
    const server = startRouter({ silent: true, verbose: true })
    await new Promise<void>(resListen => server!.once("listening", resListen))
    const address = server!.address() as AddressInfo

    const res = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mlx-community/FailModel",
        messages: [{ role: "user", content: "hello" }],
        temperature: 0.7
      })
    })

    // Expect 502 or 503 error returned to client
    expect([502, 503]).toContain(res.status)

    await stopRouter()
  })

  it("handles router lifecycle options, disabled config, and verbose logging", async () => {
    vi.resetModules()
    vi.doMock("../config/index.js", async () => {
      const actual: any = await vi.importActual("../config/index.js")
      return {
        ...actual,
        loadConfig: () => ({
          ...actual.loadConfig(),
          router: {
            enabled: false,
            host: "127.0.0.1",
            port: 0,
            verbose: false,
            drainTimeoutMs: 100
          }
        })
      }
    })

    const { startRouter, stopRouter } = await import("./server.js")

    // When disabled and not forced, returns null
    const sNull = startRouter({ force: false })
    expect(sNull).toBeNull()

    // Stop when not running resolves cleanly
    await expect(stopRouter()).resolves.toBeUndefined()

    // Start with force: true and verbose: true, silent: false
    const s1 = startRouter({ force: true, port: 0, verbose: true, silent: false })
    expect(s1).not.toBeNull()
    await new Promise<void>(resListen => s1!.once("listening", resListen))
    const address = s1!.address() as AddressInfo

    // Calling startRouter again returns same server instance
    const s2 = startRouter({ force: true })
    expect(s2).toBe(s1)

    // GET /health with verbose: true
    const resHealth = await fetch(`http://127.0.0.1:${address.port}/health`)
    expect(resHealth.status).toBe(200)

    // GET /models alias with verbose: true
    const resModels = await fetch(`http://127.0.0.1:${address.port}/models`)
    expect(resModels.status).toBe(200)

    // POST /v1/invalid with non-JSON body to trigger summarizeRequestBody catch branch
    const resBadBody = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-custom-test": "header-val" },
      body: "this is not json at all"
    })
    expect(resBadBody.status).toBe(400)

    // GET /not-found with verbose: true
    const res404 = await fetch(`http://127.0.0.1:${address.port}/unhandled/path`)
    expect(res404.status).toBe(404)

    await stopRouter()
  })
})


