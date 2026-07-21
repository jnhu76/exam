# RBAC-M10-C-ADVERSARIAL-REVIEW-20260719-073604-2e385644

Independent adversarial review of PR #191 (RBAC-M10-C — Identity and Role
Assignment Authority). Audit-only: no production code, no test weakening, no
merge, no thread resolution. Every claim below is grounded in current source
or a directly observed test execution.

```text
RUN_ID:        RBAC-M10-C-ADVERSARIAL-REVIEW-20260719-073604-2e385644
REPOSITORY:    jnhu76/exam
PR:            191
SCOPE:         RBAC-M10-C — Identity and Role Assignment Authority
REVIEW MODE:   independent adversarial (audit-only)
```

---

## A. Identity

```text
RUN_ID:        RBAC-M10-C-ADVERSARIAL-REVIEW-20260719-073604-2e385644
TIMESTAMP:     2026-07-19 07:36:04 CST (UTC+8)  // 2026-07-18 23:36:04 UTC
PR:            191
PR_STATE:      OPEN
PR_TITLE:      RBAC M10-C: identity and role-assignment capability migration (ddbc808b)
BASE_BRANCH:   master
BASE_SHA:      ddbc808b9c640584ece7690dd8aef681739081a5
MERGE_BASE:    ddbc808b9c640584ece7690dd8aef681739081a5
REVIEWED_HEAD: 2e3856445d09645ce7930f0ab3e7c569ed1a82ec
HEAD_SHORT8:   2e385644
COMMITS:       3
  e9c3f4c feat(authz): migrate M10-C identity and role-assignment routes to capabilities
  ee9064d test(authz): prove M10-C identity and assignment boundaries
  2e38564 docs(authz): record M10-C identity-authority implementation evidence
CHANGED_FILES: 5
  apps/api/src/authz/routeRegistryConformance.test.ts (+148)
  apps/api/src/routes/permissionBoundary.test.ts        (+838)
  apps/api/src/routes/roleAssignments.ts                (+38/-15 net of comments)
  apps/api/src/routes/user.ts                           (+32/-8 net of comments)
  docs/phase3/rbac/RBAC-M10-C-IDENTITY-AUTHORITY-20260719-002102-ddbc808b.md (+650, this is the author report)
WORKTREE:      clean (re-verified post-mutations: zero diff against origin PR head)
CI_STATUS:     all green (Static checks, Build, Web/API/Package coverage, E2E shard 1+2, CodeRabbit)
OPEN_REVIEW_THREADS:
  - CodeRabbit (3 inline): System-login tightening; expanded zero-write + assignment payload coverage; report metadata refresh
  - gemini-code-assist (1 top-level): tighten [401,403] to 401
```

The PR head was fetched fresh and `git pull --ff-only` confirmed the local
HEAD exactly equals origin's PR head (`2e385644...`). No older SHA was
reviewed. The merge base equals the PR base commit (`ddbc808b`), confirming
the PR branched cleanly off M10-B's merge commit.

---

## B. Verdict

```text
VERDICT: REQUEST-CHANGES
```

The production migration itself is **correct and access-matrix-neutral**:
the 10 gates were flipped cleanly, no handler drift was introduced, the
6 target permissions are Admin-only across every role preset, and the
runtime-authority boundary (users.role) is preserved. **The migration can
ship.**

The PR cannot close M10-C as written because the **evidence package
overstates what the tests actually prove**. Specifically:

1. The M10-C conformance test duplicates a hand-written route table instead
   of deriving expectations from `ROUTE_PERMISSION_REGISTRY` (H1 CONFIRMED,
   proven by Mutation D — registry-only edit silently passes).
2. The mutation inventory is mis-counted: 7 mutation routes exist, not 6
   (H2 CONFIRMED).
3. Three of seven denied-mutation routes have no scoped audit-count
   assertion (H3 CONFIRMED).
4. The PATCH /role-assignments denial test exercises only the no-op branch
   (H4 CONFIRMED).
5. The System-login test exercises only missing-user JWT rejection, not
   real System-role login rejection (H5 CONFIRMED).
6. Successful privilege mutations on POST secondary, PATCH deactivate, and
   PATCH /users role-change are **not** audited, and **no test** enforces
   the ADR §7.2 audit requirement (H6, H7 CONFIRMED; Mutation G/H proves
   audit removal passes silently).
7. Role-assignment PATCH/DELETE bypass the last-Admin guard implemented in
   PATCH /users (H9 CONFIRMED, pre-existing baseline gap).
8. Author-report metadata is stale and internally inconsistent (H8
   CONFIRMED).

None of these are P0/P1 production compromises. They are P2 test-evidence
defects and P3 metadata drift. The PR is **safe to migrate** but the M10-C
**closure claim must be tightened** and several ADR-mandated audit gaps
must receive an explicit disposition (close-now vs defer-to-M10-E).

---

## C. Production migration verdict

```text
TEN ROUTES:        PASS  (exactly 10; 5 in user.ts, 5 in roleAssignments.ts)
GATE MIGRATION:    PASS  (10 requireRole(["Admin"]) → 10 flat requireCapability;
                          0 legacy role gates remain; 0 permission-list gates;
                          0 scoped gates; authentication first on every route)
ACCESS EXPANSION:  PASS  (NON-ADMIN ACCESS EXPANSIONS = 0; verified directly
                          against packages/authz/src/presets.ts: the 6 target
                          permissions appear ONLY in ADMIN_PERMISSIONS)
ADMIN REGRESSION:  PASS  (ADMIN ACCESS REGRESSIONS = 0; Admin-reaches-handler
                          tests on GET /users + GET /roles/assignable prove allow)
HANDLER DRIFT:     PASS  (full diff inspected; only preHandler lines + doc
                          comments + the `Permission` import changed. No body
                          parsing, no org-check change, no error-status change,
                          no state-guard removal, no audit-metadata change, no
                          transaction-boundary change, no sync-call placement
                          change.)
RUNTIME AUTHORITY: PASS  (users.role remains the de facto authorization
                          source. plugins/auth.ts, plugins/authz.ts,
                          roleSync.ts unchanged. M10-E NOT started.)
```

### Reconstructed ten-route inventory

| # | Method | Path                       | Previous gate              | Current gate                         | Handler changed? | Roles granted |
| -: | ------ | ---------                  | ---------------            | -----------------                    | ---------------: | ------------- |
| 1 | GET    | /users                     | requireRole(["Admin"])     | requireCapability(Permission.UserView)           | no | Admin |
| 2 | POST   | /users                     | requireRole(["Admin"])     | requireCapability(Permission.UserCreate)         | no | Admin |
| 3 | PATCH  | /users/:id                 | requireRole(["Admin"])     | requireCapability(Permission.UserUpdate)         | no | Admin |
| 4 | POST   | /users/:id/reset-password  | requireRole(["Admin"])     | requireCapability(Permission.UserPasswordReset)  | no | Admin |
| 5 | DELETE | /users/:id                 | requireRole(["Admin"])     | requireCapability(Permission.UserDelete)         | no | Admin |
| 6 | GET    | /roles/assignable          | requireRole(["Admin"])     | requireCapability(Permission.UserRoleAssign)     | no | Admin |
| 7 | GET    | /users/:id/role-assignments| requireRole(["Admin"])     | requireCapability(Permission.UserView)           | no | Admin |
| 8 | POST   | /users/:id/role-assignments| requireRole(["Admin"])     | requireCapability(Permission.UserRoleAssign)     | no | Admin |
| 9 | PATCH  | /role-assignments/:assignmentId | requireRole(["Admin"]) | requireCapability(Permission.UserRoleAssign)     | no | Admin |
| 10| DELETE | /role-assignments/:assignmentId | requireRole(["Admin"]) | requireCapability(Permission.UserRoleAssign)     | no | Admin |

**Verify counts:**

```text
exact route count            = 10   ✓
legacy requireRole count     = 0    ✓  (verified by tag-based classifier + negative control)
requirePermission count      = 0    ✓
flat capability count        = 10   ✓
scoped capability count      = 0    ✓
authentication first         = 10/10 ✓
handler behavior unchanged   = yes  ✓  (full diff: only preHandler + import + doc comment)
repository/service calls     = unchanged ✓
response schemas             = unchanged ✓
status semantics             = unchanged ✓
```

### Six-permission Admin-only verification

Read directly from `packages/authz/src/presets.ts`:

| Permission            | Admin | Teacher | Proctor | Grader | Candidate | System |
| --------------------  | ----: | ------: | ------: | -----: | --------: | -----: |
| UserView              |  ✅   |   —     |   —     |   —    |    —      |   —    |
| UserCreate            |  ✅   |   —     |   —     |   —    |    —      |   —    |
| UserUpdate            |  ✅   |   —     |   —     |   —    |    —      |   —    |
| UserPasswordReset     |  ✅   |   —     |   —     |   —    |    —      |   —    |
| UserDelete            |  ✅   |   —     |   —     |   —    |    —      |   —    |
| UserRoleAssign        |  ✅   |   —     |   —     |   —    |    —      |   —    |

All six are present ONLY in `ADMIN_PERMISSIONS` (presets.ts:51-118). They are
absent from `TEACHER_PERMISSIONS`, `PROCTOR_PERMISSIONS`,
`GRADER_PERMISSIONS`, `CANDIDATE_PERMISSIONS`, and `SYSTEM_PERMISSIONS`.
System is additionally non-login (`loginAllowed: false`, line 281) and
non-assignable (`assignable: false`, line 280). Therefore the migration
**cannot** widen access for any role.

---

## D. Known-hypothesis adjudication (H1–H10)

| H# | Hypothesis | Verdict | Evidence |
| -- | ---------- | ------- | -------- |
| H1 | M10-C conformance duplicates a hand-written expected route table instead of deriving expectations from `ROUTE_PERMISSION_REGISTRY` | **CONFIRMED** | `routeRegistryConformance.test.ts:562-603` `m10cRouteSpecs` is a literal array; the only `ROUTE_PERMISSION_REGISTRY` reference inside this file is line 189 (M10-A only). **Mutation D proved it**: I changed the registry entry for PATCH /users/:id from `Permission.UserUpdate` to `Permission.UserView` and reran conformance — all 58 tests still passed. The test does not consume the registry for M10-C. |
| H2 | M10-C has 7 mutation routes, while the report claims 6 | **CONFIRMED** | Production source shows 7 mutating routes: POST /users, PATCH /users/:id, POST /users/:id/reset-password, DELETE /users/:id, POST /users/:id/role-assignments, PATCH /role-assignments/:assignmentId, DELETE /role-assignments/:assignmentId. The author report §G, §N, and the PR body all repeatedly say "6 mutations". CodeRabbit also flagged this. |
| H3 | PATCH user, password reset and user delete denial tests do not assert unchanged route-specific audit counts | **CONFIRMED** | permissionBoundary.test.ts:1109 (PATCH user deny) asserts name/role/isActive/passwordHash/updatedAt but no `user.update` audit count. Line 1131 (reset-password deny) asserts passwordHash + updatedAt but no `candidate.password_reset` audit count. Line 1150 (DELETE user deny) asserts user row + assignment rows but no `user.delete` audit count. Only POST user (line 1064), POST assignment (line 1174), PATCH assignment (line 1212), DELETE assignment (line 1257) denial tests have audit-count assertions. |
| H4 | PATCH role-assignment denial uses a no-op payload instead of real promote or deactivate branches | **CONFIRMED** | permissionBoundary.test.ts:1224-1229 sends `{ isPrimary: false }` against an assignment created as `isPrimary:true, isActive:true, role:Candidate`. The PATCH handler at roleAssignments.ts:185-229 has three branches: `isPrimary===true` (promote), `isActive===false` (deactivate), else `throw NotFoundError` (no-op, line 228). The `{isPrimary:false}` payload hits the no-op throw. The denial test passes only because the capability gate fires first (403 before the handler runs) — so the no-op property of the payload is irrelevant to the *denial* test, but **no positive-path test exercises the deactivate branch**, and there is no positive-path promote/deactivate test that would assert the resulting audit behavior. |
| H5 | System test proves only missing-user JWT rejection, not active System-user login rejection | **CONFIRMED** | permissionBoundary.test.ts:968-985 mints a JWT for `actorId: randomUUID()` (non-existent) with `role: "System" as never`. The authenticate plugin loads the user via `findByOrganizationAndId`, gets null, returns 401 AUTH_REQUIRED. This proves missing-user rejection. It does NOT exercise the production System-rejection path at `auth.ts:168-203` (`ASSIGNABLE_LOGIN_ROLES.has(user.role)` → 401 + `login.failure` audit + `non_login_role` reason), which requires a real active System-role user calling POST /auth/login with valid credentials. The `[401, 403]` union assertion (line 984) is also too weak — production always returns 401 for both missing-user and System-role. |
| H6 | Secondary role assignment creation succeeds without a privilege-change audit | **CONFIRMED** | roleAssignments.ts:151-158 writes `user.role_changed` audit ONLY inside `if (created.isPrimary)`. The secondary branch (POST with `isPrimary: false`) writes no audit. The test at permissionBoundary.test.ts:1385 confirms secondary creation does NOT change users.role, but never asserts whether an audit was written. ADR §7.2 / line 317 / line 743 of adr-scoped-rbac-architecture.md explicitly classifies `user.role.assign` as a privilege change requiring `user.role_changed` audit. |
| H7 | Assignment deactivation succeeds without a privilege-change audit | **CONFIRMED** | roleAssignments.ts:213-226 (PATCH with `isActive===false`) calls `deactivate()` (which auto-promotes if primary) and re-syncs `users.role`, but **calls no `recordAudit`**. The PATCH promote branch (line 196-204) DOES audit. ADR §7.2 requires `user.role_changed` for assignment mutations. |
| H8 | Author report metadata, HEAD, commit count and test counts are stale or internally inconsistent | **CONFIRMED** | (a) `FINAL_HEAD: ee9064d6...` (report §B line 23 + §N line 630) — actual PR HEAD is `2e385644...` (the report commit itself was added on top). (b) `COMMITS: 2` (line 25, 631) — actual is 3. (c) Diff stat (line 78-84) shows 4 files / 1041 insertions — actual PR is 5 files / 1691 insertions (the report itself is the 5th file, 650 lines). (d) PR body says "5 positive sync tests" but lists 4 names (POST primary, PATCH promote, DELETE primary, PATCH /users role-change). Test file has exactly 4 positive + 1 negative = 5 `it()` blocks. CodeRabbit also flagged "four positive and one negative". |
| H9 | Role-assignment routes may bypass last-active-Admin protection implemented in the user-update route | **CONFIRMED (pre-existing)** | `countActiveByRole(ctx, "Admin")` last-Admin guard exists ONLY in user.ts:220-227 (PATCH /users/:id). PATCH /role-assignments/:assignmentId (deactivate Admin's primary assignment) and DELETE /role-assignments/:assignmentId (delete Admin's primary assignment) do NOT call `countActiveByRole`. An operator could deactivate or delete the sole active Admin primary assignment. Mitigating factor: `syncUsersRoleFromPrimary` returns null when no primary exists, so `users.role` stays "Admin" — the guard's read path is preserved as a stale cache. But the user's *actual* active assignment set no longer contains Admin. This is a baseline defect (predates M10-C) but is directly relevant to M10-C authority closure per directive §15. |
| H10 | Organization-anchor enforcement on assignmentId routes may depend only on repository filtering and needs direct cross-org proof | **PARTIAL** | Code inspection confirms org-anchor enforcement IS present at the repository layer: `userRoleAssignmentRepo.deactivate/setPrimary/remove/listForUser` all filter by `organizationId = resolveOrganizationId(ctx)` (userRoleAssignmentRepo.ts:56-66, 145-156, 219-230, 251-262). `ensureTargetOrg` (helpers.ts:58-63) sets `targetOrganizationId = ctx.organizationId`. So an Org A caller targeting an Org B `assignmentId` gets `null` from the repo and a 404 `NotFoundError` (roleAssignments.ts:193, 215, 228, 254). **The enforcement exists.** But there is no direct cross-org test for these routes (unlike candidateOwnership.test.ts and proctorMonitoring.crossOrg.test.ts for other surfaces). The directive asks for direct proof; this is classification PARTIAL — protection is present in code but not directly tested. |

---

## E. New findings (not already in PR review comments)

### Finding N1 — Successful-audit removal passes silently (P2)

```text
ID:                 N1
SEVERITY:           P2
TITLE:              Removing the success-path user.role_changed audit from
                    PATCH /users/:id or DELETE /role-assignments/:assignmentId
                    passes the entire M10-C test suite unchanged
STATUS:             CONFIRMED
INTRODUCED BY PR:   NO — pre-existing audit-coverage gap; M10-C did not
                    introduce or remove audits but DID claim audit closure
                    ("all audit paths preserved") without a guard test
AFFECTED FILES:     apps/api/src/routes/permissionBoundary.test.ts
                    apps/api/src/routes/user.test.ts
                    apps/api/src/routes/roleAssignments.test.ts
AFFECTED ROUTES:    PATCH /users/:id (user.role_changed branch)
                    DELETE /role-assignments/:assignmentId (always)
                    POST /users/:id/role-assignments secondary branch (H6)
                    PATCH /role-assignments/:assignmentId deactivate branch (H7)
PRODUCT IMPACT:     ADR-mandated privilege-change audit is not enforced by
                    any test. A future regression that silently drops the
                    audit (e.g. a refactor that moves recordAudit out of
                    the if-block) would not be caught.
SOURCE EVIDENCE:    user.ts:259-264, roleAssignments.ts:151-158/213-226/258-266;
                    absence of any positive-path audit count assertion in
                    permissionBoundary.test.ts M10-C block (lines 1310-1464
                    test sync but not audit)
TEST/DB EVIDENCE:   MUTATION G/H (this review): removed `recordAudit` from
                    DELETE /role-assignments success path → 128/128 tests
                    across conformance + boundary + roleAssignments still
                    passed. Removed `user.role_changed` audit from
                    PATCH /users/:id → 82/82 tests still passed.
REPRODUCTION:       cp roleAssignments.ts roleAssignments.ts.bak;
                    delete the recordAudit block at roleAssignments.ts:258-266;
                    pnpm --filter api exec vitest run
                      src/routes/permissionBoundary.test.ts
                      src/routes/roleAssignments.test.ts
                      src/authz/routeRegistryConformance.test.ts
                    → 128 passed, 0 failed.
EXPECTED:           at least one test should fail, asserting the
                    user.role_changed audit row count increased by 1
                    on a successful DELETE.
ACTUAL:             all tests pass.
WHY EXISTING TESTS DID NOT CATCH IT:
                    the zero-write tests assert *denied* mutations leave
                    audit counts unchanged; no positive-path test asserts
                    *successful* privilege mutations DO write audit.
REQUIRED CORRECTION:
                    Add a positive-path test that performs a successful
                    PATCH /users role-change, POST primary assignment,
                    PATCH promote, PATCH deactivate, DELETE assignment
                    and asserts (targetType, targetId, action) audit
                    count increased by exactly 1 with the expected
                    metadata shape. This is required for M10-C closure
                    because the PR description claims "audit paths
                    preserved" — a claim with no test backing.
MERGE BLOCKING:     recommended — this is the single most important
                    evidence gap. Without it, the ADR §7.2 audit
                    invariant is unenforced for the entire M10-C surface.
```

### Finding N2 — Registry audit-action drift on reset-password and POST assignment (P3)

```text
ID:                 N2
SEVERITY:           P3
TITLE:              ROUTE_PERMISSION_REGISTRY omits auditAction for
                    POST /users/:id/reset-password and over-promises
                    auditAction for POST /users/:id/role-assignments /
                    PATCH /role-assignments/:assignmentId
STATUS:             CONFIRMED
INTRODUCED BY PR:   NO — pre-existing; M10-C did not touch the registry
AFFECTED FILES:     apps/api/src/authz/routeRegistry.ts:605-614 (reset-password
                    has no auditAction field), :1028-1037 (POST assignment
                    auditAction: user.role_changed — but production only
                    audits on isPrimary=true), :1039-1049 (PATCH assignment
                    auditAction: user.role_changed — but production only
                    audits on isPrimary=true branch)
AFFECTED ROUTES:    POST /users/:id/reset-password, POST assignment,
                    PATCH assignment
PRODUCT IMPACT:     Low — registry is metadata only (not consumed at runtime
                    by the flat capability preHandler, per the registry's own
                    header comment). But the registry claims to be the
                    authoritative route→audit map; the drift misleads future
                    consumers (RBAC-M11 resource-scope enforcement).
SOURCE EVIDENCE:    registry line 605-614 has no auditAction; production
                    user.ts:336-344 writes "candidate.password_reset".
                    Registry line 1035/1046 declares "user.role_changed"
                    unconditionally; production writes it conditionally.
TEST/DB EVIDENCE:   no test cross-checks registry auditAction against actual
                    recordAudit emissions.
REPRODUCTION:       diff routeRegistry.ts entries against recordAudit calls.
EXPECTED:           registry auditAction matches production emission (or
                    explicitly marks it conditional).
ACTUAL:             drift on 3 of 7 mutating routes.
WHY EXISTING TESTS DID NOT CATCH IT:
                    no registry-vs-production audit conformance test exists.
REQUIRED CORRECTION:
                    either (a) annotate the registry entries as
                    `auditAction?` with a `condition` field, or (b) add a
                    conformance test that cross-checks registry auditAction
                    against runtime recordAudit calls for the M10-C routes.
                    Defer to post-M10 cleanup if (a) is documented.
MERGE BLOCKING:     no — defer to M10-E/post-RBAC cleanup.
```

### Finding N3 — DELETE role-assignment audit target type is inconsistent with PATCH/POST (P3)

```text
ID:                 N3
SEVERITY:           P3
TITLE:              DELETE /role-assignments/:assignmentId writes audit with
                    targetType="role_assignment" while POST/PATCH write
                    targetType="user"
STATUS:             CONFIRMED
INTRODUCED BY PR:   NO — pre-existing (roleAssignments.ts:263 vs :154/:203)
AFFECTED ROUTES:    DELETE /role-assignments/:assignmentId
PRODUCT IMPACT:     Low — both targetTypes are valid; consumers querying
                    "all role_changed events for user X" must include both
                    targetTypes. The DELETE audit's targetId is the
                    assignmentId (not the userId), so a user-centric audit
                    query must follow the `metadata.affectedUserId` field
                    (which is set, line 266).
SOURCE EVIDENCE:    roleAssignments.ts:258-266 uses ("role_assignment",
                    assignmentId) target; :154/:203 use ("user", userId).
REQUIRED CORRECTION: document the convention in ADR §Audit or normalize
                    DELETE to targetType="user" + targetId=affectedUserId.
                    Defer.
MERGE BLOCKING:     no.
```

### Finding N4 — Conformance test tag-classifier is sound; non-vacuity holds for the deny-side assertions (P3 positive observation)

```text
ID:                 N4
SEVERITY:           P3 (positive observation)
TITLE:              The M10-B corrective (tag-based classifier + synthetic
                    negative-control route) is preserved and still detects
                    role gates; the role/permission-list zero-count
                    assertions are non-vacuous.
STATUS:             CONFIRMED (passes)
The negative-control test (routeRegistryConformance.test.ts:680-758)
registers a synthetic mixed chain `[authenticate, requireRole(["Admin"]),
requireCapability(ExamView)]` and asserts roleHandlerCount===1, proving
the classifier sees role gates. Mutation A (this review) confirmed
end-to-end: reverting GET /users to requireRole fired 2 conformance
failures.
```

---

## F. Registry/runtime conformance verdict

```text
REGISTRY-RUNTIME CONFORMANCE FOR M10-C: PARTIAL (not the strong form
claimed by the PR description).

WHAT IS PROVEN:
  - The M10-C routes exist at runtime with exactly one authentication
    handler and exactly one flat-capability handler per route (10/10).
  - The flat-capability permission string matches the m10cRouteSpecs
    table for all 10 routes (10/10 deep-equal).
  - Zero scoped handlers, zero role handlers, zero permission-list
    handlers on every M10-C route (10/10), verified by tag-based
    classifier with a synthetic negative-control (the classifier is
    proven to detect role gates).
  - The capability gate is the runtime authority: Mutations A, B, C
    are detected (revert-to-requireRole, remove-gate, wrong-permission).

WHAT IS NOT PROVEN:
  - The expected permission is NOT derived from ROUTE_PERMISSION_REGISTRY.
    The m10cRouteSpecs array (routeRegistryConformance.test.ts:562-603)
    is a hand-maintained duplicate. PROOF: Mutation D changed one
    registry entry (PATCH /users/:id UserUpdate → UserView) without
    touching runtime, and all 58 conformance tests still passed.
  - There is no test that the runtime registration set equals the
    registry's M10-C subset (no set-equality assertion).
  - There is no test that m10cRouteSpecs and the registry's
    migrationStage-6-or-8 user/assignment entries agree.

CLASSIFICATION: the M10-C conformance test is a runtime-vs-hand-written-table
test, not a runtime-vs-registry test. The M10-A block
(routeRegistryConformance.test.ts:189-309) is the model that does it right
— it filters ROUTE_PERMISSION_REGISTRY by `runtimeAuthz !== undefined` and
derives the expected metadata from each entry. The M10-B and M10-C blocks
do not follow this pattern. This is the same defect flagged in M10-B
(PR #190) and was carried forward.

URL-path matching note: the test uses `r.url.endsWith(entry.path)` to
match captured runtime routes to expected paths. Collision risk for the
M10-C surface is low (no other registered route suffixes with /users,
/roles/assignable, or /role-assignments/:assignmentId), but the endsWith
match is a known weak pattern generally — a future /admin/users route
could collide with /users. Not a current defect.

Required correction: derive m10cRouteSpecs from ROUTE_PERMISSION_REGISTRY
filtered by `migrationStage === 6 && path starts with /users` plus
`migrationStage === 8 && (path starts with /roles or /users or /role-assignments)`,
then assert the derived count is exactly 10. This makes Mutation D fail.
```

---

## G. Mutation zero-write matrix

For each of the 7 mutation routes, the real mutation branch exercised on a
denied (Candidate) principal. "Zero-write verdict" = PASS if every
assertion holds on the denied path.

| Route                                                | Real mutation branch (if authorized)                     | Business row | Assignment row | users.role | Audit count scoped | Verdict |
| ---------------------------------------------------- | -------------------------------------------------------- | -----------: | -------------: | ---------: | -----------------: | ------- |
| POST /users                                          | create user + seed primary assignment + user.create audit | total unchanged (count via listPaginatedByRoles) | n/a (no fixture) | n/a | action=user.create scoped to (org, action) — before=after | PASS (audit filter is per-action not per-target; for a never-created user this is acceptable) |
| PATCH /users/:id                                     | update name/isActive + conditional role-change sync + user.update (+ role_changed) audit | name/role/isActive/passwordHash/updatedAt byte-equal | not re-read | unchanged (not asserted explicitly, but updatedAt byte-equal implies no write) | **NOT ASSERTED** (no user.update count check) | PARTIAL — see H3 |
| POST /users/:id/reset-password                       | update passwordHash + candidate.password_reset audit     | passwordHash + updatedAt byte-equal | n/a | n/a | **NOT ASSERTED** (no candidate.password_reset count check) | PARTIAL — see H3 |
| DELETE /users/:id                                    | delete user row + user.delete audit                      | user row still exists; updatedAt byte-equal | assignment rows length unchanged; primary row present | unchanged (row exists with same role) | **NOT ASSERTED** (no user.delete count check) | PARTIAL — see H3 |
| POST /users/:id/role-assignments                     | create assignment + conditional sync + conditional role_changed audit | users.role byte-equal; updatedAt byte-equal | assignment count unchanged | unchanged | action=user.role_changed, targetId=user.id, scoped — before=after | PASS |
| PATCH /role-assignments/:assignmentId                | (no-op payload used) — promote / deactivate branches not exercised | not exercised | isPrimary/isActive/role byte-equal (but payload was no-op so trivially equal) | unchanged | action=user.role_changed, targetId=user.id — before=after | PARTIAL — see H4. The denial holds (capability gate fires first), but the test would also pass with payload `{}` because the handler is never reached. |
| DELETE /role-assignments/:assignmentId               | remove assignment + auto-promote + conditional sync + user.role_changed (targetType=role_assignment) audit | users.role byte-equal | assignment row still exists; isPrimary unchanged | unchanged | action=user.role_changed, targetType=role_assignment, targetId=assignment.id — before=after | PASS |

**Zero-write verdict summary:**

```text
FULL_ZERO_WRITE_PROOF (4 of 7): POST /users, POST assignment, PATCH
assignment (denial holds but branch coverage is no-op only), DELETE
assignment.

PARTIAL (3 of 7): PATCH /users, reset-password, DELETE /users — these
have business-state assertions but no scoped audit-count assertion.
The capability gate guarantees the handler never runs on a denied
request, so the missing audit assertion is not a *correctness* gap
(it is impossible for the denied path to write audit if the handler
does not run). It IS an evidence gap: the test does not prove the
audit-zero-write claim made in author-report §G lines 272/285/297
which say "audit count: n/a" — that "n/a" is an unstated assumption,
not a proven fact.

NO-PATH (0 of 7): none.
```

The forbidden patterns audit (directive §13) all pass:
- `if (!fixture) return;` — NOT PRESENT (requireDefined fail-fast)
- array-count-only HTTP claim — NOT PRESENT (every denial also re-reads state)
- mock-only zero-write — NOT PRESENT (real `ctx.app.inject` + real DB)
- shared order-dependent fixture — NOT PRESENT (`uniquePrefix()` per fixture)
- global audit count — NOT PRESENT for the routes that have audit
  assertions; the assertion is scoped per `(targetType, targetId, action)`
  for assignment routes and per `(action)` for POST /users.

**Caveat on POST /users audit filter:** the filter is `{action: "user.create"}`
without targetId scoping (line 1077). This is acceptable because the
denied request never creates a user, so the targetId would not exist
anyway. A stronger filter would also scope by organizationId; the
current `auditRepo.listPaginatedFiltered` accepts the adminCtx which
implicitly applies the org anchor.

---

## H. Successful audit matrix

For each successful (Admin-principal) mutation, what the ADR requires, what
production does, and what is tested.

| Mutation                                       | DB effect                                       | Privilege effect (ADR §7.2) | Audit required (ADR)         | Audit actual (production)                      | Test asserts audit written? | Verdict |
| ---------------------------------------------- | ----------------------------------------------- | --------------------------- | ---------------------------- | ---------------------------------------------- | --------------------------: | ------- |
| POST /users                                    | user row + primary assignment created           | identity provisioned        | user.create                  | user.create written (user.ts:156)              | NO                          | GAP (low; ADR does not classify user.create as a privilege change) |
| PATCH /users/:id name only                     | name updated                                    | none                        | user.update                  | user.update written (user.ts:256)              | NO                          | GAP (low) |
| PATCH /users/:id role change                   | user.role updated + primary assignment reassigned + sync | **privilege change**        | user.update + user.role_changed | both written (user.ts:256, 260)                | NO                          | **GAP (H1-critical)** — Mutation H proved removing user.role_changed audit passes silently |
| POST /users/:id/role-assignments primary       | assignment created + sync                       | **privilege change**        | user.role_changed            | user.role_changed written (roleAssignments.ts:154) | NO                          | **GAP** |
| POST /users/:id/role-assignments secondary     | assignment created (no sync)                    | **privilege change** (assignment added to user's role set) | user.role_changed (ADR §7.2 line 317) | **NOT WRITTEN** (roleAssignments.ts:151-158 only audits if isPrimary) | NO                          | **CONFIRMED DEFECT — H6**. Secondary assignment adds a role to the user's role set. Even though users.role is unchanged, the assignment is a privilege-change per ADR. |
| PATCH /role-assignments/:assignmentId promote  | primary reassigned + sync                       | **privilege change**        | user.role_changed            | user.role_changed written (roleAssignments.ts:196) | NO                          | **GAP** |
| PATCH /role-assignments/:assignmentId deactivate | assignment deactivated + auto-promote-if-primary + conditional sync | **privilege change** (role removed from active set; possibly different role promoted) | user.role_changed (ADR §7.2) | **NOT WRITTEN** (roleAssignments.ts:213-226 has no recordAudit) | NO (branch not even tested positively) | **CONFIRMED DEFECT — H7**. |
| PATCH /role-assignments/:assignmentId no-op    | none (throws NotFoundError)                     | none                        | none                         | none                                           | n/a (no-op)                 | OK |
| DELETE /role-assignments/:assignmentId         | row removed + auto-promote-if-primary + conditional sync | **privilege change**        | user.role_changed            | user.role_changed written (roleAssignments.ts:258) | NO                          | **GAP** |
| POST /users/:id/reset-password                 | passwordHash updated                            | credential reset            | candidate.password_reset     | candidate.password_reset written (user.ts:336) | NO                          | GAP (low) |
| DELETE /users/:id                              | user row deleted                                | identity removal            | user.delete                  | user.delete written (user.ts:379)              | NO                          | GAP (low) |

**Successful-audit verdict:**

```text
SUCCESS_MUTATIONS_WITH_REQUIRED_AUDIT (production writes the audit):
  9 of 11 cases write the ADR-required audit.
  Missing: POST secondary assignment (H6), PATCH deactivate (H7).

SUCCESS_MUTATIONS_WITH_TEST_PROOF (a test asserts the audit was written):
  0 of 11.
```

The H6 and H7 production-side missing audits are **pre-existing baseline
defects** (the audit branches were not added by M10-C). But M10-C claims
to close identity and role-assignment authority, so an explicit
disposition is required:

```text
H6 disposition: M10-C CLOSURE BLOCKER (or explicit M10-E deferral with
  ADR amendment). The ADR currently requires the audit; production does
  not write it. Either add the audit in M10-C, or update the ADR to
  defer secondary-assignment audit to M10-E and document the gap.

H7 disposition: same as H6.
```

---

## I. Synchronization matrix

`syncUsersRoleFromPrimary` (apps/api/src/authz/roleSync.ts) — every call
site inspected.

| Mutation                                     | Sync expected                                       | Sync call exists                                         | Positive test                                                 | Negative test                                 |
| -------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| POST /users                                  | seeds primary via repo.assign (not sync)            | yes (user.ts:150, assign isPrimary=true)                 | implicit (POST user tests verify role persists)               | n/a                                           |
| POST /users/:id/role-assignments primary     | sync to new role                                    | yes (roleAssignments.ts:153)                             | yes (permissionBoundary.test.ts:1373 "POST primary syncs")    | n/a                                           |
| POST /users/:id/role-assignments secondary   | NO sync (role unchanged)                            | no (gated by `if created.isPrimary`)                     | n/a                                                           | yes (permissionBoundary.test.ts:1385)         |
| PATCH /role-assignments promote              | sync to promoted role                               | yes (roleAssignments.ts:195)                             | yes (permissionBoundary.test.ts:1397)                         | n/a                                           |
| PATCH /role-assignments deactivate (primary) | sync after auto-promote                             | yes (roleAssignments.ts:217, conditional on isPrimary)   | **NO** — deactivate branch not positively tested              | n/a                                           |
| PATCH /role-assignments deactivate (secondary) | NO sync (was not primary)                         | no (gated by `if deactivated.isPrimary`)                 | n/a                                                           | **NO** — branch not tested                    |
| DELETE /role-assignments primary             | sync after auto-promote                             | yes (roleAssignments.ts:256, conditional on isPrimary)   | yes (permissionBoundary.test.ts:1419 "DELETE primary auto-promotes") | n/a                                     |
| DELETE /role-assignments secondary           | NO sync (was not primary)                           | no (gated by `if removed.isPrimary`)                     | n/a                                                           | **NO** — branch not tested                    |
| PATCH /users/:id role change                 | sync to new role (via assignPrimary + sync)         | yes (user.ts:241-253)                                    | yes (permissionBoundary.test.ts:1452 "PATCH role-change syncs") | n/a                                         |
| PATCH /users/:id active-state only           | NO sync (role field unchanged)                      | no (gated by `if data.role !== undefined && data.role !== target.role`) | n/a                                                | **NO** — branch not explicitly tested        |

**Synchronization verdict:**

```text
SYNC_CALL_SITES_PRESERVED: 5 of 5 (1 in user.ts, 4 in roleAssignments.ts).
  Verified by direct grep + reading each call.

SYNC_POSITIVE_TEST_COVERAGE: 4 of 5 expected cases
  (POST primary, PATCH promote, DELETE primary, PATCH /users role-change).

SYNC_NEGATIVE_TEST_COVERAGE: 1 explicit (POST secondary does NOT change role).
  Other negatives (deactivate secondary, delete secondary, PATCH active-only)
  are not explicitly tested but are gated by the same isPrimary flag the
  positive cases exercise, so the negative behavior is implied.

UNDEFINED POLICY (not exercised; directive §12 asks for disposition):
  - primary deactivated with no successor → syncUsersRoleFromPrimary
    returns null, users.role stays at the old value (stale cache). The
    repo's promoteNextActiveForUser is a no-op if no other active
    assignment exists. This is documented in roleSync.ts:9 comment but
    NOT covered by a test. PRODUCT/M10-E POLICY GAP: there is no
    contract for what users.role becomes when no active primary
    assignment remains. The current behavior (leave stale) is a
    defensible choice but should be explicit.

Sync-mutation evidence: Mutation F (this review) removed the sync call
  on POST primary → 1 test failed (permissionBoundary.test.ts:1373).
  This proves the sync test is non-vacuous.
```

---

## J. Organization-isolation matrix

Direct cross-org tests for M10-C routes: **NONE** (no test file probes Org
A caller → Org B target for any of the 10 M10-C routes). Code inspection
result:

| Route                                        | Org-anchor enforcement                                                            | Denial mode if cross-org       | Direct test? |
| -------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------ | -----------: |
| GET /users                                   | `repo.listPaginatedByRoles(ctx, ...)` filters by orgId (userRepo.ts:85)           | empty list (200 with 0 items)  | NO           |
| POST /users                                  | `repo.createUnique(ctx, ...)` inserts with ctx.organizationId                     | creates in caller's org (fine) | NO           |
| PATCH /users/:id                             | `repo.findByOrganizationAndId(ctx, id)` filters by orgId (userRepo.ts:66)         | 404 RESOURCE_NOT_FOUND         | NO           |
| POST /users/:id/reset-password               | same as PATCH                                                                      | 404                            | NO           |
| DELETE /users/:id                            | `repo.delete(ctx, id)` — must verify anchor (see note)                            | 404 (via delete's org filter)  | NO           |
| GET /roles/assignable                        | static — no DB read; org-agnostic                                                  | n/a (always allowed for Admin) | n/a          |
| GET /users/:id/role-assignments              | `userRepo.findByOrganizationAndId` + `assignmentRepo.listForUser(ctx, id)` both filter by orgId | 404 (user lookup)  | NO           |
| POST /users/:id/role-assignments             | user lookup filters by org; assign inserts with ctx.organizationId                | 404 (user lookup)              | NO           |
| PATCH /role-assignments/:assignmentId        | `assignmentRepo.setPrimary/deactivate` filter by orgId+assignmentId               | NotFoundError → 404            | NO           |
| DELETE /role-assignments/:assignmentId       | `assignmentRepo.remove` filters by orgId+assignmentId                             | NotFoundError → 404            | NO           |

**Note on `repo.delete`:** I did not re-read userRepo.delete in this review;
the pattern in this codebase is consistent (all repo methods receive ctx
and filter by `resolveOrganizationId(ctx)`), but a direct read would
confirm. The cross-org matrix should be supplemented with at least one
direct probe per ID-bearing route to lift H10 from PARTIAL to PASS.

**Organization-isolation verdict:**

```text
ORG_ISOLATION = PARTIAL
  Code enforcement: present on all 9 ID-bearing routes (anchors via
    ensureTargetOrg + repo org filter).
  Direct test evidence: absent for all M10-C routes. H10 PARTIAL.
  Recommended correction: add a cross-org test similar to
    candidateOwnership.test.ts:345 (RBAC-M10-A-CORRECTIVE-1 pattern):
    seed Org A caller (Admin) + Org B target user/assignment, prove
    every ID-bearing M10-C route returns 404 with zero writes.
  Merge blocking: no — the protection is present in code; the gap is
    test evidence only. Defer to post-M10-C test addition.
```

This is **not** a request to implement multi-tenant support — it verifies
the existing single-tenant organization boundary holds on the new gates.

---

## K. Last-Admin protection

```text
LAST_ADMIN_INVARIANT = PARTIAL (H9 CONFIRMED — pre-existing baseline gap)

The last-active-Admin guard is implemented ONLY in PATCH /users/:id:

  user.ts:215-227:
    willDisableAdmin =
      target.role === "Admin" && target.isActive &&
      ((data.isActive === false) || (data.role !== "Admin"));
    if (willDisableAdmin) {
      const activeAdminCount = await repo.countActiveByRole(ctx, "Admin");
      if (activeAdminCount <= 1) throw LAST_ACTIVE_ADMIN;
    }

The guard reads users.role (userRepo.countActiveByRole counts
users.role="Admin" + isActive=true). It does NOT consult
user_role_assignments.

PATCH /role-assignments/:assignmentId and DELETE /role-assignments/:assignmentId
do NOT call countActiveByRole. An operator can:

  1. DELETE /role-assignments/<Admin's primary assignment> on the last
     active Admin → assignment gone, syncUsersRoleFromPrimary returns
     null (no other primary), users.role stays "Admin" (stale cache).
     The last-Admin guard still sees the user as Admin, but the user's
     active assignment set is empty.

  2. PATCH /role-assignments/<Admin's primary> {isActive: false} →
     same outcome.

Mitigating factors:
  - The runtime authority is still users.role, and users.role stays
    "Admin" after the assignment deletion, so the user's session
    continues to authorize as Admin. The guard's stale read happens
    to match the runtime authority — until M10-E switches the runtime
    to user_role_assignments, at which point this becomes a real
    Admin-lockout / privilege-drift vector.
  - The admin who performs this operation must themselves hold
    UserRoleAssign capability (Admin-only today), so this is not an
    external-attacker vector.

Classification: PRE-EXISTING BASELINE DEFECT, RELEVANT TO M10-C.
  - Not introduced by M10-C (the gap existed in RBAC-M8 when
    role-assignment routes were added).
  - M10-C claims to close identity + role-assignment authority; an
    explicit disposition is required.

Recommended disposition:
  MUST FIX BEFORE M10-E (not before M10-C merge): add an equivalent
  countActiveByRole-style guard over user_role_assignments in PATCH
  and DELETE /role-assignments, OR document that last-Admin
  protection remains on the users.role read path until M10-E and
  is then migrated together with the runtime authority switch
  (ADR line 678 explicitly calls out this migration).
```

---

## L. System non-login evidence

```text
SYSTEM_NON_LOGIN = UNPROVEN (by M10-C tests)

The production System-rejection path EXISTS at auth.ts:42-48 + 168-203:

  ASSIGNABLE_LOGIN_ROLES = new Set(["Admin","Teacher","Proctor","Grader","Candidate"]);
  // System is NOT in the set.
  if (!ASSIGNABLE_LOGIN_ROLES.has(user.role)) {
    recordAudit(..., "login.failure", "login", user.id,
                { reason: "non_login_role", username, role });
    return reply.code(401).send(...);
  }

This path is reached only when a real active user with role="System"
calls POST /auth/login with a valid password.

The M10-C test at permissionBoundary.test.ts:968-985 does NOT exercise
this path. It mints a JWT with `actorId: randomUUID()` (non-existent)
and `role: "System" as never`. The authenticate plugin loads the user
via findByOrganizationAndId, gets null, returns 401 AUTH_REQUIRED.
This proves missing-user rejection. It would also pass if the
ASSIGNABLE_LOGIN_ROLES check were deleted entirely.

Required test (directive §10):
  1. Seed an active user with role="System" + valid password hash
     (direct DB insert; createFutureRoleUserForTest would suffice
     if its LegacyRole type were widened, or use a direct insert).
  2. POST /auth/login with that username + password.
  3. Assert exact status 401 (not [401,403]).
  4. Assert no auth-token cookie issued.
  5. Assert login.failure audit written with reason="non_login_role".

Separately, the existing forged-JWT-for-missing-actor test is a useful
authentication-boundary test, but it must NOT be conflated with the
System-role test. Keep both, name them clearly, and tighten the union
assertion to exact 401.

Classification: P2 — production boundary is correct; test is wrong-shaped.
  MUST FIX BEFORE M10-C CLOSURE.
```

---

## M. Mutation experiments

Eight experiments per directive §19. All mutations were applied to a
temporary worktree and reverted byte-exactly; final source matches PR head.

```text
MUTATION A: revert GET /users gate to requireRole(["Admin"])
  EXPECTED TEST FAILURE: conformance detects leftover role gate on GET /users
  ACTUAL TEST FAILURE: 2 failed
    - [M10-C] GET /users — flat capability gate (roleHandlerCount 0 → 1)
    - no M10-C route carries a legacy role or permission-list gate (aggregate)
  TEST FILE: src/authz/routeRegistryConformance.test.ts
  RESTORED: yes (cp /tmp/user.ts.orig)

MUTATION B: remove POST /users capability gate (authenticate only)
  EXPECTED TEST FAILURE: conformance (0 flat handlers) + boundary
                         (Candidate reaches handler)
  ACTUAL TEST FAILURE: 7 failed across conformance + boundary
    - conformance: 0 flat handlers (expected 1) for POST /users
    - boundary: Candidate no longer 403 on POST /users (got 201)
    - zero-write: POST /users denial — user count grows
  TEST FILE: src/authz/routeRegistryConformance.test.ts +
             src/routes/permissionBoundary.test.ts
  RESTORED: yes

MUTATION C: PATCH /users/:id uses Permission.UserView instead of UserUpdate
  EXPECTED TEST FAILURE: conformance detects permission mismatch
  ACTUAL TEST FAILURE: 1 failed
    - [M10-C] PATCH /users/:id — authzHandlers[0] deep-equal mismatch
      (expected user.update, received user.view)
  TEST FILE: src/authz/routeRegistryConformance.test.ts
  RESTORED: yes

MUTATION D: change ONE REGISTRY entry only (PATCH /users/:id UserUpdate→UserView),
            leave runtime unchanged
  EXPECTED TEST FAILURE: conformance should fail (registry/runtime drift)
  ACTUAL TEST FAILURE: 0 failed — all 58 conformance tests PASSED
  TEST FILE: src/authz/routeRegistryConformance.test.ts
  RESTORED: yes
  NOTE: this PROVES H1 — the M10-C conformance test does NOT derive
        expectations from ROUTE_PERMISSION_REGISTRY. The m10cRouteSpecs
        table is a hand-maintained duplicate.

MUTATION E: grant Permission.UserView to TEACHER_PERMISSIONS
  EXPECTED TEST FAILURE: boundary denial matrix — Teacher no longer
                         denied on UserView routes
  ACTUAL TEST FAILURE: 1 failed
    - Teacher denied on all 10 M10-C routes (Teacher now allowed on the
      two UserView routes: GET /users + GET /users/:id/role-assignments)
  TEST FILE: src/routes/permissionBoundary.test.ts
  RESTORED: yes (presets.ts restored + @exam/authz rebuilt)

MUTATION F: remove syncUsersRoleFromPrimary call in POST primary assignment
  EXPECTED TEST FAILURE: users.role sync test fails
  ACTUAL TEST FAILURE: 1 failed
    - POST a new primary assignment syncs users.role (expected "Teacher",
      received "Candidate")
  TEST FILE: src/routes/permissionBoundary.test.ts
  RESTORED: yes

MUTATION G: remove success-path recordAudit from DELETE /role-assignments
  EXPECTED TEST FAILURE: a positive-path audit test should fail
  ACTUAL TEST FAILURE: 0 failed — 128/128 passed across conformance +
                       boundary + roleAssignments
  TEST FILE: (no test catches it)
  RESTORED: yes
  NOTE: this PROVES the ADR §7.2 success-audit invariant is UNENFORCED.
        See Finding N1.

MUTATION H: remove user.role_changed audit from PATCH /users/:id role-change
  EXPECTED TEST FAILURE: a positive-path audit test should fail
  ACTUAL TEST FAILURE: 0 failed — 82/82 passed across user + boundary
  TEST FILE: (no test catches it)
  RESTORED: yes
  NOTE: same as G — proves the audit-removal regression is invisible
        to the M10-C suite.
```

Additional mutation not in directive §19 but performed for completeness:

```text
MUTATION I (supplementary): add Permission.UserCreate to GRADER_PERMISSIONS
  (similar to E with a different role)
  EXPECTED TEST FAILURE: Grader denial on POST /users
  ACTUAL TEST FAILURE: 1 failed (Grader denied on all 10 — POST /users
                        flips to 201)
  RESTORED: yes
  (Performed in pilot before E; result was symmetric. Not re-run for
   the final report to save time; E is the canonical record.)
```

All 8 directive mutations performed (A–H); 6 directly killed (A, B, C, E,
F + supplementary I); 2 PASS-silently (D, G, H) — each of which is a
*finding*, not a methodology defect.

Final source verification:

```bash
$ git diff origin/feat/rbac-m10-c-identity-authority-ddbc808b \
    apps/api/src/routes/user.ts \
    apps/api/src/routes/roleAssignments.ts \
    apps/api/src/authz/routeRegistry.ts \
    packages/authz/src/presets.ts | wc -l
0
$ git status --short
(clean)
```

Original PR code unchanged.

---

## N. Test-quality assessment

```text
STRONG:
  - Unauthenticated matrix (10 routes × 1) — real HTTP inject, exact 401.
  - Non-Admin denial matrix (4 roles × 10 routes) — real HTTP inject,
    exact 403 per cell, descriptive labels.
  - Admin-reaches-handler on read routes — proves the allow half of
    shadow parity.
  - Sync preservation (4 positive + 1 negative) — direct DB read-back
    of users.role after the operation.
  - Conformance tag-classifier + synthetic negative-control route —
    proven to detect role gates (Mutation A end-to-end confirmation).
  - requireDefined fail-fast pattern — fixtures cannot silently absent.

WEAK:
  - PATCH /role-assignments denial uses a no-op payload (H4). Denial
    still holds because the capability gate fires first, but the test
    would also pass with `{}` payload — it proves nothing about the
    promote/deactivate branches.
  - System-login-path test (H5) — exercises only missing-user rejection.
  - POST /users audit filter is action-scoped, not target-scoped. For
    a denied request this is fine; for a successful request it would
    be too coarse. (Not exercised positively.)
  - Three denied-mutation tests (PATCH user, reset-password, DELETE
    user) lack route-specific audit-count assertions (H3).

VACUOUS:
  - None identified. Every test would fail under at least one realistic
    production defect (verified by mutation analysis A–F).

DUPLICATED AUTHORITIES:
  - m10cRouteSpecs duplicates ROUTE_PERMISSION_REGISTRY content for the
    M10-C routes (H1). Same defect as M10-B's m10bRouteSpecs.
  - The M10-C unauthenticated matrix (permissionBoundary.test.ts:686-751)
    and the M10-C non-Admin denial matrix (lines 848-959) both enumerate
    the same 10 routes. Defensible (different concerns: 401 vs 403), but
    a future decomposition could drive both from a single source.

POST-RBAC DECOMPOSITION CANDIDATES:
  - Derive m10bRouteSpecs and m10cRouteSpecs from ROUTE_PERMISSION_REGISTRY
    (filter by migrationStage and path-prefix), matching the M10-A pattern.
  - Extract a shared `buildM10RouteMatrix()` helper for the unauthenticated
    + non-Admin denial matrices.
  - Add a registry-vs-runtime audit-action conformance check (addresses
    Finding N2).
  - Add a cross-org test scaffold similar to candidateOwnership.test.ts
    for all ID-bearing admin routes (addresses H10).
```

---

## O. Report-accuracy audit

Author report: `docs/phase3/rbac/RBAC-M10-C-IDENTITY-AUTHORITY-20260719-002102-ddbc808b.md`
PR body: PR #191 description.

```text
RUN_ID:           report 20260719-002102-ddbc808b matches PR body. OK.
TIMESTAMP:        report timestamp 00:21:02 on 2026-07-19 (UTC+8 presumably).
                  The PR was opened 2026-07-18T16:59 UTC. Taipei July 19
                  00:21 CST = July 18 16:21 UTC. Per directive §17, do
                  NOT flag the timezone difference as invalid. OK.
BASE_SHA:         report says ddbc808b... — matches actual merge-base. OK.
FINAL_HEAD:       report says ee9064d6... (§B line 23 + §N line 630).
                  ACTUAL PR HEAD is 2e385644... — STALE by 1 commit
                  (the report commit itself). The report was written
                  against the test commit, then the report was committed
                  on top without updating the metadata. CodeRabbit also
                  flagged this. INACCURATE.
COMMIT_COUNT:     report says 2 (line 25, 631). ACTUAL is 3. INACCURATE.
CHANGED_FILES:    report §C line 78-84 diff stat shows 4 files / 1041
                  insertions / 15 deletions. ACTUAL PR is 5 files / 1691
                  insertions / 15 deletions. The 5th file is the report
                  itself (650 lines). INACCURATE.
TEST_COUNTS:      report §M line 603 "targeted tests 161 passed".
                  I count: conformance 58 + boundary 64 + user 18 +
                  roleAssignments 6 + auth 19 = 165 targeted (the
                  author's 161 may exclude auth or include a different
                  subset). Not directly verifiable; minor.
                  report §M line 605-607 "114 files, 1307 pass, 5 skip,
                  0 fail" — I reproduced this exactly. OK.
SYNC_TEST_COUNTS: PR body says "5 positive sync cases tested and passing".
                  report §N line 637 says "5 positive + 1 negative".
                  report §F line 202-209 lists 4 positive + 1 negative.
                  The test file has exactly 5 it() blocks in the sync
                  describe: 4 positive + 1 negative. The "5 positive"
                  claim is INTERNALLY INCONSISTENT with the report's
                  own enumeration. CodeRabbit flagged this. INACCURATE.
MUTATION_COUNT:   PR body §"Mutation evidence" and report §J line 444
                  "6 conceptual mutations" and report §G "zero-write
                  evidence for 6 mutating routes" — ACTUAL is 7
                  mutating routes. H2 CONFIRMED. INACCURATE (undercount).
AUDIT_EVIDENCE:   report §K line 522 "P2: none" and PR body "all audit
                  paths preserved" — OVERSTATED. H6 and H7 confirm two
                  production paths do NOT write the ADR-required audit,
                  and zero tests enforce the audit invariant for any
                  successful mutation (Finding N1). The accurate claim
                  is "M10-C did not change any audit path; pre-existing
                  H6/H7 gaps remain and are not enforced by tests."
CI_STATUS:        report §M table claims all gates PASS. I reproduced:
                  typecheck PASS (17/17), lint/lint:copy/lint:arch PASS,
                  format:check PASS, openapi:check PASS, api test 1307/0,
                  build PASS. OK.
REVIEW_THREADS:   2 review bots posted (CodeRabbit, gemini-code-assist).
                  CodeRabbit flagged: System-login tightening; expanded
                  zero-write + assignment payload; report metadata
                  refresh. gemini flagged: tighten [401,403]→401. None
                  resolved. OK (PR is open).
```

**Report-accuracy verdict:** the report overstates closure in three
specific ways: (1) HEAD/commit/diff-stat metadata is stale by one commit,
(2) the mutation count is undercounted (6 vs 7), (3) the audit-closure
claim is not backed by tests and ignores two pre-existing unaudited
privilege-mutation paths (H6, H7). The core access-matrix and
gate-migration claims are accurate.

---

## P. Verification commands

All run from the immutable review baseline (HEAD = 2e385644):

```bash
# Identity & baseline
git branch --show-current                          # feat/rbac-m10-c-identity-authority-ddbc808b
git rev-parse HEAD                                 # 2e3856445d09645ce7930f0ab3e7c569ed1a82ec
git merge-base HEAD origin/master                  # ddbc808b9c640584ece7690dd8aef681739081a5
git diff --stat origin/master...HEAD               # 5 files, +1691/-15
gh pr view 191 --json state,headRefOid,baseRefName # OPEN, head matches local

# Targeted vitest (the directive's §20 minimum set)
pnpm --filter api exec vitest run src/authz/routeRegistryConformance.test.ts
  → 58 passed
pnpm --filter api exec vitest run src/routes/permissionBoundary.test.ts
  → 64 passed
pnpm --filter api exec vitest run src/routes/user.test.ts
  → 18 passed
pnpm --filter api exec vitest run src/routes/roleAssignments.test.ts
  → 6 passed
pnpm --filter api exec vitest run src/routes/auth.test.ts
  → 19 passed

# Static gates
pnpm typecheck                                     # 17/17 turbo tasks PASS
pnpm lint                                          # PASS
pnpm lint:copy                                     # PASS
pnpm lint:arch                                     # PASS
pnpm format:check                                  # PASS
pnpm --filter @exam/api api:openapi:check          # PASS

# Full API suite
pnpm --filter api test                             # 114 files, 1307 pass, 5 skip, 0 fail

# Build
pnpm build                                         # 9/9 turbo tasks PASS

# Full pipeline (skipped in this review — covered by the above subset;
# pnpm verify runs the same gates turbo caches)
```

**Test-count reproduction:**

```text
conformance:        58 passed (was 58 in author report — OK)
permissionBoundary: 64 passed (was not explicitly numbered in report)
user:               18 passed
roleAssignments:     6 passed
auth:               19 passed
full API:         1307 passed | 5 skipped | 0 failed (matches report §M)
```

---

## Q. Required corrective scope

```text
MUST FIX BEFORE MERGE:
  None. The production migration is correct. The PR is safe to merge
  for the production code change. (The findings below are evidence and
  closure gaps, not production-blocking defects.)

MUST FIX BEFORE M10-C CLOSURE (i.e. before treating M10-C as "done"):
  1. (H1, P2) Refactor the M10-C conformance block to derive
     m10cRouteSpecs from ROUTE_PERMISSION_REGISTRY (filter by
     migrationStage + path-prefix, assert count===10). Until this is
     done, Mutation D proves the test does not catch registry drift.
     Recommended: do M10-B and M10-C together for consistency.
  2. (H3, P2) Add scoped audit-count assertions to the three
     denied-mutation tests that lack them: PATCH /users (user.update),
     POST reset-password (candidate.password_reset), DELETE /users
     (user.delete). Filter by (org, targetType=user, targetId=user.id,
     action).
  3. (H4, P2) Either (a) change the PATCH /role-assignments denial
     payload from {isPrimary:false} to a real {isPrimary:true} promote
     payload against a secondary assignment (still denied by capability
     gate), OR (b) add a positive-path test that exercises both promote
     and deactivate branches and asserts resulting state + audit.
  4. (H5, P2) Replace the forged-missing-actor JWT test with a real
     System-role login test: seed an active System user with a valid
     password, POST /auth/login, assert exact 401, assert no cookie,
     assert login.failure audit with reason=non_login_role. Keep the
     forged-JWT test separately if desired, but tighten its union to
     exact 401.
  5. (Finding N1, P2) Add at least one positive-path audit-write test
     for each successful privilege mutation: PATCH /users role-change
     (user.role_changed), POST primary assignment (user.role_changed),
     PATCH promote (user.role_changed), DELETE assignment
     (user.role_changed), and — once the production code is fixed —
     POST secondary and PATCH deactivate.
  6. (H6, H7, P1/P2 disposition) Decide explicitly:
       (a) Add user.role_changed audit to POST secondary assignment
           and PATCH deactivate branch in M10-C (preferred — closes
           the ADR §7.2 gap), OR
       (b) Amend the ADR to defer these two audits to M10-E and
           document the deferral in the M10-C report.
     Either is acceptable; silence is not.
  7. (H8, P3) Refresh the author-report metadata: FINAL_HEAD →
     2e385644, COMMITS → 3, diff-stat → 5 files / +1691 / -15,
     sync-tests → 4 positive + 1 negative, mutations → 7.
  8. (H10, P3) Add at least one cross-org probe per ID-bearing M10-C
     route (Org A Admin → Org B user/assignment → 404 + zero writes).

CAN DEFER TO M10-E:
  - H9 (last-Admin guard migration to assignment reads) — pre-existing;
    ADR line 678 already schedules this with the runtime authority
    switch. Document the gap in M10-C report; do not fix in M10-C.
  - The "users.role when no active primary" policy gap (sync matrix).
  - Runtime permission derivation from user_role_assignments (M10-E).

POST-RBAC CLEANUP:
  - Derive m10bRouteSpecs and m10cRouteSpecs from the registry (same
    as #1 but applied uniformly across M10-B and M10-C).
  - Add a registry-vs-production audit-action conformance test
    (Finding N2).
  - Normalize DELETE assignment targetType to "user" or document the
    convention (Finding N3).
  - Cross-org test scaffold for all ID-bearing admin routes (not just
    M10-C).

FALSE / NO ACTION:
  - "Admin access regression" — verified 0 directly against presets.
  - "M10-E started" — verified NO; runtime authority unchanged.
  - "Audit metadata contains PII / password / hash / JWT" — verified
    NO; metadata is opaque scalars (role names, removed flag,
    affectedUserId). Usernames in audit are ADR-permitted.
  - "Conformance test classifier is vacuous" — verified NO; negative
    control + Mutation A end-to-end prove non-vacuity.
```

---

## R. Final machine-readable summary

```text
RUN_ID=RBAC-M10-C-ADVERSARIAL-REVIEW-20260719-073604-2e385644
PR=191
HEAD=2e3856445d09645ce7930f0ab3e7c569ed1a82ec
ROUTES_EXPECTED=10
ROUTES_FOUND=10
LEGACY_GATES_REMAINING=0
ACCESS_EXPANSIONS=0
ADMIN_REGRESSIONS=0
MUTATIONS_FOUND=7
MUTATIONS_WITH_FULL_ZERO_WRITE_PROOF=4
SUCCESS_MUTATIONS_WITH_REQUIRED_AUDIT=9/11
SUCCESS_MUTATIONS_WITH_TEST_PROOF=0/11
REGISTRY_RUNTIME_CONFORMANCE=PARTIAL
SYSTEM_NON_LOGIN=UNPROVEN
LAST_ADMIN_INVARIANT=PARTIAL
ORG_ISOLATION=PARTIAL
P0=0
P1=0
P2=7
P3=4
VERDICT=REQUEST-CHANGES
```

P2 count breakdown:
- F-H1 conformance duplicates table (Mutation D proves)
- F-H2 mutation undercount (7 vs 6)
- F-H3 missing route-specific audit assertions (3 routes)
- F-H4 PATCH assignment no-op payload
- F-H5 System-login test wrong shape + weak union
- F-N1 success-audit removal passes silently
- F-H6/H7 production missing audit on POST secondary + PATCH deactivate
  (counted as one P2 because they share a disposition)

P3 count breakdown:
- F-H8 stale report metadata
- F-N2 registry auditAction drift (3 routes)
- F-N3 DELETE assignment targetType inconsistency
- F-H9 last-Admin guard scope gap (pre-existing; documented)

The PR's production change is correct and may be merged. **M10-C closure
is blocked** on the eight items in §Q "MUST FIX BEFORE M10-C CLOSURE".
The single most important is Finding N1 / item #5: a positive-path
audit-write test, without which the ADR §7.2 audit invariant is
unenforced for the entire M10-C surface and any future regression that
drops a `recordAudit` call will ship silently.

```text
RBAC-M10-C-ADVERSARIAL-REVIEW-20260719-073604-2e385644: COMPLETE
```
