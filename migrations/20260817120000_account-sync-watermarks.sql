-- Account-level sources serve CORRECTABLE account snapshots, not append-only
-- machine logs: TRAE CN (trae-cn) can revise a session's totals downward,
-- move it to another model, or shift its time bucket. Each device reconciles
-- those corrections against its own cursor state, but two devices can hold
-- different snapshot VERSIONS of the same account hour, and the previous
-- cloud aggregation (per-(hour, model) MAX across devices) stitches
-- incompatible versions together:
--   downward correction  old device H/A=100, fresh device H/A=60   -> 100 (should be 60)
--   model migration      old device H/A=100, fresh device H/B=100   -> 200 (should be 100)
--   bucket migration     old device 10:00/A=100, fresh 10:30/A=100  -> 200 (should be 100)
--
-- Fix: every successful account-source sync appends a watermark record to the
-- CLI queue (kind: account_sync_watermark; src/lib/rollout.js) right after
-- the reconciled bucket rows; the ingest edge upserts it here. An hour
-- covered by a watermark is OWNED by the freshest covering watermark's
-- device: only that device's rows for the hour count (all models; a missing
-- model is 0), so a fresher snapshot displaces stale tuples from devices
-- that never saw the correction — including displacement by a brand-new
-- device with no prior cursor state, because ownership is asserted per hour
-- RANGE, not per tuple. Hours covered by no watermark (cursor, or trae-cn
-- history older than every verified window) keep the legacy whole-row MAX
-- dedup, so watermark-less sources do not regress.
--
-- Semantics mirrored by src/lib/account-usage-dedup.js and pinned by
-- test/account-usage-dedup.test.js. Apply BEFORE re-deploying the updated
-- scripts/ops/account-usage-grouped-rpc.sql (that RPC reads this table).
-- Rollback: DROP TABLE tokentracker_account_sync_watermarks; and re-apply the
-- previous leaderboard_hourly_dedup_v2 definition.

-- Watermark rows are IMMUTABLE HISTORY: identity is the full window
-- (user_id, device_id, source, window_start, window_end). A device's newer
-- rolling window INSERTS a new row; it never overwrites the old one. This is
-- what keeps historical ownership stable: once device B displaced device A's
-- stale tuple for hour H, B's covering watermark row stays in the table even
-- after B's 30-day window slides past H, so H never falls back to the legacy
-- MAX dedup and the correction cannot resurrect. Growth is one row per
-- verified sync per device (~1.5k rows/device-year at 4 syncs/day) - cheap
-- for the owner lookup below; semantic-preserving compaction (merging
-- overlapping windows of the SAME device when coverage is unaffected) is a
-- possible future optimization, not needed at this scale.
CREATE TABLE IF NOT EXISTS public.tokentracker_account_sync_watermarks (
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  source text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  -- Coverage starts at the snapshot's FIRST data bucket, not window_start:
  -- enumeration is only PROVEN from the first observed session onward, so
  -- [window_start, first_covered_hour) asserts nothing (legacy dedup).
  first_covered_hour timestamptz NOT NULL,
  -- Logical fetch time, stamped once per real fetch and replayed verbatim
  -- by the append-only queue; a transport retry reuses the original value
  -- and can never fake freshness.
  snapshot_verified_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id, source, window_start, window_end),
  CHECK (window_end > window_start),
  CHECK (first_covered_hour >= window_start AND first_covered_hour < window_end)
);

ALTER TABLE public.tokentracker_account_sync_watermarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tokentracker_account_sync_watermarks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tokentracker_account_sync_watermarks TO project_admin;

CREATE INDEX IF NOT EXISTS tokentracker_account_sync_watermarks_lookup_idx
  ON public.tokentracker_account_sync_watermarks (user_id, source, window_end);

-- Leaderboard: same per-hour canonical ownership for account-level sources,
-- plus trae-cn joins the account_sources list (it was missing, which sent
-- trae-cn rows down the machine-cluster SUM path and double-counted any
-- multi-device trae-cn user). Historical rollup days self-heal through the
-- existing 7-day repair loop in leaderboard_rollup_daily_advance_v2; an
-- immediate full rebuild is optional (call leaderboard_rollup_daily_replace_v2
-- for the affected range).
CREATE OR REPLACE FUNCTION public.leaderboard_hourly_dedup_v2(
  p_from timestamptz,
  p_to timestamptz
) RETURNS TABLE (
  user_id uuid,
  source text,
  model text,
  hour_start timestamptz,
  total_tokens bigint,
  input_tokens bigint,
  output_tokens bigint,
  cached_input_tokens bigint,
  cache_creation_input_tokens bigint,
  reasoning_output_tokens bigint
)
LANGUAGE sql STABLE
AS $func$
  WITH cfg AS (
    SELECT ARRAY['cursor', 'trae-cn']::text[] AS account_sources
  ),
  acct_hours AS (
    SELECT DISTINCT h.user_id, h.source, h.hour_start
    FROM tokentracker_hourly h CROSS JOIN cfg
    WHERE h.hour_start >= p_from AND h.hour_start < p_to
      AND h.source = ANY(cfg.account_sources)
  ),
  -- Per (user, account source, hour): the watermark with the greatest
  -- window_end whose coverage FULLY CONTAINS the half-hour bucket owns it
  -- (NULL = uncovered, legacy dedup below). Full containment: bucket start
  -- >= first_covered_hour AND bucket end <= window_end - a partially
  -- verified bucket is never claimed, and neither is a bucket before the
  -- snapshot's first data point (enumeration is only proven from there).
  -- Freshness is window identity then LOGICAL fetch time (window_end,
  -- window_start, snapshot_verified_at, device_id): a genuinely newer fetch
  -- of the SAME window beats an older one via snapshot_verified_at, while a
  -- transport retry replays the original stamp and cannot steal ownership.
  -- updated_at is the FIRST-upload time of an immutable row and never
  -- participates.
  acct_own AS (
    SELECT ah.user_id, ah.source, ah.hour_start,
      (SELECT w.device_id
         FROM tokentracker_account_sync_watermarks w
        WHERE w.user_id = ah.user_id
          AND w.source = ah.source
          AND ah.hour_start >= w.first_covered_hour
          AND ah.hour_start + interval '30 minutes' <= w.window_end
        ORDER BY w.window_end DESC, w.window_start DESC, w.snapshot_verified_at DESC, w.device_id
        LIMIT 1) AS owner_device_id
    FROM acct_hours ah
  )
  -- Deduplicate device-id drift/replays inside one physical machine cluster,
  -- then add genuinely distinct machines for the same user/hour/model.
  SELECT mac.user_id, mac.source, mac.model, mac.hour_start,
    SUM(mac.total_tokens)::bigint                AS total_tokens,
    SUM(mac.input_tokens)::bigint                AS input_tokens,
    SUM(mac.output_tokens)::bigint               AS output_tokens,
    SUM(mac.cached_input_tokens)::bigint         AS cached_input_tokens,
    SUM(mac.cache_creation_input_tokens)::bigint AS cache_creation_input_tokens,
    SUM(mac.reasoning_output_tokens)::bigint     AS reasoning_output_tokens
  FROM (
    SELECT DISTINCT ON (
      h.user_id,
      COALESCE(dm.machine_cluster_id, h.device_id::text),
      h.source,
      h.model,
      h.hour_start
    )
      h.user_id,
      COALESCE(dm.machine_cluster_id, h.device_id::text) AS machine_cluster_id,
      h.source, h.model, h.hour_start,
      h.total_tokens::bigint                AS total_tokens,
      h.input_tokens::bigint                AS input_tokens,
      h.output_tokens::bigint               AS output_tokens,
      h.cached_input_tokens::bigint         AS cached_input_tokens,
      h.cache_creation_input_tokens::bigint AS cache_creation_input_tokens,
      h.reasoning_output_tokens::bigint     AS reasoning_output_tokens
    FROM tokentracker_hourly h
    CROSS JOIN cfg
    JOIN tokentracker_devices d
      ON d.id = h.device_id AND d.revoked_at IS NULL
    LEFT JOIN tokentracker_device_machine dm
      ON dm.device_id = h.device_id
    WHERE h.hour_start >= p_from AND h.hour_start < p_to
      AND NOT (h.source = ANY(cfg.account_sources))
    ORDER BY
      h.user_id,
      COALESCE(dm.machine_cluster_id, h.device_id::text),
      h.source,
      h.model,
      h.hour_start,
      h.total_tokens DESC,
      h.updated_at DESC
  ) mac
  GROUP BY mac.user_id, mac.source, mac.model, mac.hour_start

  UNION ALL

  -- Account-level, WATERMARK-COVERED hours: the owner device's rows count
  -- exclusively (all models of that one snapshot; a missing model is 0 and
  -- another device's stale tuple for the hour is displaced).
  SELECT h.user_id, h.source, h.model, h.hour_start,
    h.total_tokens::bigint                AS total_tokens,
    h.input_tokens::bigint                AS input_tokens,
    h.output_tokens::bigint               AS output_tokens,
    h.cached_input_tokens::bigint         AS cached_input_tokens,
    h.cache_creation_input_tokens::bigint AS cache_creation_input_tokens,
    h.reasoning_output_tokens::bigint     AS reasoning_output_tokens
  FROM tokentracker_hourly h
  JOIN acct_own o
    ON  o.user_id    = h.user_id
    AND o.hour_start = h.hour_start
    AND o.source     = h.source
    AND o.owner_device_id = h.device_id
  WHERE h.hour_start >= p_from AND h.hour_start < p_to

  UNION ALL

  -- Account-level, UNCOVERED hours (cursor, watermark-less history): the
  -- legacy whole-row MAX pick per (user, hour, source, model).
  SELECT acct.user_id, acct.source, acct.model, acct.hour_start,
    acct.total_tokens, acct.input_tokens, acct.output_tokens,
    acct.cached_input_tokens, acct.cache_creation_input_tokens,
    acct.reasoning_output_tokens
  FROM (
    SELECT DISTINCT ON (h.user_id, h.source, h.model, h.hour_start)
      h.user_id, h.source, h.model, h.hour_start,
      h.total_tokens::bigint                AS total_tokens,
      h.input_tokens::bigint                AS input_tokens,
      h.output_tokens::bigint               AS output_tokens,
      h.cached_input_tokens::bigint         AS cached_input_tokens,
      h.cache_creation_input_tokens::bigint AS cache_creation_input_tokens,
      h.reasoning_output_tokens::bigint     AS reasoning_output_tokens
    FROM tokentracker_hourly h CROSS JOIN cfg
    JOIN acct_own o
      ON  o.user_id    = h.user_id
      AND o.hour_start = h.hour_start
      AND o.source     = h.source
      AND o.owner_device_id IS NULL
    WHERE h.hour_start >= p_from AND h.hour_start < p_to
      AND h.source = ANY(cfg.account_sources)
    ORDER BY h.user_id, h.source, h.model, h.hour_start, h.total_tokens DESC, h.updated_at DESC
  ) acct
$func$;
