# #545 Query plans & long-lived dataset measurements

Environment: dedicated throwaway PostgreSQL 18.6 cluster (Ubuntu binaries, user-space,
`/tmp/exam545`, port 5545, `exam_test`), fresh per-experiment schema with the repo's production
Drizzle migrations. `shared_buffers=128MB`, `work_mem=4MB` (docker-image defaults), fsync on.
Warm-cache steady-state numbers (the reconciliation path runs every 30 s, so buffers are warm
between ticks); `read=0` in all plans. Harness: temporary vitest file (not committed), real
`reconcileSystemIncidents` production leg, plans saved raw under `/tmp/exam545/plans/`.

## Dataset shape (per scale org — anti-vacuity: dominated by settled history)

| Component | S1=1k | S2=10k | S3=50k |
| --- | --- | --- | --- |
| old completed (~180 d spread, bulk-committed System ops) | 962 | 9,844 | 49,193 |
| recent completed (≤ 3 d) | 30 | 700 | 700 … see note |
| pending recent | 2 | 20 | 100 |
| **pending historical (240 d old — C3/T3)** | 5 | 5 | 5 |
| operationId conflict (C4/T5) | 1 | 1 | 1 |
| human coexistence (C5/T6) | 1 | 1 | 1 |
| second organization (multi-org loop) | — | — | 61,003 total across orgs |

Plus one attempt/user/enrollment chain per episode (production join shape). Scales are
query-scaling evidence, not product promises: semester-realistic episode counts (hundreds per
org) sit far below S1; S3 models a multi-year accumulated history or a high-disruption deployment.

## Q1 — discovery (`listHeartbeatDetectedEpisodes`), EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)

| Scale | Server exec | Plan | Sort |
| --- | --- | --- | --- |
| S1 | 2.3 ms | 0.17 ms | quicksort 189 kB **memory** |
| S2 | 23.6 ms | 0.16 ms | quicksort 2,025 kB **memory** |
| S3 | 152.0 ms | 0.17 ms | **external merge 7,752 kB DISK** (temp blocks 969) |

BASE path at S2/S3 (raw artifacts in `plans/base-master/`): Bitmap Index→Heap Scan on
`attempt_interruption_events` (org prefix + detected/heartbeat filters) → nested-loop PK joins →
Sort. The raw S1 BASE plan file was accidentally overwritten during the post-fix runs; its S1
numbers above are from the same live run as the committed S2/S3 files, whose shape S1 shares
(Bitmap→Heap + in-memory quicksort). At S3 the sort spills to disk every tick (work_mem 4 MB) —
per-tick disk churn that grows linearly with history. No BASE index covers
`(organization_id, event_type='detected', detection_source='heartbeat_timeout') ORDER BY
occurred_at, interruption_id`. Wall clock from JS: 9.9 → 49 → 303 ms (S1→S3), i.e. transport +
N-row materialization dominates from S2 on.

## Q2 — arbiter probe (`listCommittedOperations`), N-element IN list

| Scale | ids | Server exec | Plan | Path |
| --- | --- | --- | --- | --- |
| S1 | 1,000 | 0.35 ms | 0.14 ms | Bitmap Index Scan `exam_incident_events_org_operation_unique` ✓ |
| S2 | 10,000 | 3.9 ms | 1.3 ms | same ✓ |
| S3 | 50,000 | 22.9 ms | 11.0 ms | same ✓ |

The probe is fully index-backed at every scale (raw S1 artifact committed at
`plans/base-master/q2-probe-s1000.json`; the S2/S3 raw files are ~0.7 MB / 3.7 MB —
overwhelmingly the 10k/50k-element placeholder list — so only their extracted numbers are
recorded here). The cost of the probe lives in transport: ~50 k placeholders (~700 kB SQL text)
+ returning the FULL canonical payload of every completed operation (≈ 21 MB jsonb at S3) →
measured JS-side wall 12 → 115 → 484 ms.

### Q2-cliff — hard failure boundary (proven, exact)

`postgres@3.4.9` throws client-side at `parameters.length >= 65534`
(`connection.js toBuffer`). The probe binds `1 + N`, therefore:

```text
N_ids = 65,532 → ok
N_ids = 65,533 → MAX_PARAMETERS_EXCEEDED (query never reaches the server)
```

At ≥ 65,533 historical episodes in ONE organization the probe throws EVERY tick;
`reconcileSystemIncidentsAcrossOrgs` classifies that as a discovery-level failure and skips the
org (`heartbeat.ts` catch) — **System incident delivery for that org stops permanently** while
history only grows. This is a hard correctness cliff, not a slow-down.

## Q3 — whole production reconciliation leg (real `reconcileSystemIncidents`)

| Scale | delivery pass | steady-state pass (converged tick) | heap Δ |
| --- | --- | --- | --- |
| S1 | 107 ms (created 8, conflict 1) | 27.9 ms | −13 MB |
| S2 | 434 ms (created 26, conflict 1) | 226.8 ms | 43.5 MB |
| S3 | 1,856 ms (created 106, conflict 1) | **1,220 ms** | 37.8 MB |

Semantics verified on every pass: `createdCount` == expected pending (8/26/106, including the
240-day-old pending historical episodes — T3 anti-horizon evidence); the conflict episode
surfaces `conflictCount=1` on EVERY pass, never silently skipped (C4/T5); the human-coexistence
episode always delivers (C5/T6); incidents/links counts reconcile exactly (S3: 50,001 incidents,
50,000 links).

Whole loop across all three orgs (61,003 episodes total, one tick): delivery 1,424 ms;
steady 1,418 ms — dominated by the S3 org (orgs processed sequentially).

## Interpretation

- At semester-realistic scale (S1) the current design costs ~30 ms per org per tick —
  KEEP_CURRENT territory.
- The algorithmic shape is O(total history) per org per tick in: rows scanned, rows sorted
  (disk spill ≥ ~40k episodes), payload bytes transferred, JS objects materialized, UUID-v5
  derivations. Growth is linear and unbounded, hitting the 30 s tick budget only at
  many-×50k-episode scale (or many large orgs).
- The 65,533-episode cliff is the one hard failure: below it the design is bounded enough,
  above it the System delivery leg is dead. No timestamp horizon would fix it; the probe
  transport is the defect, not the candidate set.

## Post-fix measurements (chunked probe landed; index REJECTED by plan evidence)

Candidate fix A (LANDED): `listCommittedOperations` probes in disjoint 10,000-id chunks
(`OPERATION_PROBE_BATCH`); the chunk union is provably identical to a single probe over the
committed arbiter rows at call time (ids unique per org, chunks disjoint). Removes the hard
cliff; probe wall time unchanged (chunked 459 ms vs single 479 ms at S3). Verified semantics on
the full leg: created == pending (8/26/106), conflict surfaces every pass, counts reconcile
exactly.

Candidate fix B (REJECTED): partial index
`attempt_interruption_events_org_occurred_hb_idx (organization_id, occurred_at, interruption_id)
WHERE event_type='detected' AND detection_source='heartbeat_timeout'`. Evidence
(`plans/idx-experiment/`, one S3 dataset, serial plans): WITHOUT the index the discovery plan is
bitmap + **disk-spilling sort** (147.0 ms server, temp 969); WITH the index the planner takes it
(125.7 ms server, plain Index Scan, no Sort, temp 0; 3.4 MB at 50k episodes) — but even when
taken, the index path is no better than the no-index path within run noise, on a dataset where
heartbeat-detected rows are ~100% of the table (synthetic fixtures insert `detected` events
only; a production table also carries restored/terminalized outcomes, operator-incident events,
and backfill rows, which lowers seq-scan selectivity and could only favor the index more — the
A/B therefore understates, not overstates, the index's benefit, and the benefit measured is
~0). A separate post-fix run with the index migration present and explicit ANALYZE
(`plans/chunked-probe/q1-discovery-s50000.json`) shows the planner refusing the index in favor
of a parallel Seq Scan + Sort (57.5 ms — parallel workers, not comparable to the serial numbers
above). Conclusion: no reliable plan-level benefit at measured scales → not landed. The sort
spill remains a bounded linear residual (57–152 ms and ~8 MB temp at 50k episodes),
documented for the #550 long-lived re-proof.

Full leg with the chunked probe (`plans/chunked-probe/summary.json`): steady-state pass
S1 29.4 ms / S2 215.3 ms / S3 1,058.4 ms; whole 3-org loop delivery 1,385 ms / steady 1,301 ms
— statistically identical to BASE (wall time was never the defect; the cliff and the plan shape
were). Raw plans under `plans/` (base-master = BASE master; idx-experiment = single-dataset
index A/B; chunked-probe = post-fix run).
