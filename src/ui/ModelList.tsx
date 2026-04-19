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

// Mid-string truncation with an ellipsis. Used to keep the slug
// column from overflowing into the next visual row, which would
// otherwise reflow every row below it on a narrow terminal.
function truncMid(s: string, max: number): string {
  if (s.length <= max) return s
  if (max <= 3) return s.slice(0, max)
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return s.slice(0, head) + "…" + s.slice(s.length - tail)
}

export interface ModelListProps {
  models: ModelEntry[]
  selectedIndex: number
  instances: Map<string, ActiveInstance>
  stats?: Map<string, InstanceStats>
  // Terminal width. When omitted we fall back to a generous default
  // so the existing tests (which don't pass cols) still render the
  // full slug uncut.
  cols?: number
}

export const ModelList: React.FC<ModelListProps> = ({
  models, selectedIndex, instances, stats, cols
}) => {
  if (models.length === 0) {
    return <Text dimColor>registry empty — press `p` to pull a model or `s` to scan</Text>
  }
  // Budget breakdown for fixed columns to the right of the slug:
  //   cursor 2 + status 2 + runtime 10 + ":port  " ~8 + "[pi] " 5
  //   + "pid xxxxx" ~10 + suffix (cpu/rss/tok·s) up to ~28.
  // We size the slug column to whatever's left, with a 12-char floor
  // so it stays readable on very narrow terminals.
  const FIXED_CHROME = 2 + 2 + 10 + 8 + 5 + 10
  const SUFFIX_MAX   = 28
  const width = cols ?? 200
  const slugBudget = Math.max(12, Math.min(40, width - FIXED_CHROME - SUFFIX_MAX))
  return (
    <Box flexDirection="column">
      {models.map((m, i) => {
        const inst = instances.get(m.id)
        const { ch, color } = statusIndicator(inst?.status)
        const selected = i === selectedIndex
        const suffix = inst ? runtimeSuffix(stats?.get(m.id)) : ""
        const slug = truncMid(m.slug, slugBudget).padEnd(slugBudget)
        return (
          <Box key={m.id} width={cols}>
            <Text color={selected ? "cyan" : undefined}>{selected ? "› " : "  "}</Text>
            <Text color={color}>{ch} </Text>
            <Text bold={selected} color={selected ? "cyan" : undefined}>
              {slug}
            </Text>
            <Text dimColor>{m.runtime.padEnd(10)}</Text>
            <Text>:{m.port}  </Text>
            <Text dimColor>{m.publish ? "[pi] " : "     "}</Text>
            <Text dimColor>{inst ? `pid ${inst.pid}` : ""}</Text>
            {suffix ? <Text dimColor wrap="truncate">  {suffix}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}
