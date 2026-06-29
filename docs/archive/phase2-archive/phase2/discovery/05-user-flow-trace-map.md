# User Flow Trace Map — Phase 1 Discovery

> Each action traced: frontend → API → handler → domain → DB → response → frontend feedback → E2E coverage.

## A. Candidate Flow

### A1. Login

```
Frontend: LoginPage.tsx
  → api.post('/api/auth/login', { username, password })
  → Backend: auth.ts:32 (POST /auth/login)
    → userRepo.findByOrganizationAndUsername()
    → verifyPasswordOrDummy()
    → signJWT() → setCookie('auth-token')
    → recordAudit('login.success')
  → Response: { id, username, name, role, organizationId }
  → Frontend: AuthContext stores user, navigate('/exam/list')
  → E2E: auth.test.ts (login success/failure/role blocking)
```

### A2. View Exam List

```
Frontend: ExamListPage.tsx
  → api.get('/api/candidate/exams')
  → Backend: attempts.ts:397 (GET /candidate/exams)
    → candidateRepo.findByUserId()
    → enrollmentRepo.findByCandidate()
    → For each enrollment:
      → examRepo.findById()
      → attemptRepo.findByExamAndCandidate()
      → deriveCandidateExamState() → { availabilityStatus, primaryAction }
      → pickDisplayAttempt()
    → CandidateExamSummarySchema.parse()
  → Response: CandidateExamSummary[]
  → Frontend: ExamCard[] grouped by canTake/upcoming/others
  → E2E: attempts.test.ts (candidate exam list)
```

### A3. Start Exam (Exam Detail → Start)

```
Frontend: StartExamPage.tsx
  → api.get(`/api/candidate/exams/${examId}`)
  → Backend: attempts.ts:508 (GET /candidate/exams/:examId)
    → Same as A2 but for single exam
    → buildCandidateExamDetail() → CandidateExamDetailResponse
  → Frontend: Shows exam info, "开始考试" button
  → E2E: StartExamPage.test.tsx
```

### A4. Enter Exam (Start Attempt)

```
Frontend: StartExamPage.tsx → handleStart() → enterExam()
  → api.post(`/api/attempts/${examId}/start`)
  → Backend: attempts.ts:590 (POST /attempts/:examId/start)
    → candidateRepo.findByUserId()
    → enrollmentRepo.findByExamAndCandidate() → must exist
    → Check for active/disrupted attempt
      → If disrupted: restoreAttempt() → return
      → If in_progress: return existing
    → startAttempt():
      → examRepo.findById() → validate open status + time window
      → Check retakePolicy (maxAttempts, passThenStop)
      → attemptRepo.create({ status: "in_progress", deadlineAt, questionSnapshot })
      → enrollmentRepo.update({ status: "started", attemptCount++ })
    → recordAudit('attempt.start')
  → Response: LoadAttemptResponse (with questionSnapshot, answers, deadlineAt)
  → Frontend: navigate(`/exam/${attempt.id}/take`)
  → E2E: attempts.test.ts (start, restore, max_attempts, pass_then_stop)
```

### A5. Answer Question (Save)

```
Frontend: TakeExamPage.tsx → saveAnswer()
  → useSubmitFlush.scheduleSave() (debounce 1500ms)
  → api.post(`/api/attempts/${attemptId}/answers/${questionId}`, body)
  → Backend: attempts.ts:713 (POST /attempts/:attemptId/answers/:questionId)
    → executeInTransaction:
      → candidateRepo.findByUserId()
      → attemptRepo.findByIdForUpdate() (SELECT FOR UPDATE)
      → Validate: attempt exists, candidate owns it, question in snapshot
      → processSaveAnswer():
        → Check status (voided/submitted → reject)
        → Check deadline
        → Check idempotency (clientSeq)
        → Check version conflict (baseVersion < currentVersion)
        → Accept: newVersion++
      → attemptRepo.update({ answers: [...], lastActivityAt: now })
    → recordAudit('attempt.saveAnswer')
  → Response: SaveAnswerAccepted | SaveAnswerRejected
  → Frontend:
    → Accepted: update versionMap, saveState="saved"
    → STALE_VERSION: accept server answer, update local
    → DEADLINE_EXCEEDED / ATTEMPT_ALREADY_SUBMITTED: show save-rejection-alert
    → Network error: isDisconnected=true
  → E2E: attempts.test.ts (save, stale version, deadline, idempotency)
```

### A6. Heartbeat

```
Frontend: TakeExamPage.tsx → useEffect (setInterval 30s)
  → api.post(`/api/attempts/${attemptId}/heartbeat`)
  → Backend: attempts.ts:969 (POST /attempts/:attemptId/heartbeat)
    → attemptRepo.findById() → must be in_progress
    → attemptRepo.update({ lastActivityAt: now })
  → Response: { ok: true }
  → Frontend: setIsDisconnected(false)
  → On failure: setIsDisconnected(true)
  → E2E: heartbeat.test.ts
```

### A7. Submit Exam

```
Frontend: TakeExamPage.tsx → handleSubmit()
  → useSubmitFlush.flush() (drain pending saves first)
  → api.post(`/api/attempts/${attemptId}/submit`)
  → Backend: attempts.ts:853 (POST /attempts/:attemptId/submit)
    → Phase 1 (tx):
      → candidateRepo.findByUserId()
      → attemptRepo.findByIdForUpdate()
      → If in_progress/disrupted → submitAttempt() → status="submitted"
      → If submitted → skip (idempotent)
      → If graded → return graded result
    → Phase 2 (outside tx):
      → readGradingSnapshot() → { attempt, exam, enrollment }
      → computeGradingResult() → gradeAnswers()
      → finalizeGrading() in tx:
        → attemptRepo.update({ status: "graded", gradingResult, score, passed, gradedAt })
        → enrollmentRepo.update({ status, finalScore, finalPassed, finalAttemptId })
    → recordAudit('attempt.submit')
  → Response: LoadAttemptResponse (graded)
  → Frontend: navigate(`/exam/${attemptId}/result`)
  → E2E: attempts.test.ts (submit, double-submit idempotent, grading)
```

### A8. View Result

```
Frontend: ResultPage.tsx
  → api.get(`/api/scores/attempts/${attemptId}`)
  → Backend: scores.ts:194 (GET /scores/attempts/:attemptId)
    → findVisibleAttempt() (Admin: any attempt; Candidate: owned only)
    → examRepo.findById()
    → If showResultImmediately AND graded → full result
    → Else → status-only response
  → Response: AttemptResultResponse (two shapes)
  → Frontend:
    → showResultImmediately: score + question results table
    → Otherwise: "已提交，等待评分" / "正在评分" / "成绩尚未公布"
  → E2E: ResultPage.test.tsx
```

### A9. Resume After Disruption

```
Frontend: ExamListPage → "继续考试" → StartExamPage → enterExam()
  → api.post(`/api/attempts/${examId}/start`)
  → Backend: attempts.ts:590
    → Detects active disrupted attempt
    → restoreAttempt() → status="in_progress", lastActivityAt=now
    → Returns attempt with preserved answers
  → Frontend: navigate to TakeExamPage with restored attempt
  → Answers restored from server
  → E2E: attempts.test.ts (restore flow)
```

### A10. Timeout Auto-Submit

```
Frontend: ExamTimer → onTimeout callback
  → useSubmitFlush.flush() (drain pending saves)
  → handleSubmit() → submit attempt
  → Backend: Same as A7
  → Frontend: navigate to result page
  → E2E: StartExamPage.test.tsx (timeout path)
```

## B. Admin Flow

### B1. Login

```
Same as A1 but role=Admin → navigate('/admin/dashboard')
```

### B2. User Management

```
Frontend: UsersPage.tsx
  → GET /api/users → list users (Admin role only)
  → POST /api/users → create user (hash password, createUnique)
  → PATCH /api/users/:id → update (self-disable guard, last-admin guard)
  → POST /api/users/:id/reset-password → Candidate only
  → DELETE /api/users/:id → delete user
  → Backend: user.ts routes → userRepo methods
  → E2E: user.test.ts
```

### B3. Candidate Management

```
Frontend: CandidatesPage.tsx
  → GET /api/candidates → list with user info
  → POST /api/candidates → create (tx: user + candidate profile)
  → PATCH /api/candidates/:id → update fields + user info
  → POST /api/candidates/import → batch CSV import
  → Backend: candidate.ts routes → validateCandidateFields, identity conflict check
  → E2E: candidate.test.ts, candidateInvariant.test.ts
```

### B4. Candidate Fields Configuration

```
Frontend: CandidateFieldsPage.tsx
  → CRUD on /api/candidate-fields
  → Unique field constraint (only one identity field)
  → Backend: candidateField.ts routes
  → E2E: candidateField.test.ts
```

### B5. Course Management

```
Frontend: CoursePage.tsx
  → CRUD on /api/courses
  → Duplicate code check on create
  → Questions-exist guard on delete
  → Backend: course.ts routes
  → E2E: course.test.ts
```

### B6. Question Management

```
Frontend: QuestionPage.tsx → list/filter/delete
  → QuestionEditPage.tsx → create/edit
  → QuestionImportPage.tsx → CSV import
  → APIs:
    → GET /api/questions (filter: courseId, type, difficulty, tags)
    → POST /api/questions (validate courseId exists)
    → PATCH /api/questions/:id
    → DELETE /api/questions/:id
    → POST /api/questions/import (batch validate + create)
  → Backend: question.ts routes
  → E2E: question.test.ts
```

### B7. Exam Lifecycle

```
Frontend: ExamPage.tsx → list
  → ExamCreatePage.tsx → create (form + question picker)
  → ExamDetailPage.tsx → detail + publish/archive/enroll
  → APIs:
    → GET /api/exams → paginated list with stats
    → POST /api/exams → create draft (validate course, questions)
    → PATCH /api/exams/:id → update draft only
    → POST /api/exams/:id/publish → state machine: draft→published + build snapshot
    → POST /api/exams/:id/archive → state machine: → archived
    → DELETE /api/exams/:id → draft only
  → Backend: exam.ts routes → examCommands.ts → examStateMachine.ts
  → E2E: exam.test.ts, examStateMachine.test.ts
```

### B8. Enrollment Management

```
Frontend: ExamDetailPage.tsx → Enrollment tab
  → GET /api/exams/:examId/enrollments → list with candidate info
  → POST /api/exams/:examId/enrollments → batch add (skip existing)
  → DELETE /api/exams/:examId/enrollments/:enrollmentId → assigned-only
  → Backend: exam.ts routes
  → E2E: enrollment.test.ts
```

### B9. Score Viewing & Export

```
Frontend: ScoreListPage.tsx
  → GET /api/exams/:id/scores → paginated graded attempts + stats
  → GET /api/exams/:id/export/scores → CSV download
  → Backend: scores.ts, export.ts routes
  → E2E: scores.test.ts, export.test.ts
```

### B10. Settings & Branding

```
Frontend: SettingsPage.tsx → PlatformSettingsForm
  → GET /api/admin/settings/branding → current settings
  → PATCH /api/admin/settings/branding → update
  → Backend: settings.ts routes
  → E2E: settings.test.ts
```

### B11. System Health

```
Frontend: SystemHealthPage.tsx
  → GET /api/system/health → CPU, memory, DB latency
  → GET /api/system/info → version, uptime
  → Backend: system.ts routes
  → E2E: system.test.ts
```

### B12. Dashboard

```
Frontend: DashboardPage.tsx
  → GET /api/system/dashboard → totalQuestions, activeExams, totalCandidates, todayExams, recentExams
  → Backend: system.ts routes → systemStatsRepo
  → E2E: DashboardPage.test.tsx
```

## C. Proctor Flow

### C1. Current State: NOT IMPLEMENTED

Phase 1 has **no proctor UI**. However, backend infrastructure exists:

| Capability | Backend Code | Frontend UI |
|-----------|-------------|-------------|
| View exam participants | `GET /api/exams/:id` (includes participants) | `ExamDetailPage` (enrollment tab) |
| Heartbeat-based disruption | `heartbeat.ts` plugin → auto `markDisrupted` | `TakeExamPage` shows disconnect alert |
| Restore disrupted attempt | `POST /attempts/:id/restore` | Candidate self-service via `StartExamPage` |
| Force submit | `submitAttempt()` works on disrupted attempts | No admin UI — candidate must self-submit |
| Extend time | `controlFlags` exists, no API | **Missing** |
| Mark misconduct | Permission defined (`MARK_MISCONDUCT`), no API | **Missing** |
| Exam room management | `VIEW_EXAM_ROOM` permission defined | **Missing** |
| Real-time monitoring | No WebSocket/SSE | **Missing** |

### C2. What's Missing for Phase 2 Proctor

| Feature | Required | Current State |
|---------|----------|---------------|
| Proctor dashboard (real-time) | WebSocket/SSE | No real-time mechanism |
| Candidate status cards | Live candidate status | Only static enrollment list |
| Force submit action | API + UI | API exists (submit works on any status), no UI |
| Extend time action | API + UI | No API, no UI |
| Misconduct flagging | API + UI | Permission exists, no API/UI |
| Exam room overview | API + UI | Basic participant list in ExamDetailPage |

## D. Audit Trail Coverage

| Action | Audit Logged | Metadata |
|--------|-------------|----------|
| Login success/failure | ✅ | username, reason |
| Logout | ✅ | — |
| User CRUD | ✅ | — |
| Candidate CRUD | ✅ | — |
| Candidate import | ✅ | total, created, updated, errors |
| CandidateField CRUD | ✅ | — |
| Course CRUD | ✅ | — |
| Question CRUD | ✅ | — |
| Question import | ✅ | total, valid, errors |
| Exam create/update/delete | ✅ | — |
| Exam publish/archive | ✅ | — |
| Enrollment add/remove | ✅ | examId, candidateId |
| Attempt start/restore | ✅ | — |
| Attempt saveAnswer | ✅ | — |
| Attempt submit | ✅ | — |
| Branding update | ✅ | — |
| Score export | ✅ | format, rowCount |
| Heartbeat/disrupt | ❌ | Not logged |
| Auto-disrupted (scanner) | ❌ | Not logged |

## E. E2E Test Coverage Summary

| Flow | Test File | Happy Path | Error Path | Concurrent |
|------|-----------|-----------|------------|------------|
| Login | auth.test.ts | ✅ | ✅ (invalid creds, role blocking) | — |
| User CRUD | user.test.ts | ✅ | ✅ (self-disable, last-admin) | — |
| Candidate CRUD | candidate.test.ts | ✅ | ✅ (identity conflict, validation) | — |
| Candidate import | candidate.test.ts | ✅ | ✅ (duplicate, missing fields) | — |
| Course CRUD | course.test.ts | ✅ | ✅ (duplicate code, questions exist) | — |
| Question CRUD | question.test.ts | ✅ | ✅ (course not found) | — |
| Question import | question.test.ts | ✅ | ✅ (validation errors) | — |
| Exam CRUD | exam.test.ts | ✅ | ✅ (not draft, not found) | — |
| Exam publish | examStateMachine.test.ts | ✅ | ✅ (all validation failures) | — |
| Enrollment | enrollment.test.ts | ✅ | ✅ (duplicate, not removable) | — |
| Start attempt | attempts.test.ts | ✅ | ✅ (not enrolled, max attempts, already passed) | — |
| Save answer | attempts.test.ts | ✅ | ✅ (stale, deadline, already submitted) | — |
| Submit attempt | attempts.test.ts | ✅ | ✅ (double submit, grading) | — |
| Heartbeat | heartbeat.test.ts | ✅ | ✅ (stale detection) | — |
| Score list | scores.test.ts | ✅ | ✅ (exam not finished, no grades) | — |
| Export | export.test.ts | ✅ | ✅ (not found) | — |
| System health | system.test.ts | ✅ | — | — |
| Audit logs | audit.test.ts | ✅ | — | — |
| Permission boundary | permissionBoundary.test.ts | — | ✅ (role denied) | — |
| Input validation | inputValidation.test.ts | — | ✅ (invalid inputs) | — |
| Candidate invariant | candidateInvariant.test.ts | — | ✅ (configuration errors) | — |

### Not Covered by E2E

| Gap | Detail |
|-----|--------|
| Concurrent save race condition | No test for two simultaneous saves to same question |
| Concurrent attempt creation | No test for double-click start |
| Heartbeat scanner race with save | No test for scanner marking disrupted while save is in-flight |
| Deadline auto-submit | No test for browser crash at deadline |
| Disrupted → submit path | Partially covered (submitAttempt handles disrupted status) |
| Server restart during attempt | Not tested |
| Queue admission flow | In-memory queue not tested end-to-end |
