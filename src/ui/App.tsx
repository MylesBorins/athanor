import React, { useEffect, useMemo, useState } from "react"
import { Box, Text, useInput, useApp, useStdout } from "ink"
import type { ActiveInstance, ModelEntry } from "../types/index.js"
import { listModels, removeModel, updateModel } from "../registry/index.js"
import { supervisor } from "../supervisor/index.js"
import { syncPi } from "../sync/pi.js"
import { ingestDiscovered } from "../discovery/ingest.js"
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
import { PullModal } from "./PullModal.js"
import { PresetEditor } from "./PresetEditor.js"

type Mode = "list" | "filter" | "pull" | "preset"

export interface AppProps {
  initialMessage?: string
}

const App: React.FC<AppProps> = ({ initialMessage }) => {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [models, setModels] = useState<ModelEntry[]>(listModels())
  const [instances, setInstances] = useState<ActiveInstance[]>(supervisor.list())
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [message, setMessage] = useState(initialMessage ?? "")
  const [mode, setMode] = useState<Mode>("list")
  const [filter, setFilter] = useState("")
  const [sys, setSys] = useState<SysStats | undefined>()
  const [instStats, setInstStats] = useState<Map<string, InstanceStats>>(new Map())
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

  const instMap = useMemo(() => new Map(instances.map(i => [i.id, i])), [instances])
  const selected = filtered[selectedIdx]
  const selectedInst = selected ? instMap.get(selected.id) : undefined

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
    if (mode === "filter") {
      if (key.escape || key.return) { setMode("list"); return }
      if (key.backspace || key.delete) { setFilter(f => f.slice(0, -1)); return }
      if (input && !key.ctrl && !key.meta) setFilter(f => f + input)
      return
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
        : <Text dimColor>↑↓ · ⏎ start/stop · r restart · k kill · P expose/hide · d remove · s scan · p pull · e preset · / filter · q quit</Text>}
      {message ? <Text color="yellow">{message}</Text> : null}
    </Box>
  )
}

export default App
