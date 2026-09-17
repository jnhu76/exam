# #554 Measurements

Scope: targeted pool-level probes that #545/#546/#547 did not already measure. Query-plan and
deployment evidence is REUSED from #545 (committed raw EXPLAIN under
`docs/research/exam-545-long-lived-reconciliation-1/plans/`) and #547
(`tests/deployment/readiness-gate.sh`) rather than re-measured.

## Method and environment

- Throwaway PostgreSQL 18.4 container (research-only, `postgres:18.4-bookworm`, tmpfs storage,
  deleted after the run), port 5554, DEFAULT server settings identical to the compose db
  (`max_connections=100`, `shared_buffers=128MB`, `work_mem=4MB`).
- Repo production migrations applied to the research instance; minimal fixture chain
  org → course → exam → 200 users/profiles/enrollments/attempts (`status='in_progress'`).
- Pool under test: `postgres(URL)` with NO options — byte-identical to the runtime pool shape
  (`packages/db/src/postgres.ts` passes no options; postgres.js 3.4.9, same version as prod).
- Readiness probe emulation mirrors `operabilityMonitor.ts` exactly: `Promise.race([ping,
  2000ms timer])`; ping = `SELECT id FROM organizations LIMIT 1` (`systemStatsRepo.pingDb`).
- Raw outputs committed: `experiments/p1-rp-results.json`, `experiments/lt-results.json`.
- Host: WSL2 x86_64, 20 CPU, 15 GiB — numbers are for mechanism characterization and
  order-of-magnitude margins, not absolute production latency.

## Experiment P1 — pool acquisition vs query execution (separated)

| Scenario | Probe total | Interpretation |
| --- | --- | --- |
| idle pool, 300 samples | p50 0.36 ms / p95 0.53 ms | execution + transport only |
| 5/10 connections held (3 s) | p50 ~0.9 ms | free capacity absorbs probes |
| 10/10 held (3 s) | first probe **2605 ms**, later probes ~1 ms | acquisition wait ≈ holder remaining hold; acquisition/execution ratio ≈ 7200× |
| 15 holders vs 10 | identical (2603 ms) | excess holders queue CLIENT-side; probe fate unchanged |

Cross-validation: `pg_stat_activity` showed 10 active sleepers during holds; pool-queued probes
were INVISIBLE server-side (they had not reached the server) — client-side queueing is the
mechanism, and it is unobservable from the database alone. Recorded as E28: production
POOL_QUEUE_TIME = NOT_DIRECTLY_OBSERVABLE, bounded by this experiment's mechanism.

## Experiment RP — readiness probe pool risk (#547 residual)

| Scenario | Caller behavior | Pool/server effect | Recovery |
| --- | --- | --- | --- |
| RP1 healthy DB, 1 probe | ready @1.1 ms | — | — |
| RP1 healthy, 100 concurrent | 100/100 ready, p50 5.1 ms, max 5.9 ms | all served from pool | — |
| RP2 full block (45 s, 10/10 held) | 5 benign probes (6/min cadence): 5× `timeout@~2001ms` (not_ready); 25-probe abusive burst: 25× `timeout@2001ms`, 0 errors | abandoned pings queue CLIENT-side (server-side pending statements: 0→1); a business query sharing the pool waited 44.6 s | after release: drain ≈ instant (≤1 sample), next probe ready @0.5 ms |
| RP3 slow DB (2.5 s/ping), benign 6/min | 6/6 `timeout@~2001ms` (correct: DB too slow ⇒ not_ready) | ≈0.25 connections held by abandoned pings | — |
| RP3 slow DB, abusive 100/min for 60 s | 100/100 `timeout` — callers never hang | pool occupancy steady **4/10** (= Little's law 100/60 × 2.5 s ≈ 4.2) | drains immediately at rate stop |

Materiality (combined with E13 limiter CODE bounds): benign supported-topology probe rate is
≈6/min (compose healthcheck 2/min + monitor internal 4/min) → ≤0.3 connections even with 2.5 s
pings. The 4/10-connection occupancy requires a sustained limiter-ceiling flood (100/min/IP)
during a slow-but-alive DB episode — an abusive, already-rate-limited scenario in which the
system is CORRECTLY reporting not_ready. Under a hard DB outage, connection attempts fail fast
instead (#547 A1/A2 evidence: pool reconnects ~4 s).

## Experiment L — lock contention

| Scenario | Result | Classification |
| --- | --- | --- |
| L1: 200 concurrent heartbeat-shaped txs (SELECT…FOR UPDATE + UPDATE) on DISTINCT attempts | zero `pg_locks` waits sampled; wall 144 ms; per-tx p50 96 ms = pool waves (200/10), not locks | NO_MATERIAL_CONTENTION |
| L2: 50 concurrent txs on the SAME attempt (20 ms in-tx work) | wall 1157 ms ≈ exact N×20 ms serialization | BOUNDED_EXPECTED_SERIALIZATION (production cadence: 1 heartbeat/attempt/30 s from one candidate — the scenario does not occur) |

## Experiment T — transient write volume (200-candidate worst case)

| Path | Production worst-case rate | Emulated worst-case cadence result | Margin |
| --- | --- | --- | --- |
| heartbeat UPDATE (`last_activity_at`, status-qualified) | 6.7 writes/s (200 cands / 30 s) | 2733 updates/s single-pool burst (p50 0.6 ms) | ~400× |
| client_events batch inserts (≤20 rows/batch, 5 s flush) | 40 batches/s = 800 rows/s | sustained the emulated 40 batches/s demand (measured 38.8/s incl. pacing), p50 2.23 ms/batch, max 8.8 ms (≈9% of one connection) | headroom derives from per-batch latency (≈10× at the fixed worst-case cadence); cadence itself is client-throttled with backoff |
| worker_heartbeats | 1 upsert/5 s | — | negligible |

Combined steady transient write load at 200 candidates ≈ 1–2% of one max=10 pool's measured
write capacity — two-plus orders of magnitude below any justification for moving presence-like
state out of PostgreSQL. Additionally the product DELIBERATELY treats disruption facts as
durable forensic evidence (E22), so an ephemeral presence store would be a semantic mismatch,
not just an unneeded optimization.

## Reused prior measurements (not re-run)

- #545 query plans + scale table (S1/S2/S3), cliff boundary proof, index A/B rejection —
  `docs/research/exam-545-long-lived-reconciliation-1/01-query-plans.md` (+ raw EXPLAIN JSON).
- #547 deployment evidence: readiness gate D1–D4 (`tests/deployment/readiness-gate.sh`),
  probe cost 0.75 ms, DB-loss/recovery behavior, compose healthcheck semantics.
- #546 topology characterization tests (committed, executable) — rate-limit identity across
  DIRECT_LAN / SHARED_NAT / trusted-proxy topologies.

## Reproduction

Research-only; not wired into any test/CI gate. Recreate with: throwaway 18.4 instance on an
unpublished port + repo migrations (`DATABASE_URL=… pnpm --filter @exam/db db:migrate`) +
minimal fixture inserts (organizations/courses/exams/users/candidate_profiles/exam_enrollments/
exam_attempts, 200 rows each) + the two probe scripts whose complete outputs are committed in
`experiments/`. The scripts themselves were run from `/tmp` (research-only, deliberately NOT
production runtime and NOT part of the repo's command surface).

## Honesty notes

- All probes ran pool-level (no Fastify/HTTP layer); HTTP adds bounded per-request overhead and
  the limiter bound is CODE-verified, not flood-tested end-to-end. Recorded as residual unknown.
- The research instance used tmpfs storage (no disk latency); P1/RP conclusions rest on
  acquisition-queue mechanics (wall-clock deltas), not storage throughput, so this does not
  affect the acquisition/execution separation or the caller-boundedness findings. T1/T2 margins
  are so large that storage latency cannot change their classification.
- Single run per scenario (no repeated trials); margins are orders of magnitude, so variance
  does not affect any classification here. #550 owns statistically defensible capacity numbers.
