import { describe, it, expect } from "vitest"
import { decide } from "./policies.js"
import type { ActiveInstance, ModelEntry } from "../types/index.js"

function inst(id: string, startedAt: number): ActiveInstance {
  return {
    id, slug: id, runtime: "mlx", port: 8081, pid: 1,
    startedAt, status: "running", logFile: "/tmp/x.log"
  }
}

const target: ModelEntry = {
  id: "new", slug: "new", path: "/m/new", runtime: "mlx",
  source: { type: "hf", repo: "x/new" },
  port: 8090, publish: true, piAlias: "new", addedAt: 0
}

describe("supervisor policies", () => {
  it("manual never stops anything", () => {
    const d = decide("manual", 999, [inst("a", 1), inst("b", 2)], target)
    expect(d.stopBeforeStart).toEqual([])
  })

  it("single-active stops all other instances", () => {
    const d = decide("single-active", 1, [inst("a", 1), inst("b", 2)], target)
    expect(d.stopBeforeStart.sort()).toEqual(["a", "b"])
  })

  it("single-active does not stop the same id being restarted", () => {
    const d = decide(
      "single-active", 1,
      [{ ...inst("new", 1) }], target
    )
    expect(d.stopBeforeStart).toEqual([])
  })

  it("multi-active-lru evicts oldest when over capacity", () => {
    const d = decide(
      "multi-active-lru", 2,
      [inst("a", 1), inst("b", 3)], target
    )
    expect(d.stopBeforeStart).toEqual(["a"])
  })

  it("multi-active-lru keeps all within capacity", () => {
    const d = decide(
      "multi-active-lru", 3,
      [inst("a", 1), inst("b", 3)], target
    )
    expect(d.stopBeforeStart).toEqual([])
  })
})
