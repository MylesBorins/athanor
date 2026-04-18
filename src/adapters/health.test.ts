import * as http from "http"
import type { AddressInfo } from "net"
import { describe, it, expect, afterEach } from "vitest"
import { healthUrl, probeHealth, waitForHealthy } from "./health.js"

type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void

async function startServer(routes: Record<string, RouteHandler>): Promise<{
  port: number
  close: () => Promise<void>
}> {
  const server = http.createServer((req, res) => {
    const handler = routes[req.url ?? "/"]
    if (!handler) { res.writeHead(404); res.end(); return }
    handler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    close: () => new Promise<void>((resolve, reject) =>
      server.close(err => err ? reject(err) : resolve())
    )
  }
}

describe("healthUrl", () => {
  it("points llama.cpp at /health and mlx at /v1/models", () => {
    expect(healthUrl("llama.cpp", 8080)).toBe("http://127.0.0.1:8080/health")
    expect(healthUrl("mlx", 8080)).toBe("http://127.0.0.1:8080/v1/models")
  })
})

describe("probeHealth / waitForHealthy (real local server)", () => {
  const servers: { close: () => Promise<void> }[] = []

  afterEach(async () => {
    while (servers.length) await servers.pop()!.close()
  })

  it("returns true when llama.cpp /health answers { status: 'ok' }", async () => {
    const srv = await startServer({
      "/health": (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: "ok" }))
      }
    })
    servers.push(srv)
    expect(await probeHealth("llama.cpp", srv.port)).toBe(true)
  })

  it("returns false when /health reports status !== 'ok'", async () => {
    const srv = await startServer({
      "/health": (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: "loading" }))
      }
    })
    servers.push(srv)
    expect(await probeHealth("llama.cpp", srv.port)).toBe(false)
  })

  it("returns true for any 2xx on the mlx endpoint", async () => {
    const srv = await startServer({
      "/v1/models": (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ data: [] }))
      }
    })
    servers.push(srv)
    expect(await probeHealth("mlx", srv.port)).toBe(true)
  })

  it("returns false when the server is not listening", async () => {
    expect(await probeHealth("llama.cpp", 1, 200)).toBe(false)
  })

  it("waitForHealthy resolves once the endpoint goes healthy", async () => {
    let ready = false
    const srv = await startServer({
      "/health": (_req, res) => {
        if (!ready) { res.writeHead(503); res.end(); return }
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: "ok" }))
      }
    })
    servers.push(srv)
    setTimeout(() => { ready = true }, 150)
    await waitForHealthy("llama.cpp", srv.port, {
      timeoutMs: 2000, intervalMs: 50
    })
    expect(ready).toBe(true)
  })

  it("waitForHealthy rejects after the timeout elapses", async () => {
    await expect(
      waitForHealthy("llama.cpp", 1, { timeoutMs: 200, intervalMs: 50 })
    ).rejects.toThrow(/did not become healthy/)
  })
})
