/**
 * #550 summary regeneration from raw JSONL (#23 — summaries always derive
 * from raw artifacts, never hand-copied numbers).
 *
 * Walks results/<run_id>/samples.jsonl and writes summary.regenerated.json
 * next to it (phase-level percentiles + error tallies). Also verifies that a
 * committed summary.json's phase numbers match the regenerated ones.
 *
 * Run from anywhere in the repo (paths derive from this file's location):
 *   HARNESS=$(git rev-parse --show-toplevel)/docs/research/exam-550-final-capacity-reproof-1/harness
 *   pnpm --filter @exam/db exec tsx "$HARNESS/summarize.ts" \
 *     [results/pilot-... [results/...]]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESULTS_DIR } from "./lib/config.js";
import { percentile } from "./lib/summary.js";

interface Sample {
  ts: string;
  scenario_id: string;
  run_id: string;
  candidate: string;
  endpoint: string;
  phase: string;
  status: number;
  latency_ms: number;
  error_class: string | null;
  timeout: boolean;
  topology: string;
  n: number;
}

function summarizeSamples(samples: Sample[]): Record<string, unknown> {
  const byPhase = new Map<string, Sample[]>();
  for (const s of samples) {
    const arr = byPhase.get(s.phase) ?? [];
    arr.push(s);
    byPhase.set(s.phase, arr);
  }
  const out: Record<string, unknown> = {};
  for (const [phase, arr] of byPhase) {
    const lat = arr.map((s) => s.latency_ms).sort((a, b) => a - b);
    const errors: Record<string, number> = {};
    for (const s of arr) {
      if (s.error_class)
        errors[s.error_class] = (errors[s.error_class] ?? 0) + 1;
    }
    out[phase] = {
      requests: arr.length,
      success: arr.filter((s) => s.status >= 200 && s.status < 300).length,
      http429: arr.filter((s) => s.status === 429).length,
      http5xx: arr.filter((s) => s.status >= 500).length,
      timeouts: arr.filter((s) => s.timeout).length,
      p50: percentile(lat, 50),
      p90: percentile(lat, 90),
      p95: percentile(lat, 95),
      p99: percentile(lat, 99),
      max: lat.at(-1) ?? 0,
      errorClasses: errors,
    };
  }
  return out;
}

function processRunDir(dir: string): void {
  const path = join(dir, "samples.jsonl");
  if (!existsSync(path)) return;
  const samples: Sample[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      samples.push(JSON.parse(line));
    } catch {
      /* skip malformed */
    }
  }
  if (samples.length === 0) return;
  const summary = {
    run_id: samples[0].run_id,
    scenario_id: samples[0].scenario_id,
    topology: samples[0].topology,
    n: samples[0].n,
    totalRequests: samples.length,
    phases: summarizeSamples(samples),
    regenerated_at: new Date().toISOString(),
  };
  writeFileSync(
    join(dir, "summary.regenerated.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );

  // Drift check against any committed summary.json.
  const committedPath = join(dir, "summary.json");
  if (existsSync(committedPath)) {
    try {
      const committed = JSON.parse(readFileSync(committedPath, "utf8"));
      // Runs before 2026-09-19T08:00Z recorded the reconnect take-view
      // requests under RECONNECT_RESTORE in the raw JSONL while the committed
      // summary split them into RECONNECT_RESTORE / RECONNECT_TAKE (a runtime
      // partition not re-derivable from the JSONL). Merge the split back so
      // requests/max compare exactly and the non-regenerable percentiles are
      // recorded instead of fake-compared. Newer runs record RECONNECT_TAKE in
      // the JSONL directly and compare byte-exact.
      const merged: Record<string, Record<string, number>> = {};
      for (const [phase, stats] of Object.entries(committed)) {
        if (!stats || typeof stats !== "object") continue;
        const target = phase === "RECONNECT_TAKE" ? "RECONNECT_RESTORE" : phase;
        const out = merged[target] ?? {};
        for (const [k, v] of Object.entries(stats as Record<string, number>)) {
          if (typeof v !== "number") continue;
          if (k === "max") out[k] = Math.max(out[k] ?? 0, v);
          else out[k] = (out[k] ?? 0) + v;
        }
        merged[target] = out;
      }
      const takeSplit = "RECONNECT_TAKE" in committed;
      const partitionNote = takeSplit
        ? "committed RECONNECT_TAKE merged back into RECONNECT_RESTORE for comparison (raw JSONL lumps take under RECONNECT_RESTORE); split percentiles are recorded in the committed summary but are not byte-regenerable from the JSONL"
        : null;
      const drift: string[] = [];
      const phaseRegen = summary.phases as Record<
        string,
        Record<string, number>
      >;
      for (const [phase, c] of Object.entries(merged)) {
        const r = phaseRegen[phase];
        if (!r || !("p99" in c)) continue;
        // Stub phases (longlived committed summary intentionally zero-fills
        // phase stats; the regenerated summary is the authority for those).
        if ((c.requests ?? 0) === 0) continue;
        if (takeSplit && phase === "RECONNECT_RESTORE") {
          if (c.requests !== r.requests)
            drift.push(
              `${phase}.requests: committed=${c.requests} regenerated=${r.requests}`,
            );
          // max compares with the same rounding tolerance as other keys:
          // committed stores raw latency floats, the JSONL rounds to 0.1 ms.
          if (
            c.max !== undefined &&
            Math.abs((c.max ?? 0) - (r.max ?? 0)) > 0.11
          )
            drift.push(`${phase}.max: committed=${c.max} regenerated=${r.max}`);
          continue;
        }
        for (const key of ["p50", "p95", "p99", "max", "requests"] as const) {
          if (
            c[key] !== undefined &&
            Math.abs((c[key] ?? 0) - (r[key] ?? 0)) > 0.11
          ) {
            drift.push(
              `${phase}.${key}: committed=${c[key]} regenerated=${r[key]}`,
            );
          }
        }
      }
      writeFileSync(
        join(dir, "drift-check.json"),
        JSON.stringify(
          { ok: drift.length === 0, drift, partitionNote },
          null,
          2,
        ) + "\n",
      );
    } catch {
      /* committed summary is optional */
    }
  }
  console.log(`✓ ${dir} (${samples.length} samples)`);
}

const targets =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : readdirSync(RESULTS_DIR).map((d) => join(RESULTS_DIR, d));

for (const t of targets) {
  try {
    if (existsSync(join(t, "samples.jsonl"))) processRunDir(t);
  } catch (err) {
    console.error(`skip ${t}: ${String(err)}`);
  }
}
