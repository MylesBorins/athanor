# athanor

A local LLM workbench for Apple Silicon. Discover, run, configure, and switch between MLX and `llama.cpp` (GGUF) models from a TUI or CLI, while keeping an OpenAI-compatible HTTP ingress active for tools like [pi-agent](https://github.com/badlogic/pi-mono).

---

## What It Does

- **Unified Runtimes**: Runs Apple MLX (`mlx_lm.server`, `mlx_vlm.server`) and GGUF (`llama-server`) models with Metal acceleration.
- **Zero Daemon**: No persistent background service. Runtimes run as detached child processes bound to stable ports that persist across restarts.
- **OpenAI-Compatible Ingress**: Single-port reverse proxy (`http://127.0.0.1:40879/v1`) with on-demand model activation and stream-drain safety.
- **Pi-Agent Integration**: Synchronizes exposed models to `~/.pi/agent/models.json` via aggregator providers (`athanor-mlx` and `athanor-llama`) while leaving non-athanor providers (OpenAI, Anthropic, Ollama, etc.) untouched.
- **Terminal UI & Scriptable CLI**: Switch models, tail logs, adjust formulas, and monitor token throughput from an Ink TUI or CLI.

---

## Quick Install

### Prerequisites

- **Hardware**: macOS on Apple Silicon (M1/M2/M3/M4)
- **Runtime**: Node.js ≥ 22
- **External Binaries**: `mlx_lm.server`, `llama-server`, `hf`

### 1-Minute Setup

```bash
# Install external runtimes
brew install uv llama.cpp
uv tool install mlx-lm
uv tool install huggingface_hub

# Clone and install athanor
git clone https://github.com/MylesBorins/athanor.git
cd athanor
npm install && npm run build && npm link

# Verify dependencies
athanor doctor
```

*(For detailed setup options including `pipx`, dedicated virtual environments, and MLX vision dependencies, see the [Setup Guide](docs/setup.md)).*

---

## Quick Start

### 1. Using the CLI

```bash
# 1. Download a starter model from Hugging Face
athanor pull mlx-community/Qwen3.5-9B-MLX-4bit

# 2. Start the model (binds to its stable port and activates the ingress proxy)
athanor start qwen3-5-9b-mlx-4bit

# 3. Expose to pi-agent
athanor expose qwen3-5-9b-mlx-4bit

# 4. Inspect status and generation metrics
athanor status
```

In **pi-agent**, select provider **`athanor-mlx`** and model **`mlx-community/Qwen3.5-9B-MLX-4bit`**.

### 2. Using the Interactive TUI

Launch athanor without arguments to enter the TUI:

```bash
athanor
```

Press `Enter` to start/stop the highlighted model, `p` to pull new models, `e` to tune parameters, or `tab` to inspect full-screen streaming logs.

---

## CLI Reference

```
athanor                          launch the interactive TUI
athanor scan                     re-scan model dirs and update registry
athanor ls                       list registry entries with live status
athanor status                   list running instances with CPU, RSS, and tok/s
athanor show     <id|slug>       inspect a model's config and resolved launch command
athanor snippet  <id|slug>       generate integration snippets (curl, OpenAI SDK, pi)
athanor start    <id|slug> [-y]  start a model (bypassing confirmation with -y)
athanor stop     [<id|slug>|--all] stop one or all running models
athanor restart  <id|slug> [-y]  stop + start a model
athanor logs     <id|slug> [-n N] tail last N lines of a model's log
athanor pull     <repo> [--file F] download from Hugging Face and register
athanor search   [q] [--mlx|--gguf] search Hugging Face Hub
athanor trending [--mlx|--gguf]  view trending models on Hugging Face
athanor formula  <slug> ...      tune launch flags (set, unset, clear, apply, save)
athanor formulas [delete <name>] list or manage custom formulas in library
athanor flavor   <slug> lm|vlm   switch MLX runtime flavor (lm = text, vlm = vision)
athanor expose   <id|slug>       include model in pi-agent catalog
athanor hide     <id|slug>       remove model from pi-agent catalog
athanor rm       <id|slug>       remove model from registry (must be stopped)
athanor sync                     manually rewrite pi-agent catalog
athanor router   [--port P]      run the ingress server in the foreground
athanor config                   print resolved configuration and file paths
athanor doctor   [--check-updates] verify required binaries and check for updates
athanor telemetry [<slug>|clear] view historical generation throughput and metrics
```

`<id|slug>` accepts either the canonical repository ID or the short model slug.

---

## TUI Keybindings

| Key | Action |
|---|---|
| `↑` / `↓` / Wheel | Move highlighted selection |
| `⏎` (Enter) | Start (if idle) or stop (if running) the highlighted model |
| `r` | Restart highlighted model |
| `k` | Force kill highlighted model process |
| `P` | Toggle pi-agent visibility (`expose` / `hide`) |
| `d` | Remove entry from registry (must be stopped) |
| `D` | Open Downloads modal |
| `s` | Rescan models from cache |
| `p` | Open Pull modal to download a model |
| `e` | Open Formula Editor to adjust runtime parameters |
| `t` | Open Telemetry modal |
| `/` | Filter model list by text |
| `tab` | Toggle full-screen log viewer mode |
| `q` | Quit TUI (running models remain active in background) |

---

## Documentation Guides

Deep-dive documentation is available in the [`docs/`](docs/) directory:

- 🛠️ **[Setup & Installation Guide](docs/setup.md)**: Detailed runtime installation (`uv`, `pipx`, venvs), PyTorch extras for MLX vision models, building `llama.cpp` from source, and update checking.
- 🧪 **[Formulas & Model Tuning](docs/formulas.md)**: Customizing runtime flags, built-in formulas (`balanced`, `thinking`, `fast`, etc.), Quantized KV Cache (`q8_0`), Flash Attention, Speculative Decoding / MTP, and Reasoning Effort.
- 🏛️ **[Architecture & Ingress](docs/architecture.md)**: OpenAI-compatible ingress proxy, aggregator providers for pi-agent, stable per-model port allocation, detached supervisor lifecycle, and full `config.json` reference.
- 🖥️ **[Terminal User Interface (TUI)](docs/tui.md)**: Screen layout, interactive modal dialogs (Downloads, Formulas, Telemetry), log scrolling, mouse support, and tmux dev workflow.
- 🔍 **[Troubleshooting Guide](docs/troubleshooting.md)**: Fixing port conflicts, startup timeouts, missing PyTorch for VLMs, and pi-agent catalog synchronization.

---

## Development

```bash
npm install
npx tsc --noEmit      # typecheck
npm test              # lint + vitest test suite
npm run test:watch    # vitest in watch mode
npm run build         # compile typescript to dist/
npm run dev           # live development loop with TUI dev watcher
```

Tests run in an isolated environment by redirecting `ATHANOR_HOME` and `PI_HOME` to temporary directories via `test/setup.ts`, ensuring your local configuration is never touched.

---

## Credits and Acknowledgements

Parts of athanor's hardware profiling, context VRAM estimation equations, and developer features were inspired by and adapted from the open-source project [whichllm](https://github.com/Andyyyy64/whichllm) under the MIT License:
- Memory bandwidth mapping from Apple Silicon chip brand strings (`src/machine/profile.ts`).
- Context-aware VRAM calculations and MoE active parameter scaling (`src/registry/recommend.ts`).
- Search synthesis for MLX/GGUF repository variants (`src/search/hf.ts`).
- Developer integration snippet generation (`src/cli/snippet-commands.ts`).

We thank `@Andyyyy64` and the `whichllm` contributors for their excellent research.

---

## License

Copyright 2026 Myles Borins.

Licensed under the Apache License, Version 2.0. See [`LICENSE`](./LICENSE) for details.
