"use strict";

/**
 * Account-level cross-device dedup - JS reference implementation.
 *
 * Account-level sources (ACCOUNT_LEVEL_SOURCES in src/lib/source-metadata.js)
 * come from a per-ACCOUNT cloud API, so every device that syncs them stores
 * its own copy of the SAME account data. Worse, TRAE CN's API returns
 * correctable snapshots, not append-only events: a session can be re-reported
 * with a smaller total, a different model, or a shifted time bucket. Two
 * devices therefore hold different snapshot VERSIONS of one account hour, and
 * the old cloud aggregation - per (hour, source, model) pick MAX(total_tokens)
 * - stitches incompatible versions together:
 *
 *   downward correction: old device H/A=100, fresh device H/A=60 -> MAX=100
 *   model migration:     old device H/A=100, fresh device H/B=100 -> 200
 *   bucket migration:    old device 10:00/A=100, fresh 10:30/A=100 -> 200
 *
 * The fix: every successful account-source sync appends a WATERMARK record
 * (kind: "account_sync_watermark") asserting the closed window that device
 * just verified against the API. Aggregation then picks, per hour, ONE
 * canonical owning device - the freshest watermark whose window covers that
 * hour - and counts ONLY that device's rows for the whole hour (every model;
 * a model the owner lacks counts as 0). A fresh device that has never seen
 * the stale tuples still displaces them, because ownership is asserted per
 * hour RANGE, not per tuple. Hours covered by no watermark (sources or
 * devices predating watermarks, e.g. cursor) keep the legacy whole-row MAX
 * dedup, so nothing regresses for watermark-less sources.
 *
 * This module is the executable specification of that semantics; the
 * deployed SQL (scripts/ops/account-usage-grouped-rpc.sql account branch and
 * migrations/* leaderboard_hourly_dedup_v2) implements the same algorithm and
 * MUST stay in sync - test/account-usage-dedup.test.js pins both.
 */

const WATERMARK_KIND = "account_sync_watermark";

function parseMs(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// Bucket span: usage buckets are half-hours, and a watermark only claims a
// bucket it FULLY contains (bucketStart >= window_start AND bucketEnd <=
// window_end). A partially verified bucket (e.g. the in-progress final
// half-hour of a rolling window ending at floor(now)) is NOT claimed.
const BUCKET_SPAN_MS = 30 * 60 * 1000;

// Mirrors SQL owner selection: full-containment coverage, then
// ORDER BY window_end DESC, window_start DESC, device_id. updated_at never
// participates: watermark rows are immutable history and updated_at is the
// FIRST-upload time, so a transport retry cannot steal ownership from a
// genuinely newer snapshot.
function pickOwnerWatermark(watermarks, hourStartMs) {
  let best = null;
  for (const wm of watermarks) {
    const startMs = parseMs(wm.window_start);
    const endMs = parseMs(wm.window_end);
    if (startMs === null || endMs === null || endMs <= startMs) continue;
    if (hourStartMs < startMs || hourStartMs + BUCKET_SPAN_MS > endMs) continue;
    if (!best) {
      best = wm;
      continue;
    }
    const bestEnd = parseMs(best.window_end) || 0;
    const wmEnd = endMs;
    if (wmEnd !== bestEnd) {
      if (wmEnd > bestEnd) best = wm;
      continue;
    }
    const bestStart = parseMs(best.window_start) || 0;
    if (startMs !== bestStart) {
      if (startMs > bestStart) best = wm;
      continue;
    }
    if (String(wm.device_id) < String(best.device_id)) best = wm;
  }
  return best;
}
// Mirrors the legacy SQL DISTINCT ON (hour, source, model)
// ORDER BY total_tokens DESC, updated_at DESC (device_id asc as the final
// deterministic tiebreak).
function pickLegacyRow(rows) {
  let best = null;
  for (const row of rows) {
    if (!best) {
      best = row;
      continue;
    }
    const rowTotal = Number(row.total_tokens) || 0;
    const bestTotal = Number(best.total_tokens) || 0;
    if (rowTotal !== bestTotal) {
      if (rowTotal > bestTotal) best = row;
      continue;
    }
    const rowUpdated = parseMs(row.updated_at ?? "") ?? -Infinity;
    const bestUpdated = parseMs(best.updated_at ?? "") ?? -Infinity;
    if (rowUpdated !== bestUpdated) {
      if (rowUpdated > bestUpdated) best = row;
      continue;
    }
    if (String(row.device_id) < String(best.device_id)) best = row;
  }
  return best;
}

/**
 * Dedupe account-level hourly rows across devices.
 *
 * @param {Array<{device_id: string, hour_start: string, source: string,
 *   model: string, updated_at?: string, total_tokens: number}>} rows -
 *   every device's tokentracker_hourly-shaped rows for account-level sources.
 * @param {Array<{device_id: string, source: string, window_start: string,
 *   window_end: string, updated_at?: string}>} watermarks - per-device
 *   verified sync windows (tokentracker_account_sync_watermarks shape).
 * @returns {Array} canonical rows - one consistent snapshot per hour.
 */
function dedupeAccountLevelRows(rows, watermarks = []) {
  if (!Array.isArray(rows)) return [];
  const watermarkList = Array.isArray(watermarks) ? watermarks : [];
  const watermarksBySource = new Map();
  for (const wm of watermarkList) {
    if (!wm || typeof wm.source !== "string") continue;
    const list = watermarksBySource.get(wm.source) || [];
    list.push(wm);
    watermarksBySource.set(wm.source, list);
  }

  // Group rows by (source, hour_start); keep original row objects untouched.
  const byHour = new Map();
  for (const row of rows) {
    if (!row || typeof row.hour_start !== "string" || !row.hour_start) continue;
    const key = `${row.source}||${row.hour_start}`;
    const list = byHour.get(key) || [];
    list.push(row);
    byHour.set(key, list);
  }

  const out = [];
  for (const [key, hourRows] of byHour) {
    const source = key.split("||")[0];
    const hourStartMs = parseMs(hourRows[0].hour_start);
    if (hourStartMs === null) continue;
    const candidates = watermarksBySource.get(String(source).toLowerCase()) || [];
    const owner = pickOwnerWatermark(candidates, hourStartMs);
    if (owner) {
      // Watermark-covered hour: the owner's rows count exclusively; an owner
      // with no rows at this hour means the account truly has 0 here and every
      // other device's stale tuple is displaced.
      for (const row of hourRows) {
        if (String(row.device_id) === String(owner.device_id)) out.push(row);
      }
      continue;
    }
    // Uncovered hour (no watermark asserts it): legacy whole-row MAX dedup.
    const byModel = new Map();
    for (const row of hourRows) {
      const modelKey = row.model || "unknown";
      const list = byModel.get(modelKey) || [];
      list.push(row);
      byModel.set(modelKey, list);
    }
    for (const list of byModel.values()) {
      out.push(pickLegacyRow(list));
    }
  }
  return out;
}

/** Total tokens of a deduped row set - convenience for tests/diagnostics. */
function sumTotalTokens(rows) {
  return (Array.isArray(rows) ? rows : []).reduce(
    (acc, row) => acc + (Number(row?.total_tokens) || 0),
    0,
  );
}

module.exports = {
  WATERMARK_KIND,
  dedupeAccountLevelRows,
  sumTotalTokens,
};
