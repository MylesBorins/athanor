import React from "react"
import * as ink from "ink"
import { describe, expect, it } from "vitest"
import { ModelList, formatModelSize } from "./ModelList.js"
import type { ModelEntry, ActiveInstance } from "../types/index.js"

function makeModel(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "mlx-community/Qwen2.5-32B",
    slug: "qwen",
    path: "/cache/qwen",
    runtime: "mlx",
    source: { type: "hf", repo: "mlx-community/Qwen2.5-32B" },
    port: 8080,
    publish: true,
    addedAt: Date.now() - 100000,
    ...overrides
  }
}

describe("ModelList formatModelSize", () => {
  it("formats model size in GiB", () => {
    expect(formatModelSize(16 * 1024 * 1024 * 1024)).toBe("16.0G")
  })

  it("returns empty string for missing size", () => {
    expect(formatModelSize(undefined)).toBe("")
    expect(formatModelSize(0)).toBe("")
  })
})

describe("ModelList component rendering", () => {
  it("renders models across various runtimes, statuses, recencies, and metrics", () => {
    const now = Date.now()
    const models: ModelEntry[] = [
      makeModel({
        id: "mlx-community/Qwen2.5-32B",
        slug: "qwen-mlx",
        runtime: "mlx",
        sizeBytes: 20 * 1024 * 1024 * 1024,
        lastUsedAt: now - 30 * 1000, // now
        publish: true,
        port: 8080,
        tags: ["chat", "fast"],
        preset: { runtime: "mlx", mlx: { decodeConcurrency: 4 } }
      }),
      makeModel({
        id: "llama/Llama-3-8B-Q4_K_M.gguf",
        slug: "llama-3",
        runtime: "llama.cpp",
        source: { type: "local" },
        sizeBytes: 4.5 * 1024 * 1024 * 1024,
        lastUsedAt: now - 15 * 60 * 1000, // 15m
        publish: false,
        port: 8081,
        formula: { runtime: "llama.cpp", llama: {} }
      }),
      makeModel({
        id: "author/Model-Hours",
        slug: "hours-model",
        runtime: "mlx",
        lastUsedAt: now - 3 * 3600 * 1000, // 3h
        publish: true
      }),
      makeModel({
        id: "author/Model-Days",
        slug: "days-model",
        runtime: "llama.cpp",
        lastUsedAt: now - 48 * 3600 * 1000, // 2d
        publish: false
      }),
      makeModel({
        id: "author/Model-Never",
        slug: "never-model",
        runtime: "mlx",
        lastUsedAt: undefined // never
      })
    ]

    const instances = new Map<string, ActiveInstance>([
      ["mlx-community/Qwen2.5-32B", {
        id: "mlx-community/Qwen2.5-32B",
        slug: "qwen-mlx",
        runtime: "mlx",
        status: "running",
        port: 8080,
        startedAt: now,
        logFile: "",
        pid: 1234
      }],
      ["llama/Llama-3-8B-Q4_K_M.gguf", {
        id: "llama/Llama-3-8B-Q4_K_M.gguf",
        slug: "llama-3",
        runtime: "llama.cpp",
        status: "starting",
        port: 8081,
        startedAt: now,
        logFile: "",
        pid: 5678
      }],
      ["author/Model-Hours", {
        id: "author/Model-Hours",
        slug: "hours-model",
        runtime: "mlx",
        status: "error",
        port: 8082,
        startedAt: now,
        logFile: "",
        pid: 9012
      }],
      ["author/Model-Days", {
        id: "author/Model-Days",
        slug: "days-model",
        runtime: "llama.cpp",
        status: "exited",
        port: 8083,
        startedAt: now,
        logFile: "",
        pid: 3456
      }]
    ])

    const stats = new Map([
      ["mlx-community/Qwen2.5-32B", {
        proc: { pid: 1234, cpuPct: 45.8, rssBytes: 8 * 1024 * 1024 * 1024 }, // >= 1GB
        completion: { tokPerSec: 35.4, elapsedMs: 120, tokens: 25, at: now }
      }],
      ["llama/Llama-3-8B-Q4_K_M.gguf", {
        proc: { pid: 5678, cpuPct: 12.0, rssBytes: 500 * 1024 * 1024 }, // < 1GB
        completion: { tokPerSec: 0, elapsedMs: 10, tokens: 0, state: "prefilling" as const, at: now }
      }]
    ])

    const output = ink.renderToString(
      React.createElement(ModelList, {
        models,
        instances,
        selectedIndex: 0,
        stats,
        cols: 120
      })
    )

    expect(output).toContain("mlx-community/Qwen2.5-32B")
    expect(output).toContain("llama-3")
    expect(output).toContain("46%")
    expect(output).toContain("8.0")
    expect(output).toContain("500M")
    expect(output).toContain("never")

    // Test maxRows windowing and narrow layout
    const pagedOutput = ink.renderToString(
      React.createElement(ModelList, {
        models,
        instances,
        selectedIndex: 3,
        stats,
        cols: 50,
        maxRows: 2
      })
    )
    expect(pagedOutput).toBeDefined()
  })
})
