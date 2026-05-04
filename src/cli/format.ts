import type { ModelEntry, ActiveInstance } from "../types/index.js"
import { padEndVisual, style, statusGlyph, sym } from "./style.js"

function sourceLabel(entry: ModelEntry): string {
  return entry.source.type === "hf"
    ? `hf:${entry.source.repo}`
    : "local"
}

export function formatBytes(bytes?: number): string {
  if (!bytes) return "?"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let u = 0
  let v = bytes
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  return `${v.toFixed(1)} ${units[u]}`
}

export function formatUptime(startedAt: number): string {
  const s = Math.floor((Date.now() - startedAt) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60}m`
}

export function statusBadge(inst: ActiveInstance | undefined): string {
  if (!inst) return "idle"
  return inst.status
}

export function formatEntryLine(entry: ModelEntry, inst?: ActiveInstance): string {
  const marker = inst
    ? `${statusGlyph(inst.status)} ${inst.status}`
    : `${style.gray(sym.idle)} idle`
  const slug = style.bold(entry.slug)
  const runtimeLabel = entry.runtime === "mlx" && entry.mlxFlavor === "vlm"
    ? "mlx-vlm"
    : entry.runtime
  const runtime = style.cyan(runtimeLabel)
  const port = style.gray(`:${entry.port}`)
  const pub = entry.publish ? style.magenta("[pi]") : style.gray("    ")
  const tuned = entry.preset ? style.yellow("[tuned]") : style.gray("       ")
  const size = entry.sizeBytes ? style.gray(formatBytes(entry.sizeBytes)) : ""
  const source = style.gray(sourceLabel(entry))
  return [
    padEndVisual(marker, 11),
    padEndVisual(slug, 32),
    padEndVisual(runtime, 10),
    padEndVisual(port, 7),
    padEndVisual(pub, 5),
    padEndVisual(tuned, 8),
    padEndVisual(size, 10),
    source
  ].join("  ")
}
