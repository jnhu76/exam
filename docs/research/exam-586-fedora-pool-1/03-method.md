# #586 — 03 Method (Fedora production-Compose rig)

Status: FROZEN before treatment collection. Reuses #550 measurement
discipline (neutral observation, server-side truth, distinct identities,
production limiter) adapted to the Fedora production Docker topology.

## Experimental question

On the Fedora production Docker topology (web nginx edge → app container →
Dockerized PostgreSQL, driver on the same host), does raising the
application postgres.js pool cap from the implicit default 10 to 20 or 30
materially reduce submit/grading tail latency — and what is the smallest
defensible bounded pool size (knee, not maximum, §35)?

Single varied factor per cell: `EXAM_586_RESEARCH_POOL_MAX` ∈ {unset, 10,
20, 30}. Never co-varied with PostgreSQL settings, Docker limits, isolation,
grading semantics, or topology (§5, §26).

## Rig (all measured traffic enters the production ingress)

```text
driver container (harness image: node:24.15.0-bookworm-slim + iproute2,
                  cap_add NET_ADMIN, joins exam-net)
  binds each candidate's sockets to a DISTINCT secondary source IP
  (172.31.10.2 .. 172.31.10.251) — the #550 DIRECT_LAN identity law,
  re-derived for Docker: a HOST-originated connection to a published port
  is SNATed to the bridge gateway before nginx (measured and recorded in
  #550 07-rate-limit-topology.md rig deviations), so the driver runs ON the
  bridge where per-socket source addresses survive to nginx ($remote_addr).
        |
        v  http://web:80  (nginx routes /api/** unchanged, replaces XFF)
app container :3000  (TRUSTED_PROXY_CIDRS=172.31.0.0/16 → proxy-addr walk
                      returns the candidate's real source IP; runbook's
                      documented bundled-edge configuration)
        |
        v
db container (postgres:18.4-bookworm, never published)
```

- The published port 18080 remains the operator path (host health/readiness
  polling only); no measured request enters through it.
- Nginx identity law (deploy/nginx/web.conf): XFF is REPLACEd with
  `$remote_addr` — a client cannot forge its limiter identity; identity
  evidence per run = distinct `audit_logs.ip_address` count ≥ N + 0
  unexpected 429 (§13).

## Stack lifecycle per cell (fresh state, §18)

```text
new run dir + run env file (fresh POSTGRES_PASSWORD/JWT_SECRET, EXAM_PORT=18080,
  EXAM_DATA_ROOT=/home/jnhu/exam-586/runs/<run-id>/data)
docker compose -p exam-586 up db → healthy (fresh PG cluster in run data root)
docker compose -p exam-586 up app web → entrypoint runs canonical migrations,
  starts server; wait /api/ready via 127.0.0.1:18080
bootstrap-admin via docker compose exec (canonical production first-admin path)
driver setup mode: admin login → course + 12 true_false questions (score 10,
  deterministic standard answers) + warmup exam + main exam (timed_window 90min,
  window open, requireQueue=false, resultPublicationMode=immediate) → publish
host: seed candidate fixtures via psql (bulk SQL through docker exec;
  PostgreSQL is never published): N measured candidates + 1 warmup candidate,
  each = users + candidate_profiles + user_role_assignments(isPrimary) +
  exam_enrollments(assigned); one shared argon2id hash (experiment-only
  accounts, §21 — no real credentials)
driver measure mode → warm-up → measured burst (below)
host oracles via psql → correctness.json
samplers stopped; docker compose logs per service captured; SHA256SUMS
docker compose down; data root + all logs RETAINED under the run dir
```

## Workload semantics (§19/§20 — identical across every cell)

Adapted faithfully from the #550 lifecycle harness (12-question true_false
exam, production limiter ON with default budgets, one keep-alive connection
per candidate, distinct source identity per candidate):

```text
WARMUP (phase "setup", never treatment): warmup candidate full flow on the
  warmup exam: login → start → 1 save → heartbeat → submit; then fixed
  10 s stabilization interval (identical everywhere).
LOGIN_BURST: N candidates login concurrently (recorded; not the treatment).
START_BURST: N concurrent attempt starts (recorded).
ANSWER_PHASE: each candidate saves ALL 12 questions exactly once
  (baseVersion 0 → serverVersion 1), candidates staggered in waves of 20
  with 150 ms inter-wave spacing; deterministic answers:
  candidate i question q → ((i + q) mod 2) === 0; standard answer of
  question q = (q mod 2) === 0. Fixed pre-submit state per candidate:
  authenticated, in_progress attempt, 12 materialized answer rows.
STABILIZE: fixed 10 s (identical everywhere; heartbeat/save loops silent).
SUBMIT_BURST (THE TREATMENT): all N candidates POST submit concurrently;
  every request recorded with latency/status/timeout/error class.
ORACLE: durable checks via psql + HTTP evidence (below).
```

The submit path exercised is the objective auto-grading path (no
pending_manual), transaction graph per 01-submit-transaction-graph.md.

## Measurement

- Driver: per-request JSONL (`requests.jsonl`: run, pool, scale, candidate,
  endpoint, phase, status, latency_ms, timeout, error class, ts).
- App: one `EXAM586_TIMING` structured line per submit request AFTER its
  transaction resolves (per-request `timings.jsonl` is derived by joining
  on attemptId from the captured app log; raw lines stay in app.log).
  Fields: t_request_start→marks for tx acquire proxy, lock, reconciliation,
  submit, snapshot, finalize, tx hold/total, post-commit read, retries.
- PostgreSQL server truth: two long-lived `psql \watch 0.2` sessions INSIDE
  the db container (application_name=exam586-sampler, excluded from its own
  samples): (a) pg_stat_activity state/wait_event aggregates; (b) lock-wait
  sampler (pg_locks NOT GRANTED joined pg_stat_activity). → pg-activity.jsonl
- pg_stat_database counters before/after every burst → pg-before.json /
  pg-after.json (deltas; no statistics reset anywhere — §11).
- Docker: `docker stats --no-stream` (~1 s cadence, web/app/db) →
  docker-stats.jsonl; host load line per sample; docker inspect per container
  → docker-inspect.json (image digest, no CPU/mem limits = UNBOUNDED_BY_COMPOSE).
- Config witness: app startup `EXAM586_POOL` line records the seam mode and
  effective pool max per run (§28 "pool value cannot be verified" ⇒ INVALID).
- Postgres server facts per run: version + pg_settings extract (§5) →
  pg-facts.json (max_connections etc. — never varied).

## Correctness oracles (§30 — every cell)

```text
status counts: graded == N, no non-terminal leftovers
duplicate active attempts per candidate == 0
duplicate terminal transitions per (candidate, attemptNo) == 0
per-candidate score == deterministic expected score (12 × 10 grid, exact)
no candidate's attempt carries another's identity (attemptId↔candidateId
  mapping from enrollments checked against submissions)
audit distinct source IPs ≥ N (identity non-collapse evidence)
unexpected 429 == 0 (login 10/min/IP and global 100/min/IP respected via
  distinct identities; any 429 ⇒ cell INVALID — limiter is never weakened)
EXAM586_TIMING lines == N (instrumentation completeness)
```

Any oracle failure ⇒ the cell's performance result is DISQUALIFIED and the
run marked INVALID with the reason (§28/§30).

## Relation to #550 evidence (§38)

#550 (WSL2, host-native API, dev-compose PostgreSQL + Redis, 20 logical
cores) established: SUBMIT_BURST bottleneck = client-side pool queueing over
grading transactions (pgActive pinned ≈ ceiling, satFrac 0.85-0.92, DB CPU
≤ 77%, EA row locks secondary). #586 re-measures the SAME mechanism on the
Fedora production container topology with the pool cap as the treatment
variable. Qualitative mechanism comparisons only; no merged numbers, no
claim that either domain is universally representative.
