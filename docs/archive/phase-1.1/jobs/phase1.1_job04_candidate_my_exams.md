# Phase 1.1 Job 04 — Candidate My Exams

## Goal

Candidate 登录后必须有自己的考试入口。否则 Phase 1 的“考试执行”链路断掉。

## Scope

- Candidate layout or route
- My Exams page
- Start confirmation page
- Candidate exam API
- startAttempt / restoreAttempt

## API

```txt
GET  /api/candidate/exams
POST /api/candidate/exams/:examId/start
```

## UI Pages

### My Exams

显示：

```txt
- 可参加考试
- 进行中考试
- 已完成考试
- 不可参加原因
```

每条考试显示：

```txt
考试名称
开放时间
时长
及格分
题目数
状态
操作按钮
```

### Start Confirmation

显示：

```txt
考试名称
时长
题目数量
及格分
开放时间窗口
开始按钮
```

## Rules

```txt
[ ] Candidate 只能看到自己的 enrollment
[ ] 未分配考试不显示
[ ] timed_window 检查 startTime/endTime
[ ] 如果已有 in_progress attempt，点击开始应恢复
[ ] startedAt/deadlineAt 由服务端生成
[ ] 不能信任客户端时间
[ ] start writes AuditLog
```

## Tests

```txt
[ ] candidate can list assigned exams
[ ] candidate cannot list others exams
[ ] not-open exam shows reason
[ ] candidate can start available exam
[ ] repeated start restores in_progress attempt
[ ] start creates deadlineAt from server time
```

## Acceptance

```txt
[ ] Candidate 登录后能找到考试
[ ] Candidate 能进入答题页
```
