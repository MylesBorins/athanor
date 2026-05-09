import { describe, it, expect, afterEach, vi } from "vitest"
import {
  fetchRepoInfo,
  fetchRepoTree,
  inferRuntimeFromRepo,
  listGgufFiles,
  type HfRepoInfo
} from "./api.js"

const realFetch = global.fetch

function mockFetch(body: unknown, ok = true, status = 200): void {
  global.fetch = vi.fn(async () => ({
    ok,
    status,
    json: async () => body
  } as unknown as Response))
}

describe("HF api helpers", () => {
  afterEach(() => { global.fetch = realFetch })

  describe("fetchRepoInfo", () => {
    it("returns id, tags, siblings from the HF API", async () => {
      mockFetch({
        id: "x/y",
        tags: ["mlx"],
        siblings: [{ rfilename: "config.json" }]
      })
      const info = await fetchRepoInfo("x/y")
      expect(info.id).toBe("x/y")
      expect(info.tags).toEqual(["mlx"])
      expect(info.siblings).toEqual([{ rfilename: "config.json", size: undefined }])
    })

    it("extracts cardData and gguf metadata when present", async () => {
      mockFetch({
        id: "x/y",
        tags: ["gguf"],
        siblings: [{ rfilename: "model.gguf", size: 123 }],
        cardData: { license: "apache-2.0", base_model: "base/model" },
        gguf: { architecture: "gemma4", context_length: 131072, totalFileSize: 456 }
      })
      const info = await fetchRepoInfo("x/y")
      expect(info.cardData).toEqual({ license: "apache-2.0", baseModel: "base/model" })
      expect(info.gguf).toEqual({ architecture: "gemma4", contextLength: 131072, totalFileSize: 456 })
    })

    it("throws when the API returns a non-OK status", async () => {
      mockFetch({}, false, 404)
      await expect(fetchRepoInfo("x/missing")).rejects.toThrow(/HF API 404/)
    })

    it("defaults tags and siblings to arrays when absent", async () => {
      mockFetch({ id: "x/y" })
      const info = await fetchRepoInfo("x/y")
      expect(info.tags).toEqual([])
      expect(info.siblings).toEqual([])
    })

    it("encodes the revision segment when provided", async () => {
      const spy = vi.fn(async (_input: unknown) => ({
        ok: true, status: 200, json: async () => ({ id: "x/y" })
      } as unknown as Response))
      global.fetch = spy as unknown as typeof fetch
      await fetchRepoInfo("x/y", "branch/with slash")
      const firstCall = spy.mock.calls[0]
      if (!firstCall) throw new Error("fetch was not called")
      const url = String(firstCall[0])
      expect(url).toContain("/revision/branch%2Fwith%20slash")
    })
  })

  describe("fetchRepoTree", () => {
    it("returns parsed tree entries with lfs sizes", async () => {
      mockFetch([
        { path: "model.safetensors", type: "file", size: 100, lfs: { size: 200 } },
        { path: "subdir", type: "directory", size: 0 }
      ])
      const tree = await fetchRepoTree("x/y")
      expect(tree).toEqual([
        { path: "model.safetensors", type: "file", size: 100, lfs: { size: 200 } },
        { path: "subdir", type: "directory", size: 0, lfs: undefined }
      ])
    })

    it("throws when the tree endpoint is non-OK", async () => {
      mockFetch({}, false, 401)
      await expect(fetchRepoTree("x/y")).rejects.toThrow(/HF tree 401/)
    })
  })

  describe("inferRuntimeFromRepo", () => {
    const base: HfRepoInfo = { id: "anonymous/repo", tags: [], siblings: [] }

    it("returns llama.cpp when any sibling is a gguf", () => {
      expect(inferRuntimeFromRepo({
        ...base,
        siblings: [{ rfilename: "model.safetensors" }, { rfilename: "q4.gguf" }]
      })).toBe("llama.cpp")
    })

    it("returns mlx when the tag list includes mlx", () => {
      expect(inferRuntimeFromRepo({
        ...base,
        tags: ["mlx"],
        siblings: [{ rfilename: "config.json" }]
      })).toBe("mlx")
    })

    it("returns mlx when the repo id contains mlx as a token", () => {
      expect(inferRuntimeFromRepo({
        ...base,
        id: "mlx-community/Something",
        siblings: [{ rfilename: "weights.safetensors" }]
      })).toBe("mlx")
    })

    it("falls back to mlx for safetensors-only repos", () => {
      expect(inferRuntimeFromRepo({
        ...base,
        id: "apple/qwen",
        siblings: [{ rfilename: "model.safetensors" }]
      })).toBe("mlx")
    })

    it("returns undefined when nothing matches", () => {
      expect(inferRuntimeFromRepo({
        ...base,
        siblings: [{ rfilename: "README.md" }]
      })).toBeUndefined()
    })
  })

  describe("listGgufFiles", () => {
    it("filters to .gguf siblings case-insensitively", () => {
      const files = listGgufFiles({
        id: "x/y",
        tags: [],
        siblings: [
          { rfilename: "Q4_K_M.gguf" },
          { rfilename: "readme.md" },
          { rfilename: "F16.GGUF" }
        ]
      })
      expect(files.map(f => f.rfilename).sort()).toEqual(["F16.GGUF", "Q4_K_M.gguf"])
    })
  })
})
