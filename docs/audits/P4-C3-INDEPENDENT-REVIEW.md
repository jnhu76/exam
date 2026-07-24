# P4-C3 — Independent Review

> **Reviewer:** independent (differential-review skill)
> **Subject:** `P4-C3 — Three-Role Product-Path and E2E Evidence`
> **Type:** Review-only. No production code, tests, or C3 artifacts were modified by this review.
> **Branch under review:** `feat/phase4-rbac`
> **Pre-C3 base:** `87583a3` (`feat(web): enforce capability route guards`) — P4-C2
> **C3 commit (HEAD):** `93f9249` (`test(e2e): prove three-role authorization flow`)
> **Authority read first:** `AGENTS.md`, `docs/audits/P4-R0-MVP-ROLE-SWITCH-REALITY-AUDIT.md`,
> `docs/audits/P4-C1-AUTHORIZATION-RESIDUE-CLEANUP.md`, `docs/audits/P4-C2-FRONTEND-CAPABILITY-GATING.md`,
> `docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md`, `docs/architecture/authorization.md`,
> `docs/status/implementation-status.md`, `docs/roadmap/phase3-open-items.md`.
> **Frozen role boundary:** `docs/audits/P4-R0-MVP-ROLE-SWITCH-REALITY-AUDIT.md` §12.

---

## 1. Verdict

```text
FAIL
```

One acceptance item fails (browser-mutation evidence, §7/§18). All other acceptance
items pass. Per task §18, any failed acceptance item requires `FAIL` (not
`PASS_WITH_MINOR_FINDINGS`).

**Next authorized Job:** none; correct the P4-C3 findings and re-review.

This review did **not** begin corrections and did **not** declare P4 closed.

---

## 2. Reviewed branch, base commit, and HEAD

```text
branch              feat/phase4-rbac
pre-C3 base         87583a3   feat(web): enforce capability route guards    (P4-C2)
HEAD (C3)           93f9249   test(e2e): prove three-role authorization flow
commits in C3       exactly one (93f9249); 87583a3 is its sole parent
working tree        clean (git status --short empty; git diff --check clean)
```

The C3 commit sits directly on top of the documented pre-C3 base. No unrelated
commits are interleaved.

---

## 3. Diff scope

`git diff --name-status 87583a3..HEAD`:

```text
A  apps/e2e/e2e/candidate-admin-boundary.spec.ts        (+111)
A  apps/e2e/e2e/teacher-authorization-boundary.spec.ts  (+107)
A  apps/e2e/e2e/teacher-product-path.spec.ts            (+184)
M  apps/e2e/lib/login.ts                                (+23, adds loginAsTeacher + TEACHER_LANDING)
A  apps/e2e/lib/teacher.ts                              (+88)
A  docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md         (+203)
```

Total: 6 files, +716 lines, all additive (no deletions outside the new files).

**Forbidden-modification sweep** — `git diff --name-only 87583a3..HEAD` filtered
to every path outside `apps/e2e/**` and the C3 report:

```text
(none)
```

No `apps/api`, `apps/web`, `packages/**`, `migrations`, `schema`, role presets,
capability catalog, route registry, or demo/e2e seeds were touched by C3. Scope
is clean: **`apps/e2e/**` + the report**, exactly as task §16 requires.

---

## 4. Teacher fixture review

`apps/e2e/lib/teacher.ts:66-88` (`createTeacherViaApi`).

The Teacher is created through the **supported Admin product interface**,
verified against the actual route implementation:

- Admin authenticates via the real `POST /api/auth/login` flow (`adminApiToken`
  in `apps/e2e/lib/flow.ts:168-177`, used at `teacher.ts:76`).
- The Teacher is created via `POST /api/users { role: "Teacher" }`
  (`teacher.ts:77-80`). The route `apps/api/src/routes/user.ts:121-185` accepts
  `role: "Teacher"` in the body (`user.ts:143` `CreateUserRequestSchema.parse`),
  and inside one `executeInTransaction` (`user.ts:149-173`) writes:
  1. the `users` row with `users.role = "Teacher"` (`user.ts:150-156`),
  2. the **primary active Teacher assignment** via `assignWithinTransaction`
     (`user.ts:157-166`),
  3. an audit row (`user.ts:167-171`).
- The response body contains `id` (`user.ts:174-183`), which `createTeacherViaApi`
  reads and returns as `userId` (`teacher.ts:86-87`).
- Creation failure is asserted, not swallowed: `if (!res.ok()) throw`
  (`teacher.ts:81-85`).

Checklist (task §5):

```text
[x] No direct INSERT into users                  (POST /api/users only)
[x] No direct INSERT into user_role_assignments  (route writes it in-transaction)
[x] No direct JWT signing as Teacher evidence    (teacherApiToken logs in via /api/auth/login)
[x] No Teacher added to demo-seed.ts             (rg "Teacher|teacher" packages/db/src/demo-seed.ts → none)
[x] No Teacher added to e2e-seed.ts              (rg over e2e-seed.ts → none)
[x] No reliance on a default Teacher account     (minted per-call)
[x] Unique username prevents collisions          (e2e-teacher-<stamp>-<rand>; per-call prefix override)
[x] Creation errors asserted                     (throw on !res.ok())
[x] Returned identity used consistently          (userId flows back; username/password reused for login)
```

A repo-wide sweep for shortcuts (`rg "insert|user_role_assignments|signJWT|jwt.sign|createAssignedUser|prisma|drizzle|\.query\("` over `apps/e2e`) returns **zero** matches in any C3 file.

**Verdict: fixture discipline is sound.** The Teacher really is created through
the supported Admin API, and the assignment-backed authority kernel
(`apps/api/src/authz/assignmentAuthority.ts`) will resolve Teacher capabilities
on the next login.

---

## 5. Teacher login review

`apps/e2e/lib/login.ts:187-193` (`loginAsTeacher`) delegates to the shared
`loginViaUi` (`login.ts:57-166`) with `TEACHER_LANDING = /\/admin\/exams/`
(`login.ts:55`).

- It uses the real `/login` page (`login.ts:90,94` `page.goto("/login")`).
- It submits real credentials via the rendered form (`login.ts:118-120`:
  fill username / password / click `登录`).
- It waits for **observable** authentication completion: a race between the
  POST `/api/auth/login` response, the expected-URL navigation, and an alert
  (`login.ts:99-126`). Login failure cannot be mistaken for success — a non-200
  login response or a missed landing URL throws a structured error
  (`login.ts:138-161`).
- It does **not** inject cookies/localStorage/tokens: cookies are explicitly
  cleared at the start (`login.ts:89`), and storage is cleared (`login.ts:92`).
- The landing path is **not** derived from the role string. It is the
  capability-driven `adminLandingPath` resolver
  (`apps/web/src/lib/capabilities.ts:242-261`) invoked by `AuthContext.login`
  (`apps/web/src/contexts/AuthContext.tsx:89-94`) after the server returns
  `capabilities: string[]`. For a Teacher preset the chain short-circuits at
  `canSeeExams` (ExamView) → `/admin/exams` (`capabilities.ts:252-260`;
  `routes.ts:16`). This is locked by `apps/web/src/lib/capabilities.test.ts:187-195`.
- The helper is reusable: it takes `(page, username, password)` and does not
  hard-code one test's user.

**Verdict: login is real, observable, capability-driven, and reusable.** The
landing is consistent with capability-based default navigation.

---

## 6. Positive-flow review

`apps/e2e/e2e/teacher-product-path.spec.ts`.

| Step | Operation | Interface | Endpoint / page | Asserted success | Required capability | Cleanup |
|---|---|---|---|---|---|---|
| 1 | Create Teacher | API (Admin) | `POST /api/users {role:"Teacher"}` | `res.ok()` + `body.id` (`:88-91`) | `UserCreate` (Admin) | per-run unique user |
| 2 | Teacher login | **Browser UI** | `/login` → `/admin/exams` | `toHaveURL(/\/admin\/exams/)` (`:97`) | (login) | n/a |
| 3a | See allowed nav | **Browser UI** | sidebar links | `toBeVisible()` for 课程/题目/题目导入/考试/成绩 (`:101-105`) | CourseView/QuestionView/QuestionImport/ExamView/ScoreAllView | n/a |
| 3b | Not see denied nav | **Browser UI** | sidebar | `not.toBeVisible()` for 仪表盘/待评分/监考/用户管理/平台设置 (`:108-116`) | (preset absence) | n/a |
| 4a | Create course | **API (Teacher)** | `POST /api/courses` | `res.ok()` + `body.id` (`:45-50`) | `CourseCreate` | unique code |
| 4b | Create objective Q | **API (Teacher)** | `POST /api/questions` type `true_false` | `res.ok()` + `body.id` (`:73-78`) | `QuestionCreate` | unique content |
| 4c | Create exam | **API (Teacher)** | `POST /api/exams` | `examRes.ok()` (`:152`) | `ExamCreate` | unique title |
| 4d | Publish exam | **API (Teacher)** | `POST /api/exams/:id/publish` | `publishRes.status() === 200` (`:159`) | `ExamPublish` | n/a |
| 5a | Result-surface API | **API (Teacher)** | `GET /api/exams/:id/scores` | `status !== 403` (`:174-177`) | `ScoreAllView` | n/a |
| 5b | Result-surface UI | **Browser UI** | `/admin/results` | AccessDenied text `not.toBeVisible()` (`:181-182`) | `ScoreAllView` | n/a |

**P2-1 boundary honored.** The only question authored is `true_false`
(objective, auto-graded). No `text_response`, no `rubric`, no new authoring UI.
The pre-existing `candidate-happy-path` text_response regression spec still runs
unchanged; it does not authorize Teacher authoring expansion.

---

## 7. Browser-mutation evidence — **BLOCKER (F-1)**

This is the decisive finding.

**Requirement (task §7, "Critical requirement: browser mutation evidence"):**

> At least one meaningful Teacher mutation should travel through the browser UI
> **when the existing UI already supports it.**
> …
> If all Teacher mutations use API setup and the existing UI supports at least
> one of those actions, classify this as a C3 acceptance failure.

**Submitted C3:** every Teacher authoring mutation in
`teacher-product-path.spec.ts` step 4 is an API call via `request.post(...)`:

- `teacherCreateCourse` → `request.post('/api/courses')` (`teacher-product-path.spec.ts:37`)
- `teacherCreateObjectiveQuestion` → `request.post('/api/questions')` (`:63`)
- exam create → `request.post('/api/exams')` (`:136`)
- publish → `request.post('/api/exams/${examId}/publish')` (`:155-158`)

The browser is used in this spec only for: login (step 2), nav-link visibility
assertions (step 3), and a `page.goto('/admin/results')` access-denied check
(step 5b). **Zero Teacher authoring mutations travel through the rendered UI.**

**Existing UI support (verified against source):** the web UI fully supports
Teacher-equivalent authoring, and the Teacher capability set admits each action:

| Action | Page / button | API call from the UI | Capability gate | Teacher admitted? |
|---|---|---|---|---|
| Create course | `CoursePage.tsx:196-200` (button) → `:318-382` (dialog) → `handleSave` `:144-148` | `POST /api/courses` | none (page-level) | yes (CourseCreate) |
| Create `true_false` Q | `QuestionPage.tsx:347-351` → `QuestionEditPage.tsx` → `QuestionForm.tsx:213-215` (`true_false` SelectItem) → `handleSave` `:145` | `POST /api/questions` | none | yes (QuestionCreate) |
| Create exam | `ExamPage.tsx:113-120` (button, `canCreateExam`) → `ExamCreatePage.tsx:191` (`handleSave`) | `POST /api/exams` | `canCreateExam` = `ExamCreate` | **yes** |
| Publish exam | `ExamDetailPage.tsx:416-425` (button, `canPublishExam`) → `handlePublish` `:272` | `POST /api/exams/:id/publish` | `canPublishExam` = `ExamPublish` | **yes** |

The Teacher's own landing is `/admin/exams` (`teacher-product-path.spec.ts:97`),
where the create button (`ExamPage.tsx:113-120`, gated by `canCreateExam`,
which Teacher passes) renders. So the most natural browser mutation — click
"create exam", fill the form, submit, then publish — was directly reachable
from the page the test already asserts the Teacher landed on.

**The C3 spec acknowledges the requirement and then violates it.** Its own
header (`teacher-product-path.spec.ts:17-20`) states:

> Constraints honored (task §6.3): at least one meaningful Teacher mutation
> travels through the browser UI when the existing UI already supports it
> (Teacher lands on /admin/exams; we assert the capability-driven nav). API
> setup for prerequisite fixture data uses the real supported API.

But the body performs all four mutations via the API. The parenthetical
"(Teacher lands on /admin/exams; we assert the capability-driven nav)" re-casts
the requirement as satisfied by a navigation assertion, which it is not.

**C3 report framing.** The implementation report
(`docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md` §4) describes step 4 as
"Teacher performs a representative allowed mutation via the real supported
API", presenting the API path as the deliverable. This contributed to the
BLOCKER: the report does not flag that the browser-mutation requirement was
unmet.

**Classification.** Per task §7 ("classify this as a C3 acceptance failure") and
§17 (BLOCKER examples explicitly include "no meaningful browser-side Teacher
mutation"), this is a **BLOCKER**. Per task §18, the PASS checklist item
"[ ] At least one meaningful Teacher mutation uses browser UI when supported"
fails, so the verdict must be `FAIL`.

**Do not fix during review.** This report records the gap; it does not edit the
spec.

---

## 8. Result-surface assertion review — **MAJOR (F-2)**

`teacher-product-path.spec.ts:174-177`:

```ts
expect(resultsRes.status(), `Teacher view exam scores must be authorized (not 403)`).not.toBe(403);
```

**Backend behavior (verified).** `GET /api/exams/:id/scores`
(`apps/api/src/routes/scores.ts:267-391`) is gated by `ScoreAllView`
(`scores.ts:272`). For a freshly published exam with no attempts and
`closeAt` in the future, the handler reaches `canOpenScoreList`
(`scores.ts:124-145`) and returns **409 `RESOURCE_CONFLICT` with
`{ reason: "EXAM_NOT_FINISHED" }`** (`scores.ts:338-353`) — emitted *after* the
capability gate admitted the Teacher. So in the current code the test does
prove the Teacher was admitted past the authz gate.

**Why the assertion is too weak.** `not.toBe(403)` also accepts `401, 404, 409,
422, 500, 503`. A future regression that changed this route to return e.g. 401
(stale/invalid token) or 500 (server failure) would pass the assertion while
representing a real authz failure. Per task §8, a robust authorization-only
assertion should constrain the result to an explicitly expected set
(`200` or `409` with a specific documented business-conflict code/body), not
accept arbitrary non-403 failures.

**Surrounding assertions.** The Teacher token is just minted by
`teacherApiToken` (which throws on login failure), and `examId` was created by
the Teacher in the same org (asserted `examRes.ok()` at `:152`). So in practice
the response is bounded to "200 or 409 EXAM_NOT_FINISHED". This bounds the
*current* risk, but the assertion itself does not encode that bound — a
subsequent route/signature change would silently keep the test green.

**Checklist (task §8):**

```text
[~] Assertion proves capability admission           (true today; not pinned to 409-reason)
[ ] Does not accidentally pass on auth failure       (would pass on 401)
[ ] Does not accidentally pass on resource-not-found (would pass on 404)
[ ] Does not accidentally pass on server failure     (would pass on 500/503)
[~] Expected 409 tied to stable business condition   (EXAM_NOT_FINISHED is real, but not asserted)
[x] UI result-page assertion proves 403 page absent  (AccessDenied text not.toBeVisible at :182)
```

**Classification: MAJOR** (material evidence weakness; insufficient negative
assertion — task §17). Not BLOCKER because today's behavior genuinely proves
admission; the weakness is regression robustness, not current correctness. The
fix is to assert `expect([200, 409]).toContain(status)` (and optionally assert
the 409 `reason === "EXAM_NOT_FINISHED"` body when status is 409), plus the
existing UI assertion.

---

## 9. Teacher UI denial review — **MINOR (F-3)**

`teacher-authorization-boundary.spec.ts:36-50`. Six denied routes
(`/admin/users`, `/admin/grading-queue`, `/admin/proctor`, `/admin/settings`,
`/admin/system`, `/admin/audit-logs`) each assert one shared string:

```ts
await expect(page.getByText("您没有权限访问该页面。"), ...).toBeVisible();
```

**Backend/frontend reality (verified).** The string is the exact zh-CN value of
`adminRouteGuard.accessDenied` (`apps/web/src/i18n/locales/zh-CN.ts:264`),
rendered by `AccessDeniedPage` (`apps/web/src/pages/admin/AccessDeniedPage.tsx:20`)
inside a single `<p>` text node (no interpolation, zh-CN is the only locale).
`AdminLayout.tsx:175` renders `{routeDenied ? <AccessDeniedPage /> : <Outlet />}`;
the privileged `<Outlet/>` is **not mounted** when denied, so privileged page
content cannot render alongside the AccessDenied text. Each of the six routes
maps to a capability the Teacher preset lacks
(`apps/web/src/lib/adminRouteCapabilities.ts:66-206`), so all six genuinely
deny.

**Why this is only MINOR.** Because the C2 guard's render-branch unmounts the
privileged page, the shared-text assertion is structurally sound: it cannot be
satisfied by a generic error page or by privileged content. The C2 architecture
absorbs most of the task-§10 concern.

**Residual weakness.** Per task §10, a stronger per-route assertion would also
assert (a) the privileged page heading/content is absent and (b) the Teacher
remained authenticated (shell still rendered). The current loop asserts neither
explicitly — it relies on the render-branch invariant. It also does not assert
the current URL per route (no redirect occurred). These are hardening gaps, not
correctness gaps.

**Classification: MINOR** (the shared-text assertion is sound given the C2
render-branch, but explicit per-route content-absence / URL / auth-retention
assertions would be stronger — task §17 MINOR).

---

## 10. Teacher API denial review

`teacher-authorization-boundary.spec.ts:52-105`. Six API probes, each using the
Teacher's own `teacherApiToken` (no Admin token leakage — the Cookie header is
`auth-token=${teacherToken}` at every call), each asserted with **exact**
`.toBe(403)`:

| Request | Asserted | Gate (verified) | Capability | In Teacher preset? |
|---|---|---|---|---|
| `GET /api/users` | 403 (`:59`) | `user.ts:76` | `UserView` | no |
| `GET /api/admin/grading-queue` | 403 (`:68`) | `gradingQueue.ts:67` | `GradingQueueView` | no |
| `GET /api/admin/proctor/exams` | 403 (`:77`) | `proctorMonitoring.ts:58` | `ExamRoomView` | no |
| `GET /api/system/diagnostics` | 403 (`:85`) | `system.ts:261` | `SystemDiagnosticsView` | no |
| `GET /api/roles/assignable` | 403 (`:93`) | `roleAssignments.ts:59` | `UserRoleAssign` | no |
| `GET /api/exams/00000000-0000-4000-8000-000000000000/export/scores` | 403 (`:103`) | `export.ts:39` | `ScoreExport` | no |

**Synthetic-UUID export check (task §11).** Verified: `ScoreExport` is a flat
`requireCapability` gate in the route's `preHandler` (`export.ts:39`); Fastify
runs the entire preHandler chain before the handler body, so the 403
(`auth.ts:266-270`) is emitted **before** `examRepo.findById` (`export.ts:57`)
or its 404 branch (`export.ts:58-62`) can run. The synthetic uuid is well-formed
(passes `idParamsSchema`), so no 400 pre-empts. A Teacher session therefore
gets exactly 403, not 404 — proving the capability gate precedes resource
resolution.

**Verdict: all six API denials are exact and trustworthy.** Exact-403
assertions, no Admin-token leakage, no 401-mistaken-for-denial (login succeeds;
the gate denies post-auth).

---

## 11. Candidate boundary and anti-enumeration review

`apps/e2e/e2e/candidate-admin-boundary.spec.ts`.

**UI boundary.** Candidate logs in via the real UI (`loginAsCandidate`,
`flow.ts:7-12` → `loginViaUi`) and lands on `/exam/list` (`:46`). Direct visits
to `/admin/users`, `/admin/exams`, `/admin/grading-queue` all redirect to
`/exam/list` (`:48-56`). Verified control flow: `AdminLayout.tsx:107-116`
redirects any actor failing `canAccessAdminConsole` to `/exam/list` (Candidate
holds `ExamTake` so `canAccessExamRuntime` is true) **before** the per-route
guard runs, so no privileged admin content renders. The spec additionally
asserts `getByTestId("admin-layout")` is not visible after the `/admin/users`
visit (`:50`) — a real privileged-content-absence check.

**API boundary.** Three management APIs probed with the Candidate's own token:

| Request | Asserted | Gate | Capability |
|---|---|---|---|
| `GET /api/users` | 403 (`:64`) | `UserView` | not in Candidate preset |
| `GET /api/exams` | 403 (`:69`) | `ExamView` | not in Candidate preset |
| `GET /api/admin/grading-queue` | 403 (`:80`) | `GradingQueueView` | not in Candidate preset |

**Anti-enumeration (task §12).** The probe target is a **real foreign-owned
resource**: a second candidate is seeded (`seededOther` via `seedExam`,
`:36-39`), that candidate logs in and starts a real attempt
(`candidateStartAttempt`, `:86-91`), and the actor candidate probes that real
attempt id. This is not a random nonexistent UUID. Verified backend behavior:

- `GET /api/attempts/:id` → `requireOwnAttempt(AttemptViewOwn)` resolver
  (`ownAttemptCapability.ts:74-161`): same-org attempt exists, Candidate has
  `AttemptViewOwn`, but `ownerUserId !== actorId` → **404 `RESOURCE_NOT_FOUND`**
  (`ownAttemptCapability.ts:157-159`).
- `GET /api/scores/attempts/:attemptId` → `requireScoreCapability()` resolver
  (`scoreCapability.ts:81-176`): Candidate has `ScoreOwnView` (not
  `ScoreAllView`), `ownerUserId !== actorId` → **404 `RESOURCE_NOT_FOUND`**
  (`scoreCapability.ts:164-166`).

The spec asserts exactly `.toBe(404)` for both probes (`:97-100`, `:107-109`).
The 404 is the anti-enumeration contract (indistinguishable from "does not
exist"), and it is driven against a genuinely foreign-owned resource.

**Verdict: candidate boundary and anti-enumeration are proven.**

---

## 12. Isolation / flakiness review

**Identity isolation.** `createTeacherViaApi` mints `e2e-teacher-<stamp>-<rand>`
per call (`teacher.ts:70-72`); the two C3 Teacher specs use distinct prefixes
(`p4c3-tpos` positive, `p4c3-tneg` negative). Course/question/exam names embed
the same `${Date.now()}-${rand}` stamp (`teacher-product-path.spec.ts:123`), so
repeated runs / shards do not collide on unique constraints.

**No cross-spec dependency.** Each spec seeds its own Teacher and (where
needed) its own course/question/exam; neither C3 Teacher spec depends on the
other, and neither depends on a prior spec's data. `candidate-admin-boundary`
seeds both its own actor and its own "other" candidate.

**Reseed isolation.** `scripts/e2e/run-wsl.sh` reseeds `exam_e2e` every run by
default (`RESEED=1`, `:272-277`), against the dedicated `exam_e2e` database
(`:88`), never touching `exam` (dev) or `exam_test` (vitest). In parallel-shard
mode (`E2E_WORKERS>1`, the CI default of 2), each shard gets its own
`exam_e2e_w{i}` database + API server (`:300-345`), so shards are fully
isolated. A failed spec does not poison a subsequent spec because each run
rebuilds the DB from the idempotent e2e seed.

**Flakiness audit (task §13).**

- No `page.waitForTimeout(...)` in any C3 file.
- The only `setTimeout` in C3 is the login-retry backoff in `teacherApiToken`
  (`teacher.ts:44`) — a justified exponential backoff on HTTP 429, mirroring
  the established `apiLogin` pattern (`flow.ts:149`, `seed.ts:57`). Not a
  fixed-delay flake source.
- No brittle positional selectors: assertions use role/text/testid/name
  matchers (`getByRole("link", {name: ...})`, `getByText`, `getByTestId`).
- No shared mutable global state.

**Verdict: isolation and flakiness discipline are sound.**

---

## 13. E2E command and result

**Command run (exactly task §14):**

```bash
E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh \
  teacher-product-path teacher-authorization-boundary candidate-admin-boundary \
  candidate-happy-path resume-attempt submit-flush
```

**Observed output (verbatim tail):**

```text
Running 7 tests using 1 worker

  ✓  1 [chromium] › e2e/candidate-admin-boundary.spec.ts:26:3 › … (5.7s)
  ✓  2 [chromium] › e2e/candidate-happy-path.spec.ts:14:3 › … login → list → start → answer → save → submit → graded result (5.8s)
  ✓  3 [chromium] › e2e/candidate-happy-path.spec.ts:36:3 › … text_response answer … pending_manual (6.7s)
  ✓  4 [chromium] › e2e/resume-attempt.spec.ts:12:3 › … answer → reload → resume … (6.5s)
  ✓  5 [chromium] › e2e/submit-flush.spec.ts:11:3 › … select answer then immediately submit … (4.7s)
  ✓  6 [chromium] › e2e/teacher-authorization-boundary.spec.ts:23:3 › … (4.6s)
  ✓  7 [chromium] › e2e/teacher-product-path.spec.ts:82:3 › … (3.3s)

  7 passed (39.2s)
```

**Result:**

```text
project             chromium
spec files selected 6 (3 new C3 + 3 existing blocking)
tests               7 (candidate-happy-path has 2)
passes              7
skips               0
retries             0 (retries: 0 in playwright.config.ts:24)
exit code           0
```

The command syntax (positional spec-key args passed through to `npx playwright
test`) selects exactly the six intended files; no requested spec was silently
omitted. The three existing blocking specs (candidate-happy-path,
resume-attempt, submit-flush) still pass — **no regression** from C1/C2/C3.
(The single initial 409-vs-200 adjustment described in the C3 report §7 was a
test-only correction made before this HEAD; it is already in commit `93f9249`
and was not reproduced as a failure in this rerun.)

---

## 14. `pnpm verify` result

```bash
pnpm verify
```

**Result: PASS, exit 0** (background run, exit code confirmed via completion
notification; stderr empty).

The `verify` script (`package.json:40`) chains ten stages with `&&`; exit 0
means every stage succeeded:

```text
format:check → lint → lint:copy → lint:arch → lint:db-config → lint:ui-gates
  → lint:eslint → typecheck → coverage → build
```

Stage summaries observed:

```text
coverage : 16 successful, 16 total
build    : 9 successful, 9 total
```

**C3 typecheck (task §15).** `pnpm --filter @exam/e2e typecheck` (tsc --noEmit)
exits 0 — the new C3 files typecheck cleanly under `@exam/e2e`.

**Tree hygiene (task §15).** `git diff --check` clean; `git status --short`
empty. No whitespace errors, no untracked contamination.

`pnpm verify` success was **re-derived** in this review, not inferred from the
C3 report.

---

## 15. Findings ordered by severity

### BLOCKER

**F-1 — No browser-UI Teacher mutation despite existing UI support** (§7).
Every Teacher authoring mutation in `teacher-product-path.spec.ts` step 4
(course/question/exam/publish) is a `request.post(...)` API call. The existing
UI supports all four (verified: `CoursePage.tsx:144`, `QuestionEditPage.tsx:145`,
`ExamCreatePage.tsx:191`, `ExamDetailPage.tsx:272`), and the Teacher capability
set admits all four. The Teacher even lands on `/admin/exams` where the
capability-gated create button renders. Task §7 classifies this as a C3
acceptance failure; task §18 PASS checklist item "At least one meaningful
Teacher mutation uses browser UI when supported" fails.

### MAJOR

**F-2 — Broad `!== 403` result-surface assertion** (§8).
`teacher-product-path.spec.ts:174-177` asserts `status !== 403`. This also
accepts 401/404/422/500/503; a future regression returning any of those would
keep the test green without proving capability admission. The current backend
behavior is a post-gate 409 `EXAM_NOT_FINISHED` (`scores.ts:342-353`), which
does prove admission today — but the assertion does not pin that behavior.
Recommend `expect([200, 409]).toContain(status)` (and optionally assert the 409
`reason` body).

### MINOR

**F-3 — Teacher UI denial asserts only shared AccessDenied text** (§9).
`teacher-authorization-boundary.spec.ts:36-50` asserts one shared string
(`您没有权限访问该页面。`) for all six denied routes. Sound today because the
C2 render-branch (`AdminLayout.tsx:175`) unmounts the privileged `<Outlet/>`,
so the AccessDenied text cannot co-exist with privileged content. Hardening
gap: no explicit per-route privileged-content-absence, URL, or
auth-retention assertions (task §10).

### NOTE

**F-4 — C3 report framing of API mutations as the deliverable.**
`docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md` §4 describes step 4 as
"representative allowed mutation via the real supported API" without flagging
that the browser-mutation requirement (§7) was unmet, and the spec's own header
re-casts the requirement as satisfied by a navigation assertion. This is a
documentation/narrative issue that contributed to F-1 going uncaught in
self-review; it does not, by itself, affect runtime evidence.

---

## 16. Acceptance checklist (task §18)

```text
[x] Teacher created through supported Admin API           (POST /api/users {role:"Teacher"})
[x] Teacher logs in through real browser auth             (loginAsTeacher → /login UI → /admin/exams)
[ ] At least one meaningful Teacher mutation uses browser UI when supported   ← FAILS (F-1)
[x] Teacher allowed navigation is proven                  (exact link names, visibility)
[x] Teacher API/UI denials are exact and trustworthy      (6×UI→403page; 6×API→exact 403)
[~] Result authorization assertion cannot pass on arbitrary non-403 errors     ← WEAK (F-2, MAJOR)
[x] Candidate admin denial is proven                      (redirect to /exam/list; 3×API→403)
[x] Candidate cross-owner probes use real foreign-owned resources and return 404
[x] No seed pollution or direct-DB Teacher creation       (verified across seeds + e2e)
[x] All six selected E2E specs execute and pass           (7/7, 0 skips, 0 retries, exit 0)
[x] pnpm verify passes                                    (exit 0; 16 coverage + 9 build; e2e typecheck 0)
[x] C3 remains within apps/e2e/** plus its report         (diff scope clean)
```

One failed item (F-1) and one weak item (F-2). Per task §18, any failed
acceptance item requires `FAIL`.

---

## 17. Final recommendation

**Correct the P4-C3 findings and re-review.** Concretely, before re-review C3
should, without expanding scope beyond `apps/e2e/**`:

1. **(BLOCKER F-1)** Drive at least one Teacher authoring mutation through the
   rendered UI. The lowest-friction candidate is exam creation + publish from
   `/admin/exams` (the page the Teacher already lands on): fill
   `ExamCreatePage`, submit, observe UI success, then use `ExamDetailPage`'s
   publish button. Course (`CoursePage`) or objective-question
   (`QuestionEditPage`) creation through the UI are also acceptable. The
   remaining setup mutations may stay on the API. This satisfies task §7 and
   the §18 checklist.
2. **(MAJOR F-2)** Narrow the result-surface assertion to an explicit allowed
   set, e.g. `expect([200, 409]).toContain(status)` (optionally asserting the
   409 `reason === "EXAM_NOT_FINISHED"` body), so it cannot pass on 401/404/
   500/503.
3. **(MINOR F-3, optional)** Add per-route privileged-content-absence (and/or
   URL / auth-retention) assertions in the Teacher UI denial loop.
4. **(NOTE F-4)** Update the C3 report's §4 wording so it does not present the
   API mutations as satisfying the browser-mutation requirement.

This review did not modify the C3 implementation. Do not begin P4-R1. Do not
declare P4 CLOSED.
