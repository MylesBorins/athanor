import type {
  LlamaConfig,
  ModelEntry,
  RuntimeAdapter,
  RuntimeType
} from "../types/index.js"
import { healthUrl } from "./health.js"

export class LlamaAdapter implements RuntimeAdapter {
  type: RuntimeType = "llama.cpp"

  buildCommand(entry: ModelEntry, merged: LlamaConfig): { cmd: string; args: string[] } {
    const alias = entry.piAlias ?? entry.slug
    return {
      cmd: "llama-server",
      args: [
        "-m", entry.path,
        // Sets the `id` llama-server advertises at GET /v1/models and
        // the one callers should put in request `model` fields.
        "--alias", alias,
        "--port", String(entry.port),
        "--host", "127.0.0.1",
        "--n-gpu-layers", String(merged.nGpuLayers),
        "--threads", String(merged.threads),
        "--ctx-size", String(merged.ctxSize),
        "--batch-size", String(merged.batchSize),
        "--ubatch-size", String(merged.ubatchSize),
        "--parallel", String(merged.parallel)
      ]
    }
  }

  healthUrl(port: number): string {
    return healthUrl("llama.cpp", port)
  }
}
