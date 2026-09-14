import * as fs from "fs"
import * as http from "http"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import type { ModelEntry } from "../types/index.js"
import { PATHS } from "../config/index.js"
import { saveRegistry } from "../registry/index.js"
import { pidAlive } from "./state.js"

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

async function loadSupervisor(opts?: { cmd: string; args: string[] } | {
  customCmd?: { cmd: string; args: string[] }
  config?: { startupTimeoutMs?: number; healthPollIntervalMs?: number; drainTimeoutMs?: number }
}) {
  const customCmd = opts && "cmd" in opts ? opts : opts?.customCmd
  const config = opts && "config" in opts ? opts.config : undefined

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
          startupTimeoutMs: config?.startupTimeoutMs ?? 5000,
          healthPollIntervalMs: config?.healthPollIntervalMs ?? 100
        },
        router: {
          ...real.DEFAULT_CONFIG.router,
          drainTimeoutMs: config?.drainTimeoutMs ?? 0
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
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
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
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("appears to be serving on :18087 but athanor lost its PID — evicting from state")
      )
    } finally {
      errorSpy.mockRestore()
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

  it("stopAll returns false when no instances are running and true when instances are stopped", async () => {
    const sup = await loadSupervisor()
    await sup.ready()

    // No instances
    const res1 = await sup.stopAll()
    expect(res1).toBe(false)

    // Start an instance
    const e = entry(18088)
    await sup.start(e)
    expect(sup.list()).toHaveLength(1)

    // Stop all
    const res2 = await sup.stopAll()
    expect(res2).toBe(true)
    expect(sup.list()).toHaveLength(0)
  }, 15_000)

  it("restarts a running model", async () => {
    const sup = await loadSupervisor()
    await sup.ready()

    const e = entry(18089)
    const inst1 = await sup.start(e)
    expect(inst1.status).toBe("running")

    const inst2 = await sup.restart(e)
    expect(inst2.status).toBe("running")
    expect(inst2.pid).not.toBe(inst1.pid)

    await sup.stop(e.id)
  }, 15_000)

  it("aborts in-flight start when stop is called and cleans up", async () => {
    const slowServerCmd = {
      cmd: process.execPath,
      args: ["-e", `
const http = require("http")
setTimeout(() => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, {"Content-Type": "application/json"})
    res.end(JSON.stringify({status: "ok", data: [{id: "slow"}]}))
  })
  server.listen(18091, "127.0.0.1")
  process.on("SIGTERM", () => server.close(() => process.exit(0)))
}, 2000)
`]
    }
    const sup = await loadSupervisor({
      customCmd: slowServerCmd,
      config: { startupTimeoutMs: 3000, healthPollIntervalMs: 50 }
    })
    const e = entry(18091, "slow/model")
    let startErr: any
    const startPromise = sup.start(e).catch(err => {
      startErr = err
      return null
    })

    // Allow process to spawn and register as starting
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(sup.get("slow/model")?.status).toBe("starting")

    // Stop while starting
    const stopResult = await sup.stop("slow/model")
    expect(stopResult).toBe(true)

    // The start promise should be aborted
    await startPromise
    expect(startErr).toBeDefined()
    expect(startErr.message).toMatch(/aborted/)
    expect(sup.get("slow/model")).toBeUndefined()
  }, 10_000)

  it("marks instance status as error and cleans up process when startup times out", async () => {
    const deadCmd = {
      cmd: process.execPath,
      args: ["-e", `
const t = setTimeout(() => {}, 5000)
process.on("SIGTERM", () => { clearTimeout(t); process.exit(0) })
`]
    }
    const sup = await loadSupervisor({
      customCmd: deadCmd,
      config: { startupTimeoutMs: 250, healthPollIntervalMs: 50 }
    })
    const e = entry(18092, "dead/model")
    await expect(sup.start(e)).rejects.toThrow(/did not become healthy/)
  }, 10_000)

  it("refuses to start if port is already in use by an external process", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok", data: [] }))
    })
    await new Promise<void>(resolve => server.listen(18093, "127.0.0.1", resolve))
    try {
      const sup = await loadSupervisor()
      await expect(sup.start(entry(18093))).rejects.toThrow(/Port 18093 already in use/)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    }
  }, 10_000)

  it("rejects start if active instance has dead PID but port is still serving", async () => {
    const sup = await loadSupervisor()
    const e = entry(18094, "ghost/model")
    const inst = await sup.start(e)

    // Kill process externally with SIGKILL
    process.kill(inst.pid, "SIGKILL")
    while (pidAlive(inst.pid)) {
      await new Promise(r => setTimeout(r, 20))
    }

    // Now start a foreign server on the exact same port
    const foreignServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok", data: [{ id: "ghost" }] }))
    })
    await new Promise<void>(resolve => foreignServer.listen(18094, "127.0.0.1", resolve))

    try {
      await expect(sup.start(e)).rejects.toThrow(
        /cannot manage ghost-model: model is serving on :18094 but athanor does not know its PID/
      )
    } finally {
      await new Promise<void>((resolve, reject) => foreignServer.close(err => err ? reject(err) : resolve()))
    }
  }, 10_000)

  it("cleans up dead instance when port is not serving and allows fresh start", async () => {
    const sup = await loadSupervisor()
    const e = entry(18095, "stale/model")
    const inst1 = await sup.start(e)

    // Kill process externally with SIGKILL
    process.kill(inst1.pid, "SIGKILL")
    while (pidAlive(inst1.pid)) {
      await new Promise(r => setTimeout(r, 20))
    }

    // Port is not serving, so ensureStartable cleans up stale instance and starts a new one
    const inst2 = await sup.start(e)
    try {
      expect(inst2.status).toBe("running")
      expect(inst2.pid).not.toBe(inst1.pid)
    } finally {
      await sup.stop("stale/model")
    }
  }, 15_000)

  it("stop returns true when instance PID is dead and port is not serving", async () => {
    const sup = await loadSupervisor()
    const e = entry(18096, "dead2/model")
    const inst = await sup.start(e)

    // Kill process externally with SIGKILL
    process.kill(inst.pid, "SIGKILL")
    while (pidAlive(inst.pid)) {
      await new Promise(r => setTimeout(r, 20))
    }

    const stopped = await sup.stop("dead2/model")
    expect(stopped).toBe(true)
    expect(sup.get("dead2/model")).toBeUndefined()
  }, 15_000)

  it("stop returns false for non-existent model id", async () => {
    const sup = await loadSupervisor()
    await sup.ready()
    expect(await sup.stop("does/not-exist")).toBe(false)
  })

  it("drains in-flight requests when router drainTimeoutMs > 0", async () => {
    const sup = await loadSupervisor({
      config: { drainTimeoutMs: 10 }
    })
    const e = entry(18097, "drain/model")
    await sup.start(e)
    const res = await sup.stop("drain/model", { drain: true })
    expect(res).toBe(true)
    expect(sup.get("drain/model")).toBeUndefined()
  }, 10_000)
})

describe("Supervisor lifecycle events", () => {
  beforeEach(() => { resetState(); vi.resetModules() })
  afterEach(() => { resetState() })

  it("emits starting, running, and stopped events through model lifecycle", async () => {
    const sup = await loadSupervisor()
    const events: string[] = []
    let startedEntry: ModelEntry | undefined
    let runningInstance: any

    sup.on("starting", (e) => {
      events.push("starting")
      startedEntry = e
    })
    sup.on("running", (inst) => {
      events.push("running")
      runningInstance = inst
    })
    sup.on("stopped", (id) => {
      events.push(`stopped:${id}`)
    })

    const e = entry(18101, "events/test")
    const inst = await sup.start(e)
    try {
      expect(events).toEqual(["starting", "running"])
      expect(startedEntry?.id).toBe("events/test")
      expect(runningInstance?.pid).toBe(inst.pid)
      expect(runningInstance?.status).toBe("running")
    } finally {
      await sup.stop("events/test")
    }
    expect(events).toEqual(["starting", "running", "stopped:events/test"])
  }, 15_000)

  it("emits evicted event when a policy stops an active model to start another", async () => {
    const sup = await loadSupervisor()
    const evicted: Array<{ evictedId: string; triggering: string }> = []

    sup.on("evicted", (evictedId, triggeringEntry) => {
      evicted.push({ evictedId, triggering: triggeringEntry.id })
    })

    const _a = await sup.start(entry(18102, "model/a"))
    try {
      const _b = await sup.start(entry(18103, "model/b"))
      try {
        expect(evicted).toEqual([{ evictedId: "model/a", triggering: "model/b" }])
      } finally {
        await sup.stop("model/b")
      }
    } finally {
      await sup.stop("model/a")
    }
  }, 15_000)

  it("emits error event when process startup fails", async () => {
    const sup = await loadSupervisor({
      customCmd: { cmd: "non_existent_binary_12345", args: [] }
    })
    let caughtError: { id: string; error: Error } | undefined

    sup.on("error", (id, error) => {
      caughtError = { id, error }
    })

    const e = entry(18104, "fail/model")
    await expect(sup.start(e)).rejects.toThrow(/Failed to execute/)
    expect(caughtError).toBeDefined()
    expect(caughtError?.id).toBe("fail/model")
    expect(caughtError?.error).toBeInstanceOf(Error)
  }, 10_000)

  it("emits exit event when a child process terminates", async () => {
    const sup = await loadSupervisor()
    let exitEvent: { id: string; code: number | null } | undefined

    sup.on("exit", (id, code) => {
      exitEvent = { id, code }
    })

    const e = entry(18105, "exit/model")
    const inst = await sup.start(e)

    // Terminate process with SIGTERM
    process.kill(inst.pid, "SIGTERM")
    while (pidAlive(inst.pid)) {
      await new Promise(r => setTimeout(r, 20))
    }
    // Allow microtask tick for proc exit event to fire
    await new Promise(r => setTimeout(r, 50))

    expect(exitEvent).toBeDefined()
    expect(exitEvent?.id).toBe("exit/model")

    await sup.stop("exit/model")
  }, 15_000)

  it("supports typed once, off, and removeListener methods", async () => {
    const sup = await loadSupervisor()
    let onceCalled = 0
    let regularCalled = 0

    const onceListener = () => { onceCalled++ }
    const regularListener = () => { regularCalled++ }

    sup.once("stopped", onceListener)
    sup.on("stopped", regularListener)

    sup.emit("stopped", "test/1")
    expect(onceCalled).toBe(1)
    expect(regularCalled).toBe(1)

    // Second emit: once listener should not fire
    sup.emit("stopped", "test/2")
    expect(onceCalled).toBe(1)
    expect(regularCalled).toBe(2)

    // Test off / removeListener
    sup.off("stopped", regularListener)
    sup.emit("stopped", "test/3")
    expect(regularCalled).toBe(2)
  })
})

