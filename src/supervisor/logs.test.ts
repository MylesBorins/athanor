import * as fs from "fs"
import { describe, it, expect, beforeEach } from "vitest"
import { PATHS } from "../config/index.js"
import { logFilePath, openLogFile, tailLog } from "./logs.js"

function clearLogsDir(): void {
  try { fs.rmSync(PATHS.logsDir, { recursive: true, force: true }) } catch { /* absent */ }
}

describe("logFilePath", () => {
  beforeEach(clearLogsDir)

  it("composes <logsDir>/<slug>-<pid>.log and creates the logs dir", () => {
    const p = logFilePath("qwen3-4b", 12345)
    expect(p.endsWith("/logs/qwen3-4b-12345.log")).toBe(true)
    expect(fs.existsSync(PATHS.logsDir)).toBe(true)
  })
})

describe("openLogFile", () => {
  beforeEach(clearLogsDir)

  it("opens the log file for append and reports its path", () => {
    const { path: p, fd } = openLogFile("my-model", 42)
    try {
      fs.writeSync(fd, "hello\n")
    } finally {
      fs.closeSync(fd)
    }
    expect(fs.readFileSync(p, "utf8")).toBe("hello\n")
  })

  it("appends across successive opens rather than truncating", () => {
    const first  = openLogFile("slug", 1)
    fs.writeSync(first.fd, "a\n"); fs.closeSync(first.fd)
    const second = openLogFile("slug", 1)
    fs.writeSync(second.fd, "b\n"); fs.closeSync(second.fd)
    expect(fs.readFileSync(first.path, "utf8")).toBe("a\nb\n")
  })
})

describe("tailLog", () => {
  beforeEach(clearLogsDir)

  it("returns an empty string when the file is missing", () => {
    expect(tailLog("/tmp/nope-does-not-exist.log")).toBe("")
  })

  it("returns the entire contents when the file is shorter than maxBytes", () => {
    const { path: p, fd } = openLogFile("tail", 1)
    fs.writeSync(fd, "short content"); fs.closeSync(fd)
    expect(tailLog(p)).toBe("short content")
  })

  it("returns the trailing maxBytes bytes when the file is larger", () => {
    const { path: p, fd } = openLogFile("tail", 2)
    // HEAD + 20000 filler + TAIL  = 20008 bytes. Default maxBytes
    // is 8192 so only a suffix survives.
    fs.writeSync(fd, "HEAD" + "x".repeat(20000) + "TAIL")
    fs.closeSync(fd)
    const t = tailLog(p)
    expect(t.length).toBe(8192)
    // HEAD is past the retention window; TAIL always survives as the
    // final four bytes.
    expect(t.includes("HEAD")).toBe(false)
    expect(t.endsWith("TAIL")).toBe(true)
  })

  it("honors a caller-supplied maxBytes", () => {
    const { path: p, fd } = openLogFile("tail", 3)
    fs.writeSync(fd, "0123456789abcdef"); fs.closeSync(fd)
    expect(tailLog(p, 4)).toBe("cdef")
  })
})
