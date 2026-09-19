# #550 Final capacity re-proof — 06 Admission (KEEP_LAZY) + reconnect storms

Status: FROZEN, **re-frozen by EXAM-550-CORRECTIVE-1**. Evidence for the #549 KEEP_LAZY HTTP
admission contract under load and for reconnect/refresh storm absorption — now exercised under
the ACCEPTED FINAL TOPOLOGY: APP_MODE=production (limiter ON, default budgets, Redis-backed
store) with every candidate on a distinct real loopback source identity. Raw per-request
records: `results/admission-N<...>/samples.jsonl` (campaign `corrective-1`) +
`results/admission-matrix-2026-09-19T11-29-35-150Z.json`; lifecycle reconnect phases in
`results/lifecycle-<run>/` (see [04](04-results.md)). Pre-corrective e2e-mode artifacts are
marked SUPERSEDED_PRE_CORRECTIVE_EVIDENCE.

## Contract under test (unchanged by this campaign — #549 verdict KEEP_LAZY)

- `requireQueue=true` exams: candidates join a durable queue; admission is demand-triggered
  (queue poll + start gate), batch `batchSize=20` every `batchInterval=15 s`, CAS write-once
  `admitted_at` rows; eligibility at time Δt after the join anchor is
  `min(waiting, (⌊Δt/15⌋+1)·20)`. No background scheduler; no MQ; PostgreSQL is the authority.
- KEEP_LAZY semantics were NOT changed by the corrective; only the measured topology was
  (production limiter + distinct identities).

## Matrix: N ∈ {20,50,100,130,200} × Δt ∈ {15 s, 90 s, ceil(N/20)·15 s}

Each scenario: fresh DB + fresh API in production mode; real join burst; durable anchor read
from PostgreSQL; real sleep to anchor+Δt; resume burst; start burst; extra no-op poll rounds;
durable oracle. **15/15 scenarios pass.**

| scenario | expected eligible | admitted (durable) | ready-by-view | start OK | fail-closed 409 | resume wall client (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| N20-dt15 | 20 | 20 | 20 | 20 | 0 | 93 |
| N20-dt90 | 20 | 20 | 20 | 20 | 0 | 503 |
| N20-dt15 | 20 | 20 | 20 | 20 | 0 | 94 |
| N50-dt15 | 40 | 40 | 40 | 40 | 10 | 194 |
| N50-dt90 | 50 | 50 | 50 | 50 | 0 | 1294 |
| N50-dt45 | 50 | 50 | 50 | 50 | 0 | 202 |
| N100-dt15 | 40 | 40 | 40 | 40 | 60 | 435 |
| N100-dt90 | 100 | 100 | 100 | 100 | 0 | 2560 |
| N100-dt75 | 100 | 100 | 100 | 100 | 0 | 2607 |
| N130-dt15 | 40 | 40 | 40 | 40 | 90 | 520 |
| N130-dt90 | 130 | 130 | 130 | 130 | 0 | 3331 |
| N130-dt105 | 130 | 130 | 130 | 130 | 0 | 3457 |
| N200-dt15 | 40 | 40 | 40 | 40 | 160 | 794 |
| N200-dt90 | 140 | 140 | 140 | 140 | 60 | 5031 |
| N200-dt150 | 200 | 200 | 200 | 200 | 0 | 5144 |

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
5. **Burst absorption — server-side service time is the authority**: joined pino request logs
   (`results/admission-server-sojourn-corrective-1.json`) show every queue-poll wave completing
   server-side in ≤ 0.9 s at every scale (N200 resume/poll p50 ≈ 0.67–0.70 s, max ≤ 0.85 s),
   with the DB mostly idle and zero lock waits. The LARGER client-side resume walls at
   Δt > 72 s (e.g. N200-dt150 ≈ 5.1 s client) are a measured DRIVER-side reconnect artifact:
   Fastify's 72 s server keep-alive closes all sockets during pauses longer than 72 s — the
   same reconnection a real browser performs after 150 s of silence — and the driver
   serializes those N reconnects at ≈ 21 ms each (both driver-side observer loops stall for
   exactly that window; the API's own CPU and the DB are idle during it). At Δt ≤ 72 s driver
   and server views agree (N200-dt15: ≈ 0.79 s client / ≈ 0.67 s server). Zero errors, zero
   429, zero timeouts in every burst. KEEP_LAZY demand-triggering absorbs the poll wave without
   a scheduler.
6. **End state**: all admitted candidates start (`in_progress` == admitted), zero duplicate
   active attempts, `waitingAfterRun == N − admitted`.
7. **Limiter reality**: every scenario ran with the production limiter ON (Redis-backed store;
   `measured_topology` stamps in each run's `pool-analysis.json`); the pause/resume poll
   pattern stays far inside the default per-IP budgets because each candidate is a distinct
   identity — 429 count across the whole matrix: 0.

## Reconnect / refresh storms (lifecycle matrix, corrective runs)

Per lifecycle run the storm is: 15 s total silence (all N clients stop mid-exam), then one
simultaneous restore burst (start-restore + take view), then one simultaneous first-save burst.

| scale | restore burst p99 (ms) | take-view p99 (ms) | first-save p99 (ms) | errors / timeouts | durable effect |
| --- | ---: | ---: | ---: | --- | --- |
| S20 | 284.9 | 255.3 | 338.8 | 0 | none — all resumes served from persisted attempts |
| S50 | 319 | 226.2 | 496.8 | 0 | none |
| S100 | 598.1 | 392.7 | 826.6 | 0 | none |
| S130 | 764.2 | 513.8 | 1102.5 | 0 | none |
| S200 | 1107 | 763 | 1619.8 | 0 | none |

(15 s of silence stays inside the server's 72 s keep-alive window, so these restores reuse the
existing connections — no reconnect storm; the Δt > 72 s reconnect case is the admission
matrix's, characterized above.)

- Restore is served through the frozen snapshot path (start on an existing attempt returns the
  attempt with its persisted answers); no admission is involved for `requireQueue=false` exam
  shape used in the lifecycle scenario, and where the queue applies the § above bounds the
  admitted wave.
- First-save after reconnect uses fresh per-question versions taken from the restore response;
  zero `STALE_VERSION` rejections in the measured runs (version protocol intact across
  reconnects).
- Pool decomposition during restore (S130/S200): transient saturation (satFrac 0.2–0.67),
  p99 ≤ 1.2 s — bounded and error-free without any admission or backpressure change
  ([04](04-results.md) § decomposition).

## Statement for the verdict

KEEP_LAZY admission is re-proven at N=200 with exact durable semantics and bounded latency ON
THE ACCEPTED FINAL TOPOLOGY (production limiter enabled, Redis coordination, distinct
identities). Nothing in this campaign changed the #549 decision; the evidence retires the
"re-prove under load" residual with raw artifacts.
