/**
 * InsForge Edge：接收本地 CLI 上传的用量数据，写入 tokentracker_hourly。
 * 用 device token（SHA-256 hash）验证身份，用 service role key 写 DB。
 */
import { createClient } from "npm:@insforge/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-tokentracker-device-token-hash",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isLeaderboardBlockedUser(userId: string): boolean {
  return (Deno.env.get("LEADERBOARD_BLOCKED_USER_IDS") ?? "")
    .split(",")
    .some((candidate) => candidate.trim() === userId);
}

async function isUsageBlocked(
  client: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> {
  if (isLeaderboardBlockedUser(userId)) return true;
  const { data, error } = await client.database
    .from("tokentracker_leaderboard_anomaly_flags")
    .select("user_id")
    .eq("user_id", userId)
    .eq("status", "auto_excluded")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[ingest] anomaly guard failed:", error.message);
    return false;
  }
  return Boolean(data);
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  const deviceToken = authHeader?.replace(/^Bearer\s+/i, "");
  if (!deviceToken) return json({ error: "Missing bearer token" }, 401);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Invalid JSON body" }, 400);

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!;
  const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  const incomingApiKey =
    req.headers.get("apikey") ?? req.headers.get("Apikey") ?? req.headers.get("x-api-key") ?? undefined;
  const anonKey =
    Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? incomingApiKey ?? undefined;
  if (!serviceRoleKey) return json({ error: "server misconfigured" }, 500);

  const client = createClient({
    baseUrl,
    edgeFunctionToken: serviceRoleKey,
    anonKey,
    ...(anonKey ? { headers: { apikey: anonKey } } : {}),
  });

  const tokenHash = await sha256Hex(deviceToken);

  const { data: tokenRow, error: tokenErr } = await client.database
    .from("tokentracker_device_tokens")
    .select("user_id, device_id")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (tokenErr) return json({ error: tokenErr.message }, 500);
  if (!tokenRow) return json({ error: "Unauthorized" }, 401);

  const userId = (tokenRow as { user_id: string }).user_id;
  const deviceId = (tokenRow as { device_id: string }).device_id;

  // Revoking known tokens is not sufficient when another issuance request is
  // already in flight. The blocklist is the final write-path authorization.
  if (await isUsageBlocked(client, userId)) {
    return json({ error: "Account blocked" }, 403);
  }

  const buckets = Array.isArray(body.buckets)
    ? body.buckets
    : Array.isArray(body.hourly)
      ? body.hourly
      : [];

  // Account-sync watermarks (kind: "account_sync_watermark" queue records)
  // assert the closed window this device just verified against an
  // account-level source API (trae-cn). The cloud aggregation
  // (account_usage_grouped / leaderboard_hourly_dedup_v2) picks, per hour,
  // the freshest covering watermark device as the canonical owner, so a
  // newer snapshot displaces stale tuples from devices holding older
  // versions. A watermark-only batch is a meaningful upload (e.g. a
  // verified-empty window) and must not fall into the no-buckets reject.
  const rawWatermarks = Array.isArray(body.account_watermarks)
    ? body.account_watermarks
    : [];
  if (rawWatermarks.length > 50) {
    return json({ error: "Too many account watermarks (max 50)" }, 400);
  }
  const watermarks = [];
  for (const w of rawWatermarks) {
    const source = typeof w?.source === "string" ? w.source.trim().toLowerCase() : "";
    const start = Date.parse(String(w?.window_start ?? ""));
    const end = Date.parse(String(w?.window_end ?? ""));
    // Fail closed on a malformed watermark: writing a bogus window would
    // corrupt cross-device ownership for the whole account.
    if (!source || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return json({ error: "Invalid account watermark" }, 400);
    }
    watermarks.push({
      source,
      window_start: new Date(start).toISOString(),
      window_end: new Date(end).toISOString(),
    });
  }

  if ((!Array.isArray(buckets) || buckets.length === 0) && watermarks.length === 0) {
    return json({ error: "No usage buckets provided" }, 400);
  }
  if (buckets.length > 500) {
    return json({ error: "Too many buckets (max 500)" }, 400);
  }

  const mappedRows = buckets.map((b: Record<string, unknown>) => ({
    user_id: userId,
    device_id: deviceId,
    hour_start: b.hour_start,
    source: b.source || "unknown",
    model: b.model || "unknown",
    input_tokens: b.input_tokens || 0,
    cached_input_tokens: b.cached_input_tokens || 0,
    cache_creation_input_tokens: b.cache_creation_input_tokens || 0,
    output_tokens: b.output_tokens || 0,
    reasoning_output_tokens: b.reasoning_output_tokens || 0,
    total_tokens: b.total_tokens || 0,
    billable_total_tokens: b.billable_total_tokens || 0,
    total_cost_usd: Number(b.total_cost_usd) || 0,
    // The CLI queue rows name this field `conversation_count`; older upload
    // paths sent `conversations`. Reading only `conversations` zeroed the
    // column for every CLI upload since 2026-04-18 — accept both.
    conversations: b.conversation_count ?? b.conversations ?? 0,
  }));

  // Dedupe within the batch by (hour_start, source, model), keeping the row
  // with the largest total_tokens. The CLI's queue.jsonl is append-only and
  // re-emits the same logical bucket multiple times as a session fills out
  // (each emission carries the cumulative running total, so MAX wins). Two
  // rows sharing the conflict key in one upsert make Postgres throw
  // "ON CONFLICT DO UPDATE command cannot affect row a second time" and
  // reject the entire batch — which stalled all clients until this dedupe.
  const dedupedMap = new Map<string, typeof mappedRows[number]>();
  for (const r of mappedRows) {
    const key = `${r.hour_start}|${r.source}|${r.model}`;
    const prev = dedupedMap.get(key);
    if (!prev || (Number(r.total_tokens) || 0) > (Number(prev.total_tokens) || 0)) {
      dedupedMap.set(key, r);
    }
  }
  const rows = Array.from(dedupedMap.values());

  const { error: upsertErr } = await client.database
    .from("tokentracker_hourly")
    .upsert(rows, {
      onConflict: "user_id,device_id,hour_start,source,model",
    });

  if (upsertErr) return json({ error: upsertErr.message }, 500);

  if (watermarks.length > 0) {
    // Insert AFTER the bucket rows of the same upload landed, so a watermark
    // never covers hours whose owning rows failed to write. Watermark rows
    // are IMMUTABLE history keyed by the full window identity
    // (user_id, device_id, source, window_start, window_end): a re-delivered
    // watermark (queue/upload retry of the SAME verified window) is a no-op
    // (DO NOTHING), so updated_at stays the FIRST-upload time and a transport
    // retry can never masquerade as a fresher snapshot in owner selection.
    const wmRows = watermarks.map((w) => ({
      user_id: userId,
      device_id: deviceId,
      source: w.source,
      window_start: w.window_start,
      window_end: w.window_end,
    }));
    const { error: wmErr } = await client.database
      .from("tokentracker_account_sync_watermarks")
      .upsert(wmRows, {
        onConflict: "user_id,device_id,source,window_start,window_end",
        ignoreDuplicates: true,
      });
    if (wmErr) return json({ error: wmErr.message }, 500);
  }

  return json({ ok: true, inserted: rows.length, skipped: 0 });
}
