import { describe, it, expect } from "vitest"
import {
  allocatePort,
  defaultPiAlias,
  makeId,
  slugify,
  uniqueSlug
} from "./index.js"

describe("registry helpers", () => {
  describe("slugify", () => {
    it("lowercases and strips file extensions", () => {
      expect(slugify("Qwen2.5-32B.safetensors")).toBe("qwen2-5-32b")
      expect(slugify("LLaMA-8b.gguf")).toBe("llama-8b")
    })
    it("takes the last path segment", () => {
      expect(slugify("mlx-community/Qwen-4bit")).toBe("qwen-4bit")
    })
    it("falls back when empty", () => {
      expect(slugify("!!!")).toBe("model")
    })
  })

  describe("uniqueSlug", () => {
    it("returns the desired slug when free", () => {
      expect(uniqueSlug("foo", new Set())).toBe("foo")
    })
    it("appends an incrementing suffix on collision", () => {
      expect(uniqueSlug("foo", new Set(["foo"]))).toBe("foo-2")
      expect(uniqueSlug("foo", new Set(["foo", "foo-2"]))).toBe("foo-3")
    })
  })

  describe("allocatePort", () => {
    it("returns the first free port in range", () => {
      expect(allocatePort(new Set(), { min: 8081, max: 8083 })).toBe(8081)
      expect(allocatePort(new Set([8081]), { min: 8081, max: 8083 })).toBe(8082)
    })
    it("throws when the range is exhausted", () => {
      expect(() =>
        allocatePort(new Set([8081, 8082]), { min: 8081, max: 8082 })
      ).toThrow(/No free port/)
    })
  })

  describe("makeId", () => {
    it("uses repo[@rev][:file] for HF sources", () => {
      expect(makeId("llama.cpp", { type: "hf", repo: "x/y", file: "q4.gguf" }, "/p"))
        .toBe("x/y:q4.gguf")
      expect(makeId("mlx", { type: "hf", repo: "x/y", revision: "abc" }, "/p"))
        .toBe("x/y@abc")
    })
    it("uses local:<runtime>:<path> for local sources", () => {
      expect(makeId("llama.cpp", { type: "local" }, "/m/x.gguf"))
        .toBe("local:llama.cpp:/m/x.gguf")
    })
  })

  describe("defaultPiAlias", () => {
    it("returns the slug unchanged", () => {
      expect(defaultPiAlias("qwen-32b")).toBe("qwen-32b")
    })
  })
})
