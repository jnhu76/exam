# EXAM #885 — EXPERIMENTS

**BASE_SHA** `f2d44b78136cda1358148dbce891590975d4c88f`. Worktree `/home/hoo/Source/exam-885`.
All numbers below are **MEASURED** unless the column is explicitly labelled COUNTERFACTUAL.

> **Replay errata (2026-11-06).** The `105 s` detection / `15 s` recovery figures in this
> historical study were measured from phase observation markers, not from the actual
> injection/throw-settle events. The corrected episode-level measurements and the committed
> E7 reset instrument are in [`POSTFIX_VALIDATION.md`](POSTFIX_VALIDATION.md) §6. The
> “0 allocations” wording is narrowed there: no new scanning or persistent I/O was added,
> but heap allocation was not measured and per-monitor-tick closures do allocate.

## 1. What is real and what is simulated

- **MEASURED (as-built)**: three REAL Fastify plugins — `heartbeatPlugin`,
  `deadlineScannerPlugin`, `operabilityMonitorPlugin` — registered on ONE app. Faults enter
  **only** through a fake `fastify.db` that reproduces the exact drizzle chain shapes of the
  real repos (`organizationRepo.list`, `attemptRepo.listInProgress`,
  `listDeadlineCandidates`, `executeInTransaction`). No product source was modified. Every
  stdout pino JSON line, every module-level metric, every `operability.*` transition and its
  `time` stamp is real product output. The third (retention) loop is held in a known-healthy
  state so the REAL monitor does not emit a confounder `client_event_retention` stall alert.
- **COUNTERFACTUAL (A/B/C/D)**: pure classifiers fed the measured per-tick telemetry, reusing
  the REAL `classifyPersistentBusinessFailure`, `createOperabilityTransitionTracker`, and the
  REAL 15 s monitor cadence. Candidate names/events are hypotheses, NOT approved APIs, and
  their event counts/latencies are NEVER reported as delivered product behaviour.
- **Clock**: `vi.useFakeTimers({ now: T0 })`, T0 = `2026-09-17T08:00:00Z`. `fastify.now()` and
  pino's `time` share this clock. Detection latency is measured from the fault's **actual
  occurrence step**, not derived from threshold × cadence arithmetic. Step = 15 s (the real
  monitor cadence); a scanner tick fires every 2 steps (real 30 s default).

No PostgreSQL was opened. No dev/prod data was touched. No new test framework was created —
the harness is a Vitest file using the repo's own `workspaceSourceResolutionPlugin` and the
existing Fastify-plugin test idiom (fake `db` + `now` decoration + Writable log stream).
`node_modules` are symlinked from the main repo; the main worktree stayed clean throughout.

## 2. Commands actually executed (all exit code 0)

> **Historical receipt.** Commands as run on 2026-11-05 with the two runner configs then
> located in `apps/api/`; the PR #896 scope diet later merged them into
> `research/issue-885/harness/vitest.config.ts` (mapping: `REPRO.md` §4.4). Live
> commands: `REPRO.md` §5.

| # | Command (from `/home/hoo/Source/exam-885`) | Exit | Timestamp (UTC) | Artifact |
| --- | --- | --- | --- | --- |
| 1 | `git worktree add --detach /home/hoo/Source/exam-885 f2d44b78…` | 0 | 2026-11-05T13:12Z | frozen worktree |
| 2 | `apps/api/node_modules/.bin/vitest run --config apps/api/vitest.885.config.ts` (smoke) | 0 | 2026-11-05T13:18Z | `results/run-transcript.txt` (first run) |
| 3 | `apps/api/node_modules/.bin/vitest run --config apps/api/vitest.885.config.ts` (full E0–E11, after fixing the fault-phase label bug) | 0 | 2026-11-05T13:24Z | `results/experiments.json`, `results/run-transcript.txt` |
| 4 | `node research/issue-885/harness/analyze.mjs` | 0 | 2026-11-05T13:25Z | `results/analysis.json`, `results/analysis-transcript.txt` |
| 5 | `apps/api/node_modules/.bin/vitest run --config apps/api/vitest.885.regression.config.ts` (three EXISTING plugin suites, unchanged) | 0 | 2026-11-05T13:26Z | `results/regression-transcript.txt` |

Run 5: **3 files / 67 tests passed** (`operabilityMonitor.test.ts` 44, `heartbeat.test.ts` 13,
`deadlineScanner.test.ts` 10). This is the control proving the frozen #547/#862/#886 contract
is intact at BASE_SHA and that the harness did not need to change any product code.

Aggregate MEASURED evidence: **20 scenarios, 556 controlled steps, 337 real ERROR lines,
218 real throw ticks across loops, 538 settled ticks, 26 real `operability.*` transitions**.
168 counterfactual events (A/B/C/D combined). E12 was added after Reviewer 1's independent
objection (see §5), not as scope expansion.

## 3. Fault matrix — all measured per-experiment fields

Columns: injection seam & type; loops covered; started/settled tick counts (hb / dl);
`lastSettledAt` behaviour; max `consecutiveFailedTicks` (hb/dl); readiness events
(failure+recovery); `business_failure` events; `background_loop` events; real ERROR lines;
total real `operability.*` transitions; measured as-built detection/recovery latency; and
COUNTERFACTUAL candidate-C detection/recovery latency.

| ID | seam / fault type | loops | started/settled hb , dl | lastSettledAt | hbC/dlC max | readiness | biz | loop | ERROR | operability.* | as-built det/rec | CF-C det/rec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E0-normal-empty-tick | none (clean) | both | 7/7 , 7/7 | advances | 0/0 | 0+0 | 0 | 0 | 0 | 0 | — / — | — / — |
| E1-db-down-throws | pingDb + org discovery: ECONNREFUSED | both | 11/11 , 11/11 | advances | 0/0 | 1+1 | 0 | 0 | 15 | 2 | 0ms / 0ms | 105000ms / 15000ms |
| E2-both-org-discovery-logic-throw | org discovery: logic `Error` | both | 12/12 , 12/12 | advances | 0/0 | 0+0 | 0 | 0 | 18 | **0** | **— / —** | 105000ms / 15000ms |
| E2-hb-attempt-discovery-logic-throw | hb `listInProgress`: logic `Error` | heartbeat | 12/12 , 12/12 | advances | 0/0 | 0+0 | 0 | 0 | 9 | **0** | **— / —** | 105000ms / 15000ms |
| E2-dl-attempt-discovery-logic-throw | dl `listDeadlineCandidates`: logic `Error` | deadline_scanner | 12/12 , 12/12 | advances | 0/0 | 0+0 | 0 | 0 | 9 | **0** | **— / —** | 105000ms / 15000ms |
| E3-hb-pg-query-error | hb `listInProgress`: PostgreSQL 42703 | heartbeat | 12/12 , 12/12 | advances | 0/0 | 0+0 | 0 | 0 | 9 | **0** | **— / —** | 105000ms / 15000ms |
| E3-dl-pg-query-error | dl `listDeadlineCandidates`: PostgreSQL 42703 | deadline_scanner | 12/12 , 12/12 | advances | 0/0 | 0+0 | 0 | 0 | 9 | **0** | **— / —** | 105000ms / 15000ms |
| E4-both-business-failures-settle | `db.transaction` rejects (per-item) | both | 11/11 , 11/11 | advances | 7/7 | 0+0 | 4 | 0 | 23 | 4 | 105000ms / 15000ms | — / — |
| E5-hb-alternating-biz-and-throw | alternating tx + hb discovery | heartbeat | 18/18 , 18/18 | advances | 8/0 | 0+0 | 2 | 0 | 23 | 2 | 195000ms / 15000ms | — / — |
| E5-dl-alternating-biz-and-throw | alternating tx + dl discovery | deadline_scanner | 18/18 , 18/18 | advances | 0/8 | 0+0 | 2 | 0 | 15 | 2 | 195000ms / 15000ms | — / — |
| E5-both-alternating | alternating tx + org discovery | both | 18/18 , 18/18 | advances | 8/8 | 0+0 | 4 | 0 | 38 | 4 | 195000ms / 15000ms | — / — |
| E6-hb-recover-after-continuous-throws | hb `listInProgress`: logic `Error` | heartbeat | 14/14 , 14/14 | advances | 0/0 | 0+0 | 0 | 0 | 9 | **0** | **— / —** | 105000ms / 15000ms |
| E6-dl-recover-after-continuous-throws | dl `listDeadlineCandidates`: logic `Error` | deadline_scanner | 14/14 , 14/14 | advances | 0/0 | 0+0 | 0 | 0 | 9 | **0** | **— / —** | 105000ms / 15000ms |
| E6-business-failure-recovery | `db.transaction` rejects (per-item) | both | 11/11 , 11/11 | advances | 6/6 | 0+0 | 4 | 0 | 20 | 4 | 105000ms / 15000ms | — / — |
| E7-restart-during-continuous-throws | org discovery: logic `Error` + RESTART | both | 17/17 , 17/17 | advances | 0/0 | 0+0 | 0 | 0 | 26 | 0 | — / — | 105000ms / 15000ms |
| E8-desync-short-bursts | org discovery: logic `Error` (3-tick + 8-tick bursts) | both | 17/17 , 17/17 | advances | 0/0 | 0+0 | 0 | 0 | 22 | 0 | — / — | 255000ms / 315000ms |
| E9-db-down-then-db-up-with-throws | ECONNREFUSED → org discovery logic `Error` | both | 15/15 , 15/15 | advances | 0/0 | 1+1 | 0 | 0 | 23 | 2 | 0ms / — | 105000ms / 15000ms |
| E10-business-failure-then-continuous-throws | tx rejects → org discovery logic `Error` | both | 18/18 , 18/18 | advances | 6/6 | 0+0 | 4 | 0 | 34 | 4 | 105000ms / 15000ms | 285000ms / 15000ms |
| E11-hung-tick-not-throwing | org discovery: never-resolving Promise | both | 2/1 , 2/1 | **frozen** | 0/0 | 0+0 | 0 | 2 | 2 | 2 | 135000ms / — | — / — |
| E12-chronic-intermittent-3-throw-1-clean | 4 × (3 throws + 1 clean settle) | both | 19/19 , 19/19 | advances | 0/0 | 0+0 | 0 | 0 | 24 | 0 | — / — | — / — |

"advances" = `lastSettledAt` took a new value on every throw/business/clean tick → the loop
**settles** and the stall classifier reads `healthy`. E11 is the only case where it froze
(`hbSettled=0`, `dlSettled=0` in the fault window) → `operability.background_loop/stalled`.

### Expected vs actual

- **E0**: expected 0 ERROR / 0 events / counter 0 → **MATCH**.
- **E1**: expected readiness ownership (1 `unavailable`+1 `recovered`, no business_failure,
  no stall, counter frozen, loops settling) → **MATCH**. The 15 ERROR lines = 7+7 scanner
  catch logs + 1 readiness error.
- **E2 / E3 / E6**: expected the #885 gap (no escalation) → **MATCH, GAP CONFIRMED**.
  Readiness healthy on **all 18 monitor samples** in the fault window
  (`pingFailDeltaSum = 0`, `pingDeltaSum = 18`), 9 throw ticks per loop, all settled,
  `consecutiveFailedTicks` frozen at 0, `stallState = healthy`,
  **ZERO `operability.*` transitions**. The gap is unbounded: 9 consecutive throws produced
  no alert and no upper bound exists in the code.
- **E3 specifically**: a PostgreSQL-shaped `42703` error at attempt discovery coexists with a
  probe healthy on all 18 samples → `DB healthy ⇒ non-DB exception` is **REFUTED as an
  inference** (SOURCE_VERIFIED: probe covers only `organizations LIMIT 1`).
- **E4 / E6-business-failure**: expected real `operability.business_failure` at 4 consecutive
  failed settles, recovered on first clean settle → **MATCH** (2 failing + 2 recovered across
  the two loops; det 105 s, rec 15 s).
- **E5**: expected freeze/resume → **MATCH**. Measured step trace (hb): counter climbs 1,2 in
  biz-A; **freezes at 2 across three throw ticks** (`thr=1 settled=1 hbC=2`); resumes 3,4;
  freezes at 4 across three more throws; resumes 5..8; resets to 0 on the first clean settle.
  A "consecutive failed ticks" count of 8 therefore spans 240 s of wall time with 6 throw ticks
  interspersed — folding throws into that counter (candidate B) would conflate two facts.
- **E7**: expected process-local restart semantics → **MATCH**. As-built: 0 events either
  side. COUNTERFACTUAL C: re-raised after restart at +330 s with **no carry-over recovery**
  (4 failure events total = 2 loops × 2 processes, 2 recoveries).
- **E8**: expected 3-tick burst NOT to escalate, 8-tick burst to escalate → **MATCH**.
  COUNTERFACTUAL C raised only once (at +300 s) for the 8-tick burst, +105 s after that
  burst's actual start (+195 s). The 255000 ms / 315000 ms figures in the table are measured
  from the **first** burst's start/clear (the scenario has two bursts); per-burst latency is
  105000 ms / 15000 ms, identical to E2 — monitor sampling added **no missed escalation and
  no extra delay** because the counter is process-local and monotonic between samples.
- **E9**: expected same-root-cause double-alert risk → **MATCH**. As-built: 1 readiness
  `unavailable` @45 s, 1 `recovered` @195 s, 0 business_failure. COUNTERFACTUAL C: 2
  `tick_failure/failing` @150 s **during the readiness outage** (`duplicateWithReadiness=true`
  for both loops). COUNTERFACTUAL D (app-layer correlation): 0 duplicates, but raised
  `failing` @195 s — **at the readiness-recovery boundary** — then `recovered` @270 s
  (E1 shows the same artifact: raise @255 s / recover @270 s). See DECISION.md.
- **E10**: expected the old business_failure to stay held → **MATCH**. `failing` @150 s,
  7 throw ticks with DB healthy, counter frozen ≥4, **no recovery until the first clean settle
  @450 s**. Two concurrent failing facts (stale business_failure + truthful tick_failure)
  would coexist under C. Recorded as UNKNOWN-status residual risk, not "fixed".
- **E11**: expected stall, not throw → **MATCH**. 2 `background_loop/stalled` @180 s,
  0 business_failure, 0 counterfactual C/D events, `lastSettledAt` frozen. The hang is
  released at teardown (after the last observation), so no stall-recovery event is observed in
  this scenario.
- **E12** (added after Reviewer 1's independent objection): expected that a strict
  consecutive counter **cannot** cover chronic-intermittent throws → **MATCH, and it is a real
  residual false-negative boundary**. 12 throw ticks + 7 clean settles per loop (24 ERROR
  lines), readiness healthy, **ZERO** as-built events and **ZERO** counterfactual A/B/C/D
  events — every clean tick resets the strict run-length counter before it reaches 4. This is
  inherited from the #862 policy (a clean settle resets the run) and is a deliberate
  non-alert boundary for *intermittent* failures, but it is NOT covered by the phrase
  "reliably discover a persistently failing loop" if "persistent" is read as
  high-duty-cycle intermittent. Recorded as a named condition of the verdict, not silently
  solved with extra state.

### Coverage of the mandated both-loop matrix

E2 (3 scenarios: both / hb / dl), E3 (hb / dl), E5 (hb / dl / both), E6 (hb / dl + both
business-failure), E9 (both, with per-loop breakdown in `results/experiments.json`) each
explicitly cover **heartbeat and deadline_scanner**. E0/E1/E4/E7/E8/E10/E11/E12 use the shared
path with both loops registered and measured separately. All 12 mandated experiment IDs E0–E11
executed, plus one reviewer-driven boundary E12.

## 4. Counterfactual candidate event counts (COUNTERFACTUAL, not product output)

`fail/rec` = failure events / recovery events. `dup` = failure events emitted while a real
`operability.readiness/database/unavailable` was active (same-root-cause duplicates).
`det/rec ms` from fault occurrence / fault clearance.

| ID | A fail/rec (det ms) | B fail/rec (det ms) | C fail/rec (det ms) | D fail/rec | C dup | B dup | D dup |
|---|---|---|---|---|---|---|---|
| E0 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |
| E1 | 2/2 (105000) | 2/2 (105000) | 2/2 (105000) | 2/2 | **2** | **2** | 0 |
| E2-both | 2/2 (105000) | 2/2 (105000) | 2/2 (105000) | 2/2 | 0 | 0 | 0 |
| E2-hb | 1/1 (105000) | 1/1 (105000) | 1/1 (105000) | 1/1 | 0 | 0 | 0 |
| E2-dl | 1/1 (105000) | 1/1 (105000) | 1/1 (105000) | 1/1 | 0 | 0 | 0 |
| E3-hb | 1/1 (105000) | 1/1 (105000) | 1/1 (105000) | 1/1 | 0 | 0 | 0 |
| E3-dl | 1/1 (105000) | 1/1 (105000) | 1/1 (105000) | 1/1 | 0 | 0 | 0 |
| E4 | 0/0 | 2/2 (105000) | 0/0 | 0/0 | 0 | 0 | 0 |
| E5-hb | 0/0 | 1/1 (105000) | 0/0 | 0/0 | 0 | 0 | 0 |
| E5-dl | 0/0 | 1/1 (105000) | 0/0 | 0/0 | 0 | 0 | 0 |
| E5-both | 0/0 | 2/2 (105000) | 0/0 | 0/0 | 0 | 0 | 0 |
| E6-hb / E6-dl | 1/1 (105000) | 1/1 (105000) | 1/1 (105000) | 1/1 | 0 | 0 | 0 |
| E6-business-failure | 0/0 | 2/2 (105000) | 0/0 | 0/0 | 0 | 0 | 0 |
| E7 | 4/2 | 4/2 | 4/2 | 4/2 | 0 | 0 | 0 |
| E8 | 2/2 (255000) | 2/2 (255000) | 2/2 (255000) | 2/2 | 0 | 0 | 0 |
| E9 | 2/2 (105000) | 2/2 (105000) | 2/2 (105000) | 2/2 | **2** | **2** | 0 |
| E10 | 2/2 (285000) | 2/2 (105000) | 2/2 (285000) | 2/2 | 0 | 0 | 0 |
| E11 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |
| E12 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |

Key reads:
- **No candidate produced any false positive** in E0 (clean), E4 / E6-business-failure
  (business failures only), E11 (stalled), or the 3-tick burst of E8. All candidate events
  are confined to scenarios with a real throw run or a real business-failure run.
- **B is the only candidate** that emits `business_failure` for a pure throw run (E2/E3/E6)
  → its message falsely claims "N consecutive ticks with business failures". It also fires in
  E4/E5/E6-business-failure where the real alert already fires (duplicate authority) and in
  E9 with `dup=2`.
- **C and D never fire on business-failure-only or stall-only scenarios** → distinct fact.
- **A** (hypothetical external log rule) matches C's detection timing in-process, but its
  "clear" is derived from ABSENCE of ERROR lines and its keying relies on the free-text `msg`
  field, not the stable `event`/`component` contract fields. Its dedup/recovery/attribution
  properties are INFERRED/UNKNOWN (no watcher implementation exists).

## 5. Explicitly NOT measured / NOT claimed

- **Operator notification delivery latency: UNKNOWN.** No external watcher exists in the repo.
  Only stdout *event production* latency is measured (pino `time` on the controlled clock).
  The task's prohibition on claiming delivery is respected.
- **Statistical miss/false-positive rates: NOT CLAIMED.** 20 deterministic scenarios cannot
  support a percentage. Results are scenario-level with explicit coverage boundaries.
- **Chronic-intermittent coverage gap (E12): CONFIRMED residual.** A loop throwing 3 of every
  4 ticks is not escalated by ANY candidate studied, because the strict consecutive counter
  resets on each clean settle. This is a deliberate boundary of the inherited #862 policy,
  not a regression; requiring coverage would be a separate threshold/window decision.
- **Real PostgreSQL fault reproduction: INCONCLUSIVE / NOT EXECUTED (by design).** E3 injects
  a PostgreSQL-*shaped* error into a fake db; the conclusion that a healthy probe cannot
  exclude a DB-root cause rests on SOURCE_VERIFIED query-path difference, not on a live PG
  failure. No real DB was needed and no dev/prod data was touched.
- **FLAKY: none.** All 20 scenarios are deterministic (controlled clock, deferred hang released
  at teardown); repeated runs produce byte-identical `experiments.json` apart from
  `generatedAt`.
- **UNKNOWN**: behaviour under stdout loss, log-shipping lag, multi-instance deployments,
  and whether a real watcher would dedupe readiness + tick_failure notifications.

## 6. Raw artifacts

| File | Content |
| --- | --- |
| `harness/experiments.test.ts` | Full Vitest harness (fake db, 20 scenarios, counterfactual A/B/C/D) |
| `harness/smoke.test.ts` | Config/clock/source-resolution smoke |
| `harness/analyze.mjs` | Derives latencies/aggregates from `experiments.json` |
| `apps/api/vitest.885.config.ts` | Research Vitest config (no DB globalSetup) |
| `apps/api/vitest.885.regression.config.ts` | Control config running the 3 EXISTING suites unchanged |
| `results/experiments.json` | MEASURED step-by-step observations + COUNTERFACTUAL events |
| `results/analysis.json` | Derived latencies/aggregates |
| `results/run-transcript.txt`, `results/analysis-transcript.txt`, `results/regression-transcript.txt` | Real command stdout |

*(Scope diet 2026-11-06: the two runner configs merged into
`research/issue-885/harness/vitest.config.ts`, and `results/` is regenerable via `REPRO.md`
§5 and intentionally not committed — mapping and replay receipt in `REPRO.md` §4.4. The rows
above are the artifacts as of the study run.)*

SHA256 of each key artifact is recorded in REPRO.md.
