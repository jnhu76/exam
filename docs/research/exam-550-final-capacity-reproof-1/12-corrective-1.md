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

All gates executed at HEAD `39e6d91d` (the corrective evidence commit) with the exact
package.json commands. GitHub CI = UNAVAILABLE_BILLING (billing-blocked on this repo) — never
reported as PASS or FAIL on its own.

| gate | command (package.json source) | exit | outcome |
| --- | --- | ---: | --- |
| format | `pnpm format:check` | 0 | prettier-clean |
| code-quality lint | `pnpm lint` | 0 | passed |
| eslint | `pnpm lint:eslint` | 0 | `eslint . --max-warnings=0` clean |
| architecture | `pnpm lint:arch` | 0 | clean |
| typecheck | `pnpm typecheck` | 0 | all package tasks pass |
| unit + component (1st run) | `pnpm test` | **1** | 1 failure: `apps/api/tests/concurrency/ea-lock-order.test.ts:292` 5 s timeout — the **documented BUG-FLAKE-001-family flake** (test-flakes.md 2026-07-25 entry; recurrence logged). Standalone rerun immediately 3/3 PASS (1.8 s); all other 2,812 tests passed |
| unit + component (rerun) | `pnpm test` | 0 | **2,813 passed / 12 skipped** (includes the 5 new neutrality tests) |
| static bundle | `pnpm verify:static` | 0 | passed |
| full verify | `pnpm verify` | 0 | `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm coverage` + build: API coverage executed live at this HEAD (2,813 passed / 12 skipped under v8 coverage; its sources changed since the last cached run); the other packages' coverage tasks were turbo cache hits keyed on unchanged source+env hashes, and the build completed |
| full Playwright E2E (WSL topology) | `bash scripts/e2e/run-wsl.sh` | 0 | 2/2 shards passed (per-shard isolated DBs `exam_e2e_w0/w1`, ports 3100/3101) |

No gate was reported PASS without being executed; no safety control was disabled to buy green;
the one flake recurrence is disclosed and logged per the repo's flakes protocol rather than
masked with a timeout or skip.

## Fresh adversarial review (M)

A fresh-context adversarial reviewer (no prior campaign exposure, agent session distinct from
the author's) audited the corrective record with active verification — reading every meta/
oracle/artifact file named below, re-running the regeneration tools on sampled runs, re-running
the neutrality test file live, re-deriving the admission formula and rotation ages from raw
artifacts, and grepping the canonical raw JSONL for 429s. Verdicts per the 12 falsification
questions (full trail in the review transcript):

| # | question | verdict |
| --- | --- | --- |
| 1 | production mode in every canonical run (meta + measured in-process topology stamp) | HOLDS — 13 lifecycle + 15 admission + longlived + readiness + both soaks all `production`, limiter ON, Redis `ready`, pool 10; cross-checked against in-process research snapshots, not just harness-written meta |
| 2 | instrumentation never touches the returned Query; honest NOT_DIRECTLY_OBSERVABLE | HOLDS — wrapper counted + returned untouched (`git diff ed37e0ce 66c850e6` shows the eager block deleted); gating verified inert without CAPACITY_RESEARCH=1 |
| 3 | repro-before-replacement (laziness / Promise.resolve executes / old mechanism eager / OFF-vs-ON gate) | HOLDS — all four proof layers in the test file; 5/5 passed live under the reviewer's own run (2.43 s) |
| 4 | doc tables match aggregates byte-for-byte; regeneration drift ok; pre-corrective numbers quarantined | HOLDS — headline rows match exactly (S200 login p99 9174.3, submit 5155.1); summarize re-run on 4 corrective runs → timestamp-only diff; 36,954 samples recounted |
| 5 | disposition markers correct; nothing deleted | HOLDS — 30 superseded + 11 retained + diagnostic marker; `git log --diff-filter=D` shows exactly one deletion (a stray marker fix); 477 files added, none removed |
| 6 | reps, phase families, oracles, auditDistinctIps = N+1 | HOLDS — 3/3/3/2/2 reps re-derived from meta; all oracles pass; 21/51/101/131/201 confirmed per run |
| 7 | limiter integrity (zero 429, product budgets, no weakening) | HOLDS — 0×429 grepped across all raw samples; login 10/min hard-coded in `auth.ts:120`, global 100/min in settings, production mode forces the limiter on; no RATE_LIMIT_* in runner env |
| 8 | DIRECT_LAN-through-S200 sourced from the new runs' own audit evidence | HOLDS — `auditDistinctIps` 201 with distinct 127.0.0.x sample verified in `lifecycle-S200-r2`; retained topology group explicitly subordinated in 07/11 |
| 9 | admission exactness (`min(waiting,(⌊Δt/15⌋+1)·20)`, fail-closed == waiting−admitted, doc table == matrix) | HOLDS — all 15 rows re-derived; sojourn p50 max 703.9 / max 853.8 ms match the doc claims |
| 10 | soak honesty (rotation re-derived; outage root-caused; uncovered window stated) | HOLDS — 22 PIDs / 17 retirements (ages 34.5–59.3 min recomputed) / 0 errors in windows; frozen log bounds verified in the archived gz; no "clean across 95 min" claim anywhere |
| 11 | gate commands match package.json; flake disclosed; CI never green | HOLDS — commands match scripts; first `pnpm test` failure + standalone pass + rerun recorded with the test-flakes.md 2026-09-19 recurrence entry; CI = UNAVAILABLE_BILLING throughout |
| 12 | classification follows the new evidence; no merge/close/#582 language | HOLDS — 11 §1 built on production-mode numbers; OLD_HEAD/BASE recorded; only negative statements about merging/closing |

RESOLVED_MAJORS: MAJOR-1 resolved (every canonical run re-executed in production mode with
product-default budgets, measured in-process, zero 429, superseded e2e artifacts retained);
MAJOR-2 resolved (eager observation deleted, replacement proven neutral by source + live
OFF-vs-ON gate, honest NOT_DIRECTLY_OBSERVABLE facets, server-side evidence authority).

NEW findings from the review, both MINOR, both resolved in the finalization commit:
1. the gate table / flakes-recurrence entry / final sections were uncommitted working-tree
   edits at review time — by design (the review gates the final commit), resolved by this
   finalization commit;
2. the pre-corrective readiness sidecar's `authoritative_replacement` held a template string
   instead of the actual replacement filename — corrected to
   `results/readiness-2026-09-19T11-40-14-675Z.json`.

Reviewer's final line: **VERDICT: READY_FOR_HUMAN_CAPACITY_REVIEW** — no unresolved MAJOR.

## Verdict (K/N)

**READY_FOR_HUMAN_CAPACITY_REVIEW.** Both BLOCKED_BY_CORRECTIVE MAJORs are root-caused,
fixed at the mechanism level, and re-proven on the accepted #554 production topology; the
final classification (11-final-verdict.md) is derived strictly from the corrective-1
artifacts and does not preserve the pre-corrective verdict. Per the corrective contract:
PR #583 is updated in place (no new PR, no merge, #550 not closed, #582 not started); the
campaign stops here for human capacity review.

- OLD_HEAD: `ed37e0ce` · BASE: `fbf5bd41` · corrective code HEAD: `66c850e6` · evidence
  commits: `e6d48bce`, `39e6d91d` · NEW_HEAD: `3d1a0075` (the finalization commit containing
  this record; recorded by the immediately following commit)
