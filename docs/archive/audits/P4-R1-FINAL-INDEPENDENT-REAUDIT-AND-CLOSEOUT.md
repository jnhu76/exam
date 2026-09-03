# P4-R1 — Final Independent Re-audit and Closeout

> **Job:** `P4-R1 — Final Independent Re-audit and Closeout`
> **Subject (the module Job being closed):** `P4 — Admin / Teacher / Candidate MVP Role Switch`
> **Type:** Final review, verification, evidence reconciliation, and documentation
> closeout **ONLY**.
> **Production code modified by R1:** `no`.
> **Test code modified by R1:** `no`.
> **Branch:** `feat/phase4-rbac`
> **Tested commit (HEAD):** `b4dc1d6` (`test(e2e): complete teacher browser product path`)
> **Re-audit date:** 2026-07-24
> **Naming note.** This "P4" is the **Phase-3 module Job id**
> (`P4 — RBAC MVP role switch`) from `docs/archive/roadmap/phase3-open-items.md`, **not**
> the roadmap's Phase 4 ("Platformization and Integration"). Throughout this
> report "P4" = the Admin/Teacher/Candidate MVP role-switch Job; "Phase 4" =
> platformization. They are unrelated.

---

## 1. Verdict

```text
PASS — P4 CLOSED
```

Every closure criterion in the P4-R1 prompt §17 is satisfied by current
executable evidence, re-derived independently in this audit (not concatenated
from prior reports). The hard prerequisite (P4-C3-CORR1 independent review
PASS) is met; Gate 0.5 remains PASS; the runtime route inventory reconciles
exactly; legacy-authority surface is zero; assignment-backed authority remains
fail-closed; C1, C2, and C3/CORR1 are all complete; the role matrix matches the
frozen contract; the Gap Register is closed; the P3 handoff contract is frozen;
no scope leak is present; and `pnpm verify` plus the full six-spec E2E set pass
with zero skips.

**Next authorized Job:** `P5-0 — Email delivery runtime hardening` (the exact
next title and order from `docs/archive/roadmap/phase3-open-items.md` "Module execution
order").

This Job does **not** begin P5-0 and does **not** claim P3, P5-0, P5-N1, or P6
are closed.

---

## 2. Reviewed branch, commits, and working tree

```text
branch              feat/phase4-rbac
HEAD (tested)       b4dc1d6  test(e2e): complete teacher browser product path   (P4-C3 CORR1)
parent              93f9249  test(e2e): prove three-role authorization flow     (P4-C3 original)
P4-C2               87583a3  feat(web): enforce capability route guards
P4-C1               3046bc9  refactor(authz): remove legacy authorization residue
pre-C1 base         6711b2b  Merge pull request #207 from jnhu76/fix/visual-finish-test-text-token  (origin/master)
P4-R0 / P4-V0       f2a7a80 + 6a72a42  (already on master via merge 2ac1f6a; pre-date 6711b2b)
working tree        two untracked files only:
                       docs/audits/P4-C3-INDEPENDENT-REVIEW.md          (prior review, FAIL)
                       docs/audits/P4-C3-CORR1-INDEPENDENT-REVIEW.md    (prior review, PASS)
                    no staged/modified production or test source
git diff --check    clean (no whitespace errors)
```

The P4 commit chain discovered from Git history (`git log --reverse --oneline
6711b2b..HEAD`):

```text
3046bc9 refactor(authz): remove legacy authorization residue     (P4-C1)
87583a3 feat(web): enforce capability route guards               (P4-C2)
93f9249 test(e2e): prove three-role authorization flow           (P4-C3 original)
b4dc1d6 test(e2e): complete teacher browser product path         (P4-C3 CORR1)
```

Chain integrity (task §4):

```text
[x] no unrelated production commits are hidden inside the P4 series
    (4 commits, all RBAC-role-switch scoped; each parent is the prior)
[x] C1, C2, C3 responsibilities remain separated
    (C1 = api cleanup; C2 = web route guards; C3 = e2e evidence; CORR1 = e2e fix)
[x] corrective commits did not rewrite unrelated behavior
    (CORR1 sole parent is the original C3; +621/−74 across 4 files, apps/e2e/** only)
[x] working tree is trustworthy (only the two prior untracked review docs)
```

P4-R0 and P4-V0 already landed on `master` before the P4-C1 base (`6711b2b`),
via the `feat/rbac-reality-audit` merge (`2ac1f6a`). Their content is the
authority chain read in §3 and is not part of the diff-scope audit base.

---

## 3. Authority chain

Read in the order specified by task §2:

```text
AGENTS.md
docs/roadmap/phase-roadmap.md
docs/archive/roadmap/phase3-open-items.md
docs/status/implementation-status.md
docs/architecture/authorization.md
docs/adr/ADR-010-scoped-rbac-architecture.md
docs/audits/P4-R0-MVP-ROLE-SWITCH-REALITY-AUDIT.md
docs/audits/P4-V0-GATE-0.5-BASELINE-VERIFICATION.md
docs/audits/P4-C1-AUTHORIZATION-RESIDUE-CLEANUP.md
docs/audits/P4-C2-FRONTEND-CAPABILITY-GATING.md
docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md
docs/audits/P4-C3-INDEPENDENT-REVIEW.md
docs/audits/P4-C3-CORRECTIVE-1.md
docs/audits/P4-C3-CORR1-INDEPENDENT-REVIEW.md
docs/archive/phase3/RBAC-M10-F-FINAL-VERIFICATION-1.md
docs/archive/phase3/p4-mvp-rbac-route-matrix.md
```

Authority order for conflicts (task §2): current executable code and tests >
current architecture and roadmap authority > accepted ADR > current independent
audits > historical archived reports.

**Conflicts found: NONE.** The historical archived matrix
(`docs/archive/phase3/p4-mvp-rbac-route-matrix.md`, commit `286e79d`) describes
the pre-cutover state (~57 routes still on legacy `requireRole`); it is
explicitly superseded by current code and was consulted only to confirm what
changed. The 131-raw-vs-91-source count difference is fully explained by the 40
Fastify auto-generated HEAD aliases (§6). No tier conflict exists.

---

## 4. Cumulative diff-scope audit

Pre-C1 base to HEAD (`6711b2b..HEAD`), `git diff --name-status`:

```text
A  apps/api/src/authz/routeRegistryConformanceWholeApp.test.ts   (C1 regression lock)
M  apps/api/src/plugins/auth.ts                                  (C1: remove dead requirePermission)
M  apps/api/src/plugins/authz.ts                                 (C1: _isScoreCapability tag)
M  apps/api/src/types/fastify-auth.d.ts                          (C1: remove requirePermission type)
M  apps/api/src/types/requestContext.ts                          (C1: doc comment)
A  apps/e2e/e2e/candidate-admin-boundary.spec.ts                (C3 candidate boundary)
A  apps/e2e/e2e/teacher-authorization-boundary.spec.ts          (C3 Teacher negative; CORR1 F-3 hardened)
A  apps/e2e/e2e/teacher-product-path.spec.ts                    (C3 Teacher positive; CORR1 F-1/F-2)
M  apps/e2e/lib/login.ts                                         (C3 loginAsTeacher)
A  apps/e2e/lib/teacher.ts                                       (C3 createTeacherViaApi)
M  apps/web/src/components/layout/AdminLayout.tsx               (C2 per-route guard)
M  apps/web/src/components/layout/layout.test.tsx               (C2 integration tests)
M  apps/web/src/i18n/locales/zh-CN.ts                            (C2 accessDenied strings)
A  apps/web/src/lib/adminRouteCapabilities.test.ts              (C2 unit tests)
A  apps/web/src/lib/adminRouteCapabilities.ts                   (C2 route→capability map)
A  apps/web/src/pages/admin/AccessDeniedPage.tsx                (C2 403 page)
M  docs/adr/ADR-010-scoped-rbac-architecture.md                 (C1 doc: result.publish removed)
M  docs/architecture/authorization.md                           (C1 doc: users.role policy)
A  docs/audits/P4-C1-AUTHORIZATION-RESIDUE-CLEANUP.md           (C1 report)
A  docs/audits/P4-C2-FRONTEND-CAPABILITY-GATING.md              (C2 report)
A  docs/audits/P4-C3-CORRECTIVE-1.md                            (CORR1 report)
A  docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md                 (C3 report)
D  packages/auth/src/rbac.test.ts                               (C1: delete dead legacy test)
D  packages/auth/src/rbac.ts                                    (C1: delete dead legacy map)
M  packages/authz/src/catalog.ts                                (C1: remove ResultPublish)
```

Classification of every changed file (task §5):

```text
C1 authorization residue cleanup           packages/authz/src/catalog.ts
                                           packages/auth/src/rbac.ts (deleted)
                                           packages/auth/src/rbac.test.ts (deleted)
                                           apps/api/src/plugins/auth.ts
                                           apps/api/src/plugins/authz.ts
                                           apps/api/src/types/fastify-auth.d.ts
                                           apps/api/src/types/requestContext.ts
                                           docs/adr/ADR-010-scoped-rbac-architecture.md
                                           docs/architecture/authorization.md
C1 structural regression test              apps/api/src/authz/routeRegistryConformanceWholeApp.test.ts
C2 frontend route/action gating            apps/web/src/lib/adminRouteCapabilities.ts
                                           apps/web/src/pages/admin/AccessDeniedPage.tsx
                                           apps/web/src/components/layout/AdminLayout.tsx
                                           apps/web/src/i18n/locales/zh-CN.ts
C2 frontend tests                          apps/web/src/lib/adminRouteCapabilities.test.ts
                                           apps/web/src/components/layout/layout.test.tsx
C3/CORR1 E2E evidence                      apps/e2e/lib/login.ts
                                           apps/e2e/lib/teacher.ts
                                           apps/e2e/e2e/teacher-product-path.spec.ts
                                           apps/e2e/e2e/teacher-authorization-boundary.spec.ts
                                           apps/e2e/e2e/candidate-admin-boundary.spec.ts
audit/status documentation                 docs/audits/P4-C1-AUTHORIZATION-RESIDUE-CLEANUP.md
                                           docs/audits/P4-C2-FRONTEND-CAPABILITY-GATING.md
                                           docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md
                                           docs/audits/P4-C3-CORRECTIVE-1.md
unrelated                                  (none)
out-of-scope                               (none)
```

**Blocking scope-violation sweep (task §5).** Forbidden classes verified ABSENT
across the P4 diff:

```text
[x] NO M11 resource-scope tables or columns
    (rg teacher_course|teacher_exam_assignments|course_staff|exam_proctor|
       grading_assignment over schema + apps + packages → 0 matches)
[x] NO scope_type/scope_resource_id columns
    (rg scope_type|scope_resource_id|scopeType|scopeResourceId → 0 matches)
[x] NO Teacher→Course / Teacher→Exam relationship authorization
[x] NO Proctor→Exam / Grader→Work assignment implementation
[x] NO P3 resultVisibility/answerVisibility behavior change
[x] NO P5 notification/email-runtime implementation
[x] NO custom roles
[x] NO multiTenant / SuperAdmin / tenant-switcher / organizationSlug-login
    implementation (all SuperAdmin/multiTenant matches are negative tests asserting
    these are NOT exposed: system.test.ts, auth.test.ts, testHelpers allowlist)
[x] NO new default Teacher seed
    (rg over e2e-seed.ts/demo-seed.ts/seed.ts → 0 "Teacher" grants)
[x] NO removed P2-1 text_response/rubric authoring re-added
    (git diff --name-only 6711b2b..HEAD | rg text_response|rubric|QuestionForm|authoring → none)
```

**Scope verdict: clean.** No unexplained out-of-scope production change.

---

## 5. Gate 0.5 re-verification

P4-V0 established the Gate 0.5 (M10-F post-PR-197 rerun) baseline. R1 re-ran the
committed whole-application conformance harness added by C1 plus the original
M10-F artifact:

**Commands executed (this audit):**

```bash
APP_MODE=test TEST_DB_ISOLATION=worker-database \
  pnpm --filter @exam/api exec vitest run \
    src/authz/routeRegistryConformance.test.ts \
    src/authz/routeRegistryConformanceWholeApp.test.ts
```

**Result:** `2 files · 85 tests · 85 passed · 0 skipped · exit 0`

- `routeRegistryConformance.test.ts` — **75 passed** (the original M10-F artifact;
  registers the 17 M10-A/B/C/D route plugins, asserts per-route metadata against
  `ROUTE_PERMISSION_REGISTRY`, negative control proves the classifier detects a
  synthetic `requireRole` gate).
- `routeRegistryConformanceWholeApp.test.ts` — **10 passed** (the C1 whole-app
  regression lock; registers the **full production composition** via
  `registerApiRoutes(app)` inside a Fastify app built with the production auth
  plugins, attaches an `onRoute` capture hook, and asserts over every primary
  route). This is the committed full-production-composition conformance harness
  referenced by task §6.

**Runtime inventory observed (re-derived, not grep):**

```text
raw registration count           131
HEAD alias count                  40  (one per GET; excluded from primary count)
primary route count               91
flat gate count                   65  (requireCapability)
resource-aware gate count         16  (5 scoped + 1 score_capability +
                                       1 candidate_context + 3 exam_eligibility +
                                       6 own_attempt)
authenticate-only count            4  (/auth/me, /auth/me/password, /auth/me/profile,
                                       /client-events)
public/disabled count              6  (/auth/login, /auth/logout, /auth/register [disabled],
                                       /settings/branding, /system/info, /system/public-config)
registry MATCH count              81  (every protected runtime route ↔ registry MATCH)
runtime-only count                 0
registry-only count                0
gate mismatch count                0
capability mismatch count          0
unknown/unclassified count         0
```

The 91 primary routes reconcile exactly to the contract's `91 / 81 / 10`
(81 capability/ownership-gated + 10 non-gated). The 16 resource-aware gates
include the one `_isScoreCapability`-tagged dedicated score gate on
`GET /api/scores/attempts/:attemptId` — the introspection gap closed by C1.

**Gate 0.5 result: PASS (remains PASS after C1-C3-CORR1).** No count was forced;
the observed runtime result is authoritative.

---

## 6. Runtime route and registry inventory

The complete normalized runtime route table is the §7 tables of
`docs/audits/P4-V0-GATE-0.5-BASELINE-VERIFICATION.md` (the prior PASS evidence).
R1 re-derived the aggregate totals above (§5) from the live composition; the
per-route reconciliation is identical because no route, preset, registry entry,
or gate changed between V0 and HEAD (the only api changes in the P4 series are
dead-code removal and one introspection-only tag — both verified to leave the
route inventory unchanged by the 85/85 conformance run).

Authoritative category summary (re-derived in §5):

```text
A — flat capability gate            65 routes   (requireCapability)
B — scoped/resource-aware gate     16 routes   (scoped/score/candidate/eligibility/own)
C — authenticate-only               4 routes   (self/telemetry)
D — public                         5 routes   (pre-login / credential)
E — intentionally disabled public   1 route    (POST /api/auth/register)
F — unknown / unclassified          0 routes
```

Reconciliation with the registry (`ROUTE_PERMISSION_REGISTRY`, 81 entries):
**81/81 MATCH, 0 drift in every dimension.**

---

## 7. Legacy-authority regression audit

Commands executed (task §7):

```bash
rg -n "requireRole|_isRequireRole" apps packages --glob '!**/*.test.*'
rg -n "requirePermission|_isRequirePermission" apps packages --glob '!**/*.test.*'
rg -n "ctx\.role|request\.ctx\.role|user\.role|jwt.*role|role ===|role !==|roles\.includes" \
  apps/api packages --glob '!**/*.test.*'
rg -n "getPermissionsForRole|packages/auth/src/rbac|legacyMap" apps packages
```

**Classification of every match (non-exhaustive, representative):**

| Match site | Classification | Runtime authority? |
| --- | --- | --- |
| `apps/api/src/plugins/auth.ts` `requireRole` decorator + `_isRequireRole` tag + the `if (!roles.includes(ctx.role))` body | **MIGRATION RESIDUE (decorator)** — retained ONLY as the test-fixture seam for the whole-app regression lock's negative control (C1 §4). 0 route consumers (verified source + runtime via §5). | **No** |
| `apps/api/src/openapi/swagger.ts:36` `app.decorate("requireRole", () => async () => {})` | **SCRIPT ONLY** — no-op stub so OpenAPI spec generation can register flipped routes; never runs in the runtime server. | **No** |
| `apps/api/src/plugins/auth.ts:123,168,172,180-189` `ctx.role`/`roles` projection + JWT-role drift telemetry | **COMPATIBILITY PROJECTION / TELEMETRY** — `ctx.capabilities` is authoritative; the JWT-role mismatch log explicitly "must NEVER widen access". | **No** |
| `apps/api/src/routes/auth.ts:193,208,437,584` `role: user.role`/`ctx.role` in `/login`, `/me`, `/me/profile` response payloads | **DOMAIN DATA / DISPLAY** — API returns the primary role to the frontend; the frontend uses capabilities for gating. | **No** |
| `apps/api/src/routes/user.ts:179` `role: user.role` in user-list response | **DOMAIN DATA / DISPLAY** | **No** |
| `apps/api/src/routes/roleAssignments.ts` `action: "user.role_changed"` | **DOMAIN DATA (audit log strings)** | **No** |
| `apps/api/src/routes/scores.ts:77,163,473` comments documenting the removal of the old role-string branch | **COMMENT (negative evidence)** | **No** |
| `apps/api/src/authz/shadow.ts:86` `gate.includes(ctx.role)` inside `legacyAllows` | **ADVISORY ONLY** — shadow mode records drift between legacy and capability sides; `decision` mirrors the capability side; **never returns a decision to a production caller** (shadow.ts:107-143). | **No** |
| `apps/api/src/scripts/reset-admin-password.ts` reads active **assignment** rows | **SCRIPT ONLY** — and notably uses assignment-backed authority, not `users.role`. | **No** |
| `packages/authz/src/legacyMap.ts` + `index.ts` re-export | **MIGRATION COMPATIBILITY RESIDUE** — KEPT per P4-R0 §4.3-C; 0 runtime consumers (only its own test + catalog/index re-export reference it). | **No** |
| frontend `UsersPage.tsx`, `capabilities.ts`, `AuthContext.tsx` role picker / landing-path / display | **DOMAIN DATA / DISPLAY** — backend authoritative; frontend gating is UX-only. | **No** |

Closure conditions (task §7):

```text
[x] 0 active requireRole route preHandlers         (source + runtime §5)
[x] 0 active requirePermission route consumers     (decorator deleted in C1)
[x] 0 users.role authorization decisions           (compat projection only)
[x] 0 JWT-role authorization decisions             (telemetry only)
[x] 0 fallback from assignment authority to users.role
```

The explicitly-allowed retention (task §7): `users.role` compatibility
projection, JWT primary-role display claim, role-name display/editing UI,
migration compatibility types, and `legacyMap.ts` — all present, all documented,
all non-authoritative.

**Legacy-authority result: CLEAN.**

---

## 8. Assignment-authority audit

The runtime chain (re-verified against `apps/api/src/plugins/auth.ts:60-196` +
`apps/api/src/authz/assignmentAuthority.ts`):

```text
cookie "auth-token"
   │  (verifyJWT)
   ▼
authenticate (auth.ts:60)
   ├─ load user row (findByOrganizationAndId)
   ├─ if !user.isActive  → 401 AUTH_REQUIRED
   ├─ loadAssignmentAuthority(db, ctx, user.id)
   │     └─ userRoleAssignmentRepo.listActiveForUser(ctx, userId)  (filters by org)
   │     └─ deriveAssignmentAuthority(rows, orgId, userId)
   │           ├─ subject_mismatch      → {ok:false} → 503
   │           ├─ no_active_assignments → {ok:false} → 401
   │           ├─ unknown_role / zero_primary / multiple_primary → 503
   │           └─ union of permissionsForRole(role) over active roles → capabilities
   ├─ DB / loader-thrown error → 503 AUTHZ_UNAVAILABLE   (NEVER falls back to users.role)
   └─ request.ctx = { actorId, organizationId,
                      role(primary, compat), roles(active),
                      capabilities(authoritative), permissions([] legacy), sessionId }
        ↓
preHandler gate (requireCapability / requireScopedCapability / requireScoreCapability /
                 requireCandidateContext / requireExamEligibility / requireOwnAttempt)
   └─ reads ctx.capabilities  →  Allow / Deny
```

**Fail-closed modes (task §8) — each covered by passing repository-real suites:**

```text
[x] inactive user                 (auth.test.ts:249-323 → 401)
[x] no active assignments         (assignmentAuthorityRuntime E10 → 401)
[x] unknown role                  (assignmentAuthority.test.ts + E-series → 503)
[x] zero active primary           (assignmentAuthority.test.ts → 503)
[x] multiple active primary       (assignmentAuthority.test.ts → 503)
[x] subject mismatch              (assignmentAuthority.test.ts → 503)
[x] database/loader failure       (assignmentAuthorityRuntime db_error → 503)
[x] inactive assignment           (assignmentAuthorityRuntime E7 revocation)
[x] stale users.role              (assignmentAuthorityRuntime E-series — follows assignments)
[x] stale JWT role                (assignmentAuthorityRuntime E-series — telemetry only)
[x] multi-role capability union   (E17 scoped-gate + E19 ScoreAllView via secondary role)
[x] last-effective-admin removal  (adminInvariant.test.ts:7 tests)
```

**Targeted suites executed (this audit):**

```bash
APP_MODE=test TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 \
  pnpm --filter @exam/api exec vitest run \
    src/authz/assignmentAuthority.test.ts \
    src/authz/assignmentAuthorityRuntime.test.ts \
    src/authz/adminInvariant.test.ts \
    src/authz/scoreCapability.test.ts \
    src/authz/candidateContextCapability.test.ts \
    src/authz/examEligibilityCapability.test.ts \
    src/authz/ownAttemptCapability.test.ts \
    src/routes/permissionBoundary.test.ts \
    src/authz/adminSuperset.test.ts \
    src/authz/shadowParity.test.ts
```

**Result:** `10 files · 151 tests · 151 passed · 0 skipped · exit 0`

**Assignment-authority result: SOUND.** Fail-closed contract intact.

---

## 9. P4-C1 final audit

### Must be removed or closed (task §9)

| Symbol | Disposition | Evidence |
| --- | --- | --- |
| `ResultPublish` / `result.publish` | **CLOSED** | Removed from `packages/authz/src/catalog.ts` (C1). No route consumer, no grant. Catalog-closed-union test passes. |
| dead `requirePermission` runtime decorator surface | **CLOSED** | Removed from `apps/api/src/plugins/auth.ts` + type decl in `fastify-auth.d.ts` (C1). 0 route consumers. |
| dead `packages/auth` legacy RBAC runtime map + misleading assertions | **CLOSED** | `packages/auth/src/rbac.ts` + `rbac.test.ts` deleted (C1). 0 production importers. |

### Must remain (task §9)

| Symbol | Status | Evidence |
| --- | --- | --- |
| `ExamResultPublish` / `exam.result.publish` | **REMAINS — CLOSED** | `catalog.ts:72`; consumed by `POST /exams/:id/publish-results` (`exam.ts:1226`). Granted to Admin+Teacher (`presets.ts:95,139`). |
| `CandidateDelete` | **REMAINS — ACCEPTED_DEFERRED** | `catalog.ts:44`. Granted to Admin, no `DELETE /candidates/:id` route. Owner: future product decision (P4-G-04). |
| `SystemInfoView` | **REMAINS — ACCEPTED_DEFERRED** | `catalog.ts:121`. `GET /system/info` is public; no role needs it. Owner: future product decision (P4-G-04). |
| `GradingFinalize` / `GradingIdentityView` | **REMAINS — ACCEPTED_DEFERRED** | `catalog.ts:103-104`. Reserved for M11 scoped grading. Owner: M11. |
| `System*` capabilities | **REMAINS — ACCEPTED_DEFERRED** | `catalog.ts:126-128`. System-actor-only, bound to synthetic actor identities in deadlineScanner/heartbeat plugins; non-login, non-assignable. |
| `users.role` compatibility projection | **REMAINS — ACCEPTED_DEFERRED** | Documented in `authorization.md` §"users.role and JWT-role compatibility policy". 0 runtime authz decisions read it. |

### Must be documented (task §9)

```text
[x] CandidateDelete current disposition and owner       (catalog.ts:41-43 inline)
[x] SystemInfoView current disposition and owner        (catalog.ts:118-120 inline)
[x] GradingFinalize/GradingIdentityView → M11           (catalog.ts:99-102 inline)
[x] System* capabilities → System actor                 (catalog.ts:122-125 inline)
[x] users.role → compatibility/display projection only  (authorization.md §compat policy)
[x] JWT role → compatibility/display/telemetry only     (authorization.md §compat policy)
```

### Must be locked by test (task §9)

```text
[x] whole-production-composition 0 requireRole route assertion
    (routeRegistryConformanceWholeApp.test.ts: "no primary route carries a legacy
     requireRole preHandler (0 across the whole app)" — PASS)
[x] whole-production-composition 0 requirePermission route assertion
    (same file: "no primary route carries a legacy requirePermission preHandler" — PASS)
[x] protected routes classify into accepted capability/ownership gates
    (same file: "every protected route has exactly ONE capability/ownership gate" — PASS;
     "the full composition reconciles to 91 primary routes (81 + 10)" — PASS)
[x] negative control proves the classifier detects a synthetic role gate
    (same file: "negative control — the classifier detects a synthetic requireRole
     route (non-vacuity)" — PASS; synthetic route reports roleHandlerCount===1)
```

C1 verdict: **CLOSED within its accepted scope.** All must-remove items removed;
all must-remain items retained with documented owners; all must-document items
documented; all must-lock assertions live and passing.

---

## 10. P4-C2 final audit

Files inspected (task §10):

```text
apps/web/src/App.tsx
apps/web/src/components/layout/AdminLayout.tsx
apps/web/src/components/layout/ExamLayout.tsx
apps/web/src/lib/capabilities.ts
apps/web/src/lib/adminRouteCapabilities.ts
apps/web/src/pages/admin/AccessDeniedPage.tsx
apps/web/src/lib/adminRouteCapabilities.test.ts
apps/web/src/components/layout/layout.test.tsx
apps/web/src/lib/capabilities.test.ts
```

Verification (task §10):

```text
[x] every /admin/* route has a centralized capability contract
    (ADMIN_ROUTE_CAPABILITIES in adminRouteCapabilities.ts; coverage-integrity
     test asserts every App.tsx /admin/* child route is registered)
[x] parameterized and nested paths are handled safely
    (pattern-segment matcher matchAdminRoute; static-segment specificity so
     "exams/new" wins over "exams/:id"; "questions/import" wins over
     "questions/:id/edit")
[x] no fragile substring permission matching
    (pathMatchesPattern splits on "/" and compares per segment)
[x] unauthorized direct URLs do not render privileged pages
    (AdminLayout.tsx:124-125 routeDenied = relativePath !== null &&
     !canAccessAdminRoute(user, relativePath); renders <AccessDeniedPage />
     instead of <Outlet/> at AdminLayout.tsx:175)
[x] Teacher permitted pages render                      (E2E §11, teacher-product-path)
[x] Teacher denied pages render the documented AccessDenied behavior
    (E2E §11, teacher-authorization-boundary; per-route URL + admin-shell +
     privileged-heading-absence assertions all PASS)
[x] Candidate without console capabilities redirects to exam runtime
    (AdminLayout.tsx:107-116; E2E candidate-admin-boundary PASS)
[x] multi-role capability union controls shell/page access
    (layout.test.tsx candidatePlusTeacher tests)
[x] no route guard derives capabilities from user.role
    (canAccessAdminRoute reads can(user, perm); can() reads user.capabilities;
     capabilities.ts:4-13 never re-derives from presetFor(user.role))
[x] no frontend role-string authorization regression exists
    (capabilities.ts uses the API capability array verbatim)
```

**C2 tests executed (this audit):**

```bash
pnpm --filter @exam/web exec vitest run \
  src/lib/adminRouteCapabilities.test.ts \
  src/components/layout/layout.test.tsx \
  src/lib/capabilities.test.ts
```

**Result:** `3 files · 157 tests · 157 passed · 0 skipped · exit 0`

- `adminRouteCapabilities.test.ts` — **47 passed** (matcher specificity,
  route→capability resolution, Teacher ALLOW/DENY frozen-matrix, Candidate
  boundary, Grader/Proctor scoped surfaces, multi-role union, coverage integrity).
- `layout.test.tsx` — **47 passed** (direct-URL integration: Teacher DENY → 403
  page; Teacher ALLOW → page renders; Candidate redirected; multi-role union).
- `capabilities.test.ts` — **63 passed** (full per-role nav matrix, exam action
  matrix, default landing paths, multi-role shell reachability).

C2 verdict: **CLOSED.** Every `/admin/*` route has a centralized capability
contract; direct-URL denial renders the 403 page; no role-string route guards.

---

## 11. P4-C3 / CORR1 final audit

The latest independent C3 corrective review
(`docs/audits/P4-C3-CORR1-INDEPENDENT-REVIEW.md`) is **PASS** (hard prerequisite
met). R1 re-ran the executable evidence independently.

### Acceptance items (task §11)

```text
[x] Teacher created through supported Admin API
    (createTeacherViaApi → POST /api/users { role: "Teacher" }; teacher.ts:77-80)
[x] Teacher assignment is created by the product route
    (user.ts:149-173 executeInTransaction writes users + primary active Teacher assignment + audit)
[x] Teacher logs in through real browser UI
    (loginAsTeacher → loginViaUi → /login; teacher-product-path.spec.ts:106)
[x] Teacher landing is capability-driven
    (lands on /admin/exams via adminLandingPath; not a role string; :107)
[x] Teacher allowed navigation is visible
    (:111-115 exact link names: 课程管理/题目管理/题目导入/考试管理/成绩查询)
[x] Teacher denied navigation is hidden
    (:118-126 not.toBeVisible: 仪表盘/待评分/监考工作台/用户管理/平台设置)
[x] at least one meaningful Teacher mutation occurs through rendered UI
    (CORR1 F-1: exam create + publish both through browser UI — ExamCreatePage +
     ExamDetailPage; :148-258; waitForResponse captures POST /api/exams + 200/ok
     and POST /api/exams/:id/publish + 200)
[x] Teacher result authorization assertion is explicit and bounded
    (CORR1 F-2: expect([200,409]).toContain(status); if 409 assert
     body.error.code === "RESOURCE_CONFLICT" && details.reason ===
     "EXAM_NOT_FINISHED"; fails on 401/403/404/422/500/503; :274-285)
[x] Teacher denied management/grading/proctor/system APIs return exact 403
    (teacher-authorization-boundary.spec.ts:108-157; 6 probes each .toBe(403))
[x] Teacher denied direct URLs render the C2 denial contract
    (CORR1 F-3: per denied route — AccessDenied text + current URL unchanged +
     admin-layout shell visible + privileged heading toHaveCount(0); :76-102)
[x] Candidate management APIs return exact 403
    (candidate-admin-boundary.spec.ts; 3 probes .toBe(403))
[x] Candidate direct admin URLs are denied or redirected correctly
    (candidate-admin-boundary: /admin/users|exams|grading-queue → /exam/list)
[x] cross-candidate attempt and score probes use real foreign-owned resources
    (seeds a real 2nd candidate + real attempt; probes the real attempt id)
[x] cross-candidate probes return exact 404
    (anti-enumeration; .toBe(404) on GET /api/attempts/:id and
     GET /api/scores/attempts/:id)
[x] no direct-DB Teacher fixture
    (createTeacherViaApi uses POST /api/users only; no insert/jwt.sign in apps/e2e)
[x] no default Teacher seed
    (no "Teacher" grant in e2e-seed.ts/demo-seed.ts/seed.ts)
```

### Six-spec E2E re-run (this audit)

**Command (task §11):**

```bash
E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh \
  teacher-product-path teacher-authorization-boundary candidate-admin-boundary \
  candidate-happy-path resume-attempt submit-flush
```

**Observed output (verbatim tail):**

```text
Running 7 tests using 1 worker

  ✓  1 [chromium] › e2e/candidate-admin-boundary.spec.ts:26:3 › P4-C3 Candidate admin-console boundary › … (2.3s)
  ✓  2 [chromium] › e2e/candidate-happy-path.spec.ts:14:3 › candidate happy path › login → list → start → answer → save → submit → graded result (3.3s)
  ✓  3 [chromium] › e2e/candidate-happy-path.spec.ts:36:3 › candidate happy path › text_response answer … pending_manual (3.4s)
  ✓  4 [chromium] › e2e/resume-attempt.spec.ts:12:3 › resume active attempt path › answer → reload → resume … (3.2s)
  ✓  5 [chromium] › e2e/submit-flush.spec.ts:11:3 › submit-flush path › select answer then immediately submit … (1.3s)
  ✓  6 [chromium] › e2e/teacher-authorization-boundary.spec.ts:23:3 › P4-C3 Teacher negative-authorization boundary › … (1.6s)
  ✓  7 [chromium] › e2e/teacher-product-path.spec.ts:92:3 › P4-C3 Teacher positive product path › … (1.9s)

  7 passed (17.7s)
```

**Result:**

```text
project        chromium
spec files     6 (3 C3 + 3 existing blocking)
tests          7 (candidate-happy-path has 2)
passes         7
skips          0
retries        0 (retries: 0 in playwright.config.ts)
duration       17.7s
exit code      0
```

Confirmations (task §11):

```text
[x] all six intended spec files execute (no silent omission)
[x] zero skipped tests
[x] zero retries
[x] chromium project actually runs
[x] exit code 0
```

### E2E typecheck

```bash
pnpm --filter @exam/e2e typecheck
```

**Result:** PASS (exit 0; `tsc --noEmit` clean).

C3/CORR1 verdict: **CLOSED.** No skipped C3 test is counted as evidence; the
representative Teacher mutation is browser-driven; the result assertion is
explicit and bounded; the three-role negative boundaries and candidate
anti-enumeration are proven against real foreign-owned resources.

---

## 12. Final Admin / Teacher / Candidate matrix

Reconstructed from (a) role presets (`packages/authz/src/presets.ts`), (b) runtime
route gates (§5/§6 conformance capture), (c) frontend route metadata
(`adminRouteCapabilities.ts`), and (d) E2E evidence (§11) — not copied from
P4-R0 §12. Verdicts: **ALLOW** / **DENY** / **OWN** / **NOT_APPLICABLE** /
**DEFERRED_SCOPE**.

| Area | Action | Capability | Admin | Teacher | Candidate | Scope |
| --- | --- | --- | :---: | :---: | :---: | --- |
| user management | list/create/edit/delete users | `UserView/Create/Update/Delete` | ALLOW | DENY | DENY | org_global |
| user management | reset password | `UserPasswordReset` | ALLOW | DENY | DENY | org_global |
| role assignment | list assignable / assign / promote / deactivate / remove | `UserRoleAssign` (+`UserView`) | ALLOW | DENY | DENY | org_global |
| organization/settings | view/update settings + branding | `SettingsView`/`SettingsUpdate` | ALLOW | DENY | DENY | org_global |
| candidate fields | view/create/update/delete/template | `CandidateField*` | ALLOW | DENY | DENY | org_global |
| candidate management | list | `CandidateView` | ALLOW | **ALLOW** (read-only) | DENY | org_global |
| candidate management | create/update/import | `CandidateCreate/Update/Import` | ALLOW | DENY | DENY | org_global |
| course view/create/update | — | `CourseView/Create/Update` | ALLOW | ALLOW | DENY | org_global |
| course delete | — | `CourseDelete` | ALLOW | DENY | DENY | org_global |
| question CRUD/import | — | `QuestionView/Create/Update/Delete/Import` | ALLOW | ALLOW | DENY | org_global |
| exam view/create/update | — | `ExamView/Create/Update` | ALLOW | ALLOW | DENY | org_global |
| exam publish / close / publish-results | — | `ExamPublish`/`ExamClose`/`ExamResultPublish` | ALLOW | ALLOW | DENY | org_global |
| exam enrollment | list/add/remove/status | `ExamEnrollmentManage` | ALLOW | ALLOW | DENY | org_global |
| admin-only exam lifecycle | unpublish / extend / cancel / archive / delete | `ExamUnpublish`/`ExamExtend`/`ExamCancel`/`ExamArchive`/`ExamDelete` | ALLOW | DENY | DENY | org_global |
| grading | queue / detail / score-write | `GradingQueueView`/`DetailView`/`ScoreWrite` | ALLOW | DENY | DENY | DEFERRED_SCOPE (Grader role for M11 scoped) |
| proctoring | discover / attempts / events / incident / misconduct / force-submit / extend-time / timeline / export | `ExamRoomView`/`Attempt*` | ALLOW | DENY | DENY | DEFERRED_SCOPE (Proctor role for scoped) |
| all-score view | — | `ScoreAllView` | ALLOW | ALLOW | DENY | org_global |
| score export | — | `ScoreExport` | ALLOW | DENY | DENY | org_global |
| result publish | — | `ExamResultPublish` | ALLOW | ALLOW | DENY | org_global |
| candidate exam runtime | list own exams / start / take / save / submit / heartbeat / restore | `ExamTake`/`Attempt*` | NOT_APPLICABLE | NOT_APPLICABLE | **OWN** | own_attempt |
| candidate own score | view own score | `ScoreOwnView` + own-attempt arbitration | NOT_APPLICABLE | NOT_APPLICABLE | **OWN** | own_score |
| cross-candidate access | read/submit/grade another's attempt/score | — | NOT_APPLICABLE | NOT_APPLICABLE | **DENY (404 anti-enumeration)** | — |
| system/audit/diagnostics/import-logs/email-test | view / send | `SystemHealthView`/`SystemDiagnosticsView`/`AuditLogView` | ALLOW | DENY | DENY | org_global |

This matrix matches the frozen P4 contract (`docs/audits/P4-R0-MVP-ROLE-SWITCH-REALITY-AUDIT.md`
§12) exactly. No unexplained difference.

---

## 13. Gap Register closeout

Each P4-R0 gap individually reconciled (task §13):

| Gap | Area | Disposition | Evidence |
| --- | --- | --- | --- |
| **P4-B-01** | Gate 0.5 baseline verification | **CLOSED** | Gate 0.5 PASS (P4-V0); R1 re-verified via `routeRegistryConformance*` 85/85 (§5). `implementation-status.md` Known-limitations records PASS on commit `f2a7a80`. |
| **P4-G-01** | Teacher supported product path and E2E | **CLOSED** | C3/CORR1: Teacher created via `POST /api/users {role:"Teacher"}`; logs in via real `/login` UI; exam create + publish through rendered browser UI; result-surface assertion explicit and bounded. Six-spec E2E 7/7 (§11). |
| **P4-G-02** | frontend route/action capability gating | **CLOSED** | C2: centralized `ADMIN_ROUTE_CAPABILITIES` + `AdminLayout` per-route guard + `AccessDeniedPage`. C2 tests 157/157 (§10). |
| **P4-G-03** | three-role negative E2E | **CLOSED** | C3: Teacher UI/API denial (6 routes → 403 page + 6 APIs → exact 403); Candidate admin-console denial + anti-enumeration 404 (§11). |
| **P4-G-04** | dead/orphan catalog capabilities | **CLOSED (ResultPublish)** + **ACCEPTED_DEFERRED (CandidateDelete, SystemInfoView)** | `ResultPublish` removed (C1). `CandidateDelete`/`SystemInfoView` retained as unresolved product decisions with documented owner (§9). Distinguished per task §13 requirement. |
| **P4-G-05** | reserved grading/system capabilities documented | **CLOSED** | `GradingFinalize`/`GradingIdentityView` → M11 (catalog.ts:99-102); `System*` → System actor (catalog.ts:122-125); inline documentation (§9). |
| **P4-G-06** | legacy RBAC residue cleanup | **CLOSED** | `packages/auth/src/rbac.ts` + `rbac.test.ts` deleted; `requirePermission` decorator removed; `legacyMap.ts` retained as migration-compat residue with documented owner (§7, §9). |
| **P4-G-07** | users.role compatibility projection documented | **CLOSED** | `authorization.md` §"users.role and JWT-role compatibility policy" made explicit in C1; 0 runtime authz decisions read the column (§7). |
| **P4-G-08** | whole-app zero-requireRole regression lock | **CLOSED** | `routeRegistryConformanceWholeApp.test.ts` (C1): whole-production-composition sweep, 0 requireRole / 0 requirePermission / negative-control non-vacuity. 10/10 PASS (§5, §9). |

Closure requires (task §13):

```text
[x] 0 P0
[x] 0 blocking P1
[x] 0 OPEN_BLOCKING gaps
[x] 0 REGRESSED gaps
[x] accepted-deferred P2 items have owner and rationale
    (CandidateDelete/SystemInfoView → future product decision, P4-G-04;
     GradingFinalize/GradingIdentityView → M11 scoped grading;
     System* → System actor;
     users.role → compatibility/display projection only;
     legacyMap.ts → migration-compat residue, P4-R0 §4.3-C)
```

None of the accepted-deferred items widens access; each has an explicit owner
and is recorded honestly.

---

## 14. Accepted-deferred findings

The P2 items that remain visible after closure, each with owner + rationale,
none widening access:

```text
CandidateDelete (candidate.delete):
  Owner: future product decision (P4-G-04).
  Rationale: granted to Admin but no DELETE /candidates/:id route exists today.
  Non-blocking: the grant has no enforcement surface; removing it is a separate
  authorized product decision, not P4-C1 scope.

SystemInfoView (system.info.view):
  Owner: future product decision (P4-G-04).
  Rationale: GET /system/info is public; no role needs the permission.
  Non-blocking: the capability is unused at runtime.

GradingFinalize / GradingIdentityView (grading.finalize / grading.identity.view):
  Owner: M11 scoped grading.
  Rationale: omitted from all human presets by design (scoped finalize +
  double-blind identity); no route consumer today.
  Non-blocking: reserved for M11; C1 must not remove them (P4-R0 §6.3).

System* (system.auto_submit / system.heartbeat_scan / system.lifecycle_reconcile):
  Owner: System actor.
  Rationale: bound to synthetic actor identities in deadlineScanner / heartbeat
  plugins; non-login, non-assignable; never reach the assignment-authority path.
  Non-blocking: not human HTTP-route permissions.

users.role column + writes:
  Owner: compatibility/display projection.
  Rationale: non-authoritative cache mirrored by roleSync on every primary-active
  assignment mutation; 0 runtime authz decisions read it.
  Non-blocking: deprecating the column is a later decision, not P4.

legacyMap.ts:
  Owner: migration-compatibility residue (P4-R0 §4.3-C).
  Rationale: bridges legacy SCREAMING_SNAKE keys to dotted PermissionKey during
  migration; 0 runtime consumers (only its own test + catalog/index re-export).
  Non-blocking: deletion not authorized unless the P4 authority explicitly
  permits it and all consumers are proven absent.

requireRole decorator (auth.ts):
  Owner: whole-app regression-lock test seam (C1 §4).
  Rationale: retained ONLY as the negative-control fixture for
  routeRegistryConformanceWholeApp.test.ts; 0 production route consumers.
  Non-blocking: its presence is what makes the "0 requireRole routes" assertion
  non-vacuous.
```

---

## 15. P3 handoff contract

The P3 result-publishing handoff is frozen (task §14). R1 did not re-decide
P3-owned semantics; it records the capability ownership and route seams for P3
to verify against.

**Required capability ownership (re-verified against current code):**

```text
Publish results:
  ExamResultPublish (exam.result.publish)
  route: POST /api/exams/:id/publish-results       (exam.ts:1222-1226)
  Admin: ALLOW (presets.ts:95)
  Teacher: ALLOW (presets.ts:139)
  Candidate: DENY

View all scores:
  ScoreAllView (score.all.view)
  route: GET /api/exams/:id/scores                  (scores.ts:268-272)
  Admin: ALLOW
  Teacher: ALLOW (presets.ts:140)
  Candidate: DENY

View own score:
  ScoreOwnView (score.own.view) + own-attempt arbitration
  route: GET /api/scores/attempts/:attemptId        (scores.ts:414-416, requireScoreCapability)
  Candidate: OWN
  cross-candidate: 404 (anti-enumeration; scoreCapability.ts:164-166)

Export scores:
  ScoreExport (score.export)
  route: GET /api/exams/:id/export/scores           (export.ts:35-39)
  Admin: ALLOW
  Teacher: DENY (not in preset)
  Candidate: DENY
```

**Required route seams (all present, all capability-gated):**

```text
POST /api/exams/:id/publish-results    → ExamResultPublish
GET  /api/exams/:id/scores             → ScoreAllView
GET  /api/scores/attempts/:attemptId   → requireScoreCapability (ScoreOwnView | ScoreAllView)
GET  /api/exams/:id/export/scores      → ScoreExport
```

R1 did **not** verify or alter (P3/P5 responsibilities — task §14):

```text
manual result publication semantics
after_grading behavior
resultVisibility
answerVisibility
standard-answer leakage
notifications
```

The closure report explicitly hands these seams and owners to P3 without
re-deciding them. P3 result-publishing closeout
(`docs/archive/roadmap/phase3-open-items.md` §P3) will verify result-visibility modes,
leak tests, and the Admin/Teacher/Candidate result-view matrix under the final
role model — using the frozen capability ownership recorded here.

---

## 16. Targeted test commands and results

All database-backed tests ran with the repository test configuration (`APP_MODE=test`,
`exam_test` database only, `TEST_DB_ISOLATION=worker-database` per AGENTS.md). No
destructive test touched the `exam` (dev) database.

### 16.1 Gate 0.5 conformance (the direct M10-F artifact + C1 whole-app lock)

```bash
APP_MODE=test TEST_DB_ISOLATION=worker-database pnpm --filter @exam/api exec vitest run \
  src/authz/routeRegistryConformance.test.ts src/authz/routeRegistryConformanceWholeApp.test.ts
```
→ `2 files · 85 tests · 85 passed · 0 skipped · exit 0` (§5).

### 16.2 Assignment-authority + capability-gate + boundary suites

```bash
APP_MODE=test TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 \
  pnpm --filter @exam/api exec vitest run \
    src/authz/assignmentAuthority.test.ts src/authz/assignmentAuthorityRuntime.test.ts \
    src/authz/adminInvariant.test.ts src/authz/scoreCapability.test.ts \
    src/authz/candidateContextCapability.test.ts src/authz/examEligibilityCapability.test.ts \
    src/authz/ownAttemptCapability.test.ts src/routes/permissionBoundary.test.ts \
    src/authz/adminSuperset.test.ts src/authz/shadowParity.test.ts
```
→ `10 files · 151 tests · 151 passed · 0 skipped · exit 0` (§8).

### 16.3 Route-level authorization matrices

```bash
APP_MODE=test TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 \
  pnpm --filter @exam/api exec vitest run \
    src/routes/examAuthoringCapability.test.ts src/routes/questionAuthoringCapability.test.ts \
    src/routes/candidateOwnership.test.ts src/routes/m10dPermissionBoundary.test.ts \
    src/authz/permissionMatrix.exam.test.ts src/authz/permissionMatrix.question.test.ts \
    src/authz/permissionMatrix.grading.test.ts src/authz/permissionMatrix.proctor.test.ts
```
→ `8 files · 178 tests · 178 passed · 0 skipped · exit 0`.

### 16.4 C2 frontend projection suites

```bash
pnpm --filter @exam/web exec vitest run \
  src/lib/adminRouteCapabilities.test.ts src/components/layout/layout.test.tsx \
  src/lib/capabilities.test.ts
```
→ `3 files · 157 tests · 157 passed · 0 skipped · exit 0` (§10).

### 16.5 E2E typecheck

```bash
pnpm --filter @exam/e2e typecheck
```
→ `PASS · exit 0` (§11).

---

## 17. E2E result

Command and result reproduced in §11. Summary:

```text
project        chromium
spec files     6 (3 C3 + 3 existing blocking)
tests          7
passes         7
skips          0
retries        0
duration       17.7s
exit code      0
```

The three existing blocking specs (candidate-happy-path, resume-attempt,
submit-flush) remain green — **no regression** from C1/C2/C3/CORR1.

---

## 18. `pnpm verify` result

**Exact command:**

```bash
pnpm verify
```

(`pnpm verify` expands to:
`pnpm format:check && pnpm lint && pnpm lint:copy && pnpm lint:arch &&
pnpm lint:db-config && pnpm lint:ui-gates && pnpm lint:eslint && pnpm typecheck
&& TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm coverage &&
pnpm build`.)

**Result: PASS · exit 0.** Every stage green:

```text
format:check        PASS — All matched files use Prettier code style!
lint (code-quality) PASS — Code quality checks passed.
lint:copy           PASS — ✅ No hardcoded business copy found.
lint:arch           PASS — Architecture checks passed.
lint:db-config      PASS — DB/test-config regression guards passed.
lint:ui-gates       PASS
lint:eslint         PASS
typecheck (turbo)   PASS — 17 successful / 17 total
coverage (turbo)    PASS — 16 successful / 16 total
build (turbo)       PASS —  9 successful /  9 total
```

**Coverage-stage per-package results** (the test-bearing stage; all packages
green, no threshold failure):

| Package | Test Files | Tests | Skips |
| --- | ---: | ---: | ---: |
| `@exam/api` | 122 | 1509 passed | 5 (redis-env) |
| `@exam/web` | 95 | 1221 passed | 0 |
| `@exam/exam-engine` | 23 | 398 passed | 0 |
| `@exam/db` | 23 | 244 passed | 0 |
| `@exam/contracts` | 9 | 210 passed | 0 |
| `@exam/authz` | 9 | 63 passed | 0 |
| `@exam/auth` | 2 | 13 passed | 0 |
| `@exam/domain` | 3 | 12 passed | 0 |
| `@exam/import-export` | 1 | 17 passed | 0 |

The 5 skips are the documented Redis-environment skips
(`apps/api/src/routes/redis.test.ts`, gated on `REDIS_URL not set`) —
authorization-irrelevant. The `@exam/api` count is 122 (was 121; +1 for the C1
`routeRegistryConformanceWholeApp.test.ts`); `@exam/auth` is 2 (was 3; −1 for
the deleted `rbac.test.ts`). No failed package/task. No `ELIFECYCLE` markers.

**The complete repository gate `pnpm verify` was directly executed and passed
(exit 0).**

---

## 19. Scope-leak audit

Forbidden scope classes verified ABSENT across the P4 diff (§4) and across the
current tree:

```text
[x] no M11 resource-scope tables or columns
    (teacher_course / teacher_exam_assignments / course_staff / exam_proctor /
     grading_assignment / scope_type / scope_resource_id → 0 matches in schema
     or apps/packages source)
[x] no Teacher→Course / Teacher→Exam relationship authorization
[x] no Proctor→Exam / Grader→Work assignment implementation
[x] no P3 resultVisibility / answerVisibility behavior change
[x] no P5 notification or email-runtime implementation
[x] no custom roles
[x] no multiTenant / SuperAdmin / tenant-switcher / organizationSlug-login
    implementation
[x] no new default Teacher seed
[x] no removed P2-1 text_response/rubric authoring re-added
```

No M11, P3, P5, or platformization scope leaked into P4.

---

## 20. Closure checklist

```text
[x] C3 CORR1 independent review passed                (verdict PASS, prerequisite met)
[x] Gate 0.5 remains PASS                              (§5: conformance 85/85)
[x] runtime route inventory fully reconciles           (§5/§6: 91 = 81 + 10; 81/81 MATCH)
[x] 0 requireRole runtime route consumers              (§5/§7: source + runtime)
[x] 0 requirePermission runtime route consumers        (§5/§7: decorator deleted)
[x] 0 users.role/JWT-role authority decisions          (§7: compat projection + telemetry only)
[x] assignment authority remains fail-closed           (§8: 151/151 targeted suites)
[x] C1 accepted scope is complete                     (§9)
[x] C2 route/action gating is complete                (§10: 157/157 frontend suites)
[x] C3 three-role E2E is complete                     (§11: 7/7 E2E)
[x] valid browser Teacher mutation is proven          (§11: exam create + publish via UI)
[x] bounded result assertion is proven                (§11: 200 | 409 EXAM_NOT_FINISHED)
[x] Candidate own-resource anti-enumeration is proven (§11: cross-candidate → 404)
[x] final role matrix matches the frozen contract     (§12)
[x] 0 P0 gaps                                         (§13)
[x] 0 blocking P1 gaps                                (§13)
[x] 0 OPEN_BLOCKING gaps                              (§13)
[x] accepted-deferred P2 items have owner and rationale (§13, §14)
[x] P3 handoff contract is frozen                     (§15)
[x] no M11/P3/P5/platformization scope leak           (§19)
[x] all targeted suites pass                          (§16)
[x] E2E set passes with 0 skips                       (§11/§17: 7/7, 0 skips)
[x] pnpm verify passes                                (§18: exit 0)
[x] documentation is internally consistent            (§3: no conflicts across tiers)
```

Every item passes.

---

## 21. Final recommendation

**PASS — P4 CLOSED.**

P4 (the Admin/Teacher/Candidate MVP role-switch Job) satisfies its final product
and architecture contract. The hard prerequisite (C3 CORR1 PASS) is met; Gate
0.5 remains PASS; the runtime route inventory reconciles exactly (91/81/10,
81/81 registry MATCH); legacy-authority surface is zero (0 requireRole, 0
requirePermission, 0 users.role/JWT-role authority decisions); assignment-backed
authority remains fail-closed across every tested failure mode; C1 residue
cleanup is complete within its accepted scope; C2 frontend route/action gating
is complete; C3/CORR1 three-role E2E is complete with a browser-driven Teacher
mutation and a bounded result assertion; the final role matrix matches the
frozen contract; every P4-R0 gap is closed or accepted-deferred with owner and
rationale; the P3 handoff contract is frozen; no M11/P3/P5/platformization
scope leaked; `pnpm verify` passes (exit 0); and the six-spec E2E set passes
with zero skips.

R1 modified only closeout documentation (this report + the minimal status /
roadmap / architecture updates in §22). No production code and no tests were
modified.

---

## 22. Authority-document updates (PASS only)

Because the verdict is PASS, the following minimal updates are made in this
commit. They record P4 = CLOSED with the tested commit, the closure date, a link
to this report, and the next authorized Job. They do **not** mark P3, P5-0,
P5-N1, or P6 closed, and do **not** rewrite unrelated roadmap history.

- `docs/status/implementation-status.md` — Phase 3 module table: P4 row marked
  CLOSED with tested commit `b4dc1d6`, closure date 2026-07-24, link to this
  report; next-authorized-Job pointer updated to P5-0.
- `docs/archive/roadmap/phase3-open-items.md` — P4 entry marked CLOSED with tested
  commit and link to this report.
- `docs/architecture/authorization.md` — MVP product-role boundary section
  records P4 CLOSED with tested commit and link to this report.

No archived report was modified.

---

## 23. Commit behavior

One docs-only commit will be created using repository conventions:

```text
docs(audit): close P4 role-switch module
```

The commit contains only:

```text
docs/audits/P4-R1-FINAL-INDEPENDENT-REAUDIT-AND-CLOSEOUT.md  (this report)
docs/audits/P4-C3-INDEPENDENT-REVIEW.md                      (prior untracked review, FAIL)
docs/audits/P4-C3-CORR1-INDEPENDENT-REVIEW.md                (prior untracked review, PASS)
docs/status/implementation-status.md                         (minimal P4 CLOSED update)
docs/archive/roadmap/phase3-open-items.md                            (minimal P4 CLOSED update)
docs/architecture/authorization.md                           (minimal P4 CLOSED update)
```

C1/C2/C3/CORR1 commits are not amended. No push, merge, or PR is performed.

---

## 24. Next authorized roadmap Job

```text
PASS — P4 CLOSED:
  Next authorized Job:
    P5-0 — Email delivery runtime hardening
```

Per `docs/archive/roadmap/phase3-open-items.md` "Module execution order":

```text
P4 (RBAC MVP role switch)            ← CLOSED by this audit
  → P5-0 (Email delivery runtime hardening)
  → P3 (result publishing closeout)
  → P5-N1 (Notification Inbox + result-published Email integration)
  → P6 (MVP ready closeout)
```

P5-0 is the exact next title and execution order from the current roadmap. This
audit does **not** begin P5-0. It does **not** claim P3, P5-0, P5-N1, or P6 is
closed.
