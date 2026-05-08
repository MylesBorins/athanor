# Recommendation and tuning plan

Working plan for improving model recommendations, fit guidance, and tuning in athanor.

This is intentionally a plan, not a final spec. It translates the current research/spec work into a repo-aligned sequence that respects the invariants in `AGENTS.md`.

## Goals

- help users pick a model that fits their Apple Silicon Mac
- make starter suggestions more useful without pretending to be a benchmark leaderboard
- surface conservative context/preset guidance
- warn before likely-bad launches without hard-blocking in MVP
- keep user intent fields authoritative
- keep schema changes additive and migration-safe

## Non-goals for MVP

- no cloud-backed ranking service
- no token/sec promises or chip-specific performance estimates
- no silent runtime switching
- no hard launch blocking
- no changes to pi sync shape or semantics
- no rewrite of `ModelEntry` into nested `detected/inferred/intent` objects

## Design constraints from the repo

- preserve existing `ModelEntry` shape; only add optional fields if needed
- scans/pulls stay non-destructive to user intent fields
- all persisted mutations go through existing registry/materialization helpers
- effective served context in pi sync must continue to come from merged runtime config
- recommendation logic should mostly compute on read, not become a new source of truth
- prefer extending existing surfaces (`show`, `ls`, TUI empty state, `src/pull/suggestions.ts`) over creating parallel systems

## Proposed implementation phases

### Phase 0 — planning + structure

1. **Keep recommendation data split conceptually, not structurally**
   - detected facts: persisted optional fields on `ModelEntry`
   - inferred guidance: computed on read from model entry + machine profile + config
   - user intent: existing fields (`preset`, `publish`, `piAlias`, `tags`, `mlxFlavor`, etc.)

2. **Use existing command/surface names**
   - extend `athanor show`, not `info`
   - extend existing empty-state suggestions from `src/pull/suggestions.ts`
   - keep pi sync untouched for MVP

### Phase 1 — machine profile + recommendation engine (MVP core)

#### 1. Machine profile helper

Add a small helper that detects:
- total unified memory
- chip string (informational only for MVP)

Likely file:
- `src/config/machine.ts` or `src/supervisor/machine.ts`

Notes:
- no strong need to persist a cache initially; detection is cheap
- if cached later, keep it outside the registry

#### 2. Add optional detected-fact fields to `ModelEntry`

Possible additive fields:
- `architectureFamily?: string`
- `trainedContextLength?: number`
- `quantization?: string`
- `paramCount?: number`
- `isMoe?: boolean`
- `activeParams?: number`
- `metadataSource?: "gguf_header" | "mlx_config" | "file_size_only"`

Rules:
- refreshed by scan/pull like `sizeBytes` and `mlxCapabilities`
- safe to overwrite on re-scan when they are detected facts
- never user-owned

#### 3. Detection during materialization flow

Hook metadata extraction into the existing discovery/pull materialization path rather than inventing a new parallel registry layer.

Likely touchpoints:
- `src/discovery/scanner.ts`
- `src/discovery/ingest.ts`
- `src/registry/materialize.ts`
- pull path near `pullToMaterializeInput()` callers

Implementation order:
- start with lightweight best-effort extraction
- fallback cleanly to file-size-only
- source-tag every detected result

#### 4. Recommendation/inference module

Add a pure module that computes, from `ModelEntry` + machine profile:
- estimated footprint in GB
- fit band: `comfortable | tight | risky`
- recommended starting context
- confidence level based on metadata completeness
- explanation string
- optional recommended preset hint

Important:
- compute on read
- do not persist inferred values in MVP unless a concrete need appears
- keep threshold constants centralized and configurable later

#### 5. Conservative footprint heuristic

MVP estimate should stay simple:
- weight estimate from `sizeBytes`
- small fixed overhead multiplier/buffer
- do not try to estimate full KV cache precisely in MVP
- manage KV risk via recommended context instead

Initial heuristic shape:
- comfortable if estimated footprint <= 60% total memory
- tight if <= 75%
- risky otherwise

These remain heuristics, not truth.

#### 6. Recommended context is advisory in MVP

Surface a recommended starting context in `show` and TUI detail surfaces.

Do not silently mutate launch behavior in MVP.

If we later want to make it launch-affecting, it must integrate with:
- merged runtime config
- presets
- explicit per-model overrides
- pi advertised effective context invariant

### Phase 2 — user-facing surfaces

#### 7. Extend `athanor show`

Add a recommendation section to `cmdShow` with:
- fit band
- estimated footprint
- recommended starting context
- explanation string
- metadata confidence/source note

This is the best first surface because it is explicit and low-risk.

#### 8. Extend empty-state starter suggestions

Evolve `src/pull/suggestions.ts` rather than creating a new starter system immediately.

Add optional metadata such as:
- memory tier (`8 | 16 | 32`)
- task tags (`general`, `coding`, `chat`)
- reviewed date
- rationale

Keep the list:
- short
- curated
- easy to update
- clearly framed as starter picks, not authoritative best models

#### 9. Optional `suggest` command later, not first

A dedicated `athanor suggest` command can come after the underlying logic exists.

It should:
- filter starter picks by detected machine tier
- show rationale and task tags
- reuse the same recommendation helper

But this is not needed before `show` and empty-state improvements land.

#### 10. TUI fit indicators

Add fit-band pills/labels in the model list or details pane.

Keep it compact:
- `comfortable`
- `tight`
- `risky`

Avoid trying to add too much explanatory text to crowded list rows; use the detail pane for explanation.

### Phase 3 — preflight warnings + presets integration

#### 11. Preflight memory snapshot warning

Before launch, compare:
- current memory use snapshot (reuse existing `vm_stat` parsing where possible)
- estimated model footprint

Warn if the combined snapshot is above the tight threshold.

MVP behavior:
- warning only
- user can proceed
- wording must say current snapshot / estimate, not certainty

Likely touchpoints:
- `src/supervisor/metrics.ts`
- `src/app/models.ts`
- CLI/TUI launch flow

#### 12. Recommendation-aware preset hints

Do not create a new preset system.
Use the existing presets/recipes surface and add recommendation hints such as:
- `stable`
- `coding`
- `memory-saver`

Potential work:
- identify whether existing recipe names cover these well enough
- if not, add or refine recipes in the existing presets modules
- surface “recommended preset” as advice only first

### Phase 4 — calibration and richer metadata

#### 13. Validate and calibrate heuristics

Use real machines and test fixtures to validate:
- metadata extraction accuracy
- fit-band usefulness
- context recommendations
- warning relevance

Do not ship tok/s estimates before this work.

#### 14. Consider observed-memory refinement later

Possible future enhancement:
- compare estimated footprint to observed runtime RSS / system deltas
- show “estimate vs observed” in `show`

This is explicitly later-phase and not required for the first recommendation pass.

## Specific implementation notes

### Metadata extraction

Start with the cheapest robust paths:
- GGUF: parse header metadata best-effort
- MLX: parse `config.json` and quantization metadata if present
- fallback: file size only

Do not fail scan/pull if metadata extraction is incomplete.

### Starter list freshness

This is the main stale-data risk.

Approach:
- keep shipped starter picks tiny
- treat them as curated defaults, not “best models”
- store rationale in one place
- include a reviewed date if we expand the suggestion type
- prefer updating `src/pull/suggestions.ts` over inventing a second curation source initially

### Runtime guidance

For MVP, runtime guidance should mostly summarize detected format/runtime.

Avoid claims like:
- MLX is always faster
- llama.cpp is always better for agents

If we later add comparative guidance, it should be based on observed athanor testing.

### pi sync

Leave `src/sync/pi.ts` alone in MVP.

No recommendation metadata should be exported into pi provider files until there is a concrete downstream consumer need and schema agreement.

## Suggested code touchpoints

- `src/types/index.ts`
  - additive optional detected-fact fields on `ModelEntry`

- `src/discovery/scanner.ts`
  - attach detected metadata when scanning discovered models where cheap to do so

- `src/registry/materialize.ts`
  - refresh detected-fact fields alongside `path`, `sizeBytes`, `mlxCapabilities`

- pull materialization path
  - populate detected facts for newly pulled models where available

- `src/cli/model-commands.ts`
  - extend `cmdShow()` with recommendation output
  - optionally later extend `cmdList()` or add `cmdSuggest()`

- `src/pull/suggestions.ts`
  - enrich starter suggestions with tier/task/rationale metadata

- `src/ui/*`
  - add fit-band + explanation in the detail view, keeping list rows compact

- `src/supervisor/metrics.ts`
  - reuse existing memory parsing for any preflight snapshot warning

## Proposed iteration order

1. land machine-profile helper
2. add additive detected-fact fields to types
3. implement lightweight metadata extraction
4. implement pure recommendation helper
5. wire recommendation output into `athanor show`
6. update starter suggestions structure and empty-state rendering
7. add preflight warning before launch
8. validate on real machines, then decide whether to expand to `suggest` and richer preset guidance

## Open questions to resolve during implementation

- which metadata fields are reliable enough to persist from GGUF/MLX today?
- should inferred recommendation data stay computed-only, or is there a later reason to cache it?
- what existing recipes already map well to `stable`, `coding`, and `memory-saver`?
- should starter suggestions remain MLX-only for now, or include a curated GGUF option once freshness/quality is reviewed?
- do we want fit-band indicators in `ls`, or should MVP keep them only in `show` and the TUI detail pane?

## Success criteria for the first pass

- `athanor show <slug>` gives a user a clear, conservative answer about fit and starting context
- empty-state suggestions feel more tailored and better explained
- launching an obviously too-large model produces a useful warning instead of silent pain
- no registry invariants are broken
- no existing user-owned fields are overwritten by recommendation logic
