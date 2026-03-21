# Design: CLI 安装流程文案与交互改造

## Module Brief

### Scope

- IN: `init` 安装流程的文案、交互与输出结构；新增 `--yes` 与 `--dry-run`；安装后透明报告与成功提示。
- OUT: 不修改数据上传逻辑、不修改后端协议、不新增 GUI 客户端。

### Interfaces

- CLI: `npx --yes @vibescore/tracker init [--yes] [--dry-run] [--no-open] [--link-code <code>]`
- Files: `~/.vibescore/tracker/config.json`、`~/.vibescore/bin/notify.cjs`、各 CLI/Hook 配置文件。
- Env: `VIBESCORE_DEVICE_TOKEN`, `VIBESCORE_DASHBOARD_URL`, `CODEX_HOME`, `CODE_HOME`, `GEMINI_HOME`.

### Data Flow & Constraints

- 未获授权前不得写入本地文件。
- `--dry-run` 必须零写入、零 side effects。
- 非交互环境（stdin 非 TTY）必须自动继续；交互环境要求显式确认。
- 执行期仅显示 spinner，不输出底层路径/日志；错误才输出。

### Non-negotiables

- 首屏必须包含隐私承诺。
- 安装完成后必须输出“透明变更报告”。
- 需要账户绑定时必须明确告知下一步，并允许用户手动打开链接。

### Test Strategy

- Unit: dry-run 不写入任何文件；summary 状态映射正确。
- Integration: `init`/`uninstall` 既有测试加入 `--yes`；验收脚本不阻塞。
- Manual: 有/无 Codex config、有/无 Gemini/Claude/Opencode 路径的组合检查。

### Milestones

1. 文案与交互方案确认，OpenSpec 通过校验。
2. `init` 流程改造完成，测试与验收脚本通过。
3. 实机手动验证（含 link-code / no-auth / no-open）。

### Plan B Triggers

- 交互式菜单在非 TTY 环境阻塞 → 自动降级为 `--yes` 快速路径。
- 新依赖安装导致体积/兼容问题 → 退回原生 readline + ANSI 实现。

### Upgrade Plan (disabled)

- 暂不启用迁移或兼容策略。

## UX Copy (final)

> 注：以下文案在保持结构不变的前提下，对集成名称与路径做真实化调整（Codex/Every Code/Claude/Gemini/Opencode）。

### Phase 1: Welcome & Consent

```text
<ASCII Art Logo>

✨ Welcome to VibeScore CLI
----------------------------------------------
🔒 Privacy First: Your content stays local. We only upload token counts and minimal metadata, never prompts or responses.
----------------------------------------------

This tool will:
  - Analyze your local AI CLI configurations (Codex, Claude, Gemini, Opencode)
  - Set up lightweight hooks to track your flow state
  - Link your device to your VibeScore account

(Nothing will be changed until you confirm below)

? Proceed with installation?
  ❯ Yes, configure my environment
    No, exit
```

### Phase 2: The Elegant Wait

```text
⠋ Analyzing and configuring local environment...
```

### Phase 3: Transparency Report

```text
✔ Local setup complete.

We've integrated VibeScore with:
  ● Codex CLI              [Updated config]
  ● Claude                 [Hooks installed]
  ● Gemini                 [Hooks installed]
  ○ Opencode Plugin        [Skipped - Config not found]
  ○ Every Code             [Skipped - Config not found]

----------------------------------------------

👉 Final Step: Link your account

   Press [Enter] to open your browser and sign in.
   (Or visit: https://vibescore.com/auth/cli?token=...)
```

### Phase 4: Happy Path

```text
(Browser auth successful...)

┌──────────────────────────────────────────────┐
│ 🎉 You're all set!                           │
│                                              │
│ Account linked.                              │
│ Token saved to: ~/.vibescore/tracker/config.json │
│                                              │
│ You can close this terminal window.          │
└──────────────────────────────────────────────┘
```

### Error handling copy

```text
⚠️  Minor Issue: Background sync couldn't start.
    Run: npx --yes @vibescore/tracker sync
```

## Implementation Notes

- 颜色语义：成功项为绿色、跳过项为灰色、隐私提示为 Cyan/白色加粗、链接可下划线。
- Spinner 期间禁止输出底层日志（除非 error）。
- 若无法实现 Dry Run，可在 UI 上移除该选项。
