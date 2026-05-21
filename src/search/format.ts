import { style, padEndVisual } from "../cli/style.js"
import type { SearchResult } from "./hf.js"
import type { SearchRecommendation } from "./recommend.js"

export function formatCount(n: number | undefined): string {
  if (n === undefined) return "?"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n < 0) return "?"
  const u = ["B", "KB", "MB", "GB", "TB"]
  let v = n; let i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`
}

export function formatRelTime(iso: string | undefined): string {
  if (!iso) return ""
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ""
  const s = Math.floor(ms / 1000)
  if (s < 60)        return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)        return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)        return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30)        return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12)       return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

function fitLabel(rec?: SearchRecommendation | null): string {
  if (!rec) return style.dim("?")
  if (rec.fitBand === "comfortable") return style.green("fit:comfortable")
  if (rec.fitBand === "tight") return style.yellow("fit:tight")
  return style.red("fit:risky")
}

export function formatResultRow(r: SearchResult, rec?: SearchRecommendation | null): string {
  const id        = style.bold(r.id)
  const size      = r.sizeBytes !== undefined ? style.gray(formatBytes(r.sizeBytes)) : style.dim("—")
  const downloads = style.gray(`${formatCount(r.downloads)} ${style.dim("↓")}`)
  const likes     = style.gray(`${formatCount(r.likes)} ${style.dim("♥")}`)
  const license   = r.license ? style.cyan(r.license) : ""
  const ago       = style.gray(formatRelTime(r.lastModified))
  const fit       = fitLabel(rec)
  return [
    padEndVisual(id, 48),
    padEndVisual(size, 9),
    padEndVisual(fit, 18),
    padEndVisual(downloads, 14),
    padEndVisual(likes, 12),
    padEndVisual(license, 18),
    ago
  ].join("  ")
}
