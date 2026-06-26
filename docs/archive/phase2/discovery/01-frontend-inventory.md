# Frontend Inventory — Phase 1 Discovery

> Generated from code scan. All facts verified against source.

## 1. Route Map

| Path | Component | Role | Status |
|------|-----------|------|--------|
| `/login` | `LoginPage` | Public | implemented |
| `/admin` → redirect | `AdminLayout` | Admin | implemented |
| `/admin/dashboard` | `DashboardPage` | Admin | implemented |
| `/admin/system` | `SystemHealthPage` | Admin | implemented |
| `/admin/settings` | `SettingsPage` | Admin | implemented |
| `/admin/candidate-fields` | `CandidateFieldsPage` | Admin | implemented |
| `/admin/users` | `UsersPage` | Admin | implemented |
| `/admin/candidates` | `CandidatesPage` | Admin | implemented |
| `/admin/courses` | `CoursePage` | Admin | implemented |
| `/admin/questions` | `QuestionPage` | Admin | implemented |
| `/admin/questions/new` | `QuestionEditPage` | Admin | implemented |
| `/admin/questions/:id/edit` | `QuestionEditPage` | Admin | implemented |
| `/admin/questions/import` | `QuestionImportPage` | Admin | implemented |
| `/admin/exams` | `ExamPage` | Admin | implemented |
| `/admin/exams/new` | `ExamCreatePage` | Admin | implemented |
| `/admin/exams/:id` | `ExamDetailPage` | Admin | implemented |
| `/admin/exams/:id/scores` | `ScoreListPage` | Admin | implemented |
| `/admin/results` | `ResultsOverviewPage` | Admin | implemented |
| `/admin/attempts/:id` | `AttemptDetailPage` | Admin | implemented |
| `/admin/*` | `PlaceholderPage` | Admin | dead-ui |
| `/exam` → redirect | `ExamLayout` | Candidate | implemented |
| `/exam/list` | `ExamListPage` | Candidate | implemented |
| `/exam/:examId/start` | `StartExamPage` | Candidate | implemented |
| `/exam/:attemptId/take` | `TakeExamPage` | Candidate | implemented |
| `/exam/:attemptId/result` | `ResultPage` | Candidate | implemented |
| `/exam/*` | `PlaceholderPage` | Candidate | dead-ui |
| `*` (fallback) | redirect to `/login` | Public | implemented |

## 2. Layouts

| Layout | Children | Features |
|--------|----------|----------|
| `AdminLayout` | All `/admin/*` routes | Sidebar nav, BrandProvider, auth guard |
| `ExamLayout` | All `/exam/*` routes | Minimal chrome, auth guard |
| `BrandProvider` | Wraps entire app | Loads remote branding, provides `useBranding()` |
| `AuthProvider` | Wraps routes | Session restore, `useAuth()` |
| `ErrorBoundary` | Top-level | Catches render errors |

## 3. Admin Pages Detail

### DashboardPage
- **API**: `GET /api/system/dashboard`
- **Components**: Stats cards (totalQuestions, activeExams, totalCandidates, todayExams), recent exams list
- **Buttons**: None (read-only)
- **Error handling**: ErrorState component
- **testid**: none found

### UsersPage
- **API**: `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id`, `POST /api/users/:id/reset-password`, `DELETE /api/users/:id`
- **Components**: Table, Dialog (create/edit), form inputs, SearchInput, Pagination, ConfirmDialog
- **Buttons**: 创建用户, 编辑, 重置密码, 停用/启用, 删除
- **Error handling**: toast notifications, inline validation
- **testid**: none found

### CandidatesPage
- **API**: `GET /api/candidates`, `POST /api/candidates`, `PATCH /api/candidates/:id`, `POST /api/candidates/import`
- **Components**: Table, Dialog (create/edit), ImportWizard, SearchInput, Pagination
- **Buttons**: 创建候选人, 编辑, 导入 (CSV), 搜索
- **Error handling**: toast, inline validation, field errors
- **testid**: none found

### CandidateFieldsPage
- **API**: `GET /api/candidate-fields`, `POST /api/candidate-fields`, `PATCH /api/candidate-fields/:id`, `DELETE /api/candidate-fields/:id`
- **Components**: Table, Dialog, form
- **Buttons**: 创建字段, 编辑, 删除
- **Status**: implemented

### CoursePage
- **API**: `GET /api/courses`, `POST /api/courses`, `PATCH /api/courses/:id`, `DELETE /api/courses/:id`
- **Components**: Table, Dialog, form, SearchInput, ConfirmDialog
- **Buttons**: 新建课程, 编辑, 删除
- **Error handling**: toast

### QuestionPage
- **API**: `GET /api/questions`, `DELETE /api/questions/:id`
- **Components**: Table, SearchInput, Select (filter by type/course), Pagination, ConfirmDialog
- **Buttons**: 新建题目, 导入, 编辑 (navigate), 删除
- **Filters**: courseId, type, difficulty, tags

### QuestionEditPage
- **API**: `POST /api/questions`, `PATCH /api/questions/:id`, `GET /api/courses` (for dropdown)
- **Components**: QuestionForm, QuestionPreview
- **Buttons**: 保存, 返回
- **Supports**: Create and Edit modes (determined by `:id` param)

### QuestionImportPage
- **API**: `POST /api/questions/import`, `GET /api/courses`
- **Components**: ImportWizard, form
- **Buttons**: 上传CSV, 确认导入, 取消

### ExamPage
- **API**: `GET /api/exams`
- **Components**: Table, Pagination
- **Buttons**: 创建考试 (navigate), 查看详情 (navigate)
- **Status**: implemented

### ExamCreatePage
- **API**: `POST /api/exams`, `POST /api/exams/:id/publish`, `GET /api/courses`, `GET /api/questions`
- **Components**: ExamConfigForm, Table (selected/available questions), Dialog (question picker)
- **Buttons**: 保存草稿, 发布考试, 手动选题, 取消
- **Config fields**: title, description, courseId, duration, openAt, closeAt, passingScore, totalScore, controlFlags, retakePolicy, scoreStrategy, maxAttempts

### ExamDetailPage
- **API**: `GET /api/exams/:id`, `POST /api/exams/:id/publish`, `POST /api/exams/:id/archive`, `GET /api/exams/:id/enrollments`, `POST /api/exams/:id/enrollments`, `DELETE /api/exams/:id/enrollments/:enrollmentId`, `GET /api/candidates`
- **Components**: Stats cards, Tabs (enrollment/scores), Table (enrollments), EnrollmentPicker, ConfirmDialog
- **Buttons**: 发布考试, 归档, 添加考生, 移除考生, 返回列表, 前往成绩管理

### ScoreListPage
- **API**: `GET /api/exams/:id/scores`, `GET /api/exams/:id/export/scores`
- **Components**: Table, Stats cards (average/max/min/passRate), Tabs (all/pass/fail), Pagination
- **Buttons**: 导出CSV, 查看详情 (navigate)

### ResultsOverviewPage
- **API**: `GET /api/exams` (for exam list), then `GET /api/exams/:id/scores` per exam
- **Components**: Exam selector, score table
- **Status**: implemented

### AttemptDetailPage
- **API**: `GET /api/scores/attempts/:attemptId`
- **Components**: Card (result), Table (question results)
- **Buttons**: 返回

### SettingsPage
- **API**: `GET /api/admin/settings/branding`, `PATCH /api/admin/settings/branding`
- **Components**: PlatformSettingsForm
- **Fields**: productName, productSubtitle, footerText, organizationDisplayName, timezone

### SystemHealthPage
- **API**: `GET /api/system/health`, `GET /api/system/info`
- **Components**: CPU/Memory/DB stats display
- **Status**: implemented

## 4. Candidate Pages Detail

### ExamListPage
- **API**: `GET /api/candidate/exams`
- **Components**: ExamCard (×N), grouped by: canTake / upcoming / others / empty
- **Buttons**: 开始考试 / 继续考试 / 查看成绩 / 查看记录 (per card)
- **Status badges**: available, in_progress, resumable, submitted_pending_grade, graded, max_attempts_exhausted, not_started_yet, expired, unavailable
- **testid**: `exam-card-{examId}`, `exam-best-score`, `exam-primary-action`

### StartExamPage
- **API**: `GET /api/candidate/exams/:examId`, `POST /api/attempts/:examId/start`
- **Components**: Card (exam info), warning alerts, attempt status display
- **Buttons**: 开始考试 / 继续考试 / 再次考试
- **Error handling**: ApiError code switching (MAX_ATTEMPTS_REACHED, EXAM_ALREADY_PASSED, EXAM_NOT_OPEN)
- **testid**: `exam-start-btn`

### TakeExamPage
- **API**: `GET /api/attempts/:id`, `POST /api/attempts/:attemptId/answers/:questionId`, `POST /api/attempts/:attemptId/submit`, `POST /api/attempts/:attemptId/heartbeat`
- **Components**: QuestionNavigator, QuestionRenderer, ExamTimer, SaveIndicator, SubmitConfirmDialog, AnswerPanel, flag toggle
- **Buttons**: 交卷, 上一题, 下一题, 标记/取消标记, 确认交卷, 继续答题, 仍然提交, 重试
- **Features**: 
  - Debounced auto-save (1500ms via `useSubmitFlush`)
  - Heartbeat every 30s
  - Server-side deadline enforcement
  - Disconnect detection
  - Save conflict display (STALE_VERSION, DEADLINE_EXCEEDED, ATTEMPT_ALREADY_SUBMITTED)
  - Submit flush before submission
- **testid**: `take-submit-btn`, `confirm-submit-btn`, `save-rejection-alert`, `take-question-section`

### ResultPage
- **API**: `GET /api/scores/attempts/:attemptId`
- **Components**: Score display, question results table (if showResultImmediately), waiting message
- **Buttons**: 返回考试列表
- **testid**: `result-total-score`, `result-status-message`

## 5. Shared Components

| Component | Location | Usage |
|-----------|----------|-------|
| `LoadingState` | `components/shared/` | All pages - loading spinner |
| `ErrorState` | `components/shared/` | All pages - error with retry |
| `EmptyState` | `components/shared/` | List pages - no data |
| `PageHeader` | `components/shared/` | Admin pages - title + actions |
| `StatusBadge` | `components/shared/` | Status display across pages |
| `ConfirmDialog` | `components/shared/` | Destructive action confirmation |
| `SearchInput` | `components/shared/` | Filtered lists |
| `ListToolbar` | `components/shared/` | QuestionPage toolbar |
| `DataTablePagination` | `components/shared/` | Paginated tables |
| `RowActions` | `components/shared/` | Table row action menu |
| `FieldGroup` / `Field` | `components/shared/` | Form layout |
| `FieldError` | `components/shared/` | Inline validation |
| `InlineErrorBanner` | `components/shared/` | Form-level errors |
| `ImportWizard` | `components/shared/` | CSV import flow |

## 6. API Client (`lib/api.ts`)

- **Methods**: `get`, `post`, `patch`, `delete`
- **Auth**: Cookie-based (`credentials: "include"`)
- **Error handling**: `ApiError` class with status/code/details
- **401 redirect**: Auto-navigate to `/login`
- **Error i18n**: `getMessageForLocale(code)` from `@exam/contracts`
- **Network error**: toast "网络连接失败"

## 7. Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useSubmitFlush` | `hooks/useSubmitFlush.ts` | Debounced save queue + flush before submit |
| `useAuth` | `contexts/AuthContext.tsx` | Auth state, login/logout, session restore |
| `useBranding` | `components/layout/BrandProvider.tsx` | Brand settings from API |

## 8. Dead UI / Placeholders

- `/admin/*` catch-all → `PlaceholderPage` (dead-ui)
- `/exam/*` catch-all → `PlaceholderPage` (dead-ui)
- `ResultsOverviewPage` — exists but has limited scope (exam selector + score view)

## 9. Missing / Not Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| Proctor panel / dashboard | missing | No page, no route |
| Real-time proctor monitoring | missing | No WebSocket, no live status |
| Force submit (admin → candidate) | missing | No UI for this action |
| Extend time (admin → candidate) | missing | No UI for this action |
| Misconduct flagging | missing | No UI for this action |
| Exam room management | missing | No UI |
| IP restriction UI | missing | `controlFlags.restrictIp` exists but no UI to configure |
| Lockdown browser UI | missing | `controlFlags.requireLockdown` exists but no UI |
| Queue management UI | missing | `controlFlags.requireQueue` exists but no UI |
| Audit log viewer | missing | API exists (`GET /api/admin/audit-logs`) but no frontend page |
| Manual grading UI | missing | All grading is auto; no subjective grading interface |
| PDF export | missing | Only CSV export exists |
| Multi-select question random mode | missing | Phase 1 only supports `manual` selection |
