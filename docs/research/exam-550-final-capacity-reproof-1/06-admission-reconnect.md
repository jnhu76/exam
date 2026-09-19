# #550 Final capacity re-proof — 06 Admission (KEEP_LAZY) + reconnect storms

Status: FROZEN. Evidence for the #549 KEEP_LAZY HTTP admission contract under load and for
reconnect/refresh storm absorption. Raw per-request records: `results/admission-N<...>/samples.jsonl`
+ `results/admission-matrix-2026-09-19T03-33-15-408Z.json`; lifecycle reconnect phases in
`results/lifecycle-<run>/` (see [04](04-results.md)).

## Contract under test (unchanged by this campaign — #549 verdict KEEP_LAZY)

- `requireQueue=true` exams: candidates join a durable queue; admission is demand-triggered
  (queue poll + start gate), batch `batchSize=20` every `batchInterval=15 s`, CAS write-once
  `admitted_at` rows; eligibility at time Δt after the join anchor is
  `min(waiting, (⌊Δt/15⌋+1)·20)`. No background scheduler; no MQ; PostgreSQL is the authority.

## Matrix: N ∈ {20,50,100,130,200} × Δt ∈ {15 s, 90 s, ceil(N/20)·15 s}

Each scenario: fresh DB + fresh API in production shape; real join burst; durable anchor read
from PostgreSQL; real sleep to anchor+Δt; resume burst; start burst; extra no-op poll rounds;
durable oracle. 15/15 scenarios pass.

| scenario | expected eligible | admitted (durable) | ready-by-view | start OK | fail-closed 409 | resume wall (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| N20-dt15 | 20 | 20 | 20 | 20 | 0 | 100 / 105 |
| N20-dt90 | 20 | 20 | 20 | 20 | 0 | 109 |
| N50-dt15 | 40 | 40 | 40 | 40 | 10 | 287 |
| N50-dt90 | 50 | 50 | 50 | 50 | 0 | 335 |
| N50-dt45 | 50 | 50 | 50 | 50 | 0 | 295 |
| N100-dt15 | 40 | 40 | 40 | 40 | 60 | 541 |
| N100-dt90 | 100 | 100 | 100 | 100 | 0 | 587 |
| N100-dt75 | 100 | 100 | 100 | 100 | 0 | 581 |
| N130-dt15 | 40 | 40 | 40 | 40 | 90 | 685 |
| N130-dt90 | 130 | 130 | 130 | 130 | 0 | 766 |
| N130-dt105 | 130 | 130 | 130 | 130 | 0 | 720 |
| N200-dt15 | 40 | 40 | 40 | 40 | 160 | 984 |
| N200-dt90 | 140 | 140 | 140 | 140 | 60 | 1049 |
| N200-dt150 | 200 | 200 | 200 | 200 | 0 | 1133 |

(N20 has two Δt=15 s rows because ceil(20/20)·15 s = 15 s collapses onto the fixed candidate;
both are recorded.)

Properties proven, per scenario:

1. **Durable exactness**: `admitted_at` row count read from PostgreSQL equals the formula
   `min(waiting, (⌊Δt/15⌋+1)·20)` exactly — not approximately, exactly, including partial-batch
   cases (N50-dt15 admits 40 of 50; N200-dt90 admits 140 of 200).
2. **Fail-closed start gate**: candidates not yet eligible receive start rejection (409-class);
   the counts match `waiting − admitted` exactly (e.g. 160 at N200-dt15). No over-admission via
   the start path.
3. **CAS write-once**: extra poll rounds after convergence write nothing
   (`admittedAfterExtraPolls == admittedAfterResume`); no duplicate admissions.
4. **View consistency**: the queue-status view's ready count equals the durable count at every
   sample (no read-your-stale-admission divergence).
5. **Burst absorption**: the full resume burst at N200-dt150 (200 polls arriving at once after
   150 s of silence) completes in ≈ 1.13 s wall (the `resumeWallMs` field in
   `admission-matrix-2026-09-19T03-33-15-408Z.json`; also cited in [04](04-results.md)) with zero
   errors — same order as the engine's own baseline admission tick (~417 ms at 20 admissions).
   KEEP_LAZY demand-triggering absorbs the poll wave without a scheduler.
6. **End state**: all admitted candidates start (`in_progress` == admitted), zero duplicate
   active attempts, `waitingAfterRun == N − admitted`.

## Reconnect / refresh storms (lifecycle matrix)

Per lifecycle run the storm is: 15 s total silence (all N clients stop mid-exam), then one
simultaneous restore burst (start-restore + take view), then one simultaneous first-save burst.

| scale | restore burst p99 (ms) | first-save p99 (ms) | errors / timeouts | durable effect |
| --- | ---: | ---: | --- | --- |
| S20 | 110.8 | 188.8 | 0 | none — all resumes served from persisted attempts |
| S50 | 325.7 | 443.9 | 0 | none |
| S100 | 965.5 | 1194.6 | 0 | none |
| S130 | 760.9 | 1122.3 | 0 | none |
| S200 | 1207.6 | 1757.4 | 0 | none |

- Restore is served through the frozen snapshot path (start on an existing attempt returns the
  attempt with its persisted answers); no admission is involved for `requireQueue=false` exam
  shape used in the lifecycle scenario, and where the queue applies the § above bounds the
  admitted wave.
- First-save after reconnect uses fresh per-question versions taken from the restore response;
  zero `STALE_VERSION` rejections in the measured runs (version protocol intact across
  reconnects).
- Pool decomposition during restore (S130/S200): satFrac 0.33–0.5, mean queue depth ≈ 65
  statements, p99 ≤ 1.3 s — bounded and error-free without any admission or backpressure change
  ([04](04-results.md) § decomposition).

## Statement for the verdict

KEEP_LAZY admission is re-proven at N=200 with exact durable semantics and bounded latency on
this topology. Nothing in this campaign changed the #549 decision; the evidence retires the
"re-prove under load" residual with raw artifacts.
