import React, { useEffect, useState } from "react"
import { Box, Text } from "ink"
import { tailLog } from "../supervisor/logs.js"

export interface LogTailProps {
  logFile?: string
  lines?: number
  compact?: boolean
}

export const LogTail: React.FC<LogTailProps> = ({ logFile, lines = 8, compact = false }) => {
  const [content, setContent] = useState("")

  useEffect(() => {
    if (!logFile) { setContent(""); return }
    const update = () => setContent(tailLog(logFile, 16384))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [logFile])

  if (!logFile) return <Text dimColor>(no log — not running)</Text>

  const tail = content.split("\n").slice(-lines).join("\n")
  return (
    <Box flexDirection="column">
      <Text dimColor>{compact ? "log:" : `logs (${logFile}):`}</Text>
      <Text>{tail || "(waiting for output…)"}</Text>
    </Box>
  )
}
