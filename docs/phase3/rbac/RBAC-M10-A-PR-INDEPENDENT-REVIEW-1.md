# RBAC-M10-A-PR-INDEPENDENT-REVIEW-1

## A. Verdict

```
RBAC-M10-A-PR-INDEPENDENT-REVIEW-1:
APPROVE WITH NON-BLOCKING FINDINGS
```

## B. PR base, head and independence

| Field | Value |
|-------|-------|
| PR BRANCH | `fix/rbac-m10-a-review-corrective-1` |
| PR HEAD | `512f5bba403c8c1a5bfda86dd3dab6347e6f71ce` |
| PR BASE (merge-base with master) | `9cd20a839adb78f4f0b6253cfed6deafc97c3009` |
| Corrective 512f5bb present | YES |
| Worktree | CLEAN |
| Stash | 1 unrelated stash (`fix/formal-ea-lock-order`) — does not affect this PR |
| Untracked artifacts | None |

**Independence confirmed.** The review was conducted from scratch on the branch with no production code modified. All verification commands were run independently. No prior PASS statements were trusted without independent reproduction.

## C. Commit-series review

5 commits reviewed, in logical order:

| # | Commit | Purpose | Files | Scope | Verdict |
|---|--------|---------|------:|------|---------|
| 1 | 5036ddf | feat(authz): add candidate-runtime capability resolvers and decorators | 15 files (10 new, 5 modified) | Auth infrastructure: resolvers, capability builders, repo methods, type declarations, swagger stubs | CLEAN |
| 2 | e125737 | feat(api): cut over candidate runtime routes to capability authorization | 3 files modified | Route cutover: attempts.candidate.ts, examEligibilityCapability fine-tuning | CLEAN |
| 3 | 0697420 | test(authz): prove M10-A runtime metadata and zero-side-effect denial | 1 new file | m10a.candidateRuntime.test.ts | CLEAN |
| 4 | 3796d16 | docs(rbac): record M10-A implementation evidence | 3 files modified | Implementation evidence doc, job queue update, test refinement | CLEAN |
| 5 | 512f5bb | docs(rbac): close M10-A corrective — commit + documentation closure | 6 files (4 new, 2 modified) | Registry runtimeAuthz declarations, conformance test, cross-org defense test, corrective docs | CLEAN |

**Series order:** authorization infrastructure → Candidate route cutover → integration/runtime tests → implementation evidence documentation → corrective closure. This matches the expected sequence.

**No suspicious changes found:** no mutation commits, fixup/debug commits, unrelated formatting, generated artifacts, M10-B/C/D/E work, frontend changes, schema changes, JWT/session redesign, assignment-backed runtime work, or test weakening.

## D. Scope purity

```
PR SCOPE:
PURE — M10-A ONLY
```

All changed files are within the expected M10-A scope: Candidate runtime route authorization, candidate context authorization, exam eligibility authorization, own-attempt authorization, route authz metadata, route registry runtimeAuthz declarations, repository queries, M10-A-specific tests, M10-A review/closure documentation.

**No changes to:** M10-B academic management routes, identity and role-assignment runtime, multi-role merging, assignment-backed authority, JWT/session design, frontend navigation, email/settings/system administration, grading/proctor behavior, or database schema.

## E. Single-tenant consistency

```
TENANCY MODEL:
SINGLE-TENANT — CONSISTENT
```

The PR is consistent with the authoritative single-tenant product model:

- The corrective-1 document correctly declares `TENANCY MODEL: SINGLE-TENANT`
- The cross-org test in `candidateOwnership.test.ts` is correctly documented as `NON-AUTHORITATIVE LEGACY DEFENSE TEST`
- P1-1 is correctly rejected as `INVALID MULTI-TENANT PREMISE`
- No stale multi-tenant assumptions exist in production code or authority documentation

The cross-org test creates a second organization via direct DB insert (not a supported product path), and is correctly classified as non-authoritative defense-in-depth. It must not be used as M10-A closure evidence, must not define the product as multi-tenant, and must not cause M10-B to be planned as a multi-tenant migration.

## F. Candidate ownership boundary

The ownership chain is correctly enforced:

```
request.ctx.actorId
→ candidateProfiles.userId (server-derived, no client trust)
→ candidate profile
→ enrollment / attempt
→ own-resource decision
```

The canonical ownership fact is `candidateProfiles.userId === request.ctx.actorId`. The implementation rejects authority based on client candidateId, client userId, candidateProfile.id === actorId, examAttempts.candidateId === actorId, or body/query/params identity claims.

**Verified in:**
- `ownAttemptResolver.ts` — loads `ownerUserId` from `candidateProfiles.userId` via `findOwnAttemptChain`
- `ownAttemptCapability.ts` — compares `resolution.ownership.ownerUserId` against `ctx.actorId`; cross-candidate → 404 (anti-enumeration)
- `examEligibilityResolver.ts` — loads candidate profile from `candidateProfiles.userId === ctx.actorId` server-side
- `examEligibilityCapability.ts` — server-derived candidate profile, no body/params trust

No late corrective weakened this chain.

## G. Ten-route reconciliation

All 10 routes are correctly accounted for:

| # | Method | Path | Registry present | Route registered | Runtime kind |
|---|--------|------|:----------------:|:----------------:|--------------|
| 1 | GET | /candidate/exams | YES | YES | `candidate_context` |
| 2 | GET | /candidate/exams/:examId | YES | YES | `exam_eligibility` |
| 3 | POST | /attempts/:examId/queue | YES | YES | `exam_eligibility` |
| 4 | POST | /attempts/:examId/start | YES | YES | `exam_eligibility` |
| 5 | GET | /attempts/:id | YES | YES | `own_attempt` |
| 6 | GET | /candidate/attempts/:attemptId/take | YES | YES | `own_attempt` |
| 7 | POST | /attempts/:attemptId/answers/:questionId | YES | YES | `own_attempt` |
| 8 | POST | /attempts/:attemptId/submit | YES | YES | `own_attempt` |
| 9 | POST | /attempts/:attemptId/heartbeat | YES | YES | `own_attempt` |
| 10 | POST | /attempts/:attemptId/restore | YES | YES | `own_attempt` |

**Counts verified:**
```text
Candidate requireRole:   0 (down from 10)
Total production requireRole:  34 (all Admin)
```

No omissions, no duplicates, no foreign-domain routes.

## H. Registry/runtime conformance

The conformance test (`routeRegistryConformance.test.ts`) is **sound and non-tautological**:

1. **Derives expected metadata from the registry** — the `expectedMetadata()` function reads the registry's `runtimeAuthz` field + `permission` to build the expected runtime metadata object. No hard-coded expected table is duplicated in the test.
2. **Compares against actual Fastify onRoute metadata** — the test registers all routes in a real Fastify instance, captures the `onRoute` hook, and finds the authz preHandler by inspecting the full normalized preHandler array.
3. **Asserts exactly one authz preHandler** — verifies no duplicate, no omission.
4. **Full metadata comparison** — compares `kind`, `permission`, and `resourceIdKey` (where applicable), not just kind.
5. **15 tests covering all 10 routes** — registry entry count, per-route metadata match, exactly-one-authz, kind-specific invariants (candidate_context has no resolverKey/resourceIdKey, exam_eligibility always has examId, own_attempt always has id or attemptId).

**No issues:** no fixed preHandler indexes, no duplicated hard-coded route expectation tables, no registry-vs-self comparison, no silently skipped missing routes, no kind-only assertions.

The `runtimeAuthz` field is the exact runtime authorization authority. The legacy `resolver` field remains only as documented resource-family metadata and does not compete with `runtimeAuthz`.

## I. Same-tenant HTTP + DB evidence

**Same-tenant Candidate A/B isolation: PROVEN.**

The `candidateOwnership.test.ts` test suite (44 tests) includes the original P4-3 cross-candidate attack matrix plus the M10-A corrective cross-org block. The same-tenant block proves:

- Candidate A → Attempt A: allowed (positive control)
- Candidate A → Attempt B: 404 (anti-enumeration)

All 44 tests pass. Real HTTP requests against a real DB. No mock-only ownership proof.

## J. Zero-write evidence

**Zero unauthorized writes: PROVEN.**

The `m10a.candidateRuntime.test.ts` zero-side-effect denial suite proves that Candidate A's denied requests against Candidate B's attempt produce zero side effects on:

- Attempt status
- `lastActivityAt`
- `submittedAt`
- Audit log rows
- `attempt_grading_entries` rows
- `client_events` rows
- Enrollment `attemptCount`

The test covers all 5 mutating routes: start, save-answer, submit, heartbeat, restore. The `GET /take` route is also proven to cause no unauthorized reconciliation write.

Real DB before/after assertions are used for all side-effect checks.

## K. Test integrity

| Test file | Evidence level | Real DB? | Positive control? | What it proves | Verdict |
|-----------|---------------|:--------:|:-----------------:|----------------|---------|
| `routeRegistryConformance.test.ts` | Actual Fastify onRoute capture | YES (app bootstrap) | Registry entry count | Registry ↔ runtime metadata conformance | CLEAN |
| `candidateOwnership.test.ts` | Real HTTP + real DB | YES | YES (positive control tests) | Same-tenant Candidate A/B isolation, cross-org denial | CLEAN |
| `m10a.candidateRuntime.test.ts` | Real HTTP + real DB | YES | YES (Candidate B own access) | Runtime metadata, zero-side-effect denial, non-Candidate role denial | CLEAN |
| Resolver unit tests (×4) | vi.mock + real resolver logic | NO (stubbed) | N/A | Org-anchor, chain integrity, error handling | CLEAN |
| Capability unit tests (×3) | vi.mock + real preHandler logic | NO (stubbed) | N/A | Deny mapping, ownership arbitration, role-name-free | CLEAN |

**No integrity issues found:** no `.skip`, `.todo`, conditional skip, fake positive IDs, 404 classified as successful access, mock-only ownership proof, missing positive controls, wrong target-row assertions, weakened status assertions, or test-order dependence.

## L. Documentation consistency

**Corrective history is consistent:**

- [x] Single-tenant is authoritative
- [x] Invalid multi-tenant P1 rejected
- [x] Cross-org test is non-authoritative
- [x] P1-3 is closed
- [x] Corrective SHA 512f5bb is accurate
- [x] Worktree status claims are historical and accurately dated
- [x] M10-A is closed only after commit 512f5bb
- [x] M10-B is only authorized to rebase and plan

Historical reports retain original verdicts with clear supersedure notes. The current authority documentation is consistent.

## M. PR description accuracy

The commit messages and documentation accurately state:

- [x] M10-A only
- [x] Single-tenant Candidate ownership
- [x] 10 Candidate routes migrated
- [x] Candidate requireRole 10 → 0
- [x] Total requireRole 44 → 34
- [x] runtimeAuthz conformance
- [x] Same-tenant real-DB zero-write proof
- [x] M10-A closed after corrective 512f5bb
- [x] M10-B not implemented

No overclaiming: no "global RBAC complete", "multi-tenant isolation complete", "assignment-backed runtime complete", "M10-B complete", or "all requireRole removed".

## N. Verification commands

### Focused tests (independently executed, uncached)

| Test suite | Result |
|------------|:------:|
| `routeRegistryConformance.test.ts` | 15/15 PASS |
| `candidateOwnership.test.ts` | 44/44 PASS |
| `m10a.candidateRuntime.test.ts` | 18/18 PASS |
| `src/authz` (all) | 161/161 PASS |
| `src/routes/attempts` (all) | 144/144 PASS |

### Full verification chain

| Check | Result |
|-------|:------:|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm lint:arch` | PASS |
| `pnpm lint:copy` | PASS |
| `pnpm format:check` | PASS |
| `pnpm verify` | PASS (9 tasks, all cached) |

The focused tests were independently executed uncached in this review. The cached `pnpm verify` is acceptable because the directly relevant tests were independently verified uncached.

### Mutation evidence (Section 14)

The prior reviews documented 5/5 mutations killed (A: flat downgrade, B: mutating flat downgrade, C: ownership bypass, D: org-anchor neutralized, E: wrong resourceIdKey). No code changed after the mutation campaign that would invalidate the evidence. The mutation evidence is independently inspectable from the committed test files. **Classified as already proven.**

## O. Findings

### P0: 0

None.

### P1: 0

None.

### P2: 1

**P2-1: Corrective-1 document terminal summary is stale relative to the corrective commit.**

The document `RBAC-M10-A-INDEPENDENT-REVIEW-CORRECTIVE-1.md` was written before the corrective commit was made and was included in commit 512f5bb as-is. Its terminal summary states:

```
Worktree:
DIRTY — uncommitted corrective changes present

M10-A:
OPEN — COMMIT + DOCUMENTATION CLOSURE REQUIRED
```

This contradicts the actual commit state: the corrective commit 512f5bb has committed all corrective changes, the worktree is clean, and this document is the closure documentation. The terminal summary should reflect the committed state.

**Recommendation:** Update the terminal summary in the corrective-1 document to state `Worktree: CLEAN` and `M10-A: CLOSED — CORRECTIVE COMMITTED` to match the actual commit state. This is a documentation wording fix only.

**Severity:** P2 — non-blocking. The corrective-1 document's body text is correct (P1-1 rejected, tenancy model declared, cross-org test classified). The terminal summary is a minor inconsistency that does not affect production code or security boundaries.

## P. Merge recommendation

```
MERGE RECOMMENDATION:
APPROVE
```

### Approval criteria checklist

| # | Criterion | Status |
|---|-----------|:------:|
| 1 | PR HEAD includes corrective commit 512f5bb | ✅ |
| 2 | Worktree clean | ✅ |
| 3 | Commit series reviewable | ✅ |
| 4 | PR scope pure M10-A | ✅ |
| 5 | Single-tenant authority consistent | ✅ |
| 6 | Invalid multi-tenant P1 rejected | ✅ |
| 7 | All 10 Candidate routes reconciled | ✅ (10/10) |
| 8 | Candidate requireRole = 0 | ✅ |
| 9 | Total requireRole = 34 | ✅ |
| 10 | Candidate A/B isolation valid | ✅ |
| 11 | Same-tenant zero-write evidence valid | ✅ |
| 12 | runtimeAuthz exact | ✅ |
| 13 | Actual Fastify metadata matches registry | ✅ |
| 14 | No contradictory registry authority | ✅ |
| 15 | State/deadline semantics preserved | ✅ |
| 16 | Focused tests pass | ✅ |
| 17 | pnpm verify passes | ✅ |
| 18 | PR description accurate | ✅ |
| 19 | No unresolved P0 | ✅ |
| 20 | No unresolved P1 | ✅ |

### Final state

```
RBAC-M10-A-PR-INDEPENDENT-REVIEW-1:
APPROVE WITH NON-BLOCKING FINDINGS

PR base:
9cd20a839adb78f4f0b6253cfed6deafc97c3009

PR head:
512f5bba403c8c1a5bfda86dd3dab6347e6f71ce

Commits reviewed:
5

Corrective 512f5bb present:
YES

Worktree:
CLEAN

Scope purity:
PASS

Tenancy model:
SINGLE-TENANT

Routes reconciled:
10/10

Candidate requireRole:
0

Total requireRole:
34

Same-tenant ownership:
PASS

Zero unauthorized writes:
PASS

Registry/runtime conformance:
PASS

Focused mutations:
5/5 killed (proven in prior reviews, independently inspectable)

pnpm verify:
PASS

P0:
0

P1:
0

P2:
1 (P2-1: corrective-1 terminal summary stale — non-blocking documentation wording)

Merge recommendation:
APPROVE

M10-B:
AUTHORIZED AFTER MERGE
```

**Non-blocking finding:** P2-1 (corrective-1 terminal summary stale) — should be fixed before or after merge as a minor documentation correction. Does not block the PR.

**Authorization:** After merge, M10-B is authorized to rebase and plan under the single-tenant model.