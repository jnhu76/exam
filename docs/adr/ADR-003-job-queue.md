# ADR-003 — Job Queue for Async / Long-Running Workloads

## Status

Queue classification / adoption policy: **ACCEPTED — amended 2026-09-05**.

General-purpose job-queue platform: **DEFERRED**.

Workload-specific queue adoption remains governed by the corresponding
Accepted ADR or other current normative design authority.

> **Current authority note:** ADR-003 does not say that every structure named
> "queue" is the same architectural mechanism. It defines how queue-like
> workloads are classified, what authority they may own, and what evidence is
> required before sharing infrastructure across them.
>
> Email has already taken the workload-specific path: ADR-011 adopts a
> PostgreSQL `email_outbox` plus asynchronous delivery. That does **not** adopt a
> generic job platform.
>
> Exam admission is a different class. `requireQueue` decides who may enter an
> exam and when, so a production admission runtime participates in exam
> correctness. The current `timed_sync` semantic contract freezes the boundary
> between timing and admission; issue #292 tracks the still-open durable
> admission work. The issue is tracking/evidence, not architecture authority by
> itself.

## Historical Context — Phase 2 acceptance-time baseline

> This section is historical evidence. Later Accepted ADRs and current
> architecture/contracts govern present runtime facts.

At the original Phase 2 decision point:

- answer save / submit were synchronous PostgreSQL operations;
- objective auto-grading ran inline on submit;
- CSV import/export were synchronous;
- deadline/heartbeat scanning used specialized in-process reconciliation loops;
- manual grading was request-scoped;
- there was no generic worker platform or message broker.

The original decision therefore deferred a generic Job Queue until a real
workload demonstrated the need. That judgment still holds for a platform-wide
queue, but later work proved that "one queue decision" is too coarse: Email,
long-running jobs, exam admission, and UI worklists have different authority
and failure semantics.

## Queue taxonomy

Classify the workload **before** selecting technology or sharing a worker.

| Class | Example | Authority | Failure tolerance | Default direction |
| --- | --- | --- | --- | --- |
| **A. Delivery / side-effect queue** | Email delivery (ADR-011) | Delivery attempts for a business fact committed elsewhere | Lag/retry/at-least-once may be acceptable; business truth survives delivery failure | Workload-specific transactional outbox in PostgreSQL |
| **B. Async work queue** | Future large PDF/export/import/recompute | Slow-work execution and its job lifecycle; result/progress persisted separately | Bounded delay, retry and backpressure are expected | PostgreSQL-backed job records first; worker topology only as needed |
| **C. Admission / control queue** | Exam `requireQueue` | Who is eligible/admitted to enter an exam and in what order/batch | **Correctness-critical**; restart loss or bypass changes exam behavior | Domain-specific durable admission state + explicit state machine + atomic admit/start boundary |
| **D. Read-model / worklist called “queue”** | Manual grading queue, recovery queue | A projection/list over existing authoritative records | No execution transport exists | Keep as query/projection; do not add queue infrastructure because of the name |

Deadline/heartbeat scanners are also not automatically Job Queues. They are
specialized reconciliation loops over PostgreSQL authority. If scale later
requires distributed ownership, backlog scheduling, or delayed retry, perform a
scanner-specific architecture review first.

## Criticality rule

"Non-critical" here means **not authoritative for the originating business
operation**, not "unimportant to the product".

Email is a good example: SMTP may be unavailable while the exam/result/account
operation that created the delivery intent remains correct. ADR-011 can
therefore tolerate asynchronous lag and at-least-once delivery.

Exam admission cannot use the same degradation rule. For an exam whose frozen
policy has `requireQueue=true`, loss of admission authority must never silently
fall back to "start normally". That would change who is permitted to enter and
would bypass published policy.

## Decision

The following policy is Accepted:

1. **Classify before sharing infrastructure.** Similar names do not create a
   common authority boundary.
2. **One workload may adopt a focused queue without activating a generic
   platform.** ADR-011 Email is the current example.
3. **General-purpose queue adoption remains Deferred.** One outbox or one
   scanner is not evidence for BullMQ, RabbitMQ, Kafka, or a generic `jobs`
   abstraction.
4. **PostgreSQL is the default durable authority** for job/admission facts unless
   an Accepted decision explicitly moves that authority.
5. **Redis adoption is per responsibility.** ADR-001 currently adopts Redis for
   shared rate limiting only. Redis availability does not authorize queue,
   scanner, Email, or admission truth to move there.
6. **Exam-control queues require a domain decision.** A worker library cannot
   substitute for admission lifecycle, idempotency, locking, audit,
   authorization, and admit→attempt atomicity.
7. **Timing and admission are orthogonal.** ADR-006 owns server time. The
   current `timed_sync` contract owns the T0/deadline relationship. Admission
   delay or queue position must not become a second exam clock.
8. **Real-time transport is orthogonal.** ADR-002 governs polling/SSE/WebSocket;
   push may improve waiting UX but never becomes queue/admission authority.
9. **Stateful test isolation follows ADR-007.** New queue/worker resources must
   have explicit isolated namespaces/lifecycles; ordinary tests do not
   implicitly start consumers.
10. **Authorization follows the accepted scoped model.** Operator actions over
    exam-control queues reuse the capability/resource-scope architecture
    (ADR-010/ADR-015 where applicable), not coarse role-name checks.

## Trigger register

A trigger means "perform the focused architecture review". It does **not** mean
"install a generic queue".

| Trigger | Current status | Disposition |
| --- | --- | --- |
| Large CSV/PDF export cannot finish within the supported request budget | **Not demonstrated** | Class B review; measure rows/latency/memory first |
| Large import exceeds request lifecycle | **Not demonstrated** | Class B review; preserve import idempotency and partial-failure semantics |
| Email must not block/fail the originating business operation | **Triggered / resolved** | ADR-011 Class A PostgreSQL `email_outbox`; generic platform remains Deferred |
| Slow grading recomputation/batch processing | **Not demonstrated** | Class B review; current grading worklist is Class D, not worker infrastructure |
| Scanner outgrows a single reconciliation loop | **Not demonstrated** | Scanner-specific ownership/backlog review first |
| Durable operational `requireQueue` capability | **Product need is live; durable runtime still open** | Class C review constrained by current `timed_sync` contract; implementation tracked by #292 |

Performance triggers require measurements. Correctness/control triggers may be
raised by a product requirement even at small scale: durability is required
because semantics demand it, not because throughput crossed a benchmark.

## Current exam-admission reality

The repository currently has a legacy process-local `examQueues` Map and
candidate queue/start gates. The current `timed_sync` contract records that
`requireQueue=true` is product-reachable for existing timing modes but that this
Map is non-durable, single-instance, and not an acceptable final admission
runtime.

Therefore:

- the Map is **as-built reality**, not durable architecture authority;
- this is a known implementation/design gap, tracked by #292;
- #292 does not itself become authority merely because it is an issue;
- the eventual admission state machine/commands must be explicitly
  human-approved and recorded in a current normative decision/contract before
  implementation is treated as conformant.

## Relationship to other decisions

| Decision / contract | Relationship to ADR-003 |
| --- | --- |
| **ADR-001 — Redis** | Redis is optional infrastructure; shared rate limiting is the only adopted Redis business responsibility. Admission/queue/scanner use requires a separate explicit decision. Redis may later coordinate or accelerate, but must not silently become durable exam truth. |
| **ADR-002 — WebSocket/SSE** | Waiting/progress notification transport is separate from queue correctness. Polling/SSE/WebSocket cannot own work/admission state. |
| **ADR-006 — Exam Time Authority** | Any exam queue consumes the canonical server `now`; it cannot invent a second clock. For `timed_sync`, admission never changes T0/shared deadline. |
| **ADR-007 — Stateful Infrastructure Test Isolation** | New queue/worker state must use the accepted test-scope isolation model and explicit worker lifecycle. |
| **ADR-010 / ADR-015 — Scoped authorization** | Admin/Proctor actions on exam-control queues use current capability/resource-scope authority. Queue ownership is not authorization. |
| **ADR-011 — Notification / Email** | Accepted focused Class A adoption: PostgreSQL outbox + asynchronous delivery. ADR-011 does not supersede ADR-003 and does not authorize a generic queue. |
| **Current `timed_sync` semantic contract** | Current normative source for the timing/admission boundary: timing authority and admission authority are separate; admission must not change shared deadline semantics. |
| **Issue #292** | Tracks the still-open durable `requireQueue` admission implementation/design work. It is evidence/work tracking, not authority by itself. |

Later ADRs may adopt another focused Class A/B/C mechanism without superseding
ADR-003. Supersession is required only if the project changes this
classification policy or intentionally adopts a shared general-purpose job
platform.

## Minimal viable adoption by class

### Class A — Delivery / side effect

Use a transactional outbox when the business transaction must durably record an
intent to deliver while the external side effect occurs later.

- enqueue inside the relevant PostgreSQL transaction when delivery intent must
  be atomic with business state;
- explicit claim/retry/terminal states;
- bounded backoff and abandoned-work recovery;
- at-least-once only when duplicate semantics are understood and accepted;
- delivery state is not the originating domain fact.

ADR-011 is the concrete implementation.

### Class B — Async long-running work

When a measured workload cannot remain request-scoped:

1. Start with PostgreSQL-backed job records and the smallest worker topology
   that fits.
2. Persist progress/result/reference; worker memory is never the sole result.
3. Make handlers retry-safe/idempotent where required; do not assume exactly
   once.
4. Add backpressure, retry bounds, diagnostics, and operator recovery before
   increasing worker concurrency.
5. Keep a synchronous fallback only if it preserves identical semantics; two
   divergent execution paths are worse than no fallback.

### Class C — Exam admission / control

Do **not** model exam admission as a generic background job by default.

The eventual human-approved design must cover at least:

- durable PostgreSQL admission records tied to the relevant exam and
  candidate/enrollment identity;
- an explicit admission lifecycle/state machine (state names belong to that
  design, not this ADR);
- stable idempotency/command identity for enqueue/admit/operator actions;
- deterministic ordering/batch semantics from the frozen exam policy;
- atomic serialization between consumed admission and attempt creation/start;
- restart reconstruction from durable rows;
- capability/resource-scope authorization and required audit evidence;
- queue position/readiness as a derived projection, not a second authority;
- no ownership of `timed_sync` T0/deadline; ADR-006 remains clock authority.

Redis may later provide ephemeral coordination/wakeup/acceleration only after a
separate ADR-001 decision. Redis loss must not erase admission facts or silently
admit candidates.

## When a generic job platform becomes a candidate

Consider shared queue infrastructure only when specialized mechanisms create
material duplicated complexity or measured operational limits, for example:

- several independent Class B workloads need common delayed scheduling, retry,
  cancellation, progress, and worker scaling;
- job classes need independent worker pools;
- PostgreSQL polling/claiming is a measured bottleneck;
- operations need one supported cross-workload job-control plane;
- duplicated worker lifecycle/retry implementations have become significant
  maintenance debt.

Even then, **Class C exam-control authority does not automatically migrate into
the generic platform**. The adoption ADR must enumerate which workloads move,
which PostgreSQL authority remains, and the failure/reconciliation contract for
all migrated classes.

## Non-goals

- Building a generic task framework because Email has an outbox.
- Treating every UI/business worklist named "queue" as queue infrastructure.
- Replacing deadline/heartbeat scanners merely for architectural uniformity.
- Moving objective auto-grading off submit without a separate semantic or
  measured reason.
- Letting Redis availability decide durable exam truth.
- Letting a queue define the exam clock.
- Bypassing a configured correctness-critical admission policy when admission
  authority is unavailable.

## Operational / failure principles

All asynchronous mechanisms require some subset of supervised lifecycle,
shutdown bounds, retries, backpressure, diagnostics, deterministic tests, and
explicit teardown. An in-process loop such as Email does not require a second
container, but it is still an independent lifecycle.

For Classes A/B:

- crash/retry/duplicate execution semantics must be explicit;
- poison work must have bounded retry/quarantine where relevant;
- backlog age/depth must be observable;
- results must persist outside worker memory.

For Class C admission:

- restart must reconstruct membership/order/admission facts from durable state;
- concurrent/duplicate admission commands must converge;
- authority unavailable => queue-gated entry fails closed, not bypassed;
- later Redis loss must be recoverable from PostgreSQL authority;
- time-sensitive decisions use ADR-006's canonical server time.

## Rollback principles

Rollback is class-specific.

Classes A/B may return to synchronous execution only when that path preserves
the same business semantics and durable in-flight work is drained/migrated or
explicitly dispositioned.

Class C admission must **not** roll back by bypassing `requireQueue` on an exam
whose frozen policy requires it. Safe rollback means preventing activation,
restoring a previous durable implementation, explicitly migrating admission
state, or failing closed until authority is restored.

## Current disposition

- **Queue classification / adoption policy:** `ACCEPTED`.
- **General-purpose Job Queue:** `DEFERRED`.
- **Email delivery:** Class A adoption `ACCEPTED` via ADR-011; PostgreSQL
  `email_outbox` is the durable delivery queue.
- **Large export/import/async grading:** no demonstrated Class B trigger.
- **Deadline/heartbeat scanners:** specialized reconciliation loops; no generic
  queue adoption.
- **Exam admission (`requireQueue`):** Class C correctness problem is real;
  durable admission runtime is not yet complete. Current normative constraints
  come from the `timed_sync` contract; implementation work is tracked by #292.
- **Legacy `examQueues` Map:** known non-durable as-built gap, not acceptable
  final admission authority.
- **Redis-backed queue/admission:** not adopted by ADR-001; requires a separate
  per-responsibility decision.
