/**
 * Baseline control for the #885 replay: the frozen product source must produce
 * ZERO operability.tick_failure events across the same 20 scenarios. This is
 * the counterfactual control, not a 20/20 post-fix comparison.
 *
 * Usage: node research/issue-885/harness/baseline-control.mjs [experiments.json]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const actualPath = path.resolve(
  process.argv[2] ?? path.resolve(HERE, "../results/experiments.json"),
);
const outPath = path.resolve(HERE, "../results/baseline-control.json");
const raw = JSON.parse(readFileSync(actualPath, "utf8"));

const failures = [];
if (raw.results.length !== 20) {
  failures.push(`scenario count ${raw.results.length} != 20`);
}
if (raw.subjectSha !== raw.baselineSha) {
  failures.push(
    `subjectSha ${raw.subjectSha} != baselineSha ${raw.baselineSha}`,
  );
}

const rows = raw.results.map((result) => {
  const tickFailureEvents = result.asBuilt.operabilityEvents.filter(
    (event) => event.event === "operability.tick_failure",
  );
  if (tickFailureEvents.length !== 0) {
    failures.push(
      `${result.scenario.id}: ${tickFailureEvents.length} tick_failure events`,
    );
  }
  return {
    scenario: result.scenario.id,
    tickFailureEvents: tickFailureEvents.length,
    readinessEvents:
      result.asBuilt.readinessFailureEvents +
      result.asBuilt.readinessRecoveryEvents,
    businessFailureEvents: result.asBuilt.businessFailureEvents,
    backgroundLoopEvents: result.asBuilt.backgroundLoopEvents,
  };
});

const output = {
  actualPath,
  baselineSha: raw.baselineSha,
  subjectSha: raw.subjectSha,
  subjectDirty: raw.subjectDirty,
  scenarioCount: raw.results.length,
  tickFailureEvents: rows.reduce((sum, row) => sum + row.tickFailureEvents, 0),
  baselineControlPassed: failures.length === 0,
  failures,
  rows,
};
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);

for (const row of rows) {
  console.log(
    `BASELINE ${row.scenario.padEnd(48)} tick_failure=${row.tickFailureEvents} ` +
      `readiness=${row.readinessEvents} biz=${row.businessFailureEvents} loop=${row.backgroundLoopEvents}`,
  );
}
console.log(
  `BASELINE_CONTROL ${output.baselineControlPassed ? "PASS" : "FAIL"} ` +
    `scenarios=${rows.length} tick_failure=${output.tickFailureEvents}`,
);
process.exitCode = output.baselineControlPassed ? 0 : 1;
