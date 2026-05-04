import { useEffect, useRef } from "react"
import type { SetStateAction, Dispatch } from "react"

interface Dims {
  cols: number
  rows: number
}

interface UseMouseWheelOpts {
  mode: string
  filteredLength: number
  dims: Dims
  stdin: NodeJS.ReadStream | undefined
  stdout: NodeJS.WriteStream | undefined
  setRawMode: ((value: boolean) => void) | undefined
  isRawModeSupported: boolean
  setLogScroll: Dispatch<SetStateAction<number>>
  setSelectedIdx: Dispatch<SetStateAction<number>>
}

export function useMouseWheel(opts: UseMouseWheelOpts): React.MutableRefObject<number> {
  const {
    mode,
    filteredLength,
    dims,
    stdin,
    stdout,
    setRawMode,
    isRawModeSupported,
    setLogScroll,
    setSelectedIdx
  } = opts

  const modeRef = useRef(mode)
  useEffect(() => { modeRef.current = mode }, [mode])
  const filteredLenRef = useRef(filteredLength)
  useEffect(() => { filteredLenRef.current = filteredLength }, [filteredLength])
  const dimsRef = useRef(dims)
  useEffect(() => { dimsRef.current = dims }, [dims])
  const lastMouseAtRef = useRef(0)

  function listEndY(): number {
    const rows = dimsRef.current.rows
    const filteredLen = filteredLenRef.current
    const bannerRows = 12
    const chromeRows = bannerRows + 1 + 2 + 2 + 1
    const bodyRows = Math.max(8, rows - chromeRows)
    const listRows = Math.max(4, Math.min(filteredLen + 1, Math.floor(bodyRows * 0.55)))
    return bannerRows + 1 + listRows
  }

  useEffect(() => {
    if (!stdin || !stdout || !isRawModeSupported || !setRawMode) return
    setRawMode(true)
    const enable = "\x1b[?1000h\x1b[?1006h"
    const disable = "\x1b[?1006l\x1b[?1000l"
    stdout.write(enable)

    const LOG_WHEEL_STEP = 3

    const handler = (data: Buffer): void => {
      const s = data.toString("utf8")
      const re = /\x1b\[<(\d+);(\d+);(\d+)[Mm]/g
      let match: RegExpExecArray | null
      let sawMouse = false
      while ((match = re.exec(s)) !== null) {
        sawMouse = true
        const cb = parseInt(match[1], 10)
        if ((cb & 64) === 0) continue
        const down = (cb & 1) === 1
        const y = parseInt(match[3], 10)
        if (modeRef.current === "logs") {
          if (down) setLogScroll(o => Math.max(0, o - LOG_WHEEL_STEP))
          else      setLogScroll(o => o + LOG_WHEEL_STEP)
        } else if (modeRef.current === "list") {
          const overLogs = y > listEndY()
          if (overLogs) {
            if (down) setLogScroll(o => Math.max(0, o - LOG_WHEEL_STEP))
            else      setLogScroll(o => o + LOG_WHEEL_STEP)
          } else {
            const len = filteredLenRef.current
            if (len === 0) continue
            setSelectedIdx(i =>
              down
                ? Math.min(i + 1, len - 1)
                : Math.max(i - 1, 0)
            )
          }
        }
      }
      if (sawMouse) lastMouseAtRef.current = Date.now()
    }

    stdin.prependListener("data", handler)

    let cleaned = false
    const cleanup = (): void => {
      if (cleaned) return
      cleaned = true
      try { stdout.write(disable) } catch { /* stdout may be closed */ }
    }
    process.on("exit", cleanup)
    const onSignal = (): void => { cleanup(); process.exit(0) }
    process.on("SIGTERM", onSignal)
    process.on("SIGHUP", onSignal)

    return () => {
      stdin.off("data", handler)
      process.off("exit", cleanup)
      process.off("SIGTERM", onSignal)
      process.off("SIGHUP", onSignal)
      cleanup()
    }
  }, [stdin, stdout, setRawMode, isRawModeSupported, setLogScroll, setSelectedIdx])

  return lastMouseAtRef
}
