import React, { useEffect, useMemo, useRef, useState } from "react"
import { Box, Text, useApp, useInput, useStdin, useStdout } from "ink"
import {
  searchModelsPage,
  sortBySize,
  type SearchCursor,
  type SearchFilter,
  type SearchResult,
  type SearchSort
} from "../search/hf.js"
import { formatBytes, formatCount, formatRelTime } from "../search/format.js"
import { PullModal } from "./PullModal.js"

// Column definitions shared by Header and Row so click-on-header
// sort wiring and visual alignment can't drift. Widths include the
// two leading spaces that separate adjacent columns.
interface ColumnDef {
  key: "size" | "dl" | "likes" | "lic" | "age"
  width: number
  minCols: number
  sortKey: SearchSort | null
  label: string
}
const COLUMNS: ColumnDef[] = [
  { key: "size",  width: 10, minCols: 38,  sortKey: "size",      label: "size"    },
  { key: "dl",    width: 9,  minCols: 70,  sortKey: "downloads", label: "dl  ↓"   },
  { key: "likes", width: 8,  minCols: 88,  sortKey: "likes",     label: "  ♥"     },
  { key: "lic",   width: 16, minCols: 108, sortKey: null,        label: "license" },
  { key: "age",   width: 12, minCols: 120, sortKey: "modified",  label: "updated" }
]

interface LayoutSpan { key: ColumnDef["key"]; start: number; end: number; sortKey: SearchSort | null }
interface Layout {
  idStart: number; idEnd: number; idWidth: number
  right: LayoutSpan[]
}

function columnLayout(cols: number): Layout {
  // Cursor (2) + badge "[xxxx]" (6) + id + rights…
  const active = COLUMNS.filter(c => cols >= c.minCols)
  const rightWidth = active.reduce((a, c) => a + c.width, 0)
  const idStart = 8
  const idWidth = Math.max(8, cols - idStart - rightWidth)
  const idEnd = idStart + idWidth
  const right: LayoutSpan[] = []
  let x = idEnd
  for (const c of active) {
    right.push({ key: c.key, start: x, end: x + c.width, sortKey: c.sortKey })
    x += c.width
  }
  return { idStart, idEnd, idWidth, right }
}

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

const SORT_CYCLE: SearchSort[] = ["downloads", "likes", "trending", "modified", "size"]
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

function renderCell(r: SearchResult, key: ColumnDef["key"], width: number): string {
  // inner width = span width minus the 2-char gap before the value
  const inner = width - 2
  switch (key) {
    case "size":  return "  " + (r.sizeBytes !== undefined ? formatBytes(r.sizeBytes) : "—").padStart(inner)
    case "dl":    return "  " + (formatCount(r.downloads) + "↓").padStart(inner)
    case "likes": return "  " + (formatCount(r.likes) + "♥").padStart(inner)
    case "lic":   return "  " + (r.license ?? "").padEnd(inner).slice(0, inner)
    case "age":   return "  " + formatRelTime(r.lastModified).padEnd(inner).slice(0, inner)
  }
}

function renderHeaderCell(key: ColumnDef["key"], width: number, label: string): string {
  const inner = width - 2
  // Right-align for numeric columns, left-align for textual.
  if (key === "lic" || key === "age") return "  " + label.padEnd(inner).slice(0, inner)
  return "  " + label.padStart(inner).slice(-inner)
}

// Renders a single result line. Column layout adapts to available
// width: narrow terminals drop optional columns rather than
// line-wrapping, so the list always fits in one row per entry.
function Row({ r, cols, layout, selected }: {
  r: SearchResult; cols: number; layout: Layout; selected: boolean
}) {
  const badge = runtimeBadge(r)
  const id = truncMid(r.id, layout.idWidth).padEnd(layout.idWidth)
  const right = layout.right.map(s => renderCell(r, s.key, s.end - s.start)).join("")
  const composed = `${selected ? "› " : "  "}[${badge.label.padEnd(4)}]${id}${right}`
  const padded = composed.length < cols ? composed + " ".repeat(cols - composed.length) : composed
  if (selected) {
    // inverse flips fg/bg of every character, producing a solid
    // highlighted bar across the full width while keeping readable
    // contrast against the new background.
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

// Column header row with clickable sort targets. The current sort
// column is underlined; hovering/clicking is handled by the parent
// via SGR mouse coordinates.
function Header({ cols, layout, sort }: { cols: number; layout: Layout; sort: SearchSort }) {
  return (
    <Box>
      <Text dimColor>{" ".repeat(layout.idStart)}</Text>
      <Text dimColor>{"name".padEnd(layout.idWidth).slice(0, layout.idWidth)}</Text>
      {layout.right.map(s => {
        const col = COLUMNS.find(c => c.key === s.key)!
        const text = renderHeaderCell(s.key, s.end - s.start, col.label)
        const active = s.sortKey !== null && s.sortKey === sort
        return <Text key={s.key} dimColor={!active} bold={active} underline={active}>{text}</Text>
      })}
      <Text dimColor>{" ".repeat(Math.max(0, cols - (layout.right.at(-1)?.end ?? layout.idEnd)))}</Text>
    </Box>
  )
}

export const SearchBrowser: React.FC<SearchBrowserProps> = ({
  initialQuery, initialFilter, initialSort, onExit
}) => {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const { stdin, setRawMode, isRawModeSupported } = useStdin()
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
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [scrollOff, setScrollOff]     = useState(0)
  const [mode, setMode]       = useState<Mode>(initialQuery ? "browse" : "edit")
  const [pickedRepo, setPickedRepo] = useState<string | undefined>()
  // Transient status shown in the footer — currently used to confirm
  // a completed or cancelled pull after returning to browse mode.
  const [message, setMessage] = useState<string>("")
  // Opaque next-page cursor. Undefined when results are exhausted or
  // we haven't fetched yet (loading covers the latter).
  const [cursor, setCursor] = useState<SearchCursor | undefined>()

  // Each (query, filter, sort) triple defines its own paginated
  // stream; refs let the loadMore callback observe the current cursor
  // and dedupe set without re-binding on every state update.
  const cursorRef  = useRef<SearchCursor | undefined>(undefined)
  const seenIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => { cursorRef.current = cursor }, [cursor])

  // Run a search for the current (query, filter, sort). Results are
  // keyed by that triple so unrelated re-renders don't kick off a new
  // network round-trip; changing any axis resets the paginated stream.
  const runKey = `${query}\x00${filter}\x00${sort}`
  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadingMore(false); setError(null)
    setResults([]); setCursor(undefined)
    cursorRef.current = undefined
    seenIdsRef.current = new Set()
    searchModelsPage({ query, filter, sort })
      .then(p => {
        if (cancelled) return
        for (const r of p.results) seenIdsRef.current.add(r.id)
        const ordered = sort === "size" ? sortBySize(p.results) : p.results
        setResults(ordered)
        setCursor(p.cursor)
        setSelectedIdx(0); setScrollOff(0)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey])

  // Fetch the next page and merge it in. Guarded by loadingMore so a
  // burst of scroll keypresses can't fan out into parallel fetches.
  // For sort=size we re-apply sortBySize across the union; other sorts
  // preserve the order the API returned.
  const loadingMoreRef = useRef(false)
  const loadMore = (): void => {
    if (loadingMoreRef.current) return
    const cur = cursorRef.current
    if (!cur) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    searchModelsPage({ query, filter, sort }, cur)
      .then(p => {
        const fresh: SearchResult[] = []
        for (const r of p.results) {
          if (seenIdsRef.current.has(r.id)) continue
          seenIdsRef.current.add(r.id)
          fresh.push(r)
        }
        setResults(prev => {
          const merged = prev.concat(fresh)
          return sort === "size" ? sortBySize(merged) : merged
        })
        setCursor(p.cursor)
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => { loadingMoreRef.current = false; setLoadingMore(false) })
  }

  // Chrome row count: banner + query + divider + column-header +
  // divider + footer = 6. visibleRows absorbs the rest.
  const chromeRows = 6
  const visibleRows = Math.max(3, dims.rows - chromeRows)
  const layout = useMemo(() => columnLayout(dims.cols), [dims.cols])
  // y-coordinates (1-based, matching SGR mouse) for the two clickable
  // regions. Used by the mouse handler to map a click to a sort column
  // or a selection change.
  const HEADER_Y = 4
  const FIRST_ROW_Y = 5

  // Keep the selected row inside the visible window. Recompute on
  // selection or list-length change; this is cheap and avoids stale
  // scroll math when results shrink.
  useEffect(() => {
    if (selectedIdx < scrollOff) setScrollOff(selectedIdx)
    else if (selectedIdx >= scrollOff + visibleRows)
      setScrollOff(selectedIdx - visibleRows + 1)
  }, [selectedIdx, visibleRows, scrollOff])

  // Prefetch when the cursor approaches the bottom of what we've
  // loaded. The threshold is one full visible page so the next batch
  // is in-hand before the user reaches the last row.
  useEffect(() => {
    if (!cursor || loadingMore || loading) return
    if (selectedIdx >= results.length - visibleRows) loadMore()
    // loadMore is intentionally unstable; we rely on the guard inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, results.length, visibleRows, cursor, loadingMore, loading])

  const visible = useMemo(
    () => results.slice(scrollOff, scrollOff + visibleRows),
    [results, scrollOff, visibleRows]
  )

  // Refs let the mouse-data listener read current state without
  // re-subscribing every render. Each ref mirrors a piece of state
  // the SGR handler needs to translate x/y coordinates into actions.
  const modeRef = useRef(mode); useEffect(() => { modeRef.current = mode }, [mode])
  const resultsRef = useRef(results); useEffect(() => { resultsRef.current = results }, [results])
  const layoutRef = useRef(layout); useEffect(() => { layoutRef.current = layout }, [layout])
  const scrollRef = useRef(scrollOff); useEffect(() => { scrollRef.current = scrollOff }, [scrollOff])
  const visibleRowsRef = useRef(visibleRows); useEffect(() => { visibleRowsRef.current = visibleRows }, [visibleRows])
  const lastMouseAtRef = useRef(0)

  // Enable SGR mouse reporting while SearchBrowser is mounted so the
  // column-header click-to-sort and row-click-to-select work. Cleanup
  // disables the report on unmount, on process exit, and on
  // SIGTERM/SIGHUP so the user's shell isn't left receiving mouse
  // escape sequences as garbage keystrokes.
  useEffect(() => {
    if (!stdin || !stdout || !isRawModeSupported) return
    setRawMode(true)
    const enable  = "\x1b[?1000h\x1b[?1006h"
    const disable = "\x1b[?1006l\x1b[?1000l"
    stdout.write(enable)
    const handler = (data: Buffer): void => {
      const s = data.toString("utf8")
      // SGR mouse: ESC [ < Cb ; Cx ; Cy (M=press, m=release).
      // eslint-disable-next-line no-control-regex
      const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g
      let match: RegExpExecArray | null
      let sawMouse = false
      while ((match = re.exec(s)) !== null) {
        sawMouse = true
        const cb = parseInt(match[1], 10)
        const x = parseInt(match[2], 10)
        const y = parseInt(match[3], 10)
        const press = match[4] === "M"
        if (!press) continue
        if ((cb & 64) !== 0) continue  // ignore wheel events for now
        if ((cb & 3) !== 0) continue   // left button only
        if (modeRef.current !== "browse") continue
        if (y === HEADER_Y) {
          // Header click: find the span that contains x, switch to
          // that column's sortKey if present.
          const span = layoutRef.current.right.find(r => x - 1 >= r.start && x - 1 < r.end)
          if (span?.sortKey) setSort(span.sortKey)
          continue
        }
        const rowIdx = y - FIRST_ROW_Y
        if (rowIdx < 0 || rowIdx >= visibleRowsRef.current) continue
        const abs = scrollRef.current + rowIdx
        if (abs >= 0 && abs < resultsRef.current.length) setSelectedIdx(abs)
      }
      if (sawMouse) lastMouseAtRef.current = Date.now()
    }
    stdin.prependListener("data", handler)
    let cleaned = false
    const cleanup = (): void => {
      if (cleaned) return; cleaned = true
      try { stdout.write(disable) } catch { /* stdout may be closed */ }
    }
    process.on("exit", cleanup)
    const onSig = (): void => { cleanup(); process.exit(0) }
    process.on("SIGTERM", onSig)
    process.on("SIGHUP",  onSig)
    return () => {
      stdin.off("data", handler)
      process.off("exit", cleanup)
      process.off("SIGTERM", onSig)
      process.off("SIGHUP",  onSig)
      cleanup()
    }
  }, [stdin, stdout, setRawMode, isRawModeSupported])

  useInput((input, key) => {
    if (mode === "pull") return
    // Mouse sequences arrive as stdin data; Ink may synthesize a lone
    // `escape` from the leading ESC byte. Suppress any useInput fired
    // within a short window of a mouse event, and any chunk that
    // carries the SGR mouse prefix.
    if (Date.now() - lastMouseAtRef.current < 20) return
    if (input.indexOf("[<") >= 0 || input.indexOf("\x1b[<") >= 0) return
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
    // After the pull completes or is cancelled we land back in browse
    // mode with a status message so the user can download another
    // model without relaunching. Only `esc` from the browse screen
    // now exits the TUI.
    return <PullModal
      initialRepo={pickedRepo}
      onDone={msg => { setMessage(msg); setPickedRepo(undefined); setMode("browse") }}
      onCancel={() => { setPickedRepo(undefined); setMode("browse") }}
    />
  }

  // Trailing marker reflects pagination state so the user knows
  // whether more results are en-route or we've reached the end of
  // the underlying stream(s).
  const tail =
    loadingMore ? " · loading more…" :
    cursor      ? " · +more"          :
    results.length > 0 ? " · end" : ""
  const countLine =
    loading ? "searching…" :
    error   ? `error: ${error}` :
    results.length === 0 ? "no results" :
    `${results.length} results · ${selectedIdx + 1}/${results.length}${tail}`

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
      <Header cols={dims.cols} layout={layout} sort={sort} />
      <Box flexDirection="column" height={visibleRows} overflow="hidden">
        {visible.length === 0
          ? <Text dimColor>{countLine}</Text>
          : visible.map((r, i) => (
              <Row
                key={r.id}
                r={r}
                cols={dims.cols}
                layout={layout}
                selected={scrollOff + i === selectedIdx}
              />
            ))}
      </Box>
      <Text dimColor>{"─".repeat(Math.max(8, dims.cols - 2))}</Text>
      <Text dimColor>
        {mode === "edit"
          ? "type query · ⏎ search · esc back"
          : "↑↓ · ⏎ pull · click header to sort · / edit · f filter · s sort · esc quit"}
        {" · "}{countLine}
      </Text>
      {message ? <Text color="yellow">{message}</Text> : null}
    </Box>
  )
}
