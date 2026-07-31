# REC-I4-R0 — Interruption Detection and Time-Compensation Policy Reality Audit

## Status

`REC-I4-R0 PASS — DOCS-ONLY REALITY AUDIT AND CONTRACT FREEZE`

This Job changes no runtime behavior. It introduces no Redis dependency and
does not authorize implementation beyond the follow-up PRs listed below.

> **Closeout pointer (current authority):** the coupling defect frozen in
> §"Current restore/compensation coupling" below has since been resolved. The
> composed candidate-restore command is `restoreInterruptedAttempt()`; the
> lifecycle-only helper is `restoreAttemptState()`; operator grants use the
> separate `grantAttemptTime()` command. See ADR-013 and the IMPLEMENTED
> follow-up audits REC-I4-I1 / I2 / I3A / I3B1 for the as-built contract. The
> frozen findings below are retained unchanged as audit history.

## Base HEAD

```text
BASE_HEAD = 1f337bf87ea667278ceaac10b5068956cd65f324
branch    = docs/rec-i4-r0-interruption-policy
```

The base history proves that the prerequisite PRs are merged:

```text
1f337bf8 Merge pull request #221 from jnhu76/formal/rec-f1-recovery-protocol
55ee6de3 fix(exam): restore disrupted attempts from direct take entry (#219)
8f082b07 Merge pull request #218 from jnhu76/docs/rec-r1-recovery-contract
```

Current `master`/base history is the authority. Older documents that describe
any of these PRs as not merged are historical evidence, not current status.

## Files inspected

Required documents:

```text
docs/SPEC.md
docs/roadmap/phase-roadmap.md
docs/standards/code-quality.md
docs/adr/ADR-012-candidate-recovery-contract.md
docs/adr/ADR-006-exam-time-authority.md
docs/architecture/exam-system/candidate-recovery.md
docs/architecture/exam-system/state-and-authority.md
docs/audits/REC-R1-REALITY-AND-CONTRACT.md
docs/audits/REC-I3-IMPLEMENTATION.md
docs/audits/REC-F1-RECOVERY-PROTOCOL-FORMAL-MODEL.md
docs/deployment/mvp-deployment-runbook.md
```

Required runtime sources:

```text
apps/web/src/pages/exam/TakeExamPage.tsx
apps/api/src/plugins/heartbeat.ts
apps/api/src/routes/attempts.candidate.ts
apps/api/src/routes/attempts.shared.ts
apps/api/src/routes/attempts.admin.ts
apps/api/src/config/runtimeConfig.ts
apps/api/src/server.ts
apps/api/src/plugins/redis.ts
apps/api/src/plugins/deadlineScanner.ts
apps/api/src/routes/proctorMonitoring.ts
apps/api/src/routes/registerApiRoutes.ts
apps/api/src/lib/proctorMonitoringService.ts
apps/api/src/audit/auditPolicy.ts
packages/exam-engine/src/attemptCommands.ts
packages/exam-engine/src/answerProtocol.ts
packages/exam-engine/src/deadlineReconciliation.ts
packages/exam-engine/src/attemptStateMachine.ts
packages/exam-engine/src/lockSeam.ts
packages/domain/src/types.ts
packages/domain/src/enums.ts
packages/contracts/src/exam.ts
packages/contracts/src/attempt.ts
packages/db/src/schema/pg.ts
packages/db/src/repository/attemptRepo.ts
packages/db/src/repository/examRepo.ts
packages/db/src/types.ts
packages/authz/src/catalog.ts
packages/authz/src/presets.ts
docker-compose.yml
```

The requested path `apps/api/src/routes/attempts.proctor.ts` does not exist at
this base. Its absence was verified with `rg --files`. The current proctor
monitoring routes are in `proctorMonitoring.ts`; force-submit, misconduct, and
extend-time commands remain in `attempts.admin.ts`. This audit uses those
as-built files instead of inventing a missing module.

## Commands executed

```bash
git switch master
git pull --ff-only
git switch docs/rec-i4-r0-interruption-policy
git rev-parse HEAD
git branch --show-current
git status --short
git log -12 --oneline
wc -l <required files>
rg --files apps/api/src/routes | rg 'attempt|proctor'
rg -n \
  "heartbeat|lastActivityAt|markDisrupted|restoreAttempt|extendAttemptTime|deadlineAt|ensureAttemptDeadlineReconciled|HEARTBEAT_|REDIS_URL|disrupted" \
  apps packages docs docker-compose.yml
rg -n "lastActivityAt" apps packages --glob '*.ts' \
  --glob '!**/*.test.ts' --glob '!**/*.spec.ts'
rg -n \
  "InterruptionTimePolicy|interruption|time_adjust|incidentId|currentInterruptionId|interruptedAt|eligibleSeconds|beforeDeadline|afterDeadline|addedSeconds" \
  apps packages docs
rg -n "\\.redis\\b|ioredis|REDIS_URL" apps packages
pnpm format:check
pnpm lint:copy
pnpm lint:arch
pnpm verify:static
pnpm exec markdownlint-cli2 --no-globs :<each changed Markdown path>
git diff --check
```

The GitHub connector was used to verify that PRs #218, #219, and #221 each
have `merged = true` on the base repository.

PostgreSQL 18 official documentation was also checked through Context7:
[explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html),
[advisory-lock functions](https://www.postgresql.org/docs/18/functions-admin.html),
the [constraint reference](https://www.postgresql.org/docs/18/ddl-constraints.html),
and [partial indexes](https://www.postgresql.org/docs/18/indexes-partial.html).
It confirms that `SELECT ... FOR UPDATE` blocks conflicting row mutation,
transaction-level advisory locks are released automatically at transaction
end, a partial unique index can enforce uniqueness only for rows matching its
predicate, and PostgreSQL does not support a `CHECK` as a reliable cross-table
invariant. A foreign key target must be a primary key, unique constraint, or
non-partial unique index, which is why the episode parent defines an explicit
composite unique key. These findings support, but do not replace, the
repository evidence below.

## Current runtime facts

### Heartbeat runtime

| Question | Source-proven answer |
|---|---|
| Web send frequency | Fixed 30,000 ms interval in `TakeExamPage.tsx:792-795`; it is not sourced from API runtime config. |
| Immediate send on page entry | **No.** The effect only installs `setInterval`; it does not call `handleHeartbeat()` before the first interval (`TakeExamPage.tsx:792-795`). |
| Successful heartbeat write | The route requires an owned `in_progress` attempt, samples one `fastify.now()`, and explicitly updates only `lastActivityAt`; the base repository also refreshes generic `updatedAt`. The response returns the same instant as `serverNow` (`attempts.candidate.ts:972-1015`; `baseRepo.ts:153-171`). |
| Other `lastActivityAt` writers | Attempt creation sets it (`attemptCommands.ts:199-214`); an accepted **new** answer updates it atomically with answers (`answerProtocol.ts:365-368,440-452`); restore sets it (`attemptCommands.ts:440-447`). Idempotent answer replay and rejected saves do not write it. Read/load endpoints do not update it. |
| Scanner interval/timeout | `HEARTBEAT_SCAN_INTERVAL_MS` and `HEARTBEAT_TIMEOUT_MS`, positive integers with defaults 30,000/60,000 ms (`runtimeConfig.ts:648-653,679`). |
| Scanner ownership | `server.ts:77-95` registers the heartbeat plugin in every API process. Each registered plugin starts its own interval (`heartbeat.ts:193-237`). |
| Multi-instance behavior | Every API instance lists every organization and every `in_progress` attempt (`heartbeat.ts:150-188`; `attemptRepo.ts:315-331`). There is no cross-instance leader or distributed lock, so multiple instances duplicate the full scan and stale-candidate work. |
| Same-process overlap | `activeScan` suppresses overlapping ticks only inside one process (`heartbeat.ts:207-235`). It does not coordinate separate API instances. |
| Transition race defense | Each stale candidate is handled in its own transaction; `findByIdForUpdate` locks the attempt and status is re-read under lock (`heartbeat.ts:115-133`). A second scanner, submit, restore, or grading path that moved the row out of `in_progress` makes the transition a no-op. |
| Freshness re-check gap | The locked path re-checks only status. It does **not** re-read and re-evaluate `lastActivityAt` against the timeout. Because the heartbeat route does not take the row lock, a heartbeat that commits after stale discovery but before scanner locking can still be followed by `in_progress -> disrupted`. |
| Heartbeat atomicity gap | The route reads an owned `in_progress` Attempt and later calls an unconditional repository update by ID (`attempts.candidate.ts:981-1007`). Status validation and `lastActivityAt` update are not one atomic predicate or one row-lock decision. A scanner may commit `disrupted` between them, after which the heartbeat can still update the row and return success. |
| What row locking does not prevent | It does not prevent duplicate discovery queries, duplicated DB read load, repeated attempts to acquire the row lock, stale-discovery/fresh-heartbeat misclassification, or cross-instance metric duplication. |
| Metrics durability | `heartbeatMetrics` contains only `lastScanAt` and cumulative `disruptedCount` in module memory; the source explicitly says single-instance and reset-on-restart (`heartbeat.ts:38-45`). |
| Restart loss | API restart loses interval cadence, the in-flight scan, and process-local metrics. It does **not** lose committed `lastActivityAt`, `deadlineAt`, or lifecycle status in PostgreSQL. The server stores no durable per-heartbeat receipt/history. Browser failure counters are also page-memory refs (`TakeExamPage.tsx:186-191,766-787`). |

The scanner skips attempts with null `lastActivityAt` and only marks
`in_progress` attempts whose elapsed server time meets the configured timeout
(`heartbeat.ts:67-89`). A hidden browser is not itself an interruption fact:
visibility telemetry is a separate client event, while the heartbeat interval
continues to be scheduled (`TakeExamPage.tsx:797-820`). Browser scheduling
throttling can therefore contribute to missed heartbeats without proving
network loss.

The source comment at `heartbeat.ts:107-109` says the transaction writes an
audit entry, but the function body at `heartbeat.ts:120-133` only locks and
calls `markDisrupted`. This agrees with the active audit policy: both
`attempt.disrupted` and `attempt.restore` are deprecated
`domain_history` actions, not compliance-ledger writes
(`auditPolicy.ts:173-178,207-218`). The canonical attempt row is the current
lifecycle authority; there is no durable interruption episode record.

### Restore and compensation runtime

The engine command currently combines three effects:

1. `disrupted -> in_progress`;
2. `lastActivityAt = now`;
3. `deadlineAt += max(0, now - lastActivityAt)`, clamped only to
   `exam.closeAt`.

Evidence: `attemptCommands.ts:394-449`. There is no policy selection,
per-incident cap, per-attempt aggregate cap, interruption ID, incident
association, or adjustment ledger in the domain types, contracts, exam/attempt
schema, or repositories (`types.ts:238-270,303-340`;
`contracts/exam.ts:64-91,112-176`; `schema/pg.ts:209-275,307-367`).

There are two restore entry paths:

- Explicit candidate restore:
  `POST /attempts/:attemptId/restore` opens a transaction, acquires the
  canonical Enrollment -> Attempt locks, runs
  `ensureAttemptDeadlineReconciled`, then calls the coupled `restoreAttempt`
  (`attempts.candidate.ts:1018-1093`).
- Candidate start-or-restore:
  `POST /attempts/:examId/start` opens a `READ COMMITTED` transaction and
  `startOrRestoreAttempt` locks Enrollment/active Attempt, but calls
  `restoreAttempt` directly without canonical attempt-deadline reconciliation
  (`attempts.candidate.ts:537-644`; `attemptCommands.ts:128-171`).

The explicit restore route therefore orders **reconciliation before
compensation**. If the old effective deadline has expired, reconciliation
performs a terminal freeze, after which `restoreAttempt` rejects the terminal
status (`deadlineReconciliation.ts:218-312`;
`attemptCommands.ts:410-419`). Because both calls are in one transaction, that
throw rolls back the reconciliation mutation. REC-I3 compensates at the Web
protocol layer by treating a restore 409 as an acknowledgement to perform a
new authoritative GET; that GET runs its own reconciliation transaction and
can commit the terminal result. The restore POST itself does not cleanly
return that terminal result. This rollback-shaped coupling is one reason the
new policy seam must return explicit lifecycle and compensation results.

The explicit route also samples `fastify.now()` separately for reconciliation,
restore, and response mapping (`attempts.candidate.ts:1070-1092`) rather than
capturing one operation timestamp. The implementation work must restore the
ADR-006 one-operation/one-time-sample discipline.

Duplicate restore POSTs do not currently double-add time because
`restoreAttempt` locks the row and returns unchanged when it sees
`in_progress` (`attemptCommands.ts:405-412`). Concurrent requests serialize on
the row; the first successful restore updates status, and the later request
observes `in_progress`. A lost response followed by retry has the same
state-based behavior. This is accidental command idempotency tied to the
status bit, not an interruption-episode identity or adjustment-ledger
guarantee.

### Existing operator extension runtime

| Question | Source-proven answer |
|---|---|
| Allowed states | Only `in_progress` and `disrupted` (`attemptCommands.ts:520-525`). |
| Amount validation | Integer `additionalMinutes > 0` at both Zod and engine boundaries (`contracts/attempt.ts:359-371`; `attemptCommands.ts:511-513`). |
| `exam.closeAt` | New deadline beyond close is rejected, not clamped (`attemptCommands.ts:532-543`). |
| Row lock | `findByIdForUpdate` before state/deadline mutation (`attemptCommands.ts:515-548`; repository implementation `attemptRepo.ts:195-206`). |
| Transaction | Route wraps command and audit insert in one PostgreSQL transaction (`attempts.admin.ts:295-335`). |
| Permission | Current route checks `attempt.time.extend`; Admin and Proctor presets both contain it, although route OpenAPI currently advertises only Admin (`attempts.admin.ts:274-285`; `presets.ts:97-104,144-154`). |
| Scope enforcement gap | The route uses `requireCapability`, not the resource-aware `requireScopedCapability`, even though the route registry models Attempt scope (`attempts.admin.ts:277-280`; `routeRegistry.ts:442-451`). |
| Required reason | None. The request body contains only `additionalMinutes`. |
| Attribution | The atomic compliance audit identifies the authenticated actor through audit context and records only `additionalMinutes` (`attempts.admin.ts:328-333`). |
| Domain ledger | None. There is no before/after deadline, added seconds, policy, source, incident, or stable adjustment operation ID. |

The existing command is a useful low-level deadline mutation, but it is not a
complete `operator_incident` contract. That path additionally needs an
explicit reason, resource-scoped authorization, actor/source attribution,
idempotency identity, optional `incidentId`, and an append-only domain ledger
insert in the same transaction as the deadline update. A generic compliance
audit row may reference the domain ledger ID but cannot replace it.

The separate proctor-incident endpoint is audit-event-only, has no dedicated
incident entity, and does not link its optional reason/note to an extension
transaction (`proctorMonitoring.ts:192-200,225-282`). Also, the current
extension route does not reconcile deadline before extending. It can extend an
active row whose deadline has elapsed but whose terminal transition has not
yet committed. I3 must replace that ambiguity with the frozen grant ordering.

### Documentation reality deltas

Several inspected documents intentionally preserve older snapshots and must
not be read as current runtime:

- ADR-012 and REC-R1 say the explicit restore route has no Web caller
  (`ADR-012:27-35`; `REC-R1:63-69,84-89`). REC-I3 and current
  `TakeExamPage.tsx:419-432` supersede that fact.
- The deployment runbook's disrupted-attempt note described the pre-REC-I3
  UI at the base and is corrected by this docs-only Job.
- `state-and-authority.md:288` calls `lastActivityAt` a heartbeat field, but
  current source also writes it on accepted new answers, attempt creation, and
  restore. It is server-observed activity evidence.
- `state-and-authority.md:287` calls `attempt.deadlineAt` the effective
  deadline; the canonical effective value is
  `min(exam.closeAt, attempt.deadlineAt)`
  (`deadlineReconciliation.ts:127-193`).

## Heartbeat timing and evidence boundary

The following principle is frozen:

```text
heartbeat timeout
  = evidence that the server has not recently observed qualifying activity

heartbeat timeout
  != proof that the candidate was offline for the same duration
  != proof that the candidate deserves equal additional time
```

`lastActivityAt` currently conflates the most recent successful heartbeat,
accepted new answer, attempt creation, and restore. It is therefore an
activity watermark, not a network-state timeline and not a last-answer-only
timestamp. A successful answer save can keep the attempt active while
heartbeats fail; a successful heartbeat can keep it active while answer saves
fail.

Server-observed evidence may be used to:

- mark an attempt `disrupted`;
- create and correlate an interruption episode;
- bound the eligible window for explicitly configured technical grace;
- correlate telemetry and operator investigation.

It must not be translated directly into:

```text
addedSeconds = now - lastActivityAt
```

Client timestamps, visibility duration, and client-reported offline duration
are non-authoritative telemetry. ADR-006 remains binding: the API samples
`fastify.now()` and passes an explicit `now` into engine decisions.

### Frozen scanner/heartbeat serialization

Scanner discovery is advisory only. Inside the Attempt row lock, it must
recheck:

```text
locked.status === "in_progress"
locked.lastActivityAt is not null
scannerTickNow - locked.lastActivityAt >= heartbeatTimeout
```

The same once-captured `scannerTickNow` is used for discovery, locked
freshness evaluation, transition, detected-event `occurredAt`, and
`interruptedAt`. The discovery-stage `lastActivityAt` cannot authorize
`disrupted`.

Heartbeat must combine its state predicate and write atomically:

```sql
UPDATE exam_attempts
SET last_activity_at = :now
WHERE id = :attemptId
  AND status = 'in_progress'
RETURNING ...;
```

An equivalent transaction with `FOR UPDATE` and locked status recheck is
allowed. A zero-row update is not heartbeat success. No heartbeat may update
a `disrupted` or terminal row.

The two legal commit orders are:

1. **Heartbeat commits first.** Scanner later locks the row, reads the updated
   `lastActivityAt`, recomputes staleness with `scannerTickNow`, and does not
   disrupt unless the locked value is stale.
2. **Scanner commits first.** A heartbeat that previously read
   `in_progress` waits or retries its write predicate, then observes
   `disrupted`; it updates zero rows and cannot return success.

REC-I4-V1 must include the explicit regression:

```text
heartbeat reads in_progress
→ scanner locks and commits disrupted
→ heartbeat attempts the update
→ heartbeat does not succeed and does not update lastActivityAt
```

## Current Redis reality

The implemented MVP has no Redis-backed heartbeat, presence, admission queue,
deadline, time-compensation, or other exam business-state code.

Evidence:

- Compose declares Redis as an optional `redis` profile and explicitly states
  that no MVP business code reads or writes it (`docker-compose.yml:16-18,
  96-105`).
- `REDIS_URL` defaults to empty/disabled (`docker-compose.yml:24-29`;
  `runtimeConfig.ts:461-473,655-668`).
- The Redis plugin only constructs/decorates a client
  (`plugins/redis.ts:16-47`); the only production command located by source
  search is diagnostics `PING` (`routes/system.ts:362-367`).
- Scanner operation is documented and implemented in-process with
  PostgreSQL-backed attempt facts
  (`mvp-deployment-runbook.md:452-475,479-518`).
- `worker_heartbeats` in `schema/pg.ts:697-731` belongs to the Email worker,
  not candidate presence or attempt heartbeat.

Frozen infrastructure boundary:

```text
Current supported MVP:
  Fastify in-process interval
  + PostgreSQL lastActivityAt
  + PostgreSQL transaction and row lock

Future scanner leader coordination:
  PostgreSQL transaction-level advisory lock first

Future presence/realtime fan-out:
  Redis may be evaluated later
```

REC-I4 does not introduce Redis. PostgreSQL remains the sole authority for
attempt lifecycle, deadline, timing-policy snapshot, interruption identity,
time-adjustment ledger, and audit attribution. Redis may later assist
presence caching, realtime broadcast, cross-instance WebSocket/SSE fan-out,
or rate limiting. Redis TTL expiry must never directly cause an irreversible
attempt transition. Even with Redis, the final `disrupted` transition requires
a PostgreSQL transaction, row lock, and under-lock state/evidence re-check.

The multi-instance problems are independent:

1. duplicate scanner discovery/read load; and
2. realtime presence/monitoring fan-out.

A transaction-level PostgreSQL advisory-lock leader election can solve the
first without making Redis authoritative. Redis may later help the second.

## Current restore/compensation coupling

The current coupling is a confirmed runtime mismatch with ADR-012 and the
REC-F1 target model:

```text
restoreAttempt()
  lifecycle transition
  + activity refresh
  + full observed-gap deadline extension
```

ADR-012 already requires independent
`restoreAttemptState()`/`evaluateInterruptionTimePolicy()` concerns
(`ADR-012:532-560`). REC-F1 likewise models restore and grant as separate
actions and labels the current command a runtime mismatch
(`REC-F1:300-309`). REC-I4 freezes the missing details; it does not edit the
runtime.

## Deadline ordering analysis

### Strict

Frozen order:

```text
BEGIN
-> canonical Enrollment -> Attempt lock
-> authoritative Exam lock/read
-> reconcile deadline
-> if terminal: return terminal result
-> if still disrupted and resumable: restore lifecycle
-> compensation result = addedSeconds 0
-> record interruption restore event
-> clear current interruption pointer
-> COMMIT
```

No deadline update and no time-adjustment row are produced. A terminal result
must be returned as a legitimate command result, not converted into an error
that rolls back reconciliation.

### Bounded grace

Predeclared bounded grace **may participate in the effective deadline before
the final reconciliation**, but only for a currently `disrupted`,
non-terminal attempt with an active, server-created interruption episode.

Frozen order:

```text
BEGIN
-> canonical Enrollment -> Attempt lock
-> authoritative Exam lock/read
-> reject already-terminal attempt
-> load and validate active interruption episode
-> load immutable attempt timing-policy snapshot
-> evaluate eligible server-observed duration and every cap
-> create one idempotent adjustment decision for interruptionId
-> if addedSeconds > 0:
     update deadlineAt
     insert time-adjustment ledger row
-> reconcile against the adjusted authoritative effective deadline
-> if still resumable: disrupted -> in_progress
-> otherwise terminal wins
-> append interruption outcome event and clear current pointer
-> COMMIT
```

This is not terminal resurrection. A committed submitted/grading/graded/voided
attempt is never restored. Only a currently `disrupted` attempt that has not
completed a terminal transition may receive its preconfigured bounded
decision. Adjustment, reconciliation, restore, event append, and pointer clear
are one transaction.

The lock order must preserve the repository's canonical
Enrollment -> Attempt seam (`lockSeam.ts:47-120`) and then take the Exam lock,
matching the audited deadline scanner order
(`deadlineScanner.ts:146-176`). Future implementation must not introduce an
Exam -> Attempt inversion.

### Operator incident

Candidate restore grants zero seconds and follows the strict lifecycle order.
An operator grant is a separate explicit command with its own authorization,
reason, operation identity, and ledger row. The ordinary extension/grant
command must reject terminal attempts. Reopening, undoing submission, or
rolling back grading is a separate high-risk Job and is not authorized here.

## Existing operator-extension analysis

The current `extendAttemptTime` can supply the deadline arithmetic primitive
for a later operator command, but its public contract is insufficient:

- minute granularity only, while the frozen ledger records exact seconds;
- no mandatory reason or reason code;
- no interruption/incident correlation;
- no stable idempotency key;
- no before/after/eligible/added values persisted in a domain ledger;
- no resource-scoped capability gate on the current route;
- no explicit distinction among operator incident, system incident, and
  administrative correction.

I3 must either wrap or replace this command behind a policy-aware operator
grant seam and replace the flat `requireCapability` check with
`requireScopedCapability` for the new grant authority. It must not silently
reinterpret every existing manual extension as an interruption incident.

## Threat/abuse cases

| # | Case | Current reality/risk | Frozen response |
|---:|---|---|---|
| 1 | Candidate intentionally disconnects to gain time | Current restore can return the full activity gap up to close. | Default `strict`; bounded grace is explicit, capped, episode-idempotent, and server-observed only. |
| 2 | Browser hidden while network remains online | Visibility telemetry is separate; interval throttling may delay beats. | Visibility is telemetry, not entitlement; it cannot create a grant. |
| 3 | Heartbeat fails while answer save succeeds | Accepted new save advances `lastActivityAt`; scanner may see activity. | Treat the shared field as activity evidence, not proof of network state; no client duration trust. |
| 4 | Heartbeat succeeds while answer save fails | `lastActivityAt` advances although answer transport failed. | Heartbeat/presence never proves answer durability; answer protocol remains separate authority. |
| 5 | API process restarts | In-memory metrics/cadence/in-flight scan disappear; DB facts survive. | Decisions derive from PostgreSQL episode/ledger state; restart cannot duplicate a bounded grant. |
| 6 | PostgreSQL briefly unavailable | Heartbeat writes/scans/restore fail; no authoritative mutation commits. | Fail closed and retry; no grant from client memory or Redis fallback. |
| 7 | Two API scanners scan together | Duplicate full scans and row-lock contention; one transition wins. | Preserve row lock/re-check; later add PostgreSQL advisory-lock leader coordination. |
| 8 | Scanner races candidate submit | Both target the attempt row; locked status re-check prevents `submitted -> disrupted`. | Preserve Enrollment -> Attempt ordering and terminal monotonicity. |
| 9 | Heartbeat scanner races deadline scanner | One may disrupt while the other submits; final result depends on lock order and state re-check. | Terminal transition wins; interruption outcome records terminalization, never restore. |
| 10 | Two restore POSTs race | Current row lock/status bit prevents a second extension. | Unique interruption decision + row lock make lifecycle and grant independently idempotent. |
| 11 | Restore response is lost, then retried | Current retry sees `in_progress`; no second current extension. | Retry returns the committed decision/result by interruption/operation identity. |
| 12 | Same interruption is granted twice | No durable identity/ledger currently proves at-most-once. | Partial unique constraint: at most one automatic bounded grant per `interruptionId`. |
| 13 | Multiple interruptions consume aggregate cap | No aggregate accounting exists. | Sum authoritative bounded-grace ledger rows under the attempt lock before each decision. |
| 14 | Exam configuration changes mid-attempt | Current attempt has no time-policy snapshot. | Immutable attempt snapshot; exam edits affect only attempts created afterward. |
| 15 | `exam.closeAt` precedes proposed adjusted deadline | Current auto restore clamps; manual extension rejects. | All grants satisfy `afterDeadline <= exam.closeAt`; remaining close room is a hard cap. |
| 16 | Restore arrives after old deadline but before terminal transition commits | Current explicit route reconciles first and cannot apply grace; thrown restore can roll back same-transaction reconcile. | Bounded policy may adjust before final reconcile only while row is still locked `disrupted`; strict reconciles first. |
| 17 | Operator extends a submitted attempt | Current engine rejects non-active states. | Preserve rejection; terminal reopen is out of scope. |
| 18 | Manual extension races automatic bounded grant | Current commands serialize on attempt, but no shared ledger semantics. | Both use the same attempt/Exam lock boundary; each records exact before/after state. Bounded aggregate counts only bounded-grace ledger rows. |
| 19 | Client forges offline duration/timestamp | Current restore does not accept duration but infers full gap from a mixed activity field. | No client timestamp/duration is authoritative; eligible duration comes only from server evidence. |
| 20 | Redis is down or loses data | Redis is optional and unused for business state. | No effect on authoritative detection, deadline, grant, or ledger decision. |
| 21 | Heartbeat reads active while scanner commits disruption | Current route can update by ID and return success after scanner commit. | Heartbeat write is status-qualified/locked; after scanner wins it updates zero rows, returns no success, and does not change `lastActivityAt`. |

## Frozen policy contract

### Policy type and default

```ts
type InterruptionTimePolicy =
  | "strict"
  | "bounded_grace"
  | "operator_incident";
```

The default is `strict`. Historical exams, unconfigured exams, and backfilled
attempts must behave conservatively: restore lifecycle only and grant zero.
The current full-gap compensation is not retained as an implicit default.

### `strict`

```text
restore lifecycle only
automatic addedSeconds = 0
```

### `bounded_grace`

This policy is valid only with explicit per-exam configuration:

```text
perIncidentCapSeconds > 0
perAttemptAggregateCapSeconds > 0
perIncidentCapSeconds <= perAttemptAggregateCapSeconds
```

For one interruption:

```text
eligibleSeconds =
  floor(max(0, decisionNow - detectedEvent.occurredAt) / 1000)

addedSeconds =
  min(
    eligibleSeconds,
    perIncidentCapSeconds,
    max(
      0,
      perAttemptAggregateCapSeconds - priorBoundedGraceAddedSeconds
    ),
    floor(max(0, exam.closeAt - beforeDeadline) / 1000)
  )
```

No hidden numeric default or magic number is permitted. A zero result is a
recorded policy decision/event but not a time-adjustment ledger row, because
the ledger invariant is `addedSeconds > 0`.

The unique detected event `occurredAt` is authoritative `detectedAt`.
`interruptedAt` mirrors it only while the episode is active. Eligibility begins
at the authoritative event time, not at `lastActivityAt`, and never at a client
timestamp. The timeout/discovery window before that transition is evidence of
missing observations, not automatically grantable duration.

### `operator_incident`

```text
candidate restore automatically adds 0 seconds
authorized operator explicitly grants time
reason and actor attribution are mandatory
incidentId is nullable until REC-I6 supplies a formal system incident
```

## Proposed domain model

Frozen semantic types:

```ts
type InterruptionTimePolicy =
  | "strict"
  | "bounded_grace"
  | "operator_incident";

interface AttemptTimingPolicySnapshot {
  schemaVersion: 1;
  policy: InterruptionTimePolicy;
  perIncidentCapSeconds: number | null;
  perAttemptAggregateCapSeconds: number | null;
}

type TimeAdjustmentSource =
  | "bounded_grace"
  | "operator"
  | "system_incident"
  | "administrative_correction";
```

Exam configuration:

```text
interruptionTimePolicy
interruptionGracePerIncidentSeconds
interruptionGracePerAttemptSeconds
```

Constraints:

```text
strict:
  both caps MUST be null

bounded_grace:
  both caps MUST be present and positive
  perIncident <= perAttempt

operator_incident:
  both automatic caps MUST be null
```

The policy and caps **must be snapshotted at attempt creation**. The snapshot
is immutable. This prevents an admin edit during an active exam from changing
the recovery outcome of an existing attempt.

The persistence representation is three policy-value columns plus a snapshot
version column, exposed to the engine as `AttemptTimingPolicySnapshot`:

```text
interruption_policy_snapshot_version
interruption_time_policy_snapshot
interruption_grace_per_incident_seconds_snapshot
interruption_grace_per_attempt_seconds_snapshot
```

Interruption identity on the attempt:

```text
currentInterruptionId: UUID | null
interruptedAt: server timestamp | null
```

The final identity design uses an `attempt_interruptions` parent row. The
Attempt pointer is a composite foreign key:

```text
exam_attempts(organizationId, id, currentInterruptionId)
  → attempt_interruptions(organizationId, attemptId, id)
```

This is not left as a repository-only convention for I1: the FK prevents
missing, cross-attempt, and cross-organization active references. The episode
parent exists independently of the append-only event rows and remains after
the active pointer is cleared.

Scanner transition rules:

- `in_progress -> disrupted` creates a fresh interruption UUID and durable
  episode parent, detected event, Attempt pointer/mirror, and lifecycle change
  in the same transaction;
- after locking, the scanner rechecks `in_progress`, the locked
  `lastActivityAt`, and timeout eligibility using the tick's single captured
  `now`;
- re-scanning the same `disrupted` state creates no new episode;
- restore, bounded policy decision, and telemetry use the same ID;
- restore/terminal resolution fills the episode outcome once and clears both
  current pointer fields;
- `interruptionId` identifies one attempt episode;
- nullable `incidentId` identifies a future service incident shared by many
  attempts. They are never interchangeable.

Episode time authority is:

```text
detectedAt =
  unique detected event for interruptionId .occurredAt
```

While active,
`exam_attempts.interruptedAt === detectedEvent.occurredAt`.
`interruptedAt` is only a fast-access mirror. After pointer clearing, the
append-only detected event remains the permanent authority. Bounded-grace
eligibility starts at that event time and is never reconstructed from
`lastActivityAt`, a client timestamp, or a guessed historical time. A
migration-labelled episode may use only its explicitly recorded migration
instant.

Lifecycle and compensation are separate domain concerns:

```text
restoreAttemptState()
evaluateInterruptionTimePolicy()
```

They may execute in one transaction, but have separate input/output types,
tests, persistence records, and failure results. State restore does not imply
time grant. A compensation failure must roll back and surface as a failure,
not be reported as a successful restore.

## Proposed persistence model

### Interruption parent

`attempt_interruptions` is the stable FK parent:

```text
id                 UUID primary key; interruptionId
organizationId
attemptId
createdAt
```

It has a unique key on `(organizationId, attemptId, id)`. Event rows reference
the parent, and the Attempt uses the composite active-pointer FK frozen above.
The parent is never reused for a later disruption. Its `createdAt` is row
metadata, not the authoritative `detectedAt`.

### Interruption event ledger

A minimal append-only interruption event ledger preserves episode history
even when `strict` grants zero and the attempt's current pointer is cleared:

```text
id
organizationId
attemptId
interruptionId
eventType       detected | restored | terminalized
occurredAt
observedLastActivityAt   required on ordinary detected events
detectionSource          required on detected events
timeoutSeconds           required on ordinary detected events
policy
eligibleSeconds           nullable
timeAdjustmentId          nullable
actorId         nullable for System
reasonCode
createdAt
```

For one `interruptionId` the contract is:

```text
exactly one detected event
at most one outcome event:
  restored OR terminalized
```

Database direction:

```sql
CREATE UNIQUE INDEX ... ON attempt_interruption_events (interruption_id)
WHERE event_type = 'detected';

CREATE UNIQUE INDEX ... ON attempt_interruption_events (interruption_id)
WHERE event_type IN ('restored', 'terminalized');
```

These indexes enforce at-most-one. The episode-creation transaction guarantees
the required detected event exists before commit.

Interruption events deliberately have no `operationId`. The
`interruptionId`/active-pointer decision identifies scanner retries, and the
detected/outcome partial unique indexes identify event retries. Adding an
event operation identity would duplicate those keys and be confused with the
caller-supplied time-adjustment `operationId`. This domain history is not a
substitute for the separate time-adjustment ledger.

### Time-adjustment ledger

Append-only semantic fields:

```text
id
operationId
organizationId
attemptId
interruptionId        nullable for manual non-interruption adjustment
incidentId            nullable; reserved for REC-I6
policy
source
beforeDeadline
afterDeadline
addedSeconds
eligibleSeconds
reasonCode
reasonText            nullable generally; required for operator paths
actorId               nullable for automatic policy; required for operator paths
createdAt
```

Frozen invariants:

- append-only: no update/delete business API;
- `addedSeconds > 0`;
- `eligibleSeconds` is required and non-negative for `bounded_grace`, otherwise
  nullable;
- `afterDeadline > beforeDeadline`;
- `afterDeadline - beforeDeadline = addedSeconds * 1000 ms`;
- `afterDeadline <= exam.closeAt`, enforced transactionally against the locked
  Exam row;
- automatic `bounded_grace` has exactly one positive-grant row at most per
  `interruptionId`;
- deadline update and ledger insert commit in the same transaction;
- bounded aggregate usage is the sum of authoritative
  `source=bounded_grace` ledger rows for the attempt;
- a transactionally maintained counter is allowed only after equivalence to
  the ledger sum is proven and protected by constraints/tests;
- a generic audit event may reference `ledgerId` but cannot replace this row.

### Constraint enforcement boundary

#### Same-table database constraints

PostgreSQL same-table `CHECK`/`UNIQUE` constraints and partial unique indexes
must enforce:

- Exam caps and Attempt snapshot caps are null for `strict` and
  `operator_incident`;
- both `bounded_grace` caps are positive;
- `perIncidentCapSeconds <= perAttemptAggregateCapSeconds`;
- adjustment `addedSeconds > 0`;
- adjustment `afterDeadline > beforeDeadline`;
- adjustment `afterDeadline - beforeDeadline = addedSeconds * 1000 ms`;
- policy/source-dependent required or null actor, reason, interruption, and
  eligible fields;
- one bounded-grace adjustment at most per `interruptionId`;
- unique time-adjustment `(organizationId, operationId)`;
- one detected event at most and one outcome event at most per interruption.

Database foreign keys additionally enforce episode/event/adjustment
references, including the composite active-pointer FK. They do not prove that
an episode parent has its required detected child event.

#### Transaction and integration-test invariants

The locked repository transaction and PostgreSQL tests must guarantee:

- `afterDeadline <= exam.closeAt`;
- deadline update and time-adjustment insert are atomic;
- episode parent, detected event, active pointer, `interruptedAt` mirror, and
  `disrupted` transition are atomic;
- exactly one detected event exists for every committed episode;
- while active, `interruptedAt` equals the detected event's `occurredAt`;
- the bounded aggregate cap is calculated from authoritative ledger rows
  while the Attempt is locked;
- Exam, Attempt, episode, event, and ledger cross-table organization/identity
  relationships remain consistent beyond explicit FKs;
- scanner and heartbeat produce a non-contradictory result in both commit
  orders;
- outcome append and pointer clearing commit with restore/reconciliation.

An ordinary PostgreSQL `CHECK` must not query another table. In particular,
`exam.closeAt`, detected-event existence, active-pointer/event agreement, and
aggregate sums are not claimed as `CHECK` constraints.

Historical backfill:

- existing exams: `strict`, both caps null;
- existing attempts: strict snapshot, both snapshot caps null;
- existing non-disrupted attempts: current interruption pointer fields null;
- an existing `disrupted` attempt receives one migration-labelled interruption
  UUID and a conservatively captured migration timestamp, solely so lifecycle
  restore and episode correlation remain possible; its strict snapshot grants
  zero and the event must not claim a historically precise outage start;
- no synthetic adjustment rows for historical `deadlineAt` values;
- historical manual extensions remain unattributed legacy facts and must not
  be fabricated as operator incidents.

## Transaction and lock boundary

All interruption resolution and deadline adjustment work is one PostgreSQL
transaction. It must:

1. acquire the canonical Enrollment -> Attempt lock capability;
2. re-read attempt status and interruption identity under lock;
3. lock/read the authoritative Exam before evaluating close-room;
4. load the immutable attempt policy snapshot;
5. calculate the policy decision using one server `now`;
6. insert the idempotent ledger decision and update deadline atomically;
7. reconcile against the resulting effective deadline;
8. apply lifecycle restore only if still resumable;
9. append the interruption outcome and clear the current pointer;
10. commit one unambiguous result.

Scanner creation of an interruption episode is likewise atomic with
`in_progress -> disrupted`. Under the row lock it rechecks status and the
locked `lastActivityAt` against the same tick `now`. Heartbeat uses an atomic
status-qualified update or an equivalent locked recheck. A telemetry write
may fail independently, but the domain event/pointer transition may not.

## Idempotency model

Automatic bounded grace:

- identity: `interruptionId`;
- interruption event retries use `interruptionId` and partial unique indexes,
  not an event `operationId`;
- database enforcement: unique positive bounded-grace adjustment per
  interruption;
- repeated/concurrent restore reads the committed decision and never
  recomputes from a later `now`;
- a zero-grant decision is preserved in the interruption outcome/event ledger
  so retries remain explainable.

Operator grants:

- require a stable caller-supplied `operationId` UUID;
- unique `(organizationId, operationId)` constraint;
- same operation/payload replay returns the existing ledger result;
- same operation with different payload is a conflict;
- a new operation ID is a new explicit operator decision, still bounded by
  active state and `exam.closeAt`.

The partial unique index is a last-line concurrency guarantee, not a
replacement for the attempt row lock and state re-check.

## Role/permission requirements

- Candidate may restore only their own attempt and cannot grant time.
- Automatic bounded grace runs as the non-login System actor under a narrowly
  defined system permission, but writes `actorId = null` and source
  `bounded_grace`; it must not masquerade as a human Admin.
- Operator grant requires the dedicated sensitive permission
  `attempt.time.grant`, resolved against the attempt/exam scope.
- In Phase 1.x, only Admin may hold and invoke the operator-grant permission.
- Teacher-like, Proctor, and Grader product roles remain deferred. A future
  Phase 3 decision may bind the permission to a scoped role; REC-I4 does not
  authorize or expose that product surface.
- `administrative_correction` is Admin-only and additionally requires
  `attempt.time.correct`.
- `system_incident` grant remains disabled until REC-I6 defines incident
  creation/authorization and a System-only grant permission.
- Candidate restore cannot select policy, caps, source, actor, incident ID, or
  added seconds.

The existing `attempt.time.extend` route is not silently upgraded into all of
these authorities. I3 must migrate compatibility deliberately to the new
grant command and permission.

## Migration/backfill implications

REC-I4-I1 must add database enums/checks or equivalent constrained text,
exam fields, immutable attempt snapshot fields, interruption pointer fields,
the `attempt_interruptions` parent, composite active-pointer FK, interruption
event ledger, and time-adjustment ledger.

Required migration properties:

- safe additive rollout;
- conservative `strict` backfill before `NOT NULL` enforcement;
- caps null for strict/operator rows;
- bounded caps positive and ordered;
- foreign keys include the organization/attempt-consistent active-pointer
  model;
- append-only repositories expose inserts/reads, not arbitrary update/delete;
- partial uniqueness for detected/outcome events and automatic grant
  idempotency;
- no event `operationId`; adjustment `(organizationId, operationId)` remains
  unique;
- no fourth database, Redis migration, or historical grant fabrication.

I1 does not change restore runtime. Runtime starts consuming the new fields
only in I2 after old rows are safely backfilled.

## Test matrix

| Layer | Required cases |
|---|---|
| Domain validation | Three policy shapes; default strict; null/positive cap constraints; per-incident <= aggregate. |
| Snapshot | Attempt copies current exam policy/caps once; later exam edits do not change it; historical strict backfill. |
| Episode creation | One UUID on `in_progress -> disrupted`; repeat scanner no-op; new UUID after a later independent disruption. |
| Heartbeat wins scanner race | Heartbeat atomic update commits first; scanner locks afterward, uses the tick's same `now`, reads the refreshed `lastActivityAt`, and does not disrupt a fresh row. |
| Scanner wins heartbeat race | Heartbeat reads `in_progress`; scanner locks and commits `disrupted`; heartbeat then updates zero rows, returns no success, and leaves `lastActivityAt` unchanged. |
| Strict restore | Zero added seconds; no adjustment row; restore event; expired terminal result commits. |
| Bounded calculation | Eligible duration, per-incident cap, remaining aggregate cap, and close-room cap individually and in combination. |
| Idempotency | Concurrent restores, repeated restore, lost response/retry, one positive ledger row per interruption. |
| Aggregate | Multiple episodes consume remaining cap exactly; zero remaining gives zero grant/event only. |
| Deadline ordering | Old deadline expired but terminal transition uncommitted; bounded policy may apply first; already-terminal always rejects restore. |
| Races | Heartbeat scanner vs submit; heartbeat scanner vs deadline scanner; manual grant vs bounded grant; exam close/update vs adjustment. |
| Operator | Required reason/actor/operationId; same replay; conflicting payload; Admin grant; Candidate denial; no Phase 1.x Proctor surface. |
| Ledger constraints | Append-only API; positive seconds; before/after equality; close cap; organization isolation. |
| Infrastructure | Two scanners with advisory-lock leader experiment; Redis absent/down has no semantic effect. |
| E2E | Strict default recovery; configured bounded recovery; terminal race; operator grant attribution. |
| Formal follow-up | Make time-grant action reachable only if REC-I4 runtime semantics require updating REC-F1; preserve terminal monotonicity. |

## Implementation PR decomposition

### REC-I4-I1 — Domain + persistence foundation

```text
enums/types/contracts
Exam policy configuration
Attempt timing-policy snapshot
interruption identity fields and append-only episode events
time-adjustment ledger
migration + DB constraints + conservative backfill
repository APIs
```

No restore runtime change.

### REC-I4-I2 — Engine policy seam

```text
markDisrupted records interruption episode
restoreAttemptState lifecycle-only
evaluateInterruptionTimePolicy
bounded-grace calculation
idempotent ledger insert
atomic deadline adjustment
deadline reconciliation ordering
engine tests
```

### REC-I4-I3 — API and authoring surfaces

```text
candidate restore wiring
Exam create/edit policy config
operator grant reason + operation identity + attribution
resource-scoped permissions and OpenAPI
Admin/Candidate/API authorization tests
no Proctor product surface
```

### REC-I4-V1 — Verification closeout

```text
PostgreSQL concurrency tests
heartbeat-commit-first scanner ordering
scanner-commit-first heartbeat ordering
locked lastActivityAt freshness recheck
duplicate restore
deadline race
scanner race
aggregate cap
exam.closeAt cap
lost-response retry
E2E
formal model update if required
```

These are independently reviewable vertical PRs. A single giant
implementation PR is not authorized.

## Validation

The docs-only closeout gates passed on 2026-07-28:

### Modified files

```text
docs/README.md
docs/adr/ADR-013-interruption-time-compensation-policy.md
docs/adr/README.md
docs/architecture/exam-system/candidate-recovery.md
docs/architecture/exam-system/state-and-authority.md
docs/audits/REC-I4-R0-INTERRUPTION-TIME-POLICY.md
docs/deployment/mvp-deployment-runbook.md
docs/roadmap/current.md
docs/status/implementation-status.md
```

### Markdown verification

```bash
pnpm exec markdownlint-cli2 --no-globs \
  :docs/README.md \
  :docs/adr/README.md \
  :docs/adr/ADR-013-interruption-time-compensation-policy.md \
  :docs/audits/REC-I4-R0-INTERRUPTION-TIME-POLICY.md \
  :docs/architecture/exam-system/candidate-recovery.md \
  :docs/architecture/exam-system/state-and-authority.md \
  :docs/deployment/mvp-deployment-runbook.md \
  :docs/roadmap/current.md \
  :docs/status/implementation-status.md
```

| Command | Result |
| --- | --- |
| `pnpm format:check` | PASS — all matched files use Prettier formatting. |
| `pnpm lint:copy` | PASS — no hardcoded business copy found. |
| `pnpm lint:arch` | PASS — architecture checks passed. |
| `pnpm verify:static` | PASS — code-quality, DB/environment/repository/UI guards, ESLint, TypeScript, and OpenAPI checks passed. |
| Changed-file Markdown command above | PASS — nine changed Markdown files, zero issues. |
| `pnpm verify` | PASS — static checks, workspace coverage, and production build completed successfully. |
| `git diff --check` | PASS — no whitespace errors. |

No tests were added or modified. The full `pnpm verify` command covers static
checks, coverage, and build without expanding this docs-only change scope.

## Explicit non-goals

```text
production code modification
database migration in R0
Redis wiring
BullMQ / Redis Streams
IndexedDB answer journal
offline answer replay
multi-tab lock
WebSocket/SSE monitor
operator incident UI
terminal attempt reopen
submission rollback
TLA+ liveness repair
REC-I1 / REC-I2a / REC-I2b implementation
```

## Open risks that remain after REC-I4

1. The current runtime continues full-gap compensation until I2/I3 deploy;
   this R0 document does not mitigate the production behavior by itself.
2. `lastActivityAt` remains a mixed activity watermark; I2 must define the
   exact server-observed eligible interval without treating it as pure
   network evidence.
3. Existing explicit restore can roll back same-transaction deadline
   reconciliation when the subsequent coupled restore throws.
4. Start-or-restore and explicit restore currently have different deadline
   ordering and must converge on one engine seam.
5. Multi-instance scanner leadership is not implemented; current support
   remains the documented single-app topology.
6. REC-I6 must define system incident lifecycle, cross-attempt linkage, and
   incident authorization before `system_incident` grants become active.
7. Existing manual extensions are legacy compliance-audit facts, not complete
   domain-ledger records; they cannot be perfectly reconstructed.
8. REC-F1 liveness remains partial and is not repaired by this Job.

## Verdict

`PASS` for REC-I4-R0.

The current runtime behavior is source-proven, including its coupling and
ordering defect. The frozen replacement defaults to `strict`, separates
detection from entitlement and lifecycle from compensation, defines bounded
caps and idempotency, persists interruption identity and append-only domain
history, snapshots policy per attempt, keeps PostgreSQL authoritative, and
splits implementation into reviewable PRs.

No runtime behavior changed. Redis was not introduced. The next authorized
Job is `REC-I4-I1`.
