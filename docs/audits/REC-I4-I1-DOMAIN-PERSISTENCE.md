# REC-I4-I1 — Domain and Persistence Foundation

## Status

IMPLEMENTED — DATABASE VERIFICATION BLOCKED BY LOCAL ENVIRONMENT

The implementation and static verification are complete. PostgreSQL-backed
tests and full `pnpm verify` require the repository database on
`127.0.0.1:15432`; Docker Desktop was unavailable during this run.

## Base HEAD

```text
BASE_HEAD = 419120c0a6290093af972869377400d0cc9081a7
branch = feat/rec-i4-i1-domain-persistence
PR #222 merge commit = 419120c0a6290093af972869377400d0cc9081a7
```

## Authority

1. `docs/adr/ADR-013-interruption-time-compensation-policy.md`
2. `docs/audits/REC-I4-R0-INTERRUPTION-TIME-POLICY.md`
3. Repository migration, testing, and code-quality standards
4. Current source conventions

## Files inspected

- Domain enums/types and barrel exports
- Exam/Attempt contracts and contract barrel exports
- PostgreSQL schema, DB types, repository base, Exam and Attempt repositories
- Migration journal, Drizzle config/package, migrations through `0020`
- Testing, test-flake, code-quality, roadmap, and implementation-status docs

## Files changed

- `packages/domain/src/enums.ts`
- `packages/domain/src/types.ts`
- `packages/contracts/src/interruption.ts`
- `packages/contracts/src/interruption.test.ts`
- `packages/contracts/src/index.ts`
- `packages/db/src/schema/pg.ts`
- `packages/db/src/types.ts`
- `packages/db/src/index.ts`
- `packages/db/src/testCleanup.ts`
- `packages/db/src/repository/attemptInterruptionRepo.ts`
- `packages/db/src/repository/attemptInterruptionEventRepo.ts`
- `packages/db/src/repository/attemptTimeAdjustmentRepo.ts`
- `packages/db/src/repository/interruptionPersistence.test.ts`
- `packages/db/src/migrations/0021-interruption-backfill.test.ts`
- `packages/db/migrations/postgres/0021_noisy_archangel.sql`
- `packages/db/migrations/postgres/meta/0021_snapshot.json`
- `packages/db/migrations/postgres/meta/_journal.json`
- `docs/roadmap/current.md`
- `docs/status/implementation-status.md`
- this closeout

## Migration number

`0021_noisy_archangel`

Drizzle Kit generated the migration and snapshot. Because migrations
`0016..0020` were hand-maintained without snapshots, the generated SQL also
contained already-applied DDL; that unrelated DDL was removed while retaining
the generated `0021` snapshot. The generated journal timestamp was older than
the manually assigned `0020` timestamp, so the new entry alone was corrected
to the next monotonic value (`1787200000000`) to prevent Drizzle from skipping
it.

## Domain types

- `InterruptionTimePolicy`
- `AttemptTimingPolicySnapshot`
- `InterruptionEventType`
- `InterruptionDetectionSource`
- `TimeAdjustmentSource`
- `AttemptInterruption`
- `AttemptInterruptionEvent`
- `AttemptTimeAdjustment`

Exam and Attempt expose the new projection as optional during the I1
old-runtime compatibility window. PostgreSQL rows are authoritative and always
carry the non-null strict policy/snapshot defaults. I2 must populate these
values at the engine seam before the Domain projection can be made required.

The database keeps the four explicit snapshot columns. The pure
`projectAttemptTimingPolicySnapshot` mapper creates the single authoritative
`AttemptTimingPolicySnapshot` projection; no synonym type is exported.

## Database tables

- `attempt_interruptions`
- `attempt_interruption_events`
- `attempt_time_adjustments`

Exam configuration, Attempt snapshot, active interruption UUID, and
`interrupted_at` are additive columns with conservative defaults.

## Constraints

PostgreSQL enforces policy/cap shape, snapshot version/shape, pointer pairing,
tenant-consistent attempt/episode identity, event/source vocabulary and field
shape, detected/outcome at-most-once, positive exact-second adjustments,
operation uniqueness, and bounded-grace positive adjustment at-most-once.

The active-pointer composite FK is controlled SQL in `0021` because the
mutually referencing Drizzle tables create a TypeScript initialization cycle.

## Cross-table invariants deferred to I2

I1 does not claim that CHECK constraints guarantee:

- deadline update plus ledger insertion atomicity;
- episode parent, detected event, and status transition atomicity;
- exactly one detected child for every committed episode;
- `interruptedAt` equality with detected `occurredAt`;
- aggregate-cap sums;
- scanner/heartbeat serialization;
- outcome event, pointer clear, and lifecycle atomicity.

These require I2 transaction/lock integration and integration tests.

## Historical backfill

- Exams become `strict` with null caps.
- Attempts receive snapshot version 1, `strict`, and null caps.
- Each historical `disrupted` Attempt receives a stable generated episode,
  active pointer, `interrupted_at`, and migration-labelled detected event.
- All historical disrupted rows use `transaction_timestamp()`.
- `last_activity_at` is retained only as observed evidence and is never used as
  detected time.
- The adjustment ledger starts empty.
- No deadline, submission, grading, or lifecycle field is rewritten.

## Transitional old-runtime compatibility

I1 intentionally permits:

```text
disrupted + null pointer
non-disrupted + stale pointer
terminal + stale pointer
```

The current scanner can still disrupt without inserting an episode, and the
current restore path can still change lifecycle without clearing a pointer.
There is no status/pointer equivalence CHECK and no trigger. Bounded-grace
authoring remains unreachable, so this compatibility window cannot grant
automatic time. I2 must create/close episodes transactionally and converge
these states. I1 alone does not make the recovery runtime ADR-013 compliant.

## Repository APIs

- Interruption parent: `create`, `findById`, `findByAttempt`,
  `findByAttemptForUpdate`
- Event ledger: `insert`, `findDetected`, `findOutcome`,
  `listByInterruption`, `listByAttempt`
- Adjustment ledger: `insert`, `findById`, `findByOperationId`,
  `findBoundedByInterruption`, `listByAttempt`, `sumBoundedGraceSeconds`

Every method requires tenant/request context and applies organization scope.
No update/delete API exists for any append-only record.

## Tests

New tests cover contract normalization/vocabulary, PostgreSQL defaults and
constraints, tenant isolation, append-only repository round trips, event and
adjustment uniqueness, bounded sums, and pre-0021 migration/backfill deadline
preservation.

## Commands executed

```text
git switch master
git pull --ff-only
git switch -c feat/rec-i4-i1-domain-persistence
pnpm --filter @exam/db db:generate
pnpm --filter @exam/domain typecheck
pnpm --filter @exam/contracts typecheck
pnpm --filter @exam/db typecheck
pnpm typecheck
pnpm --filter @exam/contracts test -- interruption.test.ts
pnpm --filter @exam/db test -- testIsolation.test.ts
pnpm verify:static
pnpm verify
git diff --check
```

The contract test passed (267 tests in the package run). All typechecks passed.
`pnpm verify:static` passed. The DB test command and the database coverage lane
within `pnpm verify` could not connect to `127.0.0.1:15432`; neither fell back
to or modified the dev database. The full verification run therefore stopped
at the unavailable PostgreSQL dependency and did not produce a complete
coverage result.

The two new PostgreSQL suites were not run because `exam_test` was unreachable:

- `packages/db/src/repository/interruptionPersistence.test.ts` — UNRUN
- `packages/db/src/migrations/0021-interruption-backfill.test.ts` — UNRUN

## Known limitations

- PostgreSQL-backed tests, complete coverage, fresh/upgrade migration
  execution, and a passing full `pnpm verify` remain blocked until
  Docker/PostgreSQL is available.
- The runtime still uses the pre-ADR-013 restore/scanner behavior.
- Domain projections remain optional solely for I1 old-runtime compatibility.

## Explicit non-goals

No heartbeat, scanner, restore, deadline-reconciliation, operator API,
permission, Web UI, Redis, BullMQ, formal model, or offline-answer change is
included.

## Next Job

`REC-I4-I2 — Engine Policy Seam`
