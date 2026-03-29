/**
 * InsForge Edge：排行榜列表。「当前用户」行用 fetch /api/auth/sessions/current 解析 user id，避免 Deno 内 SDK getCurrentUser 不稳定。
 */
import { createClient } from "npm:@insforge/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function extractUserIdFromSessionBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const u =
    (o.user as Record<string, unknown> | undefined) ??
    ((o.data as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined);
  if (!u || typeof u !== "object") return null;
  const id = u.id ?? u.user_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function userIdFromAccessTokenJwt(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payloadPart = parts[1];
    const padded = payloadPart
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(payloadPart.length + ((4 - (payloadPart.length % 4)) % 4), "=");
    const json = atob(padded);
    const payload = JSON.parse(json) as Record<string, unknown>;
    const sub = payload.sub;
    if (typeof sub === "string" && sub.length > 0) return sub;
    const uid = payload.user_id;
    if (typeof uid === "string" && uid.length > 0) return uid;
  } catch {
    /* ignore */
  }
  return null;
}

async function getUserIdFromSession(
  baseUrl: string,
  token: string,
  anonKey: string | undefined,
): Promise<string | null> {
  const root = baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (anonKey) headers.apikey = anonKey;
  const res = await fetch(`${root}/api/auth/sessions/current`, { headers });
  if (res.ok) {
    const body = await res.json().catch(() => null);
    const fromApi = extractUserIdFromSessionBody(body);
    if (fromApi) return fromApi;
  }
  return userIdFromAccessTokenJwt(token);
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  const period = url.searchParams.get("period") || "week";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20") || 20, 100);
  const offset = parseInt(url.searchParams.get("offset") || "0") || 0;
  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!;
  const incomingApiKey =
    req.headers.get("apikey") ?? req.headers.get("Apikey") ?? req.headers.get("x-api-key") ?? undefined;
  const anonKey =
    Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? incomingApiKey ?? undefined;
  const authH = req.headers.get("Authorization");
  const token = authH?.startsWith("Bearer ") ? authH.slice(7) : undefined;
  const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  // 优先用 service role key 查询 DB，避免用户短期 JWT 过期导致 401
  const dbToken = serviceRoleKey || token;
  const client = createClient({
    baseUrl,
    edgeFunctionToken: dbToken,
    anonKey,
    ...(anonKey ? { headers: { apikey: anonKey } } : {}),
  });
  const now = new Date();
  let from_day: string;
  let to_day: string;
  if (period === "week") {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    from_day = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 6);
    to_day = d.toISOString().slice(0, 10);
  } else if (period === "month") {
    from_day = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    to_day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  } else {
    from_day = "2024-01-01";
    to_day = now.toISOString().slice(0, 10);
  }
  const {
    data: entries,
    error,
    count,
  } = await client.database
    .from("tokentracker_leaderboard_snapshots")
    .select("*", { count: "exact" })
    .eq("period", period)
    .eq("from_day", from_day)
    .eq("to_day", to_day)
    .order("rank", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) return json({ error: error.message }, 500);
  let me: unknown = null;
  if (token) {
    try {
      const uid = await getUserIdFromSession(baseUrl, token, anonKey);
      if (uid) {
        const { data: mr } = await client.database
          .from("tokentracker_leaderboard_snapshots")
          .select("*")
          .eq("period", period)
          .eq("from_day", from_day)
          .eq("to_day", to_day)
          .eq("user_id", uid)
          .limit(1)
          .maybeSingle();
        if (mr) me = mr;
      }
    } catch {
      /* ignore */
    }
  }
  return json({
    entries: (entries || []).map((e: { user_id?: string }) => ({
      ...e,
      is_me: (me as { user_id?: string } | null)?.user_id === e.user_id,
    })),
    me,
    total_entries: count || 0,
    total_pages: Math.ceil((count || 0) / limit),
    from: from_day,
    to: to_day,
    generated_at: new Date().toISOString(),
  });
}
