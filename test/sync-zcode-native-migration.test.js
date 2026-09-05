const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test } = require("node:test");

const {
  repairZcodeInclusiveTokenMigration,
  repairZcodeNativeUsageMigration,
} = require("../src/commands/sync");

function row(source, model, hour, total) {
  return JSON.stringify({
    hour_start: hour,
    source,
    model,
    input_tokens: total,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: total,
    conversation_count: 1,
  });
}

test("native ZCode migration preserves legacy rows once and keeps unrelated usage", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-zcode-native-repair-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const queueStatePath = path.join(tmp, "queue.state.json");
    const projectQueuePath = path.join(tmp, "project.queue.jsonl");
    const projectQueueStatePath = path.join(tmp, "project.queue.state.json");
    const hour = "2026-06-15T09:00:00Z";
    await fs.writeFile(queuePath, [row("zcode", "GLM-5.2", hour, 12), row("codex", "gpt-5", hour, 20)].join("\n") + "\n");
    await fs.writeFile(projectQueuePath, [row("zcode", "GLM-5.2", hour, 12), row("codex", "gpt-5", hour, 20)].join("\n") + "\n");
    await fs.writeFile(queueStatePath, JSON.stringify({ offset: 100 }));
    await fs.writeFile(projectQueueStatePath, JSON.stringify({ offset: 50 }));
    const cursors = {
      zcode: { messages: { "legacy|row": { lastTotals: { total_tokens: 12 } } } },
      hourly: {
        buckets: {
          [`zcode|GLM-5.2|${hour}`]: { totals: { total_tokens: 12 } },
          [`codex|gpt-5|${hour}`]: { totals: { total_tokens: 20 } },
        },
        groupQueued: { [`zcode|${hour}`]: "legacy", [`codex|${hour}`]: "keep" },
      },
      projectHourly: {
        buckets: {
          [`project|zcode|${hour}`]: { totals: { total_tokens: 12 } },
          [`project|codex|${hour}`]: { totals: { total_tokens: 20 } },
        },
      },
      migrations: {},
    };

    const changed = await repairZcodeNativeUsageMigration({
      cursors,
      queuePath,
      queueStatePath,
      projectQueuePath,
      projectQueueStatePath,
    });
    assert.equal(changed, true);
    const mainRows = (await fs.readFile(queuePath, "utf8")).trim().split("\n").map(JSON.parse);
    const preservedZcode = mainRows.filter((entry) => entry.source === "zcode");
    // The re-parse may not be able to re-replicate this row (the source DB
    // prunes old sessions), so its last uploaded value must survive verbatim
    // instead of being replayed as a zero retraction.
    assert.equal(preservedZcode.length, 1, "the removed key keeps one row with its original value");
    assert.equal(preservedZcode[0].total_tokens, 12);
    assert.ok(!mainRows.some((entry) => entry.source === "zcode" && entry.total_tokens === 0),
      "no zero retractions may be emitted");
    const projectRows = (await fs.readFile(projectQueuePath, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(projectRows.filter((entry) => entry.source === "zcode").length, 1,
      "project queue keeps the legacy row with its original value too");
    assert.equal(projectRows.find((entry) => entry.source === "zcode").total_tokens, 12);
    assert.ok(cursors.hourly.buckets[`codex|gpt-5|${hour}`]);
    assert.ok(!Object.keys(cursors.hourly.buckets).some((key) => key.startsWith("zcode|")));
    assert.ok(!Object.keys(cursors.projectHourly.buckets).some((key) => key.includes("|zcode|")));
    assert.equal(cursors.zcode, undefined);
    assert.equal(JSON.parse(await fs.readFile(queueStatePath, "utf8")).offset, 0);
    assert.equal(JSON.parse(await fs.readFile(projectQueueStatePath, "utf8")).offset, 0);

    const changedAgain = await repairZcodeNativeUsageMigration({
      cursors,
      queuePath,
      queueStatePath,
      projectQueuePath,
      projectQueueStatePath,
    });
    assert.equal(changedAgain, false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("inclusive-token ZCode migration preserves prior totals and resets replay once", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-zcode-inclusive-repair-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const queueStatePath = path.join(tmp, "queue.state.json");
    const projectQueuePath = path.join(tmp, "project.queue.jsonl");
    const projectQueueStatePath = path.join(tmp, "project.queue.state.json");
    const hour = "2026-08-31T09:00:00Z";
    await fs.writeFile(queuePath, [row("zcode", "GLM-5.2", hour, 100), row("codex", "gpt-5", hour, 20)].join("\n") + "\n");
    await fs.writeFile(projectQueuePath, [row("zcode", "GLM-5.2", hour, 100), row("codex", "gpt-5", hour, 20)].join("\n") + "\n");
    await fs.writeFile(queueStatePath, JSON.stringify({ offset: 100 }));
    await fs.writeFile(projectQueueStatePath, JSON.stringify({ offset: 50 }));
    const cursors = {
      zcode: { messages: { "legacy|row": { lastTotals: { total_tokens: 100 } } } },
      hourly: {
        buckets: {
          [`zcode|GLM-5.2|${hour}`]: { totals: { total_tokens: 100 } },
          [`codex|gpt-5|${hour}`]: { totals: { total_tokens: 20 } },
        },
        groupQueued: { [`zcode|${hour}`]: "inflated", [`codex|${hour}`]: "keep" },
      },
      projectHourly: {
        buckets: {
          [`project|zcode|${hour}`]: { totals: { total_tokens: 100 } },
          [`project|codex|${hour}`]: { totals: { total_tokens: 20 } },
        },
      },
      migrations: {},
    };

    assert.equal(await repairZcodeInclusiveTokenMigration({
      cursors,
      queuePath,
      queueStatePath,
      projectQueuePath,
      projectQueueStatePath,
    }), true);
    const replayRows = (await fs.readFile(queuePath, "utf8")).trim().split("\n").map(JSON.parse);
    const zcodeRows = replayRows.filter((entry) => entry.source === "zcode");
    assert.equal(zcodeRows.length, 1);
    assert.equal(zcodeRows[0].total_tokens, 100,
      "the legacy value survives the repair instead of being zeroed");
    assert.equal(JSON.parse(await fs.readFile(queueStatePath, "utf8")).note,
      "reset_after_zcode_inclusive_token_repair_2026_09");
    assert.equal(JSON.parse(await fs.readFile(projectQueueStatePath, "utf8")).note,
      "reset_after_zcode_inclusive_token_repair_2026_09");
    assert.equal(cursors.zcode, undefined);

    assert.equal(await repairZcodeInclusiveTokenMigration({
      cursors,
      queuePath,
      queueStatePath,
      projectQueuePath,
      projectQueueStatePath,
    }), false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("repair keeps history for keys the re-parse cannot re-replicate and yields to fresh values elsewhere", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-zcode-repair-nonlossy-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const queueStatePath = path.join(tmp, "queue.state.json");
    const hourA = "2026-06-10T08:00:00Z";
    const hourB = "2026-06-11T08:00:00Z";
    // Multiple cumulative snapshots for key A; a single row for key B.
    await fs.writeFile(queuePath, [
      row("zcode", "GLM-5.2", hourA, 10),
      row("zcode", "GLM-5.2", hourA, 30),
      row("zcode", "GLM-5.2", hourA, 50),
      row("zcode", "GLM-5.2", hourB, 70),
      row("codex", "gpt-5", hourA, 20),
    ].join("\n") + "\n");
    await fs.writeFile(queueStatePath, JSON.stringify({ offset: 100 }));
    const cursors = {
      zcode: { messages: { "legacy|row": { lastTotals: { total_tokens: 50 } } } },
      hourly: { buckets: {}, groupQueued: {} },
      projectHourly: { buckets: {} },
      migrations: {},
    };

    assert.equal(await repairZcodeNativeUsageMigration({
      cursors,
      queuePath,
      queueStatePath,
    }), true);

    // Simulate the from-scratch re-parse: key A is re-replicated with a
    // corrected value; key B is gone from the source DB and never re-queued.
    await fs.appendFile(queuePath, row("zcode", "GLM-5.2", hourA, 40) + "\n");

    const rows = (await fs.readFile(queuePath, "utf8")).trim().split("\n").map(JSON.parse);
    const latestByKey = new Map();
    for (const entry of rows) {
      if (entry.source !== "zcode") continue;
      latestByKey.set(`${entry.model}|${entry.hour_start}`, entry);
    }
    assert.equal(latestByKey.get(`GLM-5.2|${hourA}`).total_tokens, 40,
      "fresh parse values win for keys the re-parse covers");
    assert.equal(latestByKey.get(`GLM-5.2|${hourB}`).total_tokens, 70,
      "keys the re-parse cannot cover keep their last uploaded value");
    assert.ok(!rows.some((entry) => entry.source === "zcode" && entry.total_tokens === 0),
      "the repair must not zero any bucket");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
