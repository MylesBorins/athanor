import { useCallback, useMemo, useState } from "react"
import { pull } from "../pull/hf.js"
import { PullAbortedError, type ProgressEvent } from "../pull/download.js"

export type DownloadTaskStatus = "queued" | "running" | "done" | "error" | "cancelled"

interface FileState {
  done: number
  total: number | null
}

export interface DownloadTask {
  id: string
  repo: string
  file?: string
  status: DownloadTaskStatus
  stageLabel: string
  currentFile: string
  rate: number | null
  errorLine: string
  byteFiles: Map<string, FileState>
  createdAt: number
  updatedAt: number
  resultMessage?: string
}

interface InternalTask extends DownloadTask {
  abort: AbortController
}

export interface QueueDownloadInput {
  repo: string
  file?: string
}

export interface DownloadsState {
  tasks: DownloadTask[]
  queueDownload: (input: QueueDownloadInput) => DownloadTask
  cancelDownload: (id: string) => void
  clearFinished: () => void
  activeCount: number
}

export function sameTarget(task: DownloadTask, input: QueueDownloadInput): boolean {
  return task.repo === input.repo && (task.file ?? "") === (input.file ?? "")
}

export function findActiveDuplicate(tasks: DownloadTask[], input: QueueDownloadInput): DownloadTask | undefined {
  return tasks.find(task => sameTarget(task, input) && (task.status === "queued" || task.status === "running"))
}

export function keepActiveTasks<T extends DownloadTask>(tasks: T[]): T[] {
  return tasks.filter(task => task.status === "running" || task.status === "queued")
}

export function markTaskSuccess<T extends DownloadTask>(tasks: T[], id: string, message: string): T[] {
  return tasks.map(task =>
    task.id === id
      ? {
          ...task,
          status: "done",
          stageLabel: "done",
          resultMessage: message,
          updatedAt: Date.now()
        }
      : task
  ) as T[]
}

export function markTaskFailure<T extends DownloadTask>(tasks: T[], id: string, err: unknown): T[] {
  const message = err instanceof PullAbortedError
    ? "pull cancelled"
    : `pull failed: ${err instanceof Error ? err.message : String(err)}`
  const status: DownloadTaskStatus = err instanceof PullAbortedError ? "cancelled" : "error"
  return tasks.map(task =>
    task.id === id
      ? {
          ...task,
          status,
          stageLabel: status === "cancelled" ? "cancelled" : "error",
          errorLine: status === "error" ? message : task.errorLine,
          resultMessage: message,
          updatedAt: Date.now()
        }
      : task
  ) as T[]
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function useDownloads(onTaskFinished?: (message: string) => void): DownloadsState {
  const [tasks, setTasks] = useState<InternalTask[]>([])

  const queueDownload = useCallback((input: QueueDownloadInput): DownloadTask => {
    const existing = findActiveDuplicate(tasks, input)
    if (existing) return existing

    const id = randomId()
    const abort = new AbortController()
    const base: InternalTask = {
      id,
      repo: input.repo,
      file: input.file,
      status: "running",
      stageLabel: "resolving…",
      currentFile: "",
      rate: null,
      errorLine: "",
      byteFiles: new Map(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      abort
    }

    setTasks(prev => [base, ...prev])

    const handleEvent = (ev: ProgressEvent): void => {
      setTasks(prev => prev.map(task => {
        if (task.id !== id) return task
        if (ev.type === "resolving") {
          return { ...task, stageLabel: "resolving…", updatedAt: Date.now() }
        }
        if (ev.type === "done") {
          return { ...task, stageLabel: "finalizing…", updatedAt: Date.now() }
        }
        if (ev.type === "error") {
          return { ...task, errorLine: ev.message, updatedAt: Date.now() }
        }
        if (ev.unit !== "B") return task
        const byteFiles = new Map(task.byteFiles)
        const existing = byteFiles.get(ev.file) ?? { done: 0, total: null }
        const done = "done" in ev ? ev.done : existing.done
        const total = ev.total ?? existing.total
        byteFiles.set(ev.file, { done, total })
        return {
          ...task,
          stageLabel: "downloading",
          currentFile: ev.file,
          rate: ev.type === "progress" ? ev.rate : task.rate,
          byteFiles,
          updatedAt: Date.now()
        }
      }))
    }

    void pull({
      repo: input.repo,
      file: input.file,
      signal: abort.signal,
      onEvent: handleEvent,
      onLine: line => {
        setTasks(prev => prev.map(task =>
          task.id === id ? { ...task, errorLine: line, updatedAt: Date.now() } : task
        ))
      }
    })
      .then(res => {
        const message = `pulled ${res.entry.slug} (port ${res.entry.port})`
        setTasks(prev => markTaskSuccess(prev, id, message))
        onTaskFinished?.(message)
      })
      .catch(err => {
        const tasksWithFailure = markTaskFailure(tasks, id, err)
        const failed = tasksWithFailure.find(task => task.id === id)
        setTasks(prev => markTaskFailure(prev, id, err))
        onTaskFinished?.(failed?.resultMessage ?? "pull failed")
      })

    return base
  }, [onTaskFinished, tasks])

  const cancelDownload = useCallback((id: string) => {
    setTasks(prev => {
      const task = prev.find(t => t.id === id)
      task?.abort.abort()
      return prev
    })
  }, [])

  const clearFinished = useCallback(() => {
    setTasks(prev => keepActiveTasks(prev))
  }, [])

  const activeCount = useMemo(
    () => tasks.filter(task => task.status === "queued" || task.status === "running").length,
    [tasks]
  )

  return { tasks, queueDownload, cancelDownload, clearFinished, activeCount }
}
