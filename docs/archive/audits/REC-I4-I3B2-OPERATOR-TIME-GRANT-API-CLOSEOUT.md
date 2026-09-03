# REC-I4-I3B2 Operator Time Grant API Closeout

## Status

**IMPLEMENTED.** The Admin operator time-grant product path already existed at
the base revision. This closeout records the source and executable-test
evidence, adds the missing audit-failure rollback coverage, and corrects active
documentation that still described the route and permission as deferred.

## Base HEAD

```text
6018aa97 Merge pull request #239 from jnhu76/docs/p7-system-readiness-roadmap
```

## Reality audit

| Capability | Expected | Current evidence | Status | Action |
| --- | --- | --- | --- | --- |
| Permission | `AttemptTimeGrant` | `packages/authz/src/catalog.ts`; preset tests | implemented | retain |
| Admin preset | allowed | `packages/authz/src/presets.ts`; `adminCompatibility.test.ts` | implemented | retain |
| Scoped route | Attempt scope | `attempts.admin.ts`; route-registry tests | implemented | retain |
| Contract | request/response | `packages/contracts/src/attempt.ts`; OpenAPI | implemented | retain |
| Engine seam | canonical command | `operatorGrant.ts`; engine unit tests | implemented | retain |
| Transaction | ledger + deadline + audit | `operatorGrantExecution.ts`; rollback test | implemented | retain |
| Replay | same canonical payload | engine and route replay tests | implemented | retain |
| Conflict | differing payload | engine, route, and concurrency tests | implemented | retain |
| Cross-Attempt race | PostgreSQL proof | concurrency harness and repeat script | implemented | retain |
| Admin UI | real route call | `ProctorDashboardPage.tsx` and page tests | implemented | retain |
| Refresh/cross-tab | frozen command + lease | pending coordinator and browser tests | implemented | retain |
| E2E | browser proof | `proctor-runtime.spec.ts`, `cross-tab-pending-grant.spec.ts` | implemented | retain |
| Docs | active status | roadmap/status/runbook/API-reference drift found | stale | corrected |

## Current reality

- `Permission.AttemptTimeGrant` is catalogued as `attempt.time.grant` and is
  included in the Admin preset.
- `POST /api/admin/attempts/:attemptId/time-grants` is registered in
  `apps/api/src/routes/attempts.admin.ts`. It uses
  `requireScopedCapability(Permission.AttemptTimeGrant, "attempt", "attemptId")`;
  the route registry declares the same permission, Attempt scope, resolver,
  and `attempt.timeGrant` audit action.
- `TimeGrantRequestSchema` and `TimeGrantResponseSchema` are the public
  contracts. The generated OpenAPI contains the route. The request admits only
  the operation identity, positive seconds, canonicalized reason, and optional
  interruption ID; actor, source, policy, deadlines, and `incidentId` remain
  server-owned.
- `grantAttemptTime()` is the only operator-grant engine command. It requires
  transaction-bound repositories and an EA capability, allows only the frozen
  `operator_incident` policy, reconciles expiry before granting, and never
  revives a terminal Attempt. It rejects an after-deadline above `exam.closeAt`
  instead of clamping it, verifies an optional interruption belongs to the
  Attempt, and requires `incidentId: null` until REC-I6.
- `grantWithOperationRaceRecovery()` is the shared production entry point for
  the route and deterministic PostgreSQL concurrency test. The route does not
  calculate a deadline or insert a ledger row itself.
- The Dashboard calls the real route. Its pending-command coordinator stores a
  frozen operation identity and payload, treats network/5xx as indeterminate,
  reuses that identity on retry, and uses a cross-tab send lease. PostgreSQL
  remains the effect authority; the browser coordinator only coordinates sends.

## Authority chain

```text
ADR-013
  → grantAttemptTime()
  → operatorGrantExecution orchestrator
  → Admin time-grant route
  → Admin Dashboard dialog
```

## Transaction boundary

One `executeInTransaction` callback creates transaction-bound repositories and
performs the following ordered work:

```text
lock Enrollment / Attempt
  → lock Exam
  → operation lookup
  → deadline reconciliation
  → adjustment insert
  → Attempt deadline update
  → atomic compliance audit
  → commit
```

The audit action is `attempt.timeGrant`. It is written only for a committed
`granted` result and its metadata is projected from the committed adjustment:
adjustment ID, operation ID, added seconds, reason code, and optional
interruption ID. Reason text is intentionally excluded by the audit policy.
An `idempotent_replay` or `terminal` result does not create a grant audit.

The route test now injects a PostgreSQL failure only for the time-grant audit
insert and asserts that the already-attempted deadline update and ledger insert
are both rolled back. PostgreSQL executes a trigger in the transaction of the
statement it fires, and an error rolls back its effects; this makes the trigger
a faithful negative test of the production atomic boundary.

## Idempotency and cross-Attempt race handling

```text
same operationId + same canonical payload
  → idempotent_replay

same operationId + different payload
  → IDEMPOTENCY_CONFLICT
```

`operationId` is command identity, not a generic dedupe field. Canonical
payload comparison includes the Attempt, seconds, reasons, actor,
interruption, source/policy shape, and the current REC-I6 invariant that
`incidentId` is null.

For the only non-serialized race—two different Attempts in the same
organization using one operation ID—the unique
`(organization_id, operation_id)` constraint selects the winner. The loser
rolls back, only an exact `23505` for that named constraint is recognized, and
the same input is run once in a fresh transaction. That fresh read returns the
winner as a replay when the payload is the same, or returns the domain
`IDEMPOTENCY_CONFLICT` when the Attempt or payload differs. Other `23505`
errors are not swallowed, and the loser Attempt deadline remains unchanged.

## Actor boundary

| Actor | Result |
| --- | --- |
| Admin | Active: has `AttemptTimeGrant` and may use the Attempt-scoped route |
| Proctor | Denied: preset does not hold `AttemptTimeGrant`; this Job does not activate it |
| Teacher | Denied: preset does not hold `AttemptTimeGrant` |
| Grader | Denied: preset does not hold `AttemptTimeGrant` |
| Candidate | Denied: preset does not hold `AttemptTimeGrant` |

Cross-organization Attempt resolution fails closed. This is server-side
authorization, not a Dashboard visibility rule.

## Test evidence

Source and test coverage includes:

- engine input/policy/terminal/replay/conflict/interruption/overflow/affinity
  coverage in `packages/exam-engine/src/operatorGrant.test.ts`;
- Admin happy path, validation, strict-policy rejection, terminal, close cap,
  cross-organization, replay/conflict, audit projection, and scoped-route
  coverage in `apps/api/src/routes/attempts/admin-time-grants.test.ts`;
- transaction-negative evidence for ledger insert, deadline update, and now
  atomic audit-insert failure rollback in that route suite;
- deterministic real-PostgreSQL same-operation race evidence in
  `admin-time-grants.concurrency.test.ts`, shared through the production
  orchestrator, plus `scripts/test/run-operator-grant-race-repeat.mjs`;
- permission/preset and route-registry conformance tests;
- Dashboard and pending-command coordinator tests for indeterminate retry,
  confirmed rejection/conflict disposal, stale response safety, reload, and
  cross-tab lease behavior;
- browser proofs in `proctor-runtime.spec.ts` and
  `cross-tab-pending-grant.spec.ts` for real route use, replay, one sender, and
  one deadline effect.

Focused commands executed in this closeout environment:

```text
PASS  pnpm --filter @exam/exam-engine test -- operatorGrant.test.ts
      26 files, 486 tests
PASS  pnpm --filter @exam/authz test -- presets-boundaries.test.ts adminCompatibility.test.ts
      9 files, 63 tests
PASS  pnpm --filter @exam/api exec vitest run src/routes/attempts/admin-time-grants.test.ts --reporter=verbose
      1 file, 14 tests
PASS  pnpm test:operator-grant-race
      1 file, 1 deterministic real-PostgreSQL race test
PASS  E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh proctor-runtime cross-tab-pending-grant
      Playwright passed; no failed tests
PASS  TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm coverage
      16 Turbo tasks successful
PASS  pnpm typecheck
PASS  pnpm verify:static
```

The verification used the documented database split: route/race/coverage used
`exam_test` worker schemas, while the managed E2E runner migrated and seeded
only `exam_e2e`. `exam` remained without the `exams` table and was not seeded
or repointed.

## Active documentation corrected

- `docs/roadmap/current.md`
- `docs/status/implementation-status.md`
- `docs/archive/roadmap/P7-system-readiness-and-exam-modes.md`
- `docs/architecture/exam-system/state-and-authority.md`
- `docs/architecture/exam-system/candidate-recovery.md`
- `docs/architecture/exam-system/protocol-catalog.md`
- `docs/contracts/api-reference.md`
- `docs/deployment/mvp-deployment-runbook.md`
- `docs/archive/roadmap/recovery-operations-jobs.md` (J1 marked CLOSED)

`docs/roadmap/phase-roadmap.md` and `docs/archive/roadmap/phase3-open-items.md` were
reviewed; neither made the superseded I3B2 route/permission deferral claim.

## Remaining non-goals

- `incidentId` integration → REC-I6
- Proctor resource scope → M11
- Admin/Proctor Recovery Center → REC-OPS
- Redis → P7-D1 after Recovery Authority Gate

This closeout does not alter ADR-013 engine policy semantics, the Attempt or
Exam state machines, incident persistence, Proctor authority, or Redis usage.
