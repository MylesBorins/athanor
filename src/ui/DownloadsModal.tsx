import React, { useEffect, useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import type { DownloadTask } from "./useDownloads.js"

export interface DownloadsModalProps {
  tasks: DownloadTask[]
  width?: number
  onClose: () => void
  onCancelTask: (id: string) => void
  onClearFinished: () => void
}

function humanBytes(n: number): string {
  if (!isFinite(n) || n < 0) return "?"
  const u = ["B", "KB", "MB", "GB", "TB"]
  let v = n
  let i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`
}

function humanRate(bps: number | null): string {
  if (bps === null || !isFinite(bps) || bps <= 0) return "—/s"
  return `${humanBytes(bps)}/s`
}

function bar(frac: number, width: number): string {
  const f = Math.max(0, Math.min(1, frac))
  const full = Math.floor(f * width)
  const rem = f * width - full
  const parts = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"]
  const head = full < width ? parts[Math.round(rem * 8)] ?? " " : ""
  return "█".repeat(full) + head + " ".repeat(Math.max(0, width - full - (head ? 1 : 0)))
}

export function taskSummary(task: DownloadTask): { done: number; total: number; filesDone: number; filesTotal: number; frac: number } {
  const files = [...task.byteFiles.values()]
  const done = files.reduce((a, s) => a + s.done, 0)
  const total = files.reduce((a, s) => a + (s.total ?? 0), 0)
  const filesDone = files.filter(s => s.total !== null && s.done >= s.total).length
  const frac = total > 0 ? done / total : 0
  return { done, total, filesDone, filesTotal: files.length, frac }
}

export const DownloadsModal: React.FC<DownloadsModalProps> = ({
  tasks,
  width = 96,
  onClose,
  onCancelTask,
  onClearFinished
}) => {
  const [cursor, setCursor] = useState(0)
  const clampedCursor = Math.max(0, Math.min(cursor, Math.max(0, tasks.length - 1)))
  const selected = tasks[clampedCursor]

  useEffect(() => {
    if (cursor !== clampedCursor) setCursor(clampedCursor)
  }, [cursor, clampedCursor])
  const innerWidth = Math.max(24, width - 4)
  const barWidth = Math.max(16, Math.min(36, innerWidth - 24))

  useInput((input, key) => {
    if (key.escape || input === "q") { onClose(); return }
    if (key.downArrow) { setCursor(i => Math.min(tasks.length - 1, i + 1)); return }
    if (key.upArrow) { setCursor(i => Math.max(0, i - 1)); return }
    if (input === "c" && selected && (selected.status === "running" || selected.status === "queued")) {
      onCancelTask(selected.id)
      return
    }
    if (input === "C") {
      onClearFinished()
    }
  })

  const counts = useMemo(() => {
    let running = 0
    let done = 0
    let error = 0
    let cancelled = 0
    for (const task of tasks) {
      if (task.status === "running") running++
      else if (task.status === "done") done++
      else if (task.status === "error") error++
      else if (task.status === "cancelled") cancelled++
    }
    return { running, done, error, cancelled }
  }, [tasks])

  return (
    <Box width={width} flexDirection="column" borderStyle="round" borderColor="cyan" padding={1} backgroundColor="black">
      <Text bold color="cyan" backgroundColor="black">Downloads</Text>
      <Text dimColor wrap="truncate-end" backgroundColor="black">
        {counts.running} active · {counts.done} done · {counts.error} failed · {counts.cancelled} cancelled
      </Text>
      <Text backgroundColor="black"> </Text>
      {tasks.length === 0
        ? <Text dimColor backgroundColor="black">No downloads yet.</Text>
        : tasks.map((task, i) => {
            const active = i === clampedCursor
            const summary = taskSummary(task)
            const pct = summary.total > 0 ? `${(summary.frac * 100).toFixed(1)}%` : task.status === "done" ? "100%" : "…"
            const statusColor = task.status === "running"
              ? "cyan"
              : task.status === "done"
                ? "green"
                : task.status === "error"
                  ? "red"
                  : "yellow"
            return (
              <Box key={task.id} flexDirection="column" backgroundColor="black" marginBottom={1}>
                <Text color={active ? "cyan" : "white"} bold={active} backgroundColor="black" wrap="truncate-end">
                  {active ? "▸ " : "  "}{task.repo}{task.file ? ` · ${task.file}` : ""}
                </Text>
                <Text backgroundColor="black">
                  <Text color={statusColor} bold backgroundColor="black">{task.status}</Text>
                  <Text dimColor backgroundColor="black">  ·  {task.stageLabel}</Text>
                  {task.currentFile ? <Text dimColor backgroundColor="black">  ·  {task.currentFile}</Text> : null}
                </Text>
                <Text backgroundColor="black">[{bar(summary.frac, barWidth)}] {pct}  <Text dimColor backgroundColor="black">{humanBytes(summary.done)} / {summary.total > 0 ? humanBytes(summary.total) : "?"} · {humanRate(task.rate)} · {summary.filesDone}/{summary.filesTotal} files</Text></Text>
                {task.errorLine ? <Text color="red" wrap="truncate-end" backgroundColor="black">{task.errorLine}</Text> : null}
                {task.resultMessage && task.status !== "running"
                  ? <Text dimColor wrap="truncate-end" backgroundColor="black">{task.resultMessage}</Text>
                  : null}
              </Box>
            )
          })}
      <Text dimColor wrap="truncate" backgroundColor="black">↑↓ select · c cancel selected · C clear finished · Esc close</Text>
    </Box>
  )
}
