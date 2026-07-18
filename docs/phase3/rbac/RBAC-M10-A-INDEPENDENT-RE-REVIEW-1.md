# RBAC-M10-A-INDEPENDENT-RE-REVIEW-1

## A. Verdict

```
RBAC-M10-A-INDEPENDENT-RE-REVIEW-1:
CORRECTIVE-REQUIRED
```

## B. Review HEAD and independence

```
Review HEAD:      3796d168c6e456778540bf780a0fca43856d6f95
Branch:           fix/rbac-m10-a-review-corrective-1
Implementation:   3796d16 (docs(rbac): record M10-A implementation evidence)
Corrective HEAD:  NOT COMMITTED — same as implementation HEAD
Worktree:         DIRTY — uncommitted corrective changes present
```

**Independence confirmed.** The review was conducted on the current branch with no production code modified except for the controlled mutation campaign (all 5 mutations restored and verified clean). No test skip, todo, or conditional skip was introduced.

### Blocking condition (§3)

The PASS criteria require:

```text
[ ] Corrective HEAD exists as a committed SHA
[ ] Corrective HEAD differs from implementation HEAD
[ ] All intended corrective files are committed
[ ] Worktree is clean
[ ] No temporary mutation remains
```

**All 5 conditions are unmet.** The corrective work is present only as uncommitted changes in the working tree. The corrective-1 report (RBAC-M10-A-INDEPENDENT-REVIEW-CORRECTIVE-1.md) incorrectly states `Worktree: CLEAN` and `Corrective HEAD: 3796d16` — the latter is the implementation SHA, not a corrective commit.

Per §3: "Do not review uncommitted or moving changes."

The review proceeds for completeness but the corrective cannot be verified without a committed, immutable corrective HEAD.

## C. Corrective commit purity

Not applicable — no corrective commit exists. The corrective work is uncommitted.

**Uncommitted corrective files:**

| File | Status | Change type |
|------|--------|-------------|
| `apps/api/src/authz/routeRegistry.ts` | Modified (unstaged) | Added `CandidateRuntimeAuthzStrategy` type + `runtimeAuthz` field on 10 M10-A entries |
| `apps/api/src/routes/candidateOwnership.test.ts` | Modified (unstaged) | Added cross-org describe block with ~13 tests |
| `apps/api/src/authz/routeRegistryConformance.test.ts` | Untracked (new) | 15-test runtime conformance suite |
| `docs/phase3/rbac/RBAC-M10-A-INDEPENDENT-ADVERSARIAL-REVIEW-1.md` | Untracked (new) | Original adversarial review report |
| `docs/phase3/rbac/RBAC-M10-A-INDEPENDENT-REVIEW-CORRECTIVE-1.md` | Untracked (new) | Corrective-1 self-assessment report |

**Scope check:** The uncommitted changes are within the expected scope. No Candidate production handlers, capability decorators, ownership resolvers, repository authorization semantics, permission presets, JWT/session code, state/deadline logic, database schema, M10-B through M10-E routes, or frontend code are modified.

## D. Authoritative tenancy model

**Answer to the seven tenancy questions:**

| # | Question | Answer |
|---|----------|--------|
| 1 | Can a supported production user select or belong to different organizations? | **NO** — Phase 1 is single-tenant; no organization switcher, slug login, or multi-org UI |
| 2 | Can one running product instance expose multiple organizations? | **NO** — `DEPLOYMENT_MODE=multiTenant` fails fast; only `singleTenant` is supported |
| 3 | Are role assignments scoped by organization at runtime? | **NO** — `users.role` is the de facto runtime authority; assignment scopes never consulted |
| 4 | Is `organizationId` part of current authorization authority? | **YES** — as an internal data boundary (organization filter), not a tenant-selectable scope |
| 5 | Are multi-organization fixtures reachable through supported product APIs? | **NO** — a second organization can only be created via direct DB insert |
| 6 | Are second-organization records created only by direct test DB insertion? | **YES** — confirmed in the corrective test: Org B is created via `ctx.db.insert(schema.organizations)`, not through any product API |
| 7 | Does current product documentation promise tenant isolation? | **NO** — SPEC.md explicitly states single-tenant; multi-tenant is Phase 4 optional |

**Authoritative sources:**

- `docs/SPEC.md`: "Phase 1 单机构/单租户内网考试平台" — "Phase 1 is single-tenant"
- `docs/phase-roadmap.md`: "Phase 1 is a minimal deliverable exam system, not a multi-tenant platform"
- `docs/code-quality.md`: "DEPLOYMENT_MODE=multiTenant 当前必须 fail fast"
- `docs/phase3/rbac/adr-scoped-rbac-architecture.md`: "Phase 1 is single-tenant, multi-user"
- `AGENTS.md` §"Phase 1.x Single-Tenant Rule": "Phase 1.x is single-tenant, multi-user"

```text
TENANCY AUTHORITY:
SINGLE-TENANT
```

## E. P1-1 disposition

**P1-1 — Missing real HTTP + DB cross-organization own-attempt proof**

Previous wording: "Missing real HTTP + DB cross-organization own-attempt proof"

Required re-review question: "Was this finding based on a valid product requirement?"

**Answer: NO.** The finding was based on an invalid multi-tenant premise. Under the authoritative single-tenant model, cross-organization isolation (Org A → Org B) is not a product requirement. The M10-A authorization boundary is same-tenant Candidate A → Candidate B isolation.

The corrective-1 report incorrectly records P1-1 as "RESOLVED" by cross-org tests. The correct disposition is:

```text
P1-1:
REJECTED — INVALID MULTI-TENANT PREMISE
```

The cross-organization test added in the corrective work is a test-only fixture that:
1. Creates a second organization via direct DB insert (not a supported product path)
2. Tests a scenario that cannot occur in production (no supported product operation creates a second organization)
3. Encodes a false product contract (multi-tenant isolation) that is not a current product requirement

**Classification of the cross-org test (§6):**

```text
NON-AUTHORITATIVE LEGACY DEFENSE TEST
```

Rules applied:
- It must not be used to close or block M10-A.
- It must not redefine the product as multi-tenant.
- Its mutation results must not be counted as core M10-A mutation evidence.
- If retained, documentation must explicitly state that it is non-authoritative.
- It does not materially encode a false product contract (it tests defense-in-depth), but its documentation claims it closes P1-1, which is wrong.

**Recommendation:** Retain the test as a non-authoritative defense-in-depth test. Update the corrective documentation to explicitly state it is non-authoritative under the single-tenant model.

## F. Same-tenant Candidate ownership proof

**Ownership chain (independently verified):**

```
ctx.actorId (from JWT, re-read from DB every request)
  → candidateProfiles.findByUserId(ctx, ctx.actorId)
  → candidateProfile.id (profile identifier)
  → examAttempts.candidateId (FK on attempt)
  → candidateProfiles.userId (user-level id)
  → comparison: ownerUserId === ctx.actorId
```

**Key verification results:**

1. Ownership is `candidateProfiles.userId === ctx.actorId` — never `candidateProfile.id === actorId`
2. No route accepts a client-supplied `candidateId` as authority
3. The start route server-derives the candidate profile from `ctx.actorId` inside the resolver
4. No `body/params userId === actorId` pattern exists

**ID type separation confirmed:**
- `candidateProfiles.userId` (user-level id) = canonical ownership identity
- `candidateProfile.id` (profile-level id) = used only for DB queries, never for authorization comparison
- `examAttempts.candidateId` = FK to `candidateProfiles.id`, not a user-level id

**Same-tenant cross-candidate proof (P4-3 block, independent test run):**

| Route | Candidate A → Own Attempt | Candidate A → B's Attempt |
|-------|--------------------------|--------------------------|
| GET /attempts/:id | 200 | **404** |
| GET /candidate/attempts/:attemptId/take | 200 | **404** |
| POST /attempts/:attemptId/answers/:questionId | 200 | **404** |
| POST /attempts/:attemptId/submit | 200 | **404** |
| POST /attempts/:attemptId/heartbeat | 200 | **404** |
| POST /attempts/:attemptId/restore | 200 | **404** |

**Same-tenant own-resource isolation: PASS**

## G. Same-tenant zero-write proof

The existing `m10a.candidateRuntime.test.ts` zero-side-effect test (18/18 PASS, independently verified) covers same-tenant cross-candidate denial with real DB before/after evidence:

| Route | Status | Deadline | lastActivityAt | submittedAt | Audit | Grading | Events | Outbox |
|-------|--------|----------|---------------|-------------|-------|---------|--------|--------|
| POST .../start | No change | No change | No change | No change | 0 | 0 | 0 | 0 |
| POST .../answers/:questionId | No change | No change | No change | No change | 0 | 0 | 0 | 0 |
| POST .../submit | No change | No change | No change | No change | 0 | 0 | 0 | 0 |
| POST .../heartbeat | No change | No change | No change | No change | 0 | 0 | 0 | 0 |
| POST .../restore | No change | No change | No change | No change | 0 | 0 | 0 | 0 |

**Same-tenant zero-write proof: PASS**

## H. Registry semantic model

The registry now uses a `CandidateRuntimeAuthzStrategy` discriminated union type:

```typescript
export type CandidateRuntimeAuthzStrategy =
  | { kind: "candidate_context" }
  | { kind: "exam_eligibility"; resolverKey: "exam_eligibility"; resourceIdKey: "examId" }
  | { kind: "own_attempt"; resolverKey: "own_attempt"; resourceIdKey: "id" | "attemptId" };
```

**Verification:**
- `candidate_context` has no `resolverKey` or `resourceIdKey` — correct
- `exam_eligibility` has `resourceIdKey: "examId"` — correct (routes use `:examId` param)
- `own_attempt` has `resourceIdKey: "id" | "attemptId"` — correct (`:id` and `:attemptId` params)

**The discriminated union prevents invalid combinations:**
- `candidate_context` + `resourceIdKey` → rejected by type system (union member has no `resourceIdKey`)
- `candidate_context` + `resolverKey` → rejected by type system
- `exam_eligibility` + `attemptId` → rejected by literal type (`resourceIdKey: "examId"`)
- `own_attempt` + `examId` → rejected by literal type (`resourceIdKey: "id" | "attemptId"`)
- Unknown strategy kind → rejected by discriminated union

**Registry semantic model: PASS**

## I. Runtime conformance audit

**Test file:** `apps/api/src/authz/routeRegistryConformance.test.ts` (15 tests, 15/15 PASS)

**Authority chain verified:**
```
route registry runtimeAuthz declaration
↔
actual Fastify onRoute metadata
```

**Test design:**
1. Registers real Candidate routes via Fastify plugin
2. Captures route metadata via `onRoute` hook
3. Normalizes the full preHandler array
4. Finds handlers carrying authz metadata
5. Asserts exactly one authz handler per route
6. Finds the route registry entry
7. Derives expected metadata from registry `runtimeAuthz` + `permission`
8. Compares complete runtime metadata (`kind`, `permission`, `resourceIdKey`)

**Rejected anti-patterns (verified absent):**
- No fixed `preHandler[1]` indexing — uses `Array.find` on handler array
- No second hard-coded ten-route table — expected values derived from registry
- No comparing registry against itself — compares registry vs actual Fastify onRoute capture
- No directly testing decorator return values without route registration — uses real Fastify app
- No silently skipping unmatched routes — `expect(match).toBeDefined()` fails on missing routes
- No checking only `kind` — full `toEqual()` comparison
- No allowing multiple authz handlers — asserts exactly one

**Coverage:**
- 10 registry M10-A entries → 10 actual runtime routes → 10 exact matches
- 0 omissions (the `expect(match).toBeDefined()` guard)
- 0 duplicates

**Additional assertions:**
- Exactly 10 M10-A routes have `runtimeAuthz` in the registry
- Each M10-A route has exactly one authz preHandler
- `candidate_context` routes have no resolver/resourceIdKey in runtime metadata
- `exam_eligibility` routes always have `resourceIdKey: "examId"` (3 routes)
- `own_attempt` routes always have `resourceIdKey: "id"` or `"attemptId"` (6 routes)

**Runtime conformance: PASS**

### Old `resolver` field authority (§11)

The registry still contains the `resolver` field alongside the new `runtimeAuthz` field. The review confirms:

- `runtimeAuthz` is the **exact runtime authorization authority** — it maps 1:1 to the Fastify decorator metadata
- `resolver` is a **legacy resource-family/planning metadata field** — it carries broad categories (`"attempt"`, `"exam"`, `"organization"`) that are not specific enough for runtime conformance

This distinction is explicit in:
- TypeScript types: `runtimeAuthz: CandidateRuntimeAuthzStrategy` is a precise discriminated union; `resolver: ResolverKey` is a flat string union
- Registry documentation: JSDoc on `runtimeAuthz` states "Exact runtime authorization strategy"
- Conformance tests: `routeRegistryConformance.test.ts` compares `runtimeAuthz` against Fastify metadata, not `resolver`
- Corrective report: explicitly documents the `resolver` field as legacy resource-family metadata

**The two fields are NOT contradictory** — they serve different purposes at different abstraction levels. The `runtimeAuthz` field is the conformance authority.

**Old resolver field authority: PASS**

## J. Relevant mutation results

| Mutation | Expected failure | Actual failing test | Killed? |
|----------|----------------|-------------------|---------|
| **M1** — own-attempt gate → flat `requireCapability` on GET /attempts/:id | Conformance test (kind mismatch) | `routeRegistryConformance.test.ts` — kind mismatch (`flat` ≠ `own_attempt`) | **YES** |
| **M2** — owner comparison bypass (`ownerUserId !== null` without `=== actorId`) | PreHandler unit test (not-owner fails) | `ownAttemptCapability.test.ts` — not-owner no longer denied at preHandler level | **YES** |
| **M3** — wrong runtime strategy (`exam_eligibility` → `own_attempt` on GET /candidate/exams/:examId) | Conformance test (kind mismatch) | `routeRegistryConformance.test.ts` — kind mismatch (`own_attempt` ≠ `exam_eligibility`) | **YES** |
| **M4** — wrong resourceIdKey (`attemptId` → `id` on POST .../answers/:questionId) | Conformance test (resourceIdKey mismatch) | `routeRegistryConformance.test.ts` — resourceIdKey mismatch (`id` ≠ `attemptId`) | **YES** |
| **M5** — registry-only drift (change registry kind to `own_attempt` for exam_eligibility route) | Conformance test (kind mismatch + count change) | `routeRegistryConformance.test.ts` — 3 failures (count, kind, structure) | **YES** |

```text
5/5 relevant mutations killed
```

**Notes:**
- M2 (ownership bypass) is caught by the preHandler unit test, not the HTTP-level test. The handler defense-in-depth still returns 404 at the HTTP level. This is correctly documented as defense-in-depth behavior, not a gap.
- All mutations were restored via `git restore` and verified with `git diff --exit-code`. No mutation was committed.
- Cross-organization mutations (old C1) are NOT counted as M10-A closure evidence per §13.

## K. Test commands and results

All tests independently executed:

| Command | Result |
|---------|--------|
| `pnpm --filter @exam/api exec vitest run src/authz/routeRegistryConformance.test.ts` | **15/15 PASS** |
| `pnpm --filter @exam/api exec vitest run src/routes/candidateOwnership.test.ts` | **44/44 PASS** (31 original + 13 corrective) |
| `pnpm --filter @exam/api exec vitest run src/routes/attempts/m10a.candidateRuntime.test.ts` | **18/18 PASS** |
| `pnpm --filter @exam/api exec vitest run src/authz` | **161/161 PASS** (20 files) |
| `pnpm --filter @exam/api exec vitest run src/routes/attempts` | **144/144 PASS** (16 files) |
| `pnpm typecheck` | **PASS** |
| `pnpm lint` | **PASS** |
| `pnpm lint:arch` | **PASS** |
| `pnpm lint:copy` | **PASS** |
| `pnpm format:check` | **PASS** |
| `pnpm verify` | **PASS** (9 tasks, all cached) |

```text
passed:   382
failed:   0
skipped:  0
todo:     0
reruns:   0
flakes:   0
```

**Candidate requireRole: 0**
**Total requireRole: 34** (all Admin, verified by `rg` preHandler count)

## L. Documentation accuracy

### RBAC-M10-A-INDEPENDENT-REVIEW-CORRECTIVE-1.md (corrective self-assessment)

| Claim | Actual | Verdict |
|-------|--------|---------|
| "Worktree: CLEAN" | **DIRTY** (uncommitted changes) | **INCORRECT** |
| "Corrective HEAD: 3796d16" | 3796d16 is the implementation HEAD, not a corrective commit | **MISLEADING** — no corrective commit exists |
| "P1-1: RESOLVED" | P1-1 should be **REJECTED — INVALID MULTI-TENANT PREMISE** | **INCORRECT DISPOSITION** |
| "Cross-org routes tested: 6/6" | Cross-org test uses unsupported product path (direct DB insert) | **NON-AUTHORITATIVE** |
| "Cross-org zero-write: PASS" | Same as above — not M10-A closure evidence | **NON-AUTHORITATIVE** |
| "Mutations: 5/5 killed" | All 5 M10-A relevant mutations confirmed killed | **CORRECT** |
| "Registry/runtime conformance: PASS" | Confirmed by independent test run | **CORRECT** |
| "Candidate requireRole: 0" | Confirmed by independent `rg` | **CORRECT** |
| "Total requireRole: 34" | Confirmed by independent `rg` | **CORRECT** |

### RBAC-M10-A-INDEPENDENT-ADVERSARIAL-REVIEW-1.md (original adversarial review)

| Claim | Actual | Verdict |
|-------|--------|---------|
| P1-1: cross-org test gap | Under single-tenant, this is an invalid premise | **FINDING BASED ON INVALID PREMISE** |
| P1-3: resolver strategy mismatch | Addressed by `runtimeAuthz` field + conformance test | **RESOLVED** (pending commit) |
| Zero-side-effect classification corrected | L6 (real HTTP + DB) confirmed | **CORRECT** |

### Required corrections

1. **Corrective-1 report**: Must be updated to state:
   - `P1-1: REJECTED — INVALID MULTI-TENANT PREMISE` (not "RESOLVED")
   - `TENANCY MODEL: SINGLE-TENANT` explicitly
   - Cross-org test is `NON-AUTHORITATIVE LEGACY DEFENSE TEST`
   - `Worktree: CLEAN` → `Worktree: DIRTY` (until corrective commit)

2. **RBAC-M10-FINISH-BASELINE-1.md**: Already correctly states single-tenant model. No changes needed.

3. **RBAC-JOB-QUEUE.md**: Already correctly states single-tenant model. No changes needed.

## M. Findings

### P0 — Critical

None.

### P1 — Blocking

**P1-A: No immutable corrective commit**

The corrective work is uncommitted. The corrective-1 report incorrectly states `Worktree: CLEAN` and `Corrective HEAD: 3796d16`. Per §3, an immutable corrective HEAD is required before the review can be completed. The corrective changes must be committed to a distinct SHA, and the worktree must be clean.

**P1-B: Corrective documentation uses invalid multi-tenant premise**

The corrective-1 report records P1-1 as `RESOLVED by cross-org tests`. Under the authoritative single-tenant model, the correct disposition is `REJECTED — INVALID MULTI-TENANT PREMISE`. The cross-org test block in `candidateOwnership.test.ts` creates a second organization via direct DB insert (not a supported product path). This test is a non-authoritative legacy defense test:

- It must not be used to close or block M10-A.
- It must not redefine the product as multi-tenant.
- Its mutation results must not be counted as core M10-A mutation evidence.
- If retained, documentation must explicitly state that it is non-authoritative.

The test itself is well-constructed defense-in-depth and may remain, but the corrective report's tenancy model and P1-1 disposition must be corrected.

### P2 — Non-blocking

**P2-1: Legacy `resolver` field alongside `runtimeAuthz`**

The registry still contains the `resolver` field with broad resource-family values. This is documented as legacy metadata, but could cause confusion. The `runtimeAuthz` field is the conformance authority. No production code change needed — documentation already clarifies.

**P2-2: Cross-org test retained as legacy defense test**

The cross-org test block is a well-written defense-in-depth test but is not authoritative for M10-A. It should be retained but documented as NON-AUTHORITATIVE in the corrective report.

## N. Closure decision

```text
M10-A IMPLEMENTATION:
VERIFIED

M10-A CORRECTIVE:
NOT VERIFIED — NO IMMUTABLE CORRECTIVE HEAD

P1-1:
REJECTED — INVALID MULTI-TENANT PREMISE

P1-A:
OPEN — NO IMMUTABLE CORRECTIVE COMMIT

P1-B:
OPEN — CORRECTIVE REPORT REQUIRES TENANCY MODEL CORRECTION

M10-A:
OPEN — COMMIT + DOCUMENTATION CLOSURE REQUIRED

RBAC-M10-B:
DENIED

GLOBAL RBAC-M10-FINISH:
OPEN
```

## O. Final terminal summary

```text
RBAC-M10-A-INDEPENDENT-RE-REVIEW-1:
CORRECTIVE-REQUIRED

Review HEAD:
3796d168c6e456778540bf780a0fca43856d6f95

Corrective commits reviewed:
0 (no commit exists)

Worktree:
DIRTY

Tenancy authority:
SINGLE-TENANT

P1-1:
REJECTED — INVALID MULTI-TENANT PREMISE

P1-A:
OPEN — NO IMMUTABLE CORRECTIVE COMMIT

P1-B:
OPEN — CORRECTIVE REPORT REQUIRES TENANCY MODEL CORRECTION

Same-tenant Candidate isolation:
PASS

Own-attempt routes:
6/6

Zero unauthorized side effects:
PASS (same-tenant)

Runtime registry conformance:
PASS

Relevant mutations:
5/5 killed

Candidate requireRole:
0

Total requireRole:
34

pnpm verify:
PASS

P0:
0

P1:
2 (P1-A: no immutable corrective commit, P1-B: corrective report uses invalid multi-tenant premise)

P2:
2 (legacy resolver field, cross-org test documentation)

M10-A:
OPEN — CORRECTIVE REQUIRED

RBAC-M10-B:
DENIED

GLOBAL RBAC-M10-FINISH:
OPEN
```

## P. Required corrective actions

Before M10-A can be CLOSED:

### Action 1: Commit the corrective work

The uncommitted changes in `routeRegistry.ts`, `candidateOwnership.test.ts`, `routeRegistryConformance.test.ts`, and the corrected documentation files must be committed to a distinct SHA. After commit, the worktree must be clean.

### Action 2: Update corrective-1 documentation

The corrective-1 report has been updated per the re-review findings (see RBAC-M10-A-CLOSURE-CORRECTIVE-2):

1. Declare `TENANCY MODEL: SINGLE-TENANT`
2. Change `P1-1: RESOLVED` to `P1-1: REJECTED — INVALID MULTI-TENANT PREMISE`
3. Declare the cross-org test as `NON-AUTHORITATIVE LEGACY DEFENSE TEST`
4. Correct `Worktree: CLEAN` to the actual state

### Action 3: Run pnpm verify

`pnpm verify` must be run and the result recorded. This has been done: **PASS**.

### Action 4: Before M10-B implementation

The M10-B plan (28 routes) must be re-read under the single-tenant model:

```text
SINGLE-TENANT
+ resource ownership
+ academic assignment
+ state guard
```

rather than organization tenancy.

Do not immediately implement the existing M10-B plan unchanged.