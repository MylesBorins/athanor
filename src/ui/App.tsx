import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Box, Text, useApp, useStdout, useStdin } from "ink"
import type { ModelEntry } from "../types/index.js"
import { listModels } from "../registry/index.js"
import { supervisor } from "../supervisor/index.js"
import { Banner } from "./Banner.js"
import { ModelList, type InstanceStats } from "./ModelList.js"
import { LogTail } from "./LogTail.js"
import { LogFocus } from "./LogFocus.js"
import { PullModal } from "./PullModal.js"
import { DownloadsModal } from "./DownloadsModal.js"
import { PresetEditor } from "./PresetEditor.js"
import { Suggestions } from "./Suggestions.js"
import { SearchBrowser } from "./SearchBrowser.js"
import { ConfirmModal } from "./ConfirmModal.js"
import { TelemetryModal } from "./TelemetryModal.js"
import { SUGGESTIONS, type Suggestion } from "../pull/suggestions.js"
import { useModelActions } from "./useModelActions.js"
import { useMouseWheel } from "./useMouseWheel.js"
import { useAppData } from "./useAppData.js"
import { useAppInput } from "./useAppInput.js"
import { useDownloads } from "./useDownloads.js"

type Mode = "list" | "filter" | "pull" | "downloads" | "preset" | "logs" | "search" | "confirm-delete" | "telemetry"

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [message, setMessage] = useState(initialMessage ?? "")
  const [mode, setMode] = useState<Mode>("list")
  const [filter, setFilter] = useState("")
  const [logScroll, setLogScroll] = useState(0)
  const [suggIdx, setSuggIdx] = useState(0)
  const [pullPrefill, setPullPrefill] = useState<Suggestion | undefined>()
  const downloads = useDownloads(msg => {
    setMessage(msg)
    setModels(listModels())
  })
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
     instStats,
     watcherReady
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
    const running = models.find(m => instances.some(i => i.id === m.id))
    if (running) {
      initialFocusDone.current = true
      setSelectedId(running.id)
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

  // Derive positional index from the tracked model ID. If the
  // selected model disappeared from the filtered list (e.g. the
  // filter hid it, or it was deleted), clamp to the last entry.
  const selectedIdx = useMemo(() => {
    if (!selectedId) return 0
    const idx = filtered.findIndex(m => m.id === selectedId)
    return idx >= 0 ? idx : Math.max(0, filtered.length - 1)
  }, [selectedId, filtered])

  // Positional setter that translates index movements back to IDs.
  // Arrow keys and mouse wheel call this; the model under the new
  // index becomes the tracked selection.
  const setSelectedIdx = useCallback((update: React.SetStateAction<number>) => {
    const nextIdx = typeof update === "function" ? update(selectedIdx) : update
    const clamped = Math.max(0, Math.min(nextIdx, filtered.length - 1))
    const target = filtered[clamped]
    if (target) setSelectedId(target.id)
  }, [selectedIdx, filtered])

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
    if (filtered.some(m => m.id === latest.id)) {
      setSelectedId(latest.id)
      return
    }
    if (models.some(m => m.id === latest.id)) {
      setFilter("")
      setSelectedId(latest.id)
    }
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

  if (mode === "search") {
    return <SearchBrowser
      embedded
      models={models}
      machineMemBytes={sys?.totalMemBytes}
      onQueueDownload={({ repo, file }) => {
        downloads.queueDownload({ repo, file })
        setMode("downloads")
      }}
      onExit={msg => {
        if (msg) setMessage(msg)
        setModels(listModels())
        setMode("list")
      }}
    />
  }

  const downloadsModalWidth = Math.max(72, Math.min(104, dims.cols - 8))
  const downloadsModalHeight = 24
  const downloadsTopPad = Math.max(0, Math.floor((dims.rows - downloadsModalHeight) / 2))
  const downloadsLeftPad = Math.max(0, Math.floor((dims.cols - downloadsModalWidth) / 2))
  const downloadsOverlay = mode === "downloads"
    ? <Box
        width={dims.cols}
        height={dims.rows}
        position="absolute"
        flexDirection="column"
      >
        {Array.from({ length: downloadsTopPad }, (_, i) => (
          <Text key={`downloads-top-${i}`}> </Text>
        ))}
        <Box paddingLeft={downloadsLeftPad}>
          <DownloadsModal
            tasks={downloads.tasks}
            width={downloadsModalWidth}
            onCancelTask={downloads.cancelDownload}
            onClearFinished={downloads.clearFinished}
            onClose={() => setMode("list")}
          />
        </Box>
      </Box>
    : null

  const presetModalWidth = Math.max(72, Math.min(96, dims.cols - 8))
  const presetModalHeight = 24
  const presetTopPad = Math.max(0, Math.floor((dims.rows - presetModalHeight) / 2))
  const presetLeftPad = Math.max(0, Math.floor((dims.cols - presetModalWidth) / 2))
  const presetOverlay = mode === "preset" && selected
    ? <Box
        width={dims.cols}
        height={dims.rows}
        position="absolute"
        flexDirection="column"
      >
        {Array.from({ length: presetTopPad }, (_, i) => (
          <Text key={`preset-top-${i}`}> </Text>
        ))}
        <Box paddingLeft={presetLeftPad}>
          <PresetEditor
            entryId={selected.id}
            width={presetModalWidth}
            onClose={msg => {
              if (msg) setMessage(msg)
              setModels(listModels())
              setMode("list")
            }}
          />
        </Box>
      </Box>
    : null

  const confirmDeleteModalWidth = Math.max(44, Math.min(72, dims.cols - 8))
  const confirmDeleteModalHeight = 10
  const confirmDeleteTopPad = Math.max(0, Math.floor((dims.rows - confirmDeleteModalHeight) / 2))
  const confirmDeleteLeftPad = Math.max(0, Math.floor((dims.cols - confirmDeleteModalWidth) / 2))
  const confirmDeleteOverlay = mode === "confirm-delete" && selected
    ? <Box
        width={dims.cols}
        height={dims.rows}
        position="absolute"
        flexDirection="column"
      >
        {Array.from({ length: confirmDeleteTopPad }, (_, i) => (
          <Text key={`top-${i}`}> </Text>
        ))}
        <Box paddingLeft={confirmDeleteLeftPad}>
          <ConfirmModal
            title={`Delete ${selected.slug}?`}
            body={[
              "Delete this model from athanor and remove its files from disk.",
              "",
              selected.path
            ]}
            width={confirmDeleteModalWidth}
            confirmLabel="delete"
            cancelLabel="cancel"
            onConfirm={() => {
              deleteEntry()
              setMode("list")
            }}
            onCancel={() => setMode("list")}
          />
        </Box>
      </Box>
    : null

  const telemetryModalWidth = Math.max(50, Math.min(76, dims.cols - 8))
  const telemetryModalHeight = 20
  const telemetryTopPad = Math.max(0, Math.floor((dims.rows - telemetryModalHeight) / 2))
  const telemetryLeftPad = Math.max(0, Math.floor((dims.cols - telemetryModalWidth) / 2))
  const telemetryOverlay = mode === "telemetry" && selected
    ? <Box
        width={dims.cols}
        height={dims.rows}
        position="absolute"
        flexDirection="column"
      >
        {Array.from({ length: telemetryTopPad }, (_, i) => (
          <Text key={`telemetry-top-${i}`}> </Text>
        ))}
        <Box paddingLeft={telemetryLeftPad}>
          <TelemetryModal
            entry={selected}
            width={telemetryModalWidth}
            onClose={() => setMode("list")}
          />
        </Box>
      </Box>
    : null

  const bannerMode = dims.rows < 20 || dims.cols < 80
    ? "minimal"
    : dims.rows < 28 || dims.cols < 100
      ? "compact"
      : "full"
  const bannerRows = bannerMode === "full" ? 12 : bannerMode === "compact" ? 2 : 2
  const compactList = dims.cols < 100 || dims.rows < 24
  // On short terminals the split list+log layout leaves awkward blank
  // space under the model rows and makes the selector feel cramped.
  // Require a bit more vertical headroom before reserving rows for the
  // inline log preview.
  const showLogPreview = models.length > 0 && dims.rows >= 26
  const divider = "─".repeat(Math.max(8, dims.cols - 2))

  if (mode === "logs") {
    // Tab hides only the model selector — banner and footer stay so
    // global context (system load, keybindings) remains visible. The
    // log pane takes over everything the ModelList used to occupy.
    const dividerRows = 2
    const footerRows = 2
    const focusRows = Math.max(8, dims.rows - bannerRows - dividerRows - footerRows)
    const logsHelp = dims.cols < 100
      ? "↑↓ scroll · PgUp/PgDn · g/G · tab list · q quit"
      : "wheel/↑↓ scroll · PgUp/PgDn page · g top · G/End tail · r restart · k kill · ⏎ start/stop · tab list · q quit"
    return (
      <Box width={dims.cols} height={dims.rows}>
        <Box flexDirection="column" width={dims.cols} height={dims.rows}>
          <Banner
            status={`${instances.length} running · ${models.length} in registry`}
            sys={sys}
            dev={process.env.ATHANOR_DEV_TUI === "1"}
            mode={bannerMode}
            cols={dims.cols}
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
          <Text dimColor wrap="truncate">{logsHelp}</Text>
          <Box height={1}><Text color="yellow" wrap="truncate">{message || " "}</Text></Box>
        </Box>
        {downloadsOverlay}
        {presetOverlay}
        {confirmDeleteOverlay}
        {telemetryOverlay}
      </Box>
    )
  }

  const footerRows = 2
  const baseChromeRows = bannerRows + 1 /* top rule */ + footerRows + 1 /* message */
  const bodyRows = Math.max(6, dims.rows - baseChromeRows)
  const isEmpty = models.length === 0
  const selectedTitle = selected
    ? (selected.source.type === "hf" ? selected.source.repo : selected.slug)
    : undefined
  const visibleListRows = isEmpty
    ? bodyRows
    : showLogPreview
      ? Math.max(4, Math.min(filtered.length, Math.floor((bodyRows - 1) * 0.6)))
      : Math.max(1, filtered.length)
  const listRows = isEmpty ? bodyRows : visibleListRows
  const logRows = showLogPreview ? Math.max(4, bodyRows - listRows - 1) : 0
  const compactViewportRows = !isEmpty && !showLogPreview && dims.rows <= 24 ? visibleListRows : undefined
  const listHelp = isEmpty
    ? (dims.cols < 90 ? "↑↓ move · ⏎ pull · p · S · s · D · q" : "↑↓ move · ⏎ pull · p repo · S search · s scan · D downloads · q quit")
    : (dims.cols < 90 ? "↑↓ move · ⏎ toggle · r · k · P · d · D · / · t · tab · q" : "↑↓ move · ⏎ toggle · r restart · k kill · P expose · d delete · D downloads · s scan · p pull · S search · e preset · t telemetry · / filter · tab logs · q quit")

  return (
    <Box width={dims.cols} flexDirection="column">
        <Banner
          status={`${instances.length} running · ${models.length} in registry`}
          sys={sys}
          dev={process.env.ATHANOR_DEV_TUI === "1"}
          mode={bannerMode}
          cols={dims.cols}
        />
        <Text dimColor>{divider}</Text>
        {isEmpty
            ? <Box flexDirection="column" height={listRows} overflow="hidden">
                <Suggestions selectedIndex={suggIdx} />
              </Box>
            : <>
                <Box flexDirection="column" height={compactViewportRows ?? visibleListRows} overflow="hidden">
                  <ModelList
                    models={filtered}
                    selectedIndex={selectedIdx}
                    instances={instMap}
                    stats={instStats}
                    cols={dims.cols}
                    compact={compactList}
                    maxRows={compactViewportRows}
                  />
                </Box>
                {showLogPreview
                  ? <>
                      <Text dimColor>{divider}</Text>
                      <Box flexDirection="column" height={logRows} overflow="hidden">
                        <Box height={1}>
                          <Text dimColor wrap="truncate">{selectedTitle ?? " "}</Text>
                        </Box>
                        <LogTail logFile={selectedInst?.logFile} lines={Math.max(1, logRows - 2)} compact={compactList} />
                      </Box>
                    </>
                  : null}
              </>}
        <Text dimColor>{divider}</Text>
        {mode === "filter"
          ? <Text wrap="truncate">/ {filter}<Text dimColor>  (esc/⏎ done)</Text></Text>
          : <Text dimColor wrap="truncate">{listHelp}</Text>}
        {message && watcherReady ? <Text color="yellow" wrap="truncate">{message}</Text> : null}
      {downloadsOverlay}
      {presetOverlay}
      {confirmDeleteOverlay}
      {telemetryOverlay}
    </Box>
  )
}

export default App
