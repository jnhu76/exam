# P2D-J2.6 Exam Transition/Reconciliation Audit Report

## Summary

This audit examines all exam state transition handlers and reconciliation logic in the exam platform, focusing on understanding current behavior patterns before any refactoring. The audit identified **6 state transition handlers**, **1 reconciliation function**, and **9 call sites** across the codebase.

### Key Findings

1. **Consistent ADR-005 pattern**: All admin routes (close, unpublish, extend, cancel, archive) follow the `lock → reconcile → guard → assert → mutate → audit` pattern inside transactions
2. **Reconciliation spread**: `checkAndUpdateExamStatus` is called from 9 locations (6 admin routes + 3 candidate routes) with inconsistent audit handling
3. **Audit duplication prevention**: Close and archive routes explicitly check for idempotent transitions to prevent duplicate audits (characterized and verified)
4. **Candidate route reconciliation**: 3 candidate routes reconcile and audit on every access, but only when transitions actually occur
5. **Audit asymmetry (characterized)**: Candidate routes DO write `exam.open`/`exam.closed` audit on lazy reconciliation; admin routes do NOT write reconciliation audits. This is verified by the `candidate reconciliation writes exam.open audit (admin routes do NOT)` characterization test.
6. **12 characterization tests added** in `apps/api/src/routes/examTransitions.test.ts`, all passing

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

**Audit pattern:**
- Candidate routes: audit only if `transition` is truthy (i.e., a status change occurred)
- Admin routes: no audit from reconciliation; route writes explicit audit for the admin action

**Duplicate audit risk analysis:**
- **Close route**: If exam is `open` but `now >= closeAt`, reconciliation triggers `open→closed`, then route still attempts `open→closed` (idempotent) and writes `exam.close`. Route has idempotent check at line 739 (`if (fromStatus !== "closed")`) to prevent this.
- **Unpublish route**: If exam is `published` but `now >= openAt`, reconciliation triggers `published→open`, then route guard rejects unpublish (line 799-801). No duplicate audit.
- **Cancel route**: If exam is `open` but `now >= closeAt`, reconciliation triggers `open→closed`, then route guard rejects cancel (line 973). No duplicate audit.
- **Archive route**: If reconciliation triggers `published→open` or `open→closed`, audit is written for the auto-transition. Route has idempotent check at line 1099 (`if (fromStatus !== "archived")`) to prevent duplicate `exam.archive` audit.

**Race condition concern:**
- Admin routes hold row lock during reconciliation, so no concurrent operations can race
- Candidate routes do NOT hold row lock during reconciliation; multiple concurrent candidate reads could trigger duplicate reconciliation attempts (but last-write-wins on status update, and audit guarded by `transition` field)

---

## 3. Inconsistencies Found

### Inconsistency 1: Reconciliation Audit Inconsistency

**Location**: Admin routes vs candidate routes

**Issue**: Admin routes do NOT audit reconciliation transitions; candidate routes DO audit reconciliation transitions.

**Evidence**:
- `attempts.candidate.ts:398-407`: Candidate route writes `exam.open` or `exam.closed` audit on auto-transition
- `exam.ts:519-524`: Admin PATCH route does not write audit on reconciliation
- `exam.ts:687-692`: Admin close route does not write audit on reconciliation (relies on explicit close audit)

**Impact**: If an exam auto-transitions from `published→open` via candidate access, only candidate-triggered audits exist. If admin later manually closes it, both `exam.open` (from reconciliation) and `exam.close` (from admin action) are logged. If exam never accessed by candidates but transitions via admin operation, the auto-transition is not audited.

**Current behavior**: Inconsistent audit trail for lazy state transitions.

**Follow-up**: Decide whether to audit all reconciliations consistently (either always or never), and if always, where to place the audit (engine vs route, inside vs outside transaction).

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

This test file characterizes current behavior across 12 tests (all passing):

1. **Published to Open Auto-Reconciliation (Candidate Route)**
   - `candidate exam list reconciles published -> open and writes exam.open audit`
   - `candidate start attempt reconciles published -> open`

2. **Open to Closed Auto-Reconciliation (Candidate Route)**
   - `candidate exam list reconciles open -> closed and writes exam.closed audit`

3. **Reconciliation Idempotency**
   - `repeated candidate access does not write duplicate exam.open audit`

4. **Close Route with Reconciliation**
   - `close after reconciliation triggers open->closed writes NO exam.close audit (fromStatus=closed)`

5. **Unpublish Route with Reconciliation**
   - `unpublish of a stale published (now open) exam is rejected -> 409`

6. **Extend Route with Reconciliation**
   - `extend of a stale open (now closed) exam is rejected -> 409 ALREADY_CLOSED`

7. **Cancel Route with Reconciliation**
   - `cancel of a stale open (now closed) exam is rejected -> 409`

8. **Archive Route with Reconciliation**
   - `archive after reconciliation (published->open->closed) succeeds and writes exam.archive audit`
   - `archive idempotency: already-archived returns 200 with NO duplicate audit`

9. **Audit Behavior Characterization**
   - `successful close writes exam.close audit with fromStatus/toStatus metadata`
   - `candidate reconciliation writes exam.open audit (admin routes do NOT)`

All tests are **characterization tests** that document current behavior without prescribing what it should be. Any behavior changes in the future would require updating these tests (with explicit justification).

---

## 5. Recommended Follow-Up

### 5.1 Centralize Reconciliation Call Pattern

**Recommendation**: Consider extracting a common helper function that wraps `checkAndUpdateExamStatus` with consistent transaction and audit behavior.

**Options**:

**Option A**: Create `executeReconciliation(repo, examId, now, options)` that:
- Takes an `options` object with flags: `{ audit: boolean | "auto" | "never" }`
- Wraps the reconciliation in a transaction if needed
- Writes audit with consistent metadata
- Returns both the exam and whether an audit was written

**Option B**: Keep current pattern but standardize on:
- Admin routes: no audit from reconciliation (explicit audit for admin action)
- Candidate routes: audit auto-transitions
- Document this decision clearly

**Decision needed**: Do we want to audit lazy transitions? If yes, where and how?

### 5.2 Extract executeExamTransition

**Recommendation**: The repeated `lock → reconcile → guard → assert → mutate → audit` pattern in admin routes (exam.ts) could be extracted into `executeExamTransition(repo, examId, command, options)`.

**Benefits**:
- Eliminates code duplication across close, unpublish, extend, cancel, archive routes
- Centralizes transaction and lock management
- Makes it easier to add new transition commands
- Consistent error handling and audit behavior

**Risks**:
- May obscure route-specific guard conditions (e.g., unresolved-attempts guard)
- Needs careful design to avoid over-abstraction
- Would be a breaking change for existing tests

**Decision needed**: Is the duplication high enough to justify extraction? Can we design a clean abstraction that preserves clarity?

### 5.3 Bugfix PR for Inconsistency #1 (Reconciliation Audit)

**Recommendation**: File a separate issue to decide on reconciliation audit policy, then implement consistently.

**Decision needed**:
- Audit all reconciliations (engine or route)?
- Audit no reconciliations (rely only on explicit actions)?
- Audit only candidate-triggered reconciliations (current behavior)?

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