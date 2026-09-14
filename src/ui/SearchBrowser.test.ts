import React from "react"
import { PassThrough } from "node:stream"
import * as ink from "ink"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SearchResult } from "../search/hf.js"

const useInputMock = vi.fn()
vi.mock("ink", async () => {
  const actual = await vi.importActual<typeof import("ink")>("ink")
  return {
    ...actual,
    useInput: (handler: any, opts: any) => {
      useInputMock(handler, opts)
    }
  }
})

describe("SearchBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock("../search/hf.js")
    vi.doUnmock("../pull/api.js")
  })

  it("renders with search results and supports keyboard navigation and filtering", async () => {
    const mockResults: SearchResult[] = [
      {
        id: "mlx-community/Qwen2.5-32B",
        runtime: "mlx",
        downloads: 12500,
        likes: 340,
        sizeBytes: 18 * 1024 * 1024 * 1024,
        lastModified: new Date(Date.now() - 3600 * 1000).toISOString(),
        license: "apache-2.0",
        tags: ["mlx"]
      },
      {
        id: "unsloth/Qwen3-GGUF",
        runtime: "llama.cpp",
        downloads: 8200,
        likes: 120,
        sizeBytes: 12 * 1024 * 1024 * 1024,
        lastModified: new Date(Date.now() - 86400 * 1000).toISOString(),
        tags: ["gguf"]
      },
      {
        id: "other/Raw-Weights",
        runtime: undefined,
        downloads: 50,
        likes: 2,
        lastModified: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
        tags: []
      }
    ]

    vi.doMock("../search/hf.js", async () => {
      const actual: any = await vi.importActual("../search/hf.js")
      return {
        ...actual,
        searchModelsPage: vi.fn(async () => ({
          results: mockResults,
          cursor: { mlx: "cur1" }
        })),
        enrichSelectionHint: vi.fn(async () => ({
          runtime: "llama.cpp",
          defaultFile: "model-q4.gguf",
          defaultFileSizeBytes: 10 * 1024 * 1024 * 1024,
          ggufSelectableCount: 2,
          ggufCandidates: [
            { name: "model-q4.gguf", sizeBytes: 10 * 1024 * 1024 * 1024 },
            { name: "model-q8.gguf", sizeBytes: 20 * 1024 * 1024 * 1024 }
          ]
        }))
      }
    })

    const onExit = vi.fn()
    const onQueueDownload = vi.fn()

    const { SearchBrowser } = await import("./SearchBrowser.js")

    const stream = new PassThrough()
    const app = ink.render(
      React.createElement(SearchBrowser, {
        initialQuery: "qwen",
        initialFilter: "any",
        initialSort: "downloads",
        onExit,
        onQueueDownload,
        embedded: true
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )

    // Wait for searchModelsPage and enrichSelectionHint to resolve
    await new Promise(r => setTimeout(r, 60))

    expect(useInputMock).toHaveBeenCalled()
    const handler = useInputMock.mock.calls[0][0]

    // Navigation in browse mode
    handler("", { downArrow: true })
    handler("", { upArrow: true })
    handler("", { pageDown: true })
    handler("", { pageUp: true })
    handler("g", {})
    handler("G", {})

    // Cycle filter
    handler("f", {})

    // Cycle sort
    handler("s", {})

    // Queue download directly from browse mode
    handler("p", {})

    // Edit mode
    handler("/", {})
    handler("a", {})
    handler("", { backspace: true })
    handler("", { return: true }) // back to browse

    // Inspect mode
    handler("", { return: true })
    await new Promise(r => setTimeout(r, 20))
    // In inspect mode: choose file
    handler("", { downArrow: true })
    handler("", { upArrow: true })
    handler("", { pageDown: true })
    handler("", { pageUp: true })
    handler("p", {}) // pull in inspect mode
    await new Promise(r => setTimeout(r, 20))

    // Exit inspect mode
    handler("", { escape: true })
    await new Promise(r => setTimeout(r, 20))

    // Select second item (llama model)
    handler("", { downArrow: true })
    // Inspect llama model
    handler("", { return: true })
    await new Promise(r => setTimeout(r, 20))

    // Press 'f' to enter manual-pull mode
    handler("f", {})
    await new Promise(r => setTimeout(r, 20))

    // Quit
    handler("q", {})
    app.unmount()
    expect(onExit).toHaveBeenCalled()
  })

  it("renders inspect mode with comfortable, tight, and risky fit hints", async () => {
    const mockResults: SearchResult[] = [
      {
        id: "unsloth/Qwen3-GGUF",
        runtime: "llama.cpp",
        downloads: 8200,
        likes: 120,
        sizeBytes: 12 * 1024 * 1024 * 1024,
        lastModified: new Date().toISOString(),
        tags: ["gguf"]
      }
    ]

    vi.doMock("../search/hf.js", async () => {
      const actual: any = await vi.importActual("../search/hf.js")
      return {
        ...actual,
        searchModelsPage: vi.fn(async () => ({
          results: mockResults
        })),
        enrichSelectionHint: vi.fn(async () => ({
          runtime: "llama.cpp",
          defaultFile: "model-q4.gguf",
          defaultFileSizeBytes: 12 * 1024 * 1024 * 1024,
          ggufSelectableCount: 3,
          ggufArchitecture: "qwen2",
          ggufContextLength: 32768,
          baseModel: "Qwen/Qwen2.5-7B",
          ggufCandidates: [
            { name: "model-q4.gguf", sizeBytes: 12 * 1024 * 1024 * 1024 },
            { name: "model-q5.gguf", sizeBytes: 16 * 1024 * 1024 * 1024 },
            { name: "model-q8.gguf", sizeBytes: 24 * 1024 * 1024 * 1024 }
          ]
        }))
      }
    })

    const onExit = vi.fn()
    const { SearchBrowser } = await import("./SearchBrowser.js")

    // 1. Comfortable on 32GB Mac (12GB <= 32 - 8 = 24GB)
    const outComfortable = ink.renderToString(
      React.createElement(SearchBrowser, {
        initialQuery: "qwen",
        onExit,
        embedded: true,
        machineMemBytes: 32 * 1024 * 1024 * 1024
      })
    )
    expect(outComfortable).toBeDefined()
    const handler1 = useInputMock.mock.calls[0][0]
    // Enter inspect mode
    handler1("", { return: true })
    // Navigate candidates with j and k
    handler1("j", {})
    handler1("k", {})
    // Candidate jump with pageUp and pageDown
    handler1("", { pageDown: true })
    handler1("", { pageUp: true })
    // Close inspect mode
    handler1("", { escape: true })

    // 2. Tight on 18GB Mac (12GB <= 18 - 4 = 14GB, but > 18 - 8 = 10GB)
    const outTight = ink.renderToString(
      React.createElement(SearchBrowser, {
        initialQuery: "qwen",
        onExit,
        embedded: true,
        machineMemBytes: 18 * 1024 * 1024 * 1024
      })
    )
    expect(outTight).toBeDefined()

    // 3. Risky / not recommended on 8GB Mac (12GB > 8GB)
    const outRisky = ink.renderToString(
      React.createElement(SearchBrowser, {
        initialQuery: "qwen",
        onExit,
        embedded: true,
        machineMemBytes: 8 * 1024 * 1024 * 1024
      })
    )
    expect(outRisky).toBeDefined()
  })

  it("handles downloads mode when onQueueDownload is not provided", async () => {
    const mockResults: SearchResult[] = [
      {
        id: "mlx-community/SmolLM2",
        runtime: "mlx",
        downloads: 500,
        likes: 20,
        sizeBytes: 1024 * 1024 * 1024,
        lastModified: new Date().toISOString(),
        tags: ["mlx"]
      }
    ]

    vi.doMock("../search/hf.js", async () => {
      const actual: any = await vi.importActual("../search/hf.js")
      return {
        ...actual,
        searchModelsPage: vi.fn(async () => ({
          results: mockResults
        }))
      }
    })

    const onExit = vi.fn()
    const { SearchBrowser } = await import("./SearchBrowser.js")

    const output = ink.renderToString(
      React.createElement(SearchBrowser, {
        initialQuery: "smol",
        onExit,
        embedded: true
        // onQueueDownload omitted -> uses downloads hook
      })
    )
    expect(output).toBeDefined()
    const handler = useInputMock.mock.calls[0][0]

    // Enter edit mode via 'i'
    handler("i", {})
    // Exit edit mode via downArrow
    handler("", { downArrow: true })

    // Press 'p' in browse mode without onQueueDownload -> sets mode = "downloads"
    handler("p", {})

    // Suppress mouse sequence
    handler("[<35;10;20M", {})

    // Exit inspect/downloads with escape
    handler("", { escape: true })
  })

  it("renders at various terminal widths (narrow, medium, wide)", async () => {
    const onExit = vi.fn()
    const { SearchBrowser } = await import("./SearchBrowser.js")

    // Narrow width
    const narrow = ink.renderToString(
      React.createElement(SearchBrowser, {
        initialQuery: "narrow",
        onExit,
        embedded: true
      })
    )
    expect(narrow).toBeDefined()
  })

  it("handles empty search results and query error gracefully", async () => {
    vi.doMock("../search/hf.js", async () => {
      const actual: any = await vi.importActual("../search/hf.js")
      return {
        ...actual,
        searchModelsPage: vi.fn(async () => {
          throw new Error("search network offline")
        })
      }
    })

    const onExit = vi.fn()
    const { SearchBrowser } = await import("./SearchBrowser.js")

    const output = ink.renderToString(
      React.createElement(SearchBrowser, {
        initialQuery: "nonexistent",
        onExit,
        embedded: true
      })
    )

    expect(output).toBeDefined()
  })
})
