import { describe, expect, it } from "vitest"
import { formatModelSize } from "./ModelList.js"

describe("ModelList formatModelSize", () => {
  it("formats model size in GiB", () => {
    expect(formatModelSize(10 * 1024 * 1024 * 1024)).toBe("10.0G")
    expect(formatModelSize(1536 * 1024 * 1024)).toBe("1.5G")
  })

  it("returns empty string when size is missing", () => {
    expect(formatModelSize(undefined)).toBe("")
    expect(formatModelSize(0)).toBe("")
  })
})
