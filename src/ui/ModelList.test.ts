import { describe, expect, it } from "vitest"
import { formatModelSize } from "./ModelList.js"

describe("ModelList formatModelSize", () => {
  it("formats model size in GiB", () => {
    expect(formatModelSize(16 * 1024 * 1024 * 1024)).toBe("16.0G")
  })

  it("returns empty string for missing size", () => {
    expect(formatModelSize(undefined)).toBe("")
    expect(formatModelSize(0)).toBe("")
  })
})
