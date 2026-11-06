/**
 * Independent comparator for the #885 tick_failure replay.
 *
 * Reads a recorded experiments.json and the committed expected-events.json.
 * It does NOT import the product classifier or tracker: the expected table is
 * a schedule-derived oracle. Event order is preserved per component; tuples
 * are compared exactly on (component, event, state, elapsedMs).
 *
 * Usage:
 *   node research/issue-885/harness/compare.mjs
 *   node research/issue-885/harness/compare.mjs --actual results/experiments.json \
 *     --expected research/issue-885/harness/expected-events.json
 *
 * Exit 0 only when every scenario matches exactly. The negative-control
 * procedure in REPRO.md intentionally mutates a temporary copy and expects a
 * non-zero exit.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const actualPath = path.resolve(
  argValue("--actual", path.resolve(HERE, "../results/experiments.json")),
);
const expectedPath = path.resolve(
  argValue("--expected", path.resolve(HERE, "expected-events.json")),
);
const outPath = path.resolve(
  argValue("--out", path.resolve(HERE, "../results/comparison.json")),
);

const actualRaw = JSON.parse(readFileSync(actualPath, "utf8"));
const expected = JSON.parse(readFileSync(expectedPath, "utf8"));

const actualScenarios = new Map(
  actualRaw.results.map((result) => [result.scenario.id, result]),
);
const expectedIds = Object.keys(expected.scenarios);
const actualIds = [...actualScenarios.keys()];
const allIds = [...new Set([...expectedIds, ...actualIds])];
const loops = ["heartbeat", "deadline_scanner"];

function tuplesFor(result) {
  const events = result.asBuilt.operabilityEvents.filter(
    (event) => event.event === "operability.tick_failure",
  );
  const grouped = Object.fromEntries(loops.map((loop) => [loop, []]));
  for (const event of events) {
    if (!loops.includes(event.component)) {
      grouped[event.component] ??= [];
    }
    grouped[event.component].push({
      event: event.event,
      component: event.component,
      state: event.state,
      elapsedMs: event.elapsedMs,
      timeMs: event.timeMs,
    });
  }
  return grouped;
}

const rows = [];
let totalExpected = 0;
let totalActual = 0;
let totalDiffs = 0;
let matchedScenarios = 0;

for (const id of allIds) {
  const result = actualScenarios.get(id);
  const expectedScenario = expected.scenarios[id];
  const row = {
    scenario: id,
    matched: false,
    expectedTuples: 0,
    actualTuples: 0,
    diffCount: 0,
    missing: [],
    extra: [],
    mismatched: [],
    orderViolations: [],
    duplicateTuples: [],
  };

  if (!result || !expectedScenario) {
    row.diffCount = 1;
    row.missing.push(result ? id : `${id}: actual scenario missing`);
    rows.push(row);
    totalDiffs += 1;
    continue;
  }

  const actualByLoop = tuplesFor(result);
  const components = [
    ...new Set([
      ...Object.keys(expectedScenario),
      ...Object.keys(actualByLoop),
    ]),
  ].sort();

  for (const component of components) {
    const expectedTuples = (expectedScenario[component] ?? []).map((item) => ({
      // Expected entries always describe this event family.
      event: "operability.tick_failure",
      component,
      state: item.state,
      elapsedMs: item.elapsedMs,
    }));
    const actualTuples = actualByLoop[component] ?? [];
    row.expectedTuples += expectedTuples.length;
    row.actualTuples += actualTuples.length;
    totalExpected += expectedTuples.length;
    totalActual += actualTuples.length;

    const max = Math.max(expectedTuples.length, actualTuples.length);
    for (let i = 0; i < max; i++) {
      const expectedTuple = expectedTuples[i];
      const actualTuple = actualTuples[i];
      if (!expectedTuple && actualTuple) {
        row.extra.push({ component, index: i, actual: actualTuple });
        row.diffCount++;
        continue;
      }
      if (expectedTuple && !actualTuple) {
        row.missing.push({ component, index: i, expected: expectedTuple });
        row.diffCount++;
        continue;
      }
      const same =
        actualTuple.event === expectedTuple.event &&
        actualTuple.component === expectedTuple.component &&
        actualTuple.state === expectedTuple.state &&
        actualTuple.elapsedMs === expectedTuple.elapsedMs;
      if (!same) {
        row.mismatched.push({
          component,
          index: i,
          expectedTuple,
          actualTuple,
        });
        row.diffCount++;
      }
    }

    // Per-component causal order must be non-decreasing. Do not sort or
    // normalize this away.
    for (let i = 1; i < actualTuples.length; i++) {
      if (actualTuples[i].elapsedMs < actualTuples[i - 1].elapsedMs) {
        row.orderViolations.push({
          component,
          index: i,
          previous: actualTuples[i - 1],
          current: actualTuples[i],
        });
        row.diffCount++;
      }
    }

    // Explicit duplicate accounting beyond the expected multiplicity.
    const counts = new Map();
    for (const tuple of actualTuples) {
      const key = `${tuple.component}/${tuple.event}/${tuple.state}@${tuple.elapsedMs}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      if (count > 1) {
        row.duplicateTuples.push({ key, count });
      }
    }
  }

  row.matched = row.diffCount === 0;
  if (row.matched) matchedScenarios++;
  totalDiffs += row.diffCount;
  rows.push(row);
}

const comparison = {
  actualPath,
  expectedPath,
  instrumentVersion: expected.instrumentVersion,
  baselineSha: expected.baselineSha,
  timeOrigin: expected.timeOrigin,
  scenarioCount: allIds.length,
  matchedScenarios,
  expectedTuples: totalExpected,
  actualTuples: totalActual,
  eventTupleDiffCount: totalDiffs,
  rows,
};
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(comparison, null, 2)}\n`);

for (const row of rows) {
  console.log(
    `${row.matched ? "PASS" : "FAIL"} ${row.scenario.padEnd(48)} ` +
      `expected=${row.expectedTuples} actual=${row.actualTuples} diffs=${row.diffCount}` +
      (row.missing.length ? ` missing=${row.missing.length}` : "") +
      (row.extra.length ? ` extra=${row.extra.length}` : "") +
      (row.mismatched.length ? ` mismatched=${row.mismatched.length}` : "") +
      (row.orderViolations.length
        ? ` order=${row.orderViolations.length}`
        : "") +
      (row.duplicateTuples.length
        ? ` duplicates=${row.duplicateTuples.length}`
        : ""),
  );
}
console.log(
  `RESULT scenarios=${matchedScenarios}/${allIds.length} ` +
    `tuples=${totalActual}/${totalExpected} diffCount=${totalDiffs}`,
);

process.exitCode = totalDiffs === 0 ? 0 : 1;
