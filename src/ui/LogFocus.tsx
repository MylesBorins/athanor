import React, { useEffect, useState } from "react"
import { Box, Text } from "ink"
import type { ActiveInstance, ModelEntry } from "../types/index.js"
import type { InstanceStats } from "./ModelList.js"
import { tailLog } from "../supervisor/logs.js"

function statusColor(status?: string): string | undefined {
  switch (status) {
    case "running":  return "green"
    case "starting": return "yellow"
    case "error":    return "red"
    case "exited":   return "gray"
    default:         return undefined
  }
}

function formatUptime(startedAt: number): string {
  const s = Math.floor((Date.now() - startedAt) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60}m`
}

function formatRss(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

function formatLastUsed(lastUsedAt?: number): string {
  if (!lastUsedAt) return "never"
  const deltaMs = Math.max(0, Date.now() - lastUsedAt)
  const minutes = Math.floor(deltaMs / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}

export interface LogFocusProps {
  entry: ModelEntry
  instance?: ActiveInstance
  stats?: InstanceStats
  rows: number
  cols: number
  // Lines scrolled up from the tail. 0 = follow live output. When > 0
  // the component pauses its auto-refresh so content doesn't shift
  // underneath the user. Clamped internally to the total line count.
  scrollOffset?: number
}

export const LogFocus: React.FC<LogFocusProps> = ({
  entry, instance, stats, rows, cols, scrollOffset = 0
}) => {
  const [content, setContent] = useState("")
  const logFile = instance?.logFile
  const paused = scrollOffset > 0

  useEffect(() => {
    if (!logFile) { setContent(""); return }
    const update = (): void => setContent(tailLog(logFile, 262144))
    update()
    if (paused) return
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [logFile, paused])

  const headerRows = 5
  const logRows = Math.max(4, rows - headerRows)
  const divider = "─".repeat(Math.max(8, cols - 2))

  // Split once. The last "" from a trailing newline is dropped so the
  // bottom line of the window isn't a blank row when the log ends on \n.
  const allLines = content.split("\n")
  if (allLines.length > 0 && allLines[allLines.length - 1] === "") allLines.pop()
  const maxOffset = Math.max(0, allLines.length - logRows)
  const offset = Math.min(scrollOffset, maxOffset)
  const end = allLines.length - offset
  const start = Math.max(0, end - logRows)
  const window = allLines.slice(start, end).join("\n")

  const runtimeLabel = entry.runtime === "mlx" && entry.mlxFlavor === "vlm"
    ? "mlx-vlm"
    : entry.runtime

  // Scroll indicator: shows "tail" when following, or "+N ↑ / paused"
  // when scrolled up so the pause state is obvious.
  const scrollLabel = offset === 0
    ? "tail"
    : `+${offset} ↑  paused`

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Box flexDirection="row">
        <Text bold color="cyan">{entry.slug}</Text>
        <Text dimColor>  {entry.id}</Text>
      </Box>
      <Box flexDirection="row">
        <Text dimColor>runtime </Text><Text>{runtimeLabel}</Text>
        <Text dimColor>  port </Text><Text>:{entry.port}</Text>
        <Text dimColor>  status </Text>
        <Text color={statusColor(instance?.status)}>{instance?.status ?? "idle"}</Text>
        {instance ? <><Text dimColor>  pid </Text><Text>{instance.pid}</Text></> : null}
        {instance ? <><Text dimColor>  up </Text><Text>{formatUptime(instance.startedAt)}</Text></> : null}
        {entry.publish ? <Text dimColor>  [pi]</Text> : null}
      </Box>
      <Box flexDirection="row">
        {stats?.proc ? (
          <>
            <Text dimColor>cpu </Text><Text>{stats.proc.cpuPct.toFixed(0)}%</Text>
            <Text dimColor>  rss </Text><Text>{formatRss(stats.proc.rssBytes)}</Text>
          </>
        ) : <Text dimColor>cpu —  rss —</Text>}
        {stats?.completion ? (
          <>
            <Text dimColor>  tok/s </Text><Text>{stats.completion.tokPerSec.toFixed(1)}</Text>
          </>
        ) : <Text dimColor>  tok/s —</Text>}
        <Text dimColor>  used </Text><Text>{formatLastUsed(entry.lastUsedAt)}</Text>
        <Text dimColor>  log </Text>
        <Text color={paused ? "yellow" : undefined}>{scrollLabel}</Text>
      </Box>
      <Text dimColor>{divider}</Text>
      <Box flexDirection="column" height={logRows} overflow="hidden">
        {logFile
          ? <Text>{window || "(waiting for output…)"}</Text>
          : <Text dimColor>(no log — not running)</Text>}
      </Box>
    </Box>
  )
}
