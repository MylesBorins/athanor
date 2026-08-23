import { describe, it, expect, beforeEach } from "vitest"
import { MlxAdapter } from "./mlx.js"
import type { MlxConfig } from "../types/index.js"
import { mlxEntry } from "./__fixtures.js"

const mlx: MlxConfig = {
  prefillStepSize: 256,
  promptCacheSize: 1024,
  decodeConcurrency: 1,
  contextWindow: 4096,
  maxTokens: 512,
  promptCacheBytes: 0,
  temp: 0,
  topP: 1,
  topK: 0,
  minP: 0,
  promptConcurrency: 8
}

describe("MlxAdapter", () => {
  let adapter: MlxAdapter
  beforeEach(() => { adapter = new MlxAdapter() })

  it("passes the HF repo id to --model for HF-sourced models", () => {
    const entry = mlxEntry({
      path: "/cache/snapshots/abc123",
      port: 8090,
      source: { type: "hf", repo: "mlx-community/Qwen3-32B-4bit" }
    })
    const { cmd, args } = adapter.buildCommand(entry, mlx)
    expect(cmd).toBe("mlx_lm.server")
    expect(args).toEqual([
      "--model", "mlx-community/Qwen3-32B-4bit",
      "--port", "8090",
      "--host", "127.0.0.1",
      "--max-tokens", "512",
      "--prefill-step-size", "256",
      "--prompt-cache-size", "1024",
      "--decode-concurrency", "1"
    ])
  })

  it("sets HF_HUB_OFFLINE and TRANSFORMERS_OFFLINE so the runtime never re-pulls", () => {
    const lm  = adapter.buildCommand(mlxEntry({ mlxFlavor: "lm"  }), mlx)
    const vlm = adapter.buildCommand(mlxEntry({ mlxFlavor: "vlm" }), mlx)
    expect(lm.env).toEqual({ HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" })
    expect(vlm.env).toEqual({ HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" })
  })

  it("passes the filesystem path to --model for local-only models", () => {
    const entry = mlxEntry({
      path: "/models/local-mlx",
      port: 8090,
      source: { type: "local" }
    })
    const { args } = adapter.buildCommand(entry, mlx)
    const i = args.indexOf("--model")
    expect(args[i + 1]).toBe("/models/local-mlx")
  })

  it("returns the mlx health url", () => {
    expect(adapter.healthUrl(9000)).toBe("http://127.0.0.1:9000/v1/models")
  })

  it("routes lm-flavor models to mlx_lm.server with tuning flags", () => {
    const entry = mlxEntry({ mlxFlavor: "lm" })
    const { cmd, args } = adapter.buildCommand(entry, mlx)
    expect(cmd).toBe("mlx_lm.server")
    expect(args).toContain("--prefill-step-size")
    expect(args).toContain("--decode-concurrency")
  })

  it("routes vlm-flavor models to mlx_vlm.server without lm-only flags", () => {
    const entry = mlxEntry({
      port: 8099,
      source: { type: "hf", repo: "mlx-community/Qwen2.5-VL-7B-Instruct-4bit" },
      mlxFlavor: "vlm"
    })
    const { cmd, args } = adapter.buildCommand(entry, mlx)
    expect(cmd).toBe("mlx_vlm.server")
    expect(args).toEqual([
      "--model", "mlx-community/Qwen2.5-VL-7B-Instruct-4bit",
      "--port", "8099",
      "--host", "127.0.0.1"
    ])
    expect(args).not.toContain("--prefill-step-size")
    expect(args).not.toContain("--prompt-cache-size")
    expect(args).not.toContain("--decode-concurrency")
  })

  it("defaults to mlx_lm.server when mlxFlavor is absent (backwards compat)", () => {
    const entry = mlxEntry()
    expect(entry.mlxFlavor).toBeUndefined()
    const { cmd } = adapter.buildCommand(entry, mlx)
    expect(cmd).toBe("mlx_lm.server")
  })

  it("passes --kv-bits and --draft-model when configured", () => {
    const entry = mlxEntry({ port: 8090 })
    const config: MlxConfig = {
      ...mlx,
      kvBits: 8,
      draftModel: "mlx-community/Qwen2.5-0.5B-Instruct-4bit"
    }
    const { cmd, args } = adapter.buildCommand(entry, config)
    expect(cmd).toBe("mlx_lm.server")
    expect(args).toContain("--kv-bits")
    expect(args[args.indexOf("--kv-bits") + 1]).toBe("8")
    expect(args).toContain("--draft-model")
    expect(args[args.indexOf("--draft-model") + 1]).toBe("mlx-community/Qwen2.5-0.5B-Instruct-4bit")
  })
})
