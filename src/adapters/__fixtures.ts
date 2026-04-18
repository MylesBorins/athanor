import type { ModelEntry } from "../types/index.js"

export function mlxEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "mlx-community/Test-4bit",
    slug: "test-4bit",
    path: "/models/test-mlx",
    runtime: "mlx",
    source: { type: "hf", repo: "mlx-community/Test-4bit" },
    port: 8081,
    publish: true,
    piAlias: "test-4bit",
    addedAt: 1,
    ...overrides
  }
}

export function llamaEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "test.gguf",
    slug: "test-gguf",
    path: "/models/test.gguf",
    runtime: "llama.cpp",
    source: { type: "local" },
    port: 8082,
    publish: true,
    piAlias: "test-gguf",
    addedAt: 1,
    ...overrides
  }
}
