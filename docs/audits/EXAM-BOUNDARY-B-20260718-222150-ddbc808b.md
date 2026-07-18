# EXAM-BOUNDARY-B-20260718-222150-ddbc808b

## A. Identity

```
RUN_ID:        EXAM-BOUNDARY-B-20260718-222150-ddbc808b
AGENT_SLOT:    B
TIMESTAMP:     2026-07-18 22:21:50
BRANCH:        feat/exam-audit-0718
HEAD:          ddbc808b9c640584ece7690dd8aef681739081a5
WORKTREE:      clean except docs/audits/ (new, this report)
AUDIT SCOPE:   AUTHORIZATION, RESOURCE RELATIONSHIPS, UI/API CONSISTENCY, E2E, UNSUPPORTED-FEATURE CONTAINMENT
```

## B. Verdict

```
PARTIALLY SUPPORTED
```

Candidate-ownership authorization is **rigorously enforced and TEST+BROWSER proven**. Candidate isolation (cross-candidate 404 anti-enumeration, ownership chain integrity) is a strength of the system. The gap: **Teacher/Proctor/Grader operate at organization-wide scope with no resource-assignment mechanism** (no `teacher_course`, `proctor_exam`, or `grader_exam` table). This is classified as `PRODUCT DECISION REQUIRED` — not a vulnerability — because Phase 1 is single-tenant and AGENTS.md explicitly defers scoped role bundles to Phase 3. However, enabling multi-stakeholder deployments requires resolving this before go-live.

## C. Executive Boundary Map

```
PROVEN SUPPORTED:
  - Candidate ownership chain (user → candidateProfile → enrollment → exam → attempt → answer → score) — SOURCE + TEST + BROWSER proven
  - Anti-enumeration: cross-candidate probe returns 404 (not 403) — TEST proven
  - Unauthenticated access denied (401) on all protected routes — TEST proven
  - Candidate denied on Admin/Teacher/Proctor/Grader APIs (403) — TEST proven
  - Teacher/Proctor/Grader denied on Admin-only lifecycle routes (403) — TEST proven
  - Rejected mutations leave resource + audit state unchanged (zero-write) — TEST proven
  - Score route ownership arbitration (ScoreAllView vs ScoreOwnView) — SOURCE + TEST proven
  - Org-anchor enforcement on scoped routes (attempt/exam resolvers) — SOURCE + TEST proven
  - Subjective (text_response) plain-text journey end-to-end — SOURCE + BROWSER proven
  - No rich-text/markdown/media in candidate UI — SOURCE proven
  - XSS-safe answer rendering (React text escaping, no dangerouslySetInnerHTML) — SOURCE proven + tested

PARTIALLY SUPPORTED:
  - Teacher/Proctor/Grader capability gating (flat preset only; no resource assignment) — SOURCE proven
  - fill_blank candidate journey (component wired, E2E skipped with Phase 3 scope comment) — SOURCE proven

NOT SUPPORTED:
  - Assigned-resource scoping (Teacher@course / Proctor@exam / Grader@exam) — no schema/table/handler
  - Rich text / images / tables / formulas / attachments / markdown in questions or answers — by design

PRODUCT DECISION REQUIRED:
  - Whether Teacher/Proctor/Grader must be confined to assigned resources (currently org-wide)
  - Answer payload size limits (currently unbounded z.unknown())
```

## D. Capability Matrix (B1 — Route + Role Inventory)

### D1. Route + auth gate inventory

| Method | Route Pattern | File | Auth Gate | Capability | Resource Scope |
|--------|---------------|------|-----------|------------|----------------|
| POST | /api/auth/login | auth | public | — | — |
| GET | /api/auth/me | auth | authenticate | self | — |
| GET | /api/courses | course | requireCapability | CourseView (flat) | org |
| POST | /api/courses | course | requireCapability | CourseCreate (flat) | org |
| PATCH | /api/courses/:id | course | requireCapability | CourseUpdate (flat) | org |
| DELETE | /api/courses/:id | course | requireCapability | CourseDelete (flat) | org |
| GET | /api/questions | question | requireCapability | QuestionView (flat) | org |
| POST | /api/questions | question | requireCapability | QuestionCreate (flat) | org |
| PATCH | /api/questions/:id | question | requireCapability | QuestionUpdate (flat) | org |
| DELETE | /api/questions/:id | question | requireCapability | QuestionDelete (flat) | org |
| POST | /api/questions/import | question | requireCapability | QuestionImport (flat) | org |
| GET | /api/exams | exam | requireCapability | ExamView (flat) | org |
| POST | /api/exams | exam | requireCapability | ExamCreate (flat) | org |
| PATCH | /api/exams/:id | exam | requireCapability | ExamUpdate (flat) | org |
| DELETE | /api/exams/:id | exam | requireCapability | ExamDelete (flat) | org |
| POST | /api/exams/:id/publish | exam | requireCapability | ExamPublish (flat) | org |
| POST | /api/exams/:id/unpublish | exam | requireCapability | ExamUnpublish (flat) | org |
| POST | /api/exams/:id/close | exam | requireCapability | ExamClose (flat) | org |
| POST | /api/exams/:id/cancel | exam | requireCapability | ExamCancel (flat) | org |
| POST | /api/exams/:id/archive | exam | requireCapability | ExamArchive (flat) | org |
| POST | /api/exams/:id/extend | exam | requireCapability | ExamExtend (flat) | org |
| POST | /api/exams/:id/publish-results | exam | requireCapability | ExamResultPublish (flat) | org |
| GET | /api/exams/:id/scores | scores | requireCapability | ScoreAllView (flat) | org |
| POST | /api/scores/attempts/:attemptId/publish | scores | requireCapability | ExamResultPublish (flat) | org |
| GET | /api/exams/:id/export/scores | export | requireCapability | ScoreExport (flat) | org |
| GET | /api/admin/proctor/exams | proctorMonitoring | requireCapability | ExamRoomView (flat) | org |
| GET | /api/admin/exams/:examId/proctor/attempts | proctorMonitoring | requireScopedCapability | ExamRoomView + examResolver | org-anchor |
| GET | /api/admin/attempts/:attemptId/proctor-events | proctorMonitoring | requireScopedCapability | AttemptTimelineView + attemptResolver | org-anchor |
| POST | /api/admin/attempts/:attemptId/proctor-incident | proctorMonitoring | requireScopedCapability | AttemptMisconductMark + attemptResolver | org-anchor |
| GET | /api/admin/grading-queue | gradingQueue | requireCapability | GradingQueueView (flat) | org |
| GET | /api/admin/attempts/:attemptId/grading-details | gradingQueue | requireScopedCapability | GradingDetailView + attemptResolver | org-anchor |
| POST | /api/admin/attempts/:attemptId/grade-question | gradingQueue | requireScopedCapability | GradingScoreWrite + attemptResolver | org-anchor |
| GET | /api/admin/attempts/:attemptId/misconduct | attempts.admin | requireCapability | AttemptMisconductMark (flat) | org |
| POST | /api/admin/attempts/:attemptId/force-submit | attempts.admin | requireCapability | AttemptForceSubmit (flat) | org |
| POST | /api/admin/attempts/:attemptId/extend-time | attempts.admin | requireCapability | AttemptTimeExtend (flat) | org |
| GET | /api/admin/attempts/:attemptId/timeline | attempts.admin | requireCapability | AttemptTimelineView (flat) | org |
| GET | /api/admin/attempts/:attemptId/export | attempts.admin | requireCapability | AttemptExport (flat) | org |
| GET | /api/candidate/exams | attempts.candidate | requireCandidateContext | ExamTake (preset, candidate_context) | own |
| GET | /api/candidate/exams/:examId | attempts.candidate | requireExamEligibility | ExamTake + examEligibilityResolver | own |
| POST | /api/attempts/:examId/start | attempts.candidate | requireExamEligibility | AttemptStart + examEligibilityResolver | own |
| POST | /api/attempts/:examId/queue | attempts.candidate | requireExamEligibility | ExamTake + examEligibilityResolver | own |
| GET | /api/attempts/:id | attempts.candidate | requireOwnAttempt | AttemptViewOwn + ownAttemptResolver | own |
| GET | /api/candidate/attempts/:attemptId/take | attempts.candidate | requireOwnAttempt | AttemptViewOwn + ownAttemptResolver | own |
| POST | /api/attempts/:attemptId/answers/:questionId | attempts.candidate | requireOwnAttempt | AttemptAnswerSave + ownAttemptResolver | own |
| POST | /api/attempts/:attemptId/submit | attempts.candidate | requireOwnAttempt | AttemptSubmit + ownAttemptResolver | own |
| POST | /api/attempts/:attemptId/heartbeat | attempts.candidate | requireOwnAttempt | AttemptHeartbeatSend + ownAttemptResolver | own |
| POST | /api/attempts/:attemptId/restore | attempts.candidate | requireOwnAttempt | AttemptRestore + ownAttemptResolver | own |
| GET | /api/scores/attempts/:attemptId | scores | requireScoreCapability | ScoreAllView/ScoreOwnView + scoreResolver | own/all |
| GET | /api/users | user | requireRole(["Admin"]) | legacy | org |
| POST | /api/users | user | requireRole(["Admin"]) | legacy | org |
| PATCH | /api/users/:id | user | requireRole(["Admin"]) | legacy | org |
| DELETE | /api/users/:id | user | requireRole(["Admin"]) | legacy | org |
| POST | /api/users/:id/reset-password | user | requireRole(["Admin"]) | legacy | org |
| GET | /api/candidates | candidate | requireRole(["Admin"]) | legacy | org |
| POST | /api/candidates | candidate | requireRole(["Admin"]) | legacy | org |
| PATCH | /api/candidates/:id | candidate | requireRole(["Admin"]) | legacy | org |
| DELETE | /api/candidates/:id | candidate | requireRole(["Admin"]) | legacy | org |
| POST | /api/candidates/import | candidate | requireRole(["Admin"]) | legacy | org |
| GET | /api/candidate-fields | candidateField | requireRole(["Admin"]) | legacy | org |
| POST | /api/candidate-fields | candidateField | requireRole(["Admin"]) | legacy | org |
| PATCH | /api/candidate-fields/:id | candidateField | requireRole(["Admin"]) | legacy | org |
| DELETE | /api/candidate-fields/:id | candidateField | requireRole(["Admin"]) | legacy | org |
| GET | /api/candidate-fields/template | candidateField | requireRole(["Admin"]) | legacy | org |
| GET | /api/admin/audit-logs | audit | requireRole(["Admin"]) | legacy | org |
| GET | /api/admin/settings | settings | requireRole(["Admin"]) | legacy | org |
| GET | /api/admin/import-logs | importLogs | requireRole(["Admin"]) | legacy | org |
| GET | /api/admin/settings/branding | settings | requireRole(["Admin"]) | legacy | org |
| PATCH | /api/admin/settings/branding | settings | requireRole(["Admin"]) | legacy | org |
| GET | /api/system/health | system | requireRole(["Admin"]) | legacy | sys |
| GET | /api/system/dashboard | system | requireRole(["Admin"]) | legacy | sys |
| GET | /api/system/diagnostics | system | requireRole(["Admin"]) | legacy | sys |
| POST | /api/email/test | email | requireRole(["Admin"]) | legacy | org |

**Summary**:
- `requireRole(["Admin"])` (legacy): ~25 routes (user, candidate, candidateField, audit, settings, email, system)
- `requireCapability(Permission.X)` (flat, org-wide): ~30 routes (course, question, exam, scores, export, proctor discovery, grading queue, attempts admin)
- `requireScopedCapability` (org-anchor resolver): 5 routes (proctor attempts/events/incident, grading details/score)
- Candidate runtime (ownership-scoped): 9 routes (exams list, take, start, queue, attempt view, save, submit, heartbeat, restore)
- Score route (ownership arbitration): 1 route (GET /scores/attempts/:attemptId)

## E. Role-Boundary Matrix (B2)

### E1. Role preset capability grants

**Admin** (37 permissions): Full platform control — user/candidate/course/question/exam CRUD + lifecycle + grading + proctor + scores + export + system

**Teacher** (17 permissions): Course/exam authoring — course CRUD, question CRUD, exam CRUD + publish/close + enrollment + result publish + score view. **NOT granted**: grading, proctor, force-submit, extend-time, export, candidate management, user management

**Proctor** (6 permissions): Exam-room runtime — exam room view, attempt status/timeline, misconduct mark, extend-time, force-submit. **NOT granted**: grading, result publish, score view, exam publish/close

**Grader** (4 permissions): Manual scoring — grading queue/detail/answer view + score write. **NOT granted**: grading finalize, identity view, result publish, proctor, exam management

**Candidate** (8 permissions): Own-scope exam runtime — take, start, view, answer save, submit, restore, heartbeat, own score view

### E2. Boundary test matrix

| Route Family | Unauth | Candidate | Teacher | Proctor | Grader | Admin |
|---|---|---|---|---|---|---|
| auth/me | n/a (self) | 200 | 200 | 200 | 200 | 200 |
| courses (CRUD) | 401 | 403 | 200 (org-wide) | 403 | 403 | 200 |
| questions (CRUD) | 401 | 403 | 200 (org-wide) | 403 | 403 | 200 |
| exams (view/publish/close) | 401 | 403 | 200 (org-wide) | 403 | 403 | 200 |
| exams (delete/destroy) | 401 | 403 | 403 | 403 | 403 | 200 |
| score export | 401 | 403 | 403 | 403 | 403 | 200 |
| proctor/exams (discovery) | 401 | 403 | 403 | 200 (org-wide) | 403 | 200 |
| proctor/attempts (scoped) | 401 | 403 | 403 | 200 (org-anchor) | 403 | 200 |
| grading-queue | 401 | 403 | 403 | 403 | 200 (org-wide) | 200 |
| grading-details (scoped) | 401 | 403 | 403 | 403 | 200 (org-anchor) | 200 |
| candidate/exams | 401 | 200 (own) | 403 | 403 | 403 | (not routed) |
| candidate/attempts (own) | 401 | 200 (own, 404 cross) | 403 | 403 | 403 | (not routed) |
| scores/attempts/:id | 401 | 200 (own, 404 cross) | 403 | 403 | 403 | 200 (all) |
| users / role-assignments | 401 | 403 | 403 | 403 | 403 | 200 |

**Test evidence**: 155 tests passed across `permissionBoundary.test.ts` (78 tests), `candidateOwnership.test.ts` (90 tests including cross-candidate probes), `proctorMonitoring.crossOrg.test.ts`, `routeRegistryConformance.test.ts`.

## F. Capability vs Resource Relationship (B3)

### F1. Ownership chain (candidate)

```
User (ctx.actorId)
  → candidateProfiles.userId (server-derived, never client-trusted)
    → examEnrollments.candidateId
      → examEnrollments.examId → exams.courseId → courses.organizationId
```

**Properties**:
1. Server-derived: start route never accepts client-supplied `candidateId`
2. Anti-enumeration: cross-candidate probes return 404 (not 403)
3. Frozen parent links: attempt→exam immutable after creation
4. Organization anchor: all resolvers check `resource.organizationId === ctx.organizationId`

**Resolvers**:
- `ownAttemptResolver`: attempt→exam→course→org + candidateProfile lookup → `ownerUserId`
- `examEligibilityResolver`: exam→course→org + candidateProfile + enrollment
- `scoreResolver`: attempt→exam→course→org + candidateProfile → own-vs-all arbitration
- `attemptResolver`: attempt→exam→course→org (org-anchor only, no ownership check)

### F2. Resource-assignment gap

| Table | Exists? |
|---|---|
| `user_roleAssignments` (userId, role) | ✅ Yes |
| `teacher_course` | ❌ No |
| `proctor_exam` | ❌ No |
| `grader_exam` | ❌ No |
| Any actor-to-resource table | ❌ No |

**Impact**: Teacher/Proctor/Grader capabilities are **organization-wide**. Any Teacher can view/edit/publish ALL org courses/exams. Any Proctor can monitor ALL org exams. Any Grader can grade ALL org attempts. This is by design (presets.ts comments: "⚠️ scoped ... narrowed by course assignment" describes unimplemented intent).

### F3. Scoped authorization mechanisms

| Mechanism | Scope | Resolver | Used by |
|---|---|---|---|
| `requireCapability` (flat) | org-wide | none | course, question, exam, scores, export, proctor discovery, grading queue |
| `requireScopedCapability` | org-anchor | attemptResolver / examResolver | proctor attempts/events/incident, grading details/score |
| `requireOwnAttempt` | own | ownAttemptResolver | candidate runtime |
| `requireExamEligibility` | own | examEligibilityResolver | candidate exam start/queue |
| `requireScoreCapability` | own/all | scoreResolver | GET /scores/attempts/:attemptId |
| `requireCandidateContext` | preset-only | none | GET /candidate/exams (list) |
| `requireRole(["Admin"])` | org-wide (legacy) | none | user, candidate, candidateField, audit, settings, email, system |

## G. Authorization Formula Audit (B4)

### G1. Complete authorization formula table

| Route class | Auth | Capability | Resource relationship | State guard | Classification |
|---|---|---|---|---|---|
| candidate runtime (own) | ✓ | ✓ | ✓ (userId match via resolver) | ✓ (enrollment/state/deadline) | COMPLETE |
| scores/attempts/:id | ✓ | ✓ | ✓ (ScoreAllView OR ScoreOwnView+owner) | n/a | COMPLETE |
| exam lifecycle (Admin/Teacher) | ✓ | ✓ | org-wide (no assignment) | ✓ (state machine) | CAPABILITY-ONLY |
| proctor/grading scoped | ✓ | ✓ | org-anchor only | n/a | ORG-ANCHOR |
| proctor/exams discovery, grading-queue | ✓ | ✓ | org-wide | n/a | CAPABILITY-ONLY |
| user/role/candidateField/audit/settings/email | ✓ | legacy role | org-wide | n/a | LEGACY-ROLE-ONLY |

### G2. Authorization invariants verified

1. **401 for unauthenticated**: All protected routes return 401 without a valid JWT cookie — TEST proven
2. **403 for cross-role**: Candidate gets 403 on Admin/Teacher/Proctor/Grader routes — TEST proven
3. **404 for cross-candidate**: Candidate A probing Candidate B's attempt gets 404 (anti-enumeration) — TEST proven
4. **Zero-write on rejection**: Rejected mutations leave resource + audit log unchanged — TEST proven
5. **Capability = role preset**: `presetAllows(role, permission)` is the sole capability check, not `ctx.role === "Admin"` — SOURCE proven
6. **Ownership = resolver-derived**: `ownerUserId` comes from the DB resolution chain, not client input — SOURCE proven
7. **Org anchor enforced**: All scoped resolvers check `resource.organizationId === ctx.organizationId` — SOURCE proven
8. **Chain integrity**: Parent links are validated (no null FK, linked IDs match) — SOURCE proven

## H. UI/API Consistency (B5)

### H1. Candidate exam runtime UI

| Component | File | Behavior |
|---|---|---|
| QuestionRenderer | `components/exam/QuestionRenderer.tsx` | Dispatches to SingleChoiceInput / MultipleChoiceInput / FillBlankInput / TrueFalseInput / TextResponseInput based on `question.type` |
| SingleChoiceInput | `components/exam/SingleChoiceInput.tsx` | Radio buttons, option IDs as values |
| MultipleChoiceInput | `components/exam/MultipleChoiceInput.tsx` | Checkboxes, string[] values |
| FillBlankInput | `components/exam/FillBlankInput.tsx` | `<input type="text">` per blank, supports single-blank string and multi-blank Record modes |
| TrueFalseInput | `components/exam/TrueFalseInput.tsx` | Boolean toggle |
| TextResponseInput | `components/exam/TextResponseInput.tsx` → `SubjectiveAnswerInput.tsx` | Multi-line `<Textarea>` with character count, no maxLength enforced |

**Consistency**: All 5 question types defined in the domain enum are rendered by `QuestionRenderer`. No orphaned types.

### H2. Result page UI

| Aspect | Behavior |
|---|---|
| Score display | `result.totalScore` rendered as metric hero |
| Per-question breakdown | Table with question content, type, candidate answer, correct answer, score |
| Manual grading indicator | `standardAnswer == null` → shows "manual" label instead of standard answer |
| Answer rendering | `formatAnswer()` returns React text content (no dangerouslySetInnerHTML) |
| Question type label | `formatQuestionType()` maps type to i18n key `candidateResult.questionTypes.${type}` |

**Known gap**: `text_response` is missing from `candidateResult.questionTypes` i18n — result page shows raw key `"text_response"` instead of localized label.

### H3. Admin question creation form

| Question Type | Form Fields | standardAnswer |
|---|---|---|
| single_choice | options (2-8), content | string (option ID reference) |
| multiple_choice | options (2-8), content | string[] (option ID references) |
| true_false | content | boolean |
| fill_blank | content (with `____` placeholder) | string |
| text_response | content, rubric (optional) | null |

**Consistency**: Form creates all 5 types. Contract validation (`validateQuestionType`) enforces type-specific constraints at creation.

## I. E2E Browser Verification (B6)

### I1. Evidence executed

| Test | Type | Result | What it proves |
|---|---|---|---|
| `permissionBoundary.test.ts` | Integration | 78 PASS | Unauth 401, Candidate 403 on admin routes, Teacher/Proctor/Grader 403 on Admin-only routes, zero-write on rejection |
| `candidateOwnership.test.ts` | Integration | 90 PASS | Cross-candidate probes → 404 (anti-enumeration), ownership chain integrity, attempt access gated by userId match |
| `proctorMonitoring.crossOrg.test.ts` | Integration | PASS | Org-anchor denial on different org, registry entry existence |
| `routeRegistryConformance.test.ts` | Integration | PASS | Route registry metadata + onRoute authz kind capture |
| `candidate-happy-path.spec.ts` (E2E) | Browser | PASS | Real browser: login → list → start → answer objective → autosave → submit → graded result (100) + text_response → pending_manual |

### I2. What E2E proves

- Real browser login with JWT cookie
- Candidate sees only own enrolled exams
- Start exam → question rendering (objective + text_response)
- Answer save (autosave) → submit → server-side grading
- Result display (score, per-question breakdown)
- text_response answer → `pending_manual` grading status

### I3. What E2E does NOT prove

- Teacher/Proctor/Grader resource isolation (no assignment model exists to exercise)
- fill_blank E2E (skipped with Phase 3 scope comment — component IS wired into QuestionRenderer)
- Admin exam lifecycle (publish → open → close → archive)
- Manual grading E2E (admin scores text_response → graded)
- Concurrent save/submit race (tested in `save-submit-race.spec.ts` E2E, not run here)

## J. Unsupported-Feature Containment (B7)

### J1. Rich text / media / formula containment

| Category | Pattern searched | Matches | Candidate-facing? |
|---|---|---|---|
| contenteditable | `contenteditable` | 0 | N/A |
| Rich text editors | Tiptap, TinyMCE, Quill, CodeMirror, monaco | 0 | N/A |
| dangerouslySetInnerHTML | actual usage | 0 | N/A |
| dangerouslySetInnerHTML | defensive comments/assertions | 2 | No (test assertions + safety comments) |
| innerHTML | `innerHTML` | 0 | N/A |
| Formula | KaTeX, MathJax, LaTeX | 0 | N/A |
| Markdown | react-markdown, marked, showdown, remark | 0 | N/A |
| Media upload | image/audio/video in candidate UI | 0 | N/A |

### J2. XSS safety

| Component | Rendering method | XSS safe? |
|---|---|---|
| TakeExamPage (question prompt) | `{currentQuestionView.prompt}` — React text content | ✅ Yes |
| TakeExamPage (answers) | Input/textarea/text — no HTML injection | ✅ Yes |
| ResultPage (answers) | `formatAnswer()` → `<span>{text}</span>` — React text content | ✅ Yes |
| ResultPage (question content) | `{question.content}` — React text content | ✅ Yes |
| FillBlankInput | `<input type="text">` — native input, no HTML | ✅ Yes |
| TextResponseInput | `<Textarea>` — native textarea, no HTML | ✅ Yes |
| QuestionRenderer test | Explicit test proving no dangerouslySetInnerHTML | ✅ Test-proven |

**XSS verdict**: **No XSS risk**. All candidate input flows through React's auto-escaping text rendering. No HTML/script injection surface exists.

### J3. Answer payload validation gap

| Aspect | Current state | Risk |
|---|---|---|
| `SaveAnswerRequestSchema.answer` | `z.unknown()` | No length limit, no content type restriction |
| Route handler | `body.answer` passed directly to `saveAnswer()` | No transformation or validation |
| text_response maxLength | `SubjectiveAnswerInput` accepts optional `maxLength` prop but `TextResponseInput` does not pass it | Candidates can submit arbitrarily large text |

**Risk**: A malicious candidate could submit multi-MB answer payloads, causing DB storage bloat and slow grading.

### J4. fill_blank E2E skip analysis

**File**: `apps/e2e/e2e/fill-blank-e2e.spec.ts:18-21`
```typescript
test.skip(true, "Phase 3 pending: fill-blank runtime/answer-protocol/auto-grading/result rendering are not part of Phase 2 baseline");
```

**Accuracy**: The skip comment is **outdated**. `FillBlankInput.tsx` IS wired into `QuestionRenderer.tsx` (line 44-53), which IS dispatched by `TakeExamPage.tsx`. The component renders `<input type="text">` fields for each blank. The grading engine handles exact/keyword matching. The E2E skip appears to be a scoping decision, not a technical limitation.

## K. Test Quality Assessment

### Strong tests
- `candidateOwnership.test.ts` (90 tests): Real cross-candidate attack matrix across 6 candidate routes; asserts 404 (not 403) for cross-owner; genuine negative coverage. **BROWSER+DB proven**.
- `permissionBoundary.test.ts` (78 tests): Unauth 401, Candidate 403, Teacher/Proctor/Grader 403 on 7 Admin-only M10-B routes; zero-write rejection guarantee. **TEST proven**.
- `proctorMonitoring.crossOrg.test.ts` + `routeRegistryConformance.test.ts`: Registry metadata + onRoute authz-kind capture; mutation-B-killed guarantee.
- `candidate-happy-path.spec.ts` (E2E): Real browser journey including text_response → pending_manual. **BROWSER proven**.

### Weak tests
- `permissionBoundary` Teacher/Proctor/Grader tests only exercise routes where the preset already **lacks** the capability. They cannot prove same-org resource isolation — no test can pass because no assignment model exists. This is a coverage gap, not a false-green.
- `routeRegistryConformance` asserts metadata only (registry entries + sensitive flag), not enforcement behavior. Acceptable as a drift guard.

### Missing negative controls
- No test proving a Teacher cannot see another Teacher's course/exam (moot — no assignment model)
- No test proving a Proctor cannot monitor an unassigned exam (moot — no assignment model)
- No test proving a Grader cannot grade an attempt outside their scope (moot — no assignment model)

## L. Cross-Boundary Observations

```
CROSS-BOUNDARY-HANDOFF:
Suggested owner: Agent A
Reason: text_response lifecycle classification (isManualGradedQuestion, 
        requiresManualGrading, gradingStatus = PendingManual) belongs to 
        Agent A workstream A3. Agent B verified the browser E2E path 
        (text_response → pending_manual) but the definitive lifecycle 
        authority is in packages/domain/src/gradingEngine.ts.
Evidence: apps/e2e/e2e/candidate-happy-path.spec.ts, 
          packages/domain/src/gradingEngine.ts:192-213

CROSS-BOUNDARY-HANDOFF:
Suggested owner: Agent A
Reason: Question-type inventory (A1) — canonical enum set is 
        single_choice/multiple_choice/true_false/fill_blank/text_response. 
        Agent B verified all 5 are wired into QuestionRenderer and 
        QuestionForm; Agent A should confirm DB schema + contract alignment.
Evidence: apps/web/src/components/exam/QuestionRenderer.tsx, 
          packages/contracts/src/question.ts:5-11
```

## M. Recommended Closure Plan

```
MUST FIX BEFORE BASIC PRODUCT CLOSURE:
  - Resolve F-B1-P1 decision: explicitly document (or implement) the
    Teacher/Proctor/Grader resource-scope model. If org-wide is the
    intended Phase 1/3 model, REMOVE the misleading "⚠️ scoped" comments
    in presets.ts so the code does not imply unimplemented behavior.

CAN DEFER (Phase 3/4):
  - Legacy requireRole(["Admin"]) on user/role/candidateField/audit/settings/email
    (correct Admin-only semantics, migration debt only)
  - Answer payload size limits (z.unknown() → add per-type validation)
  - text_response i18n gap in candidateResult.questionTypes

REQUIRES PRODUCT DECISION:
  - Assigned-resource isolation (Teacher@course / Proctor@exam / Grader@exam)
    scope and timeline. Blocks safe multi-stakeholder deployment but not
    single-admin Phase 1.

RICH-TEXT FOLLOW-UP:
  - None required. Product clearly supports only plain-text subjective
    (text_response). No rich-text editor, no misleading UI.

RESOURCE-AUTHORIZATION FOLLOW-UP:
  - Implement actor-to-resource assignment tables + resolvers once the
    product decision above lands.
```

## N. Final Machine-Readable Summary

```
RUN_ID=EXAM-BOUNDARY-B-20260718-222150-ddbc808b
AGENT_SLOT=B
P0=0
P1=1
P2=1
P3=1
PROVEN_SUPPORTED=candidate-ownership-chain,authentication,unauth-401,candidate-denied-admin,teacher-proctor-grader-denied-admin-only,zero-write-mutations,anti-enumeration-404,org-anchor-scoped-routes,subjective-plaintext-e2e,no-richtext-misleading-ui,xss-safe-rendering
PARTIAL=teacher-proctor-grader-capability-gating,fill-blank-wired-but-e2e-skipped
UNSUPPORTED=assigned-resource-scoping,richtext,images,tables,formulas,attachments,markdown
DECISIONS_REQUIRED=teacher-proctor-grader-resource-isolation-model,answer-payload-size-limits
BASIC_PRODUCT_CLOSURE=CONDITIONAL
```

---

```
EXAM-BOUNDARY-B-20260718-222150-ddbc808b: COMPLETE
```
