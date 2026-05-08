# Recommendation and tuning task checklist

Task checklist derived from `context/RECOMMENDATION_PLAN.md`.

Status legend:
- [ ] not started
- [~] in progress
- [x] done

## 0. Grounding

- [x] Write repo-aligned implementation plan (`context/RECOMMENDATION_PLAN.md`)
- [x] Keep this checklist updated as work lands
- [x] Re-check `AGENTS.md` invariants before any schema or launch-path change

## 1. Phase 1 — machine profile + detected facts + inference core

Cross-reference: `context/RECOMMENDATION_PLAN.md`
- “Phase 1 — machine profile + recommendation engine (MVP core)”
- “Suggested code touchpoints”
- “Proposed iteration order” items 1–4

### 1.1 Machine profile helper
- [x] Add a small helper to detect total unified memory and chip string
- [x] Decide file location (`src/config/machine.ts` or nearby existing module)
- [x] Keep chip string informational only in MVP
- [x] Add tests for parsing/detection logic where practical

### 1.2 Add additive detected-fact fields to types
- [x] Extend `src/types/index.ts` `ModelEntry` with optional fields:
  - [x] `architectureFamily?`
  - [x] `trainedContextLength?`
  - [x] `quantization?`
  - [x] `paramCount?`
  - [x] `isMoe?`
  - [x] `activeParams?`
  - [x] `metadataSource?`
- [x] Keep all new fields optional and migration-safe
- [x] Do not restructure `ModelEntry`

### 1.3 Lightweight metadata extraction
- [x] Identify cheapest robust extraction path for GGUF
- [x] Identify cheapest robust extraction path for MLX model dirs
- [x] Implement best-effort detection with file-size fallback
- [x] Ensure scan/pull do not fail when metadata is missing
- [x] Source-tag detected metadata
- [x] Add focused unit tests / fixtures for detection

### 1.4 Materialization integration
- [x] Thread detected facts through discovery ingest path
- [x] Thread detected facts through pull materialization path
- [x] Refresh detected facts non-destructively on re-scan/re-pull
- [x] Preserve user-owned fields unchanged
- [x] Keep `src/registry/materialize.ts` aligned with non-destructive scan invariant

### 1.5 Recommendation/inference helper
- [x] Add a pure helper module for:
  - [x] estimated footprint
  - [x] fit band
  - [x] recommended starting context
  - [x] confidence level
  - [x] explanation string
  - [x] recommended preset hint (advisory only)
- [x] Keep thresholds centralized
- [x] Keep inferred data computed on read in MVP
- [x] Add unit tests for heuristic edge cases

## 2. Phase 2 — user-facing surfaces

Cross-reference: `context/RECOMMENDATION_PLAN.md`
- “Phase 2 — user-facing surfaces”
- “Specific implementation notes”
- “Success criteria for the first pass”

### 2.1 Extend `athanor show`
- [x] Add recommendation section to `cmdShow()`
- [x] Show fit band
- [x] Show estimated footprint
- [x] Show recommended starting context
- [x] Show explanation string
- [x] Show metadata source / confidence note
- [x] Keep wording explicitly heuristic/advisory

### 2.2 Evolve starter suggestions
- [x] Extend `src/pull/suggestions.ts` metadata shape if needed
- [x] Add memory tier metadata
- [x] Add task tags
- [x] Add rationale/review metadata if useful
- [x] Keep curated list short and manually maintainable
- [x] Update empty-state CLI/TUI rendering to use richer suggestion data
- [x] Avoid “best model” language

### 2.3 Optional later surface work
- [ ] Decide whether MVP includes fit-band info in `athanor ls`
- [ ] Decide whether to add `athanor suggest` after core surfaces land
- [ ] If yes later, ensure it reuses the same recommendation helper

### 2.4 TUI fit indicators
- [x] Identify best TUI detail surface for fit band + explanation
- [x] Keep list rows compact
- [x] Add detail/secondary view for explanation text if needed

## 3. Phase 3 — preflight warnings + presets guidance

Cross-reference: `context/RECOMMENDATION_PLAN.md`
- “Phase 3 — preflight warnings + presets integration”

### 3.1 Preflight warning
- [x] Reuse existing `vm_stat` / memory parsing where possible
- [x] Add warning-only preflight check before launch
- [x] Word as current snapshot / estimate, not certainty
- [x] Ensure users can still proceed in MVP
- [x] Add tests for warning threshold logic where practical

### 3.2 Recommendation-aware preset hints
- [x] Audit existing presets/recipes for `stable`, `coding`, `memory-saver` equivalents
- [x] Prefer evolving existing recipes over creating a parallel preset system
- [x] Surface preset recommendations as advice only first
- [x] Do not silently alter launch behavior in MVP

## 4. Validation and calibration

Cross-reference: `context/RECOMMENDATION_PLAN.md`
- “Phase 4 — calibration and richer metadata”
- “Open questions to resolve during implementation”

### 4.1 Metadata validation
- [ ] Validate GGUF extraction against known models
- [ ] Validate MLX extraction against known models
- [ ] Confirm fallback behavior when metadata is absent

### 4.2 Heuristic validation
- [ ] Validate fit-band usefulness on at least one smaller-memory machine and one larger-memory machine
- [ ] Validate recommended context sanity on comfortable/tight/risky examples
- [ ] Validate warning relevance under background memory pressure

### 4.3 Future-only ideas (not MVP)
- [ ] Decide later whether to compare estimated vs observed memory usage
- [ ] Decide later whether to add a dedicated `suggest` command
- [ ] Decide later whether to add richer runtime comparison guidance
- [ ] Decide later whether curated GGUF starters should join MLX starters

## 5. Guardrails

Cross-reference: `context/RECOMMENDATION_PLAN.md`
- “Non-goals for MVP”
- “Design constraints from the repo”

- [x] Do not change pi sync shape/semantics in MVP
- [x] Do not auto-switch runtimes
- [x] Do not hard-block launches
- [x] Do not ship token/sec estimates in MVP
- [x] Do not let recommendation logic overwrite user intent
- [x] Do not introduce stale large curated lists; keep starter picks tiny
