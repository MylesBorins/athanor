import { describe, expect, it } from "vitest"
import { parsePromptCacheBytes } from "./promptCacheBytes.js"

describe("parsePromptCacheBytes", () => {
  it("returns undefined for undefined and null", () => {
    expect(parsePromptCacheBytes(undefined)).toBeUndefined()
    expect(parsePromptCacheBytes(null)).toBeUndefined()
  })

  it("parses valid non-negative numbers", () => {
    expect(parsePromptCacheBytes(0)).toBe(0)
    expect(parsePromptCacheBytes(1048576)).toBe(1048576)
    expect(parsePromptCacheBytes(1024.75)).toBe(1024)
  })

  it("throws for negative numbers and non-finite numbers", () => {
    expect(() => parsePromptCacheBytes(-1)).toThrow("expected promptCacheBytes to be a non-negative number")
    expect(() => parsePromptCacheBytes(Number.NaN)).toThrow("expected promptCacheBytes to be a non-negative number")
    expect(() => parsePromptCacheBytes(Number.POSITIVE_INFINITY)).toThrow("expected promptCacheBytes to be a non-negative number")
  })

  it("throws for non-number, non-string input types", () => {
    expect(() => parsePromptCacheBytes(true)).toThrow("expected promptCacheBytes to be a number or string, got boolean")
    expect(() => parsePromptCacheBytes({})).toThrow("expected promptCacheBytes to be a number or string, got object")
    expect(() => parsePromptCacheBytes([])).toThrow("expected promptCacheBytes to be a number or string, got object")
  })

  it("parses plain numeric strings as byte counts", () => {
    expect(parsePromptCacheBytes("0")).toBe(0)
    expect(parsePromptCacheBytes("1048576")).toBe(1048576)
    expect(parsePromptCacheBytes("  2048  ")).toBe(2048)
  })

  it("parses unit strings for kb, mb, and gb with case-insensitivity and whitespace", () => {
    expect(parsePromptCacheBytes("64kb")).toBe(64 * 1024)
    expect(parsePromptCacheBytes("  512MB  ")).toBe(512 * 1024 * 1024)
    expect(parsePromptCacheBytes("8gb")).toBe(8 * 1024 * 1024 * 1024)
    expect(parsePromptCacheBytes("16GB")).toBe(16 * 1024 * 1024 * 1024)
  })

  it("throws for empty or whitespace-only strings", () => {
    expect(() => parsePromptCacheBytes("")).toThrow("expected promptCacheBytes to be non-empty")
    expect(() => parsePromptCacheBytes("   ")).toThrow("expected promptCacheBytes to be non-empty")
  })

  it("throws for invalid unit strings or malformed input", () => {
    expect(() => parsePromptCacheBytes("10tb")).toThrow('invalid promptCacheBytes "10tb"')
    expect(() => parsePromptCacheBytes("8 gb")).toThrow('invalid promptCacheBytes "8 gb"')
    expect(() => parsePromptCacheBytes("8.5gb")).toThrow('invalid promptCacheBytes "8.5gb"')
    expect(() => parsePromptCacheBytes("invalid")).toThrow('invalid promptCacheBytes "invalid"')
    expect(() => parsePromptCacheBytes("-500mb")).toThrow('invalid promptCacheBytes "-500mb"')
  })
})
