# ADR-003 — Job Queue for Async / Long-Running Workloads

## Status

**Deferred — general-purpose job-queue platform.**

**Amended 2026-09-05 — queue classes and cross-ADR authority clarified.**

> **Current authority note:** ADR-003 does not say that every structure named
> "queue" is the same architectural mechanism. It governs when asynchronous
> execution infrastructure is justified and prevents one queue class from
> silently taking authority that belongs to another domain.
>
> The Email trigger has been met and was dispositioned by ADR-011 with a
> workload-specific PostgreSQL `email_outbox` plus an in-process delivery loop.
> That is an intentionally bounded adoption and does **not** adopt a generic job
> queue.
>
> Exam admission is different. A `requireQueue` runtime decides **who may enter
> an exam and when**. Once product-reachable, that state participates in exam
> correctness and must be designed as durable domain authority, not as a
> best-effort worker transport. The current `timed_sync` semantic freeze and
> issue #292 own that admission design. ADR-003 constrains the infrastructure
> choice but does not replace the admission-state-machine decision.

## Historical Context — Phase 2 acceptance-time baseline

> The facts in this section describe the Phase 2 baseline that motivated the
> original decision. They are historical evidence, not current runtime claims
> where later Accepted ADRs explicitly changed the system.

Every Phase 1 and Phase 2 operation originally completed within the synchronous
request lifecycle:

- **Answer save / submit** — idempotent HTTP writes to PostgreSQL; fast and bounded.
- **Auto-grading (objective)** — runs inline in the submit request; objective grading is fast and synchronous.
- **CSV import** (candidate / question) — synchronous within the request; summaries are returned directly.
- **CSV / score export** — synchronous generation; fine for the Phase 2 dataset sizes (P2E-J3 hardened this and explicitly forbade introducing a job queue).
- **Deadline auto-submit scanner** (P2A-J2) — a DB-backed, single-owner scanner, not a generic worker pool.
- **Manual grading** (P2D-J2..J4) — admin-driven, request-scoped writes; no background batch.

At that time there was no asynchronous delivery workload, no generic background
worker platform, and no message broker in the runtime.

Discovery (`docs/archive/phase2-archive/phase2/discovery/06-phase2-gap-analysis.md`
§Redis / MQ / Job Queue Assessment) concluded that a generic Job Queue was not
needed for Phase 2 and that PDF/export/import/email/scanner pressure should be
reconsidered only when demonstrated.

Since then, Email became a real asynchronous workload. ADR-011 deliberately
implemented it as a dedicated PostgreSQL outbox rather than activating a
platform-wide queue.

## Queue taxonomy

Before selecting a technology, classify the thing called a "queue". The class
determines its authority and failure semantics.

| Class | Example | What it owns | Delay / loss tolerance | Default architecture |
| --- | --- | --- | --- | --- |
| **A. Delivery / side-effect queue** | Email delivery (ADR-011) | Delivery attempts for a business fact already committed elsewhere | Delivery may lag; retry / at-least-once is acceptable; business truth must survive queue loss | Workload-specific transactional outbox in PostgreSQL |
| **B. Async work queue** | Future large PDF/export/import/recompute job | Execution of a slow workload and its job lifecycle; business result is persisted separately | Bounded delay is expected; retries/backpressure/progress are first-class | PostgreSQL-backed job records first; dedicated worker only when justified |
| **C. Admission / control queue** | Exam `requireQueue` / #292 | Eligibility and ordering to enter an exam | **Correctness-critical.** Loss, restart reset, or bypass can change who is allowed to start | Domain-specific durable admission state in PostgreSQL; explicit state machine and atomic admit/start boundary |
| **D. Read-model / worklist named “queue”** | Manual grading queue, recovery queue | A query/list of existing authoritative records | No separate execution transport exists | Keep as a projection/query; do not introduce queue infrastructure merely because the UI calls it a queue |

Background reconciliation loops such as deadline/heartbeat scanners are also
not automatically Job Queues. They discover and reconcile authoritative DB
state. If they later need distributed ownership, backlog scheduling, or retry
coordination, that is a scanner-specific architecture review first.

### Critical distinction: delivery vs exam control

Email can be temporarily unavailable while the exam operation that emitted the
notification remains correct. This is why ADR-011 can use at-least-once
outbox delivery and tolerate lag.

Exam admission cannot use that failure model. If `requireQueue=true`, the system
must not react to admission-store failure by silently bypassing the queue and
starting the candidate. The admission decision itself is business authority.
A rollback or outage plan must preserve or fail closed on that authority; it
cannot degrade to "queue off, start normally" when doing so would violate the
published exam policy.

## Decision

**Keep a general-purpose Job Queue deferred. Adopt only the smallest
workload-specific mechanism justified by a demonstrated need.**

Binding rules:

1. **Classify before sharing infrastructure.** Similar names do not create a
   shared authority boundary. Email outbox, exam admission, manual grading
   worklists, and scanners are different classes unless a later Accepted ADR
   explicitly unifies them.
2. **One workload first.** A demonstrated asynchronous workload may adopt a
   focused durable mechanism without activating a generic platform.
3. **Generic queue adoption needs its own evidence.** One specialized outbox is
   not evidence for BullMQ/RabbitMQ/a generic `jobs` abstraction. A general
   platform becomes a candidate only when multiple independent job classes or
   measured operational pressure demonstrate common scheduling/worker needs.
4. **PostgreSQL is the default durable authority.** Durable job/admission facts
   stay in PostgreSQL unless an Accepted decision explicitly changes that
   authority.
5. **Redis adoption is per responsibility.** ADR-001 currently adopts Redis for
   shared rate limiting only. Redis presence does not authorize moving Email,
   admission, scanner, or job truth into Redis.
6. **Exam control queues require a domain decision.** `requireQueue` must have a
   durable admission entity/state machine, idempotent enqueue/admit commands,
   restart semantics, authorization/audit, and an atomic boundary with attempt
   start. A generic worker library cannot substitute for those semantics.
7. **Timing and admission remain orthogonal.** Under ADR-006 and the current
   `timed_sync` contract, queue delay/position never becomes the exam clock
   authority. `syncStartedAt` / server time owns timing; #292 owns admission.
8. **Real-time transport is orthogonal.** ADR-002 governs polling/SSE/WebSocket.
   Push may improve waiting UX but never becomes admission authority.
9. **Test isolation follows ADR-007.** Any new stateful queue/worker namespace
   must use the accepted test-scope isolation contract; ordinary tests do not
   implicitly start background consumers.
10. **Authorization follows current scoped authority.** Operator actions over
    correctness-critical queues reuse the accepted capability/resource-scope
    model (ADR-010/ADR-015 where applicable), not coarse role checks.

## Trigger register

A trigger causes a **focused architecture review**. It does not automatically
select a generic queue implementation.

| Trigger | Current status | Required disposition |
| --- | --- | --- |
| Large CSV / PDF export cannot finish inside the supported request budget | **Not demonstrated** | Review as Class B async work; measure N/latency/memory first |
| Large import exceeds request lifecycle | **Not demonstrated** | Review as Class B async work; preserve idempotent import semantics |
| Email notification must not block/fail the business request | **Triggered / dispositioned** | ADR-011: Class A PostgreSQL `email_outbox`; generic queue remains Deferred |
| Async / slow grading recomputation or batch processing | **Not demonstrated** | Review as Class B; do not confuse the current grading **worklist** with a worker queue |
| Scanner workload outgrows a single in-process reconciliation loop | **Not demonstrated** | Scanner-specific ownership/backlog review; generic queue only if measured needs justify it |
| `requireQueue` becomes a durable operational exam capability | **Triggered as product design work; implementation open** | Class C admission authority: current `timed_sync` contract + #292; PostgreSQL-authoritative design, no silent bypass |

For performance triggers, use measured limits rather than forecasts. For
correctness/control triggers such as exam admission, the trigger can instead be
a product requirement whose semantics demand durability even before scale is
large; correctness does not wait for a timeout benchmark.

## Relationship to other decisions

| Decision / contract | Relationship to ADR-003 |
| --- | --- |
| **ADR-001 — Redis** | Redis is optional infrastructure with one adopted responsibility: shared rate limiting. Queue/admission/scanner use requires a separate decision. Redis may coordinate or accelerate a queue only when durable facts remain reconstructable from PostgreSQL or an Accepted ADR explicitly changes authority. |
| **ADR-002 — WebSocket/SSE** | Notification/waiting latency transport is separate from queue correctness. Polling/SSE/WebSocket cannot become job/admission truth. |
| **ADR-006 — Exam Time Authority** | Any exam queue consumes the canonical server `now`; it must not invent a second clock. For `timed_sync`, queue admission never changes the shared T0/deadline. |
| **ADR-007 — Stateful Infrastructure Test Isolation** | New queue/worker infrastructure must receive isolated PostgreSQL/Redis/queue namespaces and explicit worker lifecycle in tests. |
| **ADR-010 / ADR-015 — Scoped authorization** | Admin/Proctor operations on exam-control queues must use the current capability/resource-scope model. Queue ownership is not authorization. |
| **ADR-011 — Notification / Email** | Explicit focused adoption of ADR-003's Class A path: PostgreSQL outbox + asynchronous delivery. It does not supersede ADR-003 and does not authorize a generic job platform. |
| **`timed_sync` semantic freeze / #292** | Current authority for Class C exam admission design. Timing authority and admission authority are explicitly separate; #292 must replace the legacy in-memory gate with durable admission state. |

Later ADRs may add another focused queue class without superseding ADR-003. A
supersession is required only if the project intentionally adopts a shared
general-purpose job platform or changes these authority boundaries.

## Minimal viable adoption by class

### A. Delivery / side-effect workload

Use a transactional outbox when the business transaction must commit a durable
intent to deliver while the external side effect occurs later.

- enqueue in the relevant PostgreSQL transaction where delivery is required;
- claim/retry with explicit states and bounded backoff;
- at-least-once is acceptable only when the side effect's duplicate semantics
  are understood and explicitly accepted;
- delivery state is not business-domain truth.

ADR-011 is the current concrete example.

### B. Async long-running work

When a measured workload cannot remain request-scoped:

1. Start with PostgreSQL-backed job records and the smallest worker topology
   that fits the deployment.
2. Persist user-visible result/progress state; never leave the only result in
   worker memory.
3. Make handlers idempotent/retry-safe; do not assume exactly once.
4. Add backpressure, retry bounds, diagnostics, and operator recovery before
   scaling worker count.
5. Keep synchronous execution only where it remains semantically valid; a
   fallback is not mandatory if two execution paths would create divergent
   behavior.

### C. Exam admission / control

Do **not** model admission as a generic background job by default.

Minimum semantics include:

- a durable PostgreSQL admission record tied to the relevant exam and
  candidate/enrollment identity;
- explicit lifecycle such as waiting/eligible/admitted/terminal according to
  the accepted #292 design;
- stable idempotency/command identity for enqueue/admit/operator actions;
- deterministic ordering/batch policy from the frozen exam policy;
- atomic serialization between "admitted" and attempt creation/start so a
  candidate cannot bypass or double-consume admission;
- restart reconstruction from durable rows;
- capability/resource-scope authorization and audit for operator actions;
- queue position/readiness as a derived view, not a second source of truth;
- no ownership of `timed_sync` T0/deadline; ADR-006 remains clock authority.

Redis may later provide ephemeral coordination, wakeup, or acceleration only
under an explicit ADR-001 amendment/decision. Redis loss must not erase the
admission fact or silently admit candidates.

## When a generic job platform becomes a candidate

A shared queue framework should be considered only when evidence shows that
specialized mechanisms are creating more complexity than they remove. Examples:

- several independent Class B workloads need the same delayed scheduling,
  retry, cancellation, progress, and worker-scaling semantics;
- workers must scale independently by job class;
- PostgreSQL polling/claiming is a measured bottleneck;
- operations need one supported cross-workload job-control plane;
- duplicated worker lifecycle/retry code has become material maintenance debt.

Even then, **Class C exam-control authority does not automatically migrate into
the generic platform**. The adoption ADR must list which classes/workloads move,
what PostgreSQL authority remains, and the failure/reconciliation contract for
each one.

## Non-Goals

- Building a generic background-task framework because one outbox exists.
- Treating every UI/business list named "queue" as infrastructure.
- Replacing the deadline/heartbeat scanner merely for architectural uniformity.
- Moving objective auto-grading off the submit path without a separate measured
  or semantic reason.
- Letting Redis availability decide exam truth.
- Letting a queue define the authoritative exam clock.
- Bypassing a configured correctness-critical admission policy when its queue
  authority is unavailable.

## Operational burden

Every asynchronous mechanism introduces some subset of:

- a long-lived loop or worker lifecycle to supervise and shut down;
- retry/backoff/abandoned-work recovery;
- concurrency and backpressure limits;
- backlog/age/failure diagnostics;
- deterministic async tests and explicit teardown;
- deployment/startup/shutdown budget changes.

An in-process loop (as currently used for Email) does not require a second
container, but it still creates an independent lifecycle that must be
supervised and bounded. A dedicated worker process/container is a topology
choice, not part of the definition of a queue.

Class C admission adds stricter operational obligations: authority loss must be
visible, candidate bypass must be impossible, and recovery must preserve the
admission decision across restart.

## Failure modes

### Delivery / async work

- **Worker crash mid-job.** Re-running must be safe or duplicate effects must be
  explicitly accepted and bounded.
- **Duplicate execution.** Use stable business/job identities, idempotent
  writes, upserts, or unique constraints.
- **Poison work.** Bounded retry with dead/quarantine state and human recovery.
- **Backlog.** Observe age/depth and provide an operational response.
- **Lost result.** Persist result/reference in PostgreSQL; worker memory is not
  authority.

### Exam admission / control

- **Process restart.** Membership/order/admission facts must reconstruct from
  PostgreSQL; a process-local Map is insufficient.
- **Duplicate/concurrent admit.** Serialize and converge to one admissible
  outcome; no duplicate attempt start.
- **Authority unavailable.** Fail closed for queue-gated entry; do not fall back
  to bypassing `requireQueue`.
- **Redis loss, if later used.** Rebuild coordination from PostgreSQL; durable
  admission state is not lost.
- **Clock disagreement.** All time-sensitive decisions use ADR-006's canonical
  server time and frozen exam policy.

## Security considerations

- Background workers and queue commands obey the same organization/data
  boundaries as request paths; there is no "internal worker" authorization
  bypass.
- Correctness-critical operator commands use the accepted capability and
  resource-scope checks and produce required audit evidence.
- Export artifacts may contain candidate PII/answers; generated artifacts
  remain permission-scoped.
- Enqueued parameters are validated at their trust boundary; internal origin is
  not a substitute for validation.
- External brokers, if ever adopted, require a separate deployment/security
  decision compatible with the LAN/on-premise posture.

## Rollback principles

Rollback depends on queue class.

### Delivery / Class B async work

A focused async feature may be disabled or returned to a synchronous path only
when that fallback preserves the same business semantics. Durable in-flight
rows must be drained, migrated, or explicitly dispositioned; do not silently
orphan work.

### Exam admission / Class C

Do **not** "roll back" an admission outage by bypassing the queue for an exam
whose frozen policy requires it. Safe rollback means one of:

- prevent/withdraw activation of the queue-requiring policy before the exam;
- restore the previous durable admission implementation while preserving state;
- migrate admission state through an explicitly reviewed transition;
- fail closed until authority is restored.

PostgreSQL must retain enough authority to determine the safe outcome.

## Current disposition

- **General-purpose Job Queue:** `DEFERRED`.
- **Email delivery:** focused Class A adoption is `ACCEPTED` through ADR-011;
  PostgreSQL `email_outbox` is the durable delivery queue.
- **Large export/import/async grading:** no demonstrated Class B trigger yet.
- **Deadline/heartbeat scanners:** remain specialized reconciliation loops; no
  generic queue adoption.
- **Exam admission (`requireQueue`):** Class C durability/correctness design is
  active under the current `timed_sync` contract and #292. It must not use the
  legacy process-local Map as authority and must not be inferred from the Email
  outbox design.
- **Redis-backed queue/admission:** not adopted by ADR-001; requires an explicit
  per-responsibility decision.
