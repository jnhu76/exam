# #545 Final verdict

## VERDICT

```text
DESIGN: BATCH_ONLY (bounded probe transport)
PRODUCTION_CHANGE: listCommittedOperations probes the arbiter in disjoint
                   10,000-id chunks (OPERATION_PROBE_BATCH) — incidentRepo.ts
VERDICT: READY_FOR_HUMAN_REVIEW
```

Discovery candidate semantics are UNCHANGED — deliberately. Stage B
(02-correctness-boundary.md) proves the full enumeration of committed
heartbeat-detected episodes IS the smallest correctness-preserving candidate
set: every SQL-side exclusion surrogate weakens the frozen arbiter predicate or
duplicates the UUID-v5 authority derivation.

## BASELINE_COMPLEXITY

O(total historical heartbeat episodes) per organization per 30 s tick:
full-history discovery scan + sort, N-element IN-list probe, N UUID-v5
derivations, N episode objects + M committed-payload objects in JS.

## QUERY_PLAN

- Discovery: Bitmap/Index scan or Seq Scan (planner-dependent) + PK nested-loop
  joins + Sort; the sort spills to disk (external merge, temp blocks) once
  history passes ~40k episodes — bounded, linear residual.
- Probe: fully index-backed by `exam_incident_events_org_operation_unique` at
  every scale (22.9 ms server at 50k ids).

## SEMESTER_SCALE_COST

| Scale (episodes/org) | steady tick | delivery pass |
| --- | --- | --- |
| S1 = 1,000 | 28–29 ms | ~107–128 ms |
| S2 = 10,000 | 215–227 ms | ~416–538 ms |
| S3 = 50,000 | 1,058–1,220 ms | ~1,856–2,253 ms |

(Ranges span the BASE run and the committed post-fix run
`plans/chunked-probe/summary.json` — wall time is unchanged within run noise.)
Semester-realistic deployments (hundreds of episodes) sit far below S1. S3
models multi-year accumulation. Numbers are warm steady-state, single org;
orgs loop sequentially within a tick (measured 3-org whole loop ≈ sum).

## MEASURED_BOTTLENECK

Not wall time — a hard failure cliff: `postgres.js` throws client-side at
≥65,534 bound parameters, so from **65,533 historical episodes in one org** the
probe fails EVERY tick, the org is skipped by the discovery-level catch, and
System incident delivery stops permanently (history only grows). Proven at the
exact boundary (65,532 ok / 65,533 `MAX_PARAMETERS_EXCEEDED`).

## CORRECTNESS_BOUNDARY

- historical completed: excluded from delivery by the full
  `isMatchingCommittedOperation` arbiter check (unchanged); still enumerated
  every tick by design.
- historical pending (240-day-old fixtures, C3/T3): still discovered and
  delivered — no time horizon anywhere.
- conflicts (C4/T5): the human event committed under a derived operationId
  surfaces `conflictCount=1` on EVERY pass, never silently skipped.
- human coexistence (C5/T6): human incident + human link never satisfy System
  completion; the System incident still delivers.
- restart (T4): no cursor or process-local state introduced; reconciliation
  stays stateless per #304 — nothing to lose, `KEEP` trivially.

## PRODUCTION_CHANGE

`listCommittedOperations` (packages/db/src/repository/incidentRepo.ts): loop
over disjoint `OPERATION_PROBE_BATCH = 10_000`-id chunks, union into the same
Map. Chunk union ≡ single probe: chunks are disjoint and
`(organization_id, operation_id)` is unique on the arbiter. Semantics,
authority, and per-cycle statelessness unchanged. The cliff is now at
batch-size multiples with wide protocol headroom (10,000 ≪ 65,532).

## BEFORE_AFTER

- rows examined / returned / plan: unchanged by construction (same queries,
  same predicates, same arbiter unique; probe split into ≤10k-id statements).
- probe wall at S3: 479 ms single vs 459 ms chunked — no regression.
- whole-leg wall: unchanged within run noise (table above).
- failure behavior: org with ≥65,533 episodes now converges (chunked) instead
  of failing delivery permanently.
- index candidate: REJECTED — planner does not reliably use it in the
  representative regime (details in 01-query-plans.md); landed nothing.

## CORRECTNESS_TESTS

T-numbers follow the #545 execution-protocol regression matrix: T1 new pending,
T2 completed history, T3 historical pending, T4 restart, T5 operationId
collision, T6 human coexistence, T7 concurrent reconcilers, T8 anti-starvation.

- T1/T2/T7: existing `apps/api/src/orchestrators/systemIncidentDelivery.test.ts`
  C1 (new pending → exactly one), C1-second-pass + C6 steady cycles (no
  duplicates), C3 (concurrent reconcilers converge via arbiter).
- T3: new repo test `listHeartbeatDetectedEpisodes keeps year-old episodes
  discoverable — age is never a horizon` + 240-day-old pending fixtures
  delivered in the scale experiment.
- T4: N/A — no batching/cursor/performance state on the discovery path (probe
  chunking is per-call transport, no cross-call state).
- T5: existing C5 (collision → visible IdempotencyConflictError every cycle).
- T6: existing C4 (human coexistence) + human-coexistence fixture delivered at
  every scale.
- T8 (anti-starvation): discovery enumerates ALL committed heartbeat episodes
  every tick — no bound to starve behind; C6 storm re-proves pending convergence
  behind a large completed history; scale experiment proves 5 pending episodes
  behind 49,894 completed converge. New repo test proves the chunked probe
  unions across the batch boundary exactly like a single probe.

## PERFORMANCE_EVIDENCE

docs/research/exam-545-long-lived-reconciliation-1/01-query-plans.md +
raw EXPLAIN JSON under plans/ (base-master/ = BASE master, idx-experiment/ =
single-dataset index A/B, chunked-probe/ = post-fix run).

## DB_POOL / SCANNER_IMPACT

- Probe chunking adds at most ⌈N/10,000⌉−1 extra sequential queries per org per
  tick (0 for N ≤ 10,000; 5 at N = 50,000) — negligible vs the 30 s interval.
- No change to connection hold times (per-query checkout unchanged), no new
  transactions, no tick-overlap change (activeScan guard untouched).
- Wall time per tick unchanged within noise → pool contention not worsened.

## FRESH_ADVERSARIAL_REVIEW

See 04-adversarial-review.md (fresh-context reviewer over Issue #545, #304
authority contract, diff, and evidence).

## RESIDUAL_UNKNOWNS

1. Linear O(history) per-tick cost stands (unchanged from BASE by design — the
   smallest correctness-preserving candidate set). At ~50k episodes/org the
   steady tick costs ~1.1 s with a bounded sort spill; deployments reaching
   many-×50k per org or many large orgs should re-open bounded discovery via
   #550's long-lived re-proof (an SQL-side reduction needs the #304 authority
   decision its absence currently protects).
2. The chunk size 10,000 is a constant with ~6.5× protocol headroom; a driver
   change to postgres.js would not silently break it (failures stay loud).
3. Planner statistics regimes (stale vs analyzed) flip the discovery plan
   between bitmap/sort and seq/sort; both are bounded and warm-cache fast at
   supported scales.
4. The index A/B ran on a table composed only of heartbeat-detected events
   (~100% selectivity). A production table also carries restored/terminalized
   outcomes, operator-incident events, and backfill rows, which would lower
   seq-scan selectivity; the measured index benefit was ~0 even so. Re-check
   the index decision at #550 with a composition-realistic dataset rather than
   treating this rejection as final.

## SCALE-MATRIX NOTE

S1–S3 are query-scaling evidence, not product promises: heartbeat episodes
accrue only from real disruption events (heartbeat timeouts during attempts);
semester-scale counts are orders of magnitude below S1.
