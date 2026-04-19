import React from "react"
import { Box, Text } from "ink"
import type { SysStats } from "../supervisor/metrics.js"

// An athanor is an alchemical furnace — a slow, continuous fire kept
// for long durations to transmute matter. The silhouette below is a
// classical tower athanor: heat shimmer rising from the chimney, an
// upper chamber housing the philosopher's egg, a grate between the
// chambers, a bed of coals glowing in the fire chamber, and a vented
// base. Layout is exactly 12 rows tall; bannerRows in App.tsx must
// match this value.
type Seg = { text: string; color?: string; bold?: boolean; dim?: boolean }

// Warm stone/brick tone for the furnace body. BRICK is the base color
// for every structural line (chimney, walls, grate, base) so the
// furnace reads as masonry rather than UI chrome.
const BRICK = "#a08a66"
const SHIMMER = "#d4a56a"
const EGG = "#ffd27a"

const FURNACE: Seg[][] = [
  [{ text: "         ~ ~      ", color: SHIMMER, dim: true }],
  [{ text: "          ~       ", color: SHIMMER, dim: true }],
  [{ text: "        ╔═══╗     ", color: BRICK }],
  [{ text: "        ║   ║     ", color: BRICK }],
  [{ text: "   ╔════╩═══╩════╗", color: BRICK }],
  [{ text: "   ║             ║", color: BRICK }],
  [
    { text: "   ║      ", color: BRICK },
    { text: "◯", color: EGG, bold: true },
    { text: "      ║", color: BRICK }
  ],
  [{ text: "   ║             ║", color: BRICK }],
  [{ text: "   ╠═════════════╣", color: BRICK }],
  [
    { text: "   ║   ", color: BRICK },
    { text: "░", color: "#7a1a0a" },
    { text: "▒", color: "#c73a1a" },
    { text: "▓", color: "#ff7a2a" },
    { text: "█", color: "#ffcc66", bold: true },
    { text: "▓", color: "#ff7a2a" },
    { text: "▒", color: "#c73a1a" },
    { text: "░", color: "#7a1a0a" },
    { text: "   ║", color: BRICK }
  ],
  [{ text: "   ╚══════╦══════╝", color: BRICK }],
  [{ text: "          ╨       ", color: BRICK }]
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
