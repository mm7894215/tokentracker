# Design: Obsidian Canvas 项目架构图自动生成器

## Module Brief

### Scope

- IN: 扫描仓库源码与配置文件；识别架构模式与组件类型；抽取依赖关系；生成 Obsidian `.canvas`。
- OUT: 不修改业务代码与运行时行为；不引入网络调用；不输出中间日志；不依赖交互式输入。

### Interfaces

- CLI: `node scripts/ops/architecture-canvas.cjs`
- Optional flags: `--root <path>`、`--out <path>`（仅用于自动化或测试，仍保持无交互）。
- Output: `architecture.canvas`（默认）或可选路径。

### Data Flow & Constraints

- 文件扫描 → 组件分类 → 依赖抽取 → 层级与坐标计算 → JSON 输出。
- 只读取源码与配置文件；不可写入除输出文件及可选警告日志以外的路径。

### Non-negotiables

- 运行过程无交互提示；终端仅输出最终完成摘要。
- 默认输出 `{repoRoot}/architecture.canvas`，不可写时回退到 `~/architecture_{project}.canvas`。
- JSON 2 空格缩进，UTF-8，无 BOM，末尾保留空行。
- 节点数量 8–300，边数量过多时需裁剪。

### Test Strategy

- Unit: 组件分类与路径解析规则、边裁剪逻辑。
- Smoke: 在当前仓库运行生成器并验证输出文件可被 Obsidian 打开。

### Milestones

1. 生成器核心流程可在小型示例目录输出合格 JSON。
2. 依赖抽取与边裁剪可控，节点/边数量符合阈值。
3. 在仓库根目录生成 `architecture.canvas` 并通过最小检查。

### Plan B Triggers

- 节点数 > 300：降级为按目录/分类聚合节点。
- 边数 > 50：按权重裁剪并保留每节点最多 5 条边。

### Upgrade Plan (disabled)

- 暂不启用迁移或兼容策略。
