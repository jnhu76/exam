# API 参考文档

> **⚠ Canonical contract notice**
>
> This file is a **human-readable API guide**. It is **not** the canonical
> machine-readable API contract.
>
> The canonical API contract is generated from **runtime Fastify/Zod route
> schemas** and served as generated OpenAPI at `/api/docs/json`. If this
> document conflicts with generated OpenAPI or route schemas, **generated
> OpenAPI / route schemas win**.
>
> See `docs/api/contract.md` for the full runtime-first API contract policy,
> error envelope, and ErrorCode conventions.

> **Phase realignment note**: `docs/SPEC.md` and `docs/phase-roadmap.md` are authoritative for product phase scope. Phase 1 current product roles are Admin + Candidate only. The API reference below has been updated to reflect Phase 1 permissions. Fields like `queue`, `restrictIp`, `controlFlags.retakePolicy`, `controlFlags.scoreStrategy` remain in response schemas as structural residue from the exam model but are not Phase 1 product paths. Optional multiTenant, SuperAdmin, tenant switcher, organizationSlug login, pass-to-proceed, service tokens, and external integration are Phase 4 capabilities unless explicitly re-scoped.

## 概述

本考试平台采用 RESTful API 设计，所有端点均以 `/api` 为前缀，支持 JSON 格式请求和响应。

**Base URL**: `http://<server-host>:3000/api`

**认证**: 大多数端点需要认证。认证通过 HTTP-only Cookie (`auth-token`) 实现，使用 JWT Token。

**格式要求**:

- Content-Type: `application/json`
- Cookie: `auth-token=<jwt_token>` (HTTP-only, Secure, SameSite=strict)

**通用响应结构**:

```json
{
  "id": "uuid",
  "organizationId": "uuid",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**错误响应**:

```json
{
  "error": {
    "code": "VALIDATION_ERROR | NOT_FOUND | UNAUTHORIZED | FORBIDDEN",
    "message": "错误描述"
  }
}
```

---

## 认证相关

### POST /auth/register

**权限**: 公开（Phase 1 已禁用）

> Phase 1 不支持公开注册。该端点始终返回 `403 AUTH_REGISTER_DISABLED`。第一个 Admin 通过本地 `bootstrap:admin` 脚本创建。

**响应** (403):

```json
{
  "error": {
    "code": "AUTH_REGISTER_DISABLED",
    "message": "Phase 1 不支持公开注册",
    "requestId": "req-..."
  }
}
```

---

### POST /auth/login

**权限**: 公开
**速率限制**: 10 次/分钟/IP

**请求体**:

```json
{
  "username": "admin",
  "password": "admin123"
}
```

> Phase 1 登录仅接受 `username` 和 `password`。`organizationSlug` 不再接受；系统使用 internal default organization。

**响应** (200):

```json
{
  "id": "user-uuid",
  "username": "admin",
  "name": "管理员",
  "role": "Admin",
  "organizationId": "org-uuid"
}
```

**Cookie**: 设置 `auth-token` HTTP-only Cookie

---

### POST /auth/logout

**权限**: 需要认证

**请求体**: `{}`

**响应** (200):

```json
{
  "success": true
}
```

**Cookie**: 清除 `auth-token`

---

### GET /auth/me

**权限**: 需要认证

**响应** (200):

```json
{
  "id": "user-uuid",
  "username": "admin",
  "name": "管理员",
  "role": "Admin",
  "organizationId": "org-uuid"
}
```

---

### PATCH /auth/me/password

**权限**: 需要认证

**请求体**:

```json
{
  "currentPassword": "old-password",
  "newPassword": "new-password-123"
}
```

**响应** (200):

```json
{
  "ok": true
}
```

---

## 用户管理

### GET /users

**权限**: Admin

**查询参数**:

- `page` (可选): 页码，默认 1
- `pageSize` (可选): 每页数量，默认 20
- `role` (可选): 过滤角色

**响应** (200):

```json
{
  "items": [
    {
      "id": "user-uuid",
      "username": "admin",
      "name": "管理员",
      "role": "Admin",
      "isActive": true,
      "organizationId": "org-uuid",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 100,
  "page": 1,
  "pageSize": 20,
  "totalPages": 5
}
```

---

### POST /users

**权限**: Admin

**请求体**:

```json
{
  "username": "admin2",
  "password": "pass123",
  "name": "管理员2",
  "role": "Admin"
}
```

**响应** (201): 同 GET /users 单个用户对象

---

### POST /users/:id/reset-password

**权限**: Admin

重置考生密码。只能重置 Candidate 用户密码，不能重置 Admin 密码（Admin 密码恢复使用本地 `reset:admin-password` 脚本）。

**请求体**:

```json
{
  "newPassword": "NewCandidatePass123!"
}
```

**响应** (200):

```json
{
  "ok": true
}
```

**错误**:

- `400 PASSWORD_RESET_TARGET_ROLE_NOT_ALLOWED` — 目标用户不是 Candidate
- `404 RESOURCE_NOT_FOUND` — 用户不存在

---

## 考生管理

### GET /candidates

**权限**: Admin

**查询参数**: 同 `/users`

**响应** (200):

```json
{
  "items": [
    {
      "id": "candidate-uuid",
      "userId": "user-uuid",
      "fields": {
        "studentId": "20240001",
        "department": "计算机系",
        "grade": "2024级"
      },
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 100,
  "page": 1,
  "pageSize": 20,
  "totalPages": 5
}
```

---

### POST /candidates

**权限**: Admin

**请求体**:

```json
{
  "username": "student01",
  "password": "student123",
  "name": "张三",
  "fields": {
    "studentId": "20240001",
    "department": "计算机系",
    "grade": "2024级"
  }
}
```

**响应** (201): 同 GET /candidates 单个对象

---

### POST /candidates/import

**权限**: Admin
**速率限制**: 10 次/分钟

**请求体**:

```json
{
  "rows": [
    {
      "username": "student01",
      "password": "pass123",
      "name": "张三",
      "studentId": "20240001",
      "department": "计算机系"
    },
    {
      "username": "student02",
      "password": "pass123",
      "name": "李四",
      "studentId": "20240002",
      "department": "软件工程"
    }
  ]
}
```

**响应** (200):

```json
{
  "total": 2,
  "created": 2,
  "updated": 0,
  "errors": []
}
```

---

### PATCH /candidates/:id

**权限**: Admin

**请求体**:

```json
{
  "name": "张三(改名后)",
  "isActive": true,
  "fields": {
    "department": "软件工程"
  }
}
```

**响应** (200): 同 GET /candidates 单个对象

---

### DELETE /candidates/:id

**权限**: Admin

**响应**: 204 No Content

---

## 题型字段配置

### GET /candidate-fields

**权限**: Admin

**响应** (200):

```json
{
  "items": [
    {
      "id": "field-uuid",
      "name": "studentId",
      "label": "学号",
      "fieldType": "text",
      "required": true,
      "unique": true,
      "sortOrder": 0
    },
    {
      "id": "field-uuid",
      "name": "department",
      "label": "院系",
      "fieldType": "text",
      "required": true,
      "unique": false,
      "sortOrder": 1
    }
  ]
}
```

---

### GET /candidate-fields/template

**权限**: Admin

**响应** (200):

```json
{
  "headers": ["学号", "姓名", "院系", "年级"],
  "exampleRow": "20240001,张三,计算机系,2024级"
}
```

---

### POST /candidate-fields

**权限**: Admin

**请求体**:

```json
{
  "name": "studentId",
  "label": "学号",
  "fieldType": "text",
  "required": true,
  "unique": true,
  "sortOrder": 0
}
```

**响应** (201): 同 GET /candidate-fields 单个对象

---

## 课程管理

### GET /courses

**权限**: Admin

**查询参数**: 分页

**响应** (200):

```json
{
  "items": [
    {
      "id": "course-uuid",
      "name": "高等数学",
      "code": "MATH101",
      "description": "",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 10,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1
}
```

---

### POST /courses

**权限**: Admin

**请求体**:

```json
{
  "name": "线性代数",
  "code": "MATH102",
  "description": ""
}
```

**响应** (201): 同 GET /courses 单个对象

---

## 题目管理

### GET /questions

**权限**: Admin

**查询参数**:

- `page`, `pageSize`: 分页
- `courseId`: 按课程过滤
- `type`: 按类型过滤 (`single_choice`, `multiple_choice`, `fill_blank`, `true_false`)
- `difficulty`: 按难度过滤 (1-5)

**响应** (200):

```json
{
  "items": [
    {
      "id": "q-uuid",
      "type": "true_false",
      "content": "地球是圆的",
      "standardAnswer": true,
      "score": 10,
      "difficulty": 2,
      "tags": ["基础", "常识"],
      "courseId": "course-uuid",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 50,
  "page": 1,
  "pageSize": 20,
  "totalPages": 3
}
```

---

### POST /questions

**权限**: Admin

**请求体**:

```json
{
  "courseId": "course-uuid",
  "type": "single_choice",
  "content": "下列哪个是质数？",
  "options": [
    { "id": "A", "content": "2", "isCorrect": false },
    { "id": "B", "content": "3", "isCorrect": true },
    { "id": "C", "content": "4", "isCorrect": false },
    { "id": "D", "content": "5", "isCorrect": false }
  ],
  "standardAnswer": "B",
  "score": 5,
  "difficulty": 3,
  "tags": ["数学", "基础"],
  "gradingRule": {
    "multiSelectScoring": "all_correct_full",
    "fillBlankMatchMode": "exact"
  }
}
```

---

### POST /questions/import

**权限**: Admin
**速率限制**: 5 次/分钟

**请求体**:

```json
{
  "courseId": "course-uuid",
  "rows": [
    {
      "type": "true_false",
      "content": "2+2=4",
      "standardAnswer": true,
      "score": 10,
      "tags": "基础,数学",
      "gradingRule": {
        "fillBlankMatchMode": "keyword"
      }
    },
    {
      "type": "single_choice",
      "content": "1+1=?",
      "optionA": "1",
      "optionB": "2",
      "standardAnswer": "B",
      "score": 5
    }
  ],
  "confirm": true
}
```

**响应** (200):

```json
{
  "total": 2,
  "valid": 2,
  "warnings": 0,
  "errors": 0,
  "details": [
    {
      "row": 1,
      "status": "valid"
    },
    {
      "row": 2,
      "status": "valid"
    }
  ]
}
```

---

## 考试管理

### GET /exams

**权限**: Admin

**查询参数**: 分页

**响应** (200):

```json
{
  "items": [
    {
      "id": "exam-uuid",
      "title": "期末能力测评",
      "description": "",
      "courseId": "course-uuid",
      "status": "draft | published | open | closed | archived",
      "timingMode": "timed_window",
      "durationMinutes": 60,
      "openAt": "2024-06-01T09:00:00.000Z",
      "closeAt": "2024-06-01T11:00:00.000Z",
      "passingScore": 60,
      "totalScore": 100,
      "questionIds": ["q-uuid1", "q-uuid2"],
      "controlFlags": {
        "shuffleQuestions": false,
        "shuffleOptions": false,
        "detectTabSwitch": false,
        "disableCopyPaste": false,
        "requireQueue": false,
        "batchSize": 10,
        "batchInterval": 3,
        "restrictIp": false,
        "requireLockdown": false,
        "showResultImmediately": true
      },
      "retakePolicy": "no-retake",
      "scoreStrategy": "best",
      "maxAttempts": 1,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "stats": {
        "participantCount": 50,
        "completedCount": 35,
        "passedCount": 30
      }
    }
  ],
  "total": 20,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1
}
```

---

### POST /exams

**权限**: Admin

**请求体**:

```json
{
  "title": "期末能力测评",
  "description": "",
  "courseId": "course-uuid",
  "durationMinutes": 60,
  "openAt": "2024-06-01T09:00:00.000Z",
  "closeAt": "2024-06-01T11:00:00.000Z",
  "passingScore": 60,
  "totalScore": 100,
  "questionIds": ["q-uuid1", "q-uuid2"],
  "controlFlags": {
    "shuffleQuestions": false,
    "shuffleOptions": false,
    "detectTabSwitch": false,
    "disableCopyPaste": false,
    "requireQueue": false,
    "batchSize": 10,
    "batchInterval": 3,
    "restrictIp": false,
    "requireLockdown": false,
    "showResultImmediately": true
  },
  "retakePolicy": "no-retake",
  "scoreStrategy": "best",
  "maxAttempts": 1
}
```

**响应** (201):

```json
{
  "id": "exam-uuid",
  "title": "期末能力测评"
}
```

---

### POST /exams/:id/publish

**权限**: Admin

**响应** (200):

```json
{
  "id": "exam-uuid",
  "status": "published",
  "publishedAt": "2024-06-01T09:00:00.000Z"
}
```

**错误** (400):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Exam totalScore must match question scores"
  }
}
```

---

### POST /exams/:id/archive

**权限**: Admin

**响应** (200):

```json
{
  "id": "exam-uuid",
  "status": "archived"
}
```

---

### GET /exams/:id/enrollments

**权限**: Admin

**响应** (200):

```json
[
  {
    "id": "enrollment-uuid",
    "examId": "exam-uuid",
    "candidateId": "candidate-uuid",
    "candidateDisplayName": "张三",
    "candidateIdentity": "20240001",
    "status": "assigned | started | completed | failed",
    "attemptCount": 0,
    "finalScore": null,
    "finalPassed": null
  }
]
```

---

### POST /exams/:id/enrollments

**权限**: Admin

**请求体**:

```json
{
  "candidateIds": ["candidate-uuid1", "candidate-uuid2"]
}
```

**响应** (200): 同 GET /exams/:id/enrolls 数组

---

## 考生端 API

### GET /candidate/exams

**权限**: Candidate

**响应** (200):

```json
[
  {
    "id": "exam-uuid",
    "title": "期末能力测评",
    "description": "",
    "durationMinutes": 60,
    "passingScore": 60,
    "totalScore": 100,
    "openAt": "2024-06-01T09:00:00.000Z",
    "closeAt": "2024-06-01T11:00:00.000Z",
    "questionCount": 10,
    "controlFlags": {
      "detectTabSwitch": true,
      "disableCopyPaste": true
    },
    "enrolled": true,
    "currentAttempts": 0,
    "maxAttempts": 1,
    "retakePolicy": "no-retake"
  }
]
```

---

### POST /attempts/:examId/queue

**权限**: Candidate

**响应** (200):

```json
{
  "examId": "exam-uuid",
  "status": "waiting | ready",
  "position": 5,
  "waitCount": 4,
  "estimatedWaitSeconds": 20
}
```

---

### POST /attempts/:examId/start

**权限**: Candidate

**响应** (201):

```json
{
  "id": "attempt-uuid",
  "examId": "exam-uuid",
  "status": "in_progress",
  "deadlineAt": "2024-06-01T10:00:00.000Z"
}
```

---

### GET /attempts/:id

**权限**: Candidate

**响应** (200):

```json
{
  "id": "attempt-uuid",
  "examId": "exam-uuid",
  "status": "in_progress",
  "deadlineAt": "2024-06-01T10:00:00.000Z",
  "questionSnapshot": [
    {
      "originalQuestionId": "q-uuid1",
      "type": "true_false",
      "content": "地球是圆的",
      "score": 10,
      "options": null,
      "standardAnswer": true
    }
  ],
  "answers": [
    {
      "questionId": "q-uuid1",
      "answer": true,
      "version": 1,
      "clientSeq": 1,
      "clientSavedAt": "2024-06-01T09:05:00.000Z",
      "baseVersion": 0
    }
  ],
  "startedAt": "2024-06-01T09:00:00.000Z",
  "submittedAt": null
}
```

---

### POST /attempts/:attemptId/answers/:questionId

**权限**: Candidate

**请求体**:

```json
{
  "attemptId": "attempt-uuid",
  "questionId": "q-uuid1",
  "answer": true,
  "clientSeq": 2,
  "clientSavedAt": "2024-06-01T09:10:00.000Z",
  "baseVersion": 1
}
```

**接受响应** (200):

```json
{
  "accepted": true,
  "serverVersion": 2,
  "savedAt": "2024-06-01T09:10:00.123Z"
}
```

**拒绝响应** (200): 服务器以 200 + `accepted:false` 表达可恢复的业务拒绝（command result，不是 ErrorResponse）。客户端必须根据稳定的机器可读 `reason` 枚举分支处理，**不要**对 `message` 做字符串匹配——`message` 仅用于人类展示，文案可能随 i18n 调整。

```json
{
  "accepted": false,
  "reason": "STALE_VERSION",
  "message": "服务器上存在更新的答案版本",
  "serverVersion": 5,
  "savedAt": "2024-06-01T09:10:00.123Z",
  "details": {
    "serverAnswer": true
  }
}
```

**`reason` 枚举**（稳定契约，参见 `packages/contracts/src/attempt.ts` `SaveAnswerRejectReasonEnum`）：

| reason | 触发条件 | 客户端建议处理 |
| --- | --- | --- |
| `STALE_VERSION` | `baseVersion < serverVersion`（乐观并发冲突） | 以 `details.serverAnswer` 合并/覆盖本地状态；用 `serverVersion` 重试 |
| `ATTEMPT_ALREADY_SUBMITTED` | attempt 已在 `submitted` / `grading` / `graded` | 停止保存，提示考试已结束，引导跳转到结果页 |
| `ATTEMPT_CLOSED` | attempt 在 `voided` 等终止状态（Phase 1 暂未持续触发） | 停止保存，提示考试已被关闭 |
| `DEADLINE_EXCEEDED` | `now > deadlineAt`（save-answer 路由传入 `attempt.deadlineAt + fastify.now()` 给 `processSaveAnswer`） | 停止继续保存；已保存答案仍可 submit |

**字段说明**：

- `accepted`: discriminated union 判别字段。
- `reason`: 仅在 `accepted:false` 时出现，机器可读枚举，**契约稳定**。
- `message`: 仅在 `accepted:false` 时出现，i18n 文案，**非协议字段**，禁止用于业务分支判断。
- `serverVersion`: 当前服务器持有的版本号；接受分支返回新版本，拒绝分支返回当前最新版本。
- `savedAt`: 服务器侧时间戳。
- `details.serverAnswer?`: 仅在 `STALE_VERSION` 拒绝时返回，用于客户端合并冲突状态。

> 该响应形态由 `SaveAnswerAcceptedSchema` / `SaveAnswerRejectedSchema` (strict) 在 `packages/contracts/src/attempt.ts` 定义；route handler 在 `apps/api/src/routes/attempts.ts` 通过这两个 schema 做出口校验。Phase 1.7 起，schema 标记为 `.strict()`，**禁止**返回 legacy 嵌套 `conflict: { reason, serverAnswer }` 形状或其他未声明字段。

---

### POST /attempts/:attemptId/submit

**权限**: Candidate

**响应** (200):

```json
{
  "id": "attempt-uuid",
  "status": "graded",
  "score": 85,
  "passed": true,
  "submittedAt": "2024-06-01T10:05:00.000Z"
}
```

> Phase 1 语义：`submit` 不受 deadline 限制。deadline 仅限制继续保存答案（`save-answer` 在 deadline 后返回 `accepted:false, reason:"DEADLINE_EXCEEDED"`），不限制提交服务器已保存答案。submit 内联完成评分（in_progress/disrupted→submitted→graded），并对 `submitted`/`graded` 幂等——若 submit 在评分前崩溃，attempt 停在 `submitted`，再次 POST submit 会重试评分并推进到 `graded`。

---

### POST /attempts/:attemptId/heartbeat

**权限**: Candidate

**响应** (200):

```json
{
  "ok": true
}
```

**错误响应** (409): 当 attempt 不在 `in_progress` 时返回 ErrorResponse，`error.code` 为 `INVALID_STATE_TRANSITION`。

> Phase 1 语义：心跳仅用于刷新 `lastActivityAt`，与 deadline 无耦合——deadline 之后的心跳仍会被接受。后台扫描任务（`HEARTBEAT_TIMEOUT_MS`，默认 60s）将长时间无活动的 `in_progress` attempt 标记为 `disrupted`。前端 restore UI 在 Phase 1.7 未接入，参见 `docs/todo.md` Phase 2 backlog。

---

## 成绩导出

### GET /exams/:id/export/scores

**权限**: Admin

**响应**: CSV 文件下载

**Content-Type**: `text/csv; charset=utf-8`
**Content-Disposition**: `attachment; filename="scores-<exam-id>-<timestamp>.csv"`

**CSV 格式**:

```
考生姓名,学号,院系,年级,成绩,及格状态,尝试次数,提交时间
张三,20240001,计算机系,2024级,85,及格,1,2024-06-01T10:05:00.000Z
李四,20240002,软件工程,2024级,72,不及格,2,2024-06-01T10:08:00.000Z
```

**字段说明**:

- `考生姓名`: Candidate 的 `name` 字段
- `学号/院系/年级`: 组织配置的 CandidateField 字段
- `成绩`: 最终得分（number）
- `及格状态`: "及格" 或 "不及格"
- `尝试次数`: 累计考试次数（number）
- `提交时间`: ISO 8601 格式日期时间字符串

---

## 设置

### GET /settings/branding

**权限**: 公开

**响应** (200):

```json
{
  "productName": "考试平台",
  "productSubtitle": "可靠的内网考试系统",
  "footerText": "© 2024 某某机构"
}
```

---

### GET /admin/settings/branding

**权限**: Admin

**响应** (200): 同 `GET /settings/branding`

---

### PATCH /admin/settings/branding

**权限**: Admin

**请求体**:

```json
{
  "productName": "新的考试平台",
  "productSubtitle": "更新后的副标题",
  "footerText": "© 2024 某某机构",
  "organizationDisplayName": "考试中心"
}
```

**响应** (200): 同 GET /admin/settings/branding

---

## 系统信息

### GET /system/info

**权限**: 公开

**响应** (200):

```json
{
  "version": "0.1.0",
  "uptime": 3600
}
```

---

### GET /system/public-config

**权限**: 公开

返回前端可用的非敏感运行时配置。Phase 1 为单租户运行时，`deploymentMode` 恒为 `singleTenant`。

**注意**：Phase 1 不再输出 `exposeSuperAdmin`、`tenantSwitcher`、`superAdminConsole` 或任何 multiTenant 当前功能字段。这些属于 Phase 4 platformization 能力，不是当前功能，因此完全不输出（而不是输出 `false`），避免暗示该能力存在。

**响应** (200):

```json
{
  "deploymentMode": "singleTenant",
  "features": {
    "apiReference": false
  },
  "apiReference": {
    "enabled": false,
    "uiPath": "/_dev/api-reference",
    "specPath": "/api/openapi.json"
  }
}
```

`DEPLOYMENT_MODE=multiTenant` 会在启动时 fail fast（Phase 1 只支持 singleTenant）。optional multiTenant 是 Phase 4 platformization 能力，不是当前可运行模式。

---

### GET /system/health

**权限**: 需要认证

**响应** (200):

```json
{
  "cpu": 15,
  "memory": 45,
  "dbResponseMs": 12,
  "status": "healthy"
}
```

---

### GET /system/dashboard

**权限**: 需要认证

**响应** (200):

```json
{
  "totalQuestions": 150,
  "activeExams": 5,
  "totalCandidates": 80,
  "todayExams": 120,
  "recentExams": [
    {
      "id": "exam-uuid",
      "title": "期末能力测评",
      "status": "open",
      "completedCount": 25,
      "participantCount": 40
    }
  ]
}
```
