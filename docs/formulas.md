# Formulas & Model Tuning

In athanor, **formulas** allow you to customize runtime arguments and inference behavior per model without modifying global configuration. 

A formula merges on top of athanor's global runtime defaults (`~/.athanor/config.json`) and survives cache rescans.

---

## CLI Formula Management

Manage formulas directly from the CLI or via the TUI formula editor (press `e` on any highlighted model).

```bash
# Inspect effective runtime configuration and resolved launch command
athanor show qwen-32b

# Set individual fields (supports kebab-case, camelCase, and shorthand aliases)
athanor formula qwen-32b set ctx-size=32768 nGpuLayers=48
athanor formula qwen-32b set cache-type-k=q8_0 flash-attn=on

# Unset specific fields
athanor formula qwen-32b unset ctx-size

# Clear all formula overrides (resets to global defaults)
athanor formula qwen-32b clear

# Apply a named built-in or user formula
athanor formula qwen-32b apply thinking
athanor formula qwen-32b apply q8-kv

# Save a model's current formula tuning to your custom library
athanor formula qwen-32b save my-reasoning-profile

# List all available built-in and user formulas, plus tunable keys per runtime
athanor formulas

# Delete a custom formula from your library
athanor formulas delete my-reasoning-profile
```

*(Note: `athanor preset` and `athanor recipes` remain supported as backward-compatible aliases).*

---

## Built-in Formula Library

Athanor ships with 7 built-in formulas:

| Formula | Description | Key Settings |
|---|---|---|
| `balanced` | Recommended general default | 64K context baseline |
| `fast` | Low-latency chat & quick iterations | 8K context, reduced batch overhead |
| `long-context` | Large documents & extended prompts | 128K context, Q8_0 KV cache on MLX & llama.cpp |
| `q8-kv` | Reduced memory footprint | Quantized Q8_0 KV cache |
| `thinking` | Reasoning model sampling | `temp: 1.0`, `topP: 0.95`, `topK: 20` |
| `instruct` | Standard instruction following | `temp: 0.7`, `topP: 0.80`, `presencePenalty: 1.5` |
| `mtp` | Speculative decoding via Multi-Token Prediction | `spec-type=draft-mtp`, Metal draft layer offloading |

User-defined formulas saved to `~/.athanor/formulas.json` override built-in formulas sharing the same name.

---

## On-Disk Representation

Formulas are stored inside `~/.athanor/models.json` on the model's entry:

```json
{
  "id": "mlx-community/Qwen2.5-32B-Instruct-4bit",
  "slug": "qwen-32b",
  "formula": {
    "runtime": "mlx",
    "mlx": {
      "decodeConcurrency": 1,
      "prefillStepSize": 2048,
      "promptCacheSize": 65536
    }
  }
}
```

Whenever a formula is modified, restart the model (`athanor restart <slug>`) for changes to take effect.

---

## KV Cache Quantization & Flash Attention (`llama.cpp`)

Large context windows (32K–128K+) with default FP16 KV cache can consume 10–30+ GB of memory alone. On Apple Silicon unified memory, this can trigger macOS memory compression, swap thrashing, and collapse throughput from 20+ tok/s down to single digits.

Quantizing the KV cache to `q8_0` (or `q4_0`) roughly halves KV memory consumption while preserving model coherence:

```bash
# Halve KV cache size with Q8_0 and enable Flash Attention
athanor formula qwen-27b set cache-type-k=q8_0 cache-type-v=q8_0 flash-attn=on

# Or apply the built-in recipe
athanor formula qwen-27b apply q8-kv
```

### Available Keys

- `cache-type-k` / `cacheTypeK` / `ctk`: KV cache key data type (`f16`, `q8_0`, `q4_0`, `q4_1`, `iq4_nl`, `q5_0`, `q5_1`, `bf16`, `f32`)
- `cache-type-v` / `cacheTypeV` / `ctv`: KV cache value data type (`f16`, `q8_0`, `q4_0`, etc.)
- `cache-ram` / `cacheRam` / `cram`: Maximum prompt cache memory in MiB (`llama.cpp` defaults to 8192; 2048–4096 is recommended on 36 GB Macs to avoid swap thrashing)
- `flash-attn` / `flashAttn` / `fa`: Flash Attention mode (`on`, `off`, `auto`). **Required** when using quantized KV cache in `llama.cpp`.

---

## Speculative Decoding & MTP (`llama.cpp`)

Recent builds of `llama.cpp` support speculative decoding and Multi-Token Prediction (MTP). On Apple Silicon, this can accelerate generation speed by 1.5–2×.

```bash
# Multi-Token Prediction (MTP) for models with built-in draft heads (e.g. DeepSeek-Coder, Qwen-MTP)
# MTP heads are baked into the model weights, so spec-draft-model is NOT required:
athanor formula deepseek-coder set spec-type=draft-mtp spec-draft-ngl=32

# Traditional speculative decoding using a separate small draft model:
athanor formula llama-3 set spec-type=draft spec-draft-model=~/.models/llama-3-draft.gguf spec-draft-ngl=32
```

### Available Keys

- `spec-type` / `specType`: Speculative decoding type (`draft-mtp`, `draft`, `draft-simple`, `ngram-simple`)
- `spec-draft-model` / `specDraftModel`: Path/repo/file of the separate draft model (not required for `draft-mtp`)
- `spec-draft-ngl` / `specDraftNgl` / `ngl-draft`: Number of draft layers offloaded to Metal (recommended so draft evaluation runs on GPU)
- `spec-draft-n-max` / `specDraftNMax`: Max tokens to draft per step (default: 3)
- `spec-draft-n-min` / `specDraftNMin`: Min tokens to draft per step
- `spec-draft-p-min` / `specDraftPMin`: Min draft confidence threshold (default: 0.00)
- `spec-draft-p-split` / `specDraftPSplit`: Split probability (default: 0.10)

Athanor performs cross-field validation on speculative settings during `athanor show <slug>` and warns of potential issues (e.g. configuring draft options without `spec-type`, or supplying an unused draft model path for `draft-mtp`).

---

## Reasoning Effort (`llama.cpp`)

Models with reasoning/thinking templates (e.g. Qwen3.8-27B) consume a `reasoning_effort` parameter (`xhigh`, `medium`, `low`). Stock templates often default to `xhigh`, which can cause 20+ minute generations and 20,000+ reasoning tokens.

Athanor provides reasoning effort support:

```bash
# Set reasoning effort via formula
athanor formula qwen3.8-27b set reasoning-effort=medium

# Shorthand alias
athanor formula qwen3.8-27b set effort=low
```

### Ingress & Safety Behavior

- **Write-Time Validation:** Rejects invalid effort strings or attempts to configure reasoning effort on unsupported models.
- **Enforced Safe Defaults:** When registering models whose templates default to `xhigh`, athanor automatically configures a formula default of `medium`.
- **Dynamic Proxy Injection:** The ingress server injects the formula's effort default on completions requests when omitted by the client, validates client-supplied overrides, and strips the parameter for unsupported models to prevent crashes in `llama-server`.
