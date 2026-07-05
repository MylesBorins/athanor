import * as http from "http"
import type { AddressInfo } from "net"
import { afterEach, describe, expect, it } from "vitest"
import type { ActiveInstance, ModelEntry } from "../types/index.js"
import { recoverLiveInstances } from "./reconcile.js"

async function startServer(handler: http.RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler)
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
  }
}

function entry(port: number, overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "mlx-community/A",
    slug: "a",
    path: "/cache/a",
    runtime: "mlx",
    source: { type: "hf", repo: "mlx-community/A" },
    port,
    publish: true,
    addedAt: 0,
    ...overrides
  }
}

describe("recoverLiveInstances", () => {
  const servers: Array<{ close: () => Promise<void> }> = []

  afterEach(async () => {
    while (servers.length) await servers.pop()!.close()
  })

  it("recovers a live model that is serving on its stable port but missing from persisted state", async () => {
    const srv = await startServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ data: [{ id: "mlx-community/A" }] }))
        return
      }
      res.writeHead(404)
      res.end()
    })
    servers.push(srv)

    const recovered = await recoverLiveInstances([entry(srv.port)], [])
    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({
      id: "mlx-community/A",
      slug: "a",
      runtime: "mlx",
      port: srv.port,
      status: "running"
    })
    expect(typeof recovered[0].pid).toBe("number")
  })

  it("does not recover when the served model id does not match the expected runtime id", async () => {
    const srv = await startServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ data: [{ id: "different-model" }] }))
        return
      }
      res.writeHead(404)
      res.end()
    })
    servers.push(srv)

    const recovered = await recoverLiveInstances([entry(srv.port)], [])
    expect(recovered).toEqual([])
  })

  it("preserves already tracked instances without duplicating them", async () => {
    const srv = await startServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ data: [{ id: "mlx-community/A" }] }))
        return
      }
      res.writeHead(404)
      res.end()
    })
    servers.push(srv)

    const persisted: ActiveInstance[] = [{
      id: "mlx-community/A",
      slug: "a",
      runtime: "mlx",
      port: srv.port,
      pid: 123,
      startedAt: 1,
      status: "running",
      logFile: "/tmp/a.log"
    }]

    const recovered = await recoverLiveInstances([entry(srv.port)], persisted)
    expect(recovered).toEqual(persisted)
  })
})
