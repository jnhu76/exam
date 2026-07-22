# Redis Baseline

## Purpose

This document records the Redis baseline infrastructure introduced in Phase 2 收口. The baseline provides the foundation for ADR-007 isolation audit and future optional Redis-backed features.

## Architecture

### Plugin lifecycle

```
server.ts
  └─ dbPlugin (required)
  └─ redisPlugin (optional)
      ├─ REDIS_URL set → connect, decorate fastify.redis, onClose hook
      └─ REDIS_URL unset → decorate null, no connection
```

### Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | No | `null` (disabled) | Redis connection URL |
| `REDIS_KEY_PREFIX` | No | `""` | Key prefix for namespace separation |

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
- In-memory rate limit (current)
- Future: Redis-backed rate limit with prefix isolation
