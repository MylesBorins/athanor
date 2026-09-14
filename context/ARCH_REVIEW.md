# Architecture review — summary and backlog

Historical review from 2026-05-03. For day-to-day work, use `ARCH_MAP.md` first.

## What landed

The review targeted orchestration sprawl (CLI/TUI god modules, scattered `syncPi()` calls, duplicated registry materialization). All major phases completed:

- **Config safety** — load-time sanitization in `src/config/index.ts`
- **Registry helpers** — semantic mutations (`setModelPublish`, `setModelFlavor`, etc.) plus shared materialization in `src/registry/materialize.ts`
- **App service layer** — `src/app/models.ts` centralizes scan/pull/start/stop/expose/preset flows and most pi sync side effects
- **CLI split** — domain modules under `src/cli/` (`model-commands`, `preset-commands`, `system-commands`, `pull-commands`, `snippet-commands`, `telemetry-commands`, `pull-renderer`, `shared`) wired directly into `src/cli/index.ts` dispatcher
- **TUI split** — hooks extracted from `App.tsx` (`useAppData`, `useModelActions`, `useAppInput`, `useMouseWheel`)
- **Pi context correctness** — `contextWindow` from effective merged runtime config; 64K default baselines; explicit recipe context bands
- **Router lifecycle detach** — `src/router/lifecycle.ts`; router follows active model state, not TUI lifetime (see `plans/done/router-lifecycle-detach.md`)
- **Duplicate registry cleanup** — path dedup in scanner + `deduplicateRegistry()` on load/startup (see `plans/done/fix-dupe-models.md`)
- **Model display alignment** — HF repo primary in TUI/pi; hub GGUF runtime ids match registry id in pi (see `src/registry/display.ts`, `src/adapters/model-id.ts`)
- **Recommendation / fit guidance** — detected metadata on `ModelEntry`, `src/registry/recommend.ts`, `show`/TUI fit bands, preflight warnings, enriched starter suggestions
- **Ingress as default** — `config.router.enabled: true` default with aggregated pi providers (`athanor-mlx`, `athanor-llama`)
- **Interactive HF search browser & concurrent downloads** — `SearchBrowser.tsx`, `DownloadsModal.tsx`, `useDownloads.ts` with queue deduplication and cancellation
- **Router live token accounting** — `SSETokenCounter` passthrough Transform in `src/router/server.ts` tees SSE stream tokens live, updating `src/supervisor/metrics.ts` (`updateLiveRouterStats`), surfaced in CLI (`athanor status`) and TUI (`useAppData`)
- **Supervisor lifecycle events** — `Supervisor` extends `EventEmitter` with strongly-typed lifecycle events (`starting`, `running`, `stopped`, `exit`, `error`, `evicted`), providing event-driven observability for process transitions
- **Comprehensive test suite** — full integration test suites (pi-sync, CLI flows, pipeline, detached supervisor, router telemetry), complete TUI coverage (`PresetEditor`, `SearchBrowser`, `PullModal`, `ModelList`, and hooks `useAppInput`, `useDownloads`, `useModelActions`, `useAppData`, `useMouseWheel`), and supervisor policy & eviction suites.

Test suite as of 2026-09-14: 64 test files, 749 tests, running under Vitest v5, TypeScript 7, and oxlint with >85% overall branch coverage and >93% statement coverage.

## Remaining backlog

Ordered by value; none of these require breaking `AGENTS.md` invariants without an explicit decision.

### Medium value

1. **Recommendation calibration** — see `plans/recommendation-calibration.md` (validate GGUF/MLX metadata extraction, GQA attention head scalings, and fit-band heuristics on real machines)
2. **Performance pass** — see `plans/performance-optimization.md` (warmup semantics, latency observability, preset tuning)

### Later / optional

3. **Black-box integration tests** — fake runtimes + stub health endpoints across registry/supervisor/sync/router
4. **Transactional state store** — process-local cache with events; only if orchestration complexity grows further

## Known structural risks (unchanged)

These are acceptable today but worth remembering:

- Sync side effects are centralized by convention via `src/app/models.ts`, not events
- Supervisor mutates registry (`lastUsedAt`) directly
- Router parses full JSON bodies before proxying (no opaque passthrough)
- `App.tsx` still owns layout/mode composition

See `ARCH_MAP.md` § "Tight coupling / risk areas" for detail.
