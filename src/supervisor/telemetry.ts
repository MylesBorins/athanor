import * as fs from "fs"
import * as path from "path"
import { PATHS, ensureBaseDirs } from "../config/index.js"
import type { TelemetryRecord, RuntimeType } from "../types/index.js"

export interface TelemetryFile {
  version: number
  history: TelemetryRecord[]
}

const MAX_HISTORY_ITEMS = 1000

function atomicWrite(filepath: string, data: string): void {
  const tmp = filepath + ".tmp"
  fs.writeFileSync(tmp, data, "utf8")
  fs.renameSync(tmp, filepath)
}

export function loadTelemetryHistory(): TelemetryRecord[] {
  if (!fs.existsSync(PATHS.telemetry)) {
    return []
  }
  try {
    const raw = JSON.parse(fs.readFileSync(PATHS.telemetry, "utf8"))
    if (raw && typeof raw === "object" && Array.isArray(raw.history)) {
      return raw.history as TelemetryRecord[]
    }
  } catch {
    // If corruption occurs, default to empty
  }
  return []
}

export function saveTelemetryRecord(record: TelemetryRecord): void {
  ensureBaseDirs()
  const history = loadTelemetryHistory()
  history.unshift(record) // Add to beginning (most recent first)
  if (history.length > MAX_HISTORY_ITEMS) {
    history.length = MAX_HISTORY_ITEMS
  }
  const fileContent: TelemetryFile = { version: 1, history }
  atomicWrite(PATHS.telemetry, JSON.stringify(fileContent, null, 2))
}

export function clearTelemetryHistory(): void {
  if (fs.existsSync(PATHS.telemetry)) {
    try {
      fs.unlinkSync(PATHS.telemetry)
    } catch {
      // ignore
    }
  }
}

// Timing log regex definitions

const RE_LLAMA_PROMPT = /prompt eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens.*?([\d.]+)\s*(?:tokens per second|tokens?\/sec|tok\/sec|tok\/s)/i
const RE_LLAMA_PROMPT_NEW = /prompt processing,\s*n_tokens\s*=\s*(\d+),\s*progress\s*=\s*[\d.]+, t\s*=\s*([\d.]+)\s*s\s*\/\s*([\d.]+)\s*(?:tokens per second|tok\/s|t\/s|tokens?\/sec|tok\/sec)/i

const RE_LLAMA_GEN = /eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens.*?([\d.]+)\s*(?:tokens per second|tokens?\/sec|tok\/sec|tok\/s)/i
const RE_LLAMA_GEN_NEW = /n_decoded\s*=\s*(\d+),\s*tg\s*=\s*([\d.]+)\s*(?:t\/s|tok\/s|tokens?\/sec|tok\/sec)/i

const RE_LLAMA_SPEC = /(?:spec acceptance|draft accept|speculative acceptance|accept rate)\s*(?:=|:)\s*([\d.]+)%/i
const RE_LLAMA_SPEC_BRANCH = /speculative branch:\s*drafted\s*=\s*(\d+)\s*tokens,\s*accepted\s*=\s*(\d+)\s*tokens\s*\(\s*([\d.]+)%\s*\)/i
const RE_LLAMA_MEAN_DRAFT = /(?:mean draft length|average draft length|draft length|mean draft)\s*(?:=|:)?\s*([\d.]+)/i

const RE_MLX_GEN = /(?:Generation:|generated\s+)(?:[^\n]*?\b)?(\d+)[ \t]*tokens?[^\n]*?([\d.]+)[ \t]*(?:tokens[- _]per[- _]sec(?:ond)?|tokens?\/sec|tok\/sec|tok\/s)/i
const RE_MLX_COMPILE = /(?:compile|compilation|compiler compile) time\s*(?:=|:)?\s*([\d.]+)\s*ms/i

interface ParsedLogStats {
  promptTokens?: number
  generatedTokens?: number
  promptThroughput?: number
  generationThroughput?: number
  speculativeAcceptanceRate?: number
  meanDraftLength?: number
  compilationTimeMs?: number
}

function lastMatch(re: RegExp, content: string): RegExpExecArray | null {
  re.lastIndex = 0
  let last: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  const flags = re.flags
  const globalRe = flags.includes("g") ? re : new RegExp(re.source, flags + "g")
  while ((m = globalRe.exec(content))) {
    last = m
  }
  return last
}

export function parseLogTelemetry(logContent: string): ParsedLogStats {
  const stats: ParsedLogStats = {}

  // Llama.cpp prompt processing timings
  const promptMatch = lastMatch(RE_LLAMA_PROMPT, logContent)
  if (promptMatch) {
    stats.promptTokens = Number(promptMatch[2])
    stats.promptThroughput = Number(promptMatch[3])
  } else {
    const promptMatchNew = lastMatch(RE_LLAMA_PROMPT_NEW, logContent)
    if (promptMatchNew) {
      stats.promptTokens = Number(promptMatchNew[1])
      stats.promptThroughput = Number(promptMatchNew[3])
    }
  }

  // Llama.cpp token generation timings
  const llamaGenMatch = lastMatch(RE_LLAMA_GEN, logContent)
  if (llamaGenMatch) {
    stats.generatedTokens = Number(llamaGenMatch[2])
    stats.generationThroughput = Number(llamaGenMatch[3])
  } else {
    const llamaGenMatchNew = lastMatch(RE_LLAMA_GEN_NEW, logContent)
    if (llamaGenMatchNew) {
      stats.generatedTokens = Number(llamaGenMatchNew[1])
      stats.generationThroughput = Number(llamaGenMatchNew[2])
    }
  }

  // Llama.cpp speculative decoding acceptance
  const llamaSpecMatch = lastMatch(RE_LLAMA_SPEC, logContent)
  if (llamaSpecMatch) {
    stats.speculativeAcceptanceRate = Number(llamaSpecMatch[1])
  } else {
    const specBranchMatch = lastMatch(RE_LLAMA_SPEC_BRANCH, logContent)
    if (specBranchMatch) {
      stats.speculativeAcceptanceRate = Number(specBranchMatch[3])
    }
  }

  const meanDraftMatch = lastMatch(RE_LLAMA_MEAN_DRAFT, logContent)
  if (meanDraftMatch) {
    stats.meanDraftLength = Number(meanDraftMatch[1])
  }

  // MLX token generation timings
  const mlxGenMatch = lastMatch(RE_MLX_GEN, logContent)
  if (mlxGenMatch) {
    stats.generatedTokens = Number(mlxGenMatch[1])
    stats.generationThroughput = Number(mlxGenMatch[2])
  }

  // MLX compilation statistics
  const mlxCompileMatch = lastMatch(RE_MLX_COMPILE, logContent)
  if (mlxCompileMatch) {
    stats.compilationTimeMs = Number(mlxCompileMatch[1])
  }

  return stats
}
