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
  memoryTier: "8gb" | "16gb" | "32gb"
  taskTags: readonly string[]
  rationale?: string
  reviewedAt?: string
}

export const SUGGESTIONS: readonly Suggestion[] = [
  {
    repo: "mlx-community/Qwen3-4B-Instruct-2507-4bit",
    runtime: "mlx",
    label: "Qwen3-4B-Instruct (4bit)",
    sizeLabel: "~2.3 GB",
    note: "small general-purpose starter for tighter-memory Macs",
    memoryTier: "8gb",
    taskTags: ["general", "chat", "coding"],
    rationale: "lowest-risk first pull when you want a responsive local model without pushing memory hard",
    reviewedAt: "2026-05"
  },
  {
    repo: "mlx-community/Qwen3.5-9B-MLX-4bit",
    runtime: "mlx",
    label: "Qwen3.5-9B (4bit)",
    sizeLabel: "~5.6 GB",
    note: "balanced everyday text model for most 16 GB Apple Silicon Macs",
    memoryTier: "16gb",
    taskTags: ["general", "chat", "coding"],
    rationale: "good default when you want noticeably more headroom than 4B without jumping straight to large-model memory pressure",
    reviewedAt: "2026-05"
  },
  {
    repo: "mlx-community/Qwen3.5-27B-4bit",
    runtime: "mlx",
    label: "Qwen3.5-27B (4bit)",
    sizeLabel: "~15 GB",
    note: "larger reasoning-oriented option for roomier Apple Silicon systems",
    memoryTier: "32gb",
    taskTags: ["general", "reasoning", "coding"],
    rationale: "best reserved for machines with comfortable unified-memory headroom and users willing to trade speed for model quality",
    reviewedAt: "2026-05"
  }
]
