# P7 — FINAL PROGRAM CLOSEOUT

> **This document is the final authority for P7 closure.** It closes the P7
> hardening program truthfully, reconciles every P7 workstream and document,
> resolves Gate P7-3 with real executed evidence, moves ADR-017 revision 4 and
> ADR-018 to ACCEPTED, and migrates every legitimate deferred capability into
> GitHub Issues. After this document, GitHub Issues are the authority for
> executable future work; closed milestone documents are not an executable
> backlog.

## Executive verdict

```text
P7 — CLOSED (2026-08-14)
```

## Baseline

```text
BASE_SHA : d7dbebf1b8fe13909c7bcd0ca371398eea5552cc  (origin/master, PR #290 merged)
FINAL_SHA: d7ec9af4a466a09105be8b2d5e335b77b45d45d9  (commit carrying the full closeout)
DATE     : 2026-08-14
BRANCH   : feat/p7-final-program-closeout
```

## What P7 delivered

P7 (System Readiness and Exam Modes, Phase 3 hardening) turned the implemented
feature set into a coherent, recoverable, configurable, operator-visible
system:

- **State/authority hardening (P7-S1/S2, PR #269)** — whole-system state-machine
  and transition-owner audit; single-winner `publishResults`; `FUTURE_VERSION`
  wire reason; email at-least-once lease guard; read-only integrity diagnostics;
  crash matrix (6 flows, all ATOMIC_ROLLBACK); **no general startup reconciler**
  (evidence-based decision, Gate P7-1 PASS).
- **Redis bounded adoption (P7-D1/D2/D3, PR #265; ADR-001)** — measured decision
  gate ACCEPTED for ONE responsibility (shared/global rate limiting) with
  `off | optional | required` lifecycle. PostgreSQL remains the fact authority.
- **Portable persistence + backup + PostgreSQL DR (P7-C, PRs #270/#274)** —
  C0 durability reality audit; C1 portable bind-mounts + cold backup/restore +
  Launchpad; C2 logical `pg_dump -Fc` + verified clean restore; C3 physical
  `pg_basebackup` + `pg_verifybackup` + PostgreSQL-native PITR; six deterministic
  Docker drills under `tests/deployment/`.
- **Backup/restore/PITR (P7-C + P7-E2B)** — operator scripts under
  `scripts/backup/`; evidence ledger (`backup_runs` / `backup_run_events` /
  `restore_drill_runs`) with SUCCESS = artifact + readable + verified + durable
  commit; evidence CLI (`backup-evidence.js`).
- **Operational control plane (P7-E, PR #282)** — E2A Maintainer RBAC boundary
  (5 read-only capabilities, zero business permissions, Admin ↔ Maintainer
  mutual exclusion D14 transactionally enforced), E2B backup evidence ledger,
  E2C Admin/Maintainer operations views, E3 operational policy intent
  (`backup_operational_policy`: desired RPO/retention/drill cadence; CAS +
  audit; DESIRED vs OBSERVED vs STATUS). Decision-gated capabilities
  (`backup.trigger` / `backup.schedule.manage` / `backup.retention.manage` /
  `service.restart`) recorded NO-GO / host-owned
  (`P7-E3-DECISION-GATES.md`).
- **RBAC role-reality remediation (PR #284)** — F-01/F-02/F-03/F-05/F-07/F-08/
  F-09 FIXED; F-06/F-10/F-11 ACCEPTED; **F-04 (Teacher@Course) confirmed and
  explicitly deferred** to the dedicated scoped-RBAC milestone, durably
  tracked by issue #286 (reopened by this closeout).
- **Operational authority separation (P7-E1, PR #281; ADR-017)** — Admin =
  business authority; Application Maintainer = read-only Operational Observer
  ("Exam gives the Maintainer a window, not a hand"); Host Maintainer =
  infrastructure execution authority outside Exam RBAC. **ADR-017 revision 4
  ACCEPTED by this closeout.**
- **Operational observability window (ADR-018)** — read-only / redacted /
  domain-separated / bounded / source-aware / truthful contract for runtime
  data; no observability platform introduced. **ADR-018 ACCEPTED by this
  closeout.**
- **Configurable exam policy profiles (P7-M1/M2/M, PRs #277/#278/#279)** —
  canonical conflict validator; organization-owned profiles copy-on-apply into
  typed Exam columns; two truthful starter recipes (`basic_quiz`,
  `standard_online`); profile UI + 5-step exam wizard (multimodal visual review
  by P7-F: 0 blocking defects, 0px overflow at 390px). Controlled/Strict
  deferred to their owning subsystems (issues).
- **Final readiness closeout (P7-F, PR #288)** — release-gate audit of all of
  P7-0…P7-6; `pnpm verify` green; CI 9/9; verdict then was P7-F COMPLETE,
  P7 REMAINS OPEN on Gate P7-3 (RTO + retention) + human decisions. This
  document resolves those remaining items.
- **RTO + retention mechanism (P7-CLOSE, PR #290)** — typed nullable
  `desired_rto_seconds` authority (30s..48h) measured against automated
  restore-drill evidence; retention evidence ledger (`retention_runs` +
  success↔verified DB CHECK), retention-readiness endpoint, and the host-side
  pgBackRest retention script (`scripts/backup/pgbackrest-retain.sh`), keeping
  execution host-only (ADR-017 D4). Gate P7-3's remaining acceptance is
  resolved in §Gate P7-3 acceptance record below.
- **Final UI / readiness validation** — the P7-F multimodal visual review
  (11 screenshots, 3 viewports, deterministic overflow measurement) plus the
  residual UI migration debt now owned by issues (#305–#308).

## Gate matrix — final dispositions

| Gate | Final disposition | Evidence |
| --- | --- | --- |
| P7-0 — Truthful plan | ✅ PASS | Roadmap/status/closeout documents reconcile with master; M11 meaning preserved; `text_response` no longer listed as open; this closeout completes the reconciliation (P7-R0). |
| P7-1 — Recoverable authority | ✅ PASS | P7-S2 (PR #269): one command owner per irreversible transition, idempotency + crash matrices; general startup reconciler deliberately not built (evidence-based); targeted reconciliation exists (heartbeat scanner, email abandoned-lock recovery). |
| P7-2 — Redis decision recorded; approved responsibilities real | ✅ PASS | P7-D1 decision ACCEPTED in ADR-001 (2026-08-08); shared rate limiter (P7-D2/D3, PR #265) has a real business caller, failure policy, and tests; further responsibilities remain decision-gated. |
| P7-3 — Restore is proven | ✅ PASS (revised semantics — see §Gate P7-3 acceptance record) | Software acceptance PASS: typed RPO/RTO authority, retention mechanism + evidence ledger + host automation path, deterministic clean-volume restore drill **executed 2026-08-14 (twice, both PASS)** with measured total drill duration **87 s ≤ declared RTO 3600 s**, post-restore invariant suite green. Deployment-site acceptance (real pgBackRest retention on the production volume) is an explicit operational runbook obligation, not an unfinished feature. |
| P7-4 — Configuration is controlled | ✅ PASS | P7-E0 audit (no generic settings subsystem justified) + P7-E (E2A/E2B/E2C/E3): typed/versioned/audited operational policy intent; secrets env/Compose-only; snapshots freeze active exam behavior. |
| P7-5 — Exam profiles are coherent | ✅ PASS | P7-M (PRs #277/#279): `basic_quiz`/`standard_online` resolve to one policy schema; conflict validation before publish; profile edits do not mutate published exams; API + browser E2E proof; Controlled/Strict excluded from the gate until their owning subsystems land (issues #293/#292/#294/#295). |
| P7-6 — UI closeout | ✅ PASS | Exam-profile UI + wizard closed with P7-M (visual review by P7-F); operations/backup/restore-readiness surfaces shipped with P7-E; residual UI migration debt is issue-owned (#305–#308) and no longer part of P7's completion path. |

**No gate is `pending`, `NOT PASS`, or `HUMAN_DECISION_REQUIRED` in the final
state. The P7-F/P7-CLOSE documents that recorded those earlier verdicts are
historical evidence and are superseded by this document (see §Supersession
pointers).**

## Gate P7-3 acceptance record

The P7-CLOSE closeout (PR #290) implemented both Gate P7-3 mechanisms and left
the verdict `IMPLEMENTED — OPERATIONAL_ACCEPTANCE_PENDING` because the last
clause — "clean-volume restore completing within the declared RTO" — is an
operational acceptance on a real volume. This closeout performs the closest
legitimate operational acceptance available in the repository's deterministic
deployment environment and explicitly splits the remainder as a deployment-site
obligation.

### Executed acceptance (2026-08-14, real runs)

| Item | Value |
| --- | --- |
| Declared RTO | **3600 s (1 h)** — the "Standard operation" profile from the P7 planning frame (RPO 1h / RTO 1h). Recorded as `desired_rto_seconds = 3600` capability of the typed authority (range 30 s..48 h). |
| Test dataset / representative volume | Deterministic isolated deployment: fresh `EXAM_DATA_ROOT`, first-Admin bootstrap, State-A marker + business invariants (orgs=1, admins=1, admin.bootstrap audit=1) — the repository's canonical representative volume (small; production-volume sizing is deployment-site). |
| Restore method | C2 logical: online `pg_dump -Fc` (State A) → mutate source to State B → stop API/worker → clean-target restore (`DROP DATABASE` + `template0` + `pg_restore --no-owner --exit-on-error`) → restart API. |
| Restore start / end timestamps | Run 2 (timed): start epoch `1786692494` (2026-08-14), end epoch `1786692581`. |
| Measured duration | **87 s total drill wall time** (deployment boot + bootstrap + backup + restore + restart + invariant verification). The restore step itself is a subset; the total is a conservative upper bound. |
| Measured ≤ declared RTO | ✅ 87 s ≤ 3600 s (both executed runs PASS; run 1 and run 2 identical outcomes). |
| Post-restore invariants | ✅ Marker A present, marker B ABSENT (exact logical replacement); orgs=1 / admins=1 / audit=1 restored; restored Admin row present with password hash. |
| Retention policy actually used | Not executable in this environment: pgBackRest is **not installed** here and no production pgBackRest repository exists. The host-side mechanism (`scripts/backup/pgbackrest-retain.sh`, evidence ledger, success↔verified invariant, retention-readiness endpoint) is implemented and tested; **execution is a deployment-site obligation**. |
| Retention evidence | Mechanism-level evidence: `retention_runs` ledger + `GET /system/retention-readiness` + CLI instrumentation, covered by the API/db test suites (green). Real scheduled-run evidence must be produced at the deployment site. |
| Limitations of the environment | (1) No pgBackRest on the host → no real `expire` run; (2) test volume is small → the 87 s figure is representative of the deterministic volume, not a production-sized guarantee; (3) restore drills were executed twice (both PASS) against throwaway Compose projects; no human/dev database was touched. |

### Verdict — software acceptance vs deployment-site acceptance

```text
software acceptance    = PASS      (this closeout; evidence above)
deployment-site acceptance = external operator responsibility (runbook)
```

P7's supported product boundary is: the product records **evidence**, never
**enforces** infrastructure (ADR-017 D4; P7-E3 decision record). Under that
boundary, "restore is proven" splits into:

1. **Software acceptance (product responsibility) — PASS.** Typed RTO/RPO
   authority, retention mechanism + evidence surface, and a deterministic
   clean-volume restore drill whose measured duration satisfies a declared RTO
   with the post-restore invariant suite green. This is the product's side of
   the contract and it is now evidenced by real execution, not only unit tests.
2. **Deployment-site acceptance (deployment responsibility) — a runbook
   obligation, not an unfinished feature.** The deployment operator must, at
   install time and on the production volume: install pgBackRest, configure
   `repo*-retention-*` knobs, schedule `scripts/backup/pgbackrest-retain.sh`
   (cron/systemd), schedule recurring restore drills, and record evidence via
   the shipped CLI (`backup-evidence.js`). This obligation is documented in
   [`docs/deployment/backup-and-recovery.md`](../deployment/backup-and-recovery.md)
   §Deployment-site acceptance and does not block P7 closure.

Gate P7-3's semantics are **explicitly revised by this human-reviewable
decision document**: the gate's operational-acceptance clause is
deployment-site scope by design. The repository no longer says both "P7 CLOSED"
and "P7-3 NOT PASS"; it says "P7-3 PASS (software acceptance evidenced;
deployment-site acceptance = runbook obligation)".

## Workstream disposition matrix

Every P7 item ever mentioned in canonical documents receives exactly one final
disposition. **There are zero unclassified items.**

| Workstream / item | Final disposition | Follow-up |
| --- | --- | --- |
| P7-R0 — reality + documentation reconciliation | CLOSED_IMPLEMENTED | Post-MVP repository hygiene (2026-08-09) + this closeout |
| P7-S1 — state-machine and authority audit | CLOSED_IMPLEMENTED | P7-S2, PR #269 |
| P7-S2 — runtime authority hardening / crash evidence | CLOSED_IMPLEMENTED | PR #269 |
| P7-RC1 — crash recovery / startup reconciliation | CLOSED_BY_DECISION | No general startup reconciler (evidence-based; Gate P7-1 PASS). Reachable partial states are handled by existing scanners/commands (heartbeat, deadline, email abandoned-lock recovery). |
| P7-D1 — Redis adoption decision gate | CLOSED_IMPLEMENTED | Decision ACCEPTED 2026-08-08, recorded in ADR-001 |
| P7-D2 — Redis lifecycle hardening | CLOSED_IMPLEMENTED | PR #265 |
| P7-D3 — global Redis-backed rate limit | CLOSED_IMPLEMENTED | PR #265 |
| P7-Q1 — admission queue state-machine design | DEFERRED_TO_ISSUE | Issue #292 (admission queue) |
| P7-Q2 — Redis-backed admission queue | DECISION_GATED | Issue #292 + ADR-001 (separate decision required) |
| P7-P1 — presence / live operational projection | DECISION_GATED | ADR-001 (no measured trigger) |
| P7-B1..B4 — original backup framing (design / CLI / PITR-retention / Admin surface) | SUPERSEDED | Rebuilt as P7-C0–C3 (shipped) + P7-E2B/E3 + P7-CLOSE; Admin backup surface is OUT of scope by decision (restore operator-owned) |
| P7-C0 — durability/persistence reality audit | CLOSED_IMPLEMENTED | PR #270 |
| P7-C1 — portable persistence + cold backup + Launchpad | CLOSED_IMPLEMENTED | P7-C REBUILD (PR #274); original PR #273 superseded |
| P7-C2 — logical backup + verified clean restore | CLOSED_IMPLEMENTED | Deterministic drill; re-executed 2026-08-14 (PASS) |
| P7-C3 — physical backup + WAL + PITR | CLOSED_IMPLEMENTED | `pitr.sh` drill (P7-C closeout) |
| P7-C — portable backup/DR program | CLOSED_IMPLEMENTED | Closeout: `P7-C-PORTABLE-BACKUP-RECOVERY-CLOSEOUT.md` |
| P7-E0 — configuration reality audit | CLOSED_IMPLEMENTED | PR #276; verdict: no generic settings subsystem |
| P7-E1 — operational authority / Maintainer boundary | CLOSED_IMPLEMENTED | PR #281; ADR-017 rev 3 → rev 4 ACCEPTED here |
| P7-E2A — Maintainer RBAC boundary + mutual exclusion | CLOSED_IMPLEMENTED | PR #282 (ADR-017 D14, D7, D8) |
| P7-E2B — backup evidence ledger | CLOSED_IMPLEMENTED | PR #282 + P7-CLOSE retention ledger |
| P7-E2C — Admin/Maintainer operations views | CLOSED_IMPLEMENTED | PR #282 |
| P7-E3 — operational policy intent + decision gates | CLOSED_IMPLEMENTED | PR #282; decision-gated capabilities recorded NO-GO (P7-E3-DECISION-GATES.md) |
| P7-E — operational control plane program | CLOSED_IMPLEMENTED | Closeout: `P7-E-OPERATIONAL-CONTROL-PLANE-CLOSEOUT.md` |
| P7-M1 — exam policy authority + conflict validator | CLOSED_IMPLEMENTED | PR #277 |
| P7-M2 — profile templates + authoring-time resolution | CLOSED_IMPLEMENTED | PR #278 |
| P7-M — configurable exam modes | CLOSED_IMPLEMENTED | PR #279 + P7-F visual review (2026-08-13) |
| P7-U1 — UI pilot migration | DEFERRED_TO_ISSUE | Issue #305 (UI design-system migration; pilot sequencing preserved) |
| P7-U2+ — family-by-family UI closeout | DEFERRED_TO_ISSUE | Issues #305/#306/#307/#308 |
| P7-F — final readiness / release-gate closeout | CLOSED_IMPLEMENTED | PR #288 (2026-08-13); its open items resolved by this closeout |
| P7-CLOSE — RTO + retention mechanism | CLOSED_IMPLEMENTED | PR #290 (2026-08-13); operational acceptance resolved in §Gate P7-3 acceptance record |
| P7-RBAC role-reality remediation | CLOSED_IMPLEMENTED | PR #284 (2026-08-13); F-04 → issue #286 (reopened) |
| Gate P7-0 | ✅ PASS | — |
| Gate P7-1 | ✅ PASS | — |
| Gate P7-2 | ✅ PASS | — |
| Gate P7-3 | ✅ PASS (revised semantics) | §Gate P7-3 acceptance record |
| Gate P7-4 | ✅ PASS | — |
| Gate P7-5 | ✅ PASS | Controlled/Strict deferred to issues #293/#292/#294/#295 |
| Gate P7-6 | ✅ PASS | Residual UI debt → issues #305/#306/#307/#308 |

## Deferred-work matrix

Every significant capability intentionally not implemented by P7 has an
owning Issue. No deferred item remains buried in P7 prose as an unfinished
checkbox.

| Capability | Why not in P7 | New owner |
| --- | --- | --- |
| `timed_sync` / `deadline` / `untimed` timing modes | Product feature beyond the `timed_window` gate subset | Issue #291 |
| Operational admission queue (`requireQueue`) | Needs its own admission state machine; Redis backing decision-gated (ADR-001) | Issue #292 |
| Controlled / Strict high-assurance exam profiles | Depend on admission/device/identity subsystems that do not exist yet; truthfulness gate forbids faking them | Issue #293 |
| Question/option randomization | Orthogonal policy dimension, independently closable | Issue #294 |
| Managed desktop lockdown client | Separate platform workstream (ADR-004) | Issue #295 |
| Teacher@Course scoped authority | F-04 confirmed + explicitly deferred to the scoped-RBAC milestone; P7 makes no isolation claim | Issue #286 (reopened) |
| Grader@Exam scoped authority + assignment flow | M11 Grader slice; needs scope carrier + resolver + UI | Issue #296 |
| Staff invitation / SMTP password reset / account lifecycle | Phase 3 identity lifecycle, never started | Issue #297 |
| Permission registry + permission audit + audit-log search/export UI | Phase 3 visibility surfaces, never started | Issue #298 |
| Additional operational notifications (P5-N2) | Event-by-event expansion beyond `result_published` | Issue #299 |
| Email template engine + backend i18n | Deferred from P5-N1 | Issue #300 |
| Rich-text / WYSIWYG authoring and answering | Answer-authority feature beyond the closed plain-text loop | Issue #301 |
| Generic final-answer submit barrier (ADR-008 Option D) | Answer-type-independent follow-up to the Phase 2 conservative barrier | Issue #302 |
| Proctor Recovery Center (REC-OPS J6) | Proctor product activation milestone | Issue #303 |
| System-generated incidents | Distinct System-actor command; deliberately disabled in J3 | Issue #304 |
| UI design-system migration (full UI migration) | Non-blocking product-quality work (UI-PILOT-1 / UI-MIGRATE-N) | Issue #305 |
| Responsive + mobile closeout | Non-blocking product-quality work | Issue #306 |
| Accessibility closeout (product-wide baseline) | Non-blocking product-quality work | Issue #307 |
| Long-text answer + metadata/definition-list components | Unowned UI roles | Issue #308 |
| Phase 4 — pass-to-proceed + service tokens/API keys | Phase 4 platformization, kept Phase 4 | Issue #309 |
| Phase 4 — webhooks | Phase 4 platformization, kept Phase 4 | Issue #310 |
| Phase 4 — optional multiTenant / SuperAdmin / tenant hierarchy | Phase 4 platformization, kept Phase 4 | Issue #311 |
| Phase 4 — external log shipping (syslog/OTLP) | Phase 4; ADR-018 anti-goals exclude in-product backends | Issue #312 |
| Phase 4 — custom roles from the capability catalog | ADR-010 assigns custom roles to Phase 4 | Issue #313 |
| Remaining i18n page-level admin form/modal copy | Small UI-copy cleanup | Folded into Issue #305 |

## Explicitly rejected / unnecessary work

These decisions are frozen so future agents do not resurrect them:

```text
generic startup reconciler          — not required by reachable runtime state
                                      (Gate P7-1 PASS, evidence-based; P7-S2)
generic settings registry           — rejected (P7-E0 verdict)
product-side backup scheduler       — rejected (P7-E3 NO-GO; host cron/scripts
                                      are the execution authority)
product-side retention engine       — rejected (host-side pgBackRest path chosen)
browser-triggered restore           — rejected (ADR-017 D4; restore is
                                      operator-owned, permanently)
product-side infrastructure control — rejected (ADR-017 D4)
Admin backup button / restore UI    — rejected (restore operator-owned)
forced Redis expansion              — rejected (P7-D1: one bounded
                                      responsibility; others decision-gated)
generic observability platform      — rejected (ADR-018 anti-goals)
Loki / Elasticsearch / ClickHouse / OpenTelemetry deployment in-product
                                    — rejected (ADR-018 anti-goals; optional
                                      external log shipping is Phase 4, #312)
single `mode` enum collapse         — rejected (policy profiles over one engine)
```

## ADR resolutions

| ADR | Status after closeout | Note |
| --- | --- | --- |
| ADR-001 (Redis, "Post-MVP Decision (P7)") | ACCEPTED (unchanged) | P7-D1 decision record; further responsibilities decision-gated |
| ADR-017 (Operational Authority and Maintainer Boundary) | **ACCEPTED through revision 4** | Accepted by this closeout after the runtime boundary check: Maintainer surfaces cannot trigger restore/retention, restart services, edit secrets, mutate business data, or access candidate answers/grades through operational permissions (5 read-only capabilities; zero business/write permissions; D14 enforced on every assignment path; diagnostics domain split D8; `system.email.test` split D7). Code matches the rev-4 model. |
| ADR-018 (Operational Observability Window) | **ACCEPTED** | Accepted by this closeout; the current `/system/*` surfaces already realize the window contract (read-only, redacted, domain-separated, bounded, source-aware, truthful). |
| ADR-008, ADR-013, ADR-014, ADR-015, ADR-016 | ACCEPTED (unchanged) | No P7 item changes them; ADR-008 Option D is issue #302. |

## Issue reconciliation

- **Issues created (23):** #291–#313 (see Deferred-work matrix).
- **Issue reopened (1):** #286 — Teacher@Course scoped authority (F-04),
  reopened as the durable scoped-RBAC tracker with a recorded closure
  clarification; P7 closure makes no Teacher-isolation claim.
- **Issues reused (0).** Existing open issues #64/#182/#258/#272 are unrelated
  pre-existing items and remain open.
- **Issues deliberately NOT created:** generic startup reconciler,
  generic settings registry, browser restore, product-side scheduler/retention
  engine, Redis presence/streams/PubSub/worker expansion, observability
  platform, microscopic UI items (consolidated into #305–#308), and all other
  explicitly rejected work above. Rejected ideas get no Issues.

## Future-work rule

> **After P7 closure, future product capability is tracked through GitHub
> Issues. Closed milestone documents are not an executable backlog.**

```text
Current behavior            → docs/status/implementation-status.md
Architecture / decisions    → docs/architecture + docs/adr
High-level product direction→ docs/roadmap (current.md, phase-roadmap.md)
Executable future work      → GitHub Issues (indexed in docs/roadmap/post-mvp-issues.md)
Historical milestone evidence→ docs/audits
```

A roadmap may summarize an Issue but must not duplicate a separate detailed
specification that can drift. **No Issue = not scheduled work.**

## Supersession pointers

Earlier documents remain historical evidence; their interim verdicts are
superseded by this document:

- `P7-F-FINAL-SYSTEM-READINESS-CLOSEOUT.md` — "P7-F COMPLETE — P7 REMAINS OPEN"
  and "P7-3 NOT PASS — HUMAN_DECISION_REQUIRED" were true on 2026-08-13;
  superseded here (Gate P7-3 PASS under revised semantics; ADR-017 rev4 /
  ADR-018 ACCEPTED; #286 clarified by reopening).
- `P7-CLOSE-RTO-RETENTION-CLOSEOUT.md` — "IMPLEMENTED —
  OPERATIONAL_ACCEPTANCE_PENDING (NOT PASS)" was true on 2026-08-13; the
  acceptance is resolved in §Gate P7-3 acceptance record.
- `P7-E-OPERATIONAL-CONTROL-PLANE-CLOSEOUT.md` / `P7-RBAC-ROLE-REMEDIATION.md`
  / `P7-C-PORTABLE-BACKUP-RECOVERY-CLOSEOUT.md` — "READY FOR HUMAN REVIEW"
  verdicts were superseded by P7-F (2026-08-13) and finally by this document.
- `docs/roadmap/P7-system-readiness-and-exam-modes.md` — the "Current status"
  overlay is replaced by the STATUS: CLOSED header + this document.

## Verification

Executed as part of this closeout:

```text
restore drill (logical-backup-restore.sh)  : run twice, both PASS (87 s measured)
pnpm verify (full)                         : PASS (exit 0) — static gates
                                             (format/lint/code-quality/copy/arch/
                                             eslint/typecheck/openapi) green;
                                             coverage phase 16/16 tasks; build 9/9
```

The full static gates and the test suites are green on the closeout commit
(`d7ec9af4`); no code changed in this closeout — the changeset is
documentation + Issue governance only.
