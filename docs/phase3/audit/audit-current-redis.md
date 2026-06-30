# S5 — Current Redis Usage Audit

> **Date:** 2026-06-29
> **Branch:** `phase3/role-check-audit`
> **Purpose:** Audit all Redis touchpoints, fallback behavior, and diagnostics to prepare fact base for M2 (Redis hardening / adoption).

---

## 1. Redis Current Uses

### 1.1 Connection Plugin

**File:** `apps/api/src/plugins/redis.ts` (49 lines)

| Aspect | Detail |
|--------|--------|
| Library | `ioredis@^5.11.1` (in `@exam/api` only) |
| Client type | `RedisClient extends Redis { prefix: string }` |
| Fastify decoration | `fastify.redis: RedisClient \| null` |
| Connection mode | `lazyConnect: true`, explicit `await client.connect()` |
| Retry strategy | max 3 retries with `Math.min(times * 200, 2000)` → 200ms, 400ms, 600ms, then `null` (give up; 2000ms cap never reached) |
| Graceful close | `onClose` hook calls `client.quit()` |
| Disabled behavior | If `REDIS_URL` unset/empty → decorates `null`, no connection attempted |

### 1.2 Server Registration Order

**File:** `apps/api/src/server.ts:57-64`

```
dbPlugin → redisPlugin → nowPlugin → authPlugin → tenantPlugin → rateLimitPlugin → heartbeatPlugin → deadlineScannerPlugin
```

Redis registers after DB, before auth. If Redis connection fails (after retries exhausted), the server **crashes** — `await client.connect()` throws and `server.ts` does not catch it.

### 1.3 Actual Redis Usage at Runtime

| Usage | Redis-backed? | Current Implementation |
|-------|:---:|-------|
| Rate limiting | ❌ | `@fastify/rate-limit` with **in-memory** store (`apps/api/src/plugins/rateLimit.ts`) |
| Heartbeat / presence | ❌ | DB-backed `setInterval` scanner (`apps/api/src/plugins/heartbeat.ts`) |
| Admission queue | ❌ | In-memory `Map<string, QueueEntry[]>` (`apps/api/src/routes/attempts.candidate.ts:109`) |
| Diagnostics ping | ✅ | `fastify.redis.ping()` in `/system/diagnostics` (`apps/api/src/routes/system.ts:205`) |
| Test isolation | ✅ | `testRedis.ts` — prefix-scoped SCAN+DEL cleanup |
| Caching / pub-sub | ❌ | None |
| Job queue / BullMQ | ❌ | None |

> **Summary: Redis is connected in production but performs almost no work.** The only production usage is a diagnostics `ping()`. All business-critical features (heartbeat, rate limiting, queue) use in-process alternatives.

---

## 2. Redis Unavailable — Current Behavior

### 2.1 Startup Failure Path

When `REDIS_URL` is set and Redis is unreachable:

1. `redisPlugin` calls `await client.connect()` (line 40)
2. ioredis retries 3 times with 200ms, 400ms, 600ms backoff (`Math.min(times * 200, 2000)` — 2000ms cap never reached)
3. After 3 failed retries → throws connection error
4. Server **crashes** (uncaught in `server.ts`)

**No graceful degradation on startup.** The server does not catch the Redis connection error and fall back to `null`.

### 2.2 Disabled Path (REDIS_URL not set)

When `REDIS_URL` is unset or empty:

1. `config.redis.enabled === false`
2. Plugin decorates `fastify.redis = null`
3. Server starts normally
4. All Redis consumers check `if (fastify.redis)` before using

### 2.3 Mid-Session Redis Loss

If Redis disconnects after successful startup:

- ioredis auto-reconnects per retry strategy (3 retries: 200ms, 400ms, 600ms)
- After exhaustion, ioredis emits `"error"` event on the client EventEmitter — **the plugin has no `"error"` listener**, so Node.js treats it as an unhandled EventEmitter error and **crashes the process** (uncaughtException). Fastify's error handler only catches HTTP request-lifecycle errors, not arbitrary EventEmitter errors.
- No explicit disconnect handling in the plugin
- `/system/diagnostics` catch block would report `connected: false`
- No business logic uses Redis, so no functional impact

### 2.4 E2E Without Redis

E2E tests run without Redis (no Redis service in E2E CI job, `REDIS_URL` not set). All E2E tests pass without Redis.

---

## 3. Which Paths Must Fallback, Can Skip, Must PG-Authoritative

### 3.1 Must Fallback (graceful degradation required)

| Path | Current Behavior | Should |
|------|-----------------|--------|
| Server startup with `REDIS_URL` set | Crashes if Redis unreachable | Catch connection error, log warning, decorate `null`, continue |
| `fastify.redis.ping()` in diagnostics | try/catch → `connected: false` | ✅ Already correct |

### 3.2 Can Skip (Redis is optional enhancement)

| Path | Notes |
|------|-------|
| Rate limiting | Currently in-memory; Redis-backed rate limiting is a future enhancement, not a requirement |
| Presence / heartbeat | Currently DB-backed; Redis pub/sub presence is deferred per ADR-001 |
| Job queue | Currently in-memory; BullMQ adoption is deferred |
| Distributed caching | Not implemented; PG is authoritative for all state |

### 3.3 Must PG-Authoritative (Redis must never override)

| State | Authority | Notes |
|-------|-----------|-------|
| Exam attempt status, answers, scores | PostgreSQL | `exam_attempts` table is the single source of truth |
| Exam configuration (publish, schedule, rules) | PostgreSQL | `exams` table |
| User accounts, roles, sessions | PostgreSQL | `users` table + JWT (stateless) |
| Heartbeat / last activity | PostgreSQL | `exam_attempts.last_activity_at` |
| Disrupted detection | PostgreSQL | Heartbeat scanner reads `last_activity_at` from PG |
| Manual grading entries | PostgreSQL | `manual_grading_entries` table |
| Audit logs | PostgreSQL | `audit_logs` table |
| Candidate enrollments | PostgreSQL | `exam_enrollments` table |

> **Design invariant:** Redis is never an authority for any business state. It can only cache, signal, or rate-limit. If Redis loses data, PG state is always correct.

---

## 4. Configuration Matrix

### 4.1 Environment Variables

| Variable | Default | File |
|----------|---------|------|
| `REDIS_URL` | *(unset — Redis disabled)* | `.env:7` (commented) |
| `REDIS_KEY_PREFIX` | `""` | `.env.example:23` (commented) |
| `TEST_REDIS_URL` | *(unset)* | `testRedis.ts` fallback |
| `RATE_LIMIT_DISABLED` | `""` | Treated as false when empty |
| `RATE_LIMIT_MAX` | `100` | Per-minute (production) |
| `RATE_LIMIT_TIME_WINDOW` | `60000` | ms (production) |

### 4.2 Redis Config Resolution

**`apps/api/src/config/runtimeConfig.ts:349-395`**

```ts
function resolveRedisUrl(env): string | null {
  const url = env.REDIS_URL;
  if (!url) return null;
  const trimmed = url.trim();
  return trimmed.length === 0 ? null : trimmed;
}
// → enabled: url !== null
// → keyPrefix: env.REDIS_KEY_PREFIX ?? ""
```

### 4.3 Rate Limit Config

**`apps/api/src/plugins/rateLimit.ts:29-53`**

- Disabled when `config.rateLimit.enabled === false` (e2e mode, or `RATE_LIMIT_DISABLED=true`)
- IP-based (`request.ip`) key generator
- API reference UI path exempted
- Per-route overrides: login `10/min`, candidate import `10/min`, question import `5/min`

### 4.4 Docker Service Matrix

| Compose file | Redis image | Host port | Persistence | Health check |
|--------------|-------------|-----------|-------------|--------------|
| `docker-compose.yml` (prod) | `redis:7-alpine` | none (internal) | AOF | 10s interval |
| `docker-compose.dev.yml` | `redis:7-alpine` | `6379` | none | 2s interval |
| `docker-compose.test.yml` | `redis:7-alpine` | `${REDIS_HOST_PORT:-6379}` | none | 5s interval |

### 4.5 CI Matrix

| Job | Redis service | `REDIS_URL` set? | Notes |
|-----|:---:|:---:|-------|
| `verify` (unit + integration) | ✅ | ✅ `redis://localhost:6379` | `redis.test.ts` exercises Redis |
| E2E | ❌ | ❌ | E2E runs without Redis |

---

## 5. Test Coverage

### 5.1 Redis Plugin Tests

**`apps/api/src/routes/redis.test.ts`** (249 lines, 7 tests)

| Group | Test | Skips if Redis unavailable? |
|-------|------|:---:|
| Plugin lifecycle | connects and decorates fastify.redis | ✅ |
| Plugin lifecycle | decorates null when REDIS_URL unset | ❌ (always runs) |
| Plugin lifecycle | decorates null when REDIS_URL empty | ❌ (always runs) |
| Plugin lifecycle | closes connection gracefully | ✅ |
| Prefix isolation | prefix1 and prefix2 are isolated | ✅ |
| Prefix isolation | deleting prefix1 keys does not affect prefix2 | ✅ |
| Cleanup | prefix-scoped delete only removes scoped keys | ✅ |

**Reachability probe:** `canReachRedis()` — 500ms one-shot probe before tests to avoid retry storms. Tests that need Redis are `.skip()` rather than `.fail()` when unavailable.

### 5.2 Test Isolation Helper

**`apps/api/src/routes/testRedis.ts`** (86 lines)

```ts
interface TestRedisHandle {
  client: Redis;
  prefix: string;
  resetByPrefix(): Promise<void>;  // SCAN-based cleanup
  close(): Promise<void>();
}
```

**Prefix derivation** via `packages/db/src/testScope.ts:376-378`:

```ts
function deriveRedisPrefix({ namespaceSegment }): string {
  return `exam:test:${namespaceSegment}:`;
}
```

Examples: `exam:test:local:w1:`, `exam:test:s1:w1:`, `exam:test:e2e:`

**Cleanup invariant:** SCAN + DEL only, never FLUSHALL.

### 5.3 Rate Limit Tests

| File | Tests |
|------|-------|
| `apps/api/src/plugins/rateLimit.test.ts` | Basic rate limit with `max: 1` |
| `apps/api/src/plugins/rateLimit.abuse.test.ts` | F-005 brute-force login (12 rapid, limit 5/min) |
| `apps/api/src/routes/auth.test.ts:61-100` | E2E mode disables rate limiting |
| `apps/api/src/config/runtimeConfig.test.ts:692-779` | 10 config validation tests for rate limit settings |

### 5.4 `buildTestApp` Redis Behavior

**`apps/api/src/routes/testHelpers.ts`** — `buildTestApp` / `finishBuildTestApp` does **NOT** register the Redis plugin (the plugin-registration block at lines ~220-232 registers zodProviderPlugin, fastifyCookie, createDbPlugin, nowPlugin, authPlugin, tenantPlugin, conditionally rateLimitPlugin, and routePlugin — no `redisPlugin`). Redis is only registered in production `server.ts`.

---

## 6. Documentation References

| Doc | Content |
|-----|---------|
| `docs/adr/ADR-001-redis.md` | Redis baseline: optional infra, deferred full adoption, 5 triggers for future adoption |
| `docs/dev/redis-baseline.md` | Architecture diagram, config table, test prefix table, cleanup invariant |
| `docs/archive/phase1-archive/phase-1.4/adr/adr-redis-mq.md` | Original Phase 2 Redis/MQ plan (superseded by ADR-001, not implemented) |
| `docs/dev/phase2-baseline.md` | Documents redis.test.ts failure/fix |
| `docs/dev/phase2-closeout-report.md` | Documents redis.test.ts retry storm bug fix (`ecccf1f`) |
| `docs/phase3/job-cards.md` | Lists `redis.unavailable` / `redis.recovered` as planned monitoring events |

---

## 7. ADR-001 Adoption Triggers

ADR-001 (`docs/adr/ADR-001-redis.md` §Triggers for Adoption) defines 5 triggers for full Redis adoption beyond the baseline. Each must be evidenced by a measured limit, not a forecast. The 5 triggers, verbatim from the ADR:

1. **Multi-instance app deployment** — queue, rate limit, and presence state must be shared across processes; a per-process Map or timer no longer works.
2. **Shared rate limit required across instances** — login/answer-save throttling must be global, not per-process.
3. **Distributed presence / 1000+ concurrent candidates per exam** — heartbeat + presence state must be coordinated across instances; a single scanner is no longer sufficient.
4. **Cross-process scanner coordination required** — multiple app instances need a single owner for the deadline auto-submit scanner to avoid duplicate submits.
5. **Persistent admission queue required** — `requireQueue` needs to survive restart and be shared across instances; DB-backed queue is the alternative.

> Note: BullMQ / generic background-job-queue and real-time proctor pub/sub are **not** ADR-001 triggers. The ADR's Non-Goals explicitly list "No queue/BullMQ integration" — full Redis adoption is scoped to queue ownership, rate-limit counters, and presence, with PostgreSQL remaining the sole source of truth.

All triggers remain unmet in Phase 3 single-instance deployment.

---

## 8. Risk Points

### R1 — Startup crash on Redis failure
`await client.connect()` in `redisPlugin` is not wrapped in try/catch. If `REDIS_URL` is set but Redis is unreachable, the server crashes. This contradicts the "optional infrastructure" design intent from ADR-001.

### R2 — No disconnect event handler (process crash risk)
The Redis plugin does not listen for `"error"` or `"close"` events on the ioredis client. A mid-session disconnect after retry exhaustion would emit an `"error"` event with no listener. Node.js EventEmitter semantics dictate that an unhandled `"error"` event throws an `uncaughtException` — **crashing the entire process**. Fastify's error handler does NOT intercept EventEmitter errors from non-request-scoped objects. This is a latent crash bug, not merely a missing log.

### R3 — Rate limit not shared across instances
`@fastify/rate-limit` uses in-memory store. In a multi-instance deployment, each instance has its own counter. A determined attacker could send `N × max` requests per window across instances.

### R4 — Heartbeat scanner is DB-only
The heartbeat scanner runs `SELECT ... WHERE last_activity_at < now() - timeout` every 30s. Under high concurrency, this query may become expensive. Redis sorted sets could offload presence tracking.

### R5 — In-memory queue lost on restart
`examQueues = new Map()` in `attempts.candidate.ts:109` is process-local. Queue state is lost on server restart. However, queue admission is Phase 2+ deferred and not operationally wired.

### R6 — No `redis.recovered` monitoring event
Phase 3 job cards plan `redis.unavailable` / `redis.recovered` events, but the plugin does not emit these today.

---

## 9. M2 Modification Suggestions

### 9.1 Must-Fix (Startup Graceful Degradation)

**File:** `apps/api/src/plugins/redis.ts`

```ts
// Current (line 38-40):
const client = createRedisClient(config.redis.url, config.redis.keyPrefix);
await client.connect();  // ← throws, crashes server

// Suggested:
const client = createRedisClient(config.redis.url, config.redis.keyPrefix);
try {
  await client.connect();
} catch (err) {
  fastify.log.warn({ err }, "Redis unavailable — running without Redis");
  fastify.decorate<RedisClient | null>("redis", null);
  return;  // graceful degradation
}
```

### 9.2 Should-Fix (Disconnect Event Handler)

Add `"error"` and `"close"` event listeners on the Redis client to log and update a health flag. This enables the planned `redis.unavailable` / `redis.recovered` monitoring events.

### 9.3 Consider (Redis-Backed Rate Limit)

When multi-instance deployment is needed, switch `@fastify/rate-limit` store from in-memory to Redis ioredis. This is a config change, not a code change — `@fastify/rate-limit` supports `redis` store type natively.

### 9.4 Consider (Presence Cache)

If heartbeat scanner becomes expensive under load, add Redis sorted sets for `exam:{attemptId}:lastActivity` as a hot cache. PG remains authoritative; Redis is read-through.

### 9.5 No Change Needed

- Diagnostics ping — already has try/catch, already reports `connected: false`
- Test isolation — already correct (skip when unavailable, prefix-scoped cleanup)
- ADR-001 baseline architecture — correct design, just needs the startup fix

---

## 10. File Inventory

### Production Code

| File | Redis Role |
|------|------------|
| `apps/api/src/plugins/redis.ts` | Connection plugin (sole Redis consumer) |
| `apps/api/src/plugins/rateLimit.ts` | In-memory rate limit (no Redis) |
| `apps/api/src/plugins/heartbeat.ts` | DB-backed heartbeat scanner (no Redis) |
| `apps/api/src/routes/system.ts:196-213` | Diagnostics `redis.ping()` |
| `apps/api/src/routes/attempts.candidate.ts:109` | In-memory queue (no Redis) |
| `apps/api/src/config/runtimeConfig.ts:349-395` | Redis config resolution |
| `apps/api/src/server.ts:58` | Redis plugin registration |

### Test Code

| File | Redis Role |
|------|------------|
| `apps/api/src/routes/redis.test.ts` | Plugin lifecycle + prefix isolation (7 tests) |
| `apps/api/src/routes/testRedis.ts` | Test Redis handle (connect, prefix, cleanup) |
| `apps/api/src/plugins/rateLimit.test.ts` | Rate limit tests (in-memory) |
| `apps/api/src/plugins/rateLimit.abuse.test.ts` | Brute-force login test |
| `apps/api/src/routes/testHelpers.ts` | `buildTestApp` / `finishBuildTestApp` (does NOT register Redis) |
| `packages/db/src/testScope.ts` | Redis prefix derivation |

### Config / Infra

| File | Redis Role |
|------|------------|
| `.env` | `REDIS_URL` commented out (disabled by default) |
| `.env.example` | Redis env var documentation |
| `docker-compose.yml` | Redis 7 service (production) |
| `docker-compose.dev.yml` | Redis 7 service (dev, port 6379) |
| `docker-compose.test.yml` | Redis 7 service (test) |
| `.github/workflows/ci.yml` | Redis service in `verify` job only |

### Docs

| File | Content |
|------|---------|
| `docs/adr/ADR-001-redis.md` | Redis baseline ADR |
| `docs/dev/redis-baseline.md` | Redis baseline architecture doc |
| `docs/archive/phase1-archive/phase-1.4/adr/adr-redis-mq.md` | Archived Phase 1.4 Redis/MQ plan |
