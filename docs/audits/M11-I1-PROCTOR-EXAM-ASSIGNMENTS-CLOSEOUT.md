# M11-I1 — Proctor-to-Exam Assignments Closeout Audit

> **Job:** `M11-PROCTOR-EXAM-ASSIGNMENTS` (J4-I1)
> **Type:** Implementation closeout (runtime shipped via four stacked draft PRs)
> **Date:** 2026-08-02
> **Branches:** `feat/m11-i1a-proctor-assignment-domain` → `feat/m11-i1b-proctor-scope-runtime` → `feat/m11-i1c-proctor-assignment-api` → `feat/m11-i1d-proctor-minimum-activation`
> **Authority:** ADR-015 (Accepted 2026-08-02, PR #245, base `836023c7`)

---

## 1. Job and PR stack

| Slice | PR | Title | Base | Head SHA |
| --- | --- | --- | --- | --- |
| J4-I1A | #246 (draft) | add Proctor-to-Exam assignment domain | `master` @ `836023c7` | `329b74ce` |
| J4-I1B | #247 (draft) | enforce Proctor Exam scope | PR A branch | `cf5c8bda` |
| J4-I1C | #248 (draft) | add Admin Proctor assignment API | PR B branch | `6affe62d` |
| J4-I1D | #249 (draft) | activate minimum Proctor authority | PR C branch | HEAD of this branch |

Stack: `A → B`, `A → C`, `B + C → D` (mandated linear delivery A→B→C→D). No PR was merged; no PR was marked ready for review automatically.

## 2. Base and final SHAs

- Accepted base SHA: `836023c7f9b32bc2cacc8745d1257363fc0222bd` (master, PR #245 M11-R0)
- ADR-015 acceptance date: 2026-08-02; acceptance evidence: ADR-015 §Status + §26 checklist (all closed) present on the base commit; J4-R0 CLOSED and J4-I1 NEXT per `docs/roadmap/recovery-operations-jobs.md` §6.
- Final head (PR D branch): see PR D (pushed as draft).

## 3. Implemented scope

### J4-I1A — Persistence + domain contracts

- Tables `exam_proctor_assignments` (episode state) + `exam_proctor_assignment_events` (append-only command receipts), migration `0024_breezy_tigra.sql`.
- Domain types: `ExamProctorAssignment`, `ExamProctorAssignmentStatus`, `ExamProctorAssignmentEvent`, `ExamProctorAssignmentCommandType`, `ExamProctorAssignmentEventOutcome`, `ExamProctorAssignmentCommandOutcome`.
- Tenant-scoped repository `proctorAssignmentRepo` (ctx-first) incl. read commands `listExamProctors` (keyset), `listProctorExams`, `getProctorExamAssignment`, `hasActiveAssignment`.
- Commands `assignProctorToExam()` / `revokeProctorFromExam()` with `operationId` idempotency, canonical payload comparator (reasonCode inside payload only), episode-resolution table, and the 23505 loser-receipt recovery (`withProctorAssignmentOperationRecovery`).
- Audit actions `exam.proctor_assigned` / `exam.proctor_revoked` (atomic, only on `outcome=applied`).

### J4-I1B — Scoped authorization runtime

- Incident→Exam resolver (`incident` resolver family; incident's examId server-derived).
- Per-request Proctor-assignment enforcement (`proctorAccess: "assignment_scoped"`) after capability check + resource resolver; Admin short-circuit; missing assignment folded into 404 `RESOURCE_NOT_FOUND`.
- 5-valued `proctorAccess` on every route-registry entry (93 entries incl. the 11 previously-missing incident routes); structural conformance test enumerating every entry.
- Flat→scoped flips: misconduct, force-submit, timeline, all 11 incident routes; legacy `proctor-incident` marker Admin-only + OpenAPI `deprecated: true` (stays scoped).
- `AttemptForceSubmit` + `AttemptMisconductMark` removed from `PROCTOR_PERMISSIONS` and the Proctor sensitive projection (still valid Admin catalog permissions).
- `GET /admin/proctor/exams` backend assignment-filtered (assignment_filtered_collection).
- **Fix included in this slice (applied on PR B head `cf5c8bda`):** the resolved-Exam id is derived from the resolution chain's `exam` node (the incident resolver reduces to Scope.Exam but its `resourceId` is the incident id) — without it, incident routes could not authorize assigned Proctors.

### J4-I1C — Admin assignment API

- Permissions `exam.proctor_assignment.manage` / `exam.proctor_assignment.view` (Admin-only; no per-permission defaultScope).
- `POST /admin/exams/:examId/proctors`, `GET /admin/exams/:examId/proctors` (keyset pagination), `POST /admin/exams/:examId/proctors/:proctorUserId/revoke` — all under `requireScopedCapability(<perm>, "exam", "examId")`, wired only to the canonical commands.
- OpenAPI regenerated.

### J4-I1D — Minimum Proctor activation

- Proctor preset gains `IncidentView` / `IncidentCreate` / `IncidentInvestigate` (ADR-014 §8 target grant) behind the J4-I1B enforcement.
- `AttemptForceSubmit` / `AttemptMisconductMark` NOT restored; `AttemptTimeGrant` / `IncidentResolve` NOT granted.
- End-to-end authorization tests covering the full §6.3 matrix (cross-Exam denial, revoke/restore, role-loss/role-restore, Admin-without-fake-rows).

## 4. Schema and constraints (frozen, verified against real PostgreSQL)

- `exam_proctor_assignments_status_check` — `status IN ('active','revoked')`
- `exam_proctor_assignments_revocation_shape_check` — active ⇔ (revoked_at IS NULL AND revoked_by IS NULL); revoked ⇔ both NOT NULL
- `exam_proctor_assignments_active_unique` — partial unique `(organization_id, exam_id, proctor_user_id) WHERE status='active'` (one-active arbiter)
- `exam_proctor_assignment_events_org_operation_unique` — `(organization_id, operation_id)` (sole idempotency arbiter)
- `exam_proctor_assignment_events_command_type_check` / `_outcome_check`
- Composite FK `(organization_id, assignment_id) → exam_proctor_assignments(organization_id, id)`; composite FK `(organization_id, exam_id) → exams(organization_id, id)`; plain `users(id)` FKs (`ON DELETE NO ACTION`); `actor_id` NOT NULL.
- **Deviations from ADR-015 §15's "zero changes to existing tables" claim:** the `exams_org_id_unique` index on `exams(organization_id, id)` was required for the frozen composite exam FK — the ADR's factual premise (that the unique already exists) was wrong (verified on master: no such index existed). The index is additive and data-neutral. The user-FK reality correction (plain `users(id)`) matches the ADR's own correction.
- Migration 0024 is a pure delta (drizzle-kit's generated diff incorrectly re-created the hand-written 0023 incident tables; the SQL was corrected to the delta with index-before-FK ordering).

## 5. Command semantics

- Assign: validate (exam in org → 404; proctor in org → 404; inactive → 400; no active Proctor role → 400) → INSERT active episode → applied event → atomic audit. Already-active under a new opId → `no_change` receipt (no mutation, no audit). Replay → `idempotent_replayed` returning the ORIGINAL episode (the event's `assignment_id`). Payload/command-type conflict → 409 `IDEMPOTENCY_CONFLICT`.
- Revoke: canonical identity `{operationId, examId, proctorUserId}` (assignmentId is never a second identity); resolve+lock active episode else most-recent revoked (`revoked_at DESC, id DESC`); active → revoked + applied event + audit; already revoked → `no_change` receipt; no episode → 404.
- `reasonCode` lives ONLY inside `canonical_payload` (trimmed-or-null, ≤100).

## 6. Idempotency evidence

- Same opId + same commandType + same canonical payload → `idempotent_replayed`, no write (unit + API + concurrency tests).
- Same opId + different payload/commandType → 409 (unit + API tests).
- Events-table unique is the arbiter; `audit_logs` is NOT (it has no operation_id column).

## 7. Concurrency evidence (real PostgreSQL)

| Race | Observed outcome |
| --- | --- |
| Two concurrent assigns, different opIds | one `applied` + one `no_change`, ONE active episode, TWO durable receipts, ONE audit |
| Two concurrent assigns, same opId | one `applied` + one `idempotent_replayed`, ONE receipt, ONE audit |
| Two concurrent revokes, different opIds | one `applied` + one `no_change`, ONE revoked episode, TWO receipts, ONE audit |
| Assign vs revoke race | internally valid final state (≤1 active; revoked rows carry revoked_at/by; every event references a concrete episode) |

The concurrent-assign loser forms its own durable `no_change` receipt in a fresh transaction (ADR-015 §7) — never a bare fresh-read return. 23505 recognized only on the two named arbiters; unrelated violations surface (tested).

## 8. Route inventory

- Monitoring: `GET /admin/proctor/exams` (filtered), `GET /admin/exams/:examId/proctor/attempts` (scoped+enforcement), `GET /admin/attempts/:attemptId/proctor-events` (scoped+enforcement), `GET /admin/attempts/:attemptId/timeline` (scoped+enforcement), `POST /admin/attempts/:attemptId/proctor-incident` (scoped, Admin-only, deprecated).
- Attempt admin: misconduct / force-submit scoped + `admin_only`; time-grants scoped + `deferred`.
- Incidents: 9 assignment_scoped (view/create/investigate/notes/severity/action/attempt/interruption links + exam-scoped list/create), 2 admin_only (resolve/dismiss) — all scoped.
- Assignment API: 3 Admin-only routes.
- Whole-app inventory: 109 primary routes = 95 protected + 14 non-protected (was 106/92+14).

## 9. Dangerous-permission removal

`AttemptForceSubmit` + `AttemptMisconductMark` removed from `PROCTOR_PERMISSIONS` and the Proctor `sensitivePermissions` (J4-I1B). They remain valid Admin catalog permissions and the routes remain scoped. Tests assert the removal and that they are NOT described as deferred.

## 10. Initial Proctor grants (J4-I1D)

`IncidentView`, `IncidentCreate`, `IncidentInvestigate` added to the Proctor preset. NOT granted: `IncidentResolve`, `AttemptTimeGrant`; NOT restored: `AttemptForceSubmit`, `AttemptMisconductMark`.

## 11. 403/404 behavior

- Missing / cross-org / unassigned resource → 404 `RESOURCE_NOT_FOUND` (anti-enumeration; asserted byte-shape-identical for unassigned vs missing).
- Capability denied → 403 `PERMISSION_DENIED`.
- Resolver infra failure → 503 `AUTHZ_UNAVAILABLE`.
- OperationId conflict → 409 `IDEMPOTENCY_CONFLICT`; inactive/no-Proctor-role target → 400 `VALIDATION_ERROR`.

## 12. OpenAPI evidence

- Regenerated via `pnpm --filter @exam/api api:openapi`; `api:openapi:check` passes in `pnpm verify:static`.
- Legacy `proctor-incident` route carries `"deprecated": true` and `x-role: ["Admin"]` (verified in `apps/api/openapi.json`).

## 13. Test evidence

- `pnpm verify:static` — PASS on every PR.
- `packages/authz`, `packages/db`, `packages/exam-engine`, `apps/api` suites — PASS (apps/api: 141 files / 1787 tests incl. new conformance, behavior, authorization, and assignment-API tests).
- Real-PostgreSQL concurrency + migration-contract tests (PR A), structural conformance (PR B), Admin API integration (PR C), §6.3 end-to-end authorization matrix (PR D).
- `git diff --check` clean.

## 14. Explicit non-goals (still NOT implemented)

- Admin Recovery Center UI (J5) — NOT implemented.
- Proctor Recovery Center UI (J6) — NOT implemented (the Proctor UI is J6 work; J4 deliberately ships no Proctor UI surface — ADR-015 §17).
- Teacher→Course / Teacher→Exam / Grader→Work relationships — NOT implemented.
- Custom roles, generic policy language, Redis in the authorization path — NOT implemented (PostgreSQL is the sole assignment authority).
- WebSocket/SSE, background workers, multiTenant, SuperAdmin — NOT implemented.
- System-generated incidents — NOT implemented.
- Time-grant / force-submit / misconduct-mark authority for Proctor — NOT implemented (and force-submit/misconduct grants are removed).
- Browser-level Proctor E2E: the Proctor product UI does not exist (J6), so cross-Exam denial is covered by HTTP-level E2E tests through the real production route composition (the security authority is the backend; there is no Proctor UI to drive in a browser).

## 15. Remaining J5/J6 work

- J5 — `REC-OPS-ADMIN-RECOVERY-CENTER` (next per the accepted recovery roadmap): Admin Recovery Center UI incl. the Proctor-assignment management UI (ADR-015 §17).
- J6 — `REC-OPS-PROCTOR-RECOVERY-CENTER`: Proctor-facing UI + recovery workflows.
- J7 — scenario closeout.
- System incidents, incident retention, candidate-facing incident reporting (separate future Jobs).

## 16. Status truth

| Item | Truth |
| --- | --- |
| ADR-015 | Accepted |
| J4-R0 | Closed |
| J4-I1 | Closed (this campaign) |
| Proctor-to-Exam persistence | Implemented |
| assignment commands | Implemented |
| Admin assignment API | Implemented |
| resource-scope enforcement | Implemented |
| minimum Proctor incident authority | Implemented |
| Admin Recovery Center UI | Not implemented |
| Proctor Recovery Center UI | Not implemented |
| Redis authorization | Not used |
| J5 / J6 | Not started |

## 17. Post-closeout review finding — loser receipt when the winner is already revoked (M11-I1-R1)

**Finding (PR #246 review):** the §7 loser-receipt recovery resolved the
collision episode with a single read of the committed ACTIVE assignment. When
the winning episode was revoked between the loser's rollback and its fresh
transaction, the read came back empty and `formLoserReceipt` failed with
`NotFoundError`. The losing `operationId` then left no permanent evidence — a
later retry of the same operationId was treated as a fresh command, violating
ADR-015's core invariant ("every racing operationId must form permanent
evidence"). The shipped concurrency test only covered two concurrent assigns
while the winner stays active.

**Fix (PR #246, `94f683bf`):** `formLoserReceipt` no longer requires the
episode to be active. It resolves the collision episode within the recovery's
race window:

1. own operation event (unchanged — replay/conflict);
2. committed active assignment, bounded by the window;
3. fallback: most-recent episode of ANY status by the frozen
   `(created_at DESC, id DESC)` order, bounded by the same window;
4. the loser's `no_change` receipt references that episode — active or
   already revoked;
5. no compliance audit (unchanged).

The window bound is the fresh transaction's own snapshot time (`SELECT now()`
as the first statement; under the house REPEATABLE READ isolation it equals
the snapshot). The winning episode committed before the collision, hence
strictly before the bound; a reassignment round created at/after the bound is
never referenced. The bound can be pinned explicitly (`opts.createdBefore`) —
tests pin the window semantics deterministically. ADR-015 §7 gained amendment
A1 documenting the fallback.

**New real-PostgreSQL tests (recovery suite + repo suite):**

- loser collides (real 23505), winner's episode revoked before the loser's
  fresh recovery → the loser still writes its `no_change` receipt, the
  receipt's `assignment_id` points at the winning episode (now revoked), and
  a later retry of the loser's operationId replays instead of creating a
  fresh assignment; exactly one `exam.proctor_assigned` and one
  `exam.proctor_revoked` audit.
- race-window boundary: with the bound pinned between the original round and
  a later reassignment, the receipt references the ORIGINAL episode; without
  a pinned bound the default window is the recovery snapshot and the active
  later round is referenced.
- repo: `findMostRecentEpisodeByExamAndProctor` ordering
  (`created_at DESC, id DESC`), bound filter, cross-org fail-closed, id
  tie-break.

**No other PR affected:** the fix is confined to PR #246's files
(orchestrator, repo, engine contract, tests, ADR-015 §7); PRs #247–#249
inherit it when #246 lands.
