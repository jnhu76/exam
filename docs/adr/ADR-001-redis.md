# ADR-001 — Redis as Optional Infrastructure

## Status

Redis Baseline: **Accepted** (Phase 2 收口)
Full Redis adoption: **Deferred** (per trigger conditions below)

## Context

The exam platform is a LAN / on-premise, single-tenant deployment. Phase 1 and Phase 2 target a **single-instance** application process backed by PostgreSQL as the source of truth. The current runtime already handles the work that Redis is most commonly introduced to solve:

- **Admission queue** (`examQueues` Map in `apps/api/src/routes/attempts.ts`) — held in process memory. Acceptable while a single process owns the exam session.
- **Heartbeat scanner** (`setInterval` timer) — a single process-level timer that detects disconnected candidates and auto-submits expired attempts. Phase 2 (P2A-J2, P2C-J1) stabilizes this scanner into a DB-backed, idempotent, single-owner job.
- **Rate limiting** — in-memory limiter on the login route (`10/min`) and exam routes. Acceptable for a single-instance LAN deployment.
- **Session/JWT** — stateless HTTP-only cookie + JWT. No server-side session store is required, so Redis is not needed for session affinity.

Discovery (`docs/phase2/discovery/06-phase2-gap-analysis.md` §Redis / MQ / Job Queue Assessment) explicitly concluded: **Redis is not needed for Phase 2** as long as the deployment stays single-instance. This ADR records the pain points Redis would solve, the conditions that would trigger adoption, and the minimal viable path — so that a future team does not reach for Redis (or reject it) without the same reasoning.

Phase 2 hard rule (`docs/phase2/phase2.plan.md` §10): do not start Redis before Phase 2A Candidate Runtime P0 correctness is complete.

## Decision

**Do not introduce Redis in Phase 2 single-instance LAN deployment.**

PostgreSQL remains the sole source of truth and the only required data store. The admission queue, heartbeat scanner, and rate limiter remain in-process, backed by DB rows where durability across restart is required (the heartbeat scanner tracks its work via `exam_attempts.lastActivityAt` / `deadlineAt`, not via a Redis queue).

Redis may be re-evaluated **only** when one of the documented Triggers for Adoption is met, and only through a follow-up decision recorded against this ADR. No Phase 2 job may add a Redis runtime dependency.

## Triggers for Adoption

Redis becomes a candidate **only** when at least one of the following is concretely true (not speculative):

| Trigger | Why Redis | Discovery ref |
| ------- | --------- | ------------- |
| Multi-instance app deployment | Queue, rate limit, and presence state must be shared across processes; a per-process Map or timer no longer works. | 06 §Redis / MQ |
| Shared rate limit required across instances | Login/answer-save throttling must be global, not per-process. | 06 §Redis / MQ |
| Distributed presence / 1000+ concurrent candidates per exam | Heartbeat + presence state must be coordinated across instances; a single scanner is no longer sufficient. | 06 P1-10, §Redis |
| Cross-process scanner coordination required | Multiple app instances need a single owner for the deadline auto-submit scanner to avoid duplicate submits. | 06 P1-10 |
| Persistent admission queue required | `requireQueue` needs to survive restart and be shared across instances; DB-backed queue is the alternative. | 06 P1-9 |

Each trigger must be evidenced by a measured limit, not a forecast. "We might go multi-instance one day" is not a trigger.

## Non-Goals

- Redis as a session store. JWT + HTTP-only cookie is stateless and needs no server-side store.
- Redis as the answer-save truth source. Answers are persisted via the Answer Save Protocol to PostgreSQL (`QuestionSnapshot` + versioned answer writes). Redis must never become the source of truth for attempt state.
- Redis as a cache in front of PostgreSQL for read-heavy admin queries. Phase 2 load does not justify it.
- Redis as a Phase 2 dependency. It is optional and future.

## Minimal Viable Adoption

If a trigger is met, the smallest responsible adoption is:

1. **One concern at a time.** Introduce Redis for exactly the triggering concern (e.g. shared rate limit) and nothing else. Do not bundle in session, cache, or pub/sub opportunistically.
2. **PostgreSQL stays source of truth.** Redis holds only ephemeral coordination state (queue ownership, rate-limit counters, presence). Any state that must survive Redis loss is still in PostgreSQL.
3. **Add as an optional runtime.** Redis is enabled by an explicit config flag and defaults to **off**. Single-instance deployments must keep working without Redis.
4. **Health and degradation.** The `/health` and diagnostics page (P2E-J6) must report Redis connectivity, and documented degradation behavior must exist (see Failure Modes).
5. **Operations runbook.** Before enabling, document: deployment, restart behavior, persistence/RDB policy, and the rollback path.

## Operational Burden

Introducing Redis adds the following that the current deployment does not have:

- **A second stateful process** to deploy, monitor, restart, and back up. Today the only stateful dependency is PostgreSQL.
- **Persistence policy decisions** (RDB / AOF / none) — none is safe-by-default for exam-critical coordination state.
- **Resource planning** — memory sizing, maxmemory eviction policy, connection limits.
- **Security surface** — Redis must be bound to the LAN, require auth, and never be exposed to the public network. This is a new credential to rotate.
- **Observability gaps** — a new component that produces no pino logs by default; metrics and alerting must be added.
- **Deployment complexity** — Docker Compose gains a service; bare-metal runbooks gain a process.
- **Test environment parity** — CI and local dev must run Redis (or stub it) for any code path that uses it.

## Failure Modes

- **Redis unreachable at runtime.** Documented degradation: features that require shared coordination (multi-instance queue, global rate limit) must fail closed or fall back to the in-process implementation — never to silent corruption. Single-instance deployments with Redis off are unaffected.
- **Redis data loss (restart / eviction).** Coordination state must be reconstructable from PostgreSQL. The answer-save truth, attempt state, and grading results must never depend on Redis surviving.
- **Split-brain / network partition.** If used for scanner ownership, a partition must not cause two instances to both believe they own the deadline scanner. Prefer short-lived advisory locks with bounded TTL and renewal, not naive flags.
- **Misconfiguration (bound to public interface, no auth).** Treated as a security incident. Must be blocked by deployment validation, not just runbook text.

## Security Considerations

- Redis must run **inside the LAN** only, never exposed to the public internet. The platform is LAN/on-premise and offline-capable; Redis must not change that.
- Redis `requirepass` (or ACL) is mandatory; no open Redis instance.
- No PII or answer content should be stored in Redis. It holds only coordination metadata.
- Redis traffic should stay on the internal network; TLS is optional for LAN but mandatory if any hop leaves the trusted network.

## Rollback Plan

Because adoption is per-concern and Redis is never the source of truth:

1. Disable the feature flag that enables the Redis-backed code path. The system reverts to the in-process implementation (queue Map, in-memory rate limiter, single-instance scanner).
2. Confirm PostgreSQL still owns all attempt, answer, grading, and audit state — no reconciliation needed.
3. Remove the Redis service from the deployment and the dependency from configuration.
4. This ADR is updated to record why adoption was rolled back; a new decision is required before re-enabling.

Rollback is safe because the design rule (Redis = ephemeral coordination only) guarantees PostgreSQL can stand alone.

## Phase 2 Decision

**Redis baseline has been introduced in Phase 2 收口.** Redis is available as an optional runtime dependency. Full adoption (shared rate limit, presence, queue) requires trigger conditions to be met.

- Phase 2 remains single-instance. PostgreSQL is the source of truth.
- Redis is optional: deployments without Redis continue to work unchanged.
- The admission queue, heartbeat scanner, and rate limiter stay in-process / DB-backed.
- Any future Redis adoption beyond baseline requires (a) a documented, measured trigger from the table above, (b) a minimal per-concern rollout, and (c) an update to this ADR.

## Redis Baseline (Phase 2 收口)

The Redis baseline provides infrastructure for future ADR-007 isolation audit and optional Redis-backed features.

### What's included

- **Docker Compose**: Redis 7 service in production, dev, and test compose files.
- **Runtime config**: `REDIS_URL` (optional, defaults to disabled), `REDIS_KEY_PREFIX` for namespace separation.
- **Fastify plugin**: `apps/api/src/plugins/redis.ts` — connects, decorates `fastify.redis`, graceful close via `onClose` hook.
- **Healthcheck**: `GET /system/diagnostics` reports Redis connectivity and latency.
- **Test isolation helper**: `apps/api/src/routes/testRedis.ts` — prefix-scoped Redis for test isolation.
- **ADR-007 alignment**: Test scope resolver's `redisPrefix` is now functional.

### What's NOT included

- No Redis-backed rate limiting (stays in-memory).
- No Redis-backed heartbeat/presence (stays in-process).
- No queue/BullMQ integration.
- No Redis lock replacing PostgreSQL `FOR UPDATE`.
- No changes to exam/attempt/enrollment canonical state.

### Environment variables

```
REDIS_URL=redis://localhost:6379     # optional, leave unset to disable
REDIS_KEY_PREFIX=""                  # optional, for namespace separation
```

### Next steps

This baseline unlocks ADR-007 isolation audit:
- PostgreSQL schema/data isolation
- Redis key prefix isolation
- Queue job isolation
- Background worker isolation
- Seed/default org/user isolation
- Rate limit/presence state isolation
