# EXAM #885 — RESULTS

**Research-only.** No product runtime code was modified. No PR, merge, release, or Issue close.
Verdict: **GO_C (CONDITIONAL)** — a research/decision verdict, **not** implementation
authorization.

> **Replay errata (2026-11-06).** The `105 s` detection / `15 s` recovery figures in this
> historical study were measured from phase observation markers, not from the actual
> injection/throw-settle events. The corrected episode-level measurements and the committed
> E7 reset instrument are in [`POSTFIX_VALIDATION.md`](POSTFIX_VALIDATION.md) §6. The
> “0 allocations” wording is narrowed there: no new scanning or persistent I/O was added,
> but heap allocation was not measured and per-monitor-tick closures do allocate.

## 1. Baseline (from `origin/master`, 2026-11-05)

| Item | Value |
| --- | --- |
| BASE_SHA | `f2d44b78136cda1358148dbce891590975d4c88f` |
| Git / worktree at start | branch `master`, `git status --short` **clean**; after work the main worktree is **still clean** |
| PR #884 merge SHA | `5e790137c4c13c584961bead4749ac583cfeddb3` (merged 2026-11-05T08:19:47Z) |
| #886 | **Fully delivered**: `caf9bebe` (merged via #893); `consecutiveFailedTicks` projected in `system.ts:462`/`:485` and `packages/contracts/src/system.ts:208`,`:228` |
| #547 / #862 / #886 | CLOSED (historical decisions unchanged) |
| #800 | OPEN (research parent) |
| #885 | **OPEN**, 0 comments at baseline; Source: PR #884 review residual risk 3; P2 |
| Worktree | `/home/hoo/Source/exam-885` (detached at BASE_SHA) |

Sources read: the three plugins + their 3 test suites, `docs/operations/active-alerting.md`,
`/api/system/diagnostics` (`apps/api/src/routes/system.ts`) and its contracts schema,
`systemStatsRepo.pingDb`, `apiSurface.ts` readiness route, #547/#862/#884/#886 bodies, and
PR #884 merge metadata. Full DAG and 8 source-verified facts: `SOURCE_MAP.md`.

## 2. Root cause

**CONFIRMED BY SOURCE + MEASURED REPRODUCTION.** Three independent suppression mechanisms
compose into an unbounded blind spot for a tick-level throw loop:

1. `lastSettledAt` is stamped in `.finally()` (`heartbeat.ts:396`, `deadlineScanner.ts:393`),
   so a throwing tick **still settles** → `classifyLoopStall` reads `healthy` → no
   `operability.background_loop` alert.
2. `consecutiveFailedTicks` is updated **inside `try`** (`heartbeat.ts:386-389`,
   `deadlineScanner.ts:374-377`); the `catch` only logs an ERROR. A throw therefore **freezes**
   the counter below `BUSINESS_FAILURE_TICK_THRESHOLD = 4` → no `operability.business_failure`.
3. The readiness probe is `SELECT id FROM organizations LIMIT 1`
   (`systemStatsRepo.ts:153-160`); with the DB reachable it reports healthy → no
   `operability.readiness`.

The only remaining signal is a per-tick ERROR log (`"Error scanning for …"`) which the §3
external hook contract does **not** page on (`active-alerting.md:98-113`). §4 of that doc and
the two freeze REGRESSION tests explicitly document this as "by ownership design".

**Crucially, the design's premise does not hold**: a healthy probe does **not** prove the throw
is non-DB (E3: a PostgreSQL-shaped `42703` error coexists with a probe healthy on all 18
samples; the probe covers none of `exam_attempts` queries, joins, permissions, transactions or
serialization). Conversely an unhealthy probe does not prove causation. So
`DB healthy && tick throws → non-DB exception` is **refuted as an inference**, and any fix
must keep the cause **UNKNOWN**.

## 3. Reproduction

**REPRODUCED = YES.** 20 deterministic scenarios (E0–E11 mandated + one reviewer-driven E12),
556 controlled 15 s steps, 337 real ERROR lines, 218 real throw ticks across the two loops,
26 real `operability.*` transitions. No PostgreSQL was opened; faults entered only through a
fake `fastify.db` reproducing the real drizzle chain shapes. The three REAL plugins were
registered on one Fastify app with fake timers; all stdout pino JSON lines and metrics are
real product output.

Decisive measurement (E2/E3/E6, `DB_HEALTHY_THROW_GAP = CONFIRMED`):

```
9 consecutive throw ticks per loop, 18 monitor samples, pingFailDeltaSum = 0 (probe
healthy on EVERY sample), hbSettled = dlSettled = 9 (all ticks settled),
consecutiveFailedTicks = 0 (frozen), stallState = healthy,
operability.readiness = 0, operability.business_failure = 0,
operability.background_loop = 0, operability.* transitions = 0.
```

No upper bound exists in the code — the loop can throw forever with no escalation.

Control: the **3 existing plugin suites (67 tests) pass unchanged** at BASE_SHA.

E11 distinguishes the concepts: a hung tick never settles (`hbSettled=0`) and raises
`operability.background_loop/stalled` @180 s — **throwing ≠ stalled**.

## 4. Test matrix (condensed)

| ID | What it proves | As-built escalated events |
| --- | --- | --- |
| E0 | clean baseline | 0 (MATCH, no false positive) |
| E1 | DB-down ownership | readiness 1+1; 0 business_failure |
| E2 (×3) | **#885 gap**, both loops | **0** (GAP) |
| E3 (×2) | healthy probe + DB-root-cause throw, both loops | **0** (misattribution refuted) |
| E4 | existing business_failure works | 4 (2 failing + 2 recovered) |
| E5 (×3) | freeze/resume on mixed faults | 2–4 (MATCH) |
| E6 (×3) | recovery after throws / after business_failure | 0 for throw case (no false recovery) |
| E7 | restart = process-local | 0 as-built; CF re-raise, no carry-over recovery |
| E8 | sampling desync + short bursts | 0; 3-tick burst correctly silent |
| E9 | readiness + throw same root cause | 2 readiness; CF C `dup=2` |
| E10 | old business_failure held stale during throws | 4 (stale `failing` until clean settle) |
| E11 | hang = stalled, not throwing | 2 background_loop/stalled |
| E12 | chronic-intermittent boundary | 0 (all candidates; residual false-negative) |

Full per-field matrix, all latencies, expected-vs-actual, and commands: `EXPERIMENTS.md`.

## 5. Alert semantics (condensed)

Four distinct states: **DEPENDENCY_UNAVAILABLE** (own probe), **BUSINESS_OPERATION_FAILED**
(tick settled, item failed), **TICK_EXECUTION_FAILED** (tick aborted, unabsorbed exception),
**UNKNOWN_CAUSE** (persistent exceptions, cause not attributable from the app's facts).

- A throw is **not** a business failure, **not** a stall, and does **not** license a
  non-DB root-cause claim.
- Consecutive throws **are** an independent operational fact worth escalating.
- Accurate recovery for throws = "a settled tick with no throw was observed" (**exceptions
  cleared**), NOT "business recovered / backlog drained" → **UNKNOWN** for business
  restoration. `recovered` must never be emitted on a throw (that would be false recovery).
- A clean settle ends the exception run; it does not prove the underlying fault is fixed.
- E10: an old `business_failure/failing` stays stale (but fail-safe) during a throw run —
  document as UNKNOWN-status and file a follow-up, do NOT emit recovery.
- Delivery is NOT production: no watcher implementation exists; only stdout event-production
  latency is measured. Full answers: `ALERT_SEMANTICS.md`.

## 6. Quantified risks

**DOUBLE_ALERT_RISK**: MEASURED — candidate C produces `dup=2` (one per loop) in E1 and E9
during a readiness outage; A and B produce the same `dup=2`. D removes them (`dup=0`) but
produces a **phantom raise/recover pair at the readiness-recovery boundary** (E1
@255000/@270000, E9 @195000) and delays detection to 150–210 s. Decision: keep C's truthful
duplicates; dedupe at notification level in the external watcher, not by app-layer
suppression.

**FALSE_RECOVERY_RISK**: MEASURED — none for C in E6/E7/E8; a `recovered` is emitted only on a
clean settle, and E7 shows no carry-over recovery after restart. The residual risk is
**semantic**, not state-machine: if the recovery message said "business recovered" it would be
false. Condition §5.3 mandates "tick exceptions cleared … business restoration unknown".
E10's stale `business_failure` is a separate, documented residual.

**MINIMAL_MACHINE_WORK** (C, SOURCE_VERIFIED/INFERRED): per scanner tick 1 integer increment
or reset (via a tick-local `threw` flag written in the existing `.finally()`); per monitor
tick 2 integer reads + 2 classifier calls + 2 tracker calls, with at most one extra stdout
line **only on a transition**. **0 new timers, 0 new DB probes, 0 new I/O channels,
0 new scanning/persistent I/O, 0 durable state, 0 env knobs, 0 schema changes.** New state =
**4 scalars**. Heap allocation was not measured; per-monitor-tick closures do allocate.
(2 process-local integers + 2 tracker `boolean|null`). Historical phase-marker measurement:
**105 s** and **15 s**; the corrected episode-level replay is in `POSTFIX_VALIDATION.md` §4.

## 7. Independent reviews

- **Reviewer 1 — Reliability/Observability**: A REJECT, B REJECT, C CONDITIONAL SUPPORT,
  D REJECT; **GO_C CONDITIONAL**. Top risks: delivery unowned / whitelist gap; D's causal
  over-claim + phantom alerts; chronic-intermittent false negative.
- **Reviewer 2 — Minimum Necessary Engineering**: A REJECT, B REJECT, C SUPPORT
  (CONDITIONAL), D REJECT; **GO_C**. Minimum change set: 0 new files/functions/timers/probes/
  durable state/env knobs, 4 scalars, ~7 tests. "C is the cheapest correct option."

**Both independently rejected A, B and D and supported C conditionally.** Four genuine
disputes are recorded verbatim in `DECISION.md §6` (ADR requirement, flapping coverage,
E10 wording, delivery framing) — they are **not** merged into a false consensus. Review 1's
objections drove the corrected recovery wording, the new E12 experiment, and conditions
§5.1–§5.7. Review 2 drove the `.finally()` counter write, the ~7-test cap, the neutral-alias
condition, and the extra rejected smaller options.

## 8. Verdict

**GO_C — CONDITIONAL** (independent `operability.tick_failure` escalation, research decision
only). Priority applied: correct alert semantics > verifiable incident coverage > no duplicate
failure authority > minimal machine work > code lines.

- B rejected on correctness (false "business failures" message, breaks 2 freeze tests).
- A rejected on verifiable coverage (no escalatable event; delivery unowned).
- D rejected on measured phantom alerts + causal over-claim.
- C: historical 105 s phase-marker detection / 15 s recovery (corrected replay in
  `POSTFIX_VALIDATION.md` §4), 0 measured false positives in clean,
  business-failure-only, stall, short-burst and intermittent scenarios, at 4 scalars + one
  additive contract entry.

**Conditions before any implementation** (`DECISION.md §5`): scope the claim to event
production (update §3 whitelist); explicit decision record for the §4 design reversal; correct
recovery wording; validate the threshold hypothesis without an env knob; no app-layer
correlation; UNKNOWNs in the runbook; E10 follow-up. GO does **not** authorize product code.

Recommended change package (7 physical files, ~7 new tests, pure `git revert` rollback):
`DECISION.md §4`.

## 9. Remaining uncertainty

- **Operator delivery latency: UNKNOWN** — no external watcher exists in the repo. Only stdout
  event-production latency was measured. Do not claim "operator notified".
- **Statistical miss/FP rates: NOT CLAIMED** — 20 deterministic scenarios cannot support a
  percentage; results are scenario-level.
- **Real PostgreSQL fault: INCONCLUSIVE / not executed** — E3 uses a PostgreSQL-shaped error
  in a fake db; the conclusion rests on SOURCE_VERIFIED query-path difference. No real DB was
  touched.
- **E12 chronic-intermittent gap: CONFIRMED residual** — no candidate covers 3-of-4-tick
  throws; a 4→1→4 flapping pattern is UNMEASURED.
- **E10 stale business_failure**: residual of the frozen #862 contract; follow-up Issue needed.
- **Threshold 4** for throws is a hypothesis (same 30 s cadence), not tuned.
- Multi-instance, stdout loss, log-shipping lag, and whether a deployed watcher dedupes
  readiness + tick_failure: UNKNOWN.

## 10. Evidence locations and persistence

Local evidence package: `/home/hoo/Source/exam-885/research/issue-885/` —
`RESULTS.md`, `SOURCE_MAP.md`, `EXPERIMENTS.md`, `ALERT_SEMANTICS.md`, `DECISION.md`,
`REPRO.md`, plus `harness/` (runnable test source + configs) and `results/` (machine-readable
observations + transcripts).

**NON-PERSISTENCE NOTICE**: this package lives in a **local, detached research worktree** and
was **NOT committed or pushed** (no commit/push authorization in the task). A worktree is
ephemeral local state: if the directory or the repository is removed, the evidence is lost.
The **durable record** is the GitHub Issue #885 writeback comment, which carries BASE_SHA, the
matrix, key numbers, the six-file evidence index and the final verdict. Re-running from the
frozen BASE_SHA is fully specified in `REPRO.md`. Raw oversized logs, dependency caches and DB
snapshots were never created; `experiments.json`/`analysis.json` are compact structured
observations (~600 KB / ~220 KB), not raw log dumps.

*(2026-11-06 update: the package is now committed with PR #896 for traceability, with one
deliberate exception — the `results/` dumps are regenerable outputs of a deterministic run
and are **not committed**; their receipt hashes stay in `REPRO.md` §4.3 with the mapping in
§4.4. The NON-PERSISTENCE NOTICE above is the study's accurate history.)*

## 11. GitHub writeback

One consolidated research comment was posted to #885 (no duplicate, no close, no PR, no
merge): **comment `6660017391`** — `https://github.com/jnhu76/exam/issues/885#issuecomment-6660017391`,
by `jnhu76`, `2026-11-05T14:06:28Z`, 9,462 chars. It carries BASE_SHA, the A/B/C/D matrix,
the key measured numbers, the six-file evidence index, the non-persistence notice and the
final verdict. Verified by re-reading the Issue comments after posting: `comment_count=1`
(no duplicate), Issue state still `OPEN`, main worktree still clean. See the final answer
block for `ISSUE_WRITEBACK`.
