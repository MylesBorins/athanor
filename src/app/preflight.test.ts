import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ModelEntry } from "../types/index.js"

function entry(): ModelEntry {
  return {
    id: "mlx-community/A",
    slug: "a",
    path: "/cache/a",
    runtime: "mlx",
    source: { type: "hf", repo: "mlx-community/A" },
    port: 8081,
    publish: true,
    piAlias: "a",
    addedAt: 0,
    sizeBytes: 2 * 1024 ** 3
  }
}

describe("buildStartPreflight", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("warns when projected usage crosses the warning threshold", async () => {
    vi.doMock("../supervisor/metrics.js", () => ({
      sampleSystemStats: () => ({
        cpuPct: 0,
        totalMemBytes: 16 * 1024 ** 3,
        usedMemBytes: 10 * 1024 ** 3,
        freeMemBytes: 6 * 1024 ** 3,
        loadAvg1: 0,
        cpuCount: 10
      })
    }))
    vi.doMock("../registry/recommend.js", () => ({
      buildRecommendation: () => ({
        estimatedFootprintGiB: 3,
        fitBand: "tight",
        recommendedContext: 8192,
        recommendedContextNote: "test",
        confidence: "medium",
        explanation: "test"
      })
    }))

    const { buildStartPreflight } = await import("./preflight.js")
    const res = buildStartPreflight(entry(), {
      chip: "Apple Silicon",
      totalMemoryBytes: 16 * 1024 ** 3,
      totalMemoryGiB: 16
    })

    expect(res.shouldWarn).toBe(true)
    expect(res.shouldStrongWarn).toBe(false)
    expect(res.projectedUsedGiB).toBeCloseTo(13, 5)
  })

  it("strong-warns when projected usage crosses the strong threshold", async () => {
    vi.doMock("../supervisor/metrics.js", () => ({
      sampleSystemStats: () => ({
        cpuPct: 0,
        totalMemBytes: 16 * 1024 ** 3,
        usedMemBytes: 12 * 1024 ** 3,
        freeMemBytes: 4 * 1024 ** 3,
        loadAvg1: 0,
        cpuCount: 10
      })
    }))
    vi.doMock("../registry/recommend.js", () => ({
      buildRecommendation: () => ({
        estimatedFootprintGiB: 2,
        fitBand: "risky",
        recommendedContext: 4096,
        recommendedContextNote: "test",
        confidence: "medium",
        explanation: "test"
      })
    }))

    const { buildStartPreflight } = await import("./preflight.js")
    const res = buildStartPreflight(entry(), {
      chip: "Apple Silicon",
      totalMemoryBytes: 16 * 1024 ** 3,
      totalMemoryGiB: 16
    })

    expect(res.shouldWarn).toBe(true)
    expect(res.shouldStrongWarn).toBe(true)
    expect(res.projectedUsedGiB).toBeCloseTo(14, 5)
  })
})
