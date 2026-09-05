# ADR-001 — Redis as Optional Infrastructure

## Status

- Redis optional-infrastructure baseline: **ACCEPTED**.
- Shared/global rate limiting on Redis: **ACCEPTED** (bounded post-MVP adoption,
  2026-08-08).
- Any broader Redis responsibility: **DEFERRED pending its own trigger and
  explicit decision**.

## Current binding decision

Redis is an **optional coordination substrate**, not the durable fact authority
for the exam system.

The currently adopted Redis business responsibility is exactly:

> **shared/global rate limiting**

The following rules are binding:

1. **PostgreSQL remains durable exam-fact authority.** Answers, attempts,
   grading, results, incidents, audit, receipts, queue/admission facts, and
   other durable business state do not move to Redis under this ADR.
2. **Redis adoption is per responsibility.** The presence of a Redis service or
   client does not authorize opportunistic use for queueing, presence, scanner
   ownership, sessions, cache, Pub/Sub, Streams, or admission.
3. **Runtime mode is explicit:** `off | optional | required`.
   - `off`: no Redis client; local limiter is used.
   - `optional`: shared limiter is used while Redis is healthy; loss degrades
     to the process-local limiter.
   - `required`: Redis-backed shared limiting is required; unavailable Redis
     fails the guarded operation closed with the documented service error.
4. **Rate-limit state is ephemeral.** Counters have bounded TTLs and Redis loss
   may reset a window; no durable exam fact depends on those counters surviving.
5. **Redis keys must not expose raw client IPs.** The adopted limiter uses an
   opaque/HMAC-derived identity.
6. **An enabled bundled Redis deployment is authenticated.** The production
   Compose profile requires a password and starts Redis with authentication.
7. **Future Redis responsibilities require a fresh, scoped decision.** A
   measured scale problem or correctness/product requirement may trigger a
   review, but the trigger itself is not authorization to adopt Redis.

The detailed runtime contract for the adopted responsibility lives in
`docs/contracts/redis-baseline.md`.

## Why this decision exists

The original exam deployment was single-instance and PostgreSQL-backed. Redis
was intentionally not introduced as a default dependency because the runtime
could satisfy its then-current requirements without another stateful service.
That baseline avoided unnecessary operational and correctness surface.

Later, the project deliberately adopted Redis for one bounded post-MVP concern:
shared/global rate limiting. This validated optional shared coordination without
turning Redis into a general application-state platform.

The architectural lesson is therefore not "no Redis" and not "Redis is now the
shared backend". It is:

> **Adopt Redis one responsibility at a time, and keep durable authority
> explicit.**

## Adopted shared rate limiting

The accepted implementation has these semantics:

- atomic fixed-window counters in Redis while the runtime is ready;
- mandatory TTL on every counter;
- `optional` degradation to the local limiter;
- `required` fail-closed behavior when shared limiting is unavailable;
- `off` mode with no Redis client;
- namespace under the configured Redis key prefix;
- opaque/HMAC client-IP identity rather than raw IP address in keys;
- multiple API instances sharing one Redis share one effective limit.

This is coordination state only. PostgreSQL data is unaffected by Redis restart
or loss.

## Responsibility / trigger register

A trigger means **review this responsibility**. It does not automatically adopt
Redis.

| Responsibility / trigger | Current disposition |
| --- | --- |
| Shared/global rate limiting across instances | **ADOPTED** — bounded Redis responsibility |
| Multi-instance admission / `requireQueue` | **NOT ADOPTED** — correctness-critical admission is governed by ADR-003 and its own domain decision |
| Presence / heartbeat coordination | **DEFERRED** — no Redis authority granted |
| Deadline/scanner ownership | **DEFERRED** — no Redis lock/lease authority granted |
| Session store | **NOT NEEDED / NOT ADOPTED** — current auth does not require Redis session authority |
| Generic cache | **DEFERRED** — no measured need and no authority granted |
| Pub/Sub / Streams / generic messaging | **DEFERRED** — transport choice does not follow from Redis availability |

A future adoption must document:

- the concrete problem/trigger;
- why Redis is preferable to PostgreSQL or another mechanism for that specific
  responsibility;
- exact authority and durability boundaries;
- degradation/failure semantics;
- test isolation and worker/lifecycle behavior where applicable;
- rollback/migration behavior.

## Relationship to other ADRs

- **ADR-003 — Queue / async workload policy:** Redis availability does not move
  queue, worker, or exam-admission authority into Redis. ADR-003 classifies the
  workload first; any Redis use then requires a responsibility-specific
  decision under this ADR.
- **ADR-007 — Stateful infrastructure test isolation:** Redis-backed features
  must use the accepted test-scope namespace/lifecycle model. This relationship
  does not imply that every ADR-007 phase is already complete.
- **ADR-002 — Real-time transport:** SSE/WebSocket adoption is independent of
  Redis adoption. A future push transport does not gain business authority from
  a Redis Pub/Sub implementation choice.

## Operational constraints

Redis adds a second stateful process and therefore adds deployment, monitoring,
security, configuration, resource, and test-isolation burden.

For every enabled Redis responsibility:

- startup/command waits must be bounded;
- health/diagnostics must report meaningful connectivity/degradation state;
- key namespaces and retention/TTL behavior must be explicit;
- no silent corruption or silent authority migration is allowed on outage;
- credentials must be required for the bundled production deployment;
- Redis must remain on the trusted internal network unless a separately
  reviewed secure deployment says otherwise.

## Failure principles

- **Redis unavailable:** follow the explicitly accepted mode-specific behavior.
  For the current limiter, `optional` may degrade locally and `required` fails
  closed.
- **Redis data loss/restart:** ephemeral coordination may reset; durable exam
  facts must remain reconstructable/unchanged in PostgreSQL.
- **Network partition:** never invent a stronger coordination guarantee than the
  mechanism actually provides. Any future ownership/lease responsibility must
  define fencing/expiry semantics before adoption.
- **Misconfiguration:** unauthenticated/public Redis is a deployment/security
  failure, not an accepted degraded mode.

## Security constraints

- No answer content or other unnecessary sensitive exam payload belongs in
  Redis under the current decision.
- Redis is internal infrastructure, not a public endpoint.
- Enabled bundled production Redis requires authentication.
- Client identity in rate-limit keys is opaque; raw IPs are not stored in the
  keyspace by the adopted limiter.

## Rollback

Rollback is **responsibility-specific**, not "delete Redis and hope".

For the currently adopted shared limiter:

- a deployment may switch to `off` where process-local limiting is an accepted
  deployment behavior;
- `optional` already has an explicit local degradation path;
- a deployment intentionally configured `required` must not silently pretend
  shared limiting still exists when Redis is unavailable.

Because Redis does not own durable exam facts, disabling the current limiter's
Redis path requires no exam-data reconciliation.

## Historical context — Phase 2 acceptance-time baseline

> **NON-NORMATIVE CURRENT REALITY.** The text below explains why Redis was
> initially deferred. Where it says rate limiting remained process-local or
> shared limiting was only future, that statement was superseded by the accepted
> 2026-08-08 bounded shared-rate-limit adoption above.

At the original Phase 2 decision point:

- the application targeted a single process;
- the admission queue was process-local;
- heartbeat/deadline work used specialized DB-backed/in-process reconciliation;
- rate limiting was process-local;
- JWT/cookie authentication did not need a server-side session store;
- PostgreSQL was the only required stateful dependency.

The original trigger list included multi-instance deployment, shared rate
limiting, distributed presence, scanner coordination, and persistent admission.
Only **shared rate limiting** has since been explicitly adopted on Redis. The
other items remain separately deferred and must not be treated as implicitly
accepted because the Redis baseline now exists.

## Current disposition

```text
Redis optional baseline                 ACCEPTED
Redis shared/global rate limiting       ACCEPTED
PostgreSQL durable exam authority       KEEP
Redis queue/admission authority         NOT ADOPTED
Redis presence/scanner/session/cache    NOT ADOPTED
Broader Redis adoption                  DEFERRED PER RESPONSIBILITY
```
