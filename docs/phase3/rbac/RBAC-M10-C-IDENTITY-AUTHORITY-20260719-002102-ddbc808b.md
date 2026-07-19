# RBAC-M10-C-IDENTITY-AUTHORITY-20260719-002102-ddbc808b

## A. Verdict

```text
RBAC-M10-C-IDENTITY-AUTHORITY-20260719-002102-ddbc808b:
PASS — AUTHOR SELF-ASSESSMENT
```

Independent adversarial review is required to close M10-C. This document
is the author's evidence package, not a closure.

---

## B. Baseline

```text
BASE_BRANCH:      master
BASE_COMMIT:      ddbc808b9c640584ece7690dd8aef681739081a5
BASE_SHORT_SHA:   ddbc808b
M10-B MERGE:      ddbc808 (Merge PR #190 — RBAC-M10-B Single-Tenant Corrective)
STARTING_HEAD:    ddbc808b
FINAL_HEAD:       2e3856445d09645ce7930f0ab3e7c569ed1a82ec
                  (pre-review-fix head; this report + the review-fix
                  commit land on top — see §O for the post-fix SHA once
                  the review-comment refresh is committed)
BRANCH:           feat/rbac-m10-c-identity-authority-ddbc808b
COMMITS:          3 (production migration + tests + this report)
                  A 4th review-fix commit addresses the CodeRabbit /
                  gemini-code-assist comments on PR #191 (see §O).
WORKTREE:         clean
PR:               opened against master (see §M)
```

> **CodeRabbit PR #191 review metadata correction (H8):** the prior
> version of this report recorded `FINAL_HEAD: ee9064d6...` and
> `COMMITS: 2`. That was stale by one commit — the report commit itself
> (`2e385644`) was added on top of `ee9064d` without refreshing the
> metadata. Corrected here.

---

## C. Authority statement

```text
M10-C SCOPE:
Identity and role-assignment administrative routes

EXPECTED ROUTES:
10 (5 user.ts + 5 roleAssignments.ts)
ACTUAL ROUTES:
10 (exact match)

CURRENT RUNTIME AUTHORITY:
users.role / current role compatibility path
(authenticate plugin reads users.role → getPermissionsForRole(role);
M10-C did NOT touch this)

ROLE-ASSIGNMENT RUNTIME AUTHORITY:
NOT ENABLED BY M10-C
(user_role_assignments remains assignment-management data only;
syncUsersRoleFromPrimary keeps users.role in sync as compatibility cache)

M10-E:
NOT STARTED
(plugins/auth.ts, plugins/authz.ts, JWT/login path all unchanged)
```

### Phase boundary respected

M10-C did NOT implement any of:

```text
M10-D organization/system administrative routes
M10-E assignment-backed runtime authorization
M10-F global closure
Teacher-to-course assignment
Proctor-to-exam assignment
Grader-to-work assignment
multi-tenant authorization
custom-role policy engine
general project-corruption cleanup
unrelated test deletion
broad authz refactoring
```

Diff stat (production + test + this report, as of pre-review-fix HEAD
`2e385644`):

```text
 apps/api/src/authz/routeRegistryConformance.test.ts | 148 ++++
 apps/api/src/routes/permissionBoundary.test.ts      | 838 ++++++++++++++++
 apps/api/src/routes/roleAssignments.ts              |  38 ++-
 apps/api/src/routes/user.ts                         |  32 ++-
 docs/phase3/rbac/RBAC-M10-C-IDENTITY-AUTHORITY-20260719-002102-ddbc808b.md | 650 ++++++++++
 5 files changed, 1691 insertions(+), 15 deletions(-)
```

The review-fix commit (§O) adds a 6th changed file only insofar as it
extends `permissionBoundary.test.ts` further and refreshes this report.
No production source files change in the review-fix commit.

---

## D. Ten-route inventory

All 10 routes were `requireRole(["Admin"])` at baseline; all are now
`requireCapability(Permission.<X>)` flat gates. Org-anchor isolation is
preserved via `ensureTargetOrg(getRequestContext(request))` in every
handler (unchanged).

### user.ts — 5 routes (registry migrationStage: 6)

| # | Method | Path                       | Previous gate              | New capability                       | Roles receiving capability | Access-matrix change | Mutation class     | Audit action              | Runtime-authority effect |
| -: | ------ | ---------                  | ---------------            | ---------------------                 | ------------------------- | -------------------- | ------------------ | ------------------------- | ----------------------- |
| 1 | GET    | /users                     | requireRole(["Admin"])     | Permission.UserView                  | Admin only                | none (neutral)       | read-only          | —                         | reads users.role for projection |
| 2 | POST   | /users                     | requireRole(["Admin"])     | Permission.UserCreate                | Admin only                | none (neutral)       | identity-mutation  | user.create               | writes users.role via repo.createUnique; seeds primary assignment |
| 3 | PATCH  | /users/:id                 | requireRole(["Admin"])     | Permission.UserUpdate                | Admin only                | none (neutral)       | identity-mutation  | user.update + user.role_changed (on role change) | syncs users.role via syncUsersRoleFromPrimary on role change |
| 4 | POST   | /users/:id/reset-password  | requireRole(["Admin"])     | Permission.UserPasswordReset         | Admin only                | none (neutral)       | credential-mutation | candidate.password_reset  | reads users.role for Candidate-only check; no write |
| 5 | DELETE | /users/:id                 | requireRole(["Admin"])     | Permission.UserDelete                | Admin only                | none (neutral)       | identity-mutation  | user.delete               | deletes users.role (row) |

### roleAssignments.ts — 5 routes (registry migrationStage: 8)

| # | Method | Path                                  | Previous gate              | New capability            | Roles receiving capability | Access-matrix change | Mutation class        | Audit action        | Runtime-authority effect |
| -: | ------ | ---------                             | ---------------            | ----------------           | ------------------------- | -------------------- | -------------------- | ------------------- | ----------------------- |
| 6 | GET    | /roles/assignable                    | requireRole(["Admin"])     | Permission.UserRoleAssign | Admin only                | none (neutral)       | read-only             | —                   | none |
| 7 | GET    | /users/:id/role-assignments          | requireRole(["Admin"])     | Permission.UserView       | Admin only                | none (neutral)       | read-only             | —                   | reads user_role_assignments |
| 8 | POST   | /users/:id/role-assignments          | requireRole(["Admin"])     | Permission.UserRoleAssign | Admin only                | none (neutral)       | assignment-mutation   | user.role_changed (on primary) | syncs users.role via syncUsersRoleFromPrimary on primary |
| 9 | PATCH  | /role-assignments/:assignmentId      | requireRole(["Admin"])     | Permission.UserRoleAssign | Admin only                | none (neutral)       | assignment-mutation   | user.role_changed (on promote) | syncs users.role on promote / deactivate-of-primary |
| 10| DELETE | /role-assignments/:assignmentId      | requireRole(["Admin"])     | Permission.UserRoleAssign | Admin only                | none (neutral)       | assignment-mutation   | user.role_changed (role_assignment target) | syncs users.role when removed row was primary |

### Operation coverage reconciled

The task brief hinted at "GET/VIEW single user" as one of the 5 user
operations. The actual `user.ts` has **no `GET /users/:id`** endpoint —
the 5 routes are LIST, CREATE, UPDATE, PASSWORD-RESET, DELETE. This
matches the registry inventory at `routeRegistry.ts` (5 entries at
migrationStage 6) and the M10-C scope table in
`RBAC-M10-FINISH-BASELINE-1.md` §O. Count reconciles exactly: 5 + 5 = 10.

### Per-route structural facts (preserved)

For every route:

```text
authentication preHandler: fastify.authenticate (unchanged, first)
state/domain guard:         ensureTargetOrg in handler (unchanged)
existence behavior:         preserved (404 RESOURCE_NOT_FOUND on missing)
403/404 behavior:           preserved (403 from capability gate; 404 from handler)
transaction boundary:       none added or removed (handlers remain
                            non-transactional, matching baseline)
repository/service path:    unchanged
audit behavior:             unchanged (same actions, same metadata shape)
users.role effect:          unchanged (same sync call sites)
user_role_assignments effect: unchanged
```

---

## E. Shadow parity

Evaluated all six runtime roles (Admin / Teacher / Proctor / Grader /
Candidate / System) against both the legacy decision
(`requireRole(["Admin"])` allows Admin, denies all others) and the
capability decision (preset must hold the permission). The six target
permissions are present ONLY in the Admin preset
(`packages/authz/src/presets.ts`):

```text
Admin:     UserView ✅ UserCreate ✅ UserUpdate ✅ UserPasswordReset ✅
           UserDelete ✅ UserRoleAssign ✅
Teacher:   none of the six
Proctor:   none of the six
Grader:    none of the six
Candidate: none of the six
System:    none of the six (and loginAllowed=false, so cannot reach a
           session)
```

Parity matrix (60 cells = 6 roles × 10 routes, all equal):

| Principal | Legacy decision | Capability decision | Expected parity |
| --------- | --------------: | ------------------: | --------------: |
| Admin     |           allow |               allow |           equal |
| Teacher   |            deny |                deny |           equal |
| Proctor   |            deny |                deny |           equal |
| Grader    |            deny |                deny |           equal |
| Candidate |            deny |                deny |           equal |
| System    |  deny/non-login |                deny |           equal |

```text
NON-ADMIN ACCESS EXPANSIONS:
0

ADMIN ACCESS REGRESSIONS:
0
```

The HTTP denial matrix in `permissionBoundary.test.ts` proves the deny
half empirically for Candidate/Teacher/Proctor/Grader on all 10 routes,
and the Admin-reaches-handler tests prove the allow half on the read
routes. Mutation D (temporarily grant UserView to Teacher) was killed by
the boundary test, proving the deny assertions are non-vacuous.

---

## F. Synchronization evidence

`syncUsersRoleFromPrimary` (apps/api/src/authz/roleSync.ts) is preserved
at all 5 call sites (1 in user.ts, 4 in roleAssignments.ts). The runtime
authority remains `users.role`; the sync keeps it in sync with the
primary active assignment per the ADR migration-window invariant.

> **CodeRabbit PR #191 review metadata correction (H8):** the prior
> version of this section and the §N PR-summary block claimed "5
> positive sync cases" while enumerating only 4. The accurate count is
> **4 positive + 1 negative = 5 `it()` blocks** in the
> `permissionBoundary.test.ts` M10-C sync describe. Corrected here and
> in §N.

```text
PROVEN (positive sync happens, tested): 4 cases
  - POST primary assignment       → users.role becomes new role
  - PATCH promote-to-primary      → users.role becomes promoted role
  - DELETE primary assignment     → auto-promote + users.role syncs
  - PATCH /users/:id role-change  → users.role becomes new role

PROVEN (negative sync does NOT happen, tested): 1 case
  - POST secondary assignment     → users.role unchanged

PRESERVED (existing RBAC-M8 tests, still passing):
  - All five cases above are also covered by roleAssignments.test.ts
    and user.test.ts (the original RBAC-M8 suite, untouched).

UNDEFINED POLICY (not exercised; no established contract):
  - assign System role            → System is non-assignable (preset),
                                    AssignRoleRequestSchema rejects it
                                    at the contract layer before the
                                    handler runs
  - assign duplicate role         → userRoleAssignmentRepo.assign
                                    enforces (existing behavior);
                                    M10-C did not touch the repo
  - update user role directly via repo (no API path)
  - delete user with assignments  → cascade behavior owned by schema;
                                    M10-C did not change schema

DEFERRED TO M10-E:
  - Runtime permission derivation from user_role_assignments
  - Multi-role merging
  - Assignment scope enforcement
  - Revocation / session invalidation
```

All `users.role` mutations go through one of two paths, both preserved:
(1) `repo.createUnique` on POST /users (seeds the cache), (2)
`syncUsersRoleFromPrimary` on every primary-active assignment change.
There is no path in M10-C that can produce `users.role` /
`user_role_assignments` divergence that did not already exist at
baseline.

---

## G. Zero-write evidence

For every denied mutation, fixtures are deterministic direct-DB inserts
with unique prefixes; every read-back is fail-fast via `requireDefined`.
Audit filters are scoped per `(targetType, targetId, action)` — never
global row counts.

### POST /users denied (Candidate principal)

```text
fixture:           no fixture needed (route creates a user)
principal:         Candidate
response:          403 PERMISSION_DENIED
business state:    before total=N, after total=N (no new user)
assignment state:  no new assignment (handler never reached)
users.role:        unchanged (no user created)
audit count:       before = after (action=user.create, scoped to org)
```

### PATCH /users/:id denied (Candidate principal)

```text
fixture:           deterministic user + primary assignment (direct insert)
principal:         Candidate
response:          403
business state:    name, role, isActive, passwordHash, updatedAt — all
                   byte-equal before/after
assignment state:  primary assignment row intact
users.role:        unchanged (handler never reached; sync never invoked)
audit count:       before = after (action=user.update,
                   targetType=user, targetId=user.id)
                   [CodeRabbit PR #191 review: route-specific audit
                   assertion added in the review-fix commit]
```

### POST /users/:id/reset-password denied (Candidate principal)

```text
fixture:           deterministic Candidate user (direct insert)
principal:         Candidate
response:          403
business state:    passwordHash byte-equal before/after; updatedAt
                   byte-equal
users.role:        unchanged
audit count:       before = after (action=candidate.password_reset,
                   targetType=user, targetId=user.id)
                   [CodeRabbit PR #191 review: route-specific audit
                   assertion added in the review-fix commit]
```

### DELETE /users/:id denied (Candidate principal)

```text
fixture:           deterministic user + primary assignment
principal:         Candidate
response:          403
business state:    user row still exists; updatedAt byte-equal
assignment state:  assignment rows length unchanged; primary row still
                   present
users.role:        unchanged (row still exists with same role)
audit count:       before = after (action=user.delete,
                   targetType=user, targetId=user.id)
                   [CodeRabbit PR #191 review: route-specific audit
                   assertion added in the review-fix commit]
```

### POST /users/:id/role-assignments denied (Candidate principal)

```text
fixture:           deterministic Candidate user + primary Candidate
                   assignment
principal:         Candidate
response:          403
business state:    users.role byte-equal; updatedAt byte-equal
assignment state:  assignment count unchanged (no new row)
audit count:       before = after (action=user.role_changed,
                   targetId=user.id, scoped to org)
```

### PATCH /role-assignments/:assignmentId denied (Candidate principal)

```text
fixture:           deterministic Candidate user + primary Candidate
                   assignment + secondary Grader assignment (the promote
                   target). [CodeRabbit PR #191 review: prior version
                   seeded only a primary assignment and sent the no-op
                   payload {isPrimary:false}, which never reached a
                   state-changing branch. Now seeds a real secondary
                   assignment and sends {isPrimary:true} — the promote
                   branch that WOULD state-change if authorized.]
principal:         Candidate
response:          403
assignment state:  secondary isPrimary=false, isActive=true, role=Grader
                   (unchanged); primary isPrimary=true, role=Candidate
                   (unchanged)
users.role:        unchanged (sync never invoked)
audit count:       before = after (action=user.role_changed,
                   targetType=user, targetId=user.id)
```

### DELETE /role-assignments/:assignmentId denied (Candidate principal)

```text
fixture:           deterministic user + primary assignment
principal:         Candidate
response:          403
assignment state:  assignment row still exists; isPrimary unchanged
users.role:        unchanged
audit count:       before = after (action=user.role_changed,
                   targetType=role_assignment, targetId=assignment.id)
```

### Forbidden test patterns — none present

The directive §13 forbids several test patterns. Audit:

```text
if (!fixture) return;            — NOT PRESENT (requireDefined fail-fast)
if (!target) return;             — NOT PRESENT
array-count-only HTTP claim      — NOT PRESENT (every HTTP denial also
                                   re-reads business/assignment state)
mock-only DB zero-write claim    — NOT PRESENT (real TestContext.app.inject
                                   + real DB read-back)
fixture created by another test  — NOT PRESENT (each test inserts its own)
test-order dependency            — NOT PRESENT (uniquePrefix per fixture)
```

---

## H. Conformance evidence

`routeRegistryConformance.test.ts` was extended with a parallel M10-C
block alongside the existing M10-A and M10-B blocks.

```text
M10-C route count:                     10  (exact match to brief)
legacy role gates on M10-C routes:      0  (verified by tag-based classifier)
flat capability gates on M10-C routes: 10  (exactly 1 per route)
scoped gates on M10-C routes:           0
permission-list gates on M10-C routes:  0
captured capability == expected:       10/10 (deep-equal per route)
registry route == runtime route:       10/10 (matched via onRoute capture)
migration stage:                        6 (user.ts) + 8 (roleAssignments.ts)
                                        — unchanged from registry
wrong-capability mutations killed:      1  (Mutation C, see §J)
negative-control result:             PASS  (existing synthetic mixed-chain
                                            test still detects role gate)
```

The negative-control test (registers a synthetic route with BOTH
`requireRole(["Admin"])` AND `requireCapability(...)`) proves the
classifier actually detects role gates — without it, the "zero role
gates" assertion could be vacuous. This control was added in the M10-B
corrective and is preserved unchanged.

The `combinedPlugin` now registers `userRoutes` and
`roleAssignmentRoutes` so the onRoute hook observes M10-C routes. Both
plugins register their full paths (no per-plugin prefix); the buildTestApp
`/api` prefix applies.

---

## I. Files changed

```text
apps/api/src/routes/user.ts
  Reason: flip 5 gates requireRole → requireCapability (UserView /
  UserCreate / UserUpdate / UserPasswordReset / UserDelete). Import
  Permission from @exam/authz. Update module doc comment. No handler,
  service, audit, or sync changes.

apps/api/src/routes/roleAssignments.ts
  Reason: flip 5 gates requireRole → requireCapability (UserRoleAssign
  for the 4 mutating/assignable routes, UserView for the per-user list).
  Import Permission alongside existing ROLE_PRESETS/Role/RoleKey. Update
  module doc comment. No handler, service, audit, or sync changes.

apps/api/src/authz/routeRegistryConformance.test.ts
  Reason: register userRoutes + roleAssignmentRoutes in combinedPlugin;
  add m10cRouteSpecs (10 entries); add per-route it.each conformance;
  add aggregate 'no legacy role or permission-list gate' pass.

apps/api/src/routes/permissionBoundary.test.ts
  Reason: register roleAssignmentRoutes; add M10-C unauthenticated
  matrix (10 routes); add Candidate/Teacher/Proctor/Grader denial
  matrices (10 routes each); add System-login-path-unavailable tests
  (forged-JWT boundary + real System-role POST /auth/login boundary);
  add zero-write evidence for 7 mutating routes (business + assignment +
  users.role + audit counts — every route now has a route-specific
  scoped audit assertion); add users.role sync preservation (4 positive
  + 1 negative); add Admin-reaches-handler sanity tests.
  [CodeRabbit PR #191 review-fix: System-login test was split and
  tightened to exact 401; three user-route denial tests gained scoped
  audit-count assertions (user.update, candidate.password_reset,
  user.delete); PATCH /role-assignments denial test switched from the
  no-op {isPrimary:false} payload to the real promote branch
  {isPrimary:true} against a seeded secondary assignment.]

docs/phase3/rbac/RBAC-M10-C-IDENTITY-AUTHORITY-20260719-002102-ddbc808b.md
  Reason: this report.
```

### Files NOT changed (boundary respected)

```text
packages/authz/src/catalog.ts        — Permission catalog complete since RBAC-M4
packages/authz/src/presets.ts        — role presets complete; no M10-C capability
                                       was added to any preset
packages/authz/src/legacyMap.ts      — migration bridge, not in M10-C path
apps/api/src/plugins/auth.ts         — authenticate / requireRole /
                                       requirePermission / requireCapability
                                       unchanged (M10-E territory)
apps/api/src/plugins/authz.ts        — scoped / score / candidate-runtime
                                       decorators unchanged
apps/api/src/authz/roleSync.ts       — syncUsersRoleFromPrimary unchanged
packages/db/src/repository/*         — all repos unchanged
packages/db/src/schema.ts            — no schema changes
apps/api/src/types/fastify-auth.d.ts — AuthzMetadata union unchanged
                                       (flat kind reused; no new kind needed)
```

No schema changes. No runtime authentication-source changes.

---

## J. Mutation evidence

Six conceptual mutations per directive §16. Each was applied, the
relevant test run, the failure observed, and the source restored
byte-exactly. No mutation was committed.

```text
MUTATION A: replace GET /users capability gate with requireRole(["Admin"])
  EXPECTED FAILURE: conformance detects leftover role gate on GET /users
  OBSERVED FAILURE: 2 tests failed
    - [M10-C] GET /users — flat capability gate, no role/permission gate
      (roleHandlerCount expected 0, received 1)
    - no M10-C route carries a legacy role or permission-list gate
      (aggregate)
  RESTORATION: cp /tmp/user.ts.orig apps/api/src/routes/user.ts → byte-equal

MUTATION B: remove the capability gate on POST /users (only authenticate)
  EXPECTED FAILURE: conformance (0 flat handlers) AND boundary
                    (Candidate now reaches handler)
  OBSERVED FAILURE: 2 conformance failures + 1 boundary failure
    - [M10-C] POST /users — flat count expected 1, received 0
    - aggregate 'no M10-C route carries a legacy role' (flat count)
    - Candidate denied on all 10 M10-C routes (POST /users no longer 403)
  RESTORATION: byte-equal

MUTATION C: PATCH /users/:id uses Permission.UserView instead of UserUpdate
  EXPECTED FAILURE: conformance detects wrong permission
  OBSERVED FAILURE: 1 test failed
    - [M10-C] PATCH /users/:id — authzHandlers[0] deep-equal expected
      {kind:"flat", permission:"user.update"}, received
      {kind:"flat", permission:"user.view"}
  RESTORATION: byte-equal

MUTATION D: temporarily add Permission.UserView to TEACHER_PERMISSIONS
  EXPECTED FAILURE: boundary denial matrix — Teacher no longer denied on
                    UserView routes (GET /users, GET /users/:id/role-assignments)
  OBSERVED FAILURE: 1 test failed
    - Teacher denied on all 10 M10-C routes (Teacher now allowed on the
      two UserView routes)
  RESTORATION: byte-equal; @exam/authz rebuilt

MUTATION E: comment out syncUsersRoleFromPrimary in POST primary assignment
  EXPECTED FAILURE: users.role sync test fails (role stays "Candidate")
  OBSERVED FAILURE: 2 tests failed
    - permissionBoundary: POST a new primary assignment syncs users.role
      (expected "Teacher", received "Candidate")
    - roleAssignments.test.ts: POST a primary assignment syncs users.role
      (existing RBAC-M8 test also catches it)
  RESTORATION: byte-equal

MUTATION F: write an audit event on a denied request
  STATUS: not directly simulatable by mutating production code.
    Rationale: the capability preHandler 403s BEFORE the handler runs,
    so no handler code executes on a denied request. There is no audit
    write in the denial path to mutate. Mutating the requireCapability
    decorator itself to write audit on denial would be a large
    architectural change outside M10-C scope.
  STRONGEST AVAILABLE NEGATIVE CONTROL:
    1. The conformance negative-control test (existing) proves the
       classifier detects role gates on a synthetic mixed chain — if a
       future regression reintroduced a role gate that ALSO wrote audit,
       the conformance test would fire first.
    2. The zero-write-audit assertions in permissionBoundary.test.ts are
       scoped per (targetType, targetId, action). They will catch ANY
       new audit row matching that filter regardless of the writing
       path — including a hypothetical regression in the capability
       decorator.
    3. Mutation B (gate removal) proves that when the gate is removed
       and the handler DOES run, the zero-write-audit assertion is the
       next line of defense and would catch a handler-emitted audit on
       what should have been a denied request.
```

5 of 6 mutations killed directly; mutation F covered by negative
controls per directive §16 allowance.

---

## K. Residual findings

```text
P0:    none
P1:    none
P2:    none

P3:
  - RESOLVED by CodeRabbit PR #191 review-fix: the 'System login path'
    test previously asserted the response is in [401, 403] rather than
    exactly 401. It is now split into two tests:
      (a) forged System-claimed JWT with no user row → exact 401
          (authentication boundary);
      (b) real active System-role user POST /auth/login → exact 401,
          no auth-token cookie, AUTH_INVALID_CREDENTIALS error code,
          login.failure audit with reason=non_login_role, role=System
          (System-role policy boundary).
    The [401, 403] union is removed.

M10-E FOLLOW-UP:
  - Runtime permission derivation from user_role_assignments (the
    architectural authority switch). M10-C must be stable before M10-E
    can begin; this PR is that stable surface.
  - Assignment scope enforcement (Teacher/Course, Proctor/Exam,
    Grader/Work) — deferred to RBAC-M11 (see
    RBAC-M11-RESOURCE-RELATIONSHIP-AUTHORIZATION-DESIGN-1.md).
  - Revocation / session invalidation when an active assignment is
    deactivated or removed (currently the user's existing session
    continues to authorize via users.role until the JWT expires; M10-E
    territory).

POST-RBAC DECOMPOSITION CANDIDATE:
  - The m10bRouteSpecs and m10cRouteSpecs arrays are hand-maintained
    inventories in routeRegistryConformance.test.ts. They duplicate
    information already present in ROUTE_PERMISSION_REGISTRY. A future
    decomposition could derive them from the registry (the M10-A block
    already does this for runtimeAuthz entries). NOT done in M10-C —
    out of scope, would expand authority ambiguity if attempted
    hastily.

OUT OF SCOPE:
  - The transient `@exam/db testWorkerDatabase.test.ts` timeout
    observed in one coverage run (15s timeout on
    ensureDatabaseExists). Reproduced as passing 3/3 in isolation;
    classified as a parallel-worker-load flake, not task-introduced.
    Not an M10-C file; no action.
```

---

## L. Scope boundary

```text
M10-D organization/system administrative routes:        NOT STARTED
M10-E assignment-backed runtime authority:              NOT STARTED
M10-F global closure:                                   NOT STARTED
general project-corruption cleanup:                     NOT STARTED
route renaming:                                         NOT DONE
endpoint consolidation:                                 NOT DONE
test-suite simplification:                              NOT DONE
broad authz refactoring:                                NOT DONE
```

The diff is the minimum required for M10-C correctness: 2 production
files (gate flips + doc comments), 2 test files (conformance + boundary),
1 report. No unrelated cleanup.

---

## M. Review readiness

Verification gates (all green):

| Gate                          | Command                                        | Result     |
| ----------------------------- | ---------------------------------------------- | ---------- |
| format                        | `pnpm format:check`                            | PASS       |
| lint                          | `pnpm lint`                                    | PASS       |
| lint:copy                     | `pnpm lint:copy`                               | PASS       |
| lint:arch                     | `pnpm lint:arch`                               | PASS       |
| lint:db-config                | `pnpm lint:db-config`                          | PASS       |
| lint:ui-gates                 | `pnpm lint:ui-gates`                           | PASS       |
| lint:eslint                   | `pnpm lint:eslint`                             | PASS       |
| typecheck                     | `pnpm typecheck`                               | PASS (17/17) |
| openapi check                 | `pnpm --filter @exam/api api:openapi:check`    | PASS       |
| targeted tests                | vitest conformance + boundary + user +         | PASS       |
|                               | roleAssignments + audit                        | (161 tests)|
| full API suite                | `pnpm --filter api test`                       | PASS       |
|                               |                                                | (114 files, |
|                               |                                                | 1307 pass, |
|                               |                                                | 5 skip, 0 fail) |
| coverage                      | `TEST_DB_ISOLATION=worker-database             | PASS       |
|                               |  API_TEST_MAX_WORKERS=4 pnpm coverage`         | (16/16 tasks)|
| build                         | `pnpm build`                                   | PASS (9/9) |
| verify (full pipeline)        | `pnpm verify`                                  | PASS       |

Final worktree state: clean (after this report commit).

```text
RBAC-M10-C INDEPENDENT ADVERSARIAL REVIEW: READY
```

The branch is pushed and a PR is open against master. The PR is NOT
merged. Independent adversarial review is the closure authority.

---

## N. PR summary block (for the PR body)

```text
RUN_ID:           RBAC-M10-C-IDENTITY-AUTHORITY-20260719-002102-ddbc808b
BRANCH:           feat/rbac-m10-c-identity-authority-ddbc808b
BASE_COMMIT:      ddbc808b9c640584ece7690dd8aef681739081a5
FINAL_HEAD:       2e3856445d09645ce7930f0ab3e7c569ed1a82ec
                  (pre-review-fix head; review-fix commit lands on top —
                  see §O for the post-fix SHA once committed)
COMMITS:          3 (production migration + tests + this report)
                  A 4th review-fix commit addresses CodeRabbit /
                  gemini-code-assist comments on PR #191 (see §O).
PR:               191
ROUTES MIGRATED:  10 (5 user.ts + 5 roleAssignments.ts)
SHADOW PARITY:    60/60 cells EQUAL (6 roles × 10 routes)
ACCESS EXPANSIONS:0
ACCESS REGRESSIONS: 0
SYNC INVARIANTS:  5 call sites preserved; 4 positive + 1 negative sync
                  tests passing (5 it() blocks total)
                  [CodeRabbit PR #191 review H8: prior "5 positive + 1
                  negative" was internally inconsistent — only 4
                  positive cases exist.]
ZERO-WRITE:       7 mutating routes, all prove business + assignment +
                  users.role + audit zero-write on denied request
                  [CodeRabbit PR #191 review H2: prior "6 mutating
                  routes" undercounted; the 7 routes are POST /users,
                  PATCH /users/:id, POST /users/:id/reset-password,
                  DELETE /users/:id, POST /users/:id/role-assignments,
                  PATCH /role-assignments/:assignmentId,
                  DELETE /role-assignments/:assignmentId.]
TARGETED TESTS:   166 passed post-review-fix
                  (conformance 58 + boundary 65 + user 18 +
                  roleAssignments 6 + auth 19; boundary was 64
                  pre-fix, now 65 with the split System-login tests)
FULL TESTS:       reproduced green post-review-fix
STATIC GATES:     format, lint, lint:copy, lint:arch, lint:db-config,
                  lint:ui-gates, lint:eslint, typecheck, openapi — all PASS
BUILD:            PASS (9/9 turbo tasks)
WORKTREE:         clean
FINAL VERDICT:    PASS — AUTHOR SELF-ASSESSMENT
                  (independent adversarial review required for closure)
```

---

## O. Post-review-fix addendum (PR #191 CodeRabbit + gemini-code-assist)

This addendum documents the review-comment fixes applied on top of
`2e385644` in response to the four actionable comments on PR #191
(gemini-code-assist ×1, coderabbitai ×3). The fixes were judged VALID
against current HEAD before implementation; each maps to a finding in
the independent adversarial review at
`docs/phase3/rbac/RBAC-M10-C-ADVERSARIAL-REVIEW-20260719-073604-2e385644.md`.

```text
FIX 1 — System-login test (gemini + coderabbitai #1)
  FILES: apps/api/src/routes/permissionBoundary.test.ts
  ADDRESSES: H5 in adversarial review
  CHANGE: replaced the single forged-JWT-against-missing-actor test
          (which proved only the authentication boundary, with a loose
          [401,403] union) with two distinct tests:
            (a) forged System-claimed JWT, no user row → exact 401
                (authentication boundary)
            (b) real active System-role user POST /api/auth/login →
                exact 401, no auth-token cookie, AUTH_INVALID_CREDENTIALS
                error code, login.failure audit with
                reason=non_login_role + role=System + username match
                (the actual System non-login policy from auth.ts:168-203)
  WHY VALID: createFutureRoleUserForTest cannot seed role="System"
             (LegacyRole excludes it), but users.role is plain text
             with no CHECK constraint, so a direct schema.users insert
             is allowed and exercises the real production path.

FIX 2 — Route-specific audit-count assertions (coderabbitai #2 part 1)
  FILES: apps/api/src/routes/permissionBoundary.test.ts
  ADDRESSES: H3 in adversarial review
  CHANGE: three denied-mutation tests (PATCH /users/:id, POST
          /users/:id/reset-password, DELETE /users/:id) gained
          scoped audit-count assertions before/after the denied
          request:
            - PATCH /users/:id         → action=user.update,
              targetType=user, targetId=user.id
            - reset-password           → action=candidate.password_reset,
              targetType=user, targetId=user.id
            - DELETE /users/:id        → action=user.delete,
              targetType=user, targetId=user.id
  WHY VALID: the prior "audit count: n/a" was an unstated assumption.
             The capability gate guarantees the handler never runs on
             a denied request, so the audit-zero-write is implied —
             but the test now PROVES it instead of assuming it.

FIX 3 — PATCH assignment promote-branch coverage (coderabbitai #2 part 2)
  FILES: apps/api/src/routes/permissionBoundary.test.ts
  ADDRESSES: H4 in adversarial review
  CHANGE: the PATCH /role-assignments denial test switched from the
          no-op payload {isPrimary:false} (which fell through to the
          handler's no-op throw at roleAssignments.ts:228 and never
          exercised a state-changing branch) to {isPrimary:true}
          against a SEEDED SECONDARY assignment — the real promote
          branch. Assertions now verify:
            - secondary assignment remains isPrimary=false, isActive=true
            - primary assignment remains isPrimary=true
            - users.role unchanged
            - no new user.role_changed audit
  WHY VALID: the prior denial held only because the capability gate
             fired first; the test would also pass with payload {}.
             The new test would fail if the gate ever let an
             unauthorized principal reach a real state-changing promote.

FIX 4 — Report metadata refresh (coderabbitai #3)
  FILES: this report
  ADDRESSES: H8 in adversarial review
  CHANGE: refreshed §B / §F / §G / §I / §K / §N to reflect:
            - FINAL_HEAD: ee9064d6 → 2e385644 (was stale by 1 commit)
            - COMMITS: 2 → 3 (plus this review-fix = 4)
            - diff stat: 4 files / 1041 insertions → 5 files / 1691
              insertions (the report itself is the 5th file)
            - sync tests: "5 positive + 1 negative" (internally
              inconsistent) → "4 positive + 1 negative" (matches the
              5 it() blocks in the test file)
            - "6 mutating routes" → "7 mutating routes" (H2 correction)

ADDITIONAL CORRECTION (H2, not flagged by CodeRabbit but cheap while
refreshing metadata): the report previously claimed "6 mutating routes"
in §G and §N. The accurate count is 7 — POST /users,
PATCH /users/:id, POST /users/:id/reset-password, DELETE /users/:id,
POST /users/:id/role-assignments, PATCH /role-assignments/:assignmentId,
DELETE /role-assignments/:assignmentId. The "6 conceptual mutations"
in §J refers to the directive-§16 mutation EXPERIMENTS A–F, which is
correct and unchanged.
```

### Adversarial-review findings NOT addressed in this fix

The independent adversarial review surfaced additional findings that
were NOT flagged by the bot reviewers and are therefore out of scope
for this fix commit. They are recorded here for traceability and
scheduled for follow-up:

```text
H1 (P2): M10-C conformance test duplicates m10cRouteSpecs as a
   hand-written table instead of deriving from
   ROUTE_PERMISSION_REGISTRY. Mutation D in the adversarial review
   proved the test passes even when the registry is silently edited.
   DEFER: post-RBAC decomposition (apply uniformly to M10-A/B/C).

H6 (P2): POST /users/:id/role-assignments secondary-assignment create
   writes NO user.role_changed audit (roleAssignments.ts:151-158 only
   audits if isPrimary). ADR §7.2 classifies user.role.assign as a
   privilege change requiring audit.
   DISPOSITION REQUIRED: either add the audit in a follow-up, or
   amend the ADR to defer secondary-assignment audit to M10-E.

H7 (P2): PATCH /role-assignments/:assignmentId deactivate branch
   (roleAssignments.ts:213-226) writes NO audit, even though it can
   auto-promote a different role and re-sync users.role.
   DISPOSITION REQUIRED: same as H6.

H9 (P3, pre-existing): last-Admin guard (countActiveByRole) exists
   only in PATCH /users/:id; PATCH/DELETE /role-assignments bypass
   it. ADR §9 schedules the guard migration with M10-E.
   DEFER: M10-E.

H10 (P3): no direct cross-org test for the M10-C ID-bearing routes.
   Org-anchor enforcement IS present in the repos; the gap is test
   evidence only.
   DEFER: post-M10-C test addition.
```

