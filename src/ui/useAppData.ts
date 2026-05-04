import { useEffect, useMemo, useState } from "react"
import type { ActiveInstance, ModelEntry } from "../types/index.js"
import { listModels } from "../registry/index.js"
import { sortModelsByRecentUse } from "../registry/sort.js"
import { supervisor } from "../supervisor/index.js"
import { startCacheWatcher } from "../discovery/watcher.js"
import {
  parseCompletionStats,
  sampleProcessStats,
  sampleSystemStats,
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
}

export interface UseAppDataOpts {
  setMessage: (message: string) => void
}

export function useAppData(opts: UseAppDataOpts): AppDataState {
  const { setMessage } = opts
  const [models, setModels] = useState<ModelEntry[]>(sortModelsByRecentUse(listModels(), supervisor.list()))
  const [instances, setInstances] = useState<ActiveInstance[]>(supervisor.list())
  const [sys, setSys] = useState<SysStats | undefined>()
  const [instStats, setInstStats] = useState<Map<string, InstanceStats>>(new Map())

  useEffect(() => {
    const tick = (): void => {
      const insts = supervisor.list()
      setInstances(insts)
      setModels(sortModelsByRecentUse(listModels(), insts))
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

  useEffect(() => {
    const watcher = startCacheWatcher(added => {
      setModels(sortModelsByRecentUse(listModels(), supervisor.list()))
      const names = added.slice(0, 3).map(m => m.slug).join(", ")
      const more = added.length > 3 ? ` +${added.length - 3} more` : ""
      setMessage(`+${added.length} new: ${names}${more}`)
    })
    return () => watcher.stop()
  }, [setMessage])

  const instMap = useMemo(() => new Map(instances.map(i => [i.id, i])), [instances])

  return { models, setModels, instances, setInstances, instMap, sys, instStats }
}
