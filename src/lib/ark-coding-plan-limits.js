"use strict";

// Ark Coding Plan (火山方舟 Coding Plan) quota monitoring.
//
// Coding Plan is a subscription-style quota product (Lite/Pro) that refreshes
// on three windows — 5-hour (session), weekly and monthly — and is shared by
// every compatible coding tool (Claude Code, Codex CLI, OpenCode, TRAE, ...).
// TokenTracker already counts those tools' token consumption from their local
// files, so this module deliberately adds NO consumption source. It only
// surfaces the subscription quota percentage, which is otherwise only visible
// in the Volcano console web page.
//
// The quota is read through the user's own `arkcli` binary
// (`arkcli usage plan --format json`), which is already installed and logged
// in for users of the Ark CLI ecosystem. Feature-detected: when `arkcli` is
// missing, the provider simply reports `configured: false` and stays out of
// the way. This mirrors the pattern used by qoder-limits.js — self-contained,
// no dependency on usage-limits.js (which requires this module).

const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ARK_LIMITS_CACHE_FILE = "ark-coding-plan-limits-cache.json";
const ARK_LIMITS_CACHE_UNKNOWN_RESET_TTL_MS = 12 * 60 * 60 * 1000;
const ARK_USAGE_PLAN_TIMEOUT_MS = 10_000;
const ARK_CLI_STDERR_TRIM = 400;

// arkcli period label -> canonical window slot. `session` is the 5-hour
// rolling window; `weekly` and `monthly` refresh on calendar boundaries.
const ARK_PERIOD_WINDOW = {
  session: "primary_window",
  weekly: "secondary_window",
  monthly: "tertiary_window",
};

function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

function normalizeResetAt(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return null;
    const milliseconds = raw > 10_000_000_000 ? raw : raw * 1000;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

// The provider's display name is already "Ark Coding Plan", so the plan label
// carries only the tier — otherwise the panel title would read
// "Ark Coding Plan Coding Plan Lite".
function planLabelForTier(tier) {
  const normalized = String(tier || "").trim().toLowerCase();
  if (normalized === "pro") return "Pro";
  if (normalized === "lite") return "Lite";
  return tier && String(tier).trim() ? String(tier).trim() : null;
}

/**
 * Normalize the JSON payload returned by `arkcli plans get --format json`.
 * The tier ("lite" / "pro") lives on the plans payload, not on the usage
 * payload, so it is resolved here and merged into the plan label.
 * Returns null when there is no Coding Plan entry.
 */
function normalizeArkPlansResponse(body) {
  if (!body || typeof body !== "object") return null;
  const plans = Array.isArray(body.plans) ? body.plans : [];
  const plan = plans.find((entry) => entry?.key === "coding-plan");
  return plan?.tier ? String(plan.tier) : null;
}

/**
 * Normalize the JSON payload returned by `arkcli usage plan --format json`.
 * Returns `null` when the account has no active Coding Plan subscription
 * (caller reports `configured: false`). Throws when the payload shape is
 * unusable so the caller can fall back to the disk cache.
 */
function normalizeArkCodingPlanResponse(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Ark Coding Plan response is not an object.");
  }
  const items = Array.isArray(body.items) ? body.items : [];
  const item = items.find((entry) => entry?.product === "coding-plan");
  if (!item || item.subscribed !== true) return null;

  const windows = {};
  const periods = Array.isArray(item.periods) ? item.periods : [];
  for (const period of periods) {
    const slot = ARK_PERIOD_WINDOW[period?.label];
    if (!slot) continue;
    const percent = Number(period.percent);
    if (!Number.isFinite(percent)) continue;
    windows[slot] = {
      used_percent: clampPercent(percent),
      reset_at: normalizeResetAt(period.reset_at),
      unit: "calls",
    };
  }
  if (!windows.primary_window && !windows.secondary_window && !windows.tertiary_window) {
    throw new Error("Ark Coding Plan response contains no usable quota periods.");
  }

  return {
    configured: true,
    error: null,
    plan_label: planLabelForTier(item.tier),
    primary_window: windows.primary_window || null,
    secondary_window: windows.secondary_window || null,
    tertiary_window: windows.tertiary_window || null,
    source: "provider-api",
  };
}

function arkCodingPlanCachePath({ home = os.homedir() } = {}) {
  return path.join(home, ".tokentracker", "tracker", ARK_LIMITS_CACHE_FILE);
}

function readArkCodingPlanLimitsCache({ home = os.homedir(), nowMs = Date.now() } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(arkCodingPlanCachePath({ home }), "utf8"));
    const cachedAtMs = Date.parse(parsed?.cached_at || "");
    if (!Number.isFinite(cachedAtMs) || cachedAtMs > nowMs + 60_000) return null;
    // A window whose reset_at has passed is stale — the quota has already
    // rolled over, so serving its old used_percent would mislead. Drop it.
    const windows = [parsed?.primary_window, parsed?.secondary_window, parsed?.tertiary_window];
    const surviving = windows.map((window) => {
      if (!window) return null;
      const resetAtMs = Date.parse(window.reset_at || "");
      if (Number.isFinite(resetAtMs) && resetAtMs <= nowMs) return null;
      return window;
    });
    if (surviving.every((window) => !window)) return null;
    // Undated windows can't be checked against their reset — bound them by
    // the cache write time instead.
    const hasDated = surviving.some((window) => Number.isFinite(Date.parse(window?.reset_at || "")));
    if (!hasDated && nowMs - cachedAtMs > ARK_LIMITS_CACHE_UNKNOWN_RESET_TTL_MS) return null;
    return {
      configured: true,
      error: null,
      plan_label: typeof parsed?.plan_label === "string" ? parsed.plan_label : null,
      primary_window: surviving[0],
      secondary_window: surviving[1],
      tertiary_window: surviving[2],
      cached: true,
      stale: true,
      cached_at: parsed.cached_at,
      source: "disk-cache",
    };
  } catch (_error) {
    return null;
  }
}

function writeArkCodingPlanLimitsCache(limits, { home = os.homedir(), nowMs = Date.now() } = {}) {
  if (!limits?.configured || limits.error) return;
  const cachePath = arkCodingPlanCachePath({ home });
  const payload = {
    plan_label: limits.plan_label || null,
    primary_window: limits.primary_window || null,
    secondary_window: limits.secondary_window || null,
    tertiary_window: limits.tertiary_window || null,
    cached_at: new Date(nowMs).toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpPath, cachePath);
  } catch (_error) {}
}

// Async command runner in the same shape as usage-limits.runCommand. It
// intentionally owns its child-process lifecycle so the provider-level abort
// signal can stop spawned CLI processes instead of merely racing their result.
function runCommand(commandRunner, command, args, options = {}) {
  const merged = {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  };
  if (typeof commandRunner === "function") {
    return Promise.resolve(commandRunner(command, args, merged));
  }

  const {
    timeout,
    maxBuffer,
    killProcessGroup = false,
    signal,
    ...spawnOptions
  } = merged;
  return new Promise((resolve) => {
    if (signal?.aborted) {
      const error = new Error(`spawn ${command} aborted`);
      error.name = "AbortError";
      resolve({ status: null, stdout: "", stderr: "", error });
      return;
    }

    const useProcessGroup = killProcessGroup && process.platform !== "win32";
    let child;
    try {
      child = cp.spawn(command, args, {
        ...spawnOptions,
        detached: useProcessGroup || spawnOptions.detached,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ status: null, stdout: "", stderr: "", error });
      return;
    }

    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let timer = null;
    let hardTimer = null;
    let abortListener = null;

    const settle = ({ status = null, error = null } = {}) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (hardTimer) clearTimeout(hardTimer);
      if (abortListener) signal?.removeEventListener("abort", abortListener);
      let finalError = error;
      if (!finalError && timedOut) {
        finalError = new Error(`spawn ${command} ETIMEDOUT`);
        finalError.code = "ETIMEDOUT";
      }
      const result = { status, stdout, stderr };
      if (finalError) result.error = finalError;
      resolve(result);
    };

    const signalChild = (killSignal) => {
      try {
        if (useProcessGroup && Number.isInteger(child.pid)) {
          process.kill(-child.pid, killSignal);
        } else {
          child.kill(killSignal);
        }
      } catch (_error) {}
    };

    const stopChild = ({ timeoutExpired = false } = {}) => {
      if (settled) return;
      if (timeoutExpired) timedOut = true;
      signalChild("SIGTERM");
      // A CLI may leave descendants or inherited stdio alive after SIGTERM.
      // Escalate after a short grace period and settle even if close never fires.
      hardTimer = setTimeout(() => {
        signalChild("SIGKILL");
        settle({ status: null });
      }, 1000);
      if (typeof hardTimer.unref === "function") hardTimer.unref();
    };

    const appendOutput = (key, chunk) => {
      if (settled) return;
      if (key === "stdout") stdout += chunk;
      else stderr += chunk;
      outputBytes += Buffer.byteLength(chunk, "utf8");
      // Unlike exec/execFile, spawn does not apply a maxBuffer guard to piped
      // streams. Enforce the combined byte cap here so a verbose CLI cannot
      // grow this process without bound.
      if (outputBytes > maxBuffer) {
        const error = new Error(`spawn ${command} maxBuffer length exceeded`);
        error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        signalChild("SIGKILL");
        settle({ status: null, error });
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => appendOutput("stdout", chunk));
    child.stderr?.on("data", (chunk) => appendOutput("stderr", chunk));
    child.on("error", (error) => settle({ status: null, error }));
    child.on("close", (code) => settle({ status: timedOut ? null : code }));

    if (signal) {
      abortListener = () => stopChild();
      signal.addEventListener("abort", abortListener, { once: true });
      if (signal.aborted) abortListener();
    }
    if (Number.isFinite(timeout) && timeout > 0) {
      timer = setTimeout(() => stopChild({ timeoutExpired: true }), timeout);
    }
  });
}

// Locate a binary on PATH. Unix uses `which`; native Windows ships no `which`
// (it has `where.exe` instead), so blindly spawning `which` there returns
// ENOENT and every provider would report itself unconfigured even when the
// binary is installed and signed in.
async function whichBinary(binary, { commandRunner, platform = process.platform, signal } = {}) {
  const probe = platform === "win32" ? "where" : "which";
  const result = await runCommand(commandRunner, probe, [binary], {
    timeout: 2000,
    signal,
    killProcessGroup: true,
  });
  if (result?.error || result?.status !== 0) return null;
  const stdout = typeof result?.stdout === "string" ? result.stdout.trim() : "";
  return stdout ? stdout.split("\n")[0] : null;
}

async function isBinaryAvailable(binary, { commandRunner, platform, signal } = {}) {
  return (await whichBinary(binary, { commandRunner, platform, signal })) !== null;
}

function trimStderr(stderr) {
  const text = String(stderr || "").trim();
  if (!text) return null;
  return text.length > ARK_CLI_STDERR_TRIM
    ? `${text.slice(0, ARK_CLI_STDERR_TRIM)}…`
    : text;
}

/**
 * Fetch Ark Coding Plan quota windows from the local `arkcli` binary.
 *
 * Resolution order:
 *  1. `arkcli` missing (not installed / not on PATH)          -> { configured: false }
 *  2. `arkcli usage plan` succeeds but no subscription        -> { configured: false }
 *  3. live success                                            -> { configured: true, ...windows }
 *  4. command failed / parse failed -> bounded disk cache     -> { configured: true, ...stale }
 *  5. nothing usable                                          -> { configured: true, error }
 */
async function fetchArkCodingPlanLimits({
  commandRunner,
  home = os.homedir(),
  nowMs = Date.now(),
  platform = process.platform,
  signal,
} = {}) {
  let available;
  try {
    available = await isBinaryAvailable("arkcli", { commandRunner, platform, signal });
  } catch (_error) {
    available = false;
  }
  if (!available) return { configured: false };

  // `usage plan` is essential; `plans get` supplies only a fallback tier label.
  // Run both requests together so a slow optional lookup cannot consume the
  // provider's deadline before the quota response is available.
  const commandOptions = {
    timeout: ARK_USAGE_PLAN_TIMEOUT_MS,
    signal,
    killProcessGroup: true,
  };
  const [plansResult, result] = await Promise.all([
    runCommand(
      commandRunner,
      "arkcli",
      ["plans", "get", "--format", "json"],
      commandOptions,
    ),
    runCommand(
      commandRunner,
      "arkcli",
      ["usage", "plan", "--format", "json"],
      commandOptions,
    ),
  ]);

  let tier = null;
  if (!plansResult?.error && plansResult?.status === 0) {
    try {
      tier = normalizeArkPlansResponse(JSON.parse(String(plansResult.stdout || "")));
    } catch (_error) {}
  }

  const failWithCache = (message) => {
    const cached = readArkCodingPlanLimitsCache({ home, nowMs });
    if (cached) return cached;
    return { configured: true, error: message };
  };

  if (result?.error || result?.status !== 0) {
    const detail = result?.error?.message
      || (result?.status !== 0 && result?.status !== null
        ? `arkcli exited with code ${result.status}`
        : "arkcli usage plan failed");
    const stderr = trimStderr(result?.stderr);
    return failWithCache(stderr ? `${detail}: ${stderr}` : detail);
  }

  let body;
  try {
    body = JSON.parse(String(result?.stdout || ""));
  } catch (_error) {
    return failWithCache("arkcli usage plan returned invalid JSON.");
  }

  let limits;
  try {
    limits = normalizeArkCodingPlanResponse(body);
  } catch (error) {
    return failWithCache(error?.message || "Ark Coding Plan response could not be parsed.");
  }
  if (!limits) return { configured: false };

  if (tier && !limits.plan_label) limits.plan_label = planLabelForTier(tier);

  writeArkCodingPlanLimitsCache(limits, { home, nowMs });
  return limits;
}

module.exports = {
  ARK_PERIOD_WINDOW,
  normalizeArkPlansResponse,
  normalizeArkCodingPlanResponse,
  readArkCodingPlanLimitsCache,
  writeArkCodingPlanLimitsCache,
  runCommand,
  fetchArkCodingPlanLimits,
};
