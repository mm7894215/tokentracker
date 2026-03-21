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
npm run validate:copy                 # Validate copy registry completeness
node bin/tracker.js serve --no-sync   # Start local dashboard server
```

## Architecture

Token Tracker is a local-first AI token usage tracker. It collects token counts from multiple AI CLI tools via hooks, aggregates locally, and displays in a built-in web dashboard.

### Data Flow

```
AI CLI Tools → hooks trigger sync → rollout.js parses logs → queue.jsonl → dashboard reads locally
```

### Three Layers

**CLI (`src/`)** — Node.js CommonJS. Entry: `bin/tracker.js` → `src/cli.js` dispatches commands. Default command (no args) runs `serve` which auto-runs `init` on first use, then launches local HTTP server.

**Dashboard (`dashboard/`)** — React 18 + Vite + TailwindCSS. Built to `dashboard/dist/` and served by the CLI's `serve` command. In local mode (`localhost`), skips auth and reads data from local API endpoints.

**Backend (`insforge-src/`)** — Deno Edge Functions for the cloud service. Not needed for local-only usage. Built with `npm run build:insforge` into `insforge-functions/`.

### Key Source Files

- `src/lib/rollout.js` — Core parser. Handles 6 log formats (Codex, Claude, Gemini, OpenCode, OpenClaw, Every Code). Aggregates into 30-minute UTC buckets. Contains `normalizeOpencodeTokens`, `normalizeClaudeUsage`, `diffGeminiTotals`.
- `src/lib/local-api.js` — Local API handler for the serve command. Reads from `queue.jsonl`, serves 9 endpoints (`/functions/vibeusage-*`).
- `src/commands/serve.js` — HTTP server. Auto-detects first run, kills stale port processes, serves dashboard + API.
- `src/commands/init.js` — Hook setup for all CLI tools. Generates notify.cjs, configures Claude hooks, Gemini hooks, OpenCode plugin.
- `src/commands/sync.js` — Parses all log sources, queues hourly buckets, uploads if device token present.
- `src/lib/uploader.js` — Batch upload from queue.jsonl to backend.

### Token Normalization Convention

`input_tokens` = pure non-cached input (no cache_creation/cache_write). `cached_input_tokens` = cache reads. `cache_creation_input_tokens` = cache writes. `total_tokens` = input + output + cache_creation + cache_read (aligned with ccusage). All token types including cache are tracked and included in totals.

### OpenCode SQLite Support

OpenCode v1.2+ stores messages in `~/.local/share/opencode/opencode.db` (SQLite) instead of JSON files. `readOpencodeDbMessages()` uses `sqlite3` CLI to query, `parseOpencodeDbIncremental()` processes them. Both file and DB sources are parsed; `messageIndex` prevents double-counting.

## Conventions

- Package name: `tokentracker-cli` (npm), bin command: `tokentracker`
- CommonJS throughout `src/` (no ESM)
- Environment variable prefix: `TOKENTRACKER_` (e.g., `TOKENTRACKER_DEBUG`, `TOKENTRACKER_DEVICE_TOKEN`)
- All user-facing text in `dashboard/src/content/copy.csv`
- Platform: macOS-first
- UTC timestamps, half-hour bucket aggregation
- Privacy: token counts only, never prompts or conversation content

## OpenSpec Workflow

For significant changes (new features, breaking changes, architecture), create a proposal in `openspec/changes/<id>/`. Bug fixes and formatting skip this process.

```bash
openspec list                         # Active changes
openspec list --specs                 # Existing specifications
openspec validate <id> --strict       # Validate proposal
```
