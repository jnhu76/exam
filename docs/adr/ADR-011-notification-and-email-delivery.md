# ADR-011: Notification Inbox and Email Delivery Architecture

- **Status:** Proposed
- **Date:** 2026-07-23
- **Owners:** EXAM maintainers
- **Related:** ADR-003 Job Queue, ADR-001 Redis, P3-MOD-P5 Email Minimal Wiring

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

- a PostgreSQL-backed email outbox;
- email domain types;
- an API email module;
- a Fastify email plugin;
- an ADR that defers a general-purpose job queue and prefers PostgreSQL-backed work where adequate.

The design should extend these boundaries instead of introducing an unrelated utility layer or premature infrastructure.

## 3. Architecture

```text
Business command
    |
    | database transaction
    v
Business state mutation
    + Inbox notification
    + Email outbox row, when policy enables email
    |
    | commit
    v
HTTP response

Independent email worker
    |
    v
Claim due outbox rows
    |
    v
Render subject / text / HTML / absolute action URL
    |
    v
SMTP transport
    |
    +--> sent
    |
    +--> retry_wait
    |
    +--> dead
```

### 3.1 Authority boundaries

| Concern | Authority |
|---|---|
| Exam, attempt, grading, and result state | Existing business/domain modules |
| Whether a user should be notified | Notification policy/application service |
| What appears in the in-app Inbox | `notifications` records |
| Whether an email should be attempted | `email_outbox` records |
| Whether an email was delivered | Outbox delivery state and provider response |
| Public web origin | Validated runtime configuration |
| SMTP delivery | Email transport adapter |
| Current notification destination | Business resource plus relative `actionPath` |

Email content is not authoritative business state. It is a snapshot produced for delivery.

## 4. Channel policy

### 4.1 Identity messages

Examples:

- invitation;
- activation;
- password reset;
- password changed;
- account recovery.

Default policy:

- Email: required when an address is available and the flow depends on external access.
- Inbox: optional or supplemental.
- Security messages cannot be disabled by user preference.

### 4.2 Operational notifications

Examples:

- exam assigned;
- exam time changed;
- exam cancelled;
- grading assigned;
- result published.

Default policy:

- Inbox: required.
- Email: policy-controlled.
- High-impact changes such as cancellation may require both channels.
- Email links lead back to the authoritative resource in EXAM.

### 4.3 Announcements

Examples:

- scheduled maintenance;
- organization announcements;
- policy changes.

Default policy:

- Inbox: primary.
- Email: optional and explicitly selected.
- No free-form user-to-user messaging is introduced.

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

## 6. Queue decision

The existing PostgreSQL `email_outbox` is the queue for email delivery.

Required queue semantics:

- durable rows;
- `pending`, `processing`, `retry_wait`, `sent`, `dead`, and `cancelled` states;
- attempt count and maximum attempts;
- exponential or bounded backoff;
- `nextAttemptAt`;
- worker ownership and lock timeout;
- safe recovery of abandoned `processing` rows;
- idempotency or deduplication key;
- provider message identifier;
- last error;
- administrator-visible failure information.

Workers claim rows with a database transaction and `FOR UPDATE SKIP LOCKED`, or an equivalent repository abstraction.

A general-purpose queue is reconsidered only when measured requirements exceed the PostgreSQL outbox, including:

- independently scaled workers across several job classes;
- high-volume delayed scheduling;
- substantial PDF, export, import, or media jobs;
- operational evidence that PostgreSQL polling is a bottleneck;
- an existing Redis platform that is already required for other production concerns.

## 7. Public links and runtime configuration

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
6. Database notification records store relative paths such as:

```text
/candidate/exams/abc123
/grader/tasks/task123
/candidate/results/attempt123
```

7. Only local relative paths are accepted for post-login return destinations. Protocol-relative and external URLs are rejected.

Recommended runtime settings:

```env
PUBLIC_WEB_ORIGIN=http://localhost:5173

EMAIL_ENABLED=false
EMAIL_FROM_NAME=EXAM
EMAIL_FROM_ADDRESS=no-reply@example.com
SMTP_URL=

EMAIL_WORKER_BATCH_SIZE=20
EMAIL_WORKER_CONCURRENCY=5
EMAIL_WORKER_POLL_INTERVAL_MS=2000
EMAIL_WORKER_LOCK_TIMEOUT_MS=300000
EMAIL_MAX_ATTEMPTS=6
```

These settings belong in the existing runtime configuration system and `.env.example`. A second environment-loading framework is not introduced solely for this feature.

## 8. Repository placement

### 8.1 Domain and contracts

```text
packages/domain/src/notification.ts
packages/domain/src/email.ts

packages/contracts/src/notification.ts
```

Responsibilities:

- `notification.ts`: notification types, severity, resource references, channel-neutral invariants.
- `email.ts`: email delivery types and template keys; no SMTP implementation.
- contracts: Inbox API request and response schemas.

Do not place transport clients, Fastify instances, database repositories, or environment access in `packages/domain`.

### 8.2 Database

```text
packages/db/src/schema/pg.ts
packages/db/src/repository/notificationRepo.ts
packages/db/src/repository/emailOutboxRepo.ts
```

Responsibilities:

- notification persistence and read state;
- outbox persistence, claiming, retries, and recovery;
- transaction-aware repository operations.

The exact schema remains in the existing PostgreSQL schema module unless the repository later adopts per-feature schema files globally.

### 8.3 Fastify application services

```text
apps/api/src/notifications/
  service.ts
  policy.ts
  actionLink.ts
  types.ts
```

Responsibilities:

- `service.ts`: application orchestration; create Inbox and email deliveries.
- `policy.ts`: channel choice by notification type and severity.
- `actionLink.ts`: validates relative action paths and combines them with `PUBLIC_WEB_ORIGIN`.
- `types.ts`: API-local dependency interfaces where needed.

This directory contains business/application behavior and is not a utility directory.

### 8.4 Email delivery

Keep and evolve the existing email feature directory:

```text
apps/api/src/email/
  notificationService.ts
  renderer.ts
  transport.ts
  templates/
```

Migration direction:

- the existing `notificationService.ts` remains the email-channel adapter during transition;
- channel-neutral orchestration moves to `apps/api/src/notifications/service.ts`;
- SMTP details remain behind `transport.ts`;
- templates receive structured payloads and do not query repositories.

A later cleanup may rename `notificationService.ts` to `emailDeliveryService.ts` after callers migrate, but the rename is not required to adopt this ADR.

### 8.5 Fastify plugins and routes

```text
apps/api/src/plugins/email.ts
apps/api/src/plugins/notifications.ts

apps/api/src/routes/notifications.ts
```

Responsibilities:

- email plugin: construct and decorate the email transport/channel adapter;
- notifications plugin: construct the application service with repository and channel dependencies;
- notifications route: Inbox list, unread count, mark read, and mark all read.

Business routes must not construct SMTP transports or instantiate notification services ad hoc. They call the decorated application service or a command-level dependency.

### 8.6 Worker

```text
apps/api/src/workers/emailDeliveryWorker.ts
```

The worker is a separate process entrypoint but remains in the existing API package initially.

Example deployment:

```text
API process:
node dist/server.js

Email worker process:
node dist/workers/emailDeliveryWorker.js
```

A new `apps/worker` package is introduced only if several worker types need independent dependencies, builds, ownership, or deployment. One email worker does not justify that split.

### 8.7 Runtime configuration

```text
apps/api/src/config/runtimeConfig.ts
apps/api/src/config/runtimeConfig.test.ts
.env.example
```

`PUBLIC_WEB_ORIGIN` and email worker settings are added to the existing runtime configuration boundary. They are not read directly throughout feature code.

### 8.8 Web application

```text
apps/web/src/components/notifications/NotificationBell.tsx
apps/web/src/pages/NotificationPage.tsx
apps/web/src/lib/routes.ts
```

Initial UI:

- unread count;
- notification list;
- mark read;
- mark all read;
- action navigation.

Polling is sufficient for the first version. WebSocket/SSE remains governed by its existing ADR.

## 9. Minimal data model

### 9.1 Notifications

```text
notifications
- id
- recipient_user_id
- type
- title
- body
- severity
- resource_type
- resource_id
- action_path
- created_at
- read_at
- archived_at
- invalidated_at
- dedupe_key
```

A notification may be invalidated when the related business action is no longer applicable. The resource remains the authority.

### 9.2 Email outbox

```text
email_outbox
- id
- notification_id
- recipient_user_id
- recipient_email
- template_key
- template_version
- payload_json
- status
- attempt_count
- max_attempts
- next_attempt_at
- locked_at
- locked_by
- provider_message_id
- last_error
- dedupe_key
- created_at
- updated_at
- sent_at
```

Recipient email and rendered payload inputs are snapshotted sufficiently for deterministic retries and audit. Secrets and password-reset token plaintext are not logged.

## 10. API baseline

```http
GET  /api/notifications
GET  /api/notifications/unread-count
POST /api/notifications/:id/read
POST /api/notifications/read-all
```

Rules:

- every operation is scoped to the authenticated user and organization;
- users cannot read or mutate another user's notifications;
- `actionPath` is returned only after validation;
- notification read state is not a substitute for business task completion.

## 11. Security and privacy

- Password reset and invitation tokens are single-use and time-limited.
- Persist token hashes rather than raw tokens where the flow permits.
- Do not place scores, answer details, passwords, or sensitive personal data in email subjects.
- Email bodies contain the minimum useful information and link to authenticated pages for details.
- Logs redact tokens, SMTP credentials, and sensitive payload fields.
- An email delivery failure does not expose provider responses to ordinary users.
- Administrative retry operations require explicit permission and are audited.

## 12. Failure behavior

| Failure | Required behavior |
|---|---|
| SMTP unavailable | Business request succeeds after DB commit; outbox retries |
| Worker unavailable | Outbox rows remain pending and visible to diagnostics |
| API restart | No delivery state is lost |
| Worker crashes after claim | Lock timeout returns row to retryable state |
| Duplicate worker claim attempt | Database locking prevents concurrent ownership |
| Email permanently rejected | Row becomes `dead`; Inbox remains available |
| Invalid `PUBLIC_WEB_ORIGIN` | Production process fails startup |
| Invalid or external `actionPath` | Notification creation is rejected or stored without action |
| Notification policy failure | Transaction rolls back for required notification creation; optional channels may be omitted only by explicit policy |

## 13. Rejected alternatives

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

## 14. Consequences

### Positive

- Inbox and Email have clear, non-overlapping responsibilities.
- Business operations are independent from SMTP availability.
- Existing PostgreSQL infrastructure is reused.
- Delivery retries and failures are inspectable.
- Future channels can be added without changing business routes.
- Public URL configuration becomes explicit and testable.
- Module placement follows existing repository boundaries.

### Negative

- The API package gains an additional process entrypoint.
- Outbox locking, retries, and recovery require careful tests.
- Notification policy becomes a maintained product contract.
- Existing best-effort email call sites may need transaction-boundary migration.
- Inbox requires new schema, repository, contracts, routes, and frontend UI.

## 15. Implementation sequence

1. Add and validate `PUBLIC_WEB_ORIGIN` in existing runtime config and `.env.example`.
2. Add `actionLink.ts` tests for relative paths, base origin, and open-redirect rejection.
3. Freeze notification and email type names in domain code.
4. Add `notifications` schema and `notificationRepo`.
5. Normalize or complete `emailOutboxRepo` queue semantics.
6. Add `apps/api/src/notifications/service.ts` and policy.
7. Register the notification service through a Fastify plugin.
8. Add the independent email worker entrypoint.
9. Add Inbox API contracts and routes.
10. Add the minimal web notification center.
11. Migrate business events one at a time: invitation, password reset, exam assignment, schedule change/cancellation, grading assignment, result publication.
12. Add diagnostics, dead-row inspection, and authorized manual retry.

Each event migration must include transaction, authorization, deduplication, and delivery-failure tests.

## 16. Acceptance criteria

- Notification code is not placed in `utils`.
- Inbox notifications are persisted and user-scoped.
- Email is never sent inline in a business request.
- `email_outbox` survives process and provider failures.
- Multiple workers cannot concurrently own the same row.
- Required operational notification writes share the business transaction.
- Email links are generated from validated `PUBLIC_WEB_ORIGIN`.
- Stored action destinations are relative and cannot cause open redirects.
- API and worker can run independently.
- Redis/BullMQ/RabbitMQ are not required.
- Existing ADR-003 remains the authority for future general queue adoption.
