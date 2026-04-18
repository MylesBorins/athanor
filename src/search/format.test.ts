import { afterEach, describe, expect, it, vi } from "vitest"
import { formatCount, formatRelTime, formatResultRow } from "./format.js"
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
  it("includes the repo id, counts, license, and a relative time", () => {
    const row = stripAnsi(formatResultRow({
      id: "mlx-community/Qwen3-32B-4bit",
      tags: ["mlx", "license:apache-2.0"],
      downloads: 12_345,
      likes: 430,
      lastModified: new Date().toISOString(),
      runtime: "mlx",
      license: "apache-2.0"
    }))
    expect(row).toContain("mlx-community/Qwen3-32B-4bit")
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
