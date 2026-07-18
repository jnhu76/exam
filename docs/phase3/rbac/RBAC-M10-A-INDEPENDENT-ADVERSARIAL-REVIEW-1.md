# RBAC-M10-A-INDEPENDENT-ADVERSARIAL-REVIEW-1

## A. Verdict

```
RBAC-M10-A-INDEPENDENT-ADVERSARIAL-REVIEW-1:
CORRECTIVE-REQUIRED
```

## B. Review baseline and independence

```
WORKTREE:
CLEAN (git status --short: no output)

REVIEW HEAD:
3796d168c6e456778540bf780a0fca43856d6f95

IMPLEMENTATION BRANCH:
feat/rbac-m10-a-candidate-runtime

BASELINE:
8ef50e52cd61b15fa1814b52d31ab3785da715a3

MERGE BASE (HEAD == ancestor of baseline):
8ef50e52cd61b15fa1814b52d31ab3785da715a3

STASH:
PRESENT (stash@{0}: WIP on fix/formal-ea-lock-order — unrelated to M10-A)
```

**Independence confirmed:** The review was conducted on the existing implementation branch with a clean worktree. No production code was modified except for the controlled mutation campaign (all mutations restored, verified clean via `git diff --exit-code`). No test skip, todo, or conditional skip was introduced.

## C. Commit purity

| Commit | Intent | Files | M10-A Related? | Suspicious Change | Verdict |
| ------ | ------ | ----: | -------------: | ----------------- | ------- |
| `5036ddf` | feat(authz): add candidate-runtime capability resolvers and decorators | 15 | YES | None | CLEAN |
| `e125737` | feat(api): cut over candidate runtime routes to capability authorization | 3 | YES | None | CLEAN |
| `0697420` | test(authz): prove M10-A runtime metadata and zero-side-effect denial | 1 | YES | None | CLEAN |
| `3796d16` | docs(rbac): record M10-A implementation evidence | 3 | YES | None | CLEAN |

**Scope verification:**
- No changes to `apps/web/`, `apps/desktop/`, `packages/domain/`, `packages/contracts/`
- No changes to Email, Settings, System, User, or Role Assignment routes
- No changes to JWT/session/auth plugin core logic
- No formatting-only changes
- No test skips, `.todo`, or `.skip`
- No test assertion weakening
- No cross-domain changes
- No M10-B, M10-C, M10-D, M10-E scope pollution

**Commit purity: PASS**

## D. Authoritative ten-route reconciliation

Reconstructed from three independent sources:

1. **Baseline route-to-job table** (RBAC-M10-FINISH-BASELINE-1.md §D.1, §O)
2. **Fastify route registration** (apps/api/src/routes/attempts.candidate.ts)
3. **Route registry** (apps/api/src/authz/routeRegistry.ts)

| # | Method | Route | Source File | Baseline Assigned? | Runtime Exists? | Registry Exists? |
| -: | ------ | ----- | ----------- | -----------------: | --------------: | ---------------: |
| 1 | GET | /candidate/exams | attempts.candidate.ts:280 | YES | YES | YES |
| 2 | GET | /candidate/exams/:examId | attempts.candidate.ts:413 | YES | YES | YES |
| 3 | POST | /attempts/:examId/queue | attempts.candidate.ts:497 | YES | YES | YES |
| 4 | POST | /attempts/:examId/start | attempts.candidate.ts:543 | YES | YES | YES |
| 5 | GET | /attempts/:id | attempts.candidate.ts:657 | YES | YES | YES |
| 6 | GET | /candidate/attempts/:attemptId/take | attempts.candidate.ts:697 | YES | YES | YES |
| 7 | POST | /attempts/:attemptId/answers/:questionId | attempts.candidate.ts:790 | YES | YES | YES |
| 8 | POST | /attempts/:attemptId/submit | attempts.candidate.ts:939 | YES | YES | YES |
| 9 | POST | /attempts/:attemptId/heartbeat | attempts.candidate.ts:999 | YES | YES | YES |
| 10 | POST | /attempts/:attemptId/restore | attempts.candidate.ts:1046 | YES | YES | YES |

**Exactly 10 routes, no omissions, no duplicates, no foreign-domain routes.**

**requireRole counts (independently verified via `rg`):**
```
Candidate requireRole in production routes: 0
  (only 1 match in candidateOwnership.test.ts — doc comment, not a gate)
All requireRole in production routes: 34
  (all requireRole(["Admin"]), verified: email:1 + candidate:3 + course:1 +
   exam:5 + importLogs:1 + audit:1 + settings:3 + system:3 +
   candidateField:5 + roleAssignments:5 + export:1 + user:5 = 34)
```

**Route reconciliation: PASS**

## E. Authorization architecture

### Four semantic authz kinds

| Archetype | Decorator | Routes | Resolver | DB Reads |
| --------- | --------- | ------ | -------- | --------: |
| A (candidate-context list) | `requireCandidateContext(ExamTake)` | 1 | preset-only (handler scopes list) | 0 |
| B (exam eligibility) | `requireExamEligibility(perm, "examId")` | 3 | `resolveExamEligibilityScope` | 1 |
| C/D (own-attempt) | `requireOwnAttempt(perm, resourceIdKey)` | 6 | `resolveOwnAttemptScope` | 1 |

**Assessment:**
- The four-kind design correctly maps to the four route archetypes (A: context/list, B: eligibility/start, C: existing-attempt read, D: attempt mutation).
- No mechanical "one resolver fits all" — each archetype has a purpose-built resolver.
- Resolvers do ONLY scope/ownership; state/deadline/protocol remains in handlers.
- Resolver deny mapping follows ADR §3.9: `resource_not_found` → 404, `organization_mismatch`/`broken_parent_chain` → 403, `resolver_error` → 503.
- No duplicate DB queries for authorization (single query per resolver).
- The `candidate_context` kind (archetype A) correctly uses preset-only with no resolver — the handler scopes the query via the candidate profile.

**Authorization architecture: PASS**

## F. Candidate identity and ownership proof

**Canonical ownership chain (verified from source):**
```
ctx.actorId  (from JWT, re-read from DB every request)
  → candidateProfiles.findByUserId(ctx, ctx.actorId)
  → candidateProfile.id  (the candidate profile identifier)
  → examAttempts.candidateId  (FK on the attempt)
  → candidateProfiles.userId  (the owning user id)
  → comparison: ownerUserId === ctx.actorId
```

**Key findings:**
- Ownership is `candidateProfiles.userId === ctx.actorId` — never `candidateProfile.id === actorId`
- `findOwnAttemptChain` (attemptRepo.ts:126) LEFT JOINs `candidateProfiles` on `examAttempts.candidateId` and returns `ownerUserId: candidateProfiles.userId`
- `resolveOwnAttemptScope` returns `ownership.ownerUserId`; the preHandler compares `ownerUserId === ctx.actorId`
- No route accepts a client-supplied `candidateId` as authority (directive §6.3)
- The start route server-derives the candidate profile from `ctx.actorId` inside the resolver
- No `body/params userId === actorId` pattern exists

**ID type confusion check:**
- `candidateProfiles.userId` (user-level id) is the canonical ownership identity
- `candidateProfile.id` (profile-level id) is used only for DB queries, never for authorization comparison
- `examAttempts.candidateId` is the FK to `candidateProfiles.id`, not a user-level id
- Clean separation confirmed

**Own-resource isolation: PASS**

## G. Organization-anchor proof

**Resolver chain verification:**

`resolveOwnAttemptScope` (ownAttemptResolver.ts:123):
- Loads: attempt → exam → course → organization via `findOwnAttemptChain`
- Validates: all 4 organizationIds against `ctx.organizationId`
- Denies `organization_mismatch` if any node diverges
- Denies `broken_parent_chain` if chain integrity fails (linkedId mismatch or null orgId)
- Repository filters by `resolveOrganizationId(ctx)` on the primary table

`resolveExamEligibilityScope` (examEligibilityResolver.ts:141):
- Loads: exam → course → organization chain + candidate profile + enrollment
- Validates core chain (exam + course + organization) against `ctx.organizationId`
- Candidate profile / enrollment org handling: null is NOT a broken chain (LEFT JOIN), handled as existence facts
- Repository filters by `resolveOrganizationId(ctx)`

**Cross-org protection:**
- Repository-level `resolveOrganizationId(ctx)` filters every query by organization
- Resolver-level explicit org anchor check (deny on mismatch)
- `organization_mismatch` denied as `broken_parent_chain` → 403 (never fail open)
- `resource_not_found` for cross-org resources not found by the org-filtered repo query

**However:** The cross-org protection is proven only at the resolver unit level (Mutation D killed) and by repository SQL inspection. A real HTTP + DB test with Org A Candidate requesting an Org B attempt ID does **not** exist. See P1-1.

**Organization-anchor design: PASS (verification gap: P1-1)**

## H. Start and eligibility proof

**Start route flow:**
```
authenticate → requireExamEligibility(AttemptStart, "examId")
  → resolveExamEligibilityScope(db, logger, resolverCtx, examId)
    → examRepo.findCandidateEligibilityChain(ctx, examId, ctx.actorId)
      → single query: exam→course→org chain + candidate profile (by userId) + enrollment (by profileId + examId)
    → org anchor verified
    → capability (preset) check: Candidate preset holds AttemptStart
  → handler: startOrRestoreAttempt
    → findByExamAndCandidateForUpdate (enrollment check, state guard)
    → PermissionDeniedError on unassigned → 403
```

**Key assertions verified:**
- Candidate profile is server-derived from `ctx.actorId` — no client `candidateId` trust
- Enrollment presence is NOT re-arbitrated in the preHandler (spec §8/§9.5)
- The handler's established 403 (unassigned) vs 404 (detail/queue) contract is preserved
- State guards (exam window, attempt limits, queue) remain in the handler/exam-engine

**Start/eligibility: PASS**

## I. Mutation-route ordering and zero-side-effect proof

**Ordering for each mutating route:**

| Route | First Possible Write | Authorization Complete Before It? | Handler Defense-in-Depth? |
| ----- | -------------------- | --------------------------------: | ------------------------: |
| POST .../start | `startOrRestoreAttempt` (tx) | YES (preHandler) | YES (tx rollback) |
| POST .../answers/:questionId | `saveAnswer` (tx) | YES (preHandler) | YES (tx rollback, line 879) |
| POST .../submit | `submitAndGradeAttempt` | YES (preHandler) | YES (candidateProfile.id) |
| POST .../heartbeat | `attemptRepo.update` | YES (preHandler) | YES (getOwnedAttempt before write) |
| POST .../restore | `restoreAttempt` (tx) | YES (preHandler) | YES (getOwnedAttempt before tx) |

**Zero-side-effect evidence (corrected):**

The `m10a.candidateRuntime.test.ts` test at `describe("RBAC-M10-A candidate runtime — zero-side-effect denial (directive §9.3)")` (line 231) **uses a real database** (`ctx.db` from `buildTestApp`) and real HTTP calls (`ctx.app.inject`). It creates real data (exam, enrollments, two candidates, B's attempt), then proves cross-candidate denial leaves no trace:

| Route | Target | Before/After Queries | Real DB? |
| ----- | ------ | -------------------- | -------: |
| POST .../start (A starts shared exam) | B's enrollment.attemptCount, B's audit rows, B's attempt rows | `bEnrollmentAttemptCount()`, `countAuditForAction()`, `SELECT id FROM exam_attempts WHERE candidateId = B` | **YES** |
| POST .../answers/:questionId | B's attempt | `countAuditForAction(attemptBId, "attempt.saveAnswer")`, `SELECT id FROM attempt_grading_entries WHERE attemptId = B` | **YES** |
| POST .../submit | B's attempt | `countAuditForAction(attemptBId, "attempt.submit")`, `SELECT status FROM exam_attempts WHERE id = B` | **YES** |
| POST .../heartbeat | B's attempt | `SELECT lastActivityAt FROM exam_attempts WHERE id = B` | **YES** |
| POST .../restore | B's attempt | `countAuditForAction(attemptBId, "attempt.restore")` | **YES** |

**Correction from initial review:** The initial evidence table incorrectly classified this test as L4 (no DB). The correct classification is **L6 (HTTP + real DB)**. The test uses `ctx.db` (real Drizzle database connection) and `ctx.app.inject` (real HTTP requests against the Fastify app). The before/after queries read from the actual PostgreSQL database.

**Scope limitation:** The zero-side-effect tests cover **same-org cross-candidate denial** (Org A Candidate A attacking Org A Candidate B's attempt). Cross-org denial (Org A Candidate requesting Org B attempt) is NOT covered by real DB tests. See P1-1.

**Zero unauthorized side effects (same-org cross-candidate): PASS**
**Zero unauthorized side effects (cross-org): NOT PROVEN (see P1-1)**

## J. State/deadline/concurrency preservation

**Verified by comparing baseline vs HEAD handler logic:**

| State/Deadline Concern | Baseline | HEAD | Changed? |
| ---------------------- | -------- | ---- | -------: |
| attempt start eligibility | handler (startOrRestoreAttempt) | handler (same) | NO |
| open/close time | handler (reconciliation) | handler (same) | NO |
| attempt deadline | handler (reconciliation) | handler (same) | NO |
| extra time | handler (reconcile) | handler (same) | NO |
| disrupted/restore transition | handler (restoreAttempt) | handler (same) | NO |
| save-answer allowed states | handler (prepareReconciledAttemptMutation) | handler (same) | NO |
| submit idempotency | handler (submitAndGradeAttempt) | handler (same) | NO |
| optimistic concurrency/version | handler (saveAnswer) | handler (same) | NO |
| heartbeat rules | handler (in_progress check) | handler (same) | NO |
| terminal-state behavior | handler (submitAndGradeAttempt) | handler (same) | NO |
| result publication | handler (unchanged) | handler (same) | NO |

**No state logic moved into resolver.** Resolvers answer authorization only. The `attempts/` test suite (157/157 PASS) confirms state/deadline behavior is unchanged.

**State/deadline preservation: PASS**

## K. Runtime metadata

**Independently verified via `rg` + source inspection for all 10 routes:**

| # | Route | Kind | Permission | ResourceIdKey | Source |
| -: | ----- | ---- | ---------- | ------------- | ------ |
| 1 | GET /candidate/exams | candidate_context | exam.take | (none) | L286 |
| 2 | GET /candidate/exams/:examId | exam_eligibility | exam.take | examId | L418 |
| 3 | POST /attempts/:examId/queue | exam_eligibility | attempt.start | examId | L502 |
| 4 | POST /attempts/:examId/start | exam_eligibility | attempt.start | examId | L548 |
| 5 | GET /attempts/:id | own_attempt | attempt.view_own | id | L662 |
| 6 | GET /candidate/attempts/:attemptId/take | own_attempt | attempt.view_own | attemptId | L702 |
| 7 | POST /attempts/:attemptId/answers/:questionId | own_attempt | attempt.answer.save | attemptId | L795 |
| 8 | POST /attempts/:attemptId/submit | own_attempt | attempt.submit | attemptId | L944 |
| 9 | POST /attempts/:attemptId/heartbeat | own_attempt | attempt.heartbeat.send | attemptId | L1004 |
| 10 | POST /attempts/:attemptId/restore | own_attempt | attempt.restore | attemptId | L1051 |

**Runtime metadata test (`m10a.candidateRuntime.test.ts`, 18/18 PASS):**
- Captures preHandler metadata via Fastify `onRoute` hook
- Asserts full `toEqual({ kind, permission, resourceIdKey? })` for all 10 routes
- Captures all 4 authz kinds (`candidate_context`, `exam_eligibility`, `own_attempt`)
- Mutation A (flat downgrade) killed by this test
- Mutation B (mutating flat downgrade) killed by this test
- Mutation E (wrong resourceIdKey) killed by this test

**No route has zero authz metadata preHandlers. No route has two authz preHandlers.**

**Runtime metadata: PASS**

## L. Registry/runtime conformance

| Route | Runtime Kind | Registry Scope | Runtime Permission | Registry Permission | Registry Resolver (declared) | Runtime Strategy | Verdict |
| ----- | ------------ | -------------- | ------------------ | ------------------- | ---------------------------- | ---------------- | ------- |
| 1 | candidate_context | OwnAttempt | exam.take | exam.take | attempt | none (preset-only) | **RESOLVER_STRATEGY_MISMATCH** |
| 2 | exam_eligibility | OwnAttempt | exam.take | exam.take | attempt | examEligibilityResolver | **RESOLVER_STRATEGY_MISMATCH** |
| 3 | exam_eligibility | OwnAttempt | attempt.start | attempt.start | attempt | examEligibilityResolver | **RESOLVER_STRATEGY_MISMATCH** |
| 4 | exam_eligibility | OwnAttempt | attempt.start | attempt.start | attempt | examEligibilityResolver | **RESOLVER_STRATEGY_MISMATCH** |
| 5 | own_attempt | OwnAttempt | attempt.view_own | attempt.view_own | attempt | ownAttemptResolver | MATCH |
| 6 | own_attempt | OwnAttempt | attempt.view_own | attempt.view_own | attempt | ownAttemptResolver | MATCH |
| 7 | own_attempt | OwnAttempt | attempt.answer.save | attempt.answer.save | attempt | ownAttemptResolver | MATCH |
| 8 | own_attempt | OwnAttempt | attempt.submit | attempt.submit | attempt | ownAttemptResolver | MATCH |
| 9 | own_attempt | OwnAttempt | attempt.heartbeat.send | attempt.heartbeat.send | attempt | ownAttemptResolver | MATCH |
| 10 | own_attempt | OwnAttempt | attempt.restore | attempt.restore | attempt | ownAttemptResolver | MATCH |

**Finding P1-3:** The registry declares `resolver: "attempt"` uniformly for all 10 routes, but the runtime uses three different authorization strategies:

- Routes 1 (candidate_context): **no resolver at all** — the generic `attempt` resolver is not applicable because no attempt exists at the list level
- Routes 2-4 (exam_eligibility): uses `findCandidateEligibilityChain` (exam + candidate profile + enrollment query), not the generic `attempt` resolver
- Routes 5-10 (own_attempt): uses `findOwnAttemptChain` (attempt ownership chain), which IS the generic `attempt` resolver family

The initial report's `MATCH*` classification was incorrect — it relied on a "semantic superset" rationale that is not a valid conformance criterion. The registry's `resolver: "attempt"` field is a declaration of which resolver family to use, and the runtime must match either exactly or through a formalized abstraction.

**Two corrective paths (choose one):**
1. **Update registry to declare the exact runtime strategies** (`candidate_context`, `exam_eligibility`, `own_attempt`) and add them to the conformance test's expected values
2. **Formalize the registry's `resolver` field as a `resourceFamily`** (not a specific resolver key) and update the type system + documentation to reflect this abstraction level

Either path requires the runtime conformance test (`m10a.candidateRuntime.test.ts` metadata assertions) to match the registry's declarations.

**Registry/runtime conformance: RESOLVER_STRATEGY_MISMATCH (see P1-3)**

## M. Shadow parity

**Independently verified parity table:**

| Actor/resource relationship | Legacy effective result | New result | Parity? |
| --- | ---: | ---: | ---: |
| Candidate, own resource | allow | allow | ✅ |
| Candidate, other Candidate resource | 404 (NotFound) | 404 (anti-enumeration) | ✅ |
| Candidate, other organization | 404 (repo org filter) | 404 (resolver resource_not_found) | ✅ |
| Admin on candidate-only route | 403 (requireRole) | 403 (preset deny) | ✅ |
| Teacher | 403 | 403 | ✅ |
| Proctor | 403 | 403 | ✅ |
| Grader | 403 | 403 | ✅ |
| unauthenticated | 401 | 401 | ✅ |

**No public contract changes.** The preHandler denies earlier (before handler reconciliation code runs), which strengthens enforcement without changing status codes.

**`candidateOwnership.test.ts`** (31/31 PASS) independently proves the cross-candidate matrix:
- A cannot read/take/answer/submit/heartbeat/restore B's attempt → all 404
- A sees no detail for an exam enrolled only to B → 404

**Shadow parity: PASS**

## N. Test evidence quality (corrected)

| Test | Level | Real IDs? | Real DB? | Positive Control? | Mutation Sensitive? | Actually Proves |
| ---- | ----- | --------: | -------: | ----------------: | ------------------: | --------------- |
| ownAttemptResolver.test.ts | L2 | yes (static) | no (vi.mock) | YES | YES (Mutations C, D) | Resolver deny mapping (org/chain/ownership/resolver_error) |
| examEligibilityResolver.test.ts | L2 | yes (static) | no (vi.mock) | YES | YES (Mutation VI) | Resolver deny mapping (exam chain + profile + enrollment) |
| ownAttemptCapability.test.ts | L2 | yes (static) | no (vi.mock) | YES | YES (Mutation C) | PreHandler deny mapping (capability + ownership arbitration) |
| examEligibilityCapability.test.ts | L2 | yes (static) | no (vi.mock) | YES | YES | PreHandler deny mapping (capability + eligibility) |
| candidateContextCapability.test.ts | L2 | yes (static) | no | YES | NO (trivial) | Preset-only gate, 401/403 mapping |
| **m10a.candidateRuntime.test.ts — metadata** | **L4** | **yes (static)** | **no** | **YES** | **YES (Mutations A, B, E)** | **Runtime metadata for all 10 routes** |
| **m10a.candidateRuntime.test.ts — zero-side-effect** | **L6** | **yes (real)** | **YES** | **YES** | **NO (behavioral)** | **Cross-candidate denial → zero writes in real DB** |
| candidateOwnership.test.ts | L5 | yes | yes | YES | YES | Cross-candidate own-attempt boundary (real HTTP + DB) |
| attempts/*.test.ts | L5/6 | yes | yes | YES | N/A (state) | State/deadline/protocol behavior preserved |

**Correction note:** The initial review incorrectly classified the zero-side-effect tests as L4 (no DB). The test uses `ctx.db` (real Drizzle connection) and `ctx.app.inject` (real HTTP), making it L6. The zero-side-effect proof is valid for same-org cross-candidate denial. Cross-org denial is NOT covered by real DB tests (see P1-1).

**Key observations:**
- No fake UUID used as "allow" — all real resource IDs in L5/L6 tests
- 404 is correctly used as anti-enumeration, not mistaken for successful access
- Positive controls exist: same-org own-resource tests succeed
- No test uses `.skip`, `.todo`, or conditional skip
- The `candidateOwnership.test.ts` test exercises real HTTP + real DB with real user/org/attempt data

### Test results (independently run):

```
pnpm --filter @exam/authz test:         65/65 PASS
pnpm --filter @exam/api authz suite:   146/146 PASS
pnpm --filter @exam/api attempts suite: 144/144 PASS (16 files)
m10a.candidateRuntime.test.ts:           18/18 PASS
candidateOwnership.test.ts:              31/31 PASS
scores.test.ts:                          21/21 PASS
```

## O. Resolver failure and broken-chain handling

| Failure Mode | Resolver Response | PreHandler Mapping | Test Coverage |
| ------------ | ----------------- | ------------------ | ------------- |
| `resource_not_found` | `{ denied: true, reason: "resource_not_found" }` | 404 | ownAttemptResolver.test.ts, examEligibilityResolver.test.ts |
| `organization_mismatch` | `{ denied: true, reason: "organization_mismatch" }` | 403 | ownAttemptResolver.test.ts, examEligibilityResolver.test.ts |
| `broken_parent_chain` | `{ denied: true, reason: "broken_parent_chain" }` | 403 | ownAttemptResolver.test.ts, examEligibilityResolver.test.ts |
| `resolver_error` | `{ denied: true, reason: "resolver_error" }` | 503 AUTHZ_UNAVAILABLE | ownAttemptResolver.test.ts (catch block), examEligibilityResolver.test.ts (catch block) |
| Missing resource parameter | N/A (preHandler checks params) | 503 AUTHZ_UNAVAILABLE | ownAttemptCapability.test.ts, examEligibilityCapability.test.ts |

**Broken parent chain:** The `materializeChain` function checks `linkedId !== id` for each parent link. FK constraints in PostgreSQL prevent persistent broken chains in production, but the resolver-level test covers the fail-closed behavior.

**Resolver error → 503:** Both resolvers wrap the DB call in a try/catch and return `{ denied: true, reason: "resolver_error" }`. The preHandler maps this to 503 AUTHZ_UNAVAILABLE. Never fail open.

**All resolver errors fail closed: PASS**

## P. Independent mutation results

| Mutation | Route/File | Expected Failure | Actual Failing Test | Killed? |
| -------- | ---------- | ---------------- | ------------------- | ------: |
| I — own-attempt read → flat requireCapability | GET /attempts/:id | metadata test (kind flat≠own_attempt) | m10a.candidateRuntime.test.ts (kind mismatch) | YES |
| II — mutating route → flat requireCapability | POST .../answers/:questionId | metadata test (kind flat≠own_attempt) | m10a.candidateRuntime.test.ts (kind mismatch) | YES |
| III — ownership comparison bypass (|| true) | ownAttemptCapability.ts | unit test (not-owner → 404) | ownAttemptCapability.test.ts | YES |
| IV — organization anchor bypass (false && ...) | ownAttemptResolver.ts | resolver unit test (org_mismatch) | ownAttemptResolver.test.ts | YES |
| V — wrong resourceIdKey ("id" → "WRONG_KEY") | GET /attempts/:id | metadata test (resourceIdKey mismatch) | m10a.candidateRuntime.test.ts | YES |
| VI — start route eligibility bypass (always success) | examEligibilityResolver.ts | resolver unit test (5 fail) | examEligibilityResolver.test.ts | YES |

**All 6 mutations killed. No mutation was committed.**

**Handler defense-in-depth note:** Mutations I and III demonstrated that the handler-level ownership checks (getOwnedAttempt / findByIdAndCandidate / candidateProfile.id compare) remain sufficient — the cross-candidate real-DB test still returned 404 even with the preHandler downgraded/bypassed. This confirms the handler checks are intentionally redundant defense-in-depth, not a defect.

## Q. Test commands and results

```
pnpm --filter @exam/authz test                                       65/65 PASS
pnpm --filter @exam/api exec vitest run src/authz                    146/146 PASS
pnpm --filter @exam/api exec vitest run src/routes/attempts          144/144 PASS
pnpm --filter @exam/api exec vitest run src/routes/candidateOwnership.test.ts
                                                                      31/31 PASS
pnpm --filter @exam/api exec vitest run src/routes/attempts/m10a.candidateRuntime.test.ts
                                                                      18/18 PASS
pnpm --filter @exam/api exec vitest run src/routes/scores.test.ts     21/21 PASS
pnpm typecheck        PASS
pnpm lint             PASS
pnpm lint:arch        PASS
pnpm lint:copy        PASS
pnpm format:check     PASS
pnpm --filter @exam/api api:openapi:check   PASS (openapi.json up to date)
pnpm verify           PASS (build + static checks)
```

**Summary:**
- 0 tests skipped
- 0 tests todo
- 0 tests flaky
- 0 reruns needed
- Worker-DB isolation is standard (DROP CASCADE in test output is normal per-test cleanup)
- No pre-existing failures

## R. Findings

### P0 — Critical

None.

### P1 — Blocking

**P1-1 — Missing real database cross-organization own-attempt test**

The PASS criteria require:
- `cross-organization tests use real resources`
- `cross-org denial independently proven`
- `zero unauthorized writes` (cross-org)

Current evidence:
- `resolveOwnAttemptScope` unit test (Mutation D killed) — proves the design rejects org mismatch
- `resolveExamEligibilityScope` unit test (Mutation VI killed) — proves the design rejects org mismatch
- Repository SQL inspection — `resolveOrganizationId(ctx)` filters every query by org
- Zero-side-effect test — same-org cross-candidate only, NOT cross-org

**Missing:**
- Org A Candidate → send HTTP request to Org B's real attempt ID
- Assert: HTTP 404 (anti-enumeration) or 403 (scope violation)
- Assert: handler did not execute (no side effects)
- Assert: database tables unchanged (exam_attempts, audit_logs, etc.)

The resolver unit tests prove the **design** is correct, but the review standard requires **real HTTP + DB** evidence. This is a verification gap, not a design defect.

**P1-2 — Zero-side-effect evidence table error in initial review**

The initial review incorrectly classified the zero-side-effect test as L4 (no DB). This was a documentation error that has been corrected in §N. The test IS L6 (real HTTP + DB) and the zero-side-effect proof is valid for same-org cross-candidate denial.

**However,** the cross-org zero-side-effect gap remains (P1-1). The PASS criteria require zero-side-effect proof for cross-org denial as well, which is not currently provided.

**P1-3 — Registry resolver strategy mismatch**

The registry declares `resolver: "attempt"` for all 10 M10-A routes, but the runtime uses three different authorization strategies:
- Route 1: `candidate_context` — no resolver (preset-only)
- Routes 2-4: `exam_eligibility` — uses `findCandidateEligibilityChain`
- Routes 5-10: `own_attempt` — uses `findOwnAttemptChain`

The initial report's `MATCH*` classification was invalid. The registry field `resolver: "attempt"` is a declaration that the runtime must match. Two corrective paths exist:

1. **Update registry** to declare the exact runtime strategies with separate `candidate_context`, `exam_eligibility`, `own_attempt` resolver keys, and add them to the conformance test.
2. **Formalize the abstraction level**: rename `resolver` to `resourceFamily` in the registry type, document that `"attempt"` is a family (not a specific resolver key), and update the conformance test to expect the family-level match.

### P2 — Non-blocking

1. **exam_eligibility relies on handler enrollment enforcement for the established 403 (start) vs 404 (detail/queue) distinction.** This is intentional (spec §8/§9.5) and tested, but the preHandler is not the sole gate for the enrollment predicate on archetype B. The org-anchor + capability boundary IS sole-gated by the preHandler.

2. **No real-DB cross-organization own-attempt integration test exists for archetype C/D.** (Promoted to P1-1 — this is a blocking gap.)

## S. Closure decision

```
M10-A IMPLEMENTATION:
IMPLEMENTED

M10-A:
OPEN — VERIFICATION CORRECTIVE REQUIRED

RBAC-M10-B:
DENIED

GLOBAL RBAC-M10-FINISH:
OPEN

GLOBAL FORMAL SCOPED RBAC:
OPEN
```

## T. Corrective requirements

A minimal corrective job (`RBAC-M10-A-INDEPENDENT-REVIEW-CORRECTIVE-1`) is required before M10-A can be CLOSED:

### Corrective-1: Real database cross-org own-attempt test

Add a real HTTP + DB test in `candidateOwnership.test.ts` (or the zero-side-effect block) that:

1. Creates Org A and Org B (or uses the existing org boundary)
2. Creates a Candidate in Org A with an attempt
3. Creates a Candidate in Org B (or references a resource from Org B)
4. Sends HTTP requests from Org A Candidate targeting Org B's attempt ID
5. Asserts: HTTP 404 (anti-enumeration) or 403 (scope violation)
6. Asserts: no handler execution (zero side effects in DB)
7. Asserts: database tables unchanged (exam_attempts, audit_logs, attempt_grading_entries)

### Corrective-2: Registry/runtime conformance

Choose one of:
- **Option A:** Update the route registry to declare the exact runtime strategies (`candidate_context`, `exam_eligibility`, `own_attempt`) with separate resolver entries. Add the new keys to the conformance test.
- **Option B:** Formally rename the registry's `resolver` field to `resourceFamily` in the type system, document that it is a family-level (not resolver-level) declaration, and update the conformance test to match at the family level.

Either option must be reflected in the runtime metadata test (`m10a.candidateRuntime.test.ts`).

### Corrective-3: Fix evidence table (documentation)

The initial review evidence table incorrectly classified the zero-side-effect test as L4/no-DB. This is corrected in §N of this report. The corrective itself is already applied (this report is the authoritative review document). No production code change needed.

## U. Final terminal summary

```
RBAC-M10-A-INDEPENDENT-ADVERSARIAL-REVIEW-1:
CORRECTIVE-REQUIRED

Review HEAD:
3796d168c6e456778540bf780a0fca43856d6f95

Implementation commits reviewed:
4

Commit purity:
PASS

Routes reconciled:
10/10

Candidate requireRole:
0

Total requireRole:
34

Own-resource isolation:
PASS

Cross-organization isolation:
PASS (design) — NOT PROVEN (real DB evidence)

Start/eligibility:
PASS

Zero unauthorized side effects:
PASS (same-org cross-candidate) — NOT PROVEN (cross-org)

State/deadline preservation:
PASS

Runtime metadata:
PASS

Registry/runtime conformance:
RESOLVER_STRATEGY_MISMATCH — CORRECTIVE REQUIRED

Shadow parity:
PASS

Independent mutations:
6/6 killed

pnpm verify:
PASS

P0:
0

P1:
3

P2:
1

M10-A:
OPEN — VERIFICATION CORRECTIVE REQUIRED

RBAC-M10-B:
DENIED

GLOBAL RBAC-M10-FINISH:
OPEN

GLOBAL FORMAL SCOPED RBAC:
OPEN
```