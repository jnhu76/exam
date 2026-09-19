# #550 Final capacity re-proof — 02 Methodology (frozen before the first canonical run)

## Load driver law (#6)

- The driver exercises the REAL HTTP stack (Fastify + full route/auth/serialization path).
  No engine-level call contributes to any classification.
- Every virtual candidate retains its own identity/session state (credentials, auth cookie,
  attempt id, per-candidate pacing state) for the whole run.
- Nothing is hidden: 429/409/5xx/timeouts/connection failures/partial completions are all
  recorded with their class. No automatic retry anywhere; the ONLY retries are the seeded
  setup path's bounded 429 backoff (fixture creation, never inside a measured phase, and
  itself recorded).
- Latency = full client-side request→response-body time (performance.now around the real
  HTTP round trip), same-machine rig caveat recorded in 00-environment.md.

## Scale matrix (#7) and phases (#8)

Canonical populations `N ∈ {20, 50, 100, 130, 200}` (S130 = historical pool-queueing tail
scale; S200 = stretch/evidence target, never a product promise).

Each lifecycle run exercises, in order, with metrics SEPARATED per phase (never one mixed
percentile across endpoints):

```text
A LOGIN_BURST    N simultaneous candidate logins (POST /api/auth/login, distinct identities)
B START_BURST    N simultaneous POST /api/attempts/:examId/start  (requireQueue=false exam)
C STEADY_SAVE    every candidate saves answers on an independent ~5 s ± jitter loop
                 (POST /api/attempts/:id/answers/:qid) for STEADY_SECONDS (90 s canonical);
                 answer payloads rotate across the exam's questions with versioned
                 conflict-protocol fields (clientSeq/baseVersion/clientSavedAt)
D HEARTBEAT      every candidate heartbeats on an independent ~15 s ± jitter loop, concurrent
                 with C (POST /api/attempts/:id/heartbeat)
E PROCTOR_READ   2 proctor identities poll GET /api/admin/exams/:id/proctor/attempts every
                 ~3 s plus per-attempt proctor-event reads every ~10 s, concurrent with C/D
F SUBMIT_BURST   N simultaneous POST /api/attempts/:id/submit (synchronous grading path)
G RECONNECT      poll silence ~15 s, then simultaneous restore: POST /start (existing attempt
                 → restore path) + GET /api/candidate/attempts/:id/take, then the FIRST
                 answer save after reconnection is recorded separately
```

Per phase and run, the summary reports `p50/p90/p95/p99/max` latency, success count,
semantic-error count (4xx other than 429/limiter), 429 count, 5xx count, timeout count, wall
time — plus pool/process/host observations (below). Raw per-request samples are always
retained (§Artifacts); summaries are regenerated from raw JSONL by `summarize.ts`, never
hand-copied.

## Correctness oracles (#9)

Checked from durable PostgreSQL authority after the relevant phases, per run:

```text
authenticated N == login success count
one active attempt per candidate (attempt uniqueness / no duplicate active attempt)
started count == start success count
saved answers sampled back from DB == payload the driver sent (versioned write accepted)
submit → terminal state == graded, exactly one terminal transition (no duplicate transitions)
deadline/openAt/closeAt semantics untouched by the run
no silent partial success: every HTTP success maps to durable truth (mismatch ⇒ FAIL)
```

## DB pool decomposition (#10 — mandatory; CORRECTED in EXAM-550-CORRECTIVE-1)

Distinguish pool acquisition/queueing from DB execution — with measurement
neutrality as the hard law: the instrumentation must never trigger a query,
change query ordering, change execution timing, alter the returned Query,
swallow/change errors, or change transaction semantics:

```text
in-process (env-gated research instrumentation, default OFF):
  statement ARRIVAL counts per snapshot window (neutral funnel counter —
  sql.unsafe call count only; the returned lazy Query is never touched);
  postgres.js pool CONFIG facts (max, idle_timeout, max_lifetime);
  NOT_DIRECTLY_OBSERVABLE in-process: per-statement in-flight / duration /
  errors — postgres.js v3 Query is a lazy thenable whose then/catch/finally
  (and Promise.resolve(thenable)) SUBMIT execution, so observing completion
  would change the phenomenon. The superseded pre-corrective wrapper did
  exactly that and all artifacts it produced are marked
  SUPERSEDED_PRE_CORRECTIVE_EVIDENCE.
server-side (driver sampler, separate connection):
  pg_stat_activity state counts (active / idle in transaction) for the run
  database at ~200 ms; lock-wait counts; backend PID/backend_start churn
  (soak) for connection-lifetime rotation.
derivation (server-side truth only):
  DB saturation = pg_stat_activity active+idle-in-transaction ≥ pool max (10)
  sustained in the sampling window (the harness sampler can add +1);
  queue-wait proxy = NOT_DIRECTLY_OBSERVABLE client-side; pool queueing is
  instead evidenced by request latency tails + saturated pg_stat_activity
  windows (the queue exists between the two and is never measured directly);
  request latency = queue-at-socket + app work + pool wait + DB exec
  (+ serialization) — the dominant term is REPORTED per phase
  (09-bottleneck-analysis.md), never guessed.
```

## Measurement neutrality gate (#10a — added by EXAM-550-CORRECTIVE-1)

Before any capacity measurement may be authoritative:
`apps/api/src/lib/capacityResearch.neutrality.test.ts` (real PostgreSQL,
deterministic, single-connection FIFO — no sleeps) must pass. It proves:
baseline driver laziness; that `Promise.resolve(query)` executes a lazy
query (the observation trap); that the superseded wrapper eagerly executed
statements (defect characterization); that the corrective wrapper preserves
laziness; and the OFF-vs-ON gate — identical server-side journal and
ordering, identical returned values, identical transaction behavior
(commit + rollback), identical error propagation (same PostgresError code),
and the wrapper counting exactly the outer-funnel arrivals with no extra DB
operation. Any future change to the instrumentation must keep this gate
green before new measurements are accepted.

## Admission KEEP_LAZY HTTP contract (#11)

Exactly the #549 ADMISSION_CAPACITY_SCENARIO on the live HTTP stack: requireQueue=true,
batchSize=20, batchInterval=15s; matrix `N ∈ {20,50,100,130,200} × Δt ∈ {15s, 90s,
ceil(N/20)·15s}`; procedure join burst → poll pause (real sleep) → resume burst → all-ready
start burst. Δt is measured from the earliest `joined_at` anchor read from the DB.
Oracle: `admitted_at count == min(waiting, (floor(Δt/15)+1)·20)`; preview ready count
agrees; unqualified starts fail closed (409); repeated polls cause ZERO extra CAS writes
(write-once). Queue and start phases get separate percentiles. Engine baseline for
cross-check only: N=200 full-eligible ≈417 ms wall, 0 errors (#549 02).

## Rate-limit topologies (#12) — see 01-topology.md state table

DIRECT_LAN (distinct loopback source IPs, production defaults) verifies per-candidate
limiter independence at S20/S50/S100. SHARED_NAT keeps the shared identity honestly and
measures 429 onset against the default budget. Trusted-proxy proves distinct XFF identity
restoration AND the two spoof-negatives (untrusted-peer XFF ignored; candidate-injected XFF
left of the genuine entry never selected). Degraded no-trust proxy is measured but labelled
DEGRADED_BY_CONFIG. Every state retains the audit-trail `ip_address` evidence.

## Long-lived dataset (#14) — composition, not only isolated queries

Semester-scale composition per run org: active exam + live attempts + old completed exams
with completed attempts + heartbeat/disruption episode history (≥ #545 S1 = 1,000
episodes/org, mixed completed/pending) + materialized incidents + unmaterialized eligible
episodes + client-event history (30-day window — the retention horizon; timestamps chosen so
#545's correctness result is not broken) + admission history. Exact cardinalities retained
(05). Checks: historical eligible episodes still converge; no duplicate materialization;
reconciliation tick latency (heartbeatMetrics tick deltas + DB-side query evidence);
composition effect measured as live S100 workload latency before/during ticks with the
reconciliation running IN the API process. The #545 index-recheck residual is answered with
EXPLAIN on this composition-realistic table.

## Reconnect storm (#16) — phase G above, at every canonical N; oracles: attempt identity
stable, no duplicate attempt, answer state preserved, server deadline authority unchanged,
heartbeat recovery, first-save-after-reconnect latency recorded.

## Readiness / alerting (#18) — DB healthy → down (container stop) → recovery (start):
`/api/health` stays 200 (liveness), `/api/ready` flips to 503 `not_ready` and back;
operability monitor emits `operability.readiness` alert transitions into the pino log
(#547 contract). Evidence = timestamped probe logs + API log excerpts (08).

## Machine saturation (#20) — sampled during every major phase at ≥1 Hz:
host loadavg, MemAvailable, per-process CPU%/RSS for API and driver, PostgreSQL container
CPU% (docker stats), Redis where relevant. Bottleneck classes: APP / DB_QUERY / DB_POOL /
HOST_CPU / HOST_MEMORY / RATE_LIMIT / LOCK / OTHER / UNKNOWN.

## Baseline discipline (#21) — the first canonical run at every scale uses the accepted
production-shaped settings above. No tuning before evidence is frozen. Any diagnostic
experiment is labelled NON_CANONICAL in results/ and can never replace canonical evidence.

## Artifacts (#23)

Per run: `results/<run_id>/meta.json` (config, topology, SHA, versions), `samples.jsonl`
(one record per request: scenario_id, run_id, timestamp, candidate, endpoint, phase, status,
latency_ms, error_class, timeout, retry_count, topology, N), `pool.jsonl` (research+
pg_stat_activity+host snapshots), `summary.json` (phase stats + durable `oracles`).
`summarize.ts`
regenerates all summaries from raw JSONL. API pino stdout retained under `logs/<run_id>.api.log.gz`
(lossless gzip of the runner's exact output; `zcat` restores it).

## Repeatability (#24 — reps strengthened by the human corrective review)

S20/S50/S100: ≥3 canonical lifecycle repetitions. S130/S200: ≥2 canonical
repetitions (both scales are boundary-relevant; the corrective review raised
this from ≥1). Run-to-run variance is reported. Soak (#19): one bounded ≥75 min
run crossing at least one postgres.js connection-lifetime rotation window; if
it were skipped, CONNECTION_LIFETIME_ROTATION_NOT_EXERCISED would be stated.

## Canonical mode law (EXAM-550-CORRECTIVE-1)

Every canonical run in every group starts the API with APP_MODE=production:
the production rate limiter is ON at default budgets (global 100/min/IP;
login route 10/min/IP) with the Redis-backed store (REDIS_MODE=optional,
Redis reachable — the #554 rate-limit responsibility). DIRECT_LAN candidates
bind distinct real loopback source IPs. No timeout widening, no rate-limit
budget inflation, no pool change, no background-loop change. If the production
limiter legitimately produces 429 anywhere, the 429s are retained, classified
per phase, and the limiter is NOT weakened. Any run that cannot satisfy this
law is not canonical, whatever else it shows.

## Proven "PROVEN" bar (#26)

No invented SLO. Accepted-envelope criteria: correctness oracles pass; zero 5xx; zero
timeouts; bounded pool queueing (no unbounded growth); stable across repetitions; operator
usability and candidate-visible latency reported as measured and judged for product
hostility explicitly. SUPPORTED_PRODUCTION_TARGET is stated only as number + topology +
configuration.
