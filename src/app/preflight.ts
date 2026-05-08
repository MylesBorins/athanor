import type { ModelEntry } from "../types/index.js"
import { sampleSystemStats } from "../supervisor/metrics.js"
import type { MachineProfile } from "../machine/profile.js"
import { buildRecommendation } from "../registry/recommend.js"

export interface StartPreflight {
  currentUsedGiB: number
  projectedUsedGiB: number
  machineTotalGiB: number
  estimatedFootprintGiB: number
  shouldWarn: boolean
  shouldStrongWarn: boolean
}

export function buildStartPreflight(entry: ModelEntry, machine: MachineProfile): StartPreflight {
  const sys = sampleSystemStats()
  const rec = buildRecommendation(entry, machine)
  const currentUsedGiB = sys.usedMemBytes / (1024 ** 3)
  const projectedUsedGiB = currentUsedGiB + rec.estimatedFootprintGiB
  const machineTotalGiB = machine.totalMemoryGiB

  return {
    currentUsedGiB,
    projectedUsedGiB,
    machineTotalGiB,
    estimatedFootprintGiB: rec.estimatedFootprintGiB,
    shouldWarn: projectedUsedGiB > machineTotalGiB * 0.75,
    shouldStrongWarn: projectedUsedGiB > machineTotalGiB * 0.85
  }
}
