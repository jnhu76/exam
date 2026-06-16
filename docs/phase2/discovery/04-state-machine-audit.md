# State Machine Audit — Phase 1 Discovery

> All state machines verified against source code in `packages/exam-engine/` and `packages/domain/`.

## 1. Exam Status Machine

**Source**: `packages/exam-engine/src/examStateMachine.ts`

### States

```
draft → published → open → closed → archived
```

### Allowed Transitions

| From | To | Trigger | Code Location |
|------|-----|---------|---------------|
| draft | published | `publishExam()` | `examCommands.ts:39` |
| published | open | `openExam()` | `examCommands.ts:100` |
| published | archived | `archiveExam()` | `examCommands.ts:132` |
| open | closed | `closeExam()` | `examCommands.ts:116` |
| closed | archived | `archiveExam()` | `examCommands.ts:132` |

### Rejected Transitions (explicit in code)

- draft → open (must publish first)
- draft → archived
- published → closed (must open first)
- open → published
- open → archived (must close first)
- archived → anything

### DB Write Points

| Operation | DB Table | Columns Updated | Transaction |
|-----------|----------|-----------------|-------------|
| publishExam | exams | status, questionSnapshot | No (single update) |
| openExam | exams | status | No |
| closeExam | exams | status | No |
| archiveExam | exams | status | No |

### Phase 1 Actual Usage

- **Exam creation**: `POST /api/exams` → `repo.create()` → status = `draft`
- **Exam publish**: `POST /api/exams/:id/publish` → `publishExam()` → draft → published
- **Exam archive**: `POST /api/exams/:id/archive` → `archiveExam()` → published → archived
- **Auto open/close**: NOT implemented. No cron/scheduler transitions published→open or open→closed. **MISMATCH with state machine**: `openExam()` and `closeExam()` exist in code but no route or scheduler calls them.

### Test Coverage

- `examStateMachine.test.ts` — transition table tests
- `examCommands.test.ts` — publishExam, openExam, closeExam, archiveExam tests
- `exam.test.ts` — route-level integration

### Gaps

| Gap | Impact |
|-----|--------|
| **No auto open/close** | Exams must be manually opened/closed. The `open` and `closed` states exist but no code path triggers them automatically. |
| **published → archived direct** | Allowed but unusual — skip open/close? Valid for "cancel before start" scenario. |
| **No draft → published rollback** | Once published, cannot un-publish. This is intentional per spec. |

---

## 2. Attempt Status Machine

**Source**: `packages/exam-engine/src/attemptStateMachine.ts`

### States

```
not_started → queued → in_progress → disrupted → submitted → grading → graded
                                                                 ↘ voided
```

### Transition Table (code)

```
in_progress:submit     → submitted
in_progress:disrupt    → disrupted
disrupted:submit       → submitted
disrupted:restore      → in_progress
submitted:grade        → grading
grading:complete_grading → graded
```

### Allowed Transitions

| From | To | Command | Code Location |
|------|-----|---------|---------------|
| in_progress | submitted | submit | `attemptCommands.ts:145` |
| in_progress | disrupted | disrupt | `attemptCommands.ts:171` |
| disrupted | submitted | submit | `attemptCommands.ts:145` |
| disrupted | in_progress | restore | `attemptCommands.ts:194` |
| submitted | grading | grade | `grading.ts:131` |
| grading | graded | complete_grading | `grading.ts:114` |

### Rejected Transitions

| From | Command | Reason | Code |
|------|---------|--------|------|
| not_started | any | No transition defined | `attemptStateMachine.ts:31` |
| queued | any | No transition defined | — |
| submitted | submit | INVALID_SOURCE_STATUS | `attemptStateMachine.ts:48` |
| graded | any | No transition defined | — |
| voided | any | No transition defined | — |
| in_progress | grade | INVALID_SOURCE_STATUS | — |
| disrupted | restore | Would go to in_progress (allowed) | — |

### DB Write Points

| Operation | DB Table | Columns Updated | Transaction | Lock |
|-----------|----------|-----------------|-------------|------|
| startAttempt | exam_attempts | status, questionSnapshot, answers, startedAt, deadlineAt, lastActivityAt | No | No |
| startAttempt | exam_enrollments | status, attemptCount | No | No |
| submitAttempt | exam_attempts | status, submittedAt | No | No |
| markDisrupted | exam_attempts | status | No | No |
| restoreAttempt | exam_attempts | status, lastActivityAt | No | No |
| saveAnswer | exam_attempts | answers, lastActivityAt | **YES** (executeInTransaction) | **YES** (findByIdForUpdate) |
| submit+grade | exam_attempts | status, submittedAt, then gradingResult, score, passed, gradedAt | **YES** (2 transactions) | **YES** (findByIdForUpdate × 2) |
| finalizeGrading | exam_attempts | status, gradingResult, score, passed, gradedAt | **YES** | **YES** |
| finalizeGrading | exam_enrollments | status, finalScore, finalPassed, finalAttemptId | **YES** | No (separate tx) |

### Test Coverage

- `attemptStateMachine.test.ts` — transition table tests
- `attemptCommands.test.ts` — startAttempt, submitAttempt, markDisrupted, restoreAttempt
- `attempts.test.ts` — route-level integration (save, submit, heartbeat, restore)
- `examStateMachine.test.ts` — cross-entity state tests

### Gaps

| Gap | Impact |
|-----|--------|
| **not_started state unused** | Defined in enum but no code creates attempts in this state. |
| **queued state unused** | Defined in enum but queue is in-memory only (Phase 1 no queue UI). |
| **voided state unused** | Defined in enum but no code path creates voided attempts. |
| **Force submit not implemented** | `submitAttempt` works from `in_progress` and `disrupted`, but no admin/proctor endpoint calls it. |
| **Extend time not implemented** | `deadlineAt` is immutable after creation. No code path modifies it. |
| **Double-submit race** | `submitAttempt` in `attempts.ts:853` uses `findByIdForUpdate` + status check in transaction. But `grading` happens in a separate transaction after submit. Window: between submit tx commit and grading tx start, a second submit could see `submitted` status and return early (line 895-896). This is correct behavior (idempotent). |

---

## 3. Enrollment Status Machine

**Source**: `packages/exam-engine/src/enrollmentStateMachine.ts`

### States

```
assigned → started → completed
                  ↘ blocked → started
```

### Allowed Transitions

| From | To | Trigger | Code Location |
|------|-----|---------|---------------|
| assigned | started | startAttempt | `attemptCommands.ts:131-137` |
| assigned | blocked | (no code path) | — |
| started | completed | finalizeGrading | `grading.ts:163-174` |
| started | blocked | (no code path) | — |
| blocked | started | (no code path) | — |

### DB Write Points

| Operation | DB Table | Columns Updated |
|-----------|----------|-----------------|
| startAttempt | exam_enrollments | status=started, attemptCount |
| finalizeGrading | exam_enrollments | status=completed/started, finalScore, finalPassed, finalAttemptId |

### Test Coverage

- `enrollmentStateMachine.test.ts` — transition table tests
- `enrollment.test.ts` — route-level CRUD
- `attemptEnrollment.test.ts` — cross-entity tests

### Gaps

| Gap | Impact |
|-----|--------|
| **blocked state unused** | No code path creates or transitions to/from blocked. |
| **No enrollment bulk status** | No "mark all absent" or "batch complete" for large cohorts. |

---

## 4. Answer Save Protocol (State Machine)

**Source**: `packages/exam-engine/src/answerProtocol.ts`

### Decision Tree

```
processSaveAnswer(state, request):
  1. if status === voided → REJECT (ATTEMPT_CLOSED)
  2. if status ∈ {submitted, grading, graded} → REJECT (ATTEMPT_ALREADY_SUBMITTED)
  3. if deadline exceeded → REJECT (DEADLINE_EXCEEDED)
  4. if idempotent (same clientSeq) → ACCEPT (no-op)
  5. if stale version (baseVersion < currentVersion) → REJECT (STALE_VERSION)
  6. otherwise → ACCEPT, version++
```

### Conflict Reasons

| Reason | When | Response |
|--------|------|----------|
| ATTEMPT_CLOSED | attempt is voided | `{ accepted: false, conflict: { reason: "ATTEMPT_CLOSED" } }` |
| ATTEMPT_ALREADY_SUBMITTED | attempt is submitted/grading/graded | `{ accepted: false, conflict: { reason: "ATTEMPT_ALREADY_SUBMITTED" } }` |
| DEADLINE_EXCEEDED | now > deadlineAt | `{ accepted: false, conflict: { reason: "DEADLINE_EXCEEDED" } }` |
| STALE_VERSION | baseVersion < serverVersion | `{ accepted: false, conflict: { reason: "STALE_VERSION", latestAnswer } }` |

### DB Write Point

- `attempts.ts:734` — `executeInTransaction` + `findByIdForUpdate` → `txRepo.update(ctx, attemptId, { answers, lastActivityAt })`
- Transaction ensures: read-locked attempt + atomic answer update + heartbeat bump

### Client-Side Handling

- `TakeExamPage.tsx` — `useSubmitFlush` hook manages debounced auto-save (1500ms)
- On STALE_VERSION: server answer is displayed to user, local state updated
- On DEADLINE_EXCEEDED: UI shows "已到截止时间" alert, saves disabled
- On ATTEMPT_ALREADY_SUBMITTED: UI shows "考试已结束" alert
- On save rejection: `SaveIndicator` shows error state

### Test Coverage

- `answerProtocol.test.ts` — unit tests for all conflict paths
- `attempts.test.ts` — integration tests for save endpoint
- `submit-flush.spec.ts` — E2E test for flush-before-submit
- `resume-attempt.spec.ts` — E2E test for answer persistence across reload

### Gaps

| Gap | Impact |
|-----|--------|
| **No answer version history in DB** | `clientSeqHistory` is stored in JSONB `answers` column but not queryable. |
| **No answer diff audit** | Save operations are audited (`attempt.saveAnswer`) but the actual answer content is not in audit metadata. |
| **heartbeat bump in save tx** | `lastActivityAt` is updated inside the save transaction. This means the heartbeat scan may not detect a candidate who is actively saving but whose heartbeat endpoint is blocked. |

---

## 5. Grading Pipeline

**Source**: `packages/exam-engine/src/grading.ts`, `packages/domain/src/gradingEngine.ts`

### Pipeline

```
submitAttempt (in_progress → submitted)
  ↓
readGradingSnapshot (fetch attempt + exam + enrollment)
  ↓
computeGradingResult (gradeAnswers per question)
  ↓
finalizeGrading (submitted → grading → graded, update enrollment)
```

### Grading Rules (per question type)

| Type | Logic | Source |
|------|-------|--------|
| single_choice | Exact match: candidateAnswer === standardAnswer | `gradingEngine.ts:23` |
| true_false | Exact match (same as single_choice) | `gradingEngine.ts:122` |
| multiple_choice | All-correct = full; partial = half (if partial_half); any-wrong = zero | `gradingEngine.ts:41` |
| fill_blank | Exact or keyword match (configurable); case-insensitive by default; pipe-separated alternatives | `gradingEngine.ts:95` |

### ScoreStrategy

| Strategy | Logic | Code |
|----------|-------|------|
| highest | Keep if new score > current finalScore | `grading.ts:37` |
| latest | Always overwrite finalScore | `grading.ts:35` |
| first | Never overwrite (already has result) | `grading.ts:39` |

### Enrollment Completion Logic

```
shouldEnrollmentComplete(exam, enrollment, gradedPassed, now):
  if max_attempts AND attemptCount >= maxAttempts → complete
  if pass_then_stop AND (gradedPassed OR finalPassed) → complete
  if now >= exam.closeAt → complete
  otherwise → started (can retake)
```

### DB Write Points

| Step | DB Table | Columns | Transaction |
|------|----------|---------|-------------|
| submitAttempt | exam_attempts | status=submitted, submittedAt | YES |
| finalizeGrading | exam_attempts | status=graded, gradingResult, score, passed, gradedAt | YES |
| finalizeGrading | exam_enrollments | status, finalScore, finalPassed, finalAttemptId | YES |

### Test Coverage

- `grading.test.ts` — unit tests for grading pipeline
- `gradingEngine.test.ts` — unit tests for per-question grading
- `attempts.test.ts` — integration test for submit→grade flow
- `candidate-happy-path.spec.ts` — E2E: submit → graded result visible

### Gaps

| Gap | Impact |
|-----|--------|
| **No manual grading** | Subjective questions (essay, code review) cannot be graded. All grading is auto. |
| **No partial grading** | Grading happens atomically on submit. No "grade some questions first" workflow. |
| **No grading audit** | `gradingResult` is stored on attempt but individual grading decisions are not auditable. |
| **Enrollment completion is non-transactional with grading** | `finalizeGrading` does attempt update and enrollment update in the same function but the enrollment update is not in the same DB transaction as the attempt status update in `attempts.ts:937`. Actually — it IS in a transaction (line 937-948 wraps both in `executeInTransaction`). ✅ |

---

## 6. Heartbeat / Disrupted Detection

**Source**: `apps/api/src/plugins/heartbeat.ts`

### Mechanism

- **Server-side scanner**: `setInterval` runs every `scanIntervalMs` (default 30s)
- **Timeout threshold**: `heartbeatTimeoutMs` (default 60s)
- **Logic**: For each in_progress attempt, if `now - lastActivityAt >= timeoutMs`, mark as disrupted
- **No transaction**: Each attempt is marked individually (no batch atomicity)

### Heartbeat Endpoint

- `POST /api/attempts/:attemptId/heartbeat` → updates `lastActivityAt` to `new Date()`
- Only allowed for `in_progress` attempts
- Returns `{ ok: true }`

### Disrupted Detection Flow

```
heartbeat plugin (every 30s)
  → scanDatabaseForDisruptedAttempts()
    → for each organization:
      → attemptRepo.listInProgress(ctx)
        → scanForDisruptedAttempts(attempts, now, timeoutMs, onDisrupted)
          → for each in_progress attempt:
            → if now - lastActivityAt >= timeoutMs:
              → markDisrupted(attemptRepo, attemptId)
```

### Client-Side Handling

- `TakeExamPage.tsx` — heartbeat every 30s via `setInterval`
- On disconnect: `isDisconnected` state set, UI shows `WifiOff` icon
- On reconnect: `POST /api/attempts/:examId/start` → detects disrupted → calls `restoreAttempt` → returns attempt with answers + remaining time

### Test Coverage

- `heartbeat.test.ts` — unit tests for scan logic
- `attempts.test.ts` — integration tests for restore flow
- `resume-attempt.spec.ts` — E2E: reload → resume same attempt

### Gaps

| Gap | Impact |
|-----|--------|
| **No remaining time adjustment on restore** | `restoreAttempt` sets `lastActivityAt = now` but does NOT adjust `deadlineAt`. Candidate loses time spent disconnected. |
| **No force-submit on deadline expiry** | Scanner only checks heartbeat timeout. No scanner for deadline expiry → auto-submit. |
| **Scanner runs per-organization** | N+1 query pattern: list orgs, then list attempts per org. Could be optimized. |
| **No scanner for auto-open/auto-close** | No scheduler transitions exam status based on openAt/closeAt. |
| **No WebSocket for real-time disrupted notification** | Proctor has no way to know in real-time when a candidate is disrupted. |

---

## 7. State Machine Summary Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     EXAM STATUS                             │
│  draft ──publish──→ published ──open──→ open ──close──→ closed │
│                        │                                    │
│                        └──archive──→ archived               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    ATTEMPT STATUS                           │
│  in_progress ──submit──→ submitted ──grade──→ grading ──complete──→ graded │
│       │                       ↑                              │
│       └──disrupt──→ disrupted ┘                              │
│            ↑                                                 │
│            └──restore──→ in_progress                         │
│                                                                 │
│  (not_started, queued, voided — defined but unused in P1)     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   ENROLLMENT STATUS                         │
│  assigned ──start──→ started ──complete──→ completed         │
│                       started ←──unblock── blocked           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 ANSWER SAVE PROTOCOL                        │
│  voided? → REJECT (ATTEMPT_CLOSED)                          │
│  submitted/grading/graded? → REJECT (ATTEMPT_ALREADY)       │
│  deadline exceeded? → REJECT (DEADLINE_EXCEEDED)            │
│  same clientSeq? → ACCEPT (idempotent no-op)                │
│  stale version? → REJECT (STALE_VERSION + latestAnswer)     │
│  otherwise → ACCEPT (version++)                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Cross-Cutting State Issues

| Issue | Detail | Severity |
|-------|--------|----------|
| **No auto open/close scheduler** | `openExam()` and `closeExam()` exist but no code calls them. Exams stay in `published` until manually archived. | High — candidates can't take exams unless admin manually intervenes (but `startAttempt` checks `OPEN_STATUSES` which includes `published`) |
| **published is "open enough"** | `attemptCommands.ts:59` defines `OPEN_STATUSES = ["published", "open"]`. So candidates CAN start exams in `published` state. The `open`/`closed` states are effectively unused in Phase 1. | Medium — state machine has unused states |
| **No force-submit** | No admin/proctor endpoint to force-submit a candidate's attempt. Permissions exist (FORCE_SUBMIT) but no code. | High for Phase 2 |
| **No extend-time** | `deadlineAt` is set at creation and never modified. No endpoint or code to extend it. | High for Phase 2 |
| **No misconduct flagging** | Permission exists (MARK_MISCONDUCT) but no code. | Medium for Phase 2 |
| **heartbeat scan is best-effort** | No transaction, no retry, no dead-letter. A failed markDisrupted is logged and skipped. | Low — acceptable for Phase 1 |
