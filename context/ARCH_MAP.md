# Athanor Architecture Map

Compressed, code-driven architecture context for future work.

## Modules

- **entrypoint** — bootstraps base dirs, dispatches CLI vs TUI, starts optional control API, and reconciles detached router lifecycle
- **config** — home paths, defaults, config load/save, sanitization, effective runtime baselines (now 16K context defaults)
- **types** — shared runtime and registry types
- **registry** — atomic `models.json` CRUD, slug allocation, stable port allocation, shared materialization helpers, duplicate cleanup on load, fit/recommendation inference
- **discovery** — scan HF/local model roots, detect MLX capabilities, ingest into registry, watch for changes
- **pull** — inspect HF repos, download models, materialize pulled entries
- **adapters** — runtime-specific command building, merged config resolution, health probes, runtime model ids
- **presets** — tunable runtime overrides, explicit built-in recipes with context bands, preset editing helpers
- **supervisor** — detached child lifecycle, policy enforcement, reattach, logs, metrics, inflight drain
- **sync** — merge athanor providers into pi-agent files and update defaults
- **router** — optional OpenAI-compatible proxy over published models plus detached lifecycle coordination
- **control** — optional local HTTP API for activate/deactivate/status
- **search** — HF search/trending queries and result formatting
- **app** — thin orchestration layer for model operations + pi sync side effects
- **cli** — command dispatch, domain command modules, pull progress renderer, formatting
- **ui** — Ink TUI components and extracted hooks for data/actions/input/mouse

## Key files per module

- **entrypoint**
  - `src/index.tsx`
- **config**
  - `src/config/index.ts`
- **types**
  - `src/types/index.ts`
- **registry**
  - `src/registry/index.ts`
  - `src/registry/materialize.ts`
  - `src/registry/recommend.ts`
  - `src/registry/display.ts`
- **discovery**
  - `src/discovery/scanner.ts`
  - `src/discovery/ingest.ts`
  - `src/discovery/watcher.ts`
- **pull**
  - `src/pull/hf.ts`
  - `src/pull/download.ts`
- **adapters**
  - `src/adapters/index.ts`
  - `src/adapters/model-id.ts`
  - `src/adapters/mlx.ts`
  - `src/adapters/llama.ts`
  - `src/adapters/health.ts`
- **presets**
  - `src/presets/compound.ts`
  - `src/presets/edit.ts`
  - `src/presets/recipes.ts`
- **supervisor**
  - `src/supervisor/index.ts`
  - `src/supervisor/policies.ts`
  - `src/supervisor/state.ts`
  - `src/supervisor/metrics.ts`
  - `src/supervisor/inflight.ts`
- **sync**
  - `src/sync/pi.ts`
- **router**
  - `src/router/server.ts`
  - `src/router/lifecycle.ts`
- **control**
  - `src/control/server.ts`
- **search**
  - `src/search/hf.ts`
- **app**
  - `src/app/models.ts`
- **cli**
  - `src/cli/index.ts`
  - `src/cli/commands.ts`
  - `src/cli/model-commands.ts`
  - `src/cli/preset-commands.ts`
  - `src/cli/system-commands.ts`
  - `src/cli/pull-renderer.ts`
- **ui**
  - `src/ui/App.tsx`
  - `src/ui/ModelList.tsx`
  - `src/ui/useAppData.ts`
  - `src/ui/useModelActions.ts`
  - `src/ui/useAppInput.ts`
  - `src/ui/useMouseWheel.ts`
  - `src/ui/PresetEditor.tsx`

## Dependency graph

- **entrypoint** → config, discovery, cli, ui, control, router
- **cli** → app, registry, supervisor, presets, adapters, search, config, router, ui/search browser
- **ui** → app, registry, supervisor, discovery watcher, presets, pull suggestions, ui components
- **app** → registry, discovery, pull, supervisor, sync
- **control** → registry, supervisor/app
- **router** → registry, supervisor, adapters, config
- **sync** → registry, config, adapters
- **supervisor** → adapters, config, registry, inflight, state, metrics
- **pull** → discovery scanner capability detection, shared registry materialization, config
- **discovery** → shared registry materialization, config, types
- **adapters** → config, registry/types
- **presets** → types
- **search** → external HF API helpers

## Data flow overview

### Startup
- `src/index.tsx` ensures base dirs
- dispatches to CLI via `src/cli/index.ts`
- if no CLI command handles argv, enters TUI mode
- TUI startup does eager `ingestDiscovered()`, starts the control API when configured, and reconciles detached router state rather than owning router lifetime directly

### Scan / discovery
- `src/discovery/scanner.ts` scans HF cache + local GGUF roots
- detects MLX capabilities via `detectMlxCapabilities()`
- `src/discovery/ingest.ts` maps discovered models into the shared registry materialization path while preserving user-owned fields
- `src/discovery/watcher.ts` re-triggers ingest on filesystem changes

### Pull / materialization
- `src/pull/hf.ts` resolves repo/file/runtime and downloads via `src/pull/download.ts`
- after download, pull materializes/updates a registry entry through shared registry materialization helpers
- pull also refreshes MLX capabilities for pulled MLX repos

### Registry mutation
- registry is persisted in `~/.athanor/models.json`
- atomic writes happen only through `src/registry/index.ts`
- shared entry creation/update policy now lives in `src/registry/materialize.ts`
- semantic mutation helpers now exist for publish/flavor/preset/last-used flows
- app-layer operations wrap many mutations and trigger pi sync

### Start / stop / restart
- CLI/TUI/control call `src/app/models.ts`
- service resolves model entry, calls `src/supervisor/index.ts`
- supervisor applies policy, spawns detached child, health-checks, persists runtime state, reattaches on startup
- router lifecycle is coordinated alongside these flows via `src/router/lifecycle.ts` so router mode follows active model state rather than foreground TUI lifetime
- stop drains router inflight work when needed, terminates pid, updates persisted state

### Pi sync
- `src/sync/pi.ts` reads registry + config and rewrites only `athanor-*` providers in pi files
- pi `/model` lists by runtime model `id`; `name` is advisory and comes from `src/registry/display.ts`
- hub GGUF runtime ids default to registry `author/repo:file.gguf` via `src/adapters/model-id.ts` (custom `piAlias` wins when set)
- pi `contextWindow` now comes from effective merged runtime config (`mergedConfigFor`), so advertised context matches actual launch settings even when a model inherits global defaults
- router off: one provider per published model
- router on: up to two runtime aggregators (`athanor-mlx`, `athanor-llama`)
- when an active model is provided, sync may also set pi `defaultProvider` / `defaultModel`
- most common mutation flows now reach sync through `src/app/models.ts`

### TUI flow
- `src/ui/App.tsx` now mainly composes hooks + layout
- `useAppData()` handles polling, watcher updates, system/instance stats; instance polling now comes from persisted live state rather than only the local process's supervisor map so router-driven switches remain visible
- `useModelActions()` handles start/stop/restart/expose/delete/rescan actions
- `useAppInput()` handles keyboard routing
- `useMouseWheel()` handles raw mouse protocol and scroll routing

## Tight coupling / risk areas

- **sync side effects still centralized by convention, not events**
  - much better after `src/app/models.ts`, but still not event-driven
  - future mutation paths can still bypass the service layer if not careful

- **supervisor and registry remain directly coupled**
  - supervisor touches registry metadata (`lastUsedAt`)
  - acceptable, but a lifecycle event boundary would be cleaner

- **router/request handling is pragmatic, not fully streaming-end-to-end**
  - request bodies are parsed into memory before proxying
  - fine today, but limits future opaque passthrough behavior

- **App shell still owns layout/mode composition**
  - much improved, but remaining complexity lives in screen composition and layout math

## Load-bearing invariants

- stable port per model after first allocation
- pi must advertise effective served context, not theoretical model max or only explicit preset fields
- atomic registry writes only
- preserve non-athanor pi providers/settings keys
- pi sync shape must follow `config.router.enabled`
- pi model id must match the runtime launch model id literally
- MLX capability detection and MLX flavor are separate concepts
- scans are non-destructive to user intent fields
- mutations should go through helpers/service-layer paths, not ad hoc object edits
