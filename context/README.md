# Context folder

Reusable architecture and planning context for athanor. Not user-facing docs — see `README.md` and `AGENTS.md` for that.

## Routine work

| File | Use |
|---|---|
| `ARCH_MAP.md` | **Start here.** Compressed module map, data flows, invariants, risk areas. |
| `ARCH_REVIEW.md` | Completed refactor history + remaining architectural backlog. |

## Plans

Active and archived task plans live under `plans/`. The pi plan-mode extension reads/writes `plans/.plan-state.json` for the active plan.

| Location | Use |
|---|---|
| `plans/*.md` | Active or proposed plans |
| `plans/done/*.md` | Completed plans kept for reference |
| `plans/README.md` | Plan-mode workflow notes |

## Discipline

- Consult `ARCH_MAP.md` first for normal coding tasks.
- Prefer incremental context: changed files, related modules, affected invariants.
- After meaningful architectural refactors, update `ARCH_MAP.md` and trim backlog in `ARCH_REVIEW.md`.
- When a plan finishes, move it to `plans/done/` and update `.plan-state.json`.
