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
})
