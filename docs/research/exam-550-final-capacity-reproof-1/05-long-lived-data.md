# #550 Final capacity re-proof — 05 Long-lived composition dataset (#545 residual)

Status: FROZEN (corrective-1 evidence pass — see [12](12-corrective-1.md)). Run:
`results/longlived-S100-2026-09-19T11-33-03-837Z/` — `cardinality.json`
(dataset shape), `explain.json` (EXPLAIN ANALYZE at that cardinality), `samples.jsonl`
(7,139 live requests), `pool.jsonl` (research snapshots incl. heartbeat-loop facts),
`summary.json` + `summary.regenerated.json` (byte-regenerated via `harness/summarize.ts`); plus
the 95 min connection-lifetime soak `results/soak-S50-2026-09-19T11-41-07-352Z/` (§ soak below).
Both runs are campaign `corrective-1`, HEAD `66c850e6`, APP_MODE=production (limiter ON, default
budgets, Redis-backed store — the accepted #554 topology), DIRECT_LAN with a distinct
per-candidate loopback source IP, pool `max=10`. The pre-corrective runs
(`longlived-S100-2026-09-19T05-52-20-834Z`, `soak-S50-2026-09-19T06-13-04-398Z`) are retained
unmodified and marked SUPERSEDED_PRE_CORRECTIVE_EVIDENCE (they measured APP_MODE=e2e — see
[12](12-corrective-1.md) MAJOR-1). This is the as-built answer to the #545 residual "prove the
heartbeat-episode discovery path stays correct at semester-scale history", under the
KEEP_CURRENT_ARCHITECTURE decision (#554): no new index shipped, no query rewrite.

## Dataset composition (composition-realistic semester history)

Built in one fresh organization alongside a LIVE S100 exam:

| entity | rows |
| --- | ---: |
| users (100 live candidates + 120 history candidates + staff) | 223 |
| exams (1 live + 2 archived, 90–120 days old) | 3 |
| exam_attempts (100 live `in_progress` + 120 `graded` old; snapshot at seed — the live exam's 100 rows materialize during the run, see `cardinality.json` before/after) | 120 → 220 |
| exam_admissions (all consumed — semester admission history) | 120 |
| attempt_interruptions (episodes across the old attempts) | 1,200 |
| attempt_interruption_events (`detected` 1,200 + `restored` 900) | 2,100 |
| client_events (30-day window) | 10,000 |

Episode mix: 75% completed (detected + restored pairs), 25% pending with historical dates
(1–88 days old) — deliberately violating any "recent only" assumption.

## The two questions this run answers

### 1. Does the discovery/reconcile path converge at this cardinality? — YES, exactly

After ~4.5 minutes of live S100 traffic with the API's own 30 s heartbeat scanner running:

- `pendingEpisodes`: **300 → 0** (durable count, fresh connection).
- `systemIncidentsCreated`: **1,200** (all episodes materialized), `systemIncidentConflicts`: 0
  (write-once operation-id CAS held across every tick), `disruptedCount`: 0 in all 2,058 research
  snapshots (correct — no live candidate was actually disrupted).
- No horizon shortcut was available: the pending episodes carry 1–88-day-old timestamps, so
  convergence required scanning the full O(history) episode set — and it still converged.

Reconcile tick wall time, from the scanner's `lastStartedAt → lastSettledAt` deltas in
`pool.jsonl` (9 settled ticks): the initial **backlog tick** — the one that materializes all
1,200 incidents from the 300 pending episodes — takes **14,265 ms**; every subsequent settled
tick at full 1,200-episode cardinality (discovery query only, nothing to settle) runs
**40–54 ms**, and the 30 s cadence is maintained throughout. (The pre-corrective doc quoted only
the no-op tick value — 48 ms — which is the same shape: backlog 13,098 ms, no-op 40–50 ms there.)

### 2. Is the discovery query still fast at this cardinality — and is an index warranted? — Fast without one

`EXPLAIN (ANALYZE, BUFFERS)` of the discovery query (the `listHeartbeatDetectedEpisodes`
derivation: `event_type='detected' AND detection_source='heartbeat_timeout'` joined through
interruptions→attempts, ordered by `occurred_at, interruption_id`):

- Without candidate index: **3.4 ms** (planner `Execution Time` 2.124 ms) — nested-loop joins
  over 1,200 rows + quicksort (245 kB), 5,052 buffer hits, no seq-scan problem, no spills.
- With the candidate index created (`ll_discovery_idx`): **3.3 ms** — the planner does not
  change to an index scan; identical join/sort shape. The index is dropped after the measurement
  (A/B inside `explain.json`; the shipped schema is untouched).

Verdict: at the composition-realistic cardinality the current structure is O(rows) and
single-digit milliseconds; the #545 index re-check residual closes with **keep current
structure** (the measured planner choice), not with a new index.

## Live S100 workload under this history (interference check)

The 100 live candidates ran uninterrupted (logins + starts + 270 s of save/heartbeat) while the
reconciliation loop churned through the 300 pending episodes:

| phase | requests | success | 5xx | 429 | timeouts | p50 (ms) | p99 (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| setup logins | 100 | 100 | 0 | 0 | 0 | 3,432.4 | 4,506.4 |
| start burst | 100 | 100 | 0 | 0 | 0 | 586.7 | 715.9 |
| BASELINE_STEADY (30 s, before convergence) | 814 | 814 | 0 | 0 | 0 | 23.0 | 102.9 |
| MEASURE_STEADY (240 s, reconcile active) | 6,125 | 6,125 | 0 | 0 | 0 | 21.4 | 73.6 |

(The runner's own `summary.json` carries empty phase arrays by design — all stats regenerate
from raw `samples.jsonl` via `harness/summarize.ts`; `summary.regenerated.json` is committed
next to it. This matches the "no hand-copied numbers" rule.)

Setup logins match the main-matrix S100 LOGIN_BURST envelope (p50 3,420 / p99 4,519.5 —
[04](04-results.md)), and steady p50/p99 match the main-matrix S100 steady numbers: semester-scale
history in the same org does NOT measurably interfere with the live exam workload — the discovery
path stays off the hot path, as the #545 fix intended.

## Connection-lifetime soak (95 min, postgres.js max_lifetime rotation) — exercised, transparent

Run: `results/soak-S50-2026-09-19T11-41-07-352Z/` — 50 live candidates, DIRECT_LAN with a
distinct per-candidate loopback source IP, APP_MODE=production (limiter ON, default budgets,
Redis-backed store — the accepted #554 topology), pool `max=10` with the default randomized
`max_lifetime` 30–90 min, 11:41:10→13:16:11 UTC (95 min). Rotation evidence generated by
`harness/analyze-rotation.ts` → `rotation-analysis.json` from the 10 s `pg_stat_activity`
backend watcher in `pool.jsonl`; latency/error evidence from `samples.jsonl` (regenerated via
`harness/summarize.ts`, drift check ok). No number below is hand-copied.

- **Rotation actually happened** (the #554 E12 concern is not hypothetical): **22 distinct
  backend PIDs** served the pool over the window; **17 connections reached their lifetime and
  were replaced by fresh PIDs** (`retiredPids`; backend ages 34.5–59.3 min, all inside the
  randomized 30–90 min window), with replacements appearing continuously through the window.
- **Rotations are transparent to the workload**: 37,847 SOAK-phase save/heartbeat requests —
  **zero 5xx, zero timeouts, zero network errors**, every request 200/201; and **0 errors
  inside every ±60 s retirement window** (787–801 requests per window; `rotationWindows`).
- **Latency stays flat over the soak**: SOAK-phase p50 = 24.3 ms, p95 = 40.7 ms, p99 = 60 ms
  (`rotation-analysis.json` `soakTotals`). The single tail event (max 1,379.5 ms) is
  accounted for: at 12:24:33–12:25:00 a cluster of connections reached their lifetime nearly
  simultaneously (`pg_stat_activity` shows up to 8 active backends and 6 lock waits for
  ~25 s while replacements connected) — a transient, error-free save-latency bump, not drift;
  p50/p95 are unchanged through both hours.
- **Server log**: the API's pino stdout covers only the first 12.7 min of the 95-min run
  (zero `level≥40` lines in the covered window) and then stops receiving writes while the
  process keeps serving correctly for the remaining 82 min. Root cause: the evidence commit
  made mid-run staged these live-written artifacts and the pre-commit lint-staged
  stash/restore replaced the log path under the API's long-lived stdout fd — a measurement
  hazard, not a serving defect; the bounded 20-min reproduction with no concurrent git
  activity did not reproduce it ([12](12-corrective-1.md) § Server-log outage).
- Setup logins 50/50 (p50 1,751.1 / p99 2,280.9 ms — consistent with the S50 lifecycle
  LOGIN envelope, p99 2,432.3) and starts 50/50 (p99 377.4 ms) open the soak.

Verdict: connection-lifetime rotation is PROVEN_FOR_MEASURED_TOPOLOGY at S50 steady shape —
`CONNECTION_LIFETIME_ROTATION_NOT_EXERCISED` does NOT apply; the rotation path was exercised 17
times with no client-visible error. The soak also re-confirms the steady-state envelope at 95×
the steady measurement window (no leak, no drift, no accumulated pool damage). The stdout
logging outage is recorded as a measurement-infrastructure finding with its own bounded
reproduction ([12](12-corrective-1.md)); it did not affect any served request or the pool.

## Scope note

This run re-proves the RESILIENCE residual at one composition point (1,200 episodes, 120
attempts, 10k client events, ~223 users). It is not an unbounded-growth proof: cardinality is
semester-realistic per the #545 contract, not a stress ceiling. Behavior at 10–100× episode
counts is outside this campaign's envelope and remains future work if history retention grows.
