# J5-I1C0 Slice 3 — Misconduct-Mark Durable Command (backend closeout)

> **Status:** BACKEND CLOSED — I1C1 (operations UI) + I1D (browser E2E) remain open.
>
> **Follow-up (2026-08-08):** I1C1 (Recovery Center operations UI) and I1D
> (browser E2E + accessibility/responsive closeout) have since CLOSED on the
> same branch; see `docs/audits/J5-ADMIN-RECOVERY-CENTER-CLOSEOUT.md` (the J5
> closeout). This document remains the backend-specific record of Slice 3.
>
> Branch: `feat/j5-i1c1-admin-operations-closeout` (NOT MERGED — for morning review).
>
> Authority chain: `AGENTS.md` → `docs/SPEC.md` →
> `docs/roadmap/j5-r0-admin-recovery-center-contract.md` (J5 contract, CLOSED) →
> `docs/audits/J5-I1C0-DANGEROUS-COMMAND-IDENTITY-REALITY-AUDIT.md` (the frozen
> pre-implementation audit, with its 2026-08-08 implementation-disposition note)
> → `docs/adr/ADR-014-exam-incident-authority.md` (ACCEPTED).

This document closes the **backend** half of J5-I1C0 Slice 3 (misconduct-mark
as an operationId-keyed durable command). It does NOT close J5 as a whole:
the Recovery Center operations UI (J5-I1C1) and the browser E2E +
accessibility/responsive closeout (J5-I1D) were NOT STARTED at this point —
both have since been implemented on the same branch (SUPERSEDED; see
`docs/audits/J5-ADMIN-RECOVERY-CENTER-CLOSEOUT.md` for the J5 status).

## 1. Implemented surface

- `apps/api/src/orchestrators/misconductMarkExecution.ts` — the single
  production entry point (`misconductMarkWithOperationRaceRecovery`) shared by
  the HTTP route and the deterministic concurrency test. Mirrors the
  force-submit orchestrator structure (pre-read replay/conflict, receipt-first
  insert, postcondition verification, exact-23505 fresh-transaction recovery)
  with the misconduct-specific adaptation: `exam_attempts FOR UPDATE` inside
  the receipt transaction (the recorded §17 exception), and the misconduct
  "always applied" semantics (every new operationId is a real append; there is
  no `no_change` for misconduct).
- `apps/api/src/routes/attempts.admin.ts` — the misconduct route is flipped to
  the operation-aware contract (`MisconductMarkWithOperationRequestSchema` →
  `AttemptCommandReceiptResponseSchema`); the legacy `{ok:true}` response and
  the destructive overwrite path are retired.
- `apps/api/src/audit/auditPolicy.ts` — the `attempt.misconductFlagged` audit
  payload schema now carries `operationId` (mirroring force-submit Slice 2),
  so the audit fact links to the receipt.
- `apps/web/src/features/misconduct/pendingMisconductAuthority.ts` (+ 24
  mutation-proof tests) — the same-tab retry-identity module mirroring
  `pendingForceSubmitAuthority`.
- `apps/web/src/pages/admin/ProctorDashboardPage.tsx` — the existing
  misconduct flow now mints + reuses an operationId so it stays green against
  the new contract.

## 2. Misconduct concurrency decision (the §5.2 / §8 experiment)

**Experiment setup.** 2026-08-07, PostgreSQL 18.4, two physical psql
connections, REPEATABLE READ, same `exam_attempts` row, two different
operationIds, two different severity/notes, true transaction overlap (T1
holds `SELECT ... FOR UPDATE` + an uncommitted receipt; T2 starts its own
transaction while T1 is still open).

**Observed outcome.**
- Both receipts insert fine (the arbiter is `(organization_id, operation_id)`,
  NOT per-attempt — each operationId is a distinct command identity).
- T2's `SELECT ... FOR UPDATE` blocks on T1's row lock.
- On T1's commit, T2's first RR attempt fails with SQLSTATE 40001
  (`could not serialize access due to concurrent update`) and its WHOLE
  transaction (receipt + projection + audit) rolls back — no orphaned receipt,
  no orphaned audit, no projection-only mutation.
- Under `executeInTransaction` auto-retry, T2 re-reads T1's committed
  projection and overwrites on its own success.

**Selected projection mechanism:** candidate (b) `exam_attempts FOR UPDATE`
inside the receipt transaction. This is the simplest deterministic mechanism
that produces a testable invariant. Candidate (a) plain UPDATE was rejected
(non-deterministic 40001); candidate (d) read-derived projection was rejected
as a larger read-model change than this slice needs.

**The recorded §17 exception.** P2C-J4 §17 "no row lock" was specifically for
the OLD overwrite-only `flagMisconduct` (a single best-effort jsonb update).
Making misconduct a durable command with a receipt + atomic audit REQUIRES
the row lock; this is the explicit, recorded exception the audit anticipated.

**Final invariant (encoded as Matrix A of the concurrency test):** two
concurrent marks on the same attempt → both `applied`, two durable append
receipts, two audit rows, and a deterministic final projection
(commit-order last writer wins, serialized by the FOR UPDATE lock).

## 3. Dangerous-command guarantees (misconduct)

- **operationId:** client-generated, reused verbatim across retries within the
  same dialog session (ProctorDashboard) / frozen in sessionStorage (the
  pendingMisconductAuthority module, ready for the Recovery Center surface).
- **Replay:** same operationId + same canonical payload → returns the stored
  immutable `result_payload` verbatim; no projection churn, no new audit, no
  new receipt.
- **Conflict:** same operationId + different command / attempt / payload →
  409 `IDEMPOTENCY_CONFLICT` (the shared `(organization_id, operation_id)`
  arbiter makes the cross-command rule enforceable).
- **Receipt:** one `attempt_command_receipts` row per operationId, append-only,
  full per-attempt history reconstructable.
- **Audit:** one `attempt.misconductFlagged` row per applied mark, carrying
  `operationId`; replay / conflict write no audit.
- **Lost response:** same operationId retried → `idempotent_replay`, no
  duplicate audit.
- **Concurrency:** two different operationIds on the same attempt serialize on
  the FOR UPDATE lock (40001 auto-retry); both leave durable receipts.

## 4. Verification

| command | result |
| --- | --- |
| `pnpm typecheck` (workspace) | PASS (17/17 tasks) |
| `pnpm lint` (code-quality) | PASS |
| `pnpm lint:eslint` (web) | PASS (0 warnings) |
| `pnpm --filter @exam/api exec vitest run admin-misconduct.test.ts` | 14/14 PASS |
| `pnpm --filter @exam/api exec vitest run admin-misconduct.concurrency.test.ts` | 6/6 PASS (matrices A-E + atomicity) |
| `pnpm --filter @exam/api exec vitest run admin-force-submit.test.ts permissionMatrix.proctor.test.ts proctorAuthorization.e2e.test.ts` | 66/66 PASS (no regression) |
| `pnpm --filter @exam/web exec vitest run src/features/misconduct/ ProctorDashboardPage.test.tsx` | 55/55 PASS |

## 5. Known limitations / what is NOT done

- **J5-I1C1 (Admin operations UI) was NOT STARTED** at Slice-3 closeout — the
  Recovery Center detail pages (Incident / Attempt Operations / Exam Recovery)
  were read-only, and `pendingMisconductAuthority` was not yet consumed by any
  Recovery page. **SUPERSEDED (2026-08-08):** the operations UI shipped
  afterward on the same branch (see
  `docs/audits/J5-ADMIN-RECOVERY-CENTER-CLOSEOUT.md`).
- **J5-I1D (browser E2E + accessibility/responsive closeout) was NOT STARTED**
  at Slice-3 closeout — no new J5 browser E2E specs existed. **SUPERSEDED
  (2026-08-08):** the browser E2E work shipped afterward on the same branch
  (see `docs/audits/J5-ADMIN-RECOVERY-CENTER-CLOSEOUT.md`).
- **Issue #263 (cross-tab force-submit authority) remains a P2 follow-up** —
  not implemented, as scoped.
- **`misconduct_mark` Incident action link (ADR-014 §7)** is now UNBLOCKED by
  the durable receipt (a future ADR-014 amendment can wire it); this slice did
  not add the action link itself.
