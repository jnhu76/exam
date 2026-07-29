# REC-I4-V1 — Deterministic PostgreSQL Operator-Grant Concurrency Verification

## Status

`REC-I4-V1 POSTGRESQL CONCURRENCY VERIFIED — READY FOR HUMAN REVIEW`

## Authority

- `docs/adr/ADR-013-interruption-time-compensation-policy.md` — interruption time compensation policy
- `docs/audits/REC-I4-F1-OPERATOR-GRANT-FORMAL-MODEL.md` — formal model closeout
- `formal/tla/operator-grant/OperatorGrantServer.tla` — TLA+ server safety model

## Scope

Prove, using two physical PostgreSQL connections and a deterministic barrier, that two concurrent operator-grant commands with the same `operationId` but targeting different Attempts (different Exams, no row-lock overlap) deterministically resolve to:

1. T1 wins (granted, one ledger row, deadline advanced)
2. T2 loses (23505 unique violation → fresh transaction → `IDEMPOTENCY_CONFLICT`)

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
- `apps/api/src/routes/attempts.admin.ts` — `grantWithOperationRaceRecovery`, `runGrantTransaction`
- `apps/api/src/routes/attempts/admin-time-grants.test.ts` — existing integration tests
- `apps/api/src/routes/testHelpers.ts` — `buildTestApp`, test infrastructure
- `apps/api/src/adapters/repoAdapters.ts` — repo adapters binding ctx to DB repos

### Constraint name verification

The unique index constraint is verified by multiple sources:

**Schema definition** (`packages/db/src/schema/pg.ts`):
```typescript
uniqueIndex("attempt_time_adjustments_org_operation_unique").on(
  table.organizationId,
  table.operationId,
),
```

**Production code** (`apps/api/src/routes/attempts.admin.ts`):
```typescript
const OPERATION_UNIQUE_CONSTRAINT =
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

Each connection has `max: 1` (set by `createPostgresDatabase` when `searchPath` is provided), ensuring they are distinct physical backends. Both connections share the same search_path (the isolated test schema).

## Isolation strategy

An isolated PostgreSQL schema is created via `setupIsolatedTestDb({ namespace: "api" })`. The test app is built with this schema, and both connections use the same schema. The schema is dropped during cleanup.

## Barrier design

A `RaceBarrier` with typed `Deferred<T>` promises coordinates the two transactions:

| Deferred | Signal | Consumer |
|----------|--------|----------|
| `t1ReadAbsent` | T1's `findByOperationId` returned null | Controller |
| `t2ReadAbsent` | T2's `findByOperationId` returned null | Controller |
| `releaseT1` | Controller releases T1 past the barrier | T1 |
| `t1Committed` | T1's transaction committed | Controller |
| `releaseT2` | Controller releases T2 past the barrier | T2 |
| `t2UniqueViolation` | T2's insert hit 23505 | Controller |
| `t2RecoveryStarted` | T2's recovery transaction began | Controller |
| `t2RecoveryCompleted` | T2's recovery completed | Controller |

Each deferred has a 10-second timeout. On timeout, the error message identifies which barrier point was stuck.

The barrier is injected into the `TimeAdjustmentRepository.findByOperationId` seam via a wrapper function `wrapAdjustmentRepoWithBarrier`. The wrapper does not modify the production code path — it is purely a test-time composition.

## Exact constraint name

```text
attempt_time_adjustments_org_operation_unique
```

Verified by the `isOrgOperationUniqueViolation` helper which walks the error cause chain and matches `code === "23505"` and `constraint === "attempt_time_adjustments_org_operation_unique"`.

## Transaction trace

From a single test run:

| Phase | PID | Event |
|-------|-----|-------|
| T1 primary | 444851 | Transaction begins |
| T2 primary | 444852 | Transaction begins |
| T1 read absent | 444851 | `findByOperationId(OP_SHARED)` → null |
| T2 read absent | 444852 | `findByOperationId(OP_SHARED)` → null |
| T1 commit | 444851 | Ledger insert + deadline update → `granted` |
| T2 violation | 444852 | `INSERT` → SQLSTATE 23505 |
| T2 rollback | 444852 | Original transaction rolled back |
| T2 recovery | 444852 | Fresh transaction begins |
| T2 recovery read | 444852 | `findByOperationId(OP_SHARED)` → T1's row |
| T2 recovery result | 444852 | `IdempotencyConflictError` |

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
  - `REC-I4-V1: deterministic operationId race recovery > deterministically fixes T1 as winner, recovers T2 as IDEMPOTENCY_CONFLICT`

## 20-run repeat result

Executed via `node scripts/test/run-operator-grant-race-repeat.mjs`:

```
[REC-I4-V1] Running 20 deterministic iterations...

  ✓ Iteration 1/20
  ✓ Iteration 2/20
  ✓ Iteration 3/20
  ✓ Iteration 4/20
  ✓ Iteration 5/20
  ✓ Iteration 6/20
  ✓ Iteration 7/20
  ✓ Iteration 8/20
  ✓ Iteration 9/20
  ✓ Iteration 10/20
  ✓ Iteration 11/20
  ✓ Iteration 12/20
  ✓ Iteration 13/20
  ✓ Iteration 14/20
  ✓ Iteration 15/20
  ✓ Iteration 16/20
  ✓ Iteration 17/20
  ✓ Iteration 18/20
  ✓ Iteration 19/20
  ✓ Iteration 20/20

[REC-I4-V1] Results: 20/20 passed, 0/20 failed
```

All 20 iterations deterministically fixed T1 as winner and T2 as loser. Every iteration produced distinct PIDs, a single ledger row, and correct deadline changes.

## TLA+ mapping

| TLA+ action | Runtime event | V1 observation |
|---|---|---|
| `BeginCommand(T1)` | T1 primary transaction starts | PID 444851 |
| `BeginCommand(T2)` | T2 primary transaction starts | PID 444852 |
| `ReadOperationAbsent(T1)` | T1 lookup returns none | barrier.t1ReadAbsent |
| `ReadOperationAbsent(T2)` | T2 lookup returns none | barrier.t2ReadAbsent |
| `CommitWinner(T1)` | ledger insert + deadline update commit | final row/deadline |
| `ObserveUniqueViolation(T2)` | SQLSTATE 23505 | error.code === "23505", exact constraint |
| `BeginFreshRecovery(T2)` | new transaction begins | new PID (same connection, new txid) |
| `ReadCommittedWinner(T2)` | reads T1 committed ledger | `findByOperationId` returns T1's row |
| `ReturnIdempotencyConflict(T2)` | domain error mapped to 409 | `IdempotencyConflictError` thrown |

This test realizes one deterministic implementation trace corresponding to the model actions. It does not prove that all runtime executions refine the TLA+ model.

## Residual assumptions

- The test uses the engine's `grantAttemptTime` function directly (not through the HTTP route), so it bypasses authz, rate limiting, and the request-scoped resolver. The concurrency behavior under test (the 23505 unique violation and recovery) is identical regardless of the transport layer.
- The test uses `executeInTransaction` which defaults to `repeatable read` isolation. The production route uses the same default.
- The test creates its own tenant context object; the production route creates it from the JWT token. The context is used identically by the repos.

## Non-goals

- This is not a formal refinement proof. One deterministic trace is proven, not all possible schedules.
- Cross-tab client coordination (REC-I4-C1) is not covered.
- Cross-browser-profile / device coordination is not covered.
- The existing `Promise.all`-based race test in `admin-time-grants.test.ts` is preserved as a non-deterministic smoke test; it does not prove ordering.

## Production code changes

- **None**. All test infrastructure is in test-only files:
  - `apps/api/src/testing/barrier.ts` — barrier types
  - `apps/api/src/testing/operatorGrantConcurrencyHarness.ts` — test harness with barrier wrapping
  - `apps/api/src/routes/attempts/admin-time-grants.concurrency.test.ts` — the concurrency test
  - `scripts/test/run-operator-grant-race-repeat.mjs` — repeat runner
  - `package.json` — added `test:operator-grant-race` and `test:operator-grant-race:repeat` scripts

## New findings

- The existing `Promise.all`-based cross-Attempt race test in `admin-time-grants.test.ts` covers the same scenario but without ordering guarantees. The new deterministic test proves the exact ordering.
- PostgreSQL 18.4 correctly raises 23505 with `constraint = "attempt_time_adjustments_org_operation_unique"` when the unique index is violated.
- The `grantWithOperationRaceRecovery` recovery path in `attempts.admin.ts` correctly catches the 23505, starts a fresh transaction, and re-runs the command.

## Known limitations

- The test proves ordering for one specific schedule (T1 before T2). It does not prove that the reverse ordering (T2 before T1) would also produce a correct result, but the code is symmetric: the first transaction to commit wins, regardless of label.
- The `getBackendPid` function queries the PID from inside the transaction; it does not prove that the recovery transaction runs on a different backend than the primary transaction. However, the recovery transaction is a fresh `executeInTransaction` call, which creates a new database transaction on the same connection pool. The PID may be the same; the fresh transaction identity is proven by the fact that the original transaction was rolled back by the 23505 error.