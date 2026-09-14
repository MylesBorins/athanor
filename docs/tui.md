# Terminal User Interface (TUI)

Athanor features an interactive Ink-based TUI for monitoring, starting, tuning, and downloading models without leaving the terminal.

Launch the TUI with no arguments:

```bash
athanor
# Or in source dev mode:
npm start
```

---

## Screen Layout

```
┌─────────────────────────────────────────────────────────────┐
│ athanor · Apple M3 Max · 64GB unified                       │
│ CPU: [████░░░░░░] 42%   RAM: [███████░░░] 45.2GB / 64GB     │
├─────────────────────────────────────────────────────────────┤
│ > [mlx] mlx-community/Qwen3.5-9B-MLX-4bit (running)         │
│         40880 · 340% · 4.8G · 28.4 tok/s · [pi]             │
│   [llama] unsloth/Qwen3.6-27B-Q4_K_M (idle)                 │
│         40881 · [pi] · [tuned]                              │
├─────────────────────────────────────────────────────────────┤
│ [LOG TAIL - qwen3-5-9b-mlx-4bit]                            │
│ 2026-09-13 21:40:02 [INFO] Starting mlx_lm.server on :40880 │
│ 2026-09-13 21:40:05 [INFO] Model loaded successfully        │
└─────────────────────────────────────────────────────────────┘
```

The interface is divided into three sections:
1. **System Banner**: Real-time Apple Silicon unified memory usage, total CPU utilization, and 1-minute load average.
2. **Model Selector**: Installed models with runtime, stable port, pi-agent publish status, active/idle state, and live metrics (CPU%, RSS, tokens/second).
3. **Log Tail / Preview**: Real-time log output for the currently highlighted or running model.

---

## Primary Keybindings

| Key | Action |
|---|---|
| `↑` / `↓` / Wheel | Move selection up / down |
| `⏎` (Enter) | Start (if idle) or stop (if running) the highlighted model |
| `r` | Restart the highlighted model |
| `k` | Force kill the highlighted model's process |
| `P` | Toggle pi-agent visibility (`expose` / `hide`) |
| `d` | Remove entry from the registry (model must be stopped) |
| `D` | Open the Downloads modal |
| `s` | Rescan models in HF cache and `~/.models` |
| `p` | Open the Pull modal to download a new model |
| `e` | Open the Formula Editor for the highlighted model |
| `t` | Open the Telemetry modal for historical performance metrics |
| `/` | Filter the model list by text search |
| `tab` | Toggle full-screen log viewer mode |
| `q` | Quit the TUI (running models continue running in background) |

---

## Interactive Modals

### 1. Formula Editor (`e`)

The Formula Editor allows live tuning of runtime launch flags:

- **Mode Switching (`Tab`)**: Toggle between **Simple Mode** (high-level compound knobs) and **Advanced Mode** (granular per-flag keys).
- **Simple Compound Knobs**:
  - *Context Window*: Cycle through 8K, 16K, 32K, 64K, 128K, or custom.
  - *KV Cache Quantization*: Cycle between FP16, Q8_0, Q4_0 with automatic Flash Attention.
  - *Speculative Decoding*: Configure Multi-Token Prediction (MTP) or draft model offloading.
  - *Sampling Mode*: Switch between deterministic, instruct, or thinking profiles.
  - *Reasoning Effort*: Adjust thinking effort (`xhigh`, `medium`, `low`).
- **Quick Shortcuts**:
  - `1-7`: Instantly apply built-in formulas (`balanced`, `fast`, `long-context`, `q8-kv`, `thinking`, `instruct`, `mtp`).
  - `s`: Save current tuning as a reusable custom formula in `~/.athanor/formulas.json`.
  - `y`: Copy the resolved command-line string to your system clipboard.
  - `u`: Unset a selected field.
  - `c`: Clear all formula overrides (resets to defaults).
  - `v`: Toggle MLX flavor (`lm` vs `vlm`).
  - `Esc`: Close the editor.

### 2. Downloads Modal (`D`)

Tracks active, queued, and completed downloads initiated via `athanor pull` or the TUI:
- `↑` / `↓`: Select download task.
- `c`: Cancel the active task (terminates `hf` download process cleanly).
- `C`: Clear finished download tasks from view.
- `Esc`: Close the modal.

### 3. Telemetry Modal (`t`)

Displays comprehensive performance metrics for the selected model:
- Total requests and lifetime prompt / generation tokens.
- Average time-to-first-token (TTFT) and throughput (tok/s).
- Prompt evaluation speed and peak memory consumption (RSS).

---

## Log Viewer & Navigation (`tab`)

Pressing `tab` collapses the model list and expands the log pane into a full-screen viewer:

- `↑` / `↓`: Scroll log one line at a time.
- `Mouse Wheel`: Scroll 3 lines per notch.
- `PgUp` / `PgDn`: Scroll by half a page.
- `g` / `Home`: Jump to top of log buffer.
- `G` / `End`: Jump back to tail (resumes live auto-follow).
- When scrolled up, the header displays `+N ↑ paused`. Live streaming resumes when scrolled back to the bottom.
- Press `tab` again to restore the split model-list view.

---

## Mouse Support & Terminal Selection

Athanor enables SGR mouse reporting (`\x1b[?1000h\x1b[?1006h`) while running, allowing you to scroll logs and lists with the mouse wheel.

- **Selecting text**: In terminal emulators like iTerm2 or Terminal.app, hold `⌥` (Option / Alt) while dragging the mouse to bypass mouse tracking and copy text natively.
- **Clean exit**: Mouse tracking is cleanly disabled on normal exit, `SIGINT` (`Ctrl-C`), `SIGTERM`, and `SIGHUP`. If a crash leaves the terminal state altered, run `reset` to restore your shell.

---

## Tmux & Dev Mode (`npm run dev`)

For active development, run:

```bash
npm run dev
```

This runs `scripts/dev-watch.mjs`, which monitors TypeScript files and reloads the TUI with `ATHANOR_DEV_TUI=1`. This dev mode skips alt-screen clearing so you can comfortably test in tmux split panes without flickering or losing your scroll history.
