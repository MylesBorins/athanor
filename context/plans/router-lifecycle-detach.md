# Plan: router-lifecycle-detach

## Status
Proposed

Athanor currently starts the router/control API in-process with the main app/TUI entry, which creates an awkward mismatch for pi integration: the OpenAI-compatible ingress endpoint can disappear when the UI exits, even though the user's mental model is "the model is still running, so athanor should still answer." We also recently found a concrete dev-mode footgun where the dev TUI skipped router startup entirely.

This plan covers a distinct lifecycle refactor: make router availability follow **running model state**, not **whether the TUI process happens to be open**.

## Desired UX

Target user flow:
- open athanor
- start a model
- athanor ensures the router is available while one or more models are active
- close athanor UI without breaking pi access
- reopen athanor later to inspect status/logs/stop/switch models
- when the last model stops, the router can stop too

Operational expectations:
- if a model is running, pi should be able to connect
- if a model blue/green switches, the router stays available
- if a model crashes, the router can remain up long enough to return a useful error / keep provider availability coherent
- the TUI is an attach/detach console, not the owner of ingress lifetime

## Constraints / Invariants

These come from `AGENTS.md` and should shape the design:

1. **Stable port per model** remains unchanged. This plan is about router lifetime, not per-model port allocation.
2. **Pi sync shape follows `config.router.enabled`.** When router mode is on, pi sees `athanor-mlx` / `athanor-llama` pointed at the router base URL. That provider shape must remain stable.
3. **Supervisor default policy is `single-active`** unless configured otherwise. Router lifecycle must not fight the supervisor's model policy.
4. **Not a daemon by default.** We should avoid turning athanor into an always-on background service unless the user explicitly chooses that direction.
5. **Atomic registry writes / state helper discipline** still apply if we add router state persistence.

Working interpretation of the above:
- we likely want a **companion service lifecycle**, not a permanent daemon-first architecture
- router lifetime should be tied to "there are active served models" rather than "the TUI is mounted"

## Problem Statement

Today, router startup is coupled to process entrypoints in a way that is convenient for the app process but inconvenient for the user:
- pi provider config may point at the router while the router is absent
- closing the UI can break local provider availability
- dev mode can drift from real serving behavior
- the user's service mental model ("model is running") and athanor's process ownership model ("UI owns router") diverge

## Goals

### Primary
- Keep the router available whenever at least one model is effectively serving.
- Decouple router lifetime from the Ink TUI process.
- Preserve the current router provider shape for pi.
- Preserve athanor's non-daemon-default character as much as practical.

### Secondary
- Make dev mode behavior match real behavior for ingress.
- Make status/debugging clearer when the router is up but models are absent, starting, or crashed.
- Keep headless workflows (`pi` without TUI open) reliable.

### Non-goals
- Do **not** redesign athanor into a general-purpose always-on daemon platform in this pass.
- Do **not** change stable model ports or the router-vs-direct-provider sync contract.
- Do **not** add a public network service beyond the local router/control surfaces already in scope.

## Candidate Designs

### Option A — Detached companion router process (recommended starting point)
When the first model starts:
- ensure a detached router process is running
- persist router PID / endpoint metadata in athanor state
- reuse it while any models remain active
- stop it when the last model stops

Pros:
- best match for desired UX
- TUI becomes attach/detach naturally
- pi connectivity no longer depends on the UI process
- preserves current router API behavior

Cons:
- needs process ownership, reattach, and cleanup logic
- introduces router PID/state management
- needs stale-process detection

### Option B — Headless `serve` owner process
Introduce a command like `athanor serve` that owns router + control API + maybe supervisor coordination, while the TUI attaches separately.

Pros:
- explicit service mode
- cleaner than implicit detached children in some ways

Cons:
- adds a second operating mode users must understand
- still needs process coordination
- may be a larger user-facing concept than we want right now

### Option C — Keep router in-process but spawn a hidden owner from start/stop flows
This is basically a thinner version of Option A where supervisor/start logic forks a detached router if needed.

Pros:
- smaller conceptual shift
- can preserve most current command shapes

Cons:
- can become ad hoc if not backed by explicit state/reattach rules

## Recommendation

Pursue **Option A / C hybrid**:
- model lifecycle actions ensure router availability when needed
- implementation may use a detached athanor-managed router companion process
- headless `athanor router` remains as an explicit tool, but normal model start/stop flows should "just work"

Principle:
> If any model is running, athanor should ensure the router is available. If no models are running, the router may stop.

## Open Design Questions

1. **What owns router start/stop decisions?**
   - supervisor hooks?
   - model start/stop commands?
   - a new lifecycle coordinator module?

2. **Where does router state live?**
   - existing `state.json`?
   - a new router-state file?
   - ephemeral detection only?

3. **What exactly counts as "router should stay up"?**
   - running only?
   - starting + draining + restart transitions too?
   - crash backoff window?

4. **What should happen when the last model stops but pi still has the provider configured?**
   - router exits cleanly; pi receives connection failure until a model is restarted
   - or router stays up and returns a structured "no models active" error

5. **How should router crash recovery work?**
   - auto-restart when athanor notices active models + missing router?
   - detect on TUI/CLI attach?
   - detect during `sync` / `status`?

6. **Does control API follow the same lifecycle as router, or stay tied to the foreground app?**

## Task List

### A. Architecture / design
- [ ] Read the current router, supervisor, and state ownership paths end-to-end.
- [ ] Decide the owner of router lifecycle transitions.
- [ ] Decide whether router state lives in existing supervisor state or separate state.
- [ ] Decide crash recovery / stale PID semantics.
- [ ] Decide whether control API follows router lifecycle or remains separate.

### B. User-visible lifecycle rules
- [ ] Define precise semantics for:
  - [ ] first model start
  - [ ] model restart
  - [ ] blue/green switch under `single-active`
  - [ ] last model stop
  - [ ] model crash while router remains up
  - [ ] reopening TUI after detached router/models already exist
- [ ] Decide what `athanor status` should surface about router state.
- [ ] Decide whether `athanor ls` / `show` should surface router availability explicitly.

### C. Implementation plan
- [ ] Add a small lifecycle coordinator for router ensure/start/stop.
- [ ] Add router process spawn / reattach / stale cleanup logic.
- [ ] Wire model start/stop flows to ensure router-on-when-needed.
- [ ] Ensure router is not shut down merely because the UI exits.
- [ ] Stop router when no active models remain (subject to the decided semantics).
- [ ] Keep explicit `athanor router` command working.
- [ ] Keep dev mode behavior aligned with real serving behavior.

### D. Testing
- [ ] Add tests for router lifecycle policy decisions.
- [ ] Add tests for start-first-model => router ensured.
- [ ] Add tests for stop-last-model => router stops (if that remains the chosen rule).
- [ ] Add tests for UI exit not killing detached router ownership.
- [ ] Add tests for reattach when models are running and router is already present.
- [ ] Add tests for router-mode pi sync remaining stable.

### E. Docs / UX
- [ ] Update README lifecycle description for router mode.
- [ ] Document that pi connectivity follows active model serving state.
- [ ] Decide whether to add a dedicated note about headless usage / reopening the TUI later.

## Likely Files

Initial investigation/implementation will probably touch:
- `src/index.tsx`
- `src/router/server.ts`
- `src/cli/system-commands.ts`
- `src/supervisor/index.ts`
- `src/supervisor/state.ts`
- `src/sync/pi.ts`
- `src/cli/model-commands.ts`
- `src/ui/App.tsx`
- `README.md`
- tests around router/supervisor/sync

## Notes
- We already fixed one symptom (`ATHANOR_DEV_TUI=1` skipping router startup), but that was only a surface mismatch, not the deeper lifecycle issue.
- This plan should stay separate from the search/download plan because it changes app/service ownership semantics, not just TUI/search behavior.
- The desired end state is "TUI as console, router/model as service while active," without accidentally turning athanor into a permanently running daemon by default.
