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
  writeArkCodingPlanLimitsCache,
} = require("../src/lib/ark-coding-plan-limits");

const USAGE_JSON = JSON.stringify({
  viewer: {
    auth_method: "sso",
    user_id: "test-user-001",
    profile: "coding-plan_test_region_personal",
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

// Fetch-path fixtures use reset times relative to `nowMs` so the cache
// rollover tests never go stale as wall-clock time moves past a fixed date.
function usageJsonFor({ nowMs = Date.now() } = {}) {
  const iso = (ms) => new Date(ms).toISOString();
  return JSON.stringify({
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
          { label: "session", percent: 32.7377, reset_at: iso(nowMs + 3 * 3600_000) },
          { label: "weekly", percent: 15.670588333333333, reset_at: iso(nowMs + 3 * 86400_000) },
          { label: "monthly", percent: 8.179090833333333, reset_at: iso(nowMs + 20 * 86400_000) },
        ],
      },
    ],
  });
}

const PLANS_JSON = JSON.stringify({
  plans: [
    { key: "coding-plan", name: "Coding Plan", scope: "personal", tier: "lite", status: "Running" },
  ],
});

// Injects a spawnSync-shaped runner that dispatches on the command name.
function mockRunner({
  which = true,
  plansStdout = PLANS_JSON,
  usageStdout = usageJsonFor(),
  usageStatus = 0,
  usageError = null,
} = {}) {
  return (command, args) => {
    if (command === "which") {
      return which
        ? { status: 0, stdout: "/usr/local/bin/arkcli\n", stderr: "" }
        : { status: 1, stdout: "", stderr: "" };
    }
    // Native Windows discovery probe (where.exe).
    if (command === "where") {
      return which
        ? { status: 0, stdout: "C:\\Program Files\\arkcli.exe\n", stderr: "" }
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

test("fetchArkCodingPlanLimits discovers arkcli via where.exe on Windows", async (t) => {
  const calls = [];
  const runner = (command, args) => {
    calls.push({ command, args });
    return mockRunner()(command, args);
  };
  const result = await fetchArkCodingPlanLimits({
    commandRunner: runner,
    home: tmpHome(t),
    platform: "win32",
  });
  assert.equal(result.configured, true);
  assert.equal(result.plan_label, "Lite");
  // Native Windows discovery must use `where`, never the Unix `which` — on
  // Windows `which` does not exist, so spawning it returns ENOENT and every
  // provider would look unconfigured even when arkcli is installed.
  const commands = calls.map(({ command }) => command);
  assert.ok(commands.includes("where"), `expected where.exe probe, got calls: ${commands.join(", ")}`);
  assert.ok(!commands.includes("which"), `must not use which on win32, got calls: ${commands.join(", ")}`);
  assert.deepEqual(calls.find(({ command }) => command === "where")?.args, ["arkcli"]);
});

test("fetchArkCodingPlanLimits does not serve cache windows past their reset_at", async (t) => {
  const home = tmpHome(t);
  const nowMs = Date.now();
  const expired = new Date(nowMs - 60_000).toISOString();
  // Write a cache whose every window reset before `nowMs` — the quota has
  // rolled over, so the old percentages must not be served as stale data.
  writeArkCodingPlanLimitsCache({
    configured: true,
    error: null,
    plan_label: "Lite",
    primary_window: { used_percent: 100, reset_at: expired, unit: "calls" },
    secondary_window: { used_percent: 50, reset_at: expired, unit: "calls" },
    tertiary_window: { used_percent: 10, reset_at: expired, unit: "calls" },
  }, { home, nowMs });

  const runner = mockRunner({
    usageError: new Error("ETIMEDOUT"),
    usageStatus: null,
  });
  const result = await fetchArkCodingPlanLimits({ commandRunner: runner, home, nowMs });
  assert.equal(result.configured, true);
  assert.equal(result.stale, undefined, "expired cache must not be served as stale data");
  assert.equal(result.source, undefined);
  assert.match(result.error, /ETIMEDOUT/);
});

test("fetchArkCodingPlanLimits keeps only cache windows that have not reset", async (t) => {
  const home = tmpHome(t);
  const nowMs = Date.now();
  const expired = new Date(nowMs - 60_000).toISOString();
  const future = new Date(nowMs + 60_000).toISOString();
  writeArkCodingPlanLimitsCache({
    configured: true,
    error: null,
    plan_label: "Lite",
    primary_window: { used_percent: 100, reset_at: expired, unit: "calls" },
    secondary_window: { used_percent: 50, reset_at: future, unit: "calls" },
    tertiary_window: { used_percent: 10, reset_at: expired, unit: "calls" },
  }, { home, nowMs });

  const result = await fetchArkCodingPlanLimits({
    commandRunner: mockRunner({ usageError: new Error("ETIMEDOUT"), usageStatus: null }),
    home,
    nowMs,
  });
  assert.equal(result.configured, true);
  assert.equal(result.stale, true);
  assert.equal(result.source, "disk-cache");
  assert.equal(result.primary_window, null);
  assert.equal(result.secondary_window.used_percent, 50);
  assert.equal(result.tertiary_window, null);
});

test("fetchArkCodingPlanLimits runs the optional plan lookup alongside quota retrieval", async (t) => {
  let usageStarted = false;
  const runner = (command, args) => {
    if (command === "which") return { status: 0, stdout: "/usr/local/bin/arkcli\n", stderr: "" };
    if (command === "arkcli" && args[0] === "plans") {
      return new Promise((resolve) => setTimeout(() => {
        assert.equal(usageStarted, true, "usage plan should begin before plans get finishes");
        resolve({ status: 0, stdout: PLANS_JSON, stderr: "" });
      }, 10));
    }
    if (command === "arkcli" && args[0] === "usage") {
      usageStarted = true;
      return { status: 0, stdout: usageJsonFor(), stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unknown command" };
  };

  const result = await fetchArkCodingPlanLimits({ commandRunner: runner, home: tmpHome(t) });
  assert.equal(result.configured, true);
  assert.equal(result.plan_label, "Lite");
});

test("fetchArkCodingPlanLimits passes its cancellation signal to every Ark command", async (t) => {
  const controller = new AbortController();
  const signals = [];
  const runner = (command, args, options) => {
    signals.push({ command, signal: options?.signal });
    return mockRunner()(command, args);
  };

  const result = await fetchArkCodingPlanLimits({
    commandRunner: runner,
    home: tmpHome(t),
    signal: controller.signal,
  });
  assert.equal(result.configured, true);
  assert.equal(signals.length, 3);
  assert.ok(signals.every(({ signal }) => signal === controller.signal));
});
