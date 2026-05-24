# Fix Duplicate Model Entries in Discovery + Registration

## Status
Done

## Problem

The user's `~/.athanor/models.json` contains two entries for the same on-disk GGUF file:

| Field | Entry 1 (pull) | Entry 2 (watcher scan) |
|---|---|---|
| id | `unsloth/Qwen3.6-27B-GGUF:Qwen3.6-27B-Q4_K_M.gguf` | `/Users/…/.models/unsloth--Qwen3.6-27B-GGUF/Qwen3.6-27B-Q4_K_M.gguf` |
| path | `/Users/…/.models/unsloth--Qwen3.6-27B-GGUF/Qwen3.6-27B-Q4_K_M.gguf` | *(identical)* |
| source | `{ type: "hf", repo: "unsloth/Qwen3.6-27B-GGUF" }` | `{ type: "local" }` |
| port | 8081 | 8082 |
| addedAt | 1779593348589 | 1779594586802 (+~20 min) |

Both entries point at the **same physical file**. The second entry wastes a port and confuses the TUI.

## Root Cause Analysis

`materializeRegistryEntry` in [materialize.ts](file:///Users/mylesborins/code/athanor/src/registry/materialize.ts) already has path-based dedup (line 104–115). Within a **single Node process**, this works because all I/O is synchronous and serialized. But the dedup can fail under two conditions:

1. **Cross-process race**: Two athanor processes (e.g. TUI + CLI, or two TUI sessions) both call `loadRegistry()` before either calls `saveRegistry()`. Each sees a stale snapshot without the other's entry. Both create independent entries for the same path.

2. **Startup ingest vs. watcher timing**: TUI startup calls `ingestDiscovered()` synchronously (line 57 of [index.tsx](file:///Users/mylesborins/code/athanor/src/index.tsx)), then the watcher starts (via `useAppData`). If a previous TUI session or `athanor pull` created the HF entry, and then a new TUI session starts, the startup ingest scans and calls `materializeRegistryEntry` for each discovered model. The path dedup should catch it — but if the paths differ even subtly (e.g. trailing slash, symlink vs. real path), the match fails silently and a duplicate is created.

Regardless of the exact trigger, **the code should prevent this state entirely**.

## Proposed Changes

### Defense-in-Depth Strategy

Three layers, each independently sufficient to prevent duplicates:

---

### Layer 1: Deduplicate scanner output before ingestion

#### [MODIFY] [scanner.ts](file:///Users/mylesborins/code/athanor/src/discovery/scanner.ts)

Add deduplication to `scanModels()` before returning results. When multiple discovered models share the same path (after normalization), keep only the one with the richest source metadata (prefer `hf` over `local`). This prevents `ingestDiscovered` from ever seeing two entries for the same file.

```typescript
export function scanModels(): Model[] {
  const dirs = getModelDirs()
  const mlxModels    = scanMlxModels(dirs.mlx)
  const ggufModels   = scanGgufModels(dirs.llama)
  const hfGgufModels = scanHFCacheGgufModels(dirs.mlx)
  return deduplicateByPath([...mlxModels, ...ggufModels, ...hfGgufModels])
}
```

The `deduplicateByPath` helper normalizes paths (`fs.realpathSync` with graceful fallback) and when two entries collide on the same real path, keeps the one with `source.type === "hf"` (richer metadata).

---

### Layer 2: Registry-level dedup on load

#### [MODIFY] [materialize.ts](file:///Users/mylesborins/code/athanor/src/registry/materialize.ts)

Normalize the input path before matching: resolve symlinks and remove trailing slashes so path comparisons aren't defeated by cosmetic differences.

---

### Layer 3: Startup dedup pass

#### [MODIFY] [index.ts (registry)](file:///Users/mylesborins/code/athanor/src/registry/index.ts)

Add a `deduplicateRegistry()` function that scans the loaded registry for entries sharing the same normalized path. When duplicates exist, merge them (keeping the one with the richer source and preserving user-owned fields from either side: `slug`, `port`, `publish`, `piAlias`, `preset`, `tags`, `mlxFlavor`). Call this on load.

#### [MODIFY] [index.tsx](file:///Users/mylesborins/code/athanor/src/index.tsx)

Call `deduplicateRegistry()` at TUI startup, before `ingestDiscovered()`, so any pre-existing duplicates (like the user's current state) are cleaned up immediately.

---

### Fix existing data

The user's current duplicate will be cleaned up automatically by Layer 3 on next TUI startup. No manual intervention needed.

## Open Questions

> [!IMPORTANT]
> **Merge strategy for user-owned fields**: When deduplicating two entries that both have user-set fields (e.g. entry 1 has a preset, entry 2 has tags), which wins? My proposal: prefer the entry with `source.type === "hf"` as the "primary", then copy over any user-owned fields from the other entry that the primary lacks (additive merge). The HF-sourced entry keeps its `id`, `slug`, and `port`; any `preset`, `tags`, `mlxFlavor`, `piAlias` set on the discarded entry are copied to the primary only if the primary's field is absent/default.

## Verification Plan

### Automated Tests

- New test in `materialize.test.ts`: pull creates HF entry → scan creates local entry with same path → assert only 1 model in registry (already passes — this confirms layer 2 works in the single-process case)
- New test in `scanner.test.ts`: `deduplicateByPath` correctly keeps the HF-sourced entry when two entries share a path
- New test in `registry/index.test.ts`: `deduplicateRegistry` merges two entries sharing a path, preserving user fields
- `npx tsc --noEmit` clean
- `npm run test:run` green

### Manual Verification

- User starts TUI → duplicate should be cleaned up automatically → only one entry shown
