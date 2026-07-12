import React, { useMemo } from "react"
import { Box, Text, useInput } from "ink"
import type { ModelEntry } from "../types/index.js"
import { loadTelemetryHistory } from "../supervisor/telemetry.js"
import { formatBytes } from "../cli/format.js"

export interface TelemetryModalProps {
  entry: ModelEntry
  width?: number
  onClose: () => void
}

export const TelemetryModal: React.FC<TelemetryModalProps> = ({
  entry,
  width = 76,
  onClose
}) => {
  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === "t") {
      onClose()
    }
  })

  const history = useMemo(() => {
    const all = loadTelemetryHistory()
    return all.filter(r => r.modelId === entry.id || r.slug === entry.slug)
  }, [entry])

  const stats = useMemo(() => {
    if (history.length === 0) return null

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

    for (const r of history) {
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

    const runs = history.length
    return {
      runs,
      avgPromptTokens: Math.round(totalPromptTokens / runs),
      avgGenTokens: Math.round(totalGenTokens / runs),
      avgTtft: ttftCount > 0 ? `${(totalTtft / ttftCount).toFixed(0)}ms` : "—",
      avgPrefillSpeed: promptTpsCount > 0 ? `${(totalPromptTps / promptTpsCount).toFixed(1)} tok/s` : "—",
      avgGenSpeed: `${(totalGenTps / runs).toFixed(1)} tok/s`,
      avgDur: `${(totalDuration / runs / 1000).toFixed(2)}s`,
      avgCtxUtil: ctxUtilCount > 0 ? `${((totalCtxUtil / ctxUtilCount) * 100).toFixed(1)}%` : "—",
      avgMem: memCount > 0 ? formatBytes(totalMem / memCount) : "—",
      peakMem: memCount > 0 ? formatBytes(maxMem) : "—",
      specAcceptRate: specAcceptCount > 0 ? `${(totalSpecAccept / specAcceptCount).toFixed(1)}%` : null,
      compileTime: compileTimeCount > 0 ? `${(totalCompileTime / compileTimeCount).toFixed(0)}ms` : null
    }
  }, [history])

  // Get last 5 runs
  const recentRuns = useMemo(() => history.slice(0, 5), [history])

  // Format date
  const formatTime = (ts: number): string => {
    const d = new Date(ts)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  const innerWidth = width - 4

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="magenta"
      padding={1}
      width={width}
      backgroundColor="black"
    >
      <Text bold color="magenta" backgroundColor="black">Telemetry Profile: {entry.slug}</Text>
      <Text dimColor backgroundColor="black">Runtime: {entry.runtime}  ·  Quant: {entry.quantization ?? "unknown"}</Text>
      <Text backgroundColor="black"> </Text>

      {stats ? (
        <Box flexDirection="column" backgroundColor="black">
          <Box flexDirection="row" backgroundColor="black">
            <Box flexDirection="column" width={Math.floor(innerWidth / 2)} backgroundColor="black">
              <Text backgroundColor="black"><Text dimColor>Runs Recorded: </Text>{stats.runs}</Text>
              <Text backgroundColor="black"><Text dimColor>Avg Prefill: </Text><Text color="cyan">{stats.avgPrefillSpeed}</Text></Text>
              <Text backgroundColor="black"><Text dimColor>Avg Decode:  </Text><Text color="cyan">{stats.avgGenSpeed}</Text></Text>
              <Text backgroundColor="black"><Text dimColor>Avg TTFT:    </Text><Text color="cyan">{stats.avgTtft}</Text></Text>
            </Box>
            <Box flexDirection="column" width={Math.floor(innerWidth / 2)} backgroundColor="black">
              <Text backgroundColor="black"><Text dimColor>Avg Duration: </Text>{stats.avgDur}</Text>
              <Text backgroundColor="black"><Text dimColor>Ctx Util:     </Text>{stats.avgCtxUtil}</Text>
              <Text backgroundColor="black"><Text dimColor>Memory (Avg): </Text>{stats.avgMem}</Text>
              <Text backgroundColor="black"><Text dimColor>Memory (Peak):</Text>{stats.peakMem}</Text>
            </Box>
          </Box>

          {(stats.specAcceptRate || stats.compileTime) && (
            <>
              <Text backgroundColor="black"> </Text>
              <Box flexDirection="row" backgroundColor="black">
                {stats.specAcceptRate && <Text backgroundColor="black"><Text dimColor>Speculative Accept Rate: </Text><Text color="green">{stats.specAcceptRate}</Text>  </Text>}
                {stats.compileTime && <Text backgroundColor="black"><Text dimColor>Compiler Warmup Time: </Text><Text color="yellow">{stats.compileTime}</Text></Text>}
              </Box>
            </>
          )}

          <Text backgroundColor="black"> </Text>
          <Text bold color="magenta" backgroundColor="black">Recent runs</Text>
          <Box flexDirection="column" backgroundColor="black">
            <Text dimColor backgroundColor="black">
              {String("Time").padEnd(10)} {String("Tokens").padEnd(10)} {String("TTFT").padEnd(8)} {String("Duration").padEnd(10)} {String("Speed")}
            </Text>
            {recentRuns.map((r, i) => (
              <Text key={i} backgroundColor="black">
                {formatTime(r.timestamp).padEnd(10)}{" "}
                {`${r.promptTokens}/${r.generatedTokens}`.padEnd(10)}{" "}
                {r.timeToFirstTokenMs ? `${r.timeToFirstTokenMs.toFixed(0)}ms`.padEnd(8) : "—".padEnd(8)}{" "}
                {`${(r.totalDurationMs / 1000).toFixed(1)}s`.padEnd(10)}{" "}
                <Text color="cyan">{r.generationThroughput.toFixed(1)} tok/s</Text>
              </Text>
            ))}
          </Box>
        </Box>
      ) : (
        <Text dimColor backgroundColor="black">No telemetry history recorded for this model yet. Route requests through Athanor router to generate data.</Text>
      )}

      <Text backgroundColor="black"> </Text>
      <Text dimColor backgroundColor="black">Press Esc or 't' to close</Text>
    </Box>
  )
}
