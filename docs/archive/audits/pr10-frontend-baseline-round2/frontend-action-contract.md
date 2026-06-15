# PR10 Frontend Action Contract — Round 2

> Authority: [SPEC.md](../../../SPEC.md) defines product invariants; [phase-roadmap.md](../../../phase-roadmap.md) defines Phase 1 scope and deferred capabilities.

**Date:** 2026-06-15
**Directory:** `docs/audits/pr10-frontend-baseline-round2/`
**Scope:** 第二轮补充审计。定义下一轮修复应遵守的前端 action contract，不修改生产代码。

## 1. Contract Rules

Every user-facing action should satisfy these rules:

| ID | Rule | Requirement |
|---|---|---|
| AC-1 | Visible pending state | Async action must show pending text/spinner and disable repeated activation. |
| AC-2 | Specific success feedback | Mutation success must either navigate intentionally, close dialog with refreshed data, or show toast/inline success. |
| AC-3 | Specific error feedback | Known `ApiError.code`, `ApiError.message`, and validation details must not be replaced by generic fallback. |
| AC-4 | Input preservation | Failed form submission must preserve user input and selection state. |
| AC-5 | Field validation mapping | Backend field errors must appear near fields when possible, with form-level summary for non-field errors. |
| AC-6 | Destructive confirmation | Delete, disable, archive, submit override, and irreversible operations require confirmation or equivalent explicit dialog. |
| AC-7 | Search reset path | Search/filter UIs must always provide clear/reset path, including no-result state. |
| AC-8 | No dead controls | Any visible input/button must either work or be hidden. Disabled future controls must not appear in Phase 1 runtime. |
| AC-9 | Accessible icon controls | Icon-only buttons require meaningful `aria-label`; loading state should be screen-reader visible where practical. |
| AC-10 | Deterministic navigation | Back/return actions should prefer explicit routes over `navigate(-1)` unless history context is guaranteed. |

React docs support AC-1/AC-4 by modeling form state as typing/submitting/success/error and disabling pending submit. shadcn/ui docs support using Button variants, AlertDialog for confirmation, FieldError near form inputs, Table empty states, and Sonner for feedback.

## 2. Page Action Contract Matrix

| Page | Action | Required Contract | Current Gap | Severity |
|---|---|---|---|---|
| LoginPage | 登录 | AC-1, AC-3, AC-4 | Mostly satisfied. | Low |
| DashboardPage | 创建考试 / 导入题目 | AC-10 | Satisfied by navigation. | Low |
| UsersPage | 保存 | AC-1, AC-2, AC-3, AC-4, AC-5 | No pending/disabled state; no backend field mapping. | High |
| UsersPage | 禁用/启用 | AC-1, AC-3, AC-6 | Direct mutation, no confirmation or pending state. | High |
| CandidatesPage | 搜索 | AC-7, AC-8 | No-result state hides search input; no clear/reset action. | Critical |
| CandidatesPage | 保存 | AC-1, AC-2, AC-3, AC-4, AC-5 | No pending state; overwrites server errors with generic text. | Critical |
| CandidatesPage | 禁用/启用 | AC-1, AC-3, AC-6 | Direct mutation, generic error, no confirmation. | High |
| CandidateFieldsPage | 保存字段 | AC-1, AC-2, AC-3, AC-4, AC-5 | No pending state; API errors unhandled; invalid input silently no-ops. | Critical |
| CandidateFieldsPage | 删除字段 | AC-1, AC-3, AC-6 | Confirmation exists, but async error/pending is not handled. | High |
| CandidateFieldsPage | 上移/下移/拖拽排序 | AC-1, AC-2, AC-3, AC-9 | No pending/error state; no keyboard alternative for drag/drop. | High |
| CandidateFieldsPage | 下载模板 | AC-1, AC-3 | Async action has no loading/error state. | Medium |
| CoursePage | 搜索 | AC-7 | No clear button or no-result reset action. | High |
| CoursePage | 保存 | AC-1, AC-2, AC-3, AC-5 | Pending and success exist; save error is generic. | Medium |
| QuestionPage | 搜索/筛选 | AC-7, AC-8 | Reset exists; search only filters current page and can mislead. | High |
| QuestionPage | 删除题目 | AC-3, AC-6 | Confirmation exists; error generic. | Medium |
| QuestionEditPage | 保存 | AC-1, AC-2, AC-3, AC-4, AC-5 | Pending exists; catch block swallows errors. | Critical |
| QuestionImportPage | 校验导入 | AC-1, AC-3, AC-4 | Failure replaces whole workflow with page error. | High |
| QuestionImportPage | 下载模板 | AC-8 | Template has scenario-specific examples in production UI. | High |
| ExamPage | 删除考试 | AC-3, AC-6, AC-9 | Mostly satisfied; disabled tooltip is good. | Low |
| ExamCreatePage | 保存草稿/发布考试 | AC-1, AC-2, AC-3, AC-4, AC-5 | Pending/success exist; server errors are generic. | High |
| ExamCreatePage | 随机选题 [Phase 2] | AC-8 | Visible future disabled control should be hidden in Phase 1 runtime. | Critical |
| ExamCreatePage | Phase 2 control flags | AC-8 | `requireQueue`, `restrictIp`, `requireLockdown` are visible/editable despite Phase 1 scope. | Critical |
| ExamDetailPage | 发布考试 | AC-1, AC-2, AC-3 | Mostly satisfied; inline error not dismissible. | Medium |
| ExamDetailPage | 归档 | AC-1, AC-3, AC-6 | Pending exists; confirmation missing. | High |
| ExamDetailPage | 添加考生 | AC-1, AC-2, AC-3, AC-7 | Add pending exists; picker search lacks reset and searches only loaded candidates. | Medium |
| ScoreListPage | 搜索考生 | AC-7, AC-8 | Dead input; no value/onChange/query integration. | Critical |
| ScoreListPage | 导出CSV | AC-1, AC-2, AC-3 | Raw anchor URL, no typed API client, no loading/error state. | Critical |
| ResultsOverviewPage | 查看成绩 | AC-9, AC-10 | Disabled tooltip good; no search/filter. | Medium |
| AttemptDetailPage | 返回 | AC-10 | Uses `navigate(-1)`; direct-link users can go to wrong page/no useful page. | High |
| SettingsPage | 保存设置 | AC-1, AC-2, AC-3, AC-4, AC-5 | Parent catches error with empty block; no success feedback. | Critical |
| SystemHealthPage | 刷新 | AC-1, AC-3 | Uses full-page loading and discards stale data. | Medium |
| ExamListPage | 开始考试 / 查看结果 | AC-10 | Navigation works; page lacks explicit h1/refresh. | Low |
| StartExamPage | 开始考试 | AC-1, AC-3, AC-10 | Specific errors good; no back to exam list; queue UI is future-scope risk. | High |
| TakeExamPage | 答案保存 | AC-1, AC-3, AC-4 | Strong protocol display; good baseline. | Low |
| TakeExamPage | 交卷/仍然提交 | AC-1, AC-3, AC-6 | Flush dialog good; submit error generic. | Medium |
| ResultPage | 返回考试列表 | AC-10 | Satisfied; result table not responsive. | Low |

## 3. Required Patterns for Next Fix PRs

### Pattern A — Save mutation

Applicable pages: UsersPage, CandidatesPage, CandidateFieldsPage, CoursePage, QuestionEditPage, ExamCreatePage, SettingsPage.

Contract:

1. Validate client-side first.
2. Set `saving=true` before API call.
3. Disable submit and cancel if closing would lose pending state.
4. On success: close dialog or navigate intentionally; refresh data; show success if staying on page.
5. On error: preserve `ApiError.message`; map `ApiError.details` to fields where schema supports it; keep user input.
6. Always reset `saving=false` in `finally`.

### Pattern B — Searchable list

Applicable pages: CandidatesPage, CoursePage, ScoreListPage, EnrollmentPicker, ResultsOverviewPage if search is added.

Contract:

1. Search input remains visible even when results are empty.
2. Provide clear button inside or next to the search input.
3. No-result empty state includes a reset action.
4. If data is paginated server-side, search must be server-side/URL-bound or clearly scoped to current page.
5. Do not render a non-functional search input.

### Pattern C — Destructive action

Applicable pages: UsersPage, CandidatesPage, CandidateFieldsPage, CoursePage, ExamPage, ExamDetailPage, TakeExamPage.

Contract:

1. Use confirmation for delete, disable, archive, and submit override.
2. Confirmation copy names the target where possible.
3. Confirm button uses `destructive` variant for destructive outcomes.
4. Confirm button has pending state and prevents repeat confirm.
5. Failure preserves backend message.

### Pattern D — Export/download action

Applicable pages: ScoreListPage, CandidateFieldsPage, QuestionImportPage.

Contract:

1. Use authenticated `fetch`/API-client-compatible download flow with `credentials: include`.
2. Show exporting/downloading state.
3. Show server error if export fails.
4. Use contract-safe template/demo copy; avoid hardcoded scenario examples in production runtime.

### Pattern E — Phase boundary runtime visibility

Applicable pages: ExamCreatePage, ExamDetailPage audit tab, StartExamPage queue UI, ResultPage disrupted copy.

Contract:

1. Phase 2+ controls must not appear as current runnable product actions in Phase 1 runtime.
2. If a future capability must be documented, keep it in docs, tests, or stories, not main product UI.
3. Copy must avoid Phase 2 roles such as Proctor as if they exist in Phase 1 product paths.

## 4. Critical Next PR Candidates

1. CandidatesPage search reset + save error preservation + save loading.
2. ScoreListPage dead search removal/fix + authenticated export action state.
3. QuestionEditPage visible save error handling.
4. SettingsPage branding save success/error feedback.
5. CandidateFieldsPage mutation pending/error handling.
6. ExamCreatePage hide Phase 2 controls and preserve server errors.
7. Shared field-error extraction helper for `ApiError.details`.
8. Shared responsive table wrapper rollout.

## 5. Non-goals for Next Fix PRs

- Do not modify backend state machines.
- Do not rewrite exam save/submit protocol.
- Do not introduce a new UI framework.
- Do not implement Phase 2 proctoring, queue admission, IP restriction, random paper builder, or lockdown runtime.
- Do not solve only one search box while leaving action/error contracts untouched.
