# #586 — 07 Lock Analysis (hot-row identification)

Status: FINAL. Corrected 2026-09-29: waiter-concurrency terminology
("77–89") replaced by the audited per-instant bounds; row/instant counts
disambiguated. Sources: in-db `\watch` samplers (200 ms) in the diag runs
`results/diag-p20-S200/` and `results/diag2-p20-S200/` (both pool=20,
N=200 — the configuration with the worst tail). The main-matrix cells ran
with the activity sampler only; the relation-level and query-text
samplers were repaired after the campaign and exercised via the two
diagnostic runs (supplementary evidence, not part of the frozen matrix;
raw dirs retained).

## Sampler evidence

**Ungranted locks by relation** (diag-p20-S200: 315 physical sampler rows
across 154 distinct sampling instants, 200 ms cadence):

| locktype | relation | wait_event | weighted waiter-instants | share |
| --- | --- | --- | --- | --- |
| tuple | **exams** | Lock/tuple | 2453 | 93.8% |
| transactionid | — | Lock/transactionid | 142 | 5.4% |
| tuple | exams | Lock/transactionid | 9 | 0.3% |
| transactionid | — | Client/ClientRead etc. | 10 | 0.4% |

"weighted waiter-instants" = sum over sampler rows of the grouped backend
count at each instant; it is a cumulative observation count, NOT a
concurrency level. The relation-level rows sum to 2614 over 154 instants
(2462 of them on the exams tuple, i.e. 2453 + 9).

**Query text of tuple-lock waiters** (diag2-p20-S200: 163 physical rows
across 156 instants):

| weighted waiter-instants | statement (truncated 100 chars) |
| --- | --- |
| 2461 | `select "id","organization_id","title","description","course_id","status","timing_mode", … from "exams" …` (locking read) |
| 32 | `insert into "exam_attempts" (…)` — START-phase FK key-share behind the same row |

**Peak simultaneous waiting backends** — audited per instant
(2026-09-29, correcting earlier wording):

| quantity | value | source |
| --- | --- | --- |
| max distinct backends in `wait_event_type='Lock'` at one instant | **19** | diag2 activity sampler (`pg_stat_activity` rows with `Lock` wait, grouped counts summed per timestamp) |
| max simultaneous waiters on the exams tuple row at one instant | **18** | diag2 qtext sampler (sum of grouped counts per timestamp); diag locks sampler exams-tuple sum = 18 |
| max backends of any state at one instant | 21 | diag2 activity sampler (pool 20 + 1 background, e.g. autovacuum) |

The pool cap for both diagnostic runs is 20, so ~18–19 simultaneously
blocked backends means **essentially the entire pool is parked on the
exams row** during the convoy — not the entire 200-candidate in-flight
population. An earlier draft of this document stated "peak concurrent
waiters ≈ 77–89"; the raw-sampler audit could not reproduce that figure
as any per-instant concurrency quantity (all per-instant bounds are
≤ 21, and the app cannot exceed its pool cap). What the samplers do
contain is a per-instant waiter count of 16–18 during the long plateau
(e.g. 68 instants at 17, 49 at 16 for exams-tuple); summed over the
0.2 s cadence this yields ~80–90 waiter-instants per second — the
likely origin of the 77–89 figure. It was a cumulative lock-wait
observation rate, not simultaneous waiters, and is corrected here.

Sampler counting note: per-instant sums count grouped rows; a waiting
backend can hold more than one ungranted lock row (tuple + transactionid),
so row sums can exceed the distinct-PID count. The distinct-PID bound is
provided by the activity sampler (19). No sampler recorded per-PID rows,
so `COUNT(DISTINCT pid)` per instant is bounded here, not enumerated;
per-instant sums ≤ pool cap + background is the strongest available form.

## The contended statement

The locking exams read is `examRepo.findByIdForUpdate` called from
`ensureAttemptDeadlineReconciled`
(`packages/exam-engine/src/deadlineReconciliation.ts:211`), invoked inside
the submit transaction (`apps/api/src/orchestrators/submitAndGradeAttempt.ts:217`).

The code comments there state the design intent (EXAM-558 invariant): the
Exam authority must be read under the row lock so an expiry decision can
never be evaluated from a `closeAt` a concurrent exam command has already
replaced; under REPEATABLE READ a stale read raises 40001 and retries;
lock order Enrollment → Attempt → Exam. This is a **correctness
serialization point, deliberately chosen** — this experiment does not
question it; it measures its cost.

## Convoy mechanism

PostgreSQL row locks hold until COMMIT. So from the moment a submit
transaction acquires Exam FOR UPDATE (early, in the reconciliation
phase) until it commits (audit + grading snapshot + finalize + grading
entries materialization still to do), **no other submit transaction can
pass that point**. With pool cap P, up to P transactions are admitted
simultaneously; each waits for the full remaining work of the one ahead.
Expected queue time ≈ P × per-txn-remaining-work — matching the
measurements:

- pool 10 / N=200: txHold p50 309 ms, p99 443 ms — convoy ≤ 10 deep.
- pool 20 / N=200: txHold p50 800 ms, p99 10826 ms — convoy up to 20
  deep; a chain of ~20 × ~500 ms ≈ 10 s reproduces the p99.
- pool 30 / N=200: txHold p50 1236 ms, p99 9786 ms — same shape.

At N=50/100 the convoy is short enough that medians improve with a
bigger pool (parallel EA/answer work) while p99 stays flat or worsens.

## Ruling out alternatives

- **PG CPU saturation**: db container CPU never saturated (08); sat
  fraction is lock-wait-weighted occupancy, not compute.
- **EA (enrollment/attempt) row contention**: distinct per candidate;
  per-phase locks ≈ 4–5 ms; no tuple waits sampled on
  `exam_enrollments`/`exam_attempts` beyond the FK insert case above.
- **Serialization/deadlock retries**: 0 in all cells (no writer to the
  exams row in the workload, so no 40001 was generated).
- **Pool queueing alone**: contradicted by txHold growth — pool waits
  are upstream of the transaction and cannot inflate txHoldMs.

## Consequence for #586

The submit tail is gated by a single-row serialization point that is part
of the ADR-008/EXAM-558 correctness design, not by the connection pool
cap. A pool change cannot remove the convoy; it can only make it longer
(more simultaneous contenders) or shorter (fewer). Two bounded follow-up
directions exist, and this experiment selects neither:

1. **Narrow the serialization point's lock scope** — test whether the
   EXAM-558 deadline-authority read can use a shared Exam row lock
   (`FOR SHARE`) so same-exam candidate transactions coexist while
   exam-authority writers still serialize. This is the directly derived
   hypothesis; it was tested in the separate #558 lock-mode gate
   (`docs/research/exam-558-lock-mode-1/`) — #586 discovered the
   hypothesis and does not itself prove it.
2. **Remove work from the critical section / restructure grading** —
   explicitly NOT authorized by #586 (`11-followup-boundary.md`).
