# P4-C3-CORR1 — Corrective Implementation

> **Job:** `P4-C3-CORR1 — Browser Product-Path Evidence and Assertion Hardening`
> **Type:** Corrective (test/docs only; no production behavior change).
> **Branch:** `feat/phase4-rbac`
> **Corrects:** `docs/audits/P4-C3-INDEPENDENT-REVIEW.md` (verdict FAIL).
> **Pre-CORR1 base:** `93f9249` (`test(e2e): prove three-role authorization flow`) — the C3 commit under review.
> **Authority chain read first:** `AGENTS.md`, `docs/audits/P4-R0-MVP-ROLE-SWITCH-REALITY-AUDIT.md`,
> `docs/audits/P4-C2-FRONTEND-CAPABILITY-GATING.md`, `docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md`,
> `docs/audits/P4-C3-INDEPENDENT-REVIEW.md`, `docs/architecture/authorization.md`.
> **Status:** CORR1 implementation complete; **the independent re-review owns the final corrected C3 verdict.**
> This report does **not** declare P4-C3 PASS and does **not** begin P4-R1.

---

## 1. Corrective objective

Address the four findings from the independent review of the original C3
(`93f9249`) without expanding scope beyond `apps/e2e/**` + the C3 report (+ this
corrective report), and without any production behavior change:

- **F-1 BLOCKER** — no meaningful Teacher mutation through the browser UI.
- **F-2 MAJOR** — result-surface assertion accepts every non-403 response.
- **F-3 MINOR** — Teacher UI denial assertions can be hardened.
- **F-4 NOTE** — C3 report overstates API mutation evidence.

---

## 2. Independent-review findings addressed

| Finding | Severity | CORR1 action |
| --- | --- | --- |
| F-1 | BLOCKER | Drive the representative Teacher exam mutation (create + publish) through the rendered browser UI (`ExamCreatePage` + `ExamDetailPage`). Course + objective question remain API setup. |
| F-2 | MAJOR | Narrow the result-surface assertion to the explicit `200 \| 409 RESOURCE_CONFLICT { details.reason: "EXAM_NOT_FINISHED" }` contract; assert the 409 body; fail on `401/403/404/422/500/503`. |
| F-3 | MINOR | Harden the Teacher UI-denial loop with per-route current-URL, admin-shell, and privileged-heading-absence assertions. |
| F-4 | NOTE | Correct the C3 report (`P4-C3-THREE-ROLE-E2E-EVIDENCE.md`) so it does not present API mutations as the browser-mutation deliverable; add a corrective-history note. |

---

## 3. Diff scope

```text
apps/e2e/e2e/teacher-product-path.spec.ts          (rewritten browser mutation + F-2 assertion)
apps/e2e/e2e/teacher-authorization-boundary.spec.ts (F-3 hardened denial loop)
docs/audits/P4-C3-THREE-ROLE-E2E-EVIDENCE.md       (F-4 corrections + CORR1 re-run)
docs/audits/P4-C3-CORRECTIVE-1.md                  (this report, new)
```

Forbidden-scope sweep: `apps/api/**`, `apps/web/**`, `packages/**`, schema,
migrations, capability catalog, role presets, route registry, `demo-seed.ts`,
`e2e-seed.ts` — **none touched**. Verified by `git diff --name-only 93f9249..HEAD`
(see §8). No production behavior change.

---

## 4. Browser mutation implemented (F-1)

The representative Teacher authoring mutation now travels through the rendered
browser UI. The full positive flow:

```text
Teacher logs in through /login  (existing loginAsTeacher)
→ lands on /admin/exams         (capability-driven, asserted)
→ clicks the capability-gated 创建考试 action (canCreateExam = ExamCreate)
→ lands on /admin/exams/new     (ExamCreatePage, asserted URL)
→ fills 请输入考试名称 (exam title input)
→ clicks 手动选题 → dialog → 添加 (pick a question) → 关闭
→ sets 及格分 (passingScore) = 1 (so passingScore <= auto-computed totalScore)
→ clicks 保存草稿 (save as draft)
→ POST /api/exams observed; response.ok() asserted (201 Created); examId captured from response
→ observable navigation back to /admin/exams asserted
→ opens /admin/exams/:id (ExamDetailPage)
→ created exam identity observable: heading === examTitle asserted
→ clicks the capability-gated 发布考试 action (canPublishExam = ExamPublish)
→ POST /api/exams/:id/publish observed + 200 asserted
→ waits for handlePublish's refetch (GET /api/exams/:id)
→ publish action disappears (toHaveCount(0)) + status badge renders 已发布 asserted
```

The exam **creation AND publication** mutations both travel through the browser
UI. Only prerequisite fixture data (course + objective `true_false` question)
uses the real supported Teacher API — explicitly allowed setup.

The following do **not** satisfy F-1 and are not used for the exam mutation:
`request.post(...)`, `fetch(...)`, or calling an API helper then only checking
the browser page. (Course/question creation remain API calls as permitted
setup.)

---

## 5. UI steps and selectors (F-1)

All selectors target the existing application UI with stable accessible names:

| Step | Locator | UI source |
| --- | --- | --- |
| Create-exam action | `getByRole("button", { name: "创建考试" })` | `ExamPage.tsx` PageHeader action, gated by `canCreateExam` |
| Landing URL | `expect(page).toHaveURL(/\/admin\/exams\/new/)` | router |
| Exam title | `getByPlaceholder("请输入考试名称")` | `ExamConfigForm` title Input placeholder |
| Open question picker | `getByRole("button", { name: "手动选题" })` | `ExamCreatePage` select-questions button |
| Add question | `getByRole("dialog").getByRole("button", { name: "添加" }).first()` | `ExamCreatePage` dialog available-question row |
| Close picker | `getByRole("button", { name: "关闭" })` | `ExamCreatePage` dialog footer |
| Passing score | `getByTestId("passingScore-input")` | `ExamConfigForm` passing-score Field (dedicated testid on the `<Input>`) |
| Save draft | `getByRole("button", { name: "保存草稿" })` | `ExamCreatePage` save-draft action |
| Created exam id | `waitForResponse(POST /api/exams)` → `.json().id` | network capture (id is then opened in the browser) |
| Detail identity | `getByRole("heading", { name: examTitle })` | `ExamDetailPage` PageHeader `<h1>` |
| Publish action | `getByRole("button", { name: "发布考试" })` | `ExamDetailPage` publish button, gated by `canPublishExam`, draft-only |
| Publish success (network) | `waitForResponse(POST /api/exams/:id/publish)` → status 200 | network capture |
| Publish success (UI) | publish button `toHaveCount(0)` + `[data-slot="status-badge"]` contains "已发布" | `ExamDetailPage` re-render after `loadExam` refetch |

No `page.waitForTimeout` / arbitrary sleeps. The publish flow waits for
`handlePublish`'s refetch (`waitForResponse(GET /api/exams/:id)`) so the status
badge assertion sees the updated status, not the stale draft.

---

## 6. Result assertion correction (F-2)

Replaced the broad assertion:

```ts
expect(resultsRes.status()).not.toBe(403);
```

with the explicit contract:

```ts
const status = resultsRes.status();
expect([200, 409]).toContain(status);
if (status === 409) {
  const body = await resultsRes.json();
  expect(body.error.code).toBe("RESOURCE_CONFLICT");
  expect(body.error.details?.reason).toBe("EXAM_NOT_FINISHED");
}
```

The assertion now:

- **Accepts** `200` (scores ready) or `409 RESOURCE_CONFLICT` with
  `details.reason === "EXAM_NOT_FINISHED"` (the post-gate business conflict for
  a freshly-published, attempt-less exam — P3 publication-state, not authz).
- **Fails** on `401` (stale token), `403` (authz regression), `404`
  (resource-not-found), `422` (validation), `500`/`503` (server failure).

The 409 body shape is asserted against the actual API error contract
(`buildErrorResponse` → `{ error: { code, message, details: { reason },
requestId } }`). No backend result semantics changed; this remains
authorization-surface evidence only.

---

## 7. UI denial hardening (F-3)

`teacher-authorization-boundary.spec.ts` UI-denial loop, per denied route,
now asserts:

1. **AccessDenied text** renders (`您没有权限访问该页面。`).
2. **Current URL remains the requested denied route** (no silent redirect).
3. **Teacher remains in the authenticated admin shell** (`getByTestId("admin-layout")` visible).
4. **Representative privileged page content is absent** (the privileged
   `<Outlet/>` is unmounted by the C2 render-branch): the privileged page
   heading is asserted `toHaveCount(0)`.

Per-route privileged headings (verified against the actual page components +
zh-CN i18n):

| Route | Privileged heading (asserted absent) | Page |
| --- | --- | --- |
| `/admin/users` | 用户管理 | `UsersPage` (`admin.users.title`) |
| `/admin/grading-queue` | 待评分 | `GradingQueuePage` (`admin.grading.title`) |
| `/admin/proctor` | 监考工作台 | `ProctorWorkspacePage` (`admin.proctorWorkspace.title`) |
| `/admin/settings` | 平台与机构设置 | `SettingsPage` (`admin.settings.pageTitle`) |
| `/admin/system` | 系统监控 | `SystemDiagnosticsPage` (`diagnostics.title`) |
| `/admin/audit-logs` | 审计日志 | `AuditLogPage` (`admin.audit.title`) |

The six API-denial probes (`GET /api/users`, `/api/admin/grading-queue`,
`/api/admin/proctor/exams`, `/api/system/diagnostics`, `/api/roles/assignable`,
`/api/exams/:id/export/scores`) remain exact-`.toBe(403)` and unchanged.

---

## 8. E2E commands and results

### Targeted Teacher positive-flow (run first)

```bash
E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh teacher-product-path
```

Result: **1 passed** (0 skips, 0 retries, exit 0). Passes without retry or skip.

### Full C3 + blocking set

```bash
E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh \
  teacher-product-path teacher-authorization-boundary candidate-admin-boundary \
  candidate-happy-path resume-attempt submit-flush
```

Result (fresh `exam_e2e` reseed):

```text
project             chromium
spec files selected  6 (3 C3 + 3 existing blocking)
tests               7 (candidate-happy-path has 2)
passes              7
skips               0
retries             0 (retries: 0 in config)
duration            19.0s
exit code           0
```

Per-spec:

| # | spec | result | duration |
| ---: | --- | --- | ---: |
| 1 | candidate-admin-boundary | ✓ PASS | 2.3s |
| 2 | candidate-happy-path (happy) | ✓ PASS | 3.5s |
| 3 | candidate-happy-path (text_response) | ✓ PASS | 3.5s |
| 4 | resume-attempt | ✓ PASS | 3.6s |
| 5 | submit-flush | ✓ PASS | 1.5s |
| 6 | teacher-authorization-boundary | ✓ PASS | 1.8s |
| 7 | teacher-product-path | ✓ PASS | 2.1s |

The three existing blocking specs remain green — **no regression**.

### E2E package typecheck

```bash
pnpm --filter @exam/e2e typecheck
```

Result: **PASS** (exit 0; `tsc --noEmit` clean).

### Tree hygiene

```bash
git diff --check      # clean (no whitespace errors)
```

---

## 9. `pnpm verify` result

```bash
pnpm verify
```

**Result: PASS (exit 0).** All stages green
(format:check → lint → lint:copy → lint:arch → lint:db-config → lint:ui-gates
→ lint:eslint → typecheck → coverage → build). Coverage 16/16, build 9/9.
(One initial prettier failure on `teacher-product-path.spec.ts` was fixed with
`prettier --write` before this final run.)

---

## 10. Production behavior changes

```text
None. CORR1 is test+docs only (apps/e2e/** + two audit docs). No production
source, capability, preset, route, frontend, schema, or migration was modified.
```

---

## 11. Remaining findings

None within CORR1 scope. All four review findings (F-1 BLOCKER, F-2 MAJOR,
F-3 MINOR, F-4 NOTE) are addressed. P3 result-publication timing / visibility,
manual/`after_grading` publication, fill-blank/subjective runtime, and the
scoped Teacher/Proctor/Grader product-role bundles remain explicitly
out-of-scope (P3 work), unchanged by CORR1.

---

## 12. Re-review readiness

CORR1 is ready for the independent re-review. The re-review should confirm:

- The representative Teacher exam mutation (create + publish) is driven through
  the rendered browser UI (F-1), with course + objective question as permitted
  API setup.
- The result-surface assertion pins the explicit
  `200 | 409 RESOURCE_CONFLICT { details.reason: "EXAM_NOT_FINISHED" }`
  contract and fails on `401/403/404/422/500/503` (F-2).
- The Teacher UI-denial loop asserts per route the current URL, admin shell,
  and privileged-heading absence (F-3).
- The C3 report framing no longer presents API mutations as the
  browser-mutation deliverable (F-4).
- No production source was modified; scope stays within `apps/e2e/**` + the two
  audit docs.

The independent re-review owns the final corrected C3 verdict. CORR1 does not
declare P4-C3 PASS, does not begin P4-R1, and does not declare P4 CLOSED.
