# P7-CLOSE — RTO + Retention Gate P7-3 Closeout

> **Superseded (2026-08-14):** this document's verdict — "IMPLEMENTED —
> OPERATIONAL_ACCEPTANCE_PENDING (NOT PASS)" — was true on 2026-08-13 and is
> **historical evidence**. The operational acceptance it awaited was resolved
> by the P7 final program closeout
> ([`P7-FINAL-PROGRAM-CLOSEOUT.md`](P7-FINAL-PROGRAM-CLOSEOUT.md) §Gate P7-3
> acceptance record): software acceptance PASS (deterministic clean-volume
> restore drill executed 2026-08-14, measured 87 s ≤ declared RTO 3600 s;
> post-restore invariants green), deployment-site acceptance = runbook
> obligation (§12 of `docs/deployment/backup-and-recovery.md`). The mechanism
> descriptions in this document remain accurate.

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
WORKTREE   : round-1 committed (79a1749e); round-2 committed (4369270f)
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

## Review remediation (round 1)

The first human review of this changeset (REQUEST CHANGES) flagged two
evidence-truthfulness blockers and two evidence-quality issues. All are fixed
in this same changeset before merge:

- **RTO null contract mismatch (P1):** the UI sends an explicit
  `desiredRtoSeconds: null` when the Admin clears the RTO objective, but the
  PUT request schema was `.optional()` (allows `undefined`, not `null`), so a
  blank-RTO save returned 400 and (after migration) any Admin editing another
  field with a NULL RTO could not save. Fix: `.nullable().optional()` — `null`
  is the first-class NOT_CONFIGURED value the DB column, response schema, and
  repo already accept. The web unit test had frozen the bug in place by mocking
  the HTTP layer past the API schema; an API integration test now covers the
  `null` → 200 → `compliance.rto.status = NOT_CONFIGURED` path.
- **Retention success ↔ verified invariant (P1):** `result` and
  `verification_status` were parsed as independent fields, so
  `result='succeeded'` + `verification_status='failed'` could be stored and then
  rendered as `latestSuccessfulRetention` — contradicting the table docstring.
  Fix closes the gap at three layers: a DB CHECK
  (`retention_runs_success_verified_check`, migration `0034`), a CLI guard
  (`--result succeeded` requires `--verification-status verified`), and the repo
  query (`latestSucceededRetention` now requires `verified`, is unbounded, and
  orders by `completedAt`).
- **RTO evidence selection (P2):** RTO was measured from a bounded
  `listDrills(20).find(automated+succeeded)` that could return UNKNOWN while a
  valid automated success sat just outside the window — regressing the
  `completedAt`-authority, unbounded selection the backup repo already proved
  out. Fix: use `latestSucceededDrill(ctx, "automated")`; an automated success
  with no `durationMs` renders UNKNOWN (and the CLI now rejects recording that
  shape).
- **Retention script evidence quality (P2):** the host script recorded a fixed
  `"pgbackrest expire (config-driven)"` objective and captured a `CONF_OUTPUT`
  it never used, so the evidence proved only "expire returned 0", not that
  growth is bounded. Fix: read the actual `repo-retention-*` knobs from
  pgbackrest.conf (best-effort) plus the observed remaining full/diff counts
  after expire, and pass the evidence args via a bash array (no word-splitting
  on a multi-word reason).

These remediations do not change the Gate P7-3 verdict below — they strengthen
the evidence truthfulness the verdict rests on.

## Review remediation (round 2)

The second review found three evidence-truthfulness issues and one doc-sync
problem in the host-side retention script:

- **pgBackRest retention config regex wrong (P1):** the regex matched
  `repo-retention-*` but pgBackRest uses `repo1-retention-*` (with repository
  index). The regex never matched any real config knob. Fix: change to
  `repo[0-9]+[-_]retention[-_](full|diff|archive[-_]type)`.
- **`pgbackrest info` / `jq` failure fabricated `0` (P1):** when `pgbackrest
  info` failed or `jq` was unavailable, the evidence string still claimed
  `"0 full, 0 diff remaining"` — a false truthful-sounding value. The script's
  entire purpose is truthful evidence. Fix: track `COUNTS_OBSERVED` flag;
  record `"remaining backup counts unavailable"` when counts cannot be observed.
- **`OPERATION_ID` unique-constraint collision on same-hour retry (P1):**
  `retention:YYYY-MM-DDTHH` is stable within an hour; the DB has a UNIQUE index
  on `(organization_id, operation_id)`, so a second run within the same hour
  would unique-conflict on evidence insert. Fix: second-level UTC timestamp +
  8-char random hex suffix, making each run's identity unique.
- **Doc sync (P2):** stale WORKTREE line, missing round-2 provenance in
  implementation-status.md. Fixed in this changeset.

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

## Gate P7-3 verdict — IMPLEMENTED, operational acceptance pending

**Status: `IMPLEMENTED — OPERATIONAL_ACCEPTANCE_PENDING` (NOT PASS).**

P7-CLOSE implements the *mechanism* for both Gate P7-3 bullets P7-F left open —
the typed authority, the evidence ledger + its success↔verified invariant, the
truthful DESIRED/OBSERVED/STATUS projection, and the host-side automation path.
Implementing the mechanism is not the same as the gate being PASS. P7-F defines
Gate P7-3 as: declared RPO/RTO profile **+** backup automation + retention
operational **+** clean-host restore drill **+** post-restore invariant suite,
**with clean-volume restore completing within the declared RTO**. That last
clause is an operational acceptance on a real volume, which code-level
verification cannot discharge. Per P7-F's own principle — "a smaller truthful
product is better than a falsely complete one" — this document does **not**
claim the two bullets are *satisfied* and does **not** recommend PASS yet.

| Bullet | P7-F status | P7-CLOSE status |
| --- | --- | --- |
| RTO declared and tested | NOT MET | **Implemented (acceptance pending)**: typed nullable authority (30s..48h), declared range, measured via automated restore-drill evidence. Pending: a real automated restore drill whose measured duration ≤ declared RTO on a real volume. |
| Backup automation + retention operational | NOT MET (host-owned/`NOT_ENFORCED`) | **Implemented via option (c) (acceptance pending)**: retention evidence ledger + success↔verified invariant + readiness endpoint + host pgBackRest script; execution stays host-only (ADR-017 D4). Pending: a real scheduled retention run whose recorded objective reflects the actual pgBackRest config and whose evidence is `verified`. |

**What would move Gate P7-3 to PASS (the human's operational acceptance):**

```text
host scheduled retention (cron/systemd)
        ↓
pgBackRest expire (real repo-retention-* config in effect)
        ↓
verify actual retention config + repository integrity
        ↓
evidence written (result=succeeded ↔ verification=verified)
        ↓
clean-volume restore drill
        ↓
post-restore invariant suite
        ↓
measured restore duration ≤ declared RTO
```

Only then do ADR-017 rev 4 / ADR-018 move to ACCEPTED and Gate P7-3 to PASS. This
PR supplies the mechanism and the truthful evidence surface; it deliberately
leaves the verdict to that operational acceptance.

### Remaining (out of P7-CLOSE scope)

- **ADR-017 rev 4 / ADR-018 acceptance**: both remain `PROPOSED — awaiting human
  review`; flip to ACCEPTED follows a real Gate P7-3 PASS, not this changeset.
- **Operational deployment drill**: the unit/integration/static verification
  above is green; the end-to-end host drill above is the next acceptance step.
- **#286 Teacher@Course scoped authority**: already CLOSED as explicitly deferred
  (PR #284); Phase 3+ scope-narrowing, unrelated to Gate P7-3.
