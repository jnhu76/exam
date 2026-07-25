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
P4 (RBAC MVP role switch) ✅ CLOSED
  → P5-0 (Email delivery runtime hardening) ✅ CLOSED (2026-07-25, PR #210)
  → P3 (result publishing closeout) ✅ CLOSED (2026-07-25, PR #211)
  → P5-N1 (Notification Inbox + result-published Email integration) 🔄 IMPLEMENTATION COMPLETE — FINAL REVIEW CORRECTIVES IN PROGRESS
  → P6 (MVP ready closeout) ⏸ BLOCKED until P5-N1 final corrective gates pass and PR is merged
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

## P3: Result publishing closeout (CLOSED)

- **CAPABILITY**: Results are published under the configured strategy; candidates see only what policy permits; Admin and Teacher access is verified under the final MVP role model.
- **CURRENT STATE**: **CLOSED** (2026-07-25, PR #211). P4, P5-0, and P3 are all closed (2026-07-25). The result-publication boundary is audited (P3-R0 reality audit) and test-only closed (P3-R1: M8 Teacher publish API proof, M9 Teacher all-view result proof, M12 Teacher browser publication E2E, M13 concurrent publication idempotency; no production behavior changes). Independent closeout review is satisfied; P5-N1-R0 owns the next contract correction.
  - P3-R0 reality audit: [`docs/audits/P3-R0-FINAL-ROLE-RESULT-PUBLISHING-REALITY-AUDIT.md`](../audits/P3-R0-FINAL-ROLE-RESULT-PUBLISHING-REALITY-AUDIT.md).
  - P3-R1 test-only closeout: [`docs/audits/P3-R1-FINAL-ROLE-RESULT-PUBLISHING-TEST-CLOSEOUT.md`](../audits/P3-R1-FINAL-ROLE-RESULT-PUBLISHING-TEST-CLOSEOUT.md).
- **WHAT EXISTS**: `resultVisibility` / `answerVisibility` separation; result publishing command; candidate and admin result surfaces; backend publication modes (`immediate`, `after_grading`, `manual`); frozen-question-snapshot truth; Teacher all-view (ScoreAllView) and publish (ExamResultPublish) capability behavior; browser publication UI through ExamDetailPage. The authoritative transaction seam is frozen at `apps/api/src/routes/exam.ts:1269-1279`.
- **WHAT IS MISSING**: (none — M8/M9/M12/M13 closed by P3-R1).
- **DEPENDENCIES**: P4 closed. P5-0 closed (not a semantic dependency of result publishing).
- **NOT AUTHORIZED ASSUMPTIONS**: Inbox or Email notification integration; additional result modes; redesign of grading; weakening answer-visibility rules; WYSIWYG final-answer barrier; IP/CIDR examination policy; concurrent-session/device policy; Candidate emergency examination credentials.
- **ACCEPTANCE BOUNDARY**: Under the final Admin/Teacher/Candidate role model, an authorized actor publishes results according to configured policy; the candidate can view only the candidate's own permitted result and cannot see hidden standard answers. The result-publication command and transaction boundary are stable; P5-N1 extends them without redefining result semantics.

## P4: RBAC MVP role switch — Admin / Teacher / Candidate (CLOSED)

- **CAPABILITY**: Three product roles enforced on MVP routes.
- **CURRENT STATE**: **CLOSED** (2026-07-24, tested commit `b4dc1d6`). The final
  Admin/Teacher/Candidate product-role model is activated on MVP routes. Final
  independent re-audit and closeout:
  [`docs/audits/P4-R1-FINAL-INDEPENDENT-REAUDIT-AND-CLOSEOUT.md`](../audits/P4-R1-FINAL-INDEPENDENT-REAUDIT-AND-CLOSEOUT.md).
  Gate 0.5 remains PASS; runtime inventory 91/81/10 with 81/81 registry MATCH;
  0 `requireRole` / 0 `requirePermission` / 0 `users.role`-authority;
  assignment-backed authority fail-closed; C1 residue cleanup, C2 frontend
  capability gating, and C3 three-role E2E all complete; six-spec E2E passes
  with zero skips; `pnpm verify` passes (exit 0). Accepted-deferred items
  (`CandidateDelete` / `SystemInfoView` product decisions; `GradingFinalize` /
  `GradingIdentityView` → M11; `System*` → System actor; `users.role` /
  `legacyMap.ts` compatibility residue) remain visible with owners and do not
  widen access.
- **WHAT EXISTS**: Capability catalog, role presets, assignment-backed authority, `requireCapability` gates on all routes; frontend route/action gating (`adminRouteCapabilities.ts` + `AdminLayout` per-route guard); explicit result-publish and result-view capability ownership frozen for P3.
- **WHAT IS MISSING**: (none — closed).
- **DEPENDENCIES**: Authorization infrastructure implemented. P3 closeout is not a prerequisite; P3 will verify the result flow after this role switch.
- **NOT AUTHORIZED ASSUMPTIONS**: Proctor role activation; independent Grader role activation; custom roles; tenant/course/exam scope; `teacher_exam_assignments`; scoped role dispatch (teacher@course, proctor@exam).
- **ACCEPTANCE BOUNDARY**: Admin/Teacher/Candidate each complete their MVP duties; unauthorized MVP-route access is rejected by the backend; result publication and result viewing have final, explicit role/capability ownership for P3 verification.

## P5-0: Email delivery runtime hardening (CLOSED)

- **CAPABILITY**: Existing PostgreSQL Email outbox runs as a resident, observable, failure-recoverable worker process.
- **CURRENT STATE**: **CLOSED** (2026-07-25, PR #210, commit `cac6b85`). The Email delivery runtime now implements the `pending|processing|retry_wait|sent|dead` state machine with `FOR UPDATE SKIP LOCKED` claim, persisted lock ownership, abandoned-lock recovery, PostgreSQL-backed heartbeat, and backlog/liveness diagnostics.
- **WHAT EXISTS**: `email_outbox`; `EmailDeliveryService` (renamed); SMTP, console, and disabled senders; retry policy; resident worker loop with claim/heartbeat; admin-only `POST /api/email/test`; existing Email diagnostics surface.
- **WHAT IS MISSING**: (none for P5-0 scope — Email runtime hardened). The Email runtime is implemented, but there is not yet a real business caller.
- **DEPENDENCIES**: P4 closed; ADR-011 accepted.
- **NOT AUTHORIZED ASSUMPTIONS**: Inbox; users.email; real business caller; invitation; password reset; template engine; generic queue platform; Redis/BullMQ/RabbitMQ/Kafka.
- **ACCEPTANCE BOUNDARY**: A standalone Email worker continuously claims, retries, and terminally records outbox rows without duplicate concurrent ownership; its heartbeat and backlog are visible through existing diagnostics.

## P5-N1: Notification Inbox + result-published Email integration (IMPLEMENTATION COMPLETE — FINAL REVIEW CORRECTIVES IN PROGRESS)

- **CAPABILITY**: First operational two-channel notification: candidate Inbox plus optional Email for `result_published`.
- **CURRENT STATE**: IMPLEMENTATION COMPLETE — FINAL REVIEW CORRECTIVES IN PROGRESS (PR #213). P3, P4, and P5-0 are all closed; the P5-N1-R0 audit owns the V1 contract correction and the frozen implementation scope. ADR-011 is the architecture authority (status corrected to **Accepted** by this audit).
- **WHAT EXISTS**: notifications migration + Drizzle schema; notification repository; NotificationService and result_published policy; optional users.email; grade_notification renderer; atomic publication → audit → Inbox → outbox flow; Inbox APIs; Candidate NotificationBell UI; API/unit/integration/E2E coverage; PUBLIC_WEB_ORIGIN and action-path validation.
- **WHAT IS MISSING**: final corrective verification; final independent review disposition; PR merge/closeout.
- **DEPENDENCIES**: P3, P4, and P5-0 closed.
- **NOT AUTHORIZED ASSUMPTIONS**: invitation/password reset migration; additional notification types; user preferences; announcements; WebSocket/SSE; stale-message skip; template engine; generic queue platform; `publicationVersion`; opaque-cursor pagination (repo uses offset/page); generic URL-security framework; removal of a nonexistent old Email caller.
- **ACCEPTANCE BOUNDARY**: Authorized manual result publication atomically commits result state, one candidate Inbox record, and a linked Email outbox row when an email exists; candidate can read the Inbox item and open the authoritative result at `/exam/:attemptId/result`; SMTP remains asynchronous.

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
