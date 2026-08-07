import { describe, it, expect, vi, beforeEach } from "vitest"
import { estimateMemoryBandwidth } from "./profile.js"

describe("detectMachineProfile", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("populates profile fields accurately when sysctl brand_string succeeds", async () => {
    vi.doMock("os", () => ({
      default: {},
      totalmem: () => 16 * 1024 ** 3
    }))
    vi.doMock("child_process", () => ({
      execFileSync: () => "Apple M3 Pro\n"
    }))

    const mod = await import("./profile.js")
    const profile = mod.detectMachineProfile()

    expect(profile.totalMemoryBytes).toBe(16 * 1024 ** 3)
    expect(profile.totalMemoryGiB).toBe(16)
    expect(profile.chip).toBe("Apple M3 Pro")
    expect(profile.memoryBandwidthGBs).toBe(150.0)
  })

  it("falls back to null chip string and undefined bandwidth when sysctl fails", async () => {
    vi.doMock("os", () => ({
      default: {},
      totalmem: () => 8 * 1024 ** 3
    }))
    vi.doMock("child_process", () => ({
      execFileSync: () => { throw new Error("no sysctl") }
    }))

    const mod = await import("./profile.js")
    const profile = mod.detectMachineProfile()

    expect(profile.totalMemoryGiB).toBe(8)
    expect(profile.chip).toBeNull()
    expect(profile.memoryBandwidthGBs).toBeUndefined()
  })
})

describe("estimateMemoryBandwidth", () => {
  it("estimates memory bandwidth for Apple Silicon chip generations", () => {
    expect(estimateMemoryBandwidth("Apple M1")).toBe(68.25)
    expect(estimateMemoryBandwidth("Apple M2 Pro")).toBe(200.0)
    expect(estimateMemoryBandwidth("Apple M3 Max")).toBe(400.0)
    expect(estimateMemoryBandwidth("Apple M4")).toBe(120.0)
    expect(estimateMemoryBandwidth("Apple M4 Ultra")).toBe(819.2)
  })

  it("returns undefined for null or unknown chips", () => {
    expect(estimateMemoryBandwidth(null)).toBeUndefined()
    expect(estimateMemoryBandwidth("Generic x86_64 CPU")).toBeUndefined()
  })
})
