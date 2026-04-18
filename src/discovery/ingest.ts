import type { DiscoveredModel, ModelEntry } from "../types/index.js"
import {
  allocatePort,
  loadRegistry,
  saveRegistry,
  slugify,
  snapshot,
  uniqueSlug
} from "../registry/index.js"
import { scanModels } from "./scanner.js"

export interface IngestReport {
  added: ModelEntry[]
  updatedPath: ModelEntry[]
  unchanged: number
}

export function ingestDiscovered(
  discovered: DiscoveredModel[] = scanModels()
): IngestReport {
  const reg = loadRegistry()
  const snap = snapshot(reg)

  const byId = new Map(reg.models.map(m => [m.id, m] as const))

  const added: ModelEntry[] = []
  const updatedPath: ModelEntry[] = []
  let unchanged = 0

  for (const d of discovered) {
    const existing = byId.get(d.id)
    if (existing) {
      let changed = false
      if (existing.path !== d.path) {
        existing.path = d.path
        existing.sizeBytes = d.sizeBytes ?? existing.sizeBytes
        changed = true
      }
      // Flavor can flip if upstream publishes a new config.json revision
      // (unusual but real — e.g. a text-only repo gains a VLM sibling).
      if (d.runtime === "mlx" && d.mlxFlavor && existing.mlxFlavor !== d.mlxFlavor) {
        existing.mlxFlavor = d.mlxFlavor
        changed = true
      }
      if (changed) updatedPath.push(existing)
      else unchanged++
      continue
    }

    const desiredSlug = slugify(d.name)
    const slug = uniqueSlug(desiredSlug, snap.slugs)
    snap.slugs.add(slug)

    const port = allocatePort(snap.ports)
    snap.ports.add(port)

    const entry: ModelEntry = {
      id: d.id,
      slug,
      path: d.path,
      runtime: d.runtime,
      source: d.source,
      port,
      publish: true,
      piAlias: slug,
      sizeBytes: d.sizeBytes,
      addedAt: Date.now(),
      ...(d.runtime === "mlx" && d.mlxFlavor ? { mlxFlavor: d.mlxFlavor } : {})
    }
    reg.models.push(entry)
    byId.set(entry.id, entry)
    snap.ids.add(entry.id)
    snap.paths.add(entry.path)
    added.push(entry)
  }

  saveRegistry(reg)
  return { added, updatedPath, unchanged }
}
