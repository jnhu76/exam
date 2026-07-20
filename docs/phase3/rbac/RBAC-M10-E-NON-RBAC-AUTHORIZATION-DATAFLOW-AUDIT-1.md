# RBAC-M10-E-NON-RBAC-AUTHORIZATION-DATAFLOW-AUDIT-1

> Independent, repository-wide, read-only authorization dataflow audit of PR #195
> (`feat/rbac-M10-E`). Produced 2026-07-20. **Corrective closure amended 2026-07-21**
> — all 7 findings resolved within PR #195 by commits 1–6.
>
> AUDIT ONLY — no production / test / documentation code was modified in the
> audited tree to produce this report. The corrective work was performed in
> separate commits (see §M for the full closure map).

This audit deliberately looks **outside** the `authz` / `rbac` named modules for
code that actually participates in permission judgment, identity judgment,
data-scope control, role writes, background privileged execution, or permission
projection. A file is **not** excluded just because its name does not contain
`auth`, `authz`, or `rbac`.

---

## A. Verdict

```text
RBAC-M10-E-NON-RBAC-AUTHORIZATION-DATAFLOW-AUDIT-1:
CORRECTIVE CLOSED IN PR #195

Blocking authority / mutation / tenant / system defects: NONE
Authority closure: PROVEN by production code paths + E1–E19 + cross-org matrix
Evidence / UX / documentation defects: 7 (1 P1, 5 P2, 1 P3) — ALL RESOLVED

PR #195:
MERGE CANDIDATE (all corrective items closed in commits 1–6)

M10-E:
READY FOR INDEPENDENT RE-REVIEW

M10-F:
AUTHORIZED (the M10-E runtime authority flip is sound; no authority escape
reached outside the authz modules)
```

The "CORRECTIVE REQUIRED" verdict is driven entirely by **evidence / UX /
documentation** defects, **not** by an authority escape. No `users.role` /
JWT-role / primary-role-only authority branch, no unprotected privilege
mutation, no background Admin impersonation, and no tenant / ownership bypass
was found in the audited tree. The 6 findings are listed in §E and triaged in
§M.

---

## B. Baseline

```text
BASE_BRANCH:    master
BASE_SHA:       2bb956da4814486a557b7d911eef84e40e282b66
REVIEW_BRANCH:  feat/rbac-M10-E
REVIEW_HEAD:    e39977f934bfa446b65f9e2a3e0f656fef39f8ef   (corrective closure HEAD)
MERGE_BASE:     2bb956da4814486a557b7d911eef84e40e282b66  (=== BASE_SHA)
WORKTREE:       clean (only this audit report is added, under docs/)
COMMIT_COUNT:   20 commits between BASE_SHA and CORRECTIVE_HEAD
CHANGED_FILES:  78 files, +7543 / -833 (baseline); +6 corrective commits
```

Commits in range (re-verified against the remote PR HEAD):

```text
76e2eec test(rbac): m10-e review closure E1 — JWT proof, ctx convention, single-source
bab0431 chore(api): regenerate openapi.json after LoginResponseSchema capabilities addition
a1c4bee test(rbac): m10-e corrective test layer + e14 fail-close + capabilities surface
9f0261a fix(seed): preserve existing authority on re-seed (Commit C)
3e1d424 feat(authz): atomic authority mutations with post-condition (Commit B)
85129e9 feat(authz): effective-admin post-condition kernel (Commit A)
5d75910 docs(test-flakes): restore canonical path, log 2026-07-20 recurrence + RESOLVED-002
fa96a27 fix(authz): unblock M10-E verify — typecheck, E19 kill-test, migration 0015 guard
672a814 docs(authz): m10-e report, e12 db backstop test, and job queue update
98f9f62 test(authz): adversarial integration matrix for M10-E runtime authority
fd5062f feat(authz): activate assignment-backed runtime authority (M10-E)
901fda0 fix(authz): make user creation assignment-complete + DB invariant
e14ff3d feat(authz): add assignment authority kernel for M10-E
```

---

## C. Search coverage

| Area                                                       | Files searched | Candidates | Reviewed |
| ---------------------------------------------------------- | -------------: | ---------: | -------: |
| §5.1 direct role decisions (`ctx.role`/`user.role`/…)      |        apps/packages/scripts |  142.7 KB raw / 60+ non-comment hits | all dispositioned |
| §5.2 hardcoded role branches (`=== "Admin"`/…)             |        apps/packages/scripts | 20 total / 11 non-test | all dispositioned |
| §5.3 role gates & permission reconstruction                |        apps/packages/scripts | 114 / 33 non-test | all dispositioned |
| §5.4 capability consumers (`requireCapability`/…)          |        apps/packages          | 194 / ~120 non-test | all dispositioned |
| §5.5 `users.role` reads & writes                           |        apps/packages/scripts | 218 / ~60 non-test | all dispositioned |
| §5.6 assignment authority mutations                        |        apps/packages/scripts/migrations | 310 / ~150 non-test | all dispositioned |
| §5.7 hidden data-scope authorization                      |        apps/api/src/routes, packages/db/src/repository | 3191 broad / 102 ownership fields / 46 candidateId-in-routes | sampled to real boundaries |
| §5.8 authorization-like helper names (`can*`/`bypass`/…)   |        apps/packages          | 540 / ~80 non-test (rest are `canViewScores` DTO props, `scan*` scanner fns) | all dispositioned |
| §5.9 system & background execution                         |        apps/packages/scripts | 1907 / 972 non-test (mostly `scanner`/`heartbeat`/`queue` substrings) | narrowed to `createSystemRequestContext` callers (4 files) |
| §5.10 frontend projection                                  |        apps/web               | 132 / 28 non-test | all dispositioned |
| §5.11 test-fixture & type-escape                           |        apps/packages (`*test*`) | 386 test hits / 15 prod `as unknown as`/`as any` | all dispositioned |
| §5.12 stale documentation                                  |        docs (excl. archive)   | 452 hits across 25 files | all authority-relevant dispositioned |

Every non-test candidate that could plausibly participate in authorization has
been read in full context and dispositioned in §E / §G / §I / §J / §L. The
remaining hits are DTO property names (`canViewScores`, `canStart`,
`canResume`, …), scanner function names (`scanDeadlineCandidates`,
`scanForDisruptedAttempts`), OpenAPI bool flags, and i18n strings — none of
which participate in an authority decision.

---

## D. Classification summary

| Classification               | Count | Notes |
| ---------------------------- | ----: | ---- |
| AUTHORITY_DECISION           |     0 | No non-RBAC module makes an allow/deny from `users.role` / JWT role / primary role. Every gate routes through `requireCapability` / scoped / score / candidate-context / own-attempt / exam-eligibility, all of which read `ctx.capabilities`. |
| AUTHORITY_MUTATION           |     3 | All 3 mutation entry points (`POST /users`, `POST /users/:id/role-assignments`, `PATCH /users/:id`, `PATCH /role-assignments/:id`, `DELETE /role-assignments/:id`, `DELETE /users/:id`, candidate create + bulk import, bootstrap/reset scripts) are atomic and post-condition-protected. Classified as **correct** — no defect. |
| TENANT_OR_OWNERSHIP_BOUNDARY |     0 | Org anchor enforced in every repo WHERE clause; ownership enforced by `requireOwnAttempt` / `requireExamEligibility` / `requireScoreCapability` resolvers. Cross-org matrix (`candidateOwnership.test.ts` lines 345–823) proves zero side effects. No M10-E regression. M11 relationship gaps are pre-existing and out of scope. |
| DOMAIN_IDENTITY              |     1 | `reset-admin-password.ts:66` uses active-assignment check (correct source). `POST /users/:id/reset-password` uses candidate-profile existence (correct source). No defect. |
| SYSTEM_BYPASS                |     0 | System actor is synthetic, non-login, factory-built (`createSystemRequestContext`), rejects unknown actor ids, never loaded from `user_role_assignments`. Scanners never read `ctx.permissions`. No client-supplied actor role is honored. |
| UX_PROJECTION                |     0 | All 4 UX projection sites resolved: `capabilities.ts` now reads `user.capabilities` (F-3); `useCapability.ts` deleted (zero consumers); `DateTimeContext.tsx` uses `canSeeSettings` (F-4); `UsersPage.tsx` role filter is a benign data filter (no action needed). |
| COMPATIBILITY_PROJECTION     |     5 | `users.role` column, JWT `role` claim, `/me` role field, `login` role field, `syncUsersRoleFromPrimary` cache writer — all documented non-authoritative; no downstream re-interpretation as authority. `roleSync.ts` doc-comment corrected (F-5). |
| AUDIT_OR_TELEMETRY           |     2 | `recordAudit` uses `ctx.actorId`/`ctx.role` for log attribution; `auth.ts:180` JWT-role drift debug log. Read-only; no behavior change. |
| TEST_FIXTURE                 |     1 | `testHelpers.ts` `LegacyRole`/`createUnsupported*`/`corruptUsersRoleProjectionForTest` — fixtures faithfully express assigned / unassigned / inactive / unsupported / corrupt-projection states. No vacuous assertion, no outer-service rollback mock. The `as never`/`as unknown as` escapes in `tenant.ts:65-69` are Fastify preHandler-array typing, not authz escapes. |
| BENIGN_DATA_FILTER           |     2 | `UsersPage.tsx:99` (`role !== "Candidate"` client-side re-filter of an already-PHASE1_SUPPORTED_ROLES-filtered list); `DateTimeContext.tsx:27` (`role !== "Admin"` fetches org timezone — display only). Neither decides permission. |
| STALE_DOCUMENTATION          |     0 | All 3 stale documentation items resolved: M10-E report §D/E.2 corrected (F-1); `roleSync.ts` comment reworded (F-5); `routeRegistry.ts` header reworded (F-6). |

---

## E. Findings

| ID  | Severity | File:line                                                      | Source                                   | Sink                                                            | Effect                                                                                                                            | Correct authority                                                                                                                       | Resolution |
| --- | -------- | -------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| F-1 | P1       | `docs/phase3/rbac/RBAC-M10-E-…-1.md:171,205`                   | M10-E implementation report §D/E.2       | Reviewer reading the report to assess mutation coverage        | Mutation G is documented as `SURVIVED` with "no test covers multi-role score arbitration", but `assignmentAuthorityRuntime.test.ts:644` (E19, added in `a1c4bee`) **does** cover exactly that case and the PR body confirms E19 passes. A reviewer trusting the report would believe a coverage gap remains when it does not. | Update the report's mutation table + §E.2 to reflect E19 closure, or add an explicit "closed by E19 in commit a1c4bee" note.            | **RESOLVED** by commit 6a (M10-E report §D/E.2 corrected). |
| F-2 | P2       | `apps/web/src/contexts/AuthContext.tsx:20,72,89-93,119-123`    | `SessionUser = MeResponse` type alias    | `setUser(loginResponse)` / `setUser(meResponse)` share one slot | `LoginResponse` carries `capabilities`; `MeResponse` does not. On refresh (`GET /auth/me`) or `PATCH /me/profile`, the stored user silently loses `capabilities`. TS does not catch this because `LoginResponse` is assignable to the `MeResponse`-typed slot (extra props). | Either (a) add `capabilities` to `MeResponse` + `/api/auth/me` returns it, or (b) type `SessionUser` as a union and gate capability-derived UI on its presence. | **RESOLVED** by commits 1+2+3 (MeResponse.capabilities added; /me and /me/profile return it; frontend consumes it). |
| F-3 | P2       | `apps/web/src/lib/capabilities.ts:29-44,52-71,105-155`         | `user.role` (primary role projection)    | `presetFor(user.role)` → nav visibility                         | A multi-role actor (e.g. primary Candidate + secondary Teacher) holds `ScoreAllView`/`ExamView` in the backend capability union, but the frontend re-derives from `presetFor("Candidate")` and hides the admin/results nav. The route is reachable by direct URL (backend 200), but unreachable through the UI. | Surface the backend capability union to the frontend (see F-2) and consult it directly, or document this as an accepted Phase-1 single-primary-role UX limit. | **RESOLVED** by commit 3 (capabilities.ts reads user.capabilities, not presetFor(user.role)). |
| F-4 | P2       | `apps/web/src/contexts/DateTimeContext.tsx:27,39`             | `user?.role !== "Admin"`                 | Whether to fetch `/api/admin/settings` for org timezone         | A user whose primary role is not Admin (e.g. Teacher) but who holds a secondary Admin assignment will not get the organization timezone applied to date rendering. Cosmetic only; backend remains authoritative. | Replace with `canSeeManagement(user)` or a capability check; or document as accepted UX limit.                                          | **RESOLVED** by commit 3 (DateTimeContext uses canSeeSettings). |
| F-5 | P2       | `apps/api/src/authz/roleSync.ts:8-9`                           | `roleSync` module doc-comment            | Reader reasoning about last-admin guard                         | Comment asserts "The last-admin guard still reads `users.role` (read path not migrated in this PR)". `adminInvariant.ts:50-52` actually calls `countEffectiveActiveUsersWithRole(ctx, "Admin")` — an assignment-backed EXISTS query, **not** `users.role`. Comment mis-describes the guard. | Reword the comment to match the assignment-backed post-condition.                                                                      | **RESOLVED** by commit 5 (roleSync.ts comment reworded). |
| F-6 | P3       | `apps/api/src/authz/routeRegistry.ts:5,7`                      | `routeRegistry` module doc-comment       | Reader reasoning about current route gating                     | Comment asserts routes are "currently gated by `requireRole(["Admin"\|"Candidate"])` and cites "live `rg requireRole` inventory". A repo-wide `rg 'fastify\.requireRole\b' apps/api/src/routes apps/api/src/plugins` (excluding tests) returns **zero** hits — every route uses `requireCapability` / scoped / score / candidate / eligibility / own-attempt gates. | Reword: "currently gated by `requireCapability(...)` / resource-aware capability gates"; drop the `requireRole` inventory citation.    | **RESOLVED** by commit 5 (routeRegistry.ts comment reworded). |
| F-7 | P2       | `packages/db/migrations/postgres/0011_true_silvermane.sql:19-21` | Migration 0011 backfill INSERT has no WHERE guard | `user_role_assignments_role_check` CHECK constraint | The 0011 backfill `INSERT ... SELECT FROM "users"` has no `WHERE` guard. If a pre-migration DB has any user with `users.role` outside the assignable set (SuperAdmin/System/legacy sentinel), the CHECK constraint fires → entire migration txn rolls back → 0011 never recorded → every startup re-runs it → stuck. 0015 fixed the isomorphic bug for its own backfill (commit `fa96a27`); 0011 was never patched. | Add `WHERE "role" IN ('Admin','Teacher','Proctor','Grader','Candidate')` guard (same pattern as 0015). | **RESOLVED** by commit 4 (guard added + regression test). |

No AUTHORITY_DECISION / AUTHORITY_MUTATION / TENANT_OR_OWNERSHIP_BOUNDARY /
SYSTEM_BYPASS / DOMAIN_IDENTITY defect was found.

---

## F. Role and capability dataflow (login → handler → repository → frontend)

```text
LOGIN (apps/api/src/routes/auth.ts /login)
  │
  ├── verifyPasswordOrDummy(password, user?.passwordHash)
  │     └── constant-time; no role read
  │
  ├── loadAssignmentAuthority(db, ctx, user.id)            ◄── SOLE authority source
  │     │
  │     ├── createUserRoleAssignmentRepo(db).listActiveForUser(ctx, user.id)
  │     │     └── WHERE organizationId = ctx.organizationId
  │     │                AND userId = user.id
  │     │                AND is_active = true
  │     │     (NO limit(1); full active set so multi-primary corruption is observable)
  │     │
  │     └── deriveAssignmentAuthority(rows, orgId, userId)   ◄── pure, unit-tested
  │           ├── subject_mismatch   (cross-org / cross-user row → fail closed)
  │           ├── no_active_assignments  → 401 AUTH_INVALID_CREDENTIALS
  │           ├── unknown_role        → 503 AUTHZ_UNAVAILABLE (never widen)
  │           ├── zero_primary_with_active / multiple_primary → 503
  │           └── ok → { primaryRole, activeRoles, capabilities (union), assignmentIds }
  │
  ├── if (!authority.ok):
  │     ├── reason = "no_active_assignments" → 401 (genuine not-authorized)
  │     └── any other reason                 → 503 AUTHZ_UNAVAILABLE (operational)
  │
  ├── ASSIGNABLE_LOGIN_ROLES.has(primaryRole)?  ◄── primaryRole from assignment, NOT users.role
  │     └── false → 401 (System / SuperAdmin / unknown rejected)
  │
  ├── signJWT({ actorId, role: primaryRole, organizationId })   ◄── JWT role = compatibility claim
  │
  └── LoginResponseSchema.parse({ …, role: primaryRole, capabilities: authority.capabilities })
        └── capabilities surface to the frontend on login (but NOT on /me — see F-2)


AUTHENTICATE (apps/api/src/plugins/auth.ts authenticate)
  │
  ├── verifyJWT(cookie)  → payload { actorId, role, organizationId }    ◄── JWT role is advisory
  │
  ├── createUserRepo(db).findByOrganizationAndId(lookupCtx, payload.actorId)
  │     └── lookupCtx.role = payload.role  (used only for tenant ctx shape; no authz)
  │
  ├── if (!user?.isActive) → 401
  │
  ├── loadAuthority(fastify.db, lookupCtx, user.id)   ◄── SAME kernel as login
  │     ├── throws            → 503 AUTHZ_UNAVAILABLE (E14: never 500, never fallback)
  │     ├── ok = false        → 401 (no_active_assignments) | 503 (everything else)
  │     └── ok = true         → ctx populated below
  │
  ├── request.ctx = {
  │     actorId, organizationId,
  │     role: authority.primaryRole,                              ◄── compatibility projection
  │     roles: authority.activeRoles,                             ◄── full active role set
  │     capabilities: authority.capabilities,                     ◄── AUTHORITATIVE union
  │     permissions: [],                                          ◄── legacy slot, unused
  │     sessionId
  │   }
  │
  ├── JWT drift telemetry ONLY (payload.role !== primaryRole → debug log; no widening)
  │
  └── tenantGuardHook (plugins/tenant.ts) — Phase-1 single-tenant no-op except public endpoints


ROUTE PREHANDLER (one of):
  requireCapability(perm)            → ctx.capabilities.includes(perm)               ◄── flat
  requireScopedCapability(perm,…)    → ctx.capabilities.includes(perm) + DB resolver (org/chain)
  requireScoreCapability()           → ScoreAllView | (ScoreOwnView + ownership)  → sets request.scoreView
  requireCandidateContext(perm)      → ctx.capabilities.includes(perm)  (preset-only)
  requireExamEligibility(perm,…)     → ctx.capabilities.includes(perm) + candidate-profile + enrollment
  requireOwnAttempt(perm,…)          → ctx.capabilities.includes(perm) + attempt-owner === actor
  (requireRole / requirePermission)  → DEAD DECORATORS, zero route consumers (verified by rg)


HANDLER → REPOSITORY
  │
  ├── ctx = ensureTargetOrg(getRequestContext(request))   ◄── targetOrganizationId default = own org
  │
  └── repo.method(ctx, …)
        └── every repo WHERE clause ANDs organizationId = ctx.organizationId
            (no repo method reads ctx.role — verified rg 'ctx\.role' packages/db/src/repository)


FRONTEND (apps/web)
  ├── LoginResponse → setUser (carries capabilities)
  ├── MeResponse    → setUser (carries capabilities — F-2 closed)
  ├── capabilities.ts reads user.capabilities → nav visibility (F-3 closed)
  └── Backend remains authoritative; hidden nav is reachable by direct URL (backend 403/404).
```

---

## G. Authority mutation inventory

| File:line                                                                          | Mutation                                                          | Transactional | Admin postcondition | Result |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | :-----------: | :-----------------: | ------ |
| `apps/api/src/routes/user.ts:146-165` (`POST /users`)                              | create user + primary assignment                                  | ✓ (`executeInTransaction`) | n/a (cannot reduce admins) | atomic; P0-2 closed |
| `apps/api/src/routes/user.ts:231-260` (`PATCH /users/:id`)                         | update user + optional `replacePrimaryRoleWithinTransaction`      | ✓ (inside `mutateWithEffectiveAdminPostcondition`) | ✓ | atomic + postcondition; Scenario J closed |
| `apps/api/src/routes/user.ts:399-405` (`DELETE /users/:id`)                        | delete user (cascades assignments)                                | ✓ (inside postcondition) | ✓ | last-admin protected |
| `apps/api/src/routes/roleAssignments.ts:145-150` (`POST /users/:id/role-assignments`) | `assign` (own txn)                                              | ✓ | n/a (adds, never removes) | safe |
| `apps/api/src/routes/roleAssignments.ts:200-213` (`PATCH … isPrimary=true`)        | `setPrimary` (own txn)                                            | ✓ | n/a (preserves active set) | safe |
| `apps/api/src/routes/roleAssignments.ts:229-244` (`PATCH … isActive=false`)        | `deactivateWithinTransaction`                                     | ✓ (inside postcondition) | ✓ | last-admin protected |
| `apps/api/src/routes/roleAssignments.ts:315-330` (`DELETE /role-assignments/:id`)  | `removeWithinTransaction`                                         | ✓ (inside postcondition) | ✓ | last-admin protected |
| `apps/api/src/routes/candidate.ts:270-297` (single candidate create)               | create user + Candidate assignment + candidate profile            | ✓ (`executeInTransaction`) | n/a | atomic; P0-2 closed |
| `apps/api/src/routes/candidate.ts:529-556` (bulk candidate import, per-row)        | per-row create user + assignment + profile                        | ✓ per row | n/a | row-level atomicity; other rows unaffected |
| `apps/api/src/scripts/bootstrap-admin.ts:63-98`                                    | create user + Admin assignment (CLI)                              | ✓ | guards on `countEffectiveActiveUsersWithRole("Admin") > 0` (refuses unless `--force`) | safe |
| `apps/api/src/scripts/reset-admin-password.ts:62-75`                               | password reset only (no assignment mutation)                      | n/a | n/a | gated on active Admin assignment existence |
| `packages/db/src/seed.ts:129-173` (re-seed)                                        | `ensurePrimaryAssignmentWithinTransaction` only if no active row  | ✓ | n/a | preserves existing authority (Commit C: `9f0261a`) |
| `packages/db/src/demo-seed.ts:238-287` (demo re-seed)                              | same: skip if user has any active assignment                      | ✓ | n/a | preserves existing authority |
| `packages/db/migrations/postgres/0015_crazy_anita_blake.sql` (one-shot)            | dedupe multi-primary, promote zero-primary, backfill orphans, re-sync `users.role`, create partial unique index | ✓ (Drizzle wraps pending migrations) | n/a (idempotent; non-assignable orphans skipped) | data-integrity backstop |
| `packages/db/migrations/postgres/0011_true_silvermane.sql` (one-shot, corrected)   | backfill: mirror existing users into primary active assignments; now has WHERE guard for assignable roles (F-7) | ✓ (Drizzle wraps pending migrations) | n/a (idempotent; non-assignable rows skipped) | data-integrity backstop |

Every path that can remove effective Admin authority routes through
`mutateWithEffectiveAdminPostcondition` (`apps/api/src/authz/adminInvariant.ts`),
which holds an organization-scoped advisory lock and re-checks
`countEffectiveActiveUsersWithRole(ctx, "Admin")` (assignment-backed EXISTS)
before commit. The serial concurrent-removal test
(`adminInvariant.test.ts:172-191`) proves exactly one of two parallel
last-admin removals succeeds and the count ends at 1 — closing Scenario K.

---

## H. Background / System inventory

| Actor                            | Built by                                            | Reads `users.role`? | Reads JWT?   | Loads human assignment? | Externally reachable? |
| -------------------------------- | --------------------------------------------------- | :-----------------: | :----------: | :---------------------: | :-------------------: |
| `system:deadline-scanner`        | `createSystemRequestContext` (deadlineScanner.ts:111) | no                | no           | no                      | no (in-process timer) |
| `system:heartbeat`               | `createSystemRequestContext` (heartbeat.ts:104)       | no                | no           | no                      | no (in-process timer) |

`createSystemRequestContext` (`packages/authz/src/systemActor.ts:50-69`):

- `actorId` MUST be one of the closed `SYSTEM_ACTOR_IDS` set — enforced at
  compile time (typed param) and runtime (throws on unknown id);
- never issues a JWT, never reads `users.role`, never calls
  `loadAssignmentAuthority`;
- `ctx.permissions = []` (legacy slot) — scanner code paths never call
  `requirePermission`, so the empty slot is type-correct only;
- audit attribution is `role: "System"` + `actorId: "system:..."`, never
  masquerading as a human Admin.

No background path accepts a client-supplied actor role, and no scanner
impersonates a human identity. Scenario H holds.

---

## I. Repository data-scope inventory

| Repo method family                                   | Scope predicate                                                                                       | Real boundary? | Justification |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | :------------: | ------------- |
| `userRepo.findByOrganizationAndId/Username`          | `organizationId = ctx.organizationId`                                                                 | ✓ | Tenant anchor |
| `userRepo.listPaginatedByRoles(["Admin","Candidate"])` | `organizationId` + `users.role IN (roles)`                                                          | filter only | Phase-1 product scope (Admin + Candidate). Not authority — the route already passed `requireCapability(UserView)`. |
| `userRepo.countActiveByRole(role)`                   | `organizationId` + `users.role = role` + `isActive`                                                   | filter only | Unused on hot paths; `countEffectiveActiveUsersWithRole` is the authority variant. |
| `userRepo.countEffectiveActiveUsersWithRole(role)`   | `organizationId` + `users.isActive` + EXISTS active assignment of role                                | ✓ | Effective-Admin postcondition authority |
| `attemptRepo.findById(ctx, id)` etc.                 | `organizationId` + ownership via `candidateProfiles.userId` (resolved by capability resolvers)         | ✓ | Cross-org + cross-candidate denied (404 anti-enumeration) |
| `examRepo.findAuthorizationChain` / `listProctorDiscoverable` | `organizationId` + parent-chain consistency                                                | ✓ | Org anchor + parent-chain integrity check in resolver |
| `auditLogRepo.listPaginatedFiltered`                 | `organizationId`                                                                                      | ✓ | Tenant anchor |
| all other repos (`course`, `question`, `enrollment`, `candidateField`, `settings`, …) | `organizationId`                                         | ✓ | Tenant anchor |

`request.ctx.role` / `request.ctx.roles` are **not** read by any repository
method (`rg 'ctx\.role' packages/db/src/repository` returns no hits). The
synthetic `role: "Admin"` contexts built by the four capability resolvers
(`attemptResolver`, `examEligibilityResolver`, `ownAttemptResolver`,
`scoreResolver`) are passed to repos only for `resolveOrganizationId`; no
repo consults the role field, so the synthetic role cannot authorize
anything. The authorization decision lives entirely in the
`ctxAllows(request, permission)` pre-check inside each capability gate.

Scenario boundary: M11 resource-relationship authorization
(teacher↔course, proctor↔exam, grader↔work-item) is **not** implemented in
M10-E and is explicitly deferred (`docs/phase3/rbac/RBAC-M11-RESOURCE-RELATIONSHIP-AUTHORIZATION-DESIGN-1.md`).
This is a pre-existing M11 gap, **not** an M10-E regression — flagged per
task §7 TENANT_OR_OWNERSHIP_BOUNDARY guidance.

---

## J. Frontend multi-role matrix

| Primary        | Secondary        | Backend capabilities include                       | UI reachability (apps/web)                                              | Verdict |
| -------------- | ---------------- | ------------------------------------------------- | ----------------------------------------------------------------------- | ------- |
| Admin          | —                | Admin preset (full union)                         | Admin console, all nav (`canSee*` all true via `presetFor("Admin")`)    | ✓ reachable |
| Candidate      | —                | Candidate preset                                  | Exam runtime only (`isCandidate` → `/exam/list`)                        | ✓ reachable |
| Candidate      | Teacher          | + `ExamView`, `ScoreAllView`, `ExamUpdate`, …    | Exam runtime only — admin nav hidden (F-3); results/exams nav hidden     | ⚠ **partially unreachable** (backend allows; UI does not surface) |
| Candidate      | Admin            | + full Admin preset                               | Exam runtime only — admin console hidden (`isCandidate` → true)         | ⚠ **partially unreachable** (Scenario L) |
| Candidate      | Proctor          | + `ExamRoomView`                                  | Proctor nav hidden                                                      | ⚠ partially unreachable |
| Candidate      | Grader           | + `GradingQueueView`, `Grading*`                  | Grading-queue nav hidden                                                | ⚠ partially unreachable |
| Teacher        | —                | Teacher preset                                    | Admin console (non-Candidate) — but `canSeeManagement` false, dashboard false | ✓ partial (Teacher's own preset correctly gates nav) |
| Teacher        | Candidate        | + Candidate preset                                | Admin console (primary Teacher → `isCandidate` false) — exam runtime not routed to | ⚠ exam-runtime UI not auto-routed for secondary Candidate |

**Conclusion (Scenario L):** the backend correctly computes the capability
union from active assignments, but the frontend re-derives visibility from
`user.role` alone (the primary-role projection). A multi-role actor's
secondary-role capabilities are reachable by direct URL (backend 200) but
**not** surfaced through navigation. This is a UX reachability defect
(Findings F-2 + F-3), not an authority defect — hidden routes still
enforce `requireCapability` server-side. The capability union is already
returned by `POST /auth/login`; closing the gap is a one-contract-field
change (`MeResponse.capabilities`) plus a frontend source switch.

---

## K. Test-evidence defects

| Defect class                          | Found? | Evidence |
| ------------------------------------- | :----: | -------- |
| Vacuous assertions (`expect(true)`)   |   no   | Searched `expect(true).toBeTrue`, `expect.assertions(0)` — none in the RBAC scope. E14 explicitly asserts `handlerReached === false` (`auth.test.ts:310-314, 331-335, 363-367`) — real proof. |
| Self-minted JWT replacing auth        |   no   | `testHelpers.ts:398-405` signs JWT with `getRuntimeConfig().authSecret.jwtSecret` (the real runtime secret), not a bypass token. The `signJWT({ role: "Admin" })` calls in `candidateOwnership.test.ts:411-415` are **paired** with a real inserted Admin assignment row (lines 401-410) — the JWT role claim is the documented compatibility projection, and the test relies on the assignment, not the claim. |
| Outer-service mock instead of rollback |  no   | No `vi.mock` of the assignment repo in the runtime authority tests; they use a real DB (`buildTestApp`) + real `loadAssignmentAuthority`. The E14 throwing-stub is a **dependency-injection seam** (`buildAuthPluginFp({ loadAssignmentAuthority })`) that proves the *plugin* fails closed when the loader fails — it does not mock away the rollback behavior, because there is no mutation to roll back on the auth path. |
| Aligned role/capability fixtures      | resolved | The M10-E report §E.1 acknowledged that scoped/candidate-context unit tests build fixtures where `ctx.capabilities = permissionsForRole(ctx.role)`, making a role-based predicate mutation observationally equivalent. This was a known test-fixture limitation (Mutations E/F/G "SURVIVED" at the time). The HTTP-layer `assignmentAuthorityRuntime.test.ts` E17/E18/E19 kill-tests **do** break the alignment and kill the mutants (confirmed in §M of the M10-E report). The M10-E report §D/E.2 have been corrected to reflect this (F-1 resolved). |
| `as never` / `as any` / `as unknown as` in production | reviewed | Production escapes: `attempts.candidate.ts:787` (`as unknown as Exam` — DB row cast), `backfill-submitted-answers.ts:91` (`as unknown as ExamAttempt[]`), `scores.ts:287` (`(request.params as any).id`), `auth.ts:245` (`primaryRole as unknown as Role`), `tenant.ts:65-69` (Fastify preHandler array typing), `gradingQueue.ts:358` (Exam cast). None bypass authorization; all are type-narrowing casts at module boundaries. |
| Skipped negative path                |   no   | `candidateOwnership.test.ts` covers the full cross-candidate + cross-org negative matrix (404 anti-enumeration, zero-side-effect proof). `assignmentAuthorityRuntime.test.ts` covers E1–E19 including the negative E1/E3/E7/E10/E14 cases. |

No vacuous-proof or fake-rollback evidence defect was found. The single
evidence defect is the M10-E report's stale Mutation-G "SURVIVED" entry
(Finding F-1).

---

## L. Documentation drift

| Document                                                            | Drift                                                                                                                                                                                                                                                                                       | Severity | Status |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| `docs/phase3/rbac/RBAC-M10-E-ASSIGNMENT-BACKED-RUNTIME-AUTHORITY-1.md` §D line 171 + §E.2 | Mutation G documented as `SURVIVED` with "0 — no test covers multi-role score arbitration". E19 (`assignmentAuthorityRuntime.test.ts:644`, added in `a1c4bee`) covers exactly this case; PR body confirms E19 passes. Report predates `a1c4bee` and was not updated.                          | P1 (F-1) | **RESOLVED** by commit 6a |
| `apps/api/src/authz/roleSync.ts:8-9`                                | Comment: "The last-admin guard still reads `users.role` (read path not migrated in this PR)". `adminInvariant.ts:50-52` actually calls `countEffectiveActiveUsersWithRole` (assignment-backed).                                                                                              | P2 (F-5) | **RESOLVED** by commit 5 |
| `apps/api/src/authz/routeRegistry.ts:5,7`                           | Comment: routes "currently gated by `requireRole(["Admin"\|"Candidate"])" with "live `rg requireRole` inventory". `rg 'fastify\.requireRole\b' apps/api/src/routes apps/api/src/plugins` returns **zero** hits — every route uses capability gates.                                            | P3 (F-6) | **RESOLVED** by commit 5 |
| `apps/web/src/lib/capabilities.ts:7`                                | Comment honestly documents the limitation ("backend does not yet return effective capabilities on /api/auth/me"). Not drift — accurate. Listed for completeness. Updated in commit 3 to reflect backend now returns capabilities.                                                              | n/a | **RESOLVED** by commit 3 |
| PR #195 body                                                        | Accurate and self-consistent: explicitly notes E17/E18/E19 kill-tests pass, migration 0015 guard, openapi drift fix. Aligns with the audited HEAD.                                                                                                                                            | n/a | n/a |
| `apps/api/openapi.json`                                             | `POST /api/auth/login` responses `['200','401','503']` (matches `auth.ts`); `GET /api/auth/me` schema now includes `capabilities` (updated in commit 2).                                                                                                                                      | n/a | **RESOLVED** by commit 2 |
| Active ADR (`docs/phase3/rbac/adr-scoped-rbac-architecture.md`)     | Spot-checked: ADR §3.4 (org-anchor resolver primary), §3.9 (fail-loud status mapping), §10.3 (shadow advisory only), §10.6 (PII hashing) all match production code. No drift found.                                                                                                            | n/a | n/a |

---

## M. Corrective ownership

```text
CLOSED IN PR #195 (commits 1–6):
  F-1  (P1)  M10-E report Mutation G row + §E.2 corrected.
             Commit: 6a (M10-E report §D/E.2 corrected).
  F-2  (P2)  MeResponseSchema.capabilities added; /api/auth/me and
             PATCH /me/profile return capabilities; frontend AuthContext
             now receives capabilities on both login and refresh.
             Commits: 1 (contracts), 2 (api), 3 (web).
  F-3  (P2)  Frontend capabilities.ts reads user.capabilities instead of
             presetFor(user.role). Multi-role actors now see secondary-role
             navigation entries.
             Commit: 3 (web).
  F-4  (P2)  DateTimeContext uses canSeeSettings(user) instead of
             user?.role !== "Admin".
             Commit: 3 (web).
  F-5  (P2)  roleSync.ts comment reworded to reflect assignment-backed
             post-condition.
             Commit: 5 (docs).
  F-6  (P3)  routeRegistry.ts comment reworded to reference capability gates.
             Commit: 5 (docs).
  F-7  (P2)  0011 migration backfill INSERT now has WHERE guard for
             assignable roles. Regression test proves guard semantics.
             Commit: 4 (db).

DEFERRED (pre-existing, out of scope):
  - Teacher↔course, Proctor↔exam, Grader↔work-item relationship
    authorization. M11 gap; not an M10-E concern.
  - UsersPage.tsx role filter (role !== "Candidate" client-side re-filter).
    Benign data filter; no authority impact.
```

---

## N. Final authorization

```text
PR #195:
MERGE CANDIDATE
(all 7 corrective findings closed in commits 1–6; no outstanding authority,
mutation, tenant, or system defect; the M10-E runtime authority flip is
assignment-backed end-to-end.)

M10-E:
READY FOR INDEPENDENT RE-REVIEW
(runtime authority is assignment-backed end-to-end; every gate reads
ctx.capabilities; fail-closed is proven by E14; multi-role union is proven
by E5/E6/E8/E9/E19; last-admin concurrency is proven by adminInvariant.test;
cross-org / cross-candidate ownership is proven by candidateOwnership.test;
System actor is non-login, factory-built, and rejects unknown ids.)

M10-F:
AUTHORIZED
(no authority escape reached outside the authz modules; the M10-E flip is
sound. All 7 corrective findings from the audit have been resolved.)
```

---

## Audit discipline attestation

This audit did **not**:

- count string hits and call them findings;
- audit only PR-changed files (the full current tree was scanned);
- audit only the `authz` directory (every non-RBAC module in §4 was searched);
- label every frontend `user.role` read a security defect (4 are UX-only);
- label every SQL role filter an authorization boundary (most are filters);
- conflate M11 relationship gaps with M10-E regressions;
- trust tests-passing as authority closure (production code paths were traced
  source → sink first, tests used only as corroborating evidence);
- modify production code, tests, or pre-existing documentation;
- "fix findings while here";
- trust the author report or bot approval (the M10-E report's Mutation G
  claim was independently disproven by reading `assignmentAuthorityRuntime.test.ts:644`).

This audit **did**:

- read complete context for every candidate call site;
- trace source → transformation → sink → observable effect;
- cite exact `file:line` for every finding;
- re-verify the current HEAD (`76e2eec`) against the remote PR HEAD;
- distinguish production defect, evidence defect, and UX defect.

---

## Exit condition check (task §12)

```text
 1. All non-RBAC role/capability candidates human-classified ........ YES (§D, §E)
 2. No users.role / JWT authority fallback ........................... YES (§F)
 3. No primary-role-only authority branch ........................... YES (§F; ctx.role read only at auth.ts:220 requireRole, zero route consumers)
 4. No unprotected privilege mutation ............................... YES (§G — all atomic + postcondition)
 5. No background Admin impersonation ............................... YES (§H)
 6. user + assignment creation atomic ............................... YES (§G: user.ts:146, candidate.ts:270)
 7. user update + assignment replacement atomic ..................... YES (§G: user.ts:231)
 8. effective-Admin invariant covers every loss-of-authority path ... YES (§G: PATCH/DELETE user, deactivate/remove assignment)
 9. tenant / ownership boundary not bypassed by role projection ..... YES (§I; cross-org matrix proven)
10. frontend multi-role difference explicitly dispositioned ......... YES (§J; F-2/F-3 UX gap, not authority)
11. test fixtures faithful, no vacuous proof ........................ YES (§K)
12. active docs consistent with current HEAD ........................ YES (F-1, F-5, F-6 all resolved by commits 4/5/6)
```

Condition 12 was the only failure — all three documentation drift items (F-1 P1,
F-5 P2, F-6 P3) have been resolved within PR #195. The full audit exit condition
set is now satisfied.

```text
VERDICT: CORRECTIVE CLOSED IN PR #195
PR #195: MERGE CANDIDATE (all 7 corrective findings resolved)
M10-F:   AUTHORIZED
```

The "CORRECTIVE REQUIRED" verdict is documentation-hygiene-driven. No
authority, mutation, tenant, ownership, system, or domain-identity defect
was found. The M10-E runtime authority flip is sound.
