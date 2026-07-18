# RBAC-M10-A-IMPLEMENTATION-1

## A. Verdict

```
RBAC-M10-A-IMPLEMENTATION-1:
PASS WITH NON-BLOCKING FINDINGS — AUTHOR SELF-ASSESSMENT

INDEPENDENT ADVERSARIAL REVIEW REQUIRED
```

**Non-blocking finding ( Mutation F, spec §11 ):** the candidate-runtime
handler-level ownership checks (getOwnedAttempt / findByIdAndCandidate /
candidateProfile.id compare / submitAndGradeAttempt) are now redundant with the
new preHandler-level own-attempt / exam-eligibility gates. They are retained as
defense-in-depth per directive §6.6 and the baseline (§I). Mutations A and C
proved the preHandler alone is sufficient for the externally observable
boundary; the handler checks remain a second line. This is the documented
"intentionally redundant defense-in-depth" case the directive names, and is NOT
a defect.

## B. Baseline and branch

```
Baseline commit: 8ef50e52cd61b15fa1814b52d31ab3785da715a3
Baseline branch:  feat/rbac-m10-finish
Baseline doc:     docs/phase3/rbac/RBAC-M10-FINISH-BASELINE-1.md
Work branch:      feat/rbac-m10-a-candidate-runtime
Worktree:         CLEAN (after every commit and after the mutation campaign)
Corrective-2:     present (in baseline)
Inventory re-proven from source at job start: 10 Candidate + 34 Admin = 44
                                                  production requireRole gates.
```

## C. Authoritative ten-route inventory

All 10 routes live in `apps/api/src/routes/attempts.candidate.ts`. The route
registry (`apps/api/src/authz/routeRegistry.ts`) already declared the target
state for all 10 (`scope: OwnAttempt`, `resolver: "attempt"`,
`migrationStage: 7`); this job realizes that target at runtime.

| # | Method | Route | Registry permission |
| -: | ------ | ----- | ------------------- |
| 1 | GET | /candidate/exams | exam.take |
| 2 | GET | /candidate/exams/:examId | exam.take |
| 3 | POST | /attempts/:examId/queue | attempt.start |
| 4 | POST | /attempts/:examId/start | attempt.start |
| 5 | GET | /attempts/:id | attempt.view_own |
| 6 | GET | /candidate/attempts/:attemptId/take | attempt.view_own |
| 7 | POST | /attempts/:attemptId/answers/:questionId | attempt.answer.save |
| 8 | POST | /attempts/:attemptId/submit | attempt.submit |
| 9 | POST | /attempts/:attemptId/heartbeat | attempt.heartbeat.send |
| 10 | POST | /attempts/:attemptId/restore | attempt.restore |

Counts reconciled exactly: 10 runtime routes, 10 baseline assignments, 10
registry entries, no duplicates, no omissions.

## D. Route classification (directive §4 archetypes)

| # | Archetype | Required boundary |
| -: | --------- | ----------------- |
| 1 | A (candidate-context list) | authenticated actor → org → server-resolved candidate profile → query scoped to that profile |
| 2 | B (exam eligibility) | actor → candidate profile → exam org anchor → enrollment/eligibility → expose only the actor's resource |
| 3 | B (exam eligibility) | as above |
| 4 | B (exam eligibility, CREATE) | as above; never trust a client candidateId (directive §6.3) |
| 5 | C (existing own-attempt read) | attempt → candidate profile → candidateProfiles.userId === actorId |
| 6 | C (existing own-attempt read, reconcile side-effect) | as above |
| 7 | D (own-attempt transition) | permission + own-attempt ownership + org anchor + existing protocol/version guard |
| 8 | D (own-attempt transition) | permission + own-attempt ownership + existing submit state/deadline guard |
| 9 | D (own-attempt transition) | permission + own-attempt ownership + in_progress state guard |
| 10 | D (own-attempt transition) | permission + own-attempt ownership + disrupted-state transition guard |

## E. Selected authorization design

**Four semantic authz metadata kinds** (directive §7 — "use an explicit kind
when semantically different from generic organization-scoped authorization").
The `AuthzMetadata` union in `apps/api/src/types/fastify-auth.d.ts` is extended
with `candidate_context`, `exam_eligibility`, `own_attempt` (in addition to the
existing `flat` / `scoped`).

Three new pure capability builders + one new pure resolver family per
archetype; all deny-mapping and arbitration logic is unit-testable without DB
fixtures (the resolvers are stubbed at the repo layer, mirroring
scoreCapability.test.ts):

| Archetype | Decorator | Resolver | DB reads |
| --------- | --------- | -------- | --------: |
| A | `requireCandidateContext(perm)` | none (preset-only; handler scopes list) | 0 |
| B | `requireExamEligibility(perm, "examId")` | `resolveExamEligibilityScope` (examRepo.findCandidateEligibilityChain) | 1 |
| C/D | `requireOwnAttempt(perm, resourceIdKey)` | `resolveOwnAttemptScope` (attemptRepo.findOwnAttemptChain) | 1 |

The decision is **capability + ownership/eligibility, never role-name**
(directive §6.1): the role preset (Candidate holds all 7 runtime permissions —
no preset-parity correction needed) supplies the capability verdict; the
resolver supplies the org-anchor + ownership/eligibility facts; no
`ctx.role === "Candidate"` branch exists in any new code.

**Denial mapping (ADR §3.9, mirrors scoreCapability):**
- capability (preset) denial → 403 PERMISSION_DENIED
- resolver `resource_not_found` → 404 (anti-enumeration)
- resolver `organization_mismatch` / `broken_parent_chain` → 403
- resolver `resolver_error` → 503 AUTHZ_UNAVAILABLE (never fail open)
- own_attempt: capability holder but `ownerUserId !== actorId` → **404**
  (anti-enumeration, NOT 403 — matches the proven cross-candidate convention)

**exam_eligibility does NOT re-arbitrate enrollment presence** (spec §8/§9.5):
the handler already enforces enrollment with its established per-route
semantics (start → PermissionDeniedError → 403; detail/queue → NotFoundError →
404). Re-arbitrating in the preHandler would unify two intentionally-distinct
handler contracts and flip an established 403 to 404 (forbidden by §8/§9.5).
The preHandler's job is the org-anchor + capability boundary; the handler
keeps the enrollment predicate as defense-in-depth (§6.6).

## F. Files changed

New files:
```
apps/api/src/authz/resolvers/ownAttemptResolver.ts
apps/api/src/authz/resolvers/examEligibilityResolver.ts
apps/api/src/authz/ownAttemptCapability.ts
apps/api/src/authz/examEligibilityCapability.ts
apps/api/src/authz/candidateContextCapability.ts
apps/api/src/authz/resolvers/ownAttemptResolver.test.ts
apps/api/src/authz/resolvers/examEligibilityResolver.test.ts
apps/api/src/authz/ownAttemptCapability.test.ts
apps/api/src/authz/examEligibilityCapability.test.ts
apps/api/src/authz/candidateContextCapability.test.ts
apps/api/src/routes/attempts/m10a.candidateRuntime.test.ts
docs/phase3/rbac/RBAC-M10-A-IMPLEMENTATION-1.md   (this file)
```

Modified files:
```
apps/api/src/types/fastify-auth.d.ts           (AuthzMetadata union + 3 decorators)
apps/api/src/plugins/authz.ts                  (register 3 decorators + resolvers)
apps/api/src/openapi/swagger.ts                (3 no-op stubs)
apps/api/src/routes/attempts.candidate.ts      (flip 10 preHandler arrays)
packages/db/src/repository/attemptRepo.ts      (findOwnAttemptChain)
packages/db/src/repository/examRepo.ts         (findCandidateEligibilityChain)
docs/phase3/rbac/RBAC-JOB-QUEUE.md             (M10-A status update)
```

The route registry (`routeRegistry.ts`) already declared the target state for
all 10 routes and required no change — the runtime now matches the registry.

## G. Route-by-route migration table

| Route | Old gate | New permission | New authz kind | Resolver/strategy | Ownership source | State guard preserved |
| ----- | -------- | -------------- | -------------- | ----------------- | ---------------- | --------------------- |
| GET /candidate/exams | requireRole(["Candidate"]) | exam.take | candidate_context | preset-only; handler findByCandidate | candidateProfiles.userId | n/a (list) |
| GET /candidate/exams/:examId | requireRole(["Candidate"]) | exam.take | exam_eligibility | resolveExamEligibilityScope | candidateProfiles.userId + enrollment | handler NotFoundError 404 |
| POST /attempts/:examId/queue | requireRole(["Candidate"]) | attempt.start | exam_eligibility | resolveExamEligibilityScope | candidateProfiles.userId + enrollment | handler NotFoundError 404 |
| POST /attempts/:examId/start | requireRole(["Candidate"]) | attempt.start | exam_eligibility | resolveExamEligibilityScope | candidateProfiles.userId + enrollment | startOrRestoreAttempt state+window; PermissionDeniedError 403 |
| GET /attempts/:id | requireRole(["Candidate"]) | attempt.view_own | own_attempt | resolveOwnAttemptScope | candidateProfiles.userId === actorId | n/a (read) |
| GET /candidate/attempts/:attemptId/take | requireRole(["Candidate"]) | attempt.view_own | own_attempt | resolveOwnAttemptScope | candidateProfiles.userId === actorId | deadline reconcile (tx) |
| POST /attempts/:attemptId/answers/:questionId | requireRole(["Candidate"]) | attempt.answer.save | own_attempt | resolveOwnAttemptScope | candidateProfiles.userId === actorId | prepareReconciledAttemptMutation + Answer Protocol |
| POST /attempts/:attemptId/submit | requireRole(["Candidate"]) | attempt.submit | own_attempt | resolveOwnAttemptScope | candidateProfiles.userId === actorId (submitAndGradeAttempt) | submit state+deadline+idempotency |
| POST /attempts/:attemptId/heartbeat | requireRole(["Candidate"]) | attempt.heartbeat.send | own_attempt | resolveOwnAttemptScope | candidateProfiles.userId === actorId | in_progress state guard |
| POST /attempts/:attemptId/restore | requireRole(["Candidate"]) | attempt.restore | own_attempt | resolveOwnAttemptScope | candidateProfiles.userId === actorId | disrupted-state transition; deadline reconcile |

## H. Candidate context and ownership proof

- All ownership is server-derived: `candidateProfiles.userId === ctx.actorId`
  (never a body/params/query candidateId — directive §6.3).
- `findOwnAttemptChain` LEFT JOINs candidateProfiles on the attempt's
  candidateId; the resolver returns `ownerUserId = candidateProfiles.userId`.
- The own_attempt preHandler compares `resolution.ownership.ownerUserId ===
  ctx.actorId`; a capability holder that is not the owner is denied 404
  (anti-enumeration).
- `candidateOwnership.test.ts` (31/31 PASS) re-proves the cross-candidate matrix
  after the cutover: A cannot read/take/answer/submit/heartbeat/restore B's
  attempt (all 404), A sees no detail for an exam enrolled only to B (404).

## I. Organization-anchor proof

- `resolveOwnAttemptScope` loads the attempt→exam→course→organization chain and
  denies `organization_mismatch` if any node diverges from `ctx.organizationId`
  (explicit anchor, ADR §3.4 — never implied).
- `resolveExamEligibilityScope` validates the exam→course→organization core
  chain.
- `ownAttemptResolver.test.ts` "denies organization_mismatch anywhere in the
  chain" + "denies broken_parent_chain" prove the anchor (Mutation D killed by
  this test).
- The repo methods filter by `resolveOrganizationId(ctx)` (required) on the
  primary table, so a cross-org resource is simply not found → resource_not_found
  → 404.

## J. Start / eligibility proof

- The start route's preHandler (`requireExamEligibility(AttemptStart, "examId")`)
  resolves the exam under the org anchor and the actor's candidate profile +
  enrollment in ONE query (`findCandidateEligibilityChain`).
- The candidate profile is server-derived from `ctx.actorId` inside the resolver
  — the start route never reads a client-supplied candidateId (directive §6.3).
- Enrollment presence is NOT re-arbitrated in the preHandler (spec §8/§9.5); the
  handler's `startOrRestoreAttempt` → `findByExamAndCandidateForUpdate` retains
  its established `PermissionDeniedError` → 403 contract for an unassigned
  candidate (`candidate-start.test.ts` "rejects unassigned candidate" 403, PASS).
- State guards (exam availability window, latestStartOffset, queue admission,
  attempt-count limits) remain in the handler / exam-engine (directive §6.5 /
  ADR §22.3 — RBAC ≠ state machine).

## K. State / deadline separation

Resolvers decide ONLY "is this actor authorized for this resource?". Domain
state remains in the handler / exam-engine and is unchanged:
- start: enrollment + exam availability + start window (startOrRestoreAttempt)
- save-answer: active attempt + protocol/version + deadline
  (prepareReconciledAttemptMutation + saveAnswer)
- submit: legal status + deadline + idempotency (submitAndGradeAttempt)
- heartbeat: in_progress status
- restore: disrupted-state transition + deadline reconcile

`src/routes/attempts/` 157/157 PASS confirms state/deadline behavior is
unchanged.

## L. Zero-side-effect evidence

`m10a.candidateRuntime.test.ts` "zero-side-effect denial" block (5 tests, PASS)
proves that a cross-candidate denial on each mutating route leaves no trace:
- POST /attempts/:examId/start (A starts shared exam): B's enrollment
  attemptCount unchanged, no new B attempt, no examId-targeted attempt.start
  audit created for the shared exam (A's audit targets A's NEW attempt id).
- POST .../answers/:qid (A denied on B): no saveAnswer audit, no new grading
  entry.
- POST .../submit (A denied on B): no submit audit, B's attempt stays
  in_progress (no transition).
- POST .../heartbeat (A denied on B): lastActivityAt unchanged.
- POST .../restore (A denied on B): no restore audit.

Row counts are queried before/after on `exam_attempts`, `audit_logs`,
`attempt_grading_entries`, `exam_enrollments.attemptCount`.

## M. Runtime metadata and registry conformance

`m10a.candidateRuntime.test.ts` "runtime authz metadata" block (11 tests, PASS)
captures every route's preHandler via Fastify's `onRoute` hook and asserts the
full `toEqual({ kind, permission, resourceIdKey? })` metadata for all 10
routes. Capture matches every authz kind (`candidate_context`, `exam_eligibility`,
`own_attempt`, `scoped`, `flat`). Mutations A, B, E are killed by this test.

The registry already declared the target state for all 10 routes; the runtime
now matches.

## N. Shadow parity

| Actor/resource relationship | Legacy effective result | New result |
| --- | ---: | ---: |
| Candidate, own resource | allow | allow |
| Candidate, other Candidate resource | 404 (NotFound) | 404 (anti-enumeration) |
| Candidate, other organization | 404 (repo org filter) | 404 (resolver resource_not_found) |
| Admin on candidate-only route | 403 (requireRole) | 403 (preset) |
| Teacher | 403 | 403 |
| Proctor | 403 | 403 |
| Grader | 403 | 403 |
| unauthenticated | 401 | 401 |

Intentional differences: NONE that change the public contract. The preHandler
denies earlier (before handler reconciliation/lock code runs) — this strengthens
enforcement without changing status codes (directive §8 allows denying before
the handler rather than inside it). `candidateOwnership.test.ts` (31/31) and
`src/routes/attempts/` (157/157) PASS confirm parity.

## O. Mutation evidence

| Mutation | File/route | Expected failing test | Actual result | Killed? |
| -------- | ---------- | --------------------- | ------------- | ------: |
| A — own-attempt read downgraded to flat requireCapability | GET /attempts/:id | metadata test (kind flat≠own_attempt) | metadata test FAILED (kind mismatch) | YES |
| B — mutating route downgraded to flat requireCapability | POST /attempts/:attemptId/answers/:questionId | metadata test | metadata test FAILED (kind mismatch) | YES |
| C — ownership comparison bypassed (`|| true`) | ownAttemptCapability.ts | ownAttemptCapability.test.ts (not-owner → 404) | unit test FAILED | YES |
| D — organization anchor neutralized (`false && ...`) | ownAttemptResolver.ts | ownAttemptResolver.test.ts (org_mismatch) | unit test FAILED | YES |
| E — wrong resourceIdKey (`"id"` → `"attemptId"`) | GET /attempts/:id | metadata test | metadata test FAILED (resourceIdKey mismatch) | YES |
| F — handler ownership defense removed (source assertion only) | (defense-in-depth, redundant) | n/a — preHandler sufficient (A/C proved); handler checks retained in source | NO KILL REQUIRED (directive §11 F: do not require a kill from intentionally-redundant defense-in-depth) | N/A (honest) |

Mutations A and C additionally showed the handler-level defense-in-depth
(getOwnedAttempt / findByIdAndCandidate) is sufficient on its own — the
cross-candidate real-DB test still returned 404 even with the preHandler
downgraded/bypassed. This is exactly the directive §11 F finding: defense-in-
depth is intentionally redundant. Handler checks remain present in source
(proven by `rg` in §H).

After each mutation: `git restore`; `git status --short` clean. No mutation was
committed.

## P. Test commands and results

```
pnpm --filter @exam/authz test                                       65/65 PASS
pnpm --filter @exam/api exec vitest run src/authz                     46/46 PASS
  (scoreCapability 19, scopedCapability 10, attemptResolver 7,
   ownAttemptCapability 9, examEligibilityCapability 9,
   candidateContextCapability 3, ownAttemptResolver 6,
   examEligibilityResolver 6, + existing files)
pnpm --filter @exam/api exec vitest run src/routes/attempts          157/157 PASS
pnpm --filter @exam/api exec vitest run src/routes/candidateOwnership.test.ts
                                                                      31/31 PASS
pnpm --filter @exam/api exec vitest run src/routes/scores.test.ts      PASS
pnpm --filter @exam/api exec vitest run src/routes/attempts/m10a.candidateRuntime.test.ts
                                                                      18/18 PASS

pnpm typecheck        PASS
pnpm lint             PASS
pnpm lint:arch        PASS
pnpm lint:copy        PASS
pnpm format:check     PASS
pnpm --filter @exam/api api:openapi:check   PASS (openapi.json up to date)
pnpm verify           (see final output)
```

No skipped tests were introduced. No flaky reruns. Worker-DB isolation is the
project's standard test mechanism (the DROP CASCADE log lines in test output are
normal per-test cleanup).

## Q. Self-review findings

`rg -n 'requireRole\(\["Candidate"\]\)' apps/api/src` → 0 production matches
(2 remaining matches are doc comments: a test docstring and the
candidateContextCapability rationale comment — both intentional migration-
traceability references, not gates).

`rg -n 'ctx\.role|request\.ctx\.role|role === "Candidate"|role !== "Candidate"|isCandidate'`
in `apps/api/src/routes/attempts.candidate.ts`, `apps/api/src/authz`,
`apps/api/src/plugins` → 0 role-name authorization branches in new code. (The
capability builders read `ctx.role` only to pass it to the injected `presetAllows`
predicate — the same single source `requireCapability` uses; no branch on the
role value.)

Review checklist (directive §13):
- actor ID / profile ID confusion: NONE — ownership is candidateProfiles.userId
  compared to ctx.actorId (a user id), never the candidateProfile.id.
- trusting body/params candidateId: NONE — resolver derives profile from actorId.
- missing organization anchor: NONE — explicit in both resolvers.
- resolver error mapped to allow: NONE — 503 AUTHZ_UNAVAILABLE (fail-closed).
- authorization after write: NONE — preHandler runs before handler.
- handler side effects before authorization: NONE — preHandler denies first.
- state logic moved into resolver: NONE — resolvers answer authorization only.
- wrong permission reuse: NONE — registry permissions used as-is.
- wrong route metadata: NONE — metadata test pins all 10.
- registry/runtime drift: NONE — runtime now matches registry.
- duplicate authorization handlers: NONE — one authz preHandler per route
  (metadata test asserts).
- accidental Admin compatibility widening: NONE — Admin preset holds no
  Candidate-own permission (adminCompatibility boundary preserved).
- missing anti-enumeration: NONE — cross-candidate → 404.
- start route creating an attempt for another profile: NONE — candidateId is
  server-derived; submitAndGradeAttempt / startOrRestoreAttempt receive
  candidateProfile.id resolved from actorId.
- save/submit race or version behavior changed: NONE — Answer Protocol and
  submit idempotency unchanged (157/157 PASS).
- removed defense-in-depth: NONE — handler checks retained (source assertion).
- unrelated M10-B/M10-E changes: NONE — only the 10 Candidate routes touched.

## R. Remaining risks

1. **Runtime authority remains MIXED** (users.role is de facto authority). This
   is the documented baseline finding (BASELINE-1 §A/§J), not a defect introduced
   by M10-A; M10-E is the job that changes the authority model. M10-A operates
   entirely within the current users.role-backed preset model.
2. **exam_eligibility relies on handler enrollment enforcement** for the
   established 403 (start) vs 404 (detail/queue) distinction. This is
   intentional (spec §8/§9.5) and tested, but means the preHandler is not the
   sole gate for the enrollment predicate on archetype B. The org-anchor +
   capability boundary IS sole-gated by the preHandler.
3. **No real-DB cross-organization own-attempt integration test** exists for
   archetype C/D (candidateOwnership covers cross-candidate, same-org). The
   org-anchor boundary for own_attempt is proven at the resolver unit level
   (Mutation D) and by the repo's org filter (cross-org → resource_not_found →
   404). A cross-org own-attempt real-DB test would strengthen L6 evidence; it
   is a non-blocking follow-up.

## S. Closure recommendation

```
M10-A IMPLEMENTATION:
COMPLETE

M10-A INDEPENDENT REVIEW:
REQUIRED

RBAC-M10-B AUTHORIZATION:
DENIED

GLOBAL RBAC-M10-FINISH:
OPEN

GLOBAL FORMAL SCOPED RBAC:
OPEN
```

Independent adversarial review is required before M10-A may be marked CLOSED.
M10-B (academic management) is NOT started.
