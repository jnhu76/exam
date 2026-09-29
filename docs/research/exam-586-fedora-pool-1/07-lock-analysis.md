# #586 — 07 Lock Analysis (hot-row identification)

Status: FINAL. Sources: in-db `\watch` samplers (200 ms) in the diag runs
`results/diag-p20-S200/` and `results/diag2-p20-S200/` (both pool=20,
N=200 — the configuration with the worst tail). The main-matrix cells ran
with the activity sampler only; the relation-level and query-text
samplers were repaired after the campaign and exercised via the two
diagnostic runs (supplementary evidence, not part of the frozen matrix;
raw dirs retained).

## Sampler evidence

**Ungranted locks by relation** (diag-p20-S200, 315 sample lines):

| locktype | relation | wait_event | weighted waiter-instants | share |
| --- | --- | --- | --- | --- |
| tuple | **exams** | Lock/tuple | 2453 | 93.8% |
| transactionid | — | Lock/transactionid | 142 | 5.4% |
| tuple | exams | Lock/transactionid | 9 | 0.3% |
| transactionid | — | Client/ClientRead etc. | 10 | 0.4% |

**Query text of tuple-lock waiters** (diag2-p20-S200, 163 sample lines):

| waiters | statement (truncated 100 chars) |
| --- | --- |
| 2461 | `select "id","organization_id","title","description","course_id","status","timing_mode", … from "exams" …` (locking read) |
| 32 | `insert into "exam_attempts" (…)` — START-phase FK key-share behind the same row |

Peak concurrent waiters ≈ 77–89 — i.e. essentially the whole in-flight
submit population, not a single background session.

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
(more simultaneous contenders) or shorter (fewer). Any material tail
improvement must change the serialization point's scope or remove work
from its critical section — structural options outside this experiment's
mandate (see 09-decision.md).
