# #550 Final capacity re-proof — 01 Topology

## Accepted final topology entering #550 (authority: #554 KEEP_CURRENT_ARCHITECTURE)

```text
API_INSTANCES:      1 (native Node/Fastify process)
POSTGRES:           sole durable exam-fact authority (PG 18.4 container)
DB_POOL:            postgres.js default max=10 — never changed
REDIS:              bounded rate-limit coordination only (optional mode; no generic backend)
ADMISSION:          HTTP polling, KEEP_LAZY (#549) — demand-triggered CAS materialization only
BACKGROUND WORK:    existing in-process loops (heartbeat+incident reconcile 30s, deadline
                    scanner 30s, client-event retention 24h, operability monitor 15s,
                    email outbox loop) — all left enabled
MQ / EVENT BUS / CACHE / FANOUT: none (introducing any is forbidden by #550 §2)
```

## Measured rig wiring

```text
                    ┌────────────────────────── host (WSL2) ──────────────────────────┐
                    │                                                                 │
 load driver ───────┼──► :APP_PORT  API (node, APP_MODE=production, 1 instance)       │
 (node:http,        │        │ pool max=10, production limiter ON (Redis store)       │
  keepAlive,        │        ▼                                                        │
  per-candidate     │──► :5432  postgres:18.4 container (docker-compose.dev.yml)      │
  loopback source   │                                                                 │
  IP for DIRECT_LAN)│──► :6379  redis:7-alpine container (rate-limit coordination)    │
                    │                                                                 │
 topology runs only │──► :PROXY_PORT  minimal host-side reverse proxy (Node http,     │
                    │                ~30 lines, faithful $proxy_add_x_forwarded_for    │
                    │                semantics) ──► API                                │
                    └─────────────────────────────────────────────────────────────────┘
```

CORRECTIVE-1 (EXAM-550-CORRECTIVE-1): ALL canonical groups — lifecycle,
admission, long-lived, soak, readiness, topology — now run the API in
APP_MODE=production with the production limiter enabled (default budgets:
global 100/min/IP, login route 10/min/IP) and the Redis-backed limiter store
(REDIS_MODE=optional + REDIS_URL, Redis container running). The pre-corrective
lifecycle/admission/longlived/soak runs used APP_MODE=e2e (limiter off) — a
#554-topology violation for final-capacity authority — and are marked
SUPERSEDED_PRE_CORRECTIVE_EVIDENCE. DIRECT_LAN candidate identity = a real
distinct kernel loopback source socket per candidate (127.0.0.x, Linux
treats all of 127/8 as local) in EVERY corrective group (lifecycle,
admission, longlived, soak).

The proxy box in the diagram is AS-BUILT, not the planned nginx container: published-port
Docker NAT erases client source IPs BEFORE the proxy and Docker Desktop host networking is
ineffective in this rig (both measured — 07-rate-limit-topology.md § rig deviations, with the
failed attempts retained). The host-side Node reverse proxy binds 127.0.0.1:PROXY_PORT and sees
the drivers' real source addresses exactly like a same-host reverse proxy in a real deployment;
the behavior under test is the API's `TRUSTED_PROXY_CIDRS` + proxy-addr walk (#546), not
nginx-the-product.

- The driver speaks real HTTP to the real Fastify stack. No direct engine calls on any path
  that contributes to a #550 classification (engine numbers from #549 are cross-check
  baselines only).
- One dedicated test database `exam_550_*` (name-guarded) per run group, created/dropped by
  the harness via the repo-owned migration path (`migratePostgres`). No dev database is ever
  touched (AGENTS.md §6).
- Every measured run boots a FRESH API process (clean pools, clean loop metrics), warms it up,
  then runs the phases. Research instrumentation is env-gated (CAPACITY_RESEARCH=1,
  default OFF, zero behavior change — see 02-methodology.md §Instrumentation).

## Rate-limit topology states (authority: #546 topology freeze)

| State | Wiring | Limiter | Expected request.ip authority |
| --- | --- | --- | --- |
| `DIRECT_LAN` | driver → API directly; each virtual candidate binds a DISTINCT loopback source IP (127.0.0.x per candidate — Linux treats all of 127/8 as local) | production defaults ON | kernel socket peer (distinct per candidate) |
| `SHARED_NAT` | driver → API directly; ALL candidates share 127.0.0.1 | production defaults ON | one shared socket peer |
| `REVERSE_PROXY_WITH_TRUSTED_CLIENT_IP` | driver → host-side reverse proxy (as-built, above) → API; `TRUSTED_PROXY_CIDRS` self-calibrated from live probes (the proxy's real egress /32s, recorded per run); the proxy appends XFF (`$proxy_add_x_forwarded_for` semantics) | production defaults ON | XFF entry appended by the trusted proxy (distinct per candidate) |
| `REVERSE_PROXY_WITHOUT_TRUSTED_CLIENT_IP` | same wiring, API started WITHOUT `TRUSTED_PROXY_CIDRS` | production defaults ON | proxy socket IP (collapse — DEGRADED_BY_CONFIG, never classified healthy) |

Honesty rules (§12): SHARED_NAT does NOT fake per-client IPs (it IS the collapse case);
DIRECT_LAN per-IP independence comes from real distinct kernel socket peers, not headers;
trusted-proxy evidence includes the spoof-negative probes; the degraded proxy state is
labelled DEGRADED_BY_CONFIG and excluded from supported classifications.

`request.ip` evidence oracle: the authentication audit trail (`ip_address` column written by
the auth route from the single `request.ip` authority) is read back after login bursts and
retained per topology state.

## Research instrumentation surface (default OFF) — CORRECTED in EXAM-550-CORRECTIVE-1

```text
CAPACITY_RESEARCH=1 (API env):
  - wraps the single drizzle→postgres.js statement funnel (sql.unsafe) with a
    NEUTRAL arrival counter: counts the call synchronously and forwards the
    ORIGINAL postgres.js Query untouched — no then/catch/finally, no
    Promise.resolve, no await of the returned Query anywhere in the wrapper;
  - samples postgres.js pool CONFIG facts (max / idle_timeout / max_lifetime)
    passively;
  - exposes process RSS, CPU-usage deltas, event-loop-delay histogram,
    heartbeatMetrics, deadlineScannerMetrics, and the measured topology facts
    (appMode, rateLimit.enabled, Redis config mode + runtime state) via
    GET /api/research/capacity (capability-gated like other system diagnostics;
    route exists ONLY when env set).
  - NOT observed in-process (NOT_DIRECTLY_OBSERVABLE): per-statement
    in-flight/max-in-flight, per-statement duration, per-statement errors.
    postgres.js v3 Query is a LAZY thenable — the first then/catch/finally
    call submits execution (postgres 3.4.9 query.js), and
    Promise.resolve(thenable) attaches .then — so ANY completion observation
    triggers the query and changes submission timing/ordering. Execution-side
    evidence comes from the external pg_stat_activity sampler (200 ms),
    request-latency samples, and process/host sampling instead.

PRODUCTION BEHAVIOR WHEN ENV UNSET: none (no wrap, no route). This is the smallest
research-only instrumentation sanctioned by #550 §10; it never alters query flow.
NEUTRALITY GATE (corrective-1): apps/api/src/lib/capacityResearch.neutrality.test.ts
proves against real PostgreSQL that (a) the baseline driver is lazy,
(b) Promise.resolve(query) DOES execute a lazy query, (c) the superseded
pre-corrective wrapper eagerly executed statements (defect characterized),
(d) the corrective wrapper preserves laziness, and (e) instrumentation OFF vs ON
produce identical server-side journals, returned values, transaction semantics,
and error propagation. The pre-corrective eager wrapper
(`void Promise.resolve(result).catch(...).finally(...)`) is SUPERSEDED — every
artifact produced while it was installed is marked
SUPERSEDED_PRE_CORRECTIVE_EVIDENCE (disposition files in results/).
```
