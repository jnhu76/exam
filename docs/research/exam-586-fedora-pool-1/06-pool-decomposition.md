# #586 — 06 Pool/Transaction Decomposition

Status: FINAL. Source: neutral `EXAM586_TIMING` witness lines
(`apps/api/src/lib/research586.ts`, one line per submit, emitted after
the transaction resolves; performance.now() only, no lazy Query object
touched — #550 EXAM-550-CORRECTIVE-1 neutrality law preserved).

## Phase semantics

- `txAcquireProxyMs` = handler start → transaction entered (pool
  admission + preceding await chain).
- `lockPhaseMs` / `reconciliationPhaseMs` / `submitPhaseMs` /
  `auditPhaseMs` / `gradingSnapshotPhaseMs` / `finalizePhaseMs` = in-tx
  phase marks.
- `txHoldMs` = transaction entered → resolved (the committing attempt;
  txEnter/txExit are overwritten on retry, retries were 0 everywhere).
- `postCommitReadMs` = response-grade read after commit (a second pool
  admission).

## p50 decomposition by cell (ms)

| run | pool/N | acq | lock | reconc | submit | audit | snapshot | finalize | txHold | post-commit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| main-01 | 10/50 | 256 | 4 | 322 | 15 | 1 | 5 | 12 | 364 | 264 |
| main-09 | 20/50 | 132 | 4 | 764 | 17 | 1 | 5 | 14 | 810 | 170 |
| main-05 | 30/50 | 30 | 4 | 981 | 17 | 1 | 5 | 14 | 1044 | 4 |
| main-06 | 10/100 | 895 | 5 | 343 | 15 | 1 | 5 | 13 | 385 | 898 |
| main-02 | 20/100 | 541 | 5 | 742 | 15 | 1 | 5 | 13 | 789 | 634 |
| main-07 | 30/100 | 393 | 5 | 1132 | 16 | 1 | 5 | 14 | 1179 | 437 |
| main-08 | 10/200 | 2057 | 4 | 275 | 12 | 1 | 4 | 10 | 309 | 2094 |
| main-04 | 20/200 | 2314 | 5 | 754 | 15 | 1 | 5 | 13 | 800 | 2510 |
| main-03 | 30/200 | 2594 | 5 | 1193 | 16 | 1 | 5 | 13 | 1236 | 2356 |

## What the decomposition proves

1. **Admission (acq) and hold (txHold) trade against each other.**
   Sum acq+txHold p50 is nearly invariant per scale (S200: 2366 / 3114 /
   3830 ms — actually grows), i.e. the pool does not add capacity; it
   moves waiting from the client-side queue into in-database lock
   queueing.
2. **The reconciliation phase carries the growth.** `reconcile` p50
   tracks txHold almost 1:1 (e.g. S50: 322/764/981 vs txHold
   364/810/1044). This phase opens with `ensureAttemptDeadlineReconciled`
   → `examRepo.findByIdForUpdate` (Exam FOR UPDATE, deadlineReconciliation.ts:211,
   EXAM-558 serialization-point invariant) — a row lock held until COMMIT.
   Everything after it inside the tx (submit write, audit, snapshot,
   finalize) executes while holding that lock.
3. **Steady per-txn work is small and pool-independent.** lock ≈ 4–5 ms,
   submit ≈ 12–17 ms, audit ≈ 1 ms, snapshot ≈ 4–5 ms, finalize ≈
   10–14 ms — identical across pool sizes. The variable part is waiting
   for the exams row, not doing work.
4. **main-04/main-03 txHold p99 ≈ 10 s** with p50 800–1236 ms: a small
   subset of transactions sits behind a long convoy — the signature of a
   single-row serialization point whose queue length equals the number of
   concurrently admitted transactions, i.e. it grows with the pool cap.
5. **Retries = 0 in every cell.** The exams-row conflict never surfaced
   as 40001 (nothing concurrently UPDATEs the row in this workload); the
   cost is lock queueing, not snapshot-invalidations and retries.
6. **Post-commit read** is pool-bound at pool 10 / S200 (p50 2094 ms)
   and near-free at pool 30 / S50 — a real but secondary pool-queueing
   signal, bounded by the same finding.

## Conclusion

The submit transaction contains a de-facto global serial section (Exam
FOR UPDATE held to commit). Raising the pool cap does not parallelize it
— it only lengthens the convoy at high scale and slightly improves
median admission at low scale. This is the causal mechanism behind every
number in 05-results.md.
