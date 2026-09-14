# Architecture & Ingress

This document details athanor's process lifecycle, OpenAI-compatible ingress proxy, pi-agent catalog synchronization, supervisor policies, and configuration reference.

---

## High-Level Design

Athanor is designed for Apple Silicon workstations. It is **not a daemon** and has no background network listeners unless runtime processes or the ingress companion are actively serving requests.

```
┌─────────────────────────────────────────────────────────────┐
│                    Clients (pi-agent, curl)                 │
└──────────────────────────────┬──────────────────────────────┘
                               │
               http://127.0.0.1:40879/v1 (Ingress)
                               │
       ┌───────────────────────┴───────────────────────┐
       ▼                                               ▼
┌──────────────┐                               ┌──────────────┐
│  athanor-mlx │                               │ athanor-llama│
│  (aggregator)│                               │ (aggregator) │
└──────┬───────┘                               └───────┬──────┘
       │                                               │
       ▼ (proxies to active port)                      ▼
┌──────────────────────────────┐       ┌──────────────────────────────┐
│  mlx_lm.server / mlx_vlm     │       │         llama-server         │
│  Port: 40880 (stable)        │       │    Port: 40881 (stable)      │
└──────────────────────────────┘       └──────────────────────────────┘
```

---

## The Ingress Server

Athanor includes an OpenAI-compatible reverse proxy (default `127.0.0.1:40879`) that fronts every exposed model on a single endpoint.

### Supported Endpoints

```
GET  /health                                200 OK
GET  /v1/models                             List exposed models with capabilities
POST /v1/chat/completions  { "model": ... } Activate model + proxy stream (SSE)
POST /v1/completions       { "model": ... } Activate model + proxy stream
POST /v1/embeddings        { "model": ... } Activate model + proxy embeddings
```

### Key Ingress Capabilities

1. **Flexible Model Resolution**:
   Incoming requests can specify the model using:
   - The Hugging Face repo ID (`mlx-community/Qwen3.5-9B-MLX-4bit`)
   - The athanor slug (`qwen3-5-9b-mlx-4bit`)
   - The GGUF canonical ID (`unsloth/Qwen3.6-27B-GGUF:Qwen3.6-27B-Q4_K_M.gguf`)
   - The custom pi alias
2. **On-Demand Activation**:
   If a client requests a model that is currently idle, the ingress automatically boots the model (stopping others if following `single-active` policy) and holds the incoming request until the runtime is healthy.
3. **In-Flight Stream Protection**:
   When stopping a model or switching models, the ingress drains open proxied streams up to `drainTimeoutMs` (default: 30 seconds) before sending SIGTERM, preventing severed responses mid-generation.
4. **Detached Companion Lifecycle**:
   When active models are running, the ingress runs as a detached companion process. If you exit the TUI, the ingress remains alive to serve downstream tools. When the last model stops, the companion ingress stops automatically.
5. **Standalone Ingress**:
   To run the ingress in the foreground without opening the TUI:
   ```bash
   athanor router
   athanor router --port 8000 --verbose
   ```
   When `--verbose` is passed, inbound requests (method, path, target model, status, and latency) are logged to `~/.athanor/logs/router.log`.

---

## Pi-Agent Catalog Synchronization

Athanor integrates seamlessly with [pi-agent](https://github.com/badlogic/pi-mono). Every time models are exposed, hidden, started, or updated, athanor synchronizes `~/.pi/agent/models.json`.

### Aggregator Providers (Default: `router.enabled: true`)

Pi-agent sees up to two providers pointing at the ingress:
- `athanor-mlx` (configured with MLX compatibility flags, e.g. `supportsDeveloperRole: false`)
- `athanor-llama` (configured with `llama.cpp` compatibility flags)

Providers with zero exposed models are suppressed. Switching models inside pi-agent is instantaneous: pi sends the request with the new model ID, and the ingress swaps the active model automatically.

```json
{
  "id": "mlx-community/Qwen3.5-9B-MLX-4bit",
  "name": "[mlx] mlx-community/Qwen3.5-9B-MLX-4bit (athanor)",
  "input": ["text"],
  "contextWindow": 65536
}
```

### Direct Per-Model Providers (`router.enabled: false`)

If you disable the ingress, athanor switches to direct mode: each exposed model becomes its own pi provider named `athanor-<runtime>-<slug>`, each pointing to that model's dedicated stable port.

### Load-Bearing Pi Invariants

1. **Non-Athanor Providers are Preserved**: Providers without the `athanor-` prefix (OpenAI, Anthropic, Ollama, OpenRouter, custom keys) round-trip untouched.
2. **Settings Isolation**: `~/.pi/agent/settings.json` is only touched when an athanor model is started as the active default (`defaultProvider` and `defaultModel`).
3. **Context Accuracy**: Context window values advertised to pi reflect the merged effective runtime context (global config + formula overrides), not theoretical model maximums.

---

## Stable Per-Model Ports

Every registered model is assigned a port from `portRange` (default: `40880`–`40979`) on first discovery and keeps that port forever in `~/.athanor/models.json`.

- Ports never change behind the user's back across machine reboots.
- Switching between active models never requires reconfiguring downstream tools.
- On load, athanor cleans up any duplicate registry entries sharing the same normalized path and resolves port collisions.

---

## Supervisor & Policies

Athanor supervises model runtimes as detached child processes:
- `detached: true` with `proc.unref()`, allowing CLI/TUI sessions to exit without terminating running models.
- Standard I/O is redirected to `~/.athanor/logs/<slug>-<pid>.log`.
- State is tracked in `~/.athanor/state.json`, allowing subsequent CLI commands and the TUI to reattach cleanly.
- Health readiness is determined by polling the runtime's health endpoint (`/v1/models` for MLX, `/health` for llama.cpp), not by fragile stdout regexes.

### Eviction Policies

Configured under `supervisor.policy`:

| Policy | Behavior |
|---|---|
| `single-active` (default) | Starting model B gracefully stops model A. Best for typical Macs to maximize RAM for one large model. |
| `multi-active-lru` | Keeps up to `supervisor.maxConcurrent` models alive; evicts least-recently used when capacity is reached. |
| `manual` | Never stops running instances automatically; user explicitly runs `athanor stop`. |

---

## MLX Capabilities vs. Flavor Routing

MLX models maintain a strict separation between detected capabilities and user launch intent:

- **`mlxCapabilities`**: Detected fact from inspecting the snapshot's `config.json` for vision towers (`vision_config`, `model_type` like `qwen2_vl`, `llava`, etc.). Refreshed automatically during `athanor scan`.
- **`mlxFlavor`**: User intent for which server binary to execute:
  - `"lm"` (default): Uses `mlx_lm.server`. Lightweight, faster loading, requires no PyTorch. Serves text-only chat even for many VLM-tagged models.
  - `"vlm"`: Uses `mlx_vlm.server`. Requires PyTorch and Torchvision. Needed for image inputs.

Set flavor explicitly via:
```bash
athanor flavor <slug> vlm
athanor flavor <slug> lm
```

---

## Control API (Optional)

When `controlApi.enabled: true`, athanor provides a lightweight HTTP control API on `127.0.0.1:40878`:

```
GET  /status                    Returns running instances and registry summary
POST /activate   { "id": "..." } Starts a model (respecting supervisor policy)
POST /deactivate { "id": "..." } Stops a model
```

---

## Configuration Reference (`~/.athanor/config.json`)

```json
{
  "portRange": { "min": 40880, "max": 40979 },
  "enablePiSync": true,
  "modelDirs": {
    "mlx": "~/.cache/huggingface/hub",
    "llama": "~/.models"
  },
  "mlx": {
    "prefillStepSize": 2048,
    "promptCacheSize": 65536,
    "decodeConcurrency": 1,
    "contextWindow": 65536,
    "maxTokens": 4096,
    "promptCacheBytes": 0,
    "temp": 0,
    "topP": 1,
    "topK": 0,
    "minP": 0,
    "promptConcurrency": 8
  },
  "llama": {
    "nGpuLayers": 999,
    "ctxSize": 65536,
    "batchSize": 2048,
    "ubatchSize": 512,
    "parallel": 1,
    "speculativeMode": "auto"
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

### Environment Variables

- `ATHANOR_HOME`: Overrides the default `~/.athanor` configuration directory.
- `PI_HOME`: Overrides the default `~/.pi` configuration directory.
