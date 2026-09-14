# Plan: ingress-default-refactor

## Status
Proposed

Athanor's current distinction between "router mode" and "direct per-model pi providers" has become a product and UX liability. The user's desired mental model is simpler:
- athanor provides a general ingress for pi by default
- pi can select any exposed model behind that ingress
- athanor starts the target model on request
- ingress lifetime follows usefulness, not whether the TUI process happens to still be open

The deeper user-facing control is not router-vs-direct mode, but **how many models are allowed to remain resident in parallel** (`single-active`, `multi-active-lru`, `manual`).

This plan refactors athanor so ingress is the default/normal integration surface, while concurrency policy remains the real user-facing runtime behavior knob.

## Related follow-up TODOs

- [ ] Slug generation for llama / GGUF entries should include enough repo/source identity by default. Today some llama model slugs do not include the repo name, which makes the registry and pi surface ambiguous. Add a follow-up pass to review slug derivation for pulled/scanned GGUF models and prefer source-aware defaults where safe.

## Problem Statement

Today athanor exposes two mutually exclusive pi sync shapes:
- router off => per-model providers (`athanor-mlx-<slug>`, `athanor-llama-<slug>`)
- router on => runtime aggregators (`athanor-mlx`, `athanor-llama`)

That split creates confusing behavior:
- pi sometimes has a general ingress and sometimes does not
- auto-start-on-request works only when the router shape is active
- users can accidentally lose the expected ingress behavior by config drift
- "router mode" becomes a surprising product concept instead of invisible infrastructure

We already know from user feedback that the expected behavior is:
- open athanor
- pi can use a general ingress
- close athanor and keep ingress if a model is still serving
- only lose ingress when nothing remains active

## Goals

### Primary
- Make ingress-backed pi integration the default behavior.
- Treat ingress as infrastructure, not a user-facing mode.
- Keep ingress available while useful and stop it when truly idle.
- Preserve stable per-model ports internally.
- Keep concurrency/residency policy as the main user-facing runtime control.

### Secondary
- Reduce documentation and UX references to "router mode".
- Make status/config surfaces reflect ingress lifecycle more clearly.
- Keep a direct-per-model sync shape only as an advanced/fallback path if we decide to retain it.

### Non-goals
- Do **not** remove stable model ports.
- Do **not** change registry atomicity or pi preservation invariants.
- Do **not** redesign supervisor policies in this pass; only reframe them as the real knob.
- Do **not** patch upstream MLX/llama runtimes as part of this refactor.

## Invariants to preserve

From `AGENTS.md`:

1. **Stable port per model** stays unchanged.
2. **Atomic registry writes** remain centralized.
3. **Preserve non-athanor pi entries** untouched.
4. **Pi sync shape follows config.router.enabled** is the current invariant, but this plan's intention is to make the ingress-backed shape the default by making router enabled by default. If we later remove the distinction entirely, that would require an explicit invariant update.
5. **Runtime model id matches launch argument literally** remains unchanged.
6. **Pi context metadata reflects effective served context** remains unchanged.
7. **Supervisor default policy is `single-active`** remains unchanged.
8. **All mutations go through helpers/service paths** remains unchanged.

## Desired semantics

### Ingress lifecycle
- Opening athanor should ensure ingress availability under the default config.
- If the TUI exits and active models remain, the detached ingress companion should remain up.
- If the TUI exits and no models remain active, ingress may stop.
- Starting a model explicitly should ensure ingress exists.
- Stopping the last model should stop ingress.
- Reopening the TUI should reattach/reconcile state, not become ingress owner.

### Pi sync / provider shape
Default behavior:
- pi sees ingress-backed providers (`athanor-mlx`, `athanor-llama`) by default
- model switching happens by selecting a different `model` behind the same provider
- athanor auto-starts the requested model on demand

Fallback / advanced behavior (if retained):
- direct provider-per-model sync only when explicitly configured

### User-facing control
The main runtime control users should reason about is:
- `single-active`
- `multi-active-lru`
- `manual`

Not:
- "router mode on/off"

## Open design questions

1. Should ingress be ensured whenever the TUI is open, even with zero active models?
   - Current leaning: yes while foreground UI is open; stop on exit if no active models remain.
2. Do we keep direct per-model pi sync at all?
   - Leaning: keep as advanced compatibility path for now, but not the default.
3. Should the `router` config section be renamed later to `ingress`?
   - Leaning: not in the first pass if that creates noisy churn; user-facing wording can shift first.
4. Should `athanor router` CLI command remain named `router`?
   - Likely yes for backward compatibility in this pass, with docs describing it as the foreground ingress server command.

## Implementation plan

### A. Establish default ingress semantics
- [ ] Change default config so ingress/router is enabled by default.
- [ ] Update README/config examples to match.
- [ ] Update config tests for the new default.

### B. Normalize lifecycle ownership around ingress
- [ ] Refactor `src/router/lifecycle.ts` so ingress can be ensured independently of active-model count when appropriate.
- [ ] Keep detached companion semantics for background continuity.
- [ ] Ensure TUI exit no longer tears down ingress unconditionally.
- [ ] Keep stop-last-model => stop ingress behavior.
- [ ] Reconcile detached ingress state on startup/reattach.

### C. Reframe app-layer orchestration
- [ ] Update `src/app/models.ts` to call ingress lifecycle helpers with the new semantics.
- [ ] Ensure explicit start/restart operations always ensure ingress.
- [ ] Ensure stop/stop-all only tear ingress down when idle.

### D. Rework sync expectations around ingress-default
- [ ] Make sync tests treat ingress-backed providers as the default shape.
- [ ] Move per-model provider expectations behind explicit `router.enabled: false` mocks if we keep that path.
- [ ] Verify defaultProvider/defaultModel behavior under ingress-backed providers.

### E. Update tests and mocks
- [ ] Update router lifecycle tests to match ingress semantics and new helper names.
- [ ] Update app tests mocking lifecycle helpers (`ensureIngress`, `stopIngressIfIdle`, `reconcileIngressForCurrentState`).
- [ ] Run full `tsc` and test suite green.

### F. UX / docs cleanup
- [ ] Reduce user-facing references to "router mode" in README/help text.
- [ ] Reframe docs around "ingress" and supervisor policy.
- [ ] Decide whether CLI help should continue saying `router` or describe it as ingress.

### G. State drift recovery / reconciliation
- [ ] Add startup/attach reconciliation that trusts persisted instance state first, then probes stable model ports to recover live runtimes whose JSON state drifted.
- [ ] Add ingress request-path reconciliation before rejecting a request for a model that appears absent or inconsistent.
- [ ] Add pre-shutdown reconciliation before tearing down ingress, so athanor does not stop ingress while a live model is still serving on its stable port.
- [ ] Decide the recovered instance shape when PID is unknown (e.g. optional PID, sentinel PID, or follow-up process lookup by port).
- [ ] Add tests for crash/restart drift where a model is live on its stable port but missing from persisted instance state.

### H. Follow-up work after ingress-default lands
- [ ] Decide whether to keep or eventually remove direct per-model provider sync.
- [ ] Evaluate renaming config/docs from `router` to `ingress` in a compatibility-safe way.
- [ ] Review slug generation for llama / GGUF models so repo/source identity is preserved by default.

## Likely files

- `src/config/index.ts`
- `src/config/index.test.ts`
- `src/router/lifecycle.ts`
- `src/router/lifecycle.test.ts`
- `src/router/server.ts`
- `src/app/models.ts`
- `src/app/models.test.ts`
- `src/index.tsx`
- `src/sync/pi.ts`
- `src/sync/pi.test.ts`
- `src/cli/system-commands.ts`
- `src/cli/index.ts`
- `README.md`

## Execution order recommendation

1. **Lock default config + lifecycle semantics**
2. **Fix app/lifecycle mocks and tests**
3. **Rewrite pi sync tests around ingress-default**
4. **Run full validation (`tsc`, tests)**
5. **Do docs cleanup**
6. **Open follow-up for llama slug/source-aware naming**

## Success criteria

- Fresh/default athanor install gives pi a general ingress by default.
- pi can auto-start exposed models on request without manual provider juggling.
- Closing the TUI does not break ingress if active models remain.
- Closing the TUI with no active models leaves no unnecessary background ingress.
- Tests and docs reflect ingress as default infrastructure and supervisor policy as the real behavior knob.
