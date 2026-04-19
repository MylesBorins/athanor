import React, { useEffect, useRef, useState } from "react"
import { Box, Text, useInput } from "ink"
import { pull } from "../pull/hf.js"
import { PullAbortedError, type ProgressEvent } from "../pull/download.js"

export interface PullModalProps {
  onDone: (message: string) => void
  onCancel: () => void
  // When set, pre-fills the repo field and starts the download
  // immediately, skipping the repo/file prompts. Used by the empty-
  // state suggestions picker so `⏎` on a starter model goes straight
  // to "running".
  initialRepo?: string
  initialFile?: string
}

interface FileState { done: number; total: number | null }

function humanBytes(n: number): string {
  if (!isFinite(n) || n < 0) return "?"
  const u = ["B", "KB", "MB", "GB", "TB"]
  let v = n
  let i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`
}

function humanRate(bps: number | null): string {
  if (bps === null || !isFinite(bps) || bps <= 0) return "— MB/s"
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

export const PullModal: React.FC<PullModalProps> = ({
  onDone, onCancel, initialRepo, initialFile
}) => {
  const [repo, setRepo] = useState(initialRepo ?? "")
  const [file, setFile] = useState(initialFile ?? "")
  const [stage, setStage] = useState<"repo" | "file" | "running">(
    initialRepo ? "running" : "repo"
  )
  // Per-file progress. Keyed by tqdm desc (file name). Kept in state
  // rather than a ref so renders stay in sync with updates.
  const [byteFiles, setByteFiles] = useState<Map<string, FileState>>(new Map())
  const [currentFile, setCurrentFile] = useState<string>("")
  const [rate, setRate] = useState<number | null>(null)
  const [stageLabel, setStageLabel] = useState<string>("resolving…")
  const [errorLine, setErrorLine] = useState<string>("")
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => { abortRef.current?.abort() }, [])

  function handleEvent(ev: ProgressEvent): void {
    if (ev.type === "resolving") { setStageLabel("resolving…"); return }
    if (ev.type === "done") { setStageLabel("finalizing…"); return }
    if (ev.type === "error") { setErrorLine(ev.message); return }
    if (ev.unit !== "B") return  // the outer "files" tqdm is computed below from byteFiles
    setStageLabel("downloading")
    setCurrentFile(ev.file)
    if (ev.type === "progress") setRate(ev.rate)
    setByteFiles(prev => {
      const next = new Map(prev)
      const existing = next.get(ev.file) ?? { done: 0, total: null }
      const done = "done" in ev ? ev.done : existing.done
      const total = ev.total ?? existing.total
      next.set(ev.file, { done, total })
      return next
    })
  }

  function startPull(r: string, f: string | undefined): void {
    setStage("running")
    const ctl = new AbortController()
    abortRef.current = ctl
    pull({
      repo: r,
      file: f,
      signal: ctl.signal,
      onEvent: handleEvent,
      onLine: l => setErrorLine(l)
    })
      .then(res => onDone(`pulled ${res.entry.slug} (port ${res.entry.port})`))
      .catch(err => {
        if (err instanceof PullAbortedError) onDone("pull cancelled")
        else onDone(`pull failed: ${err.message ?? err}`)
      })
  }

  useEffect(() => {
    if (initialRepo) startPull(initialRepo, initialFile?.trim() || undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useInput((input, key) => {
    if (stage === "running") { if (key.escape) abortRef.current?.abort(); return }
    if (key.escape) return onCancel()
    if (key.return) {
      if (stage === "repo") { if (!repo.trim()) return; setStage("file"); return }
      if (stage === "file") { startPull(repo.trim(), file.trim() || undefined); return }
    }
    if (key.backspace || key.delete) {
      if (stage === "repo") setRepo(r => r.slice(0, -1))
      else if (stage === "file") setFile(f => f.slice(0, -1))
      return
    }
    if (input && !key.ctrl && !key.meta) {
      if (stage === "repo") setRepo(r => r + input)
      else if (stage === "file") setFile(f => f + input)
    }
  })

  const files = [...byteFiles.values()]
  const totalDone = files.reduce((a, s) => a + s.done, 0)
  const totalSize = files.reduce((a, s) => a + (s.total ?? 0), 0)
  const frac = totalSize > 0 ? totalDone / totalSize : 0
  const filesDone = files.filter(s => s.total !== null && s.done >= s.total).length
  const barWidth = 32
  const pct = totalSize > 0 ? (frac * 100).toFixed(1) + "%" : "…"

  return (
    <Box flexDirection="column" borderStyle="round" padding={1}>
      <Text bold>Pull from HuggingFace</Text>
      <Box marginTop={1}><Text>repo:  </Text><Text color={stage === "repo" ? "cyan" : undefined}>{repo || "<org>/<name>"}</Text></Box>
      <Box><Text>file:  </Text><Text color={stage === "file" ? "cyan" : undefined}>{file || "(blank = auto)"}</Text></Box>
      {stage === "running" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{stageLabel}  {currentFile}</Text>
          <Box>
            <Text>[</Text><Text color="cyan">{bar(frac, barWidth)}</Text><Text>]  </Text>
            <Text>{pct}</Text>
          </Box>
          <Text dimColor>{humanBytes(totalDone)} / {totalSize > 0 ? humanBytes(totalSize) : "?"}  ·  {humanRate(rate)}  ·  {filesDone}/{files.length} files</Text>
          {errorLine && <Text color="red">{errorLine}</Text>}
        </Box>
      )}
      <Box marginTop={1}><Text dimColor>⏎ next/start · esc cancel</Text></Box>
    </Box>
  )
}
