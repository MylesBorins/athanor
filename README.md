# athanor

**Athanor — personal LLM alchemy.** Discover, download, configure, and switch between MLX and llama.cpp models on Apple Silicon from a single TUI or CLI, while keeping an OpenAI-compatible HTTP endpoint live for downstream tools (pi-agent, editors, etc.).

## What it does

- **Discovers** MLX models in your HuggingFace cache and GGUF files in `~/.models`.
- **Downloads** new models from HuggingFace via the `hf` CLI.
- **Runs** them via `mlx_lm.server` or `llama-server`, one or more at a time, each on a stable port.
- **Supervises** the processes as detached children with per-process log files and automatic reattach.
- **Publishes** exposed models to pi-agent (`~/.pi/agent/models.json`) — by default via ingress-backed `athanor-mlx` / `athanor-llama` aggregators — leaving your other (cloud, Ollama, etc.) providers alone.
- **Exposes** an optional local control API so other tools can ask athanor to activate a model on demand.

## Prerequisites

- macOS on Apple Silicon
- Node.js ≥ 18
- `mlx_lm.server` (from [`mlx-lm`](https://github.com/ml-explore/mlx-lm)) — text-only MLX models
- `mlx_vlm.server` (from [`mlx-vlm`](https://github.com/Blaizzy/mlx-vlm)) — vision/multimodal MLX models; optional if you never run VLMs
- `llama-server` (from [`llama.cpp`](https://github.com/ggml-org/llama.cpp))
- `hf` (from [`huggingface_hub`](https://huggingface.co/docs/huggingface_hub/guides/cli)) — only required for `athanor pull`

Run `athanor doctor` at any point to verify all four are on your `PATH`.

## Agent-assisted setup

If you use an AI coding agent (Claude Code, Cursor, Aider, etc.), the fastest path is to open this repo in the agent and ask it to set athanor up for you. `AGENTS.md` has an **Onboarding a user** section written for that case: it tells the agent how to install the CLI (`npm start` vs `npm link`), run `athanor doctor`, install any missing runtime binaries, profile the host (Apple Silicon check, unified memory via `vm_stat`, HF cache size), and pick a starter model sized for the machine.

A minimal prompt, once the repo is open:

> Set up athanor on this machine. Profile what I have, install anything missing, and suggest a starter model I can actually run.

The rest of this README walks the same path manually.

## Setup

Install the three runtime helpers athanor shells out to. All three land on your `PATH` and can be verified with `athanor doctor`.

### mlx-lm (MLX runtime)

`mlx-lm` is a Python package; the `mlx_lm.server` entry point is what athanor invokes. A dedicated virtualenv keeps it isolated from your system Python.

```bash
# with uv (recommended)
brew install uv
uv tool install mlx-lm
# ⇒ `mlx_lm.server` is now on PATH via ~/.local/bin

# or with pipx
brew install pipx
pipx install mlx-lm

# or with a plain venv
python3 -m venv ~/.venvs/mlx && source ~/.venvs/mlx/bin/activate
pip install -U mlx-lm
```

Verify:

```bash
mlx_lm.server --help
```

MLX requires Apple Silicon and macOS 13.5+. Models are downloaded to `~/.cache/huggingface/hub` on first use.

### mlx-vlm (MLX vision/multimodal runtime)

Required only if you flip a model to `mlxFlavor: "vlm"` to feed it actual image input. Athanor defaults every MLX entry to `mlx_lm.server`, which handles text-only chat for most VLM-tagged repos (Qwen2-VL, Qwen2.5-VL, Qwen3-VL, LLaVA, etc.) without torch. Only install this when you actually need vision — and then opt in per model with `athanor flavor <slug> vlm`.

`mlx_vlm.server` imports `transformers`' VLM processors, which in turn import PyTorch and Torchvision. Installing `mlx-vlm` alone is not enough; `torch` and `torchvision` must be present in the same environment. With `uv`:

```bash
uv tool install mlx-vlm --with torch --with torchvision
```

Or with pipx:

```bash
pipx install mlx-vlm
pipx inject mlx-vlm torch torchvision
```

Or with pip into the same venv you used for mlx-lm:

```bash
pip install -U mlx-vlm torch torchvision
```

Verify:

```bash
mlx_vlm.server --help
python3 -c "import torch, torchvision; print(torch.__version__, torchvision.__version__)"
```

If `mlx_vlm.server` starts but a request fails with `Qwen3VLVideoProcessor requires the PyTorch library` (or similar), torch/torchvision are missing or installed into a different interpreter than `mlx_vlm.server` is using. Re-run the install above into the right environment.

### llama.cpp (GGUF runtime)

The easiest path on macOS is Homebrew — the bottle is built with Metal enabled, so GPU acceleration works out of the box:

```bash
brew install llama.cpp
```

You can also build from source if you want a specific revision or custom flags:

```bash
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build
cmake --build build --config Release -j
# copy or symlink build/bin/llama-server onto your PATH
```

Verify:

```bash
llama-server --help
```

### hf (HuggingFace CLI — only for `athanor pull`)

Needed only if you want athanor to download new models from the Hub. Skip if you'll populate `~/.cache/huggingface/hub` by other means (e.g. `mlx_lm.server --model <repo>` auto-downloads on first use).

The Hugging Face Hub team has replaced the legacy `huggingface-cli` command with a new CLI called `hf`. Athanor invokes `hf download`. The recommended install path is the standalone installer, which drops a self-contained `hf` binary onto your `PATH` without touching system Python:

```bash
curl -LsSf https://hf.co/cli/install.sh | bash
```

Alternatives:

```bash
# Homebrew
brew install hf

# via uvx — runs the latest release on demand, no install step
uvx hf --help

# via pip (the `hf` entry point ships with huggingface_hub ≥ 0.34)
pip install -U huggingface_hub
```

Verify:

```bash
hf --help
# optional: log in if you need access to gated/private repos
hf auth login
```

### Final check

```bash
athanor doctor
# mlx_lm.server:   /Users/you/.local/bin/mlx_lm.server  version 0.31.3 (uv)
# mlx_vlm.server:  /Users/you/.local/bin/mlx_vlm.server  version 0.4.4 (uv)
# llama-server:    /opt/homebrew/bin/llama-server  version 9010 (brew)
# hf:              /Users/you/.local/bin/hf  version 1.13.0 (uv)

athanor doctor --check-updates
# ... latest <version> up to date
# ... or latest <version> update available
# ... hint uv tool upgrade <tool>
```

## Quick start

### Fastest path

If you want one working local text model quickly on a typical 16 GB+ Apple Silicon Mac:

```bash
npm install
npm start -- doctor
npm start -- pull mlx-community/Qwen3.5-9B-MLX-4bit
npm start -- start qwen3-5-9b-mlx-4bit
npm start -- expose qwen3-5-9b-mlx-4bit
```

Then in pi-agent, select provider `athanor-mlx-qwen3-5-9b-mlx-4bit` and model `mlx-community/Qwen3.5-9B-MLX-4bit`.

If you only want text chat, you do **not** need `mlx_vlm.server`; `mlx_lm.server` is enough even for many VLM-tagged repos when used as text-only models.

### Full quick start

```bash
npm install

# verify external runtime binaries are on PATH
npm start -- doctor

# one-time: ingest whatever's already on disk
npm start -- scan

# see what's in the registry — if empty, this prints curated
# starter models with reviewed 8 / 16 / 32 GB memory tiers and task tags
# that you can copy the `athanor pull ...` line from
npm start -- ls

# pull one and start it (by slug)
npm start -- pull mlx-community/Qwen3.5-9B-MLX-4bit
npm start -- start qwen3-5-9b-mlx-4bit

# or drop into the TUI (no args) — the empty state has the same
# suggestions with memory tiers/task tags and pulls them inline when you press Enter
npm start
```

`npm start` runs the app via `tsx`, so no build step is needed for development. For a live development loop, use:

```bash
npm run dev
```

That runs a small custom watcher (`scripts/dev-watch.mjs`) which watches only `src/**/*.ts` and `src/**/*.tsx`, then respawns `tsx src/index.tsx` with `ATHANOR_DEV_TUI=1`. This avoids `tsx watch`'s stdin/restart behavior, which can interfere with Ink/TUI key handling in tmux. In this dev mode athanor still starts the real ingress path (router when needed, control API if enabled) so pi-agent integration behaves like the normal app, but it skips the alt-screen/cursor toggles to make UI iteration safer in split panes. The TUI also collapses to compact/minimal layouts in short or narrow terminals so model selection stays usable in tmux splits. Router-driven model switches are reflected in the TUI by polling persisted live instance state, not only the local process's in-memory supervisor map. For one-shot runs without the dev safeguards, keep using `npm start`.

If you want a compiled build or to install the `athanor` binary globally:

```bash
npm run build        # emit dist/
npm link             # expose `athanor` on PATH
athanor ls           # now usable directly
```

`bin/athanor` imports `dist/index.js`, so `npm link` requires a prior `npm run build`. Linked mode does not auto-rebuild; re-run the build after pulling changes or stay on `npm start` for the dev loop.

## Concepts

### Registry

`~/.athanor/models.json` is the source of truth. Every model has:

| field       | purpose                                                       |
| ----------- | ------------------------------------------------------------- |
| `id`        | stable canonical id (HF repo, repo+file, or `local:…`)        |
| `slug`      | short user-editable handle (`qwen-32b`)                       |
| `path`      | on-disk location athanor passes to the runtime                |
| `runtime`   | `mlx` or `llama.cpp`                                          |
| `source`    | `{ type: "hf", repo, [revision], [file] }` or `{ type: "local" }` |
| `port`      | **stable** port allocated once per model, never changes       |
| `formula`   | per-model overrides that merge on top of global runtime config |
| `mlxFlavor` | `"lm"` or `"vlm"` — picks which MLX binary to use (MLX only)  |
| `publish`   | whether pi-agent sees this model                              |
| `piAlias`   | optional llama launch alias; when set to something other than `slug`, overrides the default runtime model id |
| `tags`      | free-form labels (`chat`, `coder`, …)                         |

### Stable per-model ports

Each model is bound to a port at first ingest and keeps it forever. This means pi-agent's catalog is configured **once per model**; switching which model is active does not change pi's URLs, only the `status` field athanor writes into each entry.

Port range is configurable (`portRange` in `~/.athanor/config.json`, default 40880–40979).

On load, athanor collapses duplicate registry rows that share the same normalized on-disk path (keeping the HF-sourced entry when present) and upgrades local GGUF paths under `org--repo/` directories to HF source metadata when possible.

### MLX capabilities and flavor routing

MLX entries track two independent axes:

- `mlxCapabilities` — *what the model advertises*. Detected from the snapshot's `config.json` at scan and pull time, primarily by looking for a `vision_config` block, with fallbacks for known VLM `model_type` values (`qwen2_vl`, `qwen2_5_vl`, `llava*`, `mllama`, `pixtral`, `idefics2/3`, `phi3_v`) and architecture-name patterns such as `Qwen2VLForConditionalGeneration`. Today the only capability is `"vlm"`. Capabilities are refreshed on every scan.
- `mlxFlavor` — *which server binary to launch*. `"lm"` routes to `mlx_lm.server` (the default, no torch/torchvision required); `"vlm"` routes to `mlx_vlm.server` (requires torch + torchvision; needed for actual image input). Never set automatically — you choose with `athanor flavor <slug> lm|vlm`.

The split is deliberate: many VLM-tagged repos (e.g. Qwen2.5-VL, Qwen3-VL-MLX) run fine as text-only under `mlx_lm.server`, which is lighter, faster to load, and doesn't need a PyTorch install. Auto-routing every VLM-capable repo to `mlx_vlm.server` would silently break text-only workflows whenever torch isn't available. So athanor defaults everything to `lm` and leaves the upgrade to you.

In `athanor ls` and `athanor show`, entries with `mlxFlavor: "vlm"` display `mlx-vlm` in the runtime column; `athanor show` also prints a `caps` row and, for vision-capable entries still on `lm`, a hint pointing at `athanor flavor <slug> vlm`. In the TUI model list, hub-backed entries show the HF repo as the primary label with the slug dimmed after it; local entries show the slug only. In pi-agent, VLM-flavored entries render as `[mlx-vlm] <repo> (athanor)`; the provider id stays `athanor-mlx-<slug>` regardless of flavor, so pi URLs don't churn if a model's flavor is toggled later.

### Supervisor and policies

The runtime supervisor manages N concurrent child processes. Three policies:

- `single-active` (default) — starting a model stops any others.
- `multi-active-lru` — keep up to `supervisor.maxConcurrent` running; evict the least-recently-started.
- `manual` — never auto-stop; you decide.

Children are started with `detached: true`, stdio redirected to `~/.athanor/logs/<slug>-<pid>.log`, and `unref()`ed so the CLI/TUI can exit without killing them. On next launch athanor reattaches via PID.

Readiness is detected by polling the runtime's health endpoint (`/health` for llama.cpp, `/v1/models` for mlx_lm.server), not by matching stdout strings.

### Observability

The TUI banner shows a second line with system CPU and RAM bars plus the 1-minute load average, refreshed once a second. Each running row in the model list gets a compact suffix `CPU% · RSS · tok/s` (e.g. `340% · 4.2G · 22.5 tok/s`). The CLI mirrors this: `athanor status` adds CPU, RSS, and tok/s columns for every running instance.

Caveats worth knowing:

- **CPU% is per-core, not per-machine**, matching `ps` and Activity Monitor. A runtime using 8 cores reads as ~800%. Divide by `os.cpus().length` yourself if you want a whole-machine number.
- **RSS is resident set size**, not reserved allocation. On Apple Silicon's unified memory this is the honest "how much of my RAM is this model currently pinning" number.
- **tok/s is post-request, not live.** Athanor does not sit in the request path — clients connect directly to each runtime's port. The number is parsed from the per-completion timing line the runtime already writes to its log (`eval time = … tokens per second` for llama.cpp, `Generation: … tokens, … tokens-per-sec` for mlx_lm / mlx_vlm), and updates once a generation finishes. While a request is streaming, the most recent completed request's rate is shown. If no completion has happened yet, the column is blank.
- Sampling is best-effort — if `ps` fails, the log format changes, or timing lines are not yet present, the affected column is hidden rather than showing a wrong number.

### Pi-agent sync

Athanor publishes into pi-agent's [custom providers](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md) system. On every state change it rewrites `~/.pi/agent/models.json`.

**Default shape (ingress on):** pi sees up to two aggregator providers — `athanor-mlx` and `athanor-llama` — both pointing at the ingress port (`127.0.0.1:40879/v1` by default). Each lists only exposed models of that runtime. See [Ingress](#ingress) for lifecycle and request routing.

**Direct shape (`router.enabled: false`):** each exposed model becomes **its own pi provider** named `athanor-<runtime>-<slug>` (e.g. `athanor-mlx-qwen3-32b`), with `baseUrl` pointing at that model's stable port. One provider per model is required because a pi provider has exactly one `baseUrl` and each athanor model runs on its own port.

Common rules for both shapes:

- Providers whose name does **not** start with `athanor-` are preserved untouched — your OpenAI, Anthropic, Ollama, OpenRouter, etc. entries are safe.
- Each athanor provider uses `api: "openai-completions"`, a placeholder `apiKey: "athanor"`, and runtime-appropriate `compat` flags.
- pi's `/model` picker lists models by **`id`**, not `name`. The `name` field is advisory detail text. Athanor sets both so they stay aligned with what each runtime was launched with:
  - **MLX HF-sourced models** — launched with `--model <repo>`; pi `id` is that repo string.
  - **MLX local models** — launched with `--model <path>`; pi `id` is that path.
  - **llama.cpp HF GGUF** — launched with `--alias <registry-id>` where the id is `author/repo:file.gguf`; pi `id` matches. This keeps hub source visible in pi the same way MLX repos are. Slug and canonical id remain valid request aliases via the ingress resolver.
  - **llama.cpp local / custom alias** — launched with `--alias <piAlias|slug>` when you've set an explicit `piAlias` different from `slug`; pi `id` is that alias.
- Hub-backed entries use `[runtime] <repo> (athanor)` for the pi `name` field regardless of runtime.
- `~/.pi/agent/settings.json` is only touched when an athanor model is started as the active default.

Example aggregator model entry (llama GGUF, HF-sourced):

```json
{
  "id": "unsloth/Qwen3.6-27B-GGUF:Qwen3.6-27B-Q4_K_M.gguf",
  "name": "[llama.cpp] unsloth/Qwen3.6-27B-GGUF (athanor)",
  "input": ["text"],
  "contextWindow": 32768
}
```

Example direct provider (MLX, HF-sourced):

```json
{
  "providers": {
    "athanor-mlx-qwen3-32b": {
      "baseUrl": "http://127.0.0.1:40880/v1",
      "api": "openai-completions",
      "apiKey": "athanor",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "mlx-community/Qwen3-32B-4bit",
          "name": "[mlx] mlx-community/Qwen3-32B-4bit (athanor)",
          "input": ["text"],
          "contextWindow": 32768
        }
      ]
    }
  }
}
```

After upgrading athanor or changing runtime ids, run `athanor sync` and **restart** affected llama models so `--alias` matches what pi expects. pi reloads `models.json` when you open `/model`.

Disable athanor's sync entirely with `"enablePiSync": false` in `~/.athanor/config.json`.

## CLI reference

```
athanor                          launch the TUI
athanor scan                     rescan model dirs and update registry
athanor ls                       list registry entries (with live status)
athanor status                   list running instances
athanor show     <id|slug>       inspect a model: runtime, effective config, launch command
athanor snippet  <id|slug>       generate OpenAI API and pi-agent integration code snippets
athanor start    <id|slug>       start a model
athanor stop     [<id|slug>|--all]stop one or all
athanor restart  <id|slug>       stop + start
athanor logs     <id|slug> [-n N] tail last N lines of a running model's log
athanor pull     <repo> [--file F] [--revision R]
                                 download from HuggingFace and register
athanor search   [q] [--mlx|--gguf|--any] [--author A] [--sort S] [--limit N]
                                 search the HuggingFace Hub
athanor trending [--mlx|--gguf] [--limit N]
                                 top trending MLX/GGUF models
athanor formula  <slug> show|set k=v...|unset k...|clear|apply <name>|save <name>
                                 view or modify a model's formula
athanor formulas [delete <name>] list or manage formulas in library
athanor flavor   <slug> lm|vlm   force MLX runtime flavor (lm = mlx_lm, vlm = mlx_vlm)
athanor expose    <id|slug>      include in pi-agent catalog
athanor hide      <id|slug>      remove from pi-agent catalog
athanor rm       <id|slug>       remove from registry (must be stopped)
athanor sync                     manually rewrite pi catalog
athanor router   [--host H] [--port P] [--verbose]
                                 run the ingress server in the foreground
athanor config                   print resolved config and its path
athanor doctor                   check that required binaries are on PATH and show installed versions
athanor doctor --check-updates   also compare installed versions with latest available and print upgrade hints
```

`<id|slug>` accepts either the canonical id or the short slug.

## TUI key bindings

| key        | action                                              |
| ---------- | --------------------------------------------------- |
| `↑` / `↓` / wheel | move selection (one entry per wheel notch)   |
| `⏎`        | start (if idle) / stop (if running) the highlighted model |
| `r`        | restart the highlighted model                       |
| `k`        | kill the highlighted model                          |
| `P`        | toggle pi-agent visibility (expose/hide)            |
| `d`        | remove the highlighted entry from the registry      |
| `D`        | open the downloads modal                            |
| `s`        | rescan and ingest new models (automatic on start and when the HF cache changes) |
| `p`        | open the pull modal (`esc` cancels in progress)     |
| `e`        | open the formula editor for the highlighted model   |
| `t`        | open the telemetry modal for the highlighted model  |
| `/`        | filter the list by substring of slug or id          |
| `tab`      | hide the model selector and expand the log pane; press again to restore |
| `q`        | quit (does **not** stop running models)             |

The downloads modal shows queued/running/completed pulls. Inside it: `↑↓` selects a task, `c` cancels the selected running task, `C` clears finished tasks, and `esc` closes the modal. Inside the formula editor (`e`): `Tab` toggles between Simple and Advanced modes. In Simple mode: `↑↓` selects smart compound knobs (Context, KV Cache, Speculative, Sampling Mode, GPU Offload), `◀/▶` cycles options, and `⏎` enters custom values. In Advanced mode: keys are grouped by category with full granular control. In both modes: `1-7` applies formulas, `s` saves custom formulas, `y` copies formula config & command to clipboard, `u` unsets a field, `c` prompts confirmation to clear, `v` toggles MLX flavor (`lm`/`vlm`), and `esc` closes.

With the selector hidden (`tab`), the log pane grows to fill the space and the arrow keys switch roles:

| key                   | action                                               |
| --------------------- | ---------------------------------------------------- |
| mouse wheel           | scroll the log (3 lines per notch)                   |
| `↑` / `↓`             | scroll the log one line at a time                    |
| `PgUp` / `PgDn`       | scroll by half a page                                |
| `g` / `Home`          | jump to the top of the buffer                        |
| `G` / `End`           | jump back to the tail (resumes live follow)          |

When scrolled up, the header shows `+N ↑  paused` and the log stops auto-updating until you return to the tail. All other keys (`r`, `k`, `⏎`, `tab`) still act on the model you had selected before hiding the list.

Mouse reporting is enabled only while the TUI is running (SGR mode, `\x1b[?1000h\x1b[?1006h`) and disabled on exit, including on uncaught exceptions and `SIGTERM`/`SIGHUP`. While it's active, click-and-drag text selection in some terminals (iTerm2, Terminal.app) requires holding `⌥`/`Alt`; copy-on-select typically still works. If the process is killed with `SIGKILL`, nothing can reset the terminal — run `reset` or relaunch the TUI to restore it.

The bottom pane continuously tails the log file of whichever model is highlighted. When any model enters the running set — whether you started it, restarted it, or the router auto-started it on an incoming request — the cursor jumps to it so its logs appear immediately; if an active filter hides the newcomer, the filter is cleared.

Press `tab` for a full-screen log view that shows model details (id, runtime, port, path), live instance telemetry (pid, uptime, CPU, RSS, tok/s), and a larger log tail. It honors the same cursor-follows-active behavior, so a router-driven model swap auto-switches the view to the new active model. `tab` again returns to the split list+log layout.

Models downloaded out-of-band (`hf download` in another terminal, or pulled while the TUI was closed) are picked up automatically: every TUI start runs a scan, and while the TUI is running an `fs.watch` on `modelDirs.mlx` / `modelDirs.llama` debounces cache changes into an incremental `ingestDiscovered` call. New entries toast in the footer as `+N new: <slug>…`. Pressing `s` still works as an explicit rescan.

## Configuration

`~/.athanor/config.json`. Missing fields fall back to these defaults:

```json
{
  "portRange": { "min": 40880, "max": 40979 },
  "enablePiSync": true,
  "modelDirs": {
    "mlx": "~/.cache/huggingface/hub",
    "llama": "~/.models"
  },
  "mlx": {
    "prefillStepSize": 512,
    "promptCacheSize": 32768,
    "decodeConcurrency": 1
  },
  "llama": {
    "nGpuLayers": 999,
    "threads": 8,
    "ctxSize": 32768,
    "batchSize": 512,
    "ubatchSize": 256,
    "parallel": 1
  },
  "supervisor": {
    "policy": "single-active",
    "maxConcurrent": 1,
    "startupTimeoutMs": 120000,
    "healthPollIntervalMs": 500
  },
  "controlApi": {
    "enabled": false,
    "port": 40878,
    "host": "127.0.0.1"
  },
  "router": {
    "enabled": true,
    "port": 40879,
    "host": "127.0.0.1",
    "drainTimeoutMs": 30000,
    "verbose": false
  }
}
```

### Per-model formulas

`mlx` and `llama` above are **global defaults**. Athanor ships a practical 64K default context baseline; built-in formulas scale that up or down by use case. Any model in the registry can override the globals with its `formula` field, which is merged on top per-runtime. Manage formulas via the CLI (preferred) or the TUI (press `e` on a highlighted model):

```bash
# inspect effective config, launch command, and running state
athanor show qwen-32b

# set / unset individual fields — kebab-case and camelCase both work
athanor formula qwen-32b set ctx-size=32768 nGpuLayers=48
athanor formula qwen-32b unset ctx-size
athanor formula qwen-32b clear

# apply a named formula for the model's runtime
athanor formula qwen-32b apply thinking

# save a model's current formula tuning as a reusable custom formula
athanor formula qwen-32b save my-reasoning-formula

# list built-in + user formulas and every tunable key per runtime
athanor formulas

# delete a custom formula from your library
athanor formulas delete my-reasoning-formula
```

*(Note: `athanor preset` and `athanor recipes` remain supported as backward-compatible aliases).*

Built-in formulas: `balanced`, `fast`, `long-context`, `q8-kv`, `thinking`, `instruct`, `mtp`.

- `balanced` — recommended default, 64K context
- `fast` — lower latency, 8K context
- `long-context` — 128K context for large documents (with Q8_0 KV cache on both MLX and llama.cpp)
- `q8-kv` — Q8_0 KV cache quantization for reduced memory footprint across both MLX and llama.cpp
- `thinking` — reasoning model sampling (temp=1.0, topP=0.95, topK=20)
- `instruct` — standard instruct sampling (temp=0.7, topP=0.80, presencePenalty=1.5)
- `mtp` — Multi-Token Prediction speculative decoding (requires an MTP-capable GGUF model)

`balanced` is an explicit formula; clearing a formula is a separate action (`athanor formula <slug> clear`). Save your own tuning as custom named formulas via `athanor formula <slug> save <name>` or by editing `~/.athanor/formulas.json` (a plain list or `{ "formulas": [...] }`). User formulas override built-ins of the same name.

Formulas survive re-scans: `athanor scan` only refreshes `path`, `sizeBytes`, and — for MLX — `mlxCapabilities`. Everything else is left alone. `athanor ls` marks tuned models with `[tuned]`.

Under the hood, a formula looks like this in `~/.athanor/models.json` — you can edit it directly if you prefer:

```json
{
  "id": "mlx-community/Qwen2.5-32B-Instruct-4bit",
  "slug": "qwen-32b",
  "formula": {
    "runtime": "mlx",
    "mlx": { "decodeConcurrency": 1, "prefillStepSize": 512, "promptCacheSize": 32768 }
  }
}
```

Restart the model for the formula to take effect.

pi-agent receives the model's effective served context window from athanor's merged runtime configuration (global defaults plus any per-model formula), so pi metadata matches the actual launch settings rather than only explicit override fields.

### KV Cache Quantization & Flash Attention (llama.cpp only)

Large context windows (32K–128K+) with default FP16 KV cache can consume 10–30+ GB of memory alone. On Apple Silicon unified memory, this can trigger OS paging and swap thrashing, collapsing throughput from 15+ tok/s down to single digits.

Quantizing the KV cache to `q8_0` (or `q4_0`) roughly halves the KV cache memory while preserving reasoning accuracy:

```bash
# Halve KV cache size with Q8_0 quantization and enable Flash Attention
athanor preset qwen-27b set cache-type-k=q8_0 cache-type-v=q8_0 flash-attn=on

# Or apply the built-in q8-kv recipe
athanor preset qwen-27b apply q8-kv
```

Available keys:
- `cache-type-k` / `cacheTypeK` / `ctk` — KV cache key data type (`f16`, `q8_0`, `q4_0`, `q4_1`, `iq4_nl`, `q5_0`, `q5_1`, `bf16`, `f32`)
- `cache-type-v` / `cacheTypeV` / `ctv` — KV cache value data type (`f16`, `q8_0`, `q4_0`, etc.)
- `flash-attn` / `flashAttn` / `fa` — Flash Attention mode (`on`, `off`, `auto`). Required when using quantized KV cache in `llama.cpp`.
- `spec-draft-type-k` / `specDraftCacheTypeK` / `ctkd` — Draft model KV cache key data type
- `spec-draft-type-v` / `specDraftCacheTypeV` / `ctvd` — Draft model KV cache value data type

### Speculative Decoding & MTP (llama.cpp only)

Recent builds of `llama.cpp` support speculative decoding and Multi-Token Prediction (MTP) draft decoding. This can speed up token generation by 1.5–2× on Apple Silicon.

Configure these parameters on a GGUF model via a preset:

```bash
# Example 1: Multi-Token Prediction (MTP) for models with built-in draft heads
# (MTP draft heads are baked into the model weights, so spec-draft-model is NOT required)
athanor preset deepseek-coder set spec-type=draft-mtp spec-draft-ngl=32

# Example 2: Traditional speculative decoding using a separate small draft model
athanor preset llama-3 set spec-type=draft spec-draft-model=~/.models/llama-3-draft.gguf spec-draft-ngl=32
```

Available keys:
- `spec-type` / `specType` — Speculative decoding type (`draft-mtp`, `draft`, `draft-simple`, `ngram-simple`, etc.)
- `spec-draft-model` / `specDraftModel` — Path/repo/file of the separate draft model (not required for `draft-mtp`)
- `spec-draft-ngl` / `specDraftNgl` / `ngl-draft` — Number of draft model GPU layers to offload to Metal (highly recommended on Apple Silicon so draft evaluation runs on GPU)
- `spec-draft-n-max` / `specDraftNMax` — Max tokens to draft per step (default: 3)
- `spec-draft-n-min` / `specDraftNMin` — Min tokens to draft per step
- `spec-draft-p-min` / `specDraftPMin` — Min draft confidence threshold (default: 0.00)
- `spec-draft-p-split` / `specDraftPSplit` — Split probability (default: 0.10)

Athanor performs cross-field validation on these settings during `athanor show <slug>` and alerts you of potential issues (e.g., if you configure draft options without a `spec-type`, or if you specify a draft model for `draft-mtp` where it is ignored).

### Reasoning Effort (llama.cpp only)

Models with thinking/reasoning templates (e.g. Qwen3.8-27B) consume a `reasoning_effort` parameter (`xhigh`, `medium`, `low`). Stock templates default to `xhigh`, which can lead to expensive 20+ minute generations and 20,000+ reasoning tokens.

Athanor provides first-class, model-validated reasoning effort support:

```bash
# Set reasoning effort via formula
athanor formula qwen3.8-27b set reasoning-effort=medium

# Or using aliases: reasoningEffort, reasoning_effort, effort
athanor formula qwen3.8-27b set effort=low
```

Features:
- **Write-time validation:** Rejects invalid effort strings or attempts to configure reasoning effort on unsupported models before modifying processes.
- **Enforced safe default:** When registering models whose templates default to `xhigh`, Athanor automatically sets a formula default of `medium`.
- **Dynamic proxy handling:** Injects the model's formula default on chat completions when omitted by the client, validates client-supplied overrides against the model's allowed enum (returning 400 Bad Request if invalid), and strips reasoning effort for unsupported models to prevent template crashes in `llama-server`.
- **TUI integration:** The Preset Editor includes a compound knob for Reasoning Effort on supported models.

### Environment variables

- `ATHANOR_HOME` — overrides `~/.athanor`. Useful for running multiple profiles side by side or for tests.
- `PI_HOME` — overrides `~/.pi`.

## Finding new models

Browse the Hub without leaving the terminal. Both commands query `https://huggingface.co/api/models` with MLX/GGUF tag filters and print a grouped, readable list. No auth is required for public models.

```bash
# free-text search, both runtimes (default)
athanor search qwen

# restrict to one runtime
athanor search coder --mlx
athanor search llama --gguf

# by author and sort key
athanor search --author mlx-community --sort downloads --limit 30
athanor search --author bartowski --gguf --sort likes

# what's hot right now (sorts by HF's trendingScore)
athanor trending
athanor trending --mlx --limit 15
```

Supported sorts: `downloads` (default), `likes`, `trending`, `modified`, `size`. Each row shows download count, likes, license, and a relative last-modified time.

Search is intentionally biased toward athanor's actual domain: the Hub query asks for `pipeline_tag=text-generation`, and athanor also prunes obvious non-LLM tasks client-side (ASR, TTS, feature-extraction, image-generation, etc.). The goal is to surface local text-generation candidates for MLX / llama.cpp, not to behave like a general-purpose Hugging Face browser.

The footer hints at the follow-up:

```
→ athanor pull <repo>                 # MLX: downloads the whole repo
→ athanor pull <repo> --file F.gguf   # GGUF: pick one file
```

## HuggingFace pull

```bash
athanor pull mlx-community/Qwen2.5-7B-Instruct-4bit
athanor pull bartowski/Meta-Llama-3.1-8B-Instruct-GGUF \
  --file Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf
```

What happens:

1. `GET https://huggingface.co/api/models/<repo>` is used to list siblings and decide runtime.
   - any `.gguf` sibling → `llama.cpp` (you must specify `--file` if more than one exists)
   - `tags: ["mlx"]` or `mlx` in the repo id → `mlx`
   - `.safetensors` only, nothing matching MLX → fallback to `mlx`
2. `hf download` is invoked, output streamed.
3. On success, a registry entry is created with `publish: true`, a fresh port from `portRange`, and `piAlias: slug`.

Cancellation is safe: press `Ctrl-C` during `athanor pull` (or `Esc` in the TUI pull modal) and athanor SIGTERMs the `hf` child — escalating to SIGKILL after 3s if it ignores the signal — and exits with code 130. No registry entry is written on abort, so you can re-run the same `pull` later without cleanup.


## Control API (optional)

When `controlApi.enabled` is `true`, athanor exposes a small local HTTP server (default `127.0.0.1:40878`) that other tools can drive:

```
GET  /status                     running instances + registry summary
POST /activate      { "id": "<id|slug>" }   start a model (respects supervisor policy)
POST /deactivate    { "id": "<id|slug>" }   stop a model
```

This is off by default. Enable it only on trusted machines.

## Ingress

Athanor exposes an OpenAI-compatible ingress (default `127.0.0.1:40879`) that fronts every exposed model on a single port. Pi-agent sees up to **two** providers — `athanor-mlx` and `athanor-llama` — both pointing at that ingress, each listing only models of its runtime. The split exists because pi's per-provider compat flags differ between engines (mlx_lm/vlm don't accept the `developer` role; llama-server does), and it also makes it obvious in pi's `/model` picker which backend is serving a given request. Switching models inside pi becomes a normal "different `model` field in the request body" swap, and athanor starts the target on demand (respecting supervisor policy) before proxying the request.

Ingress lifecycle follows active model serving state rather than the foreground TUI. When athanor is open it ensures ingress availability; when active models remain after the UI exits, the detached ingress companion stays up; when the last model stops, the detached ingress companion stops too. This lets you start a model, close the TUI, and keep pi-agent connectivity until you stop or switch models. Reopening the TUI later reattaches to the same detached runtime/ingress state and reflects ingress-driven model switches from persisted instance state.

```
GET  /health                                200 OK
GET  /v1/models                             synthesised list of exposed models
POST /v1/chat/completions  { "model": ... } activate + proxy (SSE streamed through)
POST /v1/completions       { "model": ... } same
POST /v1/embeddings        { "model": ... } same
```

The ingress config lives under `router` in `~/.athanor/config.json` for backward compatibility:

```json
{ "router": { "enabled": true, "port": 40879, "host": "127.0.0.1", "drainTimeoutMs": 30000, "verbose": false } }
```

By default, pi sync emits the ingress-backed aggregator providers (not per-model providers). If you've exposed only MLX models you'll see `athanor-mlx` alone; only GGUF, just `athanor-llama`. The `model` field in requests may be the runtime model id (HF repo for MLX; registry `author/repo:file.gguf` for hub GGUF; custom `piAlias` or slug for local llama), the athanor slug, or the canonical registry id; all resolve. Unknown models return `404`.

For users who don't want to keep the TUI open, `athanor router` runs the ingress server in the foreground and blocks on `Ctrl-C`:

```bash
athanor router                       # uses config.router.host / .port
athanor router --port 9000           # override
athanor router --host 0.0.0.0 --port 40879
athanor router --verbose             # log every request to ~/.athanor/logs/router.log
```

The subcommand ignores `router.enabled` — invoking it is itself the opt-in — but it still respects `127.0.0.1` as the default host.

### Verbose request logging

When `router.verbose` is `true` in config (or `--verbose` is passed on the command line), the ingress logs every inbound request — method, path, model field (for POST), response status, and latency in milliseconds — to `~/.athanor/logs/router.log`. This is useful for diagnosing routing, cold-start latency, and model resolution issues without needing to intercept traffic externally. Off by default to avoid noise.

Caveats:

- **Cold start.** First request on an idle model blocks until the runtime is healthy (often 10–60s for large MLX). No keepalive is injected into the stream — make sure your client's timeout is generous.
- **In-flight safety.** `athanor stop` on a currently-streaming model waits briefly (up to `router.drainTimeoutMs`, default 30s) for open proxied streams to finish before SIGTERM; past that, the runtime is terminated and in-flight responses are cut.
- **Listen posture.** Same as the control API: `127.0.0.1` only, no auth.

## Troubleshooting

- **`athanor start` hangs or times out.** Check `~/.athanor/logs/<slug>-<pid>.log`. Most startup failures are the runtime itself complaining (missing weights, wrong quant, out of memory). Raise `supervisor.startupTimeoutMs` for very large models.
- **`port already in use`.** Another process is on the model's stable port. Either stop it, or edit the entry's `port` in `~/.athanor/models.json` and restart.
- **Pi-agent can't see a new model.** Make sure it's exposed (CLI: `athanor expose <slug>`) and run `athanor sync`. Confirm `~/.pi/agent/models.json` contains the expected athanor provider shape (per-model when `router.enabled` is false, `athanor-mlx` / `athanor-llama` aggregators when true — the default), then open `/model` in pi (the file reloads on open). If you upgraded athanor and llama model ids changed, restart the model after syncing.
- **Models from other tools disappeared from pi.** They shouldn't — athanor only rewrites providers whose name starts with `athanor-`. If this happens, open an issue with the before/after of `~/.pi/agent/models.json`.
- **Stale PID / router state.** If a child or detached router crashed without athanor noticing, reopening athanor or running `athanor sync` / `athanor status` will reconcile persisted state and clear dead router metadata opportunistically. If a model port is still held, run `athanor stop <slug>` (a no-op when nothing is live) then `athanor start <slug>`.
- **`doctor` reports a missing binary.** Install `mlx_lm`, `mlx_vlm`, `llama.cpp`, or `huggingface_hub`, or adjust your shell's `PATH`. `mlx_vlm.server` is only needed if you plan to run VLM models; `athanor start` on a VLM entry will fail with a clear error if it's missing.
- **`doctor --check-updates` reports `update available`.** Follow the printed one-line hint. Today the built-in hints cover uv-managed Python tools (`uv tool upgrade mlx-lm`, `uv tool upgrade mlx-vlm`, `uv tool upgrade hf`) and Homebrew's `llama.cpp` formula (`brew upgrade llama.cpp`).

## Development

```bash
npm install
npx tsc --noEmit      # typecheck
npm run test:run      # vitest run (one shot)
npm test              # vitest (watch)
npm run build         # tsc -> dist/
```

Tests redirect `ATHANOR_HOME` and `PI_HOME` to per-run temporary directories via `test/setup.ts`, so running the suite never touches your real config.

### Layout

```
src/
  adapters/     # mlx (lm + vlm) + llama.cpp command builders, health probes, runtime model ids
  cli/          # hand-rolled CLI dispatcher, doctor, output formatting
  config/       # config file load + defaults
  control/      # optional HTTP control API (off by default)
  discovery/    # HF cache scanner + registry ingest (MLX capability detection lives here)
  presets/      # preset merge, tunable-key metadata, recipes
  pull/         # HuggingFace repo inspection and download
  registry/     # models.json CRUD, slug + port allocation, dedup, display labels
  search/       # HuggingFace Hub search + trending
  supervisor/   # detached process lifecycle, policy, reattach
  sync/         # namespaced pi-agent catalog merge
  ui/           # Ink TUI (list, pull modal, preset editor)
  types/        # shared types
```
## Credits and Acknowledgements

Parts of Athanor's technical implementation, mathematical equations, and developer features were inspired by and adapted from the open-source project [whichllm](https://github.com/Andyyyy64/whichllm) under the MIT License:

- **Memory Bandwidth & Hardware Profiling**: Unified memory bandwidth constants mapped from sysctl-reported chip names (`src/machine/profile.ts`).
- **Context-Aware VRAM Footprint Calculations**: Context-aware VRAM footprint calculations using FP16 coefficients (3.5 MB per B-active-param per K-context-token), MoE multipliers, and dynamic activation sizes (`src/registry/recommend.ts`).
- **Programmatic Search Synthesis**: Programmatically converting raw safetensors base models into realistic MLX and GGUF quantized variant search results (`src/search/hf.ts`).
- **Developer Snippets Command**: The `athanor snippet` command templates for client integration (`src/cli/snippet-commands.ts`).

We thank `@Andyyyy64` and the `whichllm` contributors for their excellent research and open-source contributions.

---

## License

Copyright 2026 Myles Borins.

Licensed under the Apache License, Version 2.0. See [`LICENSE`](./LICENSE) for the full text, or <http://www.apache.org/licenses/LICENSE-2.0> for the canonical copy.
