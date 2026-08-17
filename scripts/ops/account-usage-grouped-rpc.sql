-- Server-side aggregation for the cross-device account view.
--
-- Motivation: each tokentracker-account-* edge function used to fetch raw
-- tokentracker_hourly rows in 1000-row PostgREST pages and aggregate them in
-- the edge. Measured cost is ~300-600ms PER 1000-row page (PostgREST round-trip
-- + JSON serialization of 1000 rows), NOT the DB scan (which is ~7ms, indexed).
-- A heavy user's 52-week heatmap spanned ~7 pages (~3.2s) and every other
-- account-* function re-paginated its own range on top of that.
--
-- This function does the GROUP BY in Postgres and returns a SINGLE jsonb row
-- (jsonb_agg), which sidesteps PostgREST's 1000-row response cap entirely: one
-- round-trip, no pagination. The heaviest real user's 52-week heatmap dropped
-- from ~3.2s to ~137ms server-side. tz-local bucketing uses `AT TIME ZONE`
-- (same IANA tz database as the old JS Intl.DateTimeFormat path, including DST
-- — verified against the old functions across Asia/Shanghai, America/New_York
-- spanning a spring-forward, and a fixed UTC offset).
--
-- CROSS-DEVICE SEMANTIC (GitHub Discussion #101) — two source classes:
--   * MACHINE-LEVEL sources (claude/codex/gemini/...) come from each machine's
--     LOCAL logs. Pick ONE canonical row per (hour, source, model) across the
--     user's ACTIVE devices (largest total_tokens wins) rather than summing.
--     One physical machine drifts across multiple device_ids (unstable
--     fingerprint, name-family splits, replay), and summing those double-counts
--     (issue #187). Whole-row dedup on the cumulative per-(hour,model) snapshot
--     is immune to that. The cost: two genuinely distinct machines running the
--     SAME model in the SAME half-hour count once, not summed — rare, and far
--     better than the systemic ~2x that fold-then-SUM produced.
--   * ACCOUNT-LEVEL sources (cursor, trae-cn) come from a per-ACCOUNT cloud
--     API, NOT machine logs, so SUMming across devices multiplies one
--     account's usage by its device count (the v0.42.0 double-count bug).
--     Dedup, do not add. HOW to dedup depends on whether the API is
--     append-only per window:
--       - cursor rows are identical across devices, and hours with NO
--         watermark coverage fall back to the legacy whole-row
--         per-(hour, model) MAX pick below.
--       - trae-cn is a CORRECTABLE snapshot: totals can be revised down, a
--         session can move to another model or another half-hour. Two
--         devices then hold different snapshot VERSIONS of the same hour,
--         and a per-(hour, model) MAX stitches incompatible versions
--         together (a model migration keeps BOTH the old device's stale
--         model row and the fresh device's new row -> 2x). Every successful
--         account-source sync therefore appends a WATERMARK record
--         (kind: account_sync_watermark in the CLI queue; upserted by the
--         ingest edge into tokentracker_account_sync_watermarks) asserting
--         the closed window that device verified against the API. For an
--         hour covered by ANY watermark, the freshest covering watermark's
--         device OWNS the whole hour: only its rows count (all models; a
--         model it lacks is 0) and every other device's row for that hour
--         is displaced. A brand-new device with no prior cursor state still
--         displaces stale tuples, because ownership is asserted per hour
--         RANGE, not per tuple. Mirrored by src/lib/account-usage-dedup.js
--         (executable spec; semantics pinned by test/account-usage-dedup.test.js).
-- DEPLOYMENT: this function reads tokentracker_account_sync_watermarks —
-- apply the account-sync-watermarks migration BEFORE this updated RPC.
-- The account-level source list MUST stay in sync with ACCOUNT_LEVEL_SOURCES in
-- src/lib/source-metadata.js (parity asserted by test/account-source-parity.test.js).
--
-- Whole-row (not per-column MAX) canonical pick: a per-column MAX would synth a
-- row that never existed and inflate cost, which is derived from the individual
-- token columns (src/lib/pricing computeRowCost), not total_tokens. DISTINCT ON
-- keeps the columns of one real row internally consistent.
--
-- Hour-grain dedup BEFORE tz bucketing: account-level data is per-hour, so the
-- canonical pick happens at the raw hour_start grain; only then is it truncated
-- to the tz-local hour/day/month. Deduping at a coarser (e.g. daily) bucket
-- would collapse many real hours into one and under-count.
--
-- SECURITY INVOKER (the default): runs with the caller's privileges, so it
-- never exposes more than a direct SELECT on tokentracker_hourly would. The
-- edge functions call it with the service-role token AFTER verifying the user's
-- JWT and resolving p_user_id / p_device_ids server-side.
--
-- Determinism (Codex review): jsonb_agg is ordered by (bucket, source, model)
-- so the array — and therefore the model-breakdown `sources` ordering and the
-- per-bucket `models` object key order built in the edge — is stable across
-- query plans, mirroring the old `.order("hour_start")` behavior.
--
-- Invalid timezone (Codex review): an unrecognized p_tz would make
-- `AT TIME ZONE p_tz` raise and 500 the endpoint. The old JS caught the
-- Intl.DateTimeFormat throw and fell back to the offset. The tzr CTE validates
-- p_tz against pg_timezone_names once; an unknown zone falls back to
-- p_offset_min, then UTC — matching the old precedence.
--
-- p_trunc: 'hour' | 'day' | 'month' | 'none' (none = group by source+model only)
-- p_tz:    IANA zone (e.g. 'Asia/Shanghai') or NULL
-- p_offset_min: fallback minutes east of UTC when p_tz is NULL/invalid (monthly
--               passes both NULL to bucket by UTC, matching the old slice).
--
-- Idempotent (CREATE OR REPLACE). Rollback: DROP FUNCTION account_usage_grouped.

CREATE OR REPLACE FUNCTION account_usage_grouped(
  p_user_id uuid,
  p_device_ids uuid[],
  p_from timestamptz,
  p_to timestamptz,
  p_trunc text,
  p_tz text,
  p_offset_min int
) RETURNS jsonb
LANGUAGE sql STABLE
AS $func$
  WITH tzr AS (
    -- Validate p_tz once; fall back to offset/UTC on an unknown zone instead of
    -- raising (mirrors the old JS Intl.DateTimeFormat try/catch fallback).
    SELECT CASE
             WHEN p_tz IS NOT NULL AND p_tz <> ''
                  AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz)
             THEN p_tz
             ELSE NULL
           END AS tz
  ),
  -- Account-level source list — keep in sync with src/lib/source-metadata.js.
  cfg AS (
    SELECT ARRAY['cursor', 'trae-cn']::text[] AS account_sources
  ),
  -- Per (account source, hour): the canonical owning device = the watermark
  -- with the greatest window_end whose coverage FULLY CONTAINS the half-hour
  -- bucket (NULL when none does, i.e. cursor and any watermark-less or only
  -- partially-covered history). Full containment: bucket start >=
  -- first_covered_hour AND bucket end <= window_end - the rolling sync
  -- window starts bucket-aligned and ends at floor(now), so the in-progress
  -- final bucket is honestly uncovered until a later sync fully contains it,
  -- and coverage only starts at the snapshot's FIRST data bucket: the API
  -- contract probes PROVE enumeration from the first observed session
  -- onward, but nothing distinguishes "no rows before it" from an index
  -- boundary, so that leading range stays legacy.
  -- Freshness is window identity then LOGICAL fetch time (window_end,
  -- window_start, snapshot_verified_at, device_id): a genuinely newer fetch
  -- of the SAME window wins via snapshot_verified_at while a transport
  -- retry replays the original stamp and cannot steal ownership.
  -- updated_at is the FIRST-upload time of an immutable row and must never
  -- participate.
  acct_own AS (
    SELECT ah.hour_start, ah.source,
      (SELECT w.device_id
         FROM tokentracker_account_sync_watermarks w
        WHERE w.user_id = p_user_id
          AND w.source = ah.source
          AND ah.hour_start >= w.first_covered_hour
          AND ah.hour_start + interval '30 minutes' <= w.window_end
        ORDER BY w.window_end DESC, w.window_start DESC, w.snapshot_verified_at DESC, w.device_id
        LIMIT 1) AS owner_device_id
    FROM (
      SELECT DISTINCT h.hour_start, h.source
      FROM tokentracker_hourly h CROSS JOIN cfg
      WHERE h.user_id = p_user_id
        AND h.hour_start >= p_from
        AND h.hour_start <  p_to
        AND h.source = ANY(cfg.account_sources)
    ) ah
  ),
  -- Stage 1: canonicalize to the raw hour grain.
  hourly AS (
    -- Machine-level: ONE canonical whole row per (hour, source, model) across
    -- the user's ACTIVE devices, taking the row with the largest total_tokens
    -- (newest-wins on ties) -- the SAME dedup as the account-level branch below,
    -- only the source/device filters differ.
    --
    -- One physical machine accumulates several device_ids over time: identity
    -- drift (no-suffix name -> "#suffix" -> machine_id anchor), an UNSTABLE
    -- hardware fingerprint minting a fresh id (sandbox vs CLI username, or
    -- ioreg/reg failure -> randomUUID), the CLI vs dashboard name families that
    -- never adopt each other, plus PR #184's full-history replay. The previous
    -- fold-then-SUM only collapsed rows BYTE-IDENTICAL across all six token
    -- columns, so a machine whose duplicate devices diverged by even one
    -- boundary hour (different sync offsets) double-counted -- the 2026-06 "2x
    -- token" reports (issue #187). Keying the canonical pick on the cumulative
    -- per-(hour,model) snapshot instead of device identity is immune to every
    -- split mode and needs no historical backfill.
    --
    -- Trade-off vs Discussion #101's "two real machines sum": genuinely distinct
    -- machines that ran the SAME model in the SAME half-hour bucket now count
    -- once (the larger snapshot) instead of summing. That collision is rare
    -- (distinct machines rarely hit an identical model+half-hour), and measured
    -- against real heavy multi-machine users it lands far closer to truth than
    -- the systemic ~2x the fold-then-SUM produced.
    -- WITHIN each machine CLUSTER pick ONE canonical whole row per
    -- (hour, source, model) [largest total_tokens], THEN SUM across clusters.
    -- A physical machine's device-id splits (identity drift / replay / a CLI +
    -- dashboard reading the same logs out of sync) share a cluster -> deduped to
    -- the max (no inflation). Two GENUINELY distinct machines fall in separate
    -- clusters -> summed (issue #187 fix that doesn't lose real multi-machine
    -- usage). Cluster membership is precomputed in tokentracker_device_machine by
    -- VALUE consistency (equal/covered overlap = same machine; concurrent
    -- independent values = distinct). Devices absent from that table cluster as
    -- themselves (device_id), so a lone device sums as one cluster.
    -- Emit ONE canonical whole row per (machine_cluster, hour, source, model).
    -- The cluster is in DISTINCT ON / ORDER BY but NOT selected, so same-machine
    -- device-id splits collapse to one row (max) while distinct machines emit one
    -- row each on the same (hour,source,model). Stage-2 `grouped` SUMs them by
    -- (bucket,source,model) -> within-cluster max, cross-cluster sum, in one pass
    -- (no extra GROUP BY here -- the whole-history leaderboard variant 502s with
    -- a second aggregation pass).
    SELECT mac.hour_start, mac.source, mac.model,
      mac.total_tokens, mac.input_tokens, mac.output_tokens,
      mac.cached_input_tokens, mac.cache_creation_input_tokens,
      mac.reasoning_output_tokens, mac.conversations
    FROM (
      SELECT DISTINCT ON (COALESCE(dm.machine_cluster_id, h.device_id::text), h.hour_start, h.source, h.model)
        h.hour_start, h.source, h.model,
        h.total_tokens::bigint                AS total_tokens,
        h.input_tokens::bigint                AS input_tokens,
        h.output_tokens::bigint               AS output_tokens,
        h.cached_input_tokens::bigint         AS cached_input_tokens,
        h.cache_creation_input_tokens::bigint AS cache_creation_input_tokens,
        h.reasoning_output_tokens::bigint     AS reasoning_output_tokens,
        h.conversations::bigint               AS conversations
      FROM tokentracker_hourly h CROSS JOIN cfg
      LEFT JOIN tokentracker_device_machine dm ON dm.device_id = h.device_id
      WHERE h.user_id = p_user_id
        AND h.hour_start >= p_from
        AND h.hour_start <  p_to
        AND NOT (h.source = ANY(cfg.account_sources))
        AND h.device_id = ANY(p_device_ids)
      ORDER BY COALESCE(dm.machine_cluster_id, h.device_id::text),
               h.hour_start, h.source, h.model, h.total_tokens DESC, h.updated_at DESC
    ) mac

    UNION ALL

    -- Account-level, WATERMARK-COVERED hours: the owner device's rows count
    -- exclusively (every model of that one snapshot; a model the owner lacks
    -- is 0). NOT active-device-filtered: ownership follows verified
    -- information, and an active-only filter would drop an hour whose
    -- freshest covering sync came from a since-revoked device. An owner with
    -- NO row at a covered hour legitimately yields nothing here — that is
    -- the displacement of another device's stale tuple.
    SELECT h.hour_start, h.source, h.model,
      h.total_tokens::bigint                AS total_tokens,
      h.input_tokens::bigint                AS input_tokens,
      h.output_tokens::bigint               AS output_tokens,
      h.cached_input_tokens::bigint         AS cached_input_tokens,
      h.cache_creation_input_tokens::bigint AS cache_creation_input_tokens,
      h.reasoning_output_tokens::bigint     AS reasoning_output_tokens,
      h.conversations::bigint               AS conversations
    FROM tokentracker_hourly h
    JOIN acct_own o
      ON  o.hour_start = h.hour_start
      AND o.source     = h.source
      AND o.owner_device_id = h.device_id
    WHERE h.user_id = p_user_id
      AND h.hour_start >= p_from
      AND h.hour_start <  p_to

    UNION ALL

    -- Account-level, UNCOVERED hours (no watermark asserts them: cursor, or
    -- trae-cn history older than every device's verified window): the legacy
    -- whole-row MAX pick per (hour, source, model) — one real, internally
    -- consistent row, never a per-column synth.
    SELECT d.hour_start, d.source, d.model,
      d.total_tokens, d.input_tokens, d.output_tokens,
      d.cached_input_tokens, d.cache_creation_input_tokens,
      d.reasoning_output_tokens, d.conversations
    FROM (
      SELECT DISTINCT ON (h.hour_start, h.source, h.model)
        h.hour_start, h.source, h.model,
        h.total_tokens::bigint                AS total_tokens,
        h.input_tokens::bigint                AS input_tokens,
        h.output_tokens::bigint               AS output_tokens,
        h.cached_input_tokens::bigint         AS cached_input_tokens,
        h.cache_creation_input_tokens::bigint AS cache_creation_input_tokens,
        h.reasoning_output_tokens::bigint     AS reasoning_output_tokens,
        h.conversations::bigint               AS conversations
      FROM tokentracker_hourly h
      JOIN acct_own o
        ON  o.hour_start = h.hour_start
        AND o.source     = h.source
        AND o.owner_device_id IS NULL
      WHERE h.user_id = p_user_id
        AND h.hour_start >= p_from
        AND h.hour_start <  p_to
      ORDER BY h.hour_start, h.source, h.model, h.total_tokens DESC, h.updated_at DESC
    ) d
  ),
  -- Stage 2: bucket the canonical hour rows to tz-local trunc, then aggregate.
  loc AS (
    SELECT
      CASE p_trunc
        WHEN 'hour'  THEN to_char(date_trunc('hour',  lt.local_ts), 'YYYY-MM-DD"T"HH24:00:00')
        WHEN 'day'   THEN to_char(date_trunc('day',   lt.local_ts), 'YYYY-MM-DD')
        WHEN 'month' THEN to_char(date_trunc('month', lt.local_ts), 'YYYY-MM')
        ELSE ''
      END AS bucket,
      hourly.source, hourly.model,
      hourly.total_tokens, hourly.input_tokens, hourly.output_tokens,
      hourly.cached_input_tokens, hourly.cache_creation_input_tokens,
      hourly.reasoning_output_tokens, hourly.conversations
    FROM hourly CROSS JOIN tzr
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN tzr.tz IS NOT NULL THEN (hourly.hour_start AT TIME ZONE tzr.tz)
               WHEN p_offset_min IS NOT NULL THEN ((hourly.hour_start AT TIME ZONE 'UTC') + make_interval(mins => p_offset_min))
               ELSE (hourly.hour_start AT TIME ZONE 'UTC')
             END AS local_ts
    ) lt
  ),
  grouped AS (
    SELECT
      bucket, source, model,
      SUM(total_tokens)::bigint                AS total_tokens,
      SUM(input_tokens)::bigint                AS input_tokens,
      SUM(output_tokens)::bigint               AS output_tokens,
      SUM(cached_input_tokens)::bigint         AS cached_input_tokens,
      SUM(cache_creation_input_tokens)::bigint AS cache_creation_input_tokens,
      SUM(reasoning_output_tokens)::bigint     AS reasoning_output_tokens,
      SUM(conversations)::bigint               AS conversations
    FROM loc
    GROUP BY bucket, source, model
  )
  SELECT COALESCE(
           jsonb_agg(to_jsonb(grouped.*) ORDER BY grouped.bucket, grouped.source, grouped.model),
           '[]'::jsonb
         )
  FROM grouped
$func$;
