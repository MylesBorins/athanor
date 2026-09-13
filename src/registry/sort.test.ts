import { describe, expect, it } from "vitest"
import type { ActiveInstance, ModelEntry } from "../types/index.js"
import {
  compareModelsByRecentUse,
  compareModelsByRunningThenSlug,
  sortModelsByRecentUse,
  sortModelsByRunningThenSlug
} from "./sort.js"

function makeModel(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "test/model",
    slug: "model",
    path: "/models/model",
    runtime: "mlx",
    source: { type: "hf", repo: "test/model" },
    port: 8080,
    publish: false,
    addedAt: 100,
    ...overrides
  }
}

function makeInstance(id: string): ActiveInstance {
  return {
    id,
    slug: id.split("/").pop() ?? id,
    runtime: "mlx",
    port: 8080,
    pid: 1234,
    startedAt: 1000,
    status: "running",
    logFile: "/tmp/log"
  }
}

describe("compareModelsByRunningThenSlug", () => {
  it("prioritizes running models over non-running models", () => {
    const running = makeModel({ id: "running-id", slug: "z-model" })
    const stopped = makeModel({ id: "stopped-id", slug: "a-model" })
    const runningIds = new Set(["running-id"])

    expect(compareModelsByRunningThenSlug(running, stopped, runningIds)).toBeLessThan(0)
    expect(compareModelsByRunningThenSlug(stopped, running, runningIds)).toBeGreaterThan(0)
  })

  it("sorts by slug alphabetically when running status is identical", () => {
    const a = makeModel({ id: "id-a", slug: "alpha" })
    const b = makeModel({ id: "id-b", slug: "beta" })

    expect(compareModelsByRunningThenSlug(a, b)).toBeLessThan(0)
    expect(compareModelsByRunningThenSlug(b, a)).toBeGreaterThan(0)
    expect(compareModelsByRunningThenSlug(a, a)).toBe(0)
  })
})

describe("sortModelsByRunningThenSlug", () => {
  it("sorts a list with running instances placed first followed by alphabetical slugs", () => {
    const m1 = makeModel({ id: "m1", slug: "zebra" })
    const m2 = makeModel({ id: "m2", slug: "apple" })
    const m3 = makeModel({ id: "m3", slug: "banana" })

    const sorted = sortModelsByRunningThenSlug([m1, m2, m3], [makeInstance("m1")])
    expect(sorted.map(m => m.slug)).toEqual(["zebra", "apple", "banana"])
  })

  it("handles empty instances list by defaulting to empty array", () => {
    const m1 = makeModel({ id: "m1", slug: "zebra" })
    const m2 = makeModel({ id: "m2", slug: "apple" })

    const sorted = sortModelsByRunningThenSlug([m1, m2])
    expect(sorted.map(m => m.slug)).toEqual(["apple", "zebra"])
  })
})

describe("compareModelsByRecentUse", () => {
  it("prioritizes running models first", () => {
    const running = makeModel({ id: "run", slug: "run", lastUsedAt: 10 })
    const stopped = makeModel({ id: "stop", slug: "stop", lastUsedAt: 500 })
    const runningIds = new Set(["run"])

    expect(compareModelsByRecentUse(running, stopped, runningIds)).toBeLessThan(0)
    expect(compareModelsByRecentUse(stopped, running, runningIds)).toBeGreaterThan(0)
  })

  it("sorts by lastUsedAt descending when neither or both are running", () => {
    const mRecent = makeModel({ id: "same-slug", slug: "same", lastUsedAt: 200 })
    const mOlder = makeModel({ id: "same-slug", slug: "same", lastUsedAt: 100 })

    expect(compareModelsByRecentUse(mRecent, mOlder)).toBeLessThan(0)
    expect(compareModelsByRecentUse(mOlder, mRecent)).toBeGreaterThan(0)
  })

  it("treats undefined lastUsedAt as 0", () => {
    const mUsed = makeModel({ id: "same-slug", slug: "same", lastUsedAt: 50 })
    const mNeverUsed = makeModel({ id: "same-slug", slug: "same", lastUsedAt: undefined })

    expect(compareModelsByRecentUse(mUsed, mNeverUsed)).toBeLessThan(0)
    expect(compareModelsByRecentUse(mNeverUsed, mUsed)).toBeGreaterThan(0)
  })

  it("falls back to addedAt descending when lastUsedAt matches", () => {
    const mNewer = makeModel({ id: "same", slug: "same", lastUsedAt: 100, addedAt: 50 })
    const mOlder = makeModel({ id: "same", slug: "same", lastUsedAt: 100, addedAt: 10 })

    expect(compareModelsByRecentUse(mNewer, mOlder)).toBeLessThan(0)
    expect(compareModelsByRecentUse(mOlder, mNewer)).toBeGreaterThan(0)
  })

  it("treats undefined addedAt as 0 and returns 0 when addedAt matches", () => {
    const m1 = makeModel({ id: "same", slug: "same", lastUsedAt: 100, addedAt: undefined })
    const m2 = makeModel({ id: "same", slug: "same", lastUsedAt: 100, addedAt: 0 })

    expect(compareModelsByRecentUse(m1, m2)).toBe(0)
  })
})

describe("sortModelsByRecentUse", () => {
  it("sorts models by running status, then slug if different, then recent use", () => {
    const r1 = makeModel({ id: "r1", slug: "beta" })
    const r2 = makeModel({ id: "r2", slug: "alpha" })
    const s1 = makeModel({ id: "s1", slug: "gamma", lastUsedAt: 300 })
    const s2 = makeModel({ id: "s2", slug: "delta", lastUsedAt: 500 })

    const sorted = sortModelsByRecentUse([s1, r1, s2, r2], [makeInstance("r1"), makeInstance("r2")])
    // Both r1 and r2 running: sorted by slug -> alpha, beta
    // s1 and s2 not running: compareModelsByRunningThenSlug checks slug: "gamma" vs "delta", so delta comes before gamma by slug
    expect(sorted.map(m => m.slug)).toEqual(["alpha", "beta", "delta", "gamma"])
  })

  it("does not mutate the original array", () => {
    const m1 = makeModel({ id: "m1", slug: "b" })
    const m2 = makeModel({ id: "m2", slug: "a" })
    const orig = [m1, m2]

    const sorted = sortModelsByRecentUse(orig)
    expect(sorted).not.toBe(orig)
    expect(orig[0]?.slug).toBe("b")
  })
})
