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
      // Refresh detected capabilities — this is a fact about the model,
      // not user intent. Safe to overwrite on re-scan (e.g. if our
      // detection heuristics improve). `mlxFlavor` (the routing choice)
      // is never touched here; the override path is
      // `athanor flavor <slug> lm|vlm`.
      if (d.runtime === "mlx") {
        const nextCaps = d.mlxCapabilities ?? []
        const prevCaps = existing.mlxCapabilities ?? []
        if (!capsEqual(prevCaps, nextCaps)) {
          if (nextCaps.length > 0) existing.mlxCapabilities = nextCaps
          else delete existing.mlxCapabilities
          changed = true
        }
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
      ...(d.runtime === "mlx" && d.mlxCapabilities && d.mlxCapabilities.length > 0
          ? { mlxCapabilities: d.mlxCapabilities }
          : {})
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

function capsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((v, i) => v === sb[i])
}
