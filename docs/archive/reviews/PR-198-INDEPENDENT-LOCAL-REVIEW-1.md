# PR #198 Independent Local Review

PR-198-INDEPENDENT-LOCAL-REVIEW-1

## A. Verdict

REQUEST CHANGES

MERGE RECOMMENDATION: NO

## B. Baseline

```
BASE:            e7af792815e8cf4bcff122a3d1d8db500b9d6eff (master)
HEAD:            095af77543861d6ec007fb0636bf574966a08c39
MERGE BASE:      e7af792815e8cf4bcff122a3d1d8db500b9d6eff
FILES CHANGED:   129
COMMITS:         8
WORKTREE:        /home/hoo/Source/exam-pr198-review
```

## C. Blocking findings

### FINDING-1

```
ID:              FINDING-1
SEVERITY:        P1
PATH:            docs/status/implementation-matrix.md:51
LINES:           51
CLAIM:           "Force-submit / extend-time / misconduct state actions ⬜ NOT IMPLEMENTED (deferred)."
VERIFIED FACT:   All three are fully implemented with routes, handlers, contracts, web UI
                 actions, dedicated test files, and permission-based authorization.

                 - Force-submit: POST /api/admin/attempts/:attemptId/force-submit
                   Route: apps/api/src/routes/attempts.admin.ts:125
                   Handler: same file, lines 145-265 (transactional submit+grade, idempotency)
                   Contract: packages/contracts/src/attempt.ts:352 (ForceSubmitRequestSchema)
                   Web: apps/web/src/pages/admin/ProctorDashboardPage.tsx:137-153
                   Tests: apps/api/src/routes/attempts/admin-force-submit.test.ts (500+ LOC)
                   Authz: requireCapability(Permission.AttemptForceSubmit) at line 129

                 - Extend-time: POST /api/admin/attempts/:attemptId/extend-time
                   Route: apps/api/src/routes/attempts.admin.ts:275
                   Handler: same file, lines 295-340 (row lock, deadline guard, transactional audit)
                   Contract: packages/contracts/src/attempt.ts:366 (ExtendTimeRequestSchema)
                   Web: apps/web/src/pages/admin/ProctorDashboardPage.tsx:157-180
                   Tests: apps/api/src/routes/attempts/admin-extend-time.test.ts
                   Authz: requireCapability(Permission.AttemptTimeExtend) at line 279

                 - Misconduct: POST /api/admin/attempts/:attemptId/misconduct
                   Route: apps/api/src/routes/attempts.admin.ts:61
                   Handler: same file, lines 80-113 (transactional flag + audit)
                   Contract: packages/contracts/src/attempt.ts:284 (FlagMisconductRequestSchema)
                   Web: apps/web/src/pages/admin/ProctorDashboardPage.tsx:183-197
                   Tests: apps/api/src/routes/attempts/admin-misconduct.test.ts
                   Authz: requireCapability(Permission.AttemptMisconductMark) at line 65

                 All three have route registry entries (routeRegistry.ts:422-449) and
                 proctor preset grants (presets-boundaries.test.ts:108-116).

IMPACT:          A current-authority document tells AI agents and maintainers these
                 capabilities are NOT IMPLEMENTED when they are fully in production.
                 Future agents relying on this matrix will conclude these features
                 do not exist and may re-implement, skip testing, or make incorrect
                 architectural decisions.

REQUIRED CORRECTION:
                 Change the matrix row from ⬜ NOT IMPLEMENTED to ✅ IMPLEMENTED with
                 the correct evidence paths listed above.

VERIFICATION:    rg -c 'force-submit|forceSubmit|extend-time|extendTime|misconduct'
                   apps/api/src/routes/ apps/web/src/pages/ packages/contracts/src/
                 should return non-zero matches in all three locations.
```

### FINDING-2

```
ID:              FINDING-2
SEVERITY:        P1
PATH:            docs/roadmap/current.md:32
LINES:           32-34
CLAIM:           "Phase 3 — Collaboration, Permissions, Account Lifecycle. Not started.
                  Scoped roles, invitation, SMTP reset, fill-blank/subjective runtime,
                  WYSIWYG submit (ADR-008 Option D)."
VERIFIED FACT:   The scoped permissions / assignment-backed runtime authority system
                 (requireCapability, requireScopedCapability, requireOwnAttempt,
                 requireExamEligibility, loadAssignmentAuthority, user_role_assignments)
                 is fully implemented and active on every production route (91 total,
                 81 capability/ownership-gated). The implementation matrix itself
                 (line 61) acknowledges "Candidate/admin permission boundary ✅" with
                 evidence pointing to packages/authz and apps/api/src/authz/*. The
                 roadmap's own Phase 2 description (line 29) says "the candidate/admin
                 permission boundary are in place."

                 The Phase 3 label "Not started" is only accurate for: scoped role
                 bundles (Teacher/Proctor/Grader presets as product roles), invitation,
                 SMTP reset, fill-blank/subjective runtime, and WYSIWYG submit. The
                 authorization infrastructure is Phase 2-implemented but the roadmap
                 collapses it into "Phase 3 — Not started."

IMPACT:          Same class of risk as FINDING-1. AI agents reading "Phase 3 not started"
                 will not understand that the permission system already exists. The
                 distinction between "Phase 3 scoped role bundles not started" vs
                 "Phase 2 permission boundary implemented" is real but the document
                 does not make it.

REQUIRED CORRECTION:
                 Split the Phase 3 status line to distinguish:
                 - Authorization infrastructure: implemented in Phase 2 (requireCapability,
                   scoped gates, assignment authority, permission catalog)
                 - Scoped role bundles / product roles: not started (Teacher/Proctor/Grader)
                 - Account lifecycle: not started (invitation, SMTP reset)
                 - Fill-blank/subjective runtime: not started
                 - WYSIWYG submit: not started (ADR-008 Option D)

VERIFICATION:    The corrected text must not claim Phase 3 authorization capabilities
                 are unimplemented. Reference the Phase 2 row in the same document
                 (line 29) that already acknowledges the permission boundary.
```

### FINDING-3

```
ID:              FINDING-3
SEVERITY:        P1
PATH:            docs/CURRENT.md:20-21
LINES:           20, 21
CLAIM:           Lists `phase2-baseline.md` and `phase2-closeout-report.md` under
                  "Active Dev Documents (docs/dev/)"
VERIFIED FACT:   These files were moved to docs/evidence/ by this PR (R100 renames
                 in git diff). docs/dev/phase2-baseline.md and
                 docs/dev/phase2-closeout-report.md do NOT exist. They exist at
                 docs/evidence/phase2-baseline.md and
                 docs/evidence/phase2-closeout-report.md.

                 CURRENT.md is a current-authority navigation document. A developer
                 or AI agent following its "Active Dev Documents" table will hit
                 nonexistent paths.

IMPACT:          Active broken reference in a current-authority navigation document.
                 The README.md (canonical entry point) correctly lists evidence
                 files under docs/evidence/. CURRENT.md is inconsistent.

REQUIRED CORRECTION:
                 Either remove the two rows from the "Active Dev Documents" table
                 (since they are evidence, not dev docs), or move them to a separate
                 evidence reference section pointing to docs/evidence/.

VERIFICATION:    test -f docs/dev/phase2-baseline.md && echo EXISTS || echo MISSING
                 test -f docs/evidence/phase2-baseline.md && echo EXISTS || echo MISSING
```

### FINDING-4

```
ID:              FINDING-4
SEVERITY:        P1
PATH:            AGENTS.md:436
LINES:           436
CLAIM:           "Then: E2E re-enable for happy path / resume / submit-flush as blocking CI."
VERIFIED FACT:   The E2E workflow is fully enabled and both shards pass in CI (run
                 29836153916, both SUCCESS). The three named specs
                 (candidate-happy-path.spec.ts, resume-attempt.spec.ts,
                 submit-flush.spec.ts) are NOT skipped — they run and pass. The only
                 skipped E2E spec is fill-blank-e2e.spec.ts (Phase 3 pending, not
                 one of the three named blockers).

                 .github/workflows/ci.yml defines the e2e job without any disabling
                 condition. The job runs on every PR and is a required CI gate
                 (needs: static, fail-fast: true).

IMPACT:          AGENTS.md is the top-level agent instruction file. The "E2E re-enable"
                 claim is stale — the re-enable has already happened. An agent reading
                 this will treat E2E as a future blocker when it is in fact already
                 resolved and blocking.

                 Note: docs/status/project-simplification.md (lines 89-125) contains
                 a detailed "E2E status" section that acknowledges CI runs E2E but
                 claims the local run was skipped due to host port conflict. That
                 section is self-consistent but the AGENTS.md line is not.

REQUIRED CORRECTION:
                 Remove or update the "E2E re-enable" line in AGENTS.md to reflect
                 that E2E is already enabled and passing as blocking CI.

VERIFICATION:    gh pr checks 198 — both E2E shards should show SUCCESS.
```

## D. Non-blocking findings

### FINDING-5 (P2)

```
ID:              FINDING-5
SEVERITY:        P2
PATH:            docs/status/implementation-matrix.md:50
LINES:           50
CLAIM:           "Proctor monitoring (visibility + incident logging) 🟡 PARTIAL"
VERIFIED FACT:   Proctor monitoring is more complete than "partial (infra present but
                 gated / scope-limited)" suggests. The following are all implemented:
                 - Visibility: GET /admin/exams/:examId/proctor/attempts (scoped gate)
                 - Polling: Web polls GET /admin/exams/:examId/candidates/status every 5s
                 - Force-submit: POST /admin/attempts/:attemptId/force-submit
                 - Extend-time: POST /admin/attempts/:attemptId/extend-time
                 - Misconduct: POST /admin/attempts/:attemptId/misconduct +
                   POST /admin/attempts/:attemptId/proctor-incident
                 - Event timeline: GET /admin/attempts/:attemptId/proctor-events
                 - Incident logging: POST /admin/attempts/:attemptId/proctor-incident
                 - E2E: 3 specs (461 LOC) covering proctor landing, monitoring UI,
                   force-submit, extend-time, and misconduct end-to-end

IMPACT:          The matrix collapses seven implemented capabilities into one vague
                 "partial" row. This is misleading for the same reasons as FINDING-1.

REQUIRED CORRECTION:
                 Split the proctor monitoring row into individual capability rows
                 or at minimum change to ✅ with a note about what specifically
                 remains deferred.
```

### FINDING-6 (P2)

```
ID:              FINDING-6
SEVERITY:        P2
PATH:            docs/status/implementation-matrix.md:76
LINES:           76
CLAIM:           "Redis 🟡 Adapter, compose service, diagnostics ping exist.
                  No production business path uses Redis. Default disabled (ADR-001)."
VERIFIED FACT:   "Default disabled" is imprecise. The code-level behavior IS
                 connection-optional (plugin returns null if REDIS_URL absent).
                 But the default Docker Compose deployment ALWAYS injects
                 REDIS_URL=redis://redis:6379 and declares redis as an API
                 depends_on service. So in the default deployment, Redis IS
                 connected (not disabled). Only local dev without Compose runs
                 without Redis.

IMPACT:          An operator deploying via Docker Compose will see Redis connected
                 and may be confused by "default disabled."

REQUIRED CORRECTION:
                 Reword to distinguish code-level optional (no REDIS_URL → null)
                 from deployment-level default (Docker Compose always provides Redis).
                 Suggested: "Code-optional (no REDIS_URL → null). Docker Compose
                 default deploys Redis."
```

### FINDING-7 (P2)

```
ID:              FINDING-7
SEVERITY:        P2
PATH:            docs/archive/audit/exam-answer-closure-review.md.bak
LINES:           (entire file)
CLAIM:           Backup file preserved in archive.
VERIFIED FACT:   The .bak file is a backup of exam-answer-closure-review.md.
                 Both exist side-by-side in docs/archive/audit/. The .bak contains
                 no unique evidence — it is a pre-edit draft.

IMPACT:           Minor archive hygiene. Backup files in archive are noise.

REQUIRED CORRECTION:
                 Delete docs/archive/audit/exam-answer-closure-review.md.bak.
```

### FINDING-8 (P2)

```
ID:              FINDING-8
SEVERITY:        P2
PATH:            20 source-comment files (see F section)
LINES:           Various
CLAIM:           The wave1 link audit documents 11 stale source-comment paths.
VERIFIED FACT:   20 stale source-comment doc paths exist (the audit documented 11
                 at its time of writing; 9 additional stale paths were created by
                 this PR's document moves). All point to files that still exist but
                 were moved to docs/archive/. None point to deleted files.

IMPACT:          Source comments citing docs/phase3/rbac/*, docs/audit/*,
                 docs/phase3/emails/*, docs/dev/*, docs/frontend/* now point to
                 archive locations. The files still exist, so the citation is
                 traceable, but a developer following the path will land in archive
                 and may not realize the document is historical.

REQUIRED CORRECTION:
                 Update the 20 source-comment paths to their archive locations,
                 or add a comment-note that the referenced document is archived.
                 This is mechanical churn and could be deferred to a follow-up.
```

### FINDING-9 (P2)

```
ID:              FINDING-9
SEVERITY:        P2
PATH:            apps/api/src/authz/permissionMatrix.helpers.ts:97-112
LINES:           97-112
CLAIM:           Transport parsing branches (204 empty body, text/plain non-JSON,
                  JSON parse error) are covered by surviving tests.
VERIFIED FACT:   The deleted permissionMatrix.fixture.test.ts exercised three
                 transport-layer branches in the verdict() method:
                 1. response.body.length === 0 (204 handling) → sets body to undefined
                 2. content-type not application/json → skips JSON parse
                 3. response.json() throws → falls back to raw body

                 No surviving test exercises any of these three branches. The new
                 permissionMatrix.verdict.test.ts tests classifyCapabilityVerdict()
                 directly, bypassing the transport layer entirely. All surviving
                 matrix tests (exam, grading, proctor, question) register real
                 production routes that always return JSON, so they never touch
                 these branches.

                 Misclassification risk is LOW: all three branches feed into the
                 2xx "passed" path, so a regression would not cause a failed route
                 to appear authorized. The risk is purely transport-robustness
                 regression.

IMPACT:          Loss of negative-path transport parsing coverage. Not a security
                 risk but a robustness gap.

REQUIRED CORRECTION:
                 Restore a compact fixture transport test covering 204 and
                 text/plain. Do not restore the entire old file.

VERIFICATION:    rg -n 'response\.body\.length === 0|text/plain|response\.json\(\)'
                   apps/api/src/authz/ --type ts
                 should find zero surviving test coverage for these branches.
```

### FINDING-10 (P3)

```
ID:              FINDING-10
SEVERITY:        P3
PATH:            docs/status/project-simplification.md:89-125
LINES:           89-125
CLAIM:           E2E status section frames E2E as "NOT RUN — host port conflict"
                 and characterizes it as "an active declared blocker that is not
                 yet resolved."
VERIFIED FACT:   CI ran both E2E shards successfully. The local-only skip is
                 accurately described but the characterization of E2E as an
                 "active declared blocker" is stale (see FINDING-4).

IMPACT:          Confusing but not harmful — the section honestly explains why
                 local E2E was skipped. However, it should acknowledge CI ran E2E.

REQUIRED CORRECTION:
                 Add a sentence: "CI E2E (both shards) passed on this branch
                 (run 29836153916)."
```

## E. Current-authority accuracy

```
ROADMAP:                FACTUALLY WRONG — Phase 3 "Not started" is incorrect
                        for the authorization infrastructure (FINDING-2).
                        The E2E re-enable claim is stale (FINDING-4).

IMPLEMENTATION MATRIX:  FACTUALLY WRONG — force-submit/extend-time/misconduct
                        marked ⬜ NOT IMPLEMENTED but are fully implemented
                        (FINDING-1). Proctor monitoring ⬜/🟡 is understated
                        (FINDING-5). Redis "default disabled" is imprecise
                        (FINDING-6).

SIMPLIFICATION STATUS:  ACCURATE — Wave statuses, Gate 0.5 PENDING, forbidden
                        items all correctly stated.

M10-F STATUS:           ACCURATE — Invalidation notice present, PENDING, required
                        evidence file does not exist, all three current-authority
                        docs agree.

REDIS STATUS:           IMPRECISE — "Default disabled" is only true at code level,
                        not at Docker Compose deployment level (FINDING-6).

PHASE STATUS:           Phase 1 ✅, Phase 2 ✅ (correct). Phase 3 "Not started"
                        is misleading — should distinguish implemented infra
                        from deferred capabilities (FINDING-2). Phase 4 "Not
                        started" ✅.
```

## F. Documentation integrity

```
ACTIVE LINKS CHECKED:          11
ACTIVE BROKEN LINKS:           0 (zero broken active links)
ARCHIVE LINKS CHECKED:         47
ARCHIVE BROKEN LINKS:          4 (all pre-existing in deep archive files,
                                 not introduced by this PR)
STALE SOURCE COMMENTS:         20 (11 documented by author + 9 additional from
                                 this PR's moves; all point to files that
                                 exist in archive, not deleted)
BACKUP/DUPLICATE FILES:        1 (.bak file in docs/archive/audit/)
AUTHORITY PRECEDENCE:          Correctly stated in all new documents.
                               SPEC.md and phase-roadmap.md rank above
                               architecture/ and status/ docs.
```

## G. Test-deletion adjudication

```
PERMISSION MATRIX VERDICT:
  The new permissionMatrix.verdict.test.ts is a strict improvement over the
  deleted helpers test. It adds explicit 204, 409, malformed-body, and
  unregistered-route coverage. The "unexpected" classification branch is
  preserved. ACCEPT deletion of helpers test.

PERMISSION MATRIX FIXTURE TRANSPORT:
  Three transport-parsing branches (204 empty body, text/plain non-JSON,
  JSON parse catch) have NO surviving test coverage. Misclassification risk
  is low (all feed into 2xx "passed") but the coverage gap is real.
  VERDICT: P2 — FIXTURE TRANSPORT NEGATIVE COVERAGE LOST.
  Recommended: restore compact 204 + text/plain transport test.

LOGIN HTTP CLIENT:
  api.auth.test.ts imports the REAL production api module, calls real
  api.post() through MSW HTTP boundary, asserts method/content-type/body
  shape/response mapping/error mapping. It does NOT mock the function
  being tested, does NOT reimplement the request, and does NOT use a
  test-only endpoint constant. LoginPage.test.tsx still owns form behavior,
  loading state, error rendering, and navigation.
  VERDICT: ACCEPT deletion. New test is strictly better.

SUBMIT/GRADING ORCHESTRATOR:
  The deleted submitAndGradeAttempt.test.ts tested through HTTP inject()
  (not isolated orchestrator call). Every deleted assertion maps to a
  surviving test in candidate-save-submit.test.ts. The survivor is strictly
  stronger: it adds transaction rollback, audit failure, retry-grading,
  min-submit guards, deadline behavior, and ownership safety nets.
  VERDICT: FULLY SUBSUMED. ACCEPT deletion.

SANITIZE CLIENT EVENT:
  The deleted web test re-tested the @exam/contracts implementation.
  The web module is a pure re-export (export { ... } from "@exam/contracts").
  The canonical contracts package test is a strict superset.
  VERDICT: ACCEPT deletion. No coverage lost.
```

## H. Mechanical deletions

```
A2 (packages/exam-engine/src/types.ts):
  Three ambient declare function stubs. Zero consumers anywhere in apps/
  or packages/. Not in barrel exports, not in package.json exports, no
  deep imports. SAFE TO DELETE. Verified.

A7 (scripts/check-e2e-artifacts.mjs):
  ~153-line E2E artifact validation script. Zero references in CI
  (.github/), package.json, scripts/, Makefile, Dockerfile, or hooks.
  SAFE TO DELETE. Verified.

A8 (package.json seed:e2e):
  Alias for pnpm --filter @exam/api db:seed:e2e. Zero references outside
  root package.json. CI calls the underlying command directly.
  SAFE TO DELETE. Verified.

A18 (package.json verify:nodb-tests):
  turbo coverage with filter exclusions. Zero references anywhere in CI,
  scripts, Makefile, or docs. Completely dead.
  SAFE TO DELETE. Verified.
```

## I. CI / E2E

```
LOCAL E2E:
  NOT RUN — host port conflict (environmental, not a suite defect).
  The review worktree shares the host with the main worktree's
  long-running dev containers (exam-db-1 on 15432, exam-redis-1 on 6379).
  This is consistent with the author's stated reason.

CI E2E SHARD 1:
  PASS — run 29836153916, 3m38s

CI E2E SHARD 2:
  PASS — run 29836153916, 2m12s

FULL CI:
  All 8 checks PASS (static checks, build, package coverage, web coverage,
  API coverage, E2E shard 1, E2E shard 2, AI Code Review).

REQUIRED CHECKS:
  All terminal. No pending checks.
```

## J. Scope verification

```
PRODUCTION BEHAVIOR CHANGED:  NO — zero production TypeScript files modified.
                               (package.json lost two dead script aliases;
                                packages/exam-engine/src/types.ts was dead code)

AUTHZ CHANGED:                NO — packages/auth/src/rbac.ts untouched,
                               requirePermission untouched, routeRegistry
                               untouched, Type 3 tests untouched.

REDIS CHANGED:                NO — plugin, config, and Compose untouched.

DOCKER CHANGED:               NO — Dockerfile and compose files untouched.

ROUTE REGISTRY CHANGED:       NO — untouched.

TYPE 3 TESTS CHANGED:         NO — untouched.
```

## K. Verification personally reproduced

All commands run in the review worktree `/home/hoo/Source/exam-pr198-review`:

```
pnpm install --frozen-lockfile
  → PASS (no output)

pnpm format:check
  → PASS ("All matched files use Prettier code style!")

pnpm lint
  → PASS

pnpm typecheck
  → PASS (17 tasks, all cached)

pnpm lint:copy
  → PASS ("No hardcoded business copy found.")

pnpm lint:md
  → FAIL — 19 errors, all PRE-EXISTING:
    13 in docs/testing/test-system-contract.md (MD031/MD032/MD040/MD051)
    5 in README.md (MD034 bare URLs, MD040 missing language)
    1 in README.md (MD040)
    None introduced by this PR. test-system-contract.md was modified at
    base commit e7af792 (not by this PR). README.md last changed at
    b5e5b4d (outside this PR's diff range).

pnpm --filter @exam/api exec vitest run src/authz/permissionMatrix.verdict.test.ts
  → FAIL (review worktree env issue: resolveTestBranchUrl crashes because
    no DATABASE_URL is set for the review worktree's vitest global setup.
    NOT a code defect.)

pnpm --filter @exam/web exec vitest run src/lib/api.auth.test.ts src/pages/LoginPage.test.tsx
  → PASS — 2 files, 14 tests passed, 3.52s

pnpm --filter @exam/api exec vitest run src/routes/attempts/candidate-save-submit.test.ts
  → FAIL (same review worktree env issue as verdict test — DB config.
    NOT a code defect.)

pnpm --filter @exam/contracts test
  → PASS — 23 files, 402 tests passed, 1.41s

pnpm --filter @exam/exam-engine test
  → PASS (no output captured but exit code 0)

pnpm --filter @exam/web test
  → PASS — 94 files, 1169 tests passed, 59.09s

pnpm build
  → PASS (9 tasks)

Note: API tests requiring database connection could not run in the review
worktree (no DATABASE_URL configured for the separate worktree). This is an
environmental constraint of the review setup, not a PR defect. GitHub CI
ran the full API test suite (1501 passed) and both E2E shards successfully.
```

## L. Final disposition

REQUEST CHANGES

Four P1 findings require correction before merge:

1. **FINDING-1 (P1):** Implementation matrix marks force-submit/extend-time/misconduct as ⬜ NOT IMPLEMENTED when all three are fully in production.
2. **FINDING-2 (P1):** Roadmap says "Phase 3 — Not started" without distinguishing the authorization infrastructure (implemented in Phase 2) from deferred Phase 3 capabilities.
3. **FINDING-3 (P1):** CURRENT.md references `docs/dev/phase2-baseline.md` and `docs/dev/phase2-closeout-report.md` which were moved to `docs/evidence/` by this PR.
4. **FINDING-4 (P1):** AGENTS.md claims "E2E re-enable as blocking CI" when E2E is already enabled and passing in CI.

None of the P1 findings require code changes — all are documentation corrections. The PR's production code scope (dead-code deletions, test deduplication, two test restorations) is clean and verified. No production behavior, authz enforcement, Redis policy, Docker build, or route registry was modified.

---

## M. Mandatory review questions

```text
1. Does the roadmap incorrectly say Phase 3 has not started?
   YES — it says "Not started" without distinguishing the authorization
   infrastructure (implemented Phase 2) from deferred capabilities.
   → FINDING-2 (P1)

2. Does the implementation matrix incorrectly say force-submit,
   extend-time or misconduct actions are not implemented?
   YES — all three are fully implemented.
   → FINDING-1 (P1)

3. Are the proctoring status rows too pessimistic or internally inconsistent?
   YES — proctor monitoring marked 🟡 when visibility, polling, force-submit,
   extend-time, misconduct, event timeline, incident logging, and E2E are all
   implemented.
   → FINDING-5 (P2)

4. Is old M10-F evidence clearly invalidated everywhere it appears?
   YES — invalidation notice is present at the top of
   docs/evidence/RBAC-M10-F-FINAL-VERIFICATION-1.md. All three
   current-authority docs agree Gate 0.5 is PENDING. No document
   elsewhere still treats the old PASS as current.

5. Does the Redis status match runtime and Compose reality?
   PARTIALLY — "Default disabled" is true at code level (no REDIS_URL → null)
   but false at deployment level (Docker Compose always provides Redis).
   → FINDING-6 (P2)

6. Are all active documentation links valid after the 99-file move?
   YES — 0 active broken links out of 11 checked. 4 archive broken links
   are pre-existing in deep archive files.

7. Are the 11 stale source-comment paths acceptable, or do they mislead?
   MARGINALLY ACCEPTABLE — all 20 stale paths point to files that exist in
   archive (not deleted). However, an AI agent following them will land in
   archive and may not realize the document is historical.
   → FINDING-8 (P2)

8. Should any *.bak or duplicate evidence file be deleted instead of archived?
   YES — docs/archive/audit/exam-answer-closure-review.md.bak should be
   deleted (no unique evidence).
   → FINDING-7 (P2)

9. Did deleting permissionMatrix.fixture.test.ts remove unique 204/non-JSON
   response parsing coverage?
   YES — three transport-parsing branches have no surviving test. Risk is
   low (all feed into 2xx "passed") but the gap is real.
   → FINDING-9 (P2)

10. Does api.auth.test.ts exercise the real production API client?
    YES — imports real api module, calls real api.post() through MSW HTTP
    boundary, asserts method/content-type/body/response/error mapping.
    Does not mock the function being tested.

11. Is submitAndGradeAttempt.test.ts fully subsumed at the same semantic level?
    YES — the deleted file tested through HTTP inject (not isolated orchestrator).
    Every deleted assertion maps to a surviving test. The survivor adds
    transaction rollback, audit failure, and retry-grading coverage.
    Classification: FULLY SUBSUMED.

12. Did GitHub CI run both E2E shards, and did both pass?
    YES — run 29836153916, both SUCCESS.

13. Is "E2E re-enable" still an accurate next-work item?
    NO — E2E is already enabled, running, and passing as blocking CI.
    → FINDING-4 (P1)

14. Is 2ca3d687 genuinely the last fully verified tree?
    ACCEPTABLE — the diff between 2ca3d687 and HEAD (095af77) is 10 files,
    each changing exactly 1 line: the LAST VERIFIED REPOSITORY COMMIT SHA
    from a previous value to 2ca3d687. No substantive content changed.
    The documents clearly distinguish baseline system commit from last
    verified repository commit.

15. Is PR #198 independently mergeable without relying on the author report?
    NO — not in its current state. The implementation matrix contains
    factually incorrect capability status claims that would mislead future
    agents. The CURRENT.md has broken references. These must be corrected
    before merge.
```