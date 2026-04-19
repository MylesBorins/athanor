import React, { useEffect, useMemo, useState } from "react"
import { Box, Text, useApp, useInput, useStdout } from "ink"
import {
  searchModels,
  type SearchFilter,
  type SearchResult,
  type SearchSort
} from "../search/hf.js"
import { formatBytes, formatCount, formatRelTime } from "../search/format.js"
import { PullModal } from "./PullModal.js"

export interface SearchBrowserProps {
  initialQuery?: string
  initialFilter?: SearchFilter
  initialSort?: SearchSort
  // Called when the user closes the browser without picking a model,
  // or when a pull finishes. In CLI mode this triggers process exit;
  // in the main TUI it routes back to the list view.
  onExit: (message?: string) => void
}

type Mode = "edit" | "browse" | "pull"

const SORT_CYCLE: SearchSort[] = ["downloads", "likes", "trending", "modified"]
const FILTER_CYCLE: SearchFilter[] = ["any", "mlx", "gguf"]

function runtimeBadge(r: SearchResult): { label: string; color: string } {
  if (r.runtime === "mlx") return { label: "mlx",  color: "magenta" }
  if (r.runtime === "llama.cpp") return { label: "gguf", color: "cyan" }
  return { label: "?",   color: "gray" }
}

function truncMid(s: string, max: number): string {
  if (s.length <= max) return s
  if (max <= 3) return s.slice(0, max)
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return s.slice(0, head) + "…" + s.slice(s.length - tail)
}

// Renders a single result line. Column layout adapts to available
// width: narrow terminals drop optional columns rather than
// line-wrapping, so the list always fits in one row per entry.
function Row({ r, cols, selected }: { r: SearchResult; cols: number; selected: boolean }) {
  const badge = runtimeBadge(r)
  const size  = r.sizeBytes !== undefined ? formatBytes(r.sizeBytes) : "—"
  const dl    = formatCount(r.downloads)
  const likes = formatCount(r.likes)
  const ago   = formatRelTime(r.lastModified)
  const lic   = r.license ?? ""
  // Right-hand fixed-width columns, reserved in priority order.
  const wantSize  = cols >= 38
  const wantDl    = cols >= 70
  const wantLikes = cols >= 88
  const wantLic   = cols >= 108
  const wantAgo   = cols >= 120
  const right =
    (wantSize  ? `  ${size.padStart(8)}`  : "") +
    (wantDl    ? `  ${dl.padStart(6)}↓`   : "") +
    (wantLikes ? `  ${likes.padStart(5)}♥` : "") +
    (wantLic   ? `  ${lic.padEnd(14).slice(0, 14)}` : "") +
    (wantAgo   ? `  ${ago.padEnd(10).slice(0, 10)}` : "")
  // 2 for cursor, 6 for "[xxxx]" badge; remainder is the id.
  const idWidth = Math.max(8, cols - 2 - 6 - right.length)
  const id = truncMid(r.id, idWidth).padEnd(idWidth)
  // Pad the composed row to the full terminal width so the selected
  // background color spans the entire line, not just the text.
  const composed = `${selected ? "› " : "  "}[${badge.label.padEnd(4)}]${id}${right}`
  const padded = composed.length < cols ? composed + " ".repeat(cols - composed.length) : composed
  if (selected) {
    // Single Text with inverse flips fg/bg of every character,
    // producing a solid highlighted bar across the full width while
    // keeping the per-segment colors readable against the new bg.
    return <Text inverse>{padded}</Text>
  }
  return (
    <Box>
      <Text>{"  "}</Text>
      <Text color={badge.color}>[{badge.label.padEnd(4)}]</Text>
      <Text>{id}</Text>
      <Text dimColor>{right}</Text>
    </Box>
  )
}

export const SearchBrowser: React.FC<SearchBrowserProps> = ({
  initialQuery, initialFilter, initialSort, onExit
}) => {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [dims, setDims] = useState({
    cols: stdout?.columns ?? 100,
    rows: stdout?.rows ?? 30
  })
  useEffect(() => {
    if (!stdout) return
    const onResize = (): void => setDims({ cols: stdout.columns, rows: stdout.rows })
    stdout.on("resize", onResize)
    return () => { stdout.off("resize", onResize) }
  }, [stdout])

  const [query, setQuery]     = useState(initialQuery ?? "")
  const [filter, setFilter]   = useState<SearchFilter>(initialFilter ?? "any")
  const [sort, setSort]       = useState<SearchSort>(initialSort ?? "downloads")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [scrollOff, setScrollOff]     = useState(0)
  const [mode, setMode]       = useState<Mode>(initialQuery ? "browse" : "edit")
  const [pickedRepo, setPickedRepo] = useState<string | undefined>()

  // Run a search for the current (query, filter, sort). Results are
  // keyed by that triple so unrelated re-renders don't kick off a new
  // network round-trip.
  const runKey = `${query}\x00${filter}\x00${sort}`
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    searchModels({ query, filter, sort, limit: 40 })
      .then(r => {
        if (cancelled) return
        setResults(r)
        setSelectedIdx(0); setScrollOff(0)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey])

  const headerRows = 2
  const footerRows = 2
  const visibleRows = Math.max(3, dims.rows - headerRows - footerRows - 1)

  // Keep the selected row inside the visible window. Recompute on
  // selection or list-length change; this is cheap and avoids stale
  // scroll math when results shrink.
  useEffect(() => {
    if (selectedIdx < scrollOff) setScrollOff(selectedIdx)
    else if (selectedIdx >= scrollOff + visibleRows)
      setScrollOff(selectedIdx - visibleRows + 1)
  }, [selectedIdx, visibleRows, scrollOff])

  const visible = useMemo(
    () => results.slice(scrollOff, scrollOff + visibleRows),
    [results, scrollOff, visibleRows]
  )

  useInput((input, key) => {
    if (mode === "pull") return
    if (key.escape) {
      if (mode === "edit" && initialQuery === undefined && results.length > 0) {
        setMode("browse"); return
      }
      onExit(); exit(); return
    }
    if (mode === "edit") {
      if (key.return) { setMode("browse"); return }
      if (key.backspace || key.delete) { setQuery(q => q.slice(0, -1)); return }
      if (input && !key.ctrl && !key.meta) setQuery(q => q + input)
      return
    }
    // browse mode
    if (input === "/" || input === "i") { setMode("edit"); return }
    if (input === "f") {
      setFilter(f => FILTER_CYCLE[(FILTER_CYCLE.indexOf(f) + 1) % FILTER_CYCLE.length])
      return
    }
    if (input === "s") {
      setSort(s => SORT_CYCLE[(SORT_CYCLE.indexOf(s) + 1) % SORT_CYCLE.length])
      return
    }
    if (key.upArrow)   { setSelectedIdx(i => Math.max(0, i - 1)); return }
    if (key.downArrow) { setSelectedIdx(i => Math.min(results.length - 1, i + 1)); return }
    if (key.pageUp)    { setSelectedIdx(i => Math.max(0, i - visibleRows)); return }
    if (key.pageDown)  { setSelectedIdx(i => Math.min(results.length - 1, i + visibleRows)); return }
    if (input === "g") { setSelectedIdx(0); return }
    if (input === "G") { setSelectedIdx(Math.max(0, results.length - 1)); return }
    if (key.return) {
      const r = results[selectedIdx]
      if (!r) return
      setPickedRepo(r.id); setMode("pull")
    }
  })

  if (mode === "pull" && pickedRepo) {
    return <PullModal
      initialRepo={pickedRepo}
      onDone={msg => { onExit(msg); exit() }}
      onCancel={() => { setPickedRepo(undefined); setMode("browse") }}
    />
  }

  const countLine =
    loading ? "searching…" :
    error   ? `error: ${error}` :
    results.length === 0 ? "no results" :
    `${results.length} results · ${selectedIdx + 1}/${results.length}`

  return (
    <Box flexDirection="column" width={dims.cols} height={dims.rows}>
      <Box>
        <Text bold>HuggingFace search</Text>
        <Text dimColor>  ·  filter: </Text>
        <Text color="yellow">{filter}</Text>
        <Text dimColor>  sort: </Text>
        <Text color="yellow">{sort}</Text>
      </Box>
      <Box>
        <Text>{mode === "edit" ? "q› " : "q  "}</Text>
        <Text color={mode === "edit" ? "cyan" : undefined}>{query || (mode === "edit" ? "" : "(any)")}</Text>
        {mode === "edit" ? <Text color="cyan">▏</Text> : null}
      </Box>
      <Text dimColor>{"─".repeat(Math.max(8, dims.cols - 2))}</Text>
      <Box flexDirection="column" height={visibleRows} overflow="hidden">
        {visible.length === 0
          ? <Text dimColor>{countLine}</Text>
          : visible.map((r, i) => (
              <Row key={r.id} r={r} cols={dims.cols} selected={scrollOff + i === selectedIdx} />
            ))}
      </Box>
      <Text dimColor>{"─".repeat(Math.max(8, dims.cols - 2))}</Text>
      <Text dimColor>
        {mode === "edit"
          ? "type query · ⏎ search · esc back"
          : "↑↓ · PgUp/PgDn · ⏎ pull · / edit · f filter · s sort · g/G top/bot · esc quit"}
        {" · "}{countLine}
      </Text>
    </Box>
  )
}
