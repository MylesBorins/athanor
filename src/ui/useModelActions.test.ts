import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ActiveInstance, ModelEntry } from "../types/index.js"

const listModels = vi.fn()
const supervisorList = vi.fn()
const removeModelEntry = vi.fn()
const restartModel = vi.fn()
const scanModelsAndReport = vi.fn()
const setPublished = vi.fn()
const startModel = vi.fn()
const stopModel = vi.fn()
const useCallbackMock = vi.fn((fn: unknown) => fn)

vi.mock("react", () => ({
  useCallback: useCallbackMock
}))

vi.mock("../registry/index.js", () => ({
  listModels
}))

vi.mock("../supervisor/index.js", () => ({
  supervisor: {
    list: supervisorList
  }
}))

vi.mock("../app/models.js", () => ({
  removeModelEntry,
  restartModel,
  scanModelsAndReport,
  setPublished,
  startModel,
  stopModel
}))

function entry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "mlx-community/A",
    slug: "a",
    path: "/m/a",
    runtime: "mlx",
    source: { type: "hf", repo: "mlx-community/A" },
    port: 8081,
    publish: true,
    addedAt: 0,
    ...overrides
  }
}

function instance(overrides: Partial<ActiveInstance> = {}): ActiveInstance {
  return {
    id: "mlx-community/A",
    slug: "a",
    runtime: "mlx",
    port: 8081,
    pid: 1,
    startedAt: 0,
    status: "running",
    logFile: "/tmp/a.log",
    ...overrides
  }
}

describe("useModelActions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supervisorList.mockReturnValue([])
    listModels.mockReturnValue([])
    scanModelsAndReport.mockReturnValue({ added: [] })
  })

  it("starts a stopped model and reports success", async () => {
    const setMessage = vi.fn<(message: string) => void>()
    const setInstances = vi.fn<(instances: ActiveInstance[]) => void>()
    const setModels = vi.fn<(models: ModelEntry[]) => void>()
    startModel.mockResolvedValue({ instance: instance({ port: 9001 }) })
    supervisorList.mockReturnValue([instance({ port: 9001 })])

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: entry(),
      instMap: new Map(),
      setMessage,
      setInstances,
      setModels
    })
    await actions.toggleStartStop()

    expect(startModel).toHaveBeenCalledWith("mlx-community/A")
    expect(setMessage).toHaveBeenNthCalledWith(1, "starting a…")
    expect(setMessage).toHaveBeenNthCalledWith(2, "a ready on :9001")
    expect(setInstances).toHaveBeenCalledWith([instance({ port: 9001 })])
  })

  it("stops a running model and refreshes instances", async () => {
    const setMessage = vi.fn<(message: string) => void>()
    const setInstances = vi.fn<(instances: ActiveInstance[]) => void>()
    const setModels = vi.fn<(models: ModelEntry[]) => void>()
    stopModel.mockResolvedValue(undefined)
    supervisorList.mockReturnValue([])

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: entry(),
      instMap: new Map([["mlx-community/A", instance()]]),
      setMessage,
      setInstances,
      setModels
    })
    await actions.toggleStartStop()

    expect(stopModel).toHaveBeenCalledWith("mlx-community/A")
    expect(setMessage).toHaveBeenNthCalledWith(1, "stopping a…")
    expect(setMessage).toHaveBeenNthCalledWith(2, "stopped a")
    expect(setInstances).toHaveBeenCalledWith([])
  })

  it("toggleExpose flips publish state, reloads models, and reports status", async () => {
    const setMessage = vi.fn<(message: string) => void>()
    const setInstances = vi.fn<(instances: ActiveInstance[]) => void>()
    const setModels = vi.fn<(models: ModelEntry[]) => void>()
    const models = [entry({ publish: false })]
    listModels.mockReturnValue(models)

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: entry({ publish: true }),
      instMap: new Map(),
      setMessage,
      setInstances,
      setModels
    })
    actions.toggleExpose()

    expect(setPublished).toHaveBeenCalledWith("mlx-community/A", false)
    expect(setModels).toHaveBeenCalledWith(models)
    expect(setMessage).toHaveBeenCalledWith("a hidden")
  })

  it("deleteEntry refuses to remove a running model", async () => {
    const setMessage = vi.fn<(message: string) => void>()
    const setInstances = vi.fn<(instances: ActiveInstance[]) => void>()
    const setModels = vi.fn<(models: ModelEntry[]) => void>()

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: entry(),
      instMap: new Map([["mlx-community/A", instance()]]),
      setMessage,
      setInstances,
      setModels
    })
    actions.deleteEntry()

    expect(removeModelEntry).not.toHaveBeenCalled()
    expect(setMessage).toHaveBeenCalledWith("stop it first before deleting")
  })

  it("rescan reloads models and reports added count", async () => {
    const setMessage = vi.fn<(message: string) => void>()
    const setInstances = vi.fn<(instances: ActiveInstance[]) => void>()
    const setModels = vi.fn<(models: ModelEntry[]) => void>()
    const models = [entry()]
    scanModelsAndReport.mockReturnValue({ added: [entry(), entry({ id: "b", slug: "b" })] })
    listModels.mockReturnValue(models)

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: undefined,
      instMap: new Map(),
      setMessage,
      setInstances,
      setModels
    })
    actions.rescan()

    expect(scanModelsAndReport).toHaveBeenCalled()
    expect(setModels).toHaveBeenCalledWith(models)
    expect(setMessage).toHaveBeenCalledWith("scan: +2 new")
  })
})
