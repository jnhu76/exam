# Phase 1.1 Job 02 — Exam Publish + Detail Refresh

## Goal

修复考试发布后页面无变化、状态仍像草稿的问题。

## Scope

- Exam detail page
- Publish button
- publish API integration
- status refresh
- publish domain validation

## Requirements

### UI

点击发布后：

```txt
[ ] 按钮进入 loading
[ ] 禁止重复点击
[ ] 成功 toast
[ ] 重新拉取 exam detail
[ ] status 从 draft 显示为 published
[ ] 发布后按钮隐藏或变为 disabled
[ ] 失败 toast 显示具体原因
```

### Backend

```txt
[ ] publishExam(ctx, examId) 使用 command function
[ ] 校验考试存在
[ ] 校验 organizationId
[ ] 校验题目数量 > 0
[ ] 校验 timed_window 时间窗口合法
[ ] 写入 AuditLog
```

## Suggested API

```txt
POST /api/exams/:examId/publish
```

Response:

```ts
{
  id: string;
  status: "published";
  publishedAt?: string;
}
```

## Tests

```txt
[ ] draft exam can publish
[ ] published exam cannot publish twice
[ ] exam with no questions cannot publish
[ ] unauthorized user cannot publish
[ ] publish writes AuditLog
[ ] page refreshes after publish
```

## Acceptance

```txt
[ ] 用户不会再感觉“点了没反应”
[ ] 草稿考试可以稳定发布
[ ] 发布失败原因明确
```
