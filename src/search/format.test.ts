import { afterEach, describe, expect, it, vi } from "vitest"
import { formatBytes, formatCount, formatRelTime, formatResultRow } from "./format.js"
import { stripAnsi } from "../cli/style.js"

describe("formatCount", () => {
  it("formats small, thousand, and million ranges", () => {
    expect(formatCount(undefined)).toBe("?")
    expect(formatCount(0)).toBe("0")
    expect(formatCount(999)).toBe("999")
    expect(formatCount(1500)).toBe("1.5k")
    expect(formatCount(12_345)).toBe("12.3k")
    expect(formatCount(2_500_000)).toBe("2.5M")
  })
})

describe("formatBytes", () => {
  it("formats byte counts with binary units", () => {
    expect(formatBytes(undefined)).toBe("?")
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(1023)).toBe("1023 B")
    expect(formatBytes(1024)).toBe("1.0 KB")
    expect(formatBytes(1_500_000)).toBe("1.4 MB")
    expect(formatBytes(4_000_000_000)).toBe("3.7 GB")
  })
})

describe("formatRelTime", () => {
  afterEach(() => vi.useRealTimers())
  it("produces a relative-time string from ISO timestamps", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"))
    expect(formatRelTime(undefined)).toBe("")
    expect(formatRelTime("")).toBe("")
    expect(formatRelTime("2024-12-31T23:59:30Z")).toBe("30s ago")
    expect(formatRelTime("2024-12-31T23:55:00Z")).toBe("5m ago")
    expect(formatRelTime("2024-12-31T20:00:00Z")).toBe("4h ago")
    expect(formatRelTime("2024-12-25T00:00:00Z")).toBe("7d ago")
  })
})

describe("formatResultRow", () => {
  it("includes the repo id, size, counts, license, and a relative time", () => {
    const row = stripAnsi(formatResultRow({
      id: "mlx-community/Qwen3-32B-4bit",
      tags: ["mlx", "license:apache-2.0"],
      downloads: 12_345,
      likes: 430,
      lastModified: new Date().toISOString(),
      runtime: "mlx",
      license: "apache-2.0",
      sizeBytes: 16 * 1024 * 1024 * 1024
    }, {
      fitBand: "comfortable",
      estimatedFootprintGiB: 12.3,
      recommendedContext: 32768,
      recommendedContextNote: "trained max: 32768",
      confidence: "high",
      explanation: "fits comfortably",
      runnable: true,
      runtimeLabel: "mlx"
    }))
    expect(row).toContain("mlx-community/Qwen3-32B-4bit")
    expect(row).toContain("16 GB")
    expect(row).toContain("fit:comfortable")
    expect(row).toContain("12.3k")
    expect(row).toContain("430")
    expect(row).toContain("apache-2.0")
  })

  it("tolerates missing fields", () => {
    const row = stripAnsi(formatResultRow({
      id: "a/b",
      tags: []
    }))
    expect(row).toContain("a/b")
    expect(row).toContain("?")
  })
})
