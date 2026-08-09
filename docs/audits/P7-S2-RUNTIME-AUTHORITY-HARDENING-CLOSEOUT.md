# P7-S2 — Runtime Authority Hardening, Crash Evidence & Reconciliation Discovery — CLOSEOUT

## 1. Baseline

```text
baseline SHA : 1d3a0bd80941bf84be3c932ac8dd6a07f0000165 (origin/master, PR #267 merged)
branch       : fix/p7-s2-runtime-authority-hardening
PR           : (draft — see Phase 14)
audit authority: Issue #268 (P7-S1 Whole-System State Machine & Authority Reality Audit)
```

Issue #268 was re-validated against current master BEFORE any modification
(Phase 0); every finding below was independently re-checked against source
and, where the defect class permits, against a deterministic runtime test.

## 2. Re-validation (Issue #268 findings → disposition)

| #268 finding | Severity | Revalidated | Action | Final status |
| --- | --- | --- | --- | --- |
| `publishResults` concurrent TOCTOU | P2 | yes — unconditional `update` after unlocked `findById`; race proven under READ COMMITTED (two winners, evidence overwrite) | CAS-equivalent row-lock serialization (`findByIdForUpdate` + re-read under lock) + deterministic 2-connection race test (RC + RR) | **CLOSED** |
| FUTURE_BASEVERSION acceptance | P2 | yes — only `baseVersion < currentVersion` rejected; `baseVersion=999` accepted as `currentVersion+1` | `FUTURE_VERSION` rejection (strict equality), domain/contracts/message-registry enum + wire test | **CLOSED** |
| Email claim→send→mark duplicate window | P2 | yes — lease 300s vs SMTP phase timeouts 30s; nodemailer `socketTimeout` is an inactivity (not total) timeout (Context7-verified) | at-least-once classification documented; fail-fast config invariant `lockTimeout > connection+greeting+socket` | **BOUNDED** |
| `recoverAbandoned` only runs inside worker | P2 | yes (worker poll loop 5a) | human amendment: NO API ownership duplication — worker-death is observable via `GET /api/system` heartbeat (`emailStatus.worker.status`), which already exists | **NO ACTION (observability confirmed)** |
| No startup reconciliation / detectors | P2 | yes — no detector existed | read-only integrity diagnostics in `GET /api/system/diagnostics` → `integrity` (two legacy-only anomaly families) | **CLOSED (detect-only)** |
| `Attempt.grading` unreachable | P3 | yes — no production writer; state-machine table only | documented; NOT deleted (Phase 9: `UNREACHABLE_FOSSIL`) | **DOCUMENTED** |
| `flagMisconduct` dead command | P3 | yes — zero production callers | recorded; NOT deleted (Phase 10) | **DOCUMENTED** |
| `EmailDeliveryService.enqueueEmail` / `enqueueBestEffort` dead | P3 | yes — zero production callers (only comment refs + its own test) | recorded; NOT deleted | **DOCUMENTED** |
| `notificationRepo.insertMany` dead | P3 | yes — zero production callers | recorded; NOT deleted | **DOCUMENTED** |
| `state-and-authority.md` drift (SHA `53ac3524`, M11 wording) | P3 | yes — stale header, stale milestone wording | header + §5/§6.1/§7/§10 rewritten to current truth | **CLOSED** |
| ADR-012 KNOWN_DEFECT (REC-I2a) | P3 | yes — still open in ADR text | amendment marks REC-I2a CLOSED with evidence pointers | **CLOSED** |
| No DB CHECK on core enums / `command_type` free string | P3 | unchanged — intentional design (command-layer enforcement) | NO ACTION | **RECORDED** |
| `0027-convergence` flaky test | P3 | not reproduced in this run | NO ACTION | **RECORDED** |
| legacy `/admin/attempts/:attemptId/proctor-incident` route | P3 | correct per ADR-015 §16 | NO ACTION | **RECORDED** |

## 3. Fixes (exact invariants + implementation)

### 3.1 RESULT_PUBLISH_IS_SINGLE_WINNER (P7-S2-A)

```text
resultsPublishedAt: NULL → timestamp, exactly once per exam
```

Implementation (`packages/exam-engine/src/examCommands.ts`): `publishResults()`
now reads the exam via `findByIdForUpdate()` (FOR UPDATE, inside the caller's
transaction) and re-checks `resultsPublishedAt` under the lock. Loser returns
`alreadyPublished=true` with the committed truth; winner updates. Consequences
closed: timestamp overwrite, duplicate `exam.publish_results` audit, duplicate
fan-out invocation, "two callers report first publication".

Why row-lock (Option A) over conditional UPDATE (Option B): `findByIdForUpdate`
already exists as the ADR-005 repository primitive ("every admin operation must
lock the exam row before reconciling and mutating"); Option B would add a new
repo surface for one caller.

### 3.2 ANSWER_BASE_VERSION_MUST_EQUAL_CURRENT_VERSION (P7-S2-B)

```text
baseVersion < currentVersion  → STALE_VERSION   (conflict)
baseVersion == currentVersion → eligible         (accepted, version+1)
baseVersion > currentVersion  → FUTURE_VERSION   (conflict)
```

Implementation: `processSaveAnswer` (`answerProtocol.ts`) rejects
`baseVersion > currentVersion` with the new `FUTURE_VERSION` reason; the wire
enum `SaveAnswerRejectReasonEnum` (`packages/contracts/src/attempt.ts`), the
domain `ConflictReason` literal (`packages/domain/src/enums.ts`), and
`saveAnswerMessages` gained the value. The idempotency-key replay check runs
BEFORE the version checks, so same-`clientSeq` replay semantics are unchanged.
Compatibility decision: a distinct wire reason was chosen over mapping into an
existing conflict because the enum/message churn is tiny and the semantic
distinction is real; the frontend needs no change (only `STALE_VERSION` has
special handling).

### 3.3 Email at-least-once lease invariant (P7-S2-D)

Fail-fast config invariant in `resolveEmailWorkerConfig`:
`EMAIL_WORKER_LOCK_TIMEOUT_MS > SMTP_CONNECTION_TIMEOUT_MS +
SMTP_GREETING_TIMEOUT_MS + SMTP_SOCKET_TIMEOUT_MS` when transport is `smtp`
(necessary minimum margin, not a proof — nodemailer `socketTimeout` is an
inactivity timeout; residual window = documented at-least-once boundary).

## 4. Concurrency evidence

`apps/api/src/routes/publishResults.concurrency.test.ts` — deterministic
two-transaction barrier on two physical connections, run under BOTH
`read committed` and `repeatable read`:

| Invariant | Result |
| --- | --- |
| exactly one caller owns applied publication | winner `alreadyPublished=false` |
| loser observes already-published truth | loser `alreadyPublished=true`, timestamp == winner's `now` |
| stored timestamp immutable | equals winner's `now` in both isolations |
| distinct physical transactions | distinct PIDs / txids |

Old-code proof (temporary test, run before the fix, then deleted): under READ
COMMITTED with both publishers gated past the NULL check, BOTH returned
`alreadyPublished=false` with different evidence timestamps and the stored
timestamp was silently overwritten.

Route-level property test (existing `resultPublishing.test.ts` M13) still
asserts one winner + one audit under two parallel `inject` calls.

## 5. Protocol evidence (baseVersion)

`packages/exam-engine/src/answerProtocol.test.ts` (+6 tests):

| Scenario | Result |
| --- | --- |
| current=2, base=1 | `STALE_VERSION` |
| current=2, base=2 | accepted → version 3 |
| current=2, base=3 | `FUTURE_VERSION` |
| current=2, base=999 | `FUTURE_VERSION` |
| no answer yet, base=999 | `FUTURE_VERSION` (current=0) |
| same clientSeq + same payload | replay accepted (unchanged) |
| same clientSeq + different payload | `CONFLICTING_PAYLOAD` (unchanged) |

Wire-level: `protocol-consistency.test.ts` scenario #15 — POST save with
`baseVersion=999` returns `accepted:false`, `reason:"FUTURE_VERSION"`,
`serverVersion:0`, and no draft persisted. Save-vs-submit and latest-wins
semantics verified by the existing suites (49 engine protocol tests, 20 API
protocol/candidate/submitFreeze tests) — no regression.

## 6. Crash matrix (P7-S2 Phase 4)

Failure injection: deterministic throw AFTER the command's DB mutations,
INSIDE the same uncommitted `executeInTransaction` shape the routes use
(discipline: `throw after DB mutation inside uncommitted tx`), then a fresh
retry. File: `apps/api/src/routes/crashAtomicity.test.ts` (6 tests).

| Flow | Failure point | Durable result | Retry behavior | Verdict |
| --- | --- | --- | --- | --- |
| submit freeze (snapshot+workset+gradingStatus) | after freeze mutation, before commit | full rollback: `in_progress`, no `submitted_answers`, no workset rows | production orchestrator (`submitAndGradeAttempt`) → `graded`, 1 workset | ATOMIC_ROLLBACK |
| manual grading terminalization | after last-entry grade+finalize mutation, before commit | rollback: entry `pending_manual`, attempt `submitted` | same `gradeQuestion` → `graded` + enrollment projection | ATOMIC_ROLLBACK |
| result publication | after timestamp mutation, before commit | rollback: `resultsPublishedAt` NULL | retry publishes | ATOMIC_ROLLBACK |
| interruption detection | after episode+event+pointer mutation, before commit | rollback: `in_progress`, no episode, no event | retry → `marked` + episode | ATOMIC_ROLLBACK |
| interruption restore | after compensation mutation, before commit | rollback: still `disrupted`, no adjustment rows, deadline unchanged | retry → `in_progress` (+ restored event; bounded_grace ledger is policy-specific) | ATOMIC_ROLLBACK |
| operator time grant | after ledger mutation, before commit | rollback: no ledger row, deadline unchanged | same-operationId retry → exactly one ledger row, deadline moved | ATOMIC_ROLLBACK |

Receipt-backed flows with existing replay evidence (cited, not re-attacked):
force-submit (`admin-force-submit.concurrency.test.ts` — lost response replays
stored `result_payload`), misconduct (`admin-misconduct.concurrency.test.ts`),
incident commands (`incidents.admin.concurrency.test.ts` — operationId +
expectedVersion), proctor assignment (`proctorAssignments.admin.test.ts`),
deadline scanner (`deadline-scanner.test.ts` — FOR UPDATE + 40001 retry).

No flow produced `REAL_PARTIAL_STATE` or `UNKNOWN`.

## 7. Email boundary

```text
DB outbox processing = durable (PostgreSQL state machine, ownership-fenced)
SMTP delivery        = external (SMTP provider transaction ≠ PG transaction)
delivery semantics   = AT LEAST ONCE
```

- Canonical ambiguity accepted and bounded: SMTP accepts → process dies before
  `markSent` → row recoverable → retry may duplicate. Bounded by
  `EMAIL_MAX_ATTEMPTS` (default 3) → `dead`.
- Lease guarantee: fail-fast config invariant (see §3.3) plus ownership fences
  (`markSent`/`markRetryWait`/`markDead` require `status='processing' AND
  locked_by=worker`; `recoverAbandoned` reclaims only rows older than
  `EMAIL_WORKER_LOCK_TIMEOUT_MS`).
- Nodemailer semantics (verified via Context7 against official docs):
  `connectionTimeout` = max wait for TCP connect; `greetingTimeout` = max wait
  for server greeting; `socketTimeout` = max IDLE period before close — NOT a
  total-operation cap. Hence the invariant is necessary-not-sufficient and the
  residual is the at-least-once boundary.
- Worker-death observability: `GET /api/system` → `emailStatus.worker.status`
  (`available`/`degraded`/`unknown`) from `worker_heartbeats` vs
  `EMAIL_WORKER_HEARTBEAT_STALE_MS`; outbox counts surfaced. Per the P7-S1
  human-review amendment, `recoverAbandoned` stays worker-owned; no API
  startup duplication.

## 8. Reconciliation conclusion

```text
NO GENERAL STARTUP RECONCILER
```

Evidence: (a) Phase 4 crash matrix — every cross-domain operation commits in
one PostgreSQL transaction, so no committed incomplete state is reachable from
current supported runtime behavior; (b) receipt-backed commands replay
committed evidence; (c) the email claim→send window is an external-side-effect
at-least-once boundary, not a DB partial state; (d) interruption pointers are
DB-CHECK-paired. The two legacy-only anomaly families (submitted+auto_graded
not terminalized; submitted workset mismatch) are detected READ-ONLY at
`GET /api/system/diagnostics` → `integrity` (admin-only, bounded sample with
identity for later canonical repair) — no auto-repair, no startup repair.

## 9. New discoveries

| Severity | Finding | Disposition |
| --- | --- | --- |
| P0 | none | — |
| P1 | none | — |
| P2 | none new (the two #268 P2s were confirmed and fixed) | — |
| P3 | `DiagnosticsResponseSchema` grew an `integrity` block — no wire-contract break (additive, admin-only route) | recorded |
| P3 | legacy detection queries are bounded at 100 rows (do not scan unbounded history) | recorded |

## 10. Deferred items

```text
Attempt.grading enum value            — UNREACHABLE_FOSSIL; deletion deferred (Phase 9)
Attempt not_started/queued/voided     — RESERVED_BY_CURRENT_ROADMAP / TARGET_DESIGN; not deleted
Enrollment.blocked                    — UNREACHABLE_RESERVED; not deleted
flagMisconduct command                — dead (zero callers); deletion deferred (Phase 10)
EmailDeliveryService.enqueueEmail / enqueueBestEffort — dead; deletion deferred
notificationRepo.insertMany           — dead; deletion deferred
DB CHECK on core enums                — intentional; DB-hardening candidate, not a defect
exam_incident_events.command_type CHECK — optional hardening, not a defect
0027-convergence parallel flake       — CI observation; no deterministic reproduction
```

## 11. Verification

All commands below ran against the branch:

| Command | Result |
| --- | --- |
| `pnpm --filter @exam/exam-engine build` | pass |
| `pnpm --filter @exam/domain build` / `@exam/contracts build` / `@exam/db build` | pass |
| `pnpm --filter @exam/exam-engine exec vitest run src/answerProtocol.test.ts src/saveAnswer.test.ts src/answerPreconditions.test.ts` | 49/49 pass |
| `pnpm --filter @exam/contracts exec vitest run` | 335/335 pass |
| `pnpm --filter api exec vitest run src/routes/publishResults.concurrency.test.ts` | 2/2 pass |
| `pnpm --filter api exec vitest run src/routes/resultPublishing.test.ts` | 15/15 pass |
| `pnpm --filter api exec vitest run src/routes/attempts/protocol-consistency.test.ts` | 16/16 pass |
| `pnpm --filter api exec vitest run src/routes/attempts/protocol-consistency.test.ts src/routes/attempts/candidate-take.test.ts src/routes/submitFreezeBarrier.test.ts` | 20/20 pass |
| `pnpm --filter api exec vitest run src/routes/crashAtomicity.test.ts` | 6/6 pass |
| `pnpm --filter api exec vitest run src/config/runtimeConfig.test.ts` | 111/111 pass |
| `pnpm --filter api exec vitest run src/routes/system.test.ts` | 25/25 pass |
| `pnpm verify` (full gate) | see Phase 13 |
| `pnpm lint:md` (touched markdown) | see Phase 13 |

## 12. Final authority model (what is now guaranteed)

- **Result publication**: exactly one caller owns `NULL → timestamp` per exam;
  losers observe committed truth; one audit; one logical fan-out; timestamp
  immutable after first publication — under any isolation level.
- **Answer protocol**: new saves require `baseVersion === currentVersion`;
  future versions are rejected with an explicit wire reason; idempotent
  same-`clientSeq` replay unchanged.
- **All irreversible exam mutations** (submit/grading freeze, manual grading
  terminalization, publication, interruption detect/restore, time grant,
  receipt-backed commands) commit atomically in one PostgreSQL transaction;
  retry after rollback succeeds; lost responses replay committed evidence.
- **Email**: outbox processing durable + ownership-fenced; delivery
  at-least-once with a fail-fast lease-config invariant and observable worker
  liveness.
- **Integrity**: legacy-only attempt anomalies are detectable read-only
  (admin diagnostics) and never auto-repaired.
- **Redis**: no exam authority added (rate-limit ephemeral + read-only
  diagnostics only).

## 13. Stop-condition answers (P7-S2 §Stop condition)

- Can concurrent result publication produce two winners? **No** — proven under RC and RR (deterministic barrier test).
- Can a client claim a future answer baseVersion? **No** — `FUTURE_VERSION` rejected (engine + wire tests).
- If submit crashes halfway, what durable state survives? **None partial** — full rollback to `in_progress` (crash test 1).
- If a response disappears after commit, what does retry return? **Committed truth** — idempotent re-grade / receipt replay (existing suites + orchestrator retry in crash test 1).
- Can manual grading leave a committed half-finalized attempt? **No** — entry completion and terminalization are one transaction (crash test 2).
- Can interruption restore commit compensation without restoring state? **No** — rollback leaves no adjustment/event/deadline change (crash test 5).
- Can Email be delivered twice? **Yes, bounded** — accepted at-least-once boundary, lease invariant + maxAttempts bound it.
- Can an abandoned Email claim recover after the worker returns? **Yes** — `recoverAbandoned` on the worker poll loop; liveness observable via system status.
- Any CURRENT-runtime committed partial states requiring startup reconciliation? **No** — NO GENERAL STARTUP RECONCILER (Phase 5).
- Has Redis acquired accidental Exam authority? **No**.
- Does `state-and-authority.md` describe current reality? **Yes** — rewritten for `1d3a0bd8`+P7-S2.
