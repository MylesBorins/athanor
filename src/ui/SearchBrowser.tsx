import React, { useEffect, useMemo, useRef, useState } from "react"
import { Box, Text, useApp, useInput, useStdin, useStdout } from "ink"
import {
  enrichSelectionHint,
  searchModelsPage,
  sortByKey,
  type SearchCursor,
  type SearchFilter,
  type SearchResult,
  type SearchSelectionHint,
  type SearchSort
} from "../search/hf.js"
import { formatBytes, formatCount, formatRelTime } from "../search/format.js"
import { loadRepoHintCache, saveRepoHint } from "../search/cache.js"
import { fetchRepoTree } from "../pull/api.js"
import { DownloadsModal } from "./DownloadsModal.js"
import { PullModal } from "./PullModal.js"
import { useDownloads } from "./useDownloads.js"
import { detectMachineProfile } from "../machine/profile.js"
import { buildSearchRecommendation, sortByFit } from "../search/recommend.js"

// Column definitions shared by Header and Row so click-on-header
// sort wiring and visual alignment can't drift. Widths include the
// two leading spaces that separate adjacent columns.
interface ColumnDef {
  key: "rt" | "size" | "dl" | "likes" | "lic" | "age"
  width: number
  minCols: number
  sortKey: SearchSort | null
  label: string
}
const COLUMNS: ColumnDef[] = [
  { key: "rt",    width: 8,  minCols: 52,  sortKey: null,        label: "rt" },
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
  // Cursor (2) + id + rights…
  const active = COLUMNS.filter(c => cols >= c.minCols)
  const rightWidth = active.reduce((a, c) => a + c.width, 0)
  const idStart = 2
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
  onExit: (message?: string) => void
  onQueueDownload?: (input: { repo: string; file?: string }) => void
  embedded?: boolean
  machineMemBytes?: number
}

type Mode = "edit" | "browse" | "inspect" | "manual-pull" | "downloads"

function SearchDetailsModal({
  result,
  hint,
  width,
  selectedFileIdx,
  machineMemBytes
}: {
  result: SearchResult
  hint: SearchSelectionHint | null
  width: number
  selectedFileIdx: number
  machineMemBytes?: number
}) {
  const runtime = runtimeBadge(result)
  const isGguf = result.runtime === "llama.cpp"
  const machine = detectMachineProfile()
  const rec = buildSearchRecommendation(result, machine, hint ?? undefined)
  const bodyLines = [
    { label: "runtime", value: runtime.label, color: runtime.color },
    { label: "size", value: result.sizeBytes !== undefined ? formatBytes(result.sizeBytes) : "—" },
    { label: "fit", value: rec ? `${rec.fitBand} · ~${rec.estimatedFootprintGiB.toFixed(1)} GiB` : "unknown", color: rec?.fitBand === "comfortable" ? "green" : rec?.fitBand === "tight" ? "yellow" : rec?.fitBand === "risky" ? "red" : undefined },
    { label: "context", value: rec ? `${formatCount(rec.recommendedContext)} · ${rec.recommendedContextNote}` : "unknown" },
    { label: "confidence", value: rec?.confidence ?? "unknown" },
    { label: "downloads", value: formatCount(result.downloads) },
    { label: "likes", value: formatCount(result.likes) },
    { label: "updated", value: formatRelTime(result.lastModified) },
    { label: "license", value: result.license ?? "—" }
  ]

  const innerWidth = Math.max(24, width - 4)
  const valueWidth = Math.max(16, innerWidth - 14)
  const selectable = hint?.ggufSelectableCount
  const ggufSummary = !isGguf
    ? null
    : !hint
      ? "Resolving GGUF files…"
      : hint.defaultFile
        ? selectable && selectable > 1
          ? `Default: ${hint.defaultFile}${hint.defaultFileSizeBytes !== undefined ? ` · ${formatBytes(hint.defaultFileSizeBytes)}` : ""} · ${selectable} selectable files`
          : `Selected: ${hint.defaultFile}${hint.defaultFileSizeBytes !== undefined ? ` · ${formatBytes(hint.defaultFileSizeBytes)}` : ""}`
        : selectable && selectable > 0
          ? `${selectable} selectable GGUF files`
          : "No GGUF file selected yet"

  const candidates = hint?.ggufCandidates ?? []
  const clampedSelectedFileIdx = Math.max(0, Math.min(candidates.length - 1, selectedFileIdx))
  const selectedFile = candidates[clampedSelectedFileIdx]
  const selectedIsDefault = selectedFile?.name === hint?.defaultFile
  const selectedSizeBytes = selectedFile?.sizeBytes
  const effectiveFitSizeBytes = selectedSizeBytes ?? hint?.ggufTotalSizeBytes
  const comfortableBytes = machineMemBytes !== undefined ? Math.max(0, machineMemBytes - 8 * 1024 ** 3) : undefined
  const tightBytes = machineMemBytes !== undefined ? Math.max(0, machineMemBytes - 4 * 1024 ** 3) : undefined
  const fitHint = machineMemBytes === undefined || effectiveFitSizeBytes === undefined
    ? null
    : effectiveFitSizeBytes <= comfortableBytes!
      ? `comfortable on this Mac (${formatBytes(machineMemBytes)} unified memory)`
      : effectiveFitSizeBytes <= tightBytes!
        ? "might work, but could be tight on this Mac"
        : "not recommended for this Mac"

  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor="cyan" padding={1} backgroundColor="black">
      <Text bold color="cyan" backgroundColor="black">Model details</Text>
      <Text color="white" bold wrap="truncate-end" backgroundColor="black">{truncEnd(result.id, innerWidth)}</Text>
      <Text backgroundColor="black"> </Text>
      {bodyLines.map(line => (
        <Box key={line.label} backgroundColor="black">
          <Text color="cyan" backgroundColor="black">{`${line.label}:`.padEnd(13)}</Text>
          <Text color={line.color} wrap="truncate-end" backgroundColor="black">{truncEnd(line.value, valueWidth)}</Text>
        </Box>
      ))}
      {rec?.explanation
        ? <Text dimColor wrap="wrap" backgroundColor="black">{truncEnd(rec.explanation, innerWidth)}</Text>
        : null}
      {isGguf
        ? <>
            <Text backgroundColor="black"> </Text>
            <Text color="yellow" bold backgroundColor="black">GGUF selection</Text>
            <Text wrap="truncate-end" backgroundColor="black">{truncEnd(ggufSummary ?? "", innerWidth)}</Text>
            {(candidates.length > 1 || selectedFile)
              ? <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} backgroundColor="black">
                  <Box justifyContent="space-between" backgroundColor="black">
                    <Text color="yellow" bold backgroundColor="black">Option {Math.min(candidates.length, clampedSelectedFileIdx + 1)}/{Math.max(1, candidates.length)}</Text>
                    <Text dimColor backgroundColor="black">{selectedIsDefault ? "recommended" : "browse"}</Text>
                  </Box>
                  <Text color="cyan" bold wrap="truncate-end" backgroundColor="black">{truncEnd(selectedFile?.name ?? hint?.defaultFile ?? "—", innerWidth - 2)}</Text>
                  <Box backgroundColor="black">
                    <Text color="yellow" backgroundColor="black">size: </Text>
                    <Text color="white" bold backgroundColor="black">{selectedFile?.sizeBytes !== undefined ? formatBytes(selectedFile.sizeBytes) : "unknown"}</Text>
                    {selectedIsDefault ? <Text color="green" backgroundColor="black">  · default</Text> : null}
                  </Box>
                  {(hint?.ggufArchitecture || hint?.ggufContextLength)
                    ? <Box backgroundColor="black">
                        {hint.ggufArchitecture ? <><Text color="yellow" backgroundColor="black">arch: </Text><Text backgroundColor="black">{hint.ggufArchitecture}</Text></> : null}
                        {hint.ggufContextLength ? <><Text color="yellow" backgroundColor="black">  ctx: </Text><Text backgroundColor="black">{formatCount(hint.ggufContextLength)}</Text></> : null}
                      </Box>
                    : null}
                  {hint?.baseModel
                    ? <Box backgroundColor="black">
                        <Text color="yellow" backgroundColor="black">base: </Text>
                        <Text wrap="truncate-end" backgroundColor="black">{truncEnd(hint.baseModel, innerWidth - 8)}</Text>
                      </Box>
                    : null}
                  {fitHint
                    ? <Text color={fitHint.startsWith("comfortable") ? "green" : fitHint.startsWith("might work") ? "yellow" : "red"} wrap="truncate-end" backgroundColor="black">{truncEnd(fitHint, innerWidth - 2)}</Text>
                    : null}
                  {candidates.length > 1
                    ? <Text dimColor wrap="truncate-end" backgroundColor="black">{clampedSelectedFileIdx > 0 ? "↑ previous" : "↑ start"} · {clampedSelectedFileIdx < candidates.length - 1 ? "↓ next" : "↓ end"}</Text>
                    : null}
                </Box>
              : null}
            {hint?.ggufTotalSizeBytes !== undefined
              ? <Box backgroundColor="black">
                  <Text color="yellow" backgroundColor="black">repo total: </Text>
                  <Text backgroundColor="black">{formatBytes(hint.ggufTotalSizeBytes)}</Text>
                </Box>
              : null}
            {candidates.length > 1
              ? <Text dimColor wrap="truncate-end" backgroundColor="black">↑↓/j/k choose option · PgUp/PgDn jump · Enter pull selected · Esc close</Text>
              : <Text dimColor wrap="truncate-end" backgroundColor="black">Press <Text color="cyan" bold backgroundColor="black">Enter</Text> to pull this repo{hint?.defaultFile ? " with the selected default file" : ""}.</Text>}
          </>
        : <>
            <Text backgroundColor="black"> </Text>
            <Text dimColor wrap="truncate-end" backgroundColor="black">Press <Text color="cyan" bold backgroundColor="black">Enter</Text> to pull this model now.</Text>
          </>}
      <Text backgroundColor="black"> </Text>
      <Text dimColor wrap="truncate" backgroundColor="black">{
        isGguf && candidates.length > 1
          ? "Enter pull · ↑↓/j/k choose option · PgUp/PgDn jump · Esc close · q quit search"
          : "Enter pull · Esc close · q quit search"
      }</Text>
    </Box>
  )
}

const SORT_CYCLE: SearchSort[] = ["downloads", "likes", "trending", "modified", "size", "fit"]
const FILTER_CYCLE: SearchFilter[] = ["any", "mlx", "gguf"]

function runtimeBadge(r: SearchResult): { label: string; color: string } {
  if (r.runtime === "mlx") return { label: "mlx", color: "magenta" }
  if (r.runtime === "llama.cpp") return { label: "gguf", color: "cyan" }
  return { label: "other", color: "gray" }
}

function truncMid(s: string, max: number): string {
  if (s.length <= max) return s
  if (max <= 3) return s.slice(0, max)
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return s.slice(0, head) + "…" + s.slice(s.length - tail)
}

function truncEnd(s: string, max: number): string {
  if (max <= 0) return ""
  if (s.length <= max) return s
  if (max <= 1) return s.slice(0, max)
  return s.slice(0, max - 1) + "…"
}

function renderCell(r: SearchResult, key: ColumnDef["key"], width: number): string {
  // inner width = span width minus the 2-char gap before the value
  const inner = width - 2
  switch (key) {
    case "rt":    return "  " + runtimeBadge(r).label.padEnd(inner).slice(0, inner)
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
  if (key === "rt" || key === "lic" || key === "age") return "  " + label.padEnd(inner).slice(0, inner)
  return "  " + label.padStart(inner).slice(-inner)
}

// Renders a single result line. Column layout adapts to available
// width: narrow terminals drop optional columns rather than
// line-wrapping, so the list always fits in one row per entry.
function Row({ r, cols, layout, selected, hint }: {
  r: SearchResult; cols: number; layout: Layout; selected: boolean; hint?: SearchSelectionHint
}) {
  const badge = runtimeBadge(r)
  const displayResult = hint?.defaultFileSizeBytes !== undefined || hint?.ggufTotalSizeBytes !== undefined
    ? { ...r, sizeBytes: hint.defaultFileSizeBytes ?? hint.ggufTotalSizeBytes }
    : r
  const id = truncMid(r.id, layout.idWidth).padEnd(layout.idWidth)
  const right = layout.right.map(s => renderCell(displayResult, s.key, s.end - s.start)).join("")
  const composed = `${selected ? "› " : "  "}${id}${right}`
  const padded = composed.length < cols ? composed + " ".repeat(cols - composed.length) : composed
  if (selected) {
    // Keep the selected row's colors stable instead of inverting the
    // full line, which can make dim metadata disappear on some themes.
    return <Text backgroundColor="gray">{padded}</Text>
  }
  return (
    <Box>
      <Text>{selected ? "› " : "  "}</Text>
      <Text color={badge.color}>{id}</Text>
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
  initialQuery, initialFilter, initialSort, onExit, onQueueDownload, embedded, machineMemBytes
}) => {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const { stdin, setRawMode, isRawModeSupported } = useStdin()
  const machine = useMemo(() => detectMachineProfile(), [])
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
  const [mode, setMode]       = useState<Mode>("browse")
  // Transient status shown in the footer — currently used to confirm
  // a completed or cancelled pull after returning to browse mode.
  const [message, setMessage] = useState<string>("")
  const [manualPull, setManualPull] = useState<{ repo?: string; file?: string } | null>(null)
  const downloads = useDownloads(msg => setMessage(msg))
  const [selectionHint, setSelectionHint] = useState<SearchSelectionHint | null>(null)
  const [selectionHintsById, setSelectionHintsById] = useState<Record<string, SearchSelectionHint>>({})
  const [selectedFileIdx, setSelectedFileIdx] = useState(0)
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
    setResults([]); setCursor(undefined); setSelectionHint(null); setSelectionHintsById(loadRepoHintCache())
    cursorRef.current = undefined
    seenIdsRef.current = new Set()
    searchModelsPage({ query, filter, sort })
      .then(p => {
        if (cancelled) return
        for (const r of p.results) seenIdsRef.current.add(r.id)
        // searchModelsPage already globally sorts filter="any" pages;
        // for single-filter + sort=size the server uses popularity so
        // we re-order client-side here. Other single-filter sorts come
        // back server-sorted and pass through unchanged.
        const needsSort = filter === "any" || sort === "size" || sort === "fit"
        const ordered = sort === "fit"
          ? sortByFit(p.results, machine)
          : needsSort ? sortByKey(sort, p.results) : p.results
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
  // For filter="any" we re-apply the active sort across the union on
  // every page add, because subsequent mlx/gguf pages can contain
  // entries that outrank rows already shown from the other stream.
  // For single-filter sort=size we also re-sort (server returns by
  // popularity); other single-filter sorts are already monotonic
  // across pages.
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
          const needsSort = filter === "any" || sort === "size" || sort === "fit"
          if (sort === "fit") return sortByFit(merged, machine, selectionHintsById)
          return needsSort ? sortByKey(sort, merged) : merged
        })
        setCursor(p.cursor)
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => { loadingMoreRef.current = false; setLoadingMore(false) })
  }

  const layout = useMemo(() => columnLayout(dims.cols), [dims.cols])
  const selected = results[selectedIdx]
  const tail =
    loadingMore ? " · loading more…" :
    cursor      ? " · +more"          :
    results.length > 0 ? " · end" : ""
  const countLine =
    loading ? "searching…" :
    error   ? `error: ${error}` :
    results.length === 0 ? "no results" :
    `${results.length} results · ${selectedIdx + 1}/${results.length}${tail}`
  const hintLine = selected?.runtime === "llama.cpp"
    ? selectionHint?.defaultFile
      ? `gguf default: ${selectionHint.defaultFile}${selectionHint.defaultFileSizeBytes !== undefined ? ` · ${formatBytes(selectionHint.defaultFileSizeBytes)}` : ""}${selectionHint.ggufSelectableCount !== undefined ? ` · ${selectionHint.ggufSelectableCount} selectable` : ""}`
      : "gguf: resolving default file…"
    : null
  const hintLineText = mode !== "inspect" && hintLine ? truncEnd(hintLine, dims.cols) : null
  // Fixed rows: title, query, top divider, header, bottom divider,
  // key help footer. Optional hint/message lines live below that.
  const chromeRows = 6 + (hintLineText ? 1 : 0) + (message ? 1 : 0)
  const visibleRows = Math.max(3, dims.rows - chromeRows)
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

  useEffect(() => {
    let cancelled = false
    setSelectionHint(null)
    setSelectedFileIdx(0)
    if (!selected || selected.runtime !== "llama.cpp") return
    const cached = selectionHintsById[selected.id]
    if (cached) {
      setSelectionHint(cached)
      const defaultIdx = cached.ggufCandidates?.findIndex(c => c.name === cached.defaultFile) ?? -1
      setSelectedFileIdx(defaultIdx >= 0 ? defaultIdx : 0)
      return
    }
    void enrichSelectionHint(selected)
      .then(hint => {
        if (cancelled) return
        setSelectionHint(hint)
        saveRepoHint(selected.id, hint)
        setSelectionHintsById(prev => prev[selected.id] ? prev : { ...prev, [selected.id]: hint })
        const defaultIdx = hint.ggufCandidates?.findIndex(c => c.name === hint.defaultFile) ?? -1
        setSelectedFileIdx(defaultIdx >= 0 ? defaultIdx : 0)
      })
      .catch(() => { if (!cancelled) setSelectionHint({ runtime: selected.runtime }) })
    return () => { cancelled = true }
  }, [selected, selectionHintsById])

  // Refs let the mouse-data listener read current state without
  // re-subscribing every render. Each ref mirrors a piece of state
  // the SGR handler needs to translate x/y coordinates into actions.
  const modeRef = useRef(mode); useEffect(() => { modeRef.current = mode }, [mode])
  const resultsRef = useRef(results); useEffect(() => { resultsRef.current = results }, [results])
  const layoutRef = useRef(layout); useEffect(() => { layoutRef.current = layout }, [layout])
  useEffect(() => {
    const targets = results.filter(r => {
      if (selectionHintsById[r.id]) return false
      if (r.runtime === "llama.cpp") return true
      if (r.runtime === "mlx" && r.sizeBytes === undefined) return true
      return false
    })
    if (targets.length === 0) return
    let cancelled = false
    const limit = 4
    const batches: SearchResult[][] = []
    for (let i = 0; i < targets.length; i += limit) batches.push(targets.slice(i, i + limit))
    void (async () => {
      for (const batch of batches) {
        const settled = await Promise.allSettled(batch.map(async r => {
          if (r.runtime === "llama.cpp") return { id: r.id, hint: await enrichSelectionHint(r) }
          const tree = await fetchRepoTree(r.id)
          const mlxSizeBytes = tree
            .filter(entry => entry.type === "file" && entry.path.toLowerCase().endsWith(".safetensors"))
            .reduce((sum, entry) => sum + (entry.lfs?.size ?? entry.size ?? 0), 0)
          return { id: r.id, hint: { runtime: "mlx" as const, ggufTotalSizeBytes: mlxSizeBytes > 0 ? mlxSizeBytes : undefined } }
        }))
        if (cancelled) return
        setSelectionHintsById(prev => {
          const next = { ...prev }
          let changed = false
          for (const item of settled) {
            if (item.status !== "fulfilled") continue
            if (next[item.value.id]) continue
            saveRepoHint(item.value.id, item.value.hint)
            next[item.value.id] = item.value.hint
            changed = true
          }
          return changed ? next : prev
        })
      }
    })()
    return () => { cancelled = true }
  }, [results, selectionHintsById])

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
    // When embedded, the parent App already owns the SGR mouse mode
    // and will tear it down on its own unmount. Writing the disable
    // sequence here on close would strip the parent's reporting as
    // a side effect, so we skip the toggle entirely and just attach
    // our data listener.
    const enable  = "\x1b[?1000h\x1b[?1006h"
    const disable = "\x1b[?1006l\x1b[?1000l"
    if (!embedded) stdout.write(enable)
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
      if (embedded) return
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
  }, [stdin, stdout, setRawMode, isRawModeSupported, embedded])

  useInput((input, key) => {
    // Mouse sequences arrive as stdin data; Ink may synthesize a lone
    // `escape` from the leading ESC byte. Suppress any useInput fired
    // within a short window of a mouse event, and any chunk that
    // carries the SGR mouse prefix.
    if (Date.now() - lastMouseAtRef.current < 20) return
    if (input.indexOf("[<") >= 0 || input.indexOf("\x1b[<") >= 0) return
    if (key.escape) {
      if (mode === "inspect") { setMode("browse"); return }
      if (mode === "edit") { setMode("browse"); return }
      return
    }
    if (mode === "edit") {
      if (key.return) { setMode("browse"); return }
      if (key.downArrow) { setMode("browse"); return }
      if (key.backspace || key.delete) { setQuery(q => q.slice(0, -1)); return }
      if (input && !key.ctrl && !key.meta) setQuery(q => q + input)
      return
    }
    if (input === "q") {
      onExit()
      if (!embedded) exit()
      return
    }
    if (mode === "inspect") {
      const r = results[selectedIdx]
      if (!r) return
      const candidateCount = selectionHint?.ggufCandidates?.length ?? 0
      const chosenFile = r.runtime === "llama.cpp"
        ? (selectionHint?.ggufCandidates?.[selectedFileIdx]?.name ?? selectionHint?.defaultFile)
        : undefined
      const canChooseFile = r.runtime === "llama.cpp" && candidateCount > 1
      if ((key.upArrow || input === "k") && canChooseFile) {
        setSelectedFileIdx(i => Math.max(0, i - 1))
        return
      }
      if ((key.downArrow || input === "j") && canChooseFile) {
        setSelectedFileIdx(i => Math.min(candidateCount - 1, i + 1))
        return
      }
      if (key.pageUp && canChooseFile) {
        setSelectedFileIdx(i => Math.max(0, i - 5))
        return
      }
      if (key.pageDown && canChooseFile) {
        setSelectedFileIdx(i => Math.min(candidateCount - 1, i + 5))
        return
      }
      if (input === "f" && r.runtime === "llama.cpp") {
        setManualPull({ repo: r.id, file: chosenFile ?? "" })
        setMode("manual-pull")
        return
      }
      if (input === "p" || key.return) {
        if (onQueueDownload) {
          onQueueDownload({ repo: r.id, file: chosenFile })
          setMessage(`queued ${r.id}${chosenFile ? ` · ${chosenFile}` : ""}`)
          setMode("browse")
        } else {
          downloads.queueDownload({ repo: r.id, file: chosenFile })
          setMode("downloads")
        }
      }
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
    if (input === "p") {
      const r = results[selectedIdx]
      if (!r) return
      if (onQueueDownload) {
        onQueueDownload({ repo: r.id, file: r.runtime === "llama.cpp" ? selectionHint?.defaultFile : undefined })
        setMessage(`queued ${r.id}`)
      } else {
        downloads.queueDownload({ repo: r.id, file: r.runtime === "llama.cpp" ? selectionHint?.defaultFile : undefined })
        setMode("downloads")
      }
      return
    }
    if (key.upArrow)   { setSelectedIdx(i => Math.max(0, i - 1)); return }
    if (key.downArrow) { setSelectedIdx(i => Math.min(results.length - 1, i + 1)); return }
    if (key.pageUp)    { setSelectedIdx(i => Math.max(0, i - visibleRows)); return }
    if (key.pageDown)  { setSelectedIdx(i => Math.min(results.length - 1, i + visibleRows)); return }
    if (input === "g") { setSelectedIdx(0); return }
    if (input === "G") { setSelectedIdx(Math.max(0, results.length - 1)); return }
    if (key.return) {
      if (!results[selectedIdx]) return
      setMode("inspect")
    }
  })

  if (mode === "manual-pull") {
    return <PullModal
      initialRepo={manualPull?.repo}
      initialFile={manualPull?.file}
      onDone={msg => {
        const needsFile = msg.startsWith("pull failed: Multiple GGUF files in ")
        setMessage(msg)
        if (needsFile) {
          setManualPull(prev => ({ repo: prev?.repo, file: "" }))
          setMode("manual-pull")
          return
        }
        setManualPull(null)
        setMode("browse")
      }}
      onCancel={() => {
        setManualPull(null)
        setMode("browse")
      }}
    />
  }

  const downloadsModalWidth = Math.max(72, Math.min(104, dims.cols - 8))
  const downloadsModalHeight = 24
  const downloadsLeft = Math.max(0, Math.floor((dims.cols - downloadsModalWidth) / 2))
  const downloadsTop = Math.max(0, Math.floor((dims.rows - downloadsModalHeight) / 2))

  const helpLine = truncEnd(
    mode === "edit"
      ? "type query · ⏎ search · esc back · q quit"
      : mode === "inspect"
        ? (selected?.runtime === "llama.cpp" && (selectionHint?.ggufCandidates?.length ?? 0) > 1
            ? "⏎ pull · ↑↓/j/k choose option · PgUp/PgDn jump · esc close · q quit"
            : "⏎ pull · esc close · q quit")
        : "↑↓ · ⏎ details · p pull · click header to sort · / edit · f filter · s sort · esc back · q quit",
    Math.max(0, dims.cols - 3 - countLine.length)
  )
  const footerLine = truncEnd(`${helpLine} · ${countLine}`, dims.cols)
  const modalWidth = Math.max(64, Math.min(88, dims.cols - 10))
  const modalHeight = selected?.runtime === "llama.cpp"
    ? ((selectionHint?.ggufCandidates?.length ?? 0) > 1 ? 22 : 19)
    : 13
  const modalLeft = Math.max(0, Math.floor((dims.cols - modalWidth) / 2))
  const modalTop = Math.max(0, Math.floor((dims.rows - modalHeight) / 2) - 2)

  return (
    <Box width={dims.cols} height={dims.rows}>
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
                hint={selectionHintsById[r.id]}
              />
            ))}
      </Box>
      <Text dimColor>{"─".repeat(Math.max(8, dims.cols - 2))}</Text>
      <Text dimColor>{footerLine}</Text>
      {hintLineText ? <Text dimColor>{hintLineText}</Text> : null}
      {message ? <Text color="yellow">{message}</Text> : null}
      </Box>
      {mode === "inspect" && selected
        ? <Box position="absolute" marginLeft={modalLeft} marginTop={modalTop}>
            <SearchDetailsModal
              result={selected}
              hint={selectionHint}
              width={modalWidth}
              selectedFileIdx={selectedFileIdx}
              machineMemBytes={machineMemBytes}
            />
          </Box>
        : null}
      {mode === "downloads"
        ? <Box position="absolute" marginLeft={downloadsLeft} marginTop={downloadsTop}>
            <DownloadsModal
              tasks={downloads.tasks}
              width={downloadsModalWidth}
              onCancelTask={downloads.cancelDownload}
              onClearFinished={downloads.clearFinished}
              onClose={() => setMode("browse")}
            />
          </Box>
        : null}
    </Box>
  )
}
