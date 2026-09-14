import * as http from "http"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
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

  it("records rich telemetry for non-streaming completions including logs, process stats, and llama speculative metrics", async () => {
    const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-router-test-"))
    const logFile = path.join(tmpLogDir, "test-llama.log")
    fs.writeFileSync(
      logFile,
      [
        "prompt eval time = 100.0 ms / 40 tokens (400.0 tokens per second)",
        "eval time = 400.0 ms / 20 tokens (50.0 tokens per second)",
        "spec acceptance = 80.0%"
      ].join("\n"),
      "utf8"
    )

    const upstream = await new Promise<{ port: number; close: () => Promise<void> }>(resolve => {
      const server = http.createServer((req, res) => {
        if (req.url === "/v1/models") {
          res.writeHead(200, { "content-type": "application/json" })
          res.end(JSON.stringify({ data: [{ id: "test-org/llama-model" }] }))
          return
        }
        if (req.url === "/v1/chat/completions") {
          res.writeHead(200, { "content-type": "application/json" })
          res.end(JSON.stringify({
            id: "cmpl-123",
            object: "chat.completion",
            choices: [{ message: { role: "assistant", content: "Hello there!" } }],
            usage: {
              prompt_tokens: 40,
              completion_tokens: 20,
              total_tokens: 60
            }
          }))
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
          router: { enabled: true, host: "127.0.0.1", port: 0, verbose: true }
        })
      }
    })
    vi.doMock("../registry/index.js", () => ({
      listModels: () => [{
        id: "test-org/llama-model",
        slug: "test-llama",
        path: "/cache/test-llama",
        runtime: "llama.cpp",
        source: { type: "hf", repo: "test-org/llama-model" },
        port: upstream.port,
        publish: true,
        addedAt: 0,
        capabilities: ["mtp"],
        formula: {
          runtime: "llama.cpp",
          name: "spec-fast",
          llama: {
            speculativeMode: "enabled",
            specDraftNMax: 5,
            ctxSize: 4096
          }
        }
      }]
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: {
        ready: vi.fn(async () => {}),
        get: () => ({
          id: "test-org/llama-model",
          port: upstream.port,
          pid: process.pid,
          logFile
        }),
        list: () => [],
        start: vi.fn(),
        stop: vi.fn(),
        stopAll: vi.fn(),
        restart: vi.fn()
      }
    }))

    const { startRouter, stopRouter } = await import("./server.js")
    const { clearTelemetryHistory, loadTelemetryHistory } = await import("../supervisor/telemetry.js")
    clearTelemetryHistory()

    const server = startRouter({ verbose: true })
    await new Promise<void>(resListen => server!.once("listening", resListen))
    const address = server!.address() as AddressInfo

    const res = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "test-org/llama-model",
        messages: [{ role: "user", content: "hi" }],
        stream: false
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.id).toBe("cmpl-123")

    // Wait for async telemetry record to be saved
    await new Promise(r => setTimeout(r, 250))
    const history = loadTelemetryHistory()
    const rec = history.find(r => r.modelId === "test-org/llama-model")!
    expect(rec).toBeDefined()
    expect(rec.modelId).toBe("test-org/llama-model")
    expect(rec.promptTokens).toBe(40)
    expect(rec.generatedTokens).toBe(20)
    expect(rec.promptThroughput).toBe(400)
    expect(rec.generationThroughput).toBe(50)
    expect(rec.contextSize).toBe(4096)
    expect(rec.contextUtilization).toBeCloseTo(60 / 4096)
    expect(rec.presetName).toBe("spec-fast")
    expect(rec.runtimeSpecific?.llama?.speculativeEnabled).toBe(true)
    expect(rec.runtimeSpecific?.llama?.mtpEnabled).toBe(true)
    expect(rec.runtimeSpecific?.llama?.speculativeAcceptanceRate).toBe(80)
    expect(rec.runtimeSpecific?.llama?.meanDraftLength).toBe(4)
    expect(typeof rec.peakMemoryBytes).toBe("number")

    await stopRouter()
    await upstream.close()
    fs.rmSync(tmpLogDir, { recursive: true, force: true })
  })

  it("records MLX compilation time in telemetry from supervisor log", async () => {
    const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-router-mlx-"))
    const logFile = path.join(tmpLogDir, "mlx-model.log")
    fs.writeFileSync(
      logFile,
      "compiler compile time = 85.5 ms\nGeneration: 12 tokens 24.0 tokens-per-sec\n",
      "utf8"
    )

    const upstream = await new Promise<{ port: number; close: () => Promise<void> }>(resolve => {
      const server = http.createServer((req, res) => {
        if (req.url === "/v1/models") {
          res.writeHead(200, { "content-type": "application/json" })
          res.end(JSON.stringify({ data: [{ id: "mlx-community/ModelB" }] }))
          return
        }
        if (req.url === "/v1/chat/completions") {
          res.writeHead(200, { "content-type": "application/json" })
          res.end(JSON.stringify({
            choices: [{ message: { role: "assistant", content: "MLX response" } }],
            usage: { prompt_tokens: 10, completion_tokens: 12 }
          }))
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
        id: "mlx-community/ModelB",
        slug: "model-b",
        path: "/cache/model-b",
        runtime: "mlx",
        source: { type: "hf", repo: "mlx-community/ModelB" },
        port: upstream.port,
        publish: true,
        addedAt: 0,
        preset: { recipe: "balanced-recipe" }
      }]
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: {
        ready: vi.fn(async () => {}),
        get: () => ({
          id: "mlx-community/ModelB",
          port: upstream.port,
          pid: process.pid,
          logFile
        }),
        list: () => [],
        start: vi.fn(),
        stop: vi.fn(),
        stopAll: vi.fn(),
        restart: vi.fn()
      }
    }))

    const { startRouter, stopRouter } = await import("./server.js")
    const { clearTelemetryHistory, loadTelemetryHistory } = await import("../supervisor/telemetry.js")
    clearTelemetryHistory()

    const server = startRouter()
    await new Promise<void>(resListen => server!.once("listening", resListen))
    const address = server!.address() as AddressInfo

    const res = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mlx-community/ModelB",
        messages: [{ role: "user", content: "hi" }]
      })
    })

    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 250))
    const history = loadTelemetryHistory()
    const rec = history.find(r => r.modelId === "mlx-community/ModelB")
    expect(rec).toBeDefined()
    expect(rec!.runtimeSpecific?.mlx?.compilationTimeMs).toBe(85.5)
    expect(rec!.presetName).toBe("balanced-recipe")

    await stopRouter()
    await upstream.close()
    fs.rmSync(tmpLogDir, { recursive: true, force: true })
  })

  it("handles upstream empty body and error status codes", async () => {
    let returnStatus = 204
    const upstream = await new Promise<{ port: number; close: () => Promise<void> }>(resolve => {
      const server = http.createServer((req, res) => {
        if (req.url === "/v1/models") {
          res.writeHead(200, { "content-type": "application/json" })
          res.end(JSON.stringify({ data: [{ id: "mlx-community/StatusModel" }] }))
          return
        }
        if (req.url === "/v1/chat/completions") {
          if (returnStatus === 204) {
            res.writeHead(204)
            res.end()
            return
          }
          res.writeHead(returnStatus, { "content-type": "application/json" })
          res.end(JSON.stringify({ error: { message: "upstream error" } }))
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
        id: "mlx-community/StatusModel",
        slug: "status-model",
        path: "/cache/status-model",
        runtime: "mlx",
        source: { type: "hf", repo: "mlx-community/StatusModel" },
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

    const { startRouter, stopRouter } = await import("./server.js")
    const server = startRouter()
    await new Promise<void>(resListen => server!.once("listening", resListen))
    const address = server!.address() as AddressInfo

    // Test 204 No Content
    returnStatus = 204
    const res204 = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mlx-community/StatusModel", messages: [{ role: "user", content: "hi" }] })
    })
    expect(res204.status).toBe(204)

    // Test 500 Internal Error from upstream
    returnStatus = 500
    const res500 = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mlx-community/StatusModel", messages: [{ role: "user", content: "hi" }] })
    })
    expect(res500.status).toBe(500)
    const errBody = await res500.json() as any
    expect(errBody.error.message).toBe("upstream error")

    await stopRouter()
    await upstream.close()
  })

  it("handles failure to start target or empty target in ensureRequestTarget", async () => {
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
        id: "mlx-community/FailStart",
        slug: "fail-start",
        path: "/cache/fail",
        runtime: "mlx",
        source: { type: "hf", repo: "mlx-community/FailStart" },
        port: 19999,
        publish: true,
        addedAt: 0
      }]
    }))

    let throwInStart = true
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: {
        ready: vi.fn(async () => {}),
        get: () => undefined,
        list: () => [],
        start: vi.fn(async () => {
          if (throwInStart) {
            throw new Error("spawn failed: ENOENT")
          }
          return undefined as any
        }),
        stop: vi.fn(),
        stopAll: vi.fn(),
        restart: vi.fn()
      }
    }))

    const { startRouter, stopRouter } = await import("./server.js")
    const server = startRouter()
    await new Promise<void>(resListen => server!.once("listening", resListen))
    const address = server!.address() as AddressInfo

    // 1. supervisor.start throws
    throwInStart = true
    const resThrow = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mlx-community/FailStart", messages: [{ role: "user", content: "hi" }] })
    })
    expect(resThrow.status).toBe(503)
    const bodyThrow = await resThrow.json() as any
    expect(bodyThrow.error).toContain("failed to start fail-start")

    // 2. supervisor.start returns undefined
    throwInStart = false
    const resEmpty = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mlx-community/FailStart", messages: [{ role: "user", content: "hi" }] })
    })
    expect(resEmpty.status).toBe(503)
    const bodyEmpty = await resEmpty.json() as any
    expect(bodyEmpty.error).toContain("failed to resolve active target for fail-start")

    await stopRouter()
  })

  it("handles retry returning 503 when retry target cannot be resolved after upstream failure", async () => {
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
        id: "mlx-community/FailModelRetry",
        slug: "fail-model-retry",
        path: "/cache/fail",
        runtime: "mlx",
        source: { type: "hf", repo: "mlx-community/FailModelRetry" },
        port: 18998,
        publish: true,
        addedAt: 0
      }]
    }))

    let started = false
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: {
        ready: vi.fn(async () => {}),
        get: () => {
          if (!started) return { port: 18998 }
          return undefined
        },
        list: () => [],
        start: vi.fn(async () => {
          started = true
          return undefined as any
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
        model: "mlx-community/FailModelRetry",
        messages: [{ role: "user", content: "hello" }]
      })
    })

    expect(res.status).toBe(503)
    const body = await res.json() as any
    expect(body.error).toContain("failed to resolve active target for fail-model-retry after upstream failure")

    await stopRouter()
  })

  it("catches and logs telemetry recording errors cleanly without throwing", async () => {
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
    vi.doMock("../supervisor/telemetry.js", () => ({
      saveTelemetryRecord: () => {
        throw new Error("simulated telemetry disk error")
      },
      clearTelemetryHistory: vi.fn(),
      loadTelemetryHistory: vi.fn(() => []),
      parseLogTelemetry: vi.fn(() => ({}))
    }))

    const { startRouter, stopRouter } = await import("./server.js")
    const server = startRouter()
    await new Promise<void>(resListen => server!.once("listening", resListen))
    const address = server!.address() as AddressInfo

    const res = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mlx-community/A", messages: [{ role: "user", content: "hi" }] })
    })
    expect(res.status).toBe(200)
    // Wait for the async telemetry timeout to run and catch
    await new Promise(r => setTimeout(r, 250))

    await stopRouter()
    await upstream.close()
  })
})


