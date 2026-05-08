import { describe, it, expect, vi, beforeEach } from "vitest"

describe("detectMachineProfile", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("returns total memory in bytes and GiB", async () => {
    vi.doMock("os", () => ({
      default: {},
      totalmem: () => 16 * 1024 ** 3
    }))
    vi.doMock("child_process", () => ({
      execFileSync: () => "Apple M4\n"
    }))

    const mod = await import("./profile.js")
    const profile = mod.detectMachineProfile()

    expect(profile.totalMemoryBytes).toBe(16 * 1024 ** 3)
    expect(profile.totalMemoryGiB).toBe(16)
    expect(profile.chip).toBe("Apple M4")
  })

  it("falls back to null chip string when sysctl fails", async () => {
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
  })
})
