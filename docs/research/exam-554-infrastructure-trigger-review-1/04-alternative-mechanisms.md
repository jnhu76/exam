# #554 Alternative mechanisms

Mechanism candidates are compared per background workload and per responsibility BEFORE any
product choice. Definitions:

```text
M0 = current in-process reconciliation / discovery loops (stateless, DB-authoritative)
M1 = PostgreSQL durable work queue (jobs table, tx-enqueued, SKIP LOCKED claim, lease/retry/DLQ)
M2 = Redis-backed job queue
M3 = external MQ / broker (RabbitMQ, Kafka, SQS, BullMQ-on-Redis, …)
```

## Workload-by-workload mechanism audit

### W1 System-incident reconciliation (R5)

| Aspect | M0 current | M1 PG queue | M2 Redis queue | M3 MQ |
| --- | --- | --- | --- | --- |
| work source | canonical rows (episodes), re-derived every tick | would need enqueue at detection | same | same |
| durable input | yes (episodes are the durable fact) | queue rows ADDED as second fact | ephemeral + PG facts | broker log |
| claim authority | none needed (stateless, arbiter dedupe) | SKIP LOCKED lease | Redis lists/streams | broker |
| completion authority | arbiter unique + deep-equal payload (#304) | still #304 arbiter (queue row ≠ completion) | unclear — Redis loss orphans work | ack ≠ completion |
| crash recovery | trivial (stateless) | lease expiry machinery | Redis restart semantics | broker redelivery |
| O(history) discovery | yes — MEASURED 28 ms @1k, 1.1 s @50k, cliff FIXED | would reduce discovery to O(pending) — but #545 proves the full enumeration IS the smallest correctness-preserving candidate set (#304 arbiter requires it); enqueuing only at detection would MISS the #545 anti-horizon cases (240-day-old pending delivered) unless a reconciliation backstop is kept — i.e. M0 must stay anyway | same + Redis loss | same |
| verdict | **KEEP** — no measured trigger; M1 adds a second fact + machinery while still requiring M0 as backstop | not justified | REJECT (loss orphans durable work) | REJECT |

### W2 Deadline work (R6)

Discovery is O(active) (`listDeadlineCandidates`, E11) — the "queue" would hold at most the
live-attempt set it already scans in milliseconds. Deadline authority is re-checked under lock
per candidate (under-lock canonical decision), so queue rows would be a projection, not
authority (ADR-003 Class D caution). **KEEP M0.**

### W3 Email outbox (R7)

Already the reference Class A adoption (ADR-011): PostgreSQL transactional outbox, `SKIP LOCKED`
claim, lease + abandoned recovery, durable worker heartbeat. This IS M1's mechanism,
workload-scoped, landed and hardened. No second workload exists to share infrastructure with.
**KEEP (already M1-shaped, workload-specific).**

### W4 Presence / heartbeat observation (R3)

Candidate liveness (`last_activity_at` heartbeat) and durable disruption episodes are one
pipeline. The ephemeral-only shape Redis would serve does not match the product: episodes feed
interruption-time compensation and incidents (ADR-013/014). A Redis TTL hint could only ever be
an accelerative hint on top of the PG authority — and E20/E21 show the PG path consumes ~1–2%
of pool write capacity at the 200-candidate ceiling. **KEEP PG; REJECT_SEMANTIC_MISMATCH.**

### W5 Rate-limit coordination (R2)

Already the single ADOPTED Redis responsibility (ADR-001), bounded, TTL'd, HMAC-keyed, with
explicit off/optional/required semantics and #546 topology safety. **KEEP unchanged.**

## Alternative ladder applied (lowest mechanism first — no layer skipping)

| Problem (from 02) | L0 accept | L1 query/shape | L2 scheduling/batching | L3 PG-local | L4 existing Redis | L5 new Redis | L6 MQ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1/B2 O(history) reconciliation | ✔ measured 28 ms @ semester scale | index MEASURED/REJECTED (#545) | chunked probe LANDED (#545) | bounded discovery needs #304 authority change — open only via its own decision | — | — | — |
| B3 pool queueing under saturation | ✔ saturation is synthetic; production tails belong to #550 | trivial queries already; pool max=10 is a config value to re-prove at #550 | loop guards already prevent tick stacking | — | — | — | — |
| B4 readiness residual | ✔ caller bounded, correct 503 | single-flight probe / short-TTL cached result (candidates for a focused NON-INFRA follow-up) | probe budget already bounds callers | query cancellation is a driver limitation (postgres.js has no per-query cancel) | — | — | — |
| B6 transient writes | ✔ ~1–2% pool capacity at ceiling | — | batched flush already (5 s/20) | — | — | presence store REJECTED (semantics) | — |

Every problem stops at the lowest ladder layer that satisfies the measured property. No evidence
chain reaches L4–L6.

## Failure semantics table (for the mechanisms that were candidates)

| Failure | M0 current | M1 PG queue (hypothetical) | M2 Redis queue | M3 MQ |
| --- | --- | --- | --- | --- |
| component down | next tick resumes; convergence preserved (#545 T7) | worker down = lease expiry path needed | queue unavailable ⇒ durable work invisible or lost | broker down ⇒ delivery stalls; consumers idle |
| data loss/restart | nothing to lose (stateless) | queue rows durable | **work lost on Redis loss** (durable exam work must not live here) | broker retention policy governs; replay ≠ business state |
| duplicate delivery | arbiter dedupe (#304) | idempotent consumer still required | same + loss risk | at-least-once; ack≠completion |
| what degrades | bookkeeping latency | — | durable exam work correctness | — |
| who owns retry/completion | canonical state re-derives; arbiter owns completion | queue ≠ completion (must keep #304) | undefined ⇒ REJECT | undefined in scope ⇒ REJECT |

Operational cost model (new stateful dependency per mechanism):

| Mechanism | New stateful service | Backup needed | Can lose data? | Recovery complexity | Test complexity |
| --- | --- | --- | --- | --- | --- |
| M0 (current) | none (PostgreSQL only) | already required | no | existing | existing |
| M1 PG queue | none (new tables) | same PG | no (but second fact class) | lease/DLQ machinery + backstop anyway | new queue lifecycle tests |
| M2 Redis queue | Redis (profile) | no (ephemeral) | **loss = lost work** ⇒ disqualified for durable work | reconnect/rebuild semantics | Redis isolation per ADR-007 |
| M3 external MQ | broker service | broker persistence | broker-dependent | new ops surface (upgrade/auth/TLS/credentials/monitoring) | broker lifecycle in CI + E2E |

M2/M3 fail the completion-authority constraint outright (Issue #554: "transport acknowledgement
!= business completion", "Redis loss must not erase durable exam truth") for durable work: queue
ack ≠ completion, and Redis loss would erase or orphan work whose completion is only provable in
PostgreSQL. M1 is mechanically sound but unjustified by any measured trigger (02) and would not
replace M0's canonical discovery without a #304 authority change — the honest disposition is
DEFER with a concrete reopen trigger, not adoption.
