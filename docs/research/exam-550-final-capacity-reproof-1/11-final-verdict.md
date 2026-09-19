# #550 Final capacity re-proof — 11 Final verdict

Status: FROZEN — this is the closeout gate document for Issue #550 (final evidence gate of
#552 generic production hardening). Everything below derives from [00](00-environment.md)…
[10](10-adversarial-review.md) and the retained raw artifacts in `results/`; no claim in this
document exists without a named artifact. Supersedes nothing; all earlier docs stay as the
per-campaign frozen record.

## 1. Classifications (the only four allowed labels)

Capacity is a property of **number × topology × configuration on a measured machine**, never a
bare number. The single measured topology: **1 API instance (native Node/Fastify), PostgreSQL
18.4 container as sole durable authority, Redis 7 rate-limit coordination only, HTTP-polling
KEEP_LAZY admission (#549), pool max=10 (postgres.js default, never overridden), WSL2 host =
one machine shared by driver+API+DB+Redis** (#554 KEEP_CURRENT_ARCHITECTURE — no MQ, no event
bus, no cache; nothing adopted because nothing was decided away).

| target | classification | evidence |
| --- | --- | --- |
| Correctness 20/50/100 candidates (DIRECT_LAN) | **PROVEN_FOR_MEASURED_TOPOLOGY** | 13/13 canonical lifecycle runs: all durable oracles pass (login/submit == N, all `graded`, zero duplicates, zero answer mismatches, zero 5xx/timeout/429) — [04](04-results.md) |
| Correctness 130/200 candidates (DIRECT_LAN) | **PROVEN_FOR_MEASURED_TOPOLOGY** (correctness; S200 latency envelope below) | 2 canonical reps each; same oracles — [04](04-results.md) |
| S200 latency envelope on THIS machine | **NOT_PROVEN as a product promise** — reported as measured values only | login burst p99 ≈ 9.3 s; start ≈ 1.5 s; restore ≈ 1.2 s; steady p99 ≤ ~1.1 s (bimodal tails); submit burst p99 ≈ 6.5 s — [04](04-results.md), [09](09-bottleneck-analysis.md) |
| Behavior beyond S200 / multi-instance / production hardware | **NOT_PROVEN** (never claimed) | non-goals + [04](04-results.md) § What S200 does and does not prove |
| #549 KEEP_LAZY admission (N×Δt matrix) | **PROVEN_FOR_MEASURED_TOPOLOGY** | 15/15 scenarios: durable eligibility `min(waiting,(⌊Δt/15⌋+1)·20)` exact, fail-closed 409 == waiting−admitted, CAS write-once, resume burst ≤ ≈1.13 s wall at N200-dt150 — [06](06-admission-reconnect.md) |
| Reconnect/refresh storm absorption | **PROVEN_FOR_MEASURED_TOPOLOGY** | silence → simultaneous restore → first-save at every scale; p99 ≤ 1.76 s at S200; zero durable effect; version protocol intact — [06](06-admission-reconnect.md) |
| #546 DIRECT_LAN per-IP rate limiting | **PROVEN_FOR_MEASURED_TOPOLOGY** | 20/50/100: zero 429, 21/51/101 distinct audit IPs, per-IP budget isolation probe — [07](07-rate-limit-topology.md) |
| #546 SHARED_NAT | **SUPPORTED_WITH_POLICY** | shared 10/min login budget burns by the 11th simultaneous client — correct limiter behavior, honest operational note — [07](07-rate-limit-topology.md) |
| #546 reverse proxy WITH `TRUSTED_PROXY_CIDRS` | **PROVEN_FOR_MEASURED_TOPOLOGY** | identity restored (21/21), spoofed XFF ignored (direct + through-proxy), genuine entry always selected — [07](07-rate-limit-topology.md) |
| #546 reverse proxy WITHOUT `TRUSTED_PROXY_CIDRS` | **DEGRADED_BY_CONFIG** (config defect, not code defect) | all clients collapse to the proxy socket identity; 50% login loss measured at 20 simultaneous — [07](07-rate-limit-topology.md) |
| #545 long-lived composition dataset | **PROVEN_FOR_MEASURED_TOPOLOGY** | 1,200 episodes at semester scale: 300 pending → 0 (durable), 1,200 incidents, 0 conflicts; discovery query 2.4 ms with 93 buffer hits — index NOT warranted (planner measured), keep current structure — [05](05-long-lived-data.md) |
| #547 readiness/alerting | **PROVEN_FOR_MEASURED_TOPOLOGY** | /api/ready 503 within 7 ms of DB loss, /api/health stays 200 (separation), no false ready across the hold, recovery 200 within 14 ms, Redis-required fail-closed 4 ms / recovery 1,011 ms, operability alert trail — [08](08-readiness-alerting.md) |
| Connection-lifetime rotation (postgres.js max_lifetime 30–90 min randomized) | **PROVEN_FOR_MEASURED_TOPOLOGY** — `CONNECTION_LIFETIME_ROTATION_NOT_EXERCISED` does NOT apply | 95 min soak: 21 distinct backend PIDs, **17 lifetime retirements** (backend ages 30.2–55.7 min, inside the window), 37,877 requests zero errors, zero errors in every ±60 s retirement window, p50 23.5 / p99 46.2 ms, zero `level≥40` log lines — [05](05-long-lived-data.md) § soak |
| GitHub CI | **UNAVAILABLE_BILLING** — never reported as PASS or FAIL; local gates substitute (below) | [00](00-environment.md) |

## 2. Exact tested infrastructure topology

```text
API:       1 instance, native Node v24.15.0 (tsx), NOT containerized (same shape as the
           repo's own WSL E2E runner). APP_MODE=production for topology/readiness groups
           (limiter ON, default budgets: global 100/min/IP, login route 10/min/IP); the
           lifecycle/admission groups use APP_MODE=e2e (limiter off) — the limiter dimension
           is measured separately in the topology group.
PostgreSQL: 18.4 (postgres:18.4-bookworm container, docker-compose.dev.yml, port 5432) —
           sole durable authority. Readiness group used dedicated throwaway containers
           (ports 3393/3394) — the shared dev stack was never touched.
Redis:     7.4.10 (redis:7-alpine) — rate-limit coordination ONLY; REDIS_MODE=optional with
           REDIS_URL set; the required-mode degradation boundary exercised separately (08).
DB pool:   postgres.js default max=10 — canonical, never overridden anywhere.
Admission: KEEP_LAZY (#549): requireQueue=true, batchSize=20, batchInterval=15 s, demand-
           triggered CAS materialization; no scheduler, no MQ.
Background:all in-process loops enabled (heartbeat+incident reconcile 30 s, deadline
           scanner 30 s, client-event retention, operability monitor 15 s, email outbox).
Proxy:     in-harness host-side Node reverse proxy (127.0.0.1:8210, faithful
           $proxy_add_x_forwarded_for) — as-built after measuring that Docker published-port
           NAT erases client IPs and Docker Desktop host networking is ineffective (07 § rig
           deviations; failed nginx attempts retained as artifacts).
Driver:    native Node on the same host (single-machine rig — CPU/mem contention is sampled
           per phase and used in the bottleneck classification, never misattributed).
```

## 3. Resource envelope (metrics contract — memory/CPU/pool)

- **Memory**: during the S200 runs, host MemAvailable never fell below ≈ 9.4 GB (started ≈ 11.2
  GB); the pre-existing full swap partition is a watch item only (00) — no memory-saturation
  event in any phase (`pool-analysis.json` per run/phase).
- **CPU**: host load1 peaked at 2.77 (of 20 logical cores) during S200; the app-process CPU
  decomposition (argon2id login bursts 745–935%, DB CPU ≤ 59%) explains the latency envelope
  ([09](09-bottleneck-analysis.md)).
- **Pool**: `max=10` never changed; submission bursts saturate the pool by design
  (satFrac 1.0, queue depth to ≈ 185 statements at S200) — measured cost of the #554 decision,
  not tuned; steady state stays uncongested (satFrac ≤ 0.029).

## 4. LOCAL_VALIDATION — gates at HEAD (executed on the research branch, 2026-09-19)

GitHub CI = UNAVAILABLE_BILLING. Local gates substitute, all executed at the research HEAD with
the exact package.json commands; **all exit codes recorded**:

| gate | command (package.json source) | exit | outcome |
| --- | --- | ---: | --- |
| format | `pnpm format:check` | 0 | all files prettier-clean (research harness incl.; raw JSONL untouched by prettier by design) |
| code-quality lint | `pnpm lint` | 0 | passed |
| eslint | `pnpm lint:eslint` | 0 | `eslint . --max-warnings=0` clean |
| architecture | `pnpm lint:arch` | 0 | clean |
| typecheck | `pnpm typecheck` | 0 | 17/17 tasks |
| unit + component | `pnpm test` | 0 | 2,808 passed / 12 skipped (206 files + 2 skipped), full turbo pass |
| static bundle | `pnpm verify:static` | 0 | 14 pass / 0 fail (+ copy/env/contract/journal/ui gates inside) |
| full verify (static + coverage + build) | `pnpm verify` | 0 | coverage green under worker-database isolation; all 9 build tasks success |
| full Playwright E2E (WSL topology) | `bash scripts/e2e/run-wsl.sh` | 0 | 2/2 shards passed (parallel worker DBs, ports 3100/3101) |

No gate was reported PASS without being executed; no safety control was disabled to buy green.

## 5. What this evidence set does and does not mean

- Supported product capacity on the measured topology: **correctness proven through 200
  concurrent candidates** with the latency envelope in § 1; the operational reading is healthy
  steady state at every scale (p50 ≤ 30 ms, satFrac ≤ 0.029) with the two known, decomposed,
  policy-consistent burst costs (login = argon2id CPU, submit = pool max=10 queueing).
- NOT proven: production hardware behavior (WSL single machine, swap-full caveat),
  multi-instance behavior, >200 candidates, CI green. These are recorded as NOT_PROVEN /
  UNAVAILABLE_BILLING — not implied.
- All percentiles regenerate deterministically from raw per-request JSONL
  (`harness/summarize.ts` + drift checks: 14/14 `ok:true`; the single recorded partition note is
  the reconnect take-view split — [10](10-adversarial-review.md) M2). Raw artifacts: 13 lifecycle
  runs + 15 admission scenarios + 8 topology states + readiness + longlived + 95-min soak;
  server logs archived losslessly as `.api.log.gz`.

## 6. Status for Issue #550

READY_FOR_HUMAN_CAPACITY_REVIEW — evidence complete, adversarially reviewed (findings fixed,
[10](10-adversarial-review.md)), gates green locally. Research branch tip at closeout:
`8c2a93de` (over base `fbf5bd41`). Per the issue contract: this PR does NOT close #550 (human
capacity review decides the roadmap disposition); #582 (visual values) and #315
(high-assurance) are NOT started by this campaign.