import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { detectMachineProfile, estimateMemoryBandwidth } from "./profile.js"

describe("detectMachineProfile (real environment)", () => {
  it("returns valid memory and chip profile for the current platform", () => {
    const profile = detectMachineProfile()
    expect(profile.totalMemoryBytes).toBeGreaterThan(0)
    expect(profile.totalMemoryGiB).toBeGreaterThan(0)
    expect(profile.memoryBandwidthGBs).toBe(estimateMemoryBandwidth(profile.chip))
    if (process.platform === "darwin") {
      expect(typeof profile.chip === "string" || profile.chip === null).toBe(true)
    } else {
      expect(profile.chip).toBeNull()
    }
  })
})

describe("detectMachineProfile (mocked Darwin platform)", () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform })
  })

  it("populates chip and memory fields on darwin when sysctl succeeds", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" })
    vi.doMock("os", () => ({
      default: {},
      totalmem: () => 16 * 1024 ** 3
    }))
    vi.doMock("child_process", () => ({
      execFileSync: () => "Apple Silicon Mock\n"
    }))

    const mod = await import("./profile.js")
    const profile = mod.detectMachineProfile()

    expect(profile.totalMemoryBytes).toBe(16 * 1024 ** 3)
    expect(profile.totalMemoryGiB).toBe(16)
    expect(profile.chip).toBe("Apple Silicon Mock")
  })

  it("returns null chip string when on non-darwin platforms like Linux", async () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    vi.doMock("os", () => ({
      default: {},
      totalmem: () => 16 * 1024 ** 3
    }))
    vi.doMock("child_process", () => ({
      execFileSync: () => "Intel Core i9\n"
    }))

    const mod = await import("./profile.js")
    const profile = mod.detectMachineProfile()

    expect(profile.totalMemoryGiB).toBe(16)
    expect(profile.chip).toBeNull()
    expect(profile.memoryBandwidthGBs).toBeUndefined()
  })

  it("falls back to null chip string when sysctl fails on darwin", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" })
    vi.doMock("os", () => ({
      default: {},
      totalmem: () => 8 * 1024 ** 3
    }))
    vi.doMock("child_process", () => ({
      execFileSync: () => { throw new Error("sysctl failed") }
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

  it("returns undefined for null or non-Apple chips", () => {
    expect(estimateMemoryBandwidth(null)).toBeUndefined()
    expect(estimateMemoryBandwidth("Generic x86_64 CPU")).toBeUndefined()
  })
})
