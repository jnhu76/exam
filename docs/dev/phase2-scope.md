# Phase 2 Scope Inventory

> Phase B of Phase 2 收口. A read-only record of **what Phase 2 actually
> implemented**, layer by layer, so that alignment (frontend ↔ API ↔ backend ↔
> PG ↔ state machine) can be verified and drift detected. No business logic was
> changed to produce this document. Findings are classified MUST FIX / SHOULD
> FIX / DEFER / PHASE 3 / FALSE POSITIVE.

## Summary

Phase 2 is a **single-tenant, multi-user** exam platform: one Admin role
configures the org (candidates, fields, courses, questions, exams, enrollments,
grading, diagnostics, exports); one Candidate role logs in, takes assigned
exams under a server-authoritative timer, submits, and views allowed results.

- **78 HTTP endpoints** across 16 route modules (auth, users, candidates,
  candidate-fields, courses, questions, exams, attempts[admin/candidate/
  grading-queue], scores, export, system, audit, import-logs, settings).
- **13 PostgreSQL tables**, all tenant-scoped (`organizationId`), via Drizzle.
- **3 state machines** (exam / attempt / enrollment) in `@exam/exam-engine`,
  plus lazy exam reconciliation + background auto-submit scanners.
- **~30 frontend pages** under `/admin/*` (Admin) and `/exam/*` (Candidate).
- Alignment is **broadly consistent** end-to-end; the gaps found are localized
  (see Risks). No MUST FIX business-logic bug was found in Phase B; the two
  MUST FIX items from Phase A were in the in-progress Redis baseline and are
  already fixed in commit `ecccf1f`.

## Implemented product flows

| Flow | Frontend | API | Backend | PG | State machine | Tests | Notes |
|---|---|---|---|---|---|---|---|
| Admin login/session | LoginPage, AuthContext | `/api/auth/login`, `/me`, `/me/password`, logout | auth plugin, JWT cookie | `users` | n/a | auth.test.ts | rate-limited 10/min |
| Admin: candidates CRUD + CSV import | CandidatesPage | `/api/candidates`, `/import` | candidate repo | `candidate_profiles`, `users`, `candidate_fields` | n/a | candidate.test.ts | per-row error codes in body |
| Admin: candidate fields (configurable identity) | CandidateFieldsPage | `/api/candidate-fields` (+ template) | candidateField repo | `candidate_fields` | n/a | candidateField.test.ts | org-defined, not hardcoded Student/学号 |
| Admin: courses CRUD | CoursePage | `/api/courses` | course repo | `courses` | n/a | course.test.ts | ad-hoc error bodies (SHOULD FIX) |
| Admin: questions CRUD + import | QuestionPage, QuestionEditPage, QuestionImportPage | `/api/questions`, `/import` | question repo | `questions` | n/a | question.test.ts | snapshot decouples from bank edits |
| Admin: exam lifecycle | ExamPage, ExamCreatePage, ExamDetailPage | `/api/exams` + `/publish` `/unpublish` `/close` `/extend` `/cancel` `/archive` `/publish-results` | exam commands + examTransitionExecutor + reconcile | `exams` | examStateMachine + lazy reconcile | exam.test.ts | open/close via reconcile + admin transitions |
| Admin: enrollments | ExamDetailPage | `/api/exams/:id/enrollments` GET/POST/DELETE | enrollment repo | `exam_enrollments` | enrollmentStateMachine | exam.test.ts | finalAttemptId has no FK (by design) |
| Admin: proctor dashboard | ProctorDashboardPage | `/api/admin/exams/:id/candidates/status`, `/api/admin/attempts/:id/force-submit`, `/misconduct`, `/extend-time` | attempts.admin routes | `exam_attempts` | attemptStateMachine | attempts.test.ts | 5s poll; force-submit source=proctor |
| Admin: grading queue + detail | GradingQueuePage, GradingDetailPage | `/api/admin/grading-queue`, `/grading-details`, `/grade-question` | gradingQueue repo + finalize | `manual_grading_entries`, `exam_attempts` | grading status (auto/pending/fully) | gradingQueue.test.ts | manual grade + finalize → enrollment final score |
| Admin: scores + export | ScoreListPage, AttemptDetailPage | `/api/exams/:id/scores`, `/export/scores`, `/api/scores/attempts/:id` | scores repo + export | `exam_attempts`, `exam_enrollments` | gated by resultPublicationMode | scores.test.ts | CSV export; result hide reasons |
| Admin: diagnostics/health | DiagnosticsPage, SystemHealthPage | `/api/system/*` | system routes + scanners | `exams`, `exam_attempts` | n/a | system.test.ts | now reports redisStatus (Phase C) |
| Admin: audit/import logs | AuditLogPage, ImportLogsPage | `/api/admin/audit-logs`, `/import-logs` | audit/importLog repos | `audit_logs`, `import_job_logs` | n/a | audit/importLogs.test.ts | append-only |
| Admin: branding settings | SettingsPage | `/api/settings/branding`, `/api/admin/settings/branding` | settings repo | `organization_settings` | n/a | settings.test.ts | productName/subtitle/footer from org settings |
| Candidate: exam list | ExamListPage | `/api/candidate/exams` | candidate routes + reconcileExamForRead | `exams`, `exam_enrollments` | reconcile (published→open→closed) | attempts.test.ts | availabilityStatus + primaryAction |
| Candidate: start/restore | StartExamPage | `/api/attempts/:examId/start`, `/restore` | startOrRestoreAttempt, restoreAttempt | `exam_attempts`, `exam_enrollments` | attemptStateMachine (start/restore) | attempts.test.ts | FOR UPDATE on enrollment |
| Candidate: take exam (answer protocol) | TakeExamPage | `/api/attempts/:id/answers/:qid`, `/heartbeat` | processSaveAnswer (versioned, idempotent) | `exam_attempts.answers` | attemptStateMachine (submit) | attempts.test.ts | clientSeq+baseVersion; rejections in body |
| Candidate: submit + auto-submit | TakeExamPage | `/api/attempts/:id/submit` | submitAndGradeAttempt orchestrator | `exam_attempts` (tx), `exam_enrollments` | attemptStateMachine (submit→grade→graded) | attempts.test.ts | deadline scanner auto-submits |
| Candidate: disrupted/recovery | TakeExamPage (offline banner), ResultPage | heartbeat, `/restore` | heartbeat scanner + restoreAttempt | `exam_attempts.lastActivityAt` | disrupt/restore transitions | attempts.test.ts | heartbeat timeout → disrupted |
| Candidate: result | ResultPage | `/api/scores/attempts/:id` | scores repo | `exam_attempts`, `exam_enrollments` | gated by publication mode | scores.test.ts | hiddenReason: not_started/not_graded/pending_publish |

## API inventory

(Full per-endpoint detail — method, path, request, success, error codes, auth,
audit action, state transition — was produced by the API-inventory pass. Key
shape summary here; see `phase2-contract-audit.md` for the deep error/response
audit.)

| Method | Path | Success | Error codes (HTTP) | Auth | Audit | State transition |
|---|---|---|---|---|---|---|
| POST | `/api/auth/login` | 200 | AUTH_INVALID_CREDENTIALS (401) | anon (RL 10/min) | login.success/failure | — |
| POST | `/api/auth/register` | — | AUTH_REGISTER_DISABLED (403, always) | anon | — | — |
| GET | `/api/auth/me` | 200 | RESOURCE_NOT_FOUND (404) | auth | — | — |
| PATCH | `/api/auth/me/password` | 200 | VALIDATION_ERROR, CURRENT_PASSWORD_INVALID | auth | — | — |
| GET/POST | `/api/users` | 200/201 | USER_ALREADY_EXISTS (409) | Admin | user.create | — |
| PATCH/DELETE | `/api/users/:id` | 200/204 | CANNOT_DISABLE_SELF, LAST_ACTIVE_ADMIN, RESOURCE_NOT_FOUND | Admin | user.update/delete | — |
| GET/POST | `/api/candidates` | 200/201 | CANDIDATE_IDENTITY_CONFLICT, USER_ALREADY_EXISTS, RESOURCE_CONFLICT | Admin | candidate.create | — |
| POST | `/api/candidates/import` | 200 | VALIDATION_ERROR + per-row codes in body | Admin (RL 10/min) | candidate.import | — |
| GET/POST/PATCH/DELETE | `/api/candidate-fields` | 200/201/204 | CANDIDATE_IDENTITY_FIELD_CONFLICT, CANDIDATE_FIELD_IN_USE | Admin | candidate_field.* | — |
| GET/POST/PATCH/DELETE | `/api/courses` | 200/201/204 | **ad-hoc** NOT_FOUND/DUPLICATE/CONFLICT (SHOULD FIX) | Admin | course.* | — |
| GET/POST/PATCH/DELETE | `/api/questions` | 200/201/204 | RESOURCE_NOT_FOUND, VALIDATION_ERROR, QUESTION_COURSE_MISMATCH | Admin | question.* | — |
| POST | `/api/questions/import` | 200 | VALIDATION_ERROR | Admin (RL 5/min) | question.import | — |
| GET/POST/PATCH/DELETE | `/api/exams` | 200/201/204 | RESOURCE_NOT_FOUND, EXAM_UPDATE_NOT_ALLOWED, QUESTION_COURSE_MISMATCH | Admin | exam.* | reconcileExamForMutation |
| POST | `/api/exams/:id/publish` | 200 | EXAM_ALREADY_PUBLISHED | Admin | exam.publish | **publishExam** |
| POST | `/api/exams/:id/close` | 200 | EXAM_CLOSE_NOT_ALLOWED (UNRESOLVED_ATTEMPTS_EXIST) | Admin | exam.close + recon | **closeExam** |
| POST | `/api/exams/:id/unpublish` | 200 | EXAM_UNPUBLISH_NOT_ALLOWED | Admin | exam.unpublish + recon | **unpublishExam** |
| POST | `/api/exams/:id/extend` | 200 | EXAM_EXTEND_NOT_ALLOWED (NOT_OPEN/ALREADY_CLOSED) | Admin | exam.extend + recon | **extendExam** |
| POST | `/api/exams/:id/cancel` | 200 | EXAM_CANCEL_NOT_ALLOWED (UNRESOLVED_ATTEMPTS_EXIST) | Admin | exam.cancel + recon | **cancelExam** |
| POST | `/api/exams/:id/archive` | 200 | EXAM_ARCHIVE_NOT_ALLOWED | Admin | exam.archive + recon | **archiveExam** |
| POST | `/api/exams/:id/publish-results` | 200 | EXAM_PUBLISH_RESULTS_NOT_ALLOWED | Admin | exam.publish_results | **publishResults** |
| GET/POST/DELETE | `/api/exams/:id/enrollments` | 200/204 | ENROLLMENT_NOT_REMOVABLE | Admin | enrollment.* | — |
| GET | `/api/admin/exams/:id/candidates/status` | 200 | RESOURCE_NOT_FOUND | Admin | — | — |
| GET | `/api/candidate/exams[/:id]` | 200 | NOT_FOUND | Candidate | — | reconcileExamForRead |
| POST | `/api/attempts/:examId/start` | 201/200 | CONFLICT (queue), ATTEMPT_ALREADY_STARTED, EXAM_NOT_OPEN, ATTEMPT_DEADLINE_EXCEEDED, ATTEMPT_LATE_ENTRY_CLOSED, MAX_ATTEMPTS_REACHED, EXAM_ALREADY_PASSED | Candidate | attempt.start/restore | **startOrRestoreAttempt** |
| POST | `/api/attempts/:id/answers/:qid` | 200 (accepted/rejected) | rejections in body: STALE_VERSION, ATTEMPT_ALREADY_SUBMITTED, ATTEMPT_CLOSED, DEADLINE_EXCEEDED, CONFLICTING_PAYLOAD | Candidate | attempt.saveAnswer (if accepted) | **processSaveAnswer** |
| POST | `/api/attempts/:id/submit` | 200 | ATTEMPT_CLOSED, ATTEMPT_SUBMIT_TOO_EARLY, INVALID_STATE_TRANSITION | Candidate | attempt.submit | **submitAndGradeAttempt** |
| POST | `/api/attempts/:id/heartbeat` | 200 | INVALID_STATE_TRANSITION | Candidate | — | — |
| POST | `/api/attempts/:id/restore` | 200 | INVALID_STATE_TRANSITION | Candidate | attempt.restore | **restoreAttempt** |
| POST | `/api/admin/attempts/:id/force-submit` | 200 | INVALID_STATE_TRANSITION (voided) | Admin | attempt.forceSubmit | **submitAttempt**(proctor)+grade |
| POST | `/api/admin/attempts/:id/misconduct` | 200 | INVALID_STATE_TRANSITION | Admin | attempt.misconductFlagged | **flagMisconduct** |
| POST | `/api/admin/attempts/:id/extend-time` | 200 | DEADLINE_EXCEEDS_EXAM_CLOSE, ATTEMPT_CLOSED | Admin | attempt.extendTime | **extendAttemptTime** |
| GET | `/api/admin/attempts/:id/timeline` | 200 | NOT_FOUND | Admin | — | — |
| GET | `/api/admin/attempts/:id/export[/csv]` | 200 json/csv | NOT_FOUND | Admin | attempt.exported | — |
| GET | `/api/admin/grading-queue` | 200 | VALIDATION_ERROR | Admin | — | — |
| POST | `/api/admin/attempts/:id/grade-question` | 200 | NOT_FOUND | Admin | grading.score_entered/finalized | **gradeQuestion** |
| GET | `/api/exams/:id/scores` | 200 | EXAM_CANCELED_RESULTS_UNAVAILABLE, UNRESOLVED_ATTEMPTS_EXIST, EXAM_NOT_FINISHED | Admin | — | — |
| GET | `/api/scores/attempts/:id` | 200 (full or hidden) | NOT_FOUND | Candidate\|Admin | — | gated by publication mode |
| GET | `/api/exams/:id/export/scores` | 200 csv | EXAM_CANCELED_RESULTS_UNAVAILABLE, UNRESOLVED_ATTEMPTS_EXIST | Admin | export_scores | — |
| GET | `/api/system/{info,public-config,health,dashboard,diagnostics}` | 200 | — | anon/Admin | — | — |
| GET | `/api/admin/audit-logs` | 200 | — | Admin | — | — |
| GET | `/api/admin/import-logs` | 200 | — | Admin | — | — |
| GET/PATCH | `/api/settings/branding`, `/api/admin/settings/branding` | 200 | INTERNAL_ERROR (upsert null) | anon/Admin | branding.update | — |

## Frontend inventory

| Area | File(s) | API dependency | State dependency | Error handling | Notes |
|---|---|---|---|---|---|
| Auth | LoginPage, AuthContext | auth/login,me,logout,password | role → landing | 401→/login, network toast | cookie-based |
| Admin layout | AdminLayout, AppSidebar | — | role guard | redirect non-Admin→/login | no per-route guard (SHOULD FIX note) |
| Exam layout | ExamLayout | — | role guard | redirect non-Candidate→/login | no per-route guard |
| Dashboard | DashboardPage | system/dashboard | — | ErrorState retry | stats + recent exams |
| Candidates | CandidatesPage | candidates, candidates/import | — | inline | CSV import |
| Candidate fields | CandidateFieldsPage | candidate-fields, template | — | inline | reorder + CRUD |
| Users | UsersPage | users | role | inline | enable/disable |
| Courses | CoursePage | courses | — | inline | CRUD |
| Questions | QuestionPage, QuestionEditPage, QuestionImportPage | questions, questions/import | — | inline | live preview |
| Exams | ExamPage, ExamCreatePage, ExamDetailPage | exams + lifecycle | exam status | inline | publish/close/extend/archive |
| Proctor | ProctorDashboardPage | candidates/status, force-submit, misconduct, extend-time | attempt status | inline | 5s poll |
| Grading | GradingQueuePage, GradingDetailPage | grading-queue, grading-details, grade-question | gradingStatus | inline | manual grade |
| Scores | ScoreListPage, AttemptDetailPage | scores, export/scores | publication mode | inline | CSV export |
| Results overview | ResultsOverviewPage | exams | exam status | inline | browse published exams |
| Diagnostics/health | DiagnosticsPage, SystemHealthPage | system/* | — | inline | now shows redisStatus |
| Audit/import logs | AuditLogPage, ImportLogsPage | audit-logs, import-logs | — | inline | search |
| Settings | SettingsPage | settings/branding | — | inline | branding |
| Candidate list | ExamListPage | candidate/exams | availabilityStatus, primaryAction | EmptyState | groups available/history/upcoming |
| Start | StartExamPage | candidate/exams/:id, attempts/start | primaryAction | EXAM_NOT_OPEN/MAX_ATTEMPTS/EXAM_ALREADY_PASSED | start/resume dispatch |
| Take | TakeExamPage | attempts/:id, answers/:qid, submit, heartbeat | attempt status, save status | save-rejection alerts, offline banner | answer protocol + deadline watcher |
| Result | ResultPage | scores/attempts/:id | publication mode | status messages | disrupted → "请联系管理员" |
| Shared states | LoadingState, EmptyState, ErrorState, StatusBadge, ConnectionIndicator, SaveIndicator, ErrorBoundary | — | statusMeta lookup | — | centralized status grammar |
| Status grammar | lib/statusMeta.ts | — | ~35 status keys | — | label/tone/icon source of truth |

## Backend inventory

| Area | Route | Service/domain | Repository | Tests | Notes |
|---|---|---|---|---|---|
| Auth | auth.ts | auth plugin (JWT, cookie) | userRepo | auth.test.ts | rate-limit on login |
| Users | user.ts | — | userRepo | user.test.ts | self-disable guard |
| Candidates | candidate.ts | — | candidateRepo, userRepo | candidate.test.ts | atomic user+profile tx |
| Candidate fields | candidateField.ts | — | candidateFieldRepo | candidateField.test.ts | template endpoint |
| Courses | course.ts | — | courseRepo | course.test.ts | ad-hoc error bodies |
| Questions | question.ts | — | questionRepo | question.test.ts | courseId must match |
| Exams | exam.ts, examTransitionExecutor.ts, reconciliation.ts | examStateMachine, checkAndUpdateExamStatus, examCommands | examRepo, enrollmentRepo | exam.test.ts | lock→reconcile→mutate |
| Attempts (candidate) | attempts.candidate.ts | attemptStateMachine, attemptCommands, submitAndGradeAttempt | attemptRepo, enrollmentRepo | attempts.test.ts | FOR UPDATE on attempt+enrollment |
| Attempts (admin) | attempts.admin.ts | submitAttempt(proctor), flagMisconduct, extendAttemptTime | attemptRepo | attempts.test.ts | awaited audit |
| Grading | gradingQueue.ts | gradeAttemptIdempotent, gradeQuestion, finalize | manualGradingRepo, attemptRepo | gradingQueue.test.ts | finalize updates enrollment |
| Scores/export | scores.ts, export.ts | gradingEngine | attemptRepo, enrollmentRepo | scores.test.ts | publication-mode gate |
| System | system.ts | heartbeat/deadlineScanner metrics, systemStats | systemStatsRepo | system.test.ts | diagnostics + redisStatus |
| Background scanners | plugins/heartbeat.ts, plugins/deadlineScanner.ts | attemptCommands, submitAttempt | attemptRepo | heartbeat.test.ts, attempts.test.ts | setInterval timers; idempotent auto-submit |
| Orchestrators | orchestrators/submitAndGradeAttempt.ts | submitAttempt + gradeAttemptIdempotent (2-phase tx) | attemptRepo, enrollmentRepo | attempts.test.ts | lock+state then grade+finalize |

## PostgreSQL inventory

| Table | Purpose | Key columns | Indexes | Constraints | Repositories | Notes |
|---|---|---|---|---|---|---|
| organizations | tenant root | name, displayName, slug | unique(slug) | — | organizationRepo | internal default org only (Phase 1) |
| organization_settings | branding/config | productName, subtitle, footer, timezone | unique(organizationId) | FK→org | settingsRepo | 1:1 |
| candidate_fields | configurable identity defs | name, label, fieldType, required, unique, sortOrder | unique(org,name) | FK→org | candidateFieldRepo | not hardcoded Student/学号 |
| users | accounts | role(Admin/Candidate), username, isActive | unique(org,username) | FK→org | userRepo | argon2/bcrypt hash |
| candidate_profiles | per-user field values | fields(jsonb), userId | unique(org,userId) | FK→org,→users | candidateRepo | |
| courses | grouping | name, code | unique(org,code) | FK→org | courseRepo | |
| questions | bank | type, standardAnswer, score, gradingRule | **none** | FK→org,→courses | questionRepo | no index (SHOULD FIX if slow) |
| exams | exam config | status, timingMode, openAt/closeAt, questionSnapshot, resultPublicationMode, resultsPublishedAt | **none** | FK→org,→courses; CHECK offset≥0 | examRepo, systemStatsRepo | lazy-reconciled |
| exam_enrollments | qualification | status, attemptCount, finalScore, finalAttemptId | unique(org,exam,candidate) | FK→org,→exams,→profiles | enrollmentRepo | finalAttemptId no FK (by design) |
| exam_attempts | attempt | status, answers, gradingResult, score, deadlineAt, lastActivityAt, gradingStatus, misconduct | unique(org,enrollment,attemptNo) | FK→org,→exams,→enrollments,→profiles | attemptRepo, systemStatsRepo | heartbeat field = lastActivityAt |
| manual_grading_entries | grader score/comment | score, maxScore, comment, gradedBy | unique(attempt,question) | FK→org,→attempts; CHECK score∈[0,max] | manualGradingRepo | questionId no FK (snapshot) |
| audit_logs | append-only log | action, targetType, targetId, metadata, ipAddress | **none** | FK→org | auditLogRepo | queried by action/target/date |
| import_job_logs | import summaries | type, status, total, createdCount, errors | (org,createdAt) idx | FK→org | importJobLogRepo | only non-unique index |

Transaction/locking:
- `FOR UPDATE` (3 sites, all in repos): `examRepo.findByIdForUpdate`, `enrollmentRepo.findByExamAndCandidateForUpdate`, `attemptRepo.findByIdForUpdate`.
- `executeInTransaction` (defined in `db/src/types.ts`) is invoked by **callers** (API routes, orchestrators, commands, scanners), never inside repos. Multi-row atomicity is the caller's responsibility.
- Every repo method takes `ctx` (TenantContext | PlatformContext | AuthLookupContext) as first arg; tenant queries filter `WHERE organization_id`.

## State machine inventory

### Exam transitions

Source: `packages/exam-engine/src/examStateMachine.ts` (explicit table) +
`reconciliation.ts` (lazy) + `examTransitionExecutor.ts` (admin).

| From | To | Trigger | Authority | Tests |
|---|---|---|---|---|
| draft | published | admin POST /publish | publishExam | exam.test.ts |
| published | draft | admin POST /unpublish | unpublishExam | exam.test.ts |
| published | open | lazy reconcile (now≥openAt) | checkAndUpdateExamStatus + reconcileExamForRead/Mutation | exam.test.ts |
| published | closed | lazy reconcile (double-transition, now≥closeAt) | reconcile (J2.7: emits exam.open+exam.closed audits) | exam.test.ts |
| published | canceled | admin POST /cancel | cancelExam | exam.test.ts |
| published | archived | admin POST /archive | archiveExam | exam.test.ts |
| open | closed | admin POST /close OR lazy reconcile (now≥closeAt) | closeExam / checkAndUpdateExamStatus | exam.test.ts |
| open | canceled | admin POST /cancel | cancelExam | exam.test.ts |
| closed | archived | admin POST /archive | archiveExam | exam.test.ts |
| canceled | archived | admin POST /archive | archiveExam | exam.test.ts |
| archived | (none) | terminal | — | exam.test.ts |

### Attempt transitions

Source: `packages/exam-engine/src/attemptStateMachine.ts` (table keyed by
`status:command`) + `attemptCommands.ts` + scanners.

| From | To | Trigger | Authority | Tests |
|---|---|---|---|---|
| (not_started)→ | in_progress | candidate POST /start | startOrRestoreAttempt | attempts.test.ts |
| in_progress | submitted | candidate POST /submit OR deadline scanner auto-submit | submitAttempt | attempts.test.ts |
| in_progress | disrupted | heartbeat scanner timeout | heartbeat plugin (setInterval) | attempts.test.ts |
| disrupted | submitted | deadline scanner auto-submit | submitAttempt | attempts.test.ts |
| disrupted | in_progress | candidate POST /restore | restoreAttempt | attempts.test.ts |
| submitted | grading | submit orchestrator phase-2 | gradeAttemptIdempotent | attempts.test.ts |
| grading | graded | grading complete (auto or manual finalize) | gradeAttemptIdempotent / gradeQuestion finalize | attempts.test.ts, gradingQueue.test.ts |
| (any active)→ | voided | admin force-submit when already submitted (idempotent guard) | submitAttempt(proctor) | attempts.test.ts |

Note: `voided` appears as a guard outcome in force-submit; `queued` is a
not_started/queue status (requireQueue is Phase 2 admission queue, in-process
Map). `not_started` is conceptual (no persisted attempt row until start).

### Enrollment transitions

Source: `packages/exam-engine/src/enrollmentStateMachine.ts`.

| From | To | Trigger | Authority | Tests |
|---|---|---|---|---|
| assigned | started | candidate POST /start | startOrRestoreAttempt | attempts.test.ts |
| assigned | blocked | retake policy / pass-then-stop | attemptCommands | attempts.test.ts |
| started | completed | grading finalize sets finalScore | grading finalize | gradingQueue.test.ts |
| started | blocked | retake policy exceeded | attemptCommands | attempts.test.ts |
| blocked | started | retake window resets | attemptCommands | attempts.test.ts |
| completed | (none) | terminal | — | — |

## Explicitly out of Phase 2 scope

- **multi-tenant runtime** (organizationSlug login, tenant switcher, SuperAdmin) — Phase 4.
- **Teacher / Proctor / Grader roles** as product role bundles — Phase 3 (Phase 2 has Admin + Candidate only; "proctor" UI exists but is Admin-role).
- **Redis-backed** rate-limit / presence / queue / scanner ownership — baseline only (Phase C); full adoption needs a measured trigger (ADR-001).
- **Pass-to-proceed external API** (access-control integration) — Phase 4.
- **Electron lockdown client** — Phase 2 desktop shell not started (ADR-004).
- **WebSocket/SSE live push** — Phase 2 proctoring polls via HTTP (ADR-002).
- **timed_sync / deadline / untimed** timing modes — Phase 1 implements `timed_window` only; others documented but not active.
- **AI grading / adaptive degradation / PDF export** — not implemented.
- **fileParallelism restoration** — gated on ADR isolation audit (Phase D).

## Risks found during inventory

### MUST FIX
None in Phase B (business logic). The two MUST FIX items were in the
in-progress Redis baseline (ADR-006 guardrail on system.ts; redis.test.ts
retry storm) — both fixed in commit `ecccf1f`.

### SHOULD FIX
- **course.ts error bodies diverge from ErrorResponseSchema**: uses ad-hoc
  `{error:{code,message}}` with `NOT_FOUND`/`DUPLICATE`/`CONFLICT`, no
  `requestId`. Inconsistent with every other route. (course.ts:78,112,157,198)
- **No index on `questions` or `audit_logs`**: both are listed/filtered by
  repo methods but have no supporting index. `audit_logs` is queried by
  action/targetType/date range with no index — a potential slowness source
  for the audit page at scale. (pg.ts:157, pg.ts:408)
- **No per-route auth guard on the frontend**: protection lives only in
  AdminLayout/ExamLayout role checks (redirect to /login, not 403). Deep
  links bounce rather than 403. (App.tsx:39,33)
- **`ExamSettingsPage.tsx` is an orphan**: exists but not wired into the router.

### DEFER
- audit logging split between fire-and-forget `recordAudit` and awaited direct
  `createAuditLogRepo().create()` calls (attempts.admin.ts, gradingQueue.ts) —
  consolidate in Phase 3 if audit reliability becomes an issue.
- `import_job_logs.status`/`type` and `candidate_fields.fieldType` are
  free-form text with no domain enum — acceptable now, constrain later.

### PHASE 3
- Teacher/Proctor/Grader role bundles (current "proctor" pages are Admin-role).
- Consolidate the two audit-recording paths into one.

### FALSE POSITIVE
- `finalAttemptId` / `manual_grading_entries.questionId` having no FK is
  **intentional** (snapshots decouple from live rows) — not a missing constraint.
- `NotFoundError.code = "NOT_FOUND"` normalizes to `RESOURCE_NOT_FOUND` via
  the legacy map — clients see the canonical code, not a leak.
