# Implementation Status Matrix

> Code-evidenced capability status. Every row is backed by a file path in the
> repository. Not a copy of any phase plan.

```text
STATUS:          CURRENT
AUTHORITY:        Status
SCOPE:            Capability implementation status across api/web/packages
OWNER:            Architecture
LAST VERIFIED:    2712c01 — evidence from apps/api/src/routes, apps/web/src/pages,
                  packages/*/src
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
| Proctor monitoring (visibility + incident logging) | 🟡 | `routes/proctorMonitoring.ts` (dashboard, attempts, events, incident POST). Source comment defers force-submit/extend-time to "L7". |
| Force-submit / extend-time / misconduct state actions | ⬜ | No matches in routes/web. Only permission enum + audit-only incident recording exist. Deferred. |
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
| `timed_sync` / `untimed` timing modes | ⬜ | Deferred to Phase 2+ hardening / Phase 3 |
| Queue admission (`requireQueue` + `batchSize` + `batchInterval`) | ⬜ | Deferred (Phase 2 exam operation) |
| Degradation / basic health check | 🟡 | Basic health check only; full degradation deferred to Phase 2 |

## Deferred infrastructure (present but dormant)

| Capability | Status | Evidence / Note |
|------------|--------|-----------------|
| Redis | 🟡 | Adapter `apps/api/src/plugins/redis.ts`, compose service, diagnostics ping exist. **No production business path uses Redis.** Default disabled (ADR-001). |
| Email | 🟡 | Full SMTP/outbox/retry plumbing under `apps/api/src/email/`; gated off by default (`EMAIL_ENABLED=false`). `routes/email.ts` `POST /email/test`. |
| WebSocket / SSE | ⬜ | Not present. Proctor dashboard uses HTTP polling (ADR-002). |
| Job queue | ⬜ | Not present. All work synchronous/request-scoped (ADR-003). |
| Desktop / Electron | ⬜ | `apps/desktop/` does not exist. `controlFlags.requireLockdown` schema-only (ADR-004). |
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
