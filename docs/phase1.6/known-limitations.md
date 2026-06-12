# Phase1.6 Known Limitations (Working Doc)

> **Status**: Working / Temporary
> **Lifecycle**: Updated as each S03a-* Job lands. Reviewed at Phase1.6 exit.
> **At Phase1.6 close**: Each entry is either (a) resolved and removed, (b) promoted to a tracked issue, or (c) absorbed into Phase2 backlog.

This file records limitations / edge cases / deferred work surfaced by Phase1.6 Jobs but **outside the Job's accepted scope**. The intent is to keep the Job's commits focused while not losing the observation.

---

## S03a-1 — Submit Deadline E2E + Server Time Injection

Commit: `7cbacf5`

### L1.1 Implicit ordering coupling between submit tests
- **Where**: `apps/api/src/routes/attempts.test.ts` describe `POST /attempts/:attemptId/submit`
- **Symptom**: `rejects double submit` only asserts `409` because the preceding `submits in_progress attempt` test already submitted the same `attemptId` (shared via `beforeAll`). Running `rejects double submit` in isolation (`-t "rejects double submit"`) returns `200`, not `409`.
- **Why deferred**: Test ordering refactor is not within S03a-1 scope (deadline behavior + time injection). Touching it would expand the diff and risk coupling other unrelated assertions.
- **Owner / next**: Candidate cleanup task — fold into Phase1.6 exit pass or a dedicated test-isolation Job. Not blocking.

### L1.2 `api-smoke.test.ts` 5s timeout flakiness under `pnpm verify`
- **Where**: `apps/api/src/routes/smoke-tests/api-smoke.test.ts:5`
- **Symptom**: Under `pnpm verify` (all turbo tasks parallel, web + api tests racing on CPU/IO + shared `exam_test` PG), the very first `buildTestApp()` occasionally exceeds the implicit 5000ms vitest test timeout. Standalone run is consistently <600ms.
- **Verified pre-existing**: Reproduced on `master` (`dec707c`) without S03a-1 changes — not introduced by `nowPlugin`.
- **Why deferred**: Smoke timeout / migrate latency stabilization belongs to S03a-4 (PG concurrency test suite must establish stable test-DB lifecycle anyway). S03a-1 already validated `pnpm verify` runs green on retry.
- **Owner / next**: S03a-4 — when designing concurrency suite, decide whether to (a) bump smoke timeout to 15s, (b) move smoke off the shared `exam_test` DB, or (c) gate `verify` task topology so api tests don't race web tests for CPU during migrate.

### L1.3 `now` semantics for grading vs. submission
- **Where**: `apps/api/src/routes/attempts.ts:746` (submit) and `:760` (grade)
- **Decision taken**: Both currently call `fastify.now()` independently — two `Date` instances milliseconds apart. SPEC §3 (server is time authority) does not require single-`now` semantics for the submit→grade pair, but a future reader may wonder why.
- **Why deferred**: No observable behavior difference; introducing a single shared `now` variable would be a stylistic refactor, not correctness.
- **Owner / next**: Optional cleanup. Not tracked as a Job.

---

## S03a-2 — Submit Route Row-level Lock Alignment

_Not yet started. Limitations to be filled when Job lands._

### L2.x (placeholder)

---

## S03a-3 — Save Route Deadline E2E

_Not yet started. Limitations to be filled when Job lands._

### L3.x (placeholder)

---

## S03a-4 — PG Concurrency Test Suite

_Not yet started. Limitations to be filled when Job lands._

### L4.x (placeholder)

---

## S03a-5 — Phase1.3 P0 Regression

_Not yet started. Limitations to be filled when Job lands._

### L5.x (placeholder)

---

## Disposition Legend

When closing Phase1.6, mark each item with one of:

- `[resolved-here]` — fixed in a follow-up commit on this branch
- `[issue:#N]` — promoted to a tracked GitHub issue
- `[phase2]` — deferred to Phase2 backlog
- `[wontfix:reason]` — accepted as permanent trade-off
