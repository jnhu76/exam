# RBAC-M10-C-CORRECTIVE-1

Corrective closure for PR #191 review findings (CodeRabbit ×3, gemini-code-assist ×1).

---

## A. Verdict

```text
RBAC-M10-C-CORRECTIVE-1:
PASS

RBAC-M10-C:
CLOSED

M10-D:
AUTHORIZED TO START FROM FINAL_HEAD
```

---

## B. Baseline

This corrective PR (#193) sits on top of the already-merged PR #191. The
baseline is therefore three-layered:

```text
ORIGINAL_M10_C_BASE:      ddbc808b9c640584ece7690dd8aef681739081a5
                           (M10-B merge — the pre-M10-C starting point)
ORIGINAL_PR_HEAD:         2e3856445d09645ce7930f0ab3e7c569ed1a82ec
                           (3 commits: feat + test + docs)
ORIGINAL_PR_COMMITS:      3
  e9c3f4c — feat(authz): migrate M10-C identity and role-assignment routes
  ee9064d — test(authz): prove M10-C identity and assignment boundaries
  2e38564 — docs(authz): record M10-C identity-authority implementation evidence
ORIGINAL_MERGE:           4d68745daf38be605744827f71bd09efa375d955
                           (PR #191 merged into master)
BRANCH:                   feat/rbac-m10-c-identity-authority-ddbc808b
                           (same branch, now ahead of master by 2 commits)

CORRECTIVE_PR_BASE:       4d68745daf38be605744827f71bd09efa375d955
                           (the merge commit — master's HEAD after PR #191)
CORRECTIVE_FINAL_HEAD:    ec5d869a2e99c4f0e99abeeced4d3823dc864cf9
CORRECTIVE_COMMITS:       2
  6d7501b — test(authz): strengthen M10-C denial and System-login evidence
  ec5d869 — docs(authz): close M10-C corrective findings
WORKTREE:                 clean (after corrective commits)
```

---

## C. Review disposition

| Finding | Verdict | Action | Evidence |
| ------- | ------- | ------ | -------- |
| 1 — System login-path test semantically weak | **ACCEPTED** | Split into two distinct tests; removed `[401,403]` union; added formal login path proof + audit metadata assertion | `permissionBoundary.test.ts:994-1087` |
| 2 — Denied user mutation audit assertions incomplete | **ACCEPTED** | Added scoped audit-count assertions (before/after) for `user.update`, `candidate.password_reset`, `user.delete` on denied mutations | `permissionBoundary.test.ts:1217-1246`, `:1256-1290`, `:1301-1330` |
| 3 — Denied role-assignment mutation fixtures vacuous | **ACCEPTED** | PATCH assignment test switched from `{isPrimary:false}` no-op to `{isPrimary:true}` promote branch against seeded secondary; full state verification | `permissionBoundary.test.ts:1371-1462` |
| 4 — Evidence report metadata stale | **ACCEPTED** | CLOSED via this corrective report (Strategy B); original report preserved as-is with §O addendum | This document |

---

## D. Root-cause analysis

### Finding 1 — System login path

**Root cause:** The original single test minted a forged JWT for a non-existent actorId and accepted `[401, 403]`. This conflated two distinct boundaries:

1. **Authentication boundary** (forged JWT → 401 from authenticate plugin) — the test only proved this one.
2. **System-role policy boundary** (real active System user cannot login → 401 from auth.ts `ASSIGNABLE_LOGIN_ROLES` gate) — the test never proved this.

The `[401, 403]` union was an admission that the test author wasn't sure which gate would fire, possibly masking a regression where the authenticate plugin accidentally passes a forged System JWT through to the capability gate.

### Finding 2 — User mutation audit assertions

**Root cause:** The original zero-write deny tests verified business state (name, role, passwordHash, updatedAt) unchanged, and the existing tests proved the capability gate fires before the handler. But they did not *explicitly* prove that the denied handler path emits no audit event. Since audit is fire-and-forget and the handler never runs on a denied request, this was a correct-but-unstated assumption. CodeRabbit correctly flagged it as an evidence gap.

### Finding 3 — Assignment mutation non-vacuity

**Root cause:** The original PATCH assignment test sent `{ isPrimary: false }` against a primary assignment that was already `isPrimary: true`. This payload falls through to the no-op throw branch at `roleAssignments.ts:228`. The test passed because the capability gate fired first — but if the gate were accidentally removed, the handler would throw NotFoundError (not actually mutate state), making the "zero-write" assertion vacuous. The fix targets the real promote branch.

### Finding 4 — Evidence report metadata

**Root cause:** The evidence report was written at commit `2e38564` but the metadata table still referenced `FINAL_HEAD: ee9064d6` and `COMMITS: 2` from an earlier commit. The original author did not refresh the metadata before the final commit. This corrective report follows Strategy B (separate document, no history rewriting).

### Additional — Fire-and-forget audit race condition

**Root cause (codiscovered during verification):** `recordAudit` (audit.ts:77) is unconditionally fire-and-forget — the `.create()` promise is never awaited. Under coverage-mode concurrency, the System-login test's audit count assertion (`expect(auditAfter.total).toBe(auditBefore.total + 1)`) raced with the async write, causing a flaky failure. Fixed by adding a `waitForAuditCount` polling helper that retries for up to 1500ms.

---

## E. Files changed

| File | Change |
| ---- | ------ |
| `apps/api/src/routes/permissionBoundary.test.ts` | System-login test split & tightened to exact 401; added scoped audit-count assertions on 3 denied user mutations; switched PATCH assignment to real promote branch; added `waitForAuditCount` polling helper for fire-and-forget audit race |
| `docs/phase3/rbac/RBAC-M10-C-CORRECTIVE-1.md` | This corrective closure report |

---

## F. System authentication semantics

```text
interactive System login:
  real active System-role user presents credentials at POST /auth/login
  → 401 AUTH_INVALID_CREDENTIALS
  → no auth-token cookie
  → login.failure audit with reason=non_login_role, role=System
  → enforced by ASSIGNABLE_LOGIN_ROLES set in auth.ts:42-48

internal System request context:
  created via createSystemRequestContext (SYSTEM-M1, PR #151)
  bypasses POST /auth/login entirely
  used by system scanners (auto-submit, heartbeat scan, reconcile)
  NOT in scope of M10-C

JWT authentication for persisted System user:
  authenticate plugin requires an active user row at DB lookup
  forged JWT for non-existent actorId → 401 AUTH_REQUIRED
  real persisted System user with valid JWT → passes authenticate
  → but never reaches this state because login is blocked

capability authorization:
  System preset has only SYS.* permissions
  holds none of the 6 M10-C target permissions (UserView/UserCreate/UserUpdate/
  UserPasswordReset/UserDelete/UserRoleAssign)
  → would be 403 if a System session somehow reached the capability gate
```

---

## G. Denied mutation evidence

### POST /users

```text
HTTP status:       403
business state:    before total=N, after total=N (no new user)
assignment state:  no new assignment
users.role:        unchanged
audit (user.create): before = after
```

### PATCH /users/:id

```text
HTTP status:       403
business state:    name, role, isActive, passwordHash, updatedAt — byte-equal
assignment state:  primary assignment intact
users.role:        unchanged
audit (user.update, targetType=user, targetId=user.id): before = after
```

### POST /users/:id/reset-password

```text
HTTP status:       403
business state:    passwordHash byte-equal, updatedAt byte-equal
users.role:        unchanged
audit (candidate.password_reset, targetType=user, targetId=user.id): before = after
```

### DELETE /users/:id

```text
HTTP status:       403
business state:    user row still exists, updatedAt byte-equal
assignment state:  assignment rows length unchanged, primary row present
users.role:        unchanged
audit (user.delete, targetType=user, targetId=user.id): before = after
```

### POST /users/:id/role-assignments

```text
HTTP status:       403
business state:    users.role byte-equal, updatedAt byte-equal
assignment state:  assignment count unchanged
users.role:        unchanged
audit (user.role_changed, targetId=user.id): before = after
```

### PATCH /role-assignments/:assignmentId

```text
HTTP status:       403
fixture:           Candidate user + primary Candidate + secondary Grader
                   (the real promote target — isPrimary=false→true)
assignment state:  secondary isPrimary=false, isActive=true, role=Grader (unchanged)
                   primary isPrimary=true, role=Candidate (unchanged)
users.role:        unchanged (still "Candidate")
audit (user.role_changed, targetType=user, targetId=user.id): before = after
```

### DELETE /role-assignments/:assignmentId

```text
HTTP status:       403
fixture:           Candidate user + primary Candidate assignment
assignment state:  assignment row still exists, isPrimary unchanged
users.role:        unchanged
audit (user.role_changed, targetType=role_assignment, targetId=assignment.id): before = after
```

---

## H. Runtime conformance

10 M10-C routes via `routeRegistryConformance.test.ts` onRoute capture:

| # | Method | Path | Permission | Authz kind | Legacy role | Legacy perm-list |
| - | ------ | ---- | ---------- | ---------- | ----------- | ---------------- |
| 1 | GET | /users | user.view | flat | 0 | 0 |
| 2 | POST | /users | user.create | flat | 0 | 0 |
| 3 | PATCH | /users/:id | user.update | flat | 0 | 0 |
| 4 | POST | /users/:id/reset-password | user.password.reset | flat | 0 | 0 |
| 5 | DELETE | /users/:id | user.delete | flat | 0 | 0 |
| 6 | GET | /roles/assignable | user.role.assign | flat | 0 | 0 |
| 7 | GET | /users/:id/role-assignments | user.view | flat | 0 | 0 |
| 8 | POST | /users/:id/role-assignments | user.role.assign | flat | 0 | 0 |
| 9 | PATCH | /role-assignments/:assignmentId | user.role.assign | flat | 0 | 0 |
| 10 | DELETE | /role-assignments/:assignmentId | user.role.assign | flat | 0 | 0 |

All 10 have exactly one flat capability gate and zero legacy gates. The negative-control synthetic route test proves the classifier detects role gates.

---

## I. Permission matrix

6 roles × 6 permissions — derived from `packages/authz/src/presets.ts`:

| Role | UserView | UserCreate | UserUpdate | UserPasswordReset | UserDelete | UserRoleAssign |
| ---- | :------: | :--------: | :--------: | :---------------: | :--------: | :------------: |
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Teacher | — | — | — | — | — | — |
| Proctor | — | — | — | — | — | — |
| Grader | — | — | — | — | — | — |
| Candidate | — | — | — | — | — | — |
| System | — | — | — | — | — | — |

All six permissions are Admin-only across every role preset. Zero access expansion. Zero Admin regression.

---

## J. Synchronization evidence

| Mutation | Positive/negative | Result |
| -------- | :---------------: | ------ |
| POST primary assignment | positive | users.role becomes the new role (Teacher) |
| POST secondary assignment | negative (N/A) | users.role unchanged (Candidate) |
| PATCH promote-to-primary | positive | users.role becomes the promoted role (Grader) |
| PATCH deactivate primary | negative (N/A) | no test in M10-C boundary suite (covered by RBAC-M8) |
| DELETE primary (auto-promote) | positive | users.role becomes the auto-promoted role (Grader) |
| PATCH /users/:id role-change | positive | users.role becomes the new role (Admin) |

All 5 call sites of `syncUsersRoleFromPrimary` are preserved (1 in `user.ts`, 4 in `roleAssignments.ts`).

---

## K. Mutation results

| Mutation | Expected kill | Actual result | Killed? |
| -------- | ------------- | ------------- | :-----: |
| A — replace GET /users with requireRole(["Admin"]) | conformance: roleHandlerCount 0→1 | 2 tests failed (it.each + aggregate) | ✅ |
| B — remove requireCapability on POST /users | conformance: 0 handlers + boundary: Candidate reaches handler | 2 conformance + 1 boundary failures | ✅ |
| C — wrong capability on PATCH (UserView vs UserUpdate) | conformance: permission mismatch | 1 test failed (deep-equal) | ✅ |
| D — add Permission.UserView to Teacher preset | boundary: Teacher no longer denied on UserView routes | Teacher denial matrix failure | ✅ |
| E — remove syncUsersRoleFromPrimary in POST primary | sync test: users.role stays Candidate | 2 tests failed (boundary + RBAC-M8) | ✅ |
| F — audit write on denied request (unsimulatable) | NOT MUTATION-PROVEN (no audit code in denial path) | Covered by: (1) conformance negative control tests detect gate regressions; (2) scoped zero-audit assertions catch any new audit row; (3) gate-removal mutation (B) proves zero-audit assertions fire when handler runs | ⚠️ |

Mutation F is honestly recorded as NOT MUTATION-PROVEN per directive §16 allowance — the capability preHandler returns 403 before any handler code executes, so there is no handler audit code to mutate. Covered by negative controls.

---

## L. Commands and results

| Command | Exit code | Tests |
| ------- | :-------: | :---: |
| `vitest run src/authz/routeRegistryConformance.test.ts src/routes/permissionBoundary.test.ts` | 0 | 123 passed |
| `vitest run src/routes/user.test.ts src/routes/roleAssignments.test.ts` | 0 | 24 passed |
| `vitest run src/routes/auth.test.ts` | 0 | 19 passed |
| `vitest run` (full api suite) | 0 | 1308 passed, 5 skipped |
| `pnpm format:check` | 0 | — |
| `pnpm lint` | 0 | — |
| `pnpm lint:copy` | 0 | — |
| `pnpm lint:arch` | 0 | — |
| `pnpm typecheck` | 0 | — |
| `pnpm build` | 0 | 9/9 tasks |
| `pnpm verify` | 0 | Full pipeline |

---

## M. Scope exclusions

```text
M10-D organization/system administrative routes:         NOT STARTED
M10-E assignment-backed runtime authority:               NOT STARTED
M10-F global closure:                                    NOT STARTED
multi-tenant authorization:                              NOT STARTED
custom-role policy engine:                               NOT STARTED
unrelated cleanup:                                       NOT STARTED
```

---

## N. Residual findings

| Finding | Severity | Classification |
| ------- | :------: | -------------- |
| Original adversarial review H1 — m10cRouteSpecs duplicates registry | P2 | **OUT OF SCOPE** — post-RBAC decomposition; applies uniformly to M10-A/B/C |
| Original adversarial review H6 — secondary assignment writes no audit | P2 | **OUT OF SCOPE** — ADR §7.2 follow-up |
| Original adversarial review H7 — deactivate branch writes no audit | P2 | **OUT OF SCOPE** — same as H6 |
| Original adversarial review H9 — last-Admin guard bypassed by assignment routes | P3 | **PRE-EXISTING** — scheduled for M10-E |
| Original adversarial review H10 — no direct cross-org test | P3 | **PRE-EXISTING** — post-M10-C test addition |

None are BLOCKING for M10-C closure.

---

## O. Final closure statement

```text
RBAC-M10-C-CORRECTIVE-1:
PASS

RBAC-M10-C:
CLOSED

M10-D:
AUTHORIZED TO START FROM FINAL_HEAD
```

All 4 CodeRabbit/gemini findings have been independently verified and corrected:

1. **Finding 1 (System login):** Test split into authentication-boundary (forged JWT → 401) and System-policy-boundary (real System user → 401 + audit). `[401,403]` union removed.
2. **Finding 2 (Audit assertions):** Scoped zero-audit assertions added for `user.update`, `candidate.password_reset`, `user.delete`.
3. **Finding 3 (Non-vacuous fixtures):** PATCH assignment now tests real promote branch (`{isPrimary:true}` on secondary), not no-op path.
4. **Finding 4 (Stale metadata):** Closed via this corrective report (Strategy B, no history rewriting).

One additional defect was codiscovered and fixed:
- **Audit race condition:** Fire-and-forget `recordAudit` caused flaky failure under coverage. Added `waitForAuditCount` polling helper.

All validation gates pass (full API suite 1308/5, `pnpm verify`). 10 M10-C route conformance confirmed. Permission matrix unchanged. Sync invariants preserved. M10-D/M10-E not started.
