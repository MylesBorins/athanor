import React from "react"
import { Box, Text } from "ink"
import type { ActiveInstance, ModelEntry } from "../types/index.js"
import type { CompletionStats, ProcStats } from "../supervisor/metrics.js"
import { detectMachineProfile } from "../machine/profile.js"
import { buildRecommendation } from "../registry/recommend.js"

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

function displayName(m: ModelEntry): string {
  return m.source.type === "hf" ? m.source.repo : m.slug
}

function runtimeLabel(runtime: ModelEntry["runtime"]): { text: string; color: string } {
  if (runtime === "mlx") return { text: "mlx", color: "magenta" }
  return { text: "llama", color: "cyan" }
}

function recencyLabel(lastUsedAt?: number): string {
  if (!lastUsedAt) return "never"
  const deltaMs = Math.max(0, Date.now() - lastUsedAt)
  const minutes = Math.floor(deltaMs / 60000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  const years = Math.floor(days / 365)
  return `${years}y`
}

function truncEnd(s: string, max: number): string {
  if (s.length <= max) return s
  if (max <= 1) return s.slice(0, max)
  return s.slice(0, max - 1) + "…"
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
  compact?: boolean
}

export const ModelList: React.FC<ModelListProps> = ({
  models, selectedIndex, instances, stats, cols, compact = false
}) => {
  if (models.length === 0) {
    return <Text dimColor>registry empty — press `p` to pull a model or `s` to scan</Text>
  }
  const width = cols ?? 200
  const machine = detectMachineProfile()
  const tiny = compact || width < 90
  const narrow = width < 110
  const showRuntime = !tiny
  const showPort = !tiny
  const showRecency = !compact
  const showStats = !compact
  const FIXED_CHROME = 2 /* cursor */
    + 2 /* status */
    + (showRuntime ? 8 : 0)
    + (showPort ? 10 : 0)
    + (showRecency ? 8 : 0)
    + (showStats ? 16 : 0)
  const SUFFIX_MAX = showStats ? (narrow ? 12 : 22) : 0
  const nameBudget = Math.max(tiny ? 24 : 28, width - FIXED_CHROME - SUFFIX_MAX)
  return (
    <Box flexDirection="column">
      {models.map((m, i) => {
        const inst = instances.get(m.id)
        const { ch, color } = statusIndicator(inst?.status)
        const selected = i === selectedIndex
        const suffix = inst ? runtimeSuffix(stats?.get(m.id)) : ""
        const fit = buildRecommendation(m, machine).fitBand
        const fitBadge = fit === "comfortable" ? "C" : fit === "tight" ? "T" : "R"
        const fitColor = fit === "comfortable" ? "green" : fit === "tight" ? "yellow" : "red"
        const name = truncEnd(displayName(m), nameBudget).padEnd(nameBudget)
        const recency = recencyLabel(m.lastUsedAt).padStart(5)
        const runtime = runtimeLabel(m.runtime)
        const runtimeText = runtime.text.padEnd(5)
        const portText = `:${m.port}`.padEnd(7)
        return (
          <Box key={m.id} width={cols}>
            <Text color={selected ? "cyan" : undefined}>{selected ? "› " : "  "}</Text>
            <Text color={color}>{ch} </Text>
            <Text bold={selected} dimColor={!selected} color={selected ? "cyan" : undefined} wrap="truncate-end">
              {name}
            </Text>
            {!tiny ? <Text color={fitColor}>{` ${fitBadge}`}</Text> : null}
            {showRuntime ? <Text color={runtime.color}>{runtimeText}</Text> : null}
            {showPort ? <Text dimColor>{` · ${portText}`}</Text> : null}
            {showRecency ? <Text dimColor>{` · ${recency}`}</Text> : null}
            {showStats && inst ? <Text dimColor>{` · pid ${inst.pid}`}</Text> : null}
            {showStats && suffix ? <Text dimColor wrap="truncate">{` · ${suffix}`}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}
