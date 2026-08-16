import { describe, expect, it } from "vitest"
import {
  getNextStandardCtx,
  getNextSlotSize,
  getNextGpuLayer,
  getNextSpecType,
  getNextRepeatLastN,
  getNextCacheType,
  getNextFlashAttn,
  getNextSpeculativeMode,
  cycleFloat,
  CYCLABLE_KEYS
} from "./PresetEditor.js"

describe("PresetEditor getNextStandardCtx", () => {
  it("cycles to next larger standard value when going right", () => {
    expect(getNextStandardCtx("4096", "right")).toBe(8192)
    expect(getNextStandardCtx("2048", "right")).toBe(4096)
    expect(getNextStandardCtx("32768", "right")).toBe(65536)
    expect(getNextStandardCtx("65536", "right")).toBe(98304) // 96k
    expect(getNextStandardCtx("98304", "right")).toBe(131072) // 128k
    expect(getNextStandardCtx("524288", "right")).toBe(524288) // clamp at maximum 512k
  })

  it("cycles to next smaller standard value when going left", () => {
    expect(getNextStandardCtx("4096", "left")).toBe(2048)
    expect(getNextStandardCtx("8192", "left")).toBe(4096)
    expect(getNextStandardCtx("98304", "left")).toBe(65536) // 96k -> 64k
    expect(getNextStandardCtx("2048", "left")).toBe(2048) // clamp at minimum
  })

  it("moves to closest larger standard value when current is non-standard going right", () => {
    expect(getNextStandardCtx("3000", "right")).toBe(4096)
    expect(getNextStandardCtx("5000", "right")).toBe(8192)
    expect(getNextStandardCtx("150000", "right")).toBe(163840) // 150k -> 160k
    expect(getNextStandardCtx("600000", "right")).toBe(524288) // too large -> 512k
  })

  it("moves to closest smaller standard value when current is non-standard going left", () => {
    expect(getNextStandardCtx("3000", "left")).toBe(2048)
    expect(getNextStandardCtx("5000", "left")).toBe(4096)
    expect(getNextStandardCtx("1000", "left")).toBe(2048)
  })

  it("defaults to 4096 if current value is invalid", () => {
    expect(getNextStandardCtx("", "right")).toBe(4096)
    expect(getNextStandardCtx("foo", "left")).toBe(4096)
  })
})

describe("PresetEditor getNextSlotSize", () => {
  it("cycles slots correctly", () => {
    expect(getNextSlotSize("4", "right")).toBe(8)
    expect(getNextSlotSize("4", "left")).toBe(2)
    expect(getNextSlotSize("64", "right")).toBe(64)
    expect(getNextSlotSize("1", "left")).toBe(1)
    expect(getNextSlotSize("5", "right")).toBe(8)
    expect(getNextSlotSize("invalid", "right")).toBe(1)
  })
})

describe("PresetEditor getNextGpuLayer", () => {
  it("cycles GPU layers correctly", () => {
    expect(getNextGpuLayer("32", "right")).toBe(48)
    expect(getNextGpuLayer("32", "left")).toBe(16)
    expect(getNextGpuLayer("999", "right")).toBe(999)
    expect(getNextGpuLayer("0", "left")).toBe(0)
    expect(getNextGpuLayer("40", "right")).toBe(48)
    expect(getNextGpuLayer("invalid", "right")).toBe(0)
  })
})

describe("PresetEditor getNextSpecType", () => {
  it("cycles speculative decoding types", () => {
    expect(getNextSpecType("none", "right")).toBe("draft")
    expect(getNextSpecType("draft-simple", "left")).toBe("draft")
    expect(getNextSpecType("ngram-simple", "right")).toBe("ngram-simple")
    expect(getNextSpecType("none", "left")).toBe("none")
    expect(getNextSpecType("invalid", "right")).toBe("none")
  })
})

describe("PresetEditor getNextRepeatLastN", () => {
  it("cycles repeat last n values correctly", () => {
    expect(getNextRepeatLastN("64", "right")).toBe(128)
    expect(getNextRepeatLastN("64", "left")).toBe(32)
    expect(getNextRepeatLastN("0", "left")).toBe(-1)
    expect(getNextRepeatLastN("-1", "left")).toBe(-1)
    expect(getNextRepeatLastN("4096", "right")).toBe(4096)
    expect(getNextRepeatLastN("invalid", "right")).toBe(64)
  })
})

describe("PresetEditor cycleFloat", () => {
  it("cycles float values with step and bounds", () => {
    expect(cycleFloat("0.7", "right", 0.1, 0.0, 2.0, 0.0)).toBe(0.8)
    expect(cycleFloat("0.7", "left", 0.1, 0.0, 2.0, 0.0)).toBe(0.6)
    expect(cycleFloat("2.0", "right", 0.1, 0.0, 2.0, 0.0)).toBe(2.0)
    expect(cycleFloat("0.0", "left", 0.1, 0.0, 2.0, 0.0)).toBe(0.0)
    expect(cycleFloat("0.95", "right", 0.05, 0.0, 1.0, 1.0)).toBe(1.0)
    expect(cycleFloat("0.95", "left", 0.05, 0.0, 1.0, 1.0)).toBe(0.9)
    expect(cycleFloat("invalid", "right", 0.1, 0.0, 2.0, 1.0)).toBe(1.0)
  })
})

describe("PresetEditor getNextCacheType", () => {
  it("cycles cache types correctly", () => {
    expect(getNextCacheType("f16", "right")).toBe("q8_0")
    expect(getNextCacheType("q8_0", "right")).toBe("q4_0")
    expect(getNextCacheType("q8_0", "left")).toBe("f16")
    expect(getNextCacheType("f32", "right")).toBe("f32")
    expect(getNextCacheType("f16", "left")).toBe("f16")
    expect(getNextCacheType("invalid", "right")).toBe("f16")
  })
})

describe("PresetEditor getNextFlashAttn", () => {
  it("cycles flash attention modes correctly", () => {
    expect(getNextFlashAttn("auto", "right")).toBe("on")
    expect(getNextFlashAttn("on", "right")).toBe("off")
    expect(getNextFlashAttn("off", "left")).toBe("on")
    expect(getNextFlashAttn("auto", "left")).toBe("auto")
    expect(getNextFlashAttn("invalid", "right")).toBe("auto")
  })
})

describe("PresetEditor getNextSpeculativeMode", () => {
  it("cycles speculative modes correctly", () => {
    expect(getNextSpeculativeMode("auto", "right")).toBe("enabled")
    expect(getNextSpeculativeMode("enabled", "right")).toBe("disabled")
    expect(getNextSpeculativeMode("disabled", "left")).toBe("enabled")
    expect(getNextSpeculativeMode("auto", "left")).toBe("auto")
    expect(getNextSpeculativeMode("invalid", "right")).toBe("auto")
  })
})

describe("CYCLABLE_KEYS", () => {
  it("includes all sampling, penalty, and cache keys", () => {
    expect(CYCLABLE_KEYS).toContain("temp")
    expect(CYCLABLE_KEYS).toContain("topP")
    expect(CYCLABLE_KEYS).toContain("topK")
    expect(CYCLABLE_KEYS).toContain("minP")
    expect(CYCLABLE_KEYS).toContain("repeatPenalty")
    expect(CYCLABLE_KEYS).toContain("presencePenalty")
    expect(CYCLABLE_KEYS).toContain("frequencyPenalty")
    expect(CYCLABLE_KEYS).toContain("repeatLastN")
    expect(CYCLABLE_KEYS).toContain("cacheTypeK")
    expect(CYCLABLE_KEYS).toContain("cacheTypeV")
    expect(CYCLABLE_KEYS).toContain("flashAttn")
    expect(CYCLABLE_KEYS).toContain("specDraftCacheTypeK")
    expect(CYCLABLE_KEYS).toContain("specDraftCacheTypeV")
    expect(CYCLABLE_KEYS).toContain("speculativeMode")
  })
})
