# Phase 1.1 API Contracts

本文档定义 Phase 1.1 必补接口。具体实现应放在 contracts 包或项目既有 DTO 定义位置，不要在 apps/web 和 apps/api 各自重复定义。

## 1. API Client 空 body 规则

### 规则

无 body 的 mutation 请求：

```txt
POST /api/exams/:id/publish
DELETE /api/courses/:id
```

不得设置：

```http
Content-Type: application/json
```

除非确实有 JSON body。

### API client 预期行为

```ts
api.post(path);
api.delete(path);
```

应该发送无 body 请求。

```ts
api.post(path, data);
api.patch(path, data);
api.delete(path, data);
```

只有 data 不是 `undefined` 时才设置 JSON header。

## 2. Exam Publish

```txt
POST /api/exams/:examId/publish
```

### Request

无 body。

### Response

```ts
type PublishExamResponse = {
  id: string;
  status: "published";
  publishedAt?: string;
};
```

### Errors

```ts
EXAM_NOT_FOUND;
EXAM_ALREADY_PUBLISHED;
EXAM_HAS_NO_QUESTIONS;
EXAM_INVALID_TIME_WINDOW;
FORBIDDEN;
```

## 3. Exam Enrollment

### List

```txt
GET /api/exams/:examId/enrollments
```

```ts
type ExamEnrollmentListItem = {
  id: string;
  examId: string;
  candidateId: string;
  candidateDisplayName: string;
  candidateIdentity?: string;
  status: "assigned" | "started" | "completed" | "blocked";
  attemptCount: number;
  finalScore?: number | null;
  finalPassed?: boolean | null;
};
```

### Add

```txt
POST /api/exams/:examId/enrollments
```

```ts
type AddExamEnrollmentRequest = {
  candidateIds: string[];
};
```

Response:

```ts
type AddExamEnrollmentResponse = {
  added: number;
  skipped: number;
  enrollments: ExamEnrollmentListItem[];
};
```

### Remove

```txt
DELETE /api/exams/:examId/enrollments/:enrollmentId
```

无 body。

规则：

- 只能删除 `assigned` 状态；
- `started` / `completed` 不允许删除，只能 blocked 或保留历史；
- 必须写入 AuditLog。

## 4. Candidate My Exams

```txt
GET /api/candidate/exams
```

```ts
type CandidateExamListItem = {
  examId: string;
  enrollmentId: string;
  title: string;
  status:
    | "available"
    | "not_open"
    | "closed"
    | "completed"
    | "blocked"
    | "in_progress";
  enrollmentStatus: "assigned" | "started" | "completed" | "blocked";
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes?: number | null;
  passingScore: number;
  questionCount: number;
  reason?: string;
};
```

## 5. Candidate Start Exam

```txt
POST /api/candidate/exams/:examId/start
```

无 body。

Response:

```ts
type StartExamResponse = {
  attemptId: string;
  examId: string;
  status: "in_progress";
  startedAt: string;
  deadlineAt?: string | null;
  remainingSeconds?: number | null;
  questionCount: number;
};
```

规则：

- 只能启动已分配 enrollment；
- timed_window 必须检查开放窗口；
- 如果已有 in_progress attempt，则恢复它；
- startedAt/deadlineAt 以服务端时间为准；
- 必须写入 AuditLog。

## 6. Account Settings

### Current User

```txt
GET /api/me
```

```ts
type MeResponse = {
  id: string;
  username: string;
  displayName: string;
  role: "SuperAdmin" | "Admin" | "Teacher" | "Proctor" | "Candidate";
  organizationId: string;
};
```

### Change Password

```txt
PATCH /api/me/password
```

```ts
type ChangePasswordRequest = {
  currentPassword: string;
  newPassword: string;
};
```

Response:

```ts
type ChangePasswordResponse = {
  ok: true;
};
```

规则：

- 需要登录；
- 验证旧密码；
- 新密码走项目既有密码 hash；
- 不允许修改 role；
- 成功后可选择保留当前 session；
- 写入 AuditLog。
