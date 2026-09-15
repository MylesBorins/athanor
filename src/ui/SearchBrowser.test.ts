import React from "react"
import { PassThrough } from "node:stream"
import * as ink from "ink"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SearchResult } from "../search/hf.js"

let customStdin: any = null
const useInputMock = vi.fn()
vi.mock("ink", async () => {
  const actual = await vi.importActual<typeof import("ink")>("ink")
  return {
    ...actual,
    useInput: (handler: any, opts: any) => {
      useInputMock(handler, opts)
    },
    useStdin: () => {
      if (customStdin) return customStdin
      return actual.useStdin()
    }
  }
})

let lastPullModalProps: any = null
vi.mock("./PullModal.js", () => ({
  PullModal: (props: any) => {
    lastPullModalProps = props
    return React.createElement("pull-modal-stub", props)
  }
}))

function getHandler(): (input: string, key: any) => void {
  const calls = useInputMock.mock.calls
  return calls[calls.length - 1][0]
}

describe("SearchBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastPullModalProps = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock("../search/hf.js")
    vi.doUnmock("../pull/api.js")
  })

  it("renders with search results and supports keyboard navigation, filtering, sorting, and pagination", async () => {
    const mockResultsPage1: SearchResult[] = [
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

    const mockResultsPage2: SearchResult[] = [
      {
        id: "mlx-community/SmolLM2-135M",
        runtime: "mlx",
        downloads: 9000,
        likes: 400,
        sizeBytes: 500 * 1024 * 1024,
        lastModified: new Date().toISOString(),
        tags: ["mlx"]
      }
    ]

    vi.doMock("../search/hf.js", async () => {
      const actual: any = await vi.importActual("../search/hf.js")
      return {
        ...actual,
        searchModelsPage: vi.fn(async (_params: any, cur?: any) => {
          if (cur) {
            return { results: mockResultsPage2, cursor: undefined }
          }
          return { results: mockResultsPage1, cursor: { mlx: "page2" } }
        }),
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

    await new Promise(r => setTimeout(r, 60))
    expect(useInputMock).toHaveBeenCalled()

    // Navigation in browse mode
    getHandler()("", { downArrow: true })
    await new Promise(r => setTimeout(r, 20))
    getHandler()("", { upArrow: true })
    await new Promise(r => setTimeout(r, 20))
    getHandler()("", { pageDown: true })
    await new Promise(r => setTimeout(r, 20))
    getHandler()("", { pageUp: true })
    await new Promise(r => setTimeout(r, 20))
    getHandler()("g", {})
    await new Promise(r => setTimeout(r, 20))
    getHandler()("G", {})
    await new Promise(r => setTimeout(r, 40))

    // Queue download directly from browse mode
    getHandler()("p", {})
    expect(onQueueDownload).toHaveBeenCalled()

    // Cycle filter (any -> mlx -> gguf -> any)
    getHandler()("f", {})
    await new Promise(r => setTimeout(r, 40))
    getHandler()("f", {})
    await new Promise(r => setTimeout(r, 40))
    getHandler()("f", {})
    await new Promise(r => setTimeout(r, 40))

    // Cycle sort (downloads -> likes -> trending -> modified -> size -> fit)
    getHandler()("s", {})
    await new Promise(r => setTimeout(r, 40))
    getHandler()("s", {})
    await new Promise(r => setTimeout(r, 40))
    getHandler()("s", {})
    await new Promise(r => setTimeout(r, 40))
    getHandler()("s", {})
    await new Promise(r => setTimeout(r, 40))
    getHandler()("s", {})
    await new Promise(r => setTimeout(r, 40))
    getHandler()("s", {})
    await new Promise(r => setTimeout(r, 60))

    // Enter edit mode
    getHandler()("/", {})
    await new Promise(r => setTimeout(r, 20))
    getHandler()("a", {})
    getHandler()("b", { ctrl: true }) // ignored
    getHandler()("", { backspace: true })
    getHandler()("", { delete: true })
    getHandler()("", { return: true }) // back to browse
    await new Promise(r => setTimeout(r, 20))

    // Inspect mode on currently selected model
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 40))

    // In inspect mode: choose file
    getHandler()("", { downArrow: true })
    getHandler()("", { upArrow: true })
    getHandler()("j", {})
    getHandler()("k", {})
    getHandler()("", { pageDown: true })
    getHandler()("", { pageUp: true })
    getHandler()("p", {}) // pull in inspect mode
    await new Promise(r => setTimeout(r, 20))

    // Exit inspect mode
    getHandler()("", { escape: true })
    await new Promise(r => setTimeout(r, 20))

    // Quit
    getHandler()("q", {})
    app.unmount()
    expect(onExit).toHaveBeenCalled()
  })

  it("handles manual-pull workflow and PullModal callbacks", async () => {
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
        searchModelsPage: vi.fn(async () => ({ results: mockResults })),
        enrichSelectionHint: vi.fn(async () => ({
          runtime: "llama.cpp",
          defaultFile: "model-q4.gguf",
          ggufSelectableCount: 2,
          ggufCandidates: [
            { name: "model-q4.gguf", sizeBytes: 10 * 1024 * 1024 * 1024 }
          ]
        }))
      }
    })

    const onExit = vi.fn()
    const { SearchBrowser } = await import("./SearchBrowser.js")

    const stream = new PassThrough()
    const app = ink.render(
      React.createElement(SearchBrowser, {
        initialQuery: "qwen",
        onExit,
        embedded: true
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 60))

    // Enter inspect mode
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 30))

    // Press 'f' to enter manual-pull mode
    getHandler()("f", {})
    await new Promise(r => setTimeout(r, 30))
    expect(lastPullModalProps).not.toBeNull()

    // Test PullModal onDone with multi-file error (stays in manual-pull mode)
    lastPullModalProps.onDone("pull failed: Multiple GGUF files in unsloth/Qwen3-GGUF")
    await new Promise(r => setTimeout(r, 30))

    // Test PullModal onCancel (returns to browse mode)
    lastPullModalProps.onCancel()
    await new Promise(r => setTimeout(r, 30))

    // Re-enter manual-pull and test successful onDone
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 30))
    getHandler()("f", {})
    await new Promise(r => setTimeout(r, 30))
    expect(useInputMock).toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
    app.unmount()
  })

  it("renders inspect mode with comfortable, tight, and risky fit hints for GGUF and MLX", async () => {
    const mockResults: SearchResult[] = [
      {
        id: "mlx-community/Qwen2.5-MLX",
        runtime: "mlx",
        downloads: 9500,
        likes: 250,
        sizeBytes: 10 * 1024 * 1024 * 1024,
        lastModified: new Date().toISOString(),
        tags: ["mlx"]
      },
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
        searchModelsPage: vi.fn(async () => ({ results: mockResults })),
        enrichSelectionHint: vi.fn(async (r: SearchResult) => {
          if (r.runtime === "mlx") return { runtime: "mlx" as const }
          return {
            runtime: "llama.cpp",
            defaultFile: "model-q4.gguf",
            defaultFileSizeBytes: 12 * 1024 * 1024 * 1024,
            ggufTotalSizeBytes: 50 * 1024 * 1024 * 1024,
            ggufSelectableCount: 3,
            ggufArchitecture: "qwen2",
            ggufContextLength: 32768,
            baseModel: "Qwen/Qwen2.5-7B",
            ggufCandidates: [
              { name: "model-q4.gguf", sizeBytes: 12 * 1024 * 1024 * 1024 },
              { name: "model-q5.gguf", sizeBytes: 16 * 1024 * 1024 * 1024 },
              { name: "model-q8.gguf", sizeBytes: 24 * 1024 * 1024 * 1024 }
            ]
          }
        })
      }
    })

    const onExit = vi.fn()
    const { SearchBrowser } = await import("./SearchBrowser.js")

    // 1. Inspect MLX model
    const stream1 = new PassThrough()
    const app1 = ink.render(
      React.createElement(SearchBrowser, {
        initialQuery: "qwen",
        onExit,
        embedded: true,
        machineMemBytes: 32 * 1024 * 1024 * 1024
      }),
      { stdout: stream1 as any, stderr: stream1 as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 60))

    // MLX inspect
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 30))
    // Pull MLX from inspect
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 20))
    getHandler()("", { escape: true })
    await new Promise(r => setTimeout(r, 20))
    app1.unmount()

    // 2. Comfortable GGUF on 32GB Mac (12GB <= 32 - 8 = 24GB)
    const stream2 = new PassThrough()
    const app2 = ink.render(
      React.createElement(SearchBrowser, {
        initialQuery: "qwen",
        onExit,
        embedded: true,
        machineMemBytes: 32 * 1024 * 1024 * 1024
      }),
      { stdout: stream2 as any, stderr: stream2 as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 60))
    // Move to GGUF row
    getHandler()("", { downArrow: true })
    await new Promise(r => setTimeout(r, 20))
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 30))
    // Navigate candidates
    getHandler()("j", {})
    getHandler()("k", {})
    getHandler()("", { pageDown: true })
    getHandler()("", { pageUp: true })
    getHandler()("", { escape: true })
    await new Promise(r => setTimeout(r, 20))
    app2.unmount()

    // 3. Tight GGUF on 18GB Mac
    const stream3 = new PassThrough()
    const app3 = ink.render(
      React.createElement(SearchBrowser, {
        initialQuery: "qwen",
        onExit,
        embedded: true,
        machineMemBytes: 18 * 1024 * 1024 * 1024
      }),
      { stdout: stream3 as any, stderr: stream3 as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 60))
    getHandler()("", { downArrow: true })
    await new Promise(r => setTimeout(r, 20))
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 30))
    app3.unmount()

    // 4. Risky GGUF on 8GB Mac
    const stream4 = new PassThrough()
    const app4 = ink.render(
      React.createElement(SearchBrowser, {
        initialQuery: "qwen",
        onExit,
        embedded: true,
        machineMemBytes: 8 * 1024 * 1024 * 1024
      }),
      { stdout: stream4 as any, stderr: stream4 as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 60))
    getHandler()("", { downArrow: true })
    await new Promise(r => setTimeout(r, 20))
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 30))
    expect(useInputMock).toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
    app4.unmount()
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
        searchModelsPage: vi.fn(async () => ({ results: mockResults }))
      }
    })

    const onExit = vi.fn()
    const { SearchBrowser } = await import("./SearchBrowser.js")

    const stream = new PassThrough()
    const app = ink.render(
      React.createElement(SearchBrowser, {
        initialQuery: "smol",
        onExit,
        embedded: true
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 60))

    // Enter edit mode via 'i'
    getHandler()("i", {})
    await new Promise(r => setTimeout(r, 20))
    // Exit edit mode via downArrow
    getHandler()("", { downArrow: true })
    await new Promise(r => setTimeout(r, 20))

    // Enter edit mode via '/'
    getHandler()("/", {})
    await new Promise(r => setTimeout(r, 20))
    // Exit edit mode via escape
    getHandler()("", { escape: true })
    await new Promise(r => setTimeout(r, 20))

    // Press 'p' in browse mode without onQueueDownload -> sets mode = "downloads"
    getHandler()("p", {})
    await new Promise(r => setTimeout(r, 30))

    // Suppress mouse sequence
    getHandler()("[<35;10;20M", {})
    getHandler()("\x1b[<35;10;20M", {})

    expect(useInputMock).toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
    app.unmount()
  })

  it("filters already downloaded models and handles empty / error states", async () => {
    const mockResults: SearchResult[] = [
      {
        id: "already/downloaded-model",
        runtime: "mlx",
        downloads: 500,
        likes: 20,
        lastModified: new Date().toISOString(),
        tags: ["mlx"]
      },
      {
        id: "fresh/available-model",
        runtime: "mlx",
        downloads: 200,
        likes: 10,
        lastModified: new Date().toISOString(),
        tags: ["mlx"]
      }
    ]

    vi.doMock("../search/hf.js", async () => {
      const actual: any = await vi.importActual("../search/hf.js")
      return {
        ...actual,
        searchModelsPage: vi.fn(async () => ({ results: mockResults }))
      }
    })

    const onExit = vi.fn()
    const { SearchBrowser } = await import("./SearchBrowser.js")

    // Filter already-downloaded model
    const stream1 = new PassThrough()
    const app1 = ink.render(
      React.createElement(SearchBrowser, {
        initialQuery: "filter",
        onExit,
        embedded: true,
        models: [{ id: "already/downloaded-model" } as any]
      }),
      { stdout: stream1 as any, stderr: stream1 as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 60))
    app1.unmount()

    // Search query network error
    vi.doMock("../search/hf.js", async () => {
      const actual: any = await vi.importActual("../search/hf.js")
      return {
        ...actual,
        searchModelsPage: vi.fn(async () => {
          throw new Error("search network offline")
        })
      }
    })

    const stream2 = new PassThrough()
    const app2 = ink.render(
      React.createElement(SearchBrowser, {
        initialQuery: "error-query",
        onExit,
        embedded: true
      }),
      { stdout: stream2 as any, stderr: stream2 as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 60))
    app2.unmount()

    // Empty search results
    vi.doMock("../search/hf.js", async () => {
      const actual: any = await vi.importActual("../search/hf.js")
      return {
        ...actual,
        searchModelsPage: vi.fn(async () => ({ results: [] }))
      }
    })

    const stream3 = new PassThrough()
    const app3 = ink.render(
      React.createElement(SearchBrowser, {
        initialQuery: "empty-query",
        onExit,
        embedded: true
      }),
      { stdout: stream3 as any, stderr: stream3 as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 60))
    expect(onExit).not.toHaveBeenCalled()
    app3.unmount()
  })

  it("handles SGR mouse clicks for header sorting, row selection, and ignores invalid mouse events", async () => {
    const mockResults: SearchResult[] = [
      {
        id: "model/one",
        runtime: "mlx",
        downloads: 100,
        likes: 10,
        sizeBytes: 1024 * 1024 * 1024,
        lastModified: new Date().toISOString(),
        tags: ["mlx"]
      },
      {
        id: "model/two",
        runtime: "llama.cpp",
        downloads: 200,
        likes: 20,
        sizeBytes: 2 * 1024 * 1024 * 1024,
        lastModified: new Date().toISOString(),
        tags: ["gguf"]
      }
    ]

    vi.doMock("../search/hf.js", async () => {
      const actual: any = await vi.importActual("../search/hf.js")
      return {
        ...actual,
        searchModelsPage: vi.fn(async () => ({ results: mockResults })),
        enrichSelectionHint: vi.fn(async () => ({ runtime: "llama.cpp" }))
      }
    })

    const onExit = vi.fn()
    const { SearchBrowser } = await import("./SearchBrowser.js")

    const stdinStream = new PassThrough()
    customStdin = {
      stdin: stdinStream,
      setRawMode: vi.fn(),
      isRawModeSupported: true
    }

    const stdoutStream = new PassThrough()
    ;(stdoutStream as any).columns = 130
    ;(stdoutStream as any).rows = 30

    const app = ink.render(
      React.createElement(SearchBrowser, {
        initialQuery: "mouse",
        onExit,
        embedded: false
      }),
      {
        stdin: stdinStream as any,
        stdout: stdoutStream as any,
        stderr: stdoutStream as any,
        patchConsole: false
      }
    )
    await new Promise(r => setTimeout(r, 60))

    // Click on header sort column "size" (x = 76, y = 4)
    stdinStream.emit("data", Buffer.from("\x1b[<0;76;4M"))
    await new Promise(r => setTimeout(r, 30))

    // Click on header non-sort column "rt" (x = 68, y = 4)
    stdinStream.emit("data", Buffer.from("\x1b[<0;68;4M"))
    await new Promise(r => setTimeout(r, 20))

    // Click on row 0 (y = 5, x = 20)
    stdinStream.emit("data", Buffer.from("\x1b[<0;20;5M"))
    await new Promise(r => setTimeout(r, 20))

    // Click on row 1 (y = 6, x = 20)
    stdinStream.emit("data", Buffer.from("\x1b[<0;20;6M"))
    await new Promise(r => setTimeout(r, 20))

    // Click on out of range rows (y = 2, y = 99)
    stdinStream.emit("data", Buffer.from("\x1b[<0;20;2M"))
    stdinStream.emit("data", Buffer.from("\x1b[<0;20;99M"))

    // Emit release event (m instead of M) - should be ignored
    stdinStream.emit("data", Buffer.from("\x1b[<0;20;5m"))

    // Emit mouse wheel event (cb = 64) - should be ignored
    stdinStream.emit("data", Buffer.from("\x1b[<64;20;5M"))

    // Emit right click (cb = 2) - should be ignored
    stdinStream.emit("data", Buffer.from("\x1b[<2;20;5M"))

    // Emit stdout resize event
    stdoutStream.emit("resize")

    // Keystrokes within 20ms of a mouse sequence are suppressed
    getHandler()("q", {})
    expect(onExit).not.toHaveBeenCalled()

    // Wait past the 20ms mouse debounce window
    await new Promise(r => setTimeout(r, 60))

    // Clean exit
    getHandler()("q", {})
    expect(onExit).toHaveBeenCalled()
    app.unmount()
    customStdin = null
  })

  it("handles background batch enrichment for MLX without sizeBytes and GGUF models", async () => {
    const mockResults: SearchResult[] = [
      {
        id: "mlx-community/No-Size-Model",
        runtime: "mlx",
        downloads: 100,
        likes: 5,
        // sizeBytes undefined triggers fetchRepoTree
        lastModified: new Date().toISOString(),
        tags: ["mlx"]
      },
      {
        id: "unsloth/Qwen-GGUF-Model",
        runtime: "llama.cpp",
        downloads: 200,
        likes: 10,
        lastModified: new Date().toISOString(),
        tags: ["gguf"]
      }
    ]

    vi.doMock("../search/hf.js", async () => {
      const actual: any = await vi.importActual("../search/hf.js")
      return {
        ...actual,
        searchModelsPage: vi.fn(async () => ({ results: mockResults })),
        enrichSelectionHint: vi.fn(async () => ({
          runtime: "llama.cpp",
          defaultFile: "model.gguf"
        }))
      }
    })

    vi.doMock("../pull/api.js", async () => {
      return {
        fetchRepoTree: vi.fn(async () => [
          { type: "file", path: "model.safetensors", size: 4 * 1024 * 1024 * 1024 },
          { type: "file", path: "config.json", size: 1024 }
        ])
      }
    })

    const onExit = vi.fn()
    const { SearchBrowser } = await import("./SearchBrowser.js")

    const stream = new PassThrough()
    const app = ink.render(
      React.createElement(SearchBrowser, {
        initialQuery: "batch",
        onExit,
        embedded: true
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 80))

    expect(useInputMock).toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
    app.unmount()
  })

  it("handles narrow terminal width and truncMid edge branches", async () => {
    const mockResults: SearchResult[] = [
      {
        id: "mlx-community/A-Very-Long-Model-Name-That-Exceeds-Narrow-Width",
        runtime: "mlx",
        downloads: 100,
        likes: 5,
        lastModified: new Date().toISOString(),
        tags: ["mlx"]
      }
    ]

    vi.doMock("../search/hf.js", async () => {
      const actual: any = await vi.importActual("../search/hf.js")
      return {
        ...actual,
        searchModelsPage: vi.fn(async () => ({ results: mockResults }))
      }
    })

    const onExit = vi.fn()
    const { SearchBrowser } = await import("./SearchBrowser.js")

    // Very narrow width (cols = 16)
    const stdoutStream = new PassThrough()
    ;(stdoutStream as any).columns = 16
    ;(stdoutStream as any).rows = 20

    const app = ink.render(
      React.createElement(SearchBrowser, {
        initialQuery: "narrow",
        onExit,
        embedded: true
      }),
      { stdout: stdoutStream as any, stderr: stdoutStream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 60))

    expect(useInputMock).toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
    app.unmount()
  })

  it("handles enrichSelectionHint rejection gracefully", async () => {
    const mockResults: SearchResult[] = [
      {
        id: "unsloth/Qwen-Failed-Hint",
        runtime: "llama.cpp",
        downloads: 100,
        likes: 5,
        lastModified: new Date().toISOString(),
        tags: ["gguf"]
      }
    ]

    vi.doMock("../search/hf.js", async () => {
      const actual: any = await vi.importActual("../search/hf.js")
      return {
        ...actual,
        searchModelsPage: vi.fn(async () => ({ results: mockResults })),
        enrichSelectionHint: vi.fn(async () => {
          throw new Error("network failed to inspect GGUF")
        })
      }
    })

    const onExit = vi.fn()
    const { SearchBrowser } = await import("./SearchBrowser.js")

    const stream = new PassThrough()
    const app = ink.render(
      React.createElement(SearchBrowser, {
        initialQuery: "fail-hint",
        onExit,
        embedded: true
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 60))

    // Enter inspect mode to check fallback selectionHint
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 30))

    expect(useInputMock).toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
    app.unmount()
  })
})
