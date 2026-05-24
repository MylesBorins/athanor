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

export function formatModelSize(sizeBytes?: number): string {
  if (!sizeBytes || sizeBytes <= 0) return ""
  const gb = sizeBytes / 1024 / 1024 / 1024
  return `${gb.toFixed(1)}G`
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

export function modelListParts(m: ModelEntry): { slug: string; repo?: string } {
  if (m.source.type === "hf") return { slug: m.slug, repo: m.source.repo }
  return { slug: m.slug }
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
  maxRows?: number
}

export const ModelList: React.FC<ModelListProps> = ({
  models, selectedIndex, instances, stats, cols, compact = false, maxRows
}) => {
  if (models.length === 0) {
    return <Text dimColor>registry empty — press `p` to pull a model or `s` to scan</Text>
  }
  const width = cols ?? 200
  const veryCompact = width < 96
  const tiny = compact || width < 90
  const narrow = width < 110
  const showRuntime = !veryCompact && !tiny
  const showPort = !veryCompact && !tiny
  const showRecency = !compact && !veryCompact
  const showStats = !compact && !veryCompact
  const showSize = !veryCompact && width >= 72
  const FIXED_CHROME = 2 /* cursor */
    + 2 /* status */
    + (showRuntime ? 8 : 0)
    + (showPort ? 10 : 0)
    + (showSize ? 8 : 0)
    + (showRecency ? 8 : 0)
    + (showStats ? 16 : 0)
  const SUFFIX_MAX = showStats ? (narrow ? 12 : 22) : 0
  const nameBudget = Math.max(veryCompact ? 40 : tiny ? 24 : 28, width - FIXED_CHROME - SUFFIX_MAX)
  const visibleModels = (() => {
    if (!maxRows || maxRows <= 0 || models.length <= maxRows) {
      return models.map((m, i) => ({ model: m, index: i }))
    }
    const half = Math.floor(maxRows / 2)
    let start = Math.max(0, selectedIndex - half)
    let end = Math.min(models.length, start + maxRows)
    start = Math.max(0, end - maxRows)
    return models.slice(start, end).map((model, offset) => ({ model, index: start + offset }))
  })()

  return (
    <Box flexDirection="column">
      {visibleModels.map(({ model: m, index: i }) => {
        const inst = instances.get(m.id)
        const { ch, color } = statusIndicator(inst?.status)
        const selected = i === selectedIndex
        const suffix = inst ? runtimeSuffix(stats?.get(m.id)) : ""
        const { slug, repo } = modelListParts(m)
        const repoReserve = repo ? Math.min(repo.length + 3, Math.max(14, Math.floor(nameBudget * 0.55))) : 0
        const slugBudget = Math.max(8, nameBudget - repoReserve)
        const slugText = truncEnd(slug, slugBudget)
        const repoBudget = Math.max(0, nameBudget - slugText.length - 3)
        const repoText = repo && repoBudget > 6 ? truncEnd(repo, repoBudget) : undefined
        const recency = recencyLabel(m.lastUsedAt).padStart(5)
        const runtime = runtimeLabel(m.runtime)
        const runtimeText = runtime.text.padEnd(5)
        const portText = `:${m.port}`.padEnd(7)
        const sizeText = formatModelSize(m.sizeBytes).padStart(5)
        return (
          <Box key={m.id} width={cols}>
            <Text color={selected ? "cyan" : undefined}>{selected ? "› " : "  "}</Text>
            <Text color={color}>{ch} </Text>
            <Text
              bold={selected}
              dimColor={!selected}
              color={selected ? "cyan" : undefined}
              wrap="truncate-end"
            >
              {(veryCompact || tiny) ? slugText : slugText.padEnd(slugBudget)}
            </Text>
            {repoText ? (
              <Text dimColor wrap="truncate-end">{` · ${repoText}`}</Text>
            ) : null}
            {showRuntime ? <Text color={runtime.color}>{runtimeText}</Text> : null}
            {showPort ? <Text dimColor>{` · ${portText}`}</Text> : null}
            {showSize ? <Text dimColor>{` · ${sizeText || "  ?  "}`}</Text> : null}
            {showRecency ? <Text dimColor>{` · ${recency}`}</Text> : null}
            {showStats && inst ? <Text dimColor>{` · pid ${inst.pid}`}</Text> : null}
            {showStats && suffix ? <Text dimColor wrap="truncate">{` · ${suffix}`}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}
