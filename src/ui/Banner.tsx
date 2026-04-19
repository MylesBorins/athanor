import React from "react"
import { Box, Text } from "ink"
import type { SysStats } from "../supervisor/metrics.js"

// An athanor is an alchemical furnace — a slow, continuous fire used to
// transmute matter over long periods. The glyph below is a stylized
// furnace with rising flames.
const FURNACE = [
  "    )   )  (  ",
  "   (   ) ) ) )",
  "    ) (((  ( (",
  "   ┏━━━━━━━━━┓",
  "   ┃ ░▒▓█▓▒░ ┃",
  "   ┗━━━━┳━━━━┛",
  "        ┻       "
]

const FLAME_COLORS = ["#ff6b1a", "#ff8c2a", "#ffb347"]

function flameColorFor(line: string, idx: number): string | undefined {
  // the first three lines are flames; color them by row for a gradient
  if (idx < 3) return FLAME_COLORS[idx] ?? "#ff6b1a"
  return undefined
}

export function bar(pct: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, pct))
  const filled = Math.round((clamped / 100) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

function formatGB(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1)
}

export interface BannerProps {
  status?: string
  sys?: SysStats
}

export const Banner: React.FC<BannerProps> = ({ status, sys }) => {
  const cpuPct = sys ? sys.cpuPct : 0
  const memPct = sys ? (sys.usedMemBytes / sys.totalMemBytes) * 100 : 0
  return (
    <Box flexDirection="row">
      <Box flexDirection="column" marginRight={2}>
        {FURNACE.map((line, i) => (
          <Text key={i} color={flameColorFor(line, i)} dimColor={i >= 3}>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" justifyContent="center">
        <Text bold color="#ffb347">
          A T H A N O R
        </Text>
        <Text dimColor>slow fire for local models</Text>
        <Text> </Text>
        <Text dimColor>{status ?? ""}</Text>
        {sys ? (
          <Text dimColor>
            CPU <Text color="cyan">{bar(cpuPct)}</Text> {cpuPct.toFixed(0).padStart(2)}%
            {"  "}
            RAM <Text color="magenta">{bar(memPct)}</Text> {formatGB(sys.usedMemBytes)}/{formatGB(sys.totalMemBytes)} GB
            {"  "}
            load {sys.loadAvg1.toFixed(2)}
          </Text>
        ) : null}
      </Box>
    </Box>
  )
}
