import * as fs from "fs"
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import {
  cmdFormulaApply,
  cmdFormulaClear,
  cmdFormulaSave,
  cmdFormulaSet,
  cmdFormulaShow,
  cmdFormulaUnset,
  cmdFormulas,
  cmdFormulasDelete
} from "./preset-commands.js"
import { upsertModel, getModel } from "../registry/index.js"
import { PATHS } from "../config/index.js"
import type { ModelEntry } from "../types/index.js"

function makeMlxModel(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "test/mlx-model",
    slug: "mlx-test",
    path: "/models/mlx",
    runtime: "mlx",
    source: { type: "hf", repo: "test/mlx-model" },
    port: 8081,
    publish: true,
    addedAt: 1,
    ...overrides
  }
}

describe("preset-commands", () => {
  beforeEach(() => {
    try { fs.unlinkSync(PATHS.registry) } catch { /* ignore */ }
    try { fs.unlinkSync(PATHS.formulas) } catch { /* ignore */ }
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("cmdFormulaShow", () => {
    it("prints (none) when model has no formula or preset", () => {
      upsertModel(makeMlxModel())
      cmdFormulaShow("mlx-test")
      const output = vi.mocked(console.log).mock.calls.map(c => c[0]).join("\n")
      expect(output).toContain("(none)")
    })

    it("prints active formula JSON when formula is configured", () => {
      upsertModel(makeMlxModel({
        formula: {
          runtime: "mlx",
          mlx: { maxTokens: 4096 }
        }
      }))
      cmdFormulaShow("mlx-test")
      const output = vi.mocked(console.log).mock.calls.map(c => c[0]).join("\n")
      expect(output).toContain('"maxTokens": 4096')
    })

    it("throws for unknown model", () => {
      expect(() => cmdFormulaShow("unknown")).toThrow("unknown model: unknown")
    })
  })

  describe("cmdFormulaSet", () => {
    it("throws when tokens array is empty", () => {
      upsertModel(makeMlxModel())
      expect(() => cmdFormulaSet("mlx-test", [])).toThrow("expected one or more key=value pairs")
    })

    it("throws when model is unknown", () => {
      expect(() => cmdFormulaSet("unknown", ["max-tokens=1024"])).toThrow("unknown model: unknown")
    })

    it("updates formula fields on model", () => {
      upsertModel(makeMlxModel())
      cmdFormulaSet("mlx-test", ["max-tokens=2048", "temp=0.7"])
      const updated = getModel("mlx-test")
      expect(updated?.formula?.runtime).toBe("mlx")
      const mlxConfig = updated?.formula?.runtime === "mlx" ? updated.formula.mlx : undefined
      expect(mlxConfig?.maxTokens).toBe(2048)
      expect(mlxConfig?.temp).toBe(0.7)
    })
  })

  describe("cmdFormulaUnset", () => {
    it("throws when keys array is empty", () => {
      upsertModel(makeMlxModel())
      expect(() => cmdFormulaUnset("mlx-test", [])).toThrow("expected one or more keys")
    })

    it("throws when model is unknown", () => {
      expect(() => cmdFormulaUnset("unknown", ["temp"])).toThrow("unknown model: unknown")
    })

    it("unsets specified keys from model formula", () => {
      upsertModel(makeMlxModel({
        formula: {
          runtime: "mlx",
          mlx: { maxTokens: 2048, temp: 0.7 }
        }
      }))
      cmdFormulaUnset("mlx-test", ["temp"])
      const updated = getModel("mlx-test")
      expect(updated?.formula?.runtime).toBe("mlx")
      const mlxConfig = updated?.formula?.runtime === "mlx" ? updated.formula.mlx : undefined
      expect(mlxConfig?.maxTokens).toBe(2048)
      expect(mlxConfig?.temp).toBeUndefined()
    })
  })

  describe("cmdFormulaClear", () => {
    it("clears formula from model", () => {
      upsertModel(makeMlxModel({
        formula: {
          runtime: "mlx",
          mlx: { maxTokens: 2048 }
        }
      }))
      cmdFormulaClear("mlx-test")
      const updated = getModel("mlx-test")
      expect(updated?.formula).toBeUndefined()
    })

    it("throws when model is unknown", () => {
      expect(() => cmdFormulaClear("unknown")).toThrow("unknown model: unknown")
    })
  })

  describe("cmdFormulaApply", () => {
    it("applies a built-in formula to model", () => {
      upsertModel(makeMlxModel())
      cmdFormulaApply("mlx-test", "fast")
      const updated = getModel("mlx-test")
      expect(updated?.formula?.runtime).toBe("mlx")
    })

    it("throws when formula name is unknown", () => {
      upsertModel(makeMlxModel())
      expect(() => cmdFormulaApply("mlx-test", "nonexistent-formula")).toThrow("unknown formula: nonexistent-formula")
    })

    it("throws when model is unknown", () => {
      expect(() => cmdFormulaApply("unknown", "fast")).toThrow("unknown model: unknown")
    })
  })

  describe("cmdFormulaSave and cmdFormulasDelete", () => {
    it("throws when saving a formula from a model without an active formula", () => {
      upsertModel(makeMlxModel())
      expect(() => cmdFormulaSave("mlx-test", "my-custom")).toThrow("has no custom formula configured to save")
    })

    it("throws when model is unknown for save", () => {
      expect(() => cmdFormulaSave("unknown", "my-custom")).toThrow("unknown model: unknown")
    })

    it("saves custom formula and deletes it", () => {
      upsertModel(makeMlxModel({
        formula: {
          runtime: "mlx",
          mlx: { maxTokens: 8192 }
        }
      }))
      cmdFormulaSave("mlx-test", "custom-8k", "8k max tokens")
      const output = vi.mocked(console.log).mock.calls.map(c => c[0]).join("\n")
      expect(output).toContain("saved formula from")

      // delete formula
      cmdFormulasDelete("custom-8k")
      expect(() => cmdFormulasDelete("custom-8k")).toThrow("unknown user formula: custom-8k")
    })
  })

  describe("cmdFormulas", () => {
    it("lists available formulas and tunable keys for both runtimes", () => {
      cmdFormulas()
      const output = vi.mocked(console.log).mock.calls.map(c => c[0]).join("\n")
      expect(output).toContain("formulas")
      expect(output).toContain("tunable keys")
      expect(output).toContain("mlx")
      expect(output).toContain("llama.cpp")
    })
  })
})
