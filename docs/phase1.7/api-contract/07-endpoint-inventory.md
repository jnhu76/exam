# Endpoint Inventory

## 说明

本文件是 A01-A06 的施工地图。每个 endpoint 至少记录以下字段。

### 字段说明

| 字段 | 含义 |
| --- | --- |
| Method | HTTP method |
| Path | URL path pattern |
| Route file | 定义此 endpoint 的源文件 |
| Auth | 认证要求（public / authenticated / role） |
| Current success status | 当前成功时的 HTTP status |
| Current success shape | 当前成功响应的结构类型 |
| Target success status | 目标成功 HTTP status |
| Target success shape | 目标响应结构类型（必须是 01-response-shapes.md 中定义的 taxonomy） |
| Current error shape | 当前错误响应的形状描述 |
| Target error shape | 目标错误形状（ErrorResponse v0 / Command Result） |
| Content-Type | 成功响应的 Content-Type |
| Frontend client | 受影响的前端调用点 |
| Migration job | 负责迁移的 Job 编号 |
| Command semantics | `yes` 如果成功路径是状态机命令（如 publish/archive），否则省略 |
| Conflict behavior | 冲突时的处理方式（如 `409 ErrorResponse`），仅当有 command semantics 时填写 |
| Status | confirmed / pending verification / outdated（见下方定义） |

### Status 定义

| Status | 含义 | 何时设置 |
| --- | --- | --- |
| `pending verification` | 文档已记录但未经验证与当前实现一致 | A00 文档阶段 |
| `confirmed` | 已完成迁移，contract/route/test/OpenAPI 全链路验证通过 | 对应 Job（A01-A04）完成时 |
| `outdated` | 文档描述已与实际实现脱节，需重新审计 | 发现不一致时 |

**规则**：

- A01-A04 每个 Job 完成时，必须把对应 endpoint 的 Status 更新为 `confirmed`。
- 新增 endpoint 必须以 `pending verification` 进入 inventory。
- 发现 endpoint 实际行为与 inventory 描述不一致时，立即标记为 `outdated` 并创建修正任务。
- 只有 `confirmed` 的 endpoint 可以作为 Phase2 的 contract baseline。

### Target success shape 允许值

Target success shape 必须是 [`01-response-shapes.md`](./01-response-shapes.md) 中定义的 taxonomy：

- Resource Response
- List Response
- Command Result Response
- Batch Operation Result / Import Result
- Empty Response / 204
- File Response

不得出现 taxonomy 外的值（如 "import summary"、"command result" 等）。

## auth.ts

### POST /register

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /register |
| Route file | auth.ts:19 |
| Auth | public (bootstrapToken) |
| Current success status | 201 |
| Current success shape | Resource (user) |
| Target success status | 201 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | RegisterPage |
| Migration job | A02 |
| Status | confirmed |

### POST /login

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /login |
| Route file | auth.ts:75 |
| Auth | public |
| Current success status | 200 |
| Current success shape | Resource (user + token) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 (不泄露用户是否存在) |
| Content-Type | application/json |
| Frontend client | LoginPage |
| Migration job | A02 |
| Status | confirmed |

### POST /logout

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /logout |
| Route file | auth.ts:142 |
| Auth | authenticated |
| Current success status | 200 |
| Current success shape | { ok: true } |
| Target success status | 204 |
| Target success shape | Empty Response |
| Current error shape | N/A |
| Target error shape | ErrorResponse v0 |
| Content-Type | N/A (204) |
| Frontend client | header/logout button |
| Migration job | A02 |
| Status | confirmed |

### GET /me

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /me |
| Route file | auth.ts:147 |
| Auth | authenticated |
| Current success status | 200 |
| Current success shape | Resource (user) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 401 via AppError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | auth context |
| Migration job | A02 |
| Status | confirmed |

### PATCH /me/password

| Field | Value |
| --- | --- |
| Method | PATCH |
| Path | /me/password |
| Route file | auth.ts:173 |
| Auth | authenticated |
| Current success status | 200 |
| Current success shape | { success: true } |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 + ValidationErrorDetails |
| Content-Type | application/json |
| Frontend client | ChangePasswordDialog |
| Migration job | A02 |
| Status | confirmed |

## system.ts

### GET /system/info

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /system/info |
| Route file | system.ts:36 |
| Auth | public |
| Current success status | 200 |
| Current success shape | { version, environment } |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | N/A |
| Target error shape | N/A |
| Content-Type | application/json |
| Frontend client | none |
| Migration job | A03 |
| Status | pending verification |

### GET /system/health

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /system/health |
| Route file | system.ts:43 |
| Auth | public |
| Current success status | 200 |
| Current success shape | { status: "ok" } |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 503 { status: "unhealthy" } |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | health check / monitoring |
| Migration job | A03 |
| Status | pending verification |

### GET /system/dashboard

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /system/dashboard |
| Route file | system.ts:61 |
| Auth | Admin / SuperAdmin |
| Current success status | 200 |
| Current success shape | Resource (stats) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 401/403 via AppError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | AdminDashboard |
| Migration job | A03 |
| Status | pending verification |

## user.ts

### GET /users

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /users |
| Route file | user.ts:14 |
| Auth | Admin / SuperAdmin |
| Current success status | 200 |
| Current success shape | List (paginated) |
| Target success status | 200 |
| Target success shape | List Response |
| Current error shape | 401/403 via AppError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | UsersPage |
| Migration job | A02 |
| Status | confirmed |

### POST /users

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /users |
| Route file | user.ts:47 |
| Auth | Admin / SuperAdmin |
| Current success status | 201 |
| Current success shape | Resource (user) |
| Target success status | 201 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 + ValidationErrorDetails |
| Content-Type | application/json |
| Frontend client | UserCreateDialog |
| Migration job | A02 |
| Status | confirmed |

### PATCH /users/:id

| Field | Value |
| --- | --- |
| Method | PATCH |
| Path | /users/:id |
| Route file | user.ts:81 |
| Auth | Admin / SuperAdmin |
| Current success status | 200 |
| Current success shape | Resource (user) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | UserEditDialog |
| Migration job | A02 |
| Status | confirmed |

### DELETE /users/:id

| Field | Value |
| --- | --- |
| Method | DELETE |
| Path | /users/:id |
| Route file | user.ts:118 |
| Auth | Admin / SuperAdmin |
| Current success status | 204 |
| Current success shape | Empty |
| Target success status | 204 |
| Target success shape | Empty Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | N/A (204) |
| Frontend client | UsersPage |
| Migration job | A02 |
| Status | confirmed |

## organization.ts

### GET /organizations

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /organizations |
| Route file | organization.ts:12 |
| Auth | SuperAdmin |
| Current success status | 200 |
| Current success shape | List (array) |
| Target success status | 200 |
| Target success shape | List Response (non-paginated) |
| Current error shape | 401/403 via AppError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | SuperAdmin org list |
| Migration job | A02 |
| Status | confirmed |

### POST /organizations

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /organizations |
| Route file | organization.ts:29 |
| Auth | SuperAdmin |
| Current success status | 201 |
| Current success shape | Resource (org) |
| Target success status | 201 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | OrgCreateDialog |
| Migration job | A02 |
| Status | confirmed |

### PATCH /organizations/:id

| Field | Value |
| --- | --- |
| Method | PATCH |
| Path | /organizations/:id |
| Route file | organization.ts:55 |
| Auth | SuperAdmin |
| Current success status | 200 |
| Current success shape | Resource (org) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | OrgEditDialog |
| Migration job | A02 |
| Status | confirmed |

### DELETE /organizations/:id

| Field | Value |
| --- | --- |
| Method | DELETE |
| Path | /organizations/:id |
| Route file | organization.ts:91 |
| Auth | SuperAdmin |
| Current success status | 204 |
| Current success shape | Empty |
| Target success status | 204 |
| Target success shape | Empty Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | N/A (204) |
| Frontend client | OrgListPage |
| Migration job | A02 |
| Status | confirmed |

## course.ts

### GET /courses

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /courses |
| Route file | course.ts:14 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | List (paginated) |
| Target success status | 200 |
| Target success shape | List Response |
| Current error shape | 401/403 via AppError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | CoursePage |
| Migration job | A03 |
| Status | pending verification |

### GET /courses/:id

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /courses/:id |
| Route file | course.ts:46 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | Resource (course) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 404 via NotFoundError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | CourseDetailDialog |
| Migration job | A03 |
| Status | pending verification |

### POST /courses

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /courses |
| Route file | course.ts:76 |
| Auth | Admin / Teacher |
| Current success status | 201 |
| Current success shape | Resource (course) |
| Target success status | 201 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 + ValidationErrorDetails |
| Content-Type | application/json |
| Frontend client | CourseCreateDialog |
| Migration job | A03 |
| Status | pending verification |

### PATCH /courses/:id

| Field | Value |
| --- | --- |
| Method | PATCH |
| Path | /courses/:id |
| Route file | course.ts:117 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | Resource (course) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | CourseEditDialog |
| Migration job | A03 |
| Status | pending verification |

### DELETE /courses/:id

| Field | Value |
| --- | --- |
| Method | DELETE |
| Path | /courses/:id |
| Route file | course.ts:153 |
| Auth | Admin / Teacher |
| Current success status | 204 |
| Current success shape | Empty |
| Target success status | 204 |
| Target success shape | Empty Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | N/A (204) |
| Frontend client | CoursePage |
| Migration job | A03 |
| Status | pending verification |

## exam.ts

### GET /exams

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /exams |
| Route file | exam.ts:165 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | List (paginated) |
| Target success status | 200 |
| Target success shape | List Response |
| Current error shape | 401/403 via AppError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | ExamListPage |
| Migration job | A03 |
| Status | pending verification |

### GET /exams/:id

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /exams/:id |
| Route file | exam.ts:213 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | Resource (exam) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 404 via NotFoundError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | ExamDetailPage |
| Migration job | A03 |
| Status | pending verification |

### POST /exams

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /exams |
| Route file | exam.ts:248 |
| Auth | Admin / Teacher |
| Current success status | 201 |
| Current success shape | Resource (exam) |
| Target success status | 201 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 + ValidationErrorDetails |
| Content-Type | application/json |
| Frontend client | ExamCreateDialog |
| Migration job | A03 |
| Status | pending verification |

### PATCH /exams/:id

| Field | Value |
| --- | --- |
| Method | PATCH |
| Path | /exams/:id |
| Route file | exam.ts:311 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | Resource (exam) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 + 领域码 |
| Content-Type | application/json |
| Frontend client | ExamEditDialog |
| Migration job | A03 |
| Status | pending verification |

### POST /exams/:id/publish

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /exams/:id/publish |
| Route file | exam.ts:375 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | Resource (exam) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 409 via InvalidStateTransitionError |
| Target error shape | ErrorResponse v0 (409 EXAM_ALREADY_PUBLISHED) |
| Content-Type | application/json |
| Frontend client | ExamDetailPage publish button |
| Migration job | A03 |
| Command semantics | yes |
| Conflict behavior | 409 ErrorResponse |
| Status | pending verification |

### POST /exams/:id/archive

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /exams/:id/archive |
| Route file | exam.ts:423 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | Resource (exam) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 409 via InvalidStateTransitionError |
| Target error shape | ErrorResponse v0 (409) |
| Content-Type | application/json |
| Frontend client | ExamDetailPage archive button |
| Migration job | A03 |
| Command semantics | yes |
| Conflict behavior | 409 ErrorResponse |
| Status | pending verification |

| Field | Value |
| --- | --- |
| Method | DELETE |
| Path | /exams/:id |
| Route file | exam.ts:442 |
| Auth | Admin / Teacher |
| Current success status | 204 |
| Current success shape | Empty |
| Target success status | 204 |
| Target success shape | Empty Response |
| Current error shape | 409 via InvalidStateTransitionError |
| Target error shape | ErrorResponse v0 (409) |
| Content-Type | N/A (204) |
| Frontend client | ExamListPage delete |
| Migration job | A03 |
| Status | pending verification |

### GET /exams/:examId/enrollments

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /exams/:examId/enrollments |
| Route file | exam.ts:477 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | List (paginated) |
| Target success status | 200 |
| Target success shape | List Response |
| Current error shape | 404 via NotFoundError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | EnrollmentPage |
| Migration job | A03 |
| Status | pending verification |

### POST /exams/:examId/enrollments

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /exams/:examId/enrollments |
| Route file | exam.ts:531 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | Resource (enrollment) |
| Target success status | 201 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | EnrollmentPage |
| Migration job | A03 |
| Status | pending verification |

### DELETE /exams/:examId/enrollments/:enrollmentId

| Field | Value |
| --- | --- |
| Method | DELETE |
| Path | /exams/:examId/enrollments/:enrollmentId |
| Route file | exam.ts:618 |
| Auth | Admin / Teacher |
| Current success status | 204 |
| Current success shape | Empty |
| Target success status | 204 |
| Target success shape | Empty Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | N/A (204) |
| Frontend client | EnrollmentPage |
| Migration job | A03 |
| Status | pending verification |

## question.ts

### GET /questions

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /questions |
| Route file | question.ts:15 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | List (paginated) |
| Target success status | 200 |
| Target success shape | List Response |
| Current error shape | 401/403 via AppError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | QuestionPage |
| Migration job | A03 |
| Status | pending verification |

### GET /questions/:id

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /questions/:id |
| Route file | question.ts:81 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | Resource (question) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 404 via NotFoundError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | QuestionDetailDialog |
| Migration job | A03 |
| Status | pending verification |

### POST /questions

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /questions |
| Route file | question.ts:118 |
| Auth | Admin / Teacher |
| Current success status | 201 |
| Current success shape | Resource (question) |
| Target success status | 201 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 + ValidationErrorDetails |
| Content-Type | application/json |
| Frontend client | QuestionCreateDialog |
| Migration job | A03 |
| Status | pending verification |

### PATCH /questions/:id

| Field | Value |
| --- | --- |
| Method | PATCH |
| Path | /questions/:id |
| Route file | question.ts:184 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | Resource (question) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | QuestionEditDialog |
| Migration job | A03 |
| Status | pending verification |

### DELETE /questions/:id

| Field | Value |
| --- | --- |
| Method | DELETE |
| Path | /questions/:id |
| Route file | question.ts:249 |
| Auth | Admin / Teacher |
| Current success status | 204 |
| Current success shape | Empty |
| Target success status | 204 |
| Target success shape | Empty Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | N/A (204) |
| Frontend client | QuestionPage |
| Migration job | A03 |
| Status | pending verification |

### POST /questions/import

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /questions/import |
| Route file | question.ts:272 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | import summary |
| Target success status | 200 |
| Target success shape | Batch Operation Result / Import Result |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 + row-level errors |
| Content-Type | application/json |
| Frontend client | QuestionImportDialog |
| Migration job | A04 |
| Status | pending verification |

## candidate.ts

### GET /candidates

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /candidates |
| Route file | candidate.ts:80 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | List (paginated) |
| Target success status | 200 |
| Target success shape | List Response |
| Current error shape | 401/403 via AppError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | CandidatePage |
| Migration job | A02 |
| Status | confirmed |

### POST /candidates

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /candidates |
| Route file | candidate.ts:118 |
| Auth | Admin / Teacher |
| Current success status | 201 |
| Current success shape | Resource (candidate) |
| Target success status | 201 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 + ValidationErrorDetails |
| Content-Type | application/json |
| Frontend client | CandidateCreateDialog |
| Migration job | A02 |
| Status | confirmed |

### PATCH /candidates/:id

| Field | Value |
| --- | --- |
| Method | PATCH |
| Path | /candidates/:id |
| Route file | candidate.ts:207 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | Resource (candidate) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | CandidateEditDialog |
| Migration job | A02 |
| Status | confirmed |

### POST /candidates/import

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /candidates/import |
| Route file | candidate.ts:263 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | import summary |
| Target success status | 200 |
| Target success shape | Batch Operation Result / Import Result |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 + row-level errors |
| Content-Type | application/json |
| Frontend client | CandidateImportDialog |
| Migration job | A04 |
| Status | pending verification |

## candidateField.ts

### GET /candidate-fields

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /candidate-fields |
| Route file | candidateField.ts:13 |
| Auth | Admin |
| Current success status | 200 |
| Current success shape | List (array) |
| Target success status | 200 |
| Target success shape | List Response (non-paginated) |
| Current error shape | 401/403 via AppError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | CandidateFieldSettings |
| Migration job | A02 |
| Status | confirmed |

### POST /candidate-fields

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /candidate-fields |
| Route file | candidateField.ts:32 |
| Auth | Admin |
| Current success status | 201 |
| Current success shape | Resource (field) |
| Target success status | 201 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | CandidateFieldCreateDialog |
| Migration job | A02 |
| Status | confirmed |

### PATCH /candidate-fields/:id

| Field | Value |
| --- | --- |
| Method | PATCH |
| Path | /candidate-fields/:id |
| Route file | candidateField.ts:68 |
| Auth | Admin |
| Current success status | 200 |
| Current success shape | Resource (field) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | CandidateFieldEditDialog |
| Migration job | A02 |
| Status | confirmed |

### DELETE /candidate-fields/:id

| Field | Value |
| --- | --- |
| Method | DELETE |
| Path | /candidate-fields/:id |
| Route file | candidateField.ts:114 |
| Auth | Admin |
| Current success status | 204 |
| Current success shape | Empty |
| Target success status | 204 |
| Target success shape | Empty Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 (409 CANDIDATE_FIELD_IN_USE) |
| Content-Type | N/A (204) |
| Frontend client | CandidateFieldSettings |
| Migration job | A02 |
| Status | confirmed |

### GET /candidate-fields/template

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /candidate-fields/template |
| Route file | candidateField.ts:156 |
| Auth | Admin |
| Current success status | 200 |
| Current success shape | Resource (template) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 401/403 via AppError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | CandidateImportDialog |
| Migration job | A02 |
| Status | confirmed |

## attempts.ts

### GET /candidate/exams

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /candidate/exams |
| Route file | attempts.ts:359 |
| Auth | Candidate |
| Current success status | 200 |
| Current success shape | List (array, filtered) |
| Target success status | 200 |
| Target success shape | List Response (non-paginated) |
| Current error shape | 401 via AppError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | ExamListPage |
| Migration job | A01 |
| Status | pending verification |

### GET /candidate/exams/:examId

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /candidate/exams/:examId |
| Route file | attempts.ts:424 |
| Auth | Candidate |
| Current success status | 200 |
| Current success shape | Resource (exam detail for candidate) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 404 via NotFoundError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | StartExamPage |
| Migration job | A01 |
| Status | pending verification |

### POST /attempts/:examId/queue

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /attempts/:examId/queue |
| Route file | attempts.ts:463 |
| Auth | Candidate |
| Current success status | 200 |
| Current success shape | Resource (queue status) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 404 via NotFoundError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | StartExamPage |
| Migration job | A01 |
| Status | pending verification |

### POST /attempts/:examId/start

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /attempts/:examId/start |
| Route file | attempts.ts:486 |
| Auth | Candidate |
| Current success status | 201 |
| Current success shape | Resource (attempt, no standardAnswer) |
| Target success status | 201 |
| Target success shape | Resource Response |
| Current error shape | 404/409 via NotFoundError/InvalidStateTransitionError |
| Target error shape | ErrorResponse v0 (409 QUEUE_WAIT_REQUIRED) |
| Content-Type | application/json |
| Frontend client | StartExamPage |
| Migration job | A01 |
| Status | pending verification |

### GET /attempts/:id

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /attempts/:id |
| Route file | attempts.ts:567 |
| Auth | Candidate |
| Current success status | 200 |
| Current success shape | Resource (attempt, no standardAnswer) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 404 via NotFoundError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | TakeExamPage |
| Migration job | A01 |
| Status | pending verification |

### POST /attempts/:attemptId/answers/:questionId

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /attempts/:attemptId/answers/:questionId |
| Route file | attempts.ts:585 |
| Auth | Candidate |
| Current success status | 200 |
| Current success shape | Command Result Response (discriminated union on `accepted`) |
| Target success status | 200 |
| Target success shape | Command Result Response (discriminated union accepted true/false) |
| Current error shape | 400 VALIDATION_ERROR / 404 via NotFoundError |
| Target error shape | ErrorResponse v0 (400/404) + Command Result rejected (reason + message + details?) |
| Content-Type | application/json |
| Frontend client | TakeExamPage autosave |
| Migration job | A01 |
| Status | A01 contract complete; OpenAPI pending (A05) |

### POST /attempts/:attemptId/submit

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /attempts/:attemptId/submit |
| Route file | attempts.ts:712 |
| Auth | Candidate |
| Current success status | 200 |
| Current success shape | Resource (graded attempt) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 409 INVALID_STATE_TRANSITION / ATTEMPT_DEADLINE_EXCEEDED |
| Target error shape | ErrorResponse v0 (409, 已固定) |
| Content-Type | application/json |
| Frontend client | TakeExamPage submit |
| Migration job | A01 |
| Status | pending verification |

### POST /attempts/:attemptId/heartbeat

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /attempts/:attemptId/heartbeat |
| Route file | attempts.ts:783 |
| Auth | Candidate |
| Current success status | 200 |
| Current success shape | { ok: true } |
| Target success status | 204 |
| Target success shape | Empty Response |
| Current error shape | 409 { error: { code, message } } |
| Target error shape | ErrorResponse v0 (409) |
| Content-Type | N/A (204) |
| Frontend client | TakeExamPage heartbeat |
| Migration job | A01 |
| Status | pending verification |

### POST /attempts/:attemptId/restore

| Field | Value |
| --- | --- |
| Method | POST |
| Path | /attempts/:attemptId/restore |
| Route file | attempts.ts:814 |
| Auth | Candidate |
| Current success status | 200 |
| Current success shape | Resource (restored attempt) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 404 via NotFoundError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | TakeExamPage restore |
| Migration job | A01 |
| Status | pending verification |

## scores.ts

### GET /exams/:id/scores

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /exams/:id/scores |
| Route file | scores.ts:120 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | List (paginated, with statistics) |
| Target success status | 200 |
| Target success shape | List Response |
| Current error shape | 401/403/404 via AppError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | ScoreManagementPage |
| Migration job | A03 |
| Status | pending verification |

### GET /scores/attempts/:attemptId

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /scores/attempts/:attemptId |
| Route file | scores.ts:197 |
| Auth | Admin / Teacher / Candidate (own) |
| Current success status | 200 |
| Current success shape | Resource (attempt detail) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 404 via NotFoundError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | ScoreDetailPage / ResultPage |
| Migration job | A03 |
| Status | pending verification |

## export.ts

### GET /exams/:id/export/scores

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /exams/:id/export/scores |
| Route file | export.ts:12 |
| Auth | Admin / Teacher |
| Current success status | 200 |
| Current success shape | File (CSV) |
| Target success status | 200 |
| Target success shape | File Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | text/csv |
| Frontend client | ScoreManagementPage export button |
| Migration job | A04 |
| Status | pending verification |

## settings.ts

### GET /settings/branding

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /settings/branding |
| Route file | settings.ts:15 |
| Auth | public |
| Current success status | 200 |
| Current success shape | Resource (branding settings) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | N/A |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | BrandMark / header / footer |
| Migration job | A03 |
| Status | pending verification |

### GET /admin/settings/branding

| Field | Value |
| --- | --- |
| Method | GET |
| Path | /admin/settings/branding |
| Route file | settings.ts:33 |
| Auth | Admin |
| Current success status | 200 |
| Current success shape | Resource (branding settings) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | 401/403 via AppError |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | SettingsPage |
| Migration job | A03 |
| Status | pending verification |

### PATCH /admin/settings/branding

| Field | Value |
| --- | --- |
| Method | PATCH |
| Path | /admin/settings/branding |
| Route file | settings.ts:54 |
| Auth | Admin |
| Current success status | 200 |
| Current success shape | Resource (updated branding) |
| Target success status | 200 |
| Target success shape | Resource Response |
| Current error shape | inline { error: { code, message } } |
| Target error shape | ErrorResponse v0 |
| Content-Type | application/json |
| Frontend client | SettingsPage |
| Migration job | A03 |
| Status | pending verification |

---

## Summary

| Migration Job | Endpoint Count | Route Files |
| --- | ---: | --- |
| A01 | 9 | attempts.ts |
| A02 | 14 | auth.ts, user.ts, candidate.ts, candidateField.ts |
| A03 | 16 | exam.ts, question.ts, course.ts, settings.ts, scores.ts, system.ts |
| A04 | 3 | export.ts, question.ts (import), candidate.ts (import) |
| A05 | all | all (OpenAPI coverage) |
| A06 | all | all (frontend client convergence) |

Total endpoints: 61
