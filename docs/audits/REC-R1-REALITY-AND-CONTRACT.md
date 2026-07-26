# REC-R1 — Reality Audit and Contract Closeout

## Frozen BASE_HEAD

```text
bcf02847b0231e233dcb3ff98ec7ae681739b028
```

Branch: `docs/rec-r1-recovery-contract` (from `master`)

---

## Files Inspected

```text
packages/exam-engine/src/attemptCommands.ts
packages/exam-engine/src/attemptStateMachine.ts
packages/exam-engine/src/answerProtocol.ts
packages/exam-engine/src/deadlineReconciliation.ts

apps/api/src/routes/attempts.candidate.ts
apps/api/src/plugins/heartbeat.ts
apps/api/src/plugins/deadlineScanner.ts
apps/api/src/orchestrators/submitAndGradeAttempt.ts

apps/web/src/pages/exam/TakeExamPage.tsx
apps/web/src/pages/exam/StartExamPage.tsx
apps/web/src/hooks/useSubmitFlush.ts
apps/web/src/lib/examTelemetry.ts
apps/web/src/lib/clientEventBuffer.ts

docs/adr/ADR-004-desktop-electron.md
docs/adr/ADR-006-exam-time-authority.md
docs/adr/ADR-008-submit-answer-freeze.md
```

---

## Current Implementation Facts

### 1. Server-confirmed answers are persisted in PostgreSQL and are recoverable

**CONFIRMED.** `saveAnswer` (answerProtocol.ts) persists accepted answers to
`exam_attempts.answers` via `attemptRepo.update`. `submitAttempt`
(attemptCommands.ts) freezes `submitted_answers` from draft answers at
submit time. Both are durable in PostgreSQL.

### 2. Unconfirmed edits exist only in browser memory during the debounce/request window

**CONFIRMED.** `useSubmitFlush` (useSubmitFlush.ts) uses in-memory `Map`
refs (`pendingRef`, `inflightRef`, `statusRef`, `generationRef`). No
IndexedDB, no localStorage, no durable persistence. A page refresh loses
all pending/inflight saves.

### 3. A disrupted attempt can be restored through the start/restore server paths

**CONFIRMED.** `startOrRestoreAttempt` (attemptCommands.ts) detects
`status === "disrupted"` and calls `restoreAttempt`. The
`POST /attempts/:examId/start` route invokes `startOrRestoreAttempt`. The
`POST /attempts/:attemptId/restore` route also exists and calls
`restoreAttempt` after deadline reconciliation.

### 4. Directly opening /take/:attemptId for a disrupted attempt does not complete the restore workflow

**CONFIRMED.** `GET /candidate/attempts/:attemptId/take` runs deadline
reconciliation (may auto-submit if expired) but does NOT call
`restoreAttempt`. It returns the snapshot with `attemptStatus=disrupted`
and `canResume=true`. The frontend `TakeExamPage` loads the snapshot but
does not invoke the restore command — it renders the disrupted state.

### 5. restoreAttempt compensates disconnected time by moving deadlineAt forward, bounded only by exam.closeAt

**CONFIRMED.** `restoreAttempt` (attemptCommands.ts:399-449) computes
`disconnectedDuration = now - lastActivityAt` and adds it to `deadlineAt`,
capped at `exam.closeAt` via `Math.min(adjustedDeadline, exam.closeAt)`.
No per-incident cap, no aggregate cap, no policy selection.

### 6. The current Web client has no durable pending-answer journal

**CONFIRMED.** No IndexedDB usage for answers. No localStorage for answers.
`useSubmitFlush` is purely in-memory. `examTelemetry.ts` buffers events
in-memory only.

### 7. The explicit POST /attempts/:attemptId/restore route has no current Web frontend caller

**CONFIRMED.** Grep of `apps/web/src` shows no code calling
`/attempts/:attemptId/restore`. The `StartExamPage` calls
`POST /attempts/:examId/start` which internally handles restore via
`startOrRestoreAttempt`. The explicit restore route is server-only.

### 8. Save-answer already has version and replay concepts (clientSeq, baseVersion, serverVersion)

**CONFIRMED.** `processSaveAnswer` (answerProtocol.ts) implements:

- `clientSeq` idempotency key (`questionId:clientSeq`)
- `CONFLICTING_PAYLOAD` rejection for same key + different payload
- `baseVersion` vs `currentVersion` comparison
- `STALE_VERSION` rejection for `baseVersion < currentVersion`
- `serverVersion` returned on acceptance
- `clientSeqHistory` persisted for replay detection

---

## Decisions Frozen

1. PostgreSQL is the sole authority for answers, lifecycle, deadline,
   submission, grading, and results.
2. Local storage is recovery material only, never a second truth source.
3. Save operations require a stable operation identity with idempotent
   replay semantics. Current implementation uses `(attemptId, questionId,
   clientSeq)` composite key; whether the target introduces a standalone
   `operationId` field is an OPEN_DECISION (REC-I2a).
4. Stale clients cannot silently overwrite newer server answers.
   KNOWN_DEFECT: future baseVersion (greater than current) is not yet
   rejected; TARGET_INVARIANT requires strict equality (REC-I2a).
5. Recovery and time compensation are separate concerns.
6. Full disconnect-time compensation is NOT frozen as the permanent default.
7. The explicit restore route is preserved; ordinary GETs do not restore.
8. The local journal abstraction is implementation-neutral (IndexedDB /
   SQLite adapters share the same contract).
9. Cross-user local-data isolation is mandatory.
10. Standard answers and auth tokens are forbidden in local storage.
11. Telemetry forbids answer content.
12. Web is the only implemented delivery target; desktop is deferred
    (ADR-004).
13. Ordinary Web exams are not lockdown exams.
14. ZKP/attestation does not prove no cheating.
15. Offline multiple-edit uses DurableAnswerDraft (latest intent per
    question) + SaveOperationOutbox (server-bound operations). The journal
    must NOT store an append-only chain of all offline edits as independent
    operations.
16. `submitted_answers` (frozen at submit per ADR-008) is the sole grading
    authority after submission. Recovery must not modify it.

---

## Current Invariants (implemented and testable today)

| ID | Invariant | Evidence |
|---|---|---|
| CI-1 | Server-confirmed answer is authoritative over stale client state | `processSaveAnswer` STALE_VERSION rejection |
| CI-2 | Same clientSeq + same payload is idempotent | `answersEqual` + idempotency key |
| CI-3 | Same clientSeq + different payload conflicts | CONFLICTING_PAYLOAD rejection |
| CI-4 | Stale baseVersion cannot overwrite newer answer | baseVersion < currentVersion → reject (NOTE: baseVersion > currentVersion is NOT rejected — KNOWN_DEFECT, see Limitations) |
| CI-5 | Submitted attempt cannot return to in_progress | State machine: no `submitted:restore` transition |
| CI-6 | Submit is idempotent (already-submitted returns existing) | submitAttempt idempotent path |
| CI-7 | Server time is authoritative (ADR-006) | `fastify.now()` threaded; engine never reads wall clock |
| CI-8 | Deadline reconciliation is lazy and inline | `ensureAttemptDeadlineReconciled` at entry points |

---

## Target Invariants (specified but NOT yet implemented)

| ID | Invariant | Implementing Job |
|---|---|---|
| TI-1 | DurableAnswerDraft is persisted before network reliance | REC-I1 |
| TI-2 | Journal scope requires organization + user + attempt isolation | REC-I1 |
| TI-3 | Operation identity and outbox semantics frozen (strict baseVersion, stable ID) | REC-I2a |
| TI-4 | Recovery reconciliation and conflict UX (draft vs server comparison) | REC-I2b |
| TI-5 | Disrupted-attempt restore is an explicit frontend command | REC-I3 |
| TI-6 | Time compensation is policy-driven, not auto-full | REC-I4 |
| TI-7 | Deadline extensions are attributable (policy/incident/operator) | REC-I4 |
| TI-8 | Recovery telemetry emits structured events without answer content | REC-I5 |
| TI-9 | Multi-tab conflict is detected and surfaced | REC-I2b |
| TI-10 | Journal is cleared on authoritative submission | REC-I1 |
| TI-11 | UI distinguishes saved_locally from saved_to_server | REC-I2b |
| TI-12 | Offline multiple-edit uses draft overwrite, not append-only operations | REC-I1 |

---

## Remaining Gaps

1. No durable local journal — edits between debounce and server ACK are
   volatile.
2. No frontend restore command invocation — disrupted attempts require
   navigation to StartExamPage.
3. No time-compensation policy — full disconnected duration is returned.
4. No multi-tab/multi-device conflict detection beyond server version.
5. No structured recovery telemetry.
6. No operator incident timeline.
7. No submission operationId (submit idempotency relies on attempt status,
   not a stable operation receipt).

---

## Jobs Authorized Next

```text
REC-I3 — Disrupted-attempt recovery UX (explicit frontend restore)
REC-I4 — Interruption and time-compensation policy
REC-I2a — Protocol hardening: operation identity freeze, future baseVersion fix,
           replay receipt, offline supersession model
REC-I1 — Web pending-answer journal (IndexedDB adapter):
           DurableAnswerDraft + SaveOperationOutbox + isolation + cleanup
REC-I2b — Recovery reconciliation, replay, and conflict UX
REC-I5 — Recovery telemetry and correlation
REC-I6 — Operator incident timeline
REC-V1 — Crash/network verification
```

Order rationale: risk-priority. REC-I3 directly fixes the P1 "locked out
after crash" blocker with minimal scope (server route exists). REC-I4 removes
the P1 abuse vector. REC-I2a freezes the data model so REC-I1 does not embed
an undecided schema. REC-I3 and REC-I4 may proceed in parallel.

These Jobs are governed by ADR-012 and this contract. They must not
contradict the frozen invariants.

---

## Commands Executed

```bash
git status --short
git branch --show-current
git log -12 --oneline
git rev-parse HEAD
```

---

## Validation

```bash
pnpm verify:static   # prettier, lint, arch, copy, UI gates, ESLint, typecheck, openapi — all pass
npx markdownlint-cli2 docs/adr/ADR-012-candidate-recovery-contract.md docs/architecture/exam-system/candidate-recovery.md docs/audits/REC-R1-REALITY-AND-CONTRACT.md  # clean
git add -A && git commit  # pre-commit hooks pass (lint-staged + typecheck)
git push origin docs/rec-r1-recovery-contract  # pre-push hooks pass
gh pr create --title "docs(recovery): freeze candidate crash-recovery contract" --body "..."
```

All static gates pass. No runtime code modified; integration/E2E tests
require Docker/PostgreSQL and are not executed for documentation-only changes.

---

## Limitations

1. Integration/E2E tests require Docker/PostgreSQL — not executed for
   documentation-only changes.
2. Time-compensation numeric defaults are intentionally undecided pending
   product decision (REC-I4).
3. Submission operationId model is specified directionally but not frozen
   to a specific wire format — REC-I2a owns the detail.
4. Multi-tab lock mechanism (Web Locks vs BroadcastChannel vs server lease)
   is not selected — REC-I2b owns the selection.
5. `baseVersion > currentVersion` is a KNOWN_DEFECT in the current
   implementation (not rejected). The TARGET_INVARIANT (strict equality)
   is frozen but the runtime fix is owned by REC-I2a.
6. The offline multiple-edit model (DurableAnswerDraft +
   SaveOperationOutbox) is frozen directionally but requires REC-I2a
   validation before REC-I1 embeds it in IndexedDB schema.
7. The current operation identity `(attemptId, questionId, clientSeq)`
   is NOT equivalent to the target `operationId` semantic field. Whether
   the target introduces a standalone wire field or enhances the composite
   key is an OPEN_DECISION owned by REC-I2a.
