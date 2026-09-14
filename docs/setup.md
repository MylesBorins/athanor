# Setup & Installation Guide

This guide covers installing and verifying the external runtime binaries required to run MLX and GGUF (`llama.cpp`) models on Apple Silicon with athanor.

---

## Prerequisites

- **Hardware**: Apple Silicon Mac (M1/M2/M3/M4, Pro/Max/Ultra or base)
- **OS**: macOS 13.5+ (Ventura, Sonoma, Sequoia or later)
- **Node.js**: Node.js ≥ 22

---

## Agent-Assisted Setup

If you use an AI coding agent (Claude Code, Cursor, Aider, Antigravity, etc.), the fastest path is to open this repository in your agent and let it profile and configure your system. [`AGENTS.md`](../AGENTS.md) contains an **Onboarding a user** specification that guides agents through:
- Installing the CLI (`npm start` dev mode vs `npm link`)
- Running `athanor doctor` to verify system binaries
- Checking unified memory with `vm_stat` and HF cache size
- Selecting an appropriately sized starter model for your RAM tier (8 / 16 / 32 / 64 GB+)

**Suggested prompt to give your agent:**
> Set up athanor on this machine. Profile what I have, install anything missing, and suggest a starter model I can actually run.

---

## Runtime Helpers

Athanor shells out to external runtimes rather than embedding heavy native binaries. All runtimes run on your `PATH` and are verified by `athanor doctor`.

### 1. `mlx-lm` (MLX Text Runtime)

`mlx-lm` is required for running text-only MLX models. It provides the `mlx_lm.server` entry point. Isolated installations via `uv` or `pipx` are recommended.

```bash
# With uv (recommended)
brew install uv
uv tool install mlx-lm
# => `mlx_lm.server` is installed in ~/.local/bin

# Or with pipx
brew install pipx
pipx install mlx-lm

# Or in a dedicated virtualenv
python3 -m venv ~/.venvs/mlx && source ~/.venvs/mlx/bin/activate
pip install -U mlx-lm
```

**Verify:**
```bash
mlx_lm.server --help
```

---

### 2. `mlx-vlm` (MLX Vision/Multimodal Runtime)

`mlx-vlm` is optional. It is required only if you flip a vision-capable model to `mlxFlavor: "vlm"` using `athanor flavor <slug> vlm` to process image inputs.

> [!IMPORTANT]
> `mlx_vlm.server` imports Hugging Face `transformers` VLM processors, which require PyTorch and Torchvision. Installing `mlx-vlm` alone is not sufficient; `torch` and `torchvision` must be present in the same environment.

```bash
# With uv (recommended)
uv tool install mlx-vlm --with torch --with torchvision

# Or with pipx
pipx install mlx-vlm
pipx inject mlx-vlm torch torchvision

# Or in your active venv
pip install -U mlx-vlm torch torchvision
```

**Verify:**
```bash
mlx_vlm.server --help
python3 -c "import torch, torchvision; print(torch.__version__, torchvision.__version__)"
```

*Troubleshooting note:* If `mlx_vlm.server` starts but requests fail with `Qwen3VLVideoProcessor requires the PyTorch library...`, PyTorch is missing from the environment `mlx_vlm.server` is executing in. Reinstall using the `--with torch --with torchvision` flag above.

---

### 3. `llama.cpp` (GGUF Runtime)

`llama-server` is required for running quantized GGUF models. On macOS, the Homebrew bottle is built with Metal support enabled by default.

```bash
# Via Homebrew (recommended)
brew install llama.cpp
```

**Building from source (optional):**
```bash
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build
cmake --build build --config Release -j
# Symlink or copy build/bin/llama-server into your PATH (e.g. /usr/local/bin or ~/.local/bin)
```

**Verify:**
```bash
llama-server --help
```

---

### 4. `hf` (Hugging Face CLI)

The `hf` CLI is required only for downloading models via `athanor pull`. If you download models manually or already have them in `~/.cache/huggingface/hub` or `~/.models`, you can skip this.

The Hugging Face team replaced legacy `huggingface-cli` with the modern `hf` command.

```bash
# Standalone installer (recommended - drops self-contained binary onto PATH)
curl -LsSf https://hf.co/cli/install.sh | bash

# Or via Homebrew
brew install hf

# Or via uvx (on-demand execution without persistent install)
uvx hf --help

# Or via pip (included with huggingface_hub >= 0.34)
pip install -U huggingface_hub
```

**Verify:**
```bash
hf --help

# Optional: log in to access gated or private repositories
hf auth login
```

---

## Verifying Dependencies (`athanor doctor`)

Run `athanor doctor` at any time to verify that all runtime binaries are located on your `PATH` and print their installed versions:

```bash
athanor doctor
# mlx_lm.server:   /Users/you/.local/bin/mlx_lm.server  version 0.31.3 (uv)
# mlx_vlm.server:  /Users/you/.local/bin/mlx_vlm.server  version 0.4.4 (uv)
# llama-server:    /opt/homebrew/bin/llama-server  version 9010 (brew)
# hf:              /Users/you/.local/bin/hf  version 1.13.0 (uv)
```

### Checking for Updates

You can check whether newer versions of your installed binaries are available on PyPI or Homebrew:

```bash
athanor doctor --check-updates
# mlx_lm.server:   version 0.31.3 (latest 0.31.3 - up to date)
# llama-server:    version 9010 (update available -> 9025)
#   hint: brew upgrade llama.cpp
```

---

## CLI Installation Modes

Clone and install athanor using any of three workflows:

| Mode | Setup | Invocation | Notes |
|---|---|---|---|
| **From source (Dev loop)** | `npm install` | `npm start -- <cmd>` | Runs directly via `tsx` without building. Pass `--` before CLI arguments. |
| **Global binary (Linked)** | `npm install && npm run build && npm link` | `athanor <cmd>` | Accessible globally from any shell. Must re-run `npm run build` after pulling updates. |
| **Project-local binary** | `npm install && npm run build` | `./bin/athanor <cmd>` | Uses the built `dist/` bundle inside the repository. |
