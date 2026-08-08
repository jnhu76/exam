# P7 — Redis Shared Rate Limit Closeout

> Status: Post-MVP infrastructure closeout
> Date: 2026-08-08
> Branch: `feat/p7-redis-shared-rate-limit` (based on `origin/master`, PR #264)
> Verdict: **REDIS SHARED RATE LIMIT READY FOR HUMAN REVIEW**

## 1. What Redis now owns

- **Ephemeral shared rate-limit counters** (fixed window, atomic Lua
  `INCR` + `PEXPIRE`/`PTTL`) under the workload namespace
  `<REDIS_KEY_PREFIX>ratelimit:v1:<ip-digest>[<METHOD><path>-]`.
- **Runtime lifecycle state** (`disabled | connecting | ready | degraded |
  closing` + degraded reason) reported through diagnostics.
- **TTL**: every counter key expires after the time window. Proven in tests
  (`PTTL > 0` after creation). No persistent rate-limit keys accumulate.

## 2. What Redis explicitly does NOT own

Answers, question snapshots, attempt status, exam status, enrollments,
scores, grading entries, results, incident truth, audit truth, command
receipts, time adjustments — all remain PostgreSQL-only. No PostgreSQL
locking or durable-command logic was replaced. The Redis fallback guard
(`attempts/redis-fallback-guard.test.ts`) still passes and no Redis code was
added to attempt transaction / answer save / submit / grading / result
publication / recovery durable commands.

## 3. Runtime modes

| Mode | Startup | Redis healthy | Redis lost at runtime | Rollback |
| --- | --- | --- | --- | --- |
| `off` (default when `REDIS_URL` unset) | no client created; local store | local store | local store | — |
| `optional` (default when `REDIS_URL` set) | bounded connect (2s connect, 8s window); never hangs/crashes | shared Redis store | degrades to local store; auto-recovers on reconnect | `REDIS_MODE=off` |
| `required` | fails fast inside the bounded window if not ready | shared Redis store | **fails closed** (503 `RATE_LIMIT_UNAVAILABLE`); never silent local fallback; auto-recovers | `REDIS_MODE=off` |

Bounded connection contract (LAN-conservative): `REDIS_CONNECT_TIMEOUT_MS`
default 2000, `REDIS_COMMAND_TIMEOUT_MS` default 1000,
`REDIS_STARTUP_TIMEOUT_MS` default 8000; retry backoff 200ms → 2000ms
(bounded delay; deliberate infinite attempts for auto-recovery);
`enableOfflineQueue: false` (commands fail fast, never buffer);
`maxRetriesPerRequest: 2`. All documented in `.env.example` and
`docs/contracts/redis-baseline.md`.

## 4. Lifecycle and failure behavior

- Client events (`error`, `close`, `reconnecting`, `ready`, `end`) are all
  handled — no emitted `error` can crash the process (integration test
  proves an error/close/reconnecting storm transitions exactly once and
  logs once).
- Transition logs: `redis.ready` / `redis.recovered` /
  `redis.unavailable` / `redis.closing` — never per-retry spam. Passwords and
  credential-bearing URLs are never logged.
- Graceful shutdown: bounded `quit()` (2s race) then `disconnect()`, safe
  from every lifecycle state.
- A single command failure on a healthy connection falls back for that
  request without flipping the whole runtime (no stuck-degraded state); on an
  unhealthy connection it degrades (`command_failure`).
- Recovery is automatic: the client reconnects with bounded backoff; the
  `ready` event returns the runtime (and the shared store) to service.

## 5. Two-instance acceptance experiment (P7 §16)

In-process two Fastify API instances, one shared Redis, route `/limited`
with `max: 5` per 60s window, requests alternating A/B/A/B… (12 requests):

```
request 1  → A  200        request 7   → A  429
request 2  → B  200        request 8   → B  429
request 3  → A  200        request 9   → A  429
request 4  → B  200        request 10  → B  429
request 5  → A  200        request 11  → A  429
request 6  → B  429        request 12  → B  429
```

- **Allowed = 5, rejected = 7** — exactly ONE shared limit, NOT 5+5=10.
- Rejected responses carry the canonical structured error
  `{ error: { code: "RATE_LIMITED" } }` (HTTP 429) — contract preserved.
- Redis keys found under `<prefix>ratelimit:v1:*`; every key has
  `PTTL > 0`; no key contains a raw IP (`127.0.0.1` / `::1` absent — keys
  are 64-hex HMAC digests).
- Reproducible via:
  `REDIS_URL=redis://localhost:6379 pnpm --filter @exam/api exec vitest run src/plugins/rateLimit.redis.test.ts`

**Local-mode control experiment (P7 §17):** the same two instances with
`REDIS_MODE=off` each own their own counter: 8 requests to A → 5 allowed +
3 rejected; then 5 requests to B → all allowed. Per-instance counters,
2N total — the before/after explanation for why shared Redis matters.

## 6. Failure tests (all green)

| Scenario | Result |
| --- | --- |
| Startup unavailable, optional | app boots; runtime `degraded` (startup_timeout/connection_lost); local limiting active (1st 200, 2nd 429) |
| Startup unavailable, required | `app.ready()` rejects with `RuntimeConfigError` /required/ in <3s (bounded, no test-timeout dependence) |
| Runtime loss, optional | process survives; state → `degraded(connection_lost)`; requests don't hang; local limiting enforced; Redis restored → `ready`; shared counter continues at the pre-outage count |
| Runtime loss, required | fail closed: 503 `{ error: { code: "RATE_LIMIT_UNAVAILABLE" } }` (never a Redis stack, never local); Redis restored → `ready` → requests served again |
| Shutdown | bounded close from connecting/degraded/end states; no leaked client |

Runtime loss/recovery is exercised against a controllable fake RESP Redis
server (same port restore), so the tests are deterministic and run without
touching the shared dev Redis.

## 7. Isolation (ADR-007)

- Key prefix: `<REDIS_KEY_PREFIX>ratelimit:v1:…`; the ioredis client
  `keyPrefix` carries `REDIS_KEY_PREFIX` (verified empirically that it
  applies to custom Lua KEYS — no double-prefixing).
- Test worker isolation: two scopes (`exam:test:rlA:*` / `exam:test:rlB:*`)
  on the same Redis each allow their full N — counters are invisible across
  prefixes. Cleanup is prefix-scoped SCAN+DEL only (never FLUSHALL).
- Raw sensitive identifiers: none. The shared key is an opaque
  HMAC-SHA256 digest (`exam-ratelimit-ip-v1` domain-separated context over
  the deployment `JWT_SECRET`); no username/candidate id/email/JWT/answer
  content ever enters the keyspace. Decision: reuse `JWT_SECRET` (already
  production-required, no new credential to rotate) with explicit domain
  separation rather than adding a new secret; documented here and in
  `apps/api/src/redis/rateLimitKey.ts`.

## 8. Diagnostics

`GET /system/diagnostics` `redisStatus` now reports:

```json
{ "mode": "optional", "state": "ready", "connected": true,
  "latencyMs": 1, "degradedReason": null }
```

Mode/state/degraded-reason are truthful (an optional-mode instance whose
Redis is down reports `degraded` + reason, never a fake healthy boolean).
No secrets. The Admin diagnostics page renders disabled / connecting /
connected / degraded(+reason) instead of a flat connected boolean — a
minimal presentation fix only (no broader UI work).

## 9. Regression

| Gate | Result |
| --- | --- |
| Full API suite (Redis-off default) | PASS (see §11) |
| API suite with Redis | PASS (integration file 7/7) |
| `rateLimit.test.ts` / `rateLimit.abuse.test.ts` (contract) | PASS — `RATE_LIMITED` shape unchanged |
| `redis.test.ts` baseline | PASS (5 skip when no Redis, as designed) |
| `system.test.ts` diagnostics | PASS (20/20) |
| web `SystemDiagnosticsPage` | PASS (18/18) |
| `pnpm verify` | PASS (see §11) |

## 10. Rollback

```
Redis adoption causes trouble
        ↓
set REDIS_MODE=off (or unset REDIS_URL)
        ↓
local rate limiting resumes
        ↓
exam system continues
```

No PostgreSQL migration rollback. No data reconciliation. Redis rate-limit
counters are ephemeral; a Redis restart may reset windows (acceptable and
documented — PostgreSQL state is unaffected).

## 11. Verification evidence

- `pnpm verify` — **PASS (exit 0)**: format, lint, copy, arch, db-config,
  db-journal, env-contract, repo-contract, ui-gates, eslint, typecheck,
  openapi check, e2e-runner, db-journal checks; coverage gates: api 150
  files / 1986 passed / 7 skipped, db 41 files / 559 passed, web 109 files /
  1550 passed. (One `packages/db` migration-convergence test flaked once
  under parallel coverage — physical-DB-lifecycle contention, unrelated to
  this change (`packages/db` has zero diff); passed on immediate rerun and
  in the final verify.)
- Full API suite **without Redis**: 1986 passed / 7 skipped (the 7 are the
  Redis-gated baseline + integration tests skipping by design).
- Full API suite **with Redis** (`REDIS_URL=redis://localhost:6379`):
  **1993 passed / 0 skipped** — every Redis-gated test executed and passed.
- E2E smoke (`candidate-happy-path.spec.ts` via `scripts/e2e/run-wsl.sh`,
  2 shards) with **Redis disabled**: PASS.
- E2E smoke with **Redis optional + ready**: PASS (regression: the app boots
  and the journey completes with the Redis runtime enabled).
- Redis key hygiene: after all runs, `ratelimit:*` and `exam:test:*` key
  counts are 0 on the shared dev Redis (prefix-scoped cleanup only).

## 12. Remaining Redis candidates (explicitly deferred — not implemented)

Admission queue · presence · Pub/Sub · Streams · BullMQ/jobs · scanner
leases · cache · sessions · HA/Sentinel/Cluster · RDB/AOF correctness
requirements · backup/failover. Each requires a separate decision per
ADR-001.

## 13. Files changed

| Area | Files |
| --- | --- |
| Runtime lifecycle | `apps/api/src/redis/redisRuntime.ts` (+test) |
| Store selection | `apps/api/src/redis/rateLimitStores.ts` (+test) |
| Key digest | `apps/api/src/redis/rateLimitKey.ts` (+test) |
| Plugins | `apps/api/src/plugins/redis.ts`, `apps/api/src/plugins/rateLimit.ts` |
| Config | `apps/api/src/config/runtimeConfig.ts` (+test) |
| Diagnostics | `packages/contracts/src/system.ts`, `apps/api/src/routes/system.ts`, `apps/api/openapi.json` |
| Error code | `packages/contracts/src/messageRegistry.ts` (`RATE_LIMIT_UNAVAILABLE`) |
| UI (minimal) | `apps/web/src/pages/admin/SystemDiagnosticsPage.tsx` (+test), `apps/web/src/i18n/locales/zh-CN.ts` |
| Integration | `apps/api/src/plugins/rateLimit.redis.test.ts` (7 tests incl. two-instance + outage/recovery) |
| Deploy/env | `.env.example`, `docker-compose.yml` (`REDIS_MODE` passthrough) |
| Docs | `docs/adr/ADR-001-redis.md`, `docs/contracts/redis-baseline.md`, this closeout |
