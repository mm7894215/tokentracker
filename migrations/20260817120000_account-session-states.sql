-- Account-level sources serve CORRECTABLE account snapshots, not append-only
-- machine logs: TRAE CN (trae-cn) can revise a session's totals downward,
-- move it to another model, or shift its half-hour bucket. Deduplicating
-- those corrections at the HOUR level cannot work: a fresh device's snapshot
-- starts at its first observed session, so an hour-level owner can never
-- safely displace a stale tuple for an hour the fresh snapshot has no data
-- for (that would require an unproven "absent = deleted" contract), and a
-- bucket migration (10:00 -> 10:30) leaves the old hour stranded.
--
-- Fix: canonical truth at the SESSION level. TRAE's usage API carries a
-- stable session_id (PROVEN 2026-08-17: 137/137 sessions persisted across two
-- independent fetches with 0 disappearances; one session was revised upward
-- mid-window and KEPT its session_id; account responses have no duplicate
-- ids; cross-window cross-checks return exact subsets). The CLI parser
-- (src/lib/rollout.js) emits one queue record per CHANGED session
-- (kind: "account_session_state"); the ingest edge upserts them here via
-- tokentracker_upsert_account_session_states(). Identity is
-- (user_id, source, session_id) - device_id is NOT part of the identity: the
-- API request carries no device discriminator, so every device of the
-- account observes the SAME server-side session namespace.
--
-- Three corrections become ONE whole-row replace:
--   downward   S tokens 100 -> 60        row replaced, total 60
--   model      S model A -> B            row replaced, only B=100 remains
--   bucket     S bucket 10:00 -> 10:30   row replaced, only 10:30=100
-- A fresh device with no cursor history simply uploads the sessions it sees;
-- the upsert's LWW guard reconciles versions across devices.
--
-- Absence is NOT PROVEN to mean deletion (see the parser's empty-payload
-- note): nothing here ever deletes a session row. Corrections are explicit
-- observations only.
--
-- Freshness: the API exposes NO provider-side ordering signal (headers carry
-- only CDN trace ids; rows have no revision/updated_at - probed 2026-08-17).
-- snapshot_verified_at is the CLIENT fetch stamp, set once per real fetch
-- and replayed verbatim by the append-only queue. The upsert applies an
-- observation only when its stamp is STRICTLY NEWER (>) than the stored
-- one, so a transport retry of an old observation is a no-op, and the same
-- observation replayed is idempotent. This is best-effort cross-device
-- ordering, NOT strict correctness: two devices with skewed clocks can
-- mis-order two conflicting observations of one session (residual risk,
-- bounded by the skew; observations of the same session converge because
-- they reflect one server-side state).
--
-- Semantics mirrored by src/lib/account-usage-dedup.js and pinned by
-- test/account-usage-dedup.test.js. Apply BEFORE re-deploying the updated
-- scripts/ops/account-usage-grouped-rpc.sql and the ingest edge (both read /
-- write this table).
-- Rollback: DROP TABLE tokentracker_account_session_states; DROP FUNCTION
-- tokentracker_upsert_account_session_states(uuid, jsonb); and re-apply the
-- previous leaderboard_hourly_dedup_v2 definition.

CREATE TABLE IF NOT EXISTS public.tokentracker_account_session_states (
  user_id uuid NOT NULL,
  source text NOT NULL,
  -- Stable provider-side session identity (TRAE session_id). Not a device
  -- attribute: all devices of one account observe the same namespace.
  session_id text NOT NULL,
  model text NOT NULL,
  -- Canonical UTC half-hour bucket of this session's CURRENT placement.
  bucket_start timestamptz NOT NULL,
  input_tokens bigint NOT NULL,
  output_tokens bigint NOT NULL,
  cached_input_tokens bigint NOT NULL,
  cache_creation_input_tokens bigint NOT NULL,
  reasoning_output_tokens bigint NOT NULL,
  total_tokens bigint NOT NULL,
  -- Client logical fetch stamp (see the freshness note above). Ops metadata
  -- only - updated_at (first server write time) never participates in
  -- correctness.
  snapshot_verified_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source, session_id),
  CHECK (
    total_tokens =
      input_tokens + cached_input_tokens + cache_creation_input_tokens + output_tokens
  ),
  CHECK (
    input_tokens >= 0 AND output_tokens >= 0 AND cached_input_tokens >= 0
    AND cache_creation_input_tokens >= 0 AND reasoning_output_tokens >= 0
    AND total_tokens >= 0
  )
);

ALTER TABLE public.tokentracker_account_session_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tokentracker_account_session_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tokentracker_account_session_states TO project_admin;

-- Aggregation reads group by (user, source, bucket).
CREATE INDEX IF NOT EXISTS tokentracker_account_session_states_bucket_idx
  ON public.tokentracker_account_session_states (user_id, source, bucket_start);

-- Batch LWW upsert used by the ingest edge (the SDK's upsert cannot express
-- a conditional DO UPDATE). SECURITY DEFINER with a locked search_path; the
-- edge calls it with the service-role token after authenticating the device.
-- A strict ">" guard makes replay idempotent and prevents a transport retry
-- of an older observation from displacing a newer one; conflicting
-- observations with EQUAL stamps keep the first-applied row (stable under
-- retries).
CREATE OR REPLACE FUNCTION public.tokentracker_upsert_account_session_states(
  p_user_id uuid,
  p_states jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_applied integer;
BEGIN
  INSERT INTO tokentracker_account_session_states AS t
    (user_id, source, session_id, model, bucket_start,
     input_tokens, output_tokens, cached_input_tokens,
     cache_creation_input_tokens, reasoning_output_tokens, total_tokens,
     snapshot_verified_at)
  SELECT
    p_user_id, x.source, x.session_id, x.model, x.bucket_start,
    x.input_tokens, x.output_tokens, x.cached_input_tokens,
    x.cache_creation_input_tokens, x.reasoning_output_tokens, x.total_tokens,
    x.snapshot_verified_at
  FROM jsonb_to_recordset(p_states) AS x(
    source text, session_id text, model text, bucket_start timestamptz,
    input_tokens bigint, output_tokens bigint, cached_input_tokens bigint,
    cache_creation_input_tokens bigint, reasoning_output_tokens bigint,
    total_tokens bigint, snapshot_verified_at timestamptz)
  ON CONFLICT (user_id, source, session_id) DO UPDATE SET
    model = EXCLUDED.model,
    bucket_start = EXCLUDED.bucket_start,
    input_tokens = EXCLUDED.input_tokens,
    output_tokens = EXCLUDED.output_tokens,
    cached_input_tokens = EXCLUDED.cached_input_tokens,
    cache_creation_input_tokens = EXCLUDED.cache_creation_input_tokens,
    reasoning_output_tokens = EXCLUDED.reasoning_output_tokens,
    total_tokens = EXCLUDED.total_tokens,
    snapshot_verified_at = EXCLUDED.snapshot_verified_at,
    updated_at = now()
  WHERE EXCLUDED.snapshot_verified_at > t.snapshot_verified_at;

  GET DIAGNOSTICS v_applied = ROW_COUNT;
  RETURN v_applied;
END
$fn$;

REVOKE ALL ON FUNCTION public.tokentracker_upsert_account_session_states(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tokentracker_upsert_account_session_states(uuid, jsonb)
  TO project_admin;

-- Leaderboard: account-level sources now aggregate from SESSION STATES (the
-- canonical cross-device truth), machine-level sources keep the cluster
-- dedup. trae-cn hourly rows (per-device local reconciliations) never enter
-- the leaderboard - the session-state branch replaces both the previous
-- watermark-owner branch and the legacy MAX fallback for trae-cn. 'cursor'
-- (identical rows across devices, no session identity) keeps the legacy
-- whole-row MAX dedup. Historical rollup days self-heal through the existing
-- 7-day repair loop in leaderboard_rollup_daily_advance_v2; an immediate
-- full rebuild is optional (call leaderboard_rollup_daily_replace_v2 for the
-- affected range).
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

  -- 'cursor' (account-level but with NO stable session identity): rows are
  -- identical across devices, so the legacy whole-row MAX pick per
  -- (user, hour, source, model) dedups them.
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
    FROM tokentracker_hourly h
    WHERE h.hour_start >= p_from AND h.hour_start < p_to
      AND h.source = 'cursor'
    ORDER BY h.user_id, h.source, h.model, h.hour_start, h.total_tokens DESC, h.updated_at DESC
  ) acct

  UNION ALL

  -- trae-cn: canonical account truth aggregated from session states. Every
  -- device's observations of the same session collapsed to ONE row by the
  -- LWW upsert; corrections (downward / model / bucket) are already
  -- reflected because each session exists exactly once.
  SELECT s.user_id, s.source, s.model, s.bucket_start AS hour_start,
    SUM(s.total_tokens)::bigint                AS total_tokens,
    SUM(s.input_tokens)::bigint                AS input_tokens,
    SUM(s.output_tokens)::bigint               AS output_tokens,
    SUM(s.cached_input_tokens)::bigint         AS cached_input_tokens,
    SUM(s.cache_creation_input_tokens)::bigint AS cache_creation_input_tokens,
    SUM(s.reasoning_output_tokens)::bigint     AS reasoning_output_tokens
  FROM tokentracker_account_session_states s
  WHERE s.bucket_start >= p_from AND s.bucket_start < p_to
    AND s.source = 'trae-cn'
  GROUP BY s.user_id, s.source, s.model, s.bucket_start
$func$;
