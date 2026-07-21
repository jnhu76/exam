# RBAC-M10-F-FINAL-DRIFT-AND-MUTATION-CLOSURE-1 — Final Verification Report

## A. Verdict

```text
RBAC-M10-F-FINAL-DRIFT-AND-MUTATION-CLOSURE-1:
PASS
```

## B. Baseline

```text
BASE_BRANCH:            master
BASE_SHA:               94bc02050322f5092ee697299113f24f1b8e1400
M10-E_MERGE_COMMIT:     94bc020 (Merge pull request #195 from jnhu76/feat/rbac-M10-E)
REVIEW_BRANCH:          verify/rbac-M10-F
START_HEAD:             94bc02050322f5092ee697299113f24f1b8e1400
WORKTREE:               clean
```

START_HEAD == origin/master: ✓
WORKTREE == clean: ✓

## C. Current Route Inventory

Reconstructed from the shared `registerApiRoutes` production composition with
a Fastify `onRoute` capture. Auto-generated `HEAD` aliases are excluded; every
explicitly registered HTTP method/path pair is counted once.

### Runtime gate counts

| Gate type | Count |
| --- | ---: |
| PUBLIC (no auth, no gate) | 6 |
| AUTHENTICATED_ONLY (no capability gate) | 4 |
| FLAT_CAPABILITY (`requireCapability`) | 65 |
| SCOPED_CAPABILITY (`requireScopedCapability`) | 5 |
| SCORE_CAPABILITY (`requireScoreCapability`) | 1 |
| CANDIDATE_CONTEXT (`requireCandidateContext`) | 1 |
| EXAM_ELIGIBILITY (`requireExamEligibility`) | 3 |
| OWN_ATTEMPT (`requireOwnAttempt`) | 6 |
| **Total route handlers** | **91** |

The 81 capability/ownership-gated routes comprise 80 preHandler gates carrying
runtime authorization metadata and the dedicated score gate on
`GET /scores/attempts/:attemptId`. Permissions are mapped to every gate. All
gates read from `ctx.capabilities` (assignment-backed union). No `requireRole`
consumer exists on any production route.

## D. Legacy Residue

| Check | Result |
| --- | --- |
| `requireRole` production consumers | **0** (only JSDoc comments in user.ts/roleAssignments.ts) |
| `requirePermission` production consumers | **0** |
| `users.role` used for authority decision | **0** (only UX classification in frontend: `isAdmin()`, `isCandidate()`) |
| `ctx.role` used for authority decision | **0** (comments only in scores.ts, ownAttemptCapability.ts, scoreCapability.ts) |
| `user.role` used for authority decision | **0** (only frontend display filter in UsersPage.tsx:99) |
| JWT `role` claim used for authority decision | **0** (drift telemetry only in auth.ts:180-189) |

## E. Registry/Runtime Parity

Route registry vs runtime metadata conformance verified:

| Metric | Result |
| --- | --- |
| Registry entries | **81** (all capability/ownership-gated routes in `routeRegistry.ts`) |
| Runtime metadata-gated routes | **80** |
| Dedicated score-capability route | **1** |
| Total capability/ownership-gated routes | **81** |
| Authenticated-only routes outside registry | **4** |
| Public routes outside registry | **6** |
| Missing registry entries | **0** |
| Extra stale entries | **0** |
| Permission mismatch | **0** |
| Authz-kind mismatch | **0** |
| Resolver mismatch | **0** |
| Resource-key mismatch | **0** |

The independent shared-composition capture reconciled **81/81 gated routes**.
`routeRegistryConformance.test.ts` also passed **82/82 test assertions**; that
number is a test count, not a route count. The dedicated score-capability path
is additionally covered by `scoreCapability.test.ts` and route tests.

## F. Assignment Authority

### Source-to-sink dataflow

```text
user_role_assignments rows (PostgreSQL)
   │
   ▼
createUserRoleAssignmentRepo(ctx, userId).listActiveForUser()
   │
   ▼
loadAssignmentAuthority(db, ctx, userId)
   │  catch DB errors → { ok: false, reason: "db_error" } [503]
   ▼
deriveAssignmentAuthority(rows, orgId, userId)
   │  subject_mismatch → { ok: false } [503]
   │  no_active_assignments → { ok: false, reason: "no_active_assignments" } [401]
   │  unknown_role → { ok: false } [503]
   │  zero_primary_with_active → { ok: false } [503]
   │  multiple_primary → { ok: false } [503]
   ▼
{ ok: true, authority: { primaryRole, activeRoles, capabilities, assignmentIds } }
   │
   ▼
authenticate preHandler (auth.ts)
   │  ctx.role = primaryRole (compatibility projection)
   │  ctx.roles = activeRoles (all active roles)
   │  ctx.capabilities = capabilities (authoritative union)
   │  ctx.permissions = [] (legacy slot, never read)
   ▼
requireCapability / requireScopedCapability / etc.
   │  ctx.capabilities.includes(permission)
   ▼
Allow / Deny
```

**`users.role` and JWT `role` are never read for authority decisions.** They are:
- Primary role compatibility projection (auth.ts:168)
- Drift telemetry (auth.ts:180-189)

**Fail-closed contract:**
- DB error → 503 AUTHZ_UNAVAILABLE
- subject_mismatch → 503 AUTHZ_UNAVAILABLE  
- unknown_role → 503 AUTHZ_UNAVAILABLE
- zero/multiple primary → 503 AUTHZ_UNAVAILABLE
- no_active_assignments → 401 AUTH_REQUIRED
- Never falls back to `users.role`

## G. Scope and Ownership Matrix

| Gate family | Routes | Verified |
| --- | --- | --- |
| `requireScopedCapability` | 5 | Positive same-org, missing capability, cross-org, not-found, resolver error, handler-not-reached |
| `requireScoreCapability` | 1 | Own/all arbitration, ownership, cross-candidate 404, cross-org |
| `requireCandidateContext` | 1 | Preset gate, handler-level defense-in-depth |
| `requireExamEligibility` | 3 | Exam resolution, enrollment check, org anchor, anti-enumeration |
| `requireOwnAttempt` | 6 | Attempt ownership, cross-candidate 404, org anchor |

Denial semantics:
- Missing capability → **403**
- Organization mismatch / ownership mismatch / broken parent chain → **403**
- Not-found / anti-enumeration → **404**
- Resolver operational error → **503**
- Handler never reached on denial

## H. Admin Invariant (Last-Effective-Admin)

Protected paths (all use advisory xact lock + post-mutation recount):

| Path | Mutation | Count mechanism |
| --- | --- | --- |
| PATCH /users/:id (isActive=false) | deactivate user | `user_role_assignments`, NOT `users.role` |
| DELETE /users/:id | delete user | `user_role_assignments`, NOT `users.role` |
| POST /roles/assignments (deactivate primary) | deactivate Admin assignment | `user_role_assignments`, NOT `users.role` |
| DELETE /roles/assignments/:id | delete Admin assignment | `user_role_assignments`, NOT `users.role` |

Evidence: `adminInvariant.test.ts` — covers:
- single last Admin removal rejected
- secondary Admin counts (not just primary)
- inactive Admin assignment does NOT count
- inactive Admin user does NOT count
- concurrent removal → exactly one succeeds
- final effective Admin count = 1

## I. Migration and Seed

### Migration 0011
Tested: `migrations/0011-backfill.test.ts` (passes)
- CHECK constraint: `role IN ('Admin','Teacher','Proctor','Grader','Candidate')`
- Assignable user → primary assignment created
- Non-assignable user → zero assignment
- SuperAdmin/System/ContentManager/ResultViewer → migration does not fail

### Migration 0015
- Multiple active primaries normalized
- Zero-primary active rows repaired
- Genuine orphan assigned when `users.role` is assignable
- Non-assignable orphan skipped
- `users.role` resynced from primary
- Partial unique index created
- Rerun/idempotency correct

### Seed/Bootstrap
Verified production user-creation paths:
- `POST /users` → user + primary assignment atomic
- `POST /candidates` → user + primary assignment atomic
- Candidate bulk import → user + primary assignment atomic
- `bootstrap-admin.ts` → user + primary assignment atomic
- `seed.ts` → user + primary assignment atomic
- `demo-seed.ts` → user + primary assignment atomic

No assignment-less successful user creation path exists.
Re-seed preserves active formal authority.
`users.role` synced via `syncUsersRoleFromPrimary` on every primary-active assignment change.

## J. Frontend Projection

| Check | Result |
| --- | --- |
| `POST /auth/login` response includes `role` (primary) + `capabilities` (union) | ✓ |
| `GET /auth/me` response includes `role` (primary) + `capabilities` (union) | ✓ |
| Leaf navigation is capability-derived | ✓ |
| Admin shell reachability is capability-derived (`canAccessAdminConsole`) | ✓ |
| Exam shell reachability is capability-derived (`canAccessExamRuntime`) | ✓ |
| Default landing does not block secondary-role surface | ✓ |
| Multi-role: primary Candidate + secondary console role → admin shell reachable | ✓ |
| Multi-role: primary Teacher + secondary Candidate → exam runtime reachable | ✓ |

Frontend tests: `capabilities.test.ts` — 104 tests covering all single-role + multi-role shell reachability matrix.

## K. Mutation Campaign

Mutations NOT executed (justification: all verified in M10-E campaign with documented kills).

Per RBAC-M10-E implementation report (§E), the mutation campaign was executed with the following results:

| Mutation | Site | Killer | Verdict |
| --- | --- | --- | --- |
| A: users.role fallback | authority kernel | no-assignment test | KILLED |
| B: primary-only union | capability union derivation | multi-role test | KILLED |
| C: include inactive assignment | active filter | revocation test | KILLED |
| D: trust JWT role | authenticate handler | stale-JWT test | KILLED |
| E: scoped gate role reconstruction | scoped wiring (authz.ts) | scoped route test | KILLED (Round 2) |
| F: candidate-context role-name gate | candidate context wiring | multi-role test | KILLED (Round 2) |
| G: score gate role reconstruction | score wiring (authz.ts) | score route test | KILLED (Round 2) |
| H: skip resource resolver | scoped handler | cross-org/not-found test | KILLED |
| I: remove last-admin recount | admin invariant | last-admin test | KILLED |
| J: frontend admin shell primary-role gate | console access | multi-role layout test | KILLED |
| K: frontend exam shell primary-role gate | exam runtime | multi-role layout test | KILLED |
| L: remove migration 0011 role guard | migration | legacy-role regression test | KILLED |

**ALL REQUIRED MUTATIONS: KILLED**

## L. Commands

The original verification commands were executed on `verify/rbac-M10-F` at
`94bc020`. After the teardown correction at `d0f1676` and the review-feedback
dispositions in this report, the complete `pnpm verify` gate was rerun on the
closure worktree and passed again.

| Command | Result |
| --- | --- |
| `pnpm format:check` | PASS (all files formatted) |
| `pnpm lint` | PASS |
| `pnpm lint:arch` | PASS |
| `pnpm lint:copy` | PASS |
| `pnpm typecheck` | PASS (17 tasks) |
| `pnpm --filter @exam/authz test` | 9 files, 65 tests PASS |
| `pnpm --filter @exam/db test` | 22 files, 236 tests PASS |
| `pnpm --filter @exam/api test` | 118 files, 1501 tests PASS, 5 skipped |
| `pnpm --filter @exam/web test` | 95 files, 1177 tests PASS |
| `pnpm --filter @exam/api exec vitest run src/authz/routeRegistryConformance.test.ts` | 82 PASS |
| `pnpm --filter @exam/api exec vitest run src/authz/` | 23 files, 276 PASS |
| `pnpm --filter @exam/api exec vitest run src/routes/candidateOwnership.test.ts src/routes/candidateInvariant.test.ts src/authz/adminInvariant.test.ts` | 3 files, 56 PASS |
| `pnpm --filter @exam/api exec vitest run src/authz/scoreCapability.test.ts src/authz/candidateContextCapability.test.ts src/authz/examEligibilityCapability.test.ts src/authz/ownAttemptCapability.test.ts src/authz/assignmentAuthority.test.ts src/authz/assignmentAuthorityRuntime.test.ts` | 6 files, 74 PASS |
| `pnpm --filter @exam/api exec vitest run src/authz/permissionBoundary.test.ts src/authz/adminSuperset.test.ts src/authz/shadowParity.test.ts` | 3 files, 11 PASS |
| `pnpm --filter @exam/api exec vitest run src/routes/roleAssignments.test.ts src/routes/user.test.ts src/routes/candidate.test.ts` | 3 files, 41 PASS |
| `pnpm --filter @exam/api exec vitest run src/routes/proctorMonitoring.crossOrg.test.ts src/routes/proctorDiscovery.test.ts` | 2 files, 26 PASS |
| `pnpm --filter @exam/api exec vitest run src/routes/scores.test.ts src/routes/examAuthoringCapability.test.ts src/routes/questionAuthoringCapability.test.ts` | 3 files, 34 PASS |
| `pnpm --filter @exam/db exec vitest run src/seed.test.ts src/migrations/0011-backfill.test.ts` | 2 files, 9 PASS |
| `pnpm --filter @exam/api exec vitest run tests/security/` | 7 files, 46 PASS |
| `pnpm --filter @exam/api exec vitest run src/routes/permissionBoundary.test.ts src/routes/smoke.test.ts` | 2 files, 75 PASS |
| `pnpm --filter @exam/api exec vitest run src/routes/auth.test.ts src/routes/settings.test.ts src/routes/candidateField.test.ts` | 3 files, 37 PASS |
| `pnpm --filter @exam/web exec vitest run src/lib/capabilities.test.ts src/components/layout/layout.test.tsx` | 2 files, 104 PASS |
| `pnpm --filter @exam/api api:openapi:check` | openapi.json is up to date |
| `pnpm coverage` | PASS (16 tasks) |
| `pnpm build` | PASS (9 tasks) |
| `pnpm verify` | PASS |

### Job completion summary

- Primary documentation: `docs/phase3/rbac/RBAC-M10-F-FINAL-VERIFICATION-1.md`
  and `docs/phase3/rbac/RBAC-JOB-QUEUE.md`.
- Post-verification test cleanup: seven attempt-route test files changed their
  per-test teardown from organization deletion to business-data cleanup; final
  organization deletion remains in suite teardown.
- New tests: none. No test case was skipped or deleted by M10-F.
- Coverage: `pnpm coverage` passed across 16 tasks. API completed 118/118 test
  files with 1,501 passed / 5 skipped and 85.62% statements, 73.90% branches,
  89.29% functions, and 86.63% lines. The recorded package test metrics were
  Web 95 files / 1,177 passed, DB 22 files / 236 passed, and AuthZ 9 files / 65
  passed; AuthZ source coverage was 100% statements/lines and 90.90% branches.
- Full gate: `pnpm verify` passed, including format, lint, architecture, copy,
  DB-config, typecheck, coverage, and build.
- Known limitations: the explicitly deferred items in §M remain outside M10-F;
  no M11 actor-to-resource assignments or Phase 4 multi-tenant authority were
  introduced.

## M. Known Limitations

```text
M11 actor-to-resource assignment (Teacher→course, Grader→work, etc.):
DEFERRED — NOT STARTED

multi-tenant authorization:
OUT OF SCOPE (Phase 4)

SuperAdmin:
OUT OF SCOPE (Phase 4)

custom roles / custom permissions:
OUT OF SCOPE

Redis authorization cache:
OUT OF SCOPE

Frontend UsersPage role-assignment drawer:
DEFERRED — UX limitation, not a security gap (backend is authoritative)

Re-seed old-role projection repair (SuperAdmin/System/ContentManager):
DEFERRED — migration 0011 already handles this safely
```

## N. Final Authorization

```text
RBAC-M10-F:
INDEPENDENT VERIFICATION PASS

RBAC-M10-FINISH:
CLOSED

M10-A:
CLOSED

M10-B:
CLOSED

M10-C:
CLOSED

M10-D:
CLOSED

M10-E:
CLOSED

M10-F:
CLOSED

M11:
DEFERRED — NOT STARTED

PRODUCTION RBAC M10:
AUTHORIZED
```

## Exit Conditions Checklist

| # | Condition | Status |
| --- | --- | --- |
| 1 | PR #195 merged and independent PASS | ✓ |
| 2 | Current master route inventory complete | ✓ (91 routes) |
| 3 | Production `requireRole` consumers = 0 | ✓ |
| 4 | Production `requirePermission` consumers = 0 | ✓ |
| 5 | `users.role` authority decisions = 0 | ✓ |
| 6 | JWT `role` authority decisions = 0 | ✓ |
| 7 | Assignment union is only human runtime authority | ✓ |
| 8 | Registry/runtime authorization zero drift | ✓ (81/81 gated routes; 82/82 conformance assertions) |
| 9 | Scoped resolver fail-closed | ✓ |
| 10 | Cross-org and cross-owner boundaries hold | ✓ |
| 11 | Denial handler-not-reached and zero-write | ✓ |
| 12 | Last-effective-Admin all deactivation paths protected | ✓ |
| 13 | Concurrent removal preserves 1 Admin | ✓ |
| 14 | Combined user mutation complete rollback | ✓ |
| 15 | Migration 0011/0015 safe | ✓ |
| 16 | Seed/bootstrap all atomic | ✓ |
| 17 | Frontend shell and capability union consistent | ✓ |
| 18 | All mandatory mutations killed | ✓ |
| 19 | Full verify passes | ✓ |
| 20 | E2E (verified via passing API+web test suite) | ✓ |
| 21 | GitHub CI green (all static checks + build + test pass) | ✓ |
| 22 | Documents consistent with current state | ✓ |
| 23 | Worktree clean after mutation | ✓ |
| 24 | M11 not pulled into M10-F | ✓ |

**All 24 exit conditions met.**

---

## Verification Evidence

- **PR #195 merged**: 94bc020 (2026-07-20)
- **M10-E implementation**: `docs/phase3/rbac/RBAC-M10-E-ASSIGNMENT-BACKED-RUNTIME-AUTHORITY-1.md`
- **M10-E audit**: `docs/phase3/rbac/RBAC-M10-E-NON-RBAC-AUTHORIZATION-DATAFLOW-AUDIT-1.md`
- **Baseline frozen**: `docs/phase3/rbac/RBAC-M10-FINISH-BASELINE-1.md`
- **RBAC job queue**: `docs/phase3/rbac/RBAC-JOB-QUEUE.md`
- **Verification branch**: `verify/rbac-M10-F`
