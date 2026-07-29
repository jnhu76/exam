# REC-I4-I3B1 — Operator Grant Engine Seam

## Status

`REC-I4-I3B1 IMPLEMENTED — READY FOR HUMAN REVIEW`

The operator grant engine seam for ADR-013 interruption time compensation is
implemented. All monorepo typechecks pass. `pnpm verify` (build + lint + test)
passes.

## Base HEAD

```text
BASE_HEAD = 70ffff6d (merge commit of PR #225, REC-I4-I3A)
```

## Authority

1. `docs/adr/ADR-013-interruption-time-compensation-policy.md`
2. `docs/audits/REC-I4-R0-INTERRUPTION-TIME-POLICY.md`
3. `docs/audits/REC-I4-I1-DOMAIN-PERSISTENCE.md`
4. `docs/audits/REC-I4-I2-ENGINE-POLICY-SEAM.md`
5. `docs/audits/REC-I4-I3A-CONTRACT-AUTHORING.md`
6. Repository contract, testing, and code-quality standards

## Scope

This Job is the **engine + ledger** slice of REC-I4-I3B. It adds a new
`grantAttemptTime()` command that atomically (via caller-provided
`executeInTransaction`) inserts an `AttemptTimeAdjustment` ledger row and
updates `ExamAttempt.deadlineAt`, with `operationId`-keyed idempotency and
ADR-013's frozen lock/reconcile order. No HTTP route, no `Permission.AttemptTimeGrant`,
no Proctor Dashboard, no system incident, no Redis, no real-DB concurrency
project (REC-I4-V1 owns the dual-connection test).

## Files changed

### NEW — Engine command

| File | |
|------|-|
| `packages/exam-engine/src/operatorGrant.ts` | `grantAttemptTime` command (frozen ADR-013 order, P1–P4 fixes) |
| `packages/exam-engine/src/operatorGrant.test.ts` | 30 mock-repo unit tests covering all 15+ required scenarios |
| `docs/audits/REC-I4-I3B1-OPERATOR-GRANT-ENGINE-SEAM.md` | This closeout |

### EDIT — Domain error

| File | Change |
|------|--------|
| `packages/domain/src/errors.ts` | Added `IdempotencyConflictError` (code `IDEMPOTENCY_CONFLICT`, 409) |

### EDIT — Engine port

| File | Change |
|------|--------|
| `packages/exam-engine/src/interruptionRepositories.ts` | Added `findByOperationId` to `TimeAdjustmentRepository` port |
| `packages/exam-engine/src/index.ts` | Added `export * from "./operatorGrant.js"` |

### EDIT — Adapter (plumbing, no route)

| File | Change |
|------|--------|
| `apps/api/src/adapters/repoAdapters.ts` | Added `findByOperationId` to `createTimeAdjustmentRepoAdapter` |

### EDIT — Existing typed mocks (port method added, typecheck must stay green)

| File | Change |
|------|--------|
| `packages/exam-engine/src/attemptCommands.test.ts` | Added `findByOperationId` to both `TimeAdjustmentRepository` mocks |
| `packages/exam-engine/src/restoreInterruption.test.ts` | Added `findByOperationId` + `existingOperationAdjustment` option to mock |

### EDIT — Status docs

| File | Change |
|------|--------|
| `docs/roadmap/current.md` | REC-I4-I3B1 status |
| `docs/status/implementation-status.md` | REC-I4-I3B1 engine + ledger |

## 1. `grantAttemptTime` signature and frozen order

```ts
export async function grantAttemptTime(
  examRepo: ExamRepository,
  attemptRepo: AttemptRepository,
  enrollmentRepo: EnrollmentRepository,
  episodeRepo: InterruptionEpisodeRepository,
  eventRepo: InterruptionEventRepository,
  adjustmentRepo: TimeAdjustmentRepository,
  gradingWorksetRepo: GradingWorksetRepository,
  capability: LockedEnrollmentAttemptIdentity,
  input: GrantAttemptTimeInput,
): Promise<GrantAttemptTimeResult>
```

Frozen execution order (ADR-013 §7/§9, P1–P4 fixes applied):

1. assert EA capability affinity (`assertCapabilityFor`);
2. re-read locked Attempt, lock Exam;
3. normalize + validate inputs (canonicalize, integer/UUID bounds, `incidentId` null);
4. `operationId` replay/conflict check (`findByOperationId`);
5. validate `operator_incident` policy snapshot (P1-4 guard);
6. validate optional interruption episode ownership (P1-3, via episode port);
7. reconcile deadline: `in_progress` → `mode:none`; `disrupted` → `mode:active_interruption`;
8. if terminal after reconcile → return `{ outcome: "terminal" }`, no grant;
9. require still `in_progress | disrupted`;
10. compute `afterDeadline` with arithmetic safety;
11. reject (no silent clamp) if `afterDeadline > exam.closeAt`;
12. insert operator adjustment (`policy: snapshot.policy`, `source:"operator"`);
13. update `attempt.deadlineAt`;
14. re-read attempt, return `{ outcome: "granted" | "terminal" | "idempotent_replay", adjustment, addedSeconds }`.

## 2. P1–P4 fixes applied

| Fix | What was wrong | How it's fixed |
|-----|---------------|----------------|
| **P1-1** | `attempt` was missing — flow jumped to `examRepo.findByIdForUpdate` without a re-read | `attemptRepo.findByIdForUpdate(capability.attemptId)` as first step (matching `restoreInterruptedAttempt`) |
| **P1-2** | `disrupted` + expired + `mode:none` threw (fail closed, not terminal) | Receives `episodeRepo` + `eventRepo`; builds `mode:active_interruption` resolution for disrupted; expired disrupted terminalizes correctly |
| **P1-3** | `interruptionId` ownership used a wrong heuristic (ledger fallback) | Uses `episodeRepo.findByAttemptForUpdate` — the canonical episode port; legally references all episode types |
| **P1-4** | `policy:"operator_incident"` was hardcoded; no guard against strict/bounded attempts | Validates `snapshot.policy === "operator_incident"`; ledger writes `policy: snapshot.policy` (proven operator_incident) |

## 3. Idempotency semantics

`operationId` is command identity, not a dedupe field (ADR-013 §9):

- Same `operationId` + same payload → returns the committed adjustment (`idempotent_replay`), no second grant.
- Same `operationId` + different payload → `IdempotencyConflictError` (HTTP 409).
- Replay comparison covers user payload fields (`attemptId`, `addedSeconds`, `reasonCode`, `reasonText`, `actorId`, `interruptionId`) plus anti-corrosion checks (`source === "operator"`, `policy === "operator_incident"`, `incidentId === null`, `eligibleSeconds === null`).
- Inputs are canonicalized (trimmed) up front so `"x"` vs `"  x  "` is the same payload.

## 4. Atomicity scope

B1 is **transaction-compatible**, not atomic by itself. The command performs
ledger insert and deadline update through caller-supplied transaction-bound
repositories. The B2 caller MUST execute it inside `executeInTransaction` so
the two writes commit and roll back together. Mock tests prove insert/update
ordering, non-swallowed errors, and no continuation after failure — they do
**not** prove PostgreSQL rollback (REC-I4-V1 owns the dual-connection test).

## 5. Tests (30)

All 15 required scenarios covered, organized in `describe` blocks:

- **Happy path** (2): in_progress normal grant, disrupted normal grant (no auto-restore).
- **Terminal** (4): submitted/grading/graded/voided → outcome terminal, no grant.
- **Expired reconcile** (2): in_progress expired (mode none), disrupted expired (mode active_interruption + terminalized event).
- **Exam.closeAt** (1): afterDeadline > closeAt → `AttemptDeadlineExceedsExamCloseError`, no insert, no deadline change.
- **Idempotency** (6): same payload replay, 4 different-payload conflicts, reason canonicalization.
- **InterruptionId ownership** (2): not owned → fails closed; historical episode still referenceable.
- **Policy guard** (2): missing snapshot, strict/bounded_grace rejected.
- **Atomicity sequencing** (2): insert throws → update never called; update throws → error propagates.
- **Capability affinity** (1): different repos → rejected before any read/write.
- **Input validation** (6): UUID, positive integer, PG integer bound, reasonCode empty/oversize, reasonText empty, incidentId non-null.
- **Not found** (1): attempt missing under lock → NotFoundError.

## Non-goals reaffirmed

- No API route.
- No `Permission.AttemptTimeGrant`.
- No Proctor Dashboard change.
- No system incident (`incidentId` asserted null).
- No Redis.
- No real-DB concurrency (REC-I4-V1).
- `lock-order.structural.test.ts` unchanged: `grantAttemptTime` is a seam consumer (receives a pre-minted capability), not a minter; the B2 route will be the new AE entry point.

## Verification

```text
pnpm --filter @exam/exam-engine test -- operatorGrant.test.ts  → 30 passed
pnpm --filter @exam/exam-engine test -- restoreInterruption.test.ts attemptCommands.test.ts  → mock edits green
pnpm --filter @exam/exam-engine typecheck  → OK
pnpm --filter @exam/api typecheck  → OK
pnpm typecheck  → 17/17 tasks, OK
pnpm format:check  → OK
pnpm lint:arch  → Architecture checks passed
pnpm lint:copy  → No hardcoded business copy found
pnpm verify  → 9/9 tasks, OK
```

## Known limitations

1. No real-PostgreSQL concurrency proof — REC-I4-V1 owns the dual-connection
   idempotency/lock test.
2. No HTTP/RBAC surface — the engine seam is callable but unwired; wiring is
   REC-I4-I3B2.
3. Atomicity (ledger+deadline commit/rollback) is owned by the B2 caller's
   `executeInTransaction`; B1 is transaction-compatible, not atomic by itself.

## Next Job

`REC-I4-I3B2` (operator grant route + `Permission.AttemptTimeGrant`) or
`REC-I4-V1` (PostgreSQL concurrency closeout), per the roadmap.