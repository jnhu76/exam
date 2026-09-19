# #550 Final capacity re-proof — 11 Final verdict

Status: FROZEN (corrective-1 evidence pass — this version supersedes the pre-corrective verdict
recorded at HEAD `ed37e0ce`, whose canonical runs measured APP_MODE=e2e; see
[12](12-corrective-1.md)). This is the closeout gate document for Issue #550 (final evidence
gate of #552 generic production hardening). Everything below derives from
[00](00-environment.md)…[10](10-adversarial-review.md), [12](12-corrective-1.md) and the raw
artifacts in `results/`; no claim in this document exists without a named artifact. Historical
pre-corrective artifacts are retained unmodified under
`SUPERSEDED_PRE_CORRECTIVE_EVIDENCE` markers — superseded, never deleted.

## 1. Classifications (the only four allowed labels)

Capacity is a property of **number × topology × configuration on a measured machine**, never a
bare number. The single measured topology: **1 API instance (native Node/Fastify), PostgreSQL
18.4 container as sole durable authority, Redis 7 rate-limit coordination only, HTTP-polling
KEEP_LAZY admission (#549), pool max=10 (postgres.js default, never overridden), WSL2 host =
one machine shared by driver+API+DB+Redis** (#554 KEEP_CURRENT_ARCHITECTURE — no MQ, no event
bus, no cache; nothing adopted because nothing was decided away). Every canonical run in this
verdict measured **APP_MODE=production with the rate limiter enabled at default budgets**
(login route 10/min/IP, global 100/min/IP) and the Redis store `ready` — the accepted #554
responsibility set.

| target | classification | evidence |
| --- | --- | --- |
| Correctness 20/50/100 candidates (DIRECT_LAN) | **PROVEN_FOR_MEASURED_TOPOLOGY** | 3 canonical reps each, production mode: all durable oracles pass (login/submit == N, all `graded`, zero duplicates, zero answer mismatches, zero 5xx/timeout/429), `auditDistinctIps` = N+1 in every run — [04](04-results.md) |
| Correctness 130/200 candidates (DIRECT_LAN) | **PROVEN_FOR_MEASURED_TOPOLOGY** (correctness; S200 latency envelope below) | 2 canonical reps each; same oracles — [04](04-results.md) |
| S200 latency envelope on THIS machine | **NOT_PROVEN as a product promise** — reported as measured values only | login burst p99 9,174 ms; start 1,523 ms; restore 1,107 ms; steady heartbeat p99 1,029 ms; submit burst p99 5,155 ms — [04](04-results.md), [09](09-bottleneck-analysis.md) |
| Behavior beyond S200 / multi-instance / production hardware | **NOT_PROVEN** (never claimed) | non-goals + [04](04-results.md) § What S200 does and does not prove |
| #549 KEEP_LAZY admission (N×Δt matrix) | **PROVEN_FOR_MEASURED_TOPOLOGY** | 15/15 runs (14 unique scenarios), production mode: durable eligibility `min(waiting,(⌊Δt/15⌋+1)·20)` exact, fail-closed start rejections == waiting−admitted in every scenario, CAS write-once, zero duplicate attempts; client resume walls at Δt>72 s are a driver reconnect artifact (server-side RESUME sojourn p50 ≤ 704 ms / max ≤ 854 ms) — [06](06-admission-reconnect.md) |
| Reconnect/refresh storm absorption | **PROVEN_FOR_MEASURED_TOPOLOGY** | silence → simultaneous restore → first-save at every scale; first-save p99 ≤ 1,620 ms at S200; zero durable effect; version protocol intact — [06](06-admission-reconnect.md) |
| #546 DIRECT_LAN per-IP rate limiting | **PROVEN_FOR_MEASURED_TOPOLOGY** — through S200 from the corrective canonical runs themselves | 13/13 lifecycle runs: zero 429, `auditDistinctIps` = N+1 (21/51/101/131/201) with per-IP budgets live; plus the retained production-mode topology probes (per-IP isolation, NAT/proxy states) — [04](04-results.md), [07](07-rate-limit-topology.md) |
| #546 SHARED_NAT | **SUPPORTED_WITH_POLICY** | shared 10/min login budget burns by the 11th simultaneous client — correct limiter behavior, honest operational note — [07](07-rate-limit-topology.md) |
| #546 reverse proxy WITH `TRUSTED_PROXY_CIDRS` | **PROVEN_FOR_MEASURED_TOPOLOGY** | identity restored (21/21), spoofed XFF ignored (direct + through-proxy), genuine entry always selected — [07](07-rate-limit-topology.md) |
| #546 reverse proxy WITHOUT `TRUSTED_PROXY_CIDRS` | **DEGRADED_BY_CONFIG** (config defect, not code defect) | all clients collapse to the proxy socket identity; 50% login loss measured at 20 simultaneous — [07](07-rate-limit-topology.md) |
| #545 long-lived composition dataset | **PROVEN_FOR_MEASURED_TOPOLOGY** | 1,200 episodes at semester scale: 300 pending → 0 (durable), 1,200 incidents, 0 conflicts; backlog tick 14.3 s once, then 40–54 ms settled ticks at full cardinality; discovery query 3.4 ms, planner unchanged with candidate index — index NOT warranted, keep current structure — [05](05-long-lived-data.md) |
| #547 readiness/alerting | **PROVEN_FOR_MEASURED_TOPOLOGY** | /api/ready 503 within 6 ms of DB loss, /api/health stays 200 (separation), no false ready across the hold, recovery 200 within 15 ms, Redis-required fail-closed 4 ms / recovery 1,010 ms, operability alert trail — [08](08-readiness-alerting.md) |
| Connection-lifetime rotation (postgres.js max_lifetime 30–90 min randomized) | **PROVEN_FOR_MEASURED_TOPOLOGY** — `CONNECTION_LIFETIME_ROTATION_NOT_EXERCISED` does NOT apply | 95 min production soak: 22 distinct backend PIDs, **17 lifetime retirements** (backend ages 34.5–59.3 min), 37,847 requests zero errors, **0 errors in every ±60 s retirement window**, p50 24.3 / p99 60 ms — [05](05-long-lived-data.md) § soak |
| CAPACITY_RESEARCH instrumentation measurement-neutrality | **PROVEN** (deterministic, sleep-free proof + OFF-vs-ON gate) | postgres.js `Query` laziness preserved; old eager-execution mechanism reproduced as a permanent regression test; identical journals/errors/identities with wrapper ON vs OFF — [12](12-corrective-1.md) § neutrality |
| Server stdout logging continuity across long runs | **NOT_A_PRODUCT_DEFECT — measurement hazard documented** | the one observed outage (95-min soak, 12.7 min in; serving unaffected) is root-caused to committing mid-run artifacts: the pre-commit lint-staged stash/restore replaced the log path under the API's long-lived stdout fd; bounded reproduction without concurrent git activity did not reproduce — [12](12-corrective-1.md) § Server-log outage |
| GitHub CI | **UNAVAILABLE_BILLING** — never reported as PASS or FAIL; local gates substitute (below) | [00](00-environment.md) |

## 2. Exact tested infrastructure topology

```text
API:       1 instance, native Node v24.15.0 (tsx), NOT containerized (same shape as the
           repo's own WSL E2E runner). APP_MODE=production for ALL canonical groups in this
           corrective pass (limiter ON, default budgets: global 100/min/IP, login route
           10/min/IP; Redis-backed store, REDIS_MODE=optional with REDIS_URL set and runtime
           state `ready`). CSRF Origin enforcement active (harness sends the allowed origin).
PostgreSQL: 18.4 (postgres:18.4-bookworm container, docker-compose.dev.yml, port 5432) —
           sole durable authority. Readiness group used dedicated throwaway containers
           (ports 3393/3394) — the shared dev stack was never touched.
Redis:     7.4.10 (redis:7-alpine) — rate-limit coordination ONLY; required-mode degradation
           boundary exercised separately (08).
DB pool:   postgres.js default max=10 — canonical, never overridden anywhere.
Admission: KEEP_LAZY (#549): requireQueue=true, batchSize=20, batchInterval=15 s, demand-
           triggered CAS materialization; no scheduler, no MQ.
Background:all in-process loops enabled (heartbeat+incident reconcile 30 s, deadline
           scanner 30 s, client-event retention, operability monitor 15 s, email outbox).
Identity:  DIRECT_LAN — every candidate client binds a DISTINCT loopback source IP
           (127.0.0.2…, real kernel socket peers), so the limiter's per-IP key and the audit
           trail see one distinct identity per candidate (verified per run: N+1 audit IPs).
Proxy:     in-harness host-side Node reverse proxy (127.0.0.1:8210, faithful
           $proxy_add_x_forwarded_for) — only for the retained #546 topology states (07).
Driver:    native Node on the same host (single-machine rig — CPU/mem contention is sampled
           per phase and used in the bottleneck classification, never misattributed).
```

## 3. Resource envelope (metrics contract — memory/CPU/pool)

- **Memory**: across all 13 corrective lifecycle runs, host MemAvailable never fell below
  ≈ 10.84 GB; the pre-existing full swap partition is a watch item only (00) — no
  memory-saturation event in any phase (`pool-analysis.json` per run/phase).
- **CPU**: host load1 peaked at 2.07 (of 20 logical cores); the app-process CPU decomposition
  (argon2id login bursts 862–949%, DB CPU ≤ 89% across phases, ≤ 77% during submit bursts)
  explains the latency envelope ([09](09-bottleneck-analysis.md)).
- **Pool**: `max=10` never changed; submission bursts saturate the pool by design
  (`pgActiveMax` pinned at 10 with lock waits ≤ 9) — measured cost of the #554 decision, not
  tuned; steady state stays uncongested (saturation fraction ≤ 0.016) and the event loop
  never became a bottleneck (p90 ≤ 1.7 ms in every phase of every run).

## 4. LOCAL_VALIDATION — gates at HEAD (corrective evidence branch, 2026-09-19)

GitHub CI = UNAVAILABLE_BILLING. Local gates substitute, executed at the corrective HEAD with
the exact package.json commands; **all exit codes recorded** —
[12](12-corrective-1.md) § Local validation carries the authoritative table for this pass.

## 5. What this evidence set does and does not mean

- Supported product capacity on the measured topology: **correctness proven through 200
  concurrent candidates with the production rate-limiting responsibility enabled**, with the
  latency envelope in § 1; the operational reading is healthy steady state at every scale
  (p50 ≤ 30 ms, saturation ≤ 0.016) with the two known, decomposed, policy-consistent burst
  costs (login = argon2id CPU, submit = pool max=10 queueing).
- NOT proven: production hardware behavior (WSL single machine, swap-full caveat),
  multi-instance behavior, >200 candidates, CI green. The one measurement anomaly (soak
  stdout outage) is root-caused to mid-run artifact commits — not the product — and its
  uncovered log window is stated as uncovered ([12](12-corrective-1.md)).
- All percentiles regenerate deterministically from raw per-request JSONL
  (`harness/summarize.ts` + drift checks: 13/13 lifecycle + longlived + soak `ok:true` under
  the corrective-1 campaign; the single recorded partition note is the reconnect take-view
  split — [10](10-adversarial-review.md) M2). Raw artifacts: 13 corrective lifecycle runs +
  15 corrective admission runs + retained topology states + readiness + longlived + 95-min
  soak; server logs archived losslessly as `.api.log.gz` (the corrective soak log is
  explicitly partial — see the logging-continuity row above).

## 6. Status for Issue #550

READY_FOR_HUMAN_CAPACITY_REVIEW — corrective evidence complete (EXAM-550-CORRECTIVE-1,
[12](12-corrective-1.md)), adversarially reviewed ([10](10-adversarial-review.md)), local
gates recorded. Per the issue contract: this PR does NOT close #550 (human capacity review
decides the roadmap disposition); #582 (visual values) and #315 (high-assurance) are NOT
started by this campaign.
