import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ActiveInstance, ModelEntry } from "../types/index.js"

const listModels = vi.fn()
const deleteModelFromDisk = vi.fn()
const restartModel = vi.fn()
const scanModelsAndReport = vi.fn()
const setPublished = vi.fn()
const startModel = vi.fn()
const stopModel = vi.fn()
const loadPersistedInstances = vi.fn()
const pidAlive = vi.fn()
const useCallbackMock = vi.fn((fn: unknown) => fn)

vi.mock("react", () => ({
  useCallback: useCallbackMock
}))

vi.mock("../registry/index.js", () => ({
  listModels
}))

vi.mock("../app/models.js", () => ({
  deleteModelFromDisk,
  restartModel,
  scanModelsAndReport,
  setPublished,
  startModel,
  stopModel
}))

vi.mock("../supervisor/state.js", () => ({
  loadPersistedInstances,
  pidAlive
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
    listModels.mockReturnValue([])
    scanModelsAndReport.mockReturnValue({ added: [] })
    loadPersistedInstances.mockReturnValue([])
    pidAlive.mockReturnValue(true)
  })

  it("starts a stopped model and reports success", async () => {
    const setMessage = vi.fn<(message: string) => void>()
    const setInstances = vi.fn<(instances: ActiveInstance[]) => void>()
    const setModels = vi.fn<(models: ModelEntry[]) => void>()
    startModel.mockResolvedValue({ instance: instance({ port: 9001 }) })
    loadPersistedInstances.mockReturnValue([instance({ port: 9001 })])

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: entry(),
      instMap: new Map(),
      setMessage,
      setInstances,
      setModels
    })
    await actions.toggleStartStop()

    expect(startModel).toHaveBeenCalledWith("mlx-community/A", { confirm: true })
    expect(setMessage).toHaveBeenNthCalledWith(1, "starting a…")
    expect(setMessage).toHaveBeenNthCalledWith(2, "a ready on :9001")
    expect(setInstances).toHaveBeenCalledWith([instance({ port: 9001 })])
  })

  it("stops a running model and refreshes instances", async () => {
    const setMessage = vi.fn<(message: string) => void>()
    const setInstances = vi.fn<(instances: ActiveInstance[]) => void>()
    const setModels = vi.fn<(models: ModelEntry[]) => void>()
    stopModel.mockResolvedValue(undefined)
    loadPersistedInstances.mockReturnValue([])

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: entry(),
      instMap: new Map([["mlx-community/A", instance()]]),
      setMessage,
      setInstances,
      setModels
    })
    await actions.toggleStartStop()

    expect(stopModel).toHaveBeenCalledWith("mlx-community/A", { drain: false })
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

    // From unpublished to published
    actions.toggleExpose()
    expect(setPublished).toHaveBeenCalledWith("mlx-community/A", false)
    const exposeActions = useModelActions({
      selected: entry({ publish: false }),
      instMap: new Map(),
      setMessage,
      setInstances,
      setModels
    })
    exposeActions.toggleExpose()
    expect(setPublished).toHaveBeenCalledWith("mlx-community/A", true)
    expect(setMessage).toHaveBeenCalledWith("a exposed")
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

    expect(deleteModelFromDisk).not.toHaveBeenCalled()
    expect(setMessage).toHaveBeenCalledWith("stop it first before deleting")
  })

  it("deleteEntry deletes the selected model from disk and reloads", async () => {
    const setMessage = vi.fn<(message: string) => void>()
    const setInstances = vi.fn<(instances: ActiveInstance[]) => void>()
    const setModels = vi.fn<(models: ModelEntry[]) => void>()
    const models: ModelEntry[] = []
    listModels.mockReturnValue(models)

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: entry(),
      instMap: new Map(),
      setMessage,
      setInstances,
      setModels
    })
    actions.deleteEntry()

    expect(deleteModelFromDisk).toHaveBeenCalledWith("mlx-community/A")
    expect(setModels).toHaveBeenCalledWith(models)
    expect(setMessage).toHaveBeenCalledWith("deleted a from disk")
  })

  it("rescan refreshes models and reports additions", async () => {
    const setMessage = vi.fn<(message: string) => void>()
    const setInstances = vi.fn<(instances: ActiveInstance[]) => void>()
    const setModels = vi.fn<(models: ModelEntry[]) => void>()
    const models = [entry()]
    listModels.mockReturnValue(models)
    scanModelsAndReport.mockReturnValue({ added: [entry(), entry({ id: "b", slug: "b" })] })

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: entry(),
      instMap: new Map(),
      setMessage,
      setInstances,
      setModels
    })
    actions.rescan()

    expect(setModels).toHaveBeenCalledWith(models)
    expect(setMessage).toHaveBeenCalledWith("scan: +2 new")
  })

  it("restart handles no-op when selected is undefined", async () => {
    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: undefined,
      instMap: new Map(),
      setMessage: vi.fn(),
      setInstances: vi.fn(),
      setModels: vi.fn()
    })
    await actions.restart()
    expect(restartModel).not.toHaveBeenCalled()
  })

  it("restart restarts the selected model and reports ready status", async () => {
    const setMessage = vi.fn()
    const setInstances = vi.fn()
    const inst = instance({ port: 9090 })
    restartModel.mockResolvedValueOnce({ instance: inst })
    loadPersistedInstances.mockReturnValue([{ id: "mlx-community/A", pid: 1, port: 9090, startedAt: 0 }])
    pidAlive.mockReturnValue(true)

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: entry(),
      instMap: new Map(),
      setMessage,
      setInstances,
      setModels: vi.fn()
    })
    await actions.restart()

    expect(restartModel).toHaveBeenCalledWith("mlx-community/A", { confirm: true })
    expect(setMessage).toHaveBeenCalledWith("restarting a…")
    expect(setMessage).toHaveBeenCalledWith("a ready on :9090")
    expect(setInstances).toHaveBeenCalled()
  })

  it("restart reports error when restartModel fails", async () => {
    const setMessage = vi.fn()
    restartModel.mockRejectedValueOnce(new Error("preflight rejected"))

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: entry(),
      instMap: new Map(),
      setMessage,
      setInstances: vi.fn(),
      setModels: vi.fn()
    })
    await actions.restart()

    expect(setMessage).toHaveBeenCalledWith("error: preflight rejected")
  })

  it("deleteEntry handles no-op when selected is undefined", async () => {
    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: undefined,
      instMap: new Map(),
      setMessage: vi.fn(),
      setInstances: vi.fn(),
      setModels: vi.fn()
    })
    actions.deleteEntry()
    expect(deleteModelFromDisk).not.toHaveBeenCalled()
  })

  it("deleteEntry reports error when deleteModelFromDisk throws", async () => {
    const setMessage = vi.fn()
    const setModels = vi.fn()
    deleteModelFromDisk.mockImplementationOnce(() => {
      throw new Error("permission denied")
    })

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: entry(),
      instMap: new Map(),
      setMessage,
      setInstances: vi.fn(),
      setModels
    })
    actions.deleteEntry()

    expect(setMessage).toHaveBeenCalledWith("error: permission denied")
    expect(setModels).toHaveBeenCalled()
  })

  it("killSelected handles no-op when selected is missing or not running", async () => {
    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: undefined,
      instMap: new Map(),
      setMessage: vi.fn(),
      setInstances: vi.fn(),
      setModels: vi.fn()
    })
    await actions.killSelected()
    expect(stopModel).not.toHaveBeenCalled()

    const stoppedActions = useModelActions({
      selected: entry(),
      instMap: new Map(),
      setMessage: vi.fn(),
      setInstances: vi.fn(),
      setModels: vi.fn()
    })
    await stoppedActions.killSelected()
    expect(stopModel).not.toHaveBeenCalled()
  })

  it("killSelected stops the running instance with drain=false and updates instances", async () => {
    const setInstances = vi.fn()
    const runningEntry = entry()
    const inst = instance()

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: runningEntry,
      instMap: new Map([[runningEntry.id, inst]]),
      setMessage: vi.fn(),
      setInstances,
      setModels: vi.fn()
    })
    await actions.killSelected()

    expect(stopModel).toHaveBeenCalledWith("mlx-community/A", { drain: false })
    expect(setInstances).toHaveBeenCalled()
  })

  it("toggleStartStop and toggleExpose do nothing when selected is undefined", async () => {
    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: undefined,
      instMap: new Map(),
      setMessage: vi.fn(),
      setInstances: vi.fn(),
      setModels: vi.fn()
    })
    await actions.toggleStartStop()
    expect(startModel).not.toHaveBeenCalled()
    expect(stopModel).not.toHaveBeenCalled()

    actions.toggleExpose()
    expect(setPublished).not.toHaveBeenCalled()
  })

  it("toggleStartStop handles failed start without instance and non-Error rejections", async () => {
    const setMessage = vi.fn()
    startModel.mockResolvedValueOnce({ instance: undefined })

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: entry(),
      instMap: new Map(),
      setMessage,
      setInstances: vi.fn(),
      setModels: vi.fn()
    })
    await actions.toggleStartStop()
    expect(setMessage).toHaveBeenCalledWith("error: failed to start a")

    // Non-Error exception
    startModel.mockRejectedValueOnce("raw string failure")
    await actions.toggleStartStop()
    expect(setMessage).toHaveBeenCalledWith("error: raw string failure")
  })

  it("restart handles restart without instance", async () => {
    const setMessage = vi.fn()
    restartModel.mockResolvedValueOnce({ instance: undefined })

    const { useModelActions } = await import("./useModelActions.js")
    const actions = useModelActions({
      selected: entry(),
      instMap: new Map(),
      setMessage,
      setInstances: vi.fn(),
      setModels: vi.fn()
    })
    await actions.restart()
    expect(setMessage).toHaveBeenCalledWith("error: failed to restart a")
  })
})
