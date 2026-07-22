# Phase 3 Open Items

> Future work only. Each item records the capability, current state, what exists,
> what is missing, dependencies, and acceptance boundary. For implemented Phase 3
> infrastructure, see [`docs/architecture/authorization.md`](../architecture/authorization.md)
> and [`docs/status/implementation-status.md`](../status/implementation-status.md).
>
> Phase scope authority: [`docs/roadmap/phase-roadmap.md`](phase-roadmap.md).

The Phase 3 authorization **infrastructure** is implemented (capability model,
assignment-backed authority, permission boundary). The items below are the
Phase 3 **product** work that remains.

## Module execution order (hard constraint)

```text
P2 (authoring, ACTIVE) → P3 (result publishing) → P4 (RBAC MVP role switch)
  → P5 (email minimal) → P6 (MVP ready closeout)
```

---

## P2-1: Exam authoring UI flow (ACTIVE / CORRECTIVE REQUIRED)

- **CAPABILITY**: Teacher/Admin creates MVP question types and assembles/publishes exams from the UI.
- **CURRENT STATE**: ACTIVE — authoring UI flow audit found gaps.
- **WHAT EXISTS**: Question CRUD API + Exam create/publish commands; Question CSV import.
- **WHAT IS MISSING**: `text_response` authoring UI (rubric entry at publish); complete authoring→publish→candidate-visible E2E. Audit source: `docs/archive/phase3/p2-authoring-ui-flow-audit.md`.
- **DEPENDENCIES**: P-1/L0 protocol (CLOSED), P0 candidate runtime (CLOSED).
- **NOT AUTHORIZED ASSUMPTIONS**: random paper builder; question tag/category UI; question version history UI; batch import/export redesign.
- **ACCEPTANCE BOUNDARY**: Teacher can create objective + text_response questions, assemble an exam, publish, and a candidate can start the resulting exam.

## P3: Result publishing closeout (QUEUED)

- **CAPABILITY**: Results published per configured strategy; candidates see only what they are allowed to see.
- **CURRENT STATE**: QUEUED after P2. Backend result-visibility modes exist (immediate / after_grading / manual).
- **WHAT EXISTS**: `resultVisibility` / `answerVisibility` separation; result publishing command; admin result view.
- **WHAT IS MISSING**: Result-visibility E2E (manual or after-grading); candidate answer/standard-answer leak test; admin/teacher result-view verification in published flow.
- **DEPENDENCIES**: P2 closed.
- **ACCEPTANCE BOUNDARY**: After scoring + publish policy allows, candidate views own result and cannot see hidden standard answers.

## P4: RBAC MVP role switch — Admin / Teacher / Candidate (QUEUED)

- **CAPABILITY**: Three product roles enforced on MVP routes.
- **CURRENT STATE**: QUEUED after P3. Authorization infrastructure is implemented (see `docs/architecture/authorization.md`); this is the product role switch.
- **WHAT EXISTS**: Capability catalog, role presets, assignment-backed authority, `requireCapability` gates on all routes.
- **WHAT IS MISSING**: MVP route matrix (route → capability → role → scope); migration of remaining MVP routes to Teacher capabilities; frontend navigation gating for the three roles. Design matrix source: `docs/archive/phase3/p4-mvp-rbac-route-matrix.md`.
- **DEPENDENCIES**: P3 closed.
- **NOT AUTHORIZED ASSUMPTIONS**: Proctor role activation; independent Grader role activation; custom roles; tenant/course/exam scope; `teacher_exam_assignments`; scoped role dispatch (teacher@course, proctor@exam).
- **ACCEPTANCE BOUNDARY**: Admin/Teacher/Candidate each complete their MVP duties; unauthorized MVP-route access rejected by backend.

## M11: Resource-relationship authorization (DEFERRED — NOT STARTED)

- **CAPABILITY**: Scoped resource assignment — Teacher→course, Proctor→exam, Grader→work.
- **CURRENT STATE**: DEFERRED. Design backlog only. **Verified unimplemented**: no junction tables (`teacher_course`, `exam_proctor`, `grading_assignment`, `course_staff`), no `scope_type`/`scope_resource_id` columns on `user_role_assignments`, no resource-scope resolver code.
- **WHAT EXISTS**: Design note (`docs/archive/phase3/RBAC-M11-RESOURCE-RELATIONSHIP-AUTHORIZATION-DESIGN-1.md`).
- **WHAT IS MISSING**: Everything (schema, resolvers, assignment UI, scope enforcement).
- **DEPENDENCIES**: P4 closed.
- **ACCEPTANCE BOUNDARY**: Scoped staff can be assigned to resources and see only their assigned scope.

## Staff invitation + SMTP password reset + account lifecycle (NOT STARTED)

- **CAPABILITY**: Staff invitation flow, email password reset, user activation/deactivation, permission audit.
- **CURRENT STATE**: NOT STARTED. Email outbox/SMTP foundation exists but has no business caller (see below).
- **WHAT EXISTS**: Email outbox + 3 senders + retry policy + notification service + `POST /api/email/test` (admin-only connectivity probe).
- **WHAT IS MISSING**: `users.email` column; business callers wiring real events to `EmailNotificationService.enqueueBestEffort`; resident outbox worker daemon (analogous to `deadlineScanner`); invitation token lifecycle; password-reset flow; account activation/deactivation UI; permission audit.
- **DEPENDENCIES**: P5 (email minimal trigger) for the email path.
- **NOT AUTHORIZED ASSUMPTIONS**: complex template engine; notification history UI; email preference center.
- **ACCEPTANCE BOUNDARY**: A real business event enqueues a minimal email via the existing outbox without making the core exam transaction depend on SMTP availability.

## Email template engine + backend i18n (NOT STARTED)

- **CAPABILITY**: Templated, localized email bodies.
- **CURRENT STATE**: NOT STARTED. Pure design note.
- **WHAT EXISTS**: Design note (`docs/archive/phase3/...` via original `docs/phase3/emails/email-templates-i18n.md`); inline-string bodies only.
- **WHAT IS MISSING**: Template engine; backend i18n; multi-locale.
- **DEPENDENCIES**: A real email trigger entering scope (P5).
- **ACCEPTANCE BOUNDARY**: Templated zh-CN (and future locale) email bodies driven by event type, not inline strings.

## WYSIWYG submit final-answer barrier (NOT STARTED)

- **CAPABILITY**: `/submit` carries a final-answer payload / version barrier so the UI answer at submit-click time is the grading authority (ADR-008 Option D).
- **CURRENT STATE**: Proposed / not started. Phase 3 product task.
- **WHAT EXISTS**: ADR-008 (submit freeze barrier, Phase 2 conservative — current `submitted_answers` freeze). The WYSIWYG barrier is the Option D follow-up.
- **WHAT IS MISSING**: The `/submit` final-answer payload contract + UI barrier.
- **DEPENDENCIES**: None blocking.
- **ACCEPTANCE BOUNDARY**: The answer captured at submit-click is provably the graded answer, closing the save/submit race the Phase 2 conservative barrier left open.

## Remaining i18n page-level copy migration (NOT STARTED)

- **CAPABILITY**: All admin form/modal user-visible copy flows through `t()`.
- **CURRENT STATE**: Production-source hardcoded-copy gate (`pnpm lint:copy`) passes for all production source. Page-level admin form/modal content deferred from J7 remains.
- **WHAT IS MISSING**: CandidateFieldsPage, ExamConfigForm, QuestionForm, etc. admin form/modal copy.
- **DEPENDENCIES**: None.
- **ACCEPTANCE BOUNDARY**: `pnpm lint:copy` continues to pass; remaining admin form copy migrated.
