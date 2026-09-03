# P1 Manual Grading Operator Reality Audit

Audit date: 2026-07-30
Branch: master (HEAD 32a81ad6)
Auditor: ZCode Reality Audit

## 1. Executive Verdict

**The manual grading system is safe for production use as a one-time irrevocable scoring model, but the current frontend creates a P1-class UX semantic mismatch that risks operator confusion and data-entry errors.**

The backend data authority chain, state machine, concurrency protection, and audit logging are well-engineered. The core vulnerability is not in the backend — it is in the gap between what the UI communicates ("保存" = save draft) and what actually happens (one-time irrevocable score submission). This gap, combined with the absence of post-submission feedback, could cause operators to believe they are drafting when they are committing, or to think a save failed when it actually succeeded.

### Findings Summary

| Severity | Count |
| -------- | ----: |
| P0       | 0     |
| P1       | 5     |
| P2       | 6     |
| Deferred | 5     |

### Three Most Important Findings

1. **P1: Button says "保存" but operation is one-time irrevocable.** The backend rejects any second call to `grade-question` for the same entry (409). But the UI button says "保存" (save) — a label that implies draft-saving or reversible persistence. An operator who has not been explicitly told that manual grading is one-way is likely to click "保存" expecting to draft, and will be surprised (and may lose data) when a second edit is rejected.

2. **P1: No entry-level read-only feedback after successful save.** After a successful `grade-question`, the page updates only the top-level `gradingStatus` badge. The per-question entry (score, comment, gradedBy, gradedAt) is **not** updated in the UI. The input remains editable, and the `gradedBy`/`gradedAt` labels are not shown. A page reload does restore the correct state, but within the same session the operator sees no confirmation that the question was graded.

3. **P1: Score input initializes to 0 for ungraded questions, conflating "not graded" with "scored 0".** The frontend initializes `scores[questionId] = q.entry?.score ?? 0` (GradingDetailPage.tsx:140). For a pending (ungraded) question, `entry` is null, so the input shows `0`. An operator who submits without typing a score will POST `score: 0`. The backend accepts this as a valid score. There is no way to distinguish "this question was intentionally scored 0" from "this question was accidentally submitted without being read."

---

## 2. Audited Scope and Evidence

### Files Inspected

| File | Role |
|------|------|
| `packages/exam-engine/src/manualGrading.ts` | Core command: `gradeQuestion` |
| `packages/exam-engine/src/grading.ts` | Terminal closure: `finalizeTerminalGrading`, `finalizeGrading` |
| `packages/exam-engine/src/gradingWorkset.ts` | Workset materialization, aggregation, validation |
| `packages/exam-engine/src/lockSeam.ts` | Transaction-affine locking seam |
| `apps/api/src/routes/gradingQueue.ts` | API routes: queue, details, grade-question |
| `packages/db/src/repository/attemptGradingEntryRepo.ts` | DB repository for grading entries |
| `packages/db/src/repository/gradingQueueRepo.ts` | DB repository for queue queries |
| `packages/contracts/src/score.ts` | Zod schemas for grading request/response |
| `packages/domain/src/types.ts` | Domain types: AttemptGradingEntry, etc. |
| `packages/domain/src/enums.ts` | Enums: GradingStatus, GradingEntryMode, GradingEntryStatus |
| `packages/domain/src/errors.ts` | Domain error types |
| `packages/domain/src/gradingEngine.ts` | Domain grading functions (gradeQuestion, isManualGradedQuestion) |
| `packages/authz/src/catalog.ts` | Permission catalog |
| `packages/authz/src/presets.ts` | Role preset permissions |
| `packages/authz/src/auditActions.ts` | Audit action constants |
| `apps/web/src/pages/admin/GradingQueuePage.tsx` | Grading queue list page |
| `apps/web/src/pages/admin/GradingDetailPage.tsx` | Grading detail page (per-question scoring) |
| `apps/web/src/i18n/locales/zh-CN.ts` | i18n Chinese locale |
| `apps/e2e/e2e/manual-grading.spec.ts` | E2E browser test |
| `packages/db/src/schema/pg.ts` | DB schema (attemptGradingEntries table) |

### Test Files Inspected

| File | Tests | Status |
|------|-------|--------|
| `apps/api/src/routes/gradingQueue.test.ts` | 30+ | ✅ All pass |
| `apps/api/src/routes/attempts/manualGradingClosure.test.ts` | 6 | ✅ All pass |
| `apps/api/src/routes/attempts/gradingConcurrency.test.ts` | 4+ | ✅ All pass |
| `apps/api/src/authz/permissionMatrix.grading.test.ts` | 5 | ✅ All pass |
| `apps/api/src/runtime/gradingArchitecture.structural.test.ts` | 12 | ✅ All pass |
| `packages/exam-engine/src/manualGradingCompletion.test.ts` | 15 | ✅ All pass |
| `packages/exam-engine/src/grading.test.ts` | 19 | ✅ All pass |
| `packages/exam-engine/src/gradingWorkset.test.ts` | 19 | ✅ All pass |
| `packages/exam-engine/src/gradingAggregation.test.ts` | 18 | ✅ All pass |
| `packages/exam-engine/src/gradingScoreIdentity.test.ts` | 4 | ✅ All pass |
| `packages/exam-engine/src/gradingPoison.test.ts` | 5 | ✅ All pass |
| `packages/exam-engine/src/gradingEngine.test.ts` | 28 | ✅ All pass |
| `packages/exam-engine/src/manualGradingHold.test.ts` | 7 | ✅ All pass |
| `apps/web/src/pages/admin/GradingQueuePage.test.tsx` | 7 | ✅ All pass |
| `apps/web/src/pages/admin/GradingDetailPage.test.tsx` | 33 | ✅ All pass |
| `apps/e2e/e2e/manual-grading.spec.ts` | 1 (browser) | E2E not run locally |

### Actual Test Results (2026-07-30)

```
API tests:       130 files, 1656 passed, 5 skipped
Engine tests:     26 files, 483 passed
Web unit tests:    2 files,  40 passed (grading pages)
Authz tests:       1 file,    5 passed (grading permission matrix)
```

---

## 3. Current End-to-End Grading Flow

### Data Authority Chain

```
Candidate submits exam
  → submitted_answers frozen (immutable snapshot of all answers)
  → questionSnapshot frozen (immutable at attempt creation)
  → materializeGradingWorkset creates attempt_grading_entries:
      - objective questions: completed_auto (with earnedScore from auto-grader)
      - text_response questions: pending_manual (earnedScore = null)
  → attempt.gradingStatus = pending_manual

Admin opens grading queue
  → GET /admin/grading-queue
  → reads pending_manual entries from attempt_grading_entries
  → queue work is driven by durable rows, NOT by questionSnapshot rescanning

Admin opens grading detail
  → GET /admin/attempts/:id/grading-details
  → question metadata from questionSnapshot (frozen)
  → candidateAnswer from attempt_grading_entries entry (frozen at submit)
  → standardAnswer / rubric from questionSnapshot (frozen)

Admin submits score for one question
  → POST /admin/attempts/:id/grade-question
  → gradeQuestion() in transaction with FOR UPDATE lock:
      1. Validate attempt.status === submitted
      2. Validate attempt.gradingStatus === pending_manual
      3. Load entry by (attemptId, questionId) — fail closed if missing
      4. Reject if entry.gradingMode !== manual
      5. Reject if entry.status !== pending_manual
      6. Validate 0 ≤ score ≤ entry.maxScore
      7. UPDATE entry: pending_manual → completed_manual
      8. Count remaining pending_manual entries
      9. If 0: finalizeTerminalGrading() → writes attempt + enrollment in same tx
      10. Record audit events (grading.score_entered, optionally grading.finalized)

Terminal closure (finalizeTerminalGrading):
  → assert transaction-affinity (capability check)
  → Re-read attempt (REPEATABLE READ sees prior writes)
  → If already graded → return false (idempotent no-op)
  → Validate submitted → graded transition is legal
  → Read all entries via aggregateGradingEntries (validates terminality)
  → Write attempt: status=graded, score, passed, gradingResult, gradingStatus
  → Re-read enrollment (lock held by capability)
  → Apply scoreStrategy (highest/latest/first)
  → Write enrollment: finalScore, finalPassed, finalAttemptId, status
```

### Key Properties

- **One source of grading truth**: `attempt_grading_entries` table. No fallback to `attempt.answers`, `attempt.gradingResult`, or live questions.
- **One canonical aggregation path**: `aggregateGradingEntries()` — every production path that persists `attempt.score` flows through here.
- **No second score write path**: `gradeQuestion` delegates to `finalizeTerminalGrading` for terminal projection. The auto path (`finalizeGrading`) also goes through `finalizeTerminalGrading`.
- **Workset is created at submit-freeze time**: `materializeGradingWorkset` is called in the submit transaction. No lazy creation, no questionSnapshot rescanning.
- **Queue is entry-driven**: The queue lists attempts that have `grading_mode=manual AND status=pending_manual` entries. An attempt with `gradingStatus=pending_manual` but zero entries is invisible to the queue.

---

## 4. Authority and State-Machine Findings

### 4.1 Current Scoring Model

**One-time irrevocable completion per question.** The model is:

- Each question is graded once: `pending_manual → completed_manual`
- No draft mode, no revision, no reopen
- No "editable until finalized" — the moment you click save, the score is committed
- The last question's completion triggers automatic terminal finalization (no separate finalize step)

This is **not** documented anywhere in the UI. The button says "保存" (save), which in Chinese commonly means "save draft" or "save for later". The discrepancy is a UX semantic mismatch.

### 4.2 State Machine Answers

**Q: Current scoring model?**
One-time irrevocable completion per question. `pending_manual → completed_manual` is one-way. The attempt transitions from `submitted + pending_manual` to `graded + fully_graded` when the last manual question is scored.

**Q: Can the same request be retried after grade-question succeeds?**
No. The backend rejects any second call for the same `(attemptId, questionId)` with 409. Both same-score and different-score retries are rejected. The frontend does not enforce this before sending the request.

**Q: Can a completed question be modified after the attempt is fully graded?**
No. The entry status guard (`entry.status !== "pending_manual"`) rejects all modification attempts regardless of attempt-level state. This is verified by tests (gradingQueue.test.ts Slice 14, Slice 3C).

**Q: Is there a reopen/revision/review process?**
No. This is categorically deferred (not a defect).

**Q: Does the last question auto-finalize?**
Yes. When `countPendingManualForAttempt` returns 0 after the UPDATE, `gradeQuestion` calls `finalizeTerminalGrading` in the same transaction. No separate finalize step or permission is needed.

**Q: Are attempt and enrollment updated in the same transaction?**
Yes. `finalizeTerminalGrading` writes both `exam_attempts` and `exam_enrollments` in the same transaction, holding the FOR UPDATE lock on both rows.

**Q: Are audit events in the same transaction?**
Yes. The route handler calls `recordAtomicHttpAudit` inside the SAME `executeInTransaction` callback, so the audit write is atomic with the grading data.

---

## 5. Findings

### P0 (0 findings)

No P0 findings. The backend data authority chain, concurrency protection, and audit logging are correct. No error-grade, data-leakage, or cross-tenant violation scenarios were found.

### P1 (5 findings)

#### P1-1: Button label "保存" contradicts one-time irrevocable nature

**File**: `apps/web/src/i18n/locales/zh-CN.ts` (line ~1700: `save: "保存"`)
**Engine**: `packages/exam-engine/src/manualGrading.ts` (lines 147-153: entry status guard rejects re-grades)

**Problem**: The button says "保存" (save). In Chinese web applications, "保存" typically implies draft-saving — the data is persisted but can be edited later. The actual backend behavior is one-time irrevocable completion. A grader who expects to "save and continue later" will be surprised when the second edit is rejected with 409.

**Risk**: P1 — operator confusion. An operator may lose data by expecting to edit later, or may not realize the score is final.

**Recommendation**: Change the button label to "提交评分" (submit score) or "确认评分" (confirm score). Add a confirmation dialog. Add a tooltip or inline note explaining that scoring is one-time and irreversible.

#### P1-2: No per-question entry feedback after successful save

**File**: `apps/web/src/pages/admin/GradingDetailPage.tsx` (lines 179-186)

**Problem**: After a successful `grade-question` POST, the page only updates `gradingStatus` at the top level. The per-question `entry` (score, comment, gradedBy, gradedAt) is **not** updated in the UI. The input remains editable, and the `gradedBy`/`gradedAt` labels are not shown. A page reload restores the correct state, but within the same session the operator sees no confirmation that the question was graded.

**Code evidence**:
```typescript
// handleSave only updates gradingStatus at top level:
setData((prev) =>
  prev ? { ...prev, gradingStatus: result.gradingStatus } : prev,
);
// It does NOT update the specific question's entry in the questions array.
```

**Risk**: P1 — operator may think the save failed and retry, getting a 409. Or may not realize which questions have been graded.

**Recommendation**: After a successful save, update the specific question's entry in the local state (set `entry: { score, comment, gradedBy, gradedAt }`) and show the graded indicator.

#### P1-3: Score input initializes to 0 for ungraded questions, conflating "not graded" with "scored 0"

**File**: `apps/web/src/pages/admin/GradingDetailPage.tsx` (lines 139-140)
```typescript
initialScores[q.questionId] = q.entry?.score ?? 0;
```

**Problem**: For a pending (ungraded) question, `entry` is null, so `initialScores[q.questionId]` is set to `0`. The input shows `0`. If the operator submits without typing, the POST sends `score: 0`, which the backend accepts as valid. There is no way to distinguish "intentionally scored 0" from "accidentally submitted without reading."

**Risk**: P1 — data integrity concern. An operator could submit a 0 score for a question they never read.

**Recommendation**: Initialize the score input to empty string for ungraded questions. The backend already rejects `NaN`/`undefined` but accepts `0`. The frontend should require explicit input before allowing submission. The schema already has `z.number().min(0)` so the backend accepts 0; the fix is purely frontend.

#### P1-4: No confirmation dialog before score submission

**File**: `apps/web/src/pages/admin/GradingDetailPage.tsx` (lines 156-194, `handleSave`)

**Problem**: Clicking "保存" immediately sends the POST request. There is no confirmation dialog, no "are you sure?", no indication that this action is irreversible. Combined with the misleading button label, this creates a high-probability mis-click scenario.

**Risk**: P1 — operator error.

**Recommendation**: Add a confirmation dialog before submitting the score. The dialog should show the question content, the score being submitted, and a clear statement that scoring is irreversible.

#### P1-5: Backend 409 responses are not discriminated in the frontend

**File**: `apps/web/src/pages/admin/GradingDetailPage.tsx` (lines 187-189)
```typescript
catch {
  toast.error(t("admin.gradingDetail.errors.saveFailed"));
}
```

**Problem**: The frontend catches all errors and shows a generic "保存失败，请重试" (save failed, please retry). The backend can return 409 for multiple distinct reasons:
- Attempt is not in `submitted + pending_manual` state (e.g., already graded)
- Entry is already `completed_manual` (already graded)
- Entry is `auto` mode (not a manual question)
- Entry not found (missing workset)

The most common 409 scenario — "already graded" — should be handled differently from a transient failure. The current generic message encourages the operator to retry, which will also fail with 409.

**Risk**: P1 — operator confusion. The operator may think the system is broken or that they need to retry.

**Recommendation**: Parse the 409 response body for the error code and show a specific message. For `INVALID_STATE_TRANSITION` with "already graded" semantics, show "此题已评分，无需重复提交" (this question has already been scored, no need to re-submit).

### P2 (6 findings)

#### P2-1: `completeManualEntry` SQL UPDATE has no `status = pending_manual` WHERE guard

**File**: `packages/db/src/repository/attemptGradingEntryRepo.ts` (lines 167-192)

**Problem**: The SQL UPDATE that sets `status = completed_manual` does not include `AND status = pending_manual` in the WHERE clause. The state guard is entirely in the `gradeQuestion` command function (the engine layer). If the engine guard were ever bypassed or had a bug, the SQL would silently overwrite a `completed_manual` entry.

**Risk**: P2 — defense-in-depth. The engine guard is correct today, but the SQL layer provides no additional protection.

**Recommendation**: Add `AND status = 'pending_manual'` to the UPDATE WHERE clause so the SQL layer also enforces the transition. Check `updated.length === 0` and throw if no rows matched.

#### P2-2: Grading detail page does not show `gradedBy`/`gradedAt` for completed entries

**File**: `apps/web/src/pages/admin/GradingDetailPage.tsx` (lines 315-318)

**Problem**: When `q.entry` is non-null, the page shows only `"已评分: {{score}} 分"` (graded: {{score}} points). It does not show who graded it (`gradedBy`) or when (`gradedAt`). This is an audit/transparency gap.

**Risk**: P2 — missing audit visibility for operators.

**Recommendation**: Display `gradedBy` (grader name, resolved from user ID) and `gradedAt` in the graded entry display.

#### P2-3: E2E test only covers single-subjective-question happy path

**File**: `apps/e2e/e2e/manual-grading.spec.ts`

**Problem**: The E2E test covers only one text_response question. It does not test:
- Two subjective questions, partially graded, then page refresh
- Network failure recovery
- Concurrent grading scenarios
- Empty score submission
- Score 0 submission

**Risk**: P2 — E2E coverage gap. The API-level tests cover these scenarios, but the browser-level E2E does not.

**Recommendation**: Add E2E scenarios for partial grade recovery (grade one of two, refresh, grade the second), and for score 0 explicit submission.

#### P2-4: Frontend does not re-fetch grading details after a failed POST

**File**: `apps/web/src/pages/admin/GradingDetailPage.tsx` (lines 187-189)

**Problem**: When a POST fails (network error, 409, 500), the frontend does not re-fetch the grading details to reconcile state. The operator may be looking at stale data. If the POST actually succeeded on the server but the response was lost, the operator sees a "save failed" error while the data is actually committed.

**Risk**: P2 — network uncertainty. The operator cannot distinguish "server rejected" from "server accepted but response lost."

**Recommendation**: On POST failure, automatically re-fetch the grading details to reconcile. Parse the 409 response to distinguish "already committed" from "real conflict." Show appropriate messaging.

#### P2-5: `grading.answer.view` and `grading.identity.view` permissions exist but are not independently enforced

**File**: `apps/api/src/routes/gradingQueue.ts` (lines 128-136, grading-details route)
**File**: `packages/authz/src/catalog.ts` (lines 98-105)

**Problem**: The permission catalog defines `grading.answer.view` and `grading.identity.view` as separate permissions. However, the grading-details route is gated by a single `GradingDetailView` permission, which implicitly grants both answer and identity access. There is no route that checks `GradingAnswerView` or `GradingIdentityView` independently.

Currently this is not a vulnerability because:
- Admin has both permissions anyway
- Grader has both permissions anyway
- Teacher has no grading permissions at all
- Candidate cannot access the route

**Risk**: P2 (future). If scoped Grader roles are introduced (M11) where some graders should see answers but not identities, the current implementation would not enforce the separation.

**Recommendation**: Document this as a known limitation. The route-level enforcement will need to be split when M11 scoped grading is implemented.

#### P2-6: Grading queue page has no search/filter by exam or candidate name

**File**: `apps/web/src/pages/admin/GradingQueuePage.tsx`

**Problem**: The grading queue page supports an optional `examId` query parameter but does not expose a UI filter. The list is paginated but unsorted (ordered by `submittedAt` ascending). There is no search by candidate name. In a deployment with many pending attempts, this makes it hard to find specific work.

**Risk**: P2 — operational efficiency. Not a correctness issue.

**Recommendation**: Add exam filter dropdown and candidate name search to the queue page.

### Deferred (5 findings)

#### D-1: No reopen/revision workflow

The current one-time scoring model does not support revision. This is a deliberate product decision, not a defect. A reopen/review/revision workflow is deferred to a future phase.

#### D-2: No double-blind/anonymous grading

`grading.identity.view` exists in the catalog but is not independently enforced. Anonymous grading (hiding candidate identity from the grader) is deferred.

#### D-3: No grading task assignment (M11)

There is no per-exam or per-attempt grading task assignment. All graders with the `GradingQueueView` permission see the same global queue. This is documented as M11 deferred.

#### D-4: No rubric-based auto-scoring

The rubric is stored as a plain text string on the `QuestionSnapshot` and displayed to the grader. No rubric-based auto-scoring or rubric-guided scoring UI exists.

#### D-5: No batch grading

There is no batch-select-and-score functionality. Each question is graded individually. This is appropriate for the current MVP.

---

## 6. Authorization Matrix

| Route | Permission Check | Admin | Teacher | Grader | Candidate |
|-------|-----------------|-------|---------|--------|-----------|
| `GET /admin/grading-queue` | `GradingQueueView` | ✅ | ❌ | ✅ | ❌ (403) |
| `GET /admin/attempts/:id/grading-details` | `GradingDetailView` | ✅ | ❌ | ✅ | ❌ (403) |
| `POST /admin/attempts/:id/grade-question` | `GradingScoreWrite` | ✅ | ❌ | ✅ | ❌ (403) |

**Notes:**
- Teacher role explicitly does NOT have grading permissions (per `packages/authz/src/presets.ts` line 141: `// Explicitly NOT granted: GradingAnswerView, GradingScoreWrite`)
- Candidate sees 403 on all grading routes (confirmed by test `gradingQueue.test.ts` Slice 3)
- Grading routes are Admin-only in the `x-role` schema annotation, but the actual RBAC check uses `requireCapability`/`requireScopedCapability`, which is role-agnostic
- The `grading-details` and `grade-question` routes use `requireScopedCapability` with an attempt resolver, which provides resource-scoped access control
- `grading.finalize` and `grading.identity.view` are in the catalog but have no route consumers — they are reserved for M11
- Cross-tenant isolation is enforced by `organizationId` filtering in all repository methods (confirmed by test `gradingQueue.test.ts` Slice 3N)

### Permission Boundary Gaps

1. **`grading.answer.view` is not independently enforced**: The grading-details route returns candidate answers for all manual-mode questions without checking this permission separately. Currently all graders get answer access.

2. **`grading.identity.view` is not independently enforced**: The grading-details route returns `candidateName` without checking this permission. Currently all graders see candidate identities.

Both gaps are acceptable today because:
- Admin has both permissions
- Grader has both permissions
- Only Admin and Grader roles have access to grading routes
- Teacher/Candidate cannot access grading routes

These become actual vulnerabilities only when M11 introduces scoped Grader assignments with finer-grained permissions.

---

## 7. Recovery and Concurrency Analysis

### 7.1 Network Failure Scenarios

**Scenario: Client POSTs score → server commits → response lost in transit**

- **Idempotency key**: The API does NOT have an `operationId` / idempotency key on `grade-question`.
- **Safe retry**: The same request is NOT safe to retry. The backend will reject it with 409 (entry already `completed_manual`). But the frontend shows a generic "保存失败，请重试" error, which encourages the operator to retry — and they will see 409.
- **Reconciliation**: The frontend does NOT re-fetch grading details after a POST failure. The operator cannot distinguish "server rejected" from "server accepted but response lost."
- **Duplicate finalize**: `finalizeTerminalGrading` has an idempotency guard (`if attempt.status === "graded" → return false`), so duplicate finalization is prevented. However, the entry-level guard fires first, so the retry fails at the entry level, not at the closure level.
- **Wrong total score**: Not possible. The one-time entry model prevents double-writes.

**Risk classification**: P1 (user confusion, but data integrity is preserved).

**Recommendation**: Add a response-loss reconciliation pattern: on POST failure, re-fetch grading details. If the entry is now `completed_manual`, show success message instead of error.

### 7.2 Concurrent Grading Scenarios

**Scenario 1: Two graders grade the SAME question simultaneously**

- The route wraps everything in `executeInTransaction` with `lockEnrollmentAndAttempt` (FOR UPDATE on enrollment + attempt rows).
- Both graders hold the lock sequentially. The first grader reads the entry as `pending_manual`, updates it to `completed_manual`, and commits.
- The second grader reads the entry as `completed_manual` (after the lock is released), the engine guard rejects it with `InvalidStateTransitionError` (409).
- **Result**: Exactly one grader succeeds. The other gets 409. No lost update, no duplicate score.
- **Tested**: `manualGradingClosure.test.ts` T7 (UNCONTROLLED schedule, but invariant holds).

**Critical observation**: The `completeManualEntry` SQL UPDATE does NOT include `AND status = 'pending_manual'` in the WHERE clause. The state guard is entirely in the engine layer. If two transactions both read the entry as `pending_manual` (e.g., under READ COMMITTED without the attempt lock — which is prevented by the current code, but fragile), the second UPDATE would silently overwrite the first without checking status. The attempt FOR UPDATE lock is the only protection against this. If the lock were ever removed, this would become a P0 vulnerability.

**Risk classification**: Acceptable with current locking. P2 defense-in-depth gap (see P2-1).

**Scenario 2: Two graders grade DIFFERENT questions on the same attempt**

- The attempt row lock serializes both graders. The second grader waits for the first to commit.
- `countPendingManualForAttempt` is read after the UPDATE, so it sees the correct count.
- If the first grader's question was the last pending one, the second grader's call will find `attempt.status = graded` (written by the first grader's `finalizeTerminalGrading`). The engine guard rejects it because `attempt.status !== "submitted"`.
- **Result**: Correct serialization. No double-finalize, no missed finalize.

**Scenario 3: Two graders grade the SAME attempt's last two questions concurrently**

- Both grade the last two pending questions. Both read `countPendingManualForAttempt` after their respective UPDATE.
- The first to commit sets the count to 1 and returns `fullyGraded: false`.
- The second to commit sets the count to 0, calls `finalizeTerminalGrading`, and commits.
- The first grader's response shows `fullyGraded: false`, but a page reload would show `fully_graded`.
- **Result**: Correct. The first grader sees a non-terminal response, but the data is correct.

### 7.3 What the Data Layer Protects

| Constraint | What it protects | What it does NOT protect |
|-----------|-----------------|------------------------|
| UNIQUE(attemptId, questionId) | Exactly one entry per question per attempt | Does not prevent overwriting an existing entry |
| organizationId FK | Cross-tenant isolation | N/A (separate concerns) |
| attemptId FK → examAttempts | Referential integrity | Does not enforce lifecycle state |
| FOR UPDATE (lockSeam) | Serializes concurrent grading of same attempt | Does not protect against bypassing the engine guard |

### 7.4 What the Engine Layer Protects

| Guard | What it protects | What it does NOT protect |
|-------|-----------------|------------------------|
| `attempt.status === "submitted"` | Prevents grading after terminal completion | N/A |
| `attempt.gradingStatus === "pending_manual"` | Prevents grading auto-only or fully-graded attempts | N/A |
| `entry.gradingMode === "manual"` | Prevents grading auto-graded questions | N/A |
| `entry.status === "pending_manual"` | Prevents overwriting completed entries | Not enforced at SQL level |
| `0 ≤ score ≤ maxScore` | Score range validation | N/A |

---

## 8. Test Coverage Matrix

| Scenario | API Test | Engine Test | Web Unit | Browser E2E | Adequate? |
|----------|:--------:|:-----------:|:--------:|:-----------:|:---------:|
| Frozen candidate answer | ✅ | ✅ | ✅ | ✅ | ✅ |
| Standard answer / rubric | ✅ | ✅ | ✅ | ✅ | ✅ |
| Single question grading | ✅ | ✅ | ✅ | ✅ | ✅ |
| Two subjective questions, partial completion | ✅ | ✅ | ❌ | ❌ | ⚠️ (API covers, E2E missing) |
| Refresh restores partial scores | N/A (API) | N/A | ✅ (mocked) | ❌ | ⚠️ (web unit covers, E2E missing) |
| Empty score / no input | ❌ | ❌ | ✅ (validation test) | ❌ | ❌ (no backend test for empty submit) |
| Explicit score 0 | ❌ | ❌ | ❌ | ❌ | ❌ (not tested anywhere) |
| Double-click / retry | ✅ | ✅ | ❌ | ❌ | ⚠️ (API covers, frontend not tested) |
| Response loss reconciliation | ❌ | ❌ | ❌ | ❌ | ❌ (not implemented, not tested) |
| Same-question concurrent grading | ⚠️ (UNCONTROLLED) | ✅ | N/A | ❌ | ⚠️ (API test uses Promise.all, not deterministic) |
| Different-question concurrent grading | ❌ | ❌ | N/A | ❌ | ❌ (not tested) |
| Last question auto-finalize | ✅ | ✅ | ✅ | ✅ | ✅ |
| Post-terminal modification rejection | ✅ | ✅ | ❌ | ✅ | ✅ |
| Grader role browser flow | ❌ | ❌ | ❌ | ❌ | ❌ (E2E uses Admin, not Grader) |
| No answer permission | ❌ (not enforced) | N/A | N/A | N/A | ❌ (permission not independently enforced) |
| Cross-organization isolation | ✅ | N/A | N/A | N/A | ✅ |
| Score identity (objective + manual) | ✅ | ✅ | ❌ | ✅ | ✅ |

### Key Gaps

1. **Empty score submission**: No test covers what happens when the frontend sends `score: 0` without the operator explicitly entering "0". The backend accepts it, but the UX is problematic.
2. **Score 0**: No test explicitly asserts `score: 0` is accepted as valid.
3. **Response loss reconciliation**: Neither implemented nor tested.
4. **Different-question concurrent grading**: Not tested. The FOR UPDATE lock should serialize it, but there is no test confirming this.
5. **Grader role browser flow**: E2E tests use Admin. Grader role is never tested end-to-end.
6. **Same-question concurrency**: The API test uses `Promise.all` (UNCONTROLLED schedule), which does not prove a specific ordering. A controlled-barrier test would be stronger.

---

## 9. Recommended MVP Boundary

The current system is **safe for MVP use** with the following caveats:

### In Scope (current MVP)

- Admin/Grader can complete manual grading of text_response questions
- One-time irrevocable scoring per question
- Automatic terminal finalization on last question
- Score reconciliation (objective + manual) into attempt total and enrollment
- Audit logging of all grading operations
- Concurrent grading protection (attempt-level FOR UPDATE)

### Out of Scope (documented gaps)

- Score revision / reopen / re-grade workflow
- Anonymous / double-blind grading
- Grading task assignment (M11)
- Batch grading
- Rubric-based auto-scoring
- AI-assisted grading
- Draft scoring (edit before finalize)

### Must-Fix Before Scaling

1. **P1-3**: Score input for ungraded questions should show empty, not 0
2. **P1-1**: Button label should communicate irrevocability
3. **P1-2**: Per-question entry feedback after successful save

---

## 10. Proposed Implementation Slices

### Slice A: P1-GRADING-OPERATOR-UX-CLOSEOUT

**Problem**: P1-1 (button label), P1-2 (entry feedback), P1-4 (confirmation dialog), P1-5 (409 discrimination).

**Minimal fix scope**:
1. Change button label from "保存" to "提交评分" (submit score) or "确认评分" (confirm score)
2. After successful POST, update the question's entry in local state (show score, comment, gradedBy, gradedAt)
3. Add a confirmation dialog: "确认提交评分？提交后不可修改。" (Confirm score submission? Cannot be modified after submission.)
4. Parse 409 response body and show specific error message for "already graded" case

**Does NOT include**:
- Score revision workflow
- Draft scoring
- Any backend changes

**Acceptance criteria**:
- Button says "提交评分" (or similar) instead of "保存"
- After save, the question shows graded state (score, gradedBy, gradedAt) and inputs are visibly disabled
- Confirmation dialog appears before POST
- 409 "already graded" shows a specific message, not a generic "保存失败"

**Tests needed**:
- Web unit: button label, confirmation dialog, entry feedback update, 409 message
- E2E: two-subjective-question scenario with partial grading, refresh, completion

**Dependencies**: None

### Slice B: P1-GRADING-UNGRADED-ZERO-FIX

**Problem**: P1-3 (score input initializes to 0 for ungraded questions).

**Minimal fix scope**:
1. Initialize score input to empty string for ungraded questions (`entry === null`)
2. Set `min={0}` on the input (already done)
3. In `handleSave`, if the score is `NaN` or empty, treat as validation error ("请输入分数")
4. For already-graded questions, continue showing the existing score

**Does NOT include**:
- Backend schema changes (backend already accepts `z.number().min(0)`)
- Changing the validation of `score: 0` as a valid input

**Acceptance criteria**:
- Ungraded question shows empty score input, not 0
- Submitting without entering a score shows validation error
- Operator can still explicitly enter 0

**Tests needed**:
- Web unit: ungraded input shows empty, empty-submit validation, explicit 0 works

**Dependencies**: None

### Slice C: P1-GRADING-AMBIGUOUS-RESULT-RECONCILIATION

**Problem**: P1-5 (response loss reconciliation), P2-4 (no re-fetch after failure).

**Minimal fix scope**:
1. On POST failure (catch block), automatically re-fetch grading details
2. If the re-fetched entry shows `completed_manual`, show success toast instead of error
3. If the entry is still `pending_manual`, show the error (real failure)

**Does NOT include**:
- Idempotency key on the API (backend change, separate concern)
- Retry logic

**Acceptance criteria**:
- After a POST failure, the page re-fetches grading details
- If the entry was actually committed, the operator sees success feedback
- If the entry was not committed, the operator sees the error

**Tests needed**:
- Web unit: mock POST failure followed by GET success, verify reconciliation
- E2E: network interruption during grade-question

**Dependencies**: None

### Slice D: P2-GRADING-SQL-STATUS-GUARD

**Problem**: P2-1 (SQL UPDATE missing `status = pending_manual` guard).

**Minimal fix scope**:
1. Add `AND status = 'pending_manual'` to the `completeManualEntry` SQL UPDATE WHERE clause
2. Check `updated.length === 0` after the update and throw `NotFoundError`

**Does NOT include**:
- Any engine changes
- Frontend changes

**Acceptance criteria**:
- `completeManualEntry` with a `completed_manual` entry returns null (no-op)
- Engine test verifies the SQL-level guard catches concurrent overwrites

**Tests needed**:
- DB repository test: direct UPDATE with non-pending entry returns null

**Dependencies**: None

---

## 11. Files Inspected

See §2 (Audited Scope and Evidence) for the full file list.

---

## 12. Commands and Test Results

### Test Execution (2026-07-30)

```bash
# API grading tests (130 files, 1656 passed)
pnpm --filter api test -- --run \
  src/routes/gradingQueue.test.ts \
  src/routes/attempts/manualGradingClosure.test.ts \
  src/routes/attempts/gradingConcurrency.test.ts

# Result: All 130 test files passed, 1656 tests passed, 5 skipped

# Engine grading tests (26 files, 483 passed)
pnpm --filter exam-engine test -- --run

# Result: All 26 test files passed, 483 tests passed

# Web grading page tests (2 files, 40 passed)
cd apps/web && npx vitest run --run \
  src/pages/admin/GradingQueuePage.test.tsx \
  src/pages/admin/GradingDetailPage.test.tsx

# Result: 2 files passed, 40 tests passed

# Grading permission matrix test
pnpm --filter api exec vitest run --run \
  src/authz/permissionMatrix.grading.test.ts

# Result: 1 file passed, 5 tests passed
```

### Initial Suspects Verification

| # | Suspect | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | Backend main line is complete | ✅ **Confirmed** | Full gradeQuestion → finalizeTerminalGrading pipeline works end-to-end |
| 2 | One-time completion per question | ✅ **Confirmed** | `manualGrading.ts:147-153` — entry status guard rejects re-grades |
| 3 | Last question auto-finalizes | ✅ **Confirmed** | `manualGrading.ts:190-223` — calls `finalizeTerminalGrading` when count=0 |
| 4 | Button says "保存", misleading | ✅ **Confirmed** | i18n zh-CN: `save: "保存"`; backend is one-time irrevocable |
| 5 | Ungraded questions may show 0 | ✅ **Confirmed** | `GradingDetailPage.tsx:140`: `q.entry?.score ?? 0` |
| 6 | POST success doesn't update entry | ✅ **Confirmed** | `GradingDetailPage.tsx:179-186`: only updates `gradingStatus`, not per-question entry |
| 7 | Input remains editable after save | ⚠️ **Partially true** | The input is not programmatically disabled, but the backend rejects second saves. Reloading the page shows the correct state. |
| 8 | No GET reconciliation after failure | ✅ **Confirmed** | `GradingDetailPage.tsx:187-189`: catch block shows generic error without re-fetch |
| 9 | `grading.answer.view` and `grading.identity.view` not independently enforced | ✅ **Confirmed** | `gradingQueue.ts:128-136`: single `GradingDetailView` gate, no independent check for answer/identity |
| 10 | E2E has only one subjective question | ✅ **Confirmed** | `manual-grading.spec.ts`: single text_response question, no partial-score-recovery test |
| 11 | M11 not implemented, no task assignment | ✅ **Confirmed** | No exam/attempt scope on grading queue; all graders see all pending work |
| 12 | Post-terminal modification strictly rejected | ✅ **Confirmed** | `manualGrading.ts:111-123`: lifecycle guards; `gradingQueue.test.ts:1287-1310`: Slice 14 test |