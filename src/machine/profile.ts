import { execFileSync } from "child_process"
import * as os from "os"

export interface MachineProfile {
  totalMemoryBytes: number
  totalMemoryGiB: number
  chip: string | null
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
  return {
    totalMemoryBytes,
    totalMemoryGiB: totalMemoryBytes / (1024 ** 3),
    chip: readChipString()
  }
}
