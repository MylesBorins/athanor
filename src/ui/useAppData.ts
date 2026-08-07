import { useEffect, useMemo, useState } from "react"
import type { ActiveInstance, ModelEntry } from "../types/index.js"
import { listModels } from "../registry/index.js"
import { sortModelsByRunningThenSlug } from "../registry/sort.js"
import { loadPersistedInstances, pidAlive } from "../supervisor/state.js"
import { startCacheWatcher } from "../discovery/watcher.js"
import { reconcileIngressForCurrentState } from "../router/lifecycle.js"
import {
  parseCompletionStats,
  sampleProcessStats,
  sampleSystemStats,
  getLiveRouterStats,
  type SysStats
} from "../supervisor/metrics.js"
import { tailLog } from "../supervisor/logs.js"
import type { InstanceStats } from "./ModelList.js"

export interface AppDataState {
  models: ModelEntry[]
  setModels: React.Dispatch<React.SetStateAction<ModelEntry[]>>
  instances: ActiveInstance[]
  setInstances: React.Dispatch<React.SetStateAction<ActiveInstance[]>>
  instMap: Map<string, ActiveInstance>
  sys: SysStats | undefined
  instStats: Map<string, InstanceStats>
  watcherReady: boolean
}

export interface UseAppDataOpts {
  setMessage: (message: string) => void
}

function liveInstances(): ActiveInstance[] {
  return loadPersistedInstances().filter(inst => pidAlive(inst.pid)).map(inst => ({ ...inst, status: "running" }))
}

export function useAppData(opts: UseAppDataOpts): AppDataState {
  const { setMessage } = opts
  const [models, setModels] = useState<ModelEntry[]>(sortModelsByRunningThenSlug(listModels(), liveInstances()))
  const [instances, setInstances] = useState<ActiveInstance[]>(liveInstances())
  const [sys, setSys] = useState<SysStats | undefined>()
  const [instStats, setInstStats] = useState<Map<string, InstanceStats>>(new Map())
  const [watcherReady, setWatcherReady] = useState(false)
  const [suppressWatcherToast, setSuppressWatcherToast] = useState(true)

  useEffect(() => {
    const tick = (): void => {
      const insts = liveInstances()
      setInstances(insts)
      setModels(sortModelsByRunningThenSlug(listModels(), insts))
      setSys(sampleSystemStats())
      const proc = sampleProcessStats(insts.map(i => i.pid))
      setInstStats(prev => {
        const next = new Map<string, InstanceStats>()
        for (const inst of insts) {
          const logChunk = tailLog(inst.logFile, 16384)
          const completion = getLiveRouterStats(inst.id) ?? parseCompletionStats(logChunk) ?? prev.get(inst.id)?.completion
          next.set(inst.id, { proc: proc.get(inst.pid), completion })
        }
        return next
      })
      void reconcileIngressForCurrentState()
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let suppressInitialBurst = true
    const watcher = startCacheWatcher(added => {
      setModels(sortModelsByRunningThenSlug(listModels(), liveInstances()))
      if (suppressInitialBurst || suppressWatcherToast) return
      const names = added.slice(0, 3).map(m => m.slug).join(", ")
      const more = added.length > 3 ? ` +${added.length - 3} more` : ""
      setMessage(`+${added.length} new: ${names}${more}`)
    })
    const readyTimer = setTimeout(() => {
      suppressInitialBurst = false
      setWatcherReady(true)
      setSuppressWatcherToast(false)
    }, 4000)
    return () => {
      clearTimeout(readyTimer)
      watcher.stop()
    }
  }, [setMessage, suppressWatcherToast])

  const instMap = useMemo(() => new Map(instances.map(i => [i.id, i])), [instances])

  return { models, setModels, instances, setInstances, instMap, sys, instStats, watcherReady }
}
