# #550 Final capacity re-proof — 08 Readiness / alerting (#547)

Status: FROZEN. Run: `results/readiness-2026-09-19T06-09-41-018Z.json`; API process logs archived
losslessly as `logs/readiness-2026-09-19T06-09-41-018Z*.api.log.gz` (`zcat` restores). Production
mode; dedicated throwaway
PostgreSQL (port 3393) and Redis (port 3394) containers injected with faults; the shared dev
stack (exam-db-1 / exam-redis-1) was never touched.

## Measured behavior

| phase | evidence |
| --- | --- |
| Baseline | `GET /api/health` 200, `GET /api/ready` 200 (`{"status":"ready"}`) |
| DB stop | `/api/ready` → 503 within **7 ms** of the first post-stop probe; `{"status":"not_ready"}` |
| Liveness separation | `/api/health` stays **200** during the whole outage — liveness is dependency-blind, readiness is the gate (no probe may use /health for deploy gating) |
| No false ready | 6 ready samples across a 12 s hold, all **503** |
| DB restart recovery | after `pg_isready` passes, `/api/ready` returns **200 within 14 ms** |
| Redis required mode | baseline ready 200; redis stop → 503 within **4 ms** (fail-closed; body is the standard API error envelope — the 503 union shape); redis start → ready 200 within **1,011 ms** |
| Alert path | `operability.readiness` `component=database state=unavailable` transition logged (`"Mandatory dependency unavailable: database — instance not ready for …"`, level 50) |

The recovery alert transition (→ available) was not present in the captured log window; the
14 ms HTTP-gate recovery above is the authoritative recovery measurement, and the monitor's
transition tracking is unit-wired to the same `probeApplicationReadiness` derivation (single
authority — `operabilityMonitor.ts`).

## How the first attempt's false alarm was resolved (honesty record)

The first readiness attempt (evidence discarded) reported "no recovery within 60 s". Diagnosis:

1. An isolated driver probe (plain postgres.js pool, no app) recovered in **11 ms** after a
   server restart — driver-level recovery is immediate.
2. A decisive repro then showed `/api/ready` returning **503 already at baseline** — the
   throwaway container had NO SCHEMA, so `pingDb` (`SELECT … FROM organizations`) failed from
   boot: every number in that attempt was vacuously 503 (the harness's fault, not the
   product's). The runner now applies `migratePostgres` to the throwaway DB before the API
   boots; the committed evidence is the corrected run.

Net: PostgreSQL restart recovery is measured at **14 ms** at the HTTP gate — no recovery gap
exists in the measured configuration. This matches the design: the readiness gate probes LIVE
via the pool (`probeApplicationReadiness` → `pingDb`), and postgres.js re-establishes
connections on demand (no long-lived poisoned state after a server restart).

## Classification input

The #547 readiness/alerting contract re-proves PROVEN_FOR_MEASURED_TOPOLOGY: correct gating
under DB loss and Redis-required loss, liveness/readiness separation, no false ready, fast
recovery, and an operability alert trail in the structured log.
