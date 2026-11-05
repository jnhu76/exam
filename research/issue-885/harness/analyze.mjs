/**
 * Derive #885 decision inputs from the MEASURED + COUNTERFACTUAL raw results.
 * Run: node research/issue-885/harness/analyze.mjs
 * Pure read of experiments.json; writes analysis.json; prints a compact table.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.resolve(HERE, "../results/experiments.json"), "utf8"),
);

const isFailure = (e) =>
  e.state === "failing" ||
  e.state === "paged" ||
  e.state === "stalled" ||
  e.state === "unavailable";
const isRecovery = (e) => e.state === "recovered" || e.state === "cleared";

function latencyFor(events, faultStart, faultClear) {
  const failures = events
    .filter(isFailure)
    .sort((a, b) => a.elapsedMs - b.elapsedMs);
  const recoveries = events
    .filter(isRecovery)
    .filter((e) => faultClear === null || e.elapsedMs >= faultClear)
    .sort((a, b) => a.elapsedMs - b.elapsedMs);
  return {
    firstFailureElapsedMs: failures.length ? failures[0].elapsedMs : null,
    detectionLatencyMs:
      failures.length && faultStart !== null
        ? failures[0].elapsedMs - faultStart
        : null,
    firstRecoveryElapsedMs: recoveries.length ? recoveries[0].elapsedMs : null,
    recoveryLatencyMs:
      recoveries.length && faultClear !== null
        ? recoveries[0].elapsedMs - faultClear
        : null,
  };
}

const rows = raw.results.map((r) => {
  const asBuiltEvents = r.asBuilt.operabilityEvents.map((e) => ({
    ...e,
    state: e.state,
  }));
  const lat = {
    asBuilt: latencyFor(
      asBuiltEvents,
      r.faultStartElapsedMs,
      r.faultClearElapsedMs,
    ),
  };
  for (const cand of ["A", "B", "C", "D"]) {
    lat[cand] = latencyFor(
      r.counterfactual.events.filter((e) => e.candidate === cand),
      r.faultStartElapsedMs,
      r.faultClearElapsedMs,
    );
  }
  const firstThrowStep = r.steps.find((s) => s.hbThrow > 0 || s.dlThrow > 0);
  const lastThrowStep = [...r.steps]
    .reverse()
    .find((s) => s.hbThrow > 0 || s.dlThrow > 0);
  const firstCleanAfterLastThrow = [...r.steps]
    .filter((s) => s.step > (lastThrowStep?.step ?? -1))
    .find((s) => s.hbStarted || s.dlStarted);
  return {
    id: r.scenario.id,
    ex: r.scenario.ex,
    loops: r.scenario.loops,
    faultStart: r.faultStartElapsedMs,
    faultClear: r.faultClearElapsedMs,
    firstThrowElapsedMs: firstThrowStep?.elapsedMs ?? null,
    lastThrowElapsedMs: lastThrowStep?.elapsedMs ?? null,
    firstCleanAfterLastThrowElapsedMs:
      firstCleanAfterLastThrow?.elapsedMs ?? null,
    asBuilt: {
      totalErrorLines: r.asBuilt.totalErrorLines,
      throwTicks: r.asBuilt.totalThrowTicks,
      businessFailureTicks: r.asBuilt.totalBusinessFailureTicks,
      cleanTicks: r.asBuilt.totalCleanTicks,
      settledTicks: r.asBuilt.totalSettledTicks,
      startedTicks: r.asBuilt.totalStartedTicks,
      maxConsecutiveFailedTicks: r.asBuilt.maxConsecutiveFailedTicks,
      stallStatesSeen: r.asBuilt.stallStatesSeen,
      events: r.asBuilt.operabilityEvents,
      counts: {
        readinessFailure: r.asBuilt.readinessFailureEvents,
        readinessRecovery: r.asBuilt.readinessRecoveryEvents,
        businessFailure: r.asBuilt.businessFailureEvents,
        backgroundLoop: r.asBuilt.backgroundLoopEvents,
      },
      latency: lat.asBuilt,
    },
    counterfactual: {
      counts: r.counterfactual.byCandidate,
      latency: { A: lat.A, B: lat.B, C: lat.C, D: lat.D },
      events: r.counterfactual.events,
    },
    // lastSettledAt progression during the fault window (proves settled != stalled)
    lastSettledAtDuringFault: r.steps
      .filter(
        (s) =>
          r.faultStartElapsedMs !== null &&
          s.elapsedMs >= r.faultStartElapsedMs &&
          (r.faultClearElapsedMs === null ||
            s.elapsedMs < r.faultClearElapsedMs),
      )
      .map((s) => ({
        step: s.step,
        elapsed: s.elapsedMs,
        hb: s.metrics.hbLastSettledAt,
        dl: s.metrics.dlLastSettledAt,
        hbC: s.metrics.hbConsecutiveFailedTicks,
        dlC: s.metrics.dlConsecutiveFailedTicks,
        pingDelta: s.pingDelta,
        pingFailDelta: s.pingFailDelta,
      })),
  };
});

// The results directory is regenerable and intentionally not committed; a
// fresh clean-room clone does not have it yet.
mkdirSync(path.resolve(HERE, "../results"), { recursive: true });
writeFileSync(
  path.resolve(HERE, "../results/analysis.json"),
  JSON.stringify(
    { baseSha: raw.baseSha, generatedAt: raw.generatedAt, rows },
    null,
    2,
  ),
);

for (const r of rows) {
  const c = r.counterfactual.counts;
  console.log(
    `${r.id.padEnd(48)} ` +
      `asBuilt[rd=${r.asBuilt.counts.readinessFailure}+${r.asBuilt.counts.readinessRecovery} biz=${r.asBuilt.counts.businessFailure} loop=${r.asBuilt.counts.backgroundLoop}] ` +
      `det(ms)=${r.asBuilt.latency.detectionLatencyMs} rec(ms)=${r.asBuilt.latency.recoveryLatencyMs} | ` +
      `C[fail=${c.C.failureEvents} dup=${c.C.duplicateWithReadiness} det=${r.counterfactual.latency.C.detectionLatencyMs} rec=${r.counterfactual.latency.C.recoveryLatencyMs}] ` +
      `B[fail=${c.B.failureEvents} dup=${c.B.duplicateWithReadiness} det=${r.counterfactual.latency.B.detectionLatencyMs} rec=${r.counterfactual.latency.B.recoveryLatencyMs}] ` +
      `D[fail=${c.D.failureEvents} dup=${c.D.duplicateWithReadiness}] ` +
      `A[fail=${c.A.failureEvents} det=${r.counterfactual.latency.A.detectionLatencyMs}]`,
  );
}
