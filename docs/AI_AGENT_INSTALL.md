# VibeUsage AI Agent 安装指南

## 概述
VibeUsage 是一个 AI Token 用量追踪工具，支持 Codex CLI、Claude Code、Gemini CLI、OpenCode 和 OpenClaw 等多种 AI 客户端。

## 安装步骤（请按顺序执行）

### 步骤 1: 检查环境
```bash
# 检查 Node.js 版本（需要 18+）
node --version

# 如果 Node.js 版本低于 18，请先升级
# macOS/Linux: nvm install 18 && nvm use 18
# Windows: 下载安装 https://nodejs.org/
```

### 步骤 2: 安装 VibeUsage
```bash
# 使用 npx 安装（推荐，无需全局安装）
npx --yes vibeusage init

# 或者全局安装
npm install -g vibeusage
vibeusage init
```

### 步骤 3: 完成初始化
运行 `npx vibeusage init` 后会：
1. 自动检测并配置支持的 AI 客户端
2. 安装 notify hook 到 ~/.codex/config.toml、~/.code/config.toml 等
3. 创建本地数据目录 ~/.vibeusage/
4. 生成设备 token 用于身份识别

### 步骤 4: 验证安装
```bash
# 检查状态
vibeusage status

# 手动同步测试
vibeusage sync

# 查看帮助
vibeusage --help
```

## 支持的 AI 客户端自动配置

VibeUsage 会自动检测并配置以下客户端：

| 客户端 | 配置位置 |
|--------|----------|
| Codex CLI | ~/.codex/config.toml |
| Every Code | ~/.code/config.toml |
| Gemini CLI | ~/.gemini/settings.json |
| OpenCode | 全局插件 |
| Claude Code | ~/.claude/hooks/ |
| OpenClaw | Gateway hook |

## 常用命令

```bash
# 查看状态
vibeusage status

# 手动同步
vibeusage sync

# 调试模式同步
vibeusage sync --debug

# 查看版本
vibeusage --version

# 卸载
vibeusage uninstall

# 完全清除（包括数据）
vibeusage uninstall --purge
```

## 故障排除

### 问题: 命令找不到
解决: 确保 Node.js 18+ 已安装，并尝试使用 `npx --yes vibeusage init`

### 问题: 同步失败
解决: 检查网络连接，或运行 `vibeusage sync --debug` 查看详细日志

### 问题: 某些客户端未配置
解决: 手动运行 `vibeusage init` 会重新检测并配置所有支持的客户端

## 隐私说明
- 仅追踪 Token 用量数字，不上传代码或对话内容
- 所有数据本地存储在 ~/.vibeusage/
- 支持公开/私有模式切换

## 链接
- 官网: https://www.vibeusage.cc
- 文档: https://docs.vibeusage.cc
- GitHub: https://github.com/victorGPT/vibeusage
