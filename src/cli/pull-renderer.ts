import type { ProgressEvent } from "../pull/download.js"

function humanBytes(n: number): string {
  if (!isFinite(n) || n < 0) return "?"
  const u = ["B", "KB", "MB", "GB", "TB"]
  let v = n; let i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)}${u[i]}`
}

export interface CliPullRenderer {
  onEvent: (e: ProgressEvent) => void
  finish: () => void
}

export function makeCliPullRenderer(): CliPullRenderer {
  const byteFiles = new Map<string, { done: number; total: number | null }>()
  let currentFile = ""
  let rate: number | null = null
  let label = "resolving…"
  let lastLen = 0
  let lastPaint = 0
  const isTty = process.stdout.isTTY === true
  const minPaintMs = 100

  function termWidth(): number {
    return Math.max(20, (process.stdout.columns ?? 80) - 1)
  }

  function renderLine(width: number): string {
    const files = [...byteFiles.values()]
    const totalDone = files.reduce((a, s) => a + s.done, 0)
    const totalSize = files.reduce((a, s) => a + (s.total ?? 0), 0)
    const frac = totalSize > 0 ? totalDone / totalSize : 0
    const pct = totalSize > 0 ? (frac * 100).toFixed(1) + "%" : "…"
    const rateStr = rate && rate > 0 ? `${humanBytes(rate)}/s` : "—"
    const doneN = files.filter(s => s.total !== null && s.done >= s.total).length
    const stats =
      ` ${pct}  ${humanBytes(totalDone)}/${totalSize > 0 ? humanBytes(totalSize) : "?"}` +
      `  ${rateStr}  ${doneN}/${files.length} files`
    const prefix = `  ${label} `
    const remaining = Math.max(8, width - prefix.length - stats.length - 3)
    const barW = Math.max(6, Math.floor(remaining * 0.6))
    const tailW = Math.max(0, remaining - barW - 2)
    const filled = Math.floor(frac * barW)
    const bar = "█".repeat(filled) + "░".repeat(barW - filled)
    const tail = tailW > 0 ? `  ${currentFile.slice(0, tailW)}` : ""
    const out = `${prefix}[${bar}]${stats}${tail}`
    return out.length > width ? out.slice(0, width) : out
  }

  function paint(force: boolean): void {
    const now = Date.now()
    if (!force && now - lastPaint < minPaintMs) return
    lastPaint = now
    if (!isTty) return
    const width = termWidth()
    const line = renderLine(width)
    const pad = " ".repeat(Math.max(0, lastLen - line.length))
    process.stdout.write("\r" + line + pad)
    lastLen = line.length
  }

  function milestone(text: string): void {
    if (isTty) return
    process.stdout.write(text + "\n")
  }

  return {
    onEvent: (ev) => {
      if (ev.type === "resolving") {
        label = "resolving…"
        milestone(`resolving ${ev.repo}${ev.revision ? `@${ev.revision}` : ""}…`)
        paint(true)
        return
      }
      if (ev.type === "done") {
        label = "finalizing…"
        paint(true)
        return
      }
      if (ev.type === "error") return
      if (ev.unit !== "B") return
      label = "downloading"
      currentFile = ev.file
      if (ev.type === "progress") rate = ev.rate
      const existing = byteFiles.get(ev.file) ?? { done: 0, total: null }
      const done = "done" in ev ? ev.done : existing.done
      const total = ev.total ?? existing.total
      byteFiles.set(ev.file, { done, total })
      if (ev.type === "end") {
        milestone(`  ✓ ${ev.file} (${humanBytes(ev.total ?? ev.done)})`)
        paint(true)
      } else {
        paint(false)
      }
    },
    finish: () => {
      if (isTty) {
        paint(true)
        process.stdout.write("\n")
      } else {
        const files = [...byteFiles.values()]
        const total = files.reduce((a, s) => a + (s.total ?? s.done), 0)
        milestone(`done · ${files.length} file${files.length === 1 ? "" : "s"} · ${humanBytes(total)}`)
      }
    }
  }
}
