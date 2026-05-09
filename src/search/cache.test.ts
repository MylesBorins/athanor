import * as fs from "fs"
import * as path from "path"
import { beforeEach, describe, expect, it } from "vitest"
import { PATHS } from "../config/index.js"
import { loadRepoHintCache, saveRepoHint } from "./cache.js"

const CACHE_FILE = path.join(PATHS.base, "cache", "search-repo-hints.json")

function clearCache(): void {
  fs.rmSync(path.dirname(CACHE_FILE), { recursive: true, force: true })
}

describe("search repo hint cache", () => {
  beforeEach(() => {
    clearCache()
  })

  it("loads empty cache when no file exists", () => {
    expect(loadRepoHintCache()).toEqual({})
  })

  it("saves and reloads repo hints", () => {
    saveRepoHint("foo/bar", {
      runtime: "llama.cpp",
      defaultFile: "model-Q4_K_M.gguf",
      defaultFileSizeBytes: 1234,
      ggufSelectableCount: 2
    })

    expect(loadRepoHintCache()).toEqual({
      "foo/bar": {
        runtime: "llama.cpp",
        defaultFile: "model-Q4_K_M.gguf",
        defaultFileSizeBytes: 1234,
        ggufSelectableCount: 2
      }
    })
  })

  it("evicts stale repo hints on load", () => {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      version: 1,
      repos: {
        "fresh/repo": {
          hint: { runtime: "mlx", ggufTotalSizeBytes: 42 },
          updatedAt: Date.now()
        },
        "stale/repo": {
          hint: { runtime: "llama.cpp", defaultFile: "old.gguf" },
          updatedAt: Date.now() - 8 * 24 * 60 * 60 * 1000
        }
      }
    }, null, 2), "utf8")

    expect(loadRepoHintCache()).toEqual({
      "fresh/repo": {
        runtime: "mlx",
        ggufTotalSizeBytes: 42
      }
    })
  })
})
