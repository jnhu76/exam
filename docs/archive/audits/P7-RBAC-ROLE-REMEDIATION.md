# P7 RBAC Role / Authority Remediation

> **Superseded (2026-08-14):** the "READY FOR HUMAN REVIEW" status below was
> superseded by P7-F (2026-08-13) and finally by the
> [`P7-FINAL-PROGRAM-CLOSEOUT.md`](P7-FINAL-PROGRAM-CLOSEOUT.md) (P7 CLOSED;
> ADR-017 rev 4 ACCEPTED; F-04 durably tracked by issue #286, reopened). The
> remediation record remains accurate.

Post-P7-E Admin-authority and Maintainer-observability-boundary remediation,
driven by [`docs/audits/P7-RBAC-ROLE-REALITY-AUDIT.md`](./P7-RBAC-ROLE-REALITY-AUDIT.md)
(Issue #283).

```text
P7 RBAC REMEDIATION

Baseline SHA:  8a2c9edf6787382f73c0b03e4e05d7afa600e569  (master, PR #282 / P7-E merged)
Audit branch:  audit/p7-rbac-role-reality-audit (259afda7 — the reality audit doc)
Remediation:   fix/p7-rbac-admin-authority-maintainer-observability
Date:          2026-08-13

Authority precedence (applied):
  human-approved correction in this task
  > ADR-017 revisions 1–3 (ACCEPTED — authoritative until rev 4 is accepted)
  > ADR-017 revision 4 (PROPOSED — governs only after human acceptance)
  > ADR-010 (as amended)
  > code reality
  > old roadmap prose
```

---

## 1. Authority model (corrected, frozen)

```text
Admin          = 考试管理员  = Exam Administrator
                              = business authority + application-settings authority
                              + reliability-objective authority
                              = NEVER infrastructure execution

Maintainer     = 系统运维    = System Operations Observer
                              = read-only operational observability identity
                              (a window, not a hand)

System         = synthetic non-human actor (produces / evaluates runtime evidence)

Host Operator  = real infrastructure execution identity = NOT Exam RBAC
                 (SSH / Docker / PostgreSQL / WAL / backup / restore / PITR /
                  filesystem / secrets / systemd — granted by host/CLI access)

Configurer     = DOES NOT EXIST
```

Core principle: **Exam → Maintainer is an observability window, NOT an
infrastructure control console.** VIEW / SEARCH / FILTER / CORRELATE / DIAGNOSE
≠ MUTATE / EXECUTE / CONFIGURE / RESTART / RESTORE.

There is **no** Configurer / Configuration-Manager / System-Administrator /
Ops-Admin / Backup-Admin / Platform-Admin persona. Configuration ownership is
a resource-authority question, classified:

| Category | Owner |
| --- | --- |
| A. Exam business configuration (exam duration, question policy, branding, settings) | Admin |
| B. Reliability objectives / desired outcomes (desired RPO, retention, drill cadence) | Admin (intent only — never binds infrastructure) |
| C. Infrastructure / runtime configuration (cron, postgres.conf, backup destination, WAL, Docker, secrets) | Host Operator — outside Exam RBAC |

---

## 2. ADR-017 — revision 4 (PROPOSED)

* **Revision:** 4
* **Status:** **ACCEPTED through revision 3** (PR #281). **Revision 4:
  PROPOSED** (2026-08-13 — awaiting human review).
* **What rev 4 changes:**
  * Application Maintainer: **viewer/controller → read-only Operational
    Observer** (R4-2; D2 pointer added).
  * "Configurer does not exist" stated explicitly + 3-category config
    classification (R4-3).
  * Operational policy reframed as **reliability objective** (R4-4; D9). UI
    copy 运维策略意图 → **可靠性目标**. Persistence names unchanged (semantic
    reframe only, no migration churn).
  * D5 default stance **tightened** — `backup.trigger` / schedule / retention /
    `service.restart` are **NOT part of the current Maintainer model**; each
    requires a future independent ADR (R4-5; D5 pointer added).
  * F-04 (Teacher scope) recorded as CONFIRMED / EXPLICITLY DEFERRED (R4-8).
  * Cross-reference to ADR-018 (observability window) (R4-9).
* **What rev 4 does NOT change:** D1 (Admin business owner, no infra exec), D4
  (restore/PITR/PGDATA/raw-secret permanently excluded), D12 (host authority ⇏
  Maintainer identity), D14 (Admin ∩ Maintainer = ∅), the System synthetic
  actor.

### New ADR-018 — Operational Observability Window (PROPOSED)

Defines the read-only product boundary future runtime data plugs into. Six
invariants every future source must satisfy: **read-only, redacted,
domain-separated, bounded, source-aware, truthful.** Semantic taxonomy kept
distinct: **Metrics / Logs / Events / Materials** (no premature unified store).
Correlation allowed only with server-side redaction (an operational Maintainer
must not auto-receive business-domain detail). Anti-goals: no Loki/Elastic/
ClickHouse/OTel/log-shipping/plugin-framework/shell-console/backup-or-restore
button now. Per-source ADR required (D7).

---

## 3. Issue #283 — finding dispositions

| ID | Finding | Severity | Disposition | Evidence |
| --- | --- | --- | --- | --- |
| **F-01** | Frontend role-catalog duplicated (`EDITABLE_ROLES`); `/roles/assignable` unused | P2 | **FIXED** | `UsersPage.tsx` now fetches `GET /roles/assignable` and derives the selector from it; `EDITABLE_ROLES` deleted. Tests: `UsersPage.test.tsx` (catalog-authority test added — selector reflects exactly what the API returns). |
| **F-02** | OpenAPI `x-role` drift on `/system/health` + `/system/diagnostics` | P2 | **FIXED** | `system.ts` x-role corrected to `["Admin","Maintainer"]` on both. Structural guard added: `openapi.structural.test.ts` asserts Maintainer parity for all 5 Maintainer-readable routes. |
| **F-03** | User list role-filtered to `["Admin","Candidate","Maintainer"]`; Teacher/Proctor/Grader invisible; Candidate volume could crowd staff out of pagination | P2 | **FIXED** | `GET /users` now uses assignment-aware **staff** filtering in the repository, BEFORE pagination: staff membership = an ACTIVE assignment with any of the six assignable roles except Candidate, OR a stale staff-valued `users.role` cache (zero-primary fallback, F-06). Candidate-only users never enter the staff list nor its `total`/`totalPages`; Candidate-primary + staff-secondary users stay visible exactly once. The frontend renders the list as-is (no post-filter). Tests: `user.test.ts` — legacy-role exclusion + 4 adversarial cases (Candidate crowd-out / dual-role visibility / Candidate-only absence / Proctor+Grader+Maintainer+stale-role visibility). |
| **F-04** | Teacher `defaultScope: Course` declared but not enforced (org-wide reach) | P2 | **CONFIRMED / EXPLICITLY DEFERRED** to a dedicated scoped-RBAC milestone | Target model remains Teacher@Course. Misleading preset comments corrected (target vs current org-wide reality vs missing infra). Characterization test `teacherScopeCharacterization.test.ts` proves the current org-wide LIST/detail reach. **P7-F is NOT globally blocked, but P7-F MUST NOT claim or depend on Teacher course isolation** until the milestone closes F-04. Closure requirements listed in §4. |
| **F-05** | Dual Admin+Maintainer not re-checked on the per-request (already-issued-JWT) path | P3 | **FIXED (defense-in-depth)** | D14 now enforced in `deriveAssignmentAuthority` (the single chokepoint login + authenticate traverse). New reason `dual_admin_maintainer`. Login audit relocated to the `!ok` branch. Tests: 5 kernel cases + an "already-issued JWT denied on next request" runtime test. |
| **F-06** | `users.role` goes stale when the last active primary is removed | P3 | **ACCEPTED (documented)** | Cosmetic only; never authorizes (assignments are the source). `users.role` is `NOT NULL` and list-serialized via `AssignableRoleSchema`, so a clean "clear" needs a list-schema change — out of scope for a P3. Documented precisely in `roleSync.ts`. |
| **F-07** | Stale comment referencing nonexistent `/system/operational-diagnostics` route | P3 | **FIXED** | `system.ts` docstring corrected (D8 split is a field-level projection inside `/system/diagnostics`, not a second route). |
| **F-08** | Maintainer sees a stray "管理" nav group with one item (系统监控) | P3 | **FIXED** | `SystemHealthView` removed from `MANAGEMENT_SURFACE_PERMS` (it is operational, held by Admin + Maintainer) → 管理 group is Admin-only. 系统监控 moved into the 运维 group (Maintainer keeps diagnostics nav). Tests: `capabilities.test.ts` (Maintainer added to landing + management tables), E2E `operations.spec.ts` (管理 group absent + 系统监控 present for Maintainer). |
| **F-09** | `isAdmin(user)` UX gate on the extend-time button | P3 | **FIXED** | `ProctorDashboardPage.tsx` switched to `can(user, Permission.AttemptTimeGrant)`. Test fixture updated to carry the Admin preset capabilities. |
| **F-10** | Duplicated closed role enums across packages | P3 | **ACCEPTED (monitored)** | Structural (db↔contracts blocked by dependency layering). All duplicates fail loudly on drift (CHECK / unknown-role fail-closed). No change. |
| **F-11** | `users.role` has no DB CHECK; backfill skips non-assignable roles | P3 | **ACCEPTED (fail-closed design)** | A garbage `users.role` cannot widen authority (assignments are the source); backfill skip is documented fail-closed. No change. |

**Step 9 (role-check vs capability-check audit):** re-run. No unsafe role-based
authorization residue remains. `isAdmin`/`isCandidate` survive only as
documented non-authoritative shell-classification helpers (`capabilities.ts`);
`requireRole` survives only as the conformance test's negative-control seam (0
production consumers); `users.role` is a compatibility cache (never read by any
gate). Retained exceptions: bootstrap / compatibility projection / display /
telemetry / migration / seed — each documented. The `a.role === "Proctor"` hit
in `proctorAssignments.admin.ts` is a post-gate data filter, not an authz
decision.

---

## 4. F-04 — dedicated scoped-RBAC milestone closure requirements

F-04 is an **explicit architectural deferral**, not a silent sweep and not a
redefinition of the Teacher authority model (target stays Teacher@Course). The
future milestone that closes F-04 must deliver:

- a persisted **Teacher↔Course scope/assignment carrier** (schema + migration);
  `user_role_assignments` has no scope/resource columns today;
- a **course / question scope resolver family** (none exist — only
  attempt/examEligibility/incident/score do);
- `requireScopedCapability` on the relevant course/question/exam routes (today
  all use flat `requireCapability` with organization scope);
- **LIST-route scope filtering** (GET /courses, /questions, /exams return
  org-wide sets today);
- create/update **cross-course enforcement** + assignment API/UI;
- **cross-course adversarial tests** (Teacher@courseA allowed course-A
  resources → denied course-B resources).

P7-F is **not globally blocked** by F-04, but any P7-F work that requires
Teacher@Course enforcement is blocked until this milestone closes it. Durable
tracking: **issue #286 — Enforce Teacher@Course scoped authority (F-04)**
(closure requirements above + dependency rule).

---

## 5. Maintainer permissions (frozen)

```text
reads (5):  system.health.view · system.diagnostics.view · system.backup.view
            · system.restore_readiness.view · system.ops.policy.view
writes:        0
business perms: 0
```

The business-integrity diagnostics block (`system.business_integrity.view`) is
**Admin-only** and server-side projected out of the Maintainer's diagnostics
response (ADR-017 D8, unchanged). `POST /email/test` is gated by
`system.email.test` (Admin-only; D7 — view capability does not authorize side
effect). Maintainer mutation denial is covered by `operationalBoundary.test.ts`
(users/candidates/courses/questions/exams/grading/scores/settings/incidents/
proctor-assignments/recovery all 403; force-submit / time-grant / misconduct /
result-publish / email-test all 403).

---

## 6. Alignment summary

| Concern | State |
| --- | --- |
| Frontend/backend role catalog | `EDITABLE_ROLES` deleted; selector driven by `GET /roles/assignable` (F-01) |
| OpenAPI alignment | 5/5 Maintainer-readable routes declare `[Admin, Maintainer]`; structural guard added (F-02) |
| Teacher scope | CONFIRMED gap, explicitly deferred to scoped-RBAC milestone; characterization test pins current org-wide reality (F-04) |
| Admin/Maintainer exclusion | D14 enforced in the authority kernel (chokepoint) + login + every mutation path; JWT-window closed (F-05) |
| Naming/UI | Admin → 考试管理员, Maintainer → 系统运维, ops-policy → 可靠性目标 (F-16) |

---

## 7. Infrastructure execution inside Exam

```text
NONE.
```

Restore / PITR / PGDATA / raw-secret / raw-host / shell execution remain
permanently outside the ordinary browser control plane (ADR-017 D4). No backup
trigger, no restore button, no restart button, no secret editor, no shell
console was introduced. The Maintainer window is a view, not a control console
(ADR-018).

---

## 8. Observability window

* **Current data (today):** health, operational diagnostics (with Admin-only
  business-integrity projection), backup evidence, restore-readiness drill
  evidence, ops-policy reliability objective + DESIRED-vs-OBSERVED compliance.
* **Future Metrics / Logs / Events / Materials:** contract defined in ADR-018
  (read-only / redacted / domain-separated / bounded / source-aware /
  truthful); per-source ADR required; no backend introduced now.

---

## 9. Tests — completion evidence

```text
Baseline SHA:     8a2c9edf6787382f73c0b03e4e05d7afa600e569 (master)
Start head SHA:   0e98ff943a20a82a192288ec273a1cf8e2c90362 (PR #284 head at review start)
Final head SHA:   ae62f9f3 (fix/p7-rbac-admin-authority-maintainer-observability)
Date:             2026-08-13 (review-remediation round)
```

```text
authz:      10 files, 79 tests    — PASS
db:         42 files, 566 tests   — PASS
api:        163 files, 2190 tests (7 skipped) — PASS
web:        116 files, 1634 tests — PASS
typecheck:  17/17 tasks           — PASS
lint:       format / code-quality / copy / arch / ui-guards / eslint — PASS
build:      9/9 tasks             — PASS
coverage (v8): authz 100.00 stmts · db 80.82 · api 84.25 · web 80.98
e2e (WSL run-wsl.sh, 2 shards):   — PASS (exit 0; shard-0 + shard-1 passed, 0 failed)
pnpm verify:                      — PASS (run at final head)
```

New/updated tests added: F-01 catalog authority (`UsersPage.test.tsx`), F-02
Maintainer-parity structural (`openapi.structural.test.ts`), F-03 list
visibility + **4 adversarial staff-list cases** (Candidate crowd-out,
Candidate-primary + Teacher-secondary exactly-once, Candidate-only absence,
Proctor+Grader+Maintainer+stale-role — `user.test.ts`), F-04 org-wide
characterization (claim limited to the tested course endpoints —
`teacherScopeCharacterization.test.ts`), F-05 dual-role kernel + JWT-window
runtime (`assignmentAuthority.test.ts`, `operationalBoundary.test.ts`),
F-08 nav IA (`capabilities.test.ts`, E2E `operations.spec.ts`), F-09
capability gate positive + **negative** (button absent without
`AttemptTimeGrant` — `ProctorDashboardPage.test.tsx`), edit-role no-silent-
Admin-fallback + i18n role-label fallback (`UsersPage.test.tsx`), exact
zero-primary precedence assertion (`assignmentAuthority.test.ts`).

Known limitations (accepted, unchanged by this round): F-06 stale
`users.role` display for zero-primary accounts (staff list keeps them visible
via the cache fallback; honest display is future IA work), F-10 duplicated
role enums (structural, fail-loud on drift), F-11 no `users.role` DB CHECK
(fail-closed design).

Review dispositions (PR #284 review threads + issue #285): all 8 valid
findings fixed (role-Admin fallback, F-03 pagination/assignment-aware
staff list, i18n fallback, precedence assertion, characterization claim,
AppSidebar comments, ADR-017 D7/authority-precedence wording, count errors,
presets comments, MD037/MD056, completion evidence); 7 issue-#285 findings
rejected as false positives with repository evidence (see issue #285).

Deferred items: F-04 → issue #286; ADR-017 rev 4 (PROPOSED); ADR-018
(PROPOSED).

---

## 10. P7-F gate

```text
P0: 0
P1: 0
P2: 3 FIXED + 1 EXPLICITLY DEFERRED — F-01 FIXED · F-02 FIXED · F-03 FIXED ·
    F-04 CONFIRMED / EXPLICITLY DEFERRED to the scoped-RBAC milestone
    (NOT completed in this PR — tracked in issue #286)
P3: 7 remediated — F-05 FIXED · F-06 ACCEPTED · F-07 FIXED · F-08 FIXED ·
    F-09 FIXED · F-10 ACCEPTED · F-11 ACCEPTED

P7-F STATUS: READY FOR HUMAN REVIEW
```

ADR-017 revision 4 + ADR-018 are **PROPOSED** pending human review. This PR
does not merge automatically and does not start P7-F.
