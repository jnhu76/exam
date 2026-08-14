# P7-CLOSE — RTO + Retention Gate P7-3 Closeout

> **P7-CLOSE = close the two Gate P7-3 bullets** that the P7-F final readiness
> closeout (`P7-F-FINAL-SYSTEM-READINESS-CLOSEOUT.md`) truthfully left as
> `NOT PASS — HUMAN_DECISION_REQUIRED`: **RTO not declared/tested** and
> **retention not operational**. This is an evidence-driven implementation
> closeout of exactly those two bullets — it does not broaden P7 scope.
>
> "A smaller truthful product is better than a falsely complete one." The
> verdict below is a **recommendation for human sign-off**, not a self-declared
> PASS: the P7-F authority doc reserves the gate verdict as a human decision.

## Baseline

```text
BASE_SHA   : f8b664f462afd913143b9e0c35b5ab4b61354d23  (origin/master, PR #288 merged)
branch     : feat/p7-close-rto-retention-final
START_DATE : 2026-08-13
WORKTREE   : P7-CLOSE changeset (14 files, +761/-10) — uncommitted, pending human review
```

## What P7-CLOSE implements

### Bullet 1 — RTO declared and tested

The P7-F finding: *"no typed `desired_rto_*` authority anywhere in the product
code, no declared supported RTO value, and no restore-within-RTO acceptance."*

P7-CLOSE adds the typed authority + the measured acceptance:

- **Schema** (`packages/db/src/schema/pg.ts`, migration `0033_rto_retention_p7_close.sql`):
  nullable `desired_rto_seconds` column on `backup_operational_policy`
  (`integer NULL`, `CHECK (desired_rto_seconds BETWEEN 30 AND 172800)`). **NULL
  = RTO objective NOT_CONFIGURED** — absence is a truthful state, never a
  default-zero that would imply a 30s objective.
- **Contracts** (`packages/contracts/src/system.ts`): `desiredRtoSeconds` is
  `.optional()` on the PUT request (client may omit), nullable on the response
  `OperationalPolicySchema`, and a required `ComplianceItemSchema` row in the
  compliance projection. Range constant `OpsPolicyRtoSecondsRange = { min: 30,
  max: 172800 }` (30s .. 48h) is the single source mirrored by the DB CHECK.
- **Repository** (`operationalPolicyRepo.ts`): `upsertPolicyWithinTransaction`
  carries `desiredRtoSeconds: number | null` through the CAS-protected write.
- **Compliance projection** (`routes/system.ts buildOpsPolicyProjection`): RTO
  is measured against **automated restore-drill evidence only** —
  `SATISFIED`/`NOT_SATISFIED` when an automated drill's `durationMs` is
  within/exceeds the declared objective; `UNKNOWN` when no qualifying automated
  drill exists; `NOT_CONFIGURED` when `desiredRtoSeconds IS NULL`. Operator-
  declared drills **never** satisfy RTO (they are not proof).
- **API**: PUT `/system/ops-policy` carries `desiredRtoSeconds`; GET returns the
  RTO compliance row. Both gated `SystemOpsPolicyManage` (Admin-only) / view.
- **UI** (`OperationsPage.tsx`): RTO input (placeholder "留空 = 未配置" via the
  i18n catalog) and the RTO compliance row render alongside RPO/retention/drill.
- **Audit** (`auditPolicy.ts OpsPolicyUpdated`): the strict payload schema
  carries `desiredRtoSeconds` (nullable) atomically with the write.

### Bullet 2 — Retention evidence + host-side automation

The P7-F finding: *"retention is genuinely not automated — operator discipline …
`backup.retention.manage` recorded as NO-GO / host-owned."* P7-F named
**option (c) — host-side automated retention (cron/systemd + WAL-G/pgBackRest)**
as the architecture-aligned path. P7-CLOSE delivers exactly that, without giving
the browser or Maintainer any execution authority (ADR-017 D4 preserved):

- **Evidence ledger** (new `retention_runs` table + `retentionEvidenceRepo.ts`):
  typed retention-run records (artifact, verification, completion) — the product
  records **evidence**, never claims to **enforce**.
- **Readiness endpoint** (`GET /system/retention-readiness`): Admin + Maintainer
  read-only projection of latest/successful/history retention runs.
- **CLI** (`scripts/backup-evidence.ts`): retention subcommand instruments the
  host retention step at its natural checkpoint.
- **Host script** (`scripts/backup/pgbackrest-retain.sh`): the architecture-
  aligned host-side retention executor (cron/systemd-owned), matching P7-F
  option (c). Restore/retention **execution remains host-only**; the product
  only records and projects evidence.
- **Compliance truth**: the ops-policy retention row stays truthfully
  `NOT_ENFORCED` (host-managed by design) — P7-CLOSE does NOT fake an
  "enforced" verdict. The new retention-readiness endpoint is the evidence
  surface; the gate bullet is satisfied by host automation + evidence, not by a
  product-side retention engine.

## Root-cause fix carried in this changeset

The P7-CLOSE RTO work initially omitted `desiredRtoSeconds` from the
`OpsPolicyUpdated` audit action's **strict** payload schema
(`apps/api/src/audit/auditPolicy.ts`). Symptom: PUT `/system/ops-policy`
returned `400 UNRECOGNIZED_KEYS: 'desiredRtoSeconds'` and the 7-test
`opsPolicy` block cascaded to `NOT_CONFIGURED`. Root cause: `validateAuditPayload`
threw a raw `ZodError` *inside* `executeInTransaction`, rolling back the policy
write. Fix: add `desiredRtoSeconds: z.number().int().nullable()` to the audit
schema. (Saved as a reusable gotcha in agent memory.)

## Verification evidence

```text
Static gates (format / lint / code-quality / copy / arch / eslint /
  typecheck / openapi)               : ALL GREEN
pnpm --filter @exam/api test         : 2190 passed, 7 skipped (163 files)
pnpm --filter @exam/api coverage     : 163 files pass
pnpm --filter @exam/db test          : 566 passed (42 files)
web OperationsPage.test.tsx          : 13 passed
pnpm verify (full)                   : GREEN (static + coverage + build)
```

> Note on the verify coverage step: under parallel turbo + instrumentation load,
> two pre-existing timing-sensitive tests (contention-schedule / isolated-DB
> setup) can flake. They pass cleanly when run directly and are unrelated to
> P7-CLOSE (no P7-CLOSE change touches timing/concurrency behavior). The final
> `pnpm verify` run was green.

## Gate P7-3 verdict — RECOMMENDATION (human sign-off required)

P7-CLOSE substantively satisfies both Gate P7-3 bullets that P7-F left open:

| Bullet | P7-F status | P7-CLOSE status |
| --- | --- | --- |
| RTO declared and tested | NOT MET | **Implemented**: typed nullable authority (30s..48h), declared range, measured via automated restore-drill evidence |
| Backup automation + retention operational | NOT MET (host-owned/`NOT_ENFORCED`) | **Implemented via option (c)**: retention evidence ledger + readiness endpoint + host pgBackRest script; execution stays host-only (ADR-017 D4) |

**Recommendation:** with this changeset, Gate P7-3's two open bullets are
satisfied on the architecture-aligned path P7-F specified. Flipping the gate to
**PASS** (and ADR-017 rev 4 / ADR-018 to **ACCEPTED**) is a **human decision** —
this document supplies the evidence, it does not declare the verdict.

### Remaining (out of P7-CLOSE scope)

- **ADR-017 rev 4 / ADR-018 acceptance**: both remain `PROPOSED — awaiting human
  review`; flip to ACCEPTED is the human's call after reviewing this evidence.
- **E2E + deployment drills**: the unit/integration/static verification above is
  green; a full deployment drill (host cron + pgBackRest end-to-end, restore-
  within-RTO acceptance on a real volume) is the next acceptance step if the
  human wants operational (not just code-level) proof.
- **#286 Teacher@Course scoped authority**: already CLOSED as explicitly deferred
  (PR #284); Phase 3+ scope-narrowing, unrelated to Gate P7-3.
