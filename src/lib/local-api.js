const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const SYNC_TIMEOUT_MS = 120_000;
const TRACKER_BIN = path.resolve(__dirname, "../../bin/tracker.js");

// ---------------------------------------------------------------------------
// Queue data helpers
// ---------------------------------------------------------------------------

function resolveQueuePath() {
  const home = os.homedir();
  return path.join(home, ".tokentracker", "tracker", "queue.jsonl");
}

function readQueueData(queuePath) {
  try {
    const raw = fs.readFileSync(queuePath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    return lines.map((l) => JSON.parse(l));
  } catch (_e) {
    return [];
  }
}

function aggregateByDay(rows) {
  const byDay = new Map();
  for (const row of rows) {
    const hs = row.hour_start;
    if (!hs) continue;
    const day = hs.slice(0, 10);
    if (!byDay.has(day)) {
      byDay.set(day, {
        day,
        total_tokens: 0,
        billable_total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        conversation_count: 0,
      });
    }
    const a = byDay.get(day);
    a.total_tokens += row.total_tokens || 0;
    a.billable_total_tokens += row.total_tokens || 0;
    a.input_tokens += row.input_tokens || 0;
    a.output_tokens += row.output_tokens || 0;
    a.cached_input_tokens += row.cached_input_tokens || 0;
    a.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
    a.reasoning_output_tokens += row.reasoning_output_tokens || 0;
    a.conversation_count += row.conversation_count || 0;
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
}

function getTimeZoneContext(url) {
  const tz = String(url.searchParams.get("tz") || "").trim();
  const rawOffset = Number(url.searchParams.get("tz_offset_minutes"));
  return {
    timeZone: tz || null,
    offsetMinutes: Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : null,
  };
}

function getZonedParts(date, { timeZone, offsetMinutes } = {}) {
  const dt = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(dt.getTime())) return null;

  if (timeZone && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
      const parts = formatter.formatToParts(dt);
      const values = parts.reduce((acc, part) => {
        if (part.type && part.value) acc[part.type] = part.value;
        return acc;
      }, {});
      const year = Number(values.year);
      const month = Number(values.month);
      const day = Number(values.day);
      const hour = Number(values.hour);
      const minute = Number(values.minute);
      const second = Number(values.second);
      if ([year, month, day, hour, minute, second].every(Number.isFinite)) {
        return { year, month, day, hour, minute, second };
      }
    } catch (_e) {
      // fall through
    }
  }

  if (Number.isFinite(offsetMinutes)) {
    const shifted = new Date(dt.getTime() + offsetMinutes * 60 * 1000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
    };
  }

  return {
    year: dt.getFullYear(),
    month: dt.getMonth() + 1,
    day: dt.getDate(),
    hour: dt.getHours(),
    minute: dt.getMinutes(),
    second: dt.getSeconds(),
  };
}

function formatPartsDayKey(parts) {
  if (!parts) return "";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function aggregateHourlyByDay(rows, dayKey, timeZoneContext) {
  const byHour = new Map();
  for (const row of rows) {
    if (!row.hour_start) continue;
    const parts = getZonedParts(new Date(row.hour_start), timeZoneContext);
    if (!parts) continue;
    if (formatPartsDayKey(parts) !== dayKey) continue;
    const hourKey = `${dayKey}T${String(parts.hour).padStart(2, "0")}:00:00`;
    if (!byHour.has(hourKey)) {
      byHour.set(hourKey, {
        hour: hourKey,
        total_tokens: 0,
        billable_total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        conversation_count: 0,
      });
    }
    const bucket = byHour.get(hourKey);
    bucket.total_tokens += row.total_tokens || 0;
    bucket.billable_total_tokens += row.total_tokens || 0;
    bucket.input_tokens += row.input_tokens || 0;
    bucket.output_tokens += row.output_tokens || 0;
    bucket.cached_input_tokens += row.cached_input_tokens || 0;
    bucket.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
    bucket.reasoning_output_tokens += row.reasoning_output_tokens || 0;
    bucket.conversation_count += row.conversation_count || 0;
  }
  return Array.from(byHour.values()).sort((a, b) => a.hour.localeCompare(b.hour));
}

// ---------------------------------------------------------------------------
// Sync helper
// ---------------------------------------------------------------------------

function trimOutput(value, max = 4000) {
  const t = String(value || "");
  return t.length <= max ? t : t.slice(t.length - max);
}

function runSyncCommand() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TRACKER_BIN, "sync"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(tid);
      fn(v);
    };
    const tid = setTimeout(() => {
      child.kill("SIGTERM");
      finish(
        reject,
        Object.assign(new Error("Sync timed out"), {
          code: "SYNC_TIMEOUT",
          stdout: trimOutput(stdout),
          stderr: trimOutput(stderr),
        }),
      );
    }, SYNC_TIMEOUT_MS);
    child.stdout?.on("data", (c) => {
      stdout += c;
    });
    child.stderr?.on("data", (c) => {
      stderr += c;
    });
    child.on("error", (e) => {
      finish(reject, Object.assign(e, { stdout: trimOutput(stdout), stderr: trimOutput(stderr) }));
    });
    child.on("close", (code) => {
      const r = { code: code ?? 1, stdout: trimOutput(stdout), stderr: trimOutput(stderr) };
      code === 0
        ? finish(resolve, r)
        : finish(reject, Object.assign(new Error(r.stderr || r.stdout || `exit ${r.code}`), r));
    });
  });
}

// ---------------------------------------------------------------------------
// Project detection helpers
// ---------------------------------------------------------------------------

function parseGitUrl(url) {
  if (!url) return null;
  const ssh = url.match(/git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const http = url.match(/https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (http) return { owner: http[1], repo: http[2] };
  return null;
}

function extractProjectFromCwd(cwd) {
  const home = os.homedir();
  if (!cwd || cwd === home) return null;
  const rel = cwd.replace(home + "/", "");
  const parts = rel.split("/").filter((p) => p && !p.startsWith(".") && p !== "ext-global");
  return parts.length > 0 ? parts[0] : null;
}

function scanCodexProjects(projectMap) {
  const dir = path.join(os.homedir(), ".codex", "sessions");
  try {
    for (const year of fs.readdirSync(dir)) {
      const yp = path.join(dir, year);
      if (!fs.statSync(yp).isDirectory()) continue;
      for (const month of fs.readdirSync(yp)) {
        const mp = path.join(yp, month);
        if (!fs.statSync(mp).isDirectory()) continue;
        for (const day of fs.readdirSync(mp)) {
          const dp = path.join(mp, day);
          if (!fs.statSync(dp).isDirectory()) continue;
          const files = fs.readdirSync(dp).filter((f) => f.endsWith(".jsonl"));
          for (const file of files.slice(0, 200)) {
            try {
              const first = fs.readFileSync(path.join(dp, file), "utf8").split("\n")[0];
              const d = JSON.parse(first);
              if (d.git?.repository_url) {
                const p = parseGitUrl(d.git.repository_url);
                if (p) {
                  const key = `${p.owner}/${p.repo}`;
                  if (!projectMap.has(key))
                    projectMap.set(key, {
                      project_key: key,
                      project_ref: d.git.repository_url,
                      count: 0,
                    });
                  projectMap.get(key).count++;
                }
              }
            } catch (_e) {}
          }
        }
      }
    }
  } catch (_e) {}
}

function findSubagentsDirs(dir, depth) {
  const out = [];
  if (depth > 3) return out;
  try {
    for (const item of fs.readdirSync(dir)) {
      const fp = path.join(dir, item);
      if (!fs.statSync(fp).isDirectory()) continue;
      if (item === "subagents") out.push(fp);
      else out.push(...findSubagentsDirs(fp, depth + 1));
    }
  } catch (_e) {}
  return out;
}

function scanClaudeProjects(projectMap) {
  const dir = path.join(os.homedir(), ".claude", "projects");
  try {
    for (const subDir of findSubagentsDirs(dir, 0)) {
      const files = fs.readdirSync(subDir).filter((f) => f.endsWith(".jsonl"));
      for (const file of files.slice(0, 100)) {
        try {
          const first = fs.readFileSync(path.join(subDir, file), "utf8").split("\n")[0];
          if (!first) continue;
          const d = JSON.parse(first);
          const name = extractProjectFromCwd(d.cwd);
          if (name) {
            if (!projectMap.has(name))
              projectMap.set(name, {
                project_key: name,
                project_ref: `file://${d.cwd}`,
                count: 0,
              });
            projectMap.get(name).count++;
          }
        } catch (_e) {}
      }
    }
  } catch (_e) {}
}

// ---------------------------------------------------------------------------
// JSON response helper
// ---------------------------------------------------------------------------

function json(res, data, status) {
  res.writeHead(status || 200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Main handler factory
// ---------------------------------------------------------------------------

function createLocalApiHandler({ queuePath }) {
  const qp = queuePath || resolveQueuePath();

  return async function handleLocalApi(req, res, url) {
    const p = url.pathname;

    // --- local-sync (POST) ---
    if (p === "/functions/vibeusage-local-sync") {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      try {
        const result = await runSyncCommand();
        json(res, { ok: true, ...result });
      } catch (e) {
        json(res, { ok: false, error: e?.message, code: e?.code ?? null, stdout: e?.stdout || "", stderr: e?.stderr || "" }, 500);
      }
      return true;
    }

    // --- usage-summary ---
    if (p === "/functions/vibeusage-usage-summary") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const rows = readQueueData(qp);
      const daily = aggregateByDay(rows).filter((d) => d.day >= from && d.day <= to);
      const totals = daily.reduce(
        (acc, r) => {
          acc.total_tokens += r.total_tokens;
          acc.billable_total_tokens += r.billable_total_tokens;
          acc.input_tokens += r.input_tokens;
          acc.output_tokens += r.output_tokens;
          acc.cached_input_tokens += r.cached_input_tokens;
          acc.cache_creation_input_tokens += r.cache_creation_input_tokens;
          acc.reasoning_output_tokens += r.reasoning_output_tokens;
          acc.conversation_count += r.conversation_count;
          return acc;
        },
        { total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0 },
      );
      const totalCost = (totals.total_tokens * 1.75) / 1_000_000;

      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const allDaily = aggregateByDay(rows);

      const collectDays = (n) => {
        const out = [];
        for (let i = n - 1; i >= 0; i--) {
          const d = new Date(today);
          d.setUTCDate(d.getUTCDate() - i);
          const ds = d.toISOString().slice(0, 10);
          const dd = allDaily.find((x) => x.day === ds);
          if (dd) out.push(dd);
        }
        return out;
      };
      const sumDays = (days) =>
        days.reduce((a, r) => {
          a.billable_total_tokens += r.billable_total_tokens;
          a.conversation_count += r.conversation_count;
          return a;
        }, { billable_total_tokens: 0, conversation_count: 0 });

      const l7 = collectDays(7);
      const l30 = collectDays(30);
      const l7t = sumDays(l7);
      const l30t = sumDays(l30);
      const l7from = new Date(today);
      l7from.setUTCDate(l7from.getUTCDate() - 6);
      const l30from = new Date(today);
      l30from.setUTCDate(l30from.getUTCDate() - 29);

      json(res, {
        from, to, days: daily.length,
        totals: { ...totals, total_cost_usd: totalCost.toFixed(6) },
        rolling: {
          last_7d: { from: l7from.toISOString().slice(0, 10), to: todayStr, active_days: l7.length, totals: l7t },
          last_30d: { from: l30from.toISOString().slice(0, 10), to: todayStr, active_days: l30.length, totals: l30t, avg_per_active_day: l30.length > 0 ? Math.round(l30t.billable_total_tokens / l30.length) : 0 },
        },
      });
      return true;
    }

    // --- usage-daily ---
    if (p === "/functions/vibeusage-usage-daily") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const rows = readQueueData(qp);
      const daily = aggregateByDay(rows).filter((d) => d.day >= from && d.day <= to);
      json(res, { from, to, data: daily });
      return true;
    }

    // --- usage-heatmap ---
    if (p === "/functions/vibeusage-usage-heatmap") {
      const weeks = parseInt(url.searchParams.get("weeks") || "52", 10);
      const rows = readQueueData(qp);
      const daily = aggregateByDay(rows);
      const today = new Date();
      const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - weeks * 7 + 1);
      const from = start.toISOString().slice(0, 10);
      const to = end.toISOString().slice(0, 10);
      const byDay = new Map(daily.map((d) => [d.day, d]));

      const allValues = daily.map((d) => d.billable_total_tokens).filter((v) => v > 0);
      const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
      const calcLevel = (v) => {
        if (v <= 0) return 0;
        if (maxValue === 0) return 1;
        const r = v / maxValue;
        if (r <= 0.25) return 1;
        if (r <= 0.5) return 2;
        if (r <= 0.75) return 3;
        return 4;
      };

      // Build cells and group into weeks (array of 7-cell arrays) for the dashboard
      const cells = [];
      const cursor = new Date(start);
      while (cursor <= end) {
        const day = cursor.toISOString().slice(0, 10);
        const data = byDay.get(day);
        const billable = data?.billable_total_tokens || 0;
        cells.push({ day, total_tokens: data?.total_tokens || 0, billable_total_tokens: billable, level: calcLevel(billable) });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      const weeksArr = [];
      for (let i = 0; i < cells.length; i += 7) {
        weeksArr.push(cells.slice(i, i + 7));
      }
      json(res, { from, to, week_starts_on: "sun", active_days: cells.filter((c) => c.billable_total_tokens > 0).length, streak_days: 0, weeks: weeksArr });
      return true;
    }

    // --- usage-model-breakdown ---
    if (p === "/functions/vibeusage-usage-model-breakdown") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const rows = readQueueData(qp).filter((r) => {
        if (!r.hour_start) return false;
        const d = r.hour_start.slice(0, 10);
        return d >= from && d <= to;
      });

      const bySource = new Map();
      for (const row of rows) {
        const src = row.source || "unknown";
        const mdl = row.model || "unknown";
        if (!bySource.has(src))
          bySource.set(src, { source: src, totals: { total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_cost_usd: "0" }, models: new Map() });
        const sa = bySource.get(src);
        sa.totals.total_tokens += row.total_tokens || 0;
        sa.totals.billable_total_tokens += row.total_tokens || 0;
        sa.totals.input_tokens += row.input_tokens || 0;
        sa.totals.output_tokens += row.output_tokens || 0;
        sa.totals.cached_input_tokens += row.cached_input_tokens || 0;
        sa.totals.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
        sa.totals.reasoning_output_tokens += row.reasoning_output_tokens || 0;
        if (!sa.models.has(mdl))
          sa.models.set(mdl, { model: mdl, model_id: mdl, totals: { total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_cost_usd: "0" } });
        const ma = sa.models.get(mdl);
        ma.totals.total_tokens += row.total_tokens || 0;
        ma.totals.billable_total_tokens += row.total_tokens || 0;
        ma.totals.input_tokens += row.input_tokens || 0;
        ma.totals.output_tokens += row.output_tokens || 0;
        ma.totals.cached_input_tokens += row.cached_input_tokens || 0;
        ma.totals.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
        ma.totals.reasoning_output_tokens += row.reasoning_output_tokens || 0;
      }

      const sources = Array.from(bySource.values()).map((s) => {
        s.totals.total_cost_usd = ((s.totals.total_tokens * 1.75) / 1_000_000).toFixed(6);
        s.models = Array.from(s.models.values())
          .map((m) => ({ ...m, totals: { ...m.totals, total_cost_usd: ((m.totals.total_tokens * 1.75) / 1_000_000).toFixed(6) } }))
          .sort((a, b) => b.totals.total_tokens - a.totals.total_tokens);
        return s;
      });

      json(res, {
        from, to, days: 0, sources,
        pricing: { model: "default", pricing_mode: "add", source: "default", effective_from: new Date().toISOString().slice(0, 10), rates_per_million_usd: { input: "1.750000", cached_input: "0.175000", output: "14.000000", reasoning_output: "14.000000" } },
      });
      return true;
    }

    // --- project-usage-summary ---
    if (p === "/functions/vibeusage-project-usage-summary") {
      const projectMap = new Map();
      scanCodexProjects(projectMap);
      scanClaudeProjects(projectMap);

      const rows = readQueueData(qp);
      const totalTokens = rows.reduce((s, r) => s + (r.total_tokens || 0), 0);
      const entries = [];

      if (projectMap.size === 0) {
        const bySrc = new Map();
        for (const row of rows) {
          const src = row.source || "unknown";
          if (!bySrc.has(src)) bySrc.set(src, { project_key: src, project_ref: `https://${src}.ai`, total_tokens: 0, billable_total_tokens: 0 });
          bySrc.get(src).total_tokens += row.total_tokens || 0;
          bySrc.get(src).billable_total_tokens += row.total_tokens || 0;
        }
        entries.push(
          ...Array.from(bySrc.values())
            .sort((a, b) => b.billable_total_tokens - a.billable_total_tokens)
            .map((e) => ({ ...e, total_tokens: String(e.total_tokens), billable_total_tokens: String(e.billable_total_tokens) })),
        );
      } else {
        const totalCount = Array.from(projectMap.values()).reduce((s, p) => s + p.count, 0);
        for (const [, proj] of projectMap) {
          const ratio = totalCount > 0 ? proj.count / totalCount : 1 / projectMap.size;
          const tokens = Math.floor(totalTokens * ratio);
          entries.push({ project_key: proj.project_key, project_ref: proj.project_ref, total_tokens: String(tokens), billable_total_tokens: String(tokens) });
        }
        entries.sort((a, b) => Number(b.billable_total_tokens) - Number(a.billable_total_tokens));
      }

      json(res, { generated_at: new Date().toISOString(), entries });
      return true;
    }

    // --- user-status (stub) ---
    if (p === "/functions/vibeusage-user-status") {
      json(res, {
        user_id: "local-user", email: "local@localhost", name: "Local User", is_public: false,
        created_at: new Date().toISOString(),
        pro: { active: true, sources: ["local"], expires_at: null, partial: false, as_of: new Date().toISOString() },
      });
      return true;
    }

    // --- usage-hourly (stub for day-view) ---
    if (p === "/functions/vibeusage-usage-hourly") {
      const day = url.searchParams.get("day") || new Date().toISOString().slice(0, 10);
      const timeZoneContext = getTimeZoneContext(url);
      const rows = readQueueData(qp);
      const data = aggregateHourlyByDay(rows, day, timeZoneContext);
      json(res, { day, data });
      return true;
    }

    // --- usage-monthly (stub for trend view) ---
    if (p === "/functions/vibeusage-usage-monthly") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const rows = readQueueData(qp);
      const byMonth = new Map();
      for (const row of rows) {
        if (!row.hour_start) continue;
        const day = row.hour_start.slice(0, 10);
        if (day < from || day > to) continue;
        const month = day.slice(0, 7);
        if (!byMonth.has(month))
          byMonth.set(month, { month, total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0 });
        const a = byMonth.get(month);
        a.total_tokens += row.total_tokens || 0;
        a.billable_total_tokens += row.total_tokens || 0;
        a.input_tokens += row.input_tokens || 0;
        a.output_tokens += row.output_tokens || 0;
        a.cached_input_tokens += row.cached_input_tokens || 0;
        a.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
        a.reasoning_output_tokens += row.reasoning_output_tokens || 0;
        a.conversation_count += row.conversation_count || 0;
      }
      json(res, { from, to, data: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)) });
      return true;
    }

    return false;
  };
}

module.exports = { createLocalApiHandler, resolveQueuePath };
