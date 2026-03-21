# Architecture Canvas 生成器

## 目的

自动扫描仓库源码结构并生成 Obsidian Canvas 架构图文件（`.canvas`），用于复盘真实代码结构与依赖关系。

## 使用方式

在仓库根目录运行：

```bash
node scripts/ops/architecture-canvas.cjs
```

可选参数：

- `--root <path>`：指定扫描根目录（默认当前目录）
- `--out <path>`：指定输出路径（默认 `<root>/architecture.canvas`）

## 输出说明

- 默认输出：`<repo>/architecture.canvas`
- 若根目录不可写：回退到 `~/architecture_{project}.canvas`
- 仅输出最终摘要（无中间日志）
- 若存在警告：生成同路径的 `*.warnings.log`

## 规则摘要

- 扫描主流源码文件类型并忽略 `node_modules`、`__pycache__`、`.venv`、`dist`、`build`、`insforge-functions`
- 自动识别架构模式（单体/微服务/前后端分离/库工具/数据管道）
- 节点数量 8–300；当节点超过 120 时自动按顶层目录与层级聚合；依赖边超过 50 自动裁剪
- 不可读文件跳过并记录警告
