# Plan: performance-optimization

## Status
Proposed

Athanor already does the core orchestration work well: stable model ports, detached runtime supervision, router-based model activation, and pi sync. The next performance pass should improve the user's perceived latency and throughput without violating the project's invariants or turning athanor into a speculative caching layer.

This plan is about making athanor faster and more predictable as an orchestrator for MLX and llama.cpp runtimes. The main opportunities are in:
- better observability
- startup warmup / readiness semantics
- runtime tuning defaults and presets
- router-side request profiling
- targeted upstream runtime analysis only where needed

## Problem Statement

Today, athanor can start and supervise models, but it has limited visibility into where time is spent and limited machinery for reducing the most obvious latency spikes:
- `Supervisor.start()` waits for health, not for a model to be meaningfully warmed for first use.
- The router auto-starts idle models on first request, which is convenient but can make first-token latency feel unpredictable.
- Runtime tuning knobs exist for MLX and llama.cpp, but we do not yet have a benchmark-driven basis for default values or recipes by model size / workload shape.
- Metrics are stronger for post-hoc throughput than for startup latency, first-token latency, and repeated-prefix behavior.
- "Prompt caching" is currently a broad idea, but the useful category for athanor is runtime prefix/KV reuse, not application-level response memoization.

## Goals

### Primary
- Make startup and first-request behavior faster and more predictable.
- Add enough observability to benchmark and compare improvements.
- Keep optimization work inside athanor's orchestration boundary before considering upstream patches.
- Preserve existing invariants around ports, registry, pi sync shape, and runtime model ids.

### Secondary
- Improve default presets based on measured behavior, not guesses.
- Separate cold-start, warm-start, first-token, and steady-state throughput in UX and diagnostics.
- Learn enough about MLX and llama.cpp semantics to expose the right knobs and warmup behavior.

### Non-goals
- Do **not** add application-level response caching by default.
- Do **not** redesign athanor into a generalized batch scheduler.
- Do **not** patch MLX or llama.cpp until athanor-level bottlenecks are measured and a concrete upstream gap is identified.
- Do **not** change stable port allocation, router/provider sync shape, or registry mutation discipline.

## Performance Model

Treat local serving performance as four distinct buckets:

1. **Cold start**
   - process spawn
   - runtime init
   - model load / mmap
   - health readiness

2. **First-token latency**
   - router/request handling
   - tokenization / prompt ingest
   - prefill
   - lazy runtime initialization
   - cache miss vs cache hit behavior

3. **Steady-state throughput**
   - decode tok/s
   - concurrency behavior
   - runtime flag effects

4. **Model-switch latency**
   - stop/start churn under `single-active`
   - router-triggered activation of a different model

Each bucket should be measured independently and mapped to different interventions.

## Constraints / Invariants

From `AGENTS.md`, these remain load-bearing during this work:

1. **Stable port per model** stays unchanged.
2. **Atomic registry writes** stay centralized in `src/registry/index.ts`.
3. **Pi sync shape follows `config.router.enabled`** and non-athanor pi entries must round-trip untouched.
4. **Runtime model id must match the launch argument literally**; any warmup/proxy path must use the same model ids callers use.
5. **Pi context metadata reflects effective served context**; performance metadata must not drift from merged config semantics.
6. **Supervisor default policy is `single-active`** unless configured otherwise.
7. **All mutations go through helpers** and app/service paths rather than ad hoc edits.

Working interpretation:
- performance changes should mostly live in `supervisor`, `router`, `adapters`, `presets`, and `app`
- optimization metadata should be additive and optional
- user-visible defaults should come from recipes/presets/config, not hidden magic

## Key Questions

1. What is athanor's current breakdown for startup, warmup, first-token latency, and throughput by runtime?
2. Does health-ready correlate with real readiness for first token on MLX and llama.cpp?
3. What is the safest warmup request that triggers useful initialization without surprising side effects?
4. Which existing runtime flags materially affect:
   - startup latency
   - first-token latency
   - throughput
   - memory use
5. What repeated-prefix patterns actually occur in router traffic, and are they frequent enough to justify cache-oriented defaults?
6. Which optimization opportunities belong in athanor versus upstream runtime behavior?

## Recommendation

Proceed in phases:

### Phase 1 — Instrumentation first
Add metrics so we can observe:
- spawn start -> process spawned
- process spawned -> health ready
- optional warmup start -> warmup complete
- request received -> first byte / first token
- request duration
- live token rate while streaming

### Phase 2 — Cheap athanor-level wins
Implement optional warmup after health check:
- small, safe completion request
- config/preset-controlled
- visible in status/logs

### Phase 3 — Benchmark matrix
Run a controlled matrix across:
- MLX vs llama.cpp
- small/medium/large models
- cold vs warmed starts
- short vs long prompts
- repeated-prefix vs one-off prompts

### Phase 4 — Targeted upstream analysis
Read MLX / llama.cpp source and docs only to answer questions raised by measured results.

### Phase 5 — Productize defaults
Convert findings into:
- better built-in recipes
- runtime-aware defaults
- optional performance modes (interactive / throughput / long-context)

## Candidate Workstreams

### A. Observability
Potential additions:
- instance lifecycle timestamps in supervisor-managed state
- request timing hooks in router
- live token accounting from SSE passthrough
- CLI/TUI surfacing of cold/warm/first-token metrics

Pros:
- unblocks benchmark-driven tuning
- low semantic risk
- useful even if no warmup logic lands immediately

Risks:
- avoid turning state files into noisy append-only logs
- do not persist high-frequency telemetry beyond what the UI/CLI needs

### B. Warmup semantics
Potential additions:
- `warmOnStart` config / preset field
- supervisor post-health warmup hook
- runtime-specific warmup payload builders
- explicit instance states such as `warming`

Pros:
- directly targets the common "first request is slow" complaint
- fits athanor's role as orchestrator

Risks:
- warmup may consume memory / compute that some users do not want
- warmup request must not poison logs or confuse users as a real request
- VLMs may require separate semantics from text-only MLX and llama-server

### C. Runtime tuning defaults
Potential additions:
- benchmark-driven adjustments to existing preset recipes
- model-size-sensitive defaults for MLX and llama.cpp
- guidance in `show` / README for when to favor latency vs throughput

Pros:
- high ROI if defaults are materially suboptimal today
- no new runtime concepts required

Risks:
- defaults that help one workload may hurt another
- keep additive recipes explicit; do not make scans destructive or "smart"

### D. Router profiling and repeated-prefix awareness
Potential additions:
- detect repeated prefix hashes per model
- collect counts for cache-helpful request patterns
- correlate router request shape with model cold/warm state

Pros:
- helps decide if prompt-cache-oriented tuning is worth it
- gives athanor workload-aware visibility that upstream runtimes lack

Risks:
- handle prompts carefully; avoid storing raw sensitive content
- prefer hashes / lengths / counters over body persistence

### E. Targeted upstream runtime analysis
Questions to answer upstream:
- MLX:
  - what exactly does health readiness imply?
  - how does prompt cache behave and when is it allocated?
  - what work is deferred until the first real prompt?
  - how does `decodeConcurrency` trade single-user latency vs throughput?
- llama.cpp / llama-server:
  - which flags most affect first-token latency on Apple Silicon?
  - what cache/session semantics are already available through the server path?
  - what are the startup vs throughput tradeoffs of `parallel`, `batch-size`, and `ubatch-size`?

Pros:
- grounds athanor defaults in actual runtime semantics

Risks:
- easy to over-invest before we know what athanor-level work is needed

## Proposed Milestones

### Milestone 1 — Metrics foundation
- [ ] Trace startup lifecycle in `src/supervisor/index.ts`
- [ ] Trace request lifecycle in `src/router/server.ts`
- [ ] Add live streaming token accounting hook in router passthrough
- [ ] Surface a minimal performance summary in CLI/TUI/status
- [ ] Define where ephemeral vs persisted performance data should live

#### Milestone 1 execution checklist

##### 1. Decide the data model before coding
- [ ] Keep **high-frequency request metrics ephemeral** in process memory where possible.
- [ ] Persist only **small lifecycle summaries** that are useful across TUI/CLI attach-detach boundaries.
- [ ] Avoid writing per-token or per-request append logs into `state.json`.
- [ ] Prefer additive optional fields on runtime state/types so older state files remain valid.

##### 2. Add supervisor lifecycle timing
Files:
- `src/supervisor/index.ts`
- `src/supervisor/state.ts`
- `src/types/index.ts`

Proposed fields on active instance state / status summary:
- [ ] `spawnStartedAt?: number`
- [ ] `spawnedAt?: number`
- [ ] `healthyAt?: number`
- [ ] `warmStartedAt?: number`
- [ ] `warmFinishedAt?: number`
- [ ] `lastRequestAt?: number`
- [ ] `lastFirstTokenLatencyMs?: number`
- [ ] `lastRequestDurationMs?: number`
- [ ] `lastTokPerSec?: number`

Implementation steps:
- [ ] Capture `spawnStartedAt` immediately before `spawn(...)`.
- [ ] Capture `spawnedAt` once the child PID exists.
- [ ] Capture `healthyAt` when `waitForHealthy(...)` succeeds.
- [ ] Ensure persisted state load/save tolerates absent new fields.
- [ ] Keep these fields summary-only; do not accumulate historical arrays in state.

##### 3. Add router request timing hooks
Files:
- `src/router/server.ts`
- `src/supervisor/metrics.ts` or a new focused runtime-metrics helper if needed

Per-request timestamps to capture in memory:
- [ ] `requestStartedAt`
- [ ] `upstreamFetchStartedAt`
- [ ] `upstreamHeadersAt`
- [ ] `firstResponseChunkAt`
- [ ] `requestFinishedAt`

Per-model summary values to update:
- [ ] `lastRequestAt`
- [ ] `lastFirstTokenLatencyMs`
- [ ] `lastRequestDurationMs`
- [ ] rolling/most-recent `lastTokPerSec`

Implementation notes:
- [ ] Measure first-token latency from router receive time to first streamed upstream chunk.
- [ ] For non-streaming responses, use first response body chunk or header arrival as the closest proxy.
- [ ] Keep the router body-inspection behavior compatible with existing model resolution logic.
- [ ] Avoid storing raw prompt text or full request bodies.

##### 4. Add live token accounting in streaming passthrough
Files:
- `src/router/server.ts`
- `src/supervisor/metrics.ts`

Implementation steps:
- [ ] Insert a passthrough transform around `pipeline(Readable.fromWeb(...), res)`.
- [ ] Count SSE `data:` frames or decoded content deltas conservatively.
- [ ] Maintain a per-model in-memory counter/timing window while a stream is active.
- [ ] Expose a helper that returns current live token rate when present.
- [ ] Make `src/supervisor/metrics.ts` prefer live router-derived rate over stale log-derived rate when available.

Guardrails:
- [ ] Be tolerant of malformed/incomplete SSE frames.
- [ ] Never block or significantly buffer the stream just to compute metrics.
- [ ] If token counting is ambiguous for a runtime/version, degrade gracefully rather than inventing numbers.

##### 5. Decide how metrics are surfaced
Files likely affected:
- `src/cli/model-commands.ts`
- `src/cli/system-commands.ts`
- `src/ui/App.tsx`
- any formatting helpers under `src/cli/`

Minimum UX targets:
- [ ] `athanor status` should show whether a model is merely running or has startup timing data.
- [ ] `athanor show <slug>` should be able to surface last-known startup and request summary if available.
- [ ] TUI can start with lightweight summary values only; avoid overloading the first pass.

Suggested first-pass fields to display:
- [ ] cold start to healthy
- [ ] warmup duration (when present later)
- [ ] last first-token latency
- [ ] last tok/s

##### 6. Add tests for metrics plumbing
Likely areas:
- supervisor lifecycle tests
- router proxy tests
- metrics parsing/unit tests

Checklist:
- [ ] Test lifecycle timestamps are written in monotonic order when startup succeeds.
- [ ] Test failed startup does not leave inconsistent timing summaries.
- [ ] Test router request timing updates the target model summary.
- [ ] Test streaming metrics do not break SSE passthrough.
- [ ] Test absence of live token data falls back cleanly to existing log-derived metrics.

##### 7. Define success criteria for Milestone 1
- [ ] We can answer, per model: how long did spawn->healthy take?
- [ ] We can answer, per recent request: what was first-token latency?
- [ ] We can show live or last-known tok/s without waiting only for post-hoc log parsing.
- [ ] We have enough baseline data to judge whether warm-on-start is worth implementing.

### Milestone 2 — Warm-on-start prototype
- [ ] Design config / preset shape for warmup control
- [ ] Implement optional warmup request after health-ready
- [ ] Add instance state / status wording for warming
- [ ] Add tests for success, timeout, and disabled warmup behavior
- [ ] Benchmark whether warmup improves first-token latency on representative models

### Milestone 3 — Benchmark-driven preset review
- [ ] Create a repeatable benchmark script / fixture approach
- [ ] Compare MLX and llama.cpp defaults on a small model matrix
- [ ] Review current recipe defaults against observed results
- [ ] Decide whether to add performance-oriented recipes

### Milestone 4 — Upstream analysis
- [ ] Read relevant MLX serving code/docs end-to-end for warmup/cache semantics
- [ ] Read relevant llama.cpp / llama-server code/docs end-to-end for startup/cache/parallel semantics
- [ ] Capture findings in `context/` for future work
- [ ] Decide whether any missing behavior warrants upstream issues/patches

## Likely Files

Initial likely touch points:
- `src/supervisor/index.ts`
- `src/supervisor/state.ts`
- `src/supervisor/metrics.ts`
- `src/router/server.ts`
- `src/app/models.ts`
- `src/adapters/mlx.ts`
- `src/adapters/llama.ts`
- `src/presets/edit.ts`
- `src/presets/recipes.ts`
- `src/types/index.ts`
- `src/cli/model-commands.ts`
- `src/ui/App.tsx`
- `README.md`
- performance-focused tests

External / upstream reading targets later:
- MLX server docs/source
- llama.cpp `llama-server` docs/source

## Deliverables

By the end of this plan, we should have:
- a benchmarkable definition of cold-start / warm-start / first-token / throughput
- enough instrumentation to compare changes honestly
- a decision on warm-on-start as an opt-in or default behavior
- clearer guidance on prompt-cache-related tuning
- a documented shortlist of upstream runtime findings that matter to athanor

## Notes
- Start with athanor-owned changes before touching upstream runtimes.
- Prefer observability before optimization.
- Keep "prompt caching" narrowly defined as runtime prefix/KV reuse unless the user explicitly asks for response caching.
- Any stored request-derived telemetry should avoid retaining raw prompt content; use aggregates, hashes, sizes, and timings instead.
