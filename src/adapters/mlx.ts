import type {
  MlxConfig,
  ModelEntry,
  RuntimeAdapter,
  RuntimeType
} from "../types/index.js"
import { healthUrl } from "./health.js"

// For HF-sourced MLX models we pass the repo id (e.g.
// "mlx-community/Qwen3-32B-4bit") so mlx_lm.server's stored
// `model_key` matches exactly what callers put in the OpenAI
// `model` field. mlx_lm resolves the repo id from the local HF
// cache; no network call when the snapshot is already present.
// For local-only models the filesystem path is used.
function mlxModelArg(entry: ModelEntry): string {
  return entry.source.type === "hf" ? entry.source.repo : entry.path
}

// mlx_vlm.server shares the --model/--port/--host surface of
// mlx_lm.server but does not accept the lm-specific decode-concurrency
// / prompt-cache / prefill-step flags. Keeping both command shapes
// behind buildCommand avoids leaking that asymmetry to the supervisor.
function mlxBinary(entry: ModelEntry): string {
  return entry.mlxFlavor === "vlm" ? "mlx_vlm.server" : "mlx_lm.server"
}

// huggingface_hub re-resolves the snapshot on every launch by default,
// which means mlx_lm.server / mlx_vlm.server hit the network at startup
// even when the model is fully cached. HF_HUB_OFFLINE short-circuits
// that path; TRANSFORMERS_OFFLINE does the same for the transformers
// processors mlx_vlm imports. Athanor owns the download lifecycle via
// `athanor pull`, so the runtime should never reach out on its own.
const MLX_OFFLINE_ENV: Record<string, string> = {
  HF_HUB_OFFLINE: "1",
  TRANSFORMERS_OFFLINE: "1"
}

export class MlxAdapter implements RuntimeAdapter {
  type: RuntimeType = "mlx"

  buildCommand(
    entry: ModelEntry,
    merged: MlxConfig
  ): { cmd: string; args: string[]; env: Record<string, string> } {
    const common = [
      "--model", mlxModelArg(entry),
      "--port", String(entry.port),
      "--host", "127.0.0.1"
    ]

    if (entry.mlxFlavor === "vlm") {
      // mlx_vlm.server does not accept lm-only tuning flags.
      return { cmd: "mlx_vlm.server", args: common, env: MLX_OFFLINE_ENV }
    }

    // contextWindow is advertised to pi-agent (invariant #6) but
    // mlx_lm.server has no context-window flag — the model's KV cache
    // ceiling is baked into its weights. Do not pass contextWindow here.

    // Only emit sampling flags when non-default to keep the command
    // clean. Defaults here must match mlx-lm's CLI defaults:
    //   temp=0, topP=1, topK=0, minP=0, promptConcurrency=8
    // If any of these drift, the flag will be emitted unnecessarily
    // (harmless) but the suppression pattern breaks.
    const extra: string[] = []
    if (merged.temp !== 0) extra.push("--temp", String(merged.temp))
    if (merged.topP !== 1) extra.push("--top-p", String(merged.topP))
    if (merged.topK !== 0) extra.push("--top-k", String(merged.topK))
    if (merged.minP !== 0) extra.push("--min-p", String(merged.minP))
    if (merged.promptConcurrency !== 8) extra.push("--prompt-concurrency", String(merged.promptConcurrency))

    return {
      cmd: mlxBinary(entry),
      args: [
        ...common,
        "--max-tokens", String(merged.maxTokens),
        "--prefill-step-size", String(merged.prefillStepSize),
        "--prompt-cache-size", String(merged.promptCacheSize),
        "--decode-concurrency", String(merged.decodeConcurrency),
        ...(merged.promptCacheBytes > 0
          ? ["--prompt-cache-bytes", String(merged.promptCacheBytes)]
          : []),
        ...extra
      ],
      env: MLX_OFFLINE_ENV
    }
  }

  healthUrl(port: number): string {
    return healthUrl("mlx", port)
  }
}
