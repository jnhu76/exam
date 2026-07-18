# EXAM-BOUNDARY-B-20260718-214337-ddbc808b

## A. Identity

```
RUN_ID:        EXAM-BOUNDARY-B-20260718-214337-ddbc808b
AGENT_SLOT:    B
TIMESTAMP:     2026-07-18 21:43:37
BRANCH:        feat/exam-audit-0718
HEAD:          ddbc808b9c640584ece7690dd8aef681739081a5
WORKTREE:      clean except docs/audits/ (new, this report) + pre-existing EXAM-BOUNDARY-A-*.md (Agent A, not read)
AUDIT SCOPE:   AUTHORIZATION, RESOURCE RELATIONSHIPS, UI/API CONSISTENCY, E2E, UNSUPPORTED-FEATURE CONTAINMENT
```

## B. Verdict

```
PARTIALLY SUPPORTED
```

The candidate-ownership boundary and the authentication/capability envelope are
rigorously enforced and browser-proven. However, **assigned-resource isolation
for Teacher / Proctor / Grader is NOT implemented**: those roles receive
organization-wide access wherever their role preset grants a capability. No
`Teacher@course`, `Proctor@exam`, or `Grader@exam` assignment mechanism exists
in schema or runtime. The product does not claim same-org resource isolation
(capability-only is the documented Phase 3 stance), so this is classified as
`PRODUCT DECISION REQUIRED` rather than a vulnerability — but it is the single
largest open authorization question and must be resolved before any multi-user
deployment with multiple Teachers/Proctors/Graders operating on overlapping
org data.

## C. Executive boundary map

```
PROVEN SUPPORTED:
  - Authentication (JWT cookie, inactive-user 401) — SOURCE + TEST proven
  - Candidate ownership chain (user->candidate->enrollment->exam->attempt->answer->score) — SOURCE + TEST + BROWSER proven
  - Unauthenticated -> 401 on all protected routes — TEST proven
  - Candidate denied on Admin APIs (403) — TEST proven
  - Teacher/Proctor/Grader denied on Admin-only lifecycle/destroy/export routes (403) — TEST proven
  - Rejected mutations leave resource + audit state unchanged (zero-write) — TEST proven
  - Anti-enumeration: cross-candidate probe -> 404 (not 403) — TEST proven
  - Org-anchor enforcement on scoped routes (attempt/exam resolvers) — SOURCE + TEST proven
  - Subjective (text_response) plain-text journey end-to-end (browser E2E) — BROWSER proven
  - No rich-text/markdown/image/attachment UI implies unsupported features — SOURCE proven

PARTIALLY SUPPORTED:
  - Teacher/Proctor/Grader capability gating (flat preset only; no resource assignment) — SOURCE proven
  - Proctor exam discovery (all org proctorable exams, not assigned) — SOURCE proven

NOT SUPPORTED:
  - Assigned-resource scoping (Teacher@course / Proctor@exam / Grader@exam) — SOURCE proven (no schema/table/handler)
  - Rich text / images / tables / formulas / attachments / markdown in questions or answers — SOURCE proven

PRODUCT DECISION REQUIRED:
  - Whether Teacher/Proctor/Grader must be confined to assigned resources (currently org-wide)
  - Whether Phase 1 single-tenant basic product closure accepts org-wide Teacher/Proctor/Grader access

BLOCKED:
  - None blocking basic product closure beyond the decision above
```

## D. Capability matrix (Agent B workstream)

### D1. Route + role inventory (B1)

| Method | Route | UI entry | Capability (runtime) | Resource scope | State guard | Status |
| ------ | ----- | -------- | -------------------- | -------------- | ----------- | ------ |
| POST | /api/auth/login | Login page | public | - | - | ✓ |
| GET | /api/auth/me | App shell | self | - | - | ✓ |
| GET | /api/courses | Admin course list | CourseView (flat) | org | none | CAPABILITY-ONLY |
| POST | /api/courses | Admin course create | CourseCreate (flat) | org | none | CAPABILITY-ONLY |
| PATCH/DELETE | /api/courses/:id | Admin course edit | CourseUpdate/Delete (flat) | org | none | CAPABILITY-ONLY |
| GET | /api/questions | Admin Q list | QuestionView (flat) | org | none | CAPABILITY-ONLY |
| POST/PATCH/DELETE | /api/questions* | Admin Q edit | Question* (flat) | org | none | CAPABILITY-ONLY |
| GET/POST/PATCH/DELETE | /api/exams* | Admin exam lifecycle | Exam* (flat) | org | state machine in handler | CAPABILITY-ONLY |
| GET | /api/exams/:id/scores | Admin score list | ScoreAllView (flat) | org | none | CAPABILITY-ONLY |
| GET | /api/exams/:id/export/scores | Admin score export | ScoreExport (flat) | org | none | CAPABILITY-ONLY |
| GET | /api/admin/proctor/exams | Proctor landing | ExamRoomView (flat) | org | none | CAPABILITY-ONLY |
| GET | /api/admin/exams/:examId/proctor/attempts | Proctor monitor | ExamRoomView + exam resolver (org) | org | none | SCOPED-ORG-ONLY |
| GET | /api/admin/attempts/:attemptId/proctor-events | Proctor timeline | AttemptTimelineView + attempt resolver (org) | org | none | SCOPED-ORG-ONLY |
| POST | /api/admin/attempts/:attemptId/proctor-incident | Proctor incident | AttemptMisconductMark + attempt resolver (org) | org | none | SCOPED-ORG-ONLY |
| GET | /api/admin/grading-queue | Grader queue | GradingQueueView (flat) | org | none | CAPABILITY-ONLY |
| GET | /api/admin/attempts/:attemptId/grading-details | Grader detail | GradingDetailView + attempt resolver (org) | org | none | SCOPED-ORG-ONLY |
| POST | /api/admin/attempts/:attemptId/grade-question | Grader score | GradingScoreWrite + attempt resolver (org) | org | none | SCOPED-ORG-ONLY |
| GET/POST/PATCH/DELETE | /api/admin/attempts* (misconduct/force-submit/extend/export/timeline) | Admin attempt ops | Attempt* (flat or attempt-resolver org) | org | none | CAPABILITY-ONLY / SCOPED-ORG-ONLY |
| GET | /api/candidate/exams | Candidate landing | ExamTake (candidate_context, preset) | own | enrollment check | COMPLETE (preset + handler scope) |
| GET | /api/candidate/exams/:examId | Candidate exam detail | ExamTake + exam eligibility resolver | own | enrollment check | COMPLETE |
| POST | /api/attempts/:examId/start | Candidate start | AttemptStart + exam eligibility resolver | own | enrollment/state | COMPLETE |
| GET | /api/attempts/:id | Candidate attempt view | AttemptViewOwn + own_attempt resolver | own | ownership | COMPLETE |
| POST | /api/attempts/:attemptId/answers/:questionId | Candidate save | AttemptAnswerSave + own_attempt resolver | own | ownership | COMPLETE |
| POST | /api/attempts/:attemptId/submit | Candidate submit | AttemptSubmit + own_attempt resolver | own | ownership/state | COMPLETE |
| POST | /api/attempts/:attemptId/heartbeat | Candidate heartbeat | AttemptHeartbeatSend + own_attempt resolver | own | ownership | COMPLETE |
| POST | /api/attempts/:attemptId/restore | Candidate restore | AttemptRestore + own_attempt resolver | own | ownership | COMPLETE |
| GET | /api/scores/attempts/:attemptId | Score view | ScoreOwnView/ScoreAllView + score resolver (ownership arbitration) | own/all | ownership | COMPLETE |
| GET/POST/PATCH/DELETE | /api/users* | Admin user mgmt | legacy requireRole(["Admin"]) | org | none | LEGACY-ROLE-ONLY |
| GET/POST/PATCH/DELETE | /api/role-assignments* | Admin role assign | legacy requireRole(["Admin"]) | org | none | LEGACY-ROLE-ONLY |
| GET/POST/PATCH/DELETE | /api/candidates* | Admin candidate mgmt | mixed requireRole(["Admin"]) / requireCapability | org | none | LEGACY-ROLE-ONLY / CAPABILITY-ONLY |
| GET/POST/PATCH/DELETE | /api/candidate-fields* | Admin cf mgmt | requireRole(["Admin"]) | org | none | LEGACY-ROLE-ONLY |
| GET | /api/admin/audit-logs | Admin audit | requireRole(["Admin"]) | org | none | LEGACY-ROLE-ONLY |
| GET | /api/admin/settings | Admin settings | requireRole(["Admin"]) | org | none | LEGACY-ROLE-ONLY |
| GET | /api/system/health, /dashboard, /diagnostics | Admin/diag | requireRole(["Admin"]) / requireCapability | sys/org | none | LEGACY-ROLE-ONLY / CAPABILITY-ONLY |

Runtime gate inventory (grep of apps/api/src/routes, non-test):
- `requireRole(["Admin"])` legacy: candidateField(5), audit, system, settings, importLogs, roleAssignments(5), user(5), candidate(4), email — i.e. user/role/candidate-field/audit/settings/email still legacy.
- `requireCapability(Permission.X)` flat: course, question, exam, scores(list), export, attempts.admin, gradingQueue(list), proctorMonitoring(list).
- `requireScopedCapability` (org-anchor only, no assignment): proctorMonitoring(3), gradingQueue(2).
- `requireCandidateContext / requireExamEligibility / requireOwnAttempt / requireScoreCapability`: candidate runtime (ownership-enforced).

### D2. Role-boundary matrix (B2)

Tested behavior (TEST-PROVEN via permissionBoundary.test.ts, candidateOwnership.test.ts, proctorMonitoring.crossOrg.test.ts, routeRegistryConformance.test.ts):

| Family | Unauth | Candidate | Teacher | Proctor | Grader | Admin |
| ------ | ------ | --------- | ------- | ------- | ------ | ----- |
| auth/me | n/a (self) | 200 | 200 | 200 | 200 | 200 |
| courses | 401 | 403 | 200 (org-wide) | 403 | 403 | 200 |
| questions | 401 | 403 | 200 (org-wide) | 403 | 403 | 200 |
| exam lifecycle (view) | 401 | 403 | 200 (org-wide) | 403 | 403 | 200 |
| exam lifecycle (publish/close/result) | 401 | 403 | 200 (org-wide) | 403 | 403 | 200 |
| exam destroy/extend/cancel/archive/delete | 401 | 403 | 403 | 403 | 403 | 200 |
| score export | 401 | 403(own only) | 403 | 403 | 403 | 200 |
| proctor/exams (discovery) | 401 | 403 | 403 | 200 (org-wide) | 403 | 200 |
| proctor/attempts (scoped) | 401 | 403 | 403 | 200 (org-anchor) | 403 | 200 |
| grading-queue | 401 | 403 | 403 | 403 | 200 (org-wide) | 200 |
| grading-details (scoped) | 401 | 403 | 403 | 403 | 200 (org-anchor) | 200 |
| candidate/exams | 401 | 200 (own enrolled) | 403 | 403 | 403 | (not routed) |
| candidate/attempts (own) | 401 | 200 (own only, 404 cross) | 403 | 403 | 403 | (not routed) |
| scores/attempts/:id | 401 | 200 (own only, 404 cross) | 403 | 403 | 403 | 200 (all) |
| users / role-assignments | 401 | 403 | 403 | 403 | 403 | 200 |

### D3. Capability vs resource relationship (B3)

- **Candidate**: ownership chains fully enforced. `requireOwnAttempt` resolves
  attempt→exam→course→org and compares `candidateProfiles.userId === ctx.actorId`;
  cross-owner returns 404 (anti-enumeration). `requireExamEligibility` resolves
  exam + candidate enrollment server-side. SOURCE + TEST proven.
- **Teacher**: preset grants Course/Question/Exam authoring + ExamPublish/Close/
  ResultPublish + ScoreAllView, all enforced as **organization-wide** flat
  capability. No `Teacher@course` assignment exists in schema or runtime.
- **Proctor**: preset grants ExamRoomView + attempt monitoring/misconduct/extend/
  force-submit, enforced as **organization-wide** flat (or org-anchor scoped)
  capability. No `Proctor@exam` assignment exists.
- **Grader**: preset grants GradingQueue/Detail/Answer/ScoreWrite, enforced as
  **organization-wide** flat (or org-anchor scoped) capability. No `Grader@exam`
  assignment exists. `GradingFinalize` and `GradingIdentityView` are intentionally
  omitted from the default Grader preset (presets.ts:163-165).
- **User-to-role assignment** (`roleAssignments` routes) exists; **actor-to-resource
  assignment** does NOT exist anywhere.

### D4. Authorization formula audit (B4)

| Route class | Auth | Capability | Resource relationship | State invariant | Classification |
| ----------- | ---- | ---------- | --------------------- | --------------- | -------------- |
| candidate/* (own) | ✓ | ✓ | ✓ (userId match) | ✓ (enrollment/state) | COMPLETE |
| scores/attempts/:id | ✓ | ✓ | ✓ (ownership arbitration) | n/a | COMPLETE |
| exam lifecycle (Admin) | ✓ | ✓ | org-wide (by design) | ✓ (state machine) | CAPABILITY-ONLY (org scope) |
| proctor/grading scoped | ✓ | ✓ | org-anchor only (no assignment) | n/a | RELATIONSHIP-MISSING (by design) |
| proctor/exams discovery, grading-queue | ✓ | ✓ | org-wide (no assignment) | n/a | CAPABILITY-ONLY |
| user/role/candidateField/audit/settings/email | ✓ | legacy role | org-wide | n/a | LEGACY-ROLE-ONLY |

Resource-relationship absence is classified `PRODUCT DECISION REQUIRED`, not
`VULNERABILITY`, because (a) the presets explicitly document capability-only as
the Phase 3 default grant pending scoped assignment (presets.ts:5-15), (b) Phase 1
is single-tenant with a single organization and the AGENTS.md roadmap explicitly
defers Teacher/Proctor/Grader role bundles to Phase 3, and (c) no UI or doc
claims assigned-resource isolation. The risk becomes real only when multiple
Teachers/Proctors/Graders operate on overlapping org data within one deployment.

## E. Findings

### P0
None.

### P1

**F-B1-P1 — Teacher/Proctor/Grader access is organization-wide; no assigned-resource confinement.**
- SEVERITY: P1 (core supported journey / authorization boundary not product-complete; not an active exploit because no assignment model exists)
- PRODUCT IMPACT: In a multi-stakeholder deployment, any Teacher can view/edit/publish ALL org courses, exams, and scores; any Proctor can monitor ALL org exams; any Grader can grade ALL org attempts. Candidate data isolation is unaffected (separate ownership chain).
- PRECONDITION: Role preset grants the capability (true for the listed presets); single org (Phase 1).
- REPRODUCTION: Create a Teacher user; call `GET /api/exams` or `POST /api/exams/:id/publish` with the teacher token → 200. No course/exam assignment row is consulted.
- EXPECTED (per ADR "scoped: narrowed by course assignment" comments): confined to assigned resources.
- ACTUAL: org-wide grant. The presets.ts comments ("⚠️ scoped ... narrowed by course assignment") describe unimplemented intent.
- SOURCE EVIDENCE: `packages/authz/src/presets.ts:122-142` (Teacher perms, no resolver), `apps/api/src/routes/exam.ts:332` (`requireCapability(ExamView)` flat), `packages/db/src/schema.ts` (no resource-assignment table), `apps/api/src/authz/resolvers/*` (only attempt/exam org-anchor resolvers, no assignment).
- TEST/BROWSER EVIDENCE: permissionBoundary.test.ts proves 403 on Admin-only routes but does NOT test same-org resource isolation for Teacher/Proctor/Grader (no such test can pass because no assignment exists).
- DATABASE/AUDIT EVIDENCE: No `teacher_course` / `proctor_exam` / `grader_exam` table; `user_role_assignments` carries only `(userId, role)` — no resourceId.
- CONFIDENCE: HIGH (source-proven).
- RECOMMENDED DISPOSITION: PRODUCT DECISION REQUIRED — either (a) accept org-wide access as the Phase 1/3 model and remove the misleading "scoped" comments, or (b) implement actor-to-resource assignment + resolver before enabling multi-stakeholder deployments.

### P2

**F-B2-P2 — Legacy `requireRole(["Admin"])` gates remain on sensitive surfaces (users, role-assignments, candidate-fields, audit, settings, email).**
- SEVERITY: P2 (maintainability / migration-completeness; not a security gap since Admin-only is correct, but inconsistent with the RBAC-M10 migration and blocks per-capability audit of these surfaces).
- PRODUCT IMPACT: These routes cannot be granted to a non-Admin capability holder (e.g. a delegated settings editor) and are not covered by the routeRegistry conformance test (which targets M10-B migrated routes).
- SOURCE EVIDENCE: `apps/api/src/routes/user.ts:63` etc.; `roleAssignments.ts:41` explicitly notes "gates still use legacy requireRole — enforcement is PR #3".
- CONFIDENCE: HIGH.
- RECOMMENDED DISPOSITION: CAN DEFER (Phase 3/4 migration debt) but document as known.

**F-B3-P2 — RouteRegistry is metadata-only; enforcement drift is caught only for M10-B routes, not for the flat-capability Admin/Teacher/Proctor/Grader routes.**
- SEVERITY: P2 (test architecture gap).
- PRODUCT IMPACT: A handler that drops its `requireCapability` preHandler would not be caught by `routeRegistryConformance.test.ts` unless the route is in the M10-B set.
- SOURCE EVIDENCE: `apps/api/src/authz/routeRegistry.ts:9-16` ("This job does NOT enforce anything"); conformance test asserts registry metadata + onRoute authz kind only.
- CONFIDENCE: MEDIUM.
- RECOMMENDED DISPOSITION: CAN DEFER (add capability-presence assertions for all registered routes).

### P3

**F-B4-P3 — `proctorMonitoring.crossOrg.test.ts` "cross-org" naming may imply same-org resource isolation testing that does not exist.**
- SEVERITY: P3 (clarity). The tests verify org-anchor denial (different org) and registry entry existence. Since Phase 1 is single-tenant, "cross-org" is largely moot; the tests do NOT establish same-org Proctor→exam assignment isolation (which is unimplemented).
- CONFIDENCE: HIGH.
- RECOMMENDED DISPOSITION: Clarify test intent in docstring (already partially done at lines 65-72).

**F-B5-P3 — No UI path asserts or documents that Teacher/Proctor/Grader see org-wide data.**
- SEVERITY: P3 (clarity / potential user confusion). Landing pages for these roles list all org exams/attempts without indicating scope.
- CONFIDENCE: MEDIUM.

## F. Cross-boundary observations

```
CROSS-BOUNDARY-HANDOFF:
Suggested owner: Agent A
Reason: Subjective (text_response) capability classification is primarily Agent A's
        workstream (A3). Agent B confirmed the plain-text path exists end-to-end in
        the browser E2E (candidate-happy-path: text_response -> pending_manual) and
        that the input is a native <Textarea> (no rich text), but the definitive
        lifecycle/grading classification belongs to A3.
Evidence: apps/e2e/e2e/candidate-happy-path.spec.ts (text_response -> pending_manual
          journey); apps/web/src/components/exam/TextResponseInput.tsx (plain
          textarea, comment "no dangerouslySetInnerHTML").

CROSS-BOUNDARY-HANDOFF:
Suggested owner: Agent A
Reason: Question-type inventory (A1) — the actual supported types in this codebase
        are single_choice / multiple_choice / true_false / fill_blank / text_response
        (NOT "short answer"/"essay" as separate enums). Agent B observed the
        contracts/schema use `text_response` for subjective. A1 should confirm the
        canonical enum set.
Evidence: apps/web/src/components/question/QuestionForm.tsx:62 (type union),
          packages/contracts/src/question.ts.
```

## G. Test-quality assessment

```
STRONG TESTS:
  - candidateOwnership.test.ts (794 lines, 90 passing in suite run): real cross-candidate
    attack matrix across read/answer/submit/restore/heartbeat/score; asserts 404 (not
    403) for cross-owner; genuine negative coverage. BROWSER+DB proven.
  - permissionBoundary.test.ts: asserts 401 (unauth), 403 (candidate on admin), 403
    (Teacher/Proctor/Grader on 7 Admin-only M10-B routes), and ZERO-WRITE (rejected
    mutations leave resource + audit unchanged). Strong.
  - proctorMonitoring.crossOrg.test.ts + routeRegistryConformance.test.ts: registry
    metadata + onRoute authz-kind capture; mutation-B-killed guarantee for scoped gates.
  - E2E candidate-happy-path.spec.ts: real browser journey (objective + text_response).

WEAK TESTS:
  - permissionBoundary "Teacher/Proctor/Grader denied" only exercises routes where the
    preset already lacks the capability. It therefore cannot and does not prove
    same-org resource isolation — there is no test that a Teacher CANNOT access a
    course/exam they did not create, because no such boundary exists. This is a coverage
    gap, not a false-green (it correctly asserts the 403s it claims).

VACUOUS TESTS:
  - routeRegistryConformance (subset): asserts registry entries exist + sensitive flag.
    This is metadata validation, not behavior. Acceptable as a drift guard but does not
    prove enforcement. Not vacuous in intent (it feeds the mutation test) but weak alone.
  - No test was found that counts arrays without assertions, early-returns on missing
    fixture, or filters out forbidden handlers. The route inventory capture
    (proctorMonitoring.crossOrg.test.ts:37-63) includes ALL onRoute handlers, not a
    filtered subset, so it is not masking forbidden routes.

MISSING NEGATIVE CONTROLS:
  - No test proving a Teacher cannot see another Teacher's course/exam (no assignment model).
  - No test proving a Proctor cannot monitor an exam they are not assigned to.
  - No test proving a Grader cannot grade an attempt outside their scope.
  - (All three are moot until an assignment mechanism exists — see F-B1-P1.)
```

## H. Evidence executed

1. **Baseline / structure inspection** (SOURCE)
   - `cat package.json pnpm-workspace.yaml turbo.json`, `ls .github/workflows docs`
   - Proves: pnpm workspace, turbo, vitest + Playwright e2e, three-DB strategy.

2. **Authz source review** (SOURCE)
   - `packages/authz/src/catalog.ts`, `presets.ts`, `resolver.ts`
   - `apps/api/src/plugins/auth.ts`, `authz.ts`
   - `apps/api/src/authz/scopedCapability.ts`, `scoreCapability.ts`
   - `apps/api/src/authz/resolvers/{attempt,exam,ownAttempt,score}Resolver.ts`
   - Proves: capability = flat role-preset check; scoped resolvers do org-anchor +
     ownership only; no resource-assignment resolver exists.

3. **Route gate grep** (SOURCE)
   - `grep requireRole/requireCapability/requireScopedCapability/... apps/api/src/routes`
   - Proves: flat-capability on admin/teacher/proctor/grader list+detail; scoped only on
     5 proctor/grading routes; candidate runtime fully ownership-scoped; legacy role gates
     on user/role/candidate-field/audit/settings/email.

4. **Test run — unit/integration** (TEST-PROVEN)
   - `cd apps/api && TEST_DB_ISOLATION=worker-database APP_MODE=test TEST_DATABASE_URL="postgresql://exam:exam@localhost:15432/exam_test" npx vitest run src/routes/candidateOwnership.test.ts src/authz/routeRegistryConformance.test.ts`
   - Result: 2 files, 90 tests PASSED, 13.08s.
   - Proves: candidate ownership, registry conformance.

5. **Test run — proctor/permission** (TEST-PROVEN)
   - `... npx vitest run src/routes/proctorMonitoring.crossOrg.test.ts src/routes/permissionBoundary.test.ts src/routes/proctorMonitoring.test.ts`
   - Result: 3 files, 65 tests PASSED, 16.93s.
   - Proves: unauth 401, candidate 403, Teacher/Proctor/Grader 403 on Admin-only routes,
     zero-write, org-anchor scoped gates active.

6. **Browser E2E — candidate happy path** (BROWSER-PROVEN)
   - `bash scripts/e2e/run-wsl.sh candidate-happy-path` (uses exam_e2e_w0/w1, API :3100/:3101)
   - Result: shard 1/2 PASS, shard 2/2 PASS; HTML report at apps/e2e/playwright-report.
   - Proves: real browser login → list → start → answer objective → autosave → submit →
     graded result (100), and text_response → pending_manual. Candidate journey complete
     end-to-end with no backend defect.
   - What it does NOT prove: Teacher/Proctor/Grader resource isolation (no such path in
     the happy-path spec, and no assignment model to exercise).

7. **Unsupported-feature containment** (SOURCE)
   - `grep -rln contenteditable|Tiptap|TinyMCE|Quill|CodeMirror|monaco|dangerouslySetInnerHTML apps/web/src`
   - Result: no rich-text editor library; only `TextResponseInput.tsx` matched, but that
     match was the comment "no dangerouslySetInnerHTML" — the file uses a pure React
     `<Textarea>`. No unsafe HTML rendering of candidate input found.
   - Proves: product does not mislead with rich text; subjective input is plain text.

## I. Recommended closure plan

```
MUST FIX BEFORE BASIC PRODUCT CLOSURE:
  - Resolve F-B1-P1 decision: explicitly document (or implement) the
    Teacher/Proctor/Grader resource-scope model. If org-wide is the intended Phase 1/3
    model, REMOVE the misleading "scoped: narrowed by course assignment" comments in
    presets.ts so the code does not imply unimplemented behavior.

CAN DEFER:
  - F-B2-P2 (legacy requireRole on user/role/candidate-field/audit/settings/email) —
    correct Admin-only semantics, migration debt only.
  - F-B3-P2 (conformance test covers M10-B only) — extend capability-presence assertions
    to all registered routes.
  - F-B4-P3 / F-B5-P3 (test naming clarity, UI scope indicator).

REQUIRES PRODUCT DECISION:
  - Assigned-resource isolation (Teacher@course / Proctor@exam / Grader@exam) scope and
    timeline. Blocks safe multi-stakeholder deployment but not single-admin Phase 1.

RICH-TEXT FOLLOW-UP:
  - None required: product clearly supports only plain-text subjective (text_response).
    No rich-text editor, no misleading UI. If rich text is later desired, it is a new
    feature (Phase 2+ per AGENTS.md), not a defect.

RESOURCE-AUTHORIZATION FOLLOW-UP:
  - Implement actor-to-resource assignment tables + resolvers (Teacher@course,
    Proctor@exam, Grader@exam) and flip the flat-capability routes to
    requireScopedCapability once the product decision above lands.
```

## J. Final machine-readable summary

```
RUN_ID=EXAM-BOUNDARY-B-20260718-214337-ddbc808b
AGENT_SLOT=B
P0=0
P1=1
P2=2
P3=2
PROVEN_SUPPORTED=candidate-ownership-chain,authentication,unauth-401,candidate-denied-admin,teacher-proctor-grader-denied-admin-only,zero-write-mutations,anti-enumeration-404,org-anchor-scoped-routes,subjective-plaintext-e2e,no-richtext-misleading-ui
PARTIAL=teacher-proctor-grader-capability-gating,proctor-exam-discovery
UNSUPPORTED=assigned-resource-scoping(rich-text,images,tables,formulas,attachments,markdown)
DECISIONS_REQUIRED=teacher-proctor-grader-resource-isolation-model
BASIC_PRODUCT_CLOSURE=CONDITIONAL
```

---

```
EXAM-BOUNDARY-B-20260718-214337-ddbc808b: COMPLETE
```
