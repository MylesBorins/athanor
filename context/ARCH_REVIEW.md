# Athanor Architecture Review Context (working notes)

Date: 2026-05-03
Reviewer: AI agent

## Scope
Full-repo architectural review focused on runtime behavior, invariants in `AGENTS.md`, and improvement planning.

## Working log

### Inventory
- Entry points:
  - `bin/athanor`
  - `src/index.tsx`
- Core modules present under `src/`:
  - adapters, cli, config, control, discovery, presets, pull, registry, router, search, supervisor, sync, ui, types
- Test coverage appears broad across modules (`*.test.ts` throughout)

### In-progress findings
- Recently fixed bug in pi sync context propagation:
  - `src/sync/pi.ts` `contextWindowFor()` discriminator check corrected
  - regression test added in `src/sync/pi.test.ts`

### Implementation progress since initial review
- Completed **Phase 1.1** config validation work:
  - `src/config/index.ts` now sanitizes invalid persisted config values back to defaults
  - `src/config/index.test.ts` covers invalid numeric, enum, string, and boolean-ish values
- Completed **Phase 1.2** semantic registry mutation helpers:
  - added `setModelPublish`, `setModelFlavor`, `setModelPreset`, `touchModelLastUsed`
  - migrated common call sites away from raw `updateModel()`
- Started and materially advanced **Phase 2.1** application service layer:
  - added `src/app/models.ts`
  - centralized scan/pull/start/stop/restart/expose/flavor/preset/remove/sync flows
  - migrated CLI/control/TUI mutation paths to use service functions
  - added focused tests in `src/app/models.test.ts`
- Completed most of **Phase 3.1** CLI split:
  - added `src/cli/shared.ts`
  - added `src/cli/model-commands.ts`
  - added `src/cli/preset-commands.ts`
  - added `src/cli/system-commands.ts`
  - added `src/cli/pull-renderer.ts`
  - reduced `src/cli/commands.ts` to composition + `cmdPull()` + re-exports
- Completed substantial **Phase 3.2** TUI split:
  - added `src/ui/useModelActions.ts`
  - added `src/ui/useMouseWheel.ts`
  - added `src/ui/useAppData.ts`
  - added `src/ui/useAppInput.ts`
  - `src/ui/App.tsx` now acts much more like a composition shell
- Started **Phase 4.1** shared registry materialization:
  - added `src/registry/materialize.ts`
  - discovery ingest and pull now share entry creation/update rules
  - added focused tests in `src/registry/materialize.test.ts`
  - added pull-level regression coverage in `src/pull/hf.test.ts`
- Validation status after each refactor step:
  - repeated `npx tsc --noEmit` runs remained clean after fixes
  - full suite currently passes: `33` test files, `271` tests
- Completed preset/default context audit and follow-up fixes:
  - `src/sync/pi.ts` now advertises pi `contextWindow` from effective merged runtime config rather than only explicit per-model preset fields
  - global defaults raised to practical 16K context baselines (`mlx.promptCacheSize = 16384`, `llama.ctxSize = 16384`) with conservative supporting knobs
  - built-in recipes in `src/presets/recipes.ts` are now explicit stored presets with context bands:
    - `fast` = 8K
    - `balanced` = 16K
    - `quality` = 32K
    - `coding` = 32K
    - `long-context` = 64K
  - built-in descriptions now call out tradeoffs more clearly
  - added regression coverage for merged-config pi sync behavior, recipe-band parity, explicit balanced-preset persistence, preset clearing, and recipe replacement without stale fields

## Detailed findings

### 1. Entrypoints and control flow
- `src/index.tsx` is the single runtime entrypoint and cleanly separates CLI vs TUI mode:
  - always `ensureBaseDirs()` first
  - delegates to `runCli(args)`; returns early if a command handled argv
  - TUI path enforces TTY, performs eager `ingestDiscovered()` scan, starts optional control API and router, then mounts Ink app
- This is a good top-level shape: CLI and TUI share the same module graph and state files, with explicit startup side effects.
- Risk: `src/index.tsx` owns terminal alt-screen/cursor setup and also installs SIGINT/SIGTERM handlers directly. `src/cli/commands.ts` search TUI duplicates a second alt-screen implementation. This is manageable now, but terminal lifecycle behavior is split across entrypoint, search subcommand, and `App.tsx` mouse-mode cleanup.
- Architectural note: there is no application service layer. Entry point calls command functions directly; command functions call registry/supervisor/sync modules directly.

### 2. CLI architecture
- `src/cli/index.ts` is a hand-rolled dispatcher with a straightforward switch statement. This keeps dependencies low and command behavior explicit.
- Original review finding: `src/cli/commands.ts` mixed three responsibilities in one file:
  - orchestration/business flow (`cmdStart`, `cmdExpose`, `cmdPresetSet`)
  - presentation/formatting (`ok`, `warn`, `head`, progress rendering)
  - interactive UI launching (`runSearchTui` using Ink)
- This has now been substantially improved:
  - model-oriented commands moved to `src/cli/model-commands.ts`
  - preset/recipe commands moved to `src/cli/preset-commands.ts`
  - config/search/router/doctor moved to `src/cli/system-commands.ts`
  - shared output helpers moved to `src/cli/shared.ts`
  - pull progress rendering moved to `src/cli/pull-renderer.ts`
  - `src/cli/commands.ts` now mostly composes exports and retains `cmdPull()`
- Updated assessment:
  - the original CLI god-module concern is now materially reduced
  - remaining cleanup opportunity is to move `cmdPull()` into its own module and potentially simplify `src/cli/index.ts` arg parsing later

### 3. Configuration and state boundaries
- `src/config/index.ts` is the sole source for path layout and default config. Good:
  - defaults are centralized
  - config writes are atomic (tmp + rename)
  - `ATHANOR_HOME` override is test-friendly
- `deepMerge()` allows partial config files without schema validation.
- Risk: malformed config values are largely accepted as long as JSON parses. Example classes of issues:
  - negative or inverted port ranges
  - impossible supervisor settings (`maxConcurrent=0`, negative timeout)
  - wrong primitive types surviving until later runtime failures
- Recommendation: add lightweight runtime validation/coercion at config load boundaries. Zod is already in `node_modules` transitively but not declared; could use hand-rolled validation to avoid new deps.

### 4. Registry architecture
- `src/registry/index.ts` is intentionally small and important. It correctly preserves key invariants:
  - atomic writes via temp + rename
  - stable port allocation on first ingest only
  - `slugify`, `uniqueSlug`, `allocatePort`, snapshot helpers are cohesive
- Strength: registry remains the source of truth for model identity/state and does not try to be clever.
- Important weakness: `updateModel()` shallow-merges `Partial<ModelEntry>`. That is fine for current usage patterns, but dangerous if future callers try partial nested updates like `{ preset: { mlx: { ... }}}` without using preset helpers. AGENTS.md already forbids hand-editing; code structure still makes it easy to do the wrong thing.
- Improvement direction: expose narrower mutation helpers for common actions (`setPublish`, `setFlavor`, `setPreset`, `touchLastUsed`) and reduce generic `updateModel()` call sites.

### 5. Discovery and ingest path
- Discovery is split well:
  - `src/discovery/scanner.ts`: filesystem/HF cache interpretation
  - `src/discovery/ingest.ts`: maps discovered models into shared registry materialization while preserving user intent fields
- This matches invariants well. `ingestDiscovered()` preserves slug/port/preset/publish/piAlias/tags/mlxFlavor and refreshes only path/size/capabilities.
- `detectMlxCapabilities()` is correctly centralized in scanner and reused by pull path. Good invariant adherence.
- `scanModels()` currently scans three sources:
  - MLX HF cache under `modelDirs.mlx`
  - local GGUF tree under `modelDirs.llama`
  - GGUF files inside HF cache via `scanHFCacheGgufModels(dirs.mlx)`
- Strength: practical user ergonomics; downloads from outside athanor get picked up.
- Risks / possible improvements:
  - scanner prints directly to stderr on partial failures; there is no structured error/report object
  - recursive GGUF scan may get expensive on large trees; no pruning rules or ignore list
  - size calculation for MLX snapshot is shallow directory sum; if layout changes or nested files matter, result can undercount

### 6. Pull architecture
- `src/pull/hf.ts` orchestrates hub metadata lookup, runtime inference, download, resolved-path selection, and registry upsert.
- Good separation exists between:
  - Hub API inference (`pull/api.ts`)
  - sidecar process management (`pull/download.ts` + `hf_pull.py`)
  - registry materialization (`src/registry/materialize.ts`)
- Strong design choice: pull writes registry only after download completes; abort path rejects before registry mutation.
- Review follow-up now implemented:
  - pull no longer carries its own private registry upsert logic
  - both pull and discovery now route through shared materialization helpers
- Updated assessment:
  - the previous drift risk between pull and ingest is materially reduced
  - remaining opportunity is mostly around naming/shape polish, not duplicated merge semantics

### 7. Adapter layer
- `src/adapters/index.ts`, `mlx.ts`, `llama.ts`, `health.ts` are a clean runtime boundary.
- Strengths:
  - merged config resolution is centralized in `mergedConfigFor()`
  - request model-id semantics are explicitly documented in `runtimeModelId()`
  - router reverse lookup also lives here (`resolveByRuntimeModelId()`), which keeps model identifier policy close to adapters
- Good invariant compliance:
  - MLX HF models use repo id literally
  - llama uses alias/slug
  - MLX flavor routing and capability detection stay separate
- Architectural note: the adapter abstraction is thin but appropriate; it hides command construction and health probe differences without over-generalizing.

### 8. Supervisor architecture
- `src/supervisor/index.ts` is the process lifecycle core. Overall flow is coherent:
  - constructor reattaches from persisted state
  - `start()` applies policy, checks port health, spawns detached child, waits for health, persists state, touches `lastUsedAt`
  - `stop()` optionally drains router in-flight work, kills pid, removes persisted state
- Strengths:
  - persistence/reattach behavior is simple and easy to reason about
  - policies are isolated in `src/supervisor/policies.ts`
  - inflight-drain is decoupled in `src/supervisor/inflight.ts`
- Risks:
  - supervisor mutates registry (`updateModel(entry.id, { lastUsedAt: Date.now() })`) directly. This is minor but indicates cross-layer coupling.
  - `probeHealth(entry.runtime, entry.port, 500)` is used as a port-in-use check before spawn. This only detects “some compatible runtime is responding”, not arbitrary listeners. A foreign process binding the port but not answering expected health endpoints slips through until spawn fails or runtime binds elsewhere/fails obscurely.
  - no event stream/callback mechanism exists; TUI and CLI poll `supervisor.list()` and react imperatively.
- Improvement direction: add a tiny event emitter for lifecycle transitions (`starting`, `running`, `stopped`, `error`) to reduce polling and centralize side effects like pi sync.

### 9. Router architecture
- `src/router/server.ts` is one of the cleaner modules in the repo.
- It does three jobs well:
  - synthesizes `/v1/models` from the registry
  - resolves POST `/v1/**` request `model` to a registry entry
  - auto-starts target model and proxies upstream stream transparently
- Strong invariant fit with router mode in pi sync.
- Strengths:
  - request/response header stripping is explicit
  - SSE streaming is preserved by piping bytes, not string buffering
  - in-flight accounting hooks are minimal and easy to verify
- Risks:
  - router reparses full JSON request bodies into memory before proxying. That is fine for chat/completions payload sizes today, but it means no streaming uploads and no opaque pass-through for future endpoints.
  - `listModels()` is called repeatedly per request and on `/v1/models`; acceptable now, but indicates all state access is synchronous file-backed/in-memory mix rather than through a process-level store.
  - token accounting opportunity noted in AGENTS.md remains open.

### 10. Pi sync architecture
- `src/sync/pi.ts` is a merge writer around pi-agent files and is load-bearing for user trust.
- Strengths:
  - preserves non-athanor providers verbatim
  - only updates `defaultProvider`/`defaultModel` in settings
  - cleanly models router-on vs router-off provider shapes
  - runtime-specific compat handling is explicit
- Weaknesses observed during initial review:
  - local helper types (`PiModelConfig`, `PiProviderConfig`) are informal and permissive; schema drift from actual pi expectations is possible
  - sync was invoked from many places (`start`, `stop`, `restart`, `expose/hide`, preset changes, flavor changes, rm, TUI actions, control API). This distributed triggering made it easy to forget a sync call on future mutations.
- Confirmed issue found and fixed during review:
  - `contextWindowFor()` had been reading runtime discriminator from the wrong level; fixed to use `entry.preset.runtime`
- Follow-up correctness improvement now landed:
  - pi `contextWindow` is derived from effective merged config, not only explicit preset fields, so provider metadata stays aligned with actual runtime launch settings when defaults are inherited
- This has now been partially improved structurally:
  - `src/app/models.ts` centralizes many common flows and owns most `syncPi()` triggering for CLI/TUI/control paths
  - direct `syncPi()` call-site sprawl is reduced, though not yet fully event-driven
- Updated assessment:
  - the service layer meaningfully lowers regression risk for sync behavior
  - future improvement remains: event-based sync or a stricter single mutation boundary

### 11. TUI architecture
- `src/ui/App.tsx` was originally one of the main maintainability hotspots.
- Original responsibilities included:
  - polling supervisor/registry/system stats
  - selection/filter state
  - watcher startup
  - mouse protocol enable/disable
  - modal routing (pull/preset/search/logs)
  - action orchestration (start/stop/restart/expose/delete/rescan)
  - layout math
- This has now been meaningfully improved through hook extraction:
  - `src/ui/useAppData.ts` owns polling, watcher hookup, and derived instance stats
  - `src/ui/useMouseWheel.ts` owns raw mouse protocol lifecycle and wheel routing
  - `src/ui/useModelActions.ts` owns start/stop/restart/expose/delete/rescan/kill flows
  - `src/ui/useAppInput.ts` owns keyboard routing and mode-aware keybindings
- Updated assessment:
  - `App.tsx` is no longer the same level of god module it was at review start
  - it now acts much more like a composition shell for state, input, and presentation
  - remaining complexity is mostly layout/mode composition rather than cross-layer orchestration
- Remaining improvement opportunity:
  - extract layout/view-model calculations if further simplification is desired
  - add targeted hook tests to lock in the extracted TUI behavior

### 12. Metrics and observability
- `src/supervisor/metrics.ts` is pragmatic and thoughtfully Mac-aware.
- Strengths:
  - `vm_stat` parsing uses a sensible “memory used” definition for macOS
  - per-process stats via `ps` are cheap and sufficient
  - completion-stat parsing from logs is isolated and testable
- Limitation:
  - tok/s is post-hoc log parsing rather than live runtime metrics, except for future router passthrough work
  - metrics are sampled by polling; there is no history window or structured metrics store

### 13. Tests and reliability posture
- Test coverage breadth is good: adapters/config/discovery/presets/pull/registry/router/search/supervisor/sync/ui-adjacent behavior through unit tests.
- `test/setup.ts` redirects ATHANOR_HOME and PI_HOME, which is exactly the right isolation story.
- Gaps observed from architecture perspective:
  - few end-to-end flow tests covering registry + supervisor + sync together
  - no dedicated config validation tests because config validation is currently permissive
  - no tests asserting every mutation path triggers pi sync; today this is encoded by convention

## Architectural assessment summary
- The codebase has a strong product core and coherent module split for a small single-user tool.
- The main architectural weakness is not low-level correctness; it is **orchestration sprawl**:
  - `src/cli/commands.ts` and `src/ui/App.tsx` each know too much and trigger too many side effects directly.
  - Important cross-cutting behavior (especially `syncPi()`) is manually invoked from many mutation sites.
- The best next step is **not** a rewrite. It is introducing a thin application/service layer that centralizes stateful operations while preserving the current modules and invariants.

## Improvement plan

### Status snapshot
- **Completed:** config validation/sanitization, semantic registry mutation helpers, service-layer introduction, major CLI split, major TUI split, context window regression fix, shared registry materialization
- **Partially completed:** sync centralization via `src/app/models.ts`
- **Still pending/high value:** more integration-style sync tests, optional event-based lifecycle/sync model, targeted tests for extracted TUI hooks/services

### Quick wins (remaining)
1. **Add focused tests for extracted hooks/services still lacking direct coverage**
   - especially `src/ui/useMouseWheel.ts` where practical
2. **Consider a small preset UX follow-up in CLI/TUI copy**
   - built-ins are now explicit stored presets rather than `balanced == clear`, so any user-facing wording should stay aligned with that model
3. **Finish any additional sync/integration regression coverage desired**
   - current merged-config context reporting is covered; broader provider/default-model/router cases are already in solid shape

### Medium improvements (1–2 weeks)
1. **Introduce an application service layer**
   - Example module: `src/app/models.ts` or `src/services/models.ts`
   - Own operations: scan, pull, start/stop/restart, expose/hide, preset/flavor mutation, remove, sync
   - CLI and TUI call the same service functions instead of touching registry/supervisor/sync directly.
2. **Break up `src/cli/commands.ts`**
   - Split by domain while preserving current CLI UX.
3. **Refactor `src/ui/App.tsx` into hooks + presentational shell**
   - Extract terminal/mouse plumbing and polling logic.
4. **Unify registry materialization paths**
   - Shared helper used by discovery ingest and pull upsert to avoid policy drift.
5. **Introduce structured domain events**
   - Supervisor/model lifecycle events can drive TUI refresh and pi sync more reliably than polling/manual calls.

### Larger bets (later)
1. **Transactional mutation model / state store**
   - A process-local state manager that owns registry cache, instances, and emits events.
2. **Optional schema versioning/migrations for config and registry**
   - Helpful as features accumulate.
3. **Richer observability**
   - live token accounting from router passthrough, retained metrics history, maybe JSON status output.
4. **End-to-end black-box tests**
   - Simulated runtimes + router + sync files for higher confidence on upgrades.

## Proposed prioritized backlog
1. Create thin app service layer for model operations.
2. Refactor CLI command monolith into domain modules.
3. Refactor TUI App monolith into hooks + action handlers.
4. Add config validation at load boundary.
5. Unify ingest/pull registry update logic.
6. Add event-based syncPi triggering or centralized post-mutation sync hooks.
7. Add integration tests for start/stop/expose/router sync flows.
8. Implement live token accounting in router mode.

## Phased execution plan

### Phase 1 — Safety and reduction of accidental breakage
Goal: improve correctness without changing architecture materially.
Status: **mostly complete**

#### 1.1 Config validation at load boundary
Status: **complete**
- **Why first:** low risk, immediate UX payoff, prevents opaque runtime failures.
- **Scope:**
  - validate/coerce `portRange.min/max`
  - validate positive numeric fields in `mlx`, `llama`, `supervisor`, `router`, `controlApi`
  - clamp or reject impossible values with one-line warnings
- **Files:**
  - `src/config/index.ts`
  - `src/config/index.test.ts`
- **Acceptance criteria:**
  - invalid config falls back predictably or errors clearly
  - typecheck/tests remain clean
  - README config docs still match effective defaults

#### 1.2 Narrow registry mutation helpers
Status: **complete**
- **Why first:** supports later refactors and reduces misuse of generic `updateModel()`.
- **Add helpers:**
  - `setModelPublish(idOrSlug, publish)`
  - `setModelFlavor(idOrSlug, mlxFlavor)`
  - `setModelPreset(idOrSlug, preset)`
  - `touchModelLastUsed(idOrSlug, at)`
- **Files:**
  - `src/registry/index.ts`
  - call sites in `src/cli/commands.ts`, `src/ui/App.tsx`, `src/supervisor/index.ts`
- **Acceptance criteria:**
  - most direct `updateModel()` usages replaced by semantic helpers
  - no invariant changes to registry persistence behavior

#### 1.3 Add missing integration-style tests around sync behavior
Status: **partially complete**
- **Why first:** locks in current behavior before refactors.
- **Test targets:**
  - start -> sync default provider/model
  - expose/hide -> provider emitted/removed
  - router enabled -> runtime aggregators only
  - preset context window -> reflected in pi model config
- **Files:**
  - `src/sync/pi.test.ts`
  - possibly new focused tests under `src/cli/` or `src/supervisor/`
- **Acceptance criteria:**
  - regression coverage for context window and provider shape invariants

### Phase 2 — Thin application service layer
Goal: centralize side effects without rewriting modules.
Status: **substantially complete**

#### 2.1 Introduce shared model operation service
Status: **substantially complete**
- **Core idea:** create one orchestration layer that owns “do thing + sync pi + return result”.
- **Suggested module:**
  - `src/app/models.ts` or `src/services/models.ts`
- **Initial exported operations:**
  - `scanModelsAndReport()`
  - `pullModel(opts)`
  - `startModel(idOrSlug)`
  - `stopModel(idOrSlug | "--all")`
  - `restartModel(idOrSlug)`
  - `setPublished(idOrSlug, publish)`
  - `setFlavor(idOrSlug, flavor)`
  - `setPreset(idOrSlug, preset)` / `unsetPresetFieldsForModel(...)`
  - `removeModelEntry(idOrSlug)`
  - `syncPiNow()`
- **Responsibilities of service layer:**
  - resolve entry
  - invoke registry/supervisor helpers
  - call `syncPi()` exactly once where appropriate
  - return structured result objects for CLI/TUI presentation
- **Files touched:**
  - new `src/app/models.ts`
  - `src/cli/commands.ts`
  - `src/ui/App.tsx`
  - `src/control/server.ts`
- **Acceptance criteria:**
  - CLI and TUI no longer call `syncPi()` directly for common mutations
  - behavior remains unchanged from user perspective

#### 2.2 Optional lightweight event emitter in supervisor
Status: **not started**
- **Not required to start service layer**, but useful if simple.
- **Events:** `starting`, `running`, `stopped`, `error`, `reattached`
- **Use cases:** TUI refreshes, centralized sync, later telemetry.
- **Keep it tiny:** no external dependency required.

### Phase 3 — Break up the two god modules
Goal: improve maintainability while keeping behavior stable.
Status: **substantially complete**

#### 3.1 Split `src/cli/commands.ts` by domain
Status: **mostly complete**
- **Proposed structure:**
  - `src/cli/commands/models.ts` — ls/show/start/stop/restart/logs/rm/expose/hide/sync
  - `src/cli/commands/presets.ts` — preset/flavor/recipes
  - `src/cli/commands/pull.ts` — pull + progress renderer
  - `src/cli/commands/search.tsx` — search/trending + Ink browser launch
  - `src/cli/commands/system.ts` — config/doctor/router
  - `src/cli/commands/index.ts` — exports stable functions for dispatcher
- **Benefit:** smaller files, easier testing, easier ownership of changes.
- **Acceptance criteria:**
  - `src/cli/index.ts` stays simple switch/router
  - no user-facing command changes

#### 3.2 Split `src/ui/App.tsx` into hooks + shell
Status: **substantially complete**
- **Highest priority UI extractions:**
  - `useAthanorState()` — models, instances, sys stats, polling
  - `useMouseWheel()` — raw-mode/mouse protocol management
  - `useSelectionFollowActive()` — selection jumps to newly active model
  - `useStatusMessage()` — TTL logic
  - `useCacheWatcherToast()` — watcher + toast callback
- **Potential action helper module:**
  - `src/ui/actions.ts` for start/stop/restart/expose/delete/rescan wrappers
- **Acceptance criteria:**
  - `App.tsx` mostly describes mode routing and layout
  - terminal cleanup behavior preserved exactly

### Phase 4 — Unify model materialization paths
Goal: reduce drift between discovery ingestion and explicit pull.
Status: **substantially complete**

#### 4.1 Shared helper for “discover/update registry entry”
- **Problem today:** `ingestDiscovered()` and `pull.upsertRegistryEntry()` both implement parts of registry materialization.
- **Proposed abstraction:**
  - helper that takes a discovered/materialized model descriptor and merges it into registry while preserving invariant fields
- **Possible module:**
  - `src/registry/materialize.ts`
  - or helper inside `src/discovery/ingest.ts` reused by pull
- **Rules to preserve:**
  - stable port on first insert only
  - preserve preset/publish/piAlias/tags/slug/mlxFlavor on update
  - refresh path/size/capabilities from source of truth
- **Acceptance criteria:**
  - one shared merge policy
  - pull and scan no longer drift in update semantics

### Phase 5 — Observability and higher-confidence testing
Goal: make operations easier to reason about in production-like use.
Status: **not started**

#### 5.1 Router passthrough token accounting
- Already identified in `AGENTS.md`.
- **Implementation hook:** `src/router/server.ts` around the `pipeline(...)` passthrough.
- **Companion changes:**
  - store/update live token stats in `src/supervisor/metrics.ts` or adjacent module
  - prefer live stats when router mode is active
- **Acceptance criteria:**
  - TUI/CLI can show live tok/s during active generations under router mode

#### 5.2 Black-box integration tests
- **Focus areas:**
  - router request starts correct model and proxies response
  - supervisor persistence + reattach
  - pi sync namespace preservation
  - service layer mutation -> sync side effects
- **Approach:**
  - fake runtimes / stub health endpoints / temp homes
- **Acceptance criteria:**
  - most important invariants covered by multi-module tests, not just unit tests

## Suggested issue breakdown

### P0
1. Config validation and tests
2. Semantic registry mutation helpers
3. Add sync regression/integration tests
4. Introduce service layer for start/stop/expose/preset flows

### P1
5. Move CLI commands into domain modules
6. Extract TUI state/mouse/action hooks
7. Unify pull + ingest registry materialization

### P2
8. Add supervisor lifecycle events
9. Implement router live token accounting
10. Add black-box integration suite

## Recommended order of execution from current state
1. Finish Phase 1.3 sync/integration-style tests
2. Add targeted tests for the new service layer and extracted UI hooks where practical
3. Phase 4.1 materialization unification (pull + ingest shared merge policy)
4. Phase 2.2 optional supervisor lifecycle events
5. Phase 5.1/5.2 observability + black-box tests

## Why this updated sequence
- The early safety and decomposition work is already done and validated.
- The highest remaining risk is now behavioral drift across sync/materialization paths, not monolithic file structure.
- Additional tests should land before unifying pull/ingest semantics so invariants stay locked.
- Event-driven lifecycle work is now easier because the service layer and UI boundaries exist.
