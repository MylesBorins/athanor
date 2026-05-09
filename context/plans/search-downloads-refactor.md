# Plan: search-downloads-refactor

## Status
In Progress

The search/download UX refactor is substantially implemented and validated with typecheck + expanded targeted tests. The remaining work is narrower now: download UX verification/polish, one remaining MLX row-size preference test gap, and optional search metadata polish.

## What Landed

### Search UI / modal
- Search opens in browse mode by default.
- Search details now render as a centered overlay modal instead of inline/bottom details.
- Modal uses the newer opaque centered style.
- `Esc` backs out of nested search states; `q` quits search.
- Main TUI list ordering was stabilized to `running first + slug`.
- Search modal centering was tuned after the content grew.

### GGUF detail UX
- GGUF details now support paging through selectable options.
- Main GGUF chooser moved from a list to a single focused card.
- Visible details now include:
  - selected/default file
  - per-file size when available
  - machine fit hint
  - architecture
  - context length
  - base model
  - repo total as repo-level context
- Main search rows now prefer the default GGUF file size once enrichment is available.

### Search enrichment / metadata
- Public HF tree endpoint is now used to recover exact GGUF file sizes when sibling metadata is empty.
- MLX size fallback now computes size from `.safetensors` shard totals via the public tree endpoint.
- Search enrichment now runs across all currently loaded results in bounded background batches, not only visible rows.
- Repo enrichment hints are now cached locally on disk (`~/.athanor/cache/search-repo-hints.json`) with atomic writes and TTL.
- Private/gated search results are filtered out of the TUI results.

### Downloads UX
- Added a first-class downloads state hook: `src/ui/useDownloads.ts`.
- Added downloads modal: `src/ui/DownloadsModal.tsx`.
- Added global main-TUI keybinding `D` to open downloads.
- README now documents the downloads modal and its controls.
- Search-triggered downloads now route more coherently into downloads handling instead of being a hidden main-screen-only concept.
- Added helper-level tests for duplicate detection, clear-finished behavior, success/failure/cancel transitions, and download progress aggregation.

## Current Known Issues / Follow-up

### Highest priority
1. **Finish download dedupe/cancel polish with real-flow verification.**
   We added logic and helper-level tests, but still need confidence across the actual TUI flows.

2. **Close the remaining MLX row-size preference test gap.**
   The underlying API/tree behavior is covered, but the rendered/search preference path still deserves one more direct test.

3. **Decide the next search polish item.**
   The best candidates are quant hints in GGUF cards or short README/model-card summary snippets for accessible repos.

## Task List

### A. Testing
- [x] Add tests for `src/search/cache.ts`
  - [x] load empty cache
  - [x] save/load roundtrip
  - [x] stale TTL eviction
- [x] Add tests for `src/search/hf.ts`
  - [x] private/gated result filtering
  - [x] GGUF enrichment using tree-size fallback
  - [x] default GGUF file selection with recovered sizes
- [x] Add tests for `src/ui/useDownloads.ts`
  - [x] dedupe same repo+file while active
  - [x] cancel transitions to cancelled cleanly
  - [x] clear finished keeps only active tasks
  - [x] successful completion emits expected message/state
  - [x] failure emits expected message/state
- [~] Add tests around search row size preference logic
  - [x] GGUF rows prefer default-file size over repo-level size
  - [ ] MLX rows use computed shard-total fallback when search result size is missing

### B. Downloads UX cleanup
- [ ] Verify duplicate queue prevention actually works across:
  - [ ] main TUI downloads flow
  - [ ] embedded search queue flow
  - [ ] standalone search local downloads flow
- [ ] Verify downloads modal selection stability after cancel/clear mutations in real usage.
- [ ] Confirm cancelling a running task leaves modal state clean and understandable in practice, not just in helper logic.
- [ ] Decide whether queued status should become real (instead of immediate running) or remain conceptual-only.

### C. Search UX polish
- [ ] Consider adding short quant interpretation hints in GGUF card
  - [ ] e.g. balanced / larger / highest quality-ish guidance
- [ ] Consider adding accessible README/model-card summary snippets for repos where available.
- [ ] Decide whether inaccessible repos that slip past search filtering should be hidden after failed enrichment or simply ignored.
- [ ] Evaluate whether cached repo hints should also support optional query-result caching later.
- [ ] Add stronger search-layer filtering so results better match athanor's actual purpose as a local LLM runtime manager.
  - [ ] Add modality-oriented filtering for text-in/text-out capable models.
  - [ ] Add runtime compatibility filtering that emphasizes MLX or llama.cpp-compatible repos.
  - [ ] Add task filtering so search favors text-generation/chat models and avoids unrelated pipelines such as ASR, TTS, feature-extraction, etc.
  - [ ] Evaluate using Hugging Face `pipeline_tag=text-generation` (or equivalent task filtering) at the API layer before client-side enrichment.
  - [ ] Make the search surface clearer that athanor is for local LLM inference, not a general-purpose model registry.

### D. Repo / workflow hygiene
- [ ] Decide what to do with `context/plans/2026-05-08-athanor.md`.
- [ ] Stage any remaining intended files.
- [ ] Re-run:
  - [ ] `npx tsc --noEmit`
  - [ ] `npm run test:run`
- [ ] Update README again if any additional user-visible keybindings/flows change.

## Files Changed
- `README.md`
- `src/pull/api.ts`
- `src/registry/sort.ts`
- `src/search/cache.ts`
- `src/search/hf.ts`
- `src/ui/App.tsx`
- `src/ui/ConfirmModal.tsx`
- `src/ui/DownloadsModal.tsx`
- `src/ui/PresetEditor.tsx`
- `src/ui/SearchBrowser.tsx`
- `src/ui/useAppData.ts`
- `src/ui/useAppInput.ts`
- `src/ui/useDownloads.ts`

## Notes
- Typecheck and existing test suite are currently green after recent changes.
- The repo hint cache uses atomic writes and stores only derived search enrichment data, not core registry state.
- The plan remains valid, but it is now narrower: most of the broad test debt has been reduced, and the remaining work is mainly flow verification plus optional polish.
