import { beforeEach, describe, expect, it, vi } from "vitest"

const useInput = vi.fn()

vi.mock("ink", () => ({ useInput }))

describe("useAppInput", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("routes enter to toggleStartStop in list mode", async () => {
    const toggleStartStop = vi.fn(async () => {})
    const restart = vi.fn(async () => {})
    const killSelected = vi.fn(async () => {})
    const toggleExpose = vi.fn()
    const deleteEntry = vi.fn()
    const rescan = vi.fn()
    const exit = vi.fn()
    const setMode = vi.fn()
    const setFilter = vi.fn()
    const setSelectedIdx = vi.fn()
    const setLogScroll = vi.fn()
    const setSuggIdx = vi.fn()
    const setPullPrefill = vi.fn()

    const { useAppInput } = await import("./useAppInput.js")
    useAppInput({
      mode: "list",
      dims: { cols: 100, rows: 30 },
      models: [{ id: "a", slug: "a" } as any],
      filtered: [{ id: "a", slug: "a" } as any],
      selected: { id: "a", slug: "a" } as any,
      selectedInst: undefined,
      suggIdx: 0,
      lastMouseAtRef: { current: 0 },
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

    const handler = useInput.mock.calls[0][0]
    handler("", { return: true })
    await Promise.resolve()
    expect(toggleStartStop).toHaveBeenCalled()
  })

  it("enters filter mode on slash and appends text while filtering", async () => {
    const base = {
      dims: { cols: 100, rows: 30 },
      models: [{ id: "a", slug: "a" } as any],
      filtered: [{ id: "a", slug: "a" } as any],
      selected: { id: "a", slug: "a" } as any,
      selectedInst: undefined,
      suggIdx: 0,
      lastMouseAtRef: { current: 0 },
      setMode: vi.fn(),
      setFilter: vi.fn(),
      setSelectedIdx: vi.fn(),
      setLogScroll: vi.fn(),
      setSuggIdx: vi.fn(),
      setPullPrefill: vi.fn(),
      exit: vi.fn(),
      toggleStartStop: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      killSelected: vi.fn(async () => {}),
      toggleExpose: vi.fn(),
      deleteEntry: vi.fn(),
      rescan: vi.fn()
    }

    const { useAppInput } = await import("./useAppInput.js")
    useAppInput({ ...base, mode: "list" })
    let handler = useInput.mock.calls[0][0]
    handler("/", {})
    expect(base.setFilter).toHaveBeenCalledWith("")
    expect(base.setMode).toHaveBeenCalledWith("filter")

    vi.clearAllMocks()
    useAppInput({ ...base, mode: "filter" })
    handler = useInput.mock.calls[0][0]
    handler("x", { ctrl: false, meta: false })
    expect(base.setFilter).toHaveBeenCalled()
    const updater = base.setFilter.mock.calls[0][0]
    expect(updater("ab")).toBe("abx")
  })

  it("routes empty-state enter into pull modal prefill", async () => {
    const setMode = vi.fn()
    const setPullPrefill = vi.fn()
    const setFilter = vi.fn()
    const setSelectedIdx = vi.fn()
    const setLogScroll = vi.fn()
    const setSuggIdx = vi.fn()
    const exit = vi.fn()

    const { useAppInput } = await import("./useAppInput.js")
    useAppInput({
      mode: "list",
      dims: { cols: 100, rows: 30 },
      models: [],
      filtered: [],
      selected: undefined,
      selectedInst: undefined,
      suggIdx: 0,
      lastMouseAtRef: { current: 0 },
      setMode,
      setFilter,
      setSelectedIdx,
      setLogScroll,
      setSuggIdx,
      setPullPrefill,
      exit,
      toggleStartStop: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      killSelected: vi.fn(async () => {}),
      toggleExpose: vi.fn(),
      deleteEntry: vi.fn(),
      rescan: vi.fn()
    })

    const handler = useInput.mock.calls[0][0]
    handler("", { return: true })
    expect(setPullPrefill).toHaveBeenCalled()
    expect(setMode).toHaveBeenCalledWith("pull")
  })

  it("toggles between list and logs on tab", async () => {
    const setMode = vi.fn()
    const { useAppInput } = await import("./useAppInput.js")
    useAppInput({
      mode: "list",
      dims: { cols: 100, rows: 30 },
      models: [{ id: "a", slug: "a" } as any],
      filtered: [{ id: "a", slug: "a" } as any],
      selected: { id: "a", slug: "a" } as any,
      selectedInst: undefined,
      suggIdx: 0,
      lastMouseAtRef: { current: 0 },
      setMode,
      setFilter: vi.fn(),
      setSelectedIdx: vi.fn(),
      setLogScroll: vi.fn(),
      setSuggIdx: vi.fn(),
      setPullPrefill: vi.fn(),
      exit: vi.fn(),
      toggleStartStop: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      killSelected: vi.fn(async () => {}),
      toggleExpose: vi.fn(),
      deleteEntry: vi.fn(),
      rescan: vi.fn()
    })

    const handler = useInput.mock.calls[0][0]
    handler("", { tab: true })
    const updater = setMode.mock.calls[0][0]
    expect(updater("list")).toBe("logs")
    expect(updater("logs")).toBe("list")
  })

  it("scrolls logs with arrows, page keys, and home/end", async () => {
    const setLogScroll = vi.fn()
    const { useAppInput } = await import("./useAppInput.js")
    useAppInput({
      mode: "logs",
      dims: { cols: 100, rows: 20 },
      models: [{ id: "a", slug: "a" } as any],
      filtered: [{ id: "a", slug: "a" } as any],
      selected: { id: "a", slug: "a" } as any,
      selectedInst: undefined,
      suggIdx: 0,
      lastMouseAtRef: { current: 0 },
      setMode: vi.fn(),
      setFilter: vi.fn(),
      setSelectedIdx: vi.fn(),
      setLogScroll,
      setSuggIdx: vi.fn(),
      setPullPrefill: vi.fn(),
      exit: vi.fn(),
      toggleStartStop: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      killSelected: vi.fn(async () => {}),
      toggleExpose: vi.fn(),
      deleteEntry: vi.fn(),
      rescan: vi.fn()
    })

    const handler = useInput.mock.calls[0][0]
    handler("", { upArrow: true })
    expect(setLogScroll.mock.calls[0][0](5)).toBe(6)
    handler("", { downArrow: true })
    expect(setLogScroll.mock.calls[1][0](5)).toBe(4)
    handler("", { pageUp: true })
    expect(setLogScroll.mock.calls[2][0](5)).toBe(15)
    handler("", { pageDown: true })
    expect(setLogScroll.mock.calls[3][0](5)).toBe(0)
    handler("g", {})
    expect(setLogScroll).toHaveBeenNthCalledWith(5, 1e9)
    handler("G", {})
    expect(setLogScroll).toHaveBeenNthCalledWith(6, 0)
  })

  it("only kills when a selected instance exists", async () => {
    const killSelected = vi.fn(async () => {})
    const { useAppInput } = await import("./useAppInput.js")
    useAppInput({
      mode: "list",
      dims: { cols: 100, rows: 30 },
      models: [{ id: "a", slug: "a" } as any],
      filtered: [{ id: "a", slug: "a" } as any],
      selected: { id: "a", slug: "a" } as any,
      selectedInst: undefined,
      suggIdx: 0,
      lastMouseAtRef: { current: 0 },
      setMode: vi.fn(),
      setFilter: vi.fn(),
      setSelectedIdx: vi.fn(),
      setLogScroll: vi.fn(),
      setSuggIdx: vi.fn(),
      setPullPrefill: vi.fn(),
      exit: vi.fn(),
      toggleStartStop: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      killSelected,
      toggleExpose: vi.fn(),
      deleteEntry: vi.fn(),
      rescan: vi.fn()
    })
    let handler = useInput.mock.calls[0][0]
    handler("k", {})
    expect(killSelected).not.toHaveBeenCalled()

    vi.clearAllMocks()
    useAppInput({
      mode: "list",
      dims: { cols: 100, rows: 30 },
      models: [{ id: "a", slug: "a" } as any],
      filtered: [{ id: "a", slug: "a" } as any],
      selected: { id: "a", slug: "a" } as any,
      selectedInst: { id: "a" } as any,
      suggIdx: 0,
      lastMouseAtRef: { current: 0 },
      setMode: vi.fn(),
      setFilter: vi.fn(),
      setSelectedIdx: vi.fn(),
      setLogScroll: vi.fn(),
      setSuggIdx: vi.fn(),
      setPullPrefill: vi.fn(),
      exit: vi.fn(),
      toggleStartStop: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      killSelected,
      toggleExpose: vi.fn(),
      deleteEntry: vi.fn(),
      rescan: vi.fn()
    })
    handler = useInput.mock.calls[0][0]
    handler("k", {})
    await Promise.resolve()
    expect(killSelected).toHaveBeenCalled()
  })

  it("opens downloads modal on uppercase D", async () => {
    const setMode = vi.fn()
    const { useAppInput } = await import("./useAppInput.js")
    useAppInput({
      mode: "list",
      dims: { cols: 100, rows: 30 },
      models: [{ id: "a", slug: "a" } as any],
      filtered: [{ id: "a", slug: "a" } as any],
      selected: { id: "a", slug: "a" } as any,
      selectedInst: undefined,
      suggIdx: 0,
      lastMouseAtRef: { current: 0 },
      setMode,
      setFilter: vi.fn(),
      setSelectedIdx: vi.fn(),
      setLogScroll: vi.fn(),
      setSuggIdx: vi.fn(),
      setPullPrefill: vi.fn(),
      exit: vi.fn(),
      toggleStartStop: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      killSelected: vi.fn(async () => {}),
      toggleExpose: vi.fn(),
      deleteEntry: vi.fn(),
      rescan: vi.fn()
    })

    const handler = useInput.mock.calls[0][0]
    handler("D", {})
    expect(setMode).toHaveBeenCalledWith("downloads")
  })

  it("opens delete confirmation instead of deleting immediately", async () => {
    const setMode = vi.fn()
    const deleteEntry = vi.fn()
    const { useAppInput } = await import("./useAppInput.js")
    useAppInput({
      mode: "list",
      dims: { cols: 100, rows: 30 },
      models: [{ id: "a", slug: "a" } as any],
      filtered: [{ id: "a", slug: "a" } as any],
      selected: { id: "a", slug: "a" } as any,
      selectedInst: undefined,
      suggIdx: 0,
      lastMouseAtRef: { current: 0 },
      setMode,
      setFilter: vi.fn(),
      setSelectedIdx: vi.fn(),
      setLogScroll: vi.fn(),
      setSuggIdx: vi.fn(),
      setPullPrefill: vi.fn(),
      exit: vi.fn(),
      toggleStartStop: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      killSelected: vi.fn(async () => {}),
      toggleExpose: vi.fn(),
      deleteEntry,
      rescan: vi.fn()
    })

    const handler = useInput.mock.calls[0][0]
    handler("d", {})
    expect(setMode).toHaveBeenCalledWith("confirm-delete")
    expect(deleteEntry).not.toHaveBeenCalled()
  })

  it("handles empty-state shortcuts for rescan, search, pull, and quit", async () => {
    const rescan = vi.fn()
    const setMode = vi.fn()
    const setPullPrefill = vi.fn()
    const exit = vi.fn()
    const { useAppInput } = await import("./useAppInput.js")
    useAppInput({
      mode: "list",
      dims: { cols: 100, rows: 30 },
      models: [],
      filtered: [],
      selected: undefined,
      selectedInst: undefined,
      suggIdx: 0,
      lastMouseAtRef: { current: 0 },
      setMode,
      setFilter: vi.fn(),
      setSelectedIdx: vi.fn(),
      setLogScroll: vi.fn(),
      setSuggIdx: vi.fn(),
      setPullPrefill,
      exit,
      toggleStartStop: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      killSelected: vi.fn(async () => {}),
      toggleExpose: vi.fn(),
      deleteEntry: vi.fn(),
      rescan
    })

    const handler = useInput.mock.calls[0][0]
    handler("s", {})
    expect(rescan).toHaveBeenCalled()
    handler("S", {})
    expect(setMode).toHaveBeenCalledWith("search")
    handler("p", {})
    expect(setPullPrefill).toHaveBeenCalledWith(undefined)
    expect(setMode).toHaveBeenCalledWith("pull")
    handler("q", {})
    expect(exit).toHaveBeenCalled()
  })
})
