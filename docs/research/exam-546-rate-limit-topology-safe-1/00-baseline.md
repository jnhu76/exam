# #546 Baseline — as-built rate-limit identity audit (master `7711cd9c`)

Stage A code reality audit + Stage B measured characterization. All facts below
were re-verified on current master before any design work; F-08-1 numbers are
freshly reproduced at the HTTP-contract level (the 5 characterization tests in
`apps/api/src/plugins/rateLimit.topology.test.ts`, committed in `a701bdd4`,
were run against a working tree at `7711cd9c` and passed 5/5).

## As-built wiring

- `apps/api/src/server.ts` — `Fastify({ logger })` with **no `trustProxy`
  option** → Fastify default `false` → `request.ip` is always the socket peer.
  `trustProxy` has zero occurrences in the api source.
- `apps/api/src/plugins/rateLimit.ts` — `@fastify/rate-limit` ^10.3.0 inside
  the apiSurface scope (`/api` only; docs/web outside by encapsulation).
  `keyGenerator = HMAC-SHA256("exam-ratelimit-ip-v1:<request.ip>", jwtSecret)`
  (`apps/api/src/redis/rateLimitKey.ts`) — stable, opaque, shared across
  instances via the Redis store (`DelegatingRateLimitStore`); in-memory
  fallback when Redis is off/degraded in `optional` mode; fail-closed 503 in
  `required` mode. Disabled in e2e mode or via `RATE_LIMIT_DISABLED`.
- Budgets: global `RATE_LIMIT_MAX` = 100 / `RATE_LIMIT_WINDOW_MS` = 60,000 ms
  (`apps/api/src/config/settings.ts`, `lenientIntLeaf(100)`); route-level:
  login 10/min, accept-invitation 10/min, password-reset request 5/10min,
  password-reset consume 10/min, launchpad bootstrap 5/min, invitation create
  20/min, candidate import 10/min — all keyed by the same per-IP digest.
- **`request.ip` consumers (production, complete list)**:
  1. the limiter key (`rateLimitKey.ts:33`);
  2. the audit trail (`audit/auditWriter.ts:95` → `audit_logs.ip_address`).
  Any trusted-proxy change therefore has exactly two semantic surfaces, both
  served by the single Fastify `request.ip` authority.

## Deployment-doc conflict (why KEEP_CURRENT is not free)

`docs/deployment/README.md` ("Place a reverse proxy (nginx, Caddy) in front
for HTTPS") and `docs/deployment/mvp-deployment-runbook.md` (TLS delegated to
a reverse proxy) **endorse a reverse-proxy topology the limiter degenerates
under**: without `trustProxy`, every candidate behind the proxy shares the
proxy socket IP. Declaring proxies unsupported would contradict the deployment
contract; wiring a bounded trusted-proxy model is the smaller, correct fix.

## Measured topology characterization (F-08-1 reproduced on master)

Committed test drives the real `rateLimitPlugin` (in-memory store; store
choice is irrelevant to identity) via `app.inject` with per-request
`remoteAddress` and `x-forwarded-for`:

| # | Topology | Scenario | Measured result |
| --- | --- | --- | --- |
| 1 | DIRECT_LAN | 3 distinct source IPs | budgets fully independent; exhausting one IP never blocks another |
| 2 | SHARED_NAT login | 11 same-minute logins, one IP | 11th → 429 (login budget 10/min/IP) — matches audit ">10 同刻登录必 429" |
| 3 | SHARED_NAT steady | 101 requests/min, one IP | 101st → 429 (global 100/min/IP) — matches audit "~15 人 × 6.6 req/min 触顶" |
| 4 | REVERSE_PROXY_WITHOUT_TRUSTED_CLIENT_IP | 11 candidates, distinct XFF, one socket IP | XFF ignored; collapse onto proxy IP → 11th login 429 |
| 5 | Spoofed XFF (no trusted wiring) | `X-Forwarded-For: 9.9.9.9` | header ignored entirely — no bypass, no key shift (property to preserve) |

Audit source: `docs/research/exam-production-reality-audit-1/08-scale-operability-capacity.md`
F-08-1 (MINOR, deployment-sensitive) with its topology verdict table. This
baseline confirms the code path is unchanged since that audit and pins the
behavior in an executable regression suite.
