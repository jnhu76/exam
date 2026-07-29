# REC-I4-V1 — Deterministic PostgreSQL Operator-Grant Concurrency Verification

## Status

`REC-I4-V1 POSTGRESQL CONCURRENCY VERIFIED — READY FOR HUMAN REVIEW`

The deterministic test calls the **same production recovery function** the HTTP
route calls (`grantWithOperationRaceRecovery`), not a re-implementation. DB/domain
evidence (distinct txid, real SQLSTATE, causal ordering) is proven here; HTTP
error-mapping evidence (200/409 + `IDEMPOTENCY_CONFLICT` + audit atomicity) is
proven by the existing `Promise.all` test in `admin-time-grants.test.ts`.

## Authority

- `docs/adr/ADR-013-interruption-time-compensation-policy.md` — interruption time compensation policy
- `docs/audits/REC-I4-F1-OPERATOR-GRANT-FORMAL-MODEL.md` — formal model closeout
- `formal/tla/operator-grant/OperatorGrantServer.tla` — TLA+ server safety model

## Scope

Prove, using two physical PostgreSQL connections and a deterministic barrier, that two concurrent operator-grant commands with the same `operationId` but targeting different Attempts (different Exams, no row-lock overlap) deterministically resolve to:

1. T1 wins (granted, one ledger row, deadline advanced)
2. T2 loses (23505 unique violation → fresh transaction → `IdempotencyConflictError`)

## Shared production execution module

The grant transaction + recovery wrapper live in ONE module that both the route
and the test import. There is no second copy.

- `apps/api/src/orchestrators/operatorGrantExecution.ts` — the authority for:
  - `OPERATION_UNIQUE_CONSTRAINT` (exported const)
  - `matchOrgOperationUniqueViolation(err)` — returns `{ code, constraint, table?, schema? }`
    extracted from the **real caught PostgreSQL error** (not a boolean, not
    re-hard-coded)
  - `grantWithOperationRaceRecovery(db, ctx, input, { audit?, observer?, label? })` —
    the single entry point
- `apps/api/src/routes/attempts.admin.ts` — the HTTP route calls
  `grantWithOperationRaceRecovery(fastify.db, ctx, input, { audit: { request } })`
- `apps/api/src/routes/attempts/admin-time-grants.concurrency.test.ts` — the
  deterministic test calls
  `grantWithOperationRaceRecovery(db, ctx, input, { observer, label })` with a
  barrier-backed observer

If the production recovery logic changes, the test exercises the change
automatically — the two can no longer drift silently.

## Evidence split

This audit distinguishes two layers of evidence, each owned by one test:

### Deterministic DB/domain evidence — `admin-time-grants.concurrency.test.ts`

Calls the production `grantWithOperationRaceRecovery` directly (no HTTP layer).
Proves:

- Both transactions read absent on distinct backend PIDs, captured **inside**
  the transaction callback (`pg_backend_pid()` + `txid_current()`).
- T1's primary transaction commits with a distinct txid; T2's primary
  transaction violates with a distinct txid; the two txids differ.
- T2's `onUniqueViolation` observation carries the SQLSTATE/constraint
  extracted from the **real caught error** by the production matcher — the test
  asserts `code === "23505"` and
  `constraint === "attempt_time_adjustments_org_operation_unique"`, not its own
  constants.
- T2's recovery is a FRESH transaction whose txid differs from T2's primary
  txid (proving the original rolled back before recovery began).
- Causal ordering: T1's `onPrimaryCommitted` fires before T2's violation —
  the determinism comes from the code committing T1 before T2's insert fails,
  observed via the observer, not merely enforced by the barrier.
- Final DB invariants: exactly one ledger row on the winner's attempt; the
  loser's deadline unchanged; no ledger row for the loser.
- Both connections share the same isolated schema
  (`current_schema()` + `current_setting('search_path')` asserted equal).

### HTTP error-mapping evidence — `admin-time-grants.test.ts`

The existing `Promise.all` race test (`cross-Attempt operationId race`,
~line 730) exercises the real HTTP route + the real Fastify `setErrorHandler`.
Proves:

- Exactly one response is `200 { outcome: "granted" }` and the other is
  `409 { error.code: "IDEMPOTENCY_CONFLICT" }` (NOT a generic
  `RESOURCE_CONFLICT`).
- Exactly one ledger row; the loser wrote none.
- **Audit atomicity**: the winner has exactly one `attempt.timeGrant` audit row
  whose `metadata.adjustmentId` equals the winner's ledger id; the loser has
  zero audit rows (its transaction rolled back on the 23505, and the recovery
  rerun threw `IdempotencyConflictError` before granting).

The deterministic test does NOT exercise the Fastify `setErrorHandler` → 409
mapping or the HTTP audit recording (it has no `FastifyRequest`); those are
covered by the `Promise.all` test above.

## Files inspected

- `packages/exam-engine/src/operatorGrant.ts` — the `grantAttemptTime` command function
- `packages/exam-engine/src/operatorGrant.test.ts` — unit tests (mocked repos)
- `packages/exam-engine/src/lockSeam.ts` — `lockEnrollmentAndAttempt`, `assertCapabilityFor`
- `packages/exam-engine/src/interruptionRepositories.ts` — engine-facing repo interfaces
- `packages/db/src/postgres.ts` — `createPostgresDatabase`, `migratePostgres`
- `packages/db/src/database.ts` — `createDatabase`
- `packages/db/src/types.ts` — `Database`, `TransactionDatabase`, `executeInTransaction`, `TenantContext`
- `packages/db/src/testDb.ts` — `getTestDb`, `getIsolatedTestDb`
- `packages/db/src/testIsolation.ts` — `setupIsolatedTestDb`, schema management
- `packages/db/src/repository/attemptTimeAdjustmentRepo.ts` — `findByOperationId`, `insert`
- `packages/db/src/schema/pg.ts` — schema definition, constraint names
- `apps/api/src/orchestrators/operatorGrantExecution.ts` — the shared production module (authority)
- `apps/api/src/routes/attempts.admin.ts` — the HTTP route, which imports the shared module
- `apps/api/src/routes/attempts/admin-time-grants.test.ts` — HTTP integration tests + the `Promise.all` race test
- `apps/api/src/routes/testHelpers.ts` — `buildTestApp`, test infrastructure
- `apps/api/src/adapters/repoAdapters.ts` — repo adapters binding ctx to DB repos
- `apps/api/src/audit/auditWriter.ts` — `recordAtomicHttpAudit` (3-field request surface)

### Constraint name verification

The unique index constraint is verified by multiple sources:

**Schema definition** (`packages/db/src/schema/pg.ts`):
```typescript
uniqueIndex("attempt_time_adjustments_org_operation_unique").on(
  table.organizationId,
  table.operationId,
),
```

**Shared production module** (`apps/api/src/orchestrators/operatorGrantExecution.ts`):
```typescript
export const OPERATION_UNIQUE_CONSTRAINT =
  "attempt_time_adjustments_org_operation_unique";
```

**Migration** (`packages/db/migrations/postgres/0021_noisy_archangel.sql`):
```sql
CREATE UNIQUE INDEX "attempt_time_adjustments_org_operation_unique"
```

## Database driver/version

- **Driver**: `postgres` (postgres.js) ^3.4.9
- **Drizzle ORM**: via `drizzle-orm/postgres-js`
- **PostgreSQL**: 18.4 (via Docker container `exam-db-1`)

## Connection strategy

Two separate PostgreSQL connections are created via `createPostgresDatabase` using the same `databaseUrl` and `schemaName`:

```typescript
const conn1 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
const conn2 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
```

Each connection has `max: 1` (set by `createPostgresDatabase` when `searchPath` is provided), ensuring they are distinct physical backends. Both connections share the same search_path (the isolated test schema). The test additionally asserts `current_schema()` and `current_setting('search_path')` match across both connections.

## Isolation strategy

An isolated PostgreSQL schema is created via `setupIsolatedTestDb({ namespace: "api" })`. The test app is built with this schema, and both connections use the same schema. The schema is dropped during cleanup.

## Barrier design

A `RaceBarrier` with typed `Deferred<T>` promises coordinates the two transactions. The barrier is injected via a barrier-backed `OperatorGrantExecutionObserver` (`createBarrierBackedObserver`); the production `grantWithOperationRaceRecovery` calls the observer's hooks inside its transaction callbacks. The barrier does NOT wrap or duplicate the production logic.

| Deferred | Signal | Consumer |
|----------|--------|----------|
| `t1ReadAbsent` | T1's `findByOperationId` returned null (in-txn PID+txid) | Controller |
| `t2ReadAbsent` | T2's `findByOperationId` returned null (in-txn PID+txid) | Controller |
| `releaseT1` | Controller releases T1 past the read-absent gate | T1 observer |
| `t1PrimaryCommitted` | T1's primary transaction committed (in-txn PID+txid) | Controller |
| `releaseT2` | Controller releases T2 past the read-absent gate | T2 observer |
| `t2UniqueViolation` | T2's insert hit 23505 (real SQLSTATE/constraint from caught error) | Controller |
| `t2RecoveryStarted` | T2's fresh recovery transaction began (in-txn PID+txid) | Controller |
| `t2RecoveryRejectedWithConflict` | T2's recovery threw `IdempotencyConflictError` | Controller |

Each deferred has a 10-second timeout. `RaceBarrier.dispose()` settles every
outstanding deferred and clears every timer, so a deferred that is never
awaited (e.g. when recovery throws instead of succeeding) cannot time out 10s
later and pollute the vitest worker.

## Exact constraint name

```text
attempt_time_adjustments_org_operation_unique
```

Verified by the production `matchOrgOperationUniqueViolation`, which walks the
error cause chain and matches `code === "23505"` and
`constraint === "attempt_time_adjustments_org_operation_unique"`, returning the
real fields from the caught error. The deterministic test asserts these real
runtime values (not its own constants).

## Transaction trace

From a single deterministic run. PID may be reused across sequential
transactions on one pooled connection; the txid is the authoritative
transaction-identity proof (captured via `txid_current()` inside each
transaction callback).

| Phase | PID | txid | Event |
|-------|-----|------|-------|
| T1 primary | distinct | T1-primary | Transaction begins |
| T2 primary | distinct | T2-primary | Transaction begins |
| T1 read absent | T1-pid | T1-primary | `findByOperationId(OP_SHARED)` → null |
| T2 read absent | T2-pid | T2-primary | `findByOperationId(OP_SHARED)` → null |
| T1 commit | T1-pid | T1-primary | ledger insert + deadline update → `granted` |
| T2 violation | T2-pid | T2-primary | `INSERT` → SQLSTATE 23505 (real constraint) |
| T2 rollback | T2-pid | T2-primary | Original transaction rolled back |
| T2 recovery | T2-pid | **T2-recovery (≠ T2-primary)** | Fresh transaction begins |
| T2 recovery read | T2-pid | T2-recovery | `findByOperationId(OP_SHARED)` → T1's row |
| T2 recovery result | T2-pid | T2-recovery | `IdempotencyConflictError` |

## Final database invariants

```sql
SELECT count(*) FROM attempt_time_adjustments
WHERE organization_id = '<org>' AND operation_id = '<OP_SHARED>';
-- count = 1
-- attempt_id = A1
-- source = 'operator'
-- added_seconds = 300
```

```sql
SELECT deadline_at FROM exam_attempts WHERE id = 'A1';
-- deadline_at = before_deadline + 300 seconds
```

```sql
SELECT deadline_at FROM exam_attempts WHERE id = 'A2';
-- deadline_at = before_deadline (unchanged)
```

**No second ledger row for A2. No duplicate adjustments.**

## Test names

- `apps/api/src/routes/attempts/admin-time-grants.concurrency.test.ts`:
  - `REC-I4-V1: deterministic operationId race recovery > deterministically fixes T1 as winner, recovers T2 as IDEMPOTENCY_CONFLICT, on the production recovery path`
- `apps/api/src/routes/attempts/admin-time-grants.test.ts` (HTTP evidence):
  - `cross-Attempt operationId race (different exams) > the loser returns 409 IDEMPOTENCY_CONFLICT and writes exactly one ledger row`

## 20-run repeat result

Executed via `node scripts/test/run-operator-grant-race-repeat.mjs`:

```
[REC-I4-V1] Running 20 deterministic iterations...

  ✓ Iteration 1/20
  ...
  ✓ Iteration 20/20

[REC-I4-V1] Results: 20/20 passed, 0/20 failed
```

The runner detects success by the vitest exit code only (`status === 0`); it no
longer scrapes stdout for literal "Tests"/"passed" tokens, which were fragile
against reporter changes.

All 20 iterations deterministically fixed T1 as winner and T2 as loser. Every iteration produced distinct PIDs, distinct primary/recovery txids, a single ledger row, and correct deadline changes.

## TLA+ mapping

| TLA+ action | Runtime event | V1 observation |
|---|---|---|
| `BeginCommand(T1)` | T1 primary transaction starts | T1-primary txid |
| `BeginCommand(T2)` | T2 primary transaction starts | T2-primary txid |
| `ReadOperationAbsent(T1)` | T1 lookup returns none | barrier.t1ReadAbsent (in-txn PID+txid) |
| `ReadOperationAbsent(T2)` | T2 lookup returns none | barrier.t2ReadAbsent (in-txn PID+txid) |
| `CommitWinner(T1)` | ledger insert + deadline update commit | barrier.t1PrimaryCommitted (before T2 violation) |
| `ObserveUniqueViolation(T2)` | SQLSTATE 23505 | real `code`/`constraint` from caught error |
| `BeginFreshRecovery(T2)` | new transaction begins | T2-recovery txid ≠ T2-primary txid |
| `ReadCommittedWinner(T2)` | reads T1 committed ledger | `findByOperationId` returns T1's row |
| `ReturnIdempotencyConflict(T2)` | domain error | `IdempotencyConflictError` (HTTP 409 proven in the `Promise.all` test) |

This test realizes one deterministic implementation trace corresponding to the model actions. It does not prove that all runtime executions refine the TLA+ model.

## Residual assumptions

- The deterministic test calls the production `grantWithOperationRaceRecovery` directly (not through the HTTP route), so it bypasses authz, rate limiting, and the request-scoped resolver. The concurrency behavior under test (the 23505 unique violation and recovery) is identical regardless of the transport layer, and the production module is the same code the route calls.
- The deterministic test uses `executeInTransaction` which defaults to `repeatable read` isolation. The production route uses the same default.
- The deterministic test passes no `audit` option, so it does not record the HTTP compliance audit; audit atomicity is proven by the `Promise.all` HTTP test instead.

## Non-goals

- This is not a formal refinement proof. One deterministic trace is proven, not all possible schedules.
- The deterministic test does NOT exercise the Fastify `setErrorHandler` → HTTP 409 mapping or the HTTP audit recording; those are covered by the existing `Promise.all` race test in `admin-time-grants.test.ts`.
- The same-attempt idempotent-replay recovery branch (`idempotent_replay` outcome, distinct from the `IdempotencyConflictError` branch tested here) is not covered by the deterministic test. It is exercised by the idempotent-replay integration test in `admin-time-grants.test.ts`.
- Cross-tab client coordination (REC-I4-C1) is not covered.
- Cross-browser-profile / device coordination is not covered.

## Production code changes

This PR touches production code (the extraction is the whole point — the test
must exercise the production path, not a copy):

- **NEW** `apps/api/src/orchestrators/operatorGrantExecution.ts` — the shared
  production module (grant transaction + recovery wrapper + constraint matcher
  + observer seam). Route and test both import it.
- `apps/api/src/routes/attempts.admin.ts` — the four local definitions
  (`OPERATION_UNIQUE_CONSTRAINT`, `isOrgOperationUniqueViolation`,
  `runGrantTransaction`, `grantWithOperationRaceRecovery`) are removed; the
  route imports `grantWithOperationRaceRecovery` from the new module and calls
  it as `grantWithOperationRaceRecovery(fastify.db, ctx, input, { audit: { request } })`.
  Route behavior is unchanged (verified by the existing 13 tests in
  `admin-time-grants.test.ts`).

Test-only files:

- `apps/api/src/testing/barrier.ts` — barrier types + `dispose()`
- `apps/api/src/testing/operatorGrantConcurrencyHarness.ts` — reduced to
  barrier + observer factory (no duplicate grant/recovery logic)
- `apps/api/src/routes/attempts/admin-time-grants.concurrency.test.ts` — the
  rewritten deterministic test (calls the production module)
- `apps/api/src/routes/attempts/admin-time-grants.test.ts` — added
  winner=1/loser=0 audit-row assertions to the existing `Promise.all` race test
- `scripts/test/run-operator-grant-race-repeat.mjs` — repeat runner
- `package.json` — `test:operator-grant-race` and `test:operator-grant-race:repeat` scripts

## New findings

- The existing `Promise.all`-based cross-Attempt race test in `admin-time-grants.test.ts` covers the same scenario at the HTTP layer (including the 200/409 mapping and audit atomicity); the new deterministic test adds the in-transaction DB/domain evidence and proves the production recovery path directly.
- PostgreSQL 18.4 correctly raises 23505 with `constraint = "attempt_time_adjustments_org_operation_unique"` when the unique index is violated.
- The shared `grantWithOperationRaceRecovery` in `operatorGrantExecution.ts` correctly catches the 23505, starts a fresh transaction (distinct txid), and re-runs the command — proven by the deterministic test calling that exact function.

## Known limitations

- The deterministic test proves ordering for one specific schedule (T1 before T2). It does not prove that the reverse ordering (T2 before T1) would also produce a correct result, but the code is symmetric: the first transaction to commit wins, regardless of label.
- The `txid_current()` capture inside the transaction callback proves transaction identity; PID-distinctness is necessary but not sufficient (a pooled connection can serve many sequential transactions under one PID). The test asserts both PID-distinctness (for the two connections) and txid-distinctness (for primary vs recovery on the same connection).
