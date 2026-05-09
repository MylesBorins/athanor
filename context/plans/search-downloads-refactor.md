# Plan: search-downloads-refactor

## Status
In Progress

The search/download UX refactor is substantially implemented and validated with typecheck + existing tests, but targeted test coverage for the new behavior is still missing. There is also a small amount of download UX cleanup remaining.

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

## Current Known Issues / Follow-up

### Highest priority
1. **Add tests for new functionality.**
   Existing tests pass, but new functionality is under-tested.

2. **Finish download dedupe/cancel polish.**
   We started patching duplicate download prevention and cancel behavior, but these need verification and tests.

3. **Unify downloads behavior between main TUI and search.**
   Search-triggered pulls should consistently land the user in a coherent downloads flow.

## Task List

### A. Testing
- [ ] Add tests for `src/search/cache.ts`
  - [ ] load empty cache
  - [ ] save/load roundtrip
  - [ ] stale TTL eviction
- [ ] Add tests for `src/search/hf.ts`
  - [ ] private/gated result filtering
  - [ ] GGUF enrichment using tree-size fallback
  - [ ] default GGUF file selection with recovered sizes
- [ ] Add tests for `src/ui/useDownloads.ts`
  - [ ] dedupe same repo+file while active
  - [ ] cancel transitions to cancelled cleanly
  - [ ] clear finished keeps only active tasks
  - [ ] successful completion emits expected message/state
  - [ ] failure emits expected message/state
- [ ] Add tests around search row size preference logic
  - [ ] GGUF rows prefer default-file size over repo-level size
  - [ ] MLX rows use computed shard-total fallback when search result size is missing

### B. Downloads UX cleanup
- [ ] Verify duplicate queue prevention actually works across:
  - [ ] main TUI downloads flow
  - [ ] embedded search queue flow
  - [ ] standalone search local downloads flow
- [ ] Fix/verify downloads modal selection stability after cancel/clear mutations.
- [ ] Confirm cancelling a running task leaves modal state clean and understandable.
- [ ] Decide whether queued status should become real (instead of immediate running) or remain conceptual-only.

### C. Search UX polish
- [ ] Consider adding short quant interpretation hints in GGUF card
  - [ ] e.g. balanced / larger / highest quality-ish guidance
- [ ] Consider adding accessible README/model-card summary snippets for repos where available.
- [ ] Decide whether inaccessible repos that slip past search filtering should be hidden after failed enrichment or simply ignored.
- [ ] Evaluate whether cached repo hints should also support optional query-result caching later.

### D. Repo / workflow hygiene
- [ ] Review staged vs unstaged changes and decide final commit shape.
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
- The next responsible step is to add targeted tests before making the search/download system much more complex.
