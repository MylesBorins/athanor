import * as http from "http"
import type { Server } from "http"
import { Readable } from "stream"
import { pipeline } from "stream/promises"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { loadConfig } from "../config/index.js"
import { listModels } from "../registry/index.js"
import { supervisor } from "../supervisor/index.js"
import { resolveByRuntimeModelId, runtimeModelId } from "../adapters/index.js"
import { begin, end } from "../supervisor/inflight.js"
import { recoverLiveInstances } from "../supervisor/reconcile.js"

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

const ROUTER_LOG = path.join(os.homedir(), ".athanor", "logs", "router.log")
function routerLog(line: string): void {
  const msg = `[${new Date().toISOString()}] ${line}\n`
  try {
    fs.appendFileSync(ROUTER_LOG, msg, { encoding: "utf8" })
  } catch {
    // If filesystem logging fails, fall back to console.
    console.log(msg.trimEnd())
  }
}

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

async function ensureRequestTarget(entry: ReturnType<typeof resolveByRuntimeModelId>): Promise<ReturnType<typeof supervisor.get> | { port: number } | undefined> {
  if (!entry) return undefined
  const current = supervisor.get(entry.id)
  if (current) return current

  const recovered = await recoverLiveInstances([entry], supervisor.list())
  const revived = recovered.find(inst => inst.id === entry.id)
  if (revived) return await waitForUpstreamModelList(entry, revived)

  const started = await supervisor.start(entry)
  return await waitForUpstreamModelList(entry, started)
}

async function waitForUpstreamModelList(
  entry: ReturnType<typeof resolveByRuntimeModelId>,
  inst: ReturnType<typeof supervisor.get> | { port: number }
): Promise<ReturnType<typeof supervisor.get> | { port: number }> {
  if (!inst) return inst

  // Router can receive the request immediately after supervisor.start().
  // For some backends (esp. MLX), there can be a short warmup window where
  // the TCP port is not yet accepting connections or /v1/models isn’t ready.
  // We avoid proxying too early by polling until the upstream responds.
  const timeoutMs = 20_000
  // A minimal extra buffer for very slow startups.
  // Note: this is only used when we just started/recovered an instance.
  const startedAt = Date.now()
  let lastErr: unknown

  const slug = entry?.slug ?? "(unknown)"

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const resp = await fetch(`http://127.0.0.1:${inst.port}/v1/models`, { method: "GET" })
      if (resp.ok) return inst
    } catch (err) {
      lastErr = err
    }
    await new Promise(r => setTimeout(r, 250))
  }

  routerLog(`[router] upstream readiness timeout ${JSON.stringify({ slug, port: inst.port, timeoutMs, lastErr: String(lastErr) })}`)
  throw new Error(`upstream not ready for ${slug} after ${timeoutMs}ms: ${String(lastErr)}`)
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
    routerLog(`[router] ${req.method} ${req.url ?? ""} invalid JSON body`)
    return sendJson(res, 400, { error: "invalid JSON body" })
  }
  if (typeof parsed.model !== "string" || !parsed.model) {
    routerLog(`[router] ${req.method} ${req.url ?? ""} missing/invalid model field ${JSON.stringify({ model: parsed.model })}`)
    return sendJson(res, 400, { error: "request body must include a string 'model' field" })
  }

  const entry = resolveByRuntimeModelId(listModels(), parsed.model)
  if (!entry) {
    routerLog(`[router] ${req.method} ${req.url ?? ""} unknown model ${JSON.stringify({ model: parsed.model })}`)
    return sendJson(res, 404, { error: `unknown model '${parsed.model}'` })
  }

  routerLog(`[router] ${req.method} ${req.url ?? ""} model resolved ${JSON.stringify({ model: parsed.model, runtimeId: entry.id, slug: entry.slug })}`)

  let inst
  try {
    inst = await ensureRequestTarget(entry)
  } catch (err) {
    routerLog(`[router] ensureRequestTarget failed ${JSON.stringify({ slug: entry.slug, error: String(err) })}`)
    return sendJson(res, 503, { error: `failed to start ${entry.slug}: ${String(err)}` })
  }
  if (!inst) {
    routerLog(`[router] ensureRequestTarget returned empty ${JSON.stringify({ slug: entry.slug })}`)
    return sendJson(res, 503, { error: `failed to resolve active target for ${entry.slug}` })
  }

  routerLog(`[router] using upstream ${JSON.stringify({ slug: entry.slug, port: inst.port })}`)

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
      routerLog(`[router] upstream fetch failed ${JSON.stringify({ slug: entry.slug, port: inst.port, url: upstreamUrl, error: String(err) })}`)

      // If the backend died after the readiness probe but before/while proxying,
      // try to start/switch again and retry once.
      try {
        // If the backend died, supervisor bookkeeping can lag behind.
        // Force-clear the instance for this model so ensureRequestTarget()
        // can't keep returning a stale (unreachable) port.
        try { await supervisor.stop(entry.id) } catch { /* best effort */ }

        const retryInst = await ensureRequestTarget(entry)
        if (!retryInst) {
          return sendJson(res, 503, { error: `failed to resolve active target for ${entry.slug} after upstream failure` })
        }
        const retryUrl = `http://127.0.0.1:${retryInst.port}${req.url ?? "/"}`
        routerLog(`[router] retrying upstream after failure ${JSON.stringify({ slug: entry.slug, port: retryInst.port, url: retryUrl })}`)
        upstream = await fetch(retryUrl, { method: req.method, headers, body })
      } catch (retryErr) {
        return sendJson(res, 502, { error: `upstream fetch failed: ${String(retryErr)}` })
      }
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
      await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), res)
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
