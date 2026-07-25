# P5-N1 — Notification Inbox + Result-Published Email Integration

## 1. Summary

Implement the first operational notification end to end:

```text
result_published
```

The implementation adds:

```text
- a first-class PostgreSQL Inbox notification
- minimal candidate Inbox APIs and UI
- a channel-neutral NotificationService
- explicit NotificationType -> EmailType mapping
- optional Email enqueue through the hardened existing Email delivery path
- atomic result-publication + Inbox + outbox persistence
```

This Job depends on P5-0 Email Delivery Runtime Hardening.

It does **not** redesign SMTP, the worker state machine, heartbeat, or diagnostics.

ADR authority:

```text
docs/adr/ADR-011-notification-and-email-delivery.md
```

---

## 2. Prerequisites

```text
P4 Admin / Teacher / Candidate MVP role switch closed
P5-0 Email Delivery Runtime Hardening closed
P3 Result Publishing Closeout closed
```

P2-1 Exam Authoring UI Flow is not a prerequisite and has been removed from
the active execution plan.

Before editing, verify:

```text
- result-publish command and transaction boundary
- candidate result route used by the frontend
- current EmailType values
- EmailDeliveryService interface after P5-0
- current user/candidate create and update flows
- current pagination and error-response conventions
```

Do not assume an existing result-publication Email caller. The verified baseline
before P5-N1 is that the Email foundation exists but the first real business
caller is still missing.

---

## 3. Classification

```text
[x] domain / contracts
[x] database / migration
[x] repository
[x] application service / policy
[x] business-command transaction
[x] API / authorization
[x] frontend
[x] E2E / regression
[ ] Email worker redesign
[ ] SMTP provider redesign
[ ] identity lifecycle
[ ] generic notification platform
```

---

## 4. Goal

When an authorized Admin or Teacher publishes results under the existing
result-visibility rules:

```text
result publication transaction
    |
    +--> result state mutation
    +--> one Inbox notification per eligible candidate
    +--> one Email outbox row per eligible candidate with an email address
    |
    +--> commit atomically
```

After commit:

```text
candidate
    |
    +--> sees unread badge
    +--> opens Inbox
    +--> marks notification read
    +--> navigates to the authoritative result page

email worker
    |
    +--> asynchronously delivers the existing grade-notification Email
```

SMTP availability does not participate in the result-publication transaction.

---

## 5. Scope boundary

Implement only:

```text
NotificationType.ResultPublished = "result_published"
```

Mapping:

```text
result_published -> EmailType.GradeNotification
```

Use the actual existing `EmailType` identifier from
`packages/domain/src/email.ts`; do not infer by string equality.

Defer:

```text
exam_assigned
exam_time_changed
exam_cancelled
grading_assigned
announcements
identity flows
```

---

## 6. Minimal recipient-email source

The current verified user schema has no email column. A real Email trigger cannot
be implemented without a trustworthy recipient source.

Add the smallest product-complete source:

```text
users.email
- nullable
- normalized on write
- validated by contracts
```

Wire it into the existing Admin user/candidate create and edit flow so that an
email can actually be stored and corrected.

Requirements:

- email remains optional;
- blank input is stored as null;
- trim surrounding whitespace; preserve the validated address spelling/case (no lowercase — Email is not a login identifier, not unique, no case-insensitive lookup required);
- do not invent invitation, verification, uniqueness, or ownership semantics;
- do not require email for login;
- do not add organization switching;
- candidate CSV email import is deferred unless it already exists naturally in
  the same schema and can be added without redesigning import.

A candidate without email still receives Inbox notification.

---

## 7. Domain and type model

Add:

```text
packages/domain/src/notification.ts
```

V1 types:

```text
NotificationType:
  result_published

NotificationSeverity:
  info
```

Do not add speculative future notification types merely because ADR-011 lists
examples.

`NotificationType` and `EmailType` are independent. The mapping belongs in
policy code and is tested explicitly.

---

## 8. Database model

### 8.1 `notifications`

Add:

```text
notifications
- id
- organization_id       NOT NULL FK -> organizations.id
- recipient_user_id     NOT NULL FK -> users.id
- type                   NOT NULL
- title                  NOT NULL
- body                   NOT NULL
- severity               NOT NULL
- resource_type          nullable
- resource_id            nullable
- action_path            NOT NULL (V1 has no non-actionable notification type)
- created_at             NOT NULL
- read_at                nullable
- archived_at            nullable
- invalidated_at         nullable
- dedupe_key             nullable
```

Required scope and indexes:

```text
Inbox scope:
  organization_id + recipient_user_id

Stable list order:
  organization_id + recipient_user_id + created_at DESC + id DESC

Unread count:
  organization_id + recipient_user_id + read_at

Dedup:
  UNIQUE (
    organization_id,
    recipient_user_id,
    dedupe_key
  )
  WHERE dedupe_key IS NOT NULL
```

Use the real default organization ID from trusted context. Never use a sentinel.

### 8.2 Extend `email_outbox`

Add:

```text
notification_id     nullable FK -> notifications.id
recipient_user_id   nullable FK -> users.id
```

Operational result Email rows link to their Inbox notification.

Identity Email remains allowed to use:

```text
notification_id = null
```

Do not migrate identity flows in this Job.

---

## 9. Dedupe rules

### Inbox dedupe key

Use a stable result-publication key at recipient scope:

```text
result_published:{examId}
```

`{examId}` is the stable business identity of the publication event. Because
`resultsPublishedAt` is write-once, `result_published:{examId}` is immutable and
globally unique per exam. No `publicationVersion` concept exists — publication
is a single irreversible `resultsPublishedAt: null → non-null` transition.

### Email outbox dedupe key

Email outbox uniqueness is:

```text
organization_id + recipient-scoped dedupe_key
```

Example:

```text
result_published:{examId}:{recipientUserId}
```

Different recipients must never collide.

Retry reuses the same row.

---

## 10. Notification application service

Add:

```text
apps/api/src/notifications/
  service.ts
  policy.ts
  actionLink.ts
  types.ts
```

### `NotificationService`

This is the channel-neutral service.

Suggested command-specific entry:

```ts
notifyResultPublished(tx, input)
```

Input contains trusted identifiers and display data, not arbitrary Email content:

```text
organizationId
recipientUserId
recipientEmail | null
examId
attemptId
examTitle
actionPath (NOT NULL — builder always produces a valid path)
```

Responsibilities:

```text
1. evaluate static policy
2. validate and normalize actionPath
3. insert Inbox notification idempotently
4. enqueue linked Email outbox row when recipientEmail exists
5. keep NotificationType -> EmailType mapping explicit
```

Do not query SMTP, send inline, or construct Fastify dependencies in the service.

### Static V1 policy

```text
result_published:
  Inbox = required
  Email = enabled when normalized recipient email exists
```

No user preferences, organization preferences, digests, or quiet hours.

---

## 11. Transaction boundary — hard requirement

For `result_published`, the following must be committed in one PostgreSQL
transaction:

```text
result publication state mutation
Inbox notification rows
required Email outbox rows
```

Requirements:

- repositories accept the same transaction context;
- SMTP is not called;
- a failed required Inbox/outbox write rolls back result publication;
- duplicate invocation is idempotent;
- the old route-local Email path is removed in the same change;
- old and new paths must not dual-send.

Do not preserve the previous P5-N1 post-commit best-effort debt.

If the current result-publish command cannot share a transaction, make the
smallest command/repository refactor required to establish this boundary.

Email delivery failure after commit does not alter result publication.

---

## 12. Action path and public origin

Add or reuse:

```text
PUBLIC_WEB_ORIGIN
```

through the existing runtime-config boundary.

Store only a validated site-relative path.

Use the real candidate result route from `apps/web/src/lib/routes.ts`, expected
to be under the current `/exam/*` route family. Do not invent `/candidate/*`
unless that route actually exists.

Validation occurs:

```text
write time
render time
```

Reject:

```text
external URLs
protocol-relative URLs
backslashes
control characters
dot-dot traversal
percent-encoded traversal
unknown route prefixes
```

Add a centralized test fixture that proves every V1 notification action path is
accepted by the whitelist.

---

## 13. Contracts and Inbox API

Add notification contracts with offset/page pagination (reuse `PaginationParamsSchema`).

Routes:

```http
GET  /api/notifications
GET  /api/notifications/unread-count
POST /api/notifications/:id/read
POST /api/notifications/read-all
```

### List

```text
default pageSize = 20
maximum pageSize = 100
order = created_at DESC, id DESC
pagination = offset/page (reuses PaginationParamsSchema bounds)
optional unread=true
```

### Authorization

All operations derive scope from authenticated context:

```text
organization_id
recipient_user_id / actor ID
```

Clients do not pass organization ID or recipient ID.

Access to another user's notification returns non-leaking not-found behavior.

`read_at` does not represent business completion.

---

## 14. Frontend

Add the smallest usable Inbox:

```text
NotificationBell
unread badge
notification list page or panel
empty/loading/error states
mark one read
mark all read
action navigation
```

Use current Tailwind, shadcn, Lucide, route, API, and i18n conventions.

Polling is sufficient:

```text
load count on authenticated app start
refresh after read operations
optional bounded interval using existing polling conventions
```

No WebSocket/SSE/browser push.

Result navigation must land on the authoritative existing result page.

---

## 15. `EMAIL_ENABLED=false`

P5-N1 preserves the Email-runtime semantics established by P5-0 and ADR-011:

```text
Inbox is still created
Email outbox row is still created when an email exists
DisabledEmailSender may process the row without external SMTP delivery
```

Tests and UI must not claim that `sent` unconditionally means externally
delivered.

P5-N1 does not introduce `skipped`, stale TTL, or Email preference behavior.

---

## 16. Required tests

### User email source

- create/update user with valid email;
- blank email becomes null;
- malformed email rejected;
- candidate without email remains valid;
- email is not required for authentication.

### Notification repository

- create notification;
- duplicate dedupe key is idempotent;
- same key for different recipients does not conflict;
- list uses stable created_at/id order;
- offset/page paging works;
- unread count;
- mark one read;
- mark all read;
- organization + recipient isolation.

### Action link

- real result route accepted;
- write-time validation;
- render-time revalidation;
- external URL rejected;
- protocol-relative URL rejected;
- traversal and encoded traversal rejected;
- backslash/control characters rejected;
- route fixture and whitelist stay synchronized.

### Policy and mapping

- result_published requires Inbox;
- result_published maps explicitly to actual GradeNotification EmailType;
- missing email produces Inbox only;
- NotificationType/EmailType string equality is not assumed.

### Transaction integration

- result state + Inbox + outbox commit together;
- Inbox insertion failure rolls back result publication;
- outbox insertion failure rolls back required result publication transaction;
- no SMTP call inside transaction;
- duplicate publication trigger does not duplicate rows;
- old Email path is removed;
- no double-send path remains.

### API

- unauthenticated requests rejected;
- candidate lists only own notifications;
- same-organization other-user access rejected;
- mark read idempotent;
- read-all scoped correctly;
- pagination limit bounded.

### Frontend

- unread badge;
- empty/loading/error states;
- list and stable navigation;
- mark one read;
- mark all read;
- result action opens correct route.

### Regression

- P5-0 worker and Email tests pass;
- result visibility rules remain authoritative;
- hidden standard-answer protections remain unchanged;
- Admin/Teacher capability gates remain enforced;
- full verify passes.

---

## 17. Explicit non-goals

```text
- worker state-machine redesign
- worker locking / heartbeat redesign
- SMTP provider migration
- invitation
- activation
- password reset
- password-change warning
- account recovery
- identity-flow NotificationService migration
- exam-assigned notification
- schedule-change/cancellation notification
- grading-assigned notification
- announcements
- preferences / unsubscribe / digest / quiet hours
- per-recipient rate limit
- stale-message TTL or skipped status
- retention cleanup
- manual dead-letter UI
- browser/mobile push
- WebSocket/SSE
- large-scale fan-out
- generic job queue
- template engine / backend i18n
```

---

## 18. Suggested execution order

```text
1. Verify P4, P5-0, and P3 closeout baselines
2. Add nullable users.email and minimal Admin editing
3. Add notification domain and contracts
4. Add notifications schema/repository
5. Add email_outbox notification/user linkage
6. Add PUBLIC_WEB_ORIGIN and actionLink validation
7. Add static policy and NotificationService
8. Refactor result publication into shared transaction boundary
9. Remove old Email-only trigger
10. Add Inbox routes
11. Add candidate Inbox UI
12. Add E2E and regression coverage
```

---

## 19. Suggested commit boundaries

```bash
git commit -m "feat(user): add optional notification email address"
git commit -m "feat(notification): add inbox domain contracts and persistence"
git commit -m "feat(notification): add action link validation and policy mapping"
git commit -m "feat(notification): add channel-neutral notification service"
git commit -m "feat(result): publish inbox and email outbox atomically"
git commit -m "feat(api): add notification inbox endpoints"
git commit -m "feat(web): add notification inbox and unread badge"
git commit -m "test(notification): cover transaction dedupe auth and navigation"
```

---

## 20. Acceptance criteria

```text
[ ] P4 is closed
[ ] P5-0 is closed
[ ] P3 result-publishing closeout is closed
[ ] users.email exists as an optional validated recipient source
[ ] Candidate without email still works and receives Inbox
[ ] notifications.organization_id is a real non-null organization FK
[ ] Inbox queries use organization + recipient scope
[ ] result_published is the only NotificationType implemented
[ ] NotificationType -> EmailType mapping is explicit
[ ] Operational Email row links to its Inbox notification
[ ] Identity Email may keep notification_id null
[ ] Inbox and Email dedupe keys are stable and correctly scoped
[ ] actionPath uses the real current /exam/* result route
[ ] actionPath is validated at write and render time
[ ] result mutation + Inbox + outbox commit atomically
[ ] no SMTP call occurs in the business transaction
[ ] old Email-only result trigger is removed
[ ] no old/new double-send path exists
[ ] Inbox list uses bounded offset/page pagination (reuses `PaginationParamsSchema`)
[ ] Inbox API authentication and user isolation pass
[ ] Candidate Inbox UI is usable
[ ] EMAIL_ENABLED=false still leaves Inbox authoritative
[ ] Worker, Email, result, API, frontend, and E2E regressions pass
[ ] pnpm verify passes
```

---

## 21. Definition of Done

P5-N1 is complete when one real product event proves the architecture:

```text
Authorized result publication
    -> result state committed
    -> candidate Inbox notification committed
    -> linked Email outbox row committed when email exists
    -> Email delivered asynchronously by P5-0 runtime
    -> candidate reads notification and opens authoritative result
```

No identity flow or second operational notification type is required.
