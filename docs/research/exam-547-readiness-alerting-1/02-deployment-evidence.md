# EXAM-547 — Deployment evidence (BEFORE vs AFTER)

All measurements ran on this machine against the real production Compose
topology (isolated project, temp `EXAM_DATA_ROOT`, image built from the
checkout under test via `docker-compose.build.yml`, `pull_policy: build`).
Baseline ("before") details: [`00-baseline.md`](00-baseline.md).

- BEFORE base: `13457f9b` (master, PR #562 merge) — 2026-09-17, isolated
  project `exam547-base`.
- AFTER head: this branch — 2026-09-17, `bash tests/deployment/readiness-gate.sh 3`
  (run log kept in the PR description summary; every assertion below is the
  script's own bounded-polling PASS line).

## 1. The gap closed: running-state DB loss

| Signal (DB stopped while app running) | BEFORE (150 s window) | AFTER |
| --- | --- | --- |
| `GET /api/health` (liveness) | 200 the whole time | **200 the whole time** (unchanged — the layer split held) |
| `GET /api/ready` (readiness) | — (did not exist) | **503** (bounded poll; probe budget 2 s) |
| Docker health (`app` container) | **healthy for the entire 150 s** (F3-05) | **flips to `unhealthy`** (3 consecutive failing 30 s probes) |
| App container ID | unchanged | **unchanged** (asserted equal) |
| RestartCount | 0 | **0 — no silent auto-restart** |
| Active alert | none existed | **exactly ONE** `operability.readiness` `database/unavailable` error event; repeated evaluations silent (no storm — asserted by count == 1 over the whole DB-down window) |

## 2. Recovery without restart (D3)

| Signal | BEFORE | AFTER |
| --- | --- | --- |
| `docker compose start db` → DB-backed API healthy | ~4 s (measured) | readiness `200` + docker `healthy` within bounded poll (~1 probe interval) |
| App container | same, no restart | **same container ID, RestartCount still 0** (asserted) |
| Recovery alert | — | **exactly ONE** `operability.readiness` `database/recovered` info event |

## 3. Startup ordering (D1/D4, unchanged and now proven by the suite)

- `depends_on: db: condition: service_healthy` gates app start (compose
  output asserted: db `Waiting` → `Healthy` → app `Started`).
- Baseline A3 (unchanged by #547): an app started while DB is unreachable
  crash-loops on migrations BEFORE listening (never a false-ready listener);
  converges ~4 s after DB returns.
- D4: the operability monitor itself ran in the real topology (the D2/D3
  transitions were emitted by its tick) and reported zero self-failures.

## 4. Truthfulness statement (brief §13)

In the supported direct-LAN topology, Docker health status is an
orchestration/visibility signal. `app (unhealthy)` does NOT block candidate
traffic — nothing routes on it, and #547 adds no router/proxy. What it does
give: `docker compose ps` shows the truth during DB loss, dependent tooling
(e.g. CI `--wait`, orchestration scripts) sees the gate, and the operator
gets a machine-consumable transition event in the logs.

## 5. Re-executing the evidence

```bash
bash tests/deployment/readiness-gate.sh <run-number>   # D1–D4, bounded polling
pnpm test:deployment:readiness                          # wired alias
```

The suite fails with a diagnostics bundle (compose ps, bounded app/db log
tails, probe results, container id) if any expected state is not observed
within its deadline. It is part of `pnpm test:deployment` (after
compose-smoke).
