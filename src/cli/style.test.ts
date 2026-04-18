import { describe, it, expect } from "vitest"
import { padEndVisual, stripAnsi, statusGlyph, sym } from "./style.js"

describe("stripAnsi", () => {
  it("removes SGR escape sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[39m")).toBe("red")
    expect(stripAnsi("\x1b[1m\x1b[32mok\x1b[39m\x1b[22m")).toBe("ok")
  })
  it("leaves plain text untouched", () => {
    expect(stripAnsi("plain")).toBe("plain")
  })
})

describe("padEndVisual", () => {
  it("pads by visible width, ignoring ANSI codes", () => {
    const colored = "\x1b[31mab\x1b[39m"
    const out = padEndVisual(colored, 5)
    expect(stripAnsi(out)).toBe("ab   ")
    expect(out.endsWith("   ")).toBe(true)
  })
  it("returns the input unchanged when already wide enough", () => {
    expect(padEndVisual("abcdef", 4)).toBe("abcdef")
  })
})

describe("statusGlyph", () => {
  it("produces a non-empty glyph for every known status", () => {
    for (const s of ["running", "starting", "error", "exited", "other"]) {
      const g = stripAnsi(statusGlyph(s))
      expect(g.length).toBeGreaterThan(0)
    }
  })
  it("uses the running symbol for running instances", () => {
    expect(stripAnsi(statusGlyph("running"))).toBe(sym.running)
  })
})
