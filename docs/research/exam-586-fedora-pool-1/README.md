# #586 — Fedora pool pressure experiment (research record)

Status: research record, complete for the executed scope. **Not** a
production decision: no production configuration depends on anything in
this directory (the one seam, `EXAM_586_RESEARCH_POOL_MAX`, is
research-only and inert when unset).

## Question

On a Fedora server running the production Docker topology (web nginx
edge → app → Dockerized PostgreSQL), does raising the application
postgres.js pool from the default 10 to 20 or 30 materially reduce
submit/grading tail latency — and if so, what is the smallest defensible
bounded pool size?

## Answer

`KEEP_POOL_10_FOR_CURRENT_SUBMIT_MECHANISM`. Under the currently measured
submit/deadline-lock mechanism, pools 20/30 show no tail improvement at
any tested scale and a large (2.6–2.7×) p99 degradation at N=200; the
mechanism is an Exam-row lock convoy (`FOR UPDATE` held to commit)
identified via three-layer sampler evidence. The finding is labeled
`HYPOTHESIS / FOLLOW-UP AUTHORIZED`; the follow-up lock-mode test lives
in the separate #558 research record.

## Documents

| file | content |
| --- | --- |
| `00-environment.md` | host, images, PostgreSQL, topology |
| `01-submit-transaction-graph.md` | submit transaction graph (as-built) |
| `02-experiment-schedule.md` | frozen schedule (A/A + 27 main bursts) + execution status |
| `03-method.md` | rig, lifecycle, measurement discipline |
| `04-aa-gate.md` | A/A gate verdict (PASS) |
| `05-results.md` | main matrix results (+ replication status) |
| `06-pool-decomposition.md` | per-phase timing decomposition |
| `07-lock-analysis.md` | hot-row / convoy mechanism (sampler evidence) |
| `08-resource-analysis.md` | CPU / wait / deadlock resources |
| `09-decision.md` | decision, mechanism finding, limitations |
| `10-evidence-ledger.md` | GENERATED run ledger + material policy (see `harness/make-ledger.mjs`) |
| `11-followup-boundary.md` | what #586 does and does not authorize |
| `harness/` | frozen rig: campaign, run-cell, driver, oracles, summarizer, ledger generator, collect script |
| `results/` | bounded per-run evidence (see material policy in the ledger) |

## Material policy

Git contains research source (docs + harness) and small normalized text
evidence. Raw per-request logs, database dumps and container logs stay on
the experiment host under `/home/jnhu/exam-586/runs/`, integrity-pinned
by each run's committed `SHA256SUMS`. See `10-evidence-ledger.md`.
