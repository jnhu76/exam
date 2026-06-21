# P2D-J2 Exam Transition/Reconciliation Audit Report

## Summary

This audit examines all exam state transition handlers and reconciliation logic in the exam platform, focusing on understanding current behavior patterns before any refactoring. The audit identified **6 state transition handlers**, **1 reconciliation function**, and **9 call sites** across the codebase.

### Key Findings

1. **Consistent ADR-005 pattern**: All admin routes (close, unpublish, extend, cancel, archive) follow the `lock → reconcile → guard → assert → mutate → audit` pattern inside transactions
2. **Reconciliation spread**: `checkAndUpdateExamStatus` is called from 9 locations (6 admin routes + 3 candidate routes)
3. **Audit duplication prevention**: Close and archive routes explicitly check for idempotent transitions to prevent duplicate audits (characterized and verified)
4. **Candidate route reconciliation**: 3 candidate routes reconcile and audit on every access, but only when transitions actually occur
5. **Unified reconciliation audit policy (P2D-J2.7)**: Any persisted exam.status change caused by reconciliation writes exactly one audit (`exam.open` or `exam.closed`), regardless of whether the entry point is an admin route or a candidate route. Admin mutating routes (close, extend, cancel, archive) now write reconciliation audits via `recordReconciliationAudit()`. Admin non-mutating routes (GET, PATCH) and rejection-path routes (unpublish, extend-rejected, cancel-rejected) do not write reconciliation audits because no persisted status change survives the transaction.
6. **14 characterization tests** in `apps/api/src/routes/examTransitions.test.ts`, all passing

---

## 1. Exam Status Transition Matrix

### Valid Transitions (from examStateMachine.ts)

| From Status | To Status | Trigger Type | Engine Function | Route Handler | Transaction | Lock | Audit Action | Idempotent | Error Code on Invalid |
|------------|-----------|--------------|-----------------|---------------|-------------|------|--------------|------------|----------------------|
| `draft` | `published` | Admin POST `/exams/:id/publish` | `publishExam()` | `exam.ts:575-620` | ❌ No | ❌ No | `exam.publish` | ❌ No | `EXAM_ALREADY_PUBLISHED` |
| `published` | `open` | Lazy reconciliation | `openExam()` | via `checkAndUpdateExamStatus()` | ✅ Yes* | ✅ Yes* | `exam.open` | ❌ No | `InvalidStateTransitionError` |
| `published` | `draft` | Admin POST `/exams/:id/unpublish` | `unpublishExam()` | `exam.ts:766-820` | ✅ Yes | ✅ Yes | `exam.unpublish` | ❌ No | `EXAM_UNPUBLISH_NOT_ALLOWED` |
| `published` | `canceled` | Admin POST `/exams/:id/cancel` | `cancelExam()` | `exam.ts:921-1015` | ✅ Yes | ✅ Yes | `exam.cancel` | ❌ No | `EXAM_CANCEL_NOT_ALLOWED` |
| `published` | `archived` | Admin POST `/exams/:id/archive` | `archiveExam()` | `exam.ts:1017-1107` | ✅ Yes | ✅ Yes | `exam.archive` | ❌ No | `EXAM_ARCHIVE_NOT_ALLOWED` |
| `open` | `closed` | Admin POST `/exams/:id/close` OR lazy reconciliation | `closeExam()` | `exam.ts:629-749` OR via reconciliation | ✅ Yes* | ✅ Yes* | `exam.close` | ✅ Yes (for closed) | `EXAM_CLOSE_NOT_ALLOWED` |
| `open` | `canceled` | Admin POST `/exams/:id/cancel` | `cancelExam()` | `exam.ts:921-1015` | ✅ Yes | ✅ Yes | `exam.cancel` | ❌ No | `EXAM_CANCEL_NOT_ALLOWED` |
| `closed` | `archived` | Admin POST `/exams/:id/archive` | `archiveExam()` | `exam.ts:1017-1107` | ✅ Yes | ✅ Yes | `exam.archive` | ❌ No | `EXAM_ARCHIVE_NOT_ALLOWED` |
| `canceled` | `archived` | Admin POST `/exams/:id/archive` | `archiveExam()` | `exam.ts:1017-1107` | ✅ Yes | ✅ Yes | `exam.archive` | ❌ No | `EXAM_ARCHIVE_NOT_ALLOWED` |

\* Transactions and locks apply when called via route handlers; reconciliation calls may be outside transactions.

### Transition Guards

| Handler | Guard Condition | Guard Location | Guard Throws |
|---------|-----------------|----------------|--------------|
| `publishExam` | Status must be `draft`, questions not empty, passingScore > 0, durationMinutes > 0, totalScore matches question scores | Engine (examCommands.ts:48-99) | `ValidationError` or `InvalidStateTransitionError` |
| `unpublishExam` | Reconciled status must be `published` | Route (exam.ts:799-801) | `ExamUnpublishNotAllowedError` |
| `closeExam` | Reconciled status must be `open` OR `closed`; unresolved attempts count = 0 | Route (exam.ts:696-705) | `ExamCloseNotAllowedError` (with `UNRESOLVED_ATTEMPTS_EXIST` detail) |
| `extendExam` | Reconciled status must be `open`; extendMinutes > 0 | Route (exam.ts:873-877) | `ExamExtendNotAllowedError` (with `ALREADY_CLOSED` or `NOT_OPEN` detail) |
| `cancelExam` | Reconciled status must be `published` or `open`; unresolved attempts count = 0 | Route (exam.ts:968-977) | `ExamCancelNotAllowedError` (with `UNRESOLVED_ATTEMPTS_EXIST` detail) |
| `archiveExam` | Reconciled status must be `published`, `closed`, or `canceled`; not already `archived` | Route (exam.ts:1073-1075) | `ExamArchiveNotAllowedError` |

### Audit Event Metadata

| Action | Metadata Fields | When Written |
|--------|-----------------|--------------|
| `exam.publish` | (none) | After successful transition |
| `exam.unpublish` | `fromStatus`, `toStatus` | After successful transition |
| `exam.close` | `reason` (optional), `fromStatus`, `toStatus`, `activeAttemptCount` | After successful transition, but NOT if `fromStatus === "closed"` (idempotent check) |
| `exam.extend` | `extendMinutes`, `oldCloseAt`, `newCloseAt`, `reason` (optional) | After successful transition |
| `exam.cancel` | `reason` (optional), `fromStatus`, `toStatus`, `activeAttemptCount` | After successful transition |
| `exam.archive` | `fromStatus`, `toStatus` | After successful transition, but NOT if `fromStatus === "archived"` (idempotent check) |
| `exam.open` | (none) | After lazy reconciliation, if transition occurred |
| `exam.closed` | (none) | After lazy reconciliation, if transition occurred |

---

## 2. Reconciliation Call-Site Matrix

| Call Site | Route / Handler | Transaction | Lock | Uses Reconciled Exam? | Writes Audit? | Possible Duplicate Audit? |
|-----------|-----------------|-------------|------|----------------------|----------------|---------------------------|
| `exam.ts:519` | PATCH `/exams/:id` | ✅ Yes (via `executeInTransaction`) | ✅ Yes (via `findByIdForUpdate`) | ✅ Yes (for state guard) | ❌ No | ❌ No |
| `exam.ts:687` | POST `/exams/:id/close` | ✅ Yes (via `executeInTransaction`) | ✅ Yes (via `findByIdForUpdate`) | ✅ Yes (for unresolved guard + mutation) | ❌ No (route writes audit separately) | ⚠️ Yes (if reconciliation triggered `open→closed`, route still writes `exam.close`) |
| `exam.ts:792` | POST `/exams/:id/unpublish` | ✅ Yes (via `executeInTransaction`) | ✅ Yes (via `findByIdForUpdate`) | ✅ Yes (for state guard) | ❌ No (route writes audit separately) | ⚠️ Yes (if reconciliation triggered `published→open`, candidate audit `exam.open` written, but unpublish rejected) |
| `exam.ts:867` | POST `/exams/:id/extend` | ✅ Yes (via `executeInTransaction`) | ✅ Yes (via `findByIdForUpdate`) | ✅ Yes (for state guard) | ❌ No (route writes audit separately) | ❌ No (extend only works on `open`, which cannot auto-transition to `closed` in same call) |
| `exam.ts:960` | POST `/exams/:id/cancel` | ✅ Yes (via `executeInTransaction`) | ✅ Yes (via `findByIdForUpdate`) | ✅ Yes (for unresolved guard + mutation) | ❌ No (route writes audit separately) | ⚠️ Yes (if reconciliation triggered `open→closed`, route still writes `exam.cancel`, but cancel guard rejects) |
| `exam.ts:1059` | POST `/exams/:id/archive` | ✅ Yes (via `executeInTransaction`) | ✅ Yes (via `findByIdForUpdate`) | ✅ Yes (for state guard + idempotent check) | ❌ No (route writes audit separately) | ⚠️ Yes (if reconciliation triggered `published→open` or `open→closed`, candidate audit written, but archive continues) |
| `attempts.candidate.ts:391` | GET `/attempts` (candidate exam list) | ❌ No | ❌ No | ✅ Yes (for enrollment/attempt logic) | ✅ Yes (conditional on `transition` field) | ❌ No (guarded by `if (transition)`) |
| `attempts.candidate.ts:517` | GET `/attempts/:examId` (candidate exam detail) | ❌ No | ❌ No | ✅ Yes (for enrollment/attempt logic) | ✅ Yes (conditional on `transition` field) | ❌ No (guarded by `if (transition)`) |
| `attempts.candidate.ts:644` | GET `/attempts/:examId/load` (start/restore attempt) | ❌ No | ❌ No | ✅ Yes (for enrollment/attempt logic) | ✅ Yes (conditional on `transition` field) | ❌ No (guarded by `if (transition)`) |

### Reconciliation Behavior Summary

**Auto-transitions performed by `checkAndUpdateExamStatus`:**
- `published → open` when `now >= openAt`
- `open → closed` when `now >= closeAt`

**Audit pattern (P2D-J2.7 unified policy):**
- All entry points: if reconciliation causes a persisted status change, exactly one audit (`exam.open` or `exam.closed`) is written
- Candidate routes: audit via `if (transition) { recordAudit(...) }`
- Admin mutating routes (close, extend, cancel, archive): audit via `recordReconciliationAudit()` after tx commits
- Admin non-mutating routes (GET, PATCH): no audit (reconciliation either doesn't run or tx rolls back on guard rejection)
- Double-transition edge case (`published→open→closed` in one pass): `recordReconciliationAudit` detects via `lockedStatus === "published" && transition === "closed"` and writes both `exam.open` and `exam.closed`

**Duplicate audit prevention:**
- **Close route**: If exam is `open` but `now >= closeAt`, reconciliation triggers `open→closed` (writes `exam.closed`), then closeExam is idempotent. The `exam.close` audit is suppressed by `if (fromStatus !== "closed")` check.
- **Unpublish route**: If exam is `published` but `now >= openAt`, reconciliation triggers `published→open`, then route guard rejects unpublish. Tx rolls back — no persisted change, no audit.
- **Cancel route**: If exam is `open` but `now >= closeAt`, reconciliation triggers `open→closed`, then cancelExam raises InvalidStateTransitionError. Tx rolls back — no persisted change, no audit. If exam is `published` and reconciliation does `published→open`, cancel proceeds — `exam.open` audit is written by `recordReconciliationAudit`, then `exam.cancel` by the explicit audit.
- **Archive route**: If reconciliation triggers `published→open→closed`, `recordReconciliationAudit` writes both `exam.open` and `exam.closed`. Archive then proceeds and writes `exam.archive`. The `if (fromStatus !== "archived")` check prevents duplicate archive audit.

**Race condition concern:**
- Admin routes hold row lock during reconciliation, so no concurrent operations can race
- Candidate routes do NOT hold row lock during reconciliation; multiple concurrent candidate reads could trigger duplicate reconciliation attempts (but last-write-wins on status update, and audit guarded by `transition` field)

---

## 3. Inconsistencies Found

### Inconsistency 1: Reconciliation Audit Inconsistency ✅ Resolved (P2D-J2.7)

**Location**: Admin routes vs candidate routes

**Issue**: Admin routes did NOT audit reconciliation transitions; candidate routes DID audit reconciliation transitions.

**Resolution (P2D-J2.7)**: Unified audit policy implemented. Any persisted exam.status change caused by reconciliation now writes exactly one audit (`exam.open` or `exam.closed`), regardless of entry point. Admin mutating routes (close, extend, cancel, archive) use `recordReconciliationAudit()` helper. Routes where reconciliation causes a tx rollback (unpublish, extend-rejected, cancel-rejected) do not write audit because the status change didn't persist.

**Implementation**: `recordReconciliationAudit()` in `exam.ts` handles the double-transition edge case (`published→open→closed` in one pass) by checking `lockedStatus === "published" && transition === "closed"` and emitting both `exam.open` and `exam.closed`.

### Inconsistency 2: Transaction Scope for Reconciliation

**Location**: Admin routes vs candidate routes

**Issue**: Admin routes reconcile inside transactions; candidate routes reconcile outside transactions.

**Evidence**:
- `exam.ts:506-562`: PATCH `/exams/:id` wraps reconciliation in `executeInTransaction`
- `attempts.candidate.ts:383-396`: GET `/attempts` calls reconciliation directly without transaction

**Impact**: Candidate routes can read stale data if concurrent admin operation is in-flight. Admin routes are safe due to row lock.

**Current behavior**: Candidate route reconciliation is read-then-write without atomicity guarantee.

**Follow-up**: Consider whether candidate route reconciliation should also be transactional (or at least use `SELECT FOR UPDATE` to prevent races).

### Inconsistency 3: Close Route Audit Idempotency vs Other Routes

**Location**: `exam.ts:739` vs other admin routes

**Issue**: Only close and archive routes explicitly check for idempotent transitions to suppress duplicate audits. Other routes (unpublish, extend, cancel) do not have this check.

**Evidence**:
- `exam.ts:739`: Close route checks `if (fromStatus !== "closed")` before writing audit
- `exam.ts:1099`: Archive route checks `if (fromStatus !== "archived")` before writing audit
- `exam.ts:814`: Unpublish route unconditionally writes audit
- `exam.ts:895`: Extend route unconditionally writes audit
- `exam.ts:1007`: Cancel route unconditionally writes audit

**Impact**: If `publishExam`, `unpublishExam`, `extendExam`, or `cancelExam` were made idempotent in the engine, the routes would write duplicate audits. Currently, these are NOT idempotent in the engine, so this is not a live bug, but it's an inconsistency in the route-level pattern.

**Current behavior**: Close and archive have defensive audit idempotency; others do not.

**Follow-up**: Either make all engine functions idempotent and add route-level checks, OR remove the checks from close/archive and rely on non-idempotent engine behavior consistently.

### Inconsistency 4: Transition Guard Split Between Engine and Route

**Location**: All admin routes

**Issue**: Some guards live in the engine (e.g., `publishExam` validates questions, scores, timing), while others live in the route (e.g., unresolved-attempts guard for close/cancel).

**Evidence**:
- `examCommands.ts:48-99`: `publishExam` validates business rules in engine
- `exam.ts:696-705`: Close route validates unresolved attempts (needs attempt repo, lives in route)
- `exam.ts:968-977`: Cancel route validates unresolved attempts (needs attempt repo, lives in route)

**Impact**: Transition logic is split across layers, making it harder to understand complete guard conditions for each transition.

**Current behavior**: Guards that only need exam data live in engine; guards that need other repos live in route.

**Follow-up**: This is intentional design (to keep engine dependency-free), but consider documenting all guard conditions for each transition in one place (e.g., exam-transitions.md).

---

## 4. Characterization Tests Added

### New Test File: `apps/api/src/routes/examTransitions.test.ts`

This test file characterizes current behavior across 14 tests (all passing):

1. **Published to Open Auto-Reconciliation (Candidate Route)**
   - `candidate exam list reconciles published -> open and writes exam.open audit`
   - `candidate start attempt reconciles published -> open`

2. **Open to Closed Auto-Reconciliation (Candidate Route)**
   - `candidate exam list reconciles open -> closed and writes exam.closed audit`

3. **Reconciliation Idempotency**
   - `repeated candidate access does not write duplicate exam.open audit`

4. **Close Route with Reconciliation (P2D-J2.7)**
   - `close after reconciliation triggers open->closed writes exam.closed audit (not exam.close)`

5. **Unpublish Route with Reconciliation**
   - `unpublish of a stale published (now open) exam is rejected -> 409`

6. **Extend Route with Reconciliation**
   - `extend of a stale open (now closed) exam is rejected -> 409 ALREADY_CLOSED`

7. **Cancel Route with Reconciliation**
   - `cancel of a stale open (now closed) exam is rejected -> 409`

8. **Archive Route with Reconciliation (P2D-J2.7)**
   - `archive after reconciliation (published->open->closed) writes exam.open, exam.closed, and exam.archive audits`
   - `archive idempotency: already-archived returns 200 with NO duplicate audit`

9. **Audit Behavior Characterization (P2D-J2.7)**
   - `successful close writes exam.close audit with fromStatus/toStatus metadata`
   - `admin GET (non-mutating) does not reconcile; candidate list does`
   - `admin extend on stale-published reconciles and writes exam.open audit`
   - `admin cancel on stale-published reconciles and writes exam.open audit`

All tests are **characterization tests** that document current behavior without prescribing what it should be. Any behavior changes in the future would require updating these tests (with explicit justification).

---

## 5. Recommended Follow-Up

### 5.1 Centralize Reconciliation Call Pattern ✅ Resolved (P2D-J2.7)

**Decision**: Adopted Option B variant — keep current route-level pattern, but standardize audit behavior via `recordReconciliationAudit()` helper. Admin mutating routes (close, extend, cancel, archive) now write reconciliation audits consistently. No large helper extraction (`executeReconciliation` or `executeExamTransition`) was needed.

### 5.2 Extract executeExamTransition

**Status**: Deferred. The repeated `lock → reconcile → guard → assert → mutate → audit` pattern is not duplicated enough to justify a large abstraction. The `recordReconciliationAudit()` helper addresses the audit consistency need without restructuring route control flow.

### 5.3 Reconciliation Audit Policy ✅ Resolved (P2D-J2.7)

**Decision**: Audit all reconciliations that cause a persisted status change. Implementation: `recordReconciliationAudit()` in admin routes + existing `if (transition)` pattern in candidate routes. Reconciliation audits use action names `exam.open` / `exam.closed` (matching candidate route convention), distinct from explicit transition audits (`exam.close`, `exam.cancel`, etc.).

### 5.4 Transaction Scope for Candidate Routes

**Recommendation**: Evaluate whether candidate route reconciliation should be transactional.

**Considerations**:
- Current behavior: candidate routes can read stale data during concurrent admin ops
- Fixing: wrap reconciliation in transaction with row lock
- Tradeoff: adds overhead to every candidate exam access

**Decision needed**: Is the race condition acceptable given the use case (candidate access timing windows)?

---

## 6. Test Results

### Commands Run

```bash
# Run all API tests
pnpm --filter @exam/api test

# Run verification (lint, typecheck, etc.)
pnpm verify
```

### Results

```
pnpm --filter @exam/api test

 Test Files  55 passed (55)
      Tests  572 passed (572)
   Duration  117.05s
```

```
pnpm format:check   → All matched files use Prettier code style!
pnpm lint           → Code quality checks passed.
pnpm lint:copy      → No hardcoded business copy found.
pnpm lint:arch      → Architecture checks passed.
pnpm typecheck      → 15 successful, 15 total
pnpm build          → 8 successful, 8 total
```

All verification steps pass. The 12 new characterization tests are included in the 572 passing tests.

---

## 7. Appendix: State Machine Diagram

```
┌─────────────┐
│    draft    │
└──────┬──────┘
       │
       │ publish (admin action)
       ▼
┌─────────────┐     openAt reached     ┌─────────────┐
│  published  │──────────────────────▶│     open     │
└──────┬──────┘  (lazy reconciliation)  └──────┬──────┘
       │                                     │
       │ cancel (admin action)               │ closeAt reached
       │ unpublish (admin action)            │ (lazy reconciliation)
       │                                     ▼
       │                              ┌─────────────┐
       │                              │   closed    │
       │                              └──────┬──────┘
       │                                     │
       │                                     │ close (admin action)
       │                                     │ cancel (admin action) [rejected]
       │                                     ▼
       │                              ┌─────────────┐
       └────────────────────────────▶│  canceled   │
                                      └──────┬──────┘
                                             │
                                             │ archive (admin action)
                                             ▼
                                      ┌─────────────┐
                                      │  archived   │
                                      └─────────────┘

Notes:
- draft cannot directly transition to open, closed, canceled, or archived
- published can transition to: open (lazy), draft (unpublish), canceled, archived
- open can transition to: closed (lazy or admin), canceled
- closed can transition to: archived
- canceled can transition to: archived
- archived is terminal (no transitions out)
- extend is NOT a status transition (open→open with closeAt change)
```

---

## 8. References

- **Exam state machine**: `packages/exam-engine/src/examStateMachine.ts`
- **Exam command implementations**: `packages/exam-engine/src/examCommands.ts`
- **Admin routes**: `apps/api/src/routes/exam.ts`
- **Candidate routes**: `apps/api/src/routes/attempts.candidate.ts`
- **Audit implementation**: `apps/api/src/routes/audit.ts`
- **ADR-005**: Slice 1 (close), Slice 2 (unpublish/extend), Slice 4 (cancel)