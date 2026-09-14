# Troubleshooting Guide

Common issues, diagnosis steps, and resolutions for athanor.

---

## 1. Model Fails to Start or Times Out

**Symptoms:** `athanor start <slug>` hangs or exits with a timeout error.

**Diagnosis:**
Inspect the model's process log:
```bash
athanor logs <slug> -n 100
# Or inspect the file directly:
cat ~/.athanor/logs/<slug>-*.log | tail -n 100
```

**Common Causes & Fixes:**
- **Out of Unified Memory (OOM):** Large models may exceed available system RAM. Use a smaller quantization (e.g. 4-bit instead of 8-bit), reduce the context window with `athanor formula <slug> set ctx-size=16384`, or enable quantized KV cache (`cache-type-k=q8_0`).
- **Slow SSD Load Times:** 70B+ parameter models can take 60–120 seconds to load weights from disk into Metal memory. Increase the startup timeout in `~/.athanor/config.json`:
  ```json
  "supervisor": {
    "startupTimeoutMs": 180000
  }
  ```

---

## 2. "Port already in use"

**Symptoms:** Error stating the model's assigned port is occupied by another process.

**Fixes:**
1. Check what is holding the port:
   ```bash
   lsof -i :<port>
   ```
2. If it is a lingering unmanaged runtime from an earlier crash, terminate it:
   ```bash
   kill -9 <PID>
   ```
3. Or manually reassign a fresh port in `~/.athanor/models.json` and restart.

---

## 3. MLX VLM: `PyTorch library not found`

**Symptoms:** Requesting a vision model running under `mlx_vlm.server` crashes with:
```
Qwen3VLVideoProcessor requires the PyTorch library but it was not found in your environment
```

**Cause:** `mlx-vlm` relies on Hugging Face transformers processors that import PyTorch.

**Fix:** Reinstall `mlx-vlm` with `torch` and `torchvision` in the same Python environment:
```bash
# uv
uv tool install mlx-vlm --with torch --with torchvision

# pipx
pipx inject mlx-vlm torch torchvision

# Active virtualenv
pip install -U mlx-vlm torch torchvision
```

*Note:* If you only need text chat from a vision model (e.g. Qwen2.5-VL), you can avoid PyTorch entirely by using the default `lm` flavor:
```bash
athanor flavor <slug> lm
```

---

## 4. Pi-Agent Cannot See New Models

**Symptoms:** You pulled a model, but it does not appear in pi-agent's `/model` picker.

**Checklist:**
1. **Is the model exposed?** Check `athanor ls`. If `[pi]` is missing, run:
   ```bash
   athanor expose <slug>
   ```
2. **Synchronize pi-agent catalog:**
   ```bash
   athanor sync
   ```
3. **Verify `~/.pi/agent/models.json`:**
   Inspect `~/.pi/agent/models.json`. You should see `athanor-mlx` or `athanor-llama` listed under `providers`.
4. **Reload in pi-agent:** Pi-agent reloads provider definitions when you re-open the `/model` selector dialog.

---

## 5. Non-Athanor Providers Disappeared from Pi-Agent

Athanor strictly preserves non-athanor providers (OpenAI, Anthropic, Ollama, OpenRouter, etc.) in `~/.pi/agent/models.json`. It only touches entries prefixed with `athanor-`.

If other entries were affected, verify if an external tool formatted `~/.pi/agent/models.json`, and file an issue on GitHub with your before/after files.

---

## 6. Stale Process State & Companion Recovery

If your machine rebooted unexpectedly or a process was killed externally with `SIGKILL`:
- Run `athanor status` or `athanor sync`. Athanor reconciles dead processes against `~/.athanor/state.json` and cleans up stale PIDs opportunistically.
- To restart an active model:
  ```bash
  athanor stop <slug>
  athanor start <slug>
  ```

---

## 7. Verifying and Updating Runtimes

Run `athanor doctor` to verify your environment:

```bash
athanor doctor
```

Check if newer versions of your tools are available:

```bash
athanor doctor --check-updates
# Follow printed hints:
#   uv tool upgrade mlx-lm
#   uv tool upgrade mlx-vlm
#   brew upgrade llama.cpp
#   uv tool upgrade huggingface_hub
```

---

## 8. Log Locations

- **Per-model runtime logs:** `~/.athanor/logs/<slug>-<pid>.log`
- **Ingress request logs:** `~/.athanor/logs/router.log` (when `router.verbose: true` or `--verbose` flag is passed)
- **Active registry:** `~/.athanor/models.json`
- **State cache:** `~/.athanor/state.json`
