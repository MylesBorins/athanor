import { useCallback } from "react"
import { listModels } from "../registry/index.js"
import { supervisor } from "../supervisor/index.js"
import {
  deleteModelFromDisk,
  restartModel,
  scanModelsAndReport,
  setPublished,
  startModel,
  stopModel
} from "../app/models.js"
import type { ActiveInstance, ModelEntry } from "../types/index.js"

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export interface ModelActionDeps {
  selected: ModelEntry | undefined
  instMap: Map<string, ActiveInstance>
  setMessage: (message: string) => void
  setInstances: (instances: ActiveInstance[]) => void
  setModels: (models: ModelEntry[]) => void
}

export interface ModelActions {
  toggleStartStop: () => Promise<void>
  restart: () => Promise<void>
  toggleExpose: () => void
  deleteEntry: () => void
  rescan: () => void
  killSelected: () => Promise<void>
}

export function useModelActions(deps: ModelActionDeps): ModelActions {
  const { selected, instMap, setMessage, setInstances, setModels } = deps

  const toggleStartStop = useCallback(async () => {
    if (!selected) return
    const inst = instMap.get(selected.id)
    try {
      if (inst) {
        setMessage(`stopping ${selected.slug}…`)
        await stopModel(selected.id)
        setMessage(`stopped ${selected.slug}`)
      } else {
        setMessage(`starting ${selected.slug}…`)
        const { instance } = await startModel(selected.id)
        setMessage(`${selected.slug} ready on :${instance.port}`)
      }
      setInstances(supervisor.list())
    } catch (err) {
      setMessage(`error: ${errMsg(err)}`)
    }
  }, [selected, instMap, setMessage, setInstances])

  const restart = useCallback(async () => {
    if (!selected) return
    try {
      setMessage(`restarting ${selected.slug}…`)
      const { instance } = await restartModel(selected.id)
      setInstances(supervisor.list())
      setMessage(`${selected.slug} ready on :${instance.port}`)
    } catch (err) {
      setMessage(`error: ${errMsg(err)}`)
    }
  }, [selected, setInstances, setMessage])

  const toggleExpose = useCallback(() => {
    if (!selected) return
    const next = !selected.publish
    setPublished(selected.id, next)
    setModels(listModels())
    setMessage(`${selected.slug} ${next ? "exposed" : "hidden"}`)
  }, [selected, setModels, setMessage])

  const deleteEntry = useCallback(() => {
    if (!selected) return
    if (instMap.get(selected.id)) { setMessage("stop it first before deleting"); return }
    try {
      deleteModelFromDisk(selected.id)
      setModels(listModels())
      setMessage(`deleted ${selected.slug} from disk`)
    } catch (err) {
      setModels(listModels())
      setMessage(`error: ${errMsg(err)}`)
    }
  }, [selected, instMap, setModels, setMessage])

  const rescan = useCallback(() => {
    const rep = scanModelsAndReport()
    setModels(listModels())
    setMessage(`scan: +${rep.added.length} new`)
  }, [setModels, setMessage])

  const killSelected = useCallback(async () => {
    if (!selected || !instMap.get(selected.id)) return
    await stopModel(selected.id)
    setInstances(supervisor.list())
  }, [selected, instMap, setInstances])

  return { toggleStartStop, restart, toggleExpose, deleteEntry, rescan, killSelected }
}
