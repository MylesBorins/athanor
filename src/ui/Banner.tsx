import React from "react"
import { Box, Text } from "ink"
import type { SysStats } from "../supervisor/metrics.js"

// An athanor is an alchemical furnace — a slow, continuous fire used
// to transmute matter over long durations. Rendered here as a two-
// chamber furnace: the philosopher's egg sits in the upper chamber,
// a bed of coals glows through the grate below, and flames rise from
// the chimney mouth. Layout is exactly 7 rows to match bannerRows in
// App.tsx; changing the height requires updating both callers.
type Seg = { text: string; color?: string; bold?: boolean; dim?: boolean }

const FURNACE: Seg[][] = [
  [{ text: "     ) ( )    ", color: "#ffc766" }],
  [{ text: "    )( ) )( ) ", color: "#ff6b1a" }],
  [{ text: "   ┏━━━━━━━━━┓", dim: true }],
  [
    { text: "   ┃    ", dim: true },
    { text: "◯", color: "#ffd27a", bold: true },
    { text: "    ┃", dim: true }
  ],
  [{ text: "   ┣━━━━━━━━━┫", dim: true }],
  [
    { text: "   ┃ ", dim: true },
    { text: "░", color: "#7a1a0a" },
    { text: "▒", color: "#c73a1a" },
    { text: "▓", color: "#ff7a2a" },
    { text: "█", color: "#ffb347", bold: true },
    { text: "▓", color: "#ff7a2a" },
    { text: "▒", color: "#c73a1a" },
    { text: "░", color: "#7a1a0a" },
    { text: " ┃", dim: true }
  ],
  [{ text: "   ┗━━━━┻━━━━┛", dim: true }]
]

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
        {FURNACE.map((segs, i) => (
          <Text key={i}>
            {segs.map((s, j) => (
              <Text key={j} color={s.color} bold={s.bold} dimColor={s.dim}>{s.text}</Text>
            ))}
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
