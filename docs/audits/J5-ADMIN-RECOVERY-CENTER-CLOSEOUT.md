# J5 — Admin Recovery Center Closeout

> **Status:** CLOSED (backend durable commands + operations UI + browser E2E +
> accessibility/responsive closeout). Branch `feat/j5-i1c1-admin-operations-closeout`
> is NOT MERGED — left for morning human review (one PR).
>
> Date: 2026-08-08. Authority chain: `AGENTS.md` → `docs/SPEC.md` →
> `docs/roadmap/j5-r0-admin-recovery-center-contract.md` (J5 contract, CLOSED /
> ACCEPTED, PR #251) → `docs/audits/J5-I1C0-DANGEROUS-COMMAND-IDENTITY-REALITY-AUDIT.md`
> (frozen pre-implementation audit + dated implementation-disposition note) →
> `docs/audits/J5-I1C0-MISCONDUCT-SLICE3-CLOSEOUT.md` (backend half of Slice 3).

This document closes the **Admin Recovery Center** job: J5-I1C0 (dangerous
command identity — both slices), J5-I1C1 (Admin operations UI on the four
Recovery surfaces), and J5-I1D (browser E2E workflows + accessibility /
responsive closeout). J5-I1A (read models) and J5-I1B (Recovery Center UI)
were closed earlier (PRs #252/#253/#254).

## 1. Implemented surface (this branch)

### Backend — J5-I1C0 Slice 2 (force-submit) + Slice 3 (misconduct-mark)

- `attempt_command_receipts` — the durable, operationId-keyed command-receipt
  table (Slice 1, PR #261) arbitrated by the single
  `(organization_id, operation_id)` unique constraint, shared by
  `force_submit` and `misconduct_mark` (domain `AttemptCommandType`).
- `apps/api/src/orchestrators/forceSubmitExecution.ts` (Slice 2, PR #262) and
  `apps/api/src/orchestrators/misconductMarkExecution.ts` (Slice 3, this
  branch) — the two dangerous-command orchestrators: receipt-first
  transaction, replay/conflict pre-read, immutable `result_payload` returned
  verbatim on replay, exact-23505 fresh-transaction recovery, mandatory
  atomic audit on applied, `ctx.actorId` as the single receipt actor
  authority, postcondition verification (`assertCommittedProjectionMatchesStored`).
- **Misconduct projection mechanism (the §5.2 / §8 experiment adjudication):**
  `exam_attempts FOR UPDATE` inside the receipt transaction. The deterministic
  two-connection PostgreSQL experiment (2026-08-07, REPEATABLE READ, true
  overlap) observed SQLSTATE 40001 for the loser and full rollback of
  receipt+projection+audit; the row lock serializes projection writes
  deterministically. This is the recorded, explicit exception to the old
  overwrite-only `flagMisconduct` no-row-lock property (P2C-J4 §17) — see the
  implementation-disposition note in the I1C0 audit (§25 respected: the frozen
  audit was NOT rewritten).
- `apps/api/src/routes/attempts.admin.ts` — the misconduct route is flipped to
  the operation-aware contract
  (`MisconductMarkWithOperationRequestSchema` →
  `AttemptCommandReceiptResponseSchema`); the legacy `{ok:true}` response is
  retired. `apps/api/src/audit/auditPolicy.ts` — `attempt.misconductFlagged`
  carries `operationId` (mirrors force-submit Slice 2).
- Deterministic concurrency matrices (force-submit PR #262; misconduct this
  branch): Matrix A both-applied serialized projection, Matrix B real 23505 →
  fresh-tx recovery → `idempotent_replay`, Matrix C payload drift → 409
  IDEMPOTENCY_CONFLICT, Matrix D cross-attempt rollback, Matrix E lost
  response, failure atomicity, mutation-proof divergence fail-closed.

### Frontend — J5-I1C1 (Admin operations UI)

- `apps/web/src/features/recovery-operations/useRecoveryOperation.ts` — the
  generic dangerous-command controller (J5-R0 §8.2): ONE frozen operationId
  per dialog session, retried verbatim on indeterminate (network / 5xx — the
  server may have committed), cleared on confirmed outcome; fail-closed
  `beforeSubmit` guard (pending-authority persistence failure suppresses the
  POST); classification mirrors the proctor dashboard's `classifyGrantFailure`
  contract incl. `IDEMPOTENCY_CONFLICT`.
- `apps/web/src/features/recovery-operations/RecoveryCommandDialog.tsx` — the
  controlled dialog shell: frozen form while submitting/indeterminate (a retry
  can never drift the payload under the same operationId), close blocked
  while submitting, retry + explicit abandon affordances on indeterminate,
  operation-name confirm buttons, `InlineErrorBanner` for ambiguity.
- `apps/web/src/features/misconduct/pendingMisconductAuthority.ts` — the
  same-tab durable pending-misconduct authority (fail-closed save with
  byte-for-byte read-back, strict load validation, corrupt surfacing), mirroring
  `pendingForceSubmitAuthority`.
- `RecoveryAttemptDetailPage` — Operations section gated by server-computed
  `allowedActions` (`time_grant` / `force_submit` / `misconduct_mark`): time
  grant (minutes + reason code + reason), force submit (required canonical
  reason, destructive confirmation naming candidate + exam + consequence,
  pending-force-submit authority), misconduct mark (severity + required
  notes, destructive confirmation, pending-misconduct authority). Confirmed
  outcomes reload the authoritative projection.
- `RecoveryIncidentDetailPage` — Operations section gated by `allowedActions`:
  investigate (optional reason), add note (required body), change severity,
  resolve (REQUIRED resolution summary, terminal judgment), dismiss (REQUIRED
  reason, terminal judgment). All commands send `expectedVersion` (except
  add_note, whose wire schema has no version); a 409
  `INCIDENT_VERSION_CONFLICT` surfaces the dedicated reload-and-retry message.
- `RecoveryExamDetailPage` — assign proctor (userId input; the wire has no
  proctor list, the server resolves the user and fail-closes) + per-proctor
  revoke (destructive confirmation naming proctor + exam) on the Active
  proctors section.

### E2E — J5-I1D (browser workflows + a11y/responsive)

New specs under `apps/e2e/e2e/` (all run through `bash scripts/e2e/run-wsl.sh`
against the `exam_e2e*` databases — the real API + web servers, real admin
API assertions):

- `recovery-incident-workflow.spec.ts` — Workflow A (open → investigate →
  add note → change severity, each confirmed by the recovery aggregate API),
  Workflow B (investigating → resolve with required summary → terminal status
  → reload hides terminal actions), dismiss with required reason, and a stale
  `expectedVersion` → 409 `INCIDENT_VERSION_CONFLICT` → "reload and retry".
- `recovery-time-grant.spec.ts` — Workflow C: `operator_incident` exam, grant
  10 minutes from the operations UI; the aggregate shows exactly one new
  operator adjustment (+600s) and the effective deadline shifts by exactly
  600s (server-side computation is the authority).
- `recovery-force-submit.spec.ts` — Workflow D: happy path (disposition
  `applied`, one audit, attempt graded) + lost-response retry: server commits,
  response masked as 500 via `page.route` → indeterminate → SAME operationId
  retry → parsed `idempotent_replay` with the SAME receipt `createdAt`
  (exactly one receipt) and one audit.
- `recovery-misconduct.spec.ts` — Workflow E (closes I1C0+I1C1 vertically):
  mark with severity + notes → projection shows the flag, one
  `attempt.misconductFlagged` audit, attempt stays live; lost-response retry
  with the SAME operationId → `idempotent_replay`, same receipt `createdAt`,
  no duplicate audit.
- `recovery-proctor-assignment.spec.ts` — Workflow F: assign proctor (real
  `/api/users` Proctor role) → aggregate reload shows the assignment →
  revoke with destructive confirmation → aggregate reload shows it gone.
- `recovery-operations-a11y.spec.ts` — keyboard operability (focus into the
  dialog, Escape close, focus return to the trigger), operation-name confirm
  buttons (never a bare "确认"), required-field errors via `role="alert"`
  (FieldError), indeterminate ambiguity via `role="alert"` (InlineErrorBanner,
  asserted in the force-submit retry spec), operations + dialogs usable at
  390×844 (mobile) and 1440×1000 (desktop).

## 2. Dangerous-command guarantees (frozen, all tested)

1. **One operationId per command session** — minted at dialog open, reused
   verbatim on every retry, dropped only on a confirmed outcome (2xx or
   definitive 4xx). A retry is always an idempotent replay.
2. **Fail-closed persistence** — force-submit / misconduct persist the pending
   authority (with byte-for-byte read-back verification) BEFORE the POST; an
   unpersisted identity is never sent (a lost response would lose it forever).
   Reload recovery restores the durable identity into `indeterminate`.
3. **Immutable committed fact** — the receipt's `result_payload` is returned
   verbatim on replay; the client can distinguish `applied` from
   `idempotent_replay` by parsing the response (asserted in E2E, not inferred
   from audit counts).
4. **Atomic audit** — `attempt.forceSubmit` / `attempt.misconductFlagged`
   (with `operationId` in metadata) commit inside the receipt transaction;
   a replay writes no new audit.
5. **Version-conflict safety (incidents)** — every versioned command carries
   `expectedVersion`; a stale version is a confirmed 409 with a dedicated
   reload-and-retry message, never a silent overwrite.
6. **No optimistic mutation** — every confirmed outcome reloads the server
   snapshot; the UI never derives state from its own write.

## 3. Verification

- `pnpm verify` (full gate: static checks, lint, architecture, copy guard,
  typecheck, api openapi check, coverage, build) — PASS on this branch.
- Misconduct backend: 14 route tests + 6 deterministic concurrency tests +
  force-submit regression (1581 lines) + proctor authorization regression.
- Web: `useRecoveryOperation` (11), `pendingMisconductAuthority` (24),
  RecoveryAttemptDetailPage (21), RecoveryIncidentDetailPage (18),
  RecoveryExamDetailPage (13).
- E2E: the six new recovery specs (11 tests) ran green via
  `bash scripts/e2e/run-wsl.sh` (2 shards, `exam_e2e_w0/w1`), including the
  lost-response retry evidence (same operationId, parsed `idempotent_replay`,
  same receipt `createdAt`).
- `apps/api/openapi.json` regenerated (`api:openapi`) and the
  `api:openapi:check` gate passes.

## 4. Known limitations (recorded, not silently closed)

- **Issue #263 — cross-tab force-submit authority is explicitly OUT OF SCOPE**
  (P2 follow-up, per the mission brief): no localStorage coordinator /
  `navigator.locks` / `BroadcastChannel` was added for force-submit or
  misconduct retry identity. Same-tab identity + reload recovery via
  sessionStorage is the implemented bar (matches the force-submit review's
  stated minimum). The time-grant command on the Recovery attempt page uses
  the in-hook same-tab identity (the cross-tab `pendingGrantCoordinator`
  remains the proctor dashboard's job).
- The Recovery pages have no page-level pending-command banner (the proctor
  dashboard's banner is not replicated); the dialog itself is the recovery
  surface (retry + explicit abandon) and the durable authority survives
  reloads.
- Proctor assignment on the Recovery Exam page takes a raw userId (no
  user-search endpoint exists in the current API surface; the server resolves
  the user and fail-closes 404/403/409).
- The `recovery-visual-inspection.spec.ts` screenshots (all four pages, four
  viewports) were NOT re-run on this branch; the a11y/responsive spec covers
  the operations dialogs at mobile + desktop instead.
- J6 (Proctor Recovery Center), J7, Redis, system-generated incidents,
  generic durable-command rewrite, and the misconduct incident action-link
  (ADR-014 amendment) remain future work, as scoped.

## 5. Definition-of-done mapping

- J5-I1C0 (both slices) — CLOSED: operationId + durable receipt + immutable
  request/result fact + replay/conflict classification + atomic audit +
  defined concurrency (real experiment, recorded).
- J5-I1C1 — CLOSED: attempt / incident / exam operations surfaces, gated by
  server-computed `allowedActions`, retry-safe, reload-authoritative.
- J5-I1D — CLOSED: E2E workflows A–F + failure paths (403/404/409/network-
  indeterminate) + a11y/responsive closeout, green via the WSL runner.
- Roadmap docs (`docs/roadmap/current.md`, `docs/roadmap/recovery-operations-jobs.md`)
  updated truthfully; this closeout is the single authoritative record.
