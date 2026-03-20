<div align="center">

<img src="dashboard/public/icon-192.png" width="96" alt="Token Tracker Icon" />

# TOKEN TRACKER

**Track AI Token Usage Across All Your CLI Tools**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/tokentracker-cli.svg)](https://www.npmjs.com/package/tokentracker-cli)
[![Node.js Support](https://img.shields.io/badge/Node.js-≥20-brightgreen.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-macOS-lightgrey.svg)](https://www.apple.com/macos/)

</div>

---

## Quick Start

```bash
npx tokentracker-cli
```

One command does everything: first-time setup → hook installation → data sync → open dashboard.

## Features

- **Multi-Source Tracking** — Codex CLI, Claude Code, Gemini CLI, OpenCode, OpenClaw, Every Code
- **Local-First** — All data stays on your machine. No cloud account required.
- **Zero-Config** — Hooks auto-detect and configure on first run
- **Built-in Dashboard** — Web UI at `http://localhost:7890`, no external service needed
- **Privacy-First** — Only token counts tracked, never prompts or responses

## Supported CLI Tools

| CLI Tool | Auto-Detection |
|----------|----------------|
| **Codex CLI** | ✅ |
| **Claude Code** | ✅ |
| **Gemini CLI** | ✅ |
| **OpenCode** | ✅ |
| **OpenClaw** | ✅ |
| **Every Code** | ✅ |

## Usage

After first run via `npx tokentracker-cli`, you can also install globally for shorter commands:

```bash
npm i -g tokentracker-cli

# Then use anywhere:
tokentracker              # Open dashboard
tokentracker serve --port 3000
tokentracker sync         # Manual sync
tokentracker status       # Check hook status
tokentracker doctor       # Health check
tokentracker uninstall    # Remove hooks
```

## How It Works

```
AI CLI Tools (Codex, Claude, Gemini, OpenCode, ...)
    │
    │  hooks auto-trigger on usage
    ▼
Token Tracker CLI (local parsing + aggregation)
    │
    │  30-minute UTC buckets
    ▼
Local Dashboard (http://localhost:7890)
```

1. AI CLI tools generate logs during usage
2. Lightweight hooks detect changes and trigger sync
3. CLI parses logs locally, extracts only token counts
4. Data aggregated into 30-minute buckets
5. Dashboard reads local data directly — no cloud needed

## Privacy

| Protection | Description |
|------------|-------------|
| **No Content Upload** | Never uploads prompts or responses — only token counts |
| **Local Only** | All data stays on your machine, all analysis local |
| **Transparent** | Audit the sync logic in `src/lib/rollout.js` — only numbers and timestamps |

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TOKENTRACKER_DEBUG` | Enable debug output (`1` to enable) | - |
| `TOKENTRACKER_HTTP_TIMEOUT_MS` | HTTP timeout (ms) | `20000` |
| `CODEX_HOME` | Codex CLI directory override | `~/.codex` |
| `GEMINI_HOME` | Gemini CLI directory override | `~/.gemini` |

## Development

```bash
git clone https://github.com/mm7894215/tokentracker.git
cd tokentracker
npm install

# Build dashboard
cd dashboard && npm install && npm run build && cd ..

# Run locally
node bin/tracker.js

# Run tests
npm test
```

## License

[MIT](LICENSE)

---

<div align="center">
  <b>Token Tracker</b> — Quantify your AI output.<br/>
  Made by developers, for developers.
</div>
