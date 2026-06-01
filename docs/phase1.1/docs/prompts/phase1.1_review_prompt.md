# Prompt — Phase 1.1 Review Agent

你是一名代码审查员。请审查 Phase 1.1 的实现是否真正修复闭环，而不是只修 UI 表象。

## 审查重点

### 1. P0 bug 是否解决

```txt
[ ] publish 不再触发 empty JSON body
[ ] delete course 不再触发 empty JSON body
[ ] Fastify parser 400 不再被包装成 500
[ ] 发布后页面状态刷新
[ ] 课程删除有反馈
[ ] 考试详情页能分配考生
[ ] Candidate 能看到自己的考试
[ ] Candidate 能开始考试
```

### 2. 架构底线

```txt
[ ] Route 不直接访问 db
[ ] Repository 接收 RequestContext
[ ] 查询带 organizationId
[ ] 状态变更通过 command function
[ ] 敏感操作写 AuditLog
[ ] DTO 不重复定义
[ ] 无 any / as any 滥用
[ ] 无 console.log
```

### 3. 考试底座

```txt
[ ] 服务端计时仍是权威
[ ] Answer Save Protocol 没被破坏
[ ] submitted/graded 不允许再保存答案
[ ] questionSnapshot 不被题库修改影响
[ ] enrollment 和 attempt 关系清楚
```

### 4. UI 反馈

```txt
[ ] publish loading/success/error
[ ] delete loading/success/error
[ ] enrollment add/remove loading/success/error
[ ] candidate start exam error reason 清楚
[ ] empty state 不空白
```

### 5. 测试

```txt
[ ] 有 API client 空 body 回归测试
[ ] 有 publish 回归测试
[ ] 有 enrollment 测试
[ ] 有 candidate my exams 测试
[ ] smoke 覆盖完整闭环
```

## 输出格式

```md
# Phase 1.1 Review Report

## Verdict

- PASS / PASS_WITH_MINOR_ISSUES / BLOCKED

## Blocking Issues

## Non-blocking Issues

## Architecture Risks

## Test Gaps

## Recommended Fix Prompt
```
