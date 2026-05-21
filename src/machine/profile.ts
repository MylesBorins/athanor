/**
 * Memory bandwidth constants and hardware heuristics are adapted from whichllm
 * under the MIT License:
 * Copyright (c) 2026 Andyyyy64
 * https://github.com/Andyyyy64/whichllm
 */

import { execFileSync } from "child_process"
import * as os from "os"

export interface MachineProfile {
  totalMemoryBytes: number
  totalMemoryGiB: number
  chip: string | null
  memoryBandwidthGBs?: number
}

function estimateMemoryBandwidth(chip: string | null): number | undefined {
  if (!chip) return undefined
  const c = chip.toUpperCase()
  if (c.includes("M4 ULTRA")) return 819.2
  if (c.includes("M4 MAX")) return 546.0
  if (c.includes("M4 PRO")) return 273.0
  if (c.includes("M4")) return 120.0
  if (c.includes("M3 ULTRA")) return 800.0
  if (c.includes("M3 MAX")) return 400.0
  if (c.includes("M3 PRO")) return 150.0
  if (c.includes("M3")) return 100.0
  if (c.includes("M2 ULTRA")) return 800.0
  if (c.includes("M2 MAX")) return 400.0
  if (c.includes("M2 PRO")) return 200.0
  if (c.includes("M2")) return 100.0
  if (c.includes("M1 ULTRA")) return 800.0
  if (c.includes("M1 MAX")) return 400.0
  if (c.includes("M1 PRO")) return 200.0
  if (c.includes("M1")) return 68.25
  return undefined
}

function readChipString(): string | null {
  if (process.platform !== "darwin") return null
  try {
    const out = execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], {
      encoding: "utf8",
      timeout: 1500
    }).trim()
    return out || null
  } catch {
    return null
  }
}

export function detectMachineProfile(): MachineProfile {
  const totalMemoryBytes = os.totalmem()
  const chip = readChipString()
  return {
    totalMemoryBytes,
    totalMemoryGiB: totalMemoryBytes / (1024 ** 3),
    chip,
    memoryBandwidthGBs: estimateMemoryBandwidth(chip)
  }
}

