# ADR-023 — Remove the Backup-Evidence Subsystem (Host Owns Operational Evidence)

## Status

* Status: **ACCEPTED** (2026-10-24) — records the owner gate disposition on
  [Issue #739](https://github.com/jnhu76/exam/issues/739): "Architecture
  disposition: Option D — REMOVE (conditional implementation authorization)",
  superseding the earlier SHRINK recommendation. The architecture decision is
  binding. Removal itself is **gated**: this decision is recorded by a
  docs-only change (PR-A); product code removal is PR-B and schema removal is
  PR-C, and neither may start ahead of its gate. Until PR-B lands, the runtime
  still implements the subsystem this ADR removes.
  *(2026-10-25: all three PRs are merged — PR-A #814 `91dc6ad6`, PR-B #815
  `bdc59b3c`, PR-C #816 `cc318dd5` — and the backup-evidence subsystem is
  removed from the current product. The Transition contract below is the
  historical execution plan, kept as written; the runbook §17.2 drill and the
  §2.7 upgrade gate carry the surviving operator obligations.)*
* Date: 2026-10-24
* Decision owners: project owner (owner gate disposition on #739)
* Supersedes:
  * ADR-018 — Operational Observability Window, **in part only**: the
    Backup-Evidence and Recovery/Restore-Evidence window content, and the
    statement that the backups / restore-readiness / ops-policy `/system/*`
    surfaces realize the window. The window contract itself — the D2
    data-provider invariants, the D3 taxonomy method, the D4 redaction
    boundary, the D6 host-execution boundary, and the D7 per-source ADR
    requirement — is **not** superseded and continues to govern
    health/diagnostics and any future window source.
  * ADR-017 (rev 4) — **in stated scope only**, effecting ADR-017 revision 5:
    R4-3 category B (reliability-objective intent record), R4-4
    (`system.ops.policy.*` as objective + compliance projection), D5's three
    `backup.*` decision gates (now declined), D6 (backup-trigger
    abstraction), D9 (Admin objectives / compliance projection), D10 (backup
    SUCCESS ledger invariants), the D1 business-owner summary's backup items,
    the five-capability Maintainer freeze in R4-5/D2/D3 (re-baselined to
    two), the R4-1 statement admitting backup/recovery evidence as window
    content (the window principle itself is not touched), and D13's E2B/E2C
    backup-evidence sequencing line items (historical — implemented in P7-E,
    now removed). **ADR-017 §Revision 5 is the canonical enumeration of
    these scopes.** Everything else in ADR-017 — D4 (restore/PITR
    permanently host-only), D12 (honest trust boundary), D14 (Admin ↔
    Maintainer mutual exclusion), the R4-1 window principle, and the System
    synthetic actor — remains in force unchanged.
* Superseded by: none
* Related decisions:
  * ADR-017 — Operational Authority and Maintainer Boundary (**amended by
    this ADR**; see the rev-5 note in that file)
  * ADR-018 — Operational Observability Window (**superseded in part** by
    this ADR)
  * ADR-010 — Scoped RBAC Architecture (the capability-catalog/preset change
    is executed by PR-B as part of ADR-017's existing amendment of ADR-010;
    this ADR adds no new ADR-010 relationship)
  * [#739](https://github.com/jnhu76/exam/issues/739) — backup-evidence
    architecture audit and owner gate; stays OPEN through PR-B and PR-C
    verification and closes with a closeout
  * [#812](https://github.com/jnhu76/exam/issues/812) — immutable detailed
    audit archive (evidence base; including the G0 verification record)
  * [#813](https://github.com/jnhu76/exam/issues/813) — research-stage issue
    "LAN disaster recovery × browser answer preservation ×
    authoritative-history rollback" — an **independent** concern, not
    governed or declined by this ADR

> Evidence base: the #739 architecture audit (six reports + adversarial
> review), the Delta Review, the owner decision of 2026-10-24, and the G0
> host-path verification (scoped as described under "Preserved invariants").
> Historical closeouts and audits that describe the removed subsystem
> ([`docs/archive/audits/`](../archive/audits/): P7-E, P7-E3 decision gates,
> P7-CLOSE RTO+retention, P7 final closeout) remain valid historical evidence
> of what was built and why; they are **not** current authority for the
> removed scope. Where they and this ADR disagree about the backup-evidence
> subsystem's future, this ADR governs.

---

## Context

The backup-evidence subsystem (append-only attestation ledger + operational
policy intent + RPO/RTO/retention compliance projection + Admin/Maintainer UI
+ operator evidence CLI, built in P7-E under ADR-017 rev 4 / ADR-018) was
audited from source in #739. The audit established:

- **No automated producer.** `scripts/db-backup.sh` never invokes the
  evidence CLI; the runbook documents evidence recording for restore drills
  only. No operational consumer consumes the structured evidence for
  decisions. The RTO projection reads only `source='automated'` drill rows
  that no automation produces — a closed orphan loop. Retention enforcement
  is hardcoded `NOT_ENFORCED`.
- **The ledger attests; it does not verify.** `--verification-method` is free
  text; no checksums; no read-time artifact existence check.
- **The ledger shares the failure domain of the database it describes.** A
  restore (`DROP DATABASE … WITH (FORCE)`) rolls the ledger back to the dump
  state. Missing evidence is rendered truthfully as `NO EVIDENCE` /
  `UNKNOWN` — not automatically green — but a previously verified SUCCESS
  record can outlive its artifact or its usable age and then render as green:
  the **stale-green risk**.
- After excluding accepted-ADR authority, roadmap direction-of-travel, and
  sunk-cost arguments, no ledger capability is irreplaceable; its substitutes
  are host logs, real restore drills, and the health/diagnostics surfaces
  that remain.

The owner accepted these findings and resolved the disposition to **REMOVE**
(TARGET_ARCHITECTURE = REMOVE), weighing circularity, the stale-green risk,
and absent consumers above the error-cost-asymmetry retention argument, and
declining a sunset observation window.

**Boundary of this decision.** This campaign removes the **backup-evidence
subsystem** — not the Host's disaster-recovery capability. The Host Operator
owns backup execution, scheduling and retention policy, artifact storage,
off-host copies, restore execution and verification, recurring drills, and DR
operational records, exactly as before. This ADR does not redesign, extend,
or decline any Host-side backup facility.

---

## Decision

**Exam no longer owns backup-evidence persistence, RPO/RTO compliance
projection, or a dedicated backup/restore evidence UI. The Host Operator owns
backup execution, scheduling, artifact storage, verification, restore drills,
and operational evidence. Exam retains application health and runtime
diagnostics, business integrity and its recovery protocol, application
configuration authority, and the Maintainer's read-only operational
observation window (health + diagnostics).**

What Exam keeps after removal:

- exam/attempt business state and its authoritative semantics (untouched);
- application health and runtime diagnostics (`/system/health`,
  `/system/diagnostics`);
- business-integrity and recovery protocol (ADR-012/013/014 surfaces —
  unrelated to backup evidence);
- application configuration authority (env/settings resolution as documented
  in [`architecture/configuration-authority.md`](../architecture/configuration-authority.md));
- if ever built as a separately decided product capability: an **authorized,
  non-sensitive application configuration export** (see "Configuration
  export boundary" below);
- the Maintainer as a read-only Operational Observer over health +
  diagnostics.

No replacement evidence subsystem is introduced — no external monitoring
platform, no JSONL sidecar, no evidence-forwarding service. **No new external
JSONL/service subsystem is authorized.** If a future operational requirement
demonstrates the need, it requires its own ADR.

### Deletion boundary (target state)

Executed as PR-B (product code) and PR-C (schema + docs convergence); PR-A
(this change) records the target only.

| Layer | Removed | Retained |
| --- | --- | --- |
| Schema | `backup_runs`, `backup_run_events`, `backup_operational_policy`, `restore_drill_runs`, `retention_runs` — removed by a **new forward-only DROP migration** in PR-C. Applied migrations 0031–0034 and the migration journal are **immutable** and stay intact. | all exam/attempt/audit/recovery tables |
| API | `GET /system/backups`, `GET /system/restore-readiness`, `GET /system/retention-readiness`, `GET /system/ops-policy`, `PUT /system/ops-policy` | `/system/health`, `/system/diagnostics`, and the rest of the `/system` info/public-config surface |
| Contracts | backup / restore-readiness / retention-readiness / ops-policy DTOs (defined in `@exam/contracts`) | health/diagnostics contracts |
| RBAC | the four permission keys — `system.backup.view`, `system.restore_readiness.view`, `system.ops.policy.view`, `system.ops.policy.manage` (defined in `packages/authz`, not in `@exam/contracts`) — are removed from the capability catalog and from every preset holding them (Admin holds all four; Maintainer the three views); **Maintainer target set = `system.health.view` + `system.diagnostics.view`** (5 → 2; prospective until PR-B — see "Transition contract") | Maintainer read-only Operational Observer role; D14 mutual exclusion; health/diagnostics permissions |
| CLI | `apps/api/src/scripts/backup-evidence.ts` (and its script-owned `ALLOW_UNSAFE_EVIDENCE_TEST_DB` fact) | `scripts/db-backup.sh` (host path, unchanged) |
| UI | OperationsPage backup-evidence / restore-readiness / ops-policy sections | health + diagnostics presentation |

The RBAC re-baselining is a single-commit-set concern: `packages/authz`
catalog + presets, route registry, API/contracts, role metadata, golden doc
C-09 ("frozen at exactly five read capabilities"), relevant tests, and active
documentation must change **together** in PR-B, or the documented and
implemented Maintainer diverge.

### Migration strategy (inviolable)

- Historical migrations `0031_secret_annihilus`, `0032_daily_trauma`,
  `0033_rto_retention_p7_close`,
  `0034_retention_success_verified_invariant` are **applied history**: they
  must **not** be deleted, rewritten, or edited. The historical SQL and the
  migration journal stay intact.
- PR-C removes the five tables with a **new forward-only DROP migration**,
  with upgrade/journal checks and a **pre-drop evidence-preservation gate**:
  before any destructive migration runs, the deployment's operator must
  confirm — as a project-owner-owned PR-C blocking obligation — whether
  remote production deployments exist and whether their historical evidence
  requires export/preservation. Absence of a reachable production host is not
  proof that none exists.

### Roadmap disposition — declined vs. not declined

**Declined (Exam-owned product capabilities):**

- Exam-owned backup-evidence persistence (the five-table ledger, its read
  routes, and the evidence CLI);
- internal RPO/RTO compliance projections (the ops-policy
  DESIRED-vs-OBSERVED evaluation and the retention-readiness projection);
- Admin-visible backup-evidence product features (Operations page backup
  posture; the backup items of the Admin business-owner summary);
- the `backup.trigger`, `backup.schedule.manage`, `backup.retention.manage`
  decision gates as future product capabilities (converging ADR-017 D5 with
  the P7-E3 DEFERRED (NO-GO) record);
- the generic settings import/export bullet of the P7 historical record
  remains unimplemented and declined (P7-E0: no generic settings subsystem).

**Explicitly NOT declined (Host/operator obligations and independent future
work):**

- Host backup execution and scheduling; retention policy; artifact
  checksums; off-host copies; cross-version/locale recovery — these remain
  operational obligations and may require **future host-side hardening**
  (outside Exam RBAC, decided outside the product);
- recovery verification = an **actual restore into a scratch database**;
  recurring restore drills — operator obligations, retained. (Scope note:
  the runbook's §17 documents the drill mechanics and, until PR-C, the
  P7-E2B drill-ledger recording step; it establishes no recurring-drill
  schedule, and deployment documentation stating the drill cadence or the
  deployment profile does not exist today. Recording the retained drill
  obligation and the profile it is measured against is assigned to PR-C in
  the Transition contract.);
- Phase 4 **tenant-level backup / restore** (platformization scope, a
  different capability from this single-deployment subsystem);
- #813 ("LAN disaster recovery × browser answer preservation ×
  authoritative-history rollback", research stage) — independently governed.

### Configuration export boundary

**Configuration Export ≠ Infrastructure Maintenance.** Exam may, as a
separately decided product capability, expose an authorized **non-sensitive
application configuration export**. Such an export must never contain
secrets/credentials, raw deployment environment files, PGDATA or backup
artifacts; it never performs or authorizes restore execution and never
carries Host control-plane authority.

**Current state: no configuration export capability exists** (no route, no
UI; the only historical mention is the unimplemented P7 in-scope bullet).
This ADR records it as an **independent candidate product capability** — not
implemented, not scheduled, not part of any PR in this campaign. This PR
implements no new functionality.

### Maintainer re-baseline (target state)

The Maintainer's target permission set after PR-B is exactly two read
capabilities: `system.health.view` and `system.diagnostics.view` — business
permission count 0, write permission count 0. `system.backup.view`,
`system.restore_readiness.view`, and `system.ops.policy.view` lose their
future authorization; `system.ops.policy.manage` is removed from the product
permission catalog by PR-B. The Admin ↔ Maintainer mutual exclusion (D14) and
the health/diagnostics permissions are retained.

**Runtime permissions have not changed in PR-A.** The live implementation
still holds the five read capabilities and the Admin
`system.ops.policy.manage` capability until PR-B removes them.

---

## Preserved invariants (owner constraint)

- **Host restore safety is untouched.** `db-backup.sh`
  app-stop-before-drop, typed confirmation, `TEMPLATE template0`
  recreation, healthcheck gate remain exactly as they are. G0 (2026-10-24,
  disposable PostgreSQL 18.4 exercise at baseline `2064953e`) verified the
  **database restore path** with an actual `DROP`/`CREATE`/`pg_restore`
  (exit 0) into an isolated database: matching table inventory and per-table
  row counts (41 tables), 131 indexes, 150 constraint groups,
  encoding/locale parity, FK constraints validated, selected relational/FK
  queries run against the restored copy.
- **G0's scope limits are binding.** It was a manual reproduction of script
  commands against a dev fixture — **not** execution of the full production
  Compose wrapper, **not** an application boot against the restored copy
  (matching row counts and catalogs do not prove byte-for-byte content
  equality), and **not** proof of production DR readiness or a fully proven
  application-level restore. An actual scratch-database restore validates
  the **database restore path**; application health and domain-level
  acceptance are **additional checks**, not proven by the same evidence.
  Host scheduler, retention, off-host artifact copies, cross-version/locale
  recovery, and production-scale RPO/RTO remain deployment/operator
  obligations.
- Exam's exam-runtime, authorization, and business-recovery invariants are
  outside this subsystem and unaffected.
- The ledger's D10 truthfulness invariants lapse with their table. The
  safety obligation they encoded — operational evidence must not lie —
  transfers to the operator runbook: verification means an actual restore
  into a scratch database; application health and domain-level acceptance
  are separate checks on top of it, never implied by the restore alone.
- Existing backup/restore security obligations continue after removal:
  restore/PITR stay permanently host-only (ADR-017 D4), secrets stay out of
  the product (ADR-017 D11), and the Maintainer/Admin boundary invariants
  (D12/D14) hold.

---

## Transition contract

- **PR-A (this change):** docs-only. Adds this ADR; amends ADR-017 (rev 5)
  and ADR-018 (superseded in part); registers ADR-023 in
  `docs/adr/README.md`; extends the `docs/README.md` ADR range and the
  active-roadmap tracker pointer; records the roadmap decline disposition
  (`docs/roadmap/phase-roadmap.md`); and aligns current-state documentation
  with the *transition* (`docs/status/implementation-status.md`,
  `docs/architecture/authorization.md`,
  `docs/architecture/exam-system/diagrams.md` — target described
  prospectively; live runtime unchanged). No product code, schema, test, or
  runtime-behavior change. Per the owner gate, PR-A is submitted for owner
  review and must not merge without the owner's exact-head review of this
  full file set (the touched-file enumeration above is the review scope).
- **PR-B:** blocked until PR-A is merged and this transition contract is
  accepted. Removes product API/UI/CLI/RBAC/contracts and associated tests
  in one commit-set (see the deletion boundary), while preserving
  health/diagnostics and the host `scripts/db-backup.sh`, and retaining D14
  and the health/diagnostics permissions. The same commit-set converges
  active documentation that names the removed surfaces — including the
  atlas golden doc's affected rows (C-09 capability freeze, the C-12
  ops-policy entry, the C-20 preset citation, the `/system/ops-policy`
  repo-symbol/CONTRACT rows, and its ADR-017 line-number citations, which
  PR-A's insertions shift) and the repository README's operations line —
  so the documented and implemented systems do not diverge. Until PR-B
  merges, the live Maintainer implementation remains the five read
  capabilities of ADR-017 rev 4 — a deliberate, temporary transition, not a
  documentation error.
- **PR-C:** blocked until PR-B is merged and all deployment-site
  evidence-preservation obligations are resolved. Adds the new forward-only
  DROP migration (five tables, per the migration strategy), with
  upgrade/journal checks and the pre-drop evidence-preservation gate, and
  converges remaining documentation and tests: removes the runbook §17
  P7-E2B drill-ledger recording step; gives the retained operator drill
  obligation and the deployment profile drills are measured against
  (currently stated only in the product-side RPO/RTO record that PR-B/PR-C
  delete) a home in deployment documentation, which does not exist today;
  updates the `retention_runs` reservations in current architecture
  documentation (`architecture/exam-system/data-authority.md` §13.3 and
  `architecture/exam-system/security-model.md` INV-CE-004/§15.6 declare the
  table reserved and NOT reused — both statements point at the dropped
  table once PR-C lands); and syncs the configuration-authority consumer
  index.
- #739 stays OPEN through PR-B and PR-C verification, then closes with a
  closeout comment.

---

## Consequences

- Stale-green false confidence is eliminated at its root: with no product
  ledger, a previously verified record can no longer outlive its artifact
  and render as green inside the product. Absence of backup evidence simply
  has no product representation at all.
- The Maintainer's health-diagnosis role stands on two capabilities
  (established in the Delta Review); the golden-doc capability freeze is
  deliberately re-baselined, prospectively.
- The roadmap's backup/DR direction-of-travel is split honestly: Exam-owned
  evidence capabilities are **declined**, not deferred; Host/operator DR
  obligations and their possible future hardening remain open outside the
  product.
- Historical evidence: the only reachable dev instance held zero rows in all
  five tables (G0-4); archive closeouts stay as history. Remote production
  hosts are confirmed — operator's deployment-site confirmation under the
  project-owner-owned PR-C gate — before PR-C drops the tables.
- The ADR-018 window contract survives its first removal: health/diagnostics
  remain its realized content, and any future window source must still pass
  the D2 invariants and a per-source decision.
