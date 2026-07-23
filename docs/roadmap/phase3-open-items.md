# Phase 3 Open Items

> Future work only. Each item records the capability, current state, what exists,
> what is missing, dependencies, and acceptance boundary. For implemented Phase 3
> infrastructure, see [`docs/architecture/authorization.md`](../architecture/authorization.md)
> and [`docs/status/implementation-status.md`](../status/implementation-status.md).
>
> Phase scope authority: [`docs/roadmap/phase-roadmap.md`](phase-roadmap.md).
> Notification and Email architecture authority:
> [`docs/adr/ADR-011-notification-and-email-delivery.md`](../adr/ADR-011-notification-and-email-delivery.md).

The Phase 3 authorization **infrastructure** is implemented (capability model,
assignment-backed authority, permission boundary). The items below are the
Phase 3 **product** work that remains.

## Module execution order (hard constraint)

```text
P4 (RBAC MVP role switch)
  → P5-0 (Email delivery runtime hardening)
  → P3 (result publishing closeout)
  → P5-N1 (Notification Inbox + result-published Email integration)
  → P6 (MVP ready closeout)
```

P2-1 authoring UI flow has been removed from the active Phase 3 plan by scope
decision.

P5 is a two-Job module:

```text
P5-0 = Email delivery infrastructure
P5-N1 = first real Inbox + Email business integration
```

P5-0 has no dependency on P3 and may be completed before result-publishing
closeout. P5-N1 depends on both P5-0 and P3 because it integrates directly with
the authoritative result-publication transaction and candidate result route.

Identity lifecycle remains separate future work and is not silently included in
P5-N1.

---

## P3: Result publishing closeout (QUEUED)

- **CAPABILITY**: Results are published under the configured strategy; candidates see only what policy permits; Admin and Teacher access is verified under the final MVP role model.
- **CURRENT STATE**: QUEUED after P5-0 in the hard execution order. Backend result-visibility modes already exist (`immediate`, `after_grading`, `manual`), but the published flow is not closed by final-role E2E and leak tests.
- **WHAT EXISTS**: `resultVisibility` / `answerVisibility` separation; result publishing command; candidate and admin result surfaces; backend publication modes.
- **WHAT IS MISSING**: Result-visibility E2E for manual or after-grading publication; candidate answer/standard-answer leak tests; Admin/Teacher result-view verification after the P4 role switch; a stable transaction and route boundary that P5-N1 can safely extend.
- **DEPENDENCIES**: P4 closed. P5-0 is ordered before P3 for delivery-infrastructure readiness but is not a semantic dependency of result publishing.
- **NOT AUTHORIZED ASSUMPTIONS**: Inbox or Email notification integration; additional result modes; redesign of grading; weakening answer-visibility rules.
- **ACCEPTANCE BOUNDARY**: Under the final Admin/Teacher/Candidate role model, an authorized actor publishes results according to configured policy; the candidate can view only the candidate's own permitted result and cannot see hidden standard answers. The result-publication command and transaction boundary are stable enough for P5-N1 to extend without redefining result semantics.

## P4: RBAC MVP role switch — Admin / Teacher / Candidate (QUEUED / NEXT)

- **CAPABILITY**: Three product roles enforced on MVP routes.
- **CURRENT STATE**: NEXT. Authorization infrastructure is implemented (see `docs/architecture/authorization.md`); this Job activates the final MVP product-role model before result-publishing closeout.
- **WHAT EXISTS**: Capability catalog, role presets, assignment-backed authority, `requireCapability` gates on all routes; existing result publication and result-view routes that can be assigned to the final role matrix.
- **WHAT IS MISSING**: MVP route matrix (route → capability → role → scope); migration of remaining MVP routes to Teacher capabilities; frontend navigation gating for Admin/Teacher/Candidate; explicit result-publish and result-view capability ownership.
- **DEPENDENCIES**: Authorization infrastructure implemented. P3 closeout is not a prerequisite; P3 will verify the result flow after this role switch.
- **NOT AUTHORIZED ASSUMPTIONS**: Proctor role activation; independent Grader role activation; custom roles; tenant/course/exam scope; `teacher_exam_assignments`; scoped role dispatch (teacher@course, proctor@exam).
- **ACCEPTANCE BOUNDARY**: Admin/Teacher/Candidate each complete their MVP duties; unauthorized MVP-route access is rejected by the backend; result publication and result viewing have final, explicit role/capability ownership for P3 verification.

## P5-0: Email delivery runtime hardening (QUEUED)

- **CAPABILITY**: Existing PostgreSQL Email outbox runs as a resident, observable, failure-recoverable worker process.
- **CURRENT STATE**: QUEUED after P4. Email outbox and sender foundation exist, but delivery is manually invoked and lacks production locking/heartbeat semantics.
- **WHAT EXISTS**: `email_outbox`; Email repository/service; SMTP, console, and disabled senders; retry policy; admin-only `POST /api/email/test`; existing Email diagnostics surface.
- **WHAT IS MISSING**: `pending|processing|retry_wait|sent|dead` target state machine; `FOR UPDATE SKIP LOCKED` claim; persisted lock ownership; abandoned-lock recovery; explicit worker build/start entry; PostgreSQL-backed heartbeat; backlog/liveness diagnostics; unambiguous `EmailDeliveryService` naming.
- **DEPENDENCIES**: P4 closed in the hard execution order; ADR-011 accepted. There is no dependency on P3 result-publishing closeout.
- **NOT AUTHORIZED ASSUMPTIONS**: Inbox; users.email; real business caller; invitation; password reset; template engine; generic queue platform; Redis/BullMQ/RabbitMQ/Kafka.
- **ACCEPTANCE BOUNDARY**: A standalone Email worker continuously claims, retries, and terminally records outbox rows without duplicate concurrent ownership; its heartbeat and backlog are visible through existing diagnostics.

## P5-N1: Notification Inbox + result-published Email integration (QUEUED)

- **CAPABILITY**: First operational two-channel notification: candidate Inbox plus optional Email for `result_published`.
- **CURRENT STATE**: QUEUED after P3 and P5-0. ADR-011 is the architecture authority.
- **WHAT EXISTS**: Result publishing command and result-visibility rules; hardened Email delivery runtime from P5-0; existing `EmailType` for grade notification.
- **WHAT IS MISSING**: Optional `users.email` recipient source; `notifications` table/repository/contracts; channel-neutral `NotificationService`; static `result_published -> grade_notification` policy mapping; safe relative action link; Inbox APIs and candidate UI; atomic result mutation + Inbox + outbox transaction; removal of any old route-local Email trigger.
- **DEPENDENCIES**: P3, P4, and P5-0 closed.
- **NOT AUTHORIZED ASSUMPTIONS**: invitation/password reset migration; additional notification types; user preferences; announcements; WebSocket/SSE; stale-message skip; template engine; generic queue platform.
- **ACCEPTANCE BOUNDARY**: Authorized result publication atomically commits result state, one candidate Inbox record, and a linked Email outbox row when an email exists; candidate can read the Inbox item and open the authoritative result; SMTP remains asynchronous.

## P5-N2: Operational notification expansion (DEFERRED — NOT STARTED)

- **CAPABILITY**: Migrate additional operational events onto the NotificationService one at a time.
- **CURRENT STATE**: DEFERRED until P5-N1 proves the architecture.
- **WHAT EXISTS**: ADR-011 event-policy model; after P5-N1, one implemented type (`result_published`).
- **WHAT IS MISSING**: Event-specific policy, payload, dedupe, transaction, action-path, API/UI behavior, and tests for `exam_assigned`, schedule change/cancellation, and grading assignment.
- **DEPENDENCIES**: P5-N1 closed; corresponding product flow and role must exist.
- **NOT AUTHORIZED ASSUMPTIONS**: bulk organization announcements; generic fan-out; notification preferences; identity lifecycle migration.
- **ACCEPTANCE BOUNDARY**: Each migrated event has one authoritative old/new path, explicit NotificationType→EmailType mapping, recipient-scoped dedupe, transaction tests, and no double-send.

## M11: Resource-relationship authorization (DEFERRED — NOT STARTED)

- **CAPABILITY**: Scoped resource assignment — Teacher→course, Proctor→exam, Grader→work.
- **CURRENT STATE**: DEFERRED. Design backlog only. **Verified unimplemented**: no junction tables (`teacher_course`, `exam_proctor`, `grading_assignment`, `course_staff`), no `scope_type`/`scope_resource_id` columns on `user_role_assignments`, no resource-scope resolver code.
- **WHAT EXISTS**: Design note (`docs/archive/phase3/RBAC-M11-RESOURCE-RELATIONSHIP-AUTHORIZATION-DESIGN-1.md`).
- **WHAT IS MISSING**: Everything (schema, resolvers, assignment UI, scope enforcement).
- **DEPENDENCIES**: P4 closed.
- **ACCEPTANCE BOUNDARY**: Scoped staff can be assigned to resources and see only their assigned scope.

## Staff invitation + SMTP password reset + account lifecycle (NOT STARTED)

- **CAPABILITY**: Staff invitation, Email password reset, activation/deactivation, and permission audit.
- **CURRENT STATE**: NOT STARTED. Identity flows are explicitly excluded from the first NotificationService migration.
- **WHAT EXISTS**: After P5-0/P5-N1: resident Email worker; sender adapters; optional `users.email`; Email outbox; retry and diagnostics; Email-only delivery path.
- **WHAT IS MISSING**: Invitation token lifecycle; invitation acceptance; password-reset token lifecycle; identity-specific rate limiting; account activation/deactivation UI; permission audit integration; auditable security events.
- **DEPENDENCIES**: P5-0 closed; P5-N1 closed for the shared optional email field. This item continues to use the Email-only path unless a later ADR explicitly migrates identity flows.
- **NOT AUTHORIZED ASSUMPTIONS**: Identity Inbox requirement; NotificationService migration; complex template engine; notification preference center; multi-tenant sender configuration.
- **ACCEPTANCE BOUNDARY**: Admin can invite staff through a single-use, expiring token; the recipient can activate the account and request a rate-limited password reset; activation/deactivation and security-relevant actions are audited; SMTP failure does not corrupt account state.

## Email template engine + backend i18n (NOT STARTED)

- **CAPABILITY**: Templated, localized Email bodies.
- **CURRENT STATE**: NOT STARTED. Pure design note; inline-string bodies remain.
- **WHAT EXISTS**: Existing EmailType values and delivery adapter; P5-N1 provides the first real operational caller.
- **WHAT IS MISSING**: Template registry; structured payloads; backend locale resolution; zh-CN rendering; future locale expansion; template tests.
- **DEPENDENCIES**: P5-N1 closed or another real Email caller exists.
- **NOT AUTHORIZED ASSUMPTIONS**: Full marketing template editor; user-authored HTML; per-organization branding; arbitrary locale negotiation.
- **ACCEPTANCE BOUNDARY**: Email bodies are selected by EmailType and rendered from structured payloads through a tested zh-CN backend locale path rather than route-local inline strings.

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

---

## Required phase-roadmap alignment

Because `docs/roadmap/phase-roadmap.md` is the phase-scope authority, the same PR
that adopts this Open Items update should make the following minimal Phase 3
alignment:

Add to Phase 3 **In scope**:

```text
- In-app notification Inbox for selected operational events.
- Asynchronous PostgreSQL-outbox Email delivery with a resident observable worker.
- First operational notification integration for result publication.
```

Add to Phase 3 **Acceptance signals**:

```text
- Candidate can receive and read a result-publication Inbox notification.
- A configured candidate email address receives the corresponding asynchronous
  result notification without SMTP participating in the result transaction.
- Email worker liveness and backlog are observable through diagnostics.
```

Do not move identity invitation/password-reset scope out of Phase 3. Do not add
multiTenant behavior.
