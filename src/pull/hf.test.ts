import * as fs from "fs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PATHS } from "../config/index.js"
import { listModels, updateModel } from "../registry/index.js"

function reset(): void {
  try { fs.unlinkSync(PATHS.registry) } catch { /* not present */ }
}

describe("pull registry materialization", () => {
  beforeEach(() => {
    reset()
    vi.resetModules()
  })

  it("re-pull preserves slug, port, and user fields while refreshing mlx capabilities", async () => {
    vi.doMock("./api.js", () => ({
      fetchRepoInfo: vi.fn(async () => ({ id: "mlx-community/Test-4bit" })),
      inferRuntimeFromRepo: vi.fn(() => "mlx" as const),
      listGgufFiles: vi.fn()
    }))
    vi.doMock("./download.js", () => ({
      runHfDownload: vi.fn(async () => {}),
      resolveMlxSnapshot: vi.fn(() => "/cache/mlx/snap-1")
    }))
    vi.doMock("../discovery/scanner.js", async (importOriginal) => {
      const actual: any = await importOriginal()
      return {
        ...actual,
        detectMlxCapabilities: vi.fn(() => [])
      }
    })

    const mod = await import("./hf.js")
    const first = await mod.pull({ repo: "mlx-community/Test-4bit" })

    updateModel(first.entry.id, {
      publish: false,
      piAlias: "custom-alias",
      tags: ["coder"],
      preset: { runtime: "mlx", mlx: { decodeConcurrency: 8 } },
      mlxFlavor: "lm"
    })

    vi.doMock("./download.js", () => ({
      runHfDownload: vi.fn(async () => {}),
      resolveMlxSnapshot: vi.fn(() => "/cache/mlx/snap-2")
    }))
    vi.doMock("../discovery/scanner.js", async (importOriginal) => {
      const actual: any = await importOriginal()
      return {
        ...actual,
        detectMlxCapabilities: vi.fn(() => ["vlm"])
      }
    })
    vi.resetModules()

    const mod2 = await import("./hf.js")
    const second = await mod2.pull({ repo: "mlx-community/Test-4bit" })

    expect(second.entry.slug).toBe(first.entry.slug)
    expect(second.entry.port).toBe(first.entry.port)

    const entry = listModels()[0]!
    expect(entry.path).toBe("/cache/mlx/snap-2")
    expect(entry.publish).toBe(false)
    expect(entry.piAlias).toBe("custom-alias")
    expect(entry.tags).toEqual(["coder"])
    expect(entry.preset).toEqual({ runtime: "mlx", mlx: { decodeConcurrency: 8 } })
    expect(entry.mlxFlavor).toBe("lm")
    expect(entry.mlxCapabilities).toEqual(["vlm"])
  })

  it("fails instead of materializing the HF cache root when the MLX snapshot path cannot be resolved", async () => {
    vi.doMock("./api.js", () => ({
      fetchRepoInfo: vi.fn(async () => ({ id: "mlx-community/Test-4bit" })),
      inferRuntimeFromRepo: vi.fn(() => "mlx" as const),
      listGgufFiles: vi.fn()
    }))
    vi.doMock("./download.js", () => ({
      runHfDownload: vi.fn(async () => {}),
      resolveMlxSnapshot: vi.fn(() => null)
    }))
    vi.doMock("../discovery/scanner.js", async (importOriginal) => {
      const actual: any = await importOriginal()
      return {
        ...actual,
        detectMlxCapabilities: vi.fn(() => [])
      }
    })

    const mod = await import("./hf.js")
    await expect(mod.pull({ repo: "mlx-community/Test-4bit" }))
      .rejects.toThrow("could not resolve its local HF snapshot path")
    expect(listModels()).toEqual([])
  })

  it("uses the concrete downloaded MLX snapshot path instead of falling back to refs/main", async () => {
    vi.doMock("./api.js", () => ({
      fetchRepoInfo: vi.fn(async () => ({ id: "mlx-community/Test-4bit" })),
      inferRuntimeFromRepo: vi.fn(() => "mlx" as const),
      listGgufFiles: vi.fn()
    }))
    vi.doMock("./download.js", () => ({
      runHfDownload: vi.fn(async () => "/cache/mlx/revision-snap"),
      resolveMlxSnapshot: vi.fn(() => "/cache/mlx/main-snap")
    }))
    vi.doMock("../discovery/scanner.js", async (importOriginal) => {
      const actual: any = await importOriginal()
      return {
        ...actual,
        detectMlxCapabilities: vi.fn(() => [])
      }
    })

    const mod = await import("./hf.js")
    const pulled = await mod.pull({ repo: "mlx-community/Test-4bit", revision: "refs/pr/7" })

    expect(pulled.entry.path).toBe("/cache/mlx/revision-snap")
  })
})
