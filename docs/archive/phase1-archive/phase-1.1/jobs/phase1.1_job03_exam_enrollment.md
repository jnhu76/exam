# Phase 1.1 Job 03 — Exam Enrollment Management

## Goal

补齐考试与考生关联能力。没有 Enrollment，Candidate 无法参加考试，Phase 1 闭环不成立。

## Scope

- Exam detail page: 参加人员模块
- Enrollment API
- Enrollment repository/service
- Candidate picker
- AuditLog

## Data Model

如果已有 `exam_enrollments`，复用。

如果没有，新增：

```ts
ExamEnrollment {
  id: string;
  organizationId: string;
  examId: string;
  candidateId: string;
  status: "assigned" | "started" | "completed" | "blocked";
  attemptCount: number;
  finalScore?: number | null;
  finalPassed?: boolean | null;
  finalAttemptId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

约束：

```txt
unique(organizationId, examId, candidateId)
```

## API

```txt
GET    /api/exams/:examId/enrollments
POST   /api/exams/:examId/enrollments
DELETE /api/exams/:examId/enrollments/:enrollmentId
```

## UI

考试详情页增加：

```txt
参加人员 / 考生资格
  - 已分配考生列表
  - 添加考生按钮
  - 搜索候选人
  - 批量添加
  - 移除未开始考生
  - 显示状态 assigned/started/completed/blocked
```

## Rules

```txt
[ ] 只能添加本机构 Candidate
[ ] 重复添加不创建重复记录
[ ] started/completed enrollment 不能删除
[ ] 删除 assigned enrollment 写 AuditLog
[ ] 添加 enrollment 写 AuditLog
[ ] 所有 repo 方法接收 RequestContext
```

## Tests

```txt
[ ] admin/teacher can list enrollments
[ ] admin/teacher can add candidate
[ ] duplicate add is idempotent or returns skipped
[ ] cross-organization candidate cannot be added
[ ] assigned enrollment can be removed
[ ] started enrollment cannot be removed
[ ] audit log written
```

## Acceptance

```txt
[ ] 考试详情页可以设置考生
[ ] Candidate 后续能通过 enrollment 看到考试
```
