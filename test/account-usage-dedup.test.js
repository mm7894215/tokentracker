/**
 * Account-level cross-device dedup regression tests (PR #474 review).
 *
 * TRAE CN's usage API returns CORRECTABLE snapshots, not append-only events:
 * a session's totals can be revised downward, moved to another model, or
 * shifted to another half-hour. Two devices of one account therefore hold
 * different snapshot VERSIONS of the same hour, and the legacy cloud
 * aggregation - per (hour, source, model) pick MAX(total_tokens) across
 * devices - stitches incompatible versions together. These tests pin the
 * FIXED semantics implemented by src/lib/account-usage-dedup.js (executable
 * spec) and mirrored by:
 *   - scripts/ops/account-usage-grouped-rpc.sql (account_usage_grouped)
 *   - migrations/20260817120000_account-sync-watermarks.sql
 *     (leaderboard_hourly_dedup_v2 + watermark table)
 *
 * Scenarios A-E are the exact merge-blocker cases from the PR review; they
 * exercise the real aggregation logic, not the ACCOUNT_LEVEL_SOURCES config
 * drift checks in account-source-parity.test.js.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  dedupeAccountLevelRows,
  sumTotalTokens,
} = require("../src/lib/account-usage-dedup");

const ROOT = path.join(__dirname, "..");

// Device ids / hours used across the scenarios.
const OLD = "11111111-1111-1111-1111-111111111111";
const FRESH = "22222222-2222-2222-2222-222222222222";
const H10 = "2027-01-10T10:00:00.000Z";
const H1030 = "2027-01-10T10:30:00.000Z";
const H11 = "2027-01-10T11:00:00.000Z";

function row(deviceId, hourStart, model, totalTokens) {
  return {
    device_id: deviceId,
    hour_start: hourStart,
    source: "trae-cn",
    model,
    total_tokens: totalTokens,
    input_tokens: totalTokens,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    conversations: 1,
    updated_at: "2027-01-15T00:00:00.000Z",
  };
}

function watermark(deviceId, start, end, updatedAt, opts = {}) {
  return {
    device_id: deviceId,
    source: "trae-cn",
    window_start: start,
    window_end: end,
    // Coverage starts at the snapshot's FIRST data bucket. Defaults to
    // window_start (data spanning the whole window); tests for the narrowed
    // contract pass a later first_covered_hour via opts.
    first_covered_hour: opts.firstCovered ?? start,
    // Logical fetch time (stamped once per real fetch, replayed on
    // retry). Deliberately independent of updated_at: updated_at is the
    // TRANSPORT first-upload time and must never masquerade as freshness.
    snapshot_verified_at: opts.verifiedAt ?? "2027-01-15T00:00:00.000Z",
    updated_at: updatedAt || "2027-01-15T00:00:00.000Z",
  };
}

// A watermark window covering the whole test day (mirrors the CLI's rolling
// 30-day sync window, which always covers every corrected hour).
const DAY_WINDOW = { start: "2027-01-09T00:00:00.000Z", end: "2027-01-12T00:00:00.000Z" };

function totalByModel(rows) {
  const byModel = new Map();
  for (const r of rows) {
    byModel.set(r.model, (byModel.get(r.model) || 0) + r.total_tokens);
  }
  return byModel;
}

// ---------------------------------------------------------------------------
// A. Cross-device downward correction
// ---------------------------------------------------------------------------
test("A. downward correction: old device 100, fresh device 60 -> account total is 60", () => {
  const rows = [
    row(OLD, H10, "model-a", 100),
    row(FRESH, H10, "model-a", 60),
  ];
  const watermarks = [
    watermark(OLD, DAY_WINDOW.start, "2027-01-10T09:59:00.000Z"), // older sync
    watermark(FRESH, DAY_WINDOW.start, DAY_WINDOW.end), // freshest verified window
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 60, "must pick the corrected 60, not MAX 100");
});

// ---------------------------------------------------------------------------
// B. Cross-device model migration
// ---------------------------------------------------------------------------
test("B. model migration: old device A=100, fresh device B=100 -> A displaced, total 100", () => {
  const rows = [
    row(OLD, H10, "model-a", 100),
    row(FRESH, H10, "model-b", 100),
  ];
  const watermarks = [
    watermark(OLD, DAY_WINDOW.start, "2027-01-10T09:59:00.000Z"),
    watermark(FRESH, DAY_WINDOW.start, DAY_WINDOW.end),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  const byModel = totalByModel(deduped);
  assert.equal(byModel.get("model-a") || 0, 0, "stale model-a tuple must be displaced, not kept");
  assert.equal(byModel.get("model-b"), 100, "fresh model-b row counts");
  assert.equal(sumTotalTokens(deduped), 100, "must be 100, not the stitched 200");
});

// ---------------------------------------------------------------------------
// C. Cross-device bucket (hour) migration
// ---------------------------------------------------------------------------
test("C. bucket migration: old device 10:00=100, fresh device 10:30=100 -> only new bucket", () => {
  const rows = [
    row(OLD, H10, "model-a", 100),
    row(FRESH, H1030, "model-a", 100),
  ];
  // The fresh device verified a window covering BOTH hours (the rolling
  // window does), so its lack of a 10:00 row means the account truly has 0
  // at 10:00 now.
  const watermarks = [watermark(FRESH, DAY_WINDOW.start, DAY_WINDOW.end)];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  const byHour = new Map(deduped.map((r) => [r.hour_start, r.total_tokens]));
  assert.equal(byHour.get(H10), undefined, "old 10:00 tuple must be displaced");
  assert.equal(byHour.get(H1030), 100, "new 10:30 tuple survives");
  assert.equal(sumTotalTokens(deduped), 100, "total must be 100, not 200");
});

// ---------------------------------------------------------------------------
// D. Fresh device first sync (no prior cursor state)
// ---------------------------------------------------------------------------
test("D. fresh device with no old cursors displaces stale tuples it has never seen", () => {
  // Old device synced long ago; its watermark covers only up to its own
  // (stale) sync moment. The brand-new device has no cursor state at all -
  // it only knows what the API says NOW: the session is at 10:30, 60 tokens.
  const rows = [
    row(OLD, H10, "model-a", 100),
    row(FRESH, H1030, "model-a", 60),
  ];
  const watermarks = [
    watermark(OLD, DAY_WINDOW.start, "2027-01-10T09:59:00.000Z"),
    watermark(FRESH, DAY_WINDOW.start, DAY_WINDOW.end),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 60, "fresh snapshot wins wholesale");
  const byHour = new Map(deduped.map((r) => [r.hour_start, r.total_tokens]));
  assert.equal(byHour.get(H10), undefined);
  assert.equal(byHour.get(H1030), 60);
});

test("D2. an owner with no rows at covered hours displaces every stale tuple", () => {
  // Aggregation-level displacement: the owning device's snapshot holds
  // nothing at a covered hour (e.g. every session there migrated away), so
  // the stale tuples must not survive. NOTE: an EMPTY API response produces
  // NO watermark at all (the TRAE absence contract is NOT PROVEN), so this
  // displacement only ever rides on NON-EMPTY verified snapshots.
  const rows = [row(OLD, H10, "model-a", 100), row(OLD, H11, "model-b", 50)];
  const watermarks = [watermark(FRESH, DAY_WINDOW.start, DAY_WINDOW.end)];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 0, "stale tuples must not survive a verified-empty window");
  assert.equal(deduped.length, 0);
});

// ---------------------------------------------------------------------------
// E. Two devices hold the identical snapshot
// ---------------------------------------------------------------------------
test("E. identical snapshots on two devices count exactly once", () => {
  const rows = [
    row(OLD, H10, "model-a", 100),
    row(FRESH, H10, "model-a", 100),
  ];
  const watermarks = [
    watermark(OLD, DAY_WINDOW.start, DAY_WINDOW.end, "2027-01-15T01:00:00.000Z"),
    watermark(FRESH, DAY_WINDOW.start, DAY_WINDOW.end, "2027-01-15T02:00:00.000Z"),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 100, "same account snapshot must not double");
  assert.equal(deduped.length, 1, "exactly one canonical row");
});

// ---------------------------------------------------------------------------
// Additional ownership semantics
// ---------------------------------------------------------------------------
test("upward correction: fresh larger total wins (owner is per-hour, not per-tuple MAX)", () => {
  const rows = [
    row(OLD, H10, "model-a", 60),
    row(FRESH, H10, "model-a", 100),
  ];
  const watermarks = [
    watermark(OLD, DAY_WINDOW.start, "2027-01-10T09:59:00.000Z"),
    watermark(FRESH, DAY_WINDOW.start, DAY_WINDOW.end),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 100);
});

test("an old device that never comes back online cannot keep owning newer hours", () => {
  // The stale device's watermark window ENDS before the fresher sync; hours
  // inside the fresher window belong to the fresh device even though the old
  // device's numbers are larger (revoked / inactive / retired device).
  const rows = [
    row(OLD, H10, "model-a", 100),
    row(FRESH, H10, "model-a", 40),
  ];
  const watermarks = [
    watermark(OLD, "2027-01-09T00:00:00.000Z", "2027-01-10T09:59:00.000Z"),
    watermark(FRESH, "2027-01-09T00:00:00.000Z", "2027-01-12T00:00:00.000Z"),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 40, "freshest covering window owns the hour");
});

test("hours covered by no watermark keep the legacy whole-row MAX dedup (cursor / watermark-less history)", () => {
  const rows = [
    row(OLD, H10, "model-a", 100),
    row(FRESH, H10, "model-a", 120),
    row(OLD, H10, "model-b", 30),
    row(FRESH, H10, "model-b", 30),
  ];
  const deduped = dedupeAccountLevelRows(rows, []);
  assert.equal(sumTotalTokens(deduped), 150, "per-model MAX pick, identical rows count once");
  assert.equal(deduped.length, 2);
});

test("partial coverage: covered hours use ownership, uncovered hours stay legacy", () => {
  const rows = [
    row(OLD, H10, "model-a", 100),
    row(FRESH, H10, "model-a", 60),
    row(OLD, H1030, "model-a", 70),
    row(FRESH, H1030, "model-a", 90),
  ];
  // The watermark window covers ONLY 10:00; 10:30 falls back to legacy MAX.
  const watermarks = [watermark(FRESH, "2027-01-10T10:00:00.000Z", "2027-01-10T10:30:00.000Z")];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  const byHour = new Map(deduped.map((r) => [r.hour_start, r.total_tokens]));
  assert.equal(byHour.get(H10), 60, "covered hour: owner row wins even though smaller");
  assert.equal(byHour.get(H1030), 90, "uncovered hour: legacy MAX");
});

test("owner selection tiebreak is deterministic: window_end, then window_start, then device_id", () => {
  const rows = [
    row("aaaa0000-0000-0000-0000-000000000000", H10, "model-a", 10),
    row("bbbb0000-0000-0000-0000-000000000000", H10, "model-a", 20),
  ];
  // Equal window identity -> smaller device_id wins (deterministic, mirrors
  // the SQL ORDER BY ... w.device_id LIMIT 1).
  const watermarks = [
    watermark("bbbb0000-0000-0000-0000-000000000000", DAY_WINDOW.start, DAY_WINDOW.end),
    watermark("aaaa0000-0000-0000-0000-000000000000", DAY_WINDOW.start, DAY_WINDOW.end),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 10, "device_id aaa... owns the tie");

  // updated_at is IRRELEVANT to ownership: watermark rows are immutable
  // (first-upload timestamp only), so a wildly later updated_at on the SAME
  // window identity must NOT flip the pick — this is what makes transport
  // retries harmless (regression E.23).
  const watermarks2 = [
    watermark("aaaa0000-0000-0000-0000-000000000000", DAY_WINDOW.start, DAY_WINDOW.end, "2027-01-15T00:00:00.000Z"),
    watermark("bbbb0000-0000-0000-0000-000000000000", DAY_WINDOW.start, DAY_WINDOW.end, "2027-02-16T00:00:00.000Z"),
  ];
  const deduped2 = dedupeAccountLevelRows(rows, watermarks2);
  assert.equal(sumTotalTokens(deduped2), 10, "later updated_at on the same window must not steal ownership");

  // A strictly later window_end wins outright (aaaa verified through
  // 01-13, bbbb only through 01-12 -> aaaa owns despite the device_id order).
  const watermarks3 = [
    watermark("bbbb0000-0000-0000-0000-000000000000", DAY_WINDOW.start, DAY_WINDOW.end),
    watermark("aaaa0000-0000-0000-0000-000000000000", DAY_WINDOW.start, "2027-01-13T00:00:00.000Z"),
  ];
  const deduped3 = dedupeAccountLevelRows(rows, watermarks3);
  assert.equal(sumTotalTokens(deduped3), 10, "larger window_end owns");
});
test("watermarks are scoped per source: a cursor watermark never owns trae-cn hours", () => {
  const rows = [row(OLD, H10, "model-a", 100)];
  const watermarks = [
    {
      device_id: FRESH,
      source: "cursor", // different account source
      window_start: DAY_WINDOW.start,
      window_end: DAY_WINDOW.end,
    },
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  // No trae-cn watermark -> uncovered -> legacy MAX keeps the single row.
  assert.equal(sumTotalTokens(deduped), 100);
});

test("degenerate watermarks (empty window / unparseable dates) are ignored", () => {
  const rows = [row(OLD, H10, "model-a", 100)];
  const watermarks = [
    watermark(FRESH, DAY_WINDOW.end, DAY_WINDOW.start), // inverted
    watermark(FRESH, "not-a-date", DAY_WINDOW.end),
    watermark(FRESH, DAY_WINDOW.start, "not-a-date"),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 100, "falls back to legacy dedup");
});

test("sumTotalTokens tolerates junk input", () => {
  assert.equal(sumTotalTokens(null), 0);
  assert.equal(sumTotalTokens([null, { total_tokens: "x" }, { total_tokens: 5 }]), 5);
});

// ---------------------------------------------------------------------------
// SQL / deployment parity: the deployed aggregation must implement the SAME
// owner-selection semantics as the JS spec above.
// ---------------------------------------------------------------------------
function readRepoFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("account_usage_grouped RPC implements watermark ownership with the same tiebreak as the JS spec", () => {
  const sql = readRepoFile("scripts/ops/account-usage-grouped-rpc.sql");
  assert.match(sql, /tokentracker_account_sync_watermarks/, "RPC reads the watermark table");
  assert.match(
    sql,
    /ORDER BY w\.window_end DESC, w\.window_start DESC, w\.snapshot_verified_at DESC, w\.device_id/,
    "owner tiebreak must be window_end DESC, window_start DESC, snapshot_verified_at DESC, device_id - same as pickOwnerWatermark; updated_at never participates",
  );
  assert.match(
    sql,
    /ah\.hour_start >= w\.first_covered_hour/,
    "coverage starts at the snapshot's first data bucket, not window_start",
  );
  assert.match(
    sql,
    /ah\.hour_start \+ interval '30 minutes' <= w\.window_end/,
    "a bucket is owned only when FULLY contained (bucket end <= window end)",
  );
  assert.match(
    sql,
    /o\.owner_device_id = h\.device_id/,
    "covered hours must count ONLY the owner device's rows",
  );
  assert.match(
    sql,
    /o\.owner_device_id IS NULL/,
    "uncovered hours must keep the legacy whole-row MAX branch",
  );
  // The covered branch must NOT be active-device filtered (ownership follows
  // verified information, not device liveness).
  const coveredBranch = sql.split("WATERMARK-COVERED hours: the owner device's rows count")[1]
    .split("UNION ALL")[0];
  assert.doesNotMatch(
    coveredBranch,
    /revoked_at IS NULL/,
    "covered branch must not active-filter (a since-revoked owner still owns its verified hours)",
  );
});

test("leaderboard_hourly_dedup_v2 migration mirrors the RPC ownership semantics and includes trae-cn", () => {
  const sql = readRepoFile("migrations/20260817120000_account-sync-watermarks.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.tokentracker_account_sync_watermarks/);
  assert.match(
    sql,
    /PRIMARY KEY \(user_id, device_id, source, window_start, window_end\)/,
    "watermark identity is the full window - rows are immutable history, never overwritten",
  );
  assert.match(sql, /CHECK \(window_end > window_start\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  // The leaderboard function must agree with account_usage_grouped.
  assert.match(
    sql,
    /ORDER BY w\.window_end DESC, w\.window_start DESC, w\.snapshot_verified_at DESC, w\.device_id/,
    "leaderboard owner tiebreak must equal the account RPC tiebreak",
  );
  assert.match(
    sql,
    /ah\.hour_start >= w\.first_covered_hour/,
    "leaderboard coverage also starts at first_covered_hour",
  );
  assert.match(
    sql,
    /first_covered_hour timestamptz NOT NULL/,
    "coverage start is a required column (absence cannot be faked)",
  );
  assert.match(sql, /ARRAY\['cursor', 'trae-cn'\]::text\[\] AS account_sources/);
  assert.match(sql, /o\.owner_device_id = h\.device_id/);
  assert.match(sql, /o\.owner_device_id IS NULL/);
});

test("ingest edge accepts account_watermarks and upserts them after the bucket rows", () => {
  const ts = readRepoFile("dashboard/edge-patches/tokentracker-ingest.ts");
  assert.match(ts, /account_watermarks/, "edge reads the account_watermarks payload");
  assert.match(
    ts,
    /tokentracker_account_sync_watermarks/,
    "edge upserts into the watermark table",
  );
  assert.match(
    ts,
    /onConflict: "user_id,device_id,source,window_start,window_end"/,
    "upsert conflict target matches the immutable window identity PK",
  );
  assert.match(
    ts,
    /ignoreDuplicates: true/,
    "a re-delivered watermark is a no-op (retry never refreshes updated_at / freshness)",
  );
  // Watermark upsert must come AFTER the hourly upsert in file order.
  assert.ok(
    ts.indexOf("from(\"tokentracker_hourly\")") < ts.indexOf("tokentracker_account_sync_watermarks"),
    "bucket rows land before the watermark that covers them",
  );
  // Malformed watermarks fail closed.
  assert.match(ts, /Invalid account watermark/);
});

test("local queue readers never surface watermark control records as usage rows", () => {
  const localApi = readRepoFile("src/lib/local-api.js");
  assert.match(
    localApi,
    /kind === "account_sync_watermark"/,
    "readQueueData must skip account_sync_watermark records",
  );
  const sync = readRepoFile("src/commands/sync.js");
  assert.match(
    sync,
    /account_watermarks/,
    "drainQueueToCloud must forward watermarks to the ingest edge",
  );
});
// ---------------------------------------------------------------------------
// F. Historical ownership survives the 30-day window sliding past (>30 days
// regression - merge-blocker): watermark rows are IMMUTABLE history, so the
// covering watermark that displaced a stale tuple stays in the table even
// after BOTH devices' current rolling windows no longer cover the hour.
// ---------------------------------------------------------------------------
test("F. corrected history stays corrected after the 30-day window slides past it", () => {
  // Day 0: OLD synced H10/model-a=100 (its watermark covered H10 then).
  // Day 1: TRAE corrects the session to model-b=60; FRESH syncs the
  // corrected snapshot - FRESH's day-1 watermark (greater window_end) owns H10.
  // Day 31+: both devices' CURRENT windows have slid past H10; only the
  // immutable historical rows still cover it. FRESH's day-1 watermark row
  // must STILL own H10 - the correction must never resurrect via the legacy
  // MAX fallback, and the stale model-a tuple must stay displaced.
  const rows = [
    row(OLD, H10, "model-a", 100), // OLD's stale row (uploaded day 0)
    row(FRESH, H10, "model-b", 60), // FRESH's corrected row (uploaded day 1)
  ];
  const watermarks = [
    // OLD: day-0 window (covered H10) + current day-31 window (does not).
    watermark(OLD, "2026-12-11T00:00:00.000Z", "2027-01-10T11:00:00.000Z"),
    watermark(OLD, "2027-02-10T00:00:00.000Z", "2027-03-12T00:00:00.000Z"),
    // FRESH: day-1 corrected window (still covers H10 - immutable history)
    // + current day-32 window (does not).
    watermark(FRESH, "2026-12-11T00:00:00.000Z", "2027-01-12T00:00:00.000Z"),
    watermark(FRESH, "2027-02-11T00:00:00.000Z", "2027-03-13T00:00:00.000Z"),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  const byModel = totalByModel(deduped);
  assert.equal(byModel.get("model-a") || 0, 0, "stale model-a must stay displaced");
  assert.equal(byModel.get("model-b"), 60, "corrected value survives the window slide");
  assert.equal(sumTotalTokens(deduped), 60, "must stay 60 - never 100, never 160");
});

test("F2. downward correction also survives the 30-day window slide", () => {
  const rows = [
    row(OLD, H10, "model-a", 100),
    row(FRESH, H10, "model-a", 60),
  ];
  const watermarks = [
    watermark(OLD, "2026-12-11T00:00:00.000Z", "2027-01-10T11:00:00.000Z"),
    watermark(OLD, "2027-02-10T00:00:00.000Z", "2027-03-12T00:00:00.000Z"),
    watermark(FRESH, "2026-12-11T00:00:00.000Z", "2027-01-12T00:00:00.000Z"),
    watermark(FRESH, "2027-02-11T00:00:00.000Z", "2027-03-13T00:00:00.000Z"),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 60, "must stay the corrected 60, never MAX 100");
});

test("F3. no fallback to stale MAX: a once-covered hour never reverts to legacy dedup", () => {
  // Even when the ONLY covering watermark is months old (the correcting
  // device long retired), the hour is covered - legacy MAX must not run.
  const rows = [
    row(OLD, H10, "model-a", 100),
    row(FRESH, H10, "model-a", 60),
  ];
  const watermarks = [
    watermark(FRESH, "2026-12-11T00:00:00.000Z", "2027-01-12T00:00:00.000Z", "2027-06-01T00:00:00.000Z"),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 60);
});

// ---------------------------------------------------------------------------
// G. Bucket-coverage boundary contract: a watermark claims a half-hour
// bucket only when the bucket is FULLY inside [window_start, window_end].
// The rolling fetch start is bucket-aligned down and the end is floor(now),
// so honest gaps stay uncovered (legacy fallback) instead of being claimed.
// ---------------------------------------------------------------------------
test("G1. left boundary: a window starting mid-bucket does not claim that bucket", () => {
  // Unaligned start 08:37: the 08:30 bucket is only PARTIALLY verified.
  const rows = [
    row(OLD, "2027-01-10T08:30:00.000Z", "model-a", 100),
    row(FRESH, "2027-01-10T08:30:00.000Z", "model-a", 60),
  ];
  const watermarks = [watermark(FRESH, "2027-01-10T08:37:00.000Z", DAY_WINDOW.end)];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(
    sumTotalTokens(deduped),
    100,
    "partial bucket falls back to legacy MAX - never claimed by a partial window",
  );
});

test("G2. right boundary: window_end exactly at a bucket start does not claim it", () => {
  // end = 10:30:00: the 10:30 bucket spans [10:30, 11:00) - only its first
  // instant is verified. Not claimed.
  const rows = [
    row(OLD, H1030, "model-a", 100),
    row(FRESH, H1030, "model-a", 60),
  ];
  const watermarks = [watermark(FRESH, DAY_WINDOW.start, "2027-01-10T10:30:00.000Z")];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 100, "the 10:30 bucket is NOT claimed by a window ending 10:30");
});

test("G3. right boundary: window_end mid-bucket does not claim the in-progress bucket", () => {
  // end = 10:47: the 10:30 bucket [10:30, 11:00) is only verified through
  // 10:47. Not claimed.
  const rows = [
    row(OLD, H1030, "model-a", 100),
    row(FRESH, H1030, "model-a", 60),
  ];
  const watermarks = [watermark(FRESH, DAY_WINDOW.start, "2027-01-10T10:47:00.000Z")];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 100, "in-progress bucket stays uncovered (legacy fallback)");
});

test("G4. right boundary: window_end at the bucket END fully claims the bucket", () => {
  // end = 11:00: the 10:30 bucket [10:30, 11:00) is fully contained.
  const rows = [
    row(OLD, H1030, "model-a", 100),
    row(FRESH, H1030, "model-a", 60),
  ];
  const watermarks = [watermark(FRESH, DAY_WINDOW.start, "2027-01-10T11:00:00.000Z")];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 60, "a fully-contained bucket is owned by its verifier");
});

// ---------------------------------------------------------------------------
// H. Transport retry idempotence (E.23): a re-delivered watermark of an
// older snapshot must never outrank a genuinely newer verified window,
// even if its updated_at looks fresher.
// ---------------------------------------------------------------------------
test("H. an old watermark re-delivered late never steals ownership from a newer snapshot", () => {
  const A = "aaaa0000-0000-0000-0000-000000000000";
  const B = "bbbb0000-0000-0000-0000-000000000000";
  const rows = [
    row(A, H10, "model-a", 100), // A's stale row
    row(B, H10, "model-a", 60), // B's corrected row
  ];
  const watermarks = [
    // A's snapshot verified at T1; its queue record re-delivered at T3
    // (updated_at refreshed by the retry - the legacy failure mode).
    watermark(A, DAY_WINDOW.start, "2027-01-11T00:00:00.000Z", "2027-03-01T00:00:00.000Z"),
    // B's genuinely newer window (verified T2): later window_end.
    watermark(B, DAY_WINDOW.start, "2027-01-12T00:00:00.000Z", "2027-01-20T00:00:00.000Z"),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 60, "window identity, not updated_at, decides ownership");
});

// ---------------------------------------------------------------------------
// I. P0 absence narrowing: enumeration is only PROVEN from the snapshot's
// FIRST data bucket (first_covered_hour) onward. A non-empty snapshot must
// NOT assert authoritative zero for hours BEFORE its first observed session
// (contract probe 2026-08-17: "no rows before the first data point" cannot
// be distinguished from an API index boundary).
// ---------------------------------------------------------------------------
test("I1. hours before the snapshot's first data bucket are NOT owned (no absence inference)", () => {
  // Old device B holds 10:00/model-a=100; new device A's non-empty snapshot
  // only contains 11:00/model-b=20 (first data at 11:00). The P0 review case:
  // A must NOT zero out 10:00 merely because its response lacked the session.
  const rows = [
    row(OLD, H10, "model-a", 100),
    row(FRESH, H11, "model-b", 20),
  ];
  const watermarks = [
    watermark(OLD, DAY_WINDOW.start, DAY_WINDOW.end),
    watermark(FRESH, DAY_WINDOW.start, DAY_WINDOW.end, undefined, {
      firstCovered: H11, // A's snapshot starts at 11:00
      verifiedAt: "2027-01-16T00:00:00.000Z", // A fetched after B
    }),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  const byModel = totalByModel(deduped);
  assert.equal(byModel.get("model-a"), 100, "10:00 stays legacy: B's row is kept, not zeroed");
  assert.equal(byModel.get("model-b"), 20, "11:00 is owned by FRESH");
});

test("I2. the first covered bucket itself IS owned (data anchors enumeration from there)", () => {
  const rows = [
    row(OLD, H10, "model-a", 100),
    row(FRESH, H10, "model-a", 60),
  ];
  const watermarks = [
    watermark(OLD, DAY_WINDOW.start, DAY_WINDOW.end),
    watermark(FRESH, DAY_WINDOW.start, DAY_WINDOW.end, undefined, {
      firstCovered: H10, // FRESH's first data bucket is exactly H10
      verifiedAt: "2027-01-16T00:00:00.000Z", // FRESH fetched after OLD
    }),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 60, "downward correction still lands on the first covered bucket");
});

test("I3. a watermark missing first_covered_hour / snapshot_verified_at owns nothing", () => {
  const rows = [row(OLD, H10, "model-a", 100)];
  const wm = watermark(FRESH, DAY_WINDOW.start, DAY_WINDOW.end);
  const broken1 = { ...wm, first_covered_hour: undefined };
  const broken2 = { ...wm, snapshot_verified_at: undefined };
  for (const broken of [broken1, broken2]) {
    const deduped = dedupeAccountLevelRows(rows, [broken]);
    assert.equal(sumTotalTokens(deduped), 100, "incomplete watermark rows fall back to legacy dedup");
  }
});

test("I4. first_covered_hour outside the window is rejected (owns nothing)", () => {
  const rows = [row(OLD, H10, "model-a", 100)];
  const watermarks = [
    watermark(FRESH, DAY_WINDOW.start, DAY_WINDOW.end, undefined, {
      firstCovered: "2027-01-20T00:00:00.000Z", // after window_end: invalid
    }),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 100, "invalid coverage rows assert nothing");
});

// ---------------------------------------------------------------------------
// J. P1 same-window logical freshness: two devices can produce the SAME
// window identity (same-second floor(now)) with different real fetch times.
// snapshot_verified_at - the logical fetch stamp replayed verbatim by the
// append-only queue - decides; device_id is only the final tiebreak.
// ---------------------------------------------------------------------------
test("J1. same window: the genuinely newer fetch wins regardless of device_id", () => {
  // OLD fetches at T1 (100); FRESH fetches at T2 > T1 after a correction (60).
  // OLD has the smaller device_id, which previously decided the tie - wrongly.
  const rows = [
    row(OLD, H10, "model-a", 100),
    row(FRESH, H10, "model-a", 60),
  ];
  const watermarks = [
    watermark(OLD, DAY_WINDOW.start, DAY_WINDOW.end, undefined, {
      verifiedAt: "2027-01-10T10:00:00.000Z",
    }),
    watermark(FRESH, DAY_WINDOW.start, DAY_WINDOW.end, undefined, {
      verifiedAt: "2027-01-10T10:05:00.000Z",
    }),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 60, "newer logical fetch owns the hour, not the smaller device_id");
});

test("J2. a late transport retry of the older snapshot cannot steal ownership", () => {
  // OLD verified at T1; FRESH verified at T2 > T1; OLD's queue record is only
  // uploaded at T3 > T2 (network retry). The retry replays the ORIGINAL T1
  // stamp - and updated_at (upload time) never participates - so FRESH keeps
  // the hour.
  const rows = [
    row(OLD, H10, "model-a", 100),
    row(FRESH, H10, "model-a", 60),
  ];
  const watermarks = [
    // OLD re-delivered at T3: original verifiedAt T1, late updated_at T3.
    watermark(OLD, DAY_WINDOW.start, DAY_WINDOW.end, "2027-01-11T00:00:00.000Z", {
      verifiedAt: "2027-01-10T10:00:00.000Z",
    }),
    watermark(FRESH, DAY_WINDOW.start, DAY_WINDOW.end, "2027-01-10T10:30:00.000Z", {
      verifiedAt: "2027-01-10T10:05:00.000Z",
    }),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 60, "FRESH (verified T2) still owns despite OLD's T3 re-delivery");
});

test("J3. replaying the same watermark record is idempotent (no new logical version)", () => {
  const rows = [row(OLD, H10, "model-a", 100), row(FRESH, H10, "model-a", 60)];
  const wm = watermark(FRESH, DAY_WINDOW.start, DAY_WINDOW.end, undefined, {
    verifiedAt: "2027-01-10T10:05:00.000Z",
  });
  const once = dedupeAccountLevelRows(rows, [wm]);
  const thrice = dedupeAccountLevelRows(rows, [wm, { ...wm }, { ...wm }]);
  assert.deepEqual(once, thrice, "duplicate records of one snapshot do not change ownership");
});
