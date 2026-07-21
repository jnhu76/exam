# Implementation Status Matrix

> Code-evidenced capability status. Every row is backed by a file path in the
> repository. Not a copy of any phase plan.

```text
STATUS:          CURRENT
AUTHORITY:        Status
SCOPE:            Capability implementation status across api/web/packages
OWNER:            Architecture
BASELINE SYSTEM COMMIT:
                 e7af792815e8cf4bcff122a3d1d8db500b9d6eff (PR #197)
                 The codebase state the matrix was reconstructed from.
LAST VERIFIED REPOSITORY COMMIT:
                 2ca3d687371a2f20eec518634d2e70c2c03421f5
                 The repository commit at which this document was last checked.
                 The baseline system commit is NOT the final verification
                 commit of the reorganized repository.
SUPERSEDES:       —
RELATED ADRS:     ADR-001 (Redis), ADR-002 (WS/SSE), ADR-003 (job queue),
                  ADR-004 (desktop), ADR-005 (operation state), ADR-008 (submit freeze)
```

Legend: ✅ IMPLEMENTED · 🟡 PARTIAL (infra present but gated / scope-limited) · ⬜ NOT IMPLEMENTED (deferred)

## Candidate + Admin core loop (Phase 1)

| Capability | Status | Evidence |
|------------|--------|----------|
| Candidate username/password login (no org slug) | ✅ | `apps/api/src/routes/auth.ts` (`POST /login`, `/logout`); `apps/web/src/pages/LoginPage.tsx` |
| Admin CRUD: candidates | ✅ | `routes/candidate.ts`, `routes/candidateField.ts`; `pages/admin/CandidatesPage.tsx` |
| Admin CRUD: courses | ✅ | `routes/course.ts`; `pages/admin/CoursePage.tsx` |
| Admin CRUD: questions | ✅ | `routes/question.ts`; `pages/admin/QuestionPage.tsx`, `QuestionEditPage.tsx`, `QuestionImportPage.tsx` |
| Admin CRUD: exams | ✅ | `routes/exam.ts`; `pages/admin/ExamPage.tsx`, `ExamCreatePage.tsx`, `ExamEditPage.tsx`, `ExamDetailPage.tsx` |
| Admin CRUD: assignments/enrollments | ✅ | `routes/enrollment.ts` (via tests), `routes/roleAssignments.ts` |
| Candidate takes exam (start / take / submit) | ✅ | `routes/attempts.candidate.ts` (start, take, answers, submit, heartbeat, restore); `pages/exam/*` |
| Answer Save Protocol (versioned, idempotent) | ✅ | `packages/exam-engine/src/answerProtocol.ts`; wired into `attempts.candidate.ts` + `orchestrators/submitAndGradeAttempt.ts` |
| Server time authority | ✅ | `apps/api/src/plugins/now.ts` (`fastify.now()`); ADR-006 |
| Question snapshot at attempt creation | ✅ | `QuestionSnapshot` across `packages/domain/src/types.ts`, `packages/exam-engine`, route files, `packages/db/src/schema/pg.ts` |
| Auto grading | ✅ | `packages/domain/src/gradingEngine.ts`, `packages/exam-engine/src/grading.ts` |
| Result display + CSV export | ✅ | `routes/export.ts` (CSV via `@exam/import-export`); `pages/exam/ResultPage.tsx`, `pages/admin/ResultsOverviewPage.tsx` |
| Audit log (minimal) | ✅ | `routes/audit.ts`; `packages/db/src/repository/auditLogRepo.ts` |
| Settings (org + system) | ✅ | `routes/settings.ts`; `pages/admin/SettingsPage.tsx` |
| CandidateField configuration | ✅ | `routes/candidateField.ts`; `pages/admin/CandidateFieldsPage.tsx` |

## Phase 2 operation capability

| Capability | Status | Evidence / Note |
|------------|--------|-----------------|
| Proctor visibility (exam list, attempt roster) | ✅ | `GET /admin/proctor/exams`, `GET /admin/exams/:examId/proctor/attempts` (`routes/proctorMonitoring.ts`); `pages/admin/ProctorDashboardPage.tsx` |
| Proctor event stream (per-attempt events) | ✅ | `GET /admin/attempts/:attemptId/proctor-events` (`routes/proctorMonitoring.ts`) |
| Proctor live polling dashboard | ✅ | HTTP polling (`ProctorDashboardPage.tsx` `setInterval(loadStatus, POLL_INTERVAL_MS)`). No WS/SSE (ADR-002) |
| Proctor incident logging (audit-event-only) | ✅ | `POST /admin/attempts/:attemptId/proctor-incident` (`routes/proctorMonitoring.ts`). Audit-event storage only — no dedicated incident table |
| Force-submit (admin → submit+grade in one transaction) | ✅ | `POST /admin/attempts/:attemptId/force-submit` (`routes/attempts.admin.ts:124`), capability `Permission.AttemptForceSubmit`, Zod `ForceSubmitRequestSchema`, submits + grades in the same transaction (no submitted-but-not-graded window), idempotent for graded. Tests: `admin-force-submit.test.ts` (7). UI: `ProctorDashboardPage` force-submit handler |
| Extend-time (admin extends an attempt's window) | ✅ | `POST /admin/attempts/:attemptId/extend-time` (`routes/attempts.admin.ts:274`), capability `Permission.AttemptTimeExtend`. Tests: `admin-extend-time.test.ts` (4) |
| Misconduct flag (admin records severity + notes on an attempt) | ✅ | `POST /admin/attempts/:attemptId/misconduct` (`routes/attempts.admin.ts:61`), capability `Permission.AttemptMisconductMark`. Tests: `admin-misconduct.test.ts` (4). UI: `ProctorDashboardPage` misconduct dialog (severity + notes) |
| Attempt timeline (chronological audit view) | ✅ | `GET /admin/attempts/:attemptId/timeline` (`routes/attempts.admin.ts:351`), capability `Permission.AttemptTimelineView`. UI: audit timeline on `ExamDetailPage`/`AttemptDetailPage` |
| Manual grading queue | ✅ | `routes/gradingQueue.ts` (queue, detail, grade-question); `pages/admin/GradingQueuePage.tsx`, `GradingDetailPage.tsx`; `packages/exam-engine/src/manualGrading.ts` |
| Canceled exam state | 🟡 | Enum present (`contracts/src/exam.ts`, `domain/src/enums.ts`); `POST /exams/:id/cancel` (`routes/exam.ts`). Cancellation-marker result/export semantics NOT implemented (`errors.ts` — canceled exams reject scores/export with 409). |
| Disrupted attempt recovery UI | ✅ | `pages/exam/*` restore flow + `attempts.candidate.ts` restore endpoint |
| Retake policy / score strategy | ✅ | `packages/domain/src/retakePolicy.ts`; enrollment score strategy |
| Exam/attempt timelines | ✅ | `pages/admin/ExamDetailPage.tsx`, audit timeline |
| Import/export job logs | ✅ | `routes/importLogs.ts`; `pages/admin/ImportLogsPage.tsx` |
| Diagnostics page (DB / Redis / scanner) | ✅ | `routes/system.ts` (redis ping at `system.ts`); `pages/admin/SystemDiagnosticsPage.tsx` |
| Result publishing modes | ✅ | Exam result-publishing config + admin/candidate result views |
| Client telemetry pipeline | ✅ | `routes/clientEvents.ts`; `packages/db/src/repository/clientEventRepo.ts` |
| Candidate/admin permission boundary | ✅ | `packages/authz` + `apps/api/src/authz/*` + conformance tests |

## Deferred timing / operation modes

| Capability | Status | Note |
|------------|--------|------|
| `timed_window` timing mode | ✅ | The only Phase 1 timing mode |
| `timed_sync` / `untimed` timing modes | ⬜ | Not implemented; deferred to Phase 3 |
| Queue admission (`requireQueue` + `batchSize` + `batchInterval`) | ⬜ | Not implemented; deferred (Phase 2 exam operation, not operationally wired) |
| Degradation / basic health check | 🟡 | Basic health check only. Full degradation is a Phase 2 feature that is itself not yet implemented (not "deferred to Phase 2") |

## Deferred infrastructure (present but dormant)

| Capability | Status | Evidence / Note |
|------------|--------|-----------------|
| Redis | 🟡 | **Code-level optional; Docker Compose default-on; no business path depends on it.** Adapter `apps/api/src/plugins/redis.ts` decorates `fastify.redis` and gracefully no-ops when `REDIS_URL` is unset/empty (`config/runtimeConfig.ts:386-393`). Compose (`docker-compose.yml`, `docker-compose.dev.yml`) deploys a `redis:7-alpine` service and wires `REDIS_URL` by default, so a deployed stack connects on boot. The **only** non-test production touch is a diagnostics ping in `routes/system.ts:277-282`. No business code (attempts, grading, proctor, sessions) reads/writes Redis (ADR-001). |
| Email | 🟡 | Full SMTP/outbox/retry plumbing under `apps/api/src/email/`; gated off by default (`EMAIL_ENABLED=false`). `routes/email.ts` `POST /email/test`. |
| WebSocket / SSE | ⬜ | Not present. Proctor dashboard uses HTTP polling (ADR-002). |
| Job queue | ⬜ | Not present. All work synchronous/request-scoped (ADR-003). |
| Desktop client | ⬜ | `apps/desktop/` does not exist. `controlFlags.requireLockdown` schema-only. ADR-004 records Desktop as DEFERRED; **runtime container TBD** (Electron vs another runtime is undecided — no accepted ADR fixes the implementation technology) |
| OCR | ⬜ | No code anywhere. |
| AI grading | ⬜ | Not present. |

## Phase 3+ deferred (per `docs/phase-roadmap.md`)

- Teacher-like / Proctor / Grader / ContentManager role bundles + scoped assignment.
- Permission registry UI, staff invitation, SMTP-based password reset,
  account activation/deactivation lifecycle.
- Fill-blank runtime/grading/E2E; subjective / rich-text answering; full
  manual-grading candidate-answer detail E2E; full subjective grading workflow.
- WYSIWYG submit final-answer barrier (ADR-008 Option D).
- Audit log search/export UI.

## Phase 4 deferred (platformization)

- Pass-to-proceed API, service tokens / API keys, webhooks, external
  integration.
- **Optional** `multiTenant`, SuperAdmin, tenant hierarchy / switcher / quota /
  backup, `organizationSlug` login, cross-tenant audit, external log shipping
  (Syslog/OTLP/SIEM).

## Wave 1 constraint

This matrix records status only. It does **not** authorize any change to the
deferred items, including Redis optionalization, package merges, or test
deletions beyond the Wave 1 mechanical/Type 1/Type 2 scope.
