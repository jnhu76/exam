#!/usr/bin/env node
// Exam #817 — F6 continuous fault-window probe (#817 D135 brief §2).
//
// The D2 finding (F6): probes that START after the fault cannot observe the
// outage. This module starts BEFORE the fault action and samples, at a fixed
// interval, all four required observation channels until stopped after
// recovery:
//   1. nginx static page  (GET / through the real ingress)
//   2. /api/ready through nginx → app → PostgreSQL (503 = not_ready gate,
//      502 = app down behind nginx, error = transport failure)
//   3. app container state
//   4. db container state
//
// Every sample is appended (JSONL, single writer, this run's evidence dir —
// not the mailbox) BEFORE the next tick, so a harness crash mid-fault leaves
// a usable observation record. Summaries are a pure function of the samples
// plus boundary timestamps and are recomputable at verdict time. No outage
// duration is ever inferred from a gap: only sample-bounded windows are
// reported, and an unobserved outage is NOT_ESTABLISHED, never fabricated.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { runProjectName } from "./stack.mjs";

const execFileP = promisify(execFile);

// Sampling resolution — an experiment condition recorded in every summary.
export const PROBE_INTERVAL_MS = 300;
const HTTP_TIMEOUT_MS = 2500;
// Hard stop so a wedged recovery cannot spin the probe forever; the recovery
// waiter has its own (shorter) timeout, so this only bounds a stuck loop.
const MAX_PROBE_DURATION_MS = 900000;

const PS_FORMAT = "{{.ID}}\\t{{index .Labels \"com.docker.compose.service\"}}\\t{{.State}}";

async function httpChannel(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    // Drain the body so the socket is freed before the next tick.
    await res.arrayBuffer().catch(() => {});
    return { ok: res.ok, status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String(e?.cause?.code ?? e.name ?? e.message).slice(0, 80), ms: Date.now() - t0 };
  }
}

async function containerChannel(project) {
  try {
    const { stdout } = await execFileP(
      "docker",
      ["ps", "-a", "--filter", `label=com.docker.compose.project=${project}`, "--format", PS_FORMAT],
      { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 },
    );
    const states = {};
    for (const line of stdout.split("\n").filter(Boolean)) {
      const [, service, state] = line.split("\t");
      if (service) states[service] = state;
    }
    return states;
  } catch (e) {
    return { error: e.message.slice(0, 80) };
  }
}

/**
 * Start the continuous probe. Resolves once the first sample is recorded;
 * the loop keeps running in the background until stop() or the hard cap.
 * Samples stream to <evidenceDir>/probe-<trialId>.jsonl.
 */
export async function startFaultWindowProbe({ runId, origin, evidenceDir, trialId, intervalMs = PROBE_INTERVAL_MS } = {}) {
  if (!origin) throw new Error("probe requires origin");
  const project = runProjectName(runId);
  const samplesPath = path.join(evidenceDir, `probe-${trialId}.jsonl`);
  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  let stopped = false;
  let ticks = 0;
  let lastError = null;

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(
    samplesPath,
    JSON.stringify({ kind: "exam817/fault-window-probe", run_id: runId, trial_id: trialId, origin, interval_ms: intervalMs, started_at: startedAtIso }) + "\n",
  );

  const loop = (async () => {
    for (;;) {
      if (stopped || Date.now() - startedAtMs > MAX_PROBE_DURATION_MS) break;
      const t0 = Date.now();
      const [staticPage, apiReady, containers] = await Promise.all([
        httpChannel(`${origin}/`),
        httpChannel(`${origin}/api/ready`),
        containerChannel(project),
      ]);
      const sample = {
        t_ms: t0 - startedAtMs,
        t: new Date(t0).toISOString(),
        static: staticPage,
        api_ready: apiReady,
        containers,
      };
      try {
        fs.appendFileSync(samplesPath, JSON.stringify(sample) + "\n");
      } catch (e) {
        lastError = e.message.slice(0, 120);
      }
      ticks += 1;
      const elapsed = Date.now() - t0;
      if (elapsed < intervalMs) await new Promise((r) => setTimeout(r, intervalMs - elapsed));
    }
  })();

  const stoppedAtIso = async () => {
    await loop;
    return new Date().toISOString();
  };

  return {
    startedAt: startedAtIso,
    samplesPath,
    /** Stop the loop (waits for the in-flight tick) and return boundary info. */
    async stop() {
      stopped = true;
      await loop;
      return { stopped_at: new Date().toISOString(), ticks, last_append_error: lastError, samples_path: path.basename(samplesPath) };
    },
    /** Non-blocking boundary snapshot (used on fault-failure paths). */
    stopInfo: () => ({ ticks, samples_path: path.basename(samplesPath) }),
  };
}

// ── Summary (pure — recomputable from the persisted JSONL) ─────────

function channelWindow(samples, key, { startedAtMs, stoppedAtMs, intervalMs }) {
  const idx = samples.findIndex((s) => s[key] && s[key].ok !== true);
  if (idx === -1) return { observed: false, reason: "no_failed_sample_captured" };
  const firstFail = samples[idx];
  const lastOkBefore = [...samples.slice(0, idx)].reverse().find((s) => s[key]?.ok === true) ?? null;
  const firstOkAfter = samples.slice(idx + 1).find((s) => s[key]?.ok === true) ?? null;
  const coveredFaultWindow = startedAtMs != null && Date.parse(firstFail.t) >= startedAtMs - 2 * intervalMs;
  return {
    observed: firstOkAfter != null,
    covered_fault_window: coveredFaultWindow,
    last_ok_before_fail_at: lastOkBefore?.t ?? null,
    first_fail_at: firstFail.t,
    first_fail_detail: firstFail[key],
    first_ok_after_fail_at: firstOkAfter?.t ?? null,
    observed_outage_ms:
      firstOkAfter != null ? Date.parse(firstOkAfter.t) - Date.parse(firstFail.t) : null,
    bounded_outage_ms:
      firstOkAfter != null && lastOkBefore != null
        ? Date.parse(firstOkAfter.t) - Date.parse(lastOkBefore.t)
        : null,
    unresolved_at_stop: firstOkAfter == null,
    stop_covered: stoppedAtMs != null ? Date.parse(firstFail.t) < stoppedAtMs : null,
  };
}

/**
 * Summarize probe samples for the verdict/RTO block.
 *
 * observed_api_outage vocabulary (F6): "OBSERVED" = a failed sample and a
 * later OK sample bound the outage; "NOT_ESTABLISHED" = no failed sample was
 * captured (either the probe did not cover the fault window or the service
 * never failed while sampled) — the outage is NOT fabricated from
 * timestamps or Docker state.
 */
export function summarizeProbeSamples(rawLines, { intervalMs = PROBE_INTERVAL_MS, startedAtIso = null, stoppedAtIso = null } = {}) {
  const header = rawLines.find((l) => l.kind === "exam817/fault-window-probe") ?? {};
  const samples = rawLines.filter((l) => typeof l.t === "string");
  const startedAtMs = startedAtIso ?? header.started_at ?? null;
  const boundary = {
    interval_ms: intervalMs,
    origin: header.origin ?? null,
    probe_started_at: startedAtMs,
    probe_stopped_at: stoppedAtIso ?? (samples.length > 0 ? samples[samples.length - 1].t : null),
    tick_count: samples.length,
  };
  if (samples.length === 0) {
    return { ...boundary, observed_api_outage: "NOT_ESTABLISHED", reason: "no samples recorded", api: null, static: null, containers: null };
  }
  const startedAtMsValue = startedAtMs != null ? Date.parse(startedAtMs) : null;
  const api = channelWindow(samples, "api_ready", { startedAtMs: startedAtMsValue, intervalMs });
  const staticPage = channelWindow(samples, "static", { startedAtMs: startedAtMsValue, intervalMs });

  // Container-state transitions (informational; never a substitute for the
  // HTTP channels — "docker said exited" is not "HTTP observed down").
  const containerTransitions = {};
  for (const svc of ["app", "db", "web"]) {
    const stateAt = (i) => samples[i].containers?.[svc] ?? "absent";
    const firstNonRunning = samples.findIndex((_, i) => stateAt(i) !== "running");
    const firstRunningAgain =
      firstNonRunning === -1 ? -1 : samples.findIndex((_, i) => i > firstNonRunning && stateAt(i) === "running");
    containerTransitions[svc] = {
      first_non_running_at: firstNonRunning === -1 ? null : samples[firstNonRunning].t,
      first_non_running_state: firstNonRunning === -1 ? null : stateAt(firstNonRunning),
      first_running_again_at: firstRunningAgain === -1 ? null : samples[firstRunningAgain].t,
      states_seen: [...new Set(samples.map((_, i) => stateAt(i)))],
    };
  }

  const established = api.observed && api.covered_fault_window !== false;
  return {
    ...boundary,
    observed_api_outage: established ? "OBSERVED" : "NOT_ESTABLISHED",
    not_established_reason: established ? null : (samples.length === 0 ? "no samples" : api.reason === "no_failed_sample_captured" ? "no_failed_sample_captured" : "probe_window_incomplete"),
    api,
    static: staticPage,
    containers: containerTransitions,
  };
}

/** Rebuild the summary from the persisted JSONL (verdict-time recompute). */
export function summarizeProbeFile(samplesPath, opts = {}) {
  if (!fs.existsSync(samplesPath)) return null;
  const lines = fs
    .readFileSync(samplesPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return summarizeProbeSamples(lines, { intervalMs: lines[0]?.interval_ms ?? PROBE_INTERVAL_MS, ...opts });
}
