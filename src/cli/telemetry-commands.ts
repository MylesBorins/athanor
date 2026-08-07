import { loadTelemetryHistory, clearTelemetryHistory } from "../supervisor/telemetry.js"
import { style, padEndVisual } from "./style.js"
import { head, dim, ok, info, warn } from "./shared.js"
import { formatBytes } from "./format.js"

export async function cmdTelemetry(args: string[]): Promise<void> {
  const sub = args[0]
  if (sub === "clear") {
    clearTelemetryHistory()
    ok("telemetry history cleared")
    return
  }
  if (sub === "compare") {
    cmdTelemetryCompare()
    return
  }
  if (sub && sub !== "ls") {
    // Treat as model slug/id
    cmdTelemetryShow(sub)
    return
  }
  cmdTelemetryList()
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, "0")
  const dateStr = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return `${timeStr} ${dateStr}`
}

function cmdTelemetryList(): void {
  const history = loadTelemetryHistory()
  if (history.length === 0) {
    info("no telemetry runs recorded yet. Send requests through Athanor router to generate data.")
    return
  }

  const limit = 20
  const total = history.length
  const displayed = history.slice(0, limit)

  head(`Recent runs (showing last ${displayed.length} of ${total} total)`)
  console.log("")

  const headers = [
    padEndVisual("Timestamp", 16),
    padEndVisual("Slug", 20),
    padEndVisual("Runtime", 10),
    padEndVisual("Preset", 12),
    padEndVisual("Prompt/Gen", 12),
    padEndVisual("TTFT", 8),
    padEndVisual("Total", 8),
    "Gen tps"
  ].join("  ")
  console.log(dim(headers))
  console.log(dim("—".repeat(95)))

  for (const r of displayed) {
    const timeStr = formatDate(r.timestamp)
    const promptGen = `${r.promptTokens}/${r.generatedTokens}`
    const ttft = r.timeToFirstTokenMs ? `${r.timeToFirstTokenMs.toFixed(0)}ms` : "—"
    const total = `${(r.totalDurationMs / 1000).toFixed(1)}s`
    const tps = `${r.generationThroughput.toFixed(1)} tok/s`
    const preset = r.presetName ?? "—"

    const line = [
      padEndVisual(timeStr, 16),
      padEndVisual(style.bold(r.slug), 20),
      padEndVisual(style.cyan(r.runtime), 10),
      padEndVisual(style.yellow(preset), 12),
      padEndVisual(promptGen, 12),
      padEndVisual(ttft, 8),
      padEndVisual(total, 8),
      tps
    ].join("  ")
    console.log(line)
  }
}

interface GroupStats {
  modelId: string
  slug: string
  runtime: string
  presetName: string
  runs: number
  totalPromptTps: number
  promptTpsCount: number
  totalGenTps: number
  totalTtft: number
  ttftCount: number
  totalDuration: number
}

function cmdTelemetryCompare(): void {
  const history = loadTelemetryHistory()
  if (history.length === 0) {
    info("no telemetry runs recorded yet.")
    return
  }

  const groups = new Map<string, GroupStats>()
  for (const r of history) {
    const preset = r.presetName ?? "(none)"
    const key = `${r.modelId}::${r.runtime}::${preset}`
    
    let stats = groups.get(key)
    if (!stats) {
      stats = {
        modelId: r.modelId,
        slug: r.slug,
        runtime: r.runtime,
        presetName: preset,
        runs: 0,
        totalPromptTps: 0,
        promptTpsCount: 0,
        totalGenTps: 0,
        totalTtft: 0,
        ttftCount: 0,
        totalDuration: 0
      }
      groups.set(key, stats)
    }

    stats.runs++
    if (r.promptThroughput) {
      stats.totalPromptTps += r.promptThroughput
      stats.promptTpsCount++
    }
    stats.totalGenTps += r.generationThroughput
    if (r.timeToFirstTokenMs) {
      stats.totalTtft += r.timeToFirstTokenMs
      stats.ttftCount++
    }
    stats.totalDuration += r.totalDurationMs
  }

  head("Comparative Performance Matrix")
  console.log("")

  const headers = [
    padEndVisual("Model / Runtime / Preset", 40),
    padEndVisual("Runs", 6),
    padEndVisual("Avg Prefill", 13),
    padEndVisual("Avg Gen", 12),
    padEndVisual("Avg TTFT", 10),
    "Avg Duration"
  ].join("  ")
  console.log(dim(headers))
  console.log(dim("—".repeat(95)))

  for (const s of groups.values()) {
    const label = `${s.slug} / ${s.runtime} / ${s.presetName}`
    const avgPrefill = s.promptTpsCount > 0 ? `${(s.totalPromptTps / s.promptTpsCount).toFixed(1)} tps` : "—"
    const avgGen = `${(s.totalGenTps / s.runs).toFixed(1)} tps`
    const avgTtft = s.ttftCount > 0 ? `${(s.totalTtft / s.ttftCount).toFixed(0)}ms` : "—"
    const avgDur = `${(s.totalDuration / s.runs / 1000).toFixed(2)}s`

    const line = [
      padEndVisual(label, 40),
      padEndVisual(String(s.runs), 6),
      padEndVisual(avgPrefill, 13),
      padEndVisual(avgGen, 12),
      padEndVisual(avgTtft, 10),
      avgDur
    ].join("  ")
    console.log(line)
  }
}

function cmdTelemetryShow(idOrSlug: string): void {
  const history = loadTelemetryHistory()
  const matching = history.filter(r => r.modelId === idOrSlug || r.slug === idOrSlug)

  if (matching.length === 0) {
    warn(`no telemetry history found for model: ${idOrSlug}`)
    return
  }

  const first = matching[0]!
  const slug = first.slug
  const runtime = first.runtime

  head(`Telemetry Profile: ${slug}`)
  console.log(`  ${dim("Runtime")}      ${runtime}`)
  console.log(`  ${dim("Quantization")} ${first.quantization ?? "unknown"}`)
  console.log(`  ${dim("Total Runs")}   ${matching.length}`)
  console.log("")

  // Compute stats
  let totalPromptTokens = 0
  let totalGenTokens = 0
  
  let totalTtft = 0
  let ttftCount = 0

  let totalPromptTps = 0
  let promptTpsCount = 0

  let totalGenTps = 0

  let totalDuration = 0
  let totalCtxSize = 0
  let totalCtxUtil = 0
  let ctxUtilCount = 0

  let totalMem = 0
  let maxMem = 0
  let memCount = 0

  let totalSpecAccept = 0
  let specAcceptCount = 0

  let totalCompileTime = 0
  let compileTimeCount = 0

  for (const r of matching) {
    totalPromptTokens += r.promptTokens
    totalGenTokens += r.generatedTokens
    totalDuration += r.totalDurationMs
    
    if (r.timeToFirstTokenMs) {
      totalTtft += r.timeToFirstTokenMs
      ttftCount++
    }
    if (r.promptThroughput) {
      totalPromptTps += r.promptThroughput
      promptTpsCount++
    }
    totalGenTps += r.generationThroughput
    if (r.contextSize) {
      totalCtxSize += r.contextSize
    }
    if (r.contextUtilization !== undefined) {
      totalCtxUtil += r.contextUtilization
      ctxUtilCount++
    }
    if (r.peakMemoryBytes) {
      totalMem += r.peakMemoryBytes
      maxMem = Math.max(maxMem, r.peakMemoryBytes)
      memCount++
    }

    if (r.runtimeSpecific?.llama?.speculativeAcceptanceRate !== undefined) {
      totalSpecAccept += r.runtimeSpecific.llama.speculativeAcceptanceRate
      specAcceptCount++
    }
    if (r.runtimeSpecific?.mlx?.compilationTimeMs !== undefined) {
      totalCompileTime += r.runtimeSpecific.mlx.compilationTimeMs
      compileTimeCount++
    }
  }

  const avgRuns = matching.length
  const avgPromptTokens = Math.round(totalPromptTokens / avgRuns)
  const avgGenTokens = Math.round(totalGenTokens / avgRuns)
  const avgTtft = ttftCount > 0 ? `${(totalTtft / ttftCount).toFixed(0)}ms` : "—"
  const avgPrefillSpeed = promptTpsCount > 0 ? `${(totalPromptTps / promptTpsCount).toFixed(1)} tok/s` : "—"
  const avgGenSpeed = `${(totalGenTps / avgRuns).toFixed(1)} tok/s`
  const avgDur = `${(totalDuration / avgRuns / 1000).toFixed(2)}s`
  const avgCtxUtil = ctxUtilCount > 0 ? `${((totalCtxUtil / ctxUtilCount) * 100).toFixed(2)}%` : "—"
  const avgMem = memCount > 0 ? formatBytes(totalMem / memCount) : "—"
  const peakMem = memCount > 0 ? formatBytes(maxMem) : "—"

  head("Averages & Latency Profiles")
  console.log(`  ${dim("Prefill (Prompt) Speed")}  ${style.cyan(avgPrefillSpeed)}`)
  console.log(`  ${dim("Decode (Generation) Speed")} ${style.cyan(avgGenSpeed)}`)
  console.log(`  ${dim("Time to First Token (TTFT)")} ${style.cyan(avgTtft)}`)
  console.log(`  ${dim("Total Request Duration")}     ${avgDur}`)
  console.log(`  ${dim("Prompt / Generated Tokens")} ${avgPromptTokens} / ${avgGenTokens}`)
  console.log(`  ${dim("Context Window Size")}       ${totalCtxSize > 0 ? Math.round(totalCtxSize / avgRuns) : "—"}`)
  console.log(`  ${dim("Context Utilization")}       ${avgCtxUtil}`)
  console.log(`  ${dim("Process Memory (Avg/Peak)")} ${avgMem} / ${peakMem}`)
  console.log("")

  // Runtime Specifics
  if (specAcceptCount > 0 || compileTimeCount > 0) {
    head("Runtime-Specific Insights")
    if (specAcceptCount > 0) {
      console.log(`  ${dim("Speculative Accept Rate")}   ${style.green((totalSpecAccept / specAcceptCount).toFixed(1) + "%")}`)
    }
    if (compileTimeCount > 0) {
      console.log(`  ${dim("Compiler Warmup Time")}      ${(totalCompileTime / compileTimeCount).toFixed(0)}ms`)
    }
    console.log("")
  }

  // Preset comparison breakdown
  const presetGroups = new Map<string, { count: number, totalGenTps: number }>()
  for (const r of matching) {
    const preset = r.presetName ?? "(none)"
    let pStats = presetGroups.get(preset)
    if (!pStats) {
      pStats = { count: 0, totalGenTps: 0 }
      presetGroups.set(preset, pStats)
    }
    pStats.count++
    pStats.totalGenTps += r.generationThroughput
  }

  if (presetGroups.size > 1) {
    head("Performance by Preset")
    for (const [name, stats] of presetGroups.entries()) {
      const avgTps = (stats.totalGenTps / stats.count).toFixed(1)
      console.log(`  ${padEndVisual(style.yellow(name), 16)}  ${style.cyan(avgTps + " tok/s")} ${dim(`(${stats.count} runs)`)}`)
    }
    console.log("")
  }
}
