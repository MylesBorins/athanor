import React, { useEffect, useMemo, useRef, useState } from "react"
import { Box, Text, useInput, useApp, useStdout, useStdin } from "ink"
import type { ActiveInstance, ModelEntry } from "../types/index.js"
import { listModels, removeModel, updateModel } from "../registry/index.js"
import { supervisor } from "../supervisor/index.js"
import { syncPi } from "../sync/pi.js"
import { ingestDiscovered } from "../discovery/ingest.js"
import { startCacheWatcher } from "../discovery/watcher.js"
import {
  parseCompletionStats,
  sampleProcessStats,
  sampleSystemStats,
  type SysStats
} from "../supervisor/metrics.js"
import { tailLog } from "../supervisor/logs.js"
import { Banner } from "./Banner.js"
import { ModelList, type InstanceStats } from "./ModelList.js"
import { LogTail } from "./LogTail.js"
import { LogFocus } from "./LogFocus.js"
import { PullModal } from "./PullModal.js"
import { PresetEditor } from "./PresetEditor.js"

type Mode = "list" | "filter" | "pull" | "preset" | "logs"

export interface AppProps {
  initialMessage?: string
}

const App: React.FC<AppProps> = ({ initialMessage }) => {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const { stdin, setRawMode, isRawModeSupported } = useStdin()
  const [models, setModels] = useState<ModelEntry[]>(listModels())
  const [instances, setInstances] = useState<ActiveInstance[]>(supervisor.list())
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [message, setMessage] = useState(initialMessage ?? "")
  const [mode, setMode] = useState<Mode>("list")
  const [filter, setFilter] = useState("")
  const [sys, setSys] = useState<SysStats | undefined>()
  const [instStats, setInstStats] = useState<Map<string, InstanceStats>>(new Map())
  const [logScroll, setLogScroll] = useState(0)
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

  useEffect(() => {
    const tick = (): void => {
      const insts = supervisor.list()
      setInstances(insts)
      setModels(listModels())
      setSys(sampleSystemStats())
      const proc = sampleProcessStats(insts.map(i => i.pid))
      setInstStats(prev => {
        const next = new Map<string, InstanceStats>()
        for (const inst of insts) {
          const logChunk = tailLog(inst.logFile, 16384)
          const completion = parseCompletionStats(logChunk) ?? prev.get(inst.id)?.completion
          next.set(inst.id, { proc: proc.get(inst.pid), completion })
        }
        return next
      })
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

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

  // Watch the HF cache (and llama models dir) for out-of-band model
  // additions so `hf download` in another terminal is picked up
  // without the user pressing `s`. Watcher is debounced; a partial
  // snapshot (no refs/main yet) is a silent no-op and the next event
  // from the same download triggers another scan.
  useEffect(() => {
    const watcher = startCacheWatcher(added => {
      setModels(listModels())
      const names = added.slice(0, 3).map(m => m.slug).join(", ")
      const more = added.length > 3 ? ` +${added.length - 3} more` : ""
      setMessage(`+${added.length} new: ${names}${more}`)
    })
    return () => watcher.stop()
  }, [])

  const instMap = useMemo(() => new Map(instances.map(i => [i.id, i])), [instances])
  const selected = filtered[selectedIdx]
  const selectedInst = selected ? instMap.get(selected.id) : undefined

  // Scroll state is scoped to "the currently selected instance's log".
  // Entering logs mode, swapping models, or a log file changing under
  // us resets the view back to tail so the user isn't left paused on
  // stale content.
  useEffect(() => { setLogScroll(0) }, [selectedInst?.logFile, mode === "logs"])

  // Mouse wheel support. Ink has no mouse support, so we enable SGR
  // mouse reporting ourselves and parse wheel events off stdin. Refs
  // track mode and filtered-list length so the listener doesn't have
  // to re-attach on every render. `lastMouseAtRef` is a timestamp used
  // by useInput to ignore keypresses Ink manufactures from the same
  // data chunk (e.g. a lone ESC from the mouse sequence preamble).
  const modeRef = useRef(mode)
  useEffect(() => { modeRef.current = mode }, [mode])
  const filteredLenRef = useRef(filtered.length)
  useEffect(() => { filteredLenRef.current = filtered.length }, [filtered.length])
  const lastMouseAtRef = useRef(0)

  useEffect(() => {
    if (!stdin || !stdout || !isRawModeSupported) return
    setRawMode(true)
    // ?1000h = button events (required for wheel), ?1006h = SGR
    // coordinate format. No motion tracking — we only care about
    // discrete wheel notches.
    const enable  = "\x1b[?1000h\x1b[?1006h"
    const disable = "\x1b[?1006l\x1b[?1000l"
    stdout.write(enable)

    const LOG_WHEEL_STEP = 3
    const handler = (data: Buffer): void => {
      const s = data.toString("utf8")
      // SGR mouse: ESC [ < Cb ; Cx ; Cy (M=press, m=release). Wheel
      // events have bit 6 set in Cb; bit 0 picks up vs down
      // (64 = wheel up, 65 = wheel down, 68/69 with shift, etc.).
      const re = /\x1b\[<(\d+);\d+;\d+[Mm]/g
      let match: RegExpExecArray | null
      let sawMouse = false
      while ((match = re.exec(s)) !== null) {
        sawMouse = true
        const cb = parseInt(match[1], 10)
        if ((cb & 64) === 0) continue
        const down = (cb & 1) === 1
        if (modeRef.current === "logs") {
          if (down) setLogScroll(o => Math.max(0, o - LOG_WHEEL_STEP))
          else      setLogScroll(o => o + LOG_WHEEL_STEP)
        } else if (modeRef.current === "list") {
          // Move the list cursor one entry per wheel notch so
          // trackpad/mouse behavior matches single-step arrow keys.
          const len = filteredLenRef.current
          if (len === 0) continue
          setSelectedIdx(i =>
            down
              ? Math.min(i + 1, len - 1)
              : Math.max(i - 1, 0)
          )
        }
      }
      if (sawMouse) lastMouseAtRef.current = Date.now()
    }
    // Prepend so we set the suppression timestamp before Ink's own
    // data listener fires useInput for the same chunk.
    stdin.prependListener("data", handler)

    // Safety net: if the process exits without React unmounting (e.g.
    // uncaught exception, SIGTERM, process.exit), write the disable
    // sequence synchronously so the user's terminal isn't left
    // reporting mouse events as garbage characters.
    let cleaned = false
    const cleanup = (): void => {
      if (cleaned) return
      cleaned = true
      try { stdout.write(disable) } catch { /* stdout may be closed */ }
    }
    process.on("exit", cleanup)
    const onSignal = (): void => { cleanup(); process.exit(0) }
    process.on("SIGTERM", onSignal)
    process.on("SIGHUP",  onSignal)

    return () => {
      stdin.off("data", handler)
      process.off("exit", cleanup)
      process.off("SIGTERM", onSignal)
      process.off("SIGHUP",  onSignal)
      cleanup()
    }
  }, [stdin, stdout, setRawMode, isRawModeSupported])

  async function toggleStartStop() {
    if (!selected) return
    const inst = instMap.get(selected.id)
    try {
      if (inst) {
        setMessage(`stopping ${selected.slug}…`)
        await supervisor.stop(selected.id)
        syncPi({ instances: supervisor.list() })
        setMessage(`stopped ${selected.slug}`)
      } else {
        setMessage(`starting ${selected.slug}…`)
        const started = await supervisor.start(selected)
        syncPi({ activeDefault: started, instances: supervisor.list() })
        setMessage(`${selected.slug} ready on :${started.port}`)
      }
      setInstances(supervisor.list())
    } catch (err: any) {
      setMessage(`error: ${err.message ?? err}`)
    }
  }

  async function restart() {
    if (!selected) return
    try {
      setMessage(`restarting ${selected.slug}…`)
      const inst = await supervisor.restart(selected)
      syncPi({ activeDefault: inst, instances: supervisor.list() })
      setInstances(supervisor.list())
      setMessage(`${selected.slug} ready on :${inst.port}`)
    } catch (err: any) {
      setMessage(`error: ${err.message ?? err}`)
    }
  }

  function toggleExpose() {
    if (!selected) return
    const next = !selected.publish
    updateModel(selected.id, { publish: next })
    setModels(listModels())
    syncPi({ instances: supervisor.list() })
    setMessage(`${selected.slug} ${next ? "exposed" : "hidden"}`)
  }

  function deleteEntry() {
    if (!selected) return
    if (instMap.get(selected.id)) { setMessage("stop it first before deleting"); return }
    removeModel(selected.id)
    setModels(listModels())
    syncPi({ instances: supervisor.list() })
    setMessage(`removed ${selected.slug}`)
  }

  function rescan() {
    const rep = ingestDiscovered()
    setModels(listModels())
    setMessage(`scan: +${rep.added.length} new`)
  }

  useInput((input, key) => {
    if (mode === "pull" || mode === "preset") return
    // Mouse wheel events arrive as SGR sequences ("\x1b[<64;10;20M")
    // that Ink may split across multiple useInput calls — including a
    // lone key.escape for the leading ESC byte, which would otherwise
    // close filter mode. Suppress any useInput fired within a short
    // window of a mouse event, plus any input that literally contains
    // the SGR mouse prefix.
    if (Date.now() - lastMouseAtRef.current < 20) return
    if (input.indexOf("[<") >= 0 || input.indexOf("\x1b[<") >= 0) return
    if (mode === "filter") {
      if (key.escape || key.return) { setMode("list"); return }
      if (key.backspace || key.delete) { setFilter(f => f.slice(0, -1)); return }
      if (input && !key.ctrl && !key.meta) setFilter(f => f + input)
      return
    }
    if (key.tab) { setMode(m => (m === "logs" ? "list" : "logs")); return }
    // In logs mode, ↑/↓ and PgUp/PgDn scroll the log rather than
    // moving the (hidden) selection. End/G jump back to the tail; g
    // and Home jump to the top of the available buffer.
    if (mode === "logs") {
      const page = Math.max(1, Math.floor(dims.rows / 2))
      if (key.upArrow)        { setLogScroll(o => o + 1); return }
      if (key.downArrow)      { setLogScroll(o => Math.max(0, o - 1)); return }
      if (key.pageUp)         { setLogScroll(o => o + page); return }
      if (key.pageDown)       { setLogScroll(o => Math.max(0, o - page)); return }
      if (input === "G" || key.end)  { setLogScroll(0); return }
      if (input === "g" || key.home) { setLogScroll(1e9); return }
    }
    if (key.downArrow) setSelectedIdx(i => Math.min(i + 1, filtered.length - 1))
    else if (key.upArrow) setSelectedIdx(i => Math.max(i - 1, 0))
    else if (key.return) void toggleStartStop()
    else if (input === "r") void restart()
    else if (input === "k") { if (selectedInst) void supervisor.stop(selected!.id).then(() => { setInstances(supervisor.list()); syncPi({ instances: supervisor.list() }) }) }
    else if (input === "P") toggleExpose()
    else if (input === "d") deleteEntry()
    else if (input === "s") rescan()
    else if (input === "/") { setFilter(""); setMode("filter") }
    else if (input === "p") setMode("pull")
    else if (input === "e") { if (selected) setMode("preset") }
    else if (input === "q") exit()
  })

  if (mode === "pull") {
    return <PullModal
      onDone={msg => { setMessage(msg); setModels(listModels()); setMode("list") }}
      onCancel={() => setMode("list")} />
  }

  if (mode === "preset" && selected) {
    return <PresetEditor
      entryId={selected.id}
      onClose={msg => { if (msg) setMessage(msg); setModels(listModels()); setMode("list") }} />
  }

  if (mode === "logs") {
    // Tab hides only the model selector — banner and footer stay so
    // global context (system load, keybindings) remains visible. The
    // log pane takes over everything the ModelList used to occupy.
    const bannerRows = 7
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
        {message ? <Text color="yellow">{message}</Text> : null}
      </Box>
    )
  }

  // Allocate space: banner is ~7 rows, header row is 1, two rules are 2,
  // list gets the top chunk, log tail gets the bottom chunk, footer is 2.
  const bannerRows = 7
  const chromeRows = bannerRows + 1 /* stats */ + 2 /* rules */ + 2 /* footer */
  const bodyRows = Math.max(8, dims.rows - chromeRows)
  const listRows = Math.max(4, Math.min(filtered.length + 1, Math.floor(bodyRows * 0.55)))
  const logRows = Math.max(4, bodyRows - listRows)
  const divider = "─".repeat(Math.max(8, dims.cols - 2))

  return (
    <Box flexDirection="column" width={dims.cols} height={dims.rows}>
      <Banner
        status={`${instances.length} running · ${models.length} in registry`}
        sys={sys}
      />
      <Text dimColor>{divider}</Text>
      <Box flexDirection="column" height={listRows} overflow="hidden">
        <ModelList
          models={filtered}
          selectedIndex={selectedIdx}
          instances={instMap}
          stats={instStats}
        />
      </Box>
      <Text dimColor>{divider}</Text>
      <Box flexDirection="column" height={logRows} overflow="hidden">
        <LogTail logFile={selectedInst?.logFile} lines={logRows - 1} />
      </Box>
      <Text dimColor>{divider}</Text>
      {mode === "filter"
        ? <Text>/ {filter}<Text dimColor>  (esc/⏎ done)</Text></Text>
        : <Text dimColor>↑↓ · ⏎ start/stop · r restart · k kill · P expose/hide · d remove · s scan · p pull · e preset · / filter · tab hide list · q quit</Text>}
      {message ? <Text color="yellow">{message}</Text> : null}
    </Box>
  )
}

export default App
