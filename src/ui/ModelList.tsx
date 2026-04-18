import React from "react"
import { Box, Text } from "ink"
import type { ActiveInstance, ModelEntry } from "../types/index.js"
import type { CompletionStats, ProcStats } from "../supervisor/metrics.js"

function statusIndicator(status?: string): { ch: string; color: string } {
  switch (status) {
    case "running":  return { ch: "●", color: "green" }
    case "starting": return { ch: "◐", color: "yellow" }
    case "error":    return { ch: "✕", color: "red" }
    case "exited":   return { ch: "○", color: "gray" }
    default:         return { ch: "○", color: "gray" }
  }
}

export interface InstanceStats {
  proc?: ProcStats
  completion?: CompletionStats
}

function formatRss(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(1)}G`
  return `${(bytes / 1024 / 1024).toFixed(0)}M`
}

function runtimeSuffix(stats?: InstanceStats): string {
  if (!stats) return ""
  const parts: string[] = []
  if (stats.proc) {
    parts.push(`${stats.proc.cpuPct.toFixed(0)}%`)
    parts.push(formatRss(stats.proc.rssBytes))
  }
  if (stats.completion) parts.push(`${stats.completion.tokPerSec.toFixed(1)} tok/s`)
  return parts.join(" · ")
}

export interface ModelListProps {
  models: ModelEntry[]
  selectedIndex: number
  instances: Map<string, ActiveInstance>
  stats?: Map<string, InstanceStats>
}

export const ModelList: React.FC<ModelListProps> = ({ models, selectedIndex, instances, stats }) => {
  if (models.length === 0) {
    return <Text dimColor>registry empty — press `p` to pull a model or `s` to scan</Text>
  }
  return (
    <Box flexDirection="column">
      {models.map((m, i) => {
        const inst = instances.get(m.id)
        const { ch, color } = statusIndicator(inst?.status)
        const selected = i === selectedIndex
        const suffix = inst ? runtimeSuffix(stats?.get(m.id)) : ""
        return (
          <Box key={m.id}>
            <Text color={selected ? "cyan" : undefined}>{selected ? "› " : "  "}</Text>
            <Text color={color}>{ch} </Text>
            <Text bold={selected} color={selected ? "cyan" : undefined}>
              {m.slug.padEnd(26)}
            </Text>
            <Text dimColor>{m.runtime.padEnd(10)}</Text>
            <Text>:{m.port}  </Text>
            <Text dimColor>{m.publish ? "[pi] " : "     "}</Text>
            <Text dimColor>{inst ? `pid ${inst.pid}` : ""}</Text>
            {suffix ? <Text dimColor>  {suffix}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}
