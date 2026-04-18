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

export class MlxAdapter implements RuntimeAdapter {
  type: RuntimeType = "mlx"

  buildCommand(entry: ModelEntry, merged: MlxConfig): { cmd: string; args: string[] } {
    const common = [
      "--model", mlxModelArg(entry),
      "--port", String(entry.port),
      "--host", "127.0.0.1"
    ]
    if (entry.mlxFlavor === "vlm") {
      return { cmd: "mlx_vlm.server", args: common }
    }
    return {
      cmd: mlxBinary(entry),
      args: [
        ...common,
        "--prefill-step-size", String(merged.prefillStepSize),
        "--prompt-cache-size", String(merged.promptCacheSize),
        "--decode-concurrency", String(merged.decodeConcurrency)
      ]
    }
  }

  healthUrl(port: number): string {
    return healthUrl("mlx", port)
  }
}
