import { describe, it, expect, beforeEach } from "vitest"
import {
  parseProcStats,
  parseCompletionStats,
  parseVmStat,
  sampleSystemStats,
  _resetMetricsState
} from "./metrics.js"

describe("parseProcStats", () => {
  it("parses multi-line ps output (pid, %cpu, rss-in-kb)", () => {
    const stdout = [
      "12345  34.2  1048576",
      "67890 412.7  4194304",
      ""
    ].join("\n")
    const stats = parseProcStats(stdout)
    expect(stats.size).toBe(2)
    expect(stats.get(12345)).toEqual({
      pid: 12345, cpuPct: 34.2, rssBytes: 1048576 * 1024
    })
    expect(stats.get(67890)).toEqual({
      pid: 67890, cpuPct: 412.7, rssBytes: 4194304 * 1024
    })
  })

  it("skips blank and malformed lines", () => {
    const stdout = "\n  \nthis is not a row\n12345 10.0 2048\n"
    const stats = parseProcStats(stdout)
    expect(stats.size).toBe(1)
    expect(stats.get(12345)?.cpuPct).toBe(10.0)
  })

  it("returns an empty map for empty input", () => {
    expect(parseProcStats("").size).toBe(0)
  })
})

describe("parseCompletionStats", () => {
  it("matches llama-server eval-time lines", () => {
    const chunk = [
      "slot launch: id 0",
      "prompt eval time =     432.21 ms /    15 tokens (   28.81 ms per token,    34.71 tokens per second)",
      "       eval time =   18341.23 ms /   412 tokens (   44.52 ms per token,    22.47 tokens per second)",
      "      total time =   18773.44 ms /   427 tokens"
    ].join("\n")
    const s = parseCompletionStats(chunk)
    expect(s).toMatchObject({ tokens: 412, tokPerSec: 22.47 })
    expect(s!.elapsedMs).toBeCloseTo(18341.23, 2)
  })

  it("does not pick up the llama prompt-eval line alone", () => {
    const chunk = "prompt eval time = 432.21 ms / 15 tokens ( 28.81 ms per token, 34.71 tokens per second)"
    expect(parseCompletionStats(chunk)).toBeNull()
  })

  it("matches mlx_lm Generation summary (tokens-per-sec spelling)", () => {
    const chunk = "INFO     Generation: 412 tokens, 22.47 tokens-per-sec"
    const s = parseCompletionStats(chunk)
    expect(s).toMatchObject({ tokens: 412, tokPerSec: 22.47 })
    expect(s!.elapsedMs).toBeCloseTo((412 / 22.47) * 1000, 0)
  })

  it("matches mlx_vlm Generation summary (tokens/sec spelling)", () => {
    const chunk = "Generation: 250 tokens in 12.1s (20.66 tokens/sec)"
    const s = parseCompletionStats(chunk)
    expect(s).toMatchObject({ tokens: 250, tokPerSec: 20.66 })
  })

  it("picks the most recent completion when both formats appear", () => {
    const chunk = [
      "       eval time =   10000.00 ms /   100 tokens (  100.00 ms per token,    10.00 tokens per second)",
      "Generation: 500 tokens, 50.00 tokens-per-sec"
    ].join("\n")
    const s = parseCompletionStats(chunk)
    expect(s).toMatchObject({ tokens: 500, tokPerSec: 50.0 })
  })

  it("picks the latest llama match when multiple appear (rolling tail)", () => {
    const chunk = [
      "       eval time =   10000.00 ms /   100 tokens (  100.00 ms per token,    10.00 tokens per second)",
      "       eval time =   20000.00 ms /   300 tokens (   66.66 ms per token,    15.00 tokens per second)"
    ].join("\n")
    const s = parseCompletionStats(chunk)
    expect(s).toMatchObject({ tokens: 300, tokPerSec: 15.0 })
  })

  it("returns null for chunks with no timing lines", () => {
    expect(parseCompletionStats("loading weights…\nserver listening on :8081")).toBeNull()
  })

  it("rejects zero-token or zero-rate lines", () => {
    const chunk = "       eval time =       0.00 ms /     0 tokens (    0.00 ms per token,     0.00 tokens per second)"
    expect(parseCompletionStats(chunk)).toBeNull()
  })
})

describe("sampleSystemStats", () => {
  beforeEach(() => { _resetMetricsState() })

  it("returns a well-formed snapshot on first call (cpuPct defaults to 0)", () => {
    const s = sampleSystemStats()
    expect(s.cpuCount).toBeGreaterThan(0)
    expect(s.totalMemBytes).toBeGreaterThan(0)
    expect(s.usedMemBytes).toBeGreaterThanOrEqual(0)
    expect(s.usedMemBytes).toBeLessThanOrEqual(s.totalMemBytes)
    expect(s.cpuPct).toBe(0)
    expect(typeof s.loadAvg1).toBe("number")
  })

  it("produces a cpuPct in [0,100] on the second call", () => {
    sampleSystemStats()
    // spin the event loop briefly so a non-zero cpu delta accumulates
    const end = Date.now() + 30
    while (Date.now() < end) { /* busy wait */ }
    const s = sampleSystemStats()
    expect(s.cpuPct).toBeGreaterThanOrEqual(0)
    expect(s.cpuPct).toBeLessThanOrEqual(100)
  })
})

describe("parseVmStat", () => {
  // Real sample from a 36 GB M-series Mac: pagesize 16k, ~18 GB in
  // active+wired+compressor, ~16 GB inactive (reclaimable cache).
  const SAMPLE = [
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
    "Pages free:                               90955.",
    "Pages active:                            906668.",
    "Pages inactive:                         1036665.",
    "Pages speculative:                         5540.",
    "Pages throttled:                              0.",
    "Pages wired down:                        170398.",
    "Pages purgeable:                          33048.",
    "Pages occupied by compressor:             88982.",
    ""
  ].join("\n")

  it("computes used as (active + wired + compressor) × pagesize", () => {
    const total = 36 * 1024 * 1024 * 1024
    const m = parseVmStat(SAMPLE, total)!
    expect(m.totalMemBytes).toBe(total)
    const expectedUsed = (906668 + 170398 + 88982) * 16384
    expect(m.usedMemBytes).toBe(expectedUsed)
    // inactive counts as available, not used
    const expectedFree = (90955 + 1036665 + 5540) * 16384
    expect(m.freeMemBytes).toBe(expectedFree)
  })

  it("never reports used > total", () => {
    const m = parseVmStat(SAMPLE, 1024)!
    expect(m.usedMemBytes).toBeLessThanOrEqual(1024)
    expect(m.freeMemBytes).toBeLessThanOrEqual(1024)
  })

  it("returns null when the page-size header is missing", () => {
    expect(parseVmStat("Pages free: 1.", 1024)).toBeNull()
  })
})
