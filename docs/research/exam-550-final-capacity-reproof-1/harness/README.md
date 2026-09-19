# #550 final capacity re-proof harness (RESEARCH ONLY)

HTTP-level load/capacity evidence driver for Issue #550. Nothing in this
directory runs in production; the only product-tree change on this branch is
the env-gated (CAPACITY_RESEARCH=1, default OFF) observation instrumentation
(`apps/api/src/lib/capacityResearch.ts` + route + two registration lines).

Everything measured here goes through the REAL HTTP stack (Fastify + auth +
routes + postgres.js pool max=10). The rig: driver + API + PostgreSQL 18.4 +
Redis 7 (docker-compose.dev.yml) on one WSL2 machine — evidence is bounded to
this topology (00-environment.md).

## Canonical configuration (frozen before the first run)

- DB pool: postgres.js default `max=10` — never overridden.
- Lifecycle/admission groups: `APP_MODE=e2e` (limiter off) — sanctioned by the
  #549 admission workload contract; the limiter dimension is measured
  separately in the topology group (`APP_MODE=production`, default budgets).
- Heartbeat/deadline: production defaults (60s timeout / 30s scan).
- All background loops + readiness/alerting enabled.

## Run

Every runner and analysis resolves its input/output paths from its own file
location (`harness/lib/config.ts`), so **cwd is irrelevant**; only the tsx
source path must be right. From ANY directory inside the repo:

```bash
HARNESS=$(git rev-parse --show-toplevel)/docs/research/exam-550-final-capacity-reproof-1/harness

# One canonical lifecycle run (phases: login/start burst, steady
# save+heartbeat+proctor, reconnect storm, submit burst, durable oracles)
pnpm --filter @exam/db exec tsx "$HARNESS/run-lifecycle.ts" \
  --n=100 --rep=1 --steady=90 --scenario=lifecycle

# #549 KEEP_LAZY admission matrix (15 scenarios, real sleep pauses)
pnpm --filter @exam/db exec tsx "$HARNESS/run-admission.ts"

# Rate-limit topologies (#546 contract)
pnpm --filter @exam/db exec tsx "$HARNESS/run-topology.ts"

# Long-lived composition dataset + live S100 interference (+ EXPLAIN re-check)
pnpm --filter @exam/db exec tsx "$HARNESS/run-longlived.ts"

# Readiness/alerting (DB down → recovery; Redis required-mode boundary)
pnpm --filter @exam/db exec tsx "$HARNESS/run-readiness.ts"

# Bounded soak crossing one connection-lifetime rotation (30–90 min window)
pnpm --filter @exam/db exec tsx "$HARNESS/run-soak.ts" \
  --minutes=95 --n=50

# Regenerate all summaries from raw JSONL (drift check vs committed summaries)
pnpm --filter @exam/db exec tsx "$HARNESS/summarize.ts" \
  "$(git rev-parse --show-toplevel)/docs/research/exam-550-final-capacity-reproof-1/results/lifecycle-"*

# Cross-run aggregate (burst/steady tables + oracle verdicts → results/aggregate-lifecycle.*)
pnpm --filter @exam/db exec tsx "$HARNESS/aggregate.ts"

# Pool decomposition per run → <run>/pool-analysis.json + results/pool-decomposition.md
pnpm --filter @exam/db exec tsx \
  "$HARNESS/analyze-pool.ts" \
  "$(git rev-parse --show-toplevel)"/docs/research/exam-550-final-capacity-reproof-1/results/lifecycle-*

# Connection-lifetime rotation analysis (soak) → <run>/rotation-analysis.json
pnpm --filter @exam/db exec tsx \
  "$HARNESS/analyze-rotation.ts" \
  "$(git rev-parse --show-toplevel)"/docs/research/exam-550-final-capacity-reproof-1/results/soak-S50-*
```

## Artifacts

- `results/<run_id>/samples.jsonl` — one record per request (scenario, run,
  ts, candidate, endpoint, phase, status, latency_ms, error_class, timeout,
  retry_count, topology, N). Raw truth; every reported percentile regenerates
  from this via `summarize.ts`.
- `results/<run_id>/pool.jsonl` — observations: `pgstat` (pg_stat_activity
  state counts + lock waits), `research` (in-process statement funnel
  counters, pool facts, RSS/CPU/event-loop, heartbeat/deadline loop metrics),
  `host` (loadavg, MemAvailable, PG container CPU), `phase` markers,
  `connections` (soak: backend PID/start churn for lifetime rotation).
- `results/<run_id>/summary.json` + `summary.regenerated.json` +
  `drift-check.json`.
- `logs/<run_id>.api.log.gz` — the API process's full pino stdout (server-side
  request logs incl. responseTime; operability.* alert events), archived
  losslessly with gzip -9 to keep the evidence branch light; `zcat` restores
  the exact stream the runner emitted.

## DB safety

All runs use the dedicated, name-guarded database `exam_550_e2e`, dropped and
recreated per run through the repo's own migration + seed path. No dev or
human database is ever touched.
