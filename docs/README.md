# Athanor Documentation

Technical documentation for **athanor** — local LLM workbench for Apple Silicon.

This directory contains guides covering environment prerequisites, runtime tuning, system architecture, terminal UI navigation, and diagnostic procedures.

---

## Guides Overview

| Guide | Description | Key Topics |
|---|---|---|
| 🛠️ **[Setup & Installation](setup.md)** | Installing external runtimes & verifying host dependencies | `uv`, `pipx`, `mlx-vlm` PyTorch extras, `llama.cpp` Metal builds, `hf` CLI, `athanor doctor`, and CLI install modes |
| 🧪 **[Formulas & Model Tuning](formulas.md)** | Per-model overrides & inference configuration | Built-in formulas, custom formula library, Quantized KV Cache (`q8_0`/`q4_0`), Flash Attention, Speculative Decoding / MTP, and Reasoning Effort |
| 🏛️ **[Architecture & Ingress](architecture.md)** | System internals, process lifecycle, and proxying | OpenAI-compatible ingress proxy, pi-agent aggregator sync, stable per-model ports, supervisor eviction policies, detached companion ingress, and `config.json` reference |
| 🖥️ **[Terminal User Interface (TUI)](tui.md)** | Terminal interface and monitoring | Layout, Downloads modal, Formula Editor, Telemetry modal, full-screen log navigation, mouse wheel capture, and tmux dev mode |
| 🔍 **[Troubleshooting Guide](troubleshooting.md)** | Common issues and diagnostic procedures | Port conflicts, startup timeouts on large weights, VLM processor errors, pi-agent catalog refresh, stale PID recovery, and log inspection |

---

## Documentation by Workflow

### 🚀 Getting Started
- **System Setup**: Ensure Apple Silicon and Node.js ≥ 22 requirements are met, then install runtimes via the [Setup & Installation Guide](setup.md).
- **Verifying Binaries**: Run `athanor doctor` and `athanor doctor --check-updates` to check installed toolchains ([Setup: Verifying Dependencies](setup.md#verifying-dependencies-athanor-doctor)).
- **First Model Launch**: Check the Quick Start in the root [README](../README.md#quick-start) to pull and start a recommended starter model.

### 🔌 Downstream Integration
- **Pi-Agent Connection**: Athanor updates `~/.pi/agent/models.json` with ingress aggregators (`athanor-mlx` and `athanor-llama`). See [Architecture: Pi-Agent Sync](architecture.md#pi-agent-catalog-synchronization).
- **Ingress Endpoints**: Access all models through `http://127.0.0.1:40879/v1` with on-demand model startup and stream-drain protection ([Architecture: The Ingress Server](architecture.md#the-ingress-server)).
- **Code Snippets**: Generate OpenAI API and pi-agent integration code snippets using `athanor snippet <slug>`.

### ⚙️ Tuning & Performance Optimization
- **Formula Basics**: Set context size, sampling, and GPU layers per model ([Formulas: CLI Formula Management](formulas.md#cli-formula-management)).
- **Memory Management & Swap**: Reduce KV cache memory on high-context workloads using `q8_0` quantization and Flash Attention ([Formulas: KV Cache Quantization](formulas.md#kv-cache-quantization--flash-attention-llamacpp)).
- **Inference Speed**: Increase token generation speed with Multi-Token Prediction or draft models ([Formulas: Speculative Decoding & MTP](formulas.md#speculative-decoding--mtp-llamacpp)).
- **Thinking Models**: Prevent long generations by setting reasoning effort to `medium` or `low` ([Formulas: Reasoning Effort](formulas.md#reasoning-effort-llamacpp)).

### 🖥️ Monitoring & Workbench Operations
- **Interactive TUI**: View installed models, real-time CPU/RAM/tokens-per-second metrics, and logs ([TUI Guide](tui.md)).
- **Downloads Queue**: View active Hugging Face downloads and cancel running tasks ([TUI: Downloads Modal](tui.md#2-downloads-modal-d)).
- **Tuning UI**: Adjust compound settings or granular flags live ([TUI: Formula Editor](tui.md#1-formula-editor-e)).
- **Historical Telemetry**: Track lifetime prompt and generation tokens, latency, and speed ([TUI: Telemetry Modal](tui.md#3-telemetry-modal-t)).

### 🛠️ Diagnostics & Problem Solving
- **Port In Use Errors**: Resolve port collisions or clear stale process bindings ([Troubleshooting: Port In Use](troubleshooting.md#2-port-already-in-use)).
- **Startup Timeouts**: Tune `supervisor.startupTimeoutMs` for 70B+ parameter models loading from SSD ([Troubleshooting: Startup Timeouts](troubleshooting.md#1-model-fails-to-start-or-times-out)).
- **Missing PyTorch in VLMs**: Fix `Qwen3VLVideoProcessor requires the PyTorch library...` errors ([Troubleshooting: MLX VLM](troubleshooting.md#3-mlx-vlm-pytorch-library-not-found)).
- **Inspecting Logs**: Locate supervisor logs in `~/.athanor/logs/<slug>-<pid>.log` and router logs in `~/.athanor/logs/router.log` ([Troubleshooting: Log Locations](troubleshooting.md#8-log-locations)).
