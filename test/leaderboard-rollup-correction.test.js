/**
 * >7-day TRAE CN corrections vs the HISTORICAL rollup paths (PR #474).
 *
 * Product read paths under test (mirrored from the deployed SQL):
 *
 *   account usage / profile / dashboard history
 *     -> account_usage_grouped(_cached)          LIVE session states
 *   leaderboard week / month
 *     -> leaderboard_usage_grouped(bounded)      LIVE leaderboard_hourly_dedup_v2
 *   leaderboard TOTAL
 *     -> leaderboard_rollup_daily_v2 (closed days, materialized)
 *        UNION leaderboard_hourly_dedup_v2(v_through, now)  (live tail)
 *
 * leaderboard_hourly_dedup_v2 aggregates trae-cn from
 * tokentracker_account_session_states (migrations/
 * 20260817120000_account-session-states.sql), so LIVE reads reflect a
 * correction immediately. Materialized rollup days only change when the
 * cyclic repair in leaderboard_rollup_daily_advance_v2 (7 days per run,
 * from the OLDEST history day, wrapping) reaches the corrected day - the
 * claim "historical days self-heal" is true, but the lag scales with TOTAL
 * history length (7 days repaired per scheduled 6h run), not with the
 * correction's age. These tests pin BOTH facts:
 *
 *   A. >7d downward correction   rollup 100 -> 60 once repair covers the day
 *   B. >7d model migration       rollup loses model-A, keeps model-B=100
 *   C. cross-day bucket migration Day A 23:30 -> Day B 00:00: Day A drops
 *      the 100, Day B gains it, total stays 100 (transient dip possible
 *      while only one of the two days has been repaired)
 *   D. FIRST 30-day seed on a caught-up rollup: live paths (account /
 *      profile / bounded boards) include the seed immediately, but the
 *      leaderboard TOTAL (rollup UNION live tail) misses every CLOSED seed
 *      day until a repair rebuilds them. The seed-gap PRIORITIZATION in
 *      advance_v2 (repair jumps to the earliest uncovered trae-cn day)
 *      heals the seed deterministically in ceil(seed_days / 7) scheduled
 *      runs instead of waiting a full cycle.
 *
 * The session-state inputs come from the REAL parser
 * (parseTraeCnApiIncremental -> queue -> LWW upsert mirror); the rollup/repair
 * cycle below is the executable mirror of leaderboard_rollup_daily_advance_v2
 * / _replace_v2 / leaderboard_usage_grouped, and the trailing tests pin the
 * deployed SQL itself so the mirror cannot drift silently.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  upsertAccountSessionStates,
  aggregateSessionStates,
} = require("../src/lib/account-usage-dedup");
const { parseTraeCnApiIncremental } = require("../src/lib/rollout");

const ROOT = path.join(__dirname, "..");
const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;

// Everything UTC-midnight aligned, like the SQL (date_trunc('day' ... UTC)).
const midnight = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;

function isoDay(ms) {
  return new Date(midnight(ms)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Real parser -> queue -> LWW table (same harness shape as
// test/account-usage-dedup.test.js).
// ---------------------------------------------------------------------------
function tempQueue(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, queuePath: path.join(dir, "queue.jsonl") };
}

async function syncSessions(cloudStates, { sessions, verifiedAtMs }) {
  const { dir, queuePath } = tempQueue("tokentracker-rollup-");
  try {
    await parseTraeCnApiIncremental({
      sessions,
      cursors: {},
      queuePath,
      windowStartMs: verifiedAtMs - 40 * DAY_MS,
      windowEndMs: verifiedAtMs + DAY_MS,
      snapshotVerifiedAtMs: verifiedAtMs,
    });
    const lines = fs
      .readFileSync(queuePath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const batch = lines.filter((r) => r.kind === "account_session_state");
    upsertAccountSessionStates(cloudStates, batch);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function traeSession(sessionId, usageTimeMs, overrides = {}) {
  return {
    session_id: sessionId,
    model_name: "model-a",
    usage_time: Math.floor(usageTimeMs / 1000),
    input_token: 100,
    output_token: 10,
    cache_read_token: 0,
    cache_write_token: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Executable mirror of the rollup machinery.
// ---------------------------------------------------------------------------
const REPAIR_CHUNK_DAYS = 7; // advance_v2: interval '7 days' per run

function createRollupSim(getStates, { minDayMs, nowMs }) {
  // meta mirrors tokentracker_leaderboard_rollup_meta_v2; assume catch-up
  // done (through = today), repair_from cycling from the oldest history day.
  const target = () => midnight(nowMs);
  const meta = { through: target(), repairFrom: midnight(minDayMs) };
  // rollup mirrors tokentracker_leaderboard_rollup_daily_v2:
  // Map "day|source|model" -> {day, source, model, total_tokens}
  const rollup = new Map();

  function replaceDay(dayMs) {
    const dayKey = isoDay(dayMs);
    for (const key of [...rollup.keys()]) {
      if (key.startsWith(dayKey + "|")) rollup.delete(key);
    }
    for (const row of aggregateSessionStates(getStates(), {
      from: new Date(dayMs).toISOString(),
      to: new Date(dayMs + DAY_MS).toISOString(),
    })) {
      rollup.set(`${dayKey}|${row.source}|${row.model}`, {
        day: dayKey,
        source: row.source,
        model: row.model,
        total_tokens: row.total_tokens,
      });
    }
  }

  return {
    // Seed-gap prioritization (mirrors the superseding advance_v2): the
    // earliest CLOSED day with trae-cn session states but no trae-cn rollup
    // row yet jumps the repair window there; stale-value corrections (row
    // exists) keep the cyclic schedule.
    minSeedGapDay() {
      const t = target();
      let gap = null;
      for (const state of getStates().values()) {
        const dayMs = midnight(Date.parse(state.bucket_start));
        if (dayMs >= t) continue;
        const covered = [...rollup.keys()].some(
          (key) => key.startsWith(isoDay(dayMs) + "|trae-cn|"),
        );
        if (!covered && (gap === null || dayMs < gap)) gap = dayMs;
      }
      return gap;
    },
    /** One scheduled advance run: gap-prioritized, else the cyclic chunk. */
    advanceRun() {
      const t = target();
      const gap = this.minSeedGapDay();
      let from = gap !== null ? gap : (meta.repairFrom >= t ? minDayMs : meta.repairFrom);
      const until = Math.min(t, from + REPAIR_CHUNK_DAYS * DAY_MS);
      for (let d = from; d < until; d += DAY_MS) replaceDay(d);
      meta.repairFrom = until >= t ? minDayMs : until;
    },
    /** Materialize [minDay, today) in one go (initial full build). */
    buildAll() {
      const t = target();
      for (let d = minDayMs; d < t; d += DAY_MS) replaceDay(d);
      meta.repairFrom = minDayMs;
    },
    /** leaderboard TOTAL: materialized rollup UNION live tail [through, now). */
    leaderboardTotal() {
      const perModel = new Map();
      for (const row of rollup.values()) {
        perModel.set(row.model, (perModel.get(row.model) || 0) + row.total_tokens);
      }
      for (const row of aggregateSessionStates(getStates(), {
        from: new Date(meta.through).toISOString(),
      })) {
        perModel.set(row.model, (perModel.get(row.model) || 0) + row.total_tokens);
      }
      return perModel;
    },
    rollupDay(dayMs, model) {
      return rollup.get(`${isoDay(dayMs)}|trae-cn|${model}`) || null;
    },
  };
}

// Fixed "now" so days are deterministic: TODAY = 2027-02-01T00:00:00Z.
const NOW_MS = midnight(Date.parse("2027-02-01T12:00:00.000Z"));
const DAY = (offsetDays) => NOW_MS - offsetDays * DAY_MS;

// A 120-day history: the repair cycle needs ceil/worst ~17 runs to cover a
// day-20 correction - the honest lag characterization for the total board.
const HISTORY_MIN_DAY = DAY(120);

function scenarioSetup() {
  const cloudStates = new Map();
  const sim = createRollupSim(() => cloudStates, { minDayMs: HISTORY_MIN_DAY, nowMs: NOW_MS });
  return { cloudStates, sim };
}

const V1 = Date.parse("2027-01-12T00:00:00.000Z"); // original fetch stamp
const V2 = Date.parse("2027-02-01T00:00:00.000Z"); // correction fetch stamp

// ---------------------------------------------------------------------------
// A. >7-day downward correction.
// ---------------------------------------------------------------------------
test("A. >7d downward: live paths show 60 immediately; total rollup heals when the repair cycle reaches the day", async () => {
  const { cloudStates, sim } = scenarioSetup();
  const correctedDay = DAY(20);
  await syncSessions(cloudStates, {
    sessions: [traeSession("s1", correctedDay + 10 * HALF_HOUR_MS)],
    verifiedAtMs: V1,
  });
  sim.buildAll();
  assert.equal(sim.leaderboardTotal().get("model-a"), 110, "rollup materialized 100+10");
  assert.ok(sim.rollupDay(correctedDay, "model-a"), "day-20 rollup row exists");

  // TRAE revises S down to input 50 (=total 60) 20 days later.
  await syncSessions(cloudStates, {
    sessions: [traeSession("s1", correctedDay + 10 * HALF_HOUR_MS, { input_token: 50 })],
    verifiedAtMs: V2,
  });

  // LIVE paths (account_usage_grouped / bounded leaderboard windows):
  // corrected immediately, zero rollup involvement.
  const liveRows = aggregateSessionStates(cloudStates);
  assert.equal(liveRows.length, 1);
  assert.equal(liveRows[0].total_tokens, 60, "live path shows 60 immediately");

  // TOTAL path: stale until the cyclic repair reaches day-20.
  let runs = 0;
  const maxRuns = 200;
  while (sim.leaderboardTotal().get("model-a") !== 60 && runs < maxRuns) {
    sim.advanceRun();
    runs += 1;
  }
  assert.ok(runs > 0, "the total board did NOT flip without repair work");
  assert.equal(sim.leaderboardTotal().get("model-a"), 60, `total healed to 60 after ${runs} repair runs`);
  // Honest lag pin: with 120 days of history and 7 days per run the
  // corrected day is reached near the END of the cycle (>= 10 runs).
  assert.ok(runs >= 10, `repair-cycle lag is real (took ${runs} scheduled runs, not immediate)`);
  assert.equal(sim.rollupDay(correctedDay, "model-a").total_tokens, 60, "materialized day-20 row itself is 60");
});

// ---------------------------------------------------------------------------
// B. >7-day model migration.
// ---------------------------------------------------------------------------
test("B. >7d model migration: repaired rollup keeps ONLY model-B (no permanent model-A residue)", async () => {
  const { cloudStates, sim } = scenarioSetup();
  const correctedDay = DAY(20);
  await syncSessions(cloudStates, {
    sessions: [traeSession("s1", correctedDay + 10 * HALF_HOUR_MS)],
    verifiedAtMs: V1,
  });
  sim.buildAll();
  assert.ok(sim.rollupDay(correctedDay, "model-a"), "model-A row materialized");

  await syncSessions(cloudStates, {
    sessions: [traeSession("s1", correctedDay + 10 * HALF_HOUR_MS, { model_name: "model-b" })],
    verifiedAtMs: V2,
  });

  // Live bounded path already migrated.
  const liveByModel = new Map(aggregateSessionStates(cloudStates).map((r) => [r.model, r.total_tokens]));
  assert.deepEqual([...liveByModel.keys()].sort(), ["model-b"]);

  let runs = 0;
  while ((!sim.leaderboardTotal().has("model-b") || sim.leaderboardTotal().has("model-a")) && runs < 200) {
    sim.advanceRun();
    runs += 1;
  }
  const total = sim.leaderboardTotal();
  assert.equal(total.get("model-a"), undefined, "no permanent model-A residue after repair");
  assert.equal(total.get("model-b"), 110, "model-B carries the session exactly once");
  assert.equal(sim.rollupDay(correctedDay, "model-a"), null, "the materialized model-A row is deleted by the day rebuild");
  assert.equal(sim.rollupDay(correctedDay, "model-b").total_tokens, 110);
});

// ---------------------------------------------------------------------------
// C. Cross-day bucket migration (Day A 23:30 -> Day B 00:00).
// ---------------------------------------------------------------------------
test("C. cross-day bucket migration: Day A drops the 100, Day B gains it, total stays 100", async () => {
  const { cloudStates, sim } = scenarioSetup();
  const dayA = DAY(21); // 23:30 slot lives on day A
  const dayB = DAY(20); // 00:00 slot lives on day B (the next UTC day)
  const slotA = dayA + 23 * HALF_HOUR_MS + HALF_HOUR_MS; // 23:30 on day A
  const slotB = dayB; // 00:00 on day B
  await syncSessions(cloudStates, {
    sessions: [traeSession("s1", slotA)],
    verifiedAtMs: V1,
  });
  sim.buildAll();
  assert.equal(sim.rollupDay(dayA, "model-a").total_tokens, 110, "100+10 sits on day A");
  assert.equal(sim.rollupDay(dayB, "model-a"), null, "day B empty");

  // TRAE moves the session across the UTC-day boundary.
  await syncSessions(cloudStates, {
    sessions: [traeSession("s1", slotB)],
    verifiedAtMs: V2,
  });

  // Live path: only day B's bucket carries the session now.
  const liveRows = aggregateSessionStates(cloudStates);
  assert.equal(liveRows.length, 1);
  assert.equal(Date.parse(liveRows[0].hour_start), Math.floor(slotB / HALF_HOUR_MS) * HALF_HOUR_MS);
  assert.equal(liveRows[0].total_tokens, 110);

  // Total path: day A and day B sit in the same 7-day repair chunk here, so
  // one run covering both heals them together; a chunk BOUNDARY between the
  // two days would transiently dip (documented, not a correctness bug - the
  // canonical state itself is single-copy).
  let runs = 0;
  const healed = () => sim.rollupDay(dayA, "model-a") === null
    && sim.rollupDay(dayB, "model-a")
    && sim.rollupDay(dayB, "model-a").total_tokens === 110;
  while (!healed() && runs < 200) {
    sim.advanceRun();
    runs += 1;
  }
  assert.ok(healed(), `cross-day migration healed after ${runs} repair runs`);
  assert.equal(sim.leaderboardTotal().get("model-a"), 110, "total still counts the session exactly once");
});

// ---------------------------------------------------------------------------
// D. FIRST 30-day seed vs the leaderboard TOTAL (rollup UNION live tail).
// ---------------------------------------------------------------------------
test("D. first 30-day seed: account/profile/bounded immediate; TOTAL undercounts closed days until the seed-gap-prioritized repair completes", async () => {
  const { cloudStates, sim } = scenarioSetup();
  // Preconditions (review scenario): rollup caught up (through = today),
  // no trae-cn session states, no trae-cn rollup rows. The 120-day history
  // below is OTHER sources; the cyclic repair position sits at the OLDEST
  // day, so without prioritization the seed would wait a full cycle.
  sim.buildAll();

  // First TRAE sync: one real parser call seeds ~30 CLOSED days at once
  // (one session per day, 110 tokens each).
  const seedDays = 30;
  const sessions = [];
  for (let k = seedDays; k >= 1; k -= 1) {
    sessions.push(traeSession(`seed-${k}`, DAY(k) + 10 * 60 * 60 * 1000));
  }
  await syncSessions(cloudStates, { sessions, verifiedAtMs: V2 });
  assert.equal(cloudStates.size, seedDays, "the first sync seeded 30 canonical sessions");

  // LIVE paths: everything except the leaderboard TOTAL is immediate.
  const accountTotal = aggregateSessionStates(cloudStates).reduce((acc, r) => acc + r.total_tokens, 0);
  assert.equal(accountTotal, seedDays * 110, "account usage total = 3300 immediately (profile reads the same RPC)");
  const weekRows = aggregateSessionStates(cloudStates, {
    from: new Date(DAY(7)).toISOString(),
    to: new Date(NOW_MS).toISOString(),
  });
  assert.equal(weekRows.reduce((acc, r) => acc + r.total_tokens, 0), 7 * 110, "bounded leaderboard week includes its seed days immediately");

  // TOTAL before any repair: rollup has no trae-cn rows and the live tail
  // only covers [today 00:00, now) - every seed day is closed, so the TOTAL
  // UNDERCOUNTS by the full seed.
  const before = sim.leaderboardTotal().get("model-a") || 0;
  assert.equal(before, 0, "leaderboard TOTAL undercounts the first seed entirely (all 30 days are closed days)");

  // The seed-gap prioritization must repair from the SEED's oldest day (not
  // the cyclic position 120 days back): after one run exactly the first
  // 7 seed days are materialized.
  sim.advanceRun();
  const afterRun1 = sim.leaderboardTotal().get("model-a") || 0;
  assert.equal(afterRun1, 7 * 110, "run 1 repairs the seed's oldest 7 days (gap-first, 7-day chunk)");

  // Deterministic completion: ceil(30/7) = 5 scheduled runs total.
  let runs = 1;
  while ((sim.leaderboardTotal().get("model-a") || 0) !== seedDays * 110 && runs < 50) {
    sim.advanceRun();
    runs += 1;
  }
  assert.equal(sim.leaderboardTotal().get("model-a"), seedDays * 110, "TOTAL now equals the account/profile total");
  assert.equal(runs, 5, "a 30-day seed heals in ceil(30/7)=5 scheduled runs (not a full 120-day cycle)");
});

// ---------------------------------------------------------------------------
// SQL contract pins: the deployed functions must actually implement the
// semantics mirrored above (the JS mirror cannot be allowed to drift).
// ---------------------------------------------------------------------------
function readRepoFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("SQL pin: replace_v2 rebuilds closed days from leaderboard_hourly_dedup_v2 (which reads trae-cn session states)", () => {
  const sql = readRepoFile("migrations/20260804043427_align-leaderboard-machine-clusters.sql");
  const replaceFn = sql.split("CREATE OR REPLACE FUNCTION public.leaderboard_rollup_daily_replace_v2")[1].split("$func$;")[0];
  assert.match(replaceFn, /DELETE FROM public\.tokentracker_leaderboard_rollup_daily_v2/, "a rebuild DELETEs the materialized day (downward/model corrections clean up)");
  assert.match(replaceFn, /FROM public\.leaderboard_hourly_dedup_v2\(v_day, v_day \+ interval '1 day'\)/, "days are re-aggregated from the dedup function");

  const sessionStates = readRepoFile("migrations/20260817120000_account-session-states.sql");
  const dedupFn = sessionStates.split("CREATE OR REPLACE FUNCTION public.leaderboard_hourly_dedup_v2")[1].split("$func$;")[0];
  assert.match(dedupFn, /FROM tokentracker_account_session_states s/, "the dedup function's trae-cn branch reads canonical session states");
  assert.match(dedupFn, /s\.source = 'trae-cn'/);
});

test("SQL pin: advance_v2 (superseding definition) repairs 7 days per run, cyclically, with first-seed gap prioritization", () => {
  // The 20260817120000 migration supersedes the 0804 advance_v2: pin the
  // LATEST definition the deployment will actually leave in the database.
  const sql = readRepoFile("migrations/20260817120000_account-session-states.sql");
  const advanceFn = sql.split("CREATE OR REPLACE FUNCTION public.leaderboard_rollup_daily_advance_v2")[1].split("$func$;")[0];
  assert.match(advanceFn, /interval '7 days'/, "7 days per scheduled run (catch-up AND repair)");
  assert.match(advanceFn, /v_min_day/, "repair starts at the oldest history day");
  assert.match(advanceFn, /v_repair_from := v_min_day/, "repair wraps to the oldest day after completing a cycle");
  // First-seed prioritization: jump to the earliest closed trae-cn day that
  // has session states but no rollup row yet.
  assert.match(advanceFn, /v_seed_gap_day/, "seed-gap day is computed");
  assert.match(advanceFn, /FROM public\.tokentracker_account_session_states s/, "gaps come from the canonical session states");
  assert.match(advanceFn, /NOT EXISTS[\s\S]*?r\.source = 'trae-cn'/, "a day is a gap only when NO trae-cn rollup row exists (stale values are NOT gaps)");
  assert.match(advanceFn, /v_repair_from := v_seed_gap_day/, "the repair window jumps to the seed gap");
  // Only the window POSITION changes: the per-run chunk stays 7 days.
  assert.match(advanceFn, /v_seed_gap_day[\s\S]*?v_until := LEAST\([\s\S]*?interval '7 days'/, "gap-jump still repairs a bounded 7-day chunk");
});

test("SQL pin: leaderboard TOTAL reads rollup UNION live tail; bounded windows read live", () => {
  const sql = readRepoFile("migrations/20260804043427_align-leaderboard-machine-clusters.sql");
  const groupedFn = sql.split("CREATE OR REPLACE FUNCTION public.leaderboard_usage_grouped")[1].split("$func$;")[0];
  assert.match(groupedFn, /FROM public\.tokentracker_leaderboard_rollup_daily_v2 r/, "total = materialized rollup...");
  assert.match(groupedFn, /FROM public\.leaderboard_hourly_dedup_v2\(v_through, p_to\) t/, "...UNION the live tail");
  // The rollup+tail branch requires an all-time range; bounded windows take
  // the live-only ELSE branch.
  assert.match(groupedFn, /p_from < '1980-01-01'::timestamptz AND p_to >= v_through/);

  const refresh = readRepoFile("dashboard/edge-patches/tokentracker-leaderboard-refresh.ts");
  assert.match(refresh, /if \(period === "total"\)/, "only the total period advances the rollup");
  assert.match(refresh, /leaderboard_rollup_daily_advance_v2/);
  assert.match(refresh, /from_day: "1970-01-01"/, "total uses the all-time sentinel that selects the rollup branch");
});

test("SQL pin: profile / account views read the LIVE account RPC (corrections visible immediately)", () => {
  const profile = readRepoFile("dashboard/edge-patches/tokentracker-leaderboard-profile.ts");
  assert.match(profile, /account_usage_grouped/, "profile uses the live account RPC");
  const summary = readRepoFile("dashboard/edge-patches/tokentracker-account-summary.ts");
  assert.match(summary, /account_usage_grouped/, "account summary uses the live account RPC");
  const rpc = readRepoFile("scripts/ops/account-usage-grouped-rpc.sql");
  assert.match(rpc, /FROM tokentracker_account_session_states s/, "the account RPC's trae-cn branch reads session states");
  assert.doesNotMatch(rpc, /leaderboard_rollup_daily_v2/, "the account RPC never reads the materialized rollup");
});
