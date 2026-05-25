# Surface mlx_lm.server sampling controls in athanor

## Background

Claude (and other LLM-based agents) suggest tuning sampling parameters like `repetition_penalty`, `min_p`, and `temperature` to improve generation quality. Athanor currently only exposes **infrastructure-level** server flags (context window, cache sizes, concurrency). It has **zero sampling parameter support**.

After reading the [mlx_lm server source](file:///Users/mylesborins/code/mlx-lm/mlx_lm/server.py), here's the full picture.

## Current state

### What athanor passes to `mlx_lm.server` today

From [mlx.ts](file:///Users/mylesborins/code/athanor/src/adapters/mlx.ts#L62-L75):

| Athanor preset key | CLI flag passed | mlx_lm.server meaning |
|---|---|---|
| `contextWindow` | `--max-tokens` | **Default generation limit** (NOT context window — see bug below) |
| `prefillStepSize` | `--prefill-step-size` | Prompt prefill chunk size |
| `promptCacheSize` | `--prompt-cache-size` | Max distinct KV caches in prompt cache |
| `decodeConcurrency` | `--decode-concurrency` | Parallel decode slots |
| `promptCacheBytes` | `--prompt-cache-bytes` | GPU prompt cache memory cap |

### What mlx_lm.server actually supports

#### CLI flags (server defaults — request values override)

| Flag | Type | Default | Athanor passes? |
|---|---|---|---|
| `--model` | str | required | ✅ |
| `--host` | str | `127.0.0.1` | ✅ |
| `--port` | int | `8080` | ✅ |
| `--max-tokens` | int | `512` | ✅ (as contextWindow — **wrong semantics, see below**) |
| `--prefill-step-size` | int | `2048` | ✅ |
| `--prompt-cache-size` | int | `10` | ✅ |
| `--prompt-cache-bytes` | size | `None` | ✅ |
| `--decode-concurrency` | int | `32` | ✅ |
| `--prompt-concurrency` | int | `8` | ❌ new |
| `--temp` | float | `0.0` | ❌ **missing** |
| `--top-p` | float | `1.0` | ❌ **missing** |
| `--top-k` | int | `0` | ❌ **missing** |
| `--min-p` | float | `0.0` | ❌ **missing** |
| `--trust-remote-code` | flag | false | ❌ (was in old code, not currently passed) |
| `--chat-template` | str | `""` | ❌ (was in old code, not currently passed) |
| `--use-default-chat-template` | flag | false | ❌ (was in old code, not currently passed) |
| `--chat-template-args` | JSON | `{}` | ❌ new |
| `--adapter-path` | str | None | ❌ (not relevant yet) |
| `--draft-model` | str | None | ❌ (speculative decoding) |
| `--num-draft-tokens` | int | `3` | ❌ (speculative decoding) |
| `--pipeline` | flag | false | ❌ (multi-GPU) |

#### Per-request body parameters (no CLI flag equivalent)

These can ONLY be set per-request in the JSON body. `temperature`, `top_p`, `top_k`, and `min_p` **fall back to CLI defaults** when not in the request body. The rest use hardcoded defaults:

| Parameter | Default | Falls back to CLI? | Notes |
|---|---|---|---|
| `temperature` | `0.0` | ✅ `--temp` | |
| `top_p` | `1.0` | ✅ `--top-p` | |
| `top_k` | `0` | ✅ `--top-k` | |
| `min_p` | `0.0` | ✅ `--min-p` | |
| `repetition_penalty` | `0.0` | ❌ hardcoded | >1.0 discourages repetition |
| `repetition_context_size` | `20` | ❌ hardcoded | |
| `presence_penalty` | `0.0` | ❌ hardcoded | |
| `presence_context_size` | `20` | ❌ hardcoded | |
| `frequency_penalty` | `0.0` | ❌ hardcoded | |
| `frequency_context_size` | `20` | ❌ hardcoded | |
| `xtc_probability` | `0.0` | ❌ hardcoded | Newer XTC sampling |
| `xtc_threshold` | `0.0` | ❌ hardcoded | |
| `logit_bias` | `None` | ❌ hardcoded | |
| `seed` | `None` | ❌ hardcoded | |

## User Review Required

> [!WARNING]
> **`--max-tokens` semantics mismatch.** Athanor passes `contextWindow` (default 32768) as `--max-tokens`. But in `mlx_lm.server`, `--max-tokens` is the **default generation limit per request** (default 512), not the KV cache / context window size. There is no `--context-size` or `--max-kv-size` flag in the current mlx_lm server — the KV cache is unbounded (limited only by `--prompt-cache-bytes` and available memory). This means athanor is effectively setting the default generation limit to 32768 tokens, which is harmless (clients like pi-agent send their own `max_tokens` per-request), but the internal naming `contextWindow → --max-tokens` is misleading. This was probably correct in an older version of mlx-lm that had a `--max-kv-size` flag but that flag no longer exists.

> [!IMPORTANT]
> **Two-tier parameter architecture.** Sampling parameters split into two categories:
> 1. **CLI-defaultable** (`temperature`, `top_p`, `top_k`, `min_p`) — these have CLI flags, so athanor can set server-wide defaults via command line. Per-request values from the client override them.
> 2. **Request-only** (`repetition_penalty`, `presence_penalty`, `frequency_penalty`, etc.) — no CLI flags exist. To inject these, athanor's **router** would need to modify request bodies before proxying, or the client (pi-agent) would need to send them.

## Open Questions

1. **How much do you want to own here?** Options range from "just pass the 4 CLI-defaultable sampling params" (minimal, clean) to "have the router inject sampling defaults into proxied requests" (much more complex, crosses the opaque-proxy boundary).

2. **Should the `--max-tokens` mapping be fixed?** We could either:
   - Rename `contextWindow` → something more accurate (breaking preset compat)
   - Accept the current behavior (it works because clients send per-request `max_tokens`)
   - Note: mlx-lm previously had `--max-kv-size` which **was** the context window. It has been removed in favor of unbounded KV with memory-based limits via `--prompt-cache-bytes`.

3. **Should `chat-template-args` be surfaceable?** It's new and useful — `'{"enable_thinking":false}'` can toggle extended thinking for models like Qwen3. This is a string (JSON), not numeric, so the `KeySpec` parser would need extending.

4. **Do you want the `prompt-concurrency` flag?** It's new (controls how many prompts can be prefilled in parallel, separate from decode concurrency). Relevant for multi-request workloads.

## Proposed Changes

### Tier 1 — CLI-defaultable sampling params (recommended)

These are clean: add them to the preset system, pass them as CLI flags, and the server uses them as defaults that per-request values can override. No router changes needed.

#### [MODIFY] [index.ts](file:///Users/mylesborins/code/athanor/src/types/index.ts)

Add to `MlxConfig`:
```typescript
temp: number           // --temp default (0.0)
topP: number           // --top-p default (1.0)
topK: number           // --top-k default (0)
minP: number           // --min-p default (0.0)
promptConcurrency: number  // --prompt-concurrency default (8)
```

#### [MODIFY] [edit.ts](file:///Users/mylesborins/code/athanor/src/presets/edit.ts)

Add 5 new entries to `KEYS[]`:
- `temp` / `temperature` → `temp` (float parser needed)
- `top-p` → `topP` (float parser)
- `top-k` → `topK` (int parser)
- `min-p` → `minP` (float parser)
- `prompt-concurrency` → `promptConcurrency` (int parser)

Will also need a float parser alongside the existing `num()`.

#### [MODIFY] [mlx.ts](file:///Users/mylesborins/code/athanor/src/adapters/mlx.ts)

Add to `buildMlxCommand()` args:
```
--temp <merged.temp>
--top-p <merged.topP>
--top-k <merged.topK>
--min-p <merged.minP>
--prompt-concurrency <merged.promptConcurrency>
```

Only emit when non-default (temp≠0, topP≠1, topK≠0, minP≠0) to keep the command clean.

#### [MODIFY] [index.ts](file:///Users/mylesborins/code/athanor/src/config/index.ts)

Add defaults to `DEFAULT_CONFIG.mlx`:
```typescript
temp: 0,
topP: 1,
topK: 0,
minP: 0,
promptConcurrency: 8,
```

#### [MODIFY] [recipes.ts](file:///Users/mylesborins/code/athanor/src/presets/recipes.ts)

Optionally add sampling defaults to recipes. For example, `quality` could set `minP: 0.05` and `temp: 0.7`.

---

### Tier 2 — Router-injected defaults (optional, more complex)

For parameters like `repetition_penalty` that have **no CLI flag**, the only way to set server-wide defaults is to modify request bodies in the router proxy. This would:

1. Add new "sampling default" fields to config/preset
2. In [server.ts](file:///Users/mylesborins/code/athanor/src/router/server.ts) `proxy()`, parse the request JSON, inject any configured defaults for missing fields, re-serialize, and forward

> [!WARNING]
> This crosses the "opaque proxy" boundary — the router currently forwards request bodies untouched. Adding mutation here is a design decision that affects debugging (the upstream sees different JSON than the client sent).

Deferring this tier is fine — clients like pi-agent can send `repetition_penalty` per-request if they support it.

---

### Tier 3 — Additional CLI flags (optional, low complexity)

Also surfaceable but lower priority:
- `chat-template-args` (JSON string — needs string parser support in `KeySpec`)
- `trust-remote-code` (boolean — needs bool parser)
- `chat-template` (string — needs string parser)
- `log-level` (string — debug vs info)

These require extending the `KeySpec.parse` system from numeric-only to support strings/booleans.

## Verification Plan

### Automated Tests
- `npx tsc --noEmit` — type-check clean
- `npm run test:run` — all tests green
- Verify `buildMlxCommand()` output includes new flags via existing adapter test fixtures

### Manual Verification
- `athanor preset set <slug> temp=0.5 min-p=0.05` → verify `athanor show <slug>` displays them
- `athanor start <slug>` → verify the spawned process command includes `--temp 0.5 --min-p 0.05`
- `curl localhost:<port>/v1/chat/completions -d '{"messages":[...]}' ` → verify server uses the preset defaults
- `curl localhost:<port>/v1/chat/completions -d '{"messages":[...], "temperature": 0.9}'` → verify per-request override still works
