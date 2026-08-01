# REC-I6-R0 Incident Authority Reality Audit

## Status

**REC-I6-R0 PASS — DOCS-ONLY REALITY AUDIT AND DESIGN INPUT FREEZE.**

This is a documentation-only reality audit. It records, from source evidence,
exactly what "incident" means in the current runtime, what is reserved but
unimplemented, and which frozen realities constrain the formal Exam Incident
Authority. The design itself is frozen in
[`docs/adr/ADR-014-exam-incident-authority.md`](../adr/ADR-014-exam-incident-authority.md)
(Status: **PROPOSED**, pending human acceptance) and
[`docs/architecture/exam-system/incident-authority.md`](../architecture/exam-system/incident-authority.md)
(Status: TARGET — ADR-014 PROPOSED; Runtime implementation: NOT STARTED).

This audit introduces no migration, schema, domain type, repository, route,
permission, preset, UI, Redis, WebSocket/SSE, or runtime change.

## Base HEAD

```text
41f4818c5d5c836cca72736d98f1157149f7739d
Merge pull request #240 from jnhu76/feat/rec-i4-i3b2-time-grant-closeout
branch: docs/rec-i6-r0-incident-authority
```

## Scope and method

The audit answers six questions from repository evidence:

1. Does an Incident entity, table, repository, command, permission, or UI
   exist today?
2. What does the one existing "incident" surface (`proctor.incident_marked`)
   actually do?
3. Where is `incidentId` reserved, and how is null enforced end-to-end?
4. Which operator actions are separately authoritative, and do they link to
   incidents?
5. What are the frozen transaction, lock-ordering, and idempotency precedents
   a future Incident aggregate must respect?
6. Which active documents reference REC-I6 and must stay consistent?

Searches used `rg` (ripgrep) with exclusions for `node_modules`, `dist`,
`coverage`, `playwright-report`, `test-results`, and the untracked build
artifact directory `apps/api/public` (zero git-tracked files; verified with
`git ls-files apps/api/public | wc -l` → 0). Four parallel read-only code
explorations (authorization catalog/presets/resolvers; proctor-incident
runtime; operator action runtime and persistence; REC-I4 I1–I3B2 audit set)
supplement the direct searches.

## Commands executed

```text
rg -n "incident|Incident" apps packages            # A01/B01 code surface
rg -n "incident|Incident" docs --glob '!archive/**' # A02/B02 active docs
rg -n "incidentId|incident_id" apps packages        # A03 reservation chain
rg -n "proctor-incident|ProctorIncident|proctor\.incident" apps packages  # A04
rg -n "system_incident" apps packages docs          # A05
rg -n "misconduct|Misconduct" apps packages         # A06
rg -n "forceSubmit|force-submit|force_submit|ForceSubmit" apps packages   # A07
rg -n "REC-I6" docs --glob '!archive/**'            # A08 pointer inventory
rg -n "incident" packages/db/src                    # A09 schema
rg -n "incident|Incident" packages/authz/src        # A10 authz (2 lines)
rg -n "incident|Incident" apps/web/src              # A11 web
rg -n "TIMELINE_AUDIT_ACTIONS|incident_marked" apps packages              # A12
rg -n "Incident" packages/domain/src                # B03 domain entity check
rg -n "incident" packages/db/migrations/postgres --glob '*.sql'           # B04
rg -n "incident|Incident" packages/exam-engine/src/index.ts               # B05 (exit 1: no match)
git ls-files apps/api/public | wc -l                # → 0 (untracked artifact)
```

All searches are reproducible from the base HEAD. Non-matching searches
(B03 entity check, B05 export check) are evidence of absence and are recorded
with their exit codes in the job work log.

## Current runtime facts

### 1. The Incident entity surface is absent

| Claim | Evidence | Verdict |
| --- | --- | --- |
| No Incident domain type | `packages/domain/src` matches only policy vocabulary: `interruptionGracePerIncidentSeconds` (types.ts:269), `perIncidentCapSeconds` (types.ts:324) | ABSENT |
| No Incident engine command or export | `packages/exam-engine/src/index.ts` has zero incident matches | ABSENT |
| No Incident table or migration | the only `incident_id` in any migration is `0021_noisy_archangel.sql:46`, a column on `attempt_time_adjustments`; no `CREATE TABLE` names an incident | ABSENT |
| No Incident repository | interruption repos are `attemptInterruptionRepo`, `attemptInterruptionEventRepo`, `attemptTimeAdjustmentRepo`; no incident repo exists | ABSENT |
| No Incident permission | `packages/authz/src` contains exactly two incident lines: `auditActions.ts:116-117` (`ProctorIncidentMarked: "proctor.incident_marked"`), which is an audit action, not a permission; the catalog §4.6 Proctor Runtime block (catalog.ts:85-93) has no incident permission | ABSENT |
| No Incident UI | `apps/web/src` matches only the `technical_incident` time-grant reasonCode strings (`ProctorDashboardPage.tsx:208,611,698,939`) and `incidentId: null` test fixtures; no page calls `/proctor-incident` | ABSENT |

Conclusion: there is no Incident aggregate, lifecycle, store, command,
permission, or product surface in the current tree.

### 2. The one existing incident surface: `proctor.incident_marked` (audit-event-only)

A single route carries "incident" semantics today. It writes an audit event
and nothing else.

| Fact | Evidence |
| --- | --- |
| Route | `POST /admin/attempts/:attemptId/proctor-incident` — `apps/api/src/routes/proctorMonitoring.ts:201`; handler :225-285 |
| Gate | `requireScopedCapability(Permission.AttemptMisconductMark, "attempt", "attemptId")` — proctorMonitoring.ts:203-210. A misconduct-named permission gates a non-misconduct observation; `routeRegistry.ts:524-526` documents this as a deliberate P4-1 §G.3 drift closure: the write "records a distinct canonical incident observation rather than changing attempt misconduct state" |
| Effect | one `recordAtomicHttpAudit(tx, request, ctx, { action: AuditAction.ProctorIncidentMarked, targetType: "attempt", targetId: attemptId, metadata: { incidentType, examId, candidateId, attemptId, reasonCode, note } })` → `{ ok: true }`. No table write, no Attempt mutation |
| Contract | `ProctorIncidentTypeEnum` = `suspicious_behavior_marked \| network_issue_marked \| identity_check_failed \| manual_note_added` — `packages/contracts/src/attempt.ts:398-405`; request `{ incidentType (required), examId?, candidateId?, attemptId? (uuid hints), reasonCode? (max 100), note? (max 500) }` :414-421; response `{ ok: literal(true) }` :428-430; doc :409 "Audit-event-only storage — no dedicated incident table" |
| Audit policy | `apps/api/src/audit/auditPolicy.ts:555-570` — active / atomic / privileged_mutation / low; strict metadata schema `{ incidentType max(50), examId, candidateId, attemptId, reasonCode max(100) nullable, note max(500) nullable }`; `AUDIT_METADATA_MAX_BYTES = 4096` (:33) |
| Actor matrix | Admin and Proctor 200; Teacher, Grader, Candidate 403; cross-organization target 404 with zero writes (`proctorMonitoring.crossOrg.test.ts`) |
| OpenAPI | `apps/api/openapi.json` contains the proctor-incident path |

The route's own doc comment (proctorMonitoring.ts:193-199) states: "M9 v0:
lightweight incident recording only. Full proctor authority" is future work.
ADR-006's audit authority records `proctor.incident_marked` as an ATOMIC audit
action and notes that "a dedicated incident entity is a future product
decision, not an implied current store."

### 3. `incidentId` is reserved and enforced null end-to-end

| Layer | Evidence |
| --- | --- |
| DB column | `packages/db/src/schema/pg.ts:511` — `incidentId: uuid("incident_id")`, nullable, on `attempt_time_adjustments` only (migration `0021_noisy_archangel.sql:46`) |
| Domain type | `packages/domain/src/types.ts:362` — `incidentId: string \| null` on `AttemptTimeAdjustment` |
| Engine input | `packages/exam-engine/src/operatorGrant.ts:96` — `incidentId?: string \| null`, "Reserved for REC-I6; must be null in B1" |
| Engine guard | `operatorGrant.ts:229-230` — `if (input.incidentId != null) throw new ValidationError("incidentId is reserved until REC-I6")` |
| Engine replay comparator | `operatorGrant.ts:71` — same-operation comparison requires `existing.incidentId === null` |
| Engine writers | hard-code `incidentId: null` — `operatorGrant.ts:396` (operator grant), `restoreInterruption.ts:385` (bounded_grace) |
| Engine port | `interruptionRepositories.ts:43` — `InsertTimeAdjustmentInput.incidentId: string \| null` |
| HTTP request | `TimeGrantRequestSchema` has no `incidentId` — `packages/contracts/src/attempt.ts:470-476`; doc :462 "Server-decided fields (actorId, source, policy, beforeDeadline, afterDeadline, incidentId) are intentionally absent" |
| HTTP response | `incidentId: z.string().uuid().nullable()` projected (always null) in `OperatorTimeGrantAdjustmentSchema` — attempt.ts:510; `attempts.admin.ts:402` |
| DB source vocabulary | `pg.ts:548` CHECK allows `source IN ('bounded_grace','operator','system_incident','administrative_correction')`; the row-shape CHECK at `pg.ts:587` leaves the `system_incident` branch unconstrained. The database vocabulary is permissive; the engine and permission layers admit no writer |
| ADR reservation | ADR-013:374 "a nullable `incidentId`, reserved for the REC-I6 system-incident model"; :502 "incidentId nullable; reserved for REC-I6"; :644-645 "`source=system_incident` remains disabled until REC-I6 defines a System-only incident grant permission and incident authority" |

### 4. Operator actions are separately authoritative and carry no incident link

| Action | Command / route | Permission | Audit action | Incident linkage today |
| --- | --- | --- | --- | --- |
| Operator time grant | `grantAttemptTime()` (operatorGrant.ts:158-168); orchestrator `grantWithOperationRaceRecovery` (operatorGrantExecution.ts:468); route `POST /admin/attempts/:attemptId/time-grants` (attempts.admin.ts:314-329) | `attempt.time.grant` (Attempt scope, Admin-only) | `attempt.timeGrant` (only on a committed `granted` result) | `incidentId` reserved-null |
| Force submit | route composes `submitAttempt({ source: "proctor" })` + `gradeAttemptIdempotent` in one transaction (attempts.admin.ts:130-301); there is no standalone `forceSubmit` engine command | `attempt.force_submit` | `attempt.forceSubmit` | none — body is `reason` (max 500) only |
| Misconduct mark | `flagMisconduct()` (attemptCommands.ts:614-648) mutates the Attempt `misconduct` jsonb field; no status change; allowed on any status; no row lock; route attempts.admin.ts:66-120 | `attempt.misconduct.mark` | `attempt.misconductFlagged` | none — body is `severity` + `notes` (max 1000) |
| Proctor incident mark | audit-event-only route (fact 2 above) | `attempt.misconduct.mark` (reused) | `proctor.incident_marked` | is the observation itself; no entity |

Force submit and misconduct requests carry no incident field. A future
Incident aggregate must correlate with these actions by reference, never by
absorbing their authority.

### 5. Interruption episode identity is not incident identity

- `attempt_interruptions` has only `id, organizationId, attemptId, createdAt`
  (pg.ts:476-498). It has no `status` and no `version` column; episode
  lifecycle is event-derived.
- `attempt_interruption_events` is the append-only ledger
  (`eventType ∈ {detected, restored, terminalized}`, pg.ts:608-714) with two
  partial unique indexes: at most one `detected` and at most one outcome per
  episode (pg.ts:641-646).
- ADR-013:245-247 freezes the boundary: "`interruptionId` identifies one
  attempt's interruption; future `incidentId` identifies an operational
  incident that may affect many attempts. They are never interchangeable."
- `candidate-recovery.md` repeats the boundary: the episode UUID is per
  Attempt interruption; a future `incidentId` is a different identity for one
  service incident affecting multiple attempts.

### 6. Transaction and lock-ordering precedent (ADR-013 frozen)

- Canonical seam `lockEnrollmentAndAttempt` (lockSeam.ts:69-121): Enrollment
  FOR UPDATE (:83) → Attempt FOR UPDATE (:100), marked "DO NOT REORDER".
  `lockEnrollmentAndActiveAttempt` (:190-235) is the `/start` seam.
- Exam is locked AFTER Attempt: operatorGrant.ts:178-185;
  deadlineScanner.ts:124-132. No `Exam → Attempt` path exists.
- Grant transaction order: lock Enrollment/Attempt → lock Exam → operation
  lookup → deadline reconciliation → adjustment insert → Attempt deadline
  update → atomic compliance audit → commit (operatorGrantExecution.ts:269-373).
- `executeInTransaction(db, fn, "repeatable read")` retries on retryable
  errors (packages/db/src/types.ts:151-181); transaction-bound repositories
  are built inside the callback via `createXRepo(tx)`.
- Every repository method receives `ctx` first and tenant-scopes via
  `resolveOrganizationId(ctx)`.

### 7. Idempotency precedent

- `operationId` is command identity. Unique `(organization_id, operation_id)`
  on `attempt_time_adjustments` (pg.ts:530-533) is the final arbiter; the
  engine performs read-before-write replay/conflict detection
  (operatorGrant.ts:239-264): same identity + same canonical payload →
  `idempotent_replay`; different payload → `IdempotencyConflictError`
  (HTTP 409 `IDEMPOTENCY_CONFLICT`, registered in contracts/messageRegistry).
- The only non-serialized race — one `operationId` across two different
  Attempts — is recovered by recognizing only an exact PostgreSQL `23505` on
  the named constraint `attempt_time_adjustments_org_operation_unique` and
  re-running once in a fresh transaction
  (operatorGrantExecution.ts:59-60,88-117,468-511). Other `23505` errors are
  not swallowed.
- `bounded_grace` at-most-one-per-episode uses a partial unique index
  (pg.ts:534-536); episode event existence is guaranteed by the creating
  transaction while partial uniqueness enforces at-most-one.
- Answer save uses optimistic `baseVersion`/`serverVersion` plus a `clientSeq`
  idempotency key held in JSONB (answerProtocol.ts:131-173) — not a DB unique
  constraint. The literal token `expectedVersion` appears nowhere in the tree.

### 8. Authorization facts relevant to incident authority (ADR-010)

- Permission naming is `domain.resource.action`; presets are
  Admin/Teacher/Proctor/Grader/Candidate/System; assignment-backed PostgreSQL
  authority is the source of truth; authority loading fails closed
  (503 `AUTHZ_UNAVAILABLE`).
- Proctor preset (presets.ts:146-155): `ExamRoomView`, `AttemptStatusView`,
  `AttemptTimelineView`, `AttemptMisconductMark`, `AttemptForceSubmit` only.
  Proctor has no `AttemptTimeGrant` — the operator grant is Admin-only and
  this remains true after REC-I4-I3B2. Registry default scope is `Scope.Exam`;
  sensitive capabilities are `AttemptForceSubmit` and `AttemptMisconductMark`.
- M11 (Proctor-to-Exam resource scope) is NOT IMPLEMENTED: no scope tables or
  columns exist (P4-R1 reaudit). Any Proctor-scoped incident authority is
  blocked on M11.
- Scope types: System, Organization, Course, Exam, Attempt, Candidate,
  OwnAttempt, OwnScore.

### 9. Time and audit authority facts (ADR-006)

- `fastify.now()` is the sole clock; client timestamps are never authoritative.
- Audit metadata is bounded at 4096 bytes; the proctor incident note is
  bounded at 500 chars and misconduct notes at 1000 chars by contract.
- `proctor.incident_marked` is an ATOMIC audit action; a dedicated incident
  entity is explicitly a future product decision.

## Frozen realities that constrain ADR-014

The following are not decisions of this audit; they are existing frozen
contracts ADR-014 must honor and does not reopen:

1. **Incident is a new orthogonal concept.** It is not an Attempt status, not
   an InterruptionEpisode, not a Grading/Enrollment/Email state, and not an
   audit row. `interruptionId` and `incidentId` are never interchangeable
   (ADR-013:245-247).
2. **Operator actions stay separately authoritative.** Time grant
   (`grantAttemptTime` + `attempt_time_adjustments`), force submit (Attempt
   lifecycle transition), and misconduct mark (Attempt field + audit) keep
   their own commands, permissions, and audit actions. An Incident may
   reference them; it must not absorb or re-trigger them.
3. **`incidentId` enters production writes only through an accepted ADR-014
   implementation Job.** Until then the engine guard
   (operatorGrant.ts:229-230), the null-hard-coded writers, and the
   request-schema omission remain in force. `source=system_incident` remains
   disabled (ADR-013:644-645).
4. **Lock ordering is fixed.** Enrollment → Attempt → Exam; never
   Exam → Attempt. Incident-only commands must define a lock order that
   cannot deadlock with the Attempt-first operator actions (ADR-013 §9).
5. **Idempotency model is fixed.** `operationId` + canonical payload,
   unique `(organization_id, operation_id)`, exact-`23505`-only race recovery.
   Any incident command that adopts operation identity must reuse this model.
6. **PostgreSQL is the only authority.** No Redis authority, no client
   timestamps, no WebSocket/SSE in the incident contract (ADR-001, ADR-006,
   ADR-013 §11; P7-D1 gate).
7. **Proctor product activation remains blocked on M11.** Admin is the only
   Phase 1.x operator actor for new incident authority; a future scoped
   Proctor is a separate Phase 3 decision.
8. **Audit atomicity and metadata bounds.** Incident-related audit writes
   stay within the 4096-byte metadata bound and the atomic-audit pattern
   (ADR-006); long notes/evidence references belong to the Incident store,
   not to audit metadata.

## Active-document pointer inventory

Active (non-archive) documents that reference incidents or REC-I6, recorded so
Checkpoint 3 can keep them consistent:

| Document | Reference | Disposition |
| --- | --- | --- |
| `docs/roadmap/recovery-operations-jobs.md` | J2/J3 specs; 110 incident mentions | primary update target |
| `docs/adr/ADR-013-…` | :374, :502, :644 reservation statements | ACCEPTED — statements remain true; no semantic edit |
| `docs/adr/ADR-012-…` | :618, :892 "REC-I6 operator incident timeline" | ACCEPTED — no semantic edit |
| `docs/contracts/api-reference.md` | :1063 "REC-I6 系统事件模型仍是延期项" | remains true (implementation deferred); no new route to document |
| `docs/architecture/exam-system/candidate-recovery.md` | episode/incident identity boundary | consistent; no change required |
| `docs/architecture/exam-system/state-and-authority.md` | orthogonal dimensions | add Incident as a proposed orthogonal concept |
| `docs/architecture/exam-system/protocol-catalog.md` | operator grant protocol | add proposed Incident protocols |
| `docs/architecture/exam-system/domain-model.md` | :470 REC-I6 note; §14 absent aggregates | add Incident row to §14 |
| `docs/architecture/exam-system/README.md` | :108 known limitation; doc map :74-76 | add incident-authority.md to map; refresh limitation wording |
| `docs/roadmap/current.md` | :45, :161 | refresh to "designed, pending acceptance" |
| `docs/roadmap/P7-system-readiness-and-exam-modes.md` | :643 relationship table | refresh row without changing P7 scope |
| `docs/status/implementation-status.md` | :219 known limitation | note ADR-014 PROPOSED, implementation deferred |
| `docs/deployment/mvp-deployment-runbook.md` | :733 deferred list | remains true; no change required |
| `docs/roadmap/phase-roadmap.md` | :146 timeline acceptance signal | remains true; no change required |
| `docs/contracts/observability.md` | :107 "for incident correlation" | casual wording; no change required |
| `docs/audits/*` | frozen point-in-time records | never edited |

## Follow-up debt (recorded, not fixed in this docs-only PR)

1. **`proctor.incident_marked` is absent from the proctor timeline allowlist.**
   `TIMELINE_AUDIT_ACTIONS` (`apps/api/src/lib/proctorMonitoringService.ts:97-102`)
   contains `attempt.forceSubmit`, `attempt.misconductFlagged`,
   `attempt.extendTime` (legacy), and `attempt.timeGrant` — but not
   `proctor.incident_marked`. Marked incident observations therefore do not
   appear in the per-attempt proctor-events timeline. This is runtime
   behavior requiring a product decision and tests; it is not a documentation
   error and is not changed here.
2. **The proctor-incident route is gated by a misconduct-named permission.**
   `attempt.misconduct.mark` gates a non-misconduct observation
   (routeRegistry.ts:524-526 documents this as a deliberate P4-1 §G.3 drift
   closure). Whether a dedicated incident permission replaces it is a future
   decision noted by ADR-014; the gate is not changed here.
3. **SPEC.md candidate-restore text is stale.** SPEC.md :39 and :593 still
   state that candidates have no self-service restore entry, although REC-I3
   (PR #219) implemented the candidate-facing restore flow
   (`useAttemptRestore()`), as recorded in
   `docs/architecture/exam-system/domain-model.md` :470 and
   `candidate-recovery.md`. The proctor-side clause in the same sentences
   remains true. Correcting the product-authority SPEC is a separate
   documentation Job; it is outside this incident-authority mission.

None of these items blocks the incident authority contract. None is hidden:
each is recorded here with exact locations.

## Verdict

The current tree contains exactly one incident surface — the
`proctor.incident_marked` atomic audit action and its audit-event-only route —
plus one reserved, enforced-null `incidentId` placeholder on the
time-adjustment ledger. There is no Incident entity, table, command,
permission, preset, or UI. All operator actions that an Incident must later
correlate with are separately authoritative and already frozen by ADR-010,
ADR-012, ADR-013, and the REC-I4 audit set.

This reality is sufficient input to freeze the formal Exam Incident Authority
in ADR-014 (PROPOSED). J3 (`REC-I6-I1-INCIDENT-PERSISTENCE-COMMANDS`) remains
blocked until a human accepts ADR-014.
