# #586 — 09 Decision & Disposition

Status: FINAL. Inputs: 04 (A/A PASS), 05 (matrix), 06 (decomposition),
07 (lock analysis), 08 (resources), raw evidence in `results/`.

## Question asked

> On this Fedora server, using the real production Docker topology and
> Dockerized PostgreSQL, does increasing the application PostgreSQL pool
> from 10 to 20 or 30 materially reduce submit/grading tail latency — and
> if so, what is the smallest defensible bounded pool size?

## Answer

**No — at no tested scale does a larger pool materially reduce submit
tail latency, and at the largest scale it materially worsens it.**

| scale | pool 10 p99 | pool 20 p99 | pool 30 p99 | larger pool effect on p99 |
| --- | --- | --- | --- | --- |
| 50 | 2068 ms | 2358 ms | 2498 ms | slightly worse (≤ +21%) |
| 100 | 4284 ms | 4266 ms | 4400 ms | flat (≤ ±2.7%) |
| 200 | 6578 ms | 17940 ms | 17119 ms | **2.6–2.7× worse** |

Medians improve ~20–25% at N=50/100 with pools 20/30, but medians are
not the questioned quantity and the p99 — the decision variable per the
protocol — never improves beyond replicate noise, while N=200 degrades
by 2.7×.

## Why (mechanism, §6/§7 required decomposition)

- Client-side pool queueing: real and measurable (acq p99 up to 4793 ms
  at pool 10 / N=200), but only at pool 10 / largest scale.
- PostgreSQL execution: per-txn work is small and pool-independent
  (lock 4–5 ms, submit 12–17 ms, audit ~1 ms, snapshot 4–5 ms,
  finalize 10–14 ms); db CPU ≈ 1 core peak; WAL/IO wait low single
  digits.
- Transaction hold time: grows with pool size (txHold p50 364 → 810 →
  1044 ms at N=50; p99 443 → 10826 → 9786 ms at N=200) — the signature
  of in-database lock queueing, not compute.
- Row-lock contention: 94% of sampled lock waits are tuple waits on the
  single `exams` row, acquired by `examRepo.findByIdForUpdate` from
  `ensureAttemptDeadlineReconciled` inside every submit transaction and
  held to commit (EXAM-558 serialization-point invariant, Enrollment →
  Attempt → Exam lock order).
- PG CPU saturation: excluded (08).
- Serialization/deadlock retries: zero in every cell.

The submit transaction therefore contains a deliberate global serial
section. The pool cap decides how many transactions join the convoy
simultaneously: raising it converts client queue time into longer
in-database lock queues and strictly worsens the tail at high
concurrency.

## Disposition (§38)

**KEEP_POOL_10.**

- No pool size in {20, 30} satisfies "materially reduces tail latency"
  at any scale; the smallest defensible bounded pool is the one already
  deployed (postgres.js default 10). The A/A gate additionally showed
  explicit `10` ≡ implicit default, so even a pinning change buys
  nothing measurable.
- Nothing in this experiment authorizes a production pool change; no
  production file depends on `EXAM_586_RESEARCH_POOL_MAX` at runtime
  unless the env var is set (unset = canonical path; the seam is
  research-only and non-canonical).

## Structural follow-up candidates (NOT this experiment's disposition)

Recorded as candidate future issues, each requiring its own design and
authorization; none is implied as "the fix" by this experiment alone:

1. Shorten the serialization section: move audit + grading-entries
   materialization (and any other non-authority work) out of the
   Exam-FOR-UPDATE critical section without weakening the EXAM-558
   deadline-authority invariant (SHORTEN_TRANSACTION_BOUNDARY family).
2. A durable grading job queue decoupling candidate-facing commit from
   grading aggregation (ADOPT_POSTGRES_DURABLE_GRADING_JOB_QUEUE
   family) — interacts with ADR-008's freeze barrier and would need its
   own ADR.
3. Re-measure the tail after any such structural change with this same
   rig (harness retained).

## Known limitations / unknowns (§37)

- Single host, single hardware profile; results are for this class of
  deployment, not a universal constant.
- The workload is a 12-question true/false exam with deterministic
  answers — submit-path shape is production-like (same endpoints,
  limiter, freeze barrier), absolute numbers are not a capacity claim.
- N=200 is the tested ceiling; behavior beyond it (e.g. whether pool 10
  admission queueing eventually dominates the exams convoy) is unknown.
- The relation/query-text lock samplers were repaired after the main
  campaign; relation-level lock evidence comes from the two diagnostic
  runs (pool=20, N=200) — the exact worst-tail configuration — not from
  all nine matrix cells.
- One host-load incident mid-campaign (killed monitor shell) required
  re-running main-05; the interrupted attempt is retained as
  `/home/jnhu/exam-586/runs/main-05-interrupted-2043/` and the reported
  main-05 is a fresh VALID cell. No other cell was affected (campaign
  resume markers verified per-cell before restart).
- Collected `results/*/candidates.sql` are redacted copies: the
  experiment-only argon2id password hash column is replaced with a
  placeholder (secrets stay out of version control). Unredacted raws
  remain on the experiment host under `/home/jnhu/exam-586/runs/`.
