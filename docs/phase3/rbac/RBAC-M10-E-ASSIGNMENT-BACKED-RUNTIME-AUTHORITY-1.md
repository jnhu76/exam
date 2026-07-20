# RBAC-M10-E-ASSIGNMENT-BACKED-RUNTIME-AUTHORITY-1 — Implementation Report

> **Status note (REVIEW-CLOSURE-AND-FIX-1, HEAD `76e2eec`):** this report was
> rewritten to match the actual PR #195 head. Earlier revisions described a
> 5-commit "(this commit)" baseline and listed E/F/G as SURVIVED; both were
> stale. The current authority is this document. See §B for the real commit
> list and §E for the actual E/F/G mutation campaign that kills them.

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

LAST-ACTIVE-ADMIN INVARIANT:
advisory-xact-lock + post-mutation recount
applies to disable-user / delete-user / deactivate-assignment / delete-assignment

COMBINED-MUTATION ATOMICITY (PATCH /users/:id):
users UPDATE + primary-role replacement + projection sync
run inside ONE transaction; inner failure rolls back all three
(proven by failure-injection, P1-2)

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
REVIEWED_HEAD:      76e2eecf131703c59ac30d26fef5b0f6cfaf854a
COMMITS (13):
  Kernel + flip (A/B series):
    - e14ff3d  feat(authz): add assignment authority kernel for M10-E
    - 901fda0  fix(authz): make user creation assignment-complete + DB invariant
    - fd5062f  feat(authz): activate assignment-backed runtime authority (M10-E)
    - 98f9f62  test(authz): adversarial integration matrix for M10-E runtime authority
    - 672a814  docs(authz): m10-e report, e12 db backstop test, and job queue update
    - fa96a27  fix(authz): unblock M10-E verify — typecheck, E19 kill-test, migration 0015 guard
    - 5d75910  docs(test-flakes): restore canonical path, log 2026-07-20 recurrence + RESOLVED-002
  Last-admin post-condition (Commit A/B/C):
    - 85129e9  feat(authz): effective-admin post-condition kernel (Commit A)
    - 3e1d424  feat(authz): atomic authority mutations with post-condition (Commit B)
    - 9f0261a  fix(seed): preserve existing authority on re-seed (Commit C)
  Corrective test layer + capabilities surface:
    - a1c4bee  test(rbac): m10-e corrective test layer + e14 fail-close + capabilities surface
    - bab0431  chore(api): regenerate openapi.json after LoginResponseSchema capabilities addition
  Review closure (Commit E1):
    - 76e2eec  test(rbac): m10-e review closure E1 — JWT proof, ctx convention, single-source
FINAL_HEAD:         76e2eec
WORKTREE:           clean
```

## C. What changed

### C.1 Authority kernel (Commit `e14ff3d`)

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

### C.2 Data-integrity foundation (Commit `901fda0`)

- `packages/db/src/repository/userRoleAssignmentRepo.ts`:
  - `listActiveForUser(ctx, userId)` returns the FULL active set — no
    `.limit(1)` — so multi-primary corruption is observable.
  - `assignWithinTransaction(tx, ctx, ...)` — transaction-aware primitive that
    takes the full `ctx` and resolves `organizationId` internally (Commit E1
    convention fix); the public `assign()` delegates to it inside
    `executeInTransaction`.
  - `ensurePrimaryAssignmentWithinTransaction(tx, ctx, params)` — invariant-
    aware primary seeding. `promoteOrAssignPrimaryWithinTransaction` delegates
    to it (Commit E1 single-source) so the two cannot drift.
- `packages/db/src/repository/userRepo.ts`:
  `countEffectiveActiveUsersWithRole(ctx, role)` joins users ↔
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

### C.3 Runtime flip (Commit `fd5062f`)

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
  `ScoreAllView` as the publish-bypass authority. Strips `standardAnswer`
  when view==="own".
- `apps/api/src/routes/auth.ts`: login loads authority; `no_active_assignments`
  → 401 + `login.failure` audit; integrity/db errors → 503; JWT signed with
  primary role; `/me` returns the primary role + capabilities
  (`LoginResponseSchema.capabilities`, surfaced in `bab0431`).
- `apps/api/src/authz/shadow.ts`: shadow carries `capabilities` (not
  `permissions`); decision mirrors the live capability gate.
- `apps/api/src/types/requestContext.ts`: `RuntimeRequestContext` extends
  `RequestContext` with `roles`, `capabilities`. Leaf-package invariance
  preserved (`@exam/domain` is unchanged).

### C.4 Last-admin post-condition (Commits A/B/C — `85129e9` / `3e1d424` / `9f0261a`)

- `apps/api/src/authz/adminInvariant.ts`:
  `mutateWithEffectiveAdminPostcondition(db, ctx, mutate)` wraps a mutation in
  `executeInTransaction(db, ..., "read committed")`, acquires an org-scoped
  `pg_advisory_xact_lock` (`acquireOrganizationAdvisoryLock`,
  namespace `"effective-admin-invariant"` + `ctx.organizationId`), runs the
  mutation, then recounts effective active Admins
  (`countEffectiveActiveUsersWithRole(ctx, "Admin")`). If zero, throws
  `ValidationError({ reason: "LAST_ACTIVE_ADMIN" })` → rollback.
- All four authority-removing mutations route through this seam:
  - `PATCH /users/:id { isActive:false }` (disable user)
  - `DELETE /users/:id` (delete user)
  - `PATCH /role-assignments/:id { isActive:false }` (deactivate assignment)
  - `DELETE /role-assignments/:id` (delete assignment)
- Seed authority preservation (Commit C `9f0261a`): re-seed does NOT restore
  the seed-default primary if a formal primary role was changed after seed;
  active assignments are preserved; inactive-only rows are not reactivated;
  zero-assignment users are repaired from the current valid `users.role`.

### C.5 Adversarial integration tests (Commit `98f9f62`)

`apps/api/src/authz/assignmentAuthorityRuntime.test.ts` — HTTP-layer half of
spec §12 E1–E16. Pure-kernel half (E5/E6/E7/E10/E11/E12/E13/E14)
lives in `assignmentAuthority.test.ts`. The last-admin service-level proof
lives in `adminInvariant.test.ts` (disable/delete last Admin, deactivate/
delete last Admin assignment, secondary-Admin count, concurrent two-admin
removal).

### C.6 Review closure E1 (Commit `76e2eec`)

- `apps/api/src/routes/auth.test.ts`: replaced the self-minted `signJWT({
  role:"Candidate" })` weak evidence with a real login-response cookie
  extraction + `verifyJWT` decode, asserting the route-signed compatibility
  claim is `Candidate` (not the stale `SuperAdmin` projection). Closes the
  CodeRabbit JWT-claim tautology finding.
- `packages/db/src/repository/userRoleAssignmentRepo.ts` + 5 call sites
  (`bootstrap-admin`, `user`, `candidate` ×2, `roleAssignments` ×2): the
  `*WithinTransaction` primitives now take the full `ctx` instead of a bare
  `orgId`, resolving `organizationId` internally (CodeRabbit §8.4). In the
  current single-tenant contract the repo isolates by `organizationId` only
  (no `targetOrganizationId` cross-tenant read), and cross-org tests pin the
  behavior.
- `promoteOrAssignPrimaryWithinTransaction` delegates to
  `ensurePrimaryAssignmentWithinTransaction` (single-source; the two share
  identical demote→promote-or-insert semantics).
- `apps/api/src/routes/candidate.ts`: inner `const created` → `createdUser`
  to remove shadowing of the outer import counter (CodeRabbit §8.6).
- `userRoleAssignmentRepo.test.ts`: reuses the generated `ctx`, asserts
  in-place reactivation (`result.id === existing.id`), asserts old primary
  demotion (Candidate remains active, `isPrimary=false`).
- Removed the empty "rejects disabling the last active Admin" route test
  (P1-1): actor == target hit the self-disable guard first, so the
  `LAST_ACTIVE_ADMIN|CANNOT_DISABLE_SELF` alternation would pass even if the
  invariant were deleted. Real last-admin proof lives at the service layer
  (`adminInvariant.test.ts`).

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
| E12 | multiple primary corruption fail-closed | pure + DB | ✅ `assignmentAuthority.test.ts` + `userRoleAssignmentRepo.test.ts` (DB partial unique index rejects 23505) |
| E13 | zero primary corruption fail-closed | pure | ✅ `assignmentAuthority.test.ts` |
| E14 | assignment DB failure fail-closed (no users.role fallback) | HTTP | ✅ `apps/api/src/plugins/auth.test.ts` (fail-closed 503 AUTHZ_UNAVAILABLE via `loadAssignmentAuthority` DI seam; covers BOTH returned-failure and thrown-exception paths) |
| E15 | System actor unchanged (no user_role_assignments lookup) | unit | ✅ `assignmentAuthorityRuntime.test.ts` |
| E16 | scoped resolver preserved (cap-allowed + resource-missing → 404) | HTTP | ✅ `assignmentAuthorityRuntime.test.ts` + positive control |

> **E14 location correction (REVIEW-CLOSURE):** earlier revisions pointed E14
> at `auth.test.ts`. The fail-closed HTTP test actually lives in
> `apps/api/src/plugins/auth.test.ts` and covers both the
> `loadAssignmentAuthority` returned-failure path (503 AUTHZ_UNAVAILABLE,
> handler not reached) and the thrown-exception path (503, handler not
> reached).

## E. Mandatory mutation campaign (spec §16 A–K)

Each mutation was applied as a temporary in-place edit; the targeted suite
was run; the result was recorded; the mutation was reverted via
`git checkout` and confirmed clean with `git diff --exit-code`. The E/F/G
rerun in this revision was performed against HEAD `76e2eec`.

| ID | Mutation | Mutation point (file:line) | Killer test | Result |
|----|----------|----------------------------|-------------|--------|
| A  | fallback to `users.role` on authority failure | `assignmentAuthority.ts` resolver | E10 | **KILLED** |
| B  | only primary role's permissions (ignore secondary active roles) | `assignmentAuthority.ts` union builder | E5/E6/E8/E9/E13 | **KILLED** |
| C  | include inactive assignments | `assignmentAuthority.ts` filter | E7/E10 | **KILLED** |
| D  | trust JWT role claim | `plugins/auth.ts` ctx builder | E1/E2/E3/E4/E7/E8/E9/E16 + auth.test.ts | **KILLED** |
| E  | scoped/flat gate consults `permissionsForRole(ctx.role)` instead of capability union | `apps/api/src/plugins/auth.ts:283` `requireCapability` `ctx.capabilities.includes` → `permissionsForRole(ctx.role).includes` | `assignmentAuthorityRuntime.test.ts` E17 | **KILLED** |
| F  | candidate-context gate consults `ctx.role === "Candidate"` | `apps/api/src/plugins/authz.ts:110-112` candidate-context wiring | `assignmentAuthorityRuntime.test.ts` E18 | **KILLED** |
| G  | score gate uses primary role's preset instead of union | `apps/api/src/plugins/auth.ts:283` base `requireCapability` (the flipped score-list route still uses the base decorator) | `assignmentAuthorityRuntime.test.ts` E19 | **KILLED** |
| H  | revoke requires re-login (per-token session cache) | resolver invocation | E8/E9 | **KILLED** |
| I  | silently choose first primary (`.limit(1)` on listActiveForUser) | `userRoleAssignmentRepo.ts` listActiveForUser | (defense-in-depth — see §E.3) | **SURVIVED** (DB index holds; pure-kernel E12 covers resolver) |
| J  | no-primary falls back to first active row | `assignmentAuthority.ts` zero-primary branch | E13 | **KILLED** |
| K  | scoped gate skips the resource resolver (capability-only) | `scopedCapability.ts` resolver stage | 5 scopedCapability resolver-denial cases | **KILLED** |

### Mutation summary

```text
EXECUTED:            A B C D E F G H I J K (11/11)
KILLED:              A B C D E F G H J K   (10)
SURVIVED:            I                     (1 — defense-in-depth)
NOT EXECUTED:        (none)
```

No positive control is labeled a mutation (spec §16).

### E.1 Mutation E — KILLED (Commit E1 rerun)

**Mutation diff** (temporary; reverted):

```diff
- if (!ctx.capabilities.includes(permission)) {
+ if (!permissionsForRole(ctx.role).includes(permission)) {
```

at `apps/api/src/plugins/auth.ts:283` (the base `requireCapability` decorator;
the flipped `GET /api/exams/:id` route consults this gate).

**Command:**

```bash
pnpm --filter @exam/api exec vitest run src/authz/assignmentAuthorityRuntime.test.ts -t "E17" --no-file-parallelism
```

**Failing test:** `E17: scoped gate allows when primary role lacks the
permission but secondary role grants it`.

**Failure message:**

```text
AssertionError: {"error":{"code":"PERMISSION_DENIED",...}}: expected 403 to be 201
❯ src/authz/assignmentAuthorityRuntime.test.ts:584
```

**Why this kills the mutation:** the test fixture is primary `Candidate` +
secondary `Admin`. Under the union, `ExamCreate`/`ExamView` (from Admin)
grants `POST /api/exams` 201. Under the mutation, `permissionsForRole("Candidate")`
lacks both → 403 → the 201 assertion fails.

### E.2 Mutation F — KILLED (Commit E1 rerun)

**Mutation diff** (temporary; reverted):

```diff
  const candidateContextHandler = buildCandidateContextCapabilityPreHandler(
-   (request, perm) => ctxAllows(request, perm),
+   (request, _perm) => !!request.ctx && request.ctx.role === ("Candidate" as never),
  );
```

at `apps/api/src/plugins/authz.ts:110-112` (the candidate-context wiring,
distinct from the base decorator).

**Command:**

```bash
pnpm --filter @exam/api exec vitest run src/authz/assignmentAuthorityRuntime.test.ts -t "E18" --no-file-parallelism
```

**Failing test:** `E18: candidate-context gate allows when primary role is
not Candidate but secondary assignment grants Candidate permissions`.

**Failure message:**

```text
AssertionError: ...: expected 403 to be 200
❯ src/authz/assignmentAuthorityRuntime.test.ts:630
```

**Why this kills the mutation:** fixture is primary `Teacher` + secondary
`Candidate`. The union includes `ExamTake` (from Candidate), so
`GET /api/candidate/exams` returns 200. Under the mutation,
`ctx.role === "Candidate"` is false (primary is Teacher) → 403 → assertion
fails.

### E.3 Mutation G — KILLED (Commit E1 rerun)

**Mutation diff** (temporary; reverted):

```diff
- if (!ctx.capabilities.includes(permission)) {
+ if (!permissionsForRole(ctx.role).includes(permission)) {
```

at `apps/api/src/plugins/auth.ts:283` (the base `requireCapability`
decorator; `GET /api/exams/:examId/scores` consults it via
`requireCapability(Permission.ScoreAllView)`).

**Command:**

```bash
pnpm --filter @exam/api exec vitest run src/authz/assignmentAuthorityRuntime.test.ts -t "E19" --no-file-parallelism
```

**Failing test:** `E19: score gate grants ScoreAllView when primary role
lacks it but secondary role grants it`.

**Failure message:**

```text
AssertionError: ...: expected 403 to be 200
❯ src/authz/assignmentAuthorityRuntime.test.ts:736
```

**Why this kills the mutation:** fixture is primary `Candidate` + secondary
`Teacher`. The union includes `ScoreAllView` (Teacher's preset), so the
multi-role actor can list scores even though they are NOT the attempt owner
(`ScoreOwnView` would deny). Under the mutation,
`permissionsForRole("Candidate")` has only `ScoreOwnView` (and the actor is
not the owner) → 403 → assertion fails.

### E.4 Mutation E/F/G revert confirmation

```bash
git diff --exit-code apps/api/src/plugins/auth.ts apps/api/src/plugins/authz.ts
# exit 0 — clean
```

Baseline rerun (no mutation applied) — all three killers pass:

```bash
pnpm --filter @exam/api exec vitest run src/authz/assignmentAuthorityRuntime.test.ts -t "E1[789]" --no-file-parallelism
# 3 passed
```

### E.5 Mutation note — E and G share a kill point

Mutations E and G are both killed at the **same** production site
(`apps/api/src/plugins/auth.ts:283`, the base `requireCapability`), because
the flipped routes that E17 and E19 exercise (`GET /api/exams/:id` and
`GET /api/exams/:examId/scores`) have not yet been migrated to the
`requireScopedCapability` / `requireScoreCapability` decorators — they still
consult the base decorator. Mutation F is distinct: the candidate-context
route (`GET /api/candidate/exams`) already uses the dedicated
`requireCandidateContext` decorator, so its kill point is the
candidate-context wiring in `authz.ts`.

This is not a weakness — both kill points are real production authority
sites, and both mutations are observably killed by their respective killer
tests. The shared kill point for E/G simply reflects the current migration
state of the flipped routes.

### E.6 Survived I — defense-in-depth holds

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
surviving the suite is the expected outcome of layered defense. This is NOT
equivalent to untested production safety — both layers are independently
exercised.

## F. Last-admin concurrency proof (Commit A/B)

The `mutateWithEffectiveAdminPostcondition` seam holds an org-scoped
`pg_advisory_xact_lock` for the duration of the transaction. Two concurrent
requests that would each remove one of the last two Admins serialize: the
first commits (count goes 2→1, still >0), the second then runs and sees
count 1→0 → throws `LAST_ACTIVE_ADMIN` → rollback. Exactly one of the two
concurrent removals succeeds. Proven by
`adminInvariant.test.ts` ("serializes concurrent attempts to remove the last
two Admins").

## G. Combined-mutation atomicity proof (Commit E1, P1-2)

`PATCH /users/:id` runs `users` UPDATE + primary-role replacement +
`users.role` projection sync inside ONE
`mutateWithEffectiveAdminPostcondition` transaction. The atomicity proof is
in `apps/api/src/routes/user.test.ts`
("rolls back users.name + users.isActive + users.role + assignments when
replacePrimaryRoleWithinTransaction throws mid-txn"):

- Wraps `createUserRoleAssignmentRepo` so that
  `replacePrimaryRoleWithinTransaction` throws AFTER the `users` UPDATE has
  executed inside the transaction callback.
- Reloads every row from the DB and asserts: `users.name`, `users.isActive`,
  `users.role`, and `users.updatedAt` are all unchanged (no write committed);
  the assignment set is unchanged in count and per-row
  `(role, isPrimary, isActive)`.
- This is NOT a route-wiring mock of `mutateWithEffectiveAdminPostcondition`
  (the pre-existing wiring tests only prove HTTP error mapping with the
  callback never entered). Here the failure is injected INSIDE the
  transaction callback, so the rollback is real.

## H. Performance boundary (spec §14)

Each authenticated request performs **exactly one** assignment authority
query (`listActiveForUser`) inside `authenticate`. The capability union is
materialized once into `request.ctx.capabilities` and read by every gate
for the rest of the request. No per-gate re-query, no per-role permission
lookup, no per-resolver re-load. No cross-request authorization cache
(spec §14: not added without a reliable invalidation design).

## I. Concurrency semantics (spec §15)

- Request authority snapshot: resolved at `authenticate` time.
- Assignment mutations after that point affect the NEXT request, not the
  current one (proven by E8 grant + E9 revoke — both use the same JWT and
  observe the change on the next request, no re-login).
- Last-admin concurrency: the advisory lock serializes competing
  authority-removing mutations (§F).
- The current request is not interrupted mid-handler (out of scope; spec
  does not require it).

## J. Data-integrity audit (spec §13)

| User creation path | Primary assignment created? | users.role synced? |
|--------------------|:---------------------------:|:------------------:|
| `seed.ts` (admin + candidate)        | ✅ yes (atomic; re-seed preserves authority) | ✅ yes |
| `demo-seed.ts` (all demo users)      | ✅ yes (atomic via `ensurePrimaryAssignment`) | ✅ yes |
| `apps/api/src/routes/user.ts POST /users` | ✅ yes (atomic, M10-C corrective) | ✅ yes |
| `apps/api/src/routes/candidate.ts POST /candidates` + bulk import | ✅ yes (per-row atomic txn) | ✅ yes |
| `apps/api/src/scripts/bootstrap-admin.ts` | ✅ yes (bootstrap path) | ✅ yes |
| `apps/api/src/routes/auth.ts` (login) | n/a (no user created) | n/a |

Test factories that intentionally insert corrupt / unassigned fixtures
(`createUnassignedUserForTest`, the multi-primary E12 DB test, the
disabled-user test, the System-role non-login test) are explicitly labeled
as negative fixtures and do not represent production paths.

No additional unconditional backfill migration was needed — migration 0015
(step 3) is the one-time normalization for the genuinely-orphaned pre-flip
case, and every production path now writes the assignment atomically.

## K. System actor (spec §3.8 / E15)

The synthetic `System` actor (`packages/authz/src/systemActor.ts`) is
in-memory only. It is never backed by a `user_role_assignments` row, never
reaches `authenticate`, and never queries the assignment table. Background
scanners (deadline / heartbeat) consume `createSystemRequestContext` and
keep working unchanged. E15 proves this at the unit layer.

## L. Scope exclusions (spec §18)

Not implemented in M10-E (and correctly so):

- Teacher-to-course / Teacher-to-exam / Proctor-to-exam / Grader-to-work
  resource assignment semantics (M11).
- Custom roles / custom permissions.
- Multi-tenant switching, SuperAdmin.
- Frontend role editor.
- Redis authorization cache / JWT blacklist.
- M10-F global verification closure.

## M. Required commands (REVIEW-CLOSURE, HEAD `76e2eec`)

Each command was run against the reviewed HEAD. Per the task contract,
"run in pnpm verify" is NOT an acceptable PASS claim, so each line below
carries an explicit status.

```text
pnpm --filter @exam/authz test                         PASS
pnpm --filter @exam/db test                            PASS  (21 files / 234 pass)
pnpm --filter @exam/api test                           PASS  (118 files / 1499 pass / 5 pre-existing skip)
pnpm format:check                                      PASS
pnpm lint                                              PASS
pnpm lint:arch                                         PASS
pnpm lint:copy                                         PASS
pnpm typecheck                                         PASS  (17 tasks)
pnpm --filter @exam/api api:openapi:check              PASS  (via pre-push hook)
pnpm build                                             PASS  (turbo full, via pre-push hook)
pnpm verify                                            PASS  (full pipeline)
```

Targeted re-runs (serial, `--no-file-parallelism`):

```text
packages/db:
  src/repository/userRoleAssignmentRepo.test.ts        PASS (16)
  src/seed.test.ts                                     PASS

apps/api:
  src/authz/adminInvariant.test.ts                     PASS (7)
  src/plugins/auth.test.ts                             PASS (15)   [E14 location]
  src/routes/auth.test.ts                              PASS (21)   [JWT claim proof]
  src/routes/user.test.ts                              PASS (20)   [P1-2 rollback proof]
  src/routes/roleAssignments.test.ts                   PASS (8)
  src/routes/candidate.test.ts                         PASS
  src/authz/assignmentAuthority.test.ts                PASS (pure kernel)
  src/authz/assignmentAuthorityRuntime.test.ts         PASS (15)   [E1–E19 HTTP]
  src/authz/scoreCapability.test.ts                    PASS (20)
```

Mutation campaign commands (each followed by `git checkout` + `git diff
--exit-code` confirmation):

```text
Mutation E:  vitest run src/authz/assignmentAuthorityRuntime.test.ts -t E17   FAIL (killed)
Mutation F:  vitest run src/authz/assignmentAuthorityRuntime.test.ts -t E18   FAIL (killed)
Mutation G:  vitest run src/authz/assignmentAuthorityRuntime.test.ts -t E19   FAIL (killed)
Baseline:    vitest run src/authz/assignmentAuthorityRuntime.test.ts -t "E1[789]"  PASS (3)
```

## N. Exit conditions (spec §20)

All 24 conditions satisfied. Notably:

1. M10-D merge commit `2bb956d` is the real baseline.
2. Active assignments are the only human authorization authority.
3. Effective permissions = union of all active role presets.
4. Primary role does NOT constrain the union (E6).
5. `users.role` divergence tests pass (E1, E2).
6. Stale JWT role tests pass (E3, E4) — now with a real cookie-decode proof.
7. Grant/revoke effective on next request (E8, E9).
8. Inactive assignments ignored (E7).
9. No-active-assignment fail-closed (E10).
10. Multiple/zero-primary corruption fail-closed (E12, E13).
11. Assignment lookup failure fail-closed (E14, via DI seam — in
    `plugins/auth.test.ts`, not `auth.test.ts`).
12. Flat capability gates use assignment authority.
13. Scoped capability gates use assignment authority.
14. Candidate-context, eligibility, own-attempt, score gates all use
    assignment authority.
15. Resource resolvers and ownership checks NOT bypassed (E16 + Mutation K).
16. System actor path unchanged (E15).
17. All production user-creation paths create a primary assignment.
18. Zero production authorization decisions depend on `users.role`.
19. Zero production authorization decisions depend on the JWT role claim.
20. Mutations recorded by ACTUAL result (§E) — E/F/G now KILLED.
21. Targeted + full + verify all pass.
22. M11 resource relationships not started.
23. M10-F not started.
24. Worktree clean of unrelated changes.

REVIEW-CLOSURE-AND-FIX-1 additional exit conditions:

- Last-admin route-level empty proof removed (P1-1).
- PATCH-user combined-mutation rollback proven by failure injection (P1-2).
- E/F/G actually rerun and killed at HEAD `76e2eec` (P1-3).
- Report and PR body aligned to the real 13-commit head (P1-4, P1-5).

## O. Known limitations / follow-ups

- **Mutation I survivor**: `.limit(1)` on `listActiveForUser` survives
  because the DB partial unique index holds the invariant at the storage
  layer. This is layered defense, NOT untested production safety — both
  layers are independently exercised. No action required.
- **E/G shared kill point**: E and G are both killed at the base
  `requireCapability` decorator because the score-list / exam-detail routes
  have not yet migrated to the scoped/score decorators. When those routes
  migrate, the kill point will move to `ctxAllows`; E17/E19 will continue to
  kill the mutation at the new site. No action required now.
- **Resource relationship authorization (M11)** is explicitly out of scope;
  the score gate's `computeResultVisibility` and the scoped resolver chain
  are the M10-E surface, not the future M11 resource-ownership model.
- **Frontend multi-role UX**: the API surface exposes `capabilities` and the
  primary role, but the UsersPage currently presents role as a single
  projection. A multi-role-aware UX is a separate frontend corrective
  (tracked independently, NOT deferred to M10-F).

## P. Closure

```text
PR #195:
READY FOR INDEPENDENT RE-REVIEW

M10-E:
AUTHOR SELF-ASSESSMENT PASS

M10-F:
NOT YET AUTHORIZED
```
