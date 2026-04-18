import * as fs from "fs"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import type { ModelEntry } from "../types/index.js"
import { PATHS } from "../config/index.js"

function fauxServer(port: number): string {
  return `
const http = require("http")
const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/v1/models") {
    res.writeHead(200, {"Content-Type": "application/json"})
    return res.end(JSON.stringify({status: "ok", data: []}))
  }
  res.writeHead(404); res.end()
})
server.listen(${port}, "127.0.0.1")
process.on("SIGTERM", () => server.close(() => process.exit(0)))
`
}

function entry(port: number, id = "faux/model"): ModelEntry {
  return {
    id, slug: id.replace("/", "-"), path: "/m/faux",
    runtime: "llama.cpp", source: { type: "local" },
    port, publish: true, piAlias: "faux", addedAt: 0
  }
}

function resetState(): void {
  try { fs.unlinkSync(PATHS.state) } catch { /* not present */ }
  try { fs.unlinkSync(PATHS.registry) } catch { /* not present */ }
}

async function loadSupervisor() {
  vi.doMock("../adapters/index.js", async () => {
    const real: any = await vi.importActual("../adapters/index.js")
    return {
      ...real,
      buildCommandFor: (e: ModelEntry) => ({
        cmd: process.execPath,
        args: ["-e", fauxServer(e.port)]
      })
    }
  })
  vi.doMock("../config/index.js", async () => {
    const real: any = await vi.importActual("../config/index.js")
    return {
      ...real,
      loadConfig: () => ({
        ...real.DEFAULT_CONFIG,
        supervisor: {
          policy: "single-active", maxConcurrent: 1,
          startupTimeoutMs: 5000, healthPollIntervalMs: 100
        }
      })
    }
  })
  const mod = await import("./index.js")
  return new mod.Supervisor()
}

describe("Supervisor (integration)", () => {
  beforeEach(() => { resetState(); vi.resetModules() })
  afterEach(() => { resetState() })

  it("starts a process, reports running, and stops it", async () => {
    const sup = await loadSupervisor()
    const inst = await sup.start(entry(18081))
    try {
      expect(inst.status).toBe("running")
      expect(inst.pid).toBeGreaterThan(0)
      expect(sup.get("faux/model")?.status).toBe("running")
    } finally {
      await sup.stop("faux/model")
    }
    expect(sup.get("faux/model")).toBeUndefined()
  }, 15_000)

  it("single-active policy stops the previous instance on start", async () => {
    const sup = await loadSupervisor()
    const a = await sup.start(entry(18082, "a"))
    try {
      const b = await sup.start(entry(18083, "b"))
      try {
        expect(sup.get("a")).toBeUndefined()
        expect(sup.get("b")?.pid).toBe(b.pid)
      } finally {
        await sup.stop("b")
      }
    } finally {
      try { process.kill(a.pid) } catch { /* already gone */ }
    }
  }, 20_000)

  it("start is idempotent for an already-running id", async () => {
    const sup = await loadSupervisor()
    const first = await sup.start(entry(18084))
    try {
      const second = await sup.start(entry(18084))
      expect(second.pid).toBe(first.pid)
    } finally {
      await sup.stop("faux/model")
    }
  }, 15_000)

  it("persists state and reattaches to a live process", async () => {
    const first = await loadSupervisor()
    const inst = await first.start(entry(18085))
    try {
      const saved = JSON.parse(fs.readFileSync(PATHS.state, "utf8"))
      expect(saved.instances).toHaveLength(1)

      vi.resetModules()
      const second = await loadSupervisor()
      expect(second.get("faux/model")?.pid).toBe(inst.pid)
    } finally {
      try { process.kill(inst.pid) } catch { /* already gone */ }
    }
  }, 15_000)
})
