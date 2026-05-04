import type { DiscoveredModel, ModelEntry } from "../types/index.js"
import { scanModels } from "./scanner.js"
import {
  discoveredToMaterializeInput,
  materializeRegistryEntry
} from "../registry/materialize.js"

export interface IngestReport {
  added: ModelEntry[]
  updatedPath: ModelEntry[]
  unchanged: number
}

export function ingestDiscovered(
  discovered: DiscoveredModel[] = scanModels()
): IngestReport {
  const added: ModelEntry[] = []
  const updatedPath: ModelEntry[] = []
  let unchanged = 0

  for (const d of discovered) {
    const result = materializeRegistryEntry(discoveredToMaterializeInput(d))
    if (result.created) added.push(result.entry)
    else if (result.changed) updatedPath.push(result.entry)
    else unchanged++
  }

  return { added, updatedPath, unchanged }
}
