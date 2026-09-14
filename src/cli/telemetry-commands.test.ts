import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { cmdTelemetry } from "./telemetry-commands.js"
import { clearTelemetryHistory, saveTelemetryRecord } from "../supervisor/telemetry.js"
import type { TelemetryRecord } from "../types/index.js"

function makeRecord(overrides: Partial<TelemetryRecord> = {}): TelemetryRecord {
  return {
    id: "run-1",
    modelId: "org/test-model",
    slug: "test-model",
    runtime: "mlx",
    timestamp: 1710000000000,
    promptTokens: 100,
    generatedTokens: 50,
    generationThroughput: 45.5,
    promptThroughput: 120.0,
    timeToFirstTokenMs: 250,
    totalDurationMs: 1500,
    effectiveThroughput: 55.0,
    presetName: "balanced",
    quantization: "4bit",
    contextSize: 32768,
    contextUtilization: 0.15,
    peakMemoryBytes: 4 * 1024 ** 3,
    ...overrides
  }
}

describe("cmdTelemetry", () => {
  let logCalls: string[] = []

  beforeEach(() => {
    clearTelemetryHistory()
    logCalls = []
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logCalls.push(args.map(String).join(" "))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("clear subcommand", () => {
    it("clears telemetry history and prints confirmation", async () => {
      saveTelemetryRecord(makeRecord())
      await cmdTelemetry(["clear"])
      const output = logCalls.join("\n")
      expect(output).toContain("telemetry history cleared")
    })
  })

  describe("list / default subcommand", () => {
    it("prints empty message when no telemetry records exist", async () => {
      await cmdTelemetry([])
      const output = logCalls.join("\n")
      expect(output).toContain("no telemetry runs recorded yet")
    })

    it("prints table of recent runs when records exist", async () => {
      saveTelemetryRecord(makeRecord({ id: "run-1" }))
      saveTelemetryRecord(makeRecord({ id: "run-2", promptTokens: 200, generatedTokens: 100 }))

      await cmdTelemetry(["ls"])
      const output = logCalls.join("\n")
      expect(output).toContain("Recent runs")
      expect(output).toContain("test-model")
      expect(output).toContain("balanced")
      expect(output).toContain("45.5 tok/s")
    })
  })

  describe("compare subcommand", () => {
    it("prints message when no records exist", async () => {
      await cmdTelemetry(["compare"])
      const output = logCalls.join("\n")
      expect(output).toContain("no telemetry runs recorded yet")
    })

    it("computes grouped comparison matrix across runtimes and presets", async () => {
      saveTelemetryRecord(makeRecord({
        id: "run-1",
        presetName: "balanced",
        promptThroughput: 100,
        generationThroughput: 40,
        timeToFirstTokenMs: 200,
        totalDurationMs: 1000
      }))
      saveTelemetryRecord(makeRecord({
        id: "run-2",
        presetName: "fast",
        promptThroughput: 150,
        generationThroughput: 60,
        timeToFirstTokenMs: 100,
        totalDurationMs: 800
      }))

      await cmdTelemetry(["compare"])
      const output = logCalls.join("\n")
      expect(output).toContain("Comparative Performance Matrix")
      expect(output).toContain("test-model / mlx / balanced")
      expect(output).toContain("test-model / mlx / fast")
      expect(output).toContain("Runs")
    })
  })

  describe("show subcommand (by slug or id)", () => {
    it("warns when no history matches model slug or id", async () => {
      await cmdTelemetry(["unknown-slug"])
      const output = logCalls.join("\n")
      expect(output).toContain("no telemetry history found for model: unknown-slug")
    })

    it("displays detailed telemetry profile with runtime-specific and preset breakdowns", async () => {
      saveTelemetryRecord(makeRecord({
        id: "run-1",
        slug: "deepseek-r1",
        modelId: "deepseek-ai/r1",
        runtime: "llama.cpp",
        presetName: "balanced",
        runtimeSpecific: {
          llama: { speculativeAcceptanceRate: 42.5 }
        }
      }))
      saveTelemetryRecord(makeRecord({
        id: "run-2",
        slug: "deepseek-r1",
        modelId: "deepseek-ai/r1",
        runtime: "llama.cpp",
        presetName: "fast",
        runtimeSpecific: {
          mlx: { compilationTimeMs: 120.0 }
        }
      }))

      await cmdTelemetry(["deepseek-r1"])
      let output = logCalls.join("\n")
      expect(output).toContain("Telemetry Profile: deepseek-r1")
      expect(output).toContain("Runtime")
      expect(output).toContain("llama.cpp")
      expect(output).toContain("Averages & Latency Profiles")
      expect(output).toContain("Time to First Token (TTFT)")
      expect(output).toContain("Runtime-Specific Insights")
      expect(output).toContain("Speculative Accept Rate")
      expect(output).toContain("Compiler Warmup Time")
      expect(output).toContain("Performance by Preset")
      expect(output).toContain("balanced")
      expect(output).toContain("fast")

      // Only llama speculative accept rate (no MLX warmup)
      clearTelemetryHistory()
      saveTelemetryRecord(makeRecord({
        id: "run-spec-only",
        slug: "spec-model",
        runtimeSpecific: { llama: { speculativeAcceptanceRate: 50.0 } }
      }))
      logCalls = []
      await cmdTelemetry(["spec-model"])
      output = logCalls.join("\n")
      expect(output).toContain("Speculative Accept Rate")
      expect(output).not.toContain("Compiler Warmup Time")

      // Only MLX compilation time (no llama speculative rate)
      clearTelemetryHistory()
      saveTelemetryRecord(makeRecord({
        id: "run-mlx-only",
        slug: "mlx-model",
        runtimeSpecific: { mlx: { compilationTimeMs: 150.0 } }
      }))
      logCalls = []
      await cmdTelemetry(["mlx-model"])
      output = logCalls.join("\n")
      expect(output).toContain("Compiler Warmup Time")
      expect(output).not.toContain("Speculative Accept Rate")
    })

    it("handles minimal record with undefined optional fields and single preset", async () => {
      saveTelemetryRecord(makeRecord({
        id: "sparse-1",
        slug: "sparse-model",
        modelId: "sparse/model",
        runtime: "mlx",
        presetName: undefined,
        quantization: undefined,
        timeToFirstTokenMs: undefined,
        promptThroughput: undefined,
        contextSize: undefined,
        contextUtilization: undefined,
        peakMemoryBytes: undefined,
        runtimeSpecific: undefined
      }))

      // List subcommand with sparse record
      await cmdTelemetry(["ls"])
      let output = logCalls.join("\n")
      expect(output).toContain("sparse-model")
      expect(output).toContain("—")

      // Compare subcommand with sparse record
      logCalls = []
      await cmdTelemetry(["compare"])
      output = logCalls.join("\n")
      expect(output).toContain("(none)")
      expect(output).toContain("—")

      // Show subcommand with sparse record
      logCalls = []
      await cmdTelemetry(["sparse-model"])
      output = logCalls.join("\n")
      expect(output).toContain("Telemetry Profile: sparse-model")
      expect(output).toContain("Quantization unknown")
      expect(output).toContain("Prefill (Prompt) Speed  —")
      expect(output).toContain("Time to First Token (TTFT) —")
      expect(output).toContain("Context Window Size       —")
      expect(output).toContain("Context Utilization       —")
      expect(output).toContain("Process Memory (Avg/Peak) — / —")
      expect(output).not.toContain("Runtime-Specific Insights")
      expect(output).not.toContain("Performance by Preset")
    })
  })
})
