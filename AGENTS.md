# AGENTS.md

Orientation for contributors and AI agents working on athanor. Read this before making changes; the invariants below are not negotiable without an explicit user decision.

## What athanor is

A local LLM workbench for Apple Silicon. It scans the Hugging Face cache, registers MLX and `llama.cpp` (GGUF) models in `~/.athanor/models.json`, assigns each one a **stable port**, supervises detached child processes, and exposes models to [pi-agent](https://github.com/badlogic/pi-mono) as one custom provider per model. Surfaces are an Ink TUI (`athanor`) and a hand-rolled CLI (`athanor <cmd>`).

Not a library. Not a daemon. No network listeners except the runtime children themselves (and an optional local control API, off by default).

## Invariants

These are load-bearing. If a change seems to need to break one, stop and ask.

1. **Stable port per model.** Ports are allocated on first discovery from `config.portRange` and persisted on the registry entry forever. A model's port never changes behind the user's back; pi-agent provider URLs must be stable across restarts.
2. **Atomic registry writes.** `~/.athanor/models.json` is always written via temp-file + rename in `src/registry/index.ts`. Never partial-write it, never keep it open across awaits.
3. **Preserve non-athanor pi entries.** `src/sync/pi.ts` rewrites only providers whose name starts with `athanor-`. Everything else in `~/.pi/agent/models.json` (OpenAI, Anthropic, Ollama, OpenRouter, user customs) must round-trip untouched. Same for `~/.pi/agent/settings.json` — only `defaultProvider` / `defaultModel` are touched, and only when a model is started as the active default.
4. **Pi sync shape follows `config.router.enabled`.** Default (router off): each exposed athanor model becomes its own pi provider `athanor-<runtime>-<slug>` with one `baseUrl` per model. Router on: up to two aggregator providers — `athanor-mlx` and `athanor-llama` — both pointing at the router `baseUrl`, each listing only models of its runtime and carrying runtime-specific compat flags (MLX sets `supportsDeveloperRole: false`; llama-server doesn't). A provider with zero exposed members is suppressed. Never emit both shapes. The CLI verbs are `expose` / `hide`; the underlying registry field is `publish: boolean` (storage name, kept stable for backward-compat of on-disk `models.json`).
5. **Runtime model id matches launch argument literally.** `mlx_lm.server` compares the request's `model` field to whatever was passed as `--model` and falls back to a HuggingFace network lookup on mismatch. The pi model `id` we emit must equal the adapter's `--model` (or `--alias` for `llama-server`). See `src/sync/pi.ts` and `src/adapters/*.ts`.
6. **MLX capability detection and flavor routing are separate axes.** Two fields live on an MLX entry:
   - `mlxCapabilities: ("vlm")[]` — a detected *fact* about the model (does config.json advertise a vision tower?). Refreshed by `ingestDiscovered` and `pull` via `detectMlxCapabilities()` in `src/discovery/scanner.ts`. Safe to overwrite on re-scan.
   - `mlxFlavor: "lm" | "vlm"` — user *intent* about which server binary to launch. `"vlm"` routes to `mlx_vlm.server`; `"lm"` (or absent) routes to `mlx_lm.server`. Only set by `athanor flavor <slug> lm|vlm` (`cmdFlavor` in `src/cli/commands.ts`). Discovery and ingest must never touch it.

   Detection is advisory because many VLM-tagged repos run fine as text-only under `mlx_lm.server` with no torch/torchvision installed, and that's usually the preferred path. `cmdShow` surfaces the capability with a hint that points at `athanor flavor`. Do not add VLM detection anywhere other than `detectMlxCapabilities`; keep it a single source of truth.
7. **Supervisor default policy is `single-active`.** Starting model B stops model A unless the user opts into `multi-active-lru` (or `manual`) in `config.json`. Policies live in `src/supervisor/policies.ts`.
8. **Presets are additive, scans are non-destructive.** `athanor scan` refreshes `path`, `sizeBytes`, and `mlxCapabilities`. `preset`, `publish`, `piAlias`, `tags`, `port`, `slug`, and `mlxFlavor` must survive re-scans.
9. **All mutations go through helpers.** Use `setPresetFields` / `unsetPresetFields` / `recipeToPreset` from `src/presets/edit.ts` and `updateModel` from `src/registry/index.ts`. Do not hand-edit registry objects in commands or UI components.

## Layout

```
src/
  adapters/     # mlx_lm + mlx_vlm + llama-server command builders, health probes
  cli/          # dispatcher (index.ts), commands.ts, doctor, formatting
  config/       # config load + defaults
  control/      # optional HTTP control API (opt-in)
  discovery/    # HF cache scanner + ingest + fs.watch watcher; detectMlxCapabilities lives here
  presets/      # preset merge, tunable-key metadata, recipes
  pull/         # HF repo inspection + `hf` download wrapper
  registry/     # atomic models.json CRUD, slug + port allocation
  router/       # optional OpenAI-compatible proxy (opt-in, single port)
  search/       # HF Hub search + trending
  supervisor/   # detached process lifecycle, policy, reattach, logs
  sync/         # namespaced pi-agent catalog merge
  ui/           # Ink TUI: App, ModelList, LogTail, PullModal, PresetEditor
  types/        # shared types (ModelEntry, DiscoveredModel, etc.)
test/setup.ts   # redirects ATHANOR_HOME and PI_HOME to a tmp dir per run
```

Entry points: `bin/athanor` → `dist/index.js` (built) or `npm start` (tsx) → `src/index.tsx`, which dispatches to TUI or `src/cli/index.ts` based on argv.

## Development

```bash
npm install
npx tsc --noEmit      # typecheck — must be clean
npm run test:run      # vitest run, one shot
npm test              # vitest in watch mode
npm run build         # tsc -> dist/
```

Tests set `ATHANOR_HOME` and `PI_HOME` to a per-run temp directory via `test/setup.ts`. Running the suite never touches the user's real config. Any new test that reads config must rely on these env vars, not on hardcoded paths.

Before sending a change:

1. `npx tsc --noEmit` clean.
2. `npm run test:run` green.
3. If you added a new command or TUI key, update `README.md` (CLI reference / TUI bindings tables) in the same change.
4. If you touched an invariant above, flag it explicitly in the PR description.

## Onboarding a user

When a user opens this repo with an agent and asks to "set up athanor", work in this order. Nothing below requires edits to tracked files — it's all install, profile, pick, pull, start.

### CLI install modes

`bin/athanor` resolves `../src/index.js` (the compiled entry), so the binary only works after a build. Pick one:

| Mode | Setup | Invocation |
|---|---|---|
| from source, no build | `npm install` | `npm start -- <cmd>` (the `--` forwards args to tsx) |
| linked global | `npm install && npm run build && npm link` | `athanor <cmd>` from anywhere |
| project-local | `npm install && npm run build` | `./bin/athanor <cmd>` or `npx athanor <cmd>` |

Linked mode does not auto-rebuild. Re-run `npm run build` after pulling changes or switch to `npm start` for the dev loop.

### External binaries

Run `athanor doctor` first — it prints presence and paths for each dependency and is the source of truth:

- `mlx_lm.server` — required for MLX text models. `uv tool install mlx-lm` (or `pipx install mlx-lm`).
- `mlx_vlm.server` — optional, for vision MLX models. `uv tool install mlx-vlm --with torch --with torchvision`. The torch/torchvision extras are load-bearing; see the `Qwen3VLVideoProcessor requires the PyTorch library` note in `README.md`.
- `llama-server` — optional, for GGUF models. `brew install llama.cpp` or build from source.
- `hf` — required for `athanor pull`. `uv tool install huggingface_hub --with hf_transfer` (or `pip install -U huggingface_hub[cli]`).

`athanor pull` refuses when `hf` is missing; `athanor start` refuses when the target runtime binary is missing. Neither condition is a reason to edit code — surface the missing tool to the user.

### Profiling the host

Before suggesting a model, confirm Apple Silicon and read the memory ceiling. The signals an agent should gather:

| Signal | Where |
|---|---|
| CPU architecture | `uname -m` — must be `arm64` |
| Chip model | `sysctl -n machdep.cpu.brand_string` |
| Unified memory total | `sysctl -n hw.memsize` (bytes); `os.totalmem()` agrees |
| Memory actually used | `vm_stat` parsed by `parseVmStat` in `src/supervisor/metrics.ts` — `(active + wired + compressor) × pagesize`. Inactive and speculative pages are reclaimable cache, not used. |
| HF cache footprint | `du -sh ~/.cache/huggingface/hub` |
| Registry state | `athanor ls` — when empty it prints curated suggestions sized by segment |

Rule of thumb for 4-bit MLX quants: weights occupy roughly **0.6 GB per billion parameters**, KV cache and context add 1–3 GB, and macOS plus the user's other apps want 6–8 GB. Practical budget: 8 GB Macs → stop at 4B-4bit; 16 GB → 9B-4bit; 32 GB+ → 27B-4bit is comfortable. Never recommend a quant whose on-disk size exceeds `totalMemBytes − currentUsed − 8 GB`.

### Finding models on Hugging Face

Three ordered sources, cheapest first:

1. **Curated suggestions** — `src/pull/suggestions.ts`. Surfaced automatically by `athanor ls` and the TUI empty state. Safe defaults for 8/16/32 GB Macs. Start here unless the user has a specific model in mind.
2. **`athanor search <query>`** — groups results into MLX / GGUF / other. `--mlx` and `--gguf` narrow the filter; `--author mlx-community`, `--sort downloads|likes|trending|modified`, and `--limit N` refine further. `athanor trending` is shorthand for `--sort trending`. Rows carry download count, likes, license, and last-modified — weight those over raw likes when judging a repo.
3. **Direct pull** — `athanor pull <repo>` for an MLX repo, `athanor pull <repo> --file F.gguf` for a specific GGUF file.

Quantization reading:

- **MLX:** prefer `mlx-community/*` — they carry the right conversion manifest. Suffix `-4bit` is the default; `-6bit` / `-8bit` cost ~1.5×/2× disk and memory for modest quality gains; `-bf16` is rarely worth it for serving on a Mac.
- **GGUF:** `Q4_K_M` is the balanced default, `Q5_K_M` / `Q6_K` trade size for quality, `Q8_0` is near-lossless but large. Avoid `Q2_*` and `Q3_*` except on tight memory.

After pull, `athanor show <slug>` shows detected capabilities, resolved launch command, and merged preset. For MLX entries where `caps` includes `vlm`, only flip `athanor flavor <slug> vlm` if the user actually needs image input — most VLM repos serve text fine under `mlx_lm.server` without the torch install (see invariant #6).

## How to add things

- **New adapter (runtime).** Add a file in `src/adapters/`, export `buildCommand(entry, config): { cmd, args }` and a health probe. Register it in `src/adapters/index.ts`. Add a fixture to `__fixtures.ts` and a test alongside.
- **New CLI command.** Add a case in `src/cli/commands.ts` and wire it in `src/cli/index.ts`'s dispatcher. Keep output going through `src/cli/format.ts` / `style.ts` so colors respect `NO_COLOR`.
- **New TUI key.** Bind it in `src/ui/App.tsx`'s `useInput` handler and document it in the footer string and the README key table.
- **New registry field.** Add it to `ModelEntry` in `src/types/index.ts`, teach `ingestDiscovered` how to populate/refresh it, add a migration-safe default (optional field, never required of older entries), and surface it in `athanor show` if user-relevant.
- **New tunable runtime flag.** Add to `TUNABLE_KEYS` in `src/presets/edit.ts` with both kebab-case CLI name and camelCase JSON name, then reference it in the relevant adapter's `buildCommand`.

## Where state lives

| Path | Purpose |
|---|---|
| `~/.athanor/config.json` | user config: scan roots, port range, supervisor policy, control API |
| `~/.athanor/models.json` | registry — source of truth for slugs, ports, presets, publish state |
| `~/.athanor/recipes.json` | optional user recipes; overrides built-ins of the same name |
| `~/.athanor/logs/<slug>-<pid>.log` | per-run supervisor log |
| `~/.athanor/state.json` | running PIDs / ports for reattach (see `src/supervisor/state.ts`) |
| `~/.pi/agent/models.json` | pi-agent providers; athanor namespace only |
| `~/.pi/agent/settings.json` | pi-agent settings; only `defaultProvider` / `defaultModel` touched |
| `~/.cache/huggingface/hub` | HF snapshots scanned by `src/discovery/scanner.ts` |

## Conventions

- TypeScript strict; no `any` unless unavoidable. Prefer `unknown` at boundaries and narrow.
- Functions named after what they do, not how. Side-effecting helpers end in verbs (`ingestDiscovered`, `updateModel`, `syncPi`).
- Comments match the local density. Do not annotate obvious code or explain the rationale for a change inside a comment — that belongs in the PR.
- No new files unless necessary. Prefer editing an existing module. Especially: do not create new top-level docs (`*.md`) without being asked.
- Keep command output scannable. Tables go through `format.ts`. Errors exit non-zero with a one-line message plus, when useful, a hint on the next line.

## Roadmap

### Router — remaining work

The router in `src/router/server.ts` is live (see invariant #4 and the Router section in `README.md`). Headless mode (`athanor router` subcommand) and in-flight stream safety (`src/supervisor/inflight.ts` + `supervisor.stop()` drain before SIGTERM, bounded by `config.router.drainTimeoutMs`) are both done. One follow-up remains:

- **Token accounting via passthrough.** The router sees the completion stream live. `src/supervisor/metrics.ts` could tee token counts off the passthrough instead of tailing logs, which would make `tok/s` a live counter while generation is running (not just post-request) when router mode is on. The hook point is the `pipeline(Readable.fromWeb(...), res)` call in `proxy()`; insert a passthrough Transform that counts SSE `data:` frames and updates a shared metric keyed on `entry.id`, then teach `src/supervisor/metrics.ts` to prefer that source when non-null.

## License

Proprietary. Copyright 2026 Myles Borins. Private evaluation only; no redistribution, no commercial use. See `LICENSE`. Do not add code under an incompatible license without the author's consent.
