# Redis Baseline

## Purpose

This document records the Redis baseline infrastructure introduced in Phase 2 收口 and extended by the post-MVP P7 job (runtime lifecycle hardening + shared rate limiting). The baseline provides the foundation for ADR-007 isolation audit and future optional Redis-backed features.

## Architecture

### Plugin lifecycle

```
server.ts
  └─ dbPlugin (required)
  └─ redisPlugin (optional, P7 lifecycle)
      ├─ mode=off        → no client, decorate null, state disabled
      ├─ mode=optional   → bounded connect; degrade to local on loss; never crash
      └─ mode=required   → bounded connect; startup fails fast if not ready
  └─ rateLimitPlugin (P7 store selection)
      ├─ runtime ready   → shared Redis store (atomic Lua counters)
      ├─ optional+loss   → local in-memory store
      ├─ off             → local in-memory store
      └─ required+loss   → fail closed (503 RATE_LIMIT_UNAVAILABLE)
```

### Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | No | `null` (disabled) | Redis connection URL |
| `REDIS_KEY_PREFIX` | No | `""` | Key prefix for namespace separation |
| `REDIS_MODE` | No | `optional` (URL set) / `off` | `off` \| `optional` \| `required` (P7) |
| `REDIS_CONNECT_TIMEOUT_MS` | No | `2000` | Bounded TCP connect timeout (P7) |
| `REDIS_COMMAND_TIMEOUT_MS` | No | `1000` | Bounded per-command timeout (P7) |
| `REDIS_STARTUP_TIMEOUT_MS` | No | `8000` | Bounded startup window (P7) |

`REDIS_MODE=optional|required` without `REDIS_URL` fails fast at startup
(configuration error). `REDIS_MODE=off` with a URL set is the explicit
rollback lever: the client is never created.

### P7 runtime lifecycle

The Redis runtime models its state explicitly (never a fake boolean):

```
disabled → connecting → ready ⇄ degraded → closing
```

`degraded` carries a reason: `startup_timeout` | `connection_lost` |
`command_failure` | `retry_exhausted`.

- Bounded behavior: connect timeout 2s, per-command timeout 1s, retry
  backoff 200ms → 2s (bounded delay, deliberate infinite attempts for
  auto-recovery), `enableOfflineQueue: false` (commands fail fast, never
  buffer), `maxRetriesPerRequest: 2`.
- Client events (`error`, `close`, `reconnecting`, `ready`, `end`) are all
  handled; an emitted `error` can never crash the process. Transitions are
  logged once via structured logs (`redis.ready`, `redis.recovered`,
  `redis.unavailable`, `redis.closing`) — no log storms on every retry.
- **Truthful degradation (P7 review P1-3)**: ANY Redis command failure
  degrades the logical runtime to `degraded` (reason `command_failure`),
  REGARDLESS of `client.status`. ioredis `commandTimeout` rejects the
  command without closing the connection, so a transport-`ready` client can
  be operationally broken (overload, half-open socket, hung server);
  transport ready ≠ operational health. Degraded state makes store selection
  consistent instead of hitting broken Redis per request.
- **Probe-based recovery (P7 review P1-3)**: while degraded, a bounded
  background PING probe (default 1s interval) restores `ready` only after
  the probe succeeds on a transport-ready connection. `pingLatency()` (the
  diagnostics probe) doubles as an explicit probe. A random business command
  succeeding NEVER silently flips the state back.
- Shutdown is bounded: `quit()` races a 2s grace, then `disconnect()` — safe
  from every state (disconnected / connecting / ready / reconnecting / end).
- `required` mode at runtime: Redis loss fails closed (503
  `RATE_LIMIT_UNAVAILABLE`), never a silent switch to local counters.

### P7 shared rate limiting

- Store selection lives in one seam (`DelegatingRateLimitStore`); routes do
  not know Redis exists. The HTTP contract is unchanged: over-limit requests
  still return the structured `RATE_LIMITED` error.
- Redis path: one atomic Lua script per request (`INCR` + `PEXPIRE`/`PTTL`
  fixed window) — no read-modify-write race across processes.
- **TTL is mandatory**: every counter key expires after the time window;
  nothing accumulates forever.
- Keyspace: `<REDIS_KEY_PREFIX>ratelimit:v1:<ip-digest>[<METHOD><path>-]`.
  The ioredis `keyPrefix` carries `REDIS_KEY_PREFIX` (never double-prefixed);
  `ratelimit:v1:` is the workload namespace.
- Raw IPs never enter the keyspace: the key is an HMAC-SHA256 digest of the
  IP with the deployment `JWT_SECRET`, domain-separated context
  `exam-ratelimit-ip-v1` (stable across instances sharing the secret).
- Rate-limit counters are ephemeral by design; a Redis restart may reset
  windows. PostgreSQL state is unaffected.

### Degradation contract truth (P7 review P2)

While Redis is `ready`, the shared limiter guarantees the **strict global
window** across instances. In `optional` mode with a degraded Redis, the
degradation is **availability-oriented**: each process falls back to its own
local best-effort counter, which does NOT guarantee a strict global N — a
fresh local allowance per process can briefly over-admit during the outage
window. Deployments that need strict shared limits under Redis loss must
use `REDIS_MODE=required` (fail closed, 503 `RATE_LIMIT_UNAVAILABLE`) —
never a silent local fallback.

### Diagnostics

`GET /system/diagnostics` reports `redisStatus`:

```
mode: off | optional | required
state: disabled | connecting | ready | degraded | closing
connected: state === "ready"   (backward-compatible boolean)
latencyMs: ping latency when ready, else null
degradedReason: startup_timeout | connection_lost | command_failure | retry_exhausted | null
```

Never exposed: passwords, credential-bearing URLs, key contents.

### Test isolation (ADR-007)

The test scope resolver (`packages/db/src/testScope.ts`) derives Redis prefixes:

| Scope | Redis Prefix |
|-------|-------------|
| Local worker 1 | `exam:test:local:w1:` |
| Local worker 2 | `exam:test:local:w2:` |
| CI shard 1 worker 1 | `exam:test:s1:w1:` |
| Background | `exam:test:background:` |
| E2E | `exam:test:e2e:` |

### Cleanup invariant

```typescript
// CORRECT: prefix-scoped cleanup
async resetByPrefix() {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
    cursor = nextCursor;
    if (keys.length > 0) await client.del(...keys);
  } while (cursor !== "0");
}

// WRONG: FLUSHALL/FLUSHDB affects all scopes
await client.flushdb(); // NEVER do this
```

**Key insight**: `keyPrefix` in ioredis does NOT filter `KEYS *`. Use `SCAN MATCH ${prefix}*` for prefix-scoped operations.

## Baseline test behavior

`apps/api/src/routes/redis.test.ts` documents the plugin contract. Because Redis
is **optional** (ADR-001), the suite must never fail an environment that has no
Redis. Behavior:

| Environment | Connection tests | Offline/null tests |
|---|---|---|
| `REDIS_URL` set + reachable | 5 run, PASS | 2 run, PASS |
| `REDIS_URL` unset / empty | 5 SKIP (`Redis not available`) | 2 run, PASS |
| `REDIS_URL` set but unreachable | 5 SKIP (after a 500ms probe) | 2 run, PASS |

Reachability is decided once in a top-level `beforeAll` via a short-timeout
(500ms, no-retry) ioredis probe — this avoids the previous 10s connection-retry
storm when Redis was configured but not actually reachable. Individual `it`
cases re-check the flag and call the test-context `skip()`. `beforeAll`/`afterAll`
hooks have **no** access to the test-context `skip`, so they guard on the
module-level flag instead.

## ADR-006 time authority in the plugin path

The diagnostics handler measures Redis latency. Per ADR-006, business/diagnostic
time in the API layer must use `fastify.now()` (the exam time authority), not a
raw wall-clock read. The Redis latency measurement uses `fastify.now()` even
though it is diagnostics-only, to keep the ADR-006 structural guardrail
(`apps/api/src/runtime/time-authority.structural.test.ts`) green without an
allowlist carve-out.

## Docker Compose

Redis service added to all compose files (`redis:7-alpine`):

- `docker-compose.yml` (production): AOF persistence, internal to `exam-net`
  only (no host port) — the app reaches it as `redis://redis:6379`.
  **Production Redis MUST be authenticated (P7 review P1-1):** the redis
  service requires `REDIS_PASSWORD` via Compose required-expansion (no
  functional fallback, mirroring P6-007 POSTGRES_PASSWORD) and runs the
  server with `requirepass`; the healthcheck authenticates too. The API
  must be given the authenticated URL
  (`REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379`). Redis errors never
  echo the raw URL — only `host:port` — so credentials cannot leak into
  startup exceptions or logs (P7 review P1-2). dev/test compose files keep
  an unauthenticated instance as an explicit local exception.
- `docker-compose.dev.yml` (local dev): host port `6379:6379` published so
  local-run tests (which connect to `redis://localhost:6379`) work.
- `docker-compose.test.yml` (E2E): host port configurable via `REDIS_HOST_PORT`.

> Operational note: if `docker compose up` reports
> `Bind for 0.0.0.0:6379 failed: port is already allocated`, a stale container
> owns 6379. `docker compose -f docker-compose.dev.yml down && up -d` re-binds
> cleanly. A container that started during the conflict shows `6379/tcp` with no
> host mapping and is NOT reachable from the host.

## Files modified

| File | Change |
|------|--------|
| `apps/api/src/config/runtimeConfig.ts` | Added `RedisConfig` interface and `resolveRedisUrl()` |
| `apps/api/src/plugins/redis.ts` | New: Fastify Redis plugin |
| `apps/api/src/server.ts` | Register redisPlugin after dbPlugin |
| `apps/api/src/routes/system.ts` | Added Redis status to diagnostics endpoint |
| `apps/api/src/routes/testRedis.ts` | New: Test isolation helper |
| `apps/api/src/routes/redis.test.ts` | New: 7 baseline tests |
| `packages/contracts/src/system.ts` | Added `redisStatus` to DiagnosticsResponseSchema |
| `docker-compose.yml` | Added Redis service |
| `docker-compose.dev.yml` | Added Redis service |
| `docker-compose.test.yml` | Added Redis service |
| `.env.example` | Added REDIS_URL and REDIS_KEY_PREFIX documentation |
| `docs/adr/ADR-001-redis.md` | Updated status and added baseline section |

## Next steps: ADR-007 Isolation Audit

This baseline unlocks the following isolation audit items:

### PostgreSQL schema/data
- Per-worker database isolation (Phase 3A/3B complete)
- TRUNCATE-based reset between tests

### Redis keys
- Prefix-based isolation (this baseline)
- SCAN-based cleanup (no FLUSHALL)

### Queue jobs
- Queue prefix isolation (deferred until queue adoption)
- Producer-only mode for ordinary tests

### Background workers
- Worker lifecycle isolation (off by default)
- Dedicated scopes for background tests

### Seed/default org/user
- Seed data per test scope
- Org/user fixture isolation

### Rate limit/presence state
- In-memory rate limit (Redis-off / optional-degraded)
- Redis-backed shared rate limit with prefix isolation (P7 — done)
- Presence state (not started)
