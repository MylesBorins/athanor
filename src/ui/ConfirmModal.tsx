import React, { useEffect, useRef, useState } from "react"
import { Box, Text, useInput, useStdin, useStdout } from "ink"

function truncEnd(s: string, max: number): string {
  if (s.length <= max) return s
  if (max <= 1) return s.slice(0, max)
  return s.slice(0, max - 1) + "…"
}

export interface ConfirmModalProps {
  title: string
  body: string[]
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  width?: number
}

interface ButtonSpan {
  start: number
  end: number
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  title,
  body,
  confirmLabel = "delete",
  cancelLabel = "cancel",
  onConfirm,
  onCancel,
  width = 64
}) => {
  const { stdin, setRawMode, isRawModeSupported } = useStdin()
  const { stdout } = useStdout()
  const [selectedButton, setSelectedButton] = useState<"confirm" | "cancel">("cancel")
  const confirmSpanRef = useRef<ButtonSpan>({ start: 0, end: 0 })
  const cancelSpanRef = useRef<ButtonSpan>({ start: 0, end: 0 })
  const lastMouseAtRef = useRef(0)
  const leftPadRef = useRef(0)
  const topPadRef = useRef(0)
  const widthRef = useRef(width)

  useInput((input, key) => {
    if (Date.now() - lastMouseAtRef.current < 20) return
    if (key.escape || input.toLowerCase() === "n") { onCancel(); return }
    if (key.leftArrow || key.rightArrow || key.tab) {
      setSelectedButton(b => (b === "confirm" ? "cancel" : "confirm"))
      return
    }
    if (key.return || input === " ") {
      if (selectedButton === "confirm") onConfirm()
      else onCancel()
      return
    }
    if (input.toLowerCase() === "y") { onConfirm(); return }
  })

  useEffect(() => {
    if (!stdin || !stdout || !isRawModeSupported || !setRawMode) return
    setRawMode(true)
    const enable = "\x1b[?1000h\x1b[?1006h"
    const disable = "\x1b[?1006l\x1b[?1000l"
    stdout.write(enable)

    const handler = (data: Buffer): void => {
      const s = data.toString("utf8")
      const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g
      let match: RegExpExecArray | null
      let sawMouse = false
      while ((match = re.exec(s)) !== null) {
        sawMouse = true
        const cb = parseInt(match[1], 10)
        const x = parseInt(match[2], 10)
        const y = parseInt(match[3], 10)
        const press = match[4] === "M"
        if (!press) continue
        if ((cb & 64) !== 0) continue
        if ((cb & 3) !== 0) continue
        const actionY = topPadRef.current + 7
        if (y !== actionY) continue
        const modalX = x - leftPadRef.current
        const confirm = confirmSpanRef.current
        const cancel = cancelSpanRef.current
        if (modalX >= confirm.start && modalX <= confirm.end) {
          setSelectedButton("confirm")
          onConfirm()
          continue
        }
        if (modalX >= cancel.start && modalX <= cancel.end) {
          setSelectedButton("cancel")
          onCancel()
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
  }, [stdin, stdout, setRawMode, isRawModeSupported, onConfirm, onCancel])

  const innerWidth = Math.max(24, width - 4)
  const confirmText = ` Delete `
  const cancelText = ` Cancel `
  const actionRow = 7
  const gutter = 3
  const totalButtons = confirmText.length + gutter + cancelText.length
  const buttonsStart = Math.max(1, Math.floor((innerWidth - totalButtons) / 2) + 1)
  confirmSpanRef.current = { start: buttonsStart + 1, end: buttonsStart + confirmText.length }
  cancelSpanRef.current = {
    start: buttonsStart + confirmText.length + gutter + 1,
    end: buttonsStart + confirmText.length + gutter + cancelText.length
  }
  widthRef.current = width
  if (stdout) {
    leftPadRef.current = Math.max(0, Math.floor((stdout.columns - width) / 2))
    topPadRef.current = Math.max(0, Math.floor((stdout.rows - 10) / 2))
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="red" padding={1} width={width}>
      <Text bold color="red">⚠ {truncEnd(title, innerWidth)}</Text>
      <Text dimColor>This action cannot be undone.</Text>
      <Text> </Text>
      {body.map((line, i) => (
        line === ""
          ? <Text key={i}> </Text>
          : <Text key={i} wrap="truncate-end">{truncEnd(line, innerWidth)}</Text>
      ))}
      <Text> </Text>
      <Box>
        <Text>{" ".repeat(Math.max(0, buttonsStart - 1))}</Text>
        <Text backgroundColor={selectedButton === "confirm" ? "red" : undefined} color={selectedButton === "confirm" ? "white" : "red"} bold>
          {confirmText}
        </Text>
        <Text>{" ".repeat(gutter)}</Text>
        <Text backgroundColor={selectedButton === "cancel" ? "cyan" : undefined} color={selectedButton === "cancel" ? "black" : "cyan"} bold>
          {cancelText}
        </Text>
      </Box>
      <Text dimColor wrap="truncate">← → / tab move · enter choose · y confirm · n / esc cancel</Text>
    </Box>
  )
}
