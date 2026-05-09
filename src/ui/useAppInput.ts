import { useInput } from "ink"
import type { ActiveInstance, ModelEntry } from "../types/index.js"
import { SUGGESTIONS, type Suggestion } from "../pull/suggestions.js"

interface Dims {
  cols: number
  rows: number
}

type Mode = "list" | "filter" | "pull" | "downloads" | "preset" | "logs" | "search" | "confirm-delete"

export interface AppInputOpts {
  mode: Mode
  dims: Dims
  models: ModelEntry[]
  filtered: ModelEntry[]
  selected: ModelEntry | undefined
  selectedInst: ActiveInstance | undefined
  suggIdx: number
  lastMouseAtRef: React.MutableRefObject<number>
  setMode: React.Dispatch<React.SetStateAction<Mode>>
  setFilter: React.Dispatch<React.SetStateAction<string>>
  setSelectedIdx: React.Dispatch<React.SetStateAction<number>>
  setLogScroll: React.Dispatch<React.SetStateAction<number>>
  setSuggIdx: React.Dispatch<React.SetStateAction<number>>
  setPullPrefill: React.Dispatch<React.SetStateAction<Suggestion | undefined>>
  exit: () => void
  toggleStartStop: () => Promise<void>
  restart: () => Promise<void>
  killSelected: () => Promise<void>
  toggleExpose: () => void
  deleteEntry: () => void
  rescan: () => void
}

export function useAppInput(opts: AppInputOpts): void {
  const {
    mode,
    dims,
    models,
    filtered,
    selected,
    selectedInst,
    suggIdx,
    lastMouseAtRef,
    setMode,
    setFilter,
    setSelectedIdx,
    setLogScroll,
    setSuggIdx,
    setPullPrefill,
    exit,
    toggleStartStop,
    restart,
    killSelected,
    toggleExpose,
    deleteEntry,
    rescan
  } = opts

  useInput((input, key) => {
    if (mode === "pull" || mode === "downloads" || mode === "preset" || mode === "search" || mode === "confirm-delete") return
    if (Date.now() - lastMouseAtRef.current < 20) return
    if (input.indexOf("[<") >= 0 || input.indexOf("\x1b[<") >= 0) return
    if (mode === "filter") {
      if (key.escape || key.return) { setMode("list"); return }
      if (key.backspace || key.delete) { setFilter(f => f.slice(0, -1)); return }
      if (input && !key.ctrl && !key.meta) setFilter(f => f + input)
      return
    }
    if (key.tab) { setMode(m => (m === "logs" ? "list" : "logs")); return }
    if (mode === "logs") {
      const page = Math.max(1, Math.floor(dims.rows / 2))
      if (key.upArrow)        { setLogScroll(o => o + 1); return }
      if (key.downArrow)      { setLogScroll(o => Math.max(0, o - 1)); return }
      if (key.pageUp)         { setLogScroll(o => o + page); return }
      if (key.pageDown)       { setLogScroll(o => Math.max(0, o - page)); return }
      if (input === "G" || key.end)  { setLogScroll(0); return }
      if (input === "g" || key.home) { setLogScroll(1e9); return }
    }
    if (models.length === 0) {
      if (key.downArrow) { setSuggIdx(i => Math.min(i + 1, SUGGESTIONS.length - 1)); return }
      if (key.upArrow)   { setSuggIdx(i => Math.max(i - 1, 0)); return }
      if (key.return) {
        const s = SUGGESTIONS[suggIdx]
        if (s) { setPullPrefill(s); setMode("pull") }
        return
      }
      if (input === "s") { rescan(); return }
      if (input === "p") { setPullPrefill(undefined); setMode("pull"); return }
      if (input === "S") { setMode("search"); return }
      if (input === "q") { exit(); return }
      return
    }
    if (key.downArrow) setSelectedIdx(i => Math.min(i + 1, filtered.length - 1))
    else if (key.upArrow) setSelectedIdx(i => Math.max(i - 1, 0))
    else if (key.return) void toggleStartStop()
    else if (input === "r") void restart()
    else if (input === "k") { if (selectedInst) void killSelected() }
    else if (input === "P") toggleExpose()
    else if (input === "d") { if (selected) setMode("confirm-delete") }
    else if (input === "D") setMode("downloads")
    else if (input === "s") rescan()
    else if (input === "/") { setFilter(""); setMode("filter") }
    else if (input === "p") { setPullPrefill(undefined); setMode("pull") }
    else if (input === "S") setMode("search")
    else if (input === "e") { if (selected) setMode("preset") }
    else if (input === "q") exit()
  })
}
