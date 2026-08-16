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

function watermark(deviceId, start, end, updatedAt) {
  return {
    device_id: deviceId,
    source: "trae-cn",
    window_start: start,
    window_end: end,
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

test("D2. fresh device verified-empty window zeros out stale tuples completely", () => {
  // The strongest displacement case: the API now reports NOTHING for the
  // window that the old device's stale tuples live in. The fresh device
  // contributes no rows at all - only its watermark.
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

test("owner selection tiebreak is deterministic: window_end, then updated_at, then device_id", () => {
  const rows = [
    row("aaaa0000-0000-0000-0000-000000000000", H10, "model-a", 10),
    row("bbbb0000-0000-0000-0000-000000000000", H10, "model-a", 20),
  ];
  // Equal windows + equal updated_at -> smaller device_id wins (matches the
  // SQL ORDER BY ... w.device_id LIMIT 1).
  const watermarks = [
    watermark("bbbb0000-0000-0000-0000-000000000000", DAY_WINDOW.start, DAY_WINDOW.end, "2027-01-15T00:00:00.000Z"),
    watermark("aaaa0000-0000-0000-0000-000000000000", DAY_WINDOW.start, DAY_WINDOW.end, "2027-01-15T00:00:00.000Z"),
  ];
  const deduped = dedupeAccountLevelRows(rows, watermarks);
  assert.equal(sumTotalTokens(deduped), 10, "device_id aaa... owns the tie");

  // Later updated_at on the same window_end wins over device_id order.
  const watermarks2 = [
    watermark("aaaa0000-0000-0000-0000-000000000000", DAY_WINDOW.start, DAY_WINDOW.end, "2027-01-15T00:00:00.000Z"),
    watermark("bbbb0000-0000-0000-0000-000000000000", DAY_WINDOW.start, DAY_WINDOW.end, "2027-01-16T00:00:00.000Z"),
  ];
  const deduped2 = dedupeAccountLevelRows(rows, watermarks2);
  assert.equal(sumTotalTokens(deduped2), 20, "later updated_at owns the tie");

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
    /ORDER BY w\.window_end DESC, w\.updated_at DESC, w\.device_id/,
    "owner tiebreak must be window_end DESC, updated_at DESC, device_id - same as pickOwnerWatermark",
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
    /PRIMARY KEY \(user_id, device_id, source\)/,
    "watermark identity is per (user, device, source) - last upsert per device wins",
  );
  assert.match(sql, /CHECK \(window_end > window_start\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  // The leaderboard function must agree with account_usage_grouped.
  assert.match(
    sql,
    /ORDER BY w\.window_end DESC, w\.updated_at DESC, w\.device_id/,
    "leaderboard owner tiebreak must equal the account RPC tiebreak",
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
    /onConflict: "user_id,device_id,source"/,
    "upsert conflict target matches the table PK",
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
