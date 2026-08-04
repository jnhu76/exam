# J5-I1C0 — Dangerous Command Identity Reality Audit (pre-implementation)

> **Status:** PRE-IMPLEMENTATION AUDIT — source-evidence report only.
>
> Scope: audit the two Admin Recovery **dangerous commands** — force-submit
> Attempt and misconduct-mark Attempt — and produce a gap analysis + J5-I1C0
> contract proposal that can be frozen before implementation begins.
>
> **Hard boundaries honored:** this audit does **not** modify code, docs,
> PR #254, or the working tree; does **not** push; does **not** create a PR;
> does **not** design UI; does **not** enter J5-I1C1.
>
> Branch at audit time: `feat/j5-i1a3-recovery-attempt-operations` (PR #254
> still in completion of J5-I1A/J5-I1B). All file/line citations are against
> that branch's HEAD unless noted.
>
> Authority chain: `AGENTS.md` → `docs/SPEC.md` →
> `docs/roadmap/phase-roadmap.md` → `docs/roadmap/j5-r0-admin-recovery-center-contract.md`
> (J5 contract, CLOSED/ACCEPTED) → `docs/adr/ADR-014-exam-incident-authority.md`
> (ACCEPTED) → `docs/adr/ADR-015-proctor-exam-scope-authority.md` (ACCEPTED).
> Where the J5 contract and ADRs differ from this audit, the contract and
> ADRs win; this audit records reality and proposes, it does not re-freeze.

---

## 0. TL;DR

force-submit and misconduct-mark are **the only two dangerous commands in the
Admin Recovery Center that have no `operationId`, no durable command receipt,
and no retry contract**. They are *state-idempotent only*, which does not
resolve the retry uncertainty J5-R0 §8.2 demands ("did my command commit?").
Both violate the ADR-014 / ADR-015 precedent (time grant, incident commands,
proctor assignment all carry `operationId` arbitrated by
`UNIQUE(organization_id, operation_id)`).

misconduct-mark is the sharper gap: ADR-014 §7 **explicitly forbids** it as an
Incident action link *until* "a stable append-only misconduct receipt exists"
— today it is a destructive overwrite of a single jsonb field
(`exam_attempts.misconduct`, `packages/db/src/schema/pg.ts:386`).

I1C0 must introduce a **durable `operationId`-keyed command-receipt table for
each**, mirroring the `attempt_time_adjustments` + `exam_incident_events`
precedent. The recommended contract (§4), transaction design (§5), and schema
(§6) below are derived from the repo's existing patterns, not invented.

---

## 1. Current implementation map

### 1.1 force-submit Attempt

| Layer | Location | Notes |
| --- | --- | --- |
| **Route** | `apps/api/src/routes/attempts.admin.ts:138-317` | `POST /admin/attempts/:attemptId/force-submit`. `preHandler` = `requireScopedCapability(AttemptForceSubmit, "attempt", "attemptId")` (flipped scoped by J4-I1B). `"x-role": ["Admin"]`. |
| **Authorization** | `Permission.AttemptForceSubmit` (removed from `PROCTOR_PERMISSIONS` by ADR-015 §13). Resource scope via the attempt resolver. |
| **Input schema** | `packages/contracts/src/attempt.ts:442-444` | `ForceSubmitRequestSchema = z.object({ reason: z.string().max(500).optional() })`. **No `operationId`, no `expectedVersion`.** J5-R0 §8.1 adjudicates upgrading `reason` to required. |
| **Orchestrator** | **none**. The route handler is inline (`attempts.admin.ts:167-316`). |
| **Service / command** | `submitAttempt(attempts, gradingWorksetRepo, attemptId, now, { source: "proctor", resolution })` (`exam-engine` `attemptCommands.ts`) + `gradeAttemptIdempotent(...)`. There is no `forceSubmitAttempt()` command; it is a route composition of two existing commands inside `executeInTransaction`. |
| **Transaction** | One `executeInTransaction` (EA lock order: `Enrollment → Attempt` via `lockEnrollmentAndAttempt`). Submit + grade + audit are atomic. |
| **State mutation** | `in_progress`/`disrupted` → `submitted` → `graded` (via `submitAttempt` + `gradeAttemptIdempotent`). `voided` rejected (`InvalidStateTransitionError`). Already-terminal (`submitted`/`grading`/`graded`) is a no-op path. |
| **Receipt / event** | **NONE.** No row is written to any `operationId`-keyed table. The only persisted marks are: `exam_attempts.submittedAt`/`gradedAt`/`submissionReason ∈ {manual, deadline}` (cannot distinguish force-submit from candidate self-submit — ADR-014 §7) and **one `attempt.forceSubmit` audit fact**. |
| **Audit** | `recordAtomicHttpAudit(tx, ..., { action: "attempt.forceSubmit", targetType: "attempt", targetId: attemptId, metadata: { reason? } })` (`attempts.admin.ts:296-301`). Written **only on a real transition** (`if (needsSubmit)`). |
| **Tables** | `exam_attempts` (status/timestamps) + `audit_logs` only. **No command-receipt table.** |
| **Idempotency** | State-based only (`needsSubmit = locked.status === "in_progress" \|\| "disrupted"`). A second call is a no-op, no re-grade, no duplicate audit. |
| **Conflict detection** | None. |
| **Concurrent safety** | EA row lock only serializes. Two concurrent force-submits on the same `in_progress` Attempt: the first commits submit+grade; the second reads the committed `graded` row and takes the no-op path. **Two different operationIds both succeed silently** (one mutates, one no-ops) — there is no replay/conflict distinction and no durable loser receipt. |
| **Response** | `LoadAttemptResponseSchema.parse(toCandidateAttemptResponse(attempt, now))` — **rebuilt from the current Attempt state post-transaction** (`attempts.admin.ts:307-315`), NOT from a durable receipt. |
| **Tests** | `apps/api/src/routes/attempts/admin-force-submit.test.ts` (covers: in_progress, disrupted, idempotent-for-graded (no re-grade, no dup audit), voided rejected, cross-org 404, non-admin 403). **No retry/replay/concurrent-operationId tests exist.** |

### 1.2 misconduct-mark Attempt

| Layer | Location | Notes |
| --- | --- | --- |
| **Route** | `apps/api/src/routes/attempts.admin.ts:66-128` | `POST /admin/attempts/:attemptId/misconduct`. `preHandler` = `requireScopedCapability(AttemptMisconductMark, "attempt", "attemptId")`. `"x-role": ["Admin"]`. |
| **Authorization** | `Permission.AttemptMisconductMark` (removed from `PROCTOR_PERMISSIONS` by ADR-015 §13). |
| **Input schema** | `packages/contracts/src/attempt.ts:374-377` | `FlagMisconductRequestSchema = z.object({ severity: MisconductSeverityEnum, notes: z.string().min(1).max(1000) })`. **No `operationId`.** |
| **Orchestrator / command** | `flagMisconduct(attemptRepo, attemptId, ctx.actorId, severity, notes, fastify.now())` (`packages/exam-engine/src/attemptCommands.ts:614-648`). |
| **Transaction** | `executeInTransaction` wrapping `flagMisconduct` + `recordAtomicHttpAudit`. |
| **State mutation** | **No status change.** `attemptRepo.update(attemptId, { misconduct: flag })` — a **destructive overwrite** of the `exam_attempts.misconduct` jsonb (`schema/pg.ts:386`). Any Attempt status allowed (P2C-J4 §16). |
| **Receipt / event** | **NONE.** The single `MisconductFlag` jsonb (`types.ts:459-468`: `{ flaggedAt, flaggedBy, notes, severity }`) is the **only persisted fact**, and it is **overwritten** on re-flag. No `operationId`, no append history, no version. |
| **Audit** | `attempt.misconductFlagged` audit row written **on every call** (`attempts.admin.ts:118-123`), even duplicate flags on the same Attempt. Metadata = `{ severity, notes }`. |
| **Tables** | `exam_attempts.misconduct` (jsonb, overwritten) + `audit_logs`. **No command-receipt table.** |
| **Idempotency** | **NONE.** ADR-014 §7 is explicit: "re-flagging OVERWRITES it … a mutable field is not a stable action identity." Every call writes a new audit + overwrites the jsonb. The server cannot distinguish a retry from an intentional re-mark. |
| **Conflict detection** | None. |
| **Concurrent safety** | Lost-update race on the `exam_attempts` row update (no row lock; `flagMisconduct` does `findById` then `update`). Two concurrent marks: last-writer-wins on the jsonb; both audit rows persist. |
| **Response** | `{ ok: true }` — **no projected fact, no outcome result** (`FlagMisconductResponseSchema`). |
| **Tests** | `apps/api/src/routes/attempts/admin-misconduct.test.ts` (covers: flag in_progress + persists + audit; voided flaggable; 404; non-admin 403). **No idempotency/retry/overwrite-semantics tests.** |

### 1.3 Golden reference (time grant) — I1C0 must mirror this

| Layer | Location | Why it works |
| --- | --- | --- |
| **Route** | `attempts.admin.ts:330-432` | `POST /admin/attempts/:attemptId/time-grants`. |
| **Orchestrator** | `apps/api/src/orchestrators/operatorGrantExecution.ts` — `grantWithOperationRaceRecovery()` (single production entrypoint; the route and the deterministic concurrency test share it). |
| **Command** | `grantAttemptTime()` (`packages/exam-engine/src/operatorGrant.ts`). Full frozen order: EA affinity → re-read locked attempt + lock exam → normalize/validate → **operationId replay/conflict (step 4)** → policy snapshot → Incident scope quadruple → deadline reconcile → terminal short-circuit → interruption ownership → grant → insert ledger row → update deadline → re-read. |
| **Receipt table** | `attempt_time_adjustments` (`schema/pg.ts:514-618`) — the durable ledger. `operationId uuid NOT NULL` + `UNIQUE (organization_id, operation_id)` = the arbiter (`attempt_time_adjustments_org_operation_unique`, line 543). |
| **Replay semantics** | `operatorGrant.ts:53-75,265-291` — `isSameOperatorGrantOperation()` canonical-payload comparison. Same operationId + same payload → `idempotent_replay` (return committed row); same operationId + different payload → `IdempotencyConflictError` (→ 409 IDEMPOTENCY_CONFLICT). |
| **Concurrency recovery** | `operatorGrantExecution.ts:543-586` — 23505 on the exact constraint matched → rollback → fresh-tx rerun of the SAME command → engine replay/conflict. Real constraint name extracted from the thrown PG error (`matchOrgOperationUniqueViolation`, lines 92-121). **At-most-once recovery, never recursive.** |
| **Response** | `TimeGrantResponseSchema` — returns the **operation fact** (`outcome` + the committed `adjustment` projection + `attempt`), NOT a rebuilt state. |

### 1.4 Incident action-link infrastructure (ADR-014) — force_submit identity depends on it

- `linkIncidentAction()` (`packages/exam-engine/src/incidentCommands.ts:669-811`). For `force_submit`: `actionId = attemptId` (line 739), and it verifies the `attempt.forceSubmit` audit fact exists before accepting the link (`lookupForceSubmitAudit`, lines 756-763). `misconduct_mark` is rejected (lines 695-696: "misconduct_mark action links are deferred").
- DB arbiter: `exam_incident_actions` has `UNIQUE (organization_id, action_type, action_id)` (`schema/pg.ts:1367`, `0023_exam_incidents.sql:135`). `action_type CHECK IN ('time_grant','force_submit')` — `misconduct_mark` is intentionally excluded (migration SQL lines 131-132).
- The Attempt Operations Context built in PR #254 detects force-submit by scanning the `attempt.forceSubmit` audit fact (`recoveryRepo.ts:1406-1411`) — the current ad-hoc identity.

---

## 2. Invariant matrix

Legend: ✅ meets J5-R0 §8.2 / ADR-013/014/015 precedent · ❌ missing · ⚠️ partial.

### 2.1 force-submit Attempt

| Scenario | Current behavior | Required behavior | Gap | Severity |
| --- | --- | --- | --- | --- |
| First execution | submit+grade+audit commit; returns rebuilt attempt | same + durable `operationId` receipt | ❌ no receipt | P0 |
| Same operationId replay | **N/A — no operationId**; 2nd call is a no-op against `graded` | return the exact committed receipt, `outcome=idempotent_replayed`, no mutation | ❌ no operationId on API | P0 |
| Same operationId, different payload | N/A | 409 IDEMPOTENCY_CONFLICT | ❌ | P0 |
| Different operationId after success | silent no-op (`needsSubmit=false`); the 2nd operationId "succeeds" | `no_change` receipt (see ADR-015 §6 proctor-assign precedent) OR a defined terminal outcome — never silent | ❌ silent success | P1 |
| Two concurrent operationIds | one commits; the other reads the committed row, no-ops, **both succeed, no durable loser receipt** | the loser leaves a durable `no_change` receipt; one single arbiter (UNIQUE) | ❌ no loser receipt | P0 |
| Timeout after commit, before response | commit landed; client blind-retries → silent no-op | retry hits the receipt, returns `idempotent_replayed` | ❌ client cannot tell if it committed | P0 |
| Process crash after mutation, before response | same; state committed, no receipt | same recovery guarantee | ❌ | P0 |
| Attempt already naturally submitted | no-op (terminal); no receipt | defined `terminal`/`no_change` outcome + receipt | ⚠️ defined behavior, no receipt | P1 |
| Attempt already force-submitted | no-op (terminal) | replay OR defined `no_change` outcome, distinguishable from a retry | ⚠️ | P1 |
| Attempt in invalid terminal state (`voided`) | 409 INVALID_STATE_TRANSITION | same | ✅ | — |
| Audit↔receipt atomicity | `attempt.forceSubmit` audit + status share one tx | receipt + audit + status share one tx | ⚠️ audit+state atomic, no receipt | P0 |
| operationId in audit evidence | audit metadata **carries no operationId** (just `{reason?}`) | audit must link to operationId | ❌ | P0 |

### 2.2 misconduct-mark Attempt

| Scenario | Current behavior | Required behavior | Gap | Severity |
| --- | --- | --- | --- | --- |
| First execution | jsonb `misconduct` written + audit; returns `{ok:true}` | same + durable `operationId` append receipt | ❌ no receipt | P0 |
| Same operationId replay | **N/A — no operationId**; re-flag overwrites jsonb, **2nd audit row written** | return the committed receipt, `idempotent_replayed`, no jsonb overwrite, no new audit | ❌ destructive overwrite + dup audit | P0 |
| Same operationId, different payload | N/A | 409 IDEMPOTENCY_CONFLICT | ❌ | P0 |
| Different operationId after success | **overwrites** jsonb; writes a new audit. Server cannot tell retry from intentional re-mark | defined behavior (no_change receipt, OR append-only evidence mark) | ❌ undefined (ADR-014 §7 cites this verbatim as the deferral reason) | P0 |
| Two concurrent operationIds | last-writer-wins on jsonb; **both audit rows persist** | append receipts serialize via UNIQUE arbiter; both leave durable receipts | ❌ | P0 |
| Timeout / crash retry | client blind-retries; each attempt writes a fresh jsonb+audit | retry hits the receipt, no duplicate side-effect | ❌ | P0 |
| Reason changes (severity/notes change) | overwrites old jsonb; old value lost (only in audit metadata text) | append receipt preserves history; latest projection is the current jsonb | ❌ history destructively lost | P0 |
| Incident action link required? | **blocked by ADR-014 §7** | I1C0 receipt unblocks this (future ADR-014 amendment) | ❌ blocked | P1 |
| Audit↔receipt atomicity | jsonb overwrite + audit atomic (one tx) | append receipt + audit + jsonb projection atomic | ⚠️ | P0 |
| operationId in audit evidence | none | audit links to operationId | ❌ | P0 |

---

## 3. Durable evidence analysis

### 3.1 force-submit — each fact, by category

| Fact | Category | Evidence |
| --- | --- | --- |
| Attempt was force-submitted (sometime) | **state evidence only** | `exam_attempts.status='graded'` — but indistinguishable from natural/deadline submit. `submissionReason ∈ {manual,deadline}` has no force-submit value (ADR-014 §7). |
| Attempt was force-submitted by an Admin | **audit evidence only** | `attempt.forceSubmit` audit row exists in `audit_logs` with `target_id=attemptId`. This is the **only** evidence today — and it is what PR #254's Attempt Operations Context (`recoveryRepo.ts:1406-1411`) and `linkIncidentAction`'s force_submit verification (`incidentCommands.ts:756-763`) consume. |
| *Which operationId* performed the force-submit | **missing evidence** | audit `metadata` = `{reason?}` (`attempts.admin.ts:300`). No `operation_id` column. ADR-015 §4.2: "audit_logs has no operation_id column." |
| Whether an operationId was a replay or a conflict | **missing evidence** | no operationId is persisted anywhere. |
| The concurrent race loser's receipt | **missing evidence** | no loser receipt is ever produced. |
| Response fact | **derived evidence** | `LoadAttemptResponseSchema` is rebuilt from the post-tx row read (`attempts.admin.ts:307-315`). |

### 3.2 misconduct-mark — each fact, by category

| Fact | Category | Evidence |
| --- | --- | --- |
| Attempt is flagged misconduct (current) | **state evidence only** | `exam_attempts.misconduct` jsonb (`schema/pg.ts:386`) — current projection, overwritten. |
| History of flagging (who/when/what severity over time) | **audit evidence only** (lossy) | `audit_logs` rows with `action='attempt.misconductFlagged'`, metadata `{severity,notes}`. One row per call. **This is the only "history," but it is audit-evidence only — not command identity.** |
| Whether a given operationId marked this attempt | **missing evidence** | no operationId is persisted. |
| Whether two marks were a retry or an intentional re-mark | **missing evidence** | the server literally cannot tell (ADR-014 §7; J5-R0 §7 line 110). |
| Prior severity/notes of an overwritten jsonb | **partially in audit** (as text) but not structured command evidence | recoverable only via audit-metadata text-mining; not queryable as a receipt. |
| Response fact | **derived / missing** | `{ok:true}` — does not project the misconduct fact. |

### 3.3 For contrast: time grant (the authoritative pattern)

| Fact | Category | Evidence |
| --- | --- | --- |
| A grant landed | **authoritative command evidence** | `attempt_time_adjustments` row (with `operationId`, payload, deadline delta, actor). |
| Replay / conflict | **authoritative** | `findByOperationId` → canonical-payload compare. |

**Conclusion for I1C0:** both force-submit and misconduct-mark need a new
durable, `operationId`-keyed **authoritative command evidence** table. The
existing `audit_logs` and `exam_attempts` state are structurally insufficient
(ADR-015 §4.2 is explicit that audit_logs is NOT the operation arbiter).

---

## 4. Recommended J5-I1C0 contract

The request/receipt shapes here are **not** a mechanical acceptance of the
prompt's suggested shape; they are derived by applying the ADR-014 §9 /
ADR-015 §4.2 precedent to both audited commands. Key adjustments: no
`expectedVersion` (neither command mutates a versioned aggregate; `exam_attempts`
has no `version` column — verified in `schema/pg.ts`), and misconduct's
`severity`+`notes` are the existing required human-explanation fields, so they
join the canonical payload.

### 4.1 force-submit — frozen request

```ts
// packages/contracts/src/attempt.ts — replaces ForceSubmitRequestSchema
export const ForceSubmitRequestSchema = z.object({
  operationId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),   // J5-R0 §8.1: upgraded to required
});
```

**Why no `expectedVersion`:** force-submit is a terminal-state transition, not
a versioned update; the attempt has no version column. The state machine itself
enforces "no duplicate terminal transition." Concurrency is resolved by the
operationId UNIQUE arbiter (see §5).

### 4.2 force-submit — frozen receipt response

```ts
export const ForceSubmitOutcomeEnum = z.enum([
  "applied",              // real submit+grade by THIS operation
  "no_change",            // new operationId, attempt already terminalized by another op
  "idempotent_replay",    // same operationId replayed, return original receipt
]);
// There is no "terminal" outcome on a valid state — a voided attempt throws 409.
// The response carries the operation fact (the committed receipt) + the resulting attempt.
```

The receipt projection must include enough to evidence the mutation (ADR-014 §11
/ time-grant precedent): `operationId`, `attemptId`, `actorId`, `appliedAt`
(server time), `reason`, `outcome`, and the attempt's final
`status`/`submittedAt`/`gradedAt`.

### 4.3 misconduct-mark — frozen request

```ts
export const FlagMisconductRequestSchema = z.object({
  operationId: z.string().uuid(),
  severity: MisconductSeverityEnum,
  notes: z.string().trim().min(1).max(1000),
});
```

### 4.4 misconduct-mark — frozen receipt response

```ts
export const MisconductMarkOutcomeEnum = z.enum([
  "applied",              // a fresh append-only evidence mark
  "no_change",            // new operationId + same payload but jsonb already this value (optional)
  "idempotent_replay",    // same operationId replayed
]);
// Replace `{ok:true}` response with a receipt projecting the misconduct fact + outcome.
```

**Critical adjudication:** misconduct-mark is a **business event (append receipt)**,
NOT a **state assignment (overwrite)**. The jsonb `exam_attempts.misconduct`
becomes a **projection of the receipt table** (latest receipt wins), exactly
like `exam_incidents` (the state row) is a projection of `exam_incident_events`
(the append-only history). This unblocks the ADR-014 §7 deferral and a future
ADR-014 amendment can wire the `misconduct_mark` Incident action link.

### 4.5 Replay / conflict semantics (frozen, both)

Mirroring ADR-014 §9 / time grant verbatim:

```text
same operationId + same commandType + same canonical payload
  → idempotent_replay: return the committed receipt, no mutation
same operationId + different commandType or canonical payload
  → 409 IDEMPOTENCY_CONFLICT
new operationId against an already-terminal / already-marked state
  → no_change receipt (durable loser evidence), NOT silent
```

Canonical payload (string-trimmed comparison, mirroring `incidentCommands.ts:484,622,687`
+ `operatorGrant.ts:53-75` `payloadsEqual`/`isSameOperatorGrantOperation` precedent):

```text
force-submit canonical payload    : { attemptId, reason }
misconduct-mark canonical payload : { attemptId, severity, notes }
```

(Both trimmed per the existing `attempts.shared`/`helpers` trim precedent.
`operationId` is the unique key on the receipt row, **not** part of the payload
— see ADR-015 §4.2.)

---

## 5. Transaction design

Both commands should migrate to **orchestrator modules**
(`apps/api/src/orchestrators/`), mirroring `operatorGrantExecution.ts`, so the
route and the deterministic concurrency test share one production entrypoint.

### 5.1 force-submit — frozen execution order

```text
1. pre-read operationId (non-locking, ctx-scoped)
   → found matching operationId + commandType + canonical payload
     → idempotent_replayed (return committed receipt, NO write)
   → found matching operationId + DIFFERENT payload
     → 409 IDEMPOTENCY_CONFLICT
2. validate scope / existence (non-locking)
3. BEGIN transaction (REPEATABLE READ — match executeInTransaction default)
4. EA lock: lockEnrollmentAndAttempt(enrollments, attempts, attemptId)
5. re-read locked attempt; reject `voided` (→ 409 INVALID_STATE_TRANSITION)
6. determine needsSubmit = status ∈ {in_progress, disrupted}
7. INSERT command-receipt row (carries UNIQUE(org,operation_id)) — FIRST write
8. if needsSubmit: submitAttempt(source="proctor") + gradeAttemptIdempotent
   (existing engine calls, unchanged)
9. atomic audit (attempt.forceSubmit, metadata includes operationId) — only if needsSubmit
   on no_change/idempotent_replay: NO audit (mirrors ADR-015 §6 audit policy)
10. re-read authoritative attempt; build the receipt projection
11. COMMIT
   on 23505 from receipt INSERT (UNIQUE(org,operation_id)):
     → rollback → fresh tx → operationId pre-read → replay/conflict
       (mirrors operatorGrantExecution.ts)
   on 23505 from receipt INSERT:
     → already handled by step-1 pre-read + step-7 first-write
```

**Isolation / locking:** REPEATABLE READ (execute default). EA lock order
`Enrollment → Attempt` unchanged (ADR-013 §9; no Exam lock introduced —
force-submit does not reconcile deadline). The receipt table is INSIDE the
existing EA transaction, not outside it (atomicity requirement).

### 5.2 misconduct-mark — frozen execution order

```text
1. pre-read operationId (non-locking, ctx-scoped)
   → replay / IDEMPOTENCY_CONFLICT (as above)
2. validate scope / existence (non-locking)
3. BEGIN transaction (REPEATABLE READ)
4. INSERT append-only misconduct-receipt row (UNIQUE(org,operation_id)) — FIRST write
5. UPDATE exam_attempts.misconduct jsonb = THIS receipt's projection
   (the jsonb becomes a derived projection; the receipt is authoritative)
6. atomic audit (attempt.misconductFlagged, metadata includes operationId) — only on applied
7. COMMIT
   on 23505 handling as for force-submit
```

**Key design point:** NO row lock on `exam_attempts` (preserves the P2C-J4 §17
"no row lock" property). The append-receipt INSERT arbitrates via UNIQUE. The
jsonb projection update is best-effort and re-derivable from the receipt table's
read model (mirrors how `exam_incidents.updatedAt` is updated only by
version-bumping commands, not by notes/links — ADR-014 §10). Two concurrent
marks both leave durable append receipts; the jsonb reflects the latest
committed receipt (last-writer-wins by transaction commit order, which is
acceptable given the jsonb is a derived projection).

---

## 6. Required schema changes

### 6.1 New migration needed (0027)

Yes. A new migration `0027_<drizzle_slug>.sql` (mirroring
`0023_exam_incidents.sql` / `0024_breezy_tigra.sql`). **No changes to
`exam_attempts`** (the jsonb `misconduct` column stays as a derived projection;
this keeps rollback a plain DROP).

### 6.2 One new table: `attempt_misconduct_events` (append receipt)

Mirroring ADR-014 §12 `exam_incident_events` + ADR-015 §4.2
`exam_proctor_assignment_events`:

```sql
CREATE TABLE "attempt_misconduct_events" (
  "id"              uuid PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organizations"("id"),
  "attempt_id"      text NOT NULL,
  "operation_id"    uuid NOT NULL,
  "command_type"    text NOT NULL,         -- 'misconduct_mark' (reserved for future expansion)
  "actor_id"        text NOT NULL REFERENCES "users"("id"),
  "severity"        text NOT NULL,         -- 'warning' | 'serious'
  "notes"           text NOT NULL,         -- trimmed, 1..1000
  "outcome"         text NOT NULL,         -- 'applied' | 'no_change'
  "created_at"      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "attempt_misconduct_events" ADD CONSTRAINT "attempt_misconduct_events_command_type_check"
  CHECK ("command_type" IN ('misconduct_mark'));
ALTER TABLE "attempt_misconduct_events" ADD CONSTRAINT "attempt_misconduct_events_severity_check"
  CHECK ("severity" IN ('warning','serious'));
ALTER TABLE "attempt_misconduct_events" ADD CONSTRAINT "attempt_misconduct_events_notes_check"
  CHECK (length(btrim("notes")) BETWEEN 1 AND 1000);
-- idempotency arbiter:
CREATE UNIQUE INDEX "attempt_misconduct_events_org_operation_unique"
  ON "attempt_misconduct_events" ("organization_id", "operation_id");
-- per-attempt history + operation lookup:
CREATE INDEX "attempt_misconduct_events_org_attempt_created_idx"
  ON "attempt_misconduct_events" ("organization_id", "attempt_id", "created_at");
-- composite FK to exam_attempts:
ALTER TABLE "attempt_misconduct_events" ADD CONSTRAINT "attempt_misconduct_events_org_attempt_fk"
  FOREIGN KEY ("organization_id", "attempt_id") REFERENCES "exam_attempts"("organization_id", "id");
```

### 6.3 One new table: `attempt_force_submit_events` (append receipt)

```sql
CREATE TABLE "attempt_force_submit_events" (
  "id"              uuid PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organizations"("id"),
  "attempt_id"      text NOT NULL,
  "operation_id"    uuid NOT NULL,
  "command_type"    text NOT NULL,         -- 'force_submit'
  "actor_id"        text NOT NULL REFERENCES "users"("id"),
  "reason"          text,                  -- trimmed, 1..500; NULLABLE on no_change receipts
  "outcome"         text NOT NULL,         -- 'applied' | 'no_change'
  "created_at"      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "attempt_force_submit_events" ADD CONSTRAINT "attempt_force_submit_events_command_type_check"
  CHECK ("command_type" IN ('force_submit'));
ALTER TABLE "attempt_force_submit_events" ADD CONSTRAINT "attempt_force_submit_events_reason_check"
  CHECK ("reason" IS NULL OR length(btrim("reason")) BETWEEN 1 AND 500);
CREATE UNIQUE INDEX "attempt_force_submit_events_org_operation_unique"
  ON "attempt_force_submit_events" ("organization_id", "operation_id");
CREATE INDEX "attempt_force_submit_events_org_attempt_created_idx"
  ON "attempt_force_submit_events" ("organization_id", "attempt_id", "created_at");
ALTER TABLE "attempt_force_submit_events" ADD CONSTRAINT "attempt_force_submit_events_org_attempt_fk"
  FOREIGN KEY ("organization_id", "attempt_id") REFERENCES "exam_attempts"("organization_id", "id");
```

### 6.4 Alternative considered: a unified `attempt_command_events`

Considered, **NOT recommended for I1C0** — the two commands have different
payload fields (`reason` vs `severity`+`notes`), different CHECK constraints,
and different outcome semantics. Two focused tables, mirroring the
ADR-014/015 precedent of one event table per aggregate. A single jsonb
`payload` column would lose the CHECK-level validation (violates the
`attempt_time_adjustments_*_check` discipline, `schema/pg.ts:555-602`).

### 6.5 Arbiter and FK summary

- **Idempotency arbiter (both):** `UNIQUE (organization_id, operation_id)` —
  the single final replay/conflict arbiter (ADR-014 §9, ADR-015 §4.2).
- **operationId scope:** per-organization (NOT per-attempt). Mirrors time grant
  (`OPERATION_UNIQUE_CONSTRAINT`) and incident events. Different attempts
  reusing the same operationId → IDEMPOTENCY_CONFLICT (mirrors
  `operatorGrantExecution.ts:519-531` precedent).
- **Composite FKs:** `(organization_id, attempt_id) → exam_attempts(organization_id, id)`
  — reuses the existing unique `exam_attempts_org_id_unique`, same pattern as
  ADR-014 §12.
- **No `ON DELETE CASCADE`** (mirrors ADR-014 §12 / ADR-015 §15). Attempt
  deletion fails closed while a receipt references it.
- **Rollback:** additive tables, no existing-table changes → rollback before
  any write is a plain `DROP TABLE` (ADR-014 §14 precedent). After activation,
  rollback MUST be data-preserving (mark deprecated / add a CHECK blocking new
  writes).

### 6.6 No changes to `audit_logs`

The audit log continues to record the compliance fact, now with metadata that
references the operationId. Audit is **not** the arbiter (ADR-015 §4.2).

---

## 7. Test plan

Each test mirrors the existing golden references:
`admin-time-grants.concurrency.test.ts` (deterministic PostgreSQL race,
PID/txid evidence) + `admin-force-submit.test.ts` / `admin-misconduct.test.ts`
(route integration).

| Test | Asserts |
| --- | --- |
| **Replay — force-submit** | same operationId + same payload → `outcome=idempotent_replay`, returns original receipt, **no duplicate audit, no re-grade**, attempt `gradedAt` unchanged. |
| **Replay — misconduct** | same operationId + same payload → `idempotent_replay`, **no new audit row, no jsonb churn**. |
| **Conflict — both** | same operationId + different payload → 409 IDEMPOTENCY_CONFLICT (wire code). |
| **Concurrency — force-submit** | two concurrent force-submits (same attempt, different operationIds): a documented deterministic test — one `applied`, one `no_change`; **both leave durable receipts**; UNIQUE-arbiter visibility is extracted from the real thrown PG error (PID/txid evidence). |
| **Concurrency — misconduct** | two concurrent marks: both append receipts persist; jsonb projection = latest committed; both audit rows exist (one per `applied`, mirrors ADR-015 audit policy). |
| **Rollback** | simulate failure between receipt INSERT and attempt mutation (constraint / exception): the whole tx rolls back; no orphaned receipt, no orphaned state change, no orphaned audit. |
| **Crash-equivalent retry** | commit+lost-response simulation (commit, then a fresh call with the same operationId): returns `idempotent_replay` with the original receipt. |
| **Cross-org** | operationId query is org-scoped; cross-org operationId reuse must NOT conflict (mirrors `incidentRepo.findEventByOperationId` org-scoped query). operationId is independent per organization. |
| **Stale attempt state** | `voided` → 409 INVALID_STATE_TRANSITION. force-submit on already-`graded` → `no_change` with a durable receipt (NOT silent). misconduct on terminal attempt → `applied` (any status allowed, P2C-J4 §16). |
| **Audit/receipt atomicity** | assert: on `applied`, audit + receipt + mutation commit together; on `no_change`/`idempotent_replay`, NO new audit (mirrors ADR-015 §6 audit policy). |
| **Incident action-link integration** | after I1C0 lands, a future ADR-014 amendment should unblock misconduct-mark linking; for force-submit, the existing `linkIncidentAction` force_submit verification continues to work (the audit fact still exists). I1C0 test: the receipt write is the auditable event a link can reference. |
| **JSONB projection (misconduct)** | after multiple marks, `exam_attempts.misconduct` = the projection of the latest committed `applied` receipt; the append-only history is fully reconstructable from `attempt_misconduct_events`. |
| **Canonical-payload normalization** | `" x "` payload replayed as `"x"` → still a replay (trim-canonicalization, mirrors time grant `attempts.admin.ts` comments + ADR-014 §9). |

**Concurrency-test requirement:** mirror
`admin-time-grants.concurrency.test.ts` — use `createRaceBarrier` +
`operatorGrantConcurrencyHarness`, two distinct physical PG connections,
real PID/txid/SQLSTATE/constraint extracted from the *thrown* error (NOT
hardcoded), and verify the same production orchestrator the route uses. Do NOT
reimplement the transaction.

---

## 8. PR slicing

Three reviewable PRs, all backend-only (J5-R0 §12: "J5-I1C0 … no UI"). Each is
independently mergeable; Slice 1 is the foundation for the others.

### Slice 1 — schema + repositories + domain contracts (no behavior change)

- Migration `0027`: add `attempt_force_submit_events` +
  `attempt_misconduct_events`.
- `packages/contracts/src/attempt.ts`: new `operationId`-carrying schemas +
  outcome enums + receipt response schemas (coexist with legacy, not wired yet).
- `packages/domain`: new error/outcome types, canonical-payload comparison
  helper (mirrors `payloadsEqual`, `incidentCommands.ts:300-326`).
- `packages/db/src/repository`: new receipt-repository methods
  (`findByOperationId`, `insertReceipt`, `listByAttempt`) mirroring
  `incidentRepo.findEventByOperationId`.
- Rollback guard script
  (`apps/api/src/scripts/rollback-attempt-command-receipts.ts`) mirroring
  `rollback-incident-tables.ts` (ADR-014 §14).
- Repository unit tests + migration test (mirror
  `0023-incident-fk-and-rollback.test.ts`).
- **Acceptance:** `pnpm verify` green; no route behavior change; tables empty.

### Slice 2 — force-submit orchestrator + route + tests

- New orchestrator `apps/api/src/orchestrators/forceSubmitExecution.ts`
  (mirror `operatorGrantExecution.ts`): `forceSubmitWithOperationRaceRecovery()`,
  single production entrypoint.
- Flip `attempts.admin.ts:138-317` to call the orchestrator; accept
  `operationId`; return the receipt projection.
- Remove the legacy inline path (or keep a thin adapter that calls the
  orchestrator).
- Route tests update (`admin-force-submit.test.ts`): add
  replay/conflict/no_change/cross-org/audit-policy assertions.
- New deterministic concurrency test
  `admin-force-submit.concurrency.test.ts` mirroring
  `admin-time-grants.concurrency.test.ts`.
- **Acceptance:** force-submit satisfies all replay/retry/race invariants of
  §8.2; `pnpm verify` green.

### Slice 3 — misconduct-mark orchestrator + route + tests

- New orchestrator `apps/api/src/orchestrators/misconductMarkExecution.ts`.
- Flip `attempts.admin.ts:66-128` to call it; accept `operationId`; return a
  receipt projection (NOT `{ok:true}`).
- `flagMisconduct` (`exam-engine` `attemptCommands.ts:614-648`) becomes a
  projection-updater over the append receipt (or the route writes the
  projection inside the tx after the receipt insert).
- Route tests update (`admin-misconduct.test.ts`): add
  replay/conflict/append-history/projection assertions.
- New deterministic concurrency test `admin-misconduct.concurrency.test.ts`.
- **Acceptance:** misconduct-mark satisfies all replay/retry/race invariants;
  the ADR-014 §7 block condition (stable append-only receipt) is now satisfied
  (documented for a future ADR-014 amendment to unblock).

Slices 2 and 3 can be parallelized once Slice 1 lands (distinct orchestrators,
distinct tables, no cross-dependency).

---

## 9. Unknowns (source-only, no guessing)

1. **Client-side operationId generation contract.** J5-R0 §8.2 says
   "operationId is generated client-side," but I did not audit the Recovery
   Center frontend (PR #254) to confirm whether a shared `useOperationId` hook
   already exists that I1C1 must reuse for these two dangerous operations. The
   frontend operationId-generation convention is NOT verified from backend
   sources; flagged as an I1C1 concern (I1C0 has no UI).

2. **`no_change` vs `terminal` outcome vocabulary exactness.** ADR-015 §6
   proctor-assignment precedent uses `no_change` for the duplicate/already-state
   receipt; time grant uses `terminal` for the deadline-reconcile short-circuit.
   For force-submit, the "already graded" path maps most naturally to
   `no_change`, but this is opposite to the existing force-submit test narrative
   ("idempotent for an already-graded attempt") which implies success. The
   exact wire enum strings are an I1C0 implementation decision that wants a
   small contract adjudication guided by J5-R0 §8.2 + the time-grant precedent
   — NOT frozen here (this needs one small contract adjudication).

3. **Concurrent-loser misconduct jsonb projection reconciliation.** Two
   concurrent marks both leave append receipts, but the `exam_attempts.misconduct`
   jsonb must reflect *one* deterministic value. The design in §5.2 says
   "jsonb = latest committed receipt," but a jsonb projection update under two
   REPEATABLE-READ transactions concurrently updating the same row without a row
   lock may serialize-fail (one update waits on the other). It is not
   determinable from the source whether the no-row-lock jsonb projection update
   is viable, or whether misconduct requires an attempt-row `FOR UPDATE`
   (breaking P2C-J4 §17 "no row lock") — this needs implementation-time
   testing. force-submit does not have this problem (it already holds the EA
   lock).

4. **Disposition of the `attempt.forceSubmit` audit fact after I1C0.** PR #254's
   Attempt Operations Context (`recoveryRepo.ts:1406-1411`) and
   `linkIncidentAction`'s force_submit verification (`incidentCommands.ts:756-763`)
   currently scan the audit fact as force-submit identity evidence. After I1C0
   lands, the authoritative evidence moves to `attempt_force_submit_events`.
   Whether the audit-fact read model should (a) remain as redundant evidence,
   or (b) be replaced by a receipt-table join in `linkIncidentAction` and the
   recovery read-model is NOT frozen — this is a migration concern that affects
   the Incident action-link infrastructure.

5. **Existing `proctor-incident` (legacy audit-only marker) route interaction.**
   `POST /admin/attempts/:attemptId/proctor-incident` (`proctorMonitoring.ts`)
   writes a separate `proctor.incident_marked` audit marker that ADR-015 §16
   keeps as `deprecated` and Admin-only. Whether I1C0 must extend operationId
   discipline to that legacy route, or whether it is explicitly out of scope
   (resolving only `/force-submit` and `/misconduct`, as J5-R0 §12 implies), is
   NOT confirmed in source. J5-R0 §7 matrix rows name `/force-submit` and
   `/misconduct` only; the legacy marker is plausibly out-of-scope implicitly,
   but this is not explicitly frozen.

---

**Audit complete. No code modified, no commit, no push. This report is ready to
freeze the J5-I1C0 contract.**

## Appendix — primary source citations

| Claim | Source |
| --- | --- |
| force-submit route, no operationId | `apps/api/src/routes/attempts.admin.ts:138-317`; `packages/contracts/src/attempt.ts:442-444` |
| misconduct route, no operationId, overwrite | `apps/api/src/routes/attempts.admin.ts:66-128`; `packages/exam-engine/src/attemptCommands.ts:614-648`; `packages/db/src/schema/pg.ts:386` |
| time-grant orchestrator (golden reference) | `apps/api/src/orchestrators/operatorGrantExecution.ts`; `packages/exam-engine/src/operatorGrant.ts` |
| time-grant contract with operationId + outcome | `packages/contracts/src/attempt.ts:470-493`; `packages/db/src/schema/pg.ts:514-618` |
| ADR-014 §7 misconduct deferral; force_submit action identity | `docs/adr/ADR-014-exam-incident-authority.md` §7; `packages/exam-engine/src/incidentCommands.ts:669-811` |
| ADR-015 §13 Proctor grant removal; §4.2 events-as-arbiter | `docs/adr/ADR-015-proctor-exam-scope-authority.md` §4.2, §13 |
| J5-R0 §8.2 retry rules; §7 dangerous-action matrix; §12 I1C0 slice | `docs/roadmap/j5-r0-admin-recovery-center-contract.md` §7, §8, §12 |
| audit_logs has no operation_id column | `packages/db/src/schema/pg.ts:843-863` |
| Attempt Operations Context force-submit detection (PR #254) | `packages/db/src/repository/recoveryRepo.ts:1406-1411` |
| Incident events table precedent (migration 0023) | `packages/db/migrations/postgres/0023_exam_incidents.sql` |
| Proctor assignment events precedent (migration 0024) | `packages/db/migrations/postgres/0024_breezy_tigra.sql` |
