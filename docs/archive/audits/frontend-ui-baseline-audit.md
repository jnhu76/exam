# Frontend UI / UX / Action Contract Baseline Audit

> Authority: [SPEC.md](../../SPEC.md) defines product invariants; [phase-roadmap.md](../../phase-roadmap.md) defines Phase 1 scope and deferred capabilities.

**Date:** 2026-06-15  
**Scope:** PR10 — Frontend baseline audit (no production code changes)  
**Pages scanned:** 19 page components, 16 shared components, 25 shadcn/ui primitives, 10 exam components, 2 question components, 2 settings components, 9 lib utilities, 2 hooks

---

## 1. Page Audit

| Page | Route | Purpose | Current UI Problems | Severity |
|---|---|---|---|---|
| LoginPage | `/login` | Auth entry | FieldError missing `role="alert"` for screen readers; no "forgot password" link (Phase 1 OK); no keyboard shortcut hints | Low |
| DashboardPage | `/admin/dashboard` | Admin overview | StatsCard has no hover/focus state; "创建考试" and "导入题目" buttons lack loading state; Skeleton loader is plain (no rounded corners on cards) | Low |
| UsersPage | `/admin/users` | User CRUD | No search/filter; table has no empty-state action button; save dialog has no loading indicator on submit button; toggle has no confirmation | Medium |
| CandidatesPage | `/admin/candidates` | Candidate CRUD + import | **Search has no clear button**; search no-results shows empty state but no way to reset except manually deleting search text; save dialog has no loading state on save button; toggle has no confirmation | **Critical** |
| CandidateFieldsPage | `/admin/candidate-fields` | Field config | No error handling on `save()`, `remove()`, `move()`, `drop()` — all throw unhandled; drag-drop has no visual feedback; no loading state on save | High |
| CoursePage | `/admin/courses` | Course CRUD | Search has no clear button; save dialog has loading state (good); search no-results shows empty state but no reset path | Medium |
| QuestionPage | `/admin/questions` | Question list + filters | Has "清空筛选" button (good); no skeleton loader; search/filter state not URL-synced; pagination is simple prev/next only | Low |
| QuestionEditPage | `/admin/questions/:id/edit` | Question form | Save button has loading state (good); error is swallowed — `catch {}` block with comment "error handled by api client" but no user feedback; no unsaved-changes guard | High |
| QuestionImportPage | `/admin/questions/import` | CSV import | Has "校验导入数据" → "确认导入" flow (good); error state is set but never cleared on retry; no "返回题目列表" until after import result | Medium |
| ExamPage | `/admin/exams` | Exam list | No search/filter; delete uses ConfirmDialog (good); disabled delete has tooltip (good); no loading skeleton | Low |
| ExamCreatePage | `/admin/exams/new` | Exam creation | Large form with no unsaved-changes guard; error handling in catch block is empty; no success feedback after creation | High |
| ExamDetailPage | `/admin/exams/:id` | Exam detail + enrollment | Publish has loading state (good); archive has loading state (good); enrollment add dialog has no search; "操作日志" tab shows placeholder; publishError banner has no dismiss | Medium |
| ScoreListPage | `/admin/exams/:id/scores` | Score list | Search input is non-functional (no onChange handler); tabs filter works (good); pagination works (good) | **Critical** |
| ResultsOverviewPage | `/admin/results` | Results overview | No search/filter on exam list; disabled "查看成绩" has tooltip (good) | Low |
| AttemptDetailPage | `/admin/attempts/:id` | Attempt detail | No loading skeleton; "返回" uses `navigate(-1)` which may go to wrong page | Low |
| SettingsPage | `/admin/settings` | Branding + password | Two forms on one page; no success toast after save (relies on internal component feedback) | Low |
| SystemHealthPage | `/admin/system` | System health | Auto-refresh works (good); skeleton loader works (good); no manual refresh loading state toggle | Low |
| ExamListPage | `/exam/list` | Candidate exam list | No search; cards have no hover state; no refresh button | Low |
| StartExamPage | `/exam/:examId/start` | Exam start | Queue polling works (good); error handling is good with specific error codes; no back button to exam list | Medium |
| TakeExamPage | `/exam/:attemptId/take` | Exam runtime | Save indicator works (good); disconnect alert works (good); submit flush works (good); duplicate flag button in header and footer is confusing | Medium |
| ResultPage | `/exam/:attemptId/result` | Exam result | Loading/error states work; "返回考试列表" button works; no print/export option | Low |

---

## 2. List / Table Audit

| Page | List/Table | Search | Filter | Empty State | Loading State | Error State | Reset Path | Problems |
|---|---|---|---|---|---|---|---|---|
| UsersPage | User table | None | None | Yes (no action) | Full-page spinner | Full-page error+retry | N/A | No search at all; empty state has no "新增用户" action |
| CandidatesPage | Candidate table | Inline search | None | Yes (with search context) | Full-page spinner | Full-page error+retry | **No clear/reset button** | **Search has no clear button; no way to reset except manual delete** |
| CoursePage | Course table | Inline search | None | Yes (with search context) | Full-page spinner | Full-page error+retry | **No clear/reset button** | **Search has no clear button; no way to reset except manual delete** |
| QuestionPage | Question table | Inline search | Course, type, difficulty, tags | Yes (generic) | Inline spinner | Full-page error+retry | **Has "清空筛选" button** | Good reset path; no skeleton loader |
| ExamPage | Exam table | None | None | Yes | Full-page spinner | Full-page error+retry | N/A | No search/filter |
| ExamDetailPage | Enrollment table | None | None | Yes | Full-page spinner | Full-page error+retry | N/A | No search on enrollment list |
| ScoreListPage | Score table | Input present (non-functional) | Tabs (all/passed/failed) | Yes | Full-page spinner | Full-page error+retry | N/A | **Search input has no onChange handler — completely non-functional** |
| ResultsOverviewPage | Exam table | None | None | Yes | Full-page spinner | Full-page error+retry | N/A | No search |
| CandidateFieldsPage | Field table | None | None | Yes | Full-page spinner | Full-page error+retry | N/A | No search |
| ExamListPage (candidate) | Card grid | None | None | Yes | Full-page spinner | Full-page error+retry | N/A | No search |

### Critical Findings — Search / Filter / Reset

1. **CandidatesPage**: Search filters client-side but has no clear/reset mechanism. User must manually delete search text to see all candidates. When search yields no results, EmptyState is shown but with no "清除搜索" action.

2. **CoursePage**: Same pattern — search filters client-side, no clear button, no reset path.

3. **ScoreListPage**: Search input is rendered but has **no onChange handler** — it's a completely dead UI element.

4. **QuestionPage**: Only page with proper "清空筛选" button — this should be the pattern for all searchable lists.

---

## 3. Button / Action Audit

| Page | Button Text | Type | Current Behavior | Expected Behavior | Missing State | Severity |
|---|---|---|---|---|---|---|
| LoginPage | "登录" | primary | Submits form, shows "登录中..." | Same | None (good) | — |
| DashboardPage | "创建考试" | primary | Navigates to /admin/exams/new | Same | None | — |
| DashboardPage | "导入题目" | secondary | Navigates to /admin/questions/import | Same | None | — |
| UsersPage | "新增用户" | primary | Opens dialog | Same | None | — |
| UsersPage | "保存" (dialog) | primary | Calls save(), no loading state | Should show "保存中..." and disable during save | **No loading/disabled state** | High |
| UsersPage | "禁用"/"启用" | secondary | Toggles user active state | Should have confirmation for destructive action | **No confirmation dialog** | Medium |
| CandidatesPage | "新增考生" | primary | Opens dialog | Same | None | — |
| CandidatesPage | "导入" | secondary | Opens import wizard | Same | None | — |
| CandidatesPage | "保存" (dialog) | primary | Calls save(), no loading state | Should show "保存中..." and disable during save | **No loading/disabled state** | High |
| CandidatesPage | "禁用"/"启用" | secondary | Toggles candidate active state | Should have confirmation for destructive action | **No confirmation dialog** | Medium |
| CoursePage | "新增课程" | primary | Opens dialog | Same | None | — |
| CoursePage | "保存" (dialog) | primary | Shows "保存中..." | Same | None (good) | — |
| QuestionPage | "新增题目" | primary | Navigates to /admin/questions/new | Same | None | — |
| QuestionPage | "导入题目" | secondary | Navigates to /admin/questions/import | Same | None | — |
| QuestionPage | "清空筛选" | ghost | Resets all filters | Same | None (good) | — |
| QuestionPage | "删除题目" | ghost icon | Opens ConfirmDialog | Same | None (good) | — |
| QuestionEditPage | "保存" | primary | Shows "保存中..." | Same | None (good) | — |
| QuestionEditPage | "取消" | secondary | Navigates back | Same | None | — |
| QuestionImportPage | "下载模板" | secondary | Downloads CSV | Same | None | — |
| QuestionImportPage | "校验导入数据" | primary | Shows "校验中..." | Same | None (good) | — |
| QuestionImportPage | "确认导入" | primary | Shows "导入中..." | Same | None (good) | — |
| ExamPage | "创建考试" | primary | Navigates to /admin/exams/new | Same | None | — |
| ExamPage | "查看详情" | ghost icon | Navigates to exam detail | Same | None | — |
| ExamPage | "删除考试" | ghost icon | Opens ConfirmDialog (if canDelete) | Same | None (good) | — |
| ExamDetailPage | "发布考试" | primary | Shows "发布中..." | Same | None (good) | — |
| ExamDetailPage | "归档" | secondary | Shows "归档中..." | Same | None (good) | — |
| ExamDetailPage | "返回列表" | secondary | Navigates to /admin/exams | Same | None | — |
| ExamDetailPage | "添加考生" | primary (small) | Opens dialog | Same | None | — |
| ExamDetailPage | "添加 (N)" (dialog) | primary | Adds enrollments, shows "添加中..." | Same | None (good) | — |
| ScoreListPage | "导出CSV" | secondary | Opens new tab with CSV URL | Should use authenticated fetch, not raw link | **No auth on export link** | High |
| ScoreListPage | "返回考试详情" | secondary | Navigates to exam detail | Same | None | — |
| ExamListPage (candidate) | "开始考试" | primary | Navigates to start page | Same | None | — |
| ExamListPage (candidate) | "查看结果" | secondary | Navigates to result page | Same | None | — |
| StartExamPage | "开始考试" | primary (lg) | Shows "正在进入..." | Same | None (good) | — |
| TakeExamPage | "交卷" | primary (sm) | Opens submit dialog | Same | None | — |
| TakeExamPage | "上一题" | secondary | Navigates prev | Same | None | — |
| TakeExamPage | "下一题" | secondary | Navigates next | Same | None | — |
| TakeExamPage | "标记" | secondary | Toggles flag | Same | None | — |
| TakeExamPage | "确认交卷" | primary | Shows "提交中..." | Same | None (good) | — |
| TakeExamPage | "仍然提交" | destructive | Submits with failed saves | Same | None (good) | — |
| TakeExamPage | "继续答题" | secondary | Closes dialog | Same | None | — |
| TakeExamPage | "重试" | secondary | Retries flush | Same | None (good) | — |
| ResultPage | "返回考试列表" | primary | Navigates to /exam/list | Same | None | — |
| SettingsPage | (PlatformSettingsForm) | — | Internal save logic | Has loading state internally | None | — |
| SettingsPage | (PasswordChangeForm) | — | Internal save logic | Has loading state internally | None | — |
| CandidateFieldsPage | "下载模板" | secondary | Downloads CSV | Same | None | — |
| CandidateFieldsPage | "添加字段" | primary | Opens dialog | Same | None | — |
| CandidateFieldsPage | "保存" (dialog) | primary | Calls save(), no loading state | Should show "保存中..." and disable | **No loading/disabled state** | High |
| CandidateFieldsPage | "上移"/"下移" | ghost icon | Moves field order | Same | None | — |
| CandidateFieldsPage | "编辑字段" | ghost icon | Opens dialog | Same | None | — |
| CandidateFieldsPage | "删除字段" | ghost icon | Opens ConfirmDialog | Same | None (good) | — |
| SystemHealthPage | "刷新" | secondary (sm) | Reloads health data | Same | None | — |

### Critical Findings — Buttons

1. **UsersPage "保存"**: No loading/disabled state during save — user can double-click.
2. **CandidatesPage "保存"**: Same — no loading/disabled state.
3. **CandidateFieldsPage "保存"**: Same — no loading/disabled state.
4. **ScoreListPage "导出CSV"**: Opens raw URL without authentication — CSV export may fail or expose unauthenticated data.
5. **UsersPage/CandidatesPage "禁用/启用"**: No confirmation dialog for destructive toggle action.

---

## 4. Form / Validation Audit

| Page | Form | Client Validation | Server Validation | Field Error | Form Error | Current Problem |
|---|---|---|---|---|---|---|
| LoginPage | Login form | Yes (username, password required) | Via AuthContext | Yes (inline) | Yes (alert div) | None |
| UsersPage | Create/Edit user | Yes (name, username, password) | Via API — error shown via toast | Yes (inline) | No form-level error | **Server field errors not mapped to field positions** |
| CandidatesPage | Create/Edit candidate | Yes (name, username, password, custom fields) | Via API — `setSaveError("保存失败，请重试")` | Yes (inline) | **Generic "保存失败" always** | **Server errors always overwritten by generic message** |
| CandidateFieldsPage | Create/Edit field | Minimal (name, label required) | Via API — **no error handling at all** | No | No | **All API errors unhandled — will crash or silently fail** |
| CoursePage | Create/Edit course | Yes (name, code required) | Via API — toast | Yes (inline) | No | Toast shows generic "保存失败，请稍后重试" |
| QuestionEditPage | Question form | Yes (via QuestionForm) | Via API — **catch block is empty** | Yes (internal) | **No error shown** | **Errors silently swallowed** |
| QuestionImportPage | CSV import | Client-side CSV parsing | Via API — error state set | No field errors | Yes (error state) | Error state set but not cleared on retry |
| ExamCreatePage | Exam config form | Yes (via ExamConfigForm) | Via API — **catch block is empty** | Yes (internal) | **No error shown** | **Errors silently swallowed** |
| ExamDetailPage | Add enrollment dialog | None (picker) | Via API — toast | No | No | Toast shows server message directly |
| SettingsPage | Platform settings | Via react-hook-form | Via API — toast (inside form) | Yes (internal) | No | None |
| SettingsPage | Password change | Via react-hook-form | Via API — toast (inside form) | Yes (internal) | No | None |
| TakeExamPage | Answer save | None (auto-save) | Via save protocol | Inline alert | Inline alert | Save rejection display is good |

### Critical Findings — Forms

1. **CandidateFieldsPage**: `save()`, `remove()`, `move()`, `drop()` have **zero error handling** — all `await api.*` calls are unprotected. Any server error will result in an unhandled promise rejection.

2. **QuestionEditPage**: `handleSave()` catch block is empty — errors are silently swallowed. User sees no feedback on save failure.

3. **ExamCreatePage**: Same — `handleCreate()` catch block is empty.

4. **CandidatesPage**: `save()` catch block always sets `setSaveError("保存失败，请重试")` regardless of the actual server error. The real error message from `ApiError` (which may contain specific info like "用户名已存在") is discarded.

5. **Server field errors**: No page maps backend `fieldErrors` (from VALIDATION_ERROR response) to field positions. All forms rely on client-side validation only.

---

## 5. Error Message Audit

### Backend Error Codes vs Frontend Display

| Backend Code | Backend Message (zh-CN) | Current Frontend Display | Location | Problem |
|---|---|---|---|---|
| `AUTH_REQUIRED` | 请先登录 | Redirect to /login | api.ts:68-70 | OK |
| `AUTH_INVALID_CREDENTIALS` | 用户名或密码错误 | Via AuthContext → LoginPage error | AuthContext.tsx | OK |
| `PERMISSION_DENIED` | 无权执行此操作 | Via i18n → toast/error | api.ts:60-61 | OK |
| `VALIDATION_ERROR` | 请求参数无效 | **Generic fallback "操作失败，请重试"** | i18n.ts:17 | **fieldErrors from details not displayed** |
| `RESOURCE_NOT_FOUND` | 资源不存在 | Via i18n → toast/error | api.ts:60-61 | OK |
| `RESOURCE_CONFLICT` | 资源状态冲突 | Via i18n → toast/error | api.ts:60-61 | OK |
| `USER_ALREADY_EXISTS` | 用户名已存在 | Via i18n → **but overwritten in CandidatesPage** | CandidatesPage.tsx:168 | **Lost — generic "保存失败" shown** |
| `CANDIDATE_IDENTITY_CONFLICT` | 身份信息已存在 | Via i18n → **but overwritten in CandidatesPage** | CandidatesPage.tsx:168 | **Lost — generic "保存失败" shown** |
| `INVALID_STATE_TRANSITION` | 当前状态不允许执行此操作 | Via i18n → toast | api.ts:60-61 | OK |
| `QUESTION_COURSE_MISMATCH` | 题目不属于所选课程 | Via i18n → **but swallowed in QuestionEditPage** | QuestionEditPage.tsx:105-106 | **Silently swallowed** |
| `MAX_ATTEMPTS_REACHED` | 已达到最大考试次数 | Explicit switch in StartExamPage | StartExamPage.tsx:76 | OK |
| `EXAM_ALREADY_PASSED` | 本场考试已通过 | Explicit switch in StartExamPage | StartExamPage.tsx:79 | OK |
| `EXAM_NOT_OPEN` | 考试尚未开放 | Explicit switch in StartExamPage | StartExamPage.tsx:82 | OK |
| `ATTEMPT_CLOSED` | 考试已结束 | TakeExamPage save rejection | TakeExamPage.tsx:66 | OK |
| `DEADLINE_EXCEEDED` | 考试时间已到 | TakeExamPage save rejection | TakeExamPage.tsx:53 | OK |
| `ENROLLMENT_NOT_REMOVABLE` | 已开始的报名不能移除 | Via i18n → toast | api.ts:60-61 | OK |
| Network failure | — | "网络连接失败，请稍后重试" | api.ts:83 | OK (generic is correct here) |
| Unknown error | 操作失败，请重试 | Generic fallback | i18n.ts:17 | OK (correct fallback) |

### Critical Findings — Error Messages

1. **CandidatesPage `save()`**: Catches all errors and displays `setSaveError("保存失败，请重试")`, discarding the actual `ApiError.message` which may contain specific info like "用户名已存在" or "身份信息已存在".

2. **QuestionEditPage `handleSave()`**: Catch block is completely empty — errors are silently swallowed. `QUESTION_COURSE_MISMATCH` and other validation errors are never shown to user.

3. **ExamCreatePage**: Same — empty catch block.

4. **VALIDATION_ERROR with fieldErrors**: The backend returns `details` with field-level errors, but the frontend never extracts or displays them. `i18n.ts` resolves the message but doesn't pass `details` to forms.

5. **CandidateFieldsPage**: All API calls have no error handling — server errors result in unhandled promise rejections.

---

## 6. Visual Baseline Audit

| Area | Current Problem | Expected Baseline |
|---|---|---|
| **font-family** | Defined in index.css as `Noto Sans CJK SC` with good fallback stack | OK — self-hosted Noto Sans CJK SC is loaded. Verify font files are actually served. |
| **h1 (PageHeader)** | `text-2xl font-semibold` — consistent across all pages | OK but no `tracking-tight` for large headings |
| **h2 (Section titles)** | `text-lg font-semibold` used in ExamListPage; `text-base` used in cards | **Inconsistent** — should be `text-lg` for section headings, `text-base` for card titles |
| **h3** | Not used — missing | Should exist for subsection headings |
| **body text** | `text-sm text-muted-foreground` for descriptions | OK |
| **labels** | `<Label>` from shadcn used consistently | OK but some forms use `<Label>` without `htmlFor` |
| **buttons** | Mix of `variant="default"`, `variant="outline"`, `variant="ghost"`, `variant="destructive"` | **No consistent button hierarchy** — primary/secondary/ghost usage is ad-hoc |
| **inputs** | shadcn `<Input>` used consistently | OK |
| **tables** | shadcn `<Table>` used consistently; no striped rows; no hover state customization | **Tables lack hover state** — default shadcn table has no row hover |
| **cards** | `Card` with `shadow-sm` used on most pages | **Inconsistent shadow** — some cards have `shadow-sm`, some don't |
| **empty state** | `EmptyState` component used consistently with icon + title + description | OK — but some have action buttons, some don't |
| **error state** | `ErrorState` component used consistently with icon + message + retry | OK — consistent pattern |
| **loading state** | `LoadingState` with spinner used; Dashboard and SystemHealth have skeleton loaders | **Inconsistent** — some pages have skeleton, most have spinner |
| **success state** | No dedicated success component — relies on toast | Should have inline success feedback for critical actions |
| **danger state** | `text-destructive` used for errors and destructive buttons | OK |
| **spacing** | `gap-6` for page sections, `gap-4` for card grids, `gap-3` for smaller groups | Mostly consistent but not codified |
| **borders** | `border` on cards, `border-dashed` on empty/error states | OK |
| **color variables** | OKLCH tokens defined in index.css for primary, secondary, success, warning, destructive, info, neutral, muted, accent | OK — good token system |
| **border-radius** | Default shadcn radius (not customized) | OK |
| **shadows** | `shadow-sm` on some cards, none on others | **Inconsistent** — should standardize |
| **StatusBadge** | Consistent use across pages with tone-based coloring | OK |
| **PageHeader** | Consistent pattern with title + actions | OK but some pages add `description`, some don't |
| **Card titles** | Mix of `text-base`, `text-lg`, `text-sm` | **Inconsistent** — should standardize |
| **Muted text** | `text-muted-foreground` used consistently | OK |
| **Tab navigation** | ExamDetailPage uses Tabs, ScoreListPage uses Tabs | OK |
| **Responsive** | Tables are not responsive — may overflow on mobile | **No mobile table strategy** |

### Critical Findings — Visual

1. **No mobile table strategy**: All tables use fixed-width columns with no responsive behavior. On mobile, tables will overflow or require horizontal scrolling.

2. **Inconsistent card shadows**: Some cards have `shadow-sm`, some don't. No standard.

3. **Inconsistent heading hierarchy**: `text-lg`, `text-base`, `text-2xl` used without clear rules.

4. **No skeleton loaders on most pages**: Only Dashboard and SystemHealth have skeleton loaders. All other pages show a full-page spinner.

5. **Button hierarchy not codified**: No clear primary/secondary/ghost usage rules. Same action (e.g., "save") uses different variants across pages.

---

## Summary

| Category | Count | Critical |
|---|---|---|
| Page-level UI problems | 19 findings | 1 |
| List/Table search/filter/reset problems | 10 findings | 3 |
| Button/action problems | 8 findings | 2 |
| Form/validation problems | 12 findings | 3 |
| Error message problems | 8 findings | 3 |
| Visual baseline problems | 14 findings | 1 |
| **Total** | **71 findings** | **13** |

### Critical Issues (Must Fix)

1. **CandidatesPage search has no clear/reset mechanism** — users trapped in search state
2. **ScoreListPage search input is non-functional** — no onChange handler
3. **CandidateFieldsPage has zero error handling** on all API calls
4. **QuestionEditPage silently swallows errors** — empty catch block
5. **ExamCreatePage silently swallows errors** — empty catch block
6. **CandidatesPage discards server error messages** — always shows generic "保存失败"
7. **UsersPage save button has no loading state** — allows double-submit
8. **CandidatesPage save button has no loading state** — allows double-submit
9. **CandidateFieldsPage save button has no loading state** — allows double-submit
10. **ScoreListPage "导出CSV" opens raw URL without auth** — may fail or expose data
11. **Server VALIDATION_ERROR fieldErrors not displayed** — always generic message
12. **No mobile table strategy** — tables overflow on small screens
13. **UsersPage/CandidatesPage toggle has no confirmation** — destructive action without guard
