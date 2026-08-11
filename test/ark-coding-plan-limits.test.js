"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  normalizeArkPlansResponse,
  normalizeArkCodingPlanResponse,
  fetchArkCodingPlanLimits,
} = require("../src/lib/ark-coding-plan-limits");

const USAGE_JSON = JSON.stringify({
  viewer: {
    auth_method: "sso",
    user_id: "2126262990",
    profile: "coding-plan_cn-beijing_personal",
  },
  items: [
    {
      product: "coding-plan",
      edition: "personal",
      subscribed: true,
      periods: [
        { label: "session", percent: 32.7377, reset_at: "2026-08-11T17:42:00+08:00" },
        { label: "weekly", percent: 15.670588333333333, reset_at: "2026-08-17T00:00:00+08:00" },
        { label: "monthly", percent: 8.179090833333333, reset_at: "2026-09-09T23:59:59+08:00" },
      ],
    },
  ],
});

const PLANS_JSON = JSON.stringify({
  plans: [
    { key: "coding-plan", name: "Coding Plan", scope: "personal", tier: "lite", status: "Running" },
  ],
});

// Injects a spawnSync-shaped runner that dispatches on the command name.
function mockRunner({
  which = true,
  plansStdout = PLANS_JSON,
  usageStdout = USAGE_JSON,
  usageStatus = 0,
  usageError = null,
} = {}) {
  return (command, args) => {
    if (command === "which") {
      return which
        ? { status: 0, stdout: "/usr/local/bin/arkcli\n", stderr: "" }
        : { status: 1, stdout: "", stderr: "" };
    }
    if (command === "arkcli") {
      if (args[0] === "plans") {
        return { status: 0, stdout: plansStdout, stderr: "" };
      }
      if (args[0] === "usage") {
        return {
          status: usageStatus,
          stdout: usageStdout,
          stderr: usageError ? "boom" : "",
          ...(usageError ? { error: usageError } : {}),
        };
      }
    }
    return { status: 1, stdout: "", stderr: "unknown command" };
  };
}

function tmpHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ark-plan-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("normalizeArkCodingPlanResponse maps three periods to windows", () => {
  const result = normalizeArkCodingPlanResponse(JSON.parse(USAGE_JSON));
  assert.equal(result.configured, true);
  assert.equal(result.primary_window.used_percent, 32.7377);
  assert.equal(result.primary_window.reset_at, "2026-08-11T09:42:00.000Z");
  assert.equal(result.primary_window.unit, "calls");
  assert.equal(result.secondary_window.used_percent, 15.670588333333333);
  assert.equal(result.secondary_window.reset_at, "2026-08-16T16:00:00.000Z");
  assert.equal(result.tertiary_window.used_percent, 8.179090833333333);
  assert.equal(result.tertiary_window.reset_at, "2026-09-09T15:59:59.000Z");
  assert.equal(result.source, "provider-api");
});

test("normalizeArkCodingPlanResponse returns null when not subscribed", () => {
  const body = JSON.parse(USAGE_JSON);
  body.items[0].subscribed = false;
  assert.equal(normalizeArkCodingPlanResponse(body), null);
  assert.equal(normalizeArkCodingPlanResponse({ items: [] }), null);
});

test("normalizeArkCodingPlanResponse throws on unusable payload", () => {
  assert.throws(() => normalizeArkCodingPlanResponse(null));
  assert.throws(() => normalizeArkCodingPlanResponse({ items: [{ product: "coding-plan", subscribed: true, periods: [] }] }));
});

test("normalizeArkPlansResponse extracts tier from plans payload", () => {
  assert.equal(normalizeArkPlansResponse(JSON.parse(PLANS_JSON)), "lite");
  assert.equal(normalizeArkPlansResponse({ plans: [] }), null);
  assert.equal(normalizeArkPlansResponse({ plans: [{ key: "agent-plan", tier: "pro" }] }), null);
});

test("fetchArkCodingPlanLimits succeeds with real payloads", async (t) => {
  const home = tmpHome(t);
  const result = await fetchArkCodingPlanLimits({ commandRunner: mockRunner(), home });
  assert.equal(result.configured, true);
  assert.equal(result.error, null);
  assert.equal(result.plan_label, "Lite");
  assert.equal(result.primary_window.used_percent, 32.7377);
  assert.equal(result.secondary_window.used_percent, 15.670588333333333);
  assert.equal(result.tertiary_window.used_percent, 8.179090833333333);
  assert.equal(result.source, "provider-api");
  // Cache should have been written.
  const cachePath = path.join(home, ".tokentracker", "tracker", "ark-coding-plan-limits-cache.json");
  assert.equal(fs.existsSync(cachePath), true);
});

test("fetchArkCodingPlanLimits reports configured:false when arkcli is missing", async (t) => {
  const result = await fetchArkCodingPlanLimits({ commandRunner: mockRunner({ which: false }), home: tmpHome(t) });
  assert.deepEqual(result, { configured: false });
});

test("fetchArkCodingPlanLimits reports configured:false when not subscribed", async (t) => {
  const body = JSON.parse(USAGE_JSON);
  body.items[0].subscribed = false;
  const result = await fetchArkCodingPlanLimits({
    commandRunner: mockRunner({ usageStdout: JSON.stringify(body) }),
    home: tmpHome(t),
  });
  assert.deepEqual(result, { configured: false });
});

test("fetchArkCodingPlanLimits falls back to disk cache on command failure", async (t) => {
  const home = tmpHome(t);
  // First run succeeds and writes the cache.
  await fetchArkCodingPlanLimits({ commandRunner: mockRunner(), home });
  // Second run fails; the cached snapshot must be served with stale flags.
  const runner = mockRunner({
    usageError: new Error("ETIMEDOUT"),
    usageStatus: null,
  });
  const result = await fetchArkCodingPlanLimits({ commandRunner: runner, home });
  assert.equal(result.configured, true);
  assert.equal(result.stale, true);
  assert.equal(result.source, "disk-cache");
  assert.equal(result.primary_window.used_percent, 32.7377);
});

test("fetchArkCodingPlanLimits surfaces an error when nothing is usable", async (t) => {
  const runner = mockRunner({
    usageError: new Error("ETIMEDOUT"),
    usageStatus: null,
  });
  const result = await fetchArkCodingPlanLimits({ commandRunner: runner, home: tmpHome(t) });
  assert.equal(result.configured, true);
  assert.match(result.error, /ETIMEDOUT/);
});
