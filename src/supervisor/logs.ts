import * as fs from "fs"
import * as path from "path"
import { PATHS, ensureBaseDirs } from "../config/index.js"

export function logFilePath(slug: string, pid: number): string {
  ensureBaseDirs()
  return path.join(PATHS.logsDir, `${slug}-${pid}.log`)
}

export function openLogFile(slug: string, pid: number): { path: string; fd: number } {
  const p = logFilePath(slug, pid)
  const fd = fs.openSync(p, "a")
  return { path: p, fd }
}

export function tailLog(filepath: string, maxBytes = 8192): string {
  try {
    const st = fs.statSync(filepath)
    const start = Math.max(0, st.size - maxBytes)
    const buf = Buffer.alloc(st.size - start)
    const fd = fs.openSync(filepath, "r")
    try {
      fs.readSync(fd, buf, 0, buf.length, start)
    } finally {
      fs.closeSync(fd)
    }
    return buf.toString("utf8")
  } catch {
    return ""
  }
}
