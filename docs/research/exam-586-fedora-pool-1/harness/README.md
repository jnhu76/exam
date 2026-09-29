# #586 harness (RESEARCH ONLY — exam-586-fedora-pool-1)

Load/capture rig for the Issue #586 Fedora pool-occupancy experiment. Nothing
here runs in production. The only product-tree change on this branch is the
env-gated research seam (`apps/api/src/lib/research586.ts` + the pool-seam
branch in `apps/api/src/plugins/db.ts` + neutral timing marks in the submit
route/orchestrator), inert unless `EXAM_586_RESEARCH_POOL_MAX` /
`EXAM_586_TIMING` are set.

## Components

- `driver.mjs` — one-off-container load driver (`setup` | `measure` modes).
  Real HTTP through the nginx edge (`http://web`), one keep-alive socket per
  candidate, each candidate bound to a DISTINCT secondary exam-net source IP
  (identity law; see 03-method.md for why host→published-port collapses).
- `Dockerfile.driver` — node:24 + iproute2 image for the above.
- `compose.586-research.yml` — compose override: forwards the two research
  env vars to `app`, pins the exam-net subnet. Never modifies production.
- `gen-seed.mjs` — fixture manifest + bulk candidate SQL (run via
  `docker compose exec -T db psql`; PostgreSQL is never published).
- `run-cell.sh` — one experiment cell end-to-end: fresh run dir/env/stack,
  bootstrap-admin, driver setup, seed, samplers, burst, oracles, checksums,
  teardown. Retains everything per run under `/home/jnhu/exam-586/runs/`.
- `oracles.mjs` — durable correctness oracles via psql (§30).
- `summarize586.mjs` — per-cell metrics derivation from raw evidence.
- `campaign.sh` — executes the frozen schedule from 02-experiment-schedule.md.

## Conventions

- Compose project: `exam-586` (isolated from any other deployment).
- `EXAM_PORT=18080` (non-production), data roots under
  `/home/jnhu/exam-586/runs/<run-id>/data` — never `./data`.
- The app prints one `EXAM586_POOL` witness line at startup (pool-mode
  evidence) and one `EXAM586_TIMING` line per submit AFTER its transaction
  resolves. Raw lines stay in each run's `app.log`.
- Raw evidence per run dir: `meta.json`, `requests.jsonl`, `app/web/db.log`,
  `pg-activity.jsonl`, `pg-locks.jsonl`, `docker-stats.txt`,
  `pg-before.json`/`pg-after.json`, `correctness.json`,
  `driver-summary.json`, `SHA256SUMS`.
