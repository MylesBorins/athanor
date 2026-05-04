import React, { useEffect, useMemo, useRef, useState } from "react"
import { Box, Text, useApp, useStdout, useStdin } from "ink"
import type { ModelEntry } from "../types/index.js"
import { listModels } from "../registry/index.js"
import { supervisor } from "../supervisor/index.js"
import { Banner } from "./Banner.js"
import { ModelList, type InstanceStats } from "./ModelList.js"
import { LogTail } from "./LogTail.js"
import { LogFocus } from "./LogFocus.js"
import { PullModal } from "./PullModal.js"
import { PresetEditor } from "./PresetEditor.js"
import { Suggestions } from "./Suggestions.js"
import { SearchBrowser } from "./SearchBrowser.js"
import { SUGGESTIONS, type Suggestion } from "../pull/suggestions.js"
import { useModelActions } from "./useModelActions.js"
import { useMouseWheel } from "./useMouseWheel.js"
import { useAppData } from "./useAppData.js"
import { useAppInput } from "./useAppInput.js"

type Mode = "list" | "filter" | "pull" | "preset" | "logs" | "search"

// How long a status message stays on screen before auto-dismissing.
// Long enough to read a success/error line, short enough that it
// doesn't linger and obscure subsequent context.
const MESSAGE_TTL_MS = 4000

export interface AppProps {
  initialMessage?: string
}

const App: React.FC<AppProps> = ({ initialMessage }) => {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const { stdin, setRawMode, isRawModeSupported } = useStdin()
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [message, setMessage] = useState(initialMessage ?? "")
  const [mode, setMode] = useState<Mode>("list")
  const [filter, setFilter] = useState("")
  const [logScroll, setLogScroll] = useState(0)
  const [suggIdx, setSuggIdx] = useState(0)
  const [pullPrefill, setPullPrefill] = useState<Suggestion | undefined>()
  const [dims, setDims] = useState({
    cols: stdout?.columns ?? 100,
    rows: stdout?.rows ?? 30
  })

  useEffect(() => {
    if (!stdout) return
    const onResize = (): void =>
      setDims({ cols: stdout.columns, rows: stdout.rows })
    stdout.on("resize", onResize)
    return () => { stdout.off("resize", onResize) }
  }, [stdout])

  // Auto-dismiss the status message after a short delay so it doesn't
  // linger past its relevance. Setting a new message resets the timer
  // because the effect re-runs on each `message` change.
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(""), MESSAGE_TTL_MS)
    return () => { clearTimeout(t) }
  }, [message])

  const {
     models,
     setModels,
     instances,
     setInstances,
     instMap,
     sys,
     instStats
   } = useAppData({ setMessage })

  // Auto-focus the first running model the first time we see the
  // registry populated. We defer to an effect (rather than the
  // useState factory) because the supervisor may not have hydrated
  // its persisted instance list synchronously at mount. Fires at most
  // once per session — subsequent ticks leave the user's selection
  // alone.
  const initialFocusDone = useRef(false)
  useEffect(() => {
    if (initialFocusDone.current) return
    if (models.length === 0) return
    const idx = models.findIndex(m => instances.some(i => i.id === m.id))
    if (idx >= 0) {
      initialFocusDone.current = true
      setSelectedIdx(idx)
    } else if (instances.length > 0) {
      // Instances present but none match a model — flag as done so
      // we don't re-scan on every tick.
      initialFocusDone.current = true
    }
  }, [models, instances])

  const filtered = useMemo(() => {
    if (!filter) return models
    const f = filter.toLowerCase()
    return models.filter(m =>
      m.slug.toLowerCase().includes(f) || m.id.toLowerCase().includes(f)
    )
  }, [models, filter])

  useEffect(() => {
    if (selectedIdx >= filtered.length) setSelectedIdx(Math.max(0, filtered.length - 1))
  }, [filtered, selectedIdx])

  // Move the list cursor to follow any model that newly enters the
  // running set — covers manual start, restart, and router-driven
  // auto-start. If the newcomer is hidden by the active filter, clear
  // the filter so the user sees it. Stops and router-swap-outs don't
  // move the cursor; only transitions into "running/starting" do.
  const prevRunningRef = useRef<Set<string>>(
    new Set(supervisor.list().map(i => i.id))
  )
  useEffect(() => {
    const prev = prevRunningRef.current
    const nowIds = new Set(instances.map(i => i.id))
    const newly = instances.filter(i => !prev.has(i.id))
    prevRunningRef.current = nowIds
    if (newly.length === 0) return
    const latest = newly.reduce((a, b) => (b.startedAt > a.startedAt ? b : a))
    const idx = filtered.findIndex(m => m.id === latest.id)
    if (idx >= 0) { setSelectedIdx(idx); return }
    const fullIdx = models.findIndex(m => m.id === latest.id)
    if (fullIdx >= 0) { setFilter(""); setSelectedIdx(fullIdx) }
  }, [instances, filtered, models])

  const selected = filtered[selectedIdx]
  const selectedInst = selected ? instMap.get(selected.id) : undefined

  // Scroll state is scoped to "the currently selected instance's log".
  // Entering logs mode, swapping models, or a log file changing under
  // us resets the view back to tail so the user isn't left paused on
  // stale content.
  const inLogsMode = mode === "logs"
  useEffect(() => { setLogScroll(0) }, [selectedInst?.logFile, inLogsMode])

  const lastMouseAtRef = useMouseWheel({
    mode,
    filteredLength: filtered.length,
    dims,
    stdin,
    stdout,
    setRawMode,
    isRawModeSupported,
    setLogScroll,
    setSelectedIdx
  })

  const {
    toggleStartStop,
    restart,
    toggleExpose,
    deleteEntry,
    rescan,
    killSelected
  } = useModelActions({
    selected,
    instMap,
    setMessage,
    setInstances,
    setModels
  })

  useAppInput({
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
  })

  if (mode === "pull") {
    return <PullModal
      initialRepo={pullPrefill?.repo}
      initialFile={pullPrefill?.file}
      onDone={msg => {
        setMessage(msg); setModels(listModels())
        setPullPrefill(undefined); setMode("list")
      }}
      onCancel={() => { setPullPrefill(undefined); setMode("list") }} />
  }

  if (mode === "preset" && selected) {
    return <PresetEditor
      entryId={selected.id}
      onClose={msg => { if (msg) setMessage(msg); setModels(listModels()); setMode("list") }} />
  }

  if (mode === "search") {
    // Embedded variant: onExit lands us back in list mode instead of
    // terminating the Ink app. SearchBrowser owns its own PullModal
    // flow, so new models land in the registry before we return.
    return <SearchBrowser
      embedded
      onExit={msg => {
        if (msg) setMessage(msg)
        setModels(listModels())
        setMode("list")
      }}
    />
  }

  if (mode === "logs") {
    // Tab hides only the model selector — banner and footer stay so
    // global context (system load, keybindings) remains visible. The
    // log pane takes over everything the ModelList used to occupy.
    const bannerRows = 12
    const dividerRows = 2
    const footerRows = 2
    const focusRows = Math.max(10, dims.rows - bannerRows - dividerRows - footerRows)
    const divider = "─".repeat(Math.max(8, dims.cols - 2))
    return (
      <Box flexDirection="column" width={dims.cols} height={dims.rows}>
        <Banner
          status={`${instances.length} running · ${models.length} in registry`}
          sys={sys}
        />
        <Text dimColor>{divider}</Text>
        {selected
          ? <LogFocus
              entry={selected}
              instance={selectedInst}
              stats={instStats.get(selected.id)}
              rows={focusRows}
              cols={dims.cols}
              scrollOffset={logScroll}
            />
          : <Box height={focusRows}><Text dimColor>no model selected</Text></Box>}
        <Text dimColor>{divider}</Text>
        <Text dimColor>wheel/↑↓ scroll · PgUp/PgDn page · g top · G/End tail · r restart · k kill · ⏎ start/stop · tab list · q quit</Text>
        <Box height={1}><Text color="yellow" wrap="truncate">{message || " "}</Text></Box>
      </Box>
    )
  }

  // Allocate space: banner is 12 rows (see FURNACE in Banner.tsx),
  // header row is 1, two rules are 2, list gets the top chunk, log
  // tail gets the bottom chunk, footer is 2, plus a reserved 1-row
  // status line so transient messages don't push the rest of the
  // layout off the bottom of the screen.
  const bannerRows = 12
  const chromeRows = bannerRows + 1 /* stats */ + 2 /* rules */ + 2 /* footer */ + 1 /* message */
  const bodyRows = Math.max(8, dims.rows - chromeRows)
  const listRows = Math.max(4, Math.min(filtered.length + 1, Math.floor(bodyRows * 0.55)))
  const logRows = Math.max(4, bodyRows - listRows)
  const divider = "─".repeat(Math.max(8, dims.cols - 2))
  const isEmpty = models.length === 0

  return (
    <Box flexDirection="column" width={dims.cols} height={dims.rows}>
      <Banner
        status={`${instances.length} running · ${models.length} in registry`}
        sys={sys}
      />
      <Text dimColor>{divider}</Text>
      {isEmpty
        ? <Box flexDirection="column" overflow="hidden">
            <Suggestions selectedIndex={suggIdx} />
          </Box>
        : <>
            <Box flexDirection="column" height={listRows} overflow="hidden">
              <ModelList
                models={filtered}
                selectedIndex={selectedIdx}
                instances={instMap}
                stats={instStats}
                cols={dims.cols}
              />
            </Box>
            <Text dimColor>{divider}</Text>
            <Box flexDirection="column" height={logRows} overflow="hidden">
              <LogTail logFile={selectedInst?.logFile} lines={logRows - 1} />
            </Box>
          </>}
      <Text dimColor>{divider}</Text>
      {mode === "filter"
        ? <Text>/ {filter}<Text dimColor>  (esc/⏎ done)</Text></Text>
        : isEmpty
          ? <Text dimColor>↑↓ · ⏎ pull suggestion · p pull repo · S search · s scan · q quit</Text>
          : <Text dimColor>↑↓ · ⏎ start/stop · r restart · k kill · P expose/hide · d remove · s scan · p pull · S search · e preset · / filter · tab hide list · q quit</Text>}
      <Box height={1}><Text color="yellow" wrap="truncate">{message || " "}</Text></Box>
    </Box>
  )
}

export default App
