import { afterEach, describe, expect, it, vi } from "vitest"
import { groupByRuntime, searchModels } from "./hf.js"

function mockFetch(bodyFor: (url: string) => unknown): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    return new Response(JSON.stringify(bodyFor(url)), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  }))
}

describe("searchModels", () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it("sends mlx and gguf queries when filter is 'any', dedupes by id", async () => {
    const calls: string[] = []
    mockFetch(url => {
      calls.push(url)
      if (url.includes("filter=mlx")) {
        return [
          { id: "mlx-community/A", tags: ["mlx"], downloads: 100, likes: 10 },
          { id: "mlx-community/B", tags: ["mlx"], downloads: 50 }
        ]
      }
      if (url.includes("filter=gguf")) {
        return [
          { id: "bartowski/X-GGUF", tags: ["gguf"], downloads: 80 },
          { id: "mlx-community/A", tags: ["mlx", "gguf"], downloads: 100 }
        ]
      }
      return []
    })
    const r = await searchModels({ query: "foo" })
    expect(calls.length).toBe(2)
    expect(calls.every(u => u.includes("search=foo"))).toBe(true)
    const ids = r.map(x => x.id)
    expect(ids).toContain("mlx-community/A")
    expect(ids).toContain("mlx-community/B")
    expect(ids).toContain("bartowski/X-GGUF")
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("sends a single query when the filter is 'mlx'", async () => {
    const calls: string[] = []
    mockFetch(url => { calls.push(url); return [{ id: "a/b", tags: ["mlx"] }] })
    await searchModels({ filter: "mlx", query: "x" })
    expect(calls.length).toBe(1)
    expect(calls[0]).toContain("filter=mlx")
    expect(calls[0]).not.toContain("filter=gguf")
  })

  it("maps sort='trending' to trendingScore and sets direction=-1", async () => {
    const calls: string[] = []
    mockFetch(url => { calls.push(url); return [] })
    await searchModels({ filter: "mlx", sort: "trending" })
    expect(calls[0]).toContain("sort=trendingScore")
    expect(calls[0]).toContain("direction=-1")
  })

  it("requests expand[] for size-bearing fields and default metadata", async () => {
    const calls: string[] = []
    mockFetch(url => { calls.push(url); return [] })
    await searchModels({ filter: "mlx" })
    const u = calls[0]
    expect(u).toContain("expand%5B%5D=gguf")
    expect(u).toContain("expand%5B%5D=safetensors")
    expect(u).toContain("expand%5B%5D=downloads")
    expect(u).toContain("expand%5B%5D=likes")
    expect(u).toContain("expand%5B%5D=lastModified")
    expect(u).toContain("expand%5B%5D=tags")
  })

  it("derives sizeBytes from safetensors.parameters (MLX)", async () => {
    mockFetch(() => [{
      id: "mlx-community/Q",
      tags: ["mlx"],
      safetensors: { parameters: { BF16: 1_000_000_000, U32: 500_000_000 }, total: 9_000_000_000 }
    }])
    const r = await searchModels({ filter: "mlx" })
    // BF16: 1e9 * 2 = 2e9, U32: 5e8 * 4 = 2e9, total 4e9
    expect(r[0].sizeBytes).toBe(4_000_000_000)
  })

  it("derives sizeBytes from gguf.totalFileSize (llama.cpp)", async () => {
    mockFetch(() => [{
      id: "x/Y-GGUF",
      tags: ["gguf"],
      gguf: { totalFileSize: 807_694_112, total: 1_200_000_000 }
    }])
    const r = await searchModels({ filter: "gguf" })
    expect(r[0].sizeBytes).toBe(807_694_112)
  })

  it("leaves sizeBytes undefined when neither field is present", async () => {
    mockFetch(() => [{ id: "a/b", tags: [] }])
    const r = await searchModels({ filter: "mlx" })
    expect(r[0].sizeBytes).toBeUndefined()
  })

  it("extracts license from license:* tags and infers runtime", async () => {
    mockFetch(() => [
      { id: "mlx-community/Q", tags: ["mlx", "license:apache-2.0"], downloads: 1 },
      { id: "bartowski/G-GGUF", tags: ["gguf", "license:mit"], downloads: 1 }
    ])
    const r = await searchModels({ filter: "any" })
    const mlx = r.find(x => x.id === "mlx-community/Q")!
    const gg  = r.find(x => x.id === "bartowski/G-GGUF")!
    expect(mlx.runtime).toBe("mlx")
    expect(mlx.license).toBe("apache-2.0")
    expect(gg.runtime).toBe("llama.cpp")
    expect(gg.license).toBe("mit")
  })

  it("throws when the API returns a non-OK status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })))
    await expect(searchModels({ filter: "mlx" })).rejects.toThrow(/HF search 500/)
  })

  it("applies the limit after merging for filter='any'", async () => {
    mockFetch(url => {
      if (url.includes("filter=mlx")) {
        return Array.from({ length: 10 }, (_, i) => ({ id: `mlx/${i}`, tags: ["mlx"] }))
      }
      return Array.from({ length: 10 }, (_, i) => ({ id: `ggu/${i}`, tags: ["gguf"] }))
    })
    const r = await searchModels({ filter: "any", limit: 5 })
    expect(r.length).toBe(5)
  })
})

describe("groupByRuntime", () => {
  it("splits by runtime", () => {
    const g = groupByRuntime([
      { id: "a", tags: ["mlx"], runtime: "mlx" },
      { id: "b", tags: ["gguf"], runtime: "llama.cpp" },
      { id: "c", tags: [], runtime: undefined }
    ])
    expect(g.mlx.map(x => x.id)).toEqual(["a"])
    expect(g.gguf.map(x => x.id)).toEqual(["b"])
    expect(g.other.map(x => x.id)).toEqual(["c"])
  })
})
