/**
 * #550 cross-run aggregation from raw JSONL (RESEARCH ONLY).
 *
 * Reads results/lifecycle-<run>/samples.jsonl + summary.json (oracles) and emits
 * a deterministic aggregate: per (scale × phase) and per (scale × steady
 * endpoint) latency percentiles across canonical repetitions, plus the oracle
 * verdict table. Docs embed this output; numbers are never hand-copied.
 *
 * Run from anywhere in the repo (paths derive from this file's location):
 *   HARNESS=$(git rev-parse --show-toplevel)/docs/research/exam-550-final-capacity-reproof-1/harness
 *   pnpm --filter @exam/db exec tsx "$HARNESS/aggregate.ts"
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESULTS_DIR } from "./lib/config.js";
import { percentile } from "./lib/summary.js";

interface Sample {
  n: number;
  endpoint: string;
  phase: string;
  status: number;
  latency_ms: number;
  error_class: string | null;
  timeout: boolean;
}

interface OracleSummary {
  n: number;
  rep: number;
  oracles: { pass: boolean; loginSuccess: number; submitSuccess: number };
}

const BURST_PHASES = [
  "LOGIN_BURST",
  "START_BURST",
  "RECONNECT_RESTORE",
  "RECONNECT_TAKE",
  "RECONNECT_FIRST_SAVE",
  "SUBMIT_BURST",
] as const;

const STEADY_ENDPOINTS = [
  "POST /api/attempts/:id/answers/:qid",
  "POST /api/attempts/:id/heartbeat",
  "GET /api/admin/exams/:examId/proctor/attempts",
  "GET /api/admin/attempts/:id/proctor-events",
] as const;

function stats(lat: number[]): Record<string, number> {
  const s = [...lat].sort((a, b) => a - b);
  return {
    requests: s.length,
    p50: percentile(s, 50),
    p90: percentile(s, 90),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s.at(-1) ?? 0,
  };
}

function main(): void {
  const dirs = readdirSync(RESULTS_DIR)
    .filter((d) => d.startsWith("lifecycle-"))
    .sort();
  const samples: Sample[] = [];
  const oracles: OracleSummary[] = [];
  for (const d of dirs) {
    const dir = join(RESULTS_DIR, d);
    const raw = readFileSync(join(dir, "samples.jsonl"), "utf8");
    for (const line of raw.trim().split("\n")) {
      const s = JSON.parse(line) as Sample;
      samples.push(s);
    }
    const summary = JSON.parse(
      readFileSync(join(dir, "summary.json"), "utf8"),
    ) as OracleSummary & { oracles: OracleSummary["oracles"] };
    oracles.push({
      n: summary.n,
      rep: summary.rep,
      oracles: summary.oracles,
    });
  }

  // Aggregate across reps: scale → phase → stats (all bursts lump endpoints).
  const byScalePhase = new Map<string, Map<string, Sample[]>>();
  const byScaleSteadyEp = new Map<string, Map<string, Sample[]>>();
  for (const s of samples) {
    const scale = `S${s.n}`;
    if (BURST_PHASES.includes(s.phase as (typeof BURST_PHASES)[number])) {
      const m = byScalePhase.get(scale) ?? new Map<string, Sample[]>();
      const arr = m.get(s.phase) ?? [];
      arr.push(s);
      m.set(s.phase, arr);
      byScalePhase.set(scale, m);
    } else if (s.phase === "STEADY") {
      const m = byScaleSteadyEp.get(scale) ?? new Map<string, Sample[]>();
      const arr = m.get(s.endpoint) ?? [];
      arr.push(s);
      m.set(s.endpoint, arr);
      byScaleSteadyEp.set(scale, m);
    }
  }

  // Issue metrics contract: errors (5xx + network/semantic), timeouts, and
  // 429 are reported separately, never merged into one opaque count.
  const count = (arr: Sample[], pred: (s: Sample) => boolean): number =>
    arr.filter(pred).length;
  const split = (arr: Sample[]): Record<string, number> => ({
    errors: count(arr, (s) => s.status >= 500 || s.error_class !== null),
    timeouts: count(arr, (s) => s.timeout),
    rateLimited429: count(arr, (s) => s.status === 429),
  });

  const scales = [...byScalePhase.keys()].sort(
    (a, b) => Number(a.slice(1)) - Number(b.slice(1)),
  );
  const aggregate: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
    runs: dirs,
    oracles: oracles.sort((a, b) => a.n - b.n || a.rep - b.rep),
    bursts: Object.fromEntries(
      scales.map((scale) => [
        scale,
        Object.fromEntries(
          [...(byScalePhase.get(scale)?.keys() ?? [])].sort().map((phase) => {
            const arr = byScalePhase.get(scale)!.get(phase)!;
            return [
              phase,
              { ...stats(arr.map((s) => s.latency_ms)), ...split(arr) },
            ];
          }),
        ),
      ]),
    ),
    steady: Object.fromEntries(
      scales.map((scale) => [
        scale,
        Object.fromEntries(
          STEADY_ENDPOINTS.filter((ep) =>
            byScaleSteadyEp.get(scale)?.has(ep),
          ).map((ep) => {
            const arr = byScaleSteadyEp.get(scale)!.get(ep)!;
            return [
              ep,
              { ...stats(arr.map((s) => s.latency_ms)), ...split(arr) },
            ];
          }),
        ),
      ]),
    ),
  };

  const outFile = join(RESULTS_DIR, "aggregate-lifecycle.json");
  writeFileSync(outFile, JSON.stringify(aggregate, null, 2) + "\n");
  console.log(`Wrote → ${outFile}`);
  console.log(`runs: ${dirs.length}, samples: ${samples.length}`);

  // Markdown fragment for docs (regenerated, never hand-copied).
  const md: string[] = [
    "# Generated by harness/aggregate.ts — do not edit by hand",
    "",
    `Runs: ${dirs.length} · samples: ${samples.length} · all oracle pass: ${oracles.every((o) => o.oracles.pass)}`,
    "",
    "## Burst phases (aggregated across canonical reps; latency ms)",
    "",
    "| scale | phase | requests | p50 | p90 | p95 | p99 | max | errors | timeouts | 429 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const scale of scales) {
    const phases = aggregate.bursts[scale] as Record<
      string,
      Record<string, number>
    >;
    for (const phase of Object.keys(phases).sort()) {
      const st = phases[phase];
      md.push(
        `| ${scale} | ${phase} | ${st.requests} | ${st.p50} | ${st.p90} | ${st.p95} | ${st.p99} | ${st.max.toFixed(0)} | ${st.errors} | ${st.timeouts} | ${st.rateLimited429} |`,
      );
    }
  }
  md.push(
    "",
    "## Steady phase by endpoint (aggregated across canonical reps; latency ms)",
    "",
    "| scale | endpoint | requests | p50 | p90 | p95 | p99 | max | errors | timeouts | 429 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const scale of scales) {
    const eps = aggregate.steady[scale] as Record<
      string,
      Record<string, number>
    >;
    for (const ep of Object.keys(eps).sort()) {
      const st = eps[ep];
      md.push(
        `| ${scale} | \`${ep}\` | ${st.requests} | ${st.p50} | ${st.p90} | ${st.p95} | ${st.p99} | ${st.max.toFixed(0)} | ${st.errors} | ${st.timeouts} | ${st.rateLimited429} |`,
      );
    }
  }
  md.push(
    "",
    "## Oracle verdicts",
    "",
    "| scale | rep | pass | login | submit |",
    "| --- | --- | --- | ---: | ---: |",
  );
  for (const o of oracles) {
    md.push(
      `| S${o.n} | r${o.rep} | ${o.oracles.pass} | ${o.oracles.loginSuccess} | ${o.oracles.submitSuccess} |`,
    );
  }
  const mdFile = join(RESULTS_DIR, "aggregate-lifecycle.md");
  writeFileSync(mdFile, md.join("\n") + "\n");
  console.log(`Wrote → ${mdFile}`);
}

if (!existsSync(RESULTS_DIR)) {
  console.error(`results dir missing: ${RESULTS_DIR}`);
  process.exit(1);
}
main();
