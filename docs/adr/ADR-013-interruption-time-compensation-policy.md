# ADR-013 — Interruption Detection and Time-Compensation Policy

## Status

Accepted

## Metadata

| Field | Value |
| --- | --- |
| Date | 2026-07-28 |
| Decision owners | jnhu76 |
| Supersedes | ADR-012's intentionally incomplete interruption-time policy direction |
| Superseded by | — |
| Related decisions | ADR-001, ADR-005, ADR-006, ADR-008, ADR-012 |

## Context

The current runtime uses a browser heartbeat, PostgreSQL
`exam_attempts.lastActivityAt`, and an in-process Fastify scanner to detect
stale `in_progress` attempts. The scanner changes the attempt to `disrupted`.
The current `restoreAttempt` command then combines two separate concerns:

```text
disrupted → in_progress
+ lastActivityAt refresh
+ deadlineAt += now - lastActivityAt
```

The deadline extension is capped only by `exam.closeAt`. There is no explicit
policy, per-interruption cap, per-attempt cap, durable interruption identity,
or time-adjustment ledger. This makes ordinary loss of observed activity an
implicit entitlement to equivalent exam time.

ADR-012 already rejected full disconnected-time compensation as the permanent
default and required lifecycle restoration to be separated from compensation.
This ADR freezes the missing product, domain, persistence, ordering,
idempotency, and multi-instance contracts. It authorizes no runtime change by
itself.

## Decision

### 1. Policy vocabulary and default

The only interruption-time policies are:

```ts
type InterruptionTimePolicy =
  | "strict"
  | "bounded_grace"
  | "operator_incident";
```

The default is `strict`.

This default applies to:

- newly created exams whose caller omits the configuration;
- historical exams during migration;
- historical and active attempts during migration;
- any defensive read of an unrecognized or incomplete legacy configuration,
  which must fail closed rather than infer a grant.

Ordinary personal disconnection is not trusted proof of lost exam time.
Restoring lifecycle state must not itself create an entitlement. The current
full-disconnection extension must not survive as a hidden compatibility
default.

### 2. Detection is not entitlement

The frozen evidence boundary is:

```text
heartbeat timeout
  = the server has not recently observed qualifying activity

heartbeat timeout
  ≠ proof that the candidate was unable to work
  ≠ proof that an equal time grant is deserved
```

`lastActivityAt`, the scanner timeout, and an interruption episode may be used
to:

- change `in_progress` to `disrupted`;
- create server-side interruption evidence;
- calculate the eligible window for an explicitly configured
  `bounded_grace` policy;
- correlate operational telemetry.

They must not be interpreted directly as:

```text
addedSeconds = now - lastActivityAt
```

Client timestamps and client-reported offline duration are never authoritative
inputs to lifecycle, deadline, or compensation decisions.

### 3. Exam configuration and attempt snapshot

Exam configuration has these semantic fields:

```text
interruptionTimePolicy
interruptionGracePerIncidentSeconds
interruptionGracePerAttemptSeconds
```

The constraints are:

```text
strict:
  policy = strict
  both caps are null

bounded_grace:
  policy = bounded_grace
  both caps are present integers greater than zero
  perIncidentCapSeconds <= perAttemptAggregateCapSeconds

operator_incident:
  policy = operator_incident
  both automatic caps are null
```

There are no numeric defaults for `bounded_grace`. Selecting it without both
valid caps is invalid. Policy and caps are substantive authoring fields and
may be changed through ordinary authoring only while the exam is `draft`.

The policy is frozen for each attempt at attempt creation. Existing attempts
must not change behavior when an administrator later changes the Exam row.
The domain projection is:

```ts
interface InterruptionTimingPolicySnapshot {
  schemaVersion: 1;
  policy: InterruptionTimePolicy;
  perIncidentCapSeconds: number | null;
  perAttemptAggregateCapSeconds: number | null;
}
```

The persistence contract uses explicit attempt snapshot columns so PostgreSQL
can enforce the same cross-field checks:

```text
interruption_policy_snapshot_version
interruption_time_policy_snapshot
interruption_grace_per_incident_seconds_snapshot
interruption_grace_per_attempt_seconds_snapshot
```

Repository mapping may expose the nested domain object above, but the snapshot
values are immutable after attempt creation.

### 4. Interruption episode identity

An attempt status alone is insufficient to identify one interruption. Every
successful scanner transition from `in_progress` to `disrupted` creates a
server-generated UUID `interruptionId`.

The attempt holds the active pointer:

```text
currentInterruptionId: UUID | null
interruptedAt: server timestamp | null
```

A durable append-only `attempt_interruption_events` ledger preserves the
episode:

```text
id
operationId
organizationId
attemptId
interruptionId
eventType                  detected | restored | terminalized
occurredAt
observedLastActivityAt     required for detected when available
detectionSource            required for detected
timeoutSeconds             required for ordinary heartbeat detection
policy
eligibleSeconds            nullable
timeAdjustmentId           nullable
actorId                    nullable for System
reasonCode
createdAt
```

Rules:

- the scanner creates the episode and changes the attempt status in the same
  transaction;
- after locking the Attempt, the scanner rechecks both
  `status === in_progress` and staleness from the locked `lastActivityAt`
  using the tick's captured `now` and timeout; a stale discovery read alone
  cannot create an episode;
- `detectedAt` and `interruptedAt` use the same captured server `now`;
- the episode records the `lastActivityAt` and timeout used by that scan;
- one attempt has at most one unresolved episode;
- rescanning the same `disrupted` state does not create another episode;
- restore, policy evaluation, adjustment, and telemetry use the same
  `interruptionId`;
- there is exactly one `detected` event and at most one outcome event
  (`restored` or `terminalized`) for an episode;
- events are insert-only and are never deleted or reused;
- restoring or terminally reconciling the attempt clears the active pointer
  and `interruptedAt`, while the events and any adjustment row remain;
- `interruptionId` identifies one attempt's interruption;
- future `incidentId` identifies an operational incident that may affect many
  attempts. They are never interchangeable.

The dedicated episode event ledger is required because `strict` and
`operator_incident` candidate restore create no positive adjustment ledger
row, but their interruption evidence must still survive pointer clearing.

### 5. Policy semantics

#### `strict`

```text
restore lifecycle only
automatic addedSeconds = 0
```

The interruption episode receives a retained `restored` or `terminalized`
outcome event. No positive time-adjustment row is created.

#### `bounded_grace`

This policy is valid only when selected explicitly on the Exam and frozen in
the Attempt snapshot.

The server-observed eligible interval begins at the committed scanner
transition time (`episode.detectedAt`), not at the last client timestamp and
not at `lastActivityAt`. Silence before the timeout and scanner transition is
evidence used to detect disruption, but is not automatically grantable time.

At restore, with one captured server `now`:

```text
eligibleSeconds =
  floor(max(0, now - episode.detectedAt) / 1000)

remainingAggregateSeconds =
  max(0,
      snapshot.perAttemptAggregateCapSeconds
      - sum(authoritative bounded_grace ledger addedSeconds for this attempt))

closeRoomSeconds =
  floor(max(0, exam.closeAt - beforeDeadline) / 1000)

addedSeconds =
  min(
    eligibleSeconds,
    snapshot.perIncidentCapSeconds,
    remainingAggregateSeconds,
    closeRoomSeconds
  )
```

All grants are whole seconds. If `deadlineAt` is unexpectedly null, the
reachable-state invariant is violated and the command must fail closed; it
must not invent a deadline from `now`.

The per-attempt aggregate cap covers automatic `bounded_grace` ledger rows
only. Explicit operator, system-incident, and administrative-correction
grants are separately attributable decisions and do not silently consume or
expand the automatic allowance.

#### `operator_incident`

Candidate restore automatically grants zero seconds. An authorized operator
uses a separate explicit command to grant time. That command requires:

- target-attempt scoped permission;
- an authenticated actor;
- a non-empty bounded reason;
- a reason code;
- a stable caller-supplied `operationId`;
- an optional `interruptionId` when the grant addresses one attempt episode;
- a nullable `incidentId`, reserved for the REC-I6 system-incident model.

Ordinary candidate restore never executes or infers an operator grant.

### 6. Lifecycle and compensation are separate concerns

The engine boundary is:

```text
restoreAttemptState()
evaluateInterruptionTimePolicy()
```

They may be composed in one PostgreSQL transaction, but must:

- be separate functions;
- return separate results;
- have separate tests;
- produce separate durable evidence;
- never make lifecycle restore imply compensation;
- never report restore success if compensation evaluation or persistence
  failed.

Every candidate entry point that may encounter a disrupted Attempt, including
the legacy `/start` resume path and explicit `/restore`, must call the same
composed seam. No entry point may bypass deadline ordering or retain the old
coupled `restoreAttempt` behavior.

A composed command returns both results, for example:

```ts
interface RestoreInterruptionResult {
  lifecycle: {
    outcome: "restored" | "already_in_progress" | "terminal";
  };
  compensation: {
    policy: InterruptionTimePolicy;
    interruptionId: string | null;
    eligibleSeconds: number;
    addedSeconds: number;
    adjustmentId: string | null;
  };
}
```

The HTTP response shape is owned by REC-I4-I3. The separation above is the
domain contract, not a commitment to this exact wire DTO.

### 7. Deadline reconciliation ordering

Every restore request captures one authoritative `now` and runs in one
transaction. Terminal means `submitted | grading | graded | voided`; these
states are monotonic. Any other status outside `in_progress | disrupted` is
invalid for restore and must fail closed.

#### `strict`

```text
lock
→ reconcile deadline
→ if terminal: append terminalized outcome and return terminal
→ if already in_progress: return idempotent no-op
→ if disrupted: restore lifecycle
→ append restored outcome
→ grant 0
```

The caller must use the reconciliation result. It must not call
`restoreAttemptState` after reconciliation returned a terminal attempt.

#### `bounded_grace`

Predeclared bounded grace may participate in the effective deadline before
the final deadline reconciliation:

```text
lock Enrollment → Attempt → Exam
→ reject/return an already-terminal attempt without adjustment
→ require status disrupted and load its active interruption episode
→ evaluate the frozen bounded policy from server-observed evidence
→ reuse an existing idempotent decision or create the decision
→ if addedSeconds > 0:
     insert the ledger row and update deadline in the same transaction
→ reconcile against the adjusted authoritative deadline
→ if still resumable:
     disrupted → in_progress
     append restored outcome
  else:
     terminal wins
     append terminalized outcome
→ clear the active interruption pointer
```

This is not terminal resurrection:

- a terminal attempt is rejected/returned before policy evaluation;
- only an attempt that is still `disrupted` under the row lock may receive
  its preconfigured bounded decision;
- extension, reconciliation, episode outcome, and restore share one
  transaction;
- after a terminal transition commits, candidate restore can never reverse
  it.

If the adjusted deadline is still at or before `now`, reconciliation submits
the attempt and terminal wins. If `exam.closeAt <= now`, no extension can make
the attempt resumable.

#### `operator_incident`

Candidate restore follows the `strict` ordering and grants zero. The operator
grant is a separate command. It may adjust only an
`in_progress | disrupted` attempt; it cannot reopen
`submitted | grading | graded | voided`.

Reopening, submission rollback, or void reversal is a separate high-risk
decision and is not authorized by this ADR.

### 8. Time-adjustment ledger

Positive deadline changes use an append-only domain ledger, separate from the
general compliance audit log:

```text
id
operationId
organizationId
attemptId
interruptionId        nullable for a non-interruption manual adjustment
incidentId            nullable; reserved for REC-I6
policy
source
beforeDeadline
afterDeadline
addedSeconds
eligibleSeconds       required for bounded_grace, otherwise nullable
reasonCode
reasonText            required for operator/administrative paths
actorId               null for automatic bounded policy
createdAt
```

The allowed sources are:

```text
bounded_grace
operator
system_incident
administrative_correction
```

Ledger invariants:

- rows are insert-only; normal application APIs expose no update or delete;
- `(organizationId, operationId)` is unique;
- `addedSeconds > 0`;
- `afterDeadline > beforeDeadline`;
- `afterDeadline = beforeDeadline + addedSeconds seconds`;
- `afterDeadline <= exam.closeAt`;
- `bounded_grace` requires `interruptionId`, `eligibleSeconds`, and a null
  human actor;
- an automatic bounded grant has at most one row per `interruptionId`;
- operator and administrative rows require `actorId` and `reasonText`;
- deadline update and ledger insert occur in the same transaction;
- the bounded aggregate is summed from committed authoritative ledger rows;
- a future denormalized counter is allowed only with a proved same-transaction
  invariant and a repair/reconciliation path;
- a generic audit event may reference `adjustmentId`, but never replaces the
  ledger.

Zero-grant decisions are recorded by inserting an interruption outcome event
with the policy result; they are not fake positive adjustment rows.

### 9. Transaction, lock, and idempotency boundary

All restore, bounded-grace, and explicit time-grant commands run in
`executeInTransaction`. They preserve the repository's canonical
Enrollment-before-Attempt protocol and, when deadline policy depends on the
exam window, additionally lock the Exam:

```text
Enrollment FOR UPDATE
→ Attempt FOR UPDATE
→ Exam FOR UPDATE
```

The Attempt lock serializes scanner, save, submit, restore, bounded grant, and
manual extension for one attempt. The Exam lock serializes the authoritative
`closeAt` read against exam-window changes. All implementation paths that take
both Attempt and Exam locks must use the same order; no
`Exam → Attempt` path may be introduced.

Idempotency rules:

- the scanner's status and active-pointer recheck prevents duplicate episode
  creation;
- concurrent restore POSTs serialize on the Attempt row;
- after the first commit, a retry sees `in_progress` or terminal and grants
  nothing;
- response loss followed by retry produces the same authoritative result;
- a unique ledger constraint permits at most one `bounded_grace` row for an
  `interruptionId`;
- an operator retry reuses `operationId`; the same identity and payload
  returns the committed result, while a different payload conflicts;
- aggregate cap evaluation and ledger insert happen while holding the Attempt
  lock;
- automatic and manual adjustments cannot lose updates because both chain
  from the locked current `deadlineAt`;
- transaction rollback removes the deadline update, adjustment row,
  interruption outcome event, and lifecycle change together.

### 10. Role and permission requirements

- Candidate may restore only their own attempt and can never grant time.
- Automatic bounded evaluation runs as the non-login System actor.
- Operator grants require a new sensitive `Permission.AttemptTimeGrant`
  (`attempt.time.grant`) at the target attempt's scope, enforced through the
  scoped resolver.
- The built-in Admin compatibility role may hold this permission.
- A Proctor may hold it only when the Proctor product role is activated and an
  assignment authorizes the target Exam/Attempt scope; Proctor may create only
  `source=operator` rows.
- `source=administrative_correction` additionally requires the Admin role and
  a narrower `attempt.time.correct` permission.
- `source=system_incident` remains disabled until REC-I6 defines a System-only
  incident grant permission and incident authority.
- Operator requests require reason and actor attribution even if the current
  generic extension endpoint did not.
- The existing flat `attempt.time.extend` endpoint is legacy capability, not
  the new grant authority; REC-I4-I3 must migrate compatibility deliberately
  rather than silently treating all old extensions as incidents.

### 11. Multi-instance and Redis boundary

The supported current topology is:

```text
one Fastify app process
+ in-process interval
+ PostgreSQL lastActivityAt
+ PostgreSQL transaction and row lock
```

Future multi-instance work has two separate problems:

1. duplicate scanner discovery and table scans;
2. presence/monitoring broadcast across instances.

The first coordination mechanism to evaluate for scanner leadership is a
PostgreSQL advisory lock. Redis may later assist presence caching, real-time
broadcast, cross-instance WebSocket/SSE fan-out, or shared rate limiting.

Frozen rules:

- REC-I4 introduces no Redis dependency;
- PostgreSQL remains the only authority for lifecycle, deadlines,
  interruption episodes, adjustments, and attribution;
- Redis is never compensation or deadline authority;
- Redis TTL expiry cannot directly trigger an irreversible attempt
  transition;
- even with Redis, `disrupted` requires a PostgreSQL transaction, Attempt row
  lock, and state recheck.

### 12. Migration and backfill

REC-I4-I1 must:

- add Exam policy fields with `strict` as the database and application
  default;
- backfill every historical Exam to `strict` with null caps;
- add non-null Attempt snapshot fields;
- backfill every historical Attempt snapshot to `strict` with null caps;
- add interruption identity fields as null for non-disrupted attempts;
- for each historical `disrupted` Attempt, create one migration-labelled
  interruption UUID, set its active pointer, and insert a `detected` event
  whose reason explicitly says the original detection instant is unknown;
- use one captured migration instant for that backfilled `interruptedAt`; do
  not reinterpret it as historical outage duration;
- create the adjustment table empty;
- add cross-field CHECK constraints and the bounded-grant uniqueness
  constraint;
- avoid synthesizing historical grants or a precise historical duration from
  `lastActivityAt`;
- preserve every existing deadline exactly during the foundation migration.

After migration, an already-disrupted historical attempt restores under
`strict`; the former implicit full compensation is not grandfathered.

## Consequences

- Recovery can return a candidate to a legal lifecycle state without granting
  time.
- Bounded grace is explicit, capped, attributable, and idempotent.
- Operator grants become domain records rather than metadata-only audit rows.
- Existing attempts are insulated from later Exam configuration edits.
- Strict backfill is intentionally behavior-conservative and removes the
  implicit full-disconnection grant once the runtime implementation lands.
- The interruption event and adjustment ledgers add storage and transactional
  work, but make disputes and aggregate caps reconstructable from PostgreSQL.

## Alternatives considered

| Alternative | Decision |
| --- | --- |
| Preserve full disconnection compensation as the default | Rejected: server silence is not entitlement and the behavior is unbounded. |
| Use `lastActivityAt` directly as grant duration | Rejected: it includes the detection threshold and does not prove inability to work. |
| Use a hidden default number for bounded grace | Rejected: selecting bounded grace requires explicit caps. |
| Store only the current `disrupted` status | Rejected: status cannot identify or deduplicate an interruption episode. |
| Store grants only in the compliance audit log | Rejected: aggregate policy and deadline reconstruction require a typed domain ledger. |
| Read current Exam policy during every restore | Rejected: mid-attempt edits would change an existing attempt's outcome. |
| Reconcile before every bounded decision | Rejected for predeclared bounded grace: it would terminalize an otherwise eligible disrupted attempt before its already-frozen policy can participate. |
| Reopen terminal attempts for an operator | Rejected from this scope: reopen/rollback needs a separate high-risk contract. |
| Use Redis TTL expiry as interruption authority | Rejected: volatile cache events cannot own irreversible domain transitions. |

## Implementation decomposition

### REC-I4-I1 — Domain and persistence foundation

Enums/types/contracts, Exam configuration, Attempt snapshot, interruption
identity and append-only episode events, time-adjustment ledger, migration,
constraints, and repository APIs. No restore runtime change.

### REC-I4-I2 — Engine policy seam

Episode creation in `markDisrupted`, lifecycle-only restore,
`evaluateInterruptionTimePolicy`, bounded calculation, idempotent ledger
insert, atomic deadline update, deadline ordering, and engine tests.

### REC-I4-I3 — API and authoring surfaces

Candidate restore wiring, Exam create/edit configuration, operator reason and
attribution, scoped permission enforcement, OpenAPI, and admin/proctor tests.

### REC-I4-V1 — Verification closeout

PostgreSQL concurrency tests for duplicate restore, deadline/scanner races,
aggregate cap, `exam.closeAt` cap, lost-response retry, E2E, and a formal-model
update if the changed reachable actions require it.

## Explicit non-goals

```text
runtime implementation in REC-I4-R0
database migration in REC-I4-R0
Redis wiring
BullMQ or Redis Streams
IndexedDB answer journal
offline answer replay
multi-tab lock
WebSocket or SSE monitoring
operator incident UI
terminal attempt reopen
submission rollback
TLA+ liveness repair
REC-I1 / REC-I2a / REC-I2b implementation
```
