# Change: Obsidian Canvas 项目架构图自动生成器

## Why

当前架构图需要人工维护，容易与真实代码偏离。需要一个非交互式脚本自动扫描仓库并生成 Obsidian Canvas 文件，保证可复现与可分享。

## What Changes

- 新增非交互式生成脚本，扫描仓库并输出 `architecture.canvas`。
- 根据目录结构与文件特征识别架构模式、组件分类与依赖关系。
- 自动布局节点并按规则限制节点与边数量，提供降级与容错。

## Impact

- Affected specs: `architecture-canvas-generator`
- Affected code: `scripts/ops/` 新脚本，可能新增测试与文档。
- 风险：仅影响离线工具，不影响运行时生产路径。
