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

    if (merged.promptCacheSize > merged.contextWindow) {
      console.warn(
        `promptCacheSize (${merged.promptCacheSize}) exceeds contextWindow (${merged.contextWindow}); may reduce cache efficiency`
      )
    }

    return {
      cmd: mlxBinary(entry),
      args: [
        ...common,
        "--max-tokens", String(merged.contextWindow),
        "--prefill-step-size", String(merged.prefillStepSize),
        "--prompt-cache-size", String(merged.promptCacheSize),
        "--decode-concurrency", String(merged.decodeConcurrency),
        ...(merged.promptCacheBytes > 0
          ? ["--prompt-cache-bytes", String(merged.promptCacheBytes)]
          : [])
      ],
      env: MLX_OFFLINE_ENV
    }
  }

  healthUrl(port: number): string {
    return healthUrl("mlx", port)
  }
}
