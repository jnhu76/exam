# #550 Final capacity re-proof — 00 Environment freeze

Status: FROZEN at campaign start (values below are the exact machine state recorded before the
first canonical run; per-run metadata in `results/<run_id>/meta.json` re-records the volatile
subset). Evidence produced here proves only THIS software on THIS machine/topology — no
extrapolation to production hardware.

## Base / branch

```text
BASE_SHA:  fbf5bd41bfa6e12ef9fbe4a271c458cbf37d416e   (== origin/master, PR #581 / #548 merge)
HEAD_SHA:  8c2a93de (research branch tip at closeout — docs commit, see 11-final-verdict.md)
BRANCH:    research/550-final-capacity-reproof-1
WORKTREE:  clean at branch creation; BASE GATE verified HEAD == origin/master == expected SHA
```

## Host

```text
OS:        WSL2 (Microsoft-standard kernel), Debian-family userland
KERNEL:    Linux 6.18.33.2-microsoft-standard-WSL2 x86_64
HOSTNAME:  WuJie
CPU:       12th Gen Intel(R) Core(TM) i7-12700H — 10 cores / 20 threads (nproc=20)
RAM:       16,243,360 kB total (15.5 GiB); MemAvailable at freeze ≈ 11.2 GiB
SWAP:      4 GiB partition — effectively full at freeze (SwapFree ≈ 56 kB).
           CAVEAT: long-lived machine state, not created by this campaign. MemAvailable is the
           healthy signal; host-memory-saturation classification during runs uses MemAvailable
           + per-process RSS, not swap usage.
DISK:      ~901 GB free on /
Docker:    Docker Desktop 29.5.3 (WSL2 backend), Compose v5.1.4
```

## Software under test

```text
Node:      v24.15.0
pnpm:      11.1.2
PostgreSQL: 18.4 (Debian 18.4-1.pgdg12+1), container postgres:18.4-bookworm — sole durable authority
Redis:     7.4.10 (redis:7-alpine), rate-limit coordination only (#554 KEEP)
postgres.js: 3.4.9 (pool shape: DEFAULT max=10, no env override exists in the repo — verified at
           packages/db/src/postgres.ts; the canonical pool size is never changed during #550)
drizzle-orm: 0.45.2
```

## Runtime modes exercised

```text
API:       native Node process on the host (tsx), NOT containerized — same shape as the repo's
           own WSL E2E runner (scripts/e2e/run-wsl.sh). One API instance per run group.
           Lifecycle/admission groups: APP_MODE=e2e (limiter off — sanctioned by the #549
           admission workload contract; the limiter dimension is measured separately, §12/07).
           Rate-limit topology groups: APP_MODE=production (limiter ON, production defaults).
DB/Redis:  Docker (docker-compose.dev.yml: db 5432, redis 6379), already-running containers.
Load driver: native Node process on the same host (single-machine rig — see caveats).
```

## Canonical configuration entering the baseline (#21 — no tuning)

```text
DB pool:              postgres.js default max=10 (production shape; unchanged everywhere)
Rate limit:           RATE_LIMIT_MAX=100 / 60s per key (production default), login route 10/min
                      (hardcoded route budget) — exercised in the topology group
Redis mode:           REDIS_MODE=optional with REDIS_URL set (deployment default derivation);
                      degradation boundaries exercised separately (07/§13)
Admission:            KEEP_LAZY (#549): requireQueue=true, batchSize=20, batchInterval=15s;
                      no autonomous server-side writer
Heartbeat/deadline:   production defaults (HEARTBEAT_TIMEOUT_MS=60000,
                      HEARTBEAT_SCAN_INTERVAL_MS=30000, deadline scan falls back to 30s)
                      — NOT the accelerated E2E values
Background loops:     all enabled (heartbeat+incident reconcile, deadline scanner,
                      client-event retention, operability monitor 15s, email outbox loop)
Readiness/alerting:   enabled (#547 semantics: /api/health liveness, /api/ready DB-aware)
Trust proxy:          TRUSTED_PROXY_CIDRS only set in the trusted-proxy topology run
```

## Known machine-state caveats

1. Swap partition full at freeze (pre-existing). Watch item only; MemAvailable healthy.
2. Load driver, API, PostgreSQL, and Redis share one physical machine — CPU contention between
   driver and system-under-test is possible at high N. Host + per-process CPU/RSS are sampled
   during every major phase and used in bottleneck classification (§20/09) so a saturated
   machine is never misattributed to application architecture.
3. Docker Desktop networking: `host.docker.internal` did NOT resolve from WSL at freeze; the
   trusted-proxy topology uses a container with host networking (or a direct bridge IP) — the
   exact wiring is frozen in 01-topology.md after the pilot.

## GitHub CI

```text
GITHUB_CI: UNAVAILABLE_BILLING — recorded separately; never reported as PASS or FAIL.
Local gates substitute (§27): see 11-final-verdict.md LOCAL_VALIDATION for the exact
commands + exit codes executed at HEAD.
```
