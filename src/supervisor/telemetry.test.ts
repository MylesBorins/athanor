import { describe, it, expect, beforeEach } from "vitest"
import {
  parseLogTelemetry,
  loadTelemetryHistory,
  saveTelemetryRecord,
  clearTelemetryHistory
} from "./telemetry.js"
import type { TelemetryRecord } from "../types/index.js"

describe("parseLogTelemetry", () => {
  it("parses llama.cpp prefill and generation timing blocks", () => {
    const chunk = [
      "llama_print_timings: prompt eval time =     432.21 ms /    15 tokens (   28.81 ms per token,    34.71 tokens per second)",
      "llama_print_timings:        eval time =   18341.23 ms /   412 tokens (   44.52 ms per token,    22.47 tokens per second)",
      "llama_print_timings:       total time =   18773.44 ms /   427 tokens",
      "llama_print_timings:  spec acceptance =    32.5% ( 130/ 400)"
    ].join("\n")

    const s = parseLogTelemetry(chunk)
    expect(s.promptTokens).toBe(15)
    expect(s.promptThroughput).toBe(34.71)
    expect(s.generatedTokens).toBe(412)
    expect(s.generationThroughput).toBe(22.47)
    expect(s.speculativeAcceptanceRate).toBe(32.5)
  })

  it("parses newer llama.cpp real-time timing format", () => {
    const chunk = [
      "0.28.345.080 I slot print_timing: id  0 | task 0 | prompt processing, n_tokens =  21980, progress = 1.00, t =  26.29 s / 835.99 tokens per second",
      "0.31.553.653 I slot print_timing: id  0 | task 0 | n_decoded =    198, tg =  65.07 t/s, tg_3s =  65.07 t/s"
    ].join("\n")

    const s = parseLogTelemetry(chunk)
    expect(s.promptTokens).toBe(21980)
    expect(s.promptThroughput).toBe(835.99)
    expect(s.generatedTokens).toBe(198)
    expect(s.generationThroughput).toBe(65.07)
  })

  it("parses MLX generation timing summaries and compile times", () => {
    const chunk = [
      "Compiler compile time: 1420.5 ms",
      "Generation: 412 tokens, 22.47 tokens-per-sec"
    ].join("\n")

    const s = parseLogTelemetry(chunk)
    expect(s.generatedTokens).toBe(412)
    expect(s.generationThroughput).toBe(22.47)
    expect(s.compilationTimeMs).toBe(1420.5)
  })

  it("returns empty object for unrelated log lines", () => {
    const s = parseLogTelemetry("loading weights...\nlistening on 127.0.0.1:8080")
    expect(s).toEqual({})
  })
})

describe("telemetry persistence", () => {
  beforeEach(() => {
    clearTelemetryHistory()
  })

  it("saves and loads telemetry records successfully", () => {
    expect(loadTelemetryHistory()).toEqual([])

    const record: TelemetryRecord = {
      id: "run-1",
      modelId: "llama-3-8b-mlx",
      slug: "llama-3-8b",
      runtime: "mlx",
      timestamp: Date.now(),
      promptTokens: 10,
      generatedTokens: 20,
      generationThroughput: 25.0,
      totalDurationMs: 800,
      effectiveThroughput: 37.5
    }

    saveTelemetryRecord(record)
    const history = loadTelemetryHistory()
    expect(history.length).toBe(1)
    expect(history[0]).toEqual(record)
  })

  it("caps history at MAX_HISTORY_ITEMS", () => {
    for (let i = 0; i < 1010; i++) {
      const record: TelemetryRecord = {
        id: `run-${i}`,
        modelId: "llama-3-8b-mlx",
        slug: "llama-3-8b",
        runtime: "mlx",
        timestamp: Date.now(),
        promptTokens: 10,
        generatedTokens: 20,
        generationThroughput: 25.0,
        totalDurationMs: 800,
        effectiveThroughput: 37.5
      }
      saveTelemetryRecord(record)
    }

    const history = loadTelemetryHistory()
    expect(history.length).toBe(1000)
    // First item in history should be the last one inserted (run-1009)
    expect(history[0]?.id).toBe("run-1009")
  })
})
