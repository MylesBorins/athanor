import { describe, it, expect, vi, afterEach } from "vitest"
import {
  formatBytes,
  formatEntryLine,
  formatUptime,
  statusBadge
} from "./format.js"
import type { ActiveInstance, ModelEntry } from "../types/index.js"

function entry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "x/y", slug: "y-slug", path: "/m/y", runtime: "mlx",
    source: { type: "hf", repo: "x/y" },
    port: 8081, publish: true, piAlias: "y-slug", addedAt: 0,
    ...overrides
  }
}

function instance(overrides: Partial<ActiveInstance> = {}): ActiveInstance {
  return {
    id: "x/y", slug: "y-slug", runtime: "mlx", port: 8081,
    pid: 9, startedAt: Date.now(), status: "running",
    logFile: "/tmp/x.log", ...overrides
  }
}

describe("formatBytes", () => {
  it("returns '?' for undefined or zero", () => {
    expect(formatBytes(undefined)).toBe("?")
    expect(formatBytes(0)).toBe("?")
  })
  it("scales to human-readable units", () => {
    expect(formatBytes(512)).toBe("512.0 B")
    expect(formatBytes(2048)).toBe("2.0 KB")
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB")
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB")
  })
})

describe("formatUptime", () => {
  afterEach(() => vi.useRealTimers())
  it("formats seconds, minutes, and hours ranges", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"))
    const now = Date.now()
    expect(formatUptime(now - 10_000)).toBe("10s")
    expect(formatUptime(now - 120_000)).toBe("2m")
    expect(formatUptime(now - (3 * 3600 + 5 * 60) * 1000)).toBe("3h5m")
  })
})

describe("statusBadge", () => {
  it("returns 'idle' when no instance is provided", () => {
    expect(statusBadge(undefined)).toBe("idle")
  })
  it("returns the instance status verbatim", () => {
    expect(statusBadge(instance({ status: "starting" }))).toBe("starting")
    expect(statusBadge(instance({ status: "error" }))).toBe("error")
  })
})

describe("formatEntryLine", () => {
  it("includes the slug, runtime, port, and [pi] when published", () => {
    const line = formatEntryLine(entry({ publish: true, sizeBytes: 1024 * 1024 }))
    expect(line).toContain("y-slug")
    expect(line).toContain("mlx")
    expect(line).toContain(":8081")
    expect(line).toContain("[pi]")
    expect(line).toContain("1.0 MB")
  })

  it("omits the [pi] tag when not published", () => {
    const line = formatEntryLine(entry({ publish: false }))
    expect(line).not.toContain("[pi]")
  })

  it("appends the active status marker when an instance is provided", () => {
    const line = formatEntryLine(entry(), instance({ status: "running" }))
    expect(line).toContain("● running")
  })
})
