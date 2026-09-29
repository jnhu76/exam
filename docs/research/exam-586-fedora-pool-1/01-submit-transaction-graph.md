# #586 — 01 Submit/grading transaction graph (frozen from live code)

Status: derived from the research head source tree (files cited by path);
nothing in this task shortens or redesigns the transaction. This graph is
what the timing instrumentation (§9) must decompose.

## Canonical call path (candidate submit)

```text
POST /attempts/:attemptId/submit            apps/api/src/routes/attempts.candidate.ts (~L1107-1166)
  authenticate + requireOwnAttempt(AttemptSubmit)   [preHandler, DB reads via auth plugins]
  createCandidateRepo(db).findByUserId(ctx, userId) [pool connection, OUTSIDE tx — read]
  now = fastify.now()
  submitAndGradeAttempt(db, ctx, attemptId, candidateProfileId, now, {request})
      apps/api/src/orchestrators/submitAndGradeAttempt.ts
  createExamRepo(db).findById(ctx, examId)          [pool connection, OUTSIDE tx — read]
  LoadAttemptResponseSchema.parse(...) → reply
```

## The single grading transaction (ADR-008 freeze barrier)

`executeInTransaction(db, fn)` — packages/db/src/types.ts L161-191:

- `db.transaction(...)` acquires ONE pool connection for the whole
  transaction (drizzle-orm/postgres-js → postgres.js reserved connection).
- Isolation: default `"repeatable read"`.
- Retry loop: up to `MAX_RETRIES = 3` retries (4 total attempts) on
  `40001 serialization_failure` / `40P01 deadlock_detected`, exponential
  backoff 20/40/80 ms between attempts. Every retry RE-EXECUTES `fn`,
  re-acquiring the same procedure on a fresh transaction.

Inside `fn(tx)` (all of the below runs while the transaction owns its
PostgreSQL connection):

| # | step | implementation |
| --- | --- | --- |
| 1 | repo construction | `createAttemptRepo/createEnrollmentRepo/createExamRepo(tx)` + `createExamEngineRepos` (sync, no I/O) |
| 2 | EA lock | `lockEnrollmentAndAttempt(enrollments, attempts, attemptId)` — Enrollment `FOR UPDATE` BEFORE Attempt `FOR UPDATE` (canonical seam order) |
| 3 | ownership re-read | `attempts.findById(attemptId)` (inside tx; lock already held) |
| 4 | terminal short-circuit | `status === "graded"` → return (commit) |
| 5 | interruption repos | grading/interruption repo adapters (sync) |
| 6 | deadline reconciliation | `ensureAttemptDeadlineReconciled(...)` (in_progress/disrupted only); if it freezes → return early |
| 7 | submit materialization | `submitAttempt(attempts, gradingWorksetRepo, attemptId, now, {...})` — flips row to `submitted` under the lock; owns grading-workset materialization; includes `exams.findById` for minSubmitAfterStartMinutes |
| 8 | atomic audit write | `recordAtomicHttpAudit(tx, request, ctx, {action:"attempt.submit"})` — same tx (only on fresh submit) |
| 9 | post-submit read | `attempts.findByIdForUpdate(attemptId)` |
| 10 | manual gate | `gradingStatus === "pending_manual"` → return (holds at submitted) |
| 11 | grading snapshot | `readGradingSnapshot(exams, enrollments, attempts, attemptId)` — reads the locked, post-submit answers (freeze barrier) |
| 12 | finalization | `finalizeGrading(enrollments, attempts, gradingWorksetRepo, cap, snapshot.exam, now)` — loads workset, aggregates, terminal transition (sole grading authority) |

After the transaction resolves (connection released back to the pool):

- post-commit response reads OUTSIDE the tx:
  `createAttemptRepo(db).findById(ctx, attemptId)` and
  `createExamRepo(db).findById(ctx, attempt.examId)`.

## What the experiment measures where

- `TX_ACQUIRE_PROXY` (client-side proxy for pool acquisition + transaction
  startup) = `t_tx_callback_enter − t_before_executeInTransaction`. NOT
  labeled as a directly measured postgres.js internal queue duration (§9).
- `TX_HOLD` = `t_tx_callback_exit − t_tx_callback_enter` (first callback
  invocation) — the time the attempt row lock is held, all of steps 1-12.
- Retries (§24): each retry re-invokes the callback; the instrumentation
  counts callback invocations per submit request (`retries = invocations − 1`)
  without changing retry semantics (backoff/limits untouched).
- The measured objective-grading path takes branch: fresh `in_progress` →
  reconciliation (no-op) → submitAttempt → objective snapshot → finalize →
  `graded`. No `pending_manual` (workload is all true_false, §20).

## Timing instrumentation neutrality constraints (from #550 EXAM-550-CORRECTIVE-1)

- postgres.js Query objects are NEVER wrapped/awaited/intercepted: attaching
  then/catch/finally SUBMITS the lazy query and changes scheduling. #586
  instrumentation touches none of `conn.sql`.
- Only `performance.now()` monotonic stamps + bounded per-request state
  (one record per in-flight submit, dropped after emit). No file/network/DB
  writes inside the measured transaction; the single structured
  `EXAM586_TIMING` line is emitted AFTER the transaction fully resolves.
- Instrumentation is inert unless `EXAM_586_TIMING=1` (#586 research mode);
  the pool seam is inert unless `EXAM_586_RESEARCH_POOL_MAX` is set.
