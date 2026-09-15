# Plan: recommendation-calibration

## Status
Completed

## Context
Athanor predicts memory footprint and runtime fit bands (`comfortable`, `tight`, `risky`) in `src/registry/recommend.ts` using heuristics adapted from `whichllm`. These heuristics determine:
- Whether a model is safe to run on a user's machine given unified memory constraints.
- Warning thresholds in `buildStartPreflight` during CLI/TUI start operations.
- Starter suggestions for new users when the registry is empty.
- Recommended context windows and formula hints.

## Problem Statement
The current VRAM estimation constants use fixed empirical values:
- `KV_BYTES_PER_BPARAM_PER_KCTX = 3.5 MB` (FP16 KV tensors per billion active parameters per 1K context).
- `MOE_ATTENTION_PARAM_MULTIPLIER = 4.0`.
- `FRAMEWORK_OVERHEAD_BYTES = 500 MB`.
- Quantized weight bytes-per-parameter estimates: 4-bit (~0.5 B/param), 8-bit (~1.0 B/param), 16-bit (~2.0 B/param).

While effective for standard dense models, several calibration areas need refinement:
1. **GQA / MQA Attention Scalings**: Models utilizing Grouped-Query Attention (GQA) reduce KV-cache footprints significantly (e.g. 8:1 ratio in Llama 3 / Qwen 2.5), which currently overestimates memory requirements for high-context workloads.
2. **MoE Active vs Total Parameters**: MoE models (e.g. Mixtral, DeepSeek-V2/V3, Qwen-MoE) have total weights loaded in memory, but only route a subset of active parameters per token during forward pass attention.
3. **Hardware Tiers**: Apple Silicon unified memory bands (8GB, 16GB, 24GB, 36GB, 48GB, 64GB, 96GB, 128GB+) share memory between macOS OS buffers, display buffers, and unified GPU allocations.

## Goals
- Add test suites covering calibration fixtures across popular model architectures (Dense 7B/8B/14B/32B/70B, MoE architectures, varying GQA ratios).
- Account for GQA/KV-cache tensor dimensions when available in model metadata or architecture config.
- Calibrate preflight thresholds against real `vm_stat` active/wired memory behavior.
- Ensure all invariants from `AGENTS.md` are preserved.

## Proposed Changes
- `src/registry/recommend.ts`:
  - Enhance `estimateParamCount` and `calculateKvCacheBytes` to inspect GQA head counts when present.
  - Refine MoE weight footprint (total weights in VRAM) vs KV-cache active attention footprint.
- `src/registry/recommend.test.ts`:
  - Add parameterized benchmark fixtures matching Hugging Face community quant sizes.
