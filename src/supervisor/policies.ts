import type {
  ActiveInstance,
  ModelEntry,
  SupervisorPolicy
} from "../types/index.js"

export interface PolicyDecision {
  stopBeforeStart: string[]
}

export function decide(
  policy: SupervisorPolicy,
  maxConcurrent: number,
  active: ActiveInstance[],
  target: ModelEntry
): PolicyDecision {
  const others = active.filter(a => a.id !== target.id)

  switch (policy) {
    case "manual":
      return { stopBeforeStart: [] }

    case "single-active":
      return { stopBeforeStart: others.map(o => o.id) }

    case "multi-active-lru": {
      const overflow = others.length + 1 - Math.max(1, maxConcurrent)
      if (overflow <= 0) return { stopBeforeStart: [] }
      const sorted = [...others].sort((a, b) => a.startedAt - b.startedAt)
      return { stopBeforeStart: sorted.slice(0, overflow).map(o => o.id) }
    }
  }
}
