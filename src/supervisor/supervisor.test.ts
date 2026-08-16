import * as fs from "fs"
import * as http from "http"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import type { ModelEntry } from "../types/index.js"
import { PATHS } from "../config/index.js"
import { saveRegistry } from "../registry/index.js"

function fauxServer(port: number, id: string): string {
  return `
const http = require("http")
const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/v1/models") {
    res.writeHead(200, {"Content-Type": "application/json"})
    return res.end(JSON.stringify({status: "ok", data: [{id: ${JSON.stringify(id)}}]}))
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

async function loadSupervisor(customCmd?: { cmd: string; args: string[] }) {
  vi.doMock("../adapters/index.js", async () => {
    const real: any = await vi.importActual("../adapters/index.js")
    return {
      ...real,
      buildCommandFor: (e: ModelEntry) => customCmd ?? {
        cmd: process.execPath,
        args: ["-e", fauxServer(e.port, e.piAlias ?? e.slug)]
      }
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

  it("coalesces concurrent starts for the same model", async () => {
    const sup = await loadSupervisor()
    const [first, second] = await Promise.all([
      sup.start(entry(18086)),
      sup.start(entry(18086))
    ])
    try {
      expect(first.pid).toBe(second.pid)
      expect(sup.list()).toHaveLength(1)
    } finally {
      await sup.stop("faux/model")
    }
  }, 15_000)

  it("persists state and reattaches to a live process", async () => {
    saveRegistry({ version: 1, models: [entry(18085)] })
    const first = await loadSupervisor()
    const inst = await first.start(entry(18085))
    try {
      const saved = JSON.parse(fs.readFileSync(PATHS.state, "utf8"))
      expect(saved.instances).toHaveLength(1)

      vi.resetModules()
      const second = await loadSupervisor()
      const deadline = Date.now() + 5000
      while (!second.get("faux/model") && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      expect(second.get("faux/model")).toMatchObject({
        id: "faux/model",
        port: 18085,
        status: "running"
      })
    } finally {
      try { process.kill(inst.pid) } catch { /* already gone */ }
    }
  }, 15_000)

  it("stops a recovered instance whose PID is unknown by evicting it from state", async () => {
    saveRegistry({ version: 1, models: [entry(18087)] })
    const server = http.createServer((req, res) => {
      if (req.url === "/health" || req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: "ok", data: [{ id: "faux" }] }))
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>(resolve => server.listen(18087, "127.0.0.1", resolve))
    try {
      const sup = await loadSupervisor()
      await sup.ready()
      const inst = sup.get("faux/model")
      expect(inst).toBeDefined()
      expect(inst!.port).toBe(18087)
      // stop() evicts the entry rather than throwing when PID is unknown
      const result = await sup.stop("faux/model")
      expect(result).toBe(true)
      expect(sup.get("faux/model")).toBeUndefined()
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve())
      })
    }
  }, 15_000)

  it("handles spawn error gracefully when binary does not exist without crashing process", async () => {
    const sup = await loadSupervisor({
      cmd: "non_existent_binary_for_testing_12345",
      args: []
    })
    await expect(sup.start(entry(19555))).rejects.toThrow("Failed to execute 'non_existent_binary_for_testing_12345'")
  }, 10_000)
})
