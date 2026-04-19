import * as fs from "fs"
import { describe, it, expect, beforeEach } from "vitest"
import { PATHS } from "../config/index.js"
import type { ActiveInstance } from "../types/index.js"
import { loadPersistedInstances, pidAlive, savePersistedInstances } from "./state.js"

function clearState(): void {
  try { fs.unlinkSync(PATHS.state) } catch { /* absent */ }
}

function inst(overrides: Partial<ActiveInstance> = {}): ActiveInstance {
  return {
    id: "x/y",
    slug: "y",
    runtime: "mlx",
    pid: 1234,
    port: 8081,
    status: "running",
    startedAt: 1,
    logFile: "/tmp/x-1234.log",
    ...overrides
  }
}

describe("loadPersistedInstances", () => {
  beforeEach(clearState)

  it("returns [] when the state file is absent", () => {
    expect(loadPersistedInstances()).toEqual([])
  })

  it("returns [] when the state file is malformed JSON", () => {
    fs.writeFileSync(PATHS.state, "not-json")
    expect(loadPersistedInstances()).toEqual([])
  })

  it("returns [] when instances is missing or not an array", () => {
    fs.writeFileSync(PATHS.state, JSON.stringify({ version: 1 }))
    expect(loadPersistedInstances()).toEqual([])
    fs.writeFileSync(PATHS.state, JSON.stringify({ version: 1, instances: "oops" }))
    expect(loadPersistedInstances()).toEqual([])
  })
})

describe("savePersistedInstances", () => {
  beforeEach(clearState)

  it("round-trips instances through the filesystem", () => {
    const a = inst({ id: "a/b", slug: "b", pid: 1 })
    const c = inst({ id: "c/d", slug: "d", pid: 2, port: 8082 })
    savePersistedInstances([a, c])
    const loaded = loadPersistedInstances()
    expect(loaded).toHaveLength(2)
    expect(loaded.map(i => i.slug)).toEqual(["b", "d"])
  })

  it("writes a versioned envelope around the instances array", () => {
    savePersistedInstances([inst()])
    const raw = JSON.parse(fs.readFileSync(PATHS.state, "utf8"))
    expect(raw.version).toBe(1)
    expect(Array.isArray(raw.instances)).toBe(true)
  })

  it("overwrites prior contents (not appends)", () => {
    savePersistedInstances([inst({ slug: "first" })])
    savePersistedInstances([inst({ slug: "second" })])
    const loaded = loadPersistedInstances()
    expect(loaded.map(i => i.slug)).toEqual(["second"])
  })
})

describe("pidAlive", () => {
  it("returns true for the current process", () => {
    expect(pidAlive(process.pid)).toBe(true)
  })

  it("returns false for a pid that isn't running", () => {
    // Picking a very large pid that's almost certainly unused.
    // process.kill(pid, 0) will throw ESRCH and the helper catches it.
    expect(pidAlive(2_147_483_646)).toBe(false)
  })
})
