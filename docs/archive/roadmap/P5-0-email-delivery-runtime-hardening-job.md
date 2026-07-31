# P5-0 — Email Delivery Runtime Hardening

## 1. Summary

Turn the existing PostgreSQL email-outbox skeleton into a resident, observable,
single-purpose delivery runtime that is safe for the first real business caller.

This job hardens Email delivery only. It does **not** add an Inbox, a business
notification trigger, invitation, password reset, or a template engine.

ADR authority:

```text
docs/adr/ADR-011-notification-and-email-delivery.md
docs/adr/ADR-003-job-queue.md
```

---

## 2. Why this is a separate Job

The current repository already has:

```text
email_outbox
EmailOutboxRepo
EmailOutboxService.processDueEmails
EmailNotificationService
SMTP / console / disabled senders
retry policy
/api/email/test
```

But the current path is not yet a resident production delivery runtime:

```text
- current statuses: pending | sent | failed
- no processing / retry_wait / dead state model
- no locked_at / locked_by
- no FOR UPDATE SKIP LOCKED claim
- processDueEmails is manually invoked
- no independent worker entrypoint
- no PostgreSQL-backed worker heartbeat
- diagnostics cannot prove worker liveness
```

P5-N1 must not simultaneously invent Inbox behavior and redesign the delivery
runtime. This Job closes the delivery-runtime prerequisite first.

---

## 3. Classification

```text
[x] database / migration
[x] repository
[x] worker process
[x] runtime configuration
[x] diagnostics / observability
[x] regression tests
[ ] Inbox
[ ] frontend notification center
[ ] business email trigger
[ ] invitation / password reset
[ ] generic queue platform
```

---

## 4. Goal

After this Job:

```text
API process
    |
    +--> writes email_outbox rows through existing application services

Independent email worker
    |
    +--> claims pending or due retry_wait rows
    +--> marks processing with lock ownership
    +--> invokes the configured sender
    +--> marks sent, retry_wait, or dead
    +--> persists heartbeat
    +--> exposes backlog and liveness through existing diagnostics
```

Email delivery remains at-least-once.

---

## 5. Current-state verification gate

Before editing, verify the real current implementation:

```text
packages/domain/src/email.ts
packages/db/src/schema/pg.ts
packages/db/src/repository/emailOutboxRepo.ts
apps/api/src/email/
apps/api/src/plugins/email.ts
apps/api/src/routes/system.ts
apps/api/src/config/runtimeConfig.ts
apps/api/package.json
apps/api/tsconfig*.json
```

Record any divergence from ADR-011 before implementation.

Do not assume that a daemon, locking, heartbeat, or background startup already
exists.

---

## 6. Scope

### 6.1 Rename the Email-only service

Rename:

```text
apps/api/src/email/notificationService.ts
EmailNotificationService
```

to an unambiguous Email-channel name:

```text
apps/api/src/email/emailDeliveryService.ts
EmailDeliveryService
```

Update exports, imports, tests, logs, and Fastify decorations.

Do not use `NotificationService` for Email-only behavior. That name is reserved
for the channel-neutral application service introduced by P5-N1.

---

### 6.2 Target outbox state machine

Migrate the target persisted states to:

```text
pending
processing
retry_wait
sent
dead
```

Semantics:

```text
pending
  first-time or immediately claimable

processing
  claimed by one worker
  locked_at and locked_by are non-null

retry_wait
  retryable failure under backoff
  next_attempt_at is non-null

sent
  terminal: sender adapter returned successfully
  not unconditional proof of external delivery

dead
  terminal: retry budget exhausted
  last_error is non-null
```

Transitions:

```text
pending     -> processing
retry_wait  -> processing  when next_attempt_at <= now()
processing  -> sent
processing  -> retry_wait  when retryable and attempts remain
processing  -> dead        when attempts are exhausted
processing  -> pending     after abandoned-lock recovery
```

`retry_wait` is a distinct status, not `pending + next_attempt_at`.

Do not add `cancelled`, `skipped`, or `suppressed` in this Job.

---

### 6.3 Schema changes

Extend the existing `email_outbox` with the delivery-runtime fields required by
ADR-011:

```text
locked_at
locked_by
provider_message_id
dedupe_key
```

Normalize existing names only when the migration and repository changes remain
small and safe:

```text
attempts      -> attempt_count
nextRetryAt   -> next_attempt_at
```

Do not add `notification_id` in this Job because the `notifications` table does
not yet exist. P5-N1 owns that relationship.

Do not add `recipient_user_id` unless current code already requires it for
delivery-runtime behavior. P5-N1 owns recipient linkage.

Dedupe-key storage may be introduced here, but no new business event is required
to populate it until P5-N1.

---

### 6.4 Claiming and locking

Implement transactional claiming using PostgreSQL:

```sql
SELECT ...
FROM email_outbox
WHERE
  status = 'pending'
  OR (
    status = 'retry_wait'
    AND next_attempt_at <= now()
  )
ORDER BY created_at ASC, id ASC
LIMIT $batch_size
FOR UPDATE SKIP LOCKED;
```

In the same transaction, claimed rows become:

```text
status = processing
locked_at = now()
locked_by = worker instance ID
```

Requirements:

- concurrent workers do not process the same row simultaneously;
- no intermediate `retry_wait -> pending` sweep is required;
- abandoned `processing` rows are recoverable after lock timeout;
- recovery is bounded and tested;
- retry reuses the same outbox row.

---

### 6.5 Independent worker entrypoint

Add an explicit worker process entrypoint inside the API package, for example:

```text
apps/api/src/workers/emailDeliveryWorker.ts
```

Requirements:

- explicit build entry;
- explicit package script;
- CI verifies the worker build artifact;
- no dependency on server imports or bundler auto-discovery;
- graceful shutdown on supported termination signals;
- structured startup, poll, failure, and shutdown logs;
- bounded batch size and concurrency;
- no new `apps/worker` package.

Use repository-real commands and paths rather than blindly copying examples.

---

### 6.6 PostgreSQL-backed heartbeat

Persist worker liveness in PostgreSQL using either:

```text
worker_heartbeats
```

or an existing equivalent runtime-status table.

Minimum data:

```text
worker_name
worker_instance_id
last_poll_at
last_success_at
last_error_at
last_error
updated_at
```

Rules:

- update after each successful poll cycle;
- API diagnostics read the shared PostgreSQL record;
- no process-local API/worker shared state;
- no worker HTTP RPC;
- no shared file;
- no Redis dependency;
- heartbeat-write failure logs a warning but does not terminate delivery.

---

### 6.7 Diagnostics

Extend the existing system diagnostics surface rather than creating a new
monitoring product.

Expose at least:

```text
oldestPendingAge
pendingCount
retryWaitCount
processingCount
deadCount
lastSuccessfulDeliveryAt
lastWorkerPollAt
workerStatus
```

Degraded conditions include:

```text
heartbeat too old
oldest pending row too old
dead rows present or growing
```

No external alerting platform is introduced.

---

### 6.8 `EMAIL_ENABLED=false`

Preserve current behavior unless the verified code differs:

```text
outbox rows are written
DisabledEmailSender returns successfully
rows may become sent without SMTP delivery
```

Tests and diagnostics must not treat:

```text
sent_at IS NOT NULL
```

as unconditional proof of external delivery.

Where available, distinguish:

```text
provider_message_id != null
provider_message_id == null
sender mode = disabled
```

Do not introduce `skipped` in this Job.

---

## 7. Explicit non-goals

```text
- notifications table
- NotificationService
- Inbox API
- notification bell or page
- PUBLIC_WEB_ORIGIN / actionPath
- users.email
- result_published business caller
- notification_id FK
- recipient_user_id linkage
- invitation
- activation
- password reset
- template engine / backend i18n
- user preferences
- rate limiting
- stale-message TTL implementation
- retention cleanup
- dead-letter administration UI
- generic queue infrastructure
```

---

## 8. Required tests

### State machine

- pending row is claimable;
- future retry_wait row is not claimable;
- due retry_wait row is claimable;
- claim sets processing + lock fields atomically;
- success sets sent;
- retryable failure sets retry_wait + next_attempt_at;
- exhausted failure sets dead;
- abandoned processing row returns to pending;
- terminal rows are never claimed.

### Concurrency

- two workers do not claim the same row;
- `FOR UPDATE SKIP LOCKED` behavior is proven against PostgreSQL;
- worker crash/recovery does not lose rows.

### Delivery semantics

- retry reuses one row;
- SMTP success followed by DB-update failure is documented/tested as at-least-once;
- disabled sender may produce sent without provider evidence;
- `sent_at` alone is not treated as provider acceptance.

### Worker and build

- worker entry builds;
- worker package script starts the built entry;
- CI-visible artifact exists;
- graceful shutdown works;
- heartbeat is persisted;
- diagnostics read shared heartbeat;
- stale heartbeat reports degraded.

### Regression

- existing SMTP, console, disabled, test-email, and retry tests continue to pass;
- API startup does not automatically send SMTP inline;
- no Redis/BullMQ/RabbitMQ/Kafka dependency appears.

---

## 9. Suggested execution order

```text
1. Verify current outbox/repository/sender facts
2. Rename EmailNotificationService -> EmailDeliveryService
3. Migrate state enum and delivery columns
4. Implement claim / lock / recovery repository operations
5. Add explicit worker entrypoint and build scripts
6. Add PostgreSQL heartbeat
7. Extend diagnostics
8. Add concurrency and failure tests
9. Run full Email and diagnostics regression
```

---

## 10. Acceptance criteria

```text
[ ] Email-only service is named EmailDeliveryService
[ ] No ambiguous EmailNotificationService remains
[ ] Persisted states are pending|processing|retry_wait|sent|dead
[ ] retry_wait is a distinct state
[ ] Claim query handles pending and due retry_wait
[ ] Claims use PostgreSQL row locking or an equivalent safe abstraction
[ ] locked_at / locked_by ownership is persisted
[ ] Abandoned processing rows recover after lock timeout
[ ] Delivery retry reuses the same row
[ ] Worker is an explicit independent process entrypoint
[ ] Worker build output is verified by CI
[ ] Worker heartbeat is persisted in PostgreSQL
[ ] Existing diagnostics expose heartbeat and backlog
[ ] EMAIL_ENABLED=false semantics are tested and documented
[ ] sent is not treated as unconditional proof of external delivery
[ ] Email remains at-least-once
[ ] Existing Email regression tests pass
[ ] pnpm verify passes
```

---

## 11. Definition of Done

P5-0 is complete when the existing outbox can run continuously and observably
as an independent process, safely recover from failures, and provide a stable
delivery adapter for P5-N1.

No real product event is required to enqueue Email in this Job.
