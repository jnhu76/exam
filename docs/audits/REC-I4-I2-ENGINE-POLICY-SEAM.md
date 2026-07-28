# REC-I4-I2 — Engine Policy Seam

## Status

**REC-I4-I2 IMPLEMENTED — READY FOR HUMAN REVIEW**

All engine, API, and migration changes are implemented. All 434 engine tests
pass. All monorepo typechecks pass. `pnpm verify:static` passes.

## Base HEAD

```text
BASE_HEAD = a6f57118
branch = feat/rec-i4-i2-engine-policy-seam
```

## Authority

1. `docs/adr/ADR-013-interruption-time-compensation-policy.md`
2. `docs/audits/REC-I4-R0-INTERRUPTION-TIME-POLICY.md`
3. `docs/audits/REC-I4-I1-DOMAIN-PERSISTENCE.md`
4. Repository migration, testing, and code-quality standards

## Files changed

### Engine (`packages/exam-engine/src/`)

| File | Change |
|------|--------|
| `interruptionRepositories.ts` | **NEW** — engine-facing ports for episode, event, and adjustment repos |
| `interruptionPolicy.ts` | **NEW** — pure `resolveAttemptTimingPolicySnapshot` and `evaluateInterruptionTimePolicy` |
| `restoreInterruption.ts` | **NEW** — `SubmitInterruptionResolution` union, `resolveActiveInterruptionOnTerminalization`, `restoreInterruptedAttempt` composed command, `reconstructTerminalOutcome` |
| `attemptCommands.ts` | **EDITED** — `markDisrupted` rewritten (atomic episode creation, ScannerDisruptResult), `submitAttempt` gains resolution parameter, `restoreAttemptState` added, `startOrRestoreAttempt` rewritten (lock seam, snapshot wiring), `lockEnrollmentAndActiveAttempt` import |
| `examCommands.ts` | **EDITED** — `ExamRepository` extended with `findByIdForUpdate` |
| `deadlineReconciliation.ts` | **EDITED** — `ensureAttemptDeadlineReconciled` accepts optional resolution parameter |
| `lockSeam.ts` | **EDITED** — `lockEnrollmentAndActiveAttempt` (R3) seam added |
| `index.ts` | **EDITED** — export new modules |
| `attemptMutation.testHelpers.ts` | **EDITED** — mock repos extended with new methods |
| `interruptionPolicy.test.ts` | **NEW** — 26 tests for resolver + evaluator |
| `attemptCommands.test.ts` | **EDITED** — 5 new markDisrupted tests, 1 updated restore test |
| Various test files | **EDITED** — 15 files updated with mock method additions |

### DB (`packages/db/src/`)

| File | Change |
|------|--------|
| `repository/attemptInterruptionRepo.ts` | **EDITED** — added `findLatestByAttempt` |
| `repository/attemptInterruptionEventRepo.ts` | **EDITED** — added `findLatestOutcomeByAttempt` (R10 order) |
| `repository/attemptRepo.ts` | **EDITED** — added `refreshLastActivityIfInProgress` |
| `schema/pg.ts` | **EDITED** — added `exam_attempts_status_pointer_check` |
| `migrations/postgres/0022_engine_policy_seam.sql` | **NEW** — phased fail-closed migration (P1 validation, P2 backfill, P3 cleanup, P4 CHECK) |
| `migrations/postgres/meta/0022_snapshot.json` | **NEW** — Drizzle schema snapshot |
| `migrations/postgres/meta/_journal.json` | **EDITED** — added 0022 entry |

### API (`apps/api/src/`)

| File | Change |
|------|--------|
| `adapters/repoAdapters.ts` | **EDITED** — 3 interruption adapters, flatten helper, RestoreEngineRepos bundler |
| `plugins/heartbeat.ts` | **EDITED** — `markAttemptDisrupted` thin wrapper (R12), fixed second `fastify.now()` |
| `config/runtimeConfig.ts` | **EDITED** — validate `timeoutMs % 1000 === 0`, add `heartbeatTimeoutSeconds` |
| `routes/attempts.candidate.ts` | **EDITED** — heartbeat uses `refreshLastActivityIfInProgress`, restore uses `restoreInterruptedAttempt`, start wires interruption repos |

## Commits

```text
be404d98 feat(recovery): add engine interruption repositories, policy evaluator, and restoreAttemptState
f835c13d feat(recovery): rewrite markDisrupted with atomic episode creation and Attempt-only locking
63f8a7e7 feat(recovery): add SubmitInterruptionResolution and wire into submitAttempt
94356eee feat(recovery): thread SubmitInterruptionResolution through ensureAttemptDeadlineReconciled
28549fa2 feat(recovery): add restoreInterruptedAttempt composed command
c4784557 feat(recovery): add lockEnrollmentAndActiveAttempt seam and rewrite startOrRestoreAttempt
9c9a117d feat(recovery): wire heartbeat atomic write, restore composed route, and start interruption repos
21691784 feat(recovery): add migration 0022 with validation, backfill, and status/pointer CHECK
```

## Key design decisions

1. **R1** — `submitAttempt` is the sole owner of `disrupted → submitted` terminalization.
2. **R2** — `SubmitInterruptionResolution` threads through restore → reconcile → submit → terminalization.
3. **R3** — `lockEnrollmentAndActiveAttempt` is the /start seam; `lockEnrollmentAndAttempt` stays for /restore and submit.
4. **R4** — `resolveAttemptTimingPolicySnapshot` is a pure fail-closed resolver.
5. **R7** — `restoreAttemptState` consumes an already-locked attempt (lifecycle only).
6. **R8** — /start lock seam called by engine, not route.
7. **R9** — Terminalization context carries no independent `now`.
8. **R10** — Idempotency reconstruction matches outcome type with identity-consistency checks.
9. **R11** — Migration phased fail-closed (P1 validate, P2 create, P3 resolve, P4 CHECK).
10. **R12** — Scanner uses Attempt-only locking protocol (no Enrollment/Exam).

## Non-goals reaffirmed

- No public authoring UI/API for Exam interruption fields.
- No operator grant route.
- No `Permission.AttemptTimeGrant`.
- No `system_incident`.
- No legacy `extendAttemptTime` migration.
- No Redis.
- No public DTO change.
- No TLA+.

## Known limitations

1. **Part I deferred** — `submitAndGradeAttempt` and `deadlineScanner` do not yet pass `SubmitInterruptionResolution` through to `submitAttempt`. The `disrupted → submitted` path works (status transition succeeds) but does not append a terminalized event. This is safe because:
   - The I1 transitional state already permitted `disrupted + null pointer` combinations.
   - The 0022 migration validates and resolves these states.
   - The full terminalization audit trail will be wired when the `restoreInterruptedAttempt` path is the sole entry point for disrupted→submitted.
2. **No integration tests** — The engine mock tests (434) pass, but no PostgreSQL-backed integration tests exist for the new restore flow, heartbeat scanner order, or API regression.
3. **Old `restoreAttempt` retained** — The legacy `restoreAttempt` function (with `disconnectedDuration` deadline compensation) is still present in `attemptCommands.ts` but is no longer imported by any production route. It is kept for reference and will be removed in a follow-up cleanup.

## Verification

```text
pnpm --filter @exam/exam-engine typecheck
pnpm --filter @exam/db typecheck
pnpm --filter @exam/api typecheck
pnpm typecheck
pnpm format:check
pnpm lint
pnpm lint:eslint
pnpm lint:arch
pnpm lint:copy
pnpm verify:static
```

All pass. 434 engine tests pass.

## Next Job

`REC-I4-I3` — not started.