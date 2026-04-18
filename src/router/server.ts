import * as http from "http"
import type { Server } from "http"
import { Readable } from "stream"
import { pipeline } from "stream/promises"
import { loadConfig } from "../config/index.js"
import { listModels } from "../registry/index.js"
import { supervisor } from "../supervisor/index.js"
import { resolveByRuntimeModelId, runtimeModelId } from "../adapters/index.js"
import { begin, end } from "../supervisor/inflight.js"

// OpenAI-compatible proxy fronting every exposed athanor model on a
// single port. See src/config/index.ts RouterConfig. The router
// inspects every POST /v1/** request body, reverse-looks up the
// `model` field via resolveByRuntimeModelId, asks the supervisor to
// start the target if idle (single-active policy is what makes this
// feel like magic model-switching), and streams the upstream response
// back unchanged. GET /v1/models is synthesised from the registry so
// pi-agent can enumerate exposed models without any runtime running.

// Request headers that fetch() recomputes or that would break the
// upstream connection if we forwarded them verbatim.
const STRIP_REQ = new Set(["host", "content-length", "connection", "accept-encoding"])
// Response headers Node's http server recomputes. Forwarding these
// would produce duplicate or conflicting framing.
const STRIP_RES = new Set(["content-length", "transfer-encoding", "connection"])

let current: Server | null = null

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

function synthesizeModelList(): unknown {
  const now = Math.floor(Date.now() / 1000)
  return {
    object: "list",
    data: listModels().filter(e => e.publish).map(e => ({
      id: runtimeModelId(e),
      object: "model",
      created: now,
      owned_by: "athanor"
    }))
  }
}

async function proxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Buffer
): Promise<void> {
  let parsed: { model?: unknown }
  try {
    parsed = body.length === 0 ? {} : JSON.parse(body.toString("utf8"))
  } catch {
    return sendJson(res, 400, { error: "invalid JSON body" })
  }
  if (typeof parsed.model !== "string" || !parsed.model) {
    return sendJson(res, 400, { error: "request body must include a string 'model' field" })
  }
  const entry = resolveByRuntimeModelId(listModels(), parsed.model)
  if (!entry) return sendJson(res, 404, { error: `unknown model '${parsed.model}'` })

  let inst
  try {
    inst = await supervisor.start(entry)
  } catch (err) {
    return sendJson(res, 503, { error: `failed to start ${entry.slug}: ${String(err)}` })
  }

  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (!v) continue
    const name = k.toLowerCase()
    if (STRIP_REQ.has(name)) continue
    headers[name] = Array.isArray(v) ? v.join(",") : v
  }

  // Ref-count the upstream round-trip so supervisor.stop() can drain
  // before SIGTERM. begin() lives outside the try to pair cleanly with
  // the finally; fetch/pipeline errors still decrement.
  begin(entry.id)
  try {
    const upstreamUrl = `http://127.0.0.1:${inst.port}${req.url ?? "/"}`
    let upstream: Response
    try {
      upstream = await fetch(upstreamUrl, { method: req.method, headers, body })
    } catch (err) {
      return sendJson(res, 502, { error: `upstream fetch failed: ${String(err)}` })
    }

    const outHeaders: Record<string, string> = {}
    upstream.headers.forEach((v, k) => {
      if (!STRIP_RES.has(k.toLowerCase())) outHeaders[k] = v
    })
    res.writeHead(upstream.status, outHeaders)
    if (!upstream.body) { res.end(); return }
    try {
      // Web ReadableStream -> Node Readable -> chunked http response.
      // Preserves SSE framing because we never buffer to a string.
      await pipeline(Readable.fromWeb(upstream.body as any), res)
    } catch {
      // Client disconnected or upstream errored mid-stream; both ends
      // are closed by pipeline on rejection.
    }
  } finally {
    end(entry.id)
  }
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }); res.end("ok")
    return
  }
  if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
    return sendJson(res, 200, synthesizeModelList())
  }
  if (req.method === "POST" && url.pathname.startsWith("/v1/")) {
    return proxy(req, res, await readBody(req))
  }
  sendJson(res, 404, { error: `not found: ${req.method} ${url.pathname}` })
}

export interface StartRouterOptions {
  // Override config.router.host / config.router.port at runtime. Used
  // by the `athanor router` subcommand so users can one-shot a daemon
  // without editing config.json.
  host?: string
  port?: number
  // Bypass the config.router.enabled gate. Lets `athanor router` run
  // the server even when the long-lived TUI has it disabled.
  force?: boolean
  // Suppress the "listening on ..." log. The headless command prints
  // its own banner; the TUI-embedded start path opts into silence.
  silent?: boolean
}

export function startRouter(opts: StartRouterOptions = {}): Server | null {
  const cfg = loadConfig()
  if (!opts.force && !cfg.router.enabled) return null
  if (current) return current
  const host = opts.host ?? cfg.router.host
  const port = opts.port ?? cfg.router.port
  const server = http.createServer((req, res) => {
    handle(req, res).catch(err => {
      try { sendJson(res, 500, { error: String(err) }) } catch { /* already sent */ }
    })
  })
  server.listen(port, host, () => {
    if (!opts.silent) console.log(`athanor router listening on http://${host}:${port}`)
  })
  current = server
  return server
}

export function stopRouter(): Promise<void> {
  return new Promise(resolve => {
    if (!current) return resolve()
    current.close(() => { current = null; resolve() })
  })
}
