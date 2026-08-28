# Phase 3 Open Items

> **Status: superseded as an executable backlog (2026-08-14).** Executable
> Phase 3 product work is now tracked by GitHub Issues — see
> [`post-mvp-issues.md`](post-mvp-issues.md). This file is the historical
> Phase 3 product inventory with an Issue for every item. For implemented
> Phase 3 infrastructure, see
> [`docs/architecture/authorization.md`](../architecture/authorization.md) and
> [`docs/status/implementation-status.md`](../status/implementation-status.md).
> Phase scope authority: [`docs/roadmap/phase-roadmap.md`](phase-roadmap.md).
> Notification and Email architecture authority:
> [`docs/adr/ADR-011-notification-and-email-delivery.md`](../adr/ADR-011-notification-and-email-delivery.md).

The Phase 3 authorization **infrastructure** is implemented (capability model,
assignment-backed authority, permission boundary). The Phase 3 **product**
work that remains is Issue-owned:

| Item | Status | Issue |
| --- | --- | --- |
| P5-N2 — additional operational notification types | DEFERRED_TO_ISSUE | #299 |
| M11 — Teacher→Course scope (F-04) | CLOSED 2026-08-28 (PR #347) | #286 |
| M11 — Grader→Exam scope | CLOSED 2026-08-28 | #296 |
| Staff invitation + SMTP password reset + account lifecycle | DEFERRED_TO_ISSUE | #297 |
| Email template engine + backend i18n | DEFERRED_TO_ISSUE | #300 |
| Generic final-answer submit barrier (ADR-008 Option D) | DEFERRED_TO_ISSUE | #302 |
| Rich-text / WYSIWYG authoring and answering protocol | DEFERRED_TO_ISSUE | #301 |
| Permission registry + permission audit + audit-log search/export UI | DEFERRED_TO_ISSUE | #298 |
| Remaining i18n page-level admin form/modal copy | DEFERRED_TO_ISSUE | folded into #305 |

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
| P6 — MVP ready closeout | 2026-07-26, PR #215 | [`P6-MVP-READY-REALITY-AUDIT.md`](../audits/P6-MVP-READY-REALITY-AUDIT.md) |
| Plain-text `text_response` product loop | 2026-07-31, PRs #237/#238 | [`P2-TEXT-RESPONSE-AUTHORING-CLOSEOUT.md`](../audits/P2-TEXT-RESPONSE-AUTHORING-CLOSEOUT.md) |
| P7 — System Readiness and Exam Modes | 2026-08-14 | [`P7-FINAL-PROGRAM-CLOSEOUT.md`](../audits/P7-FINAL-PROGRAM-CLOSEOUT.md) |

## M11 note

All three M11 slices are **CLOSED**: the **Proctor→Exam slice** (ADR-015
Accepted, PR #245; J4-I1 runtime CLOSED, PR #250 — see
[`M11-I1-PROCTOR-EXAM-ASSIGNMENTS-CLOSEOUT.md`](../audits/M11-I1-PROCTOR-EXAM-ASSIGNMENTS-CLOSEOUT.md)),
the **Teacher→Course slice** (#286, PR #347 — `teacher_course_assignments`
carrier + `teacherAccess` gate + SQL-side LIST filtering), and the
**Grader→Exam slice** (#296 — `grader_exam_assignments` carrier +
`graderAccess` gate + grading-queue scope filtering before
pagination/count). Authority is `capability × assignment` in all three:
the scope row alone grants zero capabilities and Admin stays org-wide.

## Phase-roadmap alignment

Notification/Email scope and acceptance signals are owned by
[`docs/roadmap/phase-roadmap.md`](phase-roadmap.md) Phase 3. Do not move
identity invitation/password-reset scope out of Phase 3. Do not add
multiTenant behavior (Phase 4, #311).
