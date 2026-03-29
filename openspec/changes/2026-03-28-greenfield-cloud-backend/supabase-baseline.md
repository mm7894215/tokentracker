# Supabase 基线（官方公开文档对齐 + 绿场 ingest 形态）

本文档将 **Supabase 官方文档**中与本项目相关的部分固化为基线，便于与 InsForge 对照。实现细节以 [Supabase Docs](https://supabase.com/docs) 为准；档位与数字随官方更新可能变化，选型时请在 Dashboard 再核对当前计划。

## 数据库备份与保留（公开文档摘要）

来源：[Backups](https://supabase.com/docs/guides/platform/backups)

- 自动备份覆盖 **Free、Pro、Team、Enterprise** 等项目类型。
- **日备份可访问窗口**（文档表述）：Pro **7 天**、Team **14 天**、Enterprise **最多 30 天**（以官方当前说明为准）。
- **PITR（Point-in-Time Recovery）**：Pro/Team/Enterprise 可按附加项启用；粒度可达秒级；对**计算规格**有前置要求（文档要求至少 Small compute 等—以官方为准）。
- **Free 档**：文档建议定期使用 CLI `db dump` 等方式做**站外**备份。
- **删除项目**：文档说明会**永久**删除关联数据与 S3 上的备份，**不可逆**。

## Edge Functions + Auth（ingest 服务端）

来源：[Edge Functions — Auth](https://supabase.com/docs/guides/functions/auth)

- 运行时：**Deno**。
- 从 `Authorization: Bearer <jwt>` 取 token；使用 `supabase.auth.getClaims(token)` 或 `getUser(token)` 校验调用方身份。
- 若用 `createClient` 并将请求的 `Authorization` 传入全局 headers，则后续 **Postgres 访问可走 Row Level Security（RLS）**，以调用者身份执行策略。

## 绿场 ingest 在 Supabase 上的推荐形态

1. **表**：例如 `usage_half_hour_buckets`（名称可调整），包含 `user_id`（`uuid`，对齐 `auth.users`）、`bucket_start_utc`、`source`、`token` 各字段、幂等键（如 `client_batch_id` 或 `(user_id, bucket_start_utc, source)` 唯一约束）。
2. **RLS**：
   - `INSERT`/`SELECT`：仅当 `auth.uid() = user_id`（或团队模型下的 membership 规则）。
   - 禁止客户端用 **service role** 直写生产表；ingest 由 Edge Function 使用用户 JWT 上下文或服务端校验后写入。
3. **Edge Function**：实现 `POST /usage/v1/batches`（或等价路径），校验 JWT，校验 payload schema，**幂等**写入。
4. **与 CLI 对齐**：CLI 持有 **refresh token / session** 或 **设备级密钥** 的设计需单独产品决策；本文档只固定「服务端验 JWT + RLS」基线。

## 与 InsForge 对照时的注意点

- Supabase 的**备份与 PITR**在公开文档中较完整；InsForge 需在 `insforge-vendor-checklist.md` 中间接补齐再对比。
- Supabase **不**捆绑「统一 AI 网关」类产品线；InsForge 可能同时暴露 AI 与 BaaS，控制台与计费需单独梳理。
