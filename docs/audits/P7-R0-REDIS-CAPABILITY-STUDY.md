# P7 Redis Capability and Adoption Study

> Status: Fact-base study (research, not an accepted ADR)
> Date: 2026-07-31
> Scope: LAN/on-premise, single-organization Exam deployment; future
> multi-instance readiness
> Planning authority: [`docs/roadmap/P7-system-readiness-and-exam-modes.md`](../roadmap/P7-system-readiness-and-exam-modes.md)
> (Workstream B / P7-D1). This document is the evidence base for the
> capability-by-capability adoption decision; it does not by itself change any
> authority.
> Related repository documents: `docs/adr/ADR-001-redis.md`,
> `docs/contracts/redis-baseline.md`, `docs/archive/phase3/audit-current-redis.md`

## 1. Executive conclusion

Redis is not limited to caching. It is a general-purpose in-memory
data-structure server with optional persistence and replication. It can
support:

- cache and materialized read models;
- shared sessions;
- global rate limiting;
- queues, delayed jobs, retries, priorities, and worker recovery;
- append-only event streams with consumer groups;
- Pub/Sub fan-out;
- shared ephemeral application state;
- presence and admission queues;
- distributed coordination, leases, locks, and leader election;
- deduplication and idempotency windows;
- counters, rankings, time-indexed scheduling, and telemetry windows.

The correct question for Exam is therefore not **"Can Redis do this?"**. It is:

> Which responsibilities should Redis own, which should PostgreSQL own, what
> durability is required, and what happens when either component is
> unavailable?

Redis can technically be configured as a durable primary store for selected
workloads. This study does **not** claim otherwise. For the current Exam
architecture, PostgreSQL remains the safer authority for irreversible exam
facts because the existing transaction, row-lock, audit, snapshot, and recovery
protocols already live there. That is a product architecture decision, not a
statement about Redis capability.

## 2. Current repository reality

The current tree has a Redis baseline but almost no production business usage:

- `apps/api/src/plugins/redis.ts` creates an optional `ioredis` client.
- Docker Compose can run Redis (gated behind the `redis` profile, P6-010).
- `REDIS_URL` and `REDIS_KEY_PREFIX` exist.
- diagnostics can `PING` Redis and report latency/connectivity
  (`GET /system/diagnostics`).
- tests support prefix-scoped Redis isolation and cleanup
  (`apps/api/src/routes/testRedis.ts`).
- rate limiting still uses the in-memory store in `@fastify/rate-limit`
  (`apps/api/src/plugins/rateLimit.ts`).
- the candidate admission queue is still process-local memory
  (`examQueues` Map in `apps/api/src/routes/attempts.candidate.ts`).
- heartbeat and deadline scanners are PostgreSQL/in-process
  (`apps/api/src/plugins/heartbeat.ts`,
  `apps/api/src/plugins/deadlineScanner.ts`).
- Email delivery uses a PostgreSQL outbox and resident worker.
- no production cache, Redis queue, Redis Stream, Pub/Sub channel, presence
  set, shared session, or distributed scanner lease is wired.
- `apps/api/src/routes/attempts/redis-fallback-guard.test.ts` makes the
  "Redis absent must not corrupt PostgreSQL candidate state" invariant
  explicit and fail-loud on regression.

Therefore the accurate status is:

> **Redis infrastructure is present; Redis business adoption is not.**

## 3. What Redis can do

| Capability | Redis mechanism | Typical behavior | Exam relevance |
| --- | --- | --- | --- |
| Cache | Strings, Hashes, JSON, TTL, cache-aside | Fast repeated reads; eviction is allowed when configured as a cache | Course/question/exam read models, permission projections, diagnostics aggregates |
| Shared sessions | Key + opaque session ID + TTL | Stateless application nodes share login/session state without sticky routing | Optional future alternative to fully stateless JWT; useful for revocation/device-session control |
| Rate limiting | Atomic counters, TTL, Lua/functions, token bucket/sliding window | Global limits shared by all API instances | Login, password reset, imports, answer-save abuse protection, API burst control |
| FIFO/LIFO queue | Lists or a queue library | Workers consume pending jobs | File processing, exports, notifications, maintenance work |
| Delayed/prioritized jobs | Sorted Sets plus queue state | Run-at timestamps, priorities, retries, backoff | Scheduled exam notifications, delayed maintenance, retryable integrations |
| Robust job runtime | BullMQ/Sidekiq-style state machine | waiting/active/completed/failed/delayed, stalled detection, retry | General background work beyond the existing Email outbox |
| Ordered event stream | Redis Streams + consumer groups | Append-only log, pending entries, replay, retention | Telemetry processing, operational event fan-out, audit-derived projections |
| Pub/Sub | Redis Pub/Sub | Low-latency fire-and-forget fan-out; no durable replay | Live dashboards, notification hints, cache invalidation, presence updates |
| Shared application state | Hashes/Sets/Strings/TTL | Cross-process transient state | online candidate presence, current operator viewing state, feature coordination |
| Admission queue | List/Sorted Set/Stream | FIFO, priority, timestamps, position queries | `requireQueue`, batch admission, wait position, restart-safe queue when persistence is enabled |
| Presence | TTL keys, Sets, Sorted Sets | last-seen and expiration windows | candidate online/disconnected hints; must not silently replace authoritative attempt state |
| Scheduling/index by time | Sorted Sets | query all members due before a timestamp | deadline discovery acceleration, delayed jobs, expiring leases |
| Deduplication/idempotency window | `SET NX EX/PX`, Sets, Hashes | suppress duplicate messages or repeated operations for a bounded period | notification dedupe, webhook/event replay guards, request collapse |
| Locks/leases/leader election | `SET NX PX`, signed release, renewal, fencing token | coordinate one owner across processes | scanner leadership, singleton maintenance, migration/worker coordination |
| Durable storage | RDB snapshots, AOF, or both | restart reconstruction and backup; durability depends on fsync, replication, failover, eviction | durable queues or streams when explicitly configured and monitored |

## 4. Lessons from mature projects

### 4.1 GitLab

GitLab documents separate Redis purposes including caching, Sidekiq job queues,
shared application state, CI trace chunks, ActionCable Pub/Sub, rate-limiting
state, and sessions. GitLab.com separates Redis instances by workload.

**Lesson for Exam:** Redis should be treated as a set of workload classes, not
one anonymous bucket. Cache keys, durable queue state, rate-limit counters, and
Pub/Sub traffic may require different eviction, persistence, memory, and
availability policies.

### 4.2 Moodle

Moodle supports Redis for application cache and shared session storage. In a
multi-node deployment, all application nodes point to shared Redis so user
session state is available regardless of which node handles the request.

**Lesson for Exam:** Redis is a practical route to multi-instance shared state.
Exam currently uses stateless JWT, so session storage is not the first need,
but device/session revocation or single-active-session policy may justify it
later.

### 4.3 Sidekiq

Sidekiq stores job and operational data in Redis. Its production guidance
recommends:

- no-eviction behavior for job data;
- persistence appropriate for the reliability target;
- separate Redis instances for cache and jobs;
- Sentinel or managed failover rather than treating a single node as fault
  tolerant;
- careful orphan/stalled job recovery and idempotent workers.

Sidekiq's reliability documentation also demonstrates that queue correctness
depends on the fetch/ack protocol, not merely "putting a JSON object in Redis."

**Lesson for Exam:** Redis can absolutely support durable jobs, but a
responsible implementation needs claim ownership, acknowledgement, retry,
stalled recovery, dedupe, observability, and worker idempotency.

### 4.4 BullMQ

BullMQ builds a full job lifecycle on Redis: waiting, prioritized, delayed,
active, completed, failed, retries with backoff, stalled-job detection,
concurrency, schedules, and crash recovery.

**Lesson for Exam:** adopting BullMQ is not equivalent to adopting a generic
cache. It creates a second job-state system that must be integrated
deliberately with PostgreSQL business transactions and current worker
semantics.

## 5. Redis durability is real, but configurable

Redis persistence choices include:

- no persistence;
- periodic RDB snapshots;
- Append Only File (AOF);
- RDB + AOF.

Redis Streams and consumer-group state can be persisted and replicated.
However, asynchronous replication and failover can still lose recent writes
under specific failure conditions. Stronger persistence, `WAIT`, topology, and
application idempotency reduce risk but do not remove the need to define an
explicit reliability contract.

A Redis instance used as a disposable cache may use eviction. A Redis instance
holding queue or stream state should normally use `noeviction`, memory alerts,
persistence, backups, and failover. Mixing these policies casually is unsafe.

### Proposed workload classes

| Workload class | Persistence | Eviction | Failure policy |
| --- | --- | --- | --- |
| `redis-ephemeral` | optional | bounded eviction permitted | feature degrades or reconstructs |
| `redis-coordination` | AOF recommended | `noeviction` | coordination pauses/fails closed; PostgreSQL remains final authority |
| `redis-jobs` | AOF + backup/failover according to RPO | `noeviction` | workers pause; jobs recover/retry; business transaction remains reconstructable |

A small deployment may begin with one Redis service and namespaces, but the
configuration model must preserve the ability to split these workloads later.

## 6. Redis use-case assessment for Exam

### 6.1 High-value first integrations

#### A. Global rate limiting

Why first:

- naturally ephemeral;
- immediately proves cross-process Redis usage;
- low coupling to exam state;
- well-understood atomic Redis patterns;
- useful for login, recovery, import, and abuse boundaries.

Required behavior:

- shared counters across two API instances in integration tests;
- explicit fail-open/fail-closed policy by route category;
- metrics and degraded-state reporting;
- bounded Redis timeout so an unavailable Redis does not hang requests.

#### B. Redis runtime hardening

Before Redis owns a business responsibility:

- explicit `off | optional | required` mode;
- connection lifecycle state;
- handled `error`, `close`, `reconnecting`, and `ready` events;
- bounded retry/backoff;
- readiness and diagnostics semantics;
- `redis.unavailable` and `redis.recovered` events;
- ACL/TLS/password handling;
- memory, persistence, eviction, and backup validation.

#### C. Admission queue

Redis is a strong fit for the deferred `requireQueue` feature:

- FIFO or priority ordering;
- queue position;
- TTL/abandonment;
- cross-process shared ownership;
- restart persistence when configured;
- atomic claim/admit operations via Lua/functions.

Before implementation, freeze the admission state machine and answer:

- whether an enrollment or attempt is created before admission;
- duplicate join semantics;
- reconnect semantics;
- cancellation and exam-close cleanup;
- fairness and priority;
- operator override;
- authoritative audit trail.

#### D. Presence and live operational updates

Redis TTL/Sorted Set state can provide fast online/disconnected hints and
Pub/Sub can push dashboard refresh events. PostgreSQL can continue storing
durable interruption evidence and attempt transitions.

This is a useful two-layer design:

```text
Redis = fast presence signal / fan-out
PostgreSQL = durable interruption fact and exam-state transition
```

### 6.2 Medium-value candidates

- Redis Streams for telemetry/event processing and temporary replay.
- Cache-aside for high-frequency read models after profiling proves a database
  bottleneck.
- distributed scanner lease to reduce duplicate discovery work in
  multi-instance mode.
- session/device registry for single-active-session, revocation, or device
  binding.
- dedupe windows for notification and integration events.

### 6.3 Do not adopt without a separate decision

These are technically possible in Redis, but should not be moved casually:

- authoritative answer content;
- authoritative attempt status;
- authoritative score or grading ledger;
- sole copy of audit records;
- sole copy of system configuration;
- a Redis lock as the only protection for an irreversible exam transition.

The restriction is architectural, not technical. Moving any of these requires a
new ADR covering persistence, failover, backup, reconciliation, migration, and
split-brain behavior.

## 7. Locks and coordination

Redis supports distributed locks, but the official guidance itself emphasizes
safety/liveness assumptions, TTL expiry, replication races, clock behavior,
renewal, and fencing tokens.

For Exam:

- a Redis lease may select which scanner performs discovery;
- the database command must still re-check authority under transaction/lock
  before an irreversible transition;
- use a fencing token or PostgreSQL version when stale owners could still
  write;
- do not use a bare `SETNX` flag with no token, TTL, or signed release;
- never assume process liveness implies lease ownership.

## 8. Relationship with the existing PostgreSQL outbox

The current Email worker already has a robust PostgreSQL outbox state machine.
Redis/BullMQ should not replace it merely to "use Redis." Options are:

1. **Keep Email fully PostgreSQL-backed.** Simple and currently proven.
2. **Use Redis only as a wake-up signal.** PostgreSQL remains the durable
   queue; Redis reduces polling latency.
3. **Use PostgreSQL outbox → Redis queue relay.** Business transaction inserts
   an outbox row; a relay publishes a Redis/BullMQ job; workers are idempotent
   and reconcile against PostgreSQL.
4. **Move queue truth to Redis.** Only after a separate durability and
   migration decision; not the default recommendation.

## 9. Proposed implementation sequence

```text
P7-R0  Current-state and authority audit
  → P7-D1  Redis capability + adoption ADR update
  → P7-D2  Redis runtime lifecycle hardening
  → P7-D3  Shared global rate limit
  → P7-Q1  Admission queue design + state machine
  → P7-Q2  Redis-backed admission queue
  → P7-P1  Presence / real-time operational projection
  → P7-D4  Evaluate Streams, cache, and generic job runtime from measured need
```

### P7-D1 acceptance

- ADR-001 is updated from "baseline/deferred" to a capability-by-capability
  adoption plan.
- Every Redis-backed feature has a declared data class, durability, eviction,
  failure, and fallback policy.
- cache and durable job workloads are not silently mixed.
- no categorical claim says Redis is incapable of durable or authoritative use.

### P7-D2 acceptance

- Redis lifecycle cannot crash the process through an unhandled client event.
- diagnostics distinguish disabled, connecting, ready, degraded, and
  unavailable.
- optional mode degrades intentionally; required mode fails readiness/startup
  intentionally.
- recovery is logged once with useful metrics, without log storms.

### P7-D3 acceptance

- two API instances share one limit in an integration test;
- high-risk routes document fail-closed behavior;
- low-risk routes document bounded fallback behavior;
- the Admin diagnostics page shows the active store and degraded state.

## 10. External primary references

- Redis data types: <https://redis.io/docs/latest/develop/data-types/>
- Redis persistence: <https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/>
- Redis Streams: <https://redis.io/docs/latest/develop/data-types/streams/>
- Redis rate limiter: <https://redis.io/docs/latest/develop/use-cases/rate-limiter/>
- Redis job queue: <https://redis.io/docs/latest/develop/use-cases/job-queue/>
- Redis session store: <https://redis.io/docs/latest/develop/use-cases/session-store/>
- Redis distributed locks: <https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/>
- GitLab Redis development guidelines: <https://docs.gitlab.com/development/redis/>
- Moodle Redis cache store: <https://docs.moodle.org/en/Redis_cache_store>
- Sidekiq using Redis: <https://github.com/sidekiq/sidekiq/wiki/Using-Redis>
- Sidekiq reliability: <https://github.com/sidekiq/sidekiq/wiki/Reliability>
- BullMQ architecture: <https://docs.bullmq.io/guide/architecture>
- BullMQ retry and stalled recovery: <https://docs.bullmq.io/guide/retrying-failing-jobs>, <https://docs.bullmq.io/guide/jobs/stalled>
