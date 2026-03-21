## 1. Implementation

- [x] Add generator script under `scripts/ops/architecture-canvas.cjs` (non-interactive, no mid-logs).
- [x] Implement scanning, classification, dependency extraction, layout, and edge pruning rules.
- [x] Add optional CLI flags `--root` and `--out` for automation (no prompts).
- [x] Add warning log capture (write to sidecar file only when warnings exist).
- [x] (Optional) Add npm script `architecture:canvas` for convenience.

## 2. Tests

- [x] Unit: classification and edge pruning.
- [x] Unit: output JSON shape and count limits with a temp fixture.

## 3. Verification

- [x] Run `node --test test/architecture-canvas.test.js`.
- [x] Run `node scripts/ops/architecture-canvas.cjs` and confirm `architecture.canvas` is created.

## 4. Docs

- [x] Add usage note in `docs/architecture-canvas.md`.
