# P4-C3-CORR1 — Independent Re-Review

> **Reviewer:** independent (differential-review skill)
> **Subject:** `P4-C3-CORR1 — Browser Product-Path Evidence and Assertion Hardening`
> **Type:** Review-only. No production code, no test code, and no C3/CORR1 artifact was modified
> by this review. Only this report file was created.
> **Branch under review:** `feat/phase4-rbac`
> **Corrects:** `docs/audits/P4-C3-INDEPENDENT-REVIEW.md` (original C3 verdict **FAIL**).
> **Pre-CORR1 base (original C3):** `93f9249` (`test(e2e): prove three-role authorization flow`)
> **CORR1 commit (HEAD):** `b4dc1d6` (`test(e2e): complete teacher browser product path`)
> **Authority read first:** `AGENTS.md`, `docs/audits/P4-R0-MVP-ROLE-SWITCH-REALITY-AUDIT.md`,
> `docs/audits/P4-V0-GATE-0.5-BASELINE-VERIFICATION.md`, `docs/audits/P4-C1-AUTHORIZATION-RESIDUE-CLEANUP.md`,
> `docs/audits/P4-C2-FRONTEND-CAPABILITY-GATING.md`, `docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md`,
> `docs/audits/P4-C3-INDEPENDENT-REVIEW.md`, `docs/audits/P4-C3-CORRECTIVE-1.md`,
> `docs/architecture/authorization.md`, `docs/status/implementation-status.md`.
> **Frozen role boundary:** `docs/audits/P4-R0-MVP-ROLE-SWITCH-REALITY-AUDIT.md` §12.

---

## 1. Verdict

```text
PASS
```

The CORR1 corrective implementation genuinely closes the BLOCKER (F-1) and the MAJOR (F-2),
and addresses the MINOR (F-3) and NOTE (F-4). Every acceptance criterion in task §14 is met,
independently re-derived from executable code and a fresh E2E re-run — not from the CORR1 report.

**Next authorized Job:** `P4-R1 — Final Independent Re-audit and Closeout`.

This review did **not** begin P4-R1 and did **not** declare P4 CLOSED.

---

## 2. Reviewed branch, commits, and working tree

```text
branch              feat/phase4-rbac
pre-C3 base         87583a3   feat(web): enforce capability route guards         (P4-C2)
original C3         93f9249   test(e2e): prove three-role authorization flow     (FAIL: F-1 BLOCKER)
CORR1 (HEAD)        b4dc1d6   test(e2e): complete teacher browser product path   (this review)
commit ancestry     87583a3 → 93f9249 → b4dc1d6  (linear; no unrelated commits interleaved)
working tree        one untracked file: docs/audits/P4-C3-INDEPENDENT-REVIEW.md (the prior review)
                     — no staged/modified production or test source
git diff --check    clean (no whitespace errors)
```

The historical anchors match the task §3 expectations exactly. CORR1 (`b4dc1d6`) is a focused
follow-up whose sole parent is the original C3 (`93f9249`); it is not a rewritten unrelated series.

---

## 3. Corrective diff scope

`git diff --name-status 93f9249..HEAD`:

```text
M  apps/e2e/e2e/teacher-authorization-boundary.spec.ts   (+74)
M  apps/e2e/e2e/teacher-product-path.spec.ts             (+196)
A  docs/audits/P4-C3-CORRECTIVE-1.md                     (+294)
M  docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md          (+131)
```

Four files, +621 / −74. Separated per task §4:

```text
review-report-only changes     docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md
                               docs/audits/P4-C3-CORRECTIVE-1.md (new)
CORR1 implementation changes   apps/e2e/e2e/teacher-product-path.spec.ts
                               apps/e2e/e2e/teacher-authorization-boundary.spec.ts
unrelated changes              (none)
```

**Forbidden-modification sweep** — `git show --name-only b4dc1d6` filtered to every forbidden
path class from task §4 (`apps/api/**`, `apps/web/**`, `packages/**`, schema, migrations,
capability catalog, role presets, route registry, `demo-seed.ts`, `e2e-seed.ts`):

```text
CLEAN — zero production-source files in the CORR1 commit
```

The candidate boundary spec and the three existing blocking specs
(`candidate-admin-boundary.spec.ts`, `candidate-happy-path.spec.ts`, `resume-attempt.spec.ts`,
`submit-flush.spec.ts`) were **not modified** by CORR1 (`git diff 93f9249..HEAD -- <each>` is
empty) — original C3 negative/anti-enumeration evidence is structurally preserved.

**Scope verdict: CORR1 is exactly `apps/e2e/**` + two audit documents. No production behavior
change.**

---

## 4. F-1 browser-mutation review — **CLOSED**

### 4.1 The mutation

`apps/e2e/e2e/teacher-product-path.spec.ts` now drives a real Teacher exam mutation through the
**rendered browser UI**. The representative flow (verified line-by-line against the spec and
against the web source):

```text
Teacher logs in through /login              (loginAsTeacher, :106)
→ lands on /admin/exams                     (asserted :107)
→ clicks 创建考试  (capability-gated)        (:148-152, getByRole button)
→ lands on /admin/exams/new                 (asserted :153)
→ fills 请输入考试名称 (exam title)          (:160, getByPlaceholder)
→ opens 手动选题 dialog, clicks 添加, 关闭   (:169-175, getByRole dialog/button)
→ sets 及格分 = 1 (passingScore)             (:183-186, Label→sibling input)
→ clicks 保存草稿 (save as draft)            (:195, getByRole button)
→ POST /api/exams captured, ok() asserted   (:190-202, waitForResponse)
→ examId captured from response body        (:201)
→ navigates back to /admin/exams asserted   (:205)
→ opens /admin/exams/:id (detail page)      (:212)
→ created exam identity observable          (:218, heading === examTitle)
→ clicks 发布考试 (capability-gated)         (:220-238, getByRole button)
→ POST /api/exams/:id/publish 200 asserted  (:226-242, waitForResponse)
→ refetch awaited (GET /api/exams/:id)      (:233-243)
→ publish action disappears (toHaveCount 0) (:254)
→ status badge renders 已发布              (:255-258, [data-slot=status-badge])
```

Both the **exam creation AND publication** mutations travel through the rendered UI. Only
prerequisite fixture data (course + objective `true_false` question) uses the real supported
Teacher API (`teacherCreateCourse` / `teacherCreateObjectiveQuestion`, :41-89) — explicitly
permitted setup per task §5 ("API setup may create prerequisite course/question data, but at
least one representative Teacher product mutation must be UI-driven").

### 4.2 UI controls exist and are capability-gated (independently verified against source)

Every selector targets the existing application UI. Verified against `apps/web/src` (file:line):

| Spec control | UI source | Gate | Teacher admitted? |
| --- | --- | --- | --- |
| `创建考试` button | `ExamPage.tsx:115-118` (`admin.exams.createBtn`) | `canCreateExam` = `Permission.ExamCreate` (`capabilities.ts:190-194`) | yes (`presets.ts:134`) |
| `请输入考试名称` placeholder | `ExamConfigForm.tsx:124-128` (`admin.forms.exam.titlePlaceholder`) | — | n/a |
| `手动选题` button | `ExamCreatePage.tsx:246-248` (`admin.examCreate.selectQuestions`) | — | n/a |
| dialog `添加` / `关闭` | `ExamCreatePage.tsx:388-394` / `:401-407` | — | n/a |
| `及格分` Label | `ExamConfigForm.tsx:313` (`admin.forms.exam.passingScore`) | — | n/a |
| `保存草稿` button | `ExamCreatePage.tsx:325-333` (`admin.examCreate.actions.saveDraft`) | — | n/a |
| `发布考试` button | `ExamDetailPage.tsx:416-425` (`admin.examDetail.actions.publish`) | `canPublishExam` = `Permission.ExamPublish` (`capabilities.ts:185-189`), draft-only | yes (`presets.ts:136`) |
| `[data-slot=status-badge]` + `已发布` | `StatusBadge.tsx:32`; `status.exam.published` = "已发布" (`zh-CN.ts:16`) | — | n/a |

The two mutation actions are gated by capabilities the Teacher preset genuinely holds
(`ExamCreate`, `ExamPublish` — `packages/authz/src/presets.ts:134,136`), so the buttons render
*because* the Teacher is authorized — their visibility itself is admission evidence, and the
subsequent UI-driven POST proves the mutation.

### 4.3 Mutation is real (task §5 "what counts")

Every interaction uses a qualifying locator form: `page.goto`, `getByRole(...).click()`,
`getByPlaceholder(...).fill()`, `getByText(...).locator(...)`. The mutation is initiated by
interaction with rendered UI controls, not by `request.post`/`fetch`. No API helper stands in
for the exam create or publish. The `request` fixture is used **only** for the permitted API
setup (course + question) and the F-2 authorization readback.

### 4.4 What does not count — confirmed absent

`request.post(...)`, `fetch(...)`, and "create by API then merely visit" are **not** used for
the exam mutation. `grep` over the spec confirms the only `request.post` calls are the
permitted API-setup helpers (`teacherCreateCourse`, `teacherCreateObjectiveQuestion`) and
`createTeacherViaApi` (Admin setup). The exam create/publish POSTs originate from the browser
`page` (captured via `waitForResponse`), not from `request`.

**F-1 verdict: CLOSED.** A meaningful Teacher mutation (exam create + publish) is UI-driven,
the Teacher is the active browser actor, and the success assertion proves the mutation happened.

---

## 5. Teacher actor/session proof

- **Admin→Teacher separation.** Teacher creation uses the Playwright **`request` fixture**
  (`createTeacherViaApi(request, …)`, :98), which carries its own isolated cookie store — it is
  **not** the browser `page`. The Admin auth-token lives only in the `request` fixture context.
- **No page-level cookie/token injection.** `grep` over the spec finds zero
  `page.context().addCookies/setCookies`, `addInitScript`, or Admin-page navigation. The only
  `page.goto` calls target `/login`, `/admin/exams/:id`, `/admin/results` — all under the
  Teacher session.
- **Login clears all prior state.** `loginViaUi` (`login.ts:89-94`) calls
  `page.context().clearCookies()`, then `localStorage.clear(); sessionStorage.clear()`, **then**
  navigates to `/login`. Any residual state is wiped before the Teacher authenticates.
- **Teacher is the active actor.** The browser only ever holds the Teacher session; every
  `page.*` interaction (clicks, fills, asserts) occurs inside that Teacher-authenticated
  context. The test never switches back to Admin before the UI mutation.
- **Mutation visibility is capability-driven.** `创建考试` and `发布考试` render only when the
  Teacher holds `ExamCreate` / `ExamPublish` (verified §4.2). The buttons are visible *because*
  Teacher holds the required capability.

**Actor/session proof: sound.** No Admin cookie/token residue; the Teacher is unambiguously the
browser actor for the mutation.

---

## 6. Browser-flow success evidence

For the browser mutation (task §5 "Verify success evidence"):

```text
mutation                       exam create (draft) + exam publish
page                           /admin/exams → /admin/exams/new → /admin/exams/:id
controls used                  创建考试, 请输入考试名称, 手动选题/添加/关闭,
                               及格分, 保存草稿, 发布考试
required capability            ExamCreate, ExamPublish (Teacher preset holds both)
success assertion (create)     createResponse.ok() === true (POST /api/exams, :197-200)
                               + navigation back to /admin/exams (:205)
success assertion (publish)    publishResponse.status() === 200 (:240-242)
                               + publishBtn toHaveCount(0) (:254)
                               + [data-slot=status-badge] contains 已发布 (:255-258)
created resource identity      examId from POST /api/exams body (:201);
                               detail-page heading === examTitle (:218)
post-mutation state            status badge 已发布; publish action unmounted
```

The success assertions prove the mutation happened (observable URL, captured network 200/ok,
identity heading, status-badge re-render, action-button disappearance) — not merely that a
button was clicked. The publish-flow `waitForResponse(GET /api/exams/:id)` (:233-243) waits for
`ExamDetailPage.handlePublish`'s refetch (`ExamDetailPage.tsx:267-285` → `loadExam` GET) so the
status-badge assertion sees the updated published state, not the stale draft.

The create endpoint returns **201** with the full exam object (`exam.ts:524`,
`reply.code(201).send(toExamResponse(exam))`); the spec asserts `createResponse.ok()` (true for
201) and reads `.json().id` (present at top level) — both correct. (This is a minor
documentation imprecision in the CORR1 report §4, which says "POST /api/exams observed + 200";
the spec itself asserts `ok()` and is robust to 200/201. Non-blocking.)

**Success evidence: sound.**

---

## 7. F-2 result-assertion review — **CLOSED**

### 7.1 The corrected assertion

`teacher-product-path.spec.ts:274-285`:

```ts
const status = resultsRes.status();
expect(
  [200, 409],
  `Teacher view exam scores must be authorized (200 or 409 EXAM_NOT_FINISHED), got ${status}`,
).toContain(status);
if (status === 409) {
  const body = (await resultsRes.json()) as {
    error: { code: string; details?: { reason?: string } };
  };
  expect(body.error.code).toBe("RESOURCE_CONFLICT");
  expect(body.error.details?.reason).toBe("EXAM_NOT_FINISHED");
}
```

This is `expect(ARRAY).toContain(ITEM)` — the correct direction: it asserts `status` is an
element of `[200, 409]`. (It is **not** the inverted `expect(status).toContain(...)`.)

### 7.2 Backend behavior independently verified

`GET /api/exams/:id/scores` (`apps/api/src/routes/scores.ts`):

- **Gate** (`scores.ts:270-273`): `preHandler: [authenticate, requireCapability(ScoreAllView)]`.
  The capability gate runs in `preHandler`, **before** the handler. A Teacher lacking
  `ScoreAllView` is rejected at `auth.ts:266-270` with **403 PERMISSION_DENIED** and the handler
  never runs.
- **Post-gate path for a freshly-published, attempt-less exam**: `canOpenScoreList`
  (`scores.ts:124-145`) returns `{ allowed: false, message: "Exam is not finished yet" }`
  (status `published`, `now < closeAt`, `examEnded` false) → the handler returns **409** at
  `scores.ts:342-353` via `buildErrorResponse(request.id, "RESOURCE_CONFLICT",
  { reason: "EXAM_NOT_FINISHED" }, access.message)`.
- **Exact body** (`errorResponse.ts:72-86`): `{ error: { code: "RESOURCE_CONFLICT", message:
  "Exam is not finished yet", details: { reason: "EXAM_NOT_FINISHED" }, requestId } }`.

The Teacher preset holds `ScoreAllView` (`presets.ts:140`), so the Teacher passes the gate and
reaches the 409 path. The 409 therefore **proves capability admission** (the gate admitted
`ScoreAllView`), and the 409 reason is a post-gate publication-state business conflict owned by
P3 — exactly the contract the assertion encodes.

### 7.3 F-2 checklist (task §7)

```text
[x] 401 fails      (not in [200,409])
[x] 403 fails      (not in [200,409])  — proves authz admission
[x] 404 fails      (not in [200,409])
[x] 422 fails      (not in [200,409])
[x] 500 fails      (not in [200,409])
[x] 503 fails      (not in [200,409])
[x] 200 passes
[x] 409 passes only with expected reason  (code RESOURCE_CONFLICT + details.reason EXAM_NOT_FINISHED)
```

The 409 body shape asserted (`body.error.code`, `body.error.details?.reason`) matches the real
`buildErrorResponse` envelope exactly.

### 7.4 No P3 result-semantic overreach

The assertion verifies **authorization surface only** (the gate admitted `ScoreAllView`, and the
response is the documented post-gate business state). It does not assert P3
result-publication timing, `resultVisibility`, `answerVisibility`, or standard-answer leak —
consistent with the P4-C3 forbidden scope (task §4 / P4-R0 §13).

**F-2 verdict: CLOSED.** The assertion accepts only `200` or `409 RESOURCE_CONFLICT
{ details.reason: "EXAM_NOT_FINISHED" }` and fails on every unintended status.

---

## 8. F-3 denial-hardening review — **ADDRESSED (hardened)**

`teacher-authorization-boundary.spec.ts:41-102`. The UI-denial loop now asserts, **per denied
route**, four conditions:

1. **AccessDenied text** renders (`您没有权限访问该页面。`, :80-83) — exact zh-CN value of
   `adminRouteGuard.accessDenied` (`zh-CN.ts:264`), rendered by `AccessDeniedPage`.
2. **Current URL remains the requested denied route** (:86-88) — `toHaveURL` with the route
   regex; no silent redirect.
3. **Teacher remains in the authenticated admin shell** (:91-94) —
   `getByTestId("admin-layout")` visible (`AdminLayout.tsx:141`).
4. **Representative privileged page content is absent** (:98-101) — the privileged page heading
   is asserted `toHaveCount(0)`.

Per-route privileged headings verified against the actual page components + zh-CN i18n:

| Route | Privileged heading (asserted absent) | Page source |
| --- | --- | --- |
| `/admin/users` | `用户管理` | `UsersPage.tsx:181` (`admin.users.title`) |
| `/admin/grading-queue` | `待评分` | `GradingQueuePage.tsx:103` (`admin.grading.title`) |
| `/admin/proctor` | `监考工作台` | `ProctorWorkspacePage.tsx:87` (`admin.proctorWorkspace.title`) |
| `/admin/settings` | `平台与机构设置` | `SettingsPage.tsx:121` (`admin.settings.pageTitle`) |
| `/admin/system` | `系统监控` | `SystemDiagnosticsPage.tsx:208` (`diagnostics.title`) |
| `/admin/audit-logs` | `审计日志` | `AuditLogPage.tsx:212` (`admin.audit.title`) |

All six route→page mounts confirmed in `App.tsx`. The C2 render-branch
(`AdminLayout.tsx:175` `{routeDenied ? <AccessDeniedPage /> : <Outlet />}`) unmounts the
privileged `<Outlet/>`, so the privileged-heading-absence assertion is structurally sound and
cannot be satisfied by privileged content rendering alongside the AccessDenied text.

The six API-denial probes (`GET /api/users`, `/api/admin/grading-queue`, `/api/admin/proctor/exams`,
`/api/system/diagnostics`, `/api/roles/assignable`, `/api/exams/:id/export/scores`) remain
exact-`.toBe(403)` and unchanged (:104-157). No new brittle or incorrect assertion was
introduced.

**F-3 verdict: ADDRESSED.** The prior MINOR hardening gap (no per-route URL / shell /
content-absence assertions) is closed; the C2 render-branch invariant remains the structural
backstop.

---

## 9. F-4 documentation review — **ADDRESSED**

`docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md` and `docs/audits/P4-C3-CORRECTIVE-1.md` now:

- **Distinguish API setup from browser product-path evidence.** §4 of the evidence doc states
  "Prerequisite course + objective `true_false` question data may be created through the
  supported Teacher APIs … These remain setup only" and "The representative Teacher exam
  mutation is performed through the rendered browser UI … **Exam creation AND publication both
  travel through the browser UI**; this satisfies the browser-product-path requirement."
- **Explicitly retract the prior framing.** A corrective-history note (§4, lines 92-100) states
  the initial C3 "used API calls (`request.post`) for every Teacher authoring mutation … API
  mutations alone do **not** satisfy the browser-mutation acceptance criterion."
- **Describe the result assertion as the explicit contract.** §7 / §8 describe it as "**200**
  (scores ready) or **409 RESOURCE_CONFLICT** with **`details.reason === "EXAM_NOT_FINISHED"`**",
  not merely "not 403".

The documentation no longer contradicts the executable test. The spec header
(`teacher-product-path.spec.ts:17-27`) accurately describes the F-1 browser mutation and the F-2
explicit contract. No material documentation/test contradiction remains.

**F-4 verdict: ADDRESSED.** (One trivial imprecision — CORR1 report §4 says "POST /api/exams
observed + 200"; the route returns 201 and the spec asserts `ok()`. The spec is robust; only the
prose says 200. NOTE, non-blocking — §16.)

---

## 10. Original C3 evidence preservation

CORR1 did **not** weaken or remove prior valid evidence. Re-confirmed against source and the
unchanged specs:

```text
[x] Teacher created through POST /api/users { role: "Teacher" }  (createTeacherViaApi, teacher.ts:77-80)
[x] Teacher logs in through the real /login UI                     (loginAsTeacher → loginViaUi)
[x] Teacher allowed navigation proven                              (teacher-product-path.spec.ts:111-115, exact link names)
[x] Teacher denied navigation proven                               (:118-126, not.toBeVisible)
[x] Teacher management/grading/proctor/system APIs return exact 403 (teacher-authorization-boundary.spec.ts:111-157, .toBe(403))
[x] Candidate admin APIs return exact 403                          (candidate-admin-boundary.spec.ts, unchanged by CORR1)
[x] Candidate direct admin URLs denied/redirected correctly        (candidate-admin-boundary.spec.ts, unchanged)
[x] Cross-candidate attempt probe returns exact 404                (candidate-admin-boundary.spec.ts, unchanged)
[x] Cross-candidate score probe returns exact 404                  (candidate-admin-boundary.spec.ts, unchanged)
[x] Foreign-owned probe uses a real resource, not a random UUID    (candidate-admin-boundary.spec.ts seeds a real 2nd candidate)
[x] No Teacher seed pollution                                      (no Teacher in e2e-seed.ts / demo-seed.ts)
[x] No direct-DB Teacher creation                                  (createTeacherViaApi uses POST /api/users only)
```

The candidate-admin-boundary spec and the three blocking specs were not touched by CORR1
(`git diff 93f9249..HEAD -- <each>` empty), so F-1 correction did not come at the cost of
deleting negative-boundary evidence.

---

## 11. Isolation / flakiness review

- **No arbitrary timing sleeps.** Zero `page.waitForTimeout(...)` or `sleep(...)` in any
  CORR1-touched file. The only `setTimeout` is the bounded 429-login retry backoff in
  `teacherApiToken` (`teacher.ts:44`) and `apiLogin` (`flow.ts:149`) — a justified exponential
  backoff on HTTP 429, mirrored across the established helpers, not a fixed-delay flake source.
- **Observable, accessible selectors.** Assertions use `getByRole`, `getByText`, `getByPlaceholder`,
  `getByTestId`, `waitForResponse`, `toHaveURL` — Playwright auto-waiting on observable state.
  The single `.first()` (`:173`) is on the dialog `添加` button (one per question row); adding
  the first available question is the intended, stable choice.
- **Identity isolation.** `createTeacherViaApi` mints `e2e-teacher-<stamp>-<rand>` per call
  (`teacher.ts:70-72`); the two Teacher specs use distinct prefixes (`p4c3-tpos`, `p4c3-tneg`).
  Exam/course/question names embed `${Date.now()}-${rand}` (`:134`), so repeated runs / shards
  do not collide on unique constraints.
- **No cross-spec dependency.** Each Teacher spec seeds its own Teacher and (where needed) its
  own course/question/exam; neither Teacher spec depends on the other or on prior-spec data.
- **Reseed isolation.** `run-wsl.sh` reseeds `exam_e2e` every run (dedicated DB, never touching
  `exam` dev or `exam_test` vitest). A failed spec does not poison the next because each run
  rebuilds the DB from the idempotent e2e seed.
- **Failure-midway safety.** The publish flow waits for `handlePublish`'s refetch
  (`waitForResponse GET /api/exams/:id`) before asserting the status badge, so the badge
  assertion cannot race the stale draft state.

**Isolation/flakiness verdict: sound.**

---

## 12. Targeted E2E result

**Command (task §11, run first):**

```bash
E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh teacher-product-path
```

**Observed output (verbatim):**

```text
Running 1 test using 1 worker

  ✓  1 [chromium] › e2e/teacher-product-path.spec.ts:92:3 › P4-C3 Teacher positive product path
      › Admin creates Teacher → Teacher logs in → Teacher authors + publishes via browser UI
      → Teacher reaches results surface (2.2s)

  1 passed (3.0s)
```

**Result:**

```text
project        chromium
spec files     1
tests          1
passes         1
skips          0
retries        0
duration       3.0s (test) / ~33s (full lifecycle: build + migrate + reseed + run)
exit code      0
```

The corrected positive spec passes without retry or skip on a fresh `exam_e2e` reseed.

---

## 13. Complete six-spec E2E result

**Command (task §11):**

```bash
E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh \
  teacher-product-path teacher-authorization-boundary candidate-admin-boundary \
  candidate-happy-path resume-attempt submit-flush
```

**Observed output (verbatim):**

```text
Running 7 tests using 1 worker

  ✓  1 [chromium] › e2e/candidate-admin-boundary.spec.ts:26:3 › … (2.2s)
  ✓  2 [chromium] › e2e/candidate-happy-path.spec.ts:14:3 › … login → list → start → answer → save → submit → graded result (3.1s)
  ✓  3 [chromium] › e2e/candidate-happy-path.spec.ts:36:3 › … text_response answer … pending_manual (3.4s)
  ✓  4 [chromium] › e2e/resume-attempt.spec.ts:12:3 › … answer → reload → resume same attempt → submit → graded (3.2s)
  ✓  5 [chromium] › e2e/submit-flush.spec.ts:11:3 › … select answer then immediately submit — flush preserves answer, score correct (1.3s)
  ✓  6 [chromium] › e2e/teacher-authorization-boundary.spec.ts:23:3 › … (1.6s)
  ✓  7 [chromium] › e2e/teacher-product-path.spec.ts:92:3 › … (1.9s)

  7 passed (17.4s)
```

**Result:**

```text
project        chromium
spec files     6 (3 C3 + 3 existing blocking)
tests          7 (candidate-happy-path has 2)
passes         7
skips          0
retries        0 (retries: 0 in playwright.config.ts)
duration       17.4s
exit code      0
```

Confirmations (task §11):

```text
[x] all six intended spec files execute (no silent omission)
[x] zero skipped tests
[x] zero retries
[x] chromium project actually runs
[x] exit code 0
```

The three existing blocking specs (candidate-happy-path, resume-attempt, submit-flush) remain
green — **no regression** from C1/C2/C3/CORR1.

---

## 14. E2E typecheck result

```bash
pnpm --filter @exam/e2e typecheck
```

**Result: PASS (exit 0).** `tsc --noEmit` clean — the corrected E2E files typecheck cleanly
under `@exam/e2e`.

---

## 15. `pnpm verify` result

```bash
pnpm verify
```

**Result: PASS (exit 0).** The `verify` script (`package.json`) chains ten stages with `&&`;
exit 0 means every stage succeeded:

```text
format:check → lint → lint:copy → lint:arch → lint:db-config → lint:ui-gates
  → lint:eslint → typecheck → coverage → build
```

Stage summaries observed (re-derived in this review from the run log, not inferred from the
CORR1 report):

```text
typecheck : 17 successful, 17 total   (includes @exam/api:typecheck, @exam/e2e:typecheck)
coverage  : 16 successful, 16 total
build     : 9 successful, 9 total
```

No `ELIFECYCLE`, no nonzero-exit markers, no failed package/task. Tree hygiene: `git diff --check`
clean; `git status --short` shows only the untracked prior-review doc (and this review's new
doc). No whitespace errors, no untracked contamination in production/test source.

---

## 16. Findings by severity

### BLOCKER

```text
(none)
```

F-1 (the prior BLOCKER) is closed: a meaningful Teacher exam mutation (create + publish) is
driven through the rendered browser UI, the Teacher is the active actor, and the success
assertion proves the mutation.

### MAJOR

```text
(none)
```

F-2 (the prior MAJOR) is closed: the result-surface assertion accepts only `200` or `409
RESOURCE_CONFLICT { details.reason: "EXAM_NOT_FINISHED" }` and fails on 401/403/404/422/500/503;
the 409 body shape matches the real API error envelope.

### MINOR

```text
(none)
```

F-3 (the prior MINOR) is addressed: the Teacher UI-denial loop now asserts, per denied route,
the current URL, the admin shell, and the privileged-heading absence, in addition to the
AccessDenied text.

### NOTE

**N-1 — CORR1 report §4 prose says "POST /api/exams observed + 200".**
The create endpoint returns **201** (`exam.ts:524` `reply.code(201)`), not 200. The spec itself
asserts `createResponse.ok()` (true for both 200 and 201) and reads `.json().id`, so it is
robust and correct; only the §4 prose is imprecise. Non-blocking documentation nit. (The
publish endpoint does return 200, `exam.ts:742`, as the report states.)

No other findings. No new regression or scope violation was introduced by CORR1.

---

## 17. Acceptance checklist (task §14)

```text
[x] At least one meaningful Teacher mutation is UI-driven         (exam create + publish, §4)
[x] Teacher is the active browser actor                           (request fixture isolation + login clears state, §5)
[x] The UI mutation has a stable success assertion                (network 200/ok + URL + identity heading + status badge + action disappearance, §6)
[x] Result assertion accepts only 200 or expected 409             (expect([200,409]).toContain(status), §7)
[x] Expected 409 reason/body is asserted                          (code RESOURCE_CONFLICT + details.reason EXAM_NOT_FINISHED, §7)
[x] Result assertion fails on 401/403/404/422/500/503            (not in [200,409], §7.3)
[x] Original Teacher positive/negative evidence remains intact    (§10)
[x] Candidate boundary and anti-enumeration remain intact        (candidate-admin-boundary unchanged, §10)
[x] No direct-DB Teacher or seed pollution                        (POST /api/users only; no seed Teacher, §10)
[x] CORR1 scope is apps/e2e/** plus audit documents               (4 files, zero production source, §3)
[x] Corrected targeted E2E passes                                 (1/1, exit 0, §12)
[x] Complete six-spec E2E set passes                              (7/7, exit 0, §13)
[x] E2E typecheck passes                                          (exit 0, §14)
[x] pnpm verify passes                                            (exit 0; typecheck 17, coverage 16, build 9, §15)
```

Every acceptance item passes. The single residual finding (N-1) is a NOTE-level documentation
imprecision that does not affect any acceptance criterion.

---

## 18. Final recommendation

**PASS.** CORR1 closes F-1 (BLOCKER) and F-2 (MAJOR), addresses F-3 (MINOR) and F-4 (NOTE),
preserves all original C3 evidence, stays within `apps/e2e/**` + two audit documents, introduces
no production behavior change, and passes the targeted E2E, the complete six-spec E2E set, the
E2E typecheck, and `pnpm verify`.

**Next authorized Job:**

```text
P4-R1 — Final Independent Re-audit and Closeout
```

This review did not modify C3 or CORR1 implementation. It did not begin P4-R1. It did not
declare P4 CLOSED.
