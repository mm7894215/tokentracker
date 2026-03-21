# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
npm test                              # Run all tests (node --test test/*.test.js)
node --test test/rollout-parser.test.js  # Run a single test file
npm run ci:local                      # Full local CI (tests + validations + builds)
npm run dashboard:dev                 # Dashboard dev server with local API mock
npm run dashboard:build               # Build dashboard to dashboard/dist/
npm run build:insforge                # Build backend Edge Functions
npm run build:insforge:check          # Verify InsForge build outputs
npm run validate:copy                 # Validate copy registry completeness
npm run validate:ui-hardcode          # Validate no hardcoded UI strings
npm run validate:guardrails           # Validate architecture constraints
node bin/tracker.js serve --no-sync   # Start local dashboard server
npm run smoke                         # Run InsForge smoke tests
```

## Architecture

Token Tracker is a local-first AI token usage tracker. It collects token counts from multiple AI CLI tools via hooks, aggregates locally, and displays in a built-in web dashboard.

### Data Flow

```
AI CLI Tools → hooks trigger sync → rollout.js parses logs → queue.jsonl → dashboard reads locally
                                                                         → uploader.js uploads to backend (if device token present)
```

### Three Layers

**CLI (`src/`)** — Node.js CommonJS. Entry: `bin/tracker.js` → `src/cli.js` dispatches commands. Default command (no args) runs `serve` which auto-runs `init` on first use, then launches local HTTP server. Bin commands: `tracker`, `tokentracker`, `tokentracker-tracker`.

**Dashboard (`dashboard/`)** — React 18 + Vite + TailwindCSS (ESM). Built to `dashboard/dist/` and served by the CLI's `serve` command. In local mode (`localhost`), skips auth and reads data from local API endpoints. Has its own `package.json` with separate dependencies.

**Backend (`insforge-src/`)** — Deno Edge Functions (27 functions) for the cloud service. Not needed for local-only usage. Built with `npm run build:insforge` into `insforge-functions/`. Shared modules in `insforge-src/shared/` (59 files).

### CLI Commands (`src/commands/`)

| Command | File | Purpose |
|---------|------|---------|
| `serve` | `serve.js` | HTTP server, auto-detects first run, kills stale port processes, serves dashboard + API |
| `init` | `init.js` | Hook setup wizard for all CLI tools (consent → hooks → browser auth) |
| `sync` | `sync.js` | Parse all log sources, queue hourly buckets, upload if device token present |
| `status` | `status.js` | Check hook installation status |
| `doctor` | `doctor.js` | Health checks and validation |
| `diagnostics` | `diagnostics.js` | Gather system diagnostics |
| `uninstall` | `uninstall.js` | Remove hooks and optional data purge |
| `activate-if-needed` | `activate-if-needed.js` | Check/activate tracker |

### Key Source Files

- `src/lib/rollout.js` — Core parser (79KB). Handles 6 log formats (Codex, Claude, Gemini, OpenCode, OpenClaw, Every Code). Aggregates into 30-minute UTC buckets. Contains `normalizeOpencodeTokens`, `normalizeClaudeUsage`, `diffGeminiTotals`.
- `src/lib/local-api.js` — Local API handler for the serve command. Reads from `queue.jsonl`, serves 9 endpoints (`/functions/vibeusage-*`).
- `src/lib/uploader.js` — Batch upload from queue.jsonl to backend.
- `src/lib/upload-throttle.js` — Request throttling for uploads.
- `src/lib/codex-config.js` — Codex CLI hook setup (notify.cjs).
- `src/lib/claude-config.js` — Claude Code hook configuration.
- `src/lib/gemini-config.js` — Gemini CLI hook setup.
- `src/lib/opencode-config.js` — OpenCode plugin setup.
- `src/lib/openclaw-hook.js` — OpenClaw hook integration.
- `src/lib/openclaw-session-plugin.js` — OpenClaw session plugin.
- `src/lib/browser-auth.js` — Browser OAuth flow.
- `src/lib/activation-check.js` — Tracker activation detection.
- `src/lib/runtime-config.js` — Runtime environment configuration.
- `src/lib/cli-ui.js` — Terminal UI (colors, spinners, prompts).
- `src/lib/fs.js` — Atomic file operations and JSON helpers.
- `src/lib/subscriptions.js` — Subscription management.
- `src/lib/vibeusage-api.js` — Backend API helpers.

### Dashboard Structure

- `dashboard/src/pages/` — Page components: `DashboardPage`, `LandingPage`, `LeaderboardPage`, `LeaderboardProfilePage`, `SignInRedirect`, `SignUpRedirect`.
- `dashboard/src/content/copy.csv` — All user-facing text (copy registry).
- `dashboard/src/lib/` — Utilities (34 files): auth, API, formatting, data aggregation, timezone handling.
- `dashboard/src/hooks/` — React hooks (6 files): usage data, activity heatmap, trend data, theme.
- `dashboard/src/ui/foundation/` — Design system (14 files): `MatrixButton`, `MatrixInput`, `ThemeProvider`, `AsciiBox`, `ScrambleText`.
- `dashboard/src/ui/matrix-a/` — Main UI theme with components like `UsagePanel`, `RollingUsagePanel`, `ProjectUsagePanel`, `TopModelsPanel`, `TrendMonitor`, `CostAnalysisModal`, `ActivityHeatmap`, `LiveSniffer`.
- `dashboard/src/ui/openai/` — Alternate OpenAI-style theme.

### Backend Endpoints (`insforge-src/functions/`)

Key edge functions: `vibeusage-ingest`, `vibeusage-usage-daily`, `vibeusage-usage-hourly`, `vibeusage-usage-monthly`, `vibeusage-usage-summary`, `vibeusage-usage-model-breakdown`, `vibeusage-leaderboard`, `vibeusage-leaderboard-profile`, `vibeusage-link-code-init`, `vibeusage-link-code-exchange`, `vibeusage-public-view-*`, `vibeusage-pricing-sync`, `vibeusage-sync-ping`.

Shared modules in `insforge-src/shared/`: auth, database helpers, core ingest/aggregation logic, pricing, model identity/aliases, pagination.

### Token Normalization Convention

`input_tokens` = pure non-cached input (no cache_creation/cache_write). `cached_input_tokens` = cache reads. `cache_creation_input_tokens` = cache writes. `total_tokens` = input + output + cache_creation + cache_read (aligned with ccusage). All token types including cache are tracked and included in totals.

### OpenCode SQLite Support

OpenCode v1.2+ stores messages in `~/.local/share/opencode/opencode.db` (SQLite) instead of JSON files. `readOpencodeDbMessages()` uses `sqlite3` CLI to query, `parseOpencodeDbIncremental()` processes them. Both file and DB sources are parsed; `messageIndex` prevents double-counting.

### Hook System

Hooks are configured per-tool during `init`:

| Tool | Hook Type | Config Location |
|------|-----------|-----------------|
| Codex CLI | notify.cjs | `~/.codex/notify.cjs` |
| Claude Code | Built-in hooks | Claude config |
| Gemini CLI | settings.json | `~/.gemini/settings.json` |
| OpenCode | Plugin | `~/.local/share/opencode/` |
| OpenClaw | Hook + Session Plugin | `~/.openclaw/` |
| Every Code | notify.cjs | `~/.code/config.toml` |

Hooks trigger on tool usage → sync parses log files → token counts extracted + aggregated → data queued locally (`queue.jsonl`) → uploaded to backend if device token present.

## Testing

- **Framework**: Node.js built-in `--test` runner (no external test framework).
- **125 test files** in `test/` covering: parser logic, CLI commands, dashboard auth, usage calculations, architecture guardrails, edge functions, visual baselines.
- **Visual testing**: Playwright + pixelmatch for screenshot baseline validation.
- **Architecture guardrails**: Automated tests enforce codebase constraints (`test/architecture-guardrails.test.js`).
- **Dashboard tests**: Vitest for dashboard-specific unit tests (`dashboard/vitest.config.ts`).

## CI/CD

**GitHub Actions** (`.github/workflows/`):
- `ci.yml` — Main CI: tests → validate copy → validate UI hardcodes → validate guardrails → architecture tests → InsForge build check → dashboard build.
- `release.yml` — npm package release.
- `deploy-preflight.yml` — Pre-deployment checks.
- `guardrails.yml` — Architecture constraint validation.
- `graph-scip.yml` — SCIP source graph generation.
- Scheduled workflows for leaderboard refresh, pricing sync, and events retention.

**Local CI**: `npm run ci:local` runs the full pipeline locally.

## Conventions

- Package name: `tokentracker-cli` (npm), bin commands: `tokentracker`, `tracker`
- CommonJS throughout `src/` (no ESM); ESM in `dashboard/`; Deno TypeScript in `insforge-src/`
- Environment variable prefix: `TOKENTRACKER_` (e.g., `TOKENTRACKER_DEBUG`, `TOKENTRACKER_DEVICE_TOKEN`)
- Dashboard env vars use `VITE_` prefix; backend uses `INSFORGE_` prefix
- All user-facing text in `dashboard/src/content/copy.csv` — no hardcoded strings in UI
- Platform: macOS-first
- UTC timestamps, half-hour bucket aggregation
- Privacy: token counts only, never prompts or conversation content
- Single dependency: `@insforge/sdk`; dev deps: `esbuild`, `@sourcegraph/scip-typescript`
- Error objects use `.status`, `.code`, `.originalMessage`, `.nextActions` pattern
- Debug mode: `--debug` flag or `TOKENTRACKER_DEBUG` env var

## OpenSpec Workflow

For significant changes (new features, breaking changes, architecture), create a proposal in `openspec/changes/<id>/`. Bug fixes and formatting skip this process.

Each proposal contains: `proposal.md`, `requirements-analysis.md`, `acceptance-criteria.md`, `test-strategy.md`, `tasks.md`, `verification-report.md`, and optionally `specs/` and `sql/` directories.

```bash
openspec list                         # Active changes
openspec list --specs                 # Existing specifications
openspec validate <id> --strict       # Validate proposal
```

## Project Layout

```
bin/                     # Executable entry point (tracker.js)
src/                     # CLI source (Node.js CommonJS)
  commands/              # 8 CLI commands
  lib/                   # 33 library modules (328KB)
dashboard/               # React 18 + Vite web UI (ESM)
  src/pages/             # Page components
  src/content/           # Copy registry (copy.csv)
  src/lib/               # Utilities
  src/hooks/             # React hooks
  src/ui/                # UI components (foundation, matrix-a, openai themes)
insforge-src/            # Deno Edge Functions (cloud backend)
  functions/             # 27 edge functions
  shared/                # 59 shared modules
insforge-functions/      # Built edge function output
test/                    # 125 test files
scripts/                 # Build, ops, and acceptance scripts
skills/                  # Claude Code skills
openspec/                # Change proposals (66+ proposals)
docs/                    # Planning and design documents
.github/workflows/       # 9 GitHub Actions workflows
```
