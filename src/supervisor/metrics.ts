import { execFileSync } from "child_process"
import * as os from "os"

export interface ProcStats {
  pid: number
  cpuPct: number
  rssBytes: number
}

export interface SysStats {
  cpuPct: number
  totalMemBytes: number
  usedMemBytes: number
  freeMemBytes: number
  loadAvg1: number
  cpuCount: number
}

export interface CompletionStats {
  tokens: number
  elapsedMs: number
  tokPerSec: number
  at: number
}

export function parseProcStats(stdout: string): Map<number, ProcStats> {
  const out = new Map<number, ProcStats>()
  for (const raw of stdout.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(\d+)[ \t]+([\d.]+)[ \t]+(\d+)/)
    if (!m) continue
    const pid = Number(m[1])
    out.set(pid, {
      pid,
      cpuPct: Number(m[2]),
      rssBytes: Number(m[3]) * 1024
    })
  }
  return out
}

export function sampleProcessStats(pids: number[]): Map<number, ProcStats> {
  if (pids.length === 0) return new Map()
  try {
    const stdout = execFileSync(
      "ps",
      ["-p", pids.join(","), "-o", "pid=,%cpu=,rss="],
      { encoding: "utf8", timeout: 1500 }
    )
    return parseProcStats(stdout)
  } catch {
    return new Map()
  }
}

interface CpuTick { idle: number; total: number }

function readCpuTick(): CpuTick {
  let idle = 0
  let total = 0
  for (const c of os.cpus()) {
    for (const t of Object.values(c.times)) total += t
    idle += c.times.idle
  }
  return { idle, total }
}

let prevTick: CpuTick | null = null

export function sampleSystemStats(): SysStats {
  const tick = readCpuTick()
  let cpuPct = 0
  if (prevTick) {
    const dIdle = tick.idle - prevTick.idle
    const dTotal = tick.total - prevTick.total
    if (dTotal > 0) {
      cpuPct = Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100))
    }
  }
  prevTick = tick
  const total = os.totalmem()
  const free = os.freemem()
  return {
    cpuPct,
    totalMemBytes: total,
    freeMemBytes: free,
    usedMemBytes: total - free,
    loadAvg1: os.loadavg()[0],
    cpuCount: os.cpus().length
  }
}

export function _resetMetricsState(): void {
  prevTick = null
}

// llama-server emits a two-line timing block per request. We match only
// the decode phase ("eval time"), not the prefill ("prompt eval time").
const RE_LLAMA = /(?:^|\n)[ \t]*eval time[ \t]*=[ \t]*([\d.]+)[ \t]*ms[ \t]*\/[ \t]*(\d+)[ \t]*tokens[^\n]*?([\d.]+)[ \t]*tokens per second/g

// mlx_lm and mlx_vlm print a single-line summary. Format varies slightly
// by version: "Generation: N tokens, X tokens-per-sec",
// "Generation: N tokens in Ys (X tokens/sec)", etc.
const RE_MLX = /Generation:[ \t]*(\d+)[ \t]*tokens[^\n]*?([\d.]+)[ \t]*(?:tokens[- _]per[- _]sec(?:ond)?|tokens?\/sec|tok\/sec|tok\/s)/gi

function lastMatch(re: RegExp, chunk: string): RegExpExecArray | null {
  re.lastIndex = 0
  let last: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(chunk))) last = m
  return last
}

export function parseCompletionStats(chunk: string): CompletionStats | null {
  const now = Date.now()
  let pick: { index: number; stats: CompletionStats } | null = null

  const llama = lastMatch(RE_LLAMA, chunk)
  if (llama) {
    const elapsedMs = Number(llama[1])
    const tokens = Number(llama[2])
    const tokPerSec = Number(llama[3])
    if (tokens > 0 && tokPerSec > 0) {
      pick = { index: llama.index, stats: { tokens, elapsedMs, tokPerSec, at: now } }
    }
  }

  const mlx = lastMatch(RE_MLX, chunk)
  if (mlx) {
    const tokens = Number(mlx[1])
    const tokPerSec = Number(mlx[2])
    const elapsedMs = tokPerSec > 0 ? (tokens / tokPerSec) * 1000 : 0
    if (tokens > 0 && tokPerSec > 0) {
      if (!pick || mlx.index > pick.index) {
        pick = { index: mlx.index, stats: { tokens, elapsedMs, tokPerSec, at: now } }
      }
    }
  }

  return pick ? pick.stats : null
}
