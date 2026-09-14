# Plan: tui-test-expansion

## Status
Proposed

## Context
Athanor's core logic (adapters, config, discovery, registry, router, supervisor, sync, cli) has achieved between 85% and 100% statement and branch coverage with over 730 automated tests. The remaining uncovered branches across the repository reside almost entirely in three interactive Ink TUI components:
- `src/ui/PresetEditor.tsx` (~57% statements, ~44% branches)
- `src/ui/SearchBrowser.tsx` (~58% statements, ~36% branches)
- `src/ui/PullModal.tsx` (~76% statements, ~62% branches)

Lifting these three components to 80%+ will elevate the entire project's branch coverage past the 80% mark.

## Scope & Target Areas

### 1. PresetEditor.tsx
- Field navigation: Up/Down arrow key transitions across tunable fields and compound sliders.
- Knob adjustments: Left/Right arrow keys for numeric and enum options (`temperature`, `top_p`, `ctx_size`, `reasoning_effort`).
- Formula save & apply: `s` / `Enter` triggering custom formula saves, name input validation, and saving to `~/.athanor/formulas.json`.
- Reset & cancel: Escape / `c` reverting modified values.

### 2. SearchBrowser.tsx
- Filtering & sorting: Toggling filters (`any`, `mlx`, `gguf`) with `tab`, switching sort orders (`downloads`, `likes`, `size`, `fit`).
- Paging & cursors: Scrolling through multi-page results, handling cursor exhaustion, and empty results states.
- Modal interactions: Enter to inspect details card, GGUF file paging, and initiating downloads with `p` / `d`.

### 3. PullModal.tsx
- Edge cases in branch/revision input and specific file selection for multi-file GGUF repositories.
- Error states when `hf` CLI returns non-zero or invalid repo names.

## Verification Plan
- Unit tests using Ink's `render` with simulated stdin inputs.
- Zero console log leaks during rendering and unmounting.
- Total project branch coverage elevated from 76.5% to >80%.
