# ADR-011: Notification Inbox and Email Delivery Architecture

- **Status:** Accepted (2026-07-25, P5-N1-R0)
- **Date:** 2026-07-23
- **Owners:** EXAM maintainers
- **Related:** ADR-003 Job Queue, ADR-001 Redis, P5-0 Email Delivery Runtime, P3 Result Publishing Closeout, P5-N1 Notification Inbox

## 1. Decision

EXAM adopts a two-channel notification architecture:

1. **Inbox notifications** are first-class business records stored in PostgreSQL.
2. **Email** is an external delivery channel used for identity flows, offline recall, and high-impact operational alerts.
3. **Email delivery is asynchronous** and uses the existing PostgreSQL `email_outbox` as a durable queue.
4. A dedicated Node.js worker process claims and delivers due outbox rows.
5. Redis, BullMQ, RabbitMQ, Kafka, and a general-purpose queue platform are not introduced at this stage.
6. Notification and email code are feature/application modules. They must not be placed in a generic `utils` directory.
7. Notification records store a relative `actionPath`. Absolute email links are produced at render time from the validated `PUBLIC_WEB_ORIGIN` runtime setting.
8. Request headers, including `Host`, are not authoritative sources for persistent email links.
9. **Email delivery is at-least-once**, not exactly-once. Duplicate delivery is a known, accepted limitation.

### 1.1 Single-tenant scope

The current product is single-tenant, single-default-organization. One deployment allows one internal default organization. Organization switcher, organization slug login, SuperAdmin, and multiTenant are not supported.

`organization_id` on `notifications` and `email_outbox` is the existing internal data boundary — not a future placeholder. Carrying `organization_id` does not mean the system has become multi-tenant; it continues the current internal organization data boundary.

Client code must not pass or switch organization ID. Organization ID comes from the authenticated request context or the associated business resource.

## 2. Context

The current Email MVP treats email as the visible feature. This is too narrow for the product.

EXAM needs to communicate several different kinds of information:

- account invitation and activation;
- password reset and password-change warnings;
- exam assignment, rescheduling, and cancellation;
- grading assignments;
- result publication;
- system or organization announcements.

Email alone cannot represent current business state, read state, task completion, or notification invalidation. Inbox alone cannot support users who are logged out, have not activated an account, or need account recovery.

The actual capability is therefore a **Notification and Delivery subsystem**, where Inbox and Email are separate channels over shared business intent.

The repository already contains:

- a PostgreSQL-backed email outbox (`email_outbox` table with `organizationId`, status lifecycle `pending → sent | failed`, exponential backoff retry);
- email domain types (`packages/domain/src/email.ts`: `EmailOutboxStatus`, `EmailType`, `EmailSender`, `EmailOutboxRow`);
- an API email module (`apps/api/src/email/`: `EmailNotificationService`, `EmailOutboxService`, senders, retry policy, sanitizer);
- a Fastify email plugin (`apps/api/src/plugins/email.ts`: decorates `fastify.emailSender`);
- an ADR (ADR-003) that defers a general-purpose job queue and prefers PostgreSQL-backed work where adequate.

The design should extend these boundaries instead of introducing an unrelated utility layer or premature infrastructure.

### 2.1 Current implementation facts (verified from code, 2026-07-25 post-P5-0)

| Aspect | Current state | Evidence |
| --- | --- | --- |
| `email_outbox.organizationId` | NOT NULL, FK → organizations.id (exists) | `packages/db/src/schema/pg.ts:587-611` |
| `email_outbox.notification_id` | Does not exist; P5-N1 adds as nullable FK | schema `pg.ts` (absent) |
| `email_outbox.recipient_user_id` | Does not exist; P5-N1 owns recipient linkage | schema `pg.ts` (absent) |
| `email_outbox` status enum | `pending`, `processing`, `retry_wait`, `sent`, `dead` (5-state, migrated) | `packages/domain/src/email.ts:31-36`; `packages/db/src/schema/pg.ts:636-638` |
| `email_outbox` locking | `locked_at`/`locked_by` columns exist; `FOR UPDATE SKIP LOCKED` claim implemented | `packages/db/src/repository/emailOutboxRepo.ts:221-275`; `schema/pg.ts:597-598` |
| Worker | Resident daemon loop (`apps/api/src/workers/emailDeliveryWorker.ts`) — `while(!shuttingDown)` poll + heartbeat + graceful shutdown | `emailDeliveryWorker.ts:150-235`; script `worker:email` in `apps/api/package.json` |
| `EMAIL_ENABLED=false` | `DisabledEmailSender` (no-op, returns `{providerMessageId:null}`); enqueue layer is NOT gated by `enabled` (no business caller exists yet) | `apps/api/src/email/senders.ts:40-44,189-192`; `emailDeliveryService.ts:50-70` |
| `apps/api/src/notifications/` | Does not exist yet (P5-N1 owns) | verified absent |
| `apps/api/src/workers/` | EXISTS — `emailDeliveryWorker.ts` (P5-0) | `apps/api/src/workers/emailDeliveryWorker.ts` |
| Frontend routes | `/admin/*`, `/exam/*`, `/login` only; candidate result route is `/exam/:attemptId/result` | `apps/web/src/lib/routes.ts:33-39` |
| `users` table email column | Does not exist (P5-N1 adds optional `users.email`) | `packages/db/src/schema/pg.ts:106-114`; migrations 0001-0018 |
| Diagnostics | `buildEmailStatus` exposes `outbox.{pending,processing,retryWait,sent,dead}`, `worker.{status,lastPollAt,...}`, `oldestPendingAge`, `lastSuccessfulDeliveryAt` | `apps/api/src/routes/system.ts:46-166` |
| Email service name | `EmailDeliveryService` (renamed from `EmailNotificationService` by P5-0) | `apps/api/src/email/emailDeliveryService.ts:29`; zero business callers (verified) |
| `grade_notification` EmailType | Defined in domain (`email.ts:47`) but NOT yet rendered/enqueued by any caller | `packages/domain/src/email.ts:47` (verified unused by grep) |

## 3. Architecture

```text
Business command
    |
    | database transaction
    v
Business state mutation
    + Inbox notification (notifications table)
    + Email outbox row (email_outbox table), when policy enables email
    |
    | commit
    v
HTTP response

Independent email worker
    |
    v
Claim due outbox rows
  (status = 'pending'
   OR (status = 'retry_wait' AND next_attempt_at <= now()))
  FOR UPDATE SKIP LOCKED
    |
    v
Set status → processing (locked_at, locked_by)
    |
    v
Render subject / text / HTML / absolute action URL
    |
    v
SMTP transport
    |
    +--> sent (terminal)
    |
    +--> retry_wait (backoff before next attempt)
    |
    +--> dead (terminal)
```

### 3.1 Status machine (target)

| Status | Meaning | Invariants |
|---|---|---|
| `pending` | First-time or immediately claimable | `next_attempt_at` may be null or immediately due |
| `processing` | Claimed by a worker | `locked_at` and `locked_by` must be non-null |
| `retry_wait` | Failed, awaiting backoff | `next_attempt_at` must be non-null |
| `sent` | Terminal: sender adapter returned successfully | `sent_at` is non-null (see §12 for delivery proof semantics) |
| `dead` | Terminal: exhausted all retry attempts | `last_error` is non-null |

Transitions:

```text
pending → processing              (worker claims)
retry_wait → processing           (worker claims when next_attempt_at <= now())
processing → sent                 (send succeeded)
processing → retry_wait           (send failed, attempt_count < max_attempts)
processing → dead                 (send failed, attempt_count >= max_attempts)
processing → pending              (worker crash: lock timeout releases row)
```

### 3.2 Authority boundaries

| Concern | Authority |
|---|---|
| Exam, attempt, grading, and result state | Existing business/domain modules |
| Whether a user should be notified | Notification policy / application service |
| What appears in the in-app Inbox | `notifications` records |
| Whether an email should be attempted | `email_outbox` records |
| Whether an email was delivered | Outbox delivery state and provider response |
| Public web origin | Validated runtime configuration (`PUBLIC_WEB_ORIGIN`) |
| SMTP delivery | Email transport adapter (`apps/api/src/email/senders.ts`) |
| Current notification destination | Business resource plus relative `actionPath` |
| Action path validation | `apps/api/src/notifications/actionLink.ts` |

Email content is not authoritative business state. It is a snapshot produced for delivery.

## 4. Channel policy

### 4.1 V1 policy mechanism

V1 channel policy is **static, code-level, per-notification-type mapping**. The policy lives at `apps/api/src/notifications/policy.ts` (or equivalent module). There is no runtime-configurable preference UI.

V1 explicitly does NOT support:

- user-level notification preferences;
- organization-admin notification preferences;
- digest mode;
- quiet hours;
- unsubscribe center;
- per-channel custom policy.

These are all **future work**. Even when user preferences are supported in the future, security and identity recovery emails must never be disabled by any user.

### 4.2 Identity messages

Examples:

- invitation;
- activation;
- password reset;
- password changed;
- account recovery.

Default policy:

| Channel | Rule |
|---|---|
| Email | Required when an address is available and the flow depends on external access |
| Inbox | Optional or supplemental |

Security messages cannot be disabled by user preference.

Identity-only emails (invitation, activation, password reset, password-change warning, account recovery) may not have a corresponding Inbox notification. The `notification_id` on `email_outbox` is nullable for this reason.

### 4.3 Operational notifications

Examples:

- exam assigned;
- exam time changed;
- exam cancelled;
- grading assigned;
- result published.

Default policy:

| Channel | Rule |
|---|---|
| Inbox | Required |
| Email | Enabled when recipient email exists |

High-impact changes such as cancellation may require both channels. Email links lead back to the authoritative resource in EXAM.

### 4.4 Announcements

Examples:

- scheduled maintenance;
- organization announcements;
- policy changes.

Default policy:

| Channel | Rule |
|---|---|
| Inbox | Primary |
| Email | Optional and explicitly selected |

No free-form user-to-user messaging is introduced.

## 5. Transaction boundary

For operational events, the target invariant is:

> The business mutation, Inbox notification, and required email outbox row are committed atomically in the same PostgreSQL transaction.

SMTP is never called inside that transaction.

This prevents:

- business success with a silently lost required notification;
- email enqueue success for a business mutation that later rolls back;
- slow SMTP calls extending request latency;
- SMTP outages breaking exam operations.

Where the current command or repository API cannot yet share a transaction, the existing post-commit best-effort enqueue may remain temporarily. Such call sites must be recorded as migration debt and must not be described as transactional outbox guarantees.

Identity flows that are not coupled to a separate business mutation may create their outbox row in their own transaction.

**Scope of atomic transaction requirement**: applies to single business operations with a limited, controllable number of recipients. Large-scale announcement fan-out is explicitly excluded (see §16).

## 6. Queue decision

The existing PostgreSQL `email_outbox` is the queue for email delivery.

### 6.1 Current queue state (verified)

The current `email_outbox` has:

- `organizationId` (NOT NULL, FK);
- status: `pending | sent | failed`;
- `attempts`, `maxAttempts`, `nextRetryAt` for retry;
- `lastError` for diagnostics;
- NO row locking columns (`locked_at`, `locked_by`);
- NO `FOR UPDATE SKIP LOCKED` — the current worker uses a simple `SELECT` + sequential processing.

### 6.2 Required queue semantics (target state)

The full queue semantics required for production:

- durable rows;
- `pending`, `processing`, `retry_wait`, `sent`, `dead` states;
- attempt count and maximum attempts;
- exponential or bounded backoff;
- `nextAttemptAt`;
- worker ownership and lock timeout (`locked_at`, `locked_by`);
- safe recovery of abandoned `processing` rows (lock timeout);
- idempotency or deduplication key (`dedupe_key`);
- provider message identifier (`provider_message_id`);
- last error;
- administrator-visible failure information.

Workers claim rows with a database transaction and `FOR UPDATE SKIP LOCKED`, or an equivalent repository abstraction.

### 6.3 Worker claim query (target)

The worker selects claimable rows using:

```sql
SELECT ... FROM email_outbox
WHERE organization_id = $1
  AND (
    status = 'pending'
    OR (status = 'retry_wait' AND next_attempt_at <= $2)
  )
ORDER BY created_at ASC, id ASC
LIMIT $3
FOR UPDATE SKIP LOCKED
```

After claiming, the worker immediately sets `status = 'processing'` with `locked_at` and `locked_by` on the same row. There is no intermediate batch update from `retry_wait` to `pending`.

### 6.4 cancelled state

`cancelled` is NOT included in the target state enum. If a cancel use case emerges (e.g. exam cancelled before email sent), the row should be deleted or marked with a business-level invalidation rather than adding a new terminal state. This avoids premature modeling of unused states. Revisit if a concrete cancel use case appears.

### 6.5 General-purpose queue reconsideration

A general-purpose queue (ADR-003) is reconsidered only when measured requirements exceed the PostgreSQL outbox, including:

- independently scaled workers across several job classes;
- high-volume delayed scheduling;
- substantial PDF, export, import, or media jobs;
- operational evidence that PostgreSQL polling is a bottleneck;
- an existing Redis platform that is already required for other production concerns.

## 7. Public links and action path security

### 7.1 Runtime configuration

The API runtime configuration must add:

```env
PUBLIC_WEB_ORIGIN=http://localhost:5173
```

Production example:

```env
PUBLIC_WEB_ORIGIN=https://exam.example.com
```

Rules:

1. The setting is validated during startup.
2. Production requires HTTPS, except for explicitly supported private-development profiles.
3. The value is an origin, not a path and not an API endpoint.
4. Email links are built with the standard URL API.
5. `request.headers.host`, forwarded host headers, and request protocol are not used as the source of persistent email links.

### 7.2 Action path validation (two-layer)

Action path validation occurs at two points:

**Layer 1 — Write time**: When a notification is created, `actionPath` is validated and normalized. Only valid, safe relative paths are stored in the database.

**Layer 2 — Render time**: When an email is rendered, the stored `actionPath` is re-validated before combining with `PUBLIC_WEB_ORIGIN`. This defends against database corruption or stale data.

Validation module: `apps/api/src/notifications/actionLink.ts` (or equivalent).

### 7.3 Allowed path format

Only site-relative absolute paths are accepted:

```text
/admin/...
/exam/...
/login
```

Based on the current frontend routes (`apps/web/src/lib/routes.ts`), the valid prefixes are:

- `/admin/` — admin dashboard, users, candidates, settings, courses, questions, exams, grading, audit, system
- `/exam/` — exam list, start, take, result, settings
- `/login`

Note: `/candidate/`, `/grader/`, `/teacher/`, `/proctor/` do not exist as frontend routes yet. When those role-specific routes are added, the action path whitelist must be updated accordingly.

### 7.4 Rejection rules

The validator MUST reject:

| Pattern | Reason |
|---|---|
| `http://evil.example.com` | External URL |
| `https://evil.example.com` | External URL |
| `//evil.example.com` | Protocol-relative URL |
| `\\evil.example.com` | Backslash path (Windows UNC) |
| `/../../admin/settings` | Path traversal |
| `/candidate/../admin/settings` | Path traversal |
| `/candidate/%2e%2e/admin` | Encoded path traversal |
| Any path containing `\` | Backslash not allowed |
| Any path containing a scheme (`://`) | Not a relative path |
| Any path with userinfo (`user:pass@host`) | URL with credentials |
| NUL bytes or control characters | Injection vector |
| Empty string | No path |
| Path not matching `/admin/*`, `/exam/*`, or `/login` | Unknown route prefix |

### 7.5 Path rules

1. Must start with a single `/`;
2. Must not start with `//`;
3. Must not contain `..` path segments, including percent-encoded equivalents (`%2e%2e`, `%2E%2E`);
4. Must not contain backslashes;
5. Must match an allowed route prefix (see §7.3);
6. Should be normalized before comparison;
7. Database stores only the validated relative path;
8. Email rendering re-validates before combining with `PUBLIC_WEB_ORIGIN`;
9. Invalid paths are rejected at write time (notification creation fails or is stored without action);
10. Invalid paths must not degrade to external redirects.

### 7.6 Whitelist synchronization

The actionPath whitelist and the frontend route definitions are maintained in two separate code locations. The following synchronization rules apply:

1. Any PR that adds or modifies a notification `actionPath` must verify the corresponding whitelist entry exists in `actionLink.ts` tests.
2. Any PR that adds a new frontend route that could be a notification target must update the whitelist and its tests in the same PR.
3. Action path tests must cover at least one test case per notification type's target path.
4. No automatic scanning of all React routes is required.
5. A centralized test fixture may be used:

```ts
const notificationActionCases = [
  { type: "result_published", path: "/exam/some-id/result" },
  { type: "exam_assigned", path: "/admin/exams/some-id" },
];
```

6. The CI or standard test suite must verify all fixture paths are accepted by the whitelist.
7. Dynamic paths not listed in fixtures must still pass runtime validation.

## 8. Repository placement

### 8.1 Domain and contracts

```text
packages/domain/src/notification.ts   (new — notification types)
packages/domain/src/email.ts          (existing — email types)

packages/contracts/src/notification.ts (new — Inbox API schemas)
```

Responsibilities:

- `notification.ts`: notification types, severity, resource references, channel-neutral invariants.
- `email.ts`: email delivery types and template keys; no SMTP implementation.
- contracts: Inbox API request and response schemas.

Do not place transport clients, Fastify instances, database repositories, or environment access in `packages/domain`.

### 8.2 Database

```text
packages/db/src/schema/pg.ts           (existing — add notifications table, extend email_outbox)
packages/db/src/repository/notificationRepo.ts   (new)
packages/db/src/repository/emailOutboxRepo.ts    (existing — extend with locking, dedup)
```

Responsibilities:

- notification persistence and read state;
- outbox persistence, claiming, retries, and recovery;
- transaction-aware repository operations.

The exact schema remains in the existing PostgreSQL schema module unless the repository later adopts per-feature schema files globally.

### 8.3 Fastify application services

```text
apps/api/src/notifications/
  service.ts        (new — channel-neutral application service)
  policy.ts         (new — channel choice by notification type)
  actionLink.ts     (new — validates relative action paths)
  types.ts          (new — API-local dependency interfaces)
```

Responsibilities:

- `service.ts`: application orchestration; create Inbox and email deliveries. This is the **NotificationService**.
- `policy.ts`: channel choice by notification type and severity. V1 is static, code-level.
- `actionLink.ts`: validates relative action paths and combines them with `PUBLIC_WEB_ORIGIN`.
- `types.ts`: API-local dependency interfaces where needed.

This directory contains business/application behavior and is not a utility directory.

### 8.4 Email delivery

Keep and evolve the existing email feature directory:

```text
apps/api/src/email/
  notificationService.ts   (existing — rename to emailDeliveryService.ts)
  renderer.ts              (existing)
  outboxService.ts         (existing)
  senders.ts               (existing)
  retryPolicy.ts          (existing)
  sanitizeError.ts         (existing)
  index.ts                 (existing)
  templates/               (existing)
```

**Naming migration (required)**:

The current `apps/api/src/email/notificationService.ts` exports `EmailNotificationService`. This name conflicts with the new channel-neutral `apps/api/src/notifications/service.ts` (`NotificationService`).

Migration direction:

- `apps/api/src/notifications/service.ts` → `NotificationService` (channel-neutral application service)
- `apps/api/src/email/notificationService.ts` → rename to `emailDeliveryService.ts`, class becomes `EmailDeliveryService`
- SMTP details remain behind `senders.ts`
- Templates receive structured payloads and do not query repositories

**Transition rules**:

- Imports must use explicit aliases.
- New code must not call the Email-only service a generic NotificationService.
- The rename is completed within the first Inbox implementation Job or the cleanup Job immediately following it.
- Logs, test descriptions, and error messages must distinguish `email delivery` from `notification`.

Do not retain two ambiguous `notificationService` names as a long-term state.

### 8.5 Fastify plugins and routes

```text
apps/api/src/plugins/email.ts          (existing)
apps/api/src/plugins/notifications.ts  (new)

apps/api/src/routes/notifications.ts   (new)
```

Responsibilities:

- email plugin: construct and decorate the email transport/channel adapter;
- notifications plugin: construct the application service with repository and channel dependencies;
- notifications route: Inbox list, unread count, mark read, and mark all read.

Business routes must not construct SMTP transports or instantiate notification services ad hoc. They call the decorated application service or a command-level dependency.

### 8.6 Worker

```text
apps/api/src/workers/emailDeliveryWorker.ts  (new)
```

The worker is a separate process entrypoint but remains in the existing API package initially.

**Build entry constraint**: The worker must be an explicit build entry in the API package's tsconfig and build scripts. CI must verify the worker build artifact exists. The worker startup command must be listed in `package.json` scripts. The worker must not depend on bundler auto-discovery of files not imported by the server.

Example:

```text
API process:
  node dist/server.js

Email worker process:
  node dist/workers/emailDeliveryWorker.js
```

Or via package.json scripts:

```bash
pnpm --filter @exam/api build
pnpm --filter @exam/api worker:email
```

A new `apps/worker` package is introduced only if several worker types need independent dependencies, builds, ownership, or deployment. One email worker does not justify that split.

### 8.7 Runtime configuration

```text
apps/api/src/config/runtimeConfig.ts      (existing — extend with PUBLIC_WEB_ORIGIN)
apps/api/src/config/runtimeConfig.test.ts (existing)
.env.example                              (existing — add email/worker settings)
```

`PUBLIC_WEB_ORIGIN` and email worker settings are added to the existing runtime configuration boundary. They are not read directly throughout feature code.

### 8.8 Web application

```text
apps/web/src/components/notifications/NotificationBell.tsx  (new)
apps/web/src/pages/NotificationPage.tsx                     (new)
apps/web/src/lib/routes.ts                                  (existing)
```

Initial UI:

- unread count;
- notification list;
- mark read;
- mark all read;
- action navigation.

Polling is sufficient for the first version. WebSocket/SSE remains governed by ADR-002.

## 9. Data model

### 9.1 Notifications

```text
notifications
- id                    UUID PK
- organization_id       TEXT NOT NULL FK → organizations.id
- recipient_user_id     TEXT NOT NULL FK → users.id
- type                  TEXT NOT NULL (enum: exam_assigned, result_published, ...)
- title                 TEXT NOT NULL
- body                  TEXT NOT NULL
- severity              TEXT NOT NULL (enum: info, warning, high)
- resource_type         TEXT (nullable — e.g. 'exam', 'attempt')
- resource_id           TEXT (nullable — e.g. exam UUID)
- action_path           TEXT (nullable in the target model; V1 freezes this
                          column as NOT NULL — see P5-N1-R0 audit §12.1)
- created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
- read_at               TIMESTAMPTZ (nullable — null = unread)
- archived_at           TIMESTAMPTZ (nullable)
- invalidated_at        TIMESTAMPTZ (nullable — set when business action no longer applicable)
- dedupe_key            TEXT (nullable — unique per scope)
```

**Scopes**:

- Inbox query scope: `(organization_id, recipient_user_id)`
- Deduplication scope: `(organization_id, recipient_user_id, dedupe_key)`
- Unique constraint on `(organization_id, recipient_user_id, dedupe_key)` WHERE dedupe_key IS NOT NULL

A notification may be invalidated when the related business action is no longer applicable. The resource remains the authority.

`read_at` / `archived_at` only affect display, not deletion.

### 9.2 Email outbox (target schema)

The current `email_outbox` will be extended with additional columns:

```text
email_outbox
- id                    UUID PK
- organization_id       TEXT NOT NULL FK → organizations.id        (EXISTS)
- notification_id       TEXT (NULLABLE FK → notifications.id)      (NEW)
- recipient_user_id     TEXT (NULLABLE FK → users.id)              (NEW)
- recipient_email       TEXT NOT NULL                                (EXISTS)
- type                  TEXT NOT NULL (EmailType enum)              (EXISTS)
- subject               TEXT NOT NULL                                (EXISTS)
- body_text             TEXT NOT NULL                                (EXISTS)
- body_html             TEXT (nullable)                              (EXISTS)
- status                TEXT NOT NULL (target enum)                  (EXISTS, extended)
- attempt_count         INTEGER NOT NULL                            (EXISTS as 'attempts')
- max_attempts          INTEGER NOT NULL                            (EXISTS)
- locked_at             TIMESTAMPTZ (nullable)                      (NEW)
- locked_by             TEXT (nullable)                              (NEW)
- provider_message_id   TEXT (nullable)                              (NEW)
- dedupe_key            TEXT (nullable)                              (NEW)
- last_error            TEXT (nullable)                              (EXISTS)
- next_attempt_at       TIMESTAMPTZ (nullable)                      (EXISTS as 'nextRetryAt')
- created_at            TIMESTAMPTZ NOT NULL DEFAULT now()          (EXISTS)
- updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()          (EXISTS)
- sent_at               TIMESTAMPTZ (nullable)                      (EXISTS)
```

**Target status enum**: `pending`, `processing`, `retry_wait`, `sent`, `dead`

Current status enum (`pending`, `sent`, `failed`) will migrate:
- `failed` → `dead` (terminal failure after exhausting retries)

**Nullable fields rationale**:

- `notification_id` is nullable because identity-only emails (invitation, activation, password reset, password-change warning, account recovery) have no corresponding Inbox notification.
- `recipient_user_id` is nullable because invitation emails may be sent to a user account that has not yet been created (the invitation flow creates the user on acceptance). Current product flow may create users first — record actual behavior, not future assumptions.

Relationship:
- Operational email: `notification_id` references a corresponding Inbox notification.
- Identity-only email: `notification_id = NULL`.

**Deduplication**: `dedupe_key` prevents the same logical event for the same recipient from creating duplicate outbox rows. The unique constraint `(organization_id, dedupe_key)` assumes that `dedupe_key` itself is recipient-scoped. See §9.4 for key format and generation rules.

### 9.3 Column rename migration

Existing column `attempts` should be renamed to `attempt_count` and `nextRetryAt` to `next_attempt_at` for consistency. This is a schema migration, not an ADR concern, but the ADR records the target names.

### 9.4 Dedupe key format and generation

`email_outbox.dedupe_key` operates at **per-recipient delivery** granularity, not at business-event granularity.

Recommended format:

```text
{emailType}:{resourceId}:{recipientIdentity}:{eventVersion}
```

Examples:

| Scenario | dedupe_key |
|---|---|
| Result published to a candidate | `result_published:{examId}:{recipientUserId}` (V1 outbox key — no `publicationVersion`; the single irreversible `resultsPublishedAt` transition is the stable key; Inbox dedupe key is `result_published:{examId}`) |
| Exam assigned to a candidate | `exam_notification:{examId}:{recipientUserId}:{assignmentVersion}` |
| Password reset for a user | `password_reset:{userId}:{tokenVersion}` |
| Invitation to a pre-user email | `registration_welcome:{invitationId}:{normalizedEmail}` |

Rules:

1. The same business event sent to different recipients MUST generate different `dedupe_key` values (recipient-scoped).
2. The same logical delivery for the same recipient MUST generate the same key on retry or re-trigger.
3. `recipientIdentity` should use the stable `recipient_user_id` when available.
4. For identity emails without a user ID, use the normalized email address or invitation ID.
5. Email addresses used as key components MUST be normalized (V1: trim + preserve case; no lowercase — see P5-N1-R0 audit §13).
6. Random UUIDs MUST NOT be used as business deduplication keys.
7. `dedupe_key` does NOT guarantee SMTP exactly-once delivery (see §11.1).
8. Worker retry reuses the same outbox row; it does not create a new key.

The unique constraint `(organization_id, dedupe_key)` assumes that `dedupe_key` itself is recipient-scoped. Do not change the constraint to `(organization_id, recipient_email, dedupe_key)` unless code review reveals that the current system must depend on the email address as a database constraint field.

### 9.5 NotificationType and EmailType relationship

`NotificationType` (Inbox notification type) and `EmailType` (email outbox type) are **independent enums**. One does not imply the other:

- An Inbox notification does not necessarily produce an Email.
- An Email does not necessarily have an Inbox notification (identity flows).
- An `EmailType` does not require a corresponding `NotificationType`.
- A `NotificationType` does not require a corresponding `EmailType`.

Association is determined by the notification policy layer (`apps/api/src/notifications/policy.ts`), not by string equality.

Current `EmailType` values (from `packages/domain/src/email.ts`):

```text
registration_welcome
password_reset
admin_created_user
exam_notification
grade_notification
system_alert
test_email
```

Policy mapping examples:

| NotificationType | EmailType | V1 behavior |
|---|---|---|
| `result_published` | `grade_notification` | Inbox + Email |
| `exam_assigned` | `exam_notification` | Inbox + Email |
| identity-only (invitation, reset) | `registration_welcome`, `password_reset` | Email only |
| future operational type | explicit mapping required | Deferred |

Rules:

1. No cross-table enum consistency constraint is added at the database level.
2. String equality between `NotificationType` and `EmailType` is never assumed.
3. Association is determined by `notification_id` on `email_outbox` and application-layer policy.
4. The mapping is centralized in `notifications/policy.ts` (or equivalent) and must have tests.
5. Renaming an `EmailType` does not change historical `NotificationType` values.
6. Email-only identity types do not require a corresponding `NotificationType`.

## 10. API baseline

### 10.1 Inbox list

```http
GET /api/notifications
```

**Pagination** (required, not optional):

V1 uses offset/page pagination (consistent with the repository's existing
`PaginationParamsSchema` / `PaginatedResponseSchema` convention — see
`packages/contracts/src/common.ts`):

```http
GET /api/notifications?page=1&pageSize=20
```

Rules:

- Default `pageSize`: 20
- Maximum `pageSize`: 100
- Ordering: `created_at DESC, id DESC` (stable sort)
- Response: `{ items, total, page, pageSize, totalPages }`
- No unbounded list responses
- Pagination remains scoped by organization and recipient from context

Optional filters:

```http
GET /api/notifications?unread=true
```

`type` filtering is deferred to a subsequent Job.

### 10.2 Unread count

```http
GET /api/notifications/unread-count
```

Returns `{ count: number }`.

### 10.3 Mark read

```http
POST /api/notifications/:id/read
```

### 10.4 Mark all read

```http
POST /api/notifications/read-all
```

Note: `POST /api/notifications/:id/read` and `POST /api/notifications/read-all` follow the project's action-endpoint convention, not generic REST resource update semantics. This is a deliberate choice aligned with existing API style.

### 10.5 Authorization

All Inbox API endpoints require authentication.

Query and mutation scope: `(organization_id, recipient_user_id)` — derived from the authenticated request context.

Accessing another user's notifications returns a not-found behavior that does not leak resource existence.

Notification read state (`read_at`) does not represent business task completion.

## 11. Email delivery semantics

### 11.1 At-least-once delivery

Email delivery is **at-least-once**, not exactly-once. The classic crash window:

```text
SMTP/provider accepts the email
  → worker has not yet updated outbox to 'sent'
  → worker crashes
  → lock timeout returns row to pending
  → user may receive the email twice
```

Mitigations:

- `dedupe_key` prevents duplicate creation of logical outbox tasks.
- `dedupe_key` CANNOT eliminate the SMTP-already-sent-but-DB-not-confirmed duplication window.
- Retry reuses the same outbox row (not a new row).
- Rare duplicate delivery is an accepted limitation of V1.
- Email content should be designed so that duplicate receipt is harmless.
- Password reset, invitation, and similar tokens must be single-use.
- Result notification links always point to the current authoritative business state.
- Provider-native idempotency capabilities are a future optional enhancement; do not assume all SMTP providers support them.

### 11.2 Failure behavior (email-specific)

| Failure | Required behavior |
|---|---|
| SMTP unavailable | Business request succeeds after DB commit; outbox retries |
| Worker unavailable | Outbox rows remain pending/retry_wait and visible to diagnostics; API continues |
| Worker crash after SMTP accept | Lock timeout returns row to pending; duplicate delivery possible (at-least-once) |
| API restart | No delivery state is lost (PostgreSQL durability) |
| Duplicate worker claim attempt | Database locking (`FOR UPDATE SKIP LOCKED`) prevents concurrent ownership |
| Email permanently rejected | Row becomes `dead`; Inbox remains available |
| Invalid `PUBLIC_WEB_ORIGIN` | Production process fails startup |
| Invalid or external `actionPath` | Notification creation is rejected or stored without action |
| Notification policy failure | Transaction rolls back for required notification; optional channels omitted only by explicit policy |

## 12. EMAIL_ENABLED semantics

### 12.1 Current behavior (verified)

`EMAIL_ENABLED=false` behavior (current implementation):

- `DisabledEmailSender` is used — a no-op that silently swallows send calls.
- **Outbox rows ARE still written** by `EmailNotificationService.enqueueBestEffort`.
- The worker (when running) picks up pending rows, but `DisabledEmailSender.send()` resolves immediately, so rows are marked `sent` without actual SMTP delivery.

This is **Approach A: disable delivery but still enqueue**.

### 12.2 `sent` status semantics

The `sent` status does not always prove external delivery. The following table documents the meaning based on sender state and `provider_message_id`:

| Status | `provider_message_id` | Sender state | Meaning |
|---|---|---|---|
| `sent` | non-null | SMTP enabled | Provider accepted or returned a delivery identifier |
| `sent` | null | SMTP enabled | Sender returned success but provider acceptance evidence is unavailable |
| `sent` | null | Email disabled | Processed by disabled sender; no external delivery occurred |
| `dead` | any | any | Terminal processing failure |
| `pending` / `retry_wait` / `processing` | any | any | Not terminal |

**Warning**: `sent_at IS NOT NULL` alone is not proof that an email was externally delivered. Delivery audits must consider `EMAIL_ENABLED`, sender mode, and `provider_message_id`.

### 12.3 Stale-message policy

Risk: if email is disabled for a long period and then re-enabled, stale outbox rows may be processed. A global stale-message TTL (e.g. skip rows where `created_at` is older than 24 hours) is too coarse:

- password reset tokens often expire in minutes;
- invitations may remain valid for days;
- exam assignment emails may remain relevant for more than 24 hours;
- result publication emails may remain useful after 24 hours, although the Inbox remains authoritative.

**V1 decision**: Stale-message skipping is **deferred** until an explicit `skipped` or `suppressed` terminal representation is designed. The current target status enum does not include `skipped`, and reusing `sent` or `dead` for stale skipped rows is not permitted. The stale-message risk remains and is recorded as a known limitation.

Inbox records are not affected by any email stale TTL.

### 12.4 Alternative considered

**Approach B** (disable email channel entirely — no outbox rows created). This avoids stale-message risk but changes the current behavior. The current implementation follows Approach A; migration to Approach B is deferred.

## 13. Worker health and observability

### 13.1 Worker heartbeat storage

The worker is a separate process. Worker heartbeat and health status are persisted in PostgreSQL so that the API diagnostics surface can read them without process-local shared memory, HTTP RPC to the worker, or Redis.

Recommended storage:

```text
worker_heartbeats (or equivalent PostgreSQL-backed runtime status record)
- worker_name         TEXT NOT NULL (e.g. 'email-delivery')
- worker_instance_id  TEXT NOT NULL (unique per process start)
- last_poll_at        TIMESTAMPTZ NOT NULL
- last_success_at     TIMESTAMPTZ (nullable)
- last_error_at       TIMESTAMPTZ (nullable)
- last_error          TEXT (nullable)
- updated_at          TIMESTAMPTZ NOT NULL
```

Rules:

1. The worker updates its heartbeat row after each successful poll cycle.
2. The API reads from PostgreSQL via the existing `buildEmailStatus` surface (`apps/api/src/routes/system.ts`).
3. No API-to-worker process-local shared state.
4. No independent HTTP worker endpoint.
5. No local shared file.
6. No Redis requirement.
7. When multiple worker instances run, diagnostics display the most recent heartbeat or aggregate by instance.
8. A heartbeat write failure must not terminate the email main loop, but must be logged with a structured warning.

### 13.2 Required diagnostics (V1)

The worker must expose the following metrics, queryable from the existing diagnostics surface (`/api/system`):

- `oldestPendingAge`: age of the oldest pending outbox row
- `pendingCount`: number of rows with status `pending`
- `retryWaitCount`: number of rows with status `retry_wait`
- `processingCount`: number of rows with status `processing`
- `deadCount`: number of rows with status `dead`
- `lastSuccessfulDeliveryAt`: timestamp of last successful send
- `lastWorkerPollAt`: timestamp of last worker poll/heartbeat (from PostgreSQL heartbeat row)

These integrate with the existing diagnostics architecture (see `apps/api/src/routes/system.ts` — `buildEmailStatus`). Do not create an independent monitoring platform.

### 13.3 Health thresholds

```text
degraded:
  - oldestPendingAge exceeds configured threshold
  - worker heartbeat exceeds configured threshold
  - deadCount > 0 or growing
```

Specific alert recipients and external alerting platforms are deferred to deployment-layer future work.

### 13.4 Worker failure behavior

| Failure | Required behavior |
|---|---|
| Worker unavailable | API core business continues; outbox accumulates; diagnostics show degraded; structured warning/error logged |
| Worker slow | Polling interval controls throughput; batch size limits concurrent sends |
| Worker crash mid-batch | Unsent rows in batch remain `pending` (lock released after crash); already-sent rows are `sent` |

## 14. Retention policy

V1 does NOT automatically delete `notifications` or `email_outbox` rows.

Recommended defaults (not immutable — subject to future data retention ADR):

| Table | Retention |
|---|---|
| `notifications` | Retain until a future data retention ADR decides. `read_at` / `archived_at` affect display only. |
| `email_outbox` (sent) | Retain at least 90 days; actual value to be made configurable later |
| `email_outbox` (dead) | Retain at least 1 year or per audit requirements |

Risk: without a cleanup strategy, these tables will grow continuously. A future retention worker or archival job should be added when the data volume justifies it.

## 15. Anti-bombing boundary

Business bugs or repeated operations may produce a large volume of emails for the same recipient.

V1 mitigations:

- Business `dedupe_key` prevents the same event for the same recipient from being enqueued repeatedly.
- No general-purpose per-recipient email rate limit is implemented in V1.
- Worker batch size and concurrency limits provide backpressure.
- Per-recipient hourly cap, digest, and suppression list are **future work**.
- Identity recovery email rate limiting is the responsibility of the corresponding identity flow, not the general Inbox policy.

Lack of a general per-recipient rate limit is recorded as a known limitation (Negative Consequence or Deferred Component).

## 16. Batch notifications and announcements

V1 does NOT implement large-scale fan-out for organization announcements.

For future thousands-of-user announcements:

- Do not require inserting all notifications in a single business transaction.
- Use an independent fan-out job, batch cursors, and resumable progress.
- This is subject to ADR-003 Job Queue re-evaluation conditions.
- Cannot be derived from the current `result_published` single-user/small-batch transaction rules.

The current atomic transaction requirement (§5) applies only to:

> Single business operations with a limited, controllable number of required notification recipients.

Do not design a complete announcement system in this ADR.

## 17. Migration: old path and new path

### 17.1 General migration rules

When migrating a business event to the new notification system:

1. The old email-only path and the new NotificationService path must NOT both send.
2. Each migration must first prove via tests that the new path includes the original email behavior.
3. Then delete the old route-local email enqueue.
4. Long-term dual-writing is not permitted.
5. If a feature flag is used, the single authoritative path and the disable sequence must be documented.
6. The first migration event is `result_published`. Other events are migrated one at a time.

### 17.2 Identity flows are excluded from the first migration

Identity flows are NOT migrated to the new channel-neutral NotificationService as part of the first Inbox implementation. The excluded flows are:

- invitation
- activation
- password reset
- password-change warning
- account recovery

V1 behavior: these flows continue using the existing email-only path (`apps/api/src/email/notificationService.ts`).

Reasons:

- They may not have an Inbox recipient (user may not be logged in or may not yet exist).
- They carry independent tokens, rate limiting, and security lifecycles.
- The first migration phase focuses on `result_published` only.

Future migration may choose either:
- Email-only remains authoritative for identity delivery, or
- NotificationService provides an optional Inbox supplement.

Both options are deferred.

Each event migration must include transaction, authorization, deduplication, and delivery-failure tests.

## 18. Rejected alternatives

### Email only

Rejected because email cannot represent authoritative current state, read state, action completion, or invalidation.

### Inbox only

Rejected because invitation, recovery, security alerts, and offline recall require an external channel.

### Put all code in `utils`

Rejected because notification policy, persistence, transactions, security, and delivery state are application and infrastructure concerns, not stateless generic helpers.

### Send SMTP inline from Fastify routes

Rejected because provider latency and outages would affect business request latency and correctness.

### Introduce BullMQ or RabbitMQ now

Rejected because PostgreSQL already provides the required durability and queue semantics at the current scale, while another infrastructure system adds deployment and consistency burden.

### Create a separate worker application immediately

Deferred. A separate process entrypoint inside `apps/api` provides isolation without prematurely creating another package.

### Store complete absolute URLs in notification rows

Rejected because environment and domain changes would make persisted links stale and unsafe.

## 19. Consequences

### Positive

- Inbox and Email have clear, non-overlapping responsibilities.
- Business operations are independent from SMTP availability.
- Existing PostgreSQL infrastructure is reused.
- Delivery retries and failures are inspectable.
- Future channels can be added without changing business routes.
- Public URL configuration becomes explicit and testable.
- Module placement follows existing repository boundaries.
- `organization_id` maintains the existing internal data boundary.

### Negative

- The API package gains an additional process entrypoint.
- Outbox locking, retries, and recovery require careful tests.
- Notification policy becomes a maintained product contract.
- Existing best-effort email call sites may need transaction-boundary migration.
- Inbox requires new schema, repository, contracts, routes, and frontend UI.
- Two `notificationService` names must be disambiguated during transition.
- At-least-once delivery means rare duplicate emails are possible.
- `sent` does not always prove external delivery while `DisabledEmailSender` is active.
- A single global stale-message TTL is too coarse for all email types.
- The actionPath whitelist must be maintained alongside notification target routes.
- NotificationType and EmailType require an explicit application-layer mapping.
- Worker heartbeat adds a small PostgreSQL write workload.
- No general per-recipient rate limit in V1 (anti-bombing gap).
- Without retention cleanup, notification and outbox tables grow continuously.

## 20. Implementation sequence

1. Add and validate `PUBLIC_WEB_ORIGIN` in existing runtime config and `.env.example`.
2. Add `actionLink.ts` with two-layer validation tests for relative paths, base origin, and open-redirect rejection.
3. Freeze notification and email type names in domain code.
4. Add `notifications` schema and `notificationRepo`.
5. Extend `email_outbox` schema: add `notification_id`, `recipient_user_id`, `locked_at`, `locked_by`, `provider_message_id`, `dedupe_key`; migrate status enum to `pending | processing | retry_wait | sent | dead`.
6. Add `apps/api/src/notifications/service.ts` and `policy.ts`.
7. Register the notification service through a Fastify plugin.
8. Add the independent email worker entrypoint with build entry constraints.
9. Add Inbox API contracts and routes with offset/page pagination (reuse `PaginationParamsSchema`).
10. Add the minimal web notification center.
11. Rename `apps/api/src/email/notificationService.ts` → `emailDeliveryService.ts`.
12. Migrate business events one at a time: result published, exam assigned, schedule change/cancellation, grading assigned.
13. Add diagnostics, dead-row inspection, and authorized manual retry.
14. Add worker heartbeat persistence in PostgreSQL.

Each event migration must include transaction, authorization, deduplication, and delivery-failure tests.

## 21. Deferred work

The following items are explicitly deferred and NOT part of V1:

- explicit `skipped` or `suppressed` delivery status;
- per-email-type stale TTL;
- stale-message skip implementation;
- identity flow integration with NotificationService (invitation, activation, password reset, password-change warning, account recovery);
- provider-native idempotency;
- user and organization notification preferences;
- digest mode, quiet hours, unsubscribe center;
- retention cleanup worker;
- per-recipient delivery rate limiting;
- large-scale fan-out for announcements;
- automated route-whitelist generation;
- external alerting platform integration.

## 22. Acceptance criteria

### Data model

- [ ] `notifications.organization_id` is a real non-null organization FK
- [ ] No dummy/sentinel/empty-string organization IDs used anywhere
- [ ] `notification_id` is nullable on `email_outbox` for identity-only emails
- [ ] `email_outbox` target schema includes locking (`locked_at`, `locked_by`) and dedup (`dedupe_key`) columns
- [ ] `retry_wait` is a distinct persisted status with explicit claim semantics (§6.3)
- [ ] Worker claim semantics for `pending` and due `retry_wait` rows are documented
- [ ] `next_attempt_at` invariants per status are documented (§3.1)
- [ ] Status enum migrates from `pending|sent|failed` to `pending|processing|retry_wait|sent|dead`

### Deduplication

- [ ] Email dedupe keys are recipient-scoped (§9.4)
- [ ] Multi-recipient delivery keys do not conflict on the dedupe constraint
- [ ] Examples cover both user-linked and email-only identity deliveries

### Delivery semantics

- [ ] Email delivery is explicitly at-least-once
- [ ] `sent` is not documented as unconditional proof of external delivery (§12.2)
- [ ] Disabled sender semantics are explicitly documented (§12.1)
- [ ] `sent_at` alone is not treated as proof of provider acceptance
- [ ] `EMAIL_ENABLED=false` behavior is documented and has test coverage
- [ ] Global stale-message TTL limitations are documented or TTL skipping is explicitly deferred (§12.3)

### Security

- [ ] `actionPath` is validated at both write time and render time (two-layer)
- [ ] `actionPath` rejects traversal, encoded traversal, external URLs, protocol-relative URLs
- [ ] Every `actionPath` used by notification creation code is covered by whitelist tests (§7.6)
- [ ] New notification target routes update whitelist and tests in the same PR (§7.6)

### API

- [ ] Inbox API passes authentication tests
- [ ] Inbox API passes same-organization user isolation tests
- [ ] Repository queries use `organization_id + recipient_user_id`
- [ ] Inbox list enforces offset/page pagination (no unbounded lists)
- [ ] Pagination reuses `PaginationParamsSchema` + `PaginatedResponseSchema`
- [ ] Pagination remains scoped by organization and recipient

### Worker and observability

- [ ] Worker heartbeat is persisted in PostgreSQL or equivalent shared storage (§13.1)
- [ ] API diagnostics do not rely on process-local worker memory
- [ ] No worker HTTP RPC is required
- [ ] Worker build entry is explicit and verified by CI
- [ ] Diagnostics expose worker heartbeat and backlog metrics (§13.2)

### Migration

- [ ] Old email path and new notification path do not double-send
- [ ] Identity flows are explicitly out of scope for the first NotificationService migration (§17.2)
- [ ] Existing identity email-only behavior remains unchanged

### Naming

- [ ] `EmailNotificationService` renamed to `EmailDeliveryService`
- [ ] No two ambiguous `notificationService` names in the codebase
- [ ] NotificationType-to-EmailType mapping is explicit and tested (§9.5)
- [ ] No cross-table string-equality invariant is assumed between NotificationType and EmailType

### Policy

- [ ] V1 channel policy is code-level static mapping (no preference UI)

### Language

- [ ] The ADR contains no unintended Chinese-language fragments
