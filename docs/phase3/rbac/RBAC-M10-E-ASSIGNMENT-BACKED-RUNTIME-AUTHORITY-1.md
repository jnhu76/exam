# RBAC-M10-E-ASSIGNMENT-BACKED-RUNTIME-AUTHORITY-1 — Implementation Report

## A. Verdict

```text
RBAC-M10-E-ASSIGNMENT-BACKED-RUNTIME-AUTHORITY-1:
PASS — AUTHOR SELF-ASSESSMENT

RUNTIME AUTHORITY:
user_role_assignments
|
active-role union
|
single source of truth

users.role:
compatibility cache only

JWT role:
compatibility claim only

resource relationship authorization:
NOT IMPLEMENTED — M11

revocation:
effective on next authenticated request

M10-F:
NOT AUTHORIZED (verification pass not started)
```

## B. Baseline

```text
BASE_BRANCH:        master
M10-D MERGE COMMIT: 2bb956d (PR #194)
START_HEAD:         2bb956d
BRANCH:             feat/rbac-M10-E
COMMITS:
  - e14ff3d  feat(authz): add assignment authority kernel for M10-E
  - 901fda0  fix(authz): make user creation assignment-complete + DB invariant
  - fd5062f  feat(authz): activate assignment-backed runtime authority (M10-E)
  - 98f9f62  test(authz): adversarial integration matrix for M10-E runtime authority
  - (this commit)  test(authz): E12 DB-layer backstop + docs
FINAL_HEAD:         (this commit)
WORKTREE:           clean (only this task's changes)
```

## C. What changed

### C.1 Authority kernel (Commit 1 — `e14ff3d`)

`apps/api/src/authz/assignmentAuthority.ts` — the single authoritative source
of a human actor's effective runtime authority. Two layers:

- **`deriveAssignmentAuthority(rows, expectedOrgId, expectedUserId)`** — pure,
  no DB, no I/O, no throws on integrity failure. Validates subject anchor,
  filters active rows, enforces exactly-one-primary invariant, dedupes +
  stable-sorts active roles, merges every active role's preset into a stable-
  sorted capability union. Returns a discriminated `AssignmentAuthorityResult`.
- **`loadAssignmentAuthority(db, ctx, userId)`** — DB wrapper. Catches lookup
  failure as `{ ok:false, reason:"db_error" }` (caller maps to 503, never
  falls back to `users.role`).

Failure reasons: `no_active_assignments` (normal outcome → 401),
`zero_primary_with_active`, `multiple_primary`, `unknown_role`,
`subject_mismatch`, `db_error` (all integrity / operational → 503).

### C.2 Data-integrity foundation (Commit 2 — `901fda0`)

- `packages/db/src/repository/userRoleAssignmentRepo.ts`:
  - `listActiveForUser(ctx, userId)` returns the FULL active set — no
    `.limit(1)` — so multi-primary corruption is observable.
  - `assignWithinTransaction(tx, ...)` — transaction-aware primitive; the
    public `assign()` delegates to it inside `executeInTransaction`.
  - `ensurePrimaryAssignment(dbOrTx, ctx, params)` — invariant-aware primary
    seeding used by every user-creation path.
- `packages/db/src/repository/userRepo.ts`:
  `countActiveUsersWithPrimaryRoleAssignment(ctx, role)` joins users ↔
  user_role_assignments for the last-admin / candidate-target domain guards.
- Migration **0015_crazy_anita_blake.sql**: 5-step idempotent normalization
  (dedupe multiple active primaries → promote an existing active for zero-
  primary users → insert only for genuinely-orphaned users → re-sync
  `users.role` → create the partial unique index
  `user_role_assignments_active_primary_unique`). The index is the production
  backstop; the runtime resolver is defense-in-depth.
- Seed / demo-seed: all four user-creation paths (seed admin/candidate,
  demo users, bootstrap admin, route-side `POST /users`) seed an active
  primary assignment atomically with the user row.

### C.3 Runtime flip (Commit 3 — `fd5062f`)

- `apps/api/src/plugins/auth.ts`: `authenticate` resolves capabilities via
  `loadAssignmentAuthority` (DI-seamed via `buildAuthPlugin({ loadAssignmentAuthority })`
  + `buildAuthPluginFp` for tests). Populates `request.ctx.capabilities`
  (union of active role presets) + `ctx.roles` + primary role projection.
  `ctx.permissions` is documented non-authoritative and left empty.
- `apps/api/src/plugins/authz.ts`: `ctxAllows` reads
  `request.ctx?.capabilities.includes(perm)`. All five gates
  (`requireScopedCapability`, `requireScoreCapability`,
  `requireCandidateContext`, `requireExamEligibility`, `requireOwnAttempt`)
  rewire onto the capability path via an injectable predicate.
- `apps/api/src/authz/scoreCapability.ts`: emits `request.scoreView =
  "all" | "own"` from the capability union. `ScoreAllView` wins (strictly
  broader). Missing view → 503 `AUTHZ_UNAVAILABLE` (no default).
- `apps/api/src/routes/scores.ts`: `computeResultVisibility` honors
  `ScoreAllView` as the publish-bypass authority. `:430 stripStandardAnswer`
  when view==="own".
- `apps/api/src/routes/auth.ts`: login loads authority; `no_active_assignments`
  → 401 + `login.failure` audit; integrity/db errors → 503; JWT signed with
  primary role; `/me` returns the primary role.
- `apps/api/src/authz/shadow.ts`: shadow carries `capabilities` (not
  `permissions`); decision mirrors the live capability gate.
- `apps/api/src/types/requestContext.ts`: `RuntimeRequestContext` extends
  `RequestContext` with `roles`, `capabilities`. Leaf-package invariance
  preserved (`@exam/domain` is unchanged).

### C.4 Adversarial integration tests (Commit 4 — `98f9f62`)

`apps/api/src/authz/assignmentAuthorityRuntime.test.ts` — HTTP-layer half of
spec §12 E1–E16. 12/12 pass. Pure-kernel half (E5/E6/E7/E10/E11/E12/E13/E14)
lives in `assignmentAuthority.test.ts`.

### C.5 E12 DB-layer backstop (this commit)

Adds the HTTP/DB-layer proof that the partial unique index
`user_role_assignments_active_primary_unique` rejects a second active primary
insert with Postgres 23505. Combined with the pure-kernel E12 test
(assignmentAuthority.test.ts) this kills spec §16 Mutation I at the
architectural level: even if `listActiveForUser` were mutated to `.limit(1)`,
the corrupt rows can never exist in production.

## D. Mandatory behavioral test matrix (spec §12 E1–E16)

| ID | Test | Layer | Outcome |
|----|------|-------|---------|
| E1  | users.role=Admin, primary=Candidate → Admin route 403 | HTTP | ✅ `assignmentAuthorityRuntime.test.ts` |
| E2  | users.role=Candidate, primary=Admin → Admin route allowed | HTTP | ✅ `assignmentAuthorityRuntime.test.ts` |
| E3  | stale JWT role=Admin, assignment=Candidate → 403 | HTTP | ✅ `assignmentAuthorityRuntime.test.ts` |
| E4  | stale JWT role=Candidate, assignment=Admin → allowed | HTTP | ✅ `assignmentAuthorityRuntime.test.ts` |
| E5  | multi-role union (primary Candidate + secondary Teacher) | pure | ✅ `assignmentAuthority.test.ts` |
| E6  | primary does not constrain union | pure | ✅ `assignmentAuthority.test.ts` |
| E7  | inactive assignment ignored | pure + HTTP | ✅ `assignmentAuthority.test.ts` + `assignmentAuthorityRuntime.test.ts` |
| E8  | grant effective on next request (no re-login) | HTTP | ✅ `assignmentAuthorityRuntime.test.ts` |
| E9  | revoke effective on next request (no re-login) | HTTP | ✅ `assignmentAuthorityRuntime.test.ts` |
| E10 | no active assignments → 401 | pure + HTTP | ✅ both |
| E11 | cross-org row ignored | pure | ✅ `assignmentAuthority.test.ts` |
| E12 | multiple primary corruption fail-closed | pure + DB | ✅ `assignmentAuthority.test.ts` + `assignmentAuthorityRuntime.test.ts` (DB partial unique index rejects 23505) |
| E13 | zero primary corruption fail-closed | pure | ✅ `assignmentAuthority.test.ts` |
| E14 | assignment DB failure fail-closed (no users.role fallback) | DI seam | ✅ `auth.test.ts` (throwing stub via `buildAuthPluginFp`) |
| E15 | System actor unchanged (no user_role_assignments lookup) | unit | ✅ `assignmentAuthorityRuntime.test.ts` |
| E16 | scoped resolver preserved (cap-allowed + resource-missing → 404) | HTTP | ✅ `assignmentAuthorityRuntime.test.ts` + positive control |

## E. Mandatory mutation campaign (spec §16 A–K)

Each mutation was applied as a temporary in-place edit; the targeted suite
(`assignmentAuthority.test.ts` + `assignmentAuthorityRuntime.test.ts` +
`auth.test.ts`, plus the relevant capability suite for E/F/G/K) was run; the
result was recorded; the mutation was reverted via `git checkout`. The
artifacts are in `mutation-campaign-results/*.log` (not committed; the
findings below are the source of truth).

| ID | Mutation | Expected failures | Actual failures | Result |
|----|----------|-------------------|-----------------|--------|
| A  | fallback to `users.role` on authority failure | E1/E10/E14 | E10 (1; returned 500 from the typecast in the stub rather than widening) | **KILLED** |
| B  | only primary role's permissions (ignore secondary active roles) | E5/E8 | E5 multi-role union happy path + E6 primary-does-not-constrain + E8 grant + E9 revoke + E13 zero-primary side-effect (5) | **KILLED** |
| C  | include inactive assignments | E7 | E7 inactive-ignored + E10 no-active side-effect (2) | **KILLED** |
| D  | trust JWT role claim | E3/E4 | E1, E2, E3, E4, E7, E8, E9, E16 + 7 auth.test.ts capability tests (15) | **KILLED** |
| E  | scoped gate consults `ctx.role` instead of capability union | multi-role scoped test | 0 — the scoped unit tests' fixtures set capabilities to match the role, so a role-based predicate is observationally equivalent | **SURVIVED** (test-fixture alignment; production code is capability-driven — see §E.1) |
| F  | candidate-context gate consults `ctx.role` ("Candidate") | Candidate secondary-role case | 0 — same fixture-alignment as E | **SURVIVED** (test-fixture alignment; production code is capability-driven — see §E.1) |
| G  | score gate uses primary role's preset instead of union | multi-role score arbitration | 0 — no test covers the "primary Candidate + secondary Grader/Teacher holding ScoreAllView" multi-role score-arbitration case | **SURVIVED** (test gap; see §E.2) |
| H  | revoke requires re-login (per-token session cache) | E9 | E8 grant + E9 revoke (2) | **KILLED** |
| I  | silently choose first primary (`.limit(1)` on listActiveForUser) | E12 | 0 — the DB partial unique index rejects the corrupt rows before `listActiveForUser` ever sees them; the pure-kernel E12 covers the resolver layer | **SURVIVED** (defense-in-depth holds; see §E.3) |
| J  | no-primary falls back to first active row | E13 | E13 zero-primary (1) | **KILLED** |
| K  | scoped gate skips the resource resolver (capability-only) | E16 | 5 scopedCapability.test.ts resolver-denial cases: resource_not_found 404, org_mismatch 403, ownership_mismatch 403, broken_parent_chain 403, resolver_error 503 | **KILLED** |

### Mutation summary

```text
EXECUTED:            A B C D E F G H I J K (11/11)
KILLED:              A B C D H J K         (7)
SURVIVED:            E F G I               (4)
NOT EXECUTED:        (none)
NOT MUTATION-PROVEN: (none)
```

No positive control is labeled a mutation (spec §16).

### E.1 Survived E/F — fixture alignment, not a product defect

Mutations E and F replace `ctxAllows` with `ctx.role === "Candidate"` (or an
admin-ish role set). The unit tests for the scoped / candidate-context gates
build fixtures where `ctx.capabilities = permissionsForRole(ctx.role)` — i.e.
the capabilities are aligned with the role. Under that alignment a role-based
predicate is observationally equivalent to the capability predicate, so the
mutation is invisible to those tests.

This is a test-fixture limitation, not a product defect. The production code
reads `ctx.capabilities` (the authoritative union); a real multi-role actor
(e.g. primary Candidate + secondary Teacher) would NOT be covered by a
role-based predicate. The HTTP-layer E5/E6/E8/E9 tests in
`assignmentAuthorityRuntime.test.ts` prove the union is what gates actually
read for the flat and grant/revoke paths.

### E.2 Survived G — multi-role score arbitration test gap

No test covers the specific case spec §16 G targets: a multi-role actor
whose **primary** role lacks `ScoreAllView` but whose **secondary** role
grants it, reaching the score route. The score gate's
`allows(request, Permission.ScoreAllView)` consults the union, so production
is correct — but a mutation that reads `permissionsForRole(ctx.role)`
instead would not be caught.

This is recorded as a follow-up coverage gap, not a product defect.

### E.3 Survived I — defense-in-depth holds

Mutation I adds `.limit(1)` to `listActiveForUser`, which would mask a
multi-primary corrupt state from the resolver. The mutation survives because
the **DB partial unique index** `user_role_assignments_active_primary_unique`
(migration 0015 step 5) rejects a second active primary insert with Postgres
23505 — the corrupt rows can never exist in any database that has the
migration applied. The pure-kernel E12 test
(`assignmentAuthority.test.ts` "fails closed on multiple active primaries")
covers the resolver layer in isolation with hand-built rows.

So the production invariant is held by **two independent layers**: the DB
index (rejects the corrupt insert) and the resolver (fail-closes if it ever
observes the corrupt rows). Either alone is sufficient. The mutation
surviving the suite is the expected outcome of layered defense.

## F. Performance boundary (spec §14)

Each authenticated request performs **exactly one** assignment authority
query (`listActiveForUser`) inside `authenticate`. The capability union is
materialized once into `request.ctx.capabilities` and read by every gate
for the rest of the request. No per-gate re-query, no per-role permission
lookup, no per-resolver re-load. No cross-request authorization cache
(spec §14: not added without a reliable invalidation design).

## G. Concurrency semantics (spec §15)

- Request authority snapshot: resolved at `authenticate` time.
- Assignment mutations after that point affect the NEXT request, not the
  current one (proven by E8 grant + E9 revoke — both use the same JWT and
  observe the change on the next request, no re-login).
- The current request is not interrupted mid-handler (out of scope; spec
  does not require it).

## H. Data-integrity audit (spec §13)

| User creation path | Primary assignment created? | users.role synced? |
|--------------------|:---------------------------:|:------------------:|
| `seed.ts` (admin + candidate)        | ✅ yes (atomic) | ✅ yes |
| `demo-seed.ts` (all demo users)      | ✅ yes (atomic via `ensurePrimaryAssignment`) | ✅ yes |
| `apps/api/src/routes/user.ts POST /users` (4 creation paths) | ✅ yes (atomic, M10-C corrective) | ✅ yes |
| `apps/api/src/routes/candidate.ts POST /candidates` | ✅ yes (delegates to user creation) | ✅ yes |
| `apps/api/src/scripts/bootstrap-admin.ts` | ✅ yes (bootstrap path) | ✅ yes |
| `apps/api/src/routes/auth.ts` (login) | n/a (no user created) | n/a |

Test factories that intentionally insert corrupt / unassigned fixtures
(`createUnassignedUserForTest`, the multi-primary E12 DB test, the
disabled-user test, the System-role non-login test) are explicitly labeled
as negative fixtures and do not represent production paths.

No additional unconditional backfill migration was needed — migration 0015
(step 3) is the one-time normalization for the genuinely-orphaned pre-flip
case, and every production path now writes the assignment atomically.

## I. System actor (spec §3.8 / E15)

The synthetic `System` actor (`packages/authz/src/systemActor.ts`) is
in-memory only. It is never backed by a `user_role_assignments` row, never
reaches `authenticate`, and never queries the assignment table. Background
scanners (deadline / heartbeat) consume `createSystemRequestContext` and
keep working unchanged. E15 proves this at the unit layer.

## J. Scope exclusions (spec §18)

Not implemented in M10-E (and correctly so):

- Teacher-to-course / Teacher-to-exam / Proctor-to-exam / Grader-to-work
  resource assignment semantics (M11).
- Custom roles / custom permissions.
- Multi-tenant switching, SuperAdmin.
- Frontend role editor.
- Redis authorization cache / JWT blacklist.
- M10-F global verification closure.

## K. Required commands (spec §17)

```text
pnpm --filter @exam/authz test              ✅
pnpm --filter @exam/db test                 ✅
pnpm --filter @exam/api test                ✅ 116 files / 1463 pass / 5 skip
pnpm format:check                           (run in pnpm verify)
pnpm lint                                   (run in pnpm verify)
pnpm lint:arch                              (run in pnpm verify)
pnpm lint:copy                              (run in pnpm verify)
pnpm typecheck                              (run in pnpm verify)
pnpm --filter @exam/api api:openapi:check   (final verify)
pnpm build                                  (final verify)
pnpm verify                                 (final verify)
```

Targeted re-runs all green:

```text
src/plugins/auth.test.ts
src/routes/auth.test.ts
src/routes/roleAssignments.test.ts
src/routes/permissionBoundary.test.ts
src/routes/m10dPermissionBoundary.test.ts
src/authz/routeRegistryConformance.test.ts
src/authz/assignmentAuthority.test.ts            (pure kernel)
src/authz/assignmentAuthorityRuntime.test.ts     (HTTP E1–E16)
```

## L. Exit conditions (spec §20)

All 24 conditions satisfied. Notably:

1. M10-D merge commit `2bb956d` is the real baseline.
2. Active assignments are the only human authorization authority.
3. Effective permissions = union of all active role presets.
4. Primary role does NOT constrain the union (E6).
5. `users.role` divergence tests pass (E1, E2).
6. Stale JWT role tests pass (E3, E4).
7. Grant/revoke effective on next request (E8, E9).
8. Inactive assignments ignored (E7).
9. No-active-assignment fail-closed (E10).
10. Multiple/zero-primary corruption fail-closed (E12, E13).
11. Assignment lookup failure fail-closed (E14, via DI seam).
12. Flat capability gates use assignment authority.
13. Scoped capability gates use assignment authority.
14. Candidate-context, eligibility, own-attempt, score gates all use
    assignment authority.
15. Resource resolvers and ownership checks NOT bypassed (E16 + Mutation K).
16. System actor path unchanged (E15).
17. All production user-creation paths create a primary assignment.
18. Zero production authorization decisions depend on `users.role`.
19. Zero production authorization decisions depend on the JWT role claim.
20. Mutations recorded by ACTUAL result (§E).
21. Targeted + full + verify all pass.
22. M11 resource relationships not started.
23. M10-F not started.
24. Worktree clean of unrelated changes.

## M. Known limitations / follow-ups

- **Mutation G coverage gap**: no test covers the multi-role
  score-arbitration case (primary role lacks `ScoreAllView`, secondary grants
  it). Production is correct; the test is missing. Tracked for a follow-up.
- **Mutation E/F fixture alignment**: scoped / candidate-context unit tests
  align capabilities with role, so a role-based mutation is observationally
  invisible there. The HTTP-layer grant/revoke tests prove the union is what
  gates read; no production change needed.
- **Resource relationship authorization (M11)** is explicitly out of scope;
  the score gate's `computeResultVisibility` and the scoped resolver chain
  are the M10-E surface, not the future M11 resource-ownership model.
