import type {
  LlamaConfig,
  ModelEntry,
  RuntimeAdapter,
  RuntimeType
} from "../types/index.js"
import { healthUrl } from "./health.js"
import { runtimeModelId } from "./model-id.js"

export class LlamaAdapter implements RuntimeAdapter {
  type: RuntimeType = "llama.cpp"

  buildCommand(entry: ModelEntry, merged: LlamaConfig): { cmd: string; args: string[] } {
    const alias = runtimeModelId(entry)
    const args = [
      "-m", entry.path,
      // Sets the `id` llama-server advertises at GET /v1/models and
      // the one callers should put in request `model` fields.
      "--alias", alias,
      "--port", String(entry.port),
      "--host", "127.0.0.1",
      "--n-gpu-layers", String(merged.nGpuLayers),
      "--ctx-size", String(merged.ctxSize),
      "--batch-size", String(merged.batchSize),
      "--ubatch-size", String(merged.ubatchSize),
      "--parallel", String(merged.parallel)
    ]

    if (merged.specType !== undefined) {
      args.push("--spec-type", merged.specType)
    }
    if (merged.specDraftNMax !== undefined) {
      args.push("--spec-draft-n-max", String(merged.specDraftNMax))
    }
    if (merged.specDraftNMin !== undefined) {
      args.push("--spec-draft-n-min", String(merged.specDraftNMin))
    }
    if (merged.specDraftPSplit !== undefined) {
      args.push("--spec-draft-p-split", String(merged.specDraftPSplit))
    }
    if (merged.specDraftPMin !== undefined) {
      args.push("--spec-draft-p-min", String(merged.specDraftPMin))
    }
    if (merged.specDraftModel !== undefined) {
      args.push("--spec-draft-model", merged.specDraftModel)
    }
    if (merged.specDraftNgl !== undefined) {
      args.push("--spec-draft-ngl", String(merged.specDraftNgl))
    }

    return {
      cmd: "llama-server",
      args
    }
  }

  healthUrl(port: number): string {
    return healthUrl("llama.cpp", port)
  }
}
