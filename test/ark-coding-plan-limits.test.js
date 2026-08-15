"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  normalizeArkPlansResponse,
  arkProfileIdentity,
  normalizeArkCodingPlanResponse,
  fetchArkCodingPlanLimits,
  writeArkCodingPlanLimitsCache,
} = require("../src/lib/ark-coding-plan-limits");
const {
  runCommand,
  resolveBinaryPath,
} = require("../src/lib/command-runner");

const PROFILE_JSON = JSON.stringify({ profile: "coding-plan_test_region_personal", user_id: "test-user-001" });

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
// The viewer identity mirrors PROFILE_JSON so cache snapshots written from
// the usage payload match the identity guard computed from `profile show`.
function usageJsonFor({ nowMs = Date.now(), withTier = false } = {}) {
  const iso = (ms) => new Date(ms).toISOString();
  return JSON.stringify({
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
        ...(withTier ? { tier: "lite" } : {}),
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
// Ark commands arrive as the absolute path resolved by the discovery probe,
// never as a bare "arkcli" — matching what the provider spawns.
function isArkCommand(command) {
  return /arkcli(\.exe)?$/i.test(String(command || ""));
}

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
    if (isArkCommand(command)) {
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
      if (args[0] === "profile") {
        return { status: 0, stdout: PROFILE_JSON, stderr: "" };
      }
    }
    return { status: 1, stdout: "", stderr: "unknown command" };
  };
}

// Temporary HOME with the ~/.arkcli install-evidence directory by default —
// the spawn-free gate requires it before any binary probe runs.
function tmpHome(t, { arkcliDir = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ark-plan-test-"));
  if (arkcliDir) fs.mkdirSync(path.join(dir, ".arkcli"), { recursive: true });
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

test("arkProfileIdentity extracts the account id from profile show's owner_trn", () => {
  // `arkcli profile show --format json` has no user_id field; the account
  // surfaces through owner_trn / identity_key instead.
  const body = {
    name: "coding-plan_cn-beijing_personal",
    owner_trn: "trn:iam::1234567890:root",
    identity_key: "volc-1234567890",
  };
  assert.equal(arkProfileIdentity(body), "coding-plan_cn-beijing_personal:1234567890");
  assert.equal(
    arkProfileIdentity({ name: "p", identity_key: "volc-9876543210" }),
    "p:9876543210",
  );
  // The usage payload's viewer shape must produce the same identity so the
  // cache guard compares equal across both sources.
  assert.equal(
    arkProfileIdentity({ user_id: "1234567890", profile: "coding-plan_cn-beijing_personal" }),
    "coding-plan_cn-beijing_personal:1234567890",
  );
});

test("runCommand stops a verbose child when its combined output exceeds maxBuffer", async () => {
  const result = await runCommand(
    undefined,
    process.execPath,
    [path.join(__dirname, "fixtures", "noisy-command.js")],
    { maxBuffer: 1024, timeout: 2_000 },
  );
  assert.equal(result.status, null);
  assert.equal(result.error?.code, "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
});

test("resolveBinaryPath falls back to a spawn-free probe of global bin dirs", async (t) => {
  const home = tmpHome(t, { arkcliDir: false });
  const binDir = path.join(home, ".npm-global", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "arkcli"), "#!/bin/sh\n", { mode: 0o755 });
  // `which` fails (minimal PATH); the directory probe must find the binary
  // and return its absolute path without any extra spawn.
  const resolved = await resolveBinaryPath("arkcli", {
    commandRunner: async () => ({ status: 1, stdout: "", stderr: "" }),
    home,
    globalBinDirs: [path.join(home, ".npm-global", "bin")],
  });
  assert.equal(resolved, path.join(binDir, "arkcli"));
});

test("resolveBinaryPath returns null when nothing resolves", async (t) => {
  const home = tmpHome(t, { arkcliDir: false });
  const resolved = await resolveBinaryPath("arkcli", {
    commandRunner: async () => ({ status: 1, stdout: "", stderr: "" }),
    home,
    globalBinDirs: [path.join(home, "empty-bin")],
  });
  assert.equal(resolved, null);
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

test("fetchArkCodingPlanLimits skips every spawn when ~/.arkcli is absent", async (t) => {
  const calls = [];
  const runner = (command, args) => {
    calls.push({ command, args });
    return mockRunner()(command, args);
  };
  // No ~/.arkcli → arkcli was never installed on this machine; the provider
  // must bail out before the `which` probe so the 5s poll cadence never pays
  // a spawn for it.
  const result = await fetchArkCodingPlanLimits({
    commandRunner: runner,
    home: tmpHome(t, { arkcliDir: false }),
  });
  assert.deepEqual(result, { configured: false });
  assert.equal(calls.length, 0);
});

test("fetchArkCodingPlanLimits reports configured:false when arkcli is missing", async (t) => {
  const result = await fetchArkCodingPlanLimits({
    commandRunner: mockRunner({ which: false }),
    home: tmpHome(t),
    // Empty probe list keeps the directory fallback away from the real
    // filesystem: this machine has arkcli in /opt/homebrew/bin, and the
    // fallback would otherwise find it and break the test.
    globalBinDirs: [],
  });
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

test("fetchArkCodingPlanLimits spawns the resolved absolute path, not a bare name", async (t) => {
  const arkCommands = [];
  const runner = (command, args) => {
    if (isArkCommand(command)) arkCommands.push(command);
    return mockRunner()(command, args);
  };
  await fetchArkCodingPlanLimits({ commandRunner: runner, home: tmpHome(t) });
  assert.ok(arkCommands.length > 0);
  // Every ark spawn goes through the absolute path from the discovery probe.
  // A bare "arkcli" would re-run PATH search — and on Windows cmd.exe
  // searches the current directory first, enabling a cwd hijack.
  assert.ok(
    arkCommands.every((command) => path.isAbsolute(command)),
    `expected absolute paths, got: ${arkCommands.join(", ")}`,
  );
});

test("fetchArkCodingPlanLimits executes Ark commands through the Windows shell", async (t) => {
  const options = [];
  const runner = (command, args, commandOptions) => {
    options.push({ command, commandOptions });
    return mockRunner()(command, args);
  };
  await fetchArkCodingPlanLimits({ commandRunner: runner, home: tmpHome(t), platform: "win32" });
  assert.ok(options.every(({ command, commandOptions }) => command === "where" || commandOptions.platform === "win32"));
});

test("fetchArkCodingPlanLimits skips plans get when the usage payload carries a tier", async (t) => {
  const calls = [];
  const runner = (command, args) => {
    calls.push(`${String(command).split(path.sep).pop()} ${args[0]}`);
    return mockRunner({ usageStdout: usageJsonFor({ withTier: true }) })(command, args);
  };
  const result = await fetchArkCodingPlanLimits({ commandRunner: runner, home: tmpHome(t) });
  assert.equal(result.configured, true);
  assert.equal(result.plan_label, "Lite");
  // `plans get` is a per-fetch extra round trip — it must only run when the
  // usage response did not already carry the tier.
  assert.ok(!calls.some((entry) => entry.endsWith("plans")), `plans get must be skipped, got: ${calls.join(" | ")}`);
});

test("fetchArkCodingPlanLimits fetches the tier on demand when usage lacks it", async (t) => {
  const order = [];
  const runner = (command, args) => {
    if (isArkCommand(command) && args[0] === "usage") order.push("usage");
    if (isArkCommand(command) && args[0] === "plans") order.push("plans");
    return mockRunner()(command, args);
  };
  const result = await fetchArkCodingPlanLimits({ commandRunner: runner, home: tmpHome(t) });
  assert.equal(result.configured, true);
  assert.equal(result.plan_label, "Lite");
  assert.deepEqual(order, ["usage", "plans"]);
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
    profile_identity: "coding-plan_test_region_personal:test-user-001",
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
    profile_identity: "coding-plan_test_region_personal:test-user-001",
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

test("readArkCodingPlanLimitsCache expires an undated window even with a dated sibling", async (t) => {
  const home = tmpHome(t);
  const nowMs = Date.now();
  writeArkCodingPlanLimitsCache({
    configured: true,
    primary_window: { used_percent: 90, reset_at: null, unit: "calls" },
    secondary_window: { used_percent: 20, reset_at: new Date(nowMs + 86400_000).toISOString(), unit: "calls" },
  }, { home, nowMs: nowMs - 13 * 3600_000 });

  const result = require("../src/lib/ark-coding-plan-limits").readArkCodingPlanLimitsCache({ home, nowMs });
  assert.equal(result.primary_window, null);
  assert.equal(result.secondary_window.used_percent, 20);
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
  // which probe + usage plan + (tier missing →) plans get.
  assert.equal(signals.length, 3);
  assert.ok(signals.every(({ signal }) => signal === controller.signal));
});

test("fetchArkCodingPlanLimits refuses a cache from another profile", async (t) => {
  const home = tmpHome(t);
  const nowMs = Date.now();
  writeArkCodingPlanLimitsCache({
    configured: true,
    profile_identity: "profile-a:user-a",
    primary_window: { used_percent: 42, reset_at: new Date(nowMs + 3600_000).toISOString(), unit: "calls" },
  }, { home, nowMs });
  const runner = (command, args) => {
    if (command === "which") return { status: 0, stdout: "/usr/local/bin/arkcli\n", stderr: "" };
    if (isArkCommand(command) && args[0] === "profile") {
      return { status: 0, stdout: JSON.stringify({ profile: "profile-b", user_id: "user-b" }), stderr: "" };
    }
    return { status: null, stdout: "", stderr: "", error: new Error("ETIMEDOUT") };
  };
  const result = await fetchArkCodingPlanLimits({ commandRunner: runner, home, nowMs });
  assert.equal(result.stale, undefined);
  assert.match(result.error, /ETIMEDOUT/);
});
