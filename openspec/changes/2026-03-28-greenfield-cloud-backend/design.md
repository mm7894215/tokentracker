# Greenfield 云端后端设计（与历史实现脱钩）

## 1. 范围与非目标

### 1.1 范围

- 定义 **Token Tracker** 下一代云端侧的最小契约：**身份**、**用量上报**、**读模型**（供 Dashboard / 可选 CLI 查询）。
- 两套对标实现路径：**InsForge**（BaaS + Edge）与 **Supabase**（Postgres + Auth + Edge），在**逻辑模型**上一致，在**具体 URL 与 SDK** 上按所选平台替换。

### 1.2 非目标（本设计刻意不继承）

- 不引用、不承诺兼容下列**历史**产物：仓库内 `insforge-src/`、`insforge-functions/` 构建物、历史 HTTP 前缀 `functions/vibeusage-*`、`BACKEND_API.md` 中已过时的 Edge 清单、以及 InsForge 上既有的 `tokentracker-*` 表名与函数 slug（见 MCP 快照；可整体替换）。
- 不把「设备 token + user JWT」的旧交互顺序当作唯一标准；绿场允许重新定义 **CLI 长期凭证** 与 **用户会话** 的边界（需在实现阶段定稿）。

## 2. 身份与凭证

### 2.1 用户身份（人机）

- 使用所选平台的 **托管 Auth**，通过 **OAuth（如 GitHub / Google）和/或邮箱密码** 登录。
- 客户端持有 **`accessToken`（JWT）**，标准用法：`Authorization: Bearer <accessToken>`。
- **JWT 内 `sub`（或平台文档指定的 user id）** 作为全局 `user_id`，在所有服务端写入路径中做归属校验。

### 2.2 设备或 CLI 长期凭证（机器）

- 绿场建议单独一类 **device credential**（名称可定为 `device_secret` / `api_key`）：仅用于 headless CLI，**哈希存库**，可轮换。
- 颁发方式二选一（实现时择一）：  
  - **A**：用户登录后调用受 JWT 保护的「创建设备」端点，返回一次性明文密钥；或  
  - **B**：OAuth device flow / 平台若支持则采用其标准。

### 2.3 禁止

- 不在文档层规定「必须用 InsForge SDK 的某私有回调路径」；应以 **HTTPS + 标准 Bearer** 为准。

## 3. 用量数据模型（逻辑）

### 3.1 半小时桶（与本地队列一致）

与本地 `queue.jsonl` 语义对齐的**最小字段**（字段名可在 SQL 层 snake_case）：

| 逻辑字段 | 说明 |
|----------|------|
| `bucket_start` | UTC 半点对齐的 ISO 时间戳（幂等键组成部分） |
| `input_tokens` | 非负整数 |
| `cached_input_tokens` | 非负整数 |
| `output_tokens` | 非负整数 |
| `reasoning_output_tokens` | 非负整数（若无则为 0） |
| `total_tokens` | 非负整数 |
| `source` | 字符串，标识 CLI 来源（如 codex、cursor） |

可选扩展：`project_ref`、`client_batch_id`（幂等）、`ingested_at`。

### 3.2 表命名（绿场建议）

使用**新前缀**以免与废弃实例混淆，例如：

- `tt_devices`：设备元数据，`user_id` 外键。
- `tt_device_credentials`：仅存凭证哈希与 `device_id`。
- `tt_usage_half_hour`：聚合行，唯一约束建议 `(user_id, bucket_start, source)` 或等价 + `client_batch_id`。

（`tt_` = Token Tracker，可替换为其他前缀。）

## 4. HTTP 契约（绿场，新路径）

以下路径为**逻辑**名称；部署时映射到 Edge Function 或 API Gateway。

### 4.1 上报用量

- `POST /usage/v1/batches`
- **Auth**：`Authorization: Bearer <user_jwt>` **或** `Authorization: Bearer <device_token>`（若实现设备凭证），由服务端解析并映射到 `user_id`。
- **Body**（示例）：

```json
{
  "batches": [
    {
      "bucket_start": "2026-03-28T12:00:00.000Z",
      "input_tokens": 0,
      "cached_input_tokens": 0,
      "output_tokens": 0,
      "reasoning_output_tokens": 0,
      "total_tokens": 100,
      "source": "codex",
      "client_batch_id": "optional-uuid"
    }
  ]
}
```

- **幂等**：相同 `user_id` + `bucket_start` + `source`（+ 可选 `client_batch_id`）重复提交不得重复累加。

### 4.2 查询聚合（Dashboard）

- 由 **Edge Function 或 PostgREST + RLS** 暴露只读区间查询；路径可定为 `GET /usage/v1/summary?from=&to=`，仅返回**聚合**数字，不返回原始对话内容。

### 4.3 设备注册

- `POST /devices/v1`（JWT）创建设备；`DELETE /devices/v1/:id` 撤销。

## 5. 平台映射

### 5.1 InsForge

- 使用官方 **Auth + Database + Edge Functions**；Edge 内用平台文档的 **`createClient` + `edgeFunctionToken` / `getCurrentUser()`** 模式绑定 `user_id`。
- 具体路由前缀以 InsForge 控制台为准（可能为 `/functions/<slug>`）；**不在本文件写死旧 slug**。

### 5.2 Supabase

- 见 `supabase-baseline.md`：RLS + Edge Function 验 JWT + 官方备份策略。

## 6. 数据保留与删除

- **应用层**：可保留「仅保留最近 N 天细粒度桶」的滚动删除任务（Edge/cron），产品层 N 可配置。
- **基础设施层**：以所选平台文档 + `insforge-vendor-checklist.md`（InsForge）或 Supabase 官方备份页（Supabase）为准。

## 7. 迁移与清理

- 若 InsForge 上已有旧 `tokentracker_*` 对象：在绿场实现稳定后，**删除或弃用**旧表与函数（通过控制台/MCP），避免双写。
- 若采用 Supabase 新项目：从零建表与 RLS，无需迁移旧 InsForge 数据（当前 MCP 显示表内数据量为 0）。
