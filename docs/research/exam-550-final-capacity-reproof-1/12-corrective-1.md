# EXAM-550-CORRECTIVE-1 — corrective evidence pass record

Status: READY_FOR_HUMAN_CAPACITY_REVIEW. This record documents the corrective round performed
on PR #583 after the BLOCKED_BY_CORRECTIVE human review verdict (reviewed HEAD `ed37e0ce`).
It is written against the same artifact chain as the rest of this campaign: every number below
regenerates from committed raw artifacts via the harness scripts in
[harness/](harness/README.md); nothing is hand-copied.

- **OLD_HEAD** (reviewed by the verdict): `ed37e0ce`
- **BASE** (PR base): `fbf5bd41` (merge of #581)
- **Corrective code HEAD** (instrumentation + harness rewrite, gate runs executed at this SHA
  unless stated otherwise): `66c850e6`
- **NEW_HEAD** (this report): <!-- NEW-HEAD-FILL -->

## Root causes

### MAJOR-1 — canonical capacity runs measured the wrong deployment mode

The pre-corrective lifecycle, admission, long-lived, soak and readiness runs drove the API with
`APP_MODE=e2e`. In e2e mode the rate-limit plugin is disabled and the Redis limiter path is
inert, so every pre-corrective "production envelope" claim was measured with the per-IP rate
limiting responsibility (the accepted #554 topology: production limiter ON, default budgets,
Redis-backed coordination store) switched off. All such runs are superseded (see § artifact
disposition) and were re-run in APP_MODE=production with the limiter enabled, default budgets
(login 10/min/IP on the login route, global 100/min/IP), Redis in `optional` config mode and
`ready` runtime state, pool `max=10`, no timeout widening and no rate-limit budget inflation.
Every run's `meta.json` records `api_mode` and every `pool-analysis.json` records the measured
topology stamp (`appMode/rateLimitEnabled/redisConfigMode/redisRuntimeState/poolMax`).

### MAJOR-2 — CAPACITY_RESEARCH instrumentation executed lazy queries by observing them

`postgres.js` `Query extends Promise`: `then()`, `catch()` and `finally()` call `this.handle()`,
which submits the query for execution. The old instrumentation wrapped `sql.unsafe` and
eagerly executed every returned query via `void Promise.resolve(result).catch(...).finally(...)`
— the `.catch/.finally` chain submitted the statement to the database at wrapper time,
independent of the caller. Consequences: the "counting wrapper" added one eager round-trip per
wrapped statement (changing arrival timing and pool contention), and any statement whose result
was observed this way executed even if the calling code never awaited it. The instrumentation
was therefore not measurement-neutral.

## Lazy-query reproducer (required before replacement)

`apps/api/src/lib/capacityResearch.neutrality.test.ts` — 5 deterministic, sleep-free tests
(single-connection FIFO ordering, repo time-contract compliant):

1. **baseline laziness** — a `sql`...`` template builds without executing (0 arrivals);
2. **`Promise.resolve(query)` executes** — awaiting a resolved thenable submits the query
   (the falsifier that indicted the old wrapper);
3. **old mechanism eagerly executes** — a verbatim copy of the superseded
   `installSupersededEagerWrapper` produces the query's effect (row insert) with zero caller
   awaits (MAJOR-2 characterized as a regression test that now guards against reintroduction);
4. **corrective wrapper preserves laziness** — the same script under the neutral wrapper shows
   the identical +4-arrival delta only when the caller actually awaits (table create + insert +
   2 probes), i.e. creation and observation without execution;
5. **OFF-vs-ON neutrality gate** — the same statement script (direct statements + one
   `sql.begin` transaction) runs control (no wrapper) vs treatment (neutral wrapper) against a
   shared table (`TRUNCATE ... RESTART IDENTITY` between arms so SQL text, identities and even
   the 42P01 error are byte-identical): identical journal (`a-first`, `c-tx`, `d-tx`), identical
   first insert id, identical tx result, identical error code; `control.arrivalsDelta === 0`,
   `treatment.arrivalsDelta === 6` (4 direct + 1 BEGIN per tx segment — the only counted
   surface, and only because the funnel is genuinely entered).

## Replacement mechanism

`capacityResearch.ts` was rewritten: the wrapper now counts funnel entries and returns the
**original Query untouched** — no `.then/.catch/.finally`, no `Promise.resolve` observation, no
timing capture around statements. Client-side per-statement in-flight/duration are honestly
reported as `NOT_DIRECTLY_OBSERVABLE` in the snapshot (measuring them would re-introduce the
MAJOR-2 defect). The snapshot carries `appMode`, limiter enablement, Redis config/runtime state,
pool config facts, process/host metrics and heartbeat/deadline-scanner metrics. All pool/timing
evidence now derives from server-side authority: `pg_stat_activity` samples (10 s watcher),
`lock waits`, and the API's own pino request logs (service-time sojourn).

## Artifact disposition (H/I)

- **SUPERSEDED_PRE_CORRECTIVE_EVIDENCE** (retained unmodified, never deleted): 30 result dirs —
  13 pre-corrective lifecycle (`lifecycle-S*-2026-09-19T02-*`/`03-*`), 15 pre-corrective
  admission, the pre-corrective longlived (`05-52-20`) and pre-corrective soak (`06-13-04`) —
  plus 2 file sidecars (`admission-matrix-2026-09-19T03-33-15-408Z.json.SUPERSEDED.json`,
  pre-corrective readiness JSON sidecar). Every pre-corrective pool/timing number in docs 04,
  05, 06, 08, 09 is superseded.
- **RETAINED_VALID_EVIDENCE**: 11 topology dirs (`topo-*`/`topology-*.json`) — these already ran
  APP_MODE=production with the limiter ON (rig + budgets recorded in `meta`), so MAJOR-1 does
  not apply to them; [07](07-rate-limit-topology.md) documents why they are retained. The
  DIRECT_LAN-through-S200 claim (§J) is additionally re-proven by the corrective lifecycle runs'
  audit evidence below, independent of retention.
- **NEW (campaign `corrective-1`)**: 13 lifecycle runs (S20/50/100 ×3 reps, S130/200 ×2 reps),
  15 admission runs (14 unique scenarios; N20-dt15 ×2), `admission-matrix-2026-09-19T11-29-35-150Z.json`,
  `admission-server-sojourn-corrective-1.json`, `longlived-S100-2026-09-19T11-33-03-837Z`,
  `readiness-2026-09-19T11-40-14-675Z.json`, `soak-S50-2026-09-19T11-41-07-352Z`, per-run
  `pool-analysis.json` for all 13 lifecycle runs, and the regenerated aggregates
  (`aggregate-lifecycle.{json,md}`, `pool-decomposition.md`).

## Canonical lifecycle matrix — production mode (B)

13/13 runs pass all oracles under the production limiter; **0 × 429, 0 × 5xx, 0 × timeouts
across all 36,954 samples**; every oracle reports `auditDistinctIps = N+1`
(21/51/101/131/201) with the shared admin IP as the +1 — per-IP budgets isolated, zero false
positives through S200 (§J). Full per-phase tables: [04](04-results.md) (generated from
`results/aggregate-lifecycle.md`). Headlines (latency ms, aggregated):

| scale | LOGIN p99 | START p99 | SUBMIT p99 | steady save p99 | steady heartbeat p99 |
| --- | ---: | ---: | ---: | ---: | ---: |
| S20 | 961.5 | 219.8 | 669.9 | 61.3 | 33.2 |
| S50 | 2,432.3 | 427.9 | 1,444.9 | 64.1 | 20.9 |
| S100 | 4,712.2 | 884.2 | 2,593.4 | 114.8 | 56.9 |
| S130 | 5,892.8 | 924.1 | 3,430 | 219.2 | 225.3 |
| S200 | 9,174.3 | 1,522.6 | 5,155.1 | 775.7 | 1,029.1 |

Pool decomposition (server-side): LOGIN is CPU-bound (API CPU 862–949% at S100+), SUBMIT is
pool-queue-bound (`pgActive` pinned at the pool max of 10 while DB CPU ≤77%), steady-state
saturation fraction ≤0.016, event-loop p90 ≤1.7 ms — decomposition table in
[09](09-bottleneck-analysis.md), per-run numbers in `pool-analysis.json`. No 429 was observed,
so no 429 retention/classification question arises in the canonical matrix; the limiter was
never weakened (it is enabled with default budgets and the audit trail proves per-IP keying).

## Admission matrix — production mode (C)

15/15 runs (14 unique scenarios) pass the durable oracle exactly:
`admitted == min(waiting, (⌊Δt/15⌋+1)·20)` holds for every scenario (N20: 20/20 at Δt15/90;
N50: 40 @Δt15, 50 @Δt45/90; N100: 40 @Δt15, 100 @Δt75/90; N130: 40 @Δt15, 130 @Δt90/105;
N200: 40 @Δt15, 140 @Δt90, 200 @Δt150), `startOk` equals `admitted`, zero duplicate active
attempts, zero 429/5xx/timeouts. KEEP_LAZY semantics unchanged. Client resume walls at
Δt>72 s (up to 5,144 ms at N200-dt150) are a driver-side reconnect artifact (Fastify 72 s
`keepAliveTimeout` vs the long pause), not server service time: the server-side pino sojourn
authority (`admission-server-sojourn-corrective-1.json`, 14 unique scenario keys — the two
N20-dt15 reps share one entry) shows RESUME service time p50 76.8–703.9 ms and max ≤853.8 ms
across all scenarios. Details: [06](06-admission-reconnect.md).

## Long-lived composition (I)

Corrective run `longlived-S100-2026-09-19T11-33-03-837Z` re-proves the #545 residual under
production mode: 300 pending episodes → 0, 1,200 incidents materialized, 0 CAS conflicts, 0
disrupted; backlog tick 14,265 ms, post-convergence settled ticks 40–54 ms; discovery query
3.4 ms (planner unchanged with candidate index — 3.3 ms; index dropped); live S100 workload
7,139 requests, 0 errors, MEASURE_STEADY p99 73.6 ms — matching the main-matrix S100 envelope.
Details: [05](05-long-lived-data.md).

## Connection-lifetime soak (I)

Full 95-min corrective soak `soak-S50-2026-09-19T11-41-07-352Z` (production mode, DIRECT_LAN,
pool max=10, default randomized max_lifetime): 37,847 SOAK-phase save/heartbeat requests with
**zero 429/5xx/timeouts/network errors**, SOAK p50 24.3 ms / p99 60 ms; **17 lifetime
retirements** across 22 distinct backend PIDs (backend ages 34.5–59.3 min, inside the
randomized 30–90 min window) with **0 errors inside every ±60 s retirement window**. A full
rerun (not a bounded one) was performed because the soak is latency- and pool-dependent
evidence that both MAJOR findings bear on directly (production limiter + instrumentation
neutrality). One transient save-latency tail (max 1,379.5 ms) is attributed to a near-
simultaneous retirement cluster at 12:24:33–12:25:00 (up to 8 active backends + 6 lock waits
for ~25 s while replacements connected) — [05](05-long-lived-data.md) § soak. During the run
the API's pino stdout stopped receiving writes at 12.7 min while the process kept serving
correctly — § Server-log outage below. GitHub CI: UNAVAILABLE_BILLING (not run).

## Server-log outage (measurement-infrastructure finding — root-caused)

The canonical 95-min soak's pino stdout stops at 11:53:51.842 UTC — 12.72 min after the API
started listening, mid-SOAK — and never resumes: the visible log ends with a clean
`request completed` line (req-569), the file's mtime freezes 1.3 s later, and there is no
shutdown line. The process itself kept serving the remaining 82 min correctly: 32,757
post-freeze requests in `samples.jsonl`, all success; the 2/s research-snapshot poller, the
200 ms `pg_stat_activity` sampler, the host sampler and the 10 s connection watcher all ran
continuously to run end; zero 429/5xx/timeouts. The outage is invisible to every in-process
metric captured in the research snapshots.

**Root cause (measured, not inferred from code alone):** the evidence commit `e6d48bce` was
made at 19:53:51 local (+08) — the same second as the freeze — while the soak was still
running, staging the run's live-written files (partial `samples.jsonl`/`pool.jsonl`/`.api.log`
snapshots are in that commit). The repo's pre-commit hook runs lint-staged, whose
`"*": "prettier --write --ignore-unknown"` config triggers stash/restore of partially-staged
files; git's restore rewrites the file at the path. Writers that open the path per record
(`appendFileSync` in the harness — `pool.jsonl`, `samples.jsonl`) re-resolve the path on every
write and were unaffected — their files run to completion. The API's pino/sonic-boom holds one
long-lived stdout fd: after the path was replaced it kept appending to the orphaned old inode
— writes silently lost, visible file frozen at the last pre-commit write. The frozen file's
content (git-add snapshot + restored 8-line delta, ending 19:53:51.842) and mtime
(19:53:53.18, the restore moment) match this mechanism exactly; the post-freeze bytes are
unrecoverable with the exited process.

**Bounded reproduction:** an otherwise identical 20-min production soak
(`soak-S50-2026-09-19T13-31-40-106Z`, marked `.DIAGNOSTIC_LOG_FREEZE_REPRO.json`, NOT part of
the canonical set) ran with a 2 s `/proc/<pid>/fd` watch: pino stdout continuous for the full
20.06 min including a clean `redis.closing` shutdown line (21,066 lines, zero `level≥40`),
crossing the 12.7-min elapsed point where the canonical run froze; fd 1 unchanged throughout.
With no concurrent git activity the outage does not reproduce — confirming the mid-run commit
as the trigger, not APP_MODE=production, the neutral instrumentation, or pino itself.

**Consequences:**
- Serving and all measurement claims are unaffected: the outage cost is the *log record* for
  the uncovered 82-min window (zero `level≥40` is verified only for the covered 12.7-min
  window and the 20-min diagnostic window — stated as such everywhere).
- This is a self-inflicted measurement hazard, not a product or harness-code defect: the rule
  "never commit artifacts of a run that is still writing them" is now part of
  [harness/README.md](harness/README.md). A product-side hardening follow-up (log to an
  explicitly-managed destination that tolerates path replacement, or alert on stdout write
  failure instead of silently dropping) is recorded for the roadmap; it is deliberately NOT
  fixed inside this campaign (no scope expansion beyond the corrective contract).

## Local validation (L)

<!-- LOCAL-VALIDATION-FILL -->

## Fresh adversarial review (M)

<!-- ADVERSARIAL-FILL -->

## Verdict (K/N)

<!-- VERDICT-FILL -->
