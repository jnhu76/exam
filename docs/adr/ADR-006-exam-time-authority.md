# ADR-006 — Exam Time Authority

## Status

**Accepted — amended by the audit atomicity corrective (2026-07-21).** The
canonical time authority plugin (`apps/api/src/plugins/now.ts`) already exists
and is in use; this ADR records that decision as binding and adds the
structural rules that prevent regression.

> This ADR does **not** introduce a new clock. `fastify.clock.now()` must not
> be added. `apps/api/src/plugins/now.ts` and the `fastify.now()` decoration it
> provides are the single runtime clock API.

## Context

Exam time is core domain state in Phase 2: `openAt`, `closeAt`,
`deadlineAt`, `startedAt`, `submittedAt`, `lastActivityAt`, the deadline
scanner's scan instant, and audit event timestamps. These must not be derived
from a mix of frontend time, the test process wall clock, ad-hoc `new Date()`
inside routes, or SQL `now()` — otherwise admin lifecycle
(publish/open/close/archive), deadline auto-submit, and the P2B-J1/J2 E2E
suite become flaky and the 409 score/export gate can fire nondeterministically.

### What already exists (binding)

`apps/api/src/plugins/now.ts` decorates the Fastify instance with:

```ts
interface FastifyInstance {
  now: () => Date;
  setNowOverride(provider: (() => Date) | null): void;
}
```

- Production default: `now()` returns `new Date()`.
- Tests can inject a fixed clock via `setNowOverride`.
- Routes and scanners already call `fastify.now()` extensively
  (`routes/attempts.ts`, `routes/exam.ts`, `plugins/deadlineScanner.ts`).
- `packages/exam-engine` and `packages/domain` are Fastify-free and already
  receive `now: Date` as an explicit parameter (`examCommands.ts`,
  `attemptCommands.ts`, `grading.ts`, `timer.ts`,
  `candidateExamSummary.ts`).

So the authority model is already in place. This ADR formalizes it and closes
the remaining gaps where raw `new Date()` / `Date.now()` / SQL `now()` still
leak into business-time paths.

## Decision

The **application server clock**, surfaced exclusively as `fastify.now()`, is
the Phase 2 exam runtime time authority. The standard call chain is:

```txt
fastify.now()
  ↓
command({ now })
  ↓
domain policy / state machine({ now })
  ↓
repo query uses now parameter
  ↓
optional security audit records the privileged action
```

### Binding rules

- `apps/api/src/plugins/now.ts` is the canonical time authority plugin.
- `fastify.now()` is the only allowed runtime clock API in the
  Fastify/API layer.
- `fastify.clock.now()` must not be introduced (no second clock).
- Each request captures **one** `now` when it performs time-sensitive business
  logic and threads it through that request.
- Each scanner tick captures **one** `now` and threads it through that tick.
- Commands receive `now` explicitly.
- Domain / state-machine / policy functions receive `now` explicitly.
- Repositories receive `now` for time-sensitive queries.
- Audit metadata that represents a business instant uses the same operation
  `now`. `audit_logs.createdAt` remains a non-authoritative storage stamp.
- Frontend / browser time is **never** authoritative for exam lifecycle
  decisions.
- DB `now()` / `CURRENT_TIMESTAMP` / `clock_timestamp()` /
  `transaction_timestamp()` must **not** be used for exam business-time
  decisions. (Drizzle `defaultNow()` on `createdAt`/`updatedAt` storage columns
  is a non-business storage stamp and is allowed — see Allowlist.)
- Do not mix the application clock and DB `now()` within the same business
  decision.

### Enforcement scope (zoned, not global)

The structural guardrail is **zoned**, not a global "ban every `new Date()`"
rule. The goal is to converge exam business time, not to eliminate all
wall-clock usage in the system:

| Zone | Rule |
| --- | --- |
| `packages/exam-engine`, `apps/api/src/routes`, deadline/heartbeat/attempt/extend/submit/score-export paths, state-transition audit | **Strict.** No raw wall-clock read; use `fastify.now()` (API/plugin layer) or an explicit `now: Date` param (engine/domain). The only exception is `plugins/now.ts`. |
| `packages/db/src/repository` | Short allowlist; every entry needs a reason. `baseRepo.now()` and org/settings repo usage are storage stamps only. |
| Frontend (`apps/web`), test polling/sleep loops, performance timing (`performance.now()`), non-authoritative reporting | **Out of ADR-006 scope.** Frontend time is display-only; test polling waits on a server signal; perf timing is not business time. |

`new Date(existingDate)` / `new Date(ms)` (date **construction/arithmetic**
from an existing instant) is not a wall-clock read and is not flagged — only
empty-arg `new Date()` is.

### Allowlist (raw time sources permitted, with reason)

| Path | Raw time allowed | Reason |
| --- | --- | --- |
| `apps/api/src/plugins/now.ts` | `new Date()` | Canonical `fastify.now()` implementation — the one place the wall clock is read. |
| `packages/db/src/repository/baseRepo.ts` | `now()` helper | `createdAt`/`updatedAt` **storage** stamps only; not a business-time decision. |
| `packages/db/src/repository/organizationRepo.ts` / `settingsRepo.ts` | `now()` (from baseRepo) | Organization/settings `updatedAt` storage stamps only (non-business). |
| `packages/db/src/repository/systemStatsRepo.ts` | `new Date()` | **Reporting/dashboard day-boundary only — NOT exam business time.** (1) reporting/dashboard only; (2) NOT used for exam lifecycle / deadline / submit / score-export gate; (3) NOT authoritative for candidate/admin runtime decisions; (4) TODO: future cleanup should derive `startOfDay` from `APP_TIMEZONE` or the org timezone explicitly. Carries an inline TODO. |
| `packages/exam-engine/src/answerProtocol.ts` | one resolved fallback | The single `state.now ?? new Date()` resolution; the API layer always supplies `state.now`, so the engine never reaches the fallback in production. |
| `apps/api/src/routes/export.ts` | `Date.now()` | Used only to generate a unique CSV download filename suffix (cache-busting); not a business-time decision. |
| `apps/api/src/routes/testHelpers.ts` | `new Date()` / `Date.now()` | Test/factory helpers (fixture generation, unique-id suffix); never asserts server business-time authority. |
| Test files (`*.test.ts`) / factories | `new Date()` / `Date.now()` | Allowed for fixtures/assertions; never used to assert business-time authority of the server. |
| `apps/web/**` | `new Date()` / `Date.now()` | Display / local UI only; never server authority. |

A structural test (`apps/api/src/runtime/time-authority.structural.test.ts`)
scans source text and fails the build if a raw wall-clock read appears outside
this allowlist in business paths.

## Runtime timezone (display only)

`APP_TIMEZONE` (default `Asia/Shanghai`) and the `TZ` / `PGTZ` env vars
configure **display, logs, diagnostics, and fixture readability**. They do
**not** change business-time comparison semantics.

- `openAt`, `closeAt`, `deadlineAt`, `submittedAt`, … are **absolute
  instants**; comparisons are instant-to-instant regardless of timezone.
- `APP_TIMEZONE` must be a valid IANA timezone (validated at startup via an
  `Intl.DateTimeFormat` probe; invalid values fail fast).
- Ambiguous abbreviations such as `CST` must not be recommended.

## Construction hard rule (binding)

Every time-sensitive operation must obtain `now` from `fastify.now()` exactly
once for the request/tick and pass it down explicitly:

```txt
request/tick
  -> const now = fastify.now()        (single capture)
  -> command({ now })                 (explicit param)
  -> policy / stateMachine({ now })   (explicit param)
  -> repo.method(ctx, ..., now)       (explicit param for time-sensitive queries)
  -> recordAtomicHttpAudit(tx, ...)    (only for an atomic security action)
```

Any business path that reads the wall clock directly (`new Date()`,
`Date.now()`, SQL `now()`) instead of the threaded `now` is a bug.

Audit placement and durability are binding and closed by the corrective below.

## Non-goals

- No Redis.
- No MQ.
- No job queue.
- No distributed clock.
- No NTP management.
- No WebSocket / SSE.
- No new timing modes.
- No broad `createdAt` / `updatedAt` refactor.
- No full P2B-J2 publish/open/close/archive business hardening.
- No rename of `fastify.now()` and no second clock API.

## Consequences

- Positive: one authority for exam runtime time; the score/export 409 gate,
  deadline auto-submit, and audit ordering are provably consistent; tests can
  freeze time via `setNowOverride`; a structural test blocks regression.
- Negative: business paths must thread `now` explicitly — slightly more
  verbose than reading the wall clock inline. This is intentional and required
  for determinism.
- Neutral: ADR-001..004 stay `Deferred`; this baseline is synchronous HTTP +
  in-process scanner + DB-backed state, consistent with single-instance
  Phase 2.

## Audit contract proportionality corrective (2026-07-21)

The earlier broad audit amendment is retained as historical context but is
superseded by this section. It incorrectly treated nearly every mutation as
transaction-critical, coupled candidate runtime to `audit_logs`, classified
authentication as response-critical despite the pre-tenant gap, and made a
best-effort drain timeout fail the process.

### Independent dimensions and inventory

`apps/api/src/audit/auditPolicy.ts` defines five independent dimensions for
each declared action: lifecycle, durability, security obligation, expected
frequency, and a strict payload schema. Enum completeness is vocabulary
completeness only; recursive production-emitter inventory proves runtime
coverage separately.

```text
DECLARED:   62
ACTIVE:     51
RESERVED:    3
DEPRECATED:  8

ATOMIC:                         28
SYNCHRONOUS_SENSITIVE_READ:      3
BEST_EFFORT:                    24
DOMAIN_HISTORY:                  7
```

The durability totals cover all declared vocabulary, including reserved and
deprecated entries. Active best-effort actions number 20. The three reserved
email actions have no production emitter and make no runtime guarantee.

### Durability sets

| Durability | Contract | Actions |
| --- | --- | --- |
| **Atomic** | The privileged/authority/credential operation must not commit unless its audit evidence commits in the same branded PostgreSQL transaction. | `admin.bootstrap`, `admin.password_reset.local`, `auth.password_update`, `attempt.submit`, `attempt.forceSubmit`, `attempt.extendTime`, `attempt.misconductFlagged`, `candidate.create`, `candidate.password_reset`, `enrollment.add`, `enrollment.remove`, `exam.published_schedule_updated`, `exam.publish`, `exam.unpublish`, `exam.close`, `exam.cancel`, `exam.archive`, `exam.delete`, `exam.extend`, `exam.publish_results`, `user.create`, `user.disabled`, `user.reactivated`, `user.delete`, `grading.score_entered`, `grading.finalized`, `user.role_changed`, `proctor.incident_marked` |
| **Synchronous sensitive read** | Audit must be durable before sensitive data is returned; an audit failure denies the read. | `attempt.exported`, `export_scores`, `grading.detail_viewed` |
| **Active best effort** | Failure is observed but does not fail the business operation or request. | `login.success`, `login.failure`, `logout`, `auth.profile_update`, `branding.update`, `candidate.update`, `candidate.import`, `candidate_field.create`, `candidate_field.update`, `candidate_field.delete`, `course.create`, `course.update`, `course.delete`, `exam.create`, `exam.update`, `question.create`, `question.update`, `question.delete`, `question.import`, `user.profile_updated` |
| **Domain-history exclusion** | Canonical business state owns the fact; the compliance table is not a hidden event store. | `attempt.start`, `attempt.saveAnswer`, `attempt.restore`, `attempt.autoSubmit`, `attempt.disrupted`, `exam.open`, `exam.closed` |
| **Reserved** | Vocabulary only; no active coverage claim. | `email.outbox_created`, `email.send_failed`, `email.send_retried` |
| **Deprecated mixed action** | Historical rows remain queryable, but production must use the split action. | `user.update` |

Routine draft edits use best-effort `exam.update`; a published schedule or
availability edit uses atomic `exam.published_schedule_updated`. A role-only
user edit emits only `user.role_changed`; display-name, disable, and reactivate
use `user.profile_updated`, `user.disabled`, and `user.reactivated`
respectively. Candidate import keeps per-row business transactions, emits
atomic `candidate.create` only for a newly created login identity, and emits
one best-effort import summary. Existing identity-field updates do not become
per-field compliance events.

`attempt.submit` and `exam.publish_results` describe state transitions, not
command attempts. Idempotent replays emit nothing. Automatic close/open and
deadline/heartbeat transitions use canonical exam/attempt rows and never emit
the explicit administrator actions.

### Candidate runtime availability and volume

`attempt.saveAnswer` never writes `audit_logs`. Its authority is the versioned
answer state (`questionId`, value, version, client sequence/history, server
save time, and attempt activity time). No answer value or standard answer is
copied into audit or structured logs.

The current frontend uses a 1.5-second per-question debounce and flushes
pending work before submit. No production load histogram exists, so capacity
figures are assumptions, not measurements. For a transparent fixture of a
60-question, 60-minute exam with one settled save per question plus ten edits,
one candidate performs about 70 saves (1.17/minute); 100 and 1,000 concurrent
candidates produce about 117 and 1,167 saves/minute. The theoretical debounce
ceiling is 40 requests/minute/candidate if a user repeatedly pauses after each
change. Before this corrective every accepted save added the same number of
transaction-critical audit inserts. After it, additional audit writes on this
path are exactly zero and an audit-table failure cannot reject a valid save.

### Authentication evidence channels

Pre-tenant and tenant-aware authentication evidence are separate:

- A bounded structured platform security log records sanitized reason codes
  for unknown organization/user, invalid password, disabled user, missing
  assignment, non-login role, and authority-resolution failure. It does not
  require or fabricate an organization ID and never logs credentials, hashes,
  cookies, JWTs, authorization headers, or an attacker-controlled username.
- Tenant `login.success`/`login.failure` observations are scheduled only after
  the default organization is resolved. They are best effort, use a user UUID
  or the bounded literal `anonymous`, and cannot turn ordinary authentication
  success/denial into an audit-driven outage.
- Public credential denials remain the same generic 401. Authority subsystem
  errors remain a generic 503; they are not disguised as bad credentials.
- `login.success` means credentials, assignment authority, and session
  issuance were accepted and a cookie was attached to the server response. It
  does not prove client delivery or a later authenticated request.

Login usernames are bounded at 50 characters by the request contract.

### Sensitive-read availability decision

The following privacy-over-availability tradeoff is explicitly accepted:

- Attempt export exposes candidate answers and standard answers.
- Score export exposes bulk candidate result data.
- Grading detail exposes candidate answers and grading material.

These reads fail before response data is returned if their audit insert fails.
This set is intentionally limited to those three operations; login and proctor
mutation paths are not mislabeled as sensitive reads.

`proctor.incident_marked` currently uses the minimal coherent model: its
append-only audit row is the canonical incident mutation and is inserted
atomically in a transaction. It is distinct from
`attempt.misconductFlagged`, which changes the attempt's misconduct state. No
route emits both for one command. A dedicated incident entity is a future
product decision, not an implied current store.

### Owned writers, payload, and storage

Only the audit module constructs production writes. HTTP atomic, system
atomic, synchronous-read, and best-effort APIs are separately typed; CLI and
scanner code never fabricates a `FastifyRequest`. The database writer exposes
only `insert`, performs one `INSERT` with no readback, and exposes no update,
delete, or retention surface. Query access is separate.

Every active action uses a strict allowed-key schema. Common limits are:

| Field | Limit |
| --- | ---: |
| serialized metadata | 4,096 bytes |
| target type | 64 characters |
| target ID / actor ID | 128 characters |
| request/correlation ID | 128 characters |
| user agent | 512 characters |
| IP address | 64 characters |
| incident/misconduct note | 500 / 1,000 characters |

Unexpected fields are rejected for atomic/synchronous operations; a malformed
best-effort observation is logged and dropped without failing the request.
Network/request evidence is bounded by truncation. Free-text incident notes
may contain PII and must be minimized by operators.

The table retains its existing primary key and
`audit_logs_org_created_at_idx (organization_id, created_at)`. On the local
realistic development fixture it contained 21 rows and occupied 48 KiB.
`EXPLAIN` showed the organization/time query using this index backward;
target/type and action queries use the same organization index with residual
filters. That dataset is too small to justify speculative indexes. Monitor
weekly row/byte growth and alert if seven-day growth exceeds twice its
four-week baseline or database free space falls below 20%; reconsider
target/action indexes only with production query latency/selectivity evidence.
Retention/archive/deletion duration remains a deferred compliance/product
decision and is not claimed as implemented.

### Transaction and shutdown evidence

Atomic writers require `TransactionDatabase`. Deterministic PostgreSQL trigger
tests prove audit-failure rollback for route-owned mutations, the
admin-invariant/role wrapper, submit/grading service transactions, the exam
transition executor, CLI bootstrap, bulk import rows, and manual finalization.
The reverse direction is also covered: failed/no-op business operations cannot
persist a false successful mutation audit.

Best-effort work has one lifecycle owner: it synchronously registers accepted
promises, stops accepting on close, drains for at most 10 seconds, and returns
`{ timedOut, pendingCount }`. A timeout logs a warning, abandons the
observation, and continues normal shutdown. The lifecycle module never owns
signals or mutates `process.exitCode`; `server.ts` owns process policy and sets
a nonzero code only for an actual graceful-shutdown failure. SIGKILL loss is
accepted for best-effort observations.

No message bus, Kafka, Redis stream, workflow engine, or general-purpose
outbox is introduced.

## Alternatives considered

- **Introduce `fastify.clock.now()` as a new API.** Rejected — `fastify.now()`
  already provides exactly this with an injectable override; a second clock
  would split the authority and invite drift.
- **Make the DB the time authority (use SQL `now()` in business queries).**
  Rejected — it couples exam decisions to DB transaction timing and makes
  deterministic tests impossible. DB time is allowed only for storage stamps.
- **Capture `now` per call site instead of once per request.** Rejected — a
  single operation could then see two different instants (e.g. the gate reads
  `t1`, the audit reads `t2 > t1`), producing inconsistent decisions/records.
