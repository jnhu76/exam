# #554 Bottleneck classification

Every candidate problem observed in the evidence is classified into the gate's root-cause
taxonomy. A workload may carry multiple classes; each class must be evidenced (01 ledger).
"NONE_OR_NOT_PROVEN" is a classification, not a failure.

| # | Candidate problem | Classification(s) | Evidence | Materiality at supported scale |
| --- | --- | --- | --- | --- |
| B1 | Incident reconciliation O(history) cost per org per tick | Q1 QUERY_COST + Q2 INDEX_OR_DATA_SHAPE (sort spill) — NOT Q6/Q10 | E08–E10 (#545 MEASURED + QUERY_PLAN) | Not material at semester scale (28 ms/tick @1k). Material only at many-×50k episodes/org or many large orgs (1.1–1.2 s/tick, disk spill). Cliff FIXED; no live failure mode. |
| B2 | Reconciliation discovery sort spills to disk ≥~40k episodes | Q2 INDEX_OR_DATA_SHAPE | E10 (#545 raw plans; index A/B measured ~0 benefit) | Bounded linear residual (57–152 ms, ~8 MB temp @50k). Index must not be silently resurrected; re-open only via #550 long-lived dataset with composition-realistic table. |
| B3 | DB connection pool queueing under saturation | Q3 DB_CONNECTION_POOL_QUEUEING | E12, E14, E23 | Only demonstrated under synthetic total saturation (all 10 connections held): acquisition dominates (2.6 s vs 0.36 ms execution). NOT demonstrated as a production bottleneck at supported load; #550's 130-user audit saw queueing TAILS (HISTORICAL_EVIDENCE, medium). Pool config (max=10) is a tuning dimension for #550, not an infrastructure-adoption trigger. |
| B4 | Readiness probe abandoned-ping accumulation (2 s caller budget does not cancel; no single-flight) | Q3 DB_CONNECTION_POOL_QUEUEING (bounded by limiter × query cost) | E13–E17 | Caller side fully bounded (measured `timeout@~2001ms` under full block AND 2.5 s slow DB). Pool side: 4/10 connections at limiter-ceiling abuse (100/min/IP) × 2.5 s pings; ~0.25 connections at benign cadence (~6 probes/min). Material only when an abusive rate AND pathologically slow-but-alive DB coexist — outside the supported benign envelope; and in that regime the DB already fails readiness (correct 503). NOT_PROVEN_IN_SUPPORTED_TOPOLOGY as a harm; residual is real and cheap to shrink at L1/L2 (non-infra). |
| B5 | Lock contention (heartbeat / scanner / admission) | NONE_OR_NOT_PROVEN (serialization is by design) | E18, E19, E06 | Cross-attempt: zero lock waits at 200-way concurrency. Same-attempt: exact bounded serialization (never occurs in production: 1 heartbeat/attempt/30 s, single candidate). Admission CAS + partial unique is contention-avoiding by construction. NO_MATERIAL_CONTENTION / BOUNDED_EXPECTED_SERIALIZATION. |
| B6 | High-frequency transient writes polluting durable path | Q5 HIGH_FREQUENCY_TRANSIENT_WRITES — classified, then measured NOT material | E20, E21, E22, E04 | Worst-case transient write set at 200 candidates: 6.7 heartbeat UPDATEs/s (~0.25% of measured single-pool throughput) + 800 client-event rows/s worst case (p50 2.2 ms/batch ≈ 9% of one connection). Redis presence would ALSO break the product's deliberate semantics: "presence" here is durable forensic evidence (interruption compensation, incidents), not ephemeral liveness. |
| B7 | Background job coordination (heartbeat/deadline/email/retention) | Q6 BACKGROUND_JOB_CONTENTION — none measured; mechanism question only | E07, E11, 00 map | Four loops, all short-tx, non-overlapping via promise guards; no measured contention; no durable-work backlog exists (loops are discovery-driven, not queue-driven). No ADOPT trigger. |
| B8 | Multi-instance coordination | Q7 MULTI_INSTANCE_COORDINATION — FUTURE/NOT_PROVEN | E05, E02 | Supported topology = 1 API instance. Forward trigger analysis only (06: D13). |
| B9 | Event fanout / push | Q8 EVENT_FANOUT_OR_PUSH — product does not exist in this scope | E04, ADR-002 | No SSE/WebSocket/multi-instance push anywhere; polling accepted by ADR-002 with unmet triggers. |
| B10 | Cacheable read hotspot | Q9 CACHEABLE_READ_HOTSPOT — none identified | E29 (UNKNOWN recorded honestly) | No measured (high QPS × high cost × staleness-tolerant) read path. Proctor dashboard polls are scoped, indexed projections at ≤200 candidates. |
| B11 | Durable work queueing (jobs table) | Q10 DURABLE_WORK_QUEUEING — no work class requires it | E07, E08, E11 | The only durable-work mechanism already exists (email outbox, ADR-011 Class A). Incident/deadline "work" is derived discovery from canonical state, not enqueued work; #545 proves full re-enumeration is the smallest correctness-preserving candidate set, so a jobs table would need a #304 authority change to even be correct. |
| B12 | External integration | Q11 EXTERNAL_INTEGRATION — does not exist in product scope | E04, E03, 00 map | No downstream consumers, no replay requirement, no export feed. |
| B13 | General DB load at target scale | Q1 — bounded | E09, E20–E24, #547 probes 0.75 ms | Sum of all steady-path costs at 200 candidates is orders of magnitude under pool/server capacity; the open question "does 130–200-user load show queueing tails?" is precisely #550's measurement mandate. |

## Classification summary

```text
MATERIAL AT MEASURED SCALES:            none
BOUNDED, SCALE-DEPENDENT (watch):       B1/B2 (O(history) reconciliation), B3/B4 (pool queueing)
                                        → explicit reopen triggers in 06; #550 owns the re-proof
NOT_PROVEN / NOT_PRESENT:               B5 locks, B7 job contention, B8 multi-instance,
                                        B9 fanout, B10 cache, B11 queueing, B12 integration
```

No classification in the material row reaches the bar for adopting new stateful infrastructure.
The two "watch" rows are consumed by reopen triggers and by #550's topology, not by adoption.
