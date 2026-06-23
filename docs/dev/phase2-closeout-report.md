# Phase 2 Closeout Report

> Phase H — final report for the Phase 2 收口 task. This task was
> documentation/infra realignment, NOT Phase 3 feature development. All
> conclusions are evidence-based (file/line, test runs, timings). Each phase
> produced its own document, linked below.

## Summary

Phase 2 收口 reviewed and aligned the platform across all layers
(frontend, API contract, backend, PostgreSQL, state machines, tests, security,
observability), introduced the Redis baseline as optional infrastructure per
ADR-001, produced an evidence-based isolation audit explaining the ~330s test
time, audited the API contract for stability, recorded document drift, and
defined a minimum observability contract.

Two MUST FIX issues were found — both **introduced by the in-progress Redis
baseline work** and both fixed in this task (commit `ecccf1f`): an ADR-006
time-authority guardrail violation (`Date.now()` in `system.ts`) and a test
portability bug (`redis.test.ts` failing/10s-retry-storming when Redis was
absent). No business-logic MUST FIX was found. The full test suite passes.

## What was done

1. **Phase A** — recorded the baseline: command inventory, measured timings,
   and the 4 test failures introduced by the in-progress Redis work.
2. **Phase B** — exhaustive scope inventory (78 endpoints, 13 tables, 3 state
   machines, ~30 pages) confirming end-to-end alignment.
3. **Phase C** — hardened the Redis baseline (fixed the 2 MUST FIX issues),
   verified it, and committed the infra.
4. **Phase D** — isolation audit mapping every shared test resource to its
   strategy/risk, explaining the ~330s as I/O contention (not state leak).
5. **Phase E** — contract/error-code/response/tenant/time/idempotency audit.
6. **Phase F** — document drift audit + one misleading-doc fix (ADR-001).
7. **Phase G** — minimum observability contract on existing infra.

## Commits / files changed

```
922c951 docs(phase2-closeout): doc-drift audit + observability contract (Phase F+G)
c37bb34 docs(phase2-closeout): contract + error-code + API audit (Phase E)
367a43c docs(phase2-closeout): isolation audit after redis baseline (Phase D)
9aa74b1 docs(phase2-closeout): phase2 scope inventory (Phase B)
ecccf1f feat(redis): add redis baseline + test namespace helpers (Phase C)
577278b docs(phase2-closeout): record phase2 baseline (Phase A)
```

21 files changed, +1781 / −6 (vs `bdb85d1`). New code: `plugins/redis.ts`,
`routes/testRedis.ts`, `routes/redis.test.ts` + config/compose wiring.
New docs: 7 under `docs/dev/`. No production business-logic file changed except
`routes/system.ts` (Redis latency now uses `fastify.now()`).

## Verification results

| Command | Result | Duration | Notes |
|---|---:|---:|---|
| `pnpm verify:static` | PASS | <1s (cached) | format/lint/copy/arch/typecheck |
| `pnpm test:db` | PASS | ~7s | 163 tests, parallel |
| `pnpm test:api` (REDIS_URL set) | PASS | 113.8s | **63 files / 651 pass / 0 fail / 0 skip** |
| `pnpm test:api` (REDIS_URL unset) | PASS | ~112s | 646 pass / 5 skip / 0 fail |
| `redis.test.ts` (REDIS_URL set) | PASS | 0.5s | 7/7 |
| `redis.test.ts` (REDIS_URL unset) | PASS | 0.4s | 2 pass / 5 skip (no 10s storm) |
| `time-authority.structural.test.ts` | PASS | 0.2s | ADR-006 guardrail green |

Baseline before 收口: `test:api` had **4 failures** (time-authority guardrail +
redis.test retry storm). After Phase C: **0 failures**.

## Phase 2 implemented scope

See `docs/dev/phase2-scope.md`. In short: single-tenant, multi-user exam
platform with Admin + Candidate roles; full exam lifecycle
(draft→published→open→closed→archived/canceled) with lazy reconciliation;
attempt state machine (in_progress→submitted→grading→graded, disrupted/restore,
voided); answer save protocol (versioned, idempotent); server-authoritative
timer (`fastify.now()`, ADR-006); proctor force-submit/misconduct/extend-time;
manual grading queue + finalize; scores + CSV export; diagnostics; audit +
import logs; configurable candidate identity; branding settings.

## Redis baseline status

See `docs/dev/redis-baseline.md`. Redis 7-alpine is now optional infra
(ADR-001 baseline): disabled by default (`REDIS_URL` unset → `fastify.redis`
is null); prefix-scoped test isolation (SCAN cleanup, never FLUSHALL);
diagnostics report `redisStatus`. PostgreSQL remains canonical for
exam/attempt/enrollment. No Redis runtime consumer (rate-limit/presence/queue)
exists yet — those need a measured trigger (ADR-001).

## Isolation audit result

See `docs/dev/adr-isolation-audit.md`. The ~330s `pnpm verify` is structural:
state-leak is **FIXED** (per-file/per-worker PG isolation); I/O contention is
**NOT FIXED**, mitigated by `fileParallelism:false` + the `verify:db-tests`
serial chain (BUG-FLAKE-001). Redis baseline adds key-prefix isolation only;
no Redis conflict exists (no consumers). Parallelism restoration is gated on
template-DB / migrate-semaphore work + stress evidence, NOT a flag flip.

## Contract audit result

See `docs/dev/phase2-contract-audit.md`. Contract is stable: canonical error
envelope with `requestId`; 31 AppError subclasses + 40-code registry; legacy
code normalization; frontend reads `error.code` (not text); tenant boundary
via `ctx.organizationId` on every repo method; `fastify.now()` business time
authority (guardrail green); submit/force-submit/restore/exam-lifecycle/
saveAnswer idempotent. SHOULD FIX: `course.ts` ad-hoc error bodies.

## Document drift result

See `docs/dev/phase2-doc-drift.md`. Applied the one misleading fix (ADR-001
Decision now points to the baseline). Remaining: ADR-007 number collision
(3 files), phase-roadmap Phase 2 timing-mode/queue scope wording — isolated
doc edits deferred to a follow-up.

## Observability contract

See `docs/dev/observability-contract.md`. Minimum contract on existing infra
(pino, `audit_logs`, `/system/diagnostics`, `requestId`): request trace,
state-transition, audit, background-job, and test-diagnostic field sets;
redaction policy (creds/tokens/cookies/auth/standardAnswer already enforced).
No OTel/metrics stack (Phase 3+).

## MUST FIX fixed in this task

1. **`apps/api/src/routes/system.ts`** used `Date.now()` for Redis latency,
   violating ADR-006's structural guardrail (which broke
   `time-authority.structural.test.ts`). Fixed to `fastify.now()`.
2. **`apps/api/src/routes/redis.test.ts`** failed with a ~10s connection-retry
   storm whenever Redis was unset/unreachable, and used `skip` inside
   `beforeAll` (which has no test-context access). Rewritten to SKIP
   connection tests when Redis is absent via a one-shot 500ms reachability
   probe decided in `beforeAll`.

Both were introduced by the in-progress Redis baseline; both resolved in
`ecccf1f`. No business-logic MUST FIX was found in any phase.

## Remaining SHOULD FIX

- `course.ts` error envelope: use `buildErrorResponse`/`AppError` instead of
  ad-hoc `{error:{code,message}}` (legacy codes, no `requestId`). (Phase E)
- Add indexes on `questions`, `audit_logs`, `exams` for org-scoped list/filter
  performance (correctness unaffected). (Phase B/D)
- K-1: `user.test.ts` sub-set pagination residue (truncate-on-setup or relax
  assertion). (Phase D)
- ADR-007 number collision; phase-roadmap Phase 2 timing-mode/queue wording.
  (Phase F)
- Standardize `metadata.stateBefore/stateAfter/source` in transition audit rows
  and actorId/role/orgId in business log statements. (Phase G)

## Deferred to Phase 3 design

- Teacher / Proctor / Grader role bundles (current proctor UI is Admin-role).
- Consolidating the two audit-recording paths.
- WebSocket/SSE, job queue, desktop Electron (ADRs 002/003/004).
- Pass-to-proceed external API, SuperAdmin, multi-tenant runtime (Phase 4).
- OTel distributed tracing / centralized metrics.

## Explicitly not changed

- **No Phase 3 feature development.** Teacher/Proctor/Grader roles, multi-tenant,
  pass-to-proceed, Electron, WebSocket/SSE, AI grading, PDF export — none added.
- **No canonical state moved from PostgreSQL to Redis.** Redis holds optional
  coordination infra only.
- **No Redis lock replacing PostgreSQL row locks.** The 3 `FOR UPDATE` sites
  (examRepo, enrollmentRepo, attemptRepo) are unchanged.
- **No business state machine rewrite.** exam/attempt/enrollment machines and
  reconciliation are untouched.
- **No `fileParallelism` restoration.** Serial api tests remain; only an
  evidence-based template-DB/migrate-semiconductor fix + stress data would
  justify parallelism.
- **No API path/method/schema/error-code change** (except fixing the
  `course.ts` divergence is a SHOULD FIX, not done in 收口; `system.ts` latency
  is internal, no contract change).

## Recommended next tasks

1. Fix the remaining SHOULD FIX items (course.ts envelope is the highest-value,
   smallest, most isolated).
2. **Plan safe parallelism restoration** based on the isolation audit: pursue
   template-DB cloning and/or a migration semaphore to remove the I/O
   contention root cause, then gather stress evidence at the target
   `API_TEST_MAX_WORKERS` before flipping `fileParallelism`.
3. Phase 3 product design (role bundles, consolidated audit, observability
   gaps), then development split by frontend / API / backend / PG / state
   machine — using this 收口's inventories as the alignment baseline.
