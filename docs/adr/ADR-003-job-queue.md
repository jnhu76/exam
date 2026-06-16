# ADR-003 — Job Queue for Async / Long-Running Workloads

## Status

Deferred

## Context

Every Phase 1 and Phase 2 operation today completes within the synchronous request lifecycle:

- **Answer save / submit** — idempotent HTTP writes to PostgreSQL; fast and bounded.
- **Auto-grading (objective)** — runs inline in the submit request; objective grading is fast and synchronous.
- **CSV import** (candidate / question) — synchronous within the request; summaries are returned directly.
- **CSV / score export** — synchronous generation; fine for current dataset sizes (P2E-J3 hardens this and explicitly forbids introducing a job queue).
- **Deadline auto-submit scanner** (P2A-J2) — a DB-backed, single-owner scanner, not a generic worker pool.
- **Manual grading** (P2D-J2..J4) — admin-driven, request-scoped writes; no background batch.

There is no async workload, no background worker, and no message broker in the runtime today.

Discovery (`06-phase2-gap-analysis.md` §Redis / MQ / Job Queue Assessment) explicitly concluded: **Job Queue is not needed for Phase 2** — all operations complete within the request lifecycle; if PDF export or email is added, reconsider. The Phase 2 plan (§8) reinforces this: a job queue is only revisited when export/import/email/auto-submit becomes too slow for the request lifecycle.

This ADR records the pain points a job queue would solve, the conditions that would trigger adoption, and the minimal viable path.

## Decision

**Do not introduce a Job Queue until a real long-running async workload appears.**

Phase 2 keeps all operations synchronous and request-scoped. No background worker, broker, or queue table is added. A job queue may be re-evaluated **only** when a documented Trigger for Adoption is met, through a follow-up decision recorded against this ADR. The deadline scanner (P2A-J2) is explicitly **not** a job queue — it is a single-owner DB-backed loop, intentionally simpler.

## Triggers for Adoption

A job queue becomes a candidate **only** when at least one of the following is concretely demonstrated:

| Trigger | Why a queue | Discovery ref |
| ------- | ----------- | ------------- |
| Large CSV / PDF export that cannot finish in a request timeout | Synchronous generation blocks the request and risks proxy/server timeouts; user needs progress and a downloadable artifact. | 06 §Redis / MQ |
| Large import processing that exceeds request lifecycle | Importing thousands of candidates/questions becomes too slow to hold an HTTP connection. | 06 §Redis / MQ |
| Email notification | SMTP send is slow, flaky, and must not block the request or fail the operation if delivery is delayed. | 06 §Redis / MQ |
| Async / slow manual grading batch | Grading workflows that aggregate or recompute across many attempts and cannot stay request-scoped. | 06 P1-6 |
| Scanner work that outgrows a single in-process loop | Deadline/disrupted scanning needs to scale beyond one owner or needs retry/backoff across a backlog. | 06 P1-10 |

Each trigger must be evidenced by a measured limit (e.g. export of N rows exceeds the request timeout), not a forecast. "Exports might grow" is not a trigger.

## Non-Goals

- A generic background task framework. The queue, if adopted, targets one real workload first.
- A replacement for the deadline scanner's single-owner design. The scanner is correct as-is for single-instance.
- A reason to move auto-grading off the submit path. Objective auto-grading is fast and synchronous by design; it stays inline.
- A Phase 2 dependency. All Phase 2 work stays synchronous.

## Minimal Viable Adoption

If a trigger is met, the smallest responsible adoption is:

1. **Pick the lightest durable option that fits.** Order of preference, decided per trigger:
   1. **PostgreSQL-backed job table + single in-process worker** — no new dependency; reuses the existing DB and transaction model; sufficient for single-instance LAN. This is the default first choice.
   2. **A dedicated queue library backed by PostgreSQL** (e.g. a pg-listen / `SELECT ... FOR UPDATE SKIP LOCKED` worker) — still no new service, better worker semantics.
   3. **Redis-backed queue** — only if ADR-001 triggers have also been met (multi-instance, shared coordination). Do not introduce Redis solely for a queue.
   4. **External broker (RabbitMQ, etc.)** — out of scope for LAN/on-premise unless a future ADR justifies it; default reject.
2. **One workload at a time.** Ship exactly the triggering workload (e.g. large PDF export). Do not retrofit synchronous operations onto the queue opportunistically.
3. **PostgreSQL stays source of truth.** The queue carries work items; all business state (attempts, answers, grades, exports, audit) lives in PostgreSQL. A lost queue item must be recoverable or safely retryable from DB state.
4. **Idempotent workers.** Every job must be safe to retry (see Failure Modes). No "exactly once" assumptions.
5. **Observability from day one.** Job status, age, failure count, and last error must be visible (extends the diagnostics page P2E-J6 and import/export job logs P2E-J5).
6. **Config-gated.** The queued path is enabled by an explicit flag; the synchronous path remains available where feasible so the feature degrades.

## Operational Burden

- **A worker process to run, monitor, and restart.** Today there is only the API process; a worker adds a second lifecycle to manage.
- **Failure handling** — retries, backoff, dead-letter/quarantine, and poison-message recovery must be designed, not improvised.
- **Backpressure / concurrency limits** — a runaway worker can overload PostgreSQL or exhaust memory; needs caps.
- **Operational visibility** — operators must be able to see queued / running / failed jobs and replay or cancel them.
- **Test complexity** — async jobs are harder to test deterministically than synchronous handlers; CI must stub or fast-forward the worker.
- **Deployment changes** — Docker Compose / bare-metal runbooks gain a worker service (or a second entrypoint mode).

## Failure Modes

- **Worker crash mid-job.** The job must be idempotent: re-running it produces the same result (same export rows, same import rows, same grade). Use stable job keys / business identifiers for dedup, not queue-assigned IDs.
- **Duplicate execution.** Workers may run a job twice after a crash or under overlapping ownership. Every job handler must be safe under double execution (idempotent writes, upserts, or unique constraints).
- **Poison message / infinite retry.** Bounded retry with a dead-letter/quarantine state. A job that fails N times is parked for human action, never retried forever.
- **Queue backlog / slow drain.** Must be observable and actionable (increase workers, shed load, alert). The synchronous path, if kept, provides a fallback.
- **Job results lost.** Results are written to PostgreSQL (e.g. export artifact stored or referenced in DB), never held only in worker memory.

## Security Considerations

- Workers run with the same data-boundary rules as the API — every job carries its `organizationId` / `ctx`; no bypassing the repository pattern.
- Export artifacts may contain candidate PII / answers; access to generated artifacts must be permission-checked and scoped.
- Job parameters are validated (Zod) before enqueue, same as HTTP request bodies — no trusting internal-only input.
- No external broker leaves the LAN; the platform stays LAN/on-premise and offline-capable.

## Rollback Plan

1. Disable the feature flag that enqueues the async path. The workload reverts to the synchronous implementation (which is kept as the default/fallback where feasible).
2. Drain or discard in-flight jobs. Because handlers are idempotent, re-running or discarding is safe; PostgreSQL holds all canonical state.
3. Remove the worker process and the job table/queue from the deployment.
4. Update this ADR to record why adoption was rolled back.

Rollback is safe because the design rule (queue = transport only, idempotent handlers, PostgreSQL = truth) guarantees the synchronous path can stand alone.

## Phase 2 Decision

**Do not introduce a Job Queue until a real long-running async workload appears.**

- All Phase 2 operations (answer save, submit, auto-grading, import, CSV export, manual grading, deadline scanner) stay synchronous and request-scoped.
- P2E-J3 (CSV hardening) and the deadline scanner (P2A-J2) explicitly do **not** introduce a job queue.
- Any future adoption requires (a) a documented, measured trigger from the table above, (b) a minimal PostgreSQL-backed-first rollout, (c) idempotent handlers, and (d) an update to this ADR.
- Redis-backed queuing is only considered if ADR-001 has also been triggered.
