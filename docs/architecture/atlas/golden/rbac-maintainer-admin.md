# Golden slice C — RBAC / Maintainer vs Admin

> **Fixture, not content.** This slice attempts to break the IR by requiring it
> to keep a **declared** mapping and the **observed runtime surface** as two
> facts, and by requiring `RolePreset ≠ effective actor authorization` to be
> structural rather than editorial.
>
> **Base revision:** master `cc318dd5` (ADR-023 removal complete: PR-A #814
> `91dc6ad6`, PR-B #815 `bdc59b3c`, PR-C #816 `cc318dd5` all merged). The
> runtime pins re-verified by content at this base: the Maintainer exact-set
> assertion (`packages/authz/src/maintainerPreset.test.ts:21-28`) and the
> `Role` catalog block (`packages/authz/src/catalog.ts:213-221`). Prior
> bases: `6ad22c79` on `remove/backup-evidence-subsystem` (PR-B #815, the
> removal commit rebased on master `91dc6ad6` with PR-A merged), the
> pre-rebase re-derivation at `2064953e` with the removal applied uncommitted,
> and the original slice base `cbe33db1a7f241ba85aadbf21c4f6dea01133f03`
> (predates the removal). Line-number anchors were re-verified by content at
> each base revision; the doc-convergence commits stacked after them do not
> touch the route/registry/permission surfaces this slice counts.

```text
REQUIRED: RolePreset ≠ effective actor authorization
FORBIDDEN OUTPUT: "role R contains permission P,
                   therefore every actor with R can operate every resource requiring P"
FORBIDDEN OUTPUT: "the registry says it is exhaustive, therefore it describes the runtime"
```

---

## 1. Identities and how each is represented

| Identity | IR representation | Evidence that this is the right shape |
| --- | --- | --- |
| Admin | `role:Admin` (`preset_kind = APPLICATION_ROLE`) | `packages/authz/src/catalog.ts:213-221` (`Role` values `:214-220`); Admin compatibility superset asserted by `packages/authz/src/adminCompatibility.test.ts` / `apps/api/src/authz/adminSuperset.test.ts` |
| Teacher | `role:Teacher` | same closed set; `teacher_course_assignments` scope |
| Proctor | `role:Proctor` | same closed set; `exam_proctor_assignments` scope |
| Grader | `role:Grader` | same closed set; `grader_exam_assignments` scope |
| Candidate | `role:Candidate` | same closed set; own-scope capabilities |
| Maintainer | `role:Maintainer` (`preset_kind = APPLICATION_ROLE`, read-only) | same closed set; capability set frozen at exactly two read capabilities |
| System | `role:System` (`preset_kind = SYNTHETIC_ACTOR`, `login_allowed = FALSE`, `assignable = FALSE`) | `packages/authz/src/catalog.ts:220`; `packages/authz/src/systemActor.ts:21`, `:43` |
| **Host Operator** | **a `Scope` with `rbac_participation = OUTSIDE_APPLICATION_RBAC` and a structured `outside_authority` block** (`scope:host-infrastructure`, `governed_by authority:adr-017`, `holder_identity = HOST_CLI_ACCESS`, `resource_domain = host infrastructure`, `excluded_from[] = {permission, role_preset, route}`) — **no `RolePreset`, no `Permission`**. Claims about the operator use `scope:host-infrastructure` as their **subject**, so "who is the host operator and what may they do" is answerable from the model rather than only from ADR-017 | ADR-017: host authority is "**NOT Exam RBAC** — granted by host/CLI access, independently of any Exam account" (`docs/adr/ADR-017-operational-authority-maintainer-boundary.md:180`; also `:190-191`, `:202`); the resource list is the R4-3 category-C row (`:202`) |

`ATLAS-IR-030`/`ATLAS-IR-031` — the `role:` namespace equals the closed catalog
set exactly, so a Host Operator preset would be a **detectable defect**, and the
`OUTSIDE_APPLICATION_RBAC` scope may not be the target of any permission path.
The exclusion is structural; it does not depend on a projection choosing to hide
it.

---

## 2. Claims — preset vs effective authorization

| # | Claim | `claim_kind` | boundary | Axes | Authority owner | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| C-01 | Role presets declare capability sets and a **scope kind** (`defaultScope`), not a resource reach: they name which *class* of resource the role's capabilities are evaluated against when no assignment narrows it, and they never name which resources. Reach requires the assignment and the resource instance | `AUTHORIZATION_EFFECT` | `B5` | design `ACCEPTED` | `docs/architecture/authorization.md:183-184` + `packages/authz/src/presets.ts:272` (Admin=organization), `:293` (Teacher=course), `:354` (Maintainer=system) | asserted by authority |
| C-02 | Effective authority is `capability × assignment`; the scope row alone grants zero capabilities, and scopes resolve fresh from the database on every request | `AUTHORIZATION_EFFECT` | `B5` | design `ACCEPTED` | `docs/architecture/authorization.md:180-181` | asserted by authority |
| C-03 | At runtime the capability set is derived from **active assignments** (a union over each active role's preset), not from the login `users.role` or JWT claims | `AUTHORIZATION_EFFECT` | `B3` | implementation `PRESENT`, verification `PASS` | `docs/architecture/authorization.md:71-73` + the resolver | **SUPPORTED** |
| C-04 | A grader without an active Grader→Exam assignment to the attempt's exam is denied as **404** (anti-enumeration), and the check fails **closed** (503) on lookup failure or a mis-declared route | `AUTHORIZATION_EFFECT` | `B3` | implementation `PRESENT`, verification `PASS` | `docs/architecture/authorization.md` + the seam | **SUPPORTED** |
| C-05 | Teacher scope is `teacher_course_assignments` (course-level); Proctor scope is `exam_proctor_assignments` (exam-level); Grader scope is `grader_exam_assignments` (exam-level). Collection reads filter in SQL **before** pagination and total count | `AUTHORIZATION_EFFECT` | `B3` | implementation `PRESENT`, verification `PASS` | `docs/architecture/authorization.md:178-184` | **SUPPORTED** |
| C-06 | Admin∩Maintainer is forbidden at the active-assignment level, enforced transactionally at a single chokepoint used by both login and per-request authentication | `AUTHORIZATION_EFFECT` | `B3` | implementation `PRESENT`, verification `PASS` | ADR-017 D14 (`:285-288`) | **SUPPORTED** |
| C-07 | **`RolePreset contains Permission ⇒ actor may operate every matching resource` is false** | `CAPABILITY_SUPPORT` (rejection) | — | `verification = INSUFFICIENT` for the proposition | — | **REJECTED** (F-09) |
| C-08 | The product's own Admin-facing projection declares that it answers "which capabilities do the active roles grant", **never** "which resources can this user reach" | `AUTHORIZATION_EFFECT` | `B5` | design `ACCEPTED` | `docs/architecture/authorization.md` (capability × assignment) + EXSEM-001; `apps/api/src/routes/permissionRegistry.ts:94-103` is the **implementation seam** and its own statement, not the authority | asserted by authority |

---

## 3. Claims — Maintainer vs Admin boundary

| # | Claim | `claim_kind` | boundary | Axes | Authority owner | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| C-09 | The Maintainer is a **read-only operational observability identity**: observation only, zero business permissions, zero write permissions, frozen at exactly two read capabilities (`system.health.view`, `system.diagnostics.view`) | `AUTHORITY_STATEMENT` | `B5` | design `ACCEPTED` | ADR-017 `:178` (observation-only identity row); the capability freeze is re-baselined 5→2 by ADR-023 via ADR-017 §Revision 5 (`:101`; the rev-4 five-read text at ADR-017 `:260-263` is historical, annotated by the rev-5 note `:265-270`); runtime pin: the exact-set assertion in `packages/authz/src/maintainerPreset.test.ts:21-28` | asserted by authority |
| C-10 | `GET /system/health` and `GET /system/diagnostics` are gated by capabilities held by **both** Admin and Maintainer | `RUNTIME_OBSERVATION` | `B3` | implementation `PRESENT`, verification `PASS` | ADR-017 + the routes | **SUPPORTED** |
| C-11 | The **business-integrity block** inside `/system/diagnostics` is Admin-only: it is loaded only when the caller holds `system.business_integrity.view`, which the Maintainer preset does not contain | `RUNTIME_OBSERVATION` + `AUTHORIZATION_EFFECT` | `B3` | implementation `PRESENT`, verification `PASS` | ADR-017 D8 | **SUPPORTED** |
| C-12 | The policy-intent surface no longer exists in application RBAC: the former Admin-only write `PUT /system/ops-policy` and both `system.ops.policy.*` keys were removed with the backup-evidence subsystem; the Maintainer holds zero write capabilities anywhere in the catalog, while Admin retains its non-backup business permissions unchanged | `AUTHORIZATION_EFFECT` | `B3` | implementation `PRESENT`, verification `PASS` | ADR-023 (removal decision) + ADR-017 §Revision 5 `:105` (D9 superseded; the rev-4 R4-4/D9 text at ADR-017 `:215+` is historical context only — it no longer states current authority); verified by the closed catalog/presets union plus the whole-app capture | **SUPPORTED** |
| C-13 | Admin-only business projections exist and are **not** Maintainer-visible: audit-log export and the organization-wide Recovery Center incident queue | `AUTHORIZATION_EFFECT` | `B3` | implementation `PRESENT`, verification `PASS` | ADR-017 + the routes | **SUPPORTED** |
| C-14 | A single route can carry **two different** authorization truths: the operational projection is shared (Admin+Maintainer) while a sub-block inside it is Admin-only | `AUTHORIZATION_EFFECT` | `B3` | implementation `PRESENT`, verification `PASS` | derived from C-10 + C-11 | **SUPPORTED** — this is why `authority_requirement` is per-operation and the integrity block is its own claim |

`C-14` is the reason the IR does not simply label "the diagnostics route" with one
role list: a projection-level role list would erase the Admin-only sub-block, and
a single flat gate would overstate the Maintainer's reach.

`ATLAS-IR-091` (added during R0-D) makes this an **obligation** rather than an
observation: an in-handler capability branch is modelled as its own
`Operation` (or recorded in `Interface.additional_gates[]`), and omitting it is a
conformance defect. Without that rule, leaving the branch out of the IR would
validate silently and C-14 would be advice instead of a constraint.

---

## 4. Claims — the System synthetic actor

| # | Claim | `claim_kind` | boundary | Axes | Authority owner | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| C-15 | `System` is a synthetic non-human actor: non-login, non-assignable, and it is **not** resolved by the assignment kernel | `RUNTIME_OBSERVATION` | `B3` | implementation `PRESENT`, verification `PASS` | ADR-017 (`:179`); `packages/authz/src/catalog.ts:220`; `packages/authz/src/systemActor.ts` | **SUPPORTED** |
| C-16 | Its contexts are constructed with a **closed set of actor ids** enforced at compile time and at runtime, and with an **empty `RequestContext.permissions` slot**, so a stray string cannot produce an untracked audit actor | `RUNTIME_OBSERVATION` | `B3` | implementation `PRESENT`, verification `PASS` | `packages/authz/src/systemActor.ts:19-35`, `:43-50` | **SUPPORTED** |
| C-17 | `RolePreset(System)` is an authorization container in the ordinary sense — it holds four system-operation capabilities (`system.auto_submit`, `system.heartbeat_scan`, `system.lifecycle_reconcile`, `system.incident_create`) — while the **runtime context** built for a scanner carries an empty permission slot; the actor's authorization therefore does not come from preset membership resolved at authentication | `AUTHORIZATION_EFFECT` | `B3` | implementation `PRESENT`, verification `PASS` | `packages/authz/src/presets.ts:255-258` (the four grants) + `packages/authz/src/systemActor.ts:43-60` (the context) + C-15's non-resolvability | **SUPPORTED** |

`C-17` correction note: an earlier draft of this slice asserted that the System
preset has an *empty* capability set. Verification against
`packages/authz/src/presets.ts:255-258` showed four grants, and the empty set is
the **context** slot only. The corrected claim is narrower and is the one the
evidence supports. This is exactly the class of error the slices are supposed to
catch, so it is recorded rather than silently edited.

---

## 5. Claims — Host Operator outside application RBAC

| # | Claim | `claim_kind` | boundary | Axes | Authority owner | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| C-18 | Host/infrastructure authority (Docker/Compose, PostgreSQL, WAL, backup destination, secrets, restore/PITR, service lifecycle, filesystem) is **outside Exam RBAC**, granted by host/CLI access, and is not an RBAC assignment | `AUTHORIZATION_EFFECT` | `B5` | design `ACCEPTED` | ADR-017 `:180`, `:190-191`, `:202` | asserted by authority |
| C-19 | No permission key grants host authority; no role preset contains one; no application route performs host-level restore/secret/PGDATA operations | `AUTHORIZATION_EFFECT` | `B3` | verification `PASS` with a **stated closed search**: catalog closed union (`packages/authz/src/catalog.ts:23-173`) × preset boundaries × the route surface as captured by the whole-app test, plus a handler scan over `apps/api/src/routes/**` for `pgdata|pg_restore|pg_dump|wal_|process.env.PG*|process.env.POSTGRES*|secret` (re-run at the current base: only the timing-safe token-comparison helper comments in `launchpad.ts`, JWT-secret reads inside `auth.ts` and test helpers, and redaction comments — no host-level handler). At the prior base the two exposed infrastructure surfaces were read-only evidence views (`GET /system/backups`, `GET /system/restore-readiness`); both surfaces, their routes and their permission keys are deleted by the backup-evidence subsystem removal, leaving **zero** application-route infrastructure exposure | ADR-017 D4 (`:281-282`) | **SUPPORTED** |
| C-20 | The Maintainer **may view** relevant status for infrastructure configuration but does not hold it | `AUTHORIZATION_EFFECT` | `B3` | implementation `PRESENT`, **verification `PASS`** | ADR-017 R4-3 (`:193-213`, Maintainer-view paragraph `:209-210`); runtime evidence: the two read capabilities at `packages/authz/src/presets.ts:234-237` plus `apps/api/src/authz/operationalBoundary.test.ts` / `adminMaintainerExclusion.test.ts` | **SUPPORTED** |
| C-21 | The operator's real authority channel is the host: the runbook's backup/restore procedures are host-side commands, and application-side readiness documentation limits app-side visibility to Admin+Maintainer | `RUNTIME_OBSERVATION` | `B5` | verification `PASS` | `docs/deployment/mvp-deployment-runbook.md` (host-side `pg_dump`/`pg_restore` wrappers) + `docs/operations/README.md:71-72` | **SUPPORTED** |

`ATLAS-SEM-114` note: R0 could **not** reproduce the claim that the deployment
runbook states "host operator is outside RBAC" — that statement was found only in
ADR-017 (`:180`, `:190-191`, `:202`); the runbook and `docs/operations/README.md`
contain no occurrence of "RBAC" at all. The claim above is therefore attributed to
**ADR-017 only**, and the absence of a second statement is recorded rather than
assumed. This is a correction to the input description in [#762](https://github.com/jnhu76/exam/issues/762).

---

## 6. The declared-metadata vs runtime-truth claim pair

This is the slice's hardest requirement: **both** facts are preserved, neither is
promoted, and O-07 is **not** fixed.

| # | Claim | `claim_kind` | boundary | Axes | Verdict |
| --- | --- | --- | --- | --- | --- |
| C-22 | The route permission registry **declares** a `route → permission → scope → audit` mapping for *every* route gated by a capability gate — i.e. it declares **exhaustive intent** | `DECLARED_METADATA` | `B0` | design `ACCEPTED` (as test-only metadata) | asserted (verbatim header, §7) |
| C-23 | The registry is **test-only metadata**: no production code reads it; it is checked against the live Fastify `onRoute` capture by conformance tests | `DECLARED_METADATA` | `B0` | implementation `PRESENT` | **SUPPORTED** |
| C-24 | The registry contains **109** entries | `FACT`-class `DECLARED_METADATA` | `B0` | `freshness CURRENT` | **verified by count at the current base** (was 113 at `cbe33db1`; the four backup-evidence registry rows are removed) |
| C-25 | The whole-application runtime capture asserts **143** primary routes, of which **122** are capability-protected and 21 are non-protected | `RUNTIME_OBSERVATION` | `B0` | implementation `PRESENT` | **verified in the test's own assertions** |
| C-26 | Therefore the declared mapping and the runtime surface **diverge by 13 protected routes**; the reverse direction (registry entries with no runtime route) is **0 orphans** | `DECLARED_METADATA` vs `RUNTIME_OBSERVATION` divergence | `B0` | `resolution = CONFLICT` at the snapshot level | **reported divergence** (count-level) |
| C-27 | The whole-app conformance test does **not** consume the registry: it asserts the route-count split and classification, and never imports the registry module | `FACT` | `B0` | implementation `PRESENT` | **verified** |
| C-28 | The registry **is** consumed by two other conformance tests, which compare registry entries against the runtime capture in the **forward** direction (registry → runtime) | `FACT` | `B0` | implementation `PRESENT` | **verified** |
| C-29 | Consequently the covered direction is registry→runtime, and the uncovered direction is runtime→registry. No test asserts that every protected runtime route appears in the registry | `FACT` (derived from C-27 + C-28) | `B0` | — | **verified by reading both tests** |
| C-30 | The per-entry gap list (14 routes across `exam-profiles`×5, `invitations`×3, `permission-registry`×2, `retention-readiness`×1, `questions/tags`×1, `admin/audit-logs/export`×1, `admin/audit-log/actions`×1) is an **issue-recorded** claim | `DECLARED_METADATA` (external) | `B0` | `external_freshness UNKNOWN` | `DECLARED_ONLY` — **R0 did not re-derive the per-module breakdown**; it is attributed to `#762` O-07 and marked unverified-locally. The breakdown also predates the backup-evidence subsystem removal: its `retention-readiness`×1 route no longer exists and the locally-derived gap at the current base is 13 (C-26), so the list must be re-derived rather than reconciled arithmetically |
| C-31 | `DECLARED_METADATA ≠ RUNTIME_TRUTH`, and neither source is discarded | — | — | — | **structural** (`Interface.declared` + `Interface.runtime_observation` + derived `declared_vs_runtime`) |

### 6.1 What R0 verified, and what it only attributes

Verified **locally, at the current base** (re-derived 2026-10-25 at the
rebased PR-B removal commit — see Base revision), by direct
inspection/counting:

```text
registry entry count                                  109   (counted)
whole-app capture assertions                    122 / 21 / 143 (read from the test's assertions)
whole-app test imports the registry module                no  (import list inspected)
proctorAccessConformance enumerates every registry entry  yes (header + imports inspected)
registry header declares exhaustive intent                 yes (verbatim, §7)
registry header declares "no production code reads this"    yes (verbatim, §7)
```

Attributed **to the issue record only** (not independently re-derived in R0):

```text
the per-module breakdown of the 14 missing routes
the "0 orphans" figure     (consistent with the forward-only direction, but not re-enumerated here)
```

`ATLAS-SEM-023` — the reverse-completeness absence is stated as *the covered
direction is forward only*, which is what reading the two tests establishes. The
"13" figure is a count-level arithmetic consequence of two locally verified
numbers (122 − 109 = 13) and is reported as such; the per-module attribution is
`DECLARED_ONLY` with `external_freshness = UNKNOWN`.

`ATLAS-SEM-112` — the divergence is **not** treated as a defect in the registry
by definition. The registry is deliberately test-only metadata; whether its
exhaustive-intent claim should hold is an owner decision already captured as
`#762` O-07, whose default remediation direction (add the 14 entries **and** add a
reverse-completeness assertion, or explicitly narrow the contract) R0 records and
does **not** execute.

---

## 7. Source refs

Bound to the PR-B removal commit `6ad22c79` on
`remove/backup-evidence-subsystem` (rebased on master `91dc6ad6`; anchors
re-verified by content 2026-10-25 — see Base revision).

| Ref | `source_kind` | Anchor / verbatim |
| --- | --- | --- |
| `packages/authz/src/catalog.ts` | `REPO_FILE` | `Role` closed set `:213-221` (values `:214-220`); `Scope` closed set `:185-194` (values `:186-193`); grading/inert annotation `:94-105` |
| `packages/authz/src/presets.ts` | `REPO_FILE` | `RolePreset` interface; `MAINTAINER_PERMISSIONS` `:234-237`; `GRADER_PERMISSIONS` `:212-219` |
| `packages/authz/src/systemActor.ts` | `REPO_SYMBOL` | `SYSTEM_ACTOR_IDS` `:21`; `createSystemRequestContext` `:43` |
| `apps/api/src/authz/assignmentAuthority.ts` | `REPO_SYMBOL` | `deriveAssignmentAuthority` `:164`; dual-role fail-closed `:231-233` |
| `apps/api/src/plugins/auth.ts` | `REPO_SYMBOL` | assignment authority load; `requireCapability` |
| `apps/api/src/authz/scopedCapability.ts` | `REPO_SYMBOL` | teacher `:355-407`; grader `:416-468` |
| `apps/api/src/routes/system.ts` | `REPO_SYMBOL` | `/system/health` `:281-302`; `/system/diagnostics` `:355-379`; integrity block `:372-377`; the former `/system/ops-policy` anchor is removed — that surface no longer exists (backup-evidence subsystem removal) |
| `apps/api/src/routes/audit.ts` | `REPO_SYMBOL` | `/admin/audit-logs/export` `:214-223` |
| `apps/api/src/routes/incidents.admin.ts` | `REPO_SYMBOL` | `/admin/recovery/incidents` `:1312-1322` |
| `apps/api/src/routes/permissionRegistry.ts` | `REPO_SYMBOL` | `/admin/users/:id/effective-authority`; capability-not-resource statement `:94-97` |
| `apps/api/src/authz/routeRegistry.ts` | `REPO_FILE` | header `:1-14` — verbatim: "Declarative `route → permission → scope → audit` mapping for every route gated by `requireCapability(...)` …" and "**TEST-ONLY METADATA: no production code reads this registry.** It is checked by `routeRegistryConformance*.test.ts` / `proctorAccessConformance.test.ts`, which compare the declared mapping against the live Fastify `onRoute` capture." |
| `apps/api/src/authz/routeRegistryConformanceWholeApp.test.ts` | `TEST_CASE` | counts `:372-391` (122 / 21 / 143); imports at `:37-43` contain no `routeRegistry` import; the identifier appears only inside three comments (`:10`, `:35`, `:78`) and each of those names the **sibling test file** `routeRegistryConformance.test.ts` — the registry module is never imported and never mentioned |
| `apps/api/src/authz/proctorAccessConformance.test.ts` | `TEST_CASE` | header: "The route registry is the enumeration source of truth — the test enumerates EVERY registry entry" |
| `apps/api/src/authz/routeRegistryConformance.test.ts` | `TEST_CASE` | reads the registry and compares against the live capture (forward direction) |
| `apps/web/src/pages/admin/PermissionRegistryPage.tsx` | `REPO_SYMBOL` | `:249` — checkmark rendered from `role.permissions.includes(entry.key)` (no scope dimension) |
| `docs/architecture/authorization.md` | `REPO_SECTION` | `:71-73`, `:85-92` ("Treat any count in prose (including below) as a snapshot — **cite the test, not the number**"), `:100-103`, `:178-184` |
| `docs/adr/ADR-017-operational-authority-maintainer-boundary.md` | `REPO_SECTION` | identity table `:175-181`; host operator `:180`, `:190-191`, `:202`; rev-5 scope table `:95-107` (R4-4 `:100`, Maintainer re-baseline `:101`, D9 `:105`); five reads (rev-4, historical, with rev-5 note) `:260-270`; R4-3 `:193-213`; D4 `:281-282`; D14 `:285-288` |
| `docs/adr/ADR-010-scoped-rbac-architecture.md` | `REPO_SECTION` | Status `:9-19` (names `authorization.md` as the implemented model); historical sections: Shadow Permission Mode `:825` with `:827`, "Draft shape … Not implemented" `:638` |
| `docs/operations/README.md` | `REPO_SECTION` | `:71-72` (app-side readiness visibility = Admin + Maintainer) |
| `work:jnhu76/exam#762` | `GITHUB_ISSUE` (`external`) | O-07, O-08, O-09 input states |
| `work:jnhu76/exam#763`, `#757` | `GITHUB_ISSUE` (`external`) | this work's authority |

External refs (SREF-1 `external_revision` triple; external freshness is a
dimension separate from the repo SHA — `provenance-v0.1.md` §7.2):

```text
work:jnhu76/exam#762  external_revision { observed_state: OPEN,   observed_updated_at: 2026-10-10, observed_at: 2026-10-11 }  external_freshness: UNKNOWN
work:jnhu76/exam#757  external_revision { observed_state: OPEN,   observed_updated_at: 2026-10-11, observed_at: 2026-10-11 }  external_freshness: UNKNOWN
work:jnhu76/exam#763  external_revision { observed_state: OPEN,   observed_updated_at: 2026-10-11, observed_at: 2026-10-11 }  external_freshness: UNKNOWN
```

`observed_updated_at` is the issue's own last observed state change, not the
observation time; every external freshness is `UNKNOWN` because no re-check was
performed. The per-module O-07 breakdown is `DECLARED_ONLY` at this
`external_revision` and must be re-derived by R1 rather than inherited.

### 7.1 A note on numbers

`docs/architecture/authorization.md:90-91` explicitly instructs readers to
**cite the test, not the number**, because counts in prose are snapshots. This
slice therefore:

- cites the **test** (`routeRegistryConformanceWholeApp.test.ts`) as the authority
  for the route split, with the numbers only as its current assertion values;
- does **not** quote a permission count or role count from prose;
- treats the registry's 109 as a count that R1 must re-derive, not inherit.

---

## 8. Supporting evidence (classified)

| Evidence | Kind | Strength | `proves` | `does_not_prove` |
| --- | --- | --- | --- | --- |
| `packages/authz/src/catalog-closed-union.test.ts`, `presets.test.ts`, `presets-boundaries.test.ts`, `adminCompatibility.test.ts`, `permissionMetadata.test.ts` | `TEST_SEMANTIC` | `BEHAVIOURAL_PURE` | The role/permission/scope sets are closed and the preset invariants (incl. Maintainer's two reads, Admin superset, boundary exclusions) hold | Any runtime enforcement |
| `packages/authz/src/maintainerPreset.test.ts`, `apps/api/src/authz/adminSuperset.test.ts`, `adminInvariant.test.ts` | `TEST_SEMANTIC` | `BEHAVIOURAL_PURE` | The Maintainer/Admin boundary as declared | Route gating |
| `packages/authz/src/systemActor.test.ts` | `TEST_SEMANTIC` | `BEHAVIOURAL_PURE` | The synthetic actor's closed id set and refusal behaviour | Route-level effect |
| `apps/api/src/authz/assignmentAuthority.test.ts` | `TEST_SEMANTIC` | `BEHAVIOURAL_PURE` | The resolver's fail-closed rules (subject/org anchor, dual-role, unknown role) | Database integration |
| `apps/api/src/authz/assignmentAuthorityRuntime.test.ts` | `TEST_INTEGRATION` (real PostgreSQL) | `BEHAVIOURAL_COMPOSITION` | Active-assignment resolution against real rows, incl. revocation effective on the next request | Physical locking |
| `apps/api/src/authz/teacherCourseMatrix.test.ts`, `graderExamMatrix.test.ts`, `apps/api/src/routes/proctorScope.test.ts` | `TEST_INTEGRATION` (real PostgreSQL / real HTTP) | `BEHAVIOURAL_COMPOSITION` | The capability×assignment matrices per scoped role, including the 404 anti-enumeration fold and SQL-side list filtering | Lock contention |
| `apps/api/src/authz/operationalBoundary.test.ts`, `adminMaintainerExclusion.test.ts` | `TEST_INTEGRATION` (real HTTP / isolated DB) | `BEHAVIOURAL_COMPOSITION` | The Maintainer/Admin operational boundary as **enforced**, incl. the diagnostics split and the Admin-only integrity block | Coverage of routes outside the ones each file exercises; physical lock behaviour; browser behaviour; the removed `opsPolicy`/`backupEvidence` HTTP suites (their routes no longer exist) |
| `apps/api/tests/security/rbac-matrix.test.ts`, `exam-protocol-security.test.ts` | `TEST_INTEGRATION` | `BEHAVIOURAL_COMPOSITION` | The security matrix over the API surface | Registry completeness |
| `apps/api/src/authz/routeRegistryConformance.test.ts`, `proctorAccessConformance.test.ts` | `TEST_INTEGRATION` | `BEHAVIOURAL_COMPOSITION` | Registry→runtime **forward** agreement for the covered entries | Runtime→registry completeness (C-29) |
| `apps/api/src/authz/routeRegistryConformanceWholeApp.test.ts` | `TEST_INTEGRATION` | `BEHAVIOURAL_COMPOSITION` | The whole-app route split and its structural classification (0 `requireRole` consumers, no route left unclassified) | Registry agreement — it never reads the registry |
| `apps/api/src/authz/scopedCapability.test.ts`, `scoreCapability.test.ts`, `ownAttemptCapability.test.ts`, `candidateContextCapability.test.ts`, `examEligibilityCapability.test.ts` | `TEST_SEMANTIC` | `BEHAVIOURAL_PURE` | The scope-resolver/deny-mapping units | Wire surface |
| `docs/architecture/authorization.md`, `docs/adr/ADR-017-…`, `docs/adr/ADR-010-…` | `CONTRACT` | `OWNER_JUDGEMENT` | The declared model and the frozen boundary | Implementation |

**No browser E2E for RBAC exists** (`Maintainer` does not appear anywhere under
`apps/e2e/`). This is consistent with `docs/standards/testing.md` §4.0: a
per-role route/visibility matrix is not a browser-only mechanism, and the
retention bar deliberately moved those assertions to the API layer. The boundary
is therefore proven at the HTTP composition layer, and that is what the claims
rest on — stated explicitly rather than left implicit.

---

## 9. Challenging evidence

| # | Challenge | Evidence | Consequence |
| --- | --- | --- | --- |
| C-C1 | **The registry claims exhaustiveness it does not have** (O-07) | Header declares a mapping "for every route gated by …" with **109** entries; the whole-app capture asserts **122** protected routes of **143** total; the whole-app test does not import the registry (C-22…C-29) | Forces the `Interface.declared_vs_runtime` model and forbids "the registry is the runtime truth". **Both** facts retained |
| C-C2 | **A test named for whole-app conformance does not consume the registry** | Import list `:37-43` contains no `routeRegistry` import; the only three occurrences of the identifier are comments naming the sibling conformance test | Forces C-27/C-29 and forbids reading a test's name as its guarantee (`ATLAS-SEM-033`) |
| C-C3 | **The Admin-facing permission matrix renders preset membership as checkmarks with no scope dimension** | `apps/web/src/pages/admin/PermissionRegistryPage.tsx:249` | An existing **projection-level false-support hazard**: a reader may infer resource reach. Recorded; the page's own limitation note is quoted in the source ref. This is `#762` O-08, an owner/product decision R0 does not take (`ATLAS-SEM-063`) |
| C-C4 | **A permission can be granted and inert** | `grading.finalize`/`grading.identity.view` are granted to Admin and consumed by no route (`catalog.ts:99-105`) | Golden B's F-16 rejection; here it forces `Permission.inert` to be **derived** |
| C-C5 | **The product's own effective-authority projection explicitly refuses to answer resource reach** | `apps/api/src/routes/permissionRegistry.ts:94-97` | Strong support for C-01/C-08 and a direct source of the "never render preset as reach" rule |
| C-C6 | **`#762` claims the runbook states the host-operator exclusion; R0 could not reproduce it** | ADR-017 `:180`/`:190-191`/`:202` carry the statement; `docs/deployment/mvp-deployment-runbook.md`, `docs/operations/README.md` and `docs/architecture/configuration-authority.md` contain no "RBAC" occurrence | The input description's attribution is **corrected**: the authority is ADR-017. This is exactly the kind of stale/noisy input `#757` §0 warns about |
| C-C7 | **ADR-010 contains sections that read as current but are historical** | "Shadow Permission Mode" (`docs/adr/ADR-010-scoped-rbac-architecture.md:825`, with its own constraint statement at `:827`) while the runtime states "no shadow-mode evaluation exists in the runtime"; registry section marked "> **Draft shape (job §8).** Not implemented." (`:638`); Status section `:9-19` names `authorization.md` as the implemented model | The ADR's **own** Status section scopes it, so this is a *documented historical section*, **not** an `AUTHORITY_CONFLICT` (`ATLAS-SEM-114`, and `#762` §9 A2). Recorded with the exact sections so a reader cannot mistake them for current requirements |
| C-C8 | **Host Operator is a real operational identity with real power but no Exam account** | ADR-017 `:180` | Forces the `OUTSIDE_APPLICATION_RBAC` scope and forbids inventing a role for it |
| C-C9 | **Counts in prose are explicitly non-authoritative** | `authorization.md:90-91` | Forces this slice to cite tests, not totals (§7.1). A count figure is used only because it was counted at a pinned revision, and it is re-derived at every re-baseline (113 at the prior base → 109 at the current base) |

**Result:** four of these (C-C1, C-C3, C-C6, C-C7) changed a recorded statement
or added a modelled hazard.

---

## 10. UNKNOWN

| ID | Unknown | Why | Not converted into |
| --- | --- | --- | --- |
| C-U1 | The per-module identity of the 13 missing registry entries | Not re-derived in R0 (attributed to `#762` O-07, whose breakdown predates the backup-evidence removal) | **Not** asserted as verified; `DECLARED_ONLY` |
| C-U2 | Whether the registry's exhaustive-intent claim should hold or be narrowed | Owner decision (`#762` O-07 default direction); Atlas must not decide | **Not** resolved; `open_governance_item.kind = WORK_ITEM` |
| C-U3 | How much the Admin permission matrix misleads actual users | Behavioural/product question (`#762` U-03) | **Not** asserted; the hazard is recorded, the severity is not |
| C-U4 | `external_freshness` of `#762`'s O-07 figures after the capture date | External refs carry a capture-time revision | left `UNKNOWN` |
| C-U5 | Whether any deployment's host-operator practice is documented outside ADR-017 | Only ADR-017 was found (`C-C6`) | left `UNKNOWN`; not generalized into "practices are undocumented" |
| C-U6 | Whether every protected route is reachable under exactly one gate (no route double-gated differently in production) | Conformance asserts classification, not per-route runtime semantics for all 143 | left `UNKNOWN` for the uncovered set |

---

## 11. CONFLICT

| ID | Kind | Parties | Status |
| --- | --- | --- | --- |
| C-K1 | `DECLARED_VS_RUNTIME_DIVERGENCE` | registry (109 entries, declared exhaustive) ↔ whole-app runtime capture (122 protected) | **UNRESOLVED**; `open_governance_item = { kind: WORK_ITEM, ref: #762 O-07, lift_condition: "add the missing entries and a runtime→registry completeness assertion, or explicitly narrow the declared contract" }`. No winner chosen |
| C-K2 | `DECLARED_VS_RUNTIME_DIVERGENCE` (projection layer) | `PermissionRegistryPage` renders preset membership as a checkmark matrix ↔ `permissionRegistry.ts:94-97` states the projection answers capabilities, never resource reach | **UNRESOLVED**; owner decision `#762` O-08 |
| C-K3 | `TEMPORAL_CONFLICT` | ADR-010's "Shadow Permission Mode" (`:825`, constraint `:827`) and "Registry … Not implemented" (`:638`) sections ↔ the runtime's "no shadow-mode evaluation exists" and the registry's actual existence | **UNRESOLVED**; `open_governance_item = { kind: DECISION_GATED, ref: the ADR-010 owner, lift_condition: "a dated amendment note per #762 O-03/O-04" }`. The ADR's own Status section is a **party statement**, not a resolution (`ATLAS-SEM-114`), and `#762` still lists O-03/O-04 as pending owner decisions. Recorded rather than adjudicated. **Correction:** an earlier draft resolved this as `RESOLVED_BY_SCOPE`, which pre-empted those two owner decisions |
| C-K4 | `EVIDENCE_CONTRADICTION` (own-slice) | The `#762` input description attributes the host-operator statement to the runbook; the runbook does not contain it | **RESOLVED_BY_CORRECTION** (C-C6): the Atlas artifact was corrected to attribute the statement to ADR-017; this is an Atlas-side provenance fix, not an adjudication of anyone's normative claim |

---

## 12. RESIDUAL

```text
RESIDUAL = 4
  1. Registry coverage gap (13 protected runtime routes unregistered,
     no runtime→registry completeness assertion).
     owner: work:jnhu76/exam#762 O-07 (follow-up). Atlas must not fix it in R0.
  2. Admin permission matrix shows preset membership without a scope dimension.
     owner: owner decision (#762 O-08). Product/UX choice pending.
  3. Granted-but-inert capability keys (grading.finalize / grading.identity.view,
     and grading.answer.view in practice).
     owner: product decision (#762 O-02 / O-13 territory).
  4. No browser-level RBAC evidence (deliberate, per the reversed E2E retention bar).
     owner: docs/standards/testing.md §4.0 policy. Not a gap to fix.
```

---

## 13. Gate

```text
GOLDEN_RBAC = PASS
  LOGICAL_ID                        = defined (§1 identities; §2/§3 authorities, permissions, scopes)
  ROLEPRESET_NEQ_EFFECTIVE          = YES (C-01…C-08; structural: no reach field on RolePreset)
  FALSE_GLOBAL_RBAC_CLAIMS          = 0   (C-07 rejection)
  MAINTAINER_READONLY               = represented (C-09…C-12)
  ADMIN_BROADER_AUTHORITY           = represented (C-11, C-13, C-06)
  DIAGNOSTICS_SPLIT                 = represented (C-10, C-11, C-14)
  TEACHER_SCOPE                     = represented (C-05)
  GRADER_SCOPE                      = represented (C-04, C-05)
  PROCTOR_SCOPE                     = represented (C-05)
  SYSTEM_SYNTHETIC_ACTOR            = represented (C-15…C-17)
  HOST_OPERATOR_OUTSIDE_RBAC        = represented structurally (C-18…C-21, §1)
  DECLARED_METADATA_NEQ_RUNTIME     = YES (C-22…C-31)
  O07_PRESERVED_BOTH_FACTS          = YES (C-31, C-K1) — neither source promoted
  O07_FIXED_IN_R0                   = NO  (out of scope, confirmed)
  REGISTRY_RUNTIME_CONFLATION       = 0   (no claim treats the registry as runtime truth)
  MISSING_SCOPE_DIMENSION           = 0   (every operation with a resource gate carries scope_ref + assignment_required)
  SLICE_SPECIFIC_SCHEMA_HACK        = 0
  VAGUE_AUTHORITY_STATEMENTS        = 0   (each C-C6/C-C7 correction names the exact authority)
  PRESET_REACH_FIELD_ON_ROLEPRESET  = 1   (default_scope names a scope KIND, not a resource instance;
                                           C-01 reworded and ATLAS-IR-092 added — see r0-review.md RV-3)
  CONFLICT_KINDS_OUTSIDE_CLOSED_SET = 0   (C-K3 reclassified to UNRESOLVED + DECISION_GATED)
  SYSTEM_PRESET_CLAIM_CORRECTED     = YES (C-17; the preset has four grants, the context slot is empty)
```
