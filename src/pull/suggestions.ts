import type { RuntimeType } from "../types/index.js"

// Curated starter models surfaced when the registry is empty. Kept
// short and conservative — these are safe, broadly useful defaults
// for a first-time Apple-Silicon user. Anything not in this list can
// still be fetched with `athanor pull <repo>` or `p` in the TUI.
//
// When adding: prefer mlx-community repos that carry real download
// counts on HF and work as text-only on `mlx_lm.server` without VLM
// extras. Disk sizes are approximations from the HF model card.
export interface Suggestion {
  repo: string
  file?: string
  runtime: RuntimeType
  label: string
  sizeLabel: string
  note: string
}

export const SUGGESTIONS: readonly Suggestion[] = [
  {
    repo: "mlx-community/Qwen3-4B-Instruct-2507-4bit",
    runtime: "mlx",
    label: "Qwen3-4B-Instruct (4bit)",
    sizeLabel: "~2.3 GB",
    note: "small & fast — fits on 8 GB Macs"
  },
  {
    repo: "mlx-community/Qwen3.5-9B-MLX-4bit",
    runtime: "mlx",
    label: "Qwen3.5-9B (4bit)",
    sizeLabel: "~5.6 GB",
    note: "solid general-purpose default — 16 GB+ memory"
  },
  {
    repo: "mlx-community/Qwen3.5-27B-4bit",
    runtime: "mlx",
    label: "Qwen3.5-27B (4bit)",
    sizeLabel: "~15 GB",
    note: "larger & smarter — needs 32 GB+ unified memory"
  }
]
