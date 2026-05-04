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

// macOS reports very little as truly "free" via os.freemem() because
// inactive and speculative pages aren't counted as available — even
// though the kernel reclaims them on demand. That makes `total - free`
// look like "nearly full" when in reality most of that is cache. btop
// and Activity Monitor's "Memory Used" both use the breakdown from
// `vm_stat`: used = (active + wired + compressor) * pagesize; the
// remainder (free + inactive + speculative) is treated as available.
//
// Returns `null` on non-darwin or if parsing fails, in which case the
// caller falls back to os.freemem().
export function parseVmStat(
  stdout: string,
  totalMemBytes: number
): Pick<SysStats, "totalMemBytes" | "usedMemBytes" | "freeMemBytes"> | null {
  const pageMatch = stdout.match(/page size of (\d+) bytes/)
  if (!pageMatch) return null
  const pageSize = Number(pageMatch[1])
  const pages = (label: string): number => {
    const re = new RegExp(`${label}:[ \\t]+(\\d+)\\.`)
    const m = stdout.match(re)
    return m ? Number(m[1]) : 0
  }
  const free        = pages("Pages free")
  const active      = pages("Pages active")
  const inactive    = pages("Pages inactive")
  const wired       = pages("Pages wired down")
  const speculative = pages("Pages speculative")
  const compressor  = pages("Pages occupied by compressor")
  const used = (active + wired + compressor) * pageSize
  const available = (free + inactive + speculative) * pageSize
  return {
    totalMemBytes,
    usedMemBytes: Math.min(totalMemBytes, used),
    freeMemBytes: Math.min(totalMemBytes, available)
  }
}

function sampleDarwinMemory(
  totalMemBytes: number
): Pick<SysStats, "totalMemBytes" | "usedMemBytes" | "freeMemBytes"> | null {
  if (process.platform !== "darwin") return null
  try {
    const stdout = execFileSync("vm_stat", [], { encoding: "utf8", timeout: 1500 })
    return parseVmStat(stdout, totalMemBytes)
  } catch {
    return null
  }
}

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
  const mem = sampleDarwinMemory(total) ?? {
    totalMemBytes: total,
    usedMemBytes: total - os.freemem(),
    freeMemBytes: os.freemem()
  }
  return {
    cpuPct,
    ...mem,
    loadAvg1: os.loadavg()[0],
    cpuCount: os.cpus().length
  }
}

export function _resetMetricsState(): void {
  prevTick = null
}

// llama-server emits a timing block per request. We match only the decode
// phase ("eval time"), not the prefill ("prompt eval time"). The wording
// of the rate field varies by version: "tokens per second", "tok/s", etc.
const RE_LLAMA = /(?:^|\n)[ \t]*eval time[ \t]*=[ \t]*([\d.]+)[ \t]*ms[ \t]*\/[ \t]*(\d+)[ \t]*tokens[^\n]*?([\d.]+)[ \t]*(?:tokens per second|tokens?\/sec|tok\/sec|tok\/s)/gi

// mlx_lm and mlx_vlm print a single-line summary, but the prefix and token
// wording vary by version. Accept the common "Generation:" line as well as
// looser "generated N tokens" variants and multiple rate spellings.
const RE_MLX = /(?:Generation:|generated\s+)(?:[^\n]*?\b)?(\d+)[ \t]*tokens?[^\n]*?([\d.]+)[ \t]*(?:tokens[- _]per[- _]sec(?:ond)?|tokens?\/sec|tok\/sec|tok\/s)/gi

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
