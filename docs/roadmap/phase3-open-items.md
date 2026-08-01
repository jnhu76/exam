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
  → P5-N1 (Notification Inbox + result-published Email integration) ✅ CLOSED (2026-07-25, PR #213)
  → P6 (MVP ready closeout) ✅ CLOSED (2026-07-26, PR #215)
  → P7 (system readiness + configurable exam modes) 🟣 PLANNING
```

The former P2-1 Exam Authoring UI Flow was removed from the active Phase 3 plan
by scope decision; the plain-text `text_response` authoring loop was later
implemented and closed (PRs #237/#238, 2026-07-31).

P7 is the next planning program — system readiness, Redis adoption,
backup/recovery, outage recovery, configuration control plane, exam modes, and
UI closeout. See
[`docs/roadmap/P7-system-readiness-and-exam-modes.md`](P7-system-readiness-and-exam-modes.md).
P7 does not redefine M11. Identity lifecycle remains separate future work.

---

## Closed programs (closeout references only)

Detailed capability, evidence, and acceptance history for closed programs lives
in the closeout audits and
[`docs/status/implementation-status.md`](../status/implementation-status.md).
The archived job plans under `docs/archive/roadmap/` are reference-only.

| Program | Closed | Closeout evidence |
| --- | --- | --- |
| P4 — RBAC MVP role switch (Admin / Teacher / Candidate) | 2026-07-24, tested commit `b4dc1d6` | [`P4-R1-FINAL-INDEPENDENT-REAUDIT-AND-CLOSEOUT.md`](../audits/P4-R1-FINAL-INDEPENDENT-REAUDIT-AND-CLOSEOUT.md) |
| P5-0 — Email delivery runtime hardening | 2026-07-25, PR #210 (`cac6b85`) | archived plan [`P5-0-email-delivery-runtime-hardening-job.md`](../archive/roadmap/P5-0-email-delivery-runtime-hardening-job.md) |
| P3 — Result publishing closeout | 2026-07-25, PR #211 | [`P3-R0-FINAL-ROLE-RESULT-PUBLISHING-REALITY-AUDIT.md`](../audits/P3-R0-FINAL-ROLE-RESULT-PUBLISHING-REALITY-AUDIT.md), [`P3-R1-FINAL-ROLE-RESULT-PUBLISHING-TEST-CLOSEOUT.md`](../audits/P3-R1-FINAL-ROLE-RESULT-PUBLISHING-TEST-CLOSEOUT.md) |
| P5-N1 — Notification Inbox + result-published Email | 2026-07-25, PR #213 (`0b36aab`) | [`P5-N1-I3-CLOSEOUT.md`](../audits/P5-N1-I3-CLOSEOUT.md), [`P5-N1-R0-NOTIFICATION-INBOX-RESULT-PUBLISHED-REALITY-AUDIT.md`](../audits/P5-N1-R0-NOTIFICATION-INBOX-RESULT-PUBLISHED-REALITY-AUDIT.md); archived plan [`P5-N1-notification-inbox-result-published-job-v2.md`](../archive/roadmap/P5-N1-notification-inbox-result-published-job-v2.md) |

## P5-N2: Operational notification expansion (DEFERRED — NOT STARTED)

- **CAPABILITY**: Migrate additional operational events onto the NotificationService one at a time.
- **CURRENT STATE**: DEFERRED — architecture now proven by P5-N1 (CLOSED). Eligible to start; not yet scoped into an active Job.
- **WHAT EXISTS**: ADR-011 event-policy model; one implemented type (`result_published`) delivered by P5-N1.
- **WHAT IS MISSING**: Event-specific policy, payload, dedupe, transaction, action-path, API/UI behavior, and tests for `exam_assigned`, schedule change/cancellation, and grading assignment.
- **DEPENDENCIES**: P5-N1 closed (✅); corresponding product flow and role must exist.
- **NOT AUTHORIZED ASSUMPTIONS**: bulk organization announcements; generic fan-out; notification preferences; identity lifecycle migration.
- **ACCEPTANCE BOUNDARY**: Each migrated event has one authoritative old/new path, explicit NotificationType→EmailType mapping, recipient-scoped dedupe, transaction tests, and no double-send.

## M11: Resource-relationship authorization (Proctor→Exam slice IN REVIEW; rest NOT STARTED)

- **CAPABILITY**: Scoped resource assignment — Teacher→course, Proctor→exam, Grader→work.
- **CURRENT STATE**: The **Proctor→Exam slice** (J4-R0) is **IN REVIEW** as
  ADR-015 Proposed
  ([`docs/adr/ADR-015-proctor-exam-scope-authority.md`](../adr/ADR-015-proctor-exam-scope-authority.md))
  with reality audit
  ([`M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md`](../audits/M11-R0-PROCTOR-EXAM-SCOPE-REALITY-AUDIT.md));
  it is documentation-only and changes no runtime code. J4-I1 (runtime) is
  BLOCKED until ADR-015 is independently reviewed and Accepted. The
  Teacher→Course, Teacher→Exam, and Grader→Work slices remain DEFERRED —
  explicitly out of J4 scope. **Verified unimplemented**: no junction tables
  (`teacher_course`, `exam_proctor`, `grading_assignment`, `course_staff`), no
  `scope_type`/`scope_resource_id` columns on `user_role_assignments`, no
  Incident→Exam resolver, no Proctor-assignment resolver.
- **WHAT EXISTS**: ADR-015 (Proposed, Proctor→Exam slice); design note
  (`docs/archive/phase3/RBAC-M11-RESOURCE-RELATIONSHIP-AUTHORIZATION-DESIGN-1.md`).
- **WHAT IS MISSING**: Everything runtime (schema, resolvers, assignment UI,
  scope enforcement) — owned by J4-I1 after ADR-015 acceptance.
- **DEPENDENCIES**: P4 closed; ADR-015 acceptance for the Proctor→Exam slice.
- **ACCEPTANCE BOUNDARY**: Scoped staff can be assigned to resources and see only their assigned scope.

## Staff invitation + SMTP password reset + account lifecycle (NOT STARTED)

- **CAPABILITY**: Staff invitation, Email password reset, activation/deactivation, and permission audit.
- **CURRENT STATE**: NOT STARTED. Identity flows are explicitly excluded from the first NotificationService migration.
- **WHAT EXISTS**: After P5-0/P5-N1: resident Email worker; sender adapters; optional `users.email`; Email outbox; retry and diagnostics; Email-only delivery path.
- **WHAT IS MISSING**: Invitation token lifecycle; invitation acceptance; password-reset token lifecycle; identity-specific rate limiting; account activation/deactivation UI; permission audit integration; auditable security events.
- **DEPENDENCIES**: P5-0 closed (✅); P5-N1 closed (✅) for the shared optional email field. This item continues to use the Email-only path unless a later ADR explicitly migrates identity flows.
- **NOT AUTHORIZED ASSUMPTIONS**: Identity Inbox requirement; NotificationService migration; complex template engine; notification preference center; multi-tenant sender configuration.
- **ACCEPTANCE BOUNDARY**: Admin can invite staff through a single-use, expiring token; the recipient can activate the account and request a rate-limited password reset; activation/deactivation and security-relevant actions are audited; SMTP failure does not corrupt account state.

## Email template engine + backend i18n (NOT STARTED)

- **CAPABILITY**: Templated, localized Email bodies.
- **CURRENT STATE**: NOT STARTED. Pure design note; inline-string bodies remain.
- **WHAT EXISTS**: Existing EmailType values and delivery adapter; P5-N1 (✅) provides the first real operational caller.
- **WHAT IS MISSING**: Template registry; structured payloads; backend locale resolution; zh-CN rendering; future locale expansion; template tests.
- **DEPENDENCIES**: P5-N1 closed (✅) or another real Email caller exists.
- **NOT AUTHORIZED ASSUMPTIONS**: Full marketing template editor; user-authored HTML; per-organization branding; arbitrary locale negotiation.
- **ACCEPTANCE BOUNDARY**: Email bodies are selected by EmailType and rendered from structured payloads through a tested zh-CN backend locale path rather than route-local inline strings.

## Generic final-answer submit barrier — ADR-008 Option D (NOT STARTED)

- **CAPABILITY**: `/submit` carries a final-answer payload or version/hash
  barrier so the UI answer at submit-click time is the grading authority
  (ADR-008 Option D). This is **answer-type-independent**: single choice,
  multi-select, true/false, fill-blank, and text answers can all hit the
  save/submit lock-ordering race the barrier closes. It is not a rich-text
  feature.
- **CURRENT STATE**: Proposed / not started. Phase 3 product task. Closing the
  plain-text `text_response` loop does not close this barrier.
- **WHAT EXISTS**: ADR-008 (submit freeze barrier, Phase 2 conservative —
  current `submitted_answers` freeze). The Option D barrier is the follow-up.
- **WHAT IS MISSING**: The `/submit` final-answer payload or answer-version/hash
  contract; server-side confirmation inside the submit transaction; frontend
  submit payload construction; transaction contract for all supported answer
  types.
- **DEPENDENCIES**: None blocking.
- **ACCEPTANCE BOUNDARY**: The answer captured at submit-click is provably the
  graded answer for every supported answer type, closing the save/submit race
  the Phase 2 conservative barrier left open.

## Rich-text/WYSIWYG authoring and answering protocol (NOT STARTED)

- **CAPABILITY**: Rich-text/WYSIWYG question authoring and candidate answering,
  including attachment/formula policy if adopted.
- **CURRENT STATE**: Proposed / not started. Distinct from the generic
  final-answer submit barrier above.
- **WHAT EXISTS**: Plain-text `text_response` authoring + answering loop
  (CLOSED, PRs #237/#238); `QuestionType` supports `text_response` today.
- **WHAT IS MISSING**: Rich-text editor; storage format; sanitization; image/
  formula/attachment handling; candidate rendering; rich-text grading basis;
  authority and sanitization rules.
- **DEPENDENCIES**: None blocking.
- **ACCEPTANCE BOUNDARY**: A future rich-text protocol has explicit authority
  and sanitization rules before activation, and does not regress the closed
  plain-text loop.

## Remaining i18n page-level copy migration (NOT STARTED)

- **CAPABILITY**: All admin form/modal user-visible copy flows through `t()`.
- **CURRENT STATE**: Production-source hardcoded-copy gate (`pnpm lint:copy`) passes for all production source. Page-level admin form/modal content deferred from J7 remains.
- **WHAT IS MISSING**: CandidateFieldsPage, ExamConfigForm, QuestionForm, etc. admin form/modal copy.
- **DEPENDENCIES**: None.
- **ACCEPTANCE BOUNDARY**: `pnpm lint:copy` continues to pass; remaining admin form copy migrated.

---

## Phase-roadmap alignment

Notification/Email scope and acceptance signals are owned by
[`docs/roadmap/phase-roadmap.md`](phase-roadmap.md) Phase 3 **In scope** and
**Acceptance signals**. Do not move identity invitation/password-reset scope out
of Phase 3. Do not add multiTenant behavior.
