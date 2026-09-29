# #586 — 05 Main Matrix Results (3 pool sizes × 3 scales)

Status: FINAL. 9/9 cells VALID, zero invalid cells, no replacement runs
needed. Raw evidence per cell in `results/main-0X/` (per-run root on the
experiment host: `/home/jnhu/exam-586/runs/<run-id>/`).

## Matrix (http submit ms; EXAM586_TIMING join; sampler-derived PG stats)

| run | pool | N | rep | http p50 | p95 | p99 | acq p99 | txHold p50 | txHold p99 | pg active max | sat frac |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| main-01 | 10 | 50 | 1 | 1748 | 1982 | **2068** | 746 | 364 | 406 | 10 | 0.19 |
| main-09 | 20 | 50 | 3 | 1512 | 2271 | **2358** | 552 | 810 | 951 | 20 | 0.25 |
| main-05 | 30 | 50 | 2 | 1317 | 2413 | **2498** | 344 | 1044 | 1435 | 30 | 0.25 |
| main-06 | 10 | 100 | 2 | 4027 | 4129 | **4284** | 2446 | 385 | 506 | 10 | 0.31 |
| main-02 | 20 | 100 | 1 | 3569 | 4087 | **4266** | 2056 | 789 | 884 | 20 | 0.38 |
| main-07 | 30 | 100 | 3 | 3177 | 4211 | **4400** | 1782 | 1179 | 1382 | 30 | 0.38 |
| main-08 | 10 | 200 | 3 | 6420 | 6505 | **6578** | 4793 | 309 | 443 | 10 | 0.40 |
| main-04 | 20 | 200 | 2 | 17268 | 17504 | **17940** | 5455 | 800 | 10826 | 20 | 0.61 |
| main-03 | 30 | 200 | 1 | 16139 | 16762 | **17119** | 5688 | 1236 | 9786 | 31* | 0.59 |

\* main-03's sampler instant peaked at 31 active backends — one above the
pool cap — because `pg_stat_activity` also counts non-app backends
(e.g. autovacuum) active in that instant; app-side occupancy never
exceeded 30.

Every cell: submit 2xx = N/N, 429 = 0, 5xx = 0, timeouts = 0,
serialization/deadlock retries = 0, correctness oracle PASS (graded=N,
no duplicate active/terminal attempts, expected per-candidate scores and
answers, distinct candidate source IPs = N).

## Findings

1. **S50 — median improves modestly, tail worsens.** p50 1748 → 1512 →
   1317 ms (10 → 20 → 30), but p99 2068 → 2358 → 2498 ms. txHold p50
   grows 364 → 810 → 1044 ms: more PG concurrency buys median throughput
   and pays for it with longer per-transaction holds.
2. **S100 — p99 flat.** 4284 / 4266 / 4400 ms across 10/20/30 — no
   material difference (≤ 2.7%), well within the observed A/A replicate
   spread at this scale. p50 improves (4027 → 3177 ms) for the same
   reason as S50.
3. **S200 — larger pools make the tail dramatically WORSE.** p99:
   pool 10 = 6578 ms; pool 20 = 17940 ms; pool 30 = 17119 ms — a 2.6–2.7×
   degradation. txHold p99 explodes from 443 ms (pool 10) to ~10 s
   (pools 20/30). The saturation fraction rises 0.40 → 0.59–0.61.
4. **Post-commit grade read** (`postCommitReadMs`) shows the same shape
   (pool 10 / S200 p50 ≈ 2094 ms vs ≤ 437 ms elsewhere) — it re-queues on
   the same pool after the submit tx, so pool queueing is visible there,
   but it is a small fraction of the submit p99 and not the driver.

## Reading

The only cell where pool admission is the dominant visible queue is
pool 10 / S200 (acq p99 4793 ms ≈ 73% of http p99 6578 ms). Raising the
cap was expected to relieve exactly that queue. Instead, the released
concurrency re-materialized as ~10 s transaction holds (06) and the tail
got worse. Pool size is not the binding constraint at any tested scale;
the binding constraint is a single serialization point inside the
submit transaction (07).
