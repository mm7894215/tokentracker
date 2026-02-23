# Architecture canvas generator

## ADDED Requirements

### Requirement: Non-interactive generation

系统 SHALL 在单次执行中完成扫描与生成，不得要求用户输入或确认，且不输出中间进度日志。

#### Scenario: Run generator once

- **WHEN** 运行 `node scripts/ops/architecture-canvas.cjs`
- **THEN** 仅输出最终摘要并生成 `.canvas` 文件

### Requirement: Source scan and exclusions

系统 SHALL 扫描源码文件（`*.py|*.js|*.ts|*.java|*.go|*.rb|*.php|*.cs`），并忽略 `node_modules`、`__pycache__`、`.venv`、`dist`、`build` 等目录。

#### Scenario: Ignore excluded directories

- **WHEN** 目录包含 `node_modules` 或 `dist`
- **THEN** 扫描结果不包含这些目录下的文件

### Requirement: Architecture pattern detection

系统 SHALL 基于目录结构、配置文件与依赖特征推断架构模式（单体、微服务、前后端分离、库/工具、数据管道）。

#### Scenario: Detect separated frontend/backend

- **WHEN** 同时存在 `frontend/` 与 `backend/` 或 `client/` 与 `server/`
- **THEN** 模式识别为前后端分离

### Requirement: Component classification and colors

系统 SHALL 基于路径/命名/内容规则为组件分类，并按颜色规则标记节点。

#### Scenario: Classify controller

- **WHEN** 文件路径包含 `/controllers/` 或 `/handlers/`
- **THEN** 节点类型为控制器并使用业务层颜色

### Requirement: Dependency extraction and edge pruning

系统 SHALL 解析本地依赖关系并构建有向边，当边数量超过 50 条时进行裁剪。

#### Scenario: Prune dense graph

- **WHEN** 依赖边超过 50 条
- **THEN** 仅保留主要连接并保证每节点保留有限边数

### Requirement: Adaptive layout and count limits

系统 SHALL 采用自适应分层与定位算法；节点数量控制在 8–300 之间。

#### Scenario: Collapse excessive nodes

- **WHEN** 节点数超过 300
- **THEN** 自动合并节点并保持层级可读

### Requirement: Output format and fallback path

系统 SHALL 生成 Obsidian Canvas JSON（2 空格缩进，末尾空行），默认写入 `{repo}/architecture.canvas`；不可写时回退到 `~/architecture_{project}.canvas`。

#### Scenario: Fallback path

- **WHEN** 仓库根目录不可写
- **THEN** 输出到用户主目录的备用路径

### Requirement: Error handling

系统 SHALL 在 JSON 生成失败时输出错误信息并保留临时结果。

#### Scenario: JSON failure

- **WHEN** 生成过程出现不可恢复错误
- **THEN** 输出错误日志并保留中间数据以便排查
