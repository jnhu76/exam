# EXAM #885 — SOURCE_MAP

**BASE_SHA** `f2d44b78136cda1358148dbce891590975d4c88f` (`origin/master`, 2026-11-05).
Frozen detached worktree: `/home/hoo/Source/exam-885`. All `file:line` references below are
from this SHA, read directly (not copied from earlier conclusions).

PR #884 merge SHA: `5e790137c4c13c584961bead4749ac583cfeddb3` (merged 2026-11-05T08:19:47Z).
#886 fully delivered: commit `caf9bebe` (merged via #893), `consecutiveFailedTicks` projected in
`apps/api/src/routes/system.ts:462` / `:485` and `packages/contracts/src/system.ts:208`, `:228`.
#547 CLOSED, #862 CLOSED, #886 CLOSED, #800 OPEN (research parent), #885 OPEN with 0 comments
at baseline.

## 1. Eight source-verified facts

| # | Fact | Authority |
| --- | --- | --- |
| F1 | `lastSettledAt` **IS still updated after a throw**. It is stamped in `.finally()`, which runs for both success and error. `settled` means "tick body finished", NOT "success". | `heartbeat.ts:393-397` (`lastSettledAt` at `:396`); `deadlineScanner.ts:390-394` (`:393`); comment `heartbeat.ts:48-51`, `deadlineScanner.ts:61-63`; classifier comment `operabilityMonitor.ts:165-172`. Also pinned by `heartbeat.test.ts:261-292`, `deadlineScanner.test.ts:151-177`. |
| F2 | `consecutiveFailedTicks` is written **only inside the `try`**; the `catch` touches nothing. Therefore a throw tick neither increments nor resets it — **frozen**. A settled tick with failures increments; the first zero-failure settle resets to 0. Process-local, reset on restart. | `heartbeat.ts:386-389` (inside `try` at `:327-389`; `catch` at `:390-392`); `deadlineScanner.ts:374-377` (`try` at `:367-386`; `catch` at `:387-389`); declarations `heartbeat.ts:69-77`, `deadlineScanner.ts:73-81`; freeze REGRESSION tests `heartbeat.test.ts:636-678`, `deadlineScanner.test.ts:379-439`. |
| F3 | `BUSINESS_FAILURE_TICK_THRESHOLD = 4`. Compile-time policy, deliberately NOT an env knob. `classifyPersistentBusinessFailure(n) = n >= 4`. | `operabilityMonitor.ts:54`, `:66-70`; `operabilityMonitor.test.ts:533-548`; `docs/operations/active-alerting.md:42-43`. |
| F4 | Readiness probe and scanners use the **SAME `fastify.db` pool but DIFFERENT query paths**. Probe = `createSystemStatsRepo(db).pingDb()` = `SELECT {id} FROM organizations LIMIT 1` (`systemStatsRepo.ts:153-160`), reached via `buildReadinessProbeDeps` (`operabilityMonitor.ts:151-161`). Scanners = `organizationRepo.list` (`SELECT * FROM organizations`), `listInProgress` / `listDeadlineCandidates` (`exam_attempts`, joins), and `executeInTransaction` (`db.transaction`, REPEATABLE READ + 40001/40P01 retry). | `systemStatsRepo.ts:153-160`; `organizationRepo.ts:59-61`; `attemptRepo.ts:561-574`, `:608-631`; `packages/db/src/types.ts:182-194`; `heartbeat.ts:262-271`, `deadlineScanner.ts:299-316`; `apps/api/src/routes/apiSurface.ts:90-91` (readiness route shares the same probe). |
| F5 | Monitor constructs one snapshot per 15s tick: `probeApplicationReadiness(probeDeps)` once, then `evaluateOperabilityTick({readiness, heartbeat: heartbeatMetrics, deadline: deadlineScannerMetrics, retention: clientEventRetentionMetrics, intervalMs, *ConsecutiveFailedTicks, now}, trackers)`. It emits bounded `operability.*` lines to the app's stdout (pino JSON). | `operabilityMonitor.ts:504-548` (probe `:508`, snapshot `:510-528`, emit `:529-538`, interval `:550` = `OPERABILITY_MONITOR_INTERVAL_MS` `:39` = 15_000); `OperabilitySnapshotInput` `:250-270`; `docs/operations/active-alerting.md:8-40`. |
| F6 | `createOperabilityTransitionTracker()` holds ONE `boolean \| null` per (event, component) fact. `lastFailed === null` + `failed` → `raise_failure`; repeated `failed` → `null`; `true → false` → `raise_recovery`; otherwise silence. Trackers are created once at monitor registration and are process-local. | `operabilityMonitor.ts:229-247`, `:488-499`, `OperabilityTickTrackers` `:295-306`; tests `operabilityMonitor.test.ts:205-236`. |
| F7 | First fault / continuous faults / recovery / restart: first `failed` observation raises exactly one failure; continuous failed observations stay silent; the first `false` after `true` raises exactly one recovery; a restart (fresh trackers + zeroed process-local counters) re-raises a CURRENT outage only after the threshold re-accumulates, and emits no carry-over recovery. | `operabilityMonitor.ts:229-247`; `operabilityMonitor.test.ts:705-742` (restart), `:621-640` (S4/recovery); `docs/operations/active-alerting.md:44-46`, `:83-96`. **MEASURED** in this research: E4, E6-business-failure, E7. |
| F8 | The external watcher consumes **stdout JSON only** and pages on `level >= 50 AND event IN {operability.readiness, operability.background_loop, operability.business_failure} AND state IN {unavailable, stalled, failing}`; clears on `state == "recovered"` keyed by `(event, component)`. Plain scanner ERROR logs (e.g. "Error scanning for expired attempts") carry **no `event` field** and are outside the whitelist. | `docs/operations/active-alerting.md:98-122` (§3), `:8-40` (§1 catalogue); scanner ERROR emission `heartbeat.ts:391`, `deadlineScanner.ts:388`. There is **no watcher implementation in the repo** — the contract is documentation only. |

The #885 blind spot is written into the contract itself: `docs/operations/active-alerting.md:142-147`
("Transient scanner errors (e.g. DB-down cycles that THROW) … DB-down cycles raise
`operability.readiness/database`, not a second concurrent business-failure alert for the same
root cause"), and into the two freeze REGRESSION tests' own comments
(`heartbeat.test.ts:661-664`, `deadlineScanner.test.ts:408-412`: "CONTINUOUS tick-level throws
(DB readiness normal throughout) … the business-failure counter stays frozen below the threshold
indefinitely — the per-tick ERROR logs are the only signal for this shape, by ownership design").

## 2. Actual call DAG (per loop, with file:line)

```
scanner timer
  heartbeat.ts:319 setInterval(..., scanIntervalMs=30_000 from settings.ts:701) / unref :399
  deadlineScanner.ts:359 setInterval(..., scanIntervalMs) / unref :396
  guards: activeScan/closing  heartbeat.ts:317-320 / deadlineScanner.ts:357-360
        │
        ▼
tick (async IIFE)
  heartbeat.ts:321-397 / deadlineScanner.ts:361-394
  lastStartedAt + activeSince = fastify.now()   heartbeat.ts:324-326 / dl:364-366
  tickNow = fastify.now() (ADR-006 one operation now)  heartbeat.ts:329
        │
        ▼
discovery / business work
  heartbeat: scanDatabaseForDisruptedAttempts  :251-299
     organizationRepo.list :262-264 → attemptRepo.listInProgress :271
     → scanForDisruptedAttempts :90-125 → markAttemptDisrupted :152-177
       → executeInTransaction :159 (db.transaction)
     → reconcileSystemIncidentsAcrossOrgs :189-239 (second leg, :355-358)
  deadline: scanDatabaseForExpiredAttempts :295-347
     organizationRepo.list :301-303 → attemptRepo.listDeadlineCandidates :316
     → scanDeadlineCandidates :107-129 → autoSubmitAndGrade :166-293
       → executeInTransaction :172 (db.transaction)
        │
        ▼
catch / finally                       ← INJECTION POINT for tick-level throws
  heartbeat.ts:390-392 catch → fastify.log.error "Error scanning for disrupted attempts"
  heartbeat.ts:393-397 .finally → activeScan=null, activeSince=null,
                                   lastSettledAt = fastify.now()   :396
  deadlineScanner.ts:387-389 catch → "Error scanning for expired attempts"
  deadlineScanner.ts:390-394 .finally → lastSettledAt :393
  NOTE: consecutiveFailedTicks update is INSIDE try (hb :386-389 / dl :374-377),
        so a throw bypasses it (frozen).
        │
        ▼
metrics (module-level, process-local singletons)
  heartbeatMetrics :53-78 / deadlineScannerMetrics :65-89
  read-only projection: apps/api/src/routes/system.ts:449-497
    (consecutiveFailedTicks :462 / :485, lastSettledAt :467 / :489-490,
     stallState :469-473 / :492-496), reached via buildOperationalDiagnostics :392
        │
        ▼
monitor snapshot (own 15s timer, NOT the scanner timer)
  operabilityMonitor.ts:550 setInterval(runTick, 15_000) / unref :551
  runTick :504-548 → probeApplicationReadiness(probeDeps) :508
     → systemStatsRepo.pingDb() :153-160 (trivial organizations SELECT)
  snapshot :510-528 reads heartbeatMetrics :513, deadlineScannerMetrics :515,
     clientEventRetentionMetrics :517, *ConsecutiveFailedTicks :519-524, now :509
        │
        ▼
classifier  evaluateOperabilityTick :314-474
  readiness legs :344-355 (probeApplicationReadiness :112-148)
  stall legs :385-415 (classifyLoopStall :187-216, LOOP_STALL_FACTOR=4 :42)
  business_failure legs :420-471 (classifyPersistentBusinessFailure :66-70,
                                  BUSINESS_FAILURE_TICK_THRESHOLD=4 :54)
        │
        ▼
transition tracker  createOperabilityTransitionTracker :229-247
  per-fact trackers created at monitor registration :488-499
  type OperabilityTickTrackers :295-306
        │
        ▼
stdout  operabilityMonitor.ts:529-538
  fastify.log[alert.level]({event, component, state}, alert.message)
  pino JSON line on app stdout — the ONLY delivery seam (no second channel)
  external hook: docs/operations/active-alerting.md:98-122
```

## 3. What the readiness probe can and cannot prove

SOURCE_VERIFIED, from F4:

- `pingDb()` proves: the app's own pool can execute one trivial indexed `SELECT` on
  `organizations` within `READINESS_PROBE_BUDGET_MS = 2_000` (`operabilityMonitor.ts:31`).
- It does **NOT** prove: `exam_attempts` queries, the `exams` join, `last_activity_at` /
  `deadline_at` columns, per-table permissions, `db.transaction` / `FOR UPDATE` locks,
  REPEATABLE READ serialization (40001), or any per-row processing logic.

Therefore `DB probe healthy && tick throws → non-DB exception` is **NOT a valid inference**.
E3 (measured) injects a PostgreSQL-shaped `42703` error at the attempt-discovery seam while the
probe succeeds on every monitor sample: a healthy probe and a DB-root-cause throw coexist.

The mirror error must also be avoided: `DB probe unhealthy` does not prove the throw's root
cause either (E1/E9: they co-occur, but the app has no causal evidence). All a tick-level throw
supports is: **this tick's execution aborted; the cause is UNKNOWN from the alert's own facts**.

## 4. Authority boundaries (not re-decided here)

- Frozen #862/#884 contract: `consecutiveFailedTicks` freeze on throw — pinned by two
  REGRESSION tests (`heartbeat.test.ts:636`, `deadlineScanner.test.ts:379`) and §4 of the
  alerting doc. This research does **not** change it.
- `lastSettledAt` stall semantics: #547; `docs/operations/active-alerting.md:19-24`, `:48-61`.
- Event catalogue & external hook: `docs/operations/active-alerting.md` §1–§3.
- Diagnostics schema: `packages/contracts/src/system.ts`; route `apps/api/src/routes/system.ts`.
- #547 / #862 historical decisions remain CLOSED; this research does not alter their status.

## 5. Deliberately NOT established by source

- No external watcher implementation exists in the repo, so **operator notification delivery
  latency is UNKNOWN / UNMEASURABLE here**. Only stdout *event production* latency is measured.
- No product runtime code in this worktree was modified. Candidate A/B/C/D behaviours are
  COUNTERFACTUAL simulations over measured telemetry (see EXPERIMENTS.md), never delivered
  product behaviour.
