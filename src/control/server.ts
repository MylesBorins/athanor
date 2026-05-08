import * as http from "http"
import type { Server } from "http"
import { loadConfig } from "../config/index.js"
import { getModel, listModels } from "../registry/index.js"
import { supervisor } from "../supervisor/index.js"
import { startModel, stopModel } from "../app/models.js"

interface RequestBody {
  id?: string
}

async function readJson(req: http.IncomingMessage): Promise<RequestBody> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as RequestBody
  } catch {
    return {}
  }
}

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  if (req.method === "GET" && url.pathname === "/status") {
    sendJson(res, 200, {
      instances: supervisor.list(),
      models: listModels().map(m => ({
        id: m.id, slug: m.slug, port: m.port, runtime: m.runtime, publish: m.publish
      }))
    })
    return
  }
  if (req.method === "POST" && url.pathname === "/activate") {
    const { id } = await readJson(req)
    if (!id) return sendJson(res, 400, { error: "id required" })
    const entry = getModel(id)
    if (!entry) return sendJson(res, 404, { error: `unknown model ${id}` })
    const { instance } = await startModel(id, { confirm: true })
    sendJson(res, 200, { instance })
    return
  }
  if (req.method === "POST" && url.pathname === "/deactivate") {
    const { id } = await readJson(req)
    if (!id) return sendJson(res, 400, { error: "id required" })
    const entry = getModel(id)
    if (!entry) return sendJson(res, 404, { error: `unknown model ${id}` })
    await stopModel(entry.id)
    sendJson(res, 200, { ok: true })
    return
  }
  sendJson(res, 404, { error: "not found" })
}

let current: Server | null = null

export function startControlApi(): Server | null {
  const cfg = loadConfig()
  if (!cfg.controlApi.enabled) return null
  if (current) return current

  const server = http.createServer((req, res) => {
    handle(req, res).catch(err => sendJson(res, 500, { error: String(err) }))
  })
  server.listen(cfg.controlApi.port, cfg.controlApi.host, () => {
    console.log(
      `athanor control API listening on http://${cfg.controlApi.host}:${cfg.controlApi.port}`
    )
  })
  current = server
  return server
}

export function stopControlApi(): Promise<void> {
  return new Promise(resolve => {
    if (!current) return resolve()
    current.close(() => {
      current = null
      resolve()
    })
  })
}
