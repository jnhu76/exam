# PR10 Frontend UI / UX Baseline Audit — Round 2

> Authority: [SPEC.md](../../../SPEC.md) defines product invariants; [phase-roadmap.md](../../../phase-roadmap.md) defines Phase 1 scope and deferred capabilities.

**Date:** 2026-06-15
**Directory:** `docs/audits/pr10-frontend-baseline-round2/`
**Scope:** 第二轮补充审计。只审计前端 UI / UX / Action Contract，不修改生产代码。

## 0. Method and Evidence

Scanned: `apps/web/src/App.tsx`, `main.tsx`, `lib/routes.ts`, `lib/api.ts`, `lib/i18n.ts`, `index.css`, all page files under `apps/web/src/pages`, and shared/layout/exam/question/settings/ui components.

Context7 docs checked: React official docs for form pending/error state and disabled submit behavior; shadcn/ui docs for Button, Form field errors, AlertDialog confirmation, Table empty state, and Sonner feedback.

Round 2 corrections vs Round 1:

1. `FieldError` already renders `role="alert"`; LoginPage field-error accessibility is not a current issue.
2. `ExamCreatePage` now shows generic toast on save failure; the issue is server-specific message loss, not silent failure.
3. `SettingsPage.handleSave()` still swallows branding save errors and has no success toast; this is Critical.
4. `CandidatesPage` search is worse than missing clear button: the search input disappears when no results are found.
5. `QuestionPage` has reset, but search is client-side over the current loaded page only, while filters are server-side.

## 1. Page Audit

| Page | Route | Purpose | Main Components | Current UI Problems | Severity |
|---|---|---|---|---|---|
| LoginPage | `/login` | Login | `BrandHeader`, `Card`, `FieldError`, `Button` | Loading/disabled/error states mostly correct. Minimal visual baseline; no account help text, acceptable because reset lifecycle is Phase 3. | Low |
| DashboardPage | `/admin/dashboard` | Admin overview | `StatsCard`, `Skeleton`, `Card`, `Table` | Has skeletons. Recent exams table lacks responsive wrapper/row hover; quick actions are visually loose. | Low |
| UsersPage | `/admin/users` | Admin user CRUD | `Dialog`, `FieldGroup`, `Table`, `Badge` | No search/filter; save lacks loading/disabled; enable/disable lacks confirmation; labels lack `htmlFor`; no backend field error mapping. | High |
| CandidatesPage | `/admin/candidates` | Candidate CRUD/import/search | `ImportWizard`, `Dialog`, `Table`, `EmptyState` | No-result search hides search input; no clear/reset; save lacks loading; server error overwritten by generic text; enable/disable lacks confirmation. | Critical |
| CandidateFieldsPage | `/admin/candidate-fields` | Candidate field config | `Dialog`, `ConfirmDialog`, `Table`, drag/drop | `save/remove/move/drop/download` lack robust loading/error handling; no field validation messages; drag/drop lacks keyboard path. | Critical |
| CoursePage | `/admin/courses` | Course CRUD/search | `Dialog`, `ConfirmDialog`, `Tooltip`, `Table` | Search no clear button; no-results has no reset action; save failure generic; table lacks responsive wrapper. | High |
| QuestionPage | `/admin/questions` | Question list/filter/delete | `Select`, `Input`, `ConfirmDialog`, `Table` | Reset exists, but search filters only current page; empty copy says `暂无题目` for active filters; delete error generic. | High |
| QuestionEditPage | `/admin/questions/new`, `/admin/questions/:id/edit` | Question create/edit | `QuestionForm`, `QuestionPreview` | Save errors swallowed by empty catch; no form-level server error; no unsaved-change guard. | Critical |
| QuestionImportPage | `/admin/questions/import` | CSV import | `FileUpload`, `Select`, `Table`, `Badge` | Import failure replaces workflow with page-level `ErrorState`; retry reloads courses, not import; production template contains scenario examples. | High |
| ExamPage | `/admin/exams` | Exam list/delete | `DataToolbar`, `DataTableShell`, `ConfirmDialog` | Better shared shell usage; no search/filter; empty state lacks create action; table lacks responsive wrapper. | Medium |
| ExamCreatePage | `/admin/exams/new` | Create/publish exam | `ExamConfigForm`, `Dialog`, `Table` | Generic save error loses backend reason; disabled `随机选题 [Phase 2]` exposed; Phase 2 flags visible/editable. | Critical |
| ExamDetailPage | `/admin/exams/:id` | Detail/enrollment/scores | `Tabs`, `EnrollmentPicker`, `Dialog`, `Card` | Archive lacks confirmation; enrollment picker search has no clear and searches only loaded candidates; `操作日志` placeholder exposed. | High |
| ScoreListPage | `/admin/exams/:id/scores` | Scores/export | `Tabs`, `Input`, `Pagination`, `Table` | Search input is dead; CSV export bypasses `api` client; no export loading/error state; pagination unbounded. | Critical |
| ResultsOverviewPage | `/admin/results` | Results overview | `Card`, `Table`, `Tooltip` | No search/filter; disabled tooltip is good; table not responsive; empty state lacks next action. | Medium |
| AttemptDetailPage | `/admin/attempts/:id` | Attempt details | `Card`, `Table`, `StatusBadge` | Error state has only retry; `navigate(-1)` return unreliable; table truncates important answers. | High |
| SettingsPage | `/admin/settings` | Branding/password | `FormSection`, `PlatformSettingsForm`, `PasswordChangeForm` | Branding save errors swallowed; no success toast; no server validation display. | Critical |
| SystemHealthPage | `/admin/system` | Health status | `Skeleton`, `Card`, `Button` | Manual refresh triggers full-page skeleton/layout jump; no inline refreshing; error discards stale data. | Medium |
| ExamListPage | `/exam/list` | Candidate exam list | `Card`, `Badge`, `Button` | No page h1; no refresh/search; active/resume state not explicit. | Medium |
| StartExamPage | `/exam/:examId/start` | Exam pre-start | `Card`, `ErrorState`, `Button` | Specific start errors good; no back button; queue UI exists though queue admission is Phase 2/planned. | High |
| TakeExamPage | `/exam/:attemptId/take` | Exam runtime | `QuestionNav`, `ExamTimer`, `SaveIndicator`, `Dialog` | Strong save/submit contract. Gaps: submit failure generic; duplicate flag button; heartbeat error lacks retry/backoff detail. | Medium |
| ResultPage | `/exam/:attemptId/result` | Result view | `Card`, `Table`, `ErrorState` | Details table not responsive; disrupted copy mentions proctor although Proctor is not Phase 1 product role. | High |

## 2. List / Table Audit

| Page | List/Table | Search | Filter | Empty State | Loading State | Error State | Reset Path | Problems |
|---|---|---|---|---|---|---|---|---|
| CandidatesPage | Candidate table | Client-side | None | Yes | Spinner | ErrorState + retry | Broken | Search input hidden on no results; no clear/reset action. |
| CoursePage | Course table | Client-side | None | Yes | Spinner | ErrorState + retry | Weak | No clear button; no reset action. |
| QuestionPage | Question table | Client-side current page | Server filters | Generic | Initial + inline spinner | ErrorState + retry | Good button | Mixed client/server semantics; misleading empty state. |
| QuestionImportPage | Preview/results | None | Course select | Missing parsed-empty | Button loading | Page-level ErrorState | Partial | Failed import recovery wrong; no row field placement. |
| ExamCreatePage | Question picker | None | None | Missing | Dialog only | None | N/A | Empty dialog table; no search/filter. |
| ExamDetailPage | EnrollmentPicker | Local loaded-page search | Enrolled disabled | Text only | Load more loading | Toast | Weak | No clear; only searches loaded candidates. |
| ScoreListPage | Score table | Dead input | Pass tabs | Yes | Spinner | ErrorState + retry + back | None | Search has no state/query; export bypasses API client. |
| All table pages | Tables | Mixed | Mixed | Mixed | Mixed | Mixed | Mixed | Most raw tables lack responsive overflow wrapper. |

Critical list/table issues: CandidatesPage no-result search hides reset affordance; ScoreListPage search is non-functional; QuestionPage can falsely report no results; most tables lack responsive overflow wrapper; import failures replace the whole workflow.

## 3. Button / Action Audit

| Page | Button Text | Type | Current Behavior | Expected Behavior | Missing State | Severity |
|---|---|---|---|---|---|---|
| UsersPage | 保存 | primary | Async save without disabled/loading | Disable, show saving, preserve server error | Loading, duplicate guard | High |
| UsersPage | 禁用/启用 | secondary/danger | Direct patch | Confirm, loading, specific error | Confirmation, pending | High |
| CandidatesPage | 保存 | primary | Async save; generic error | Disable; show `ApiError.message`; map field errors | Loading, server error preservation | Critical |
| CandidateFieldsPage | 保存 | primary | Async call, no catch/loading | Disable; field/form errors; success feedback | Loading, error, validation | Critical |
| CandidateFieldsPage | 上移/下移/删除 | icon/danger | Async reorder/delete no pending/catch | Disable affected buttons; show error | Pending, error | High |
| QuestionEditPage | 保存 | primary | Loading; errors swallowed | Show form-level/server message | Error feedback | Critical |
| ExamCreatePage | 随机选题 [Phase 2] | secondary disabled | Future feature exposed | Hide from Phase 1 runtime | Phase boundary | Critical |
| ExamCreatePage | 保存草稿/发布考试 | secondary/primary | Loading; generic error | Preserve server error; maybe confirm publish | Specific error | High |
| ExamDetailPage | 归档 | secondary/danger | Direct archive with loading | Confirm archive | Confirmation | High |
| ScoreListPage | 导出CSV | secondary | Creates raw anchor URL | Authenticated fetch download + loading/error | Loading, error, auth contract | Critical |
| ScoreListPage | 搜索考生 input | control | Dead | URL/API-bound search or remove | Entire behavior | Critical |
| AttemptDetailPage | 返回 | secondary | `navigate(-1)` | Explicit route fallback | Deterministic target | High |
| SettingsPage | 保存设置 | primary | Parent swallows errors; no success feedback | Toast success/error; preserve server message | Success and error feedback | Critical |
| SystemHealthPage | 刷新 | icon | Full-page reload skeleton | Inline refresh pending, preserve stale data | Non-disruptive loading | Medium |
| TakeExamPage | 交卷/确认交卷 | primary | Good flush/disable behavior | Preserve specific submit error | Specific error | Medium |

## 4. Form / Validation Audit

| Page | Form | Client Validation | Server Validation | Field Error | Form Error | Current Problem |
|---|---|---|---|---|---|---|
| LoginPage | Login | Required fields | Auth context | Yes | Yes | Good baseline. |
| UsersPage | Create/edit user | Local required/min password | Toast only | Local only | Toast only | No backend fieldErrors mapping; no saving state. |
| CandidatesPage | Create/edit candidate | Local required/custom field | Generic inline error | Local only | Generic | Loses `ApiError.message` and details; no saving state. |
| CandidateFieldsPage | Field dialog | Only early return | None visible | No | No | Invalid input silently no-ops; API errors unhandled. |
| CoursePage | Course dialog | Local name/code | Generic toast | Local only | Toast | Backend message discarded on save. |
| QuestionEditPage | Question form | Component validation | Swallowed | Component/local | No | `QUESTION_COURSE_MISMATCH` and validation errors invisible. |
| QuestionImportPage | CSV import | Parser preview | Page ErrorState | Row status only | Page-level | Import error loses workflow context; retry wrong. |
| ExamCreatePage | Exam config | Local summary validation | Generic toast | Partial | Toast | Server reason/code lost; Phase 2-only config visible. |
| SettingsPage | Branding | react-hook-form, no rules | Swallowed | No | No | Branding save can fail silently. |
| TakeExamPage | Answer save/submit | Input components | Save protocol | Inline save rejection | Alerts/toast | Submit API error generic. |

## 5. Error Message Audit

| Backend code/reason | Current Frontend Message | Expected Message | Location |
|---|---|---|---|
| `VALIDATION_ERROR` with field details | Usually generic/top-level only | Field errors near inputs + form summary | `api.ts`, forms |
| `USER_ALREADY_EXISTS` | Preserved in UsersPage, overwritten in CandidatesPage | Specific username conflict message | `CandidatesPage.save` |
| `CANDIDATE_IDENTITY_CONFLICT` | `保存失败，请重试` | Specific identity conflict message | `CandidatesPage.save` |
| `QUESTION_COURSE_MISMATCH` | No visible message | `题目不属于所选课程` | `QuestionEditPage.handleSave` |
| Exam create/publish errors | `保存失败，请稍后重试` | Backend `ApiError.message` | `ExamCreatePage.handleSave` |
| Branding settings error | No visible message | Backend `ApiError.message` toast/form error | `SettingsPage.handleSave` |
| CandidateFields API failures | Unhandled promise rejection or silent no-op | Specific toast/form error | `CandidateFieldsPage` |
| Submit attempt error | `提交失败，请重试` | Specific state/deadline/already submitted message | `TakeExamPage.handleSubmit` |
| Network failure | `网络连接失败，请稍后重试` | Generic network fallback is OK | `api.ts` |

## 6. Visual Baseline Audit

| Area | Current Problem | Expected Baseline |
|---|---|---|
| font-family | Good stack starts with `Noto Sans CJK SC`, but no evidence font file is bundled; may fall back to system fonts. | LAN/offline-safe font strategy; document bundled/system fallback. |
| h1 | Admin `PageHeader` is consistent, candidate pages sometimes omit h1. | One h1 per page. |
| h2/h3 | Mixed `text-lg`, `text-base`, `text-sm`; card titles vary. | Codified heading scale. |
| Buttons | Variant hierarchy ad hoc; future disabled buttons exposed. | Variants mapped to action semantics. |
| Inputs | Labels often lack `htmlFor`; search clear missing. | Label association, clear search, reset filter contract. |
| Tables | Raw tables used widely; mobile overflow likely. | Shared responsive table wrapper. |
| Cards | `shadow-sm` inconsistent. | One card elevation rule. |
| Empty state | Actions inconsistent; no-result copy often generic. | Empty/no-results differentiated with actions. |
| Loading state | Mixed skeleton/full spinner/button text; refresh layout jump. | Skeleton for page load, inline pending for refresh. |
| Error state | Action errors often swallowed/generic. | Specific error preservation with retry/back. |
| Success state | Mostly toast, sometimes none. | Toast or inline success for all async mutations. |
| Danger state | Delete confirmed; disable/archive not consistently confirmed. | Confirmation for destructive/irreversible actions. |
| Phase boundary copy | Phase 2 controls/placeholders visible in Phase 1 UI. | Hide future product paths from current runtime. |

## Summary

| Category | Count | Critical |
|---|---:|---:|
| Page-level UI/UX findings | 21 | 7 |
| List/table findings | 8 | 4 |
| Button/action findings | 15 | 7 |
| Form/validation findings | 10 | 4 |
| Error message findings | 9 | 5 |
| Visual baseline findings | 13 | 2 |
| Total | 76 | 29 |

Critical issues to fix first:

1. CandidatesPage no-result search hides search/reset path.
2. ScoreListPage search input is dead.
3. ScoreListPage CSV export bypasses typed authenticated API client and has no action state.
4. QuestionEditPage save swallows backend errors.
5. SettingsPage branding save swallows backend errors and success feedback.
6. CandidateFieldsPage mutation actions lack loading/error handling.
7. ExamCreatePage exposes Phase 2 controls/future random selection in Phase 1 runtime.
8. Server validation details are not mapped to form fields.
9. Candidate save loses business errors such as username/identity conflicts.
10. Most tables lack responsive baseline.

Recommended next PR slices:

- PR11A: Search/reset contracts for CandidatesPage, CoursePage, ScoreListPage, EnrollmentPicker.
- PR11B: Error preservation and field error mapper for API/forms.
- PR11C: Button loading/confirmation contracts for Users/Candidates/CandidateFields/ExamDetail.
- PR11D: Hide Phase 2 controls/placeholders from current Phase 1 runtime.
- PR12: Visual table/card/heading/loading baseline pass.
