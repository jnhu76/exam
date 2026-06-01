# Prompt — Phase 2 Planning Agent

你是一名系统架构师。请基于 `docs/SPEC.md`、`docs/phase1.plan.md`、`docs/phase1.1-boundary.md` 和 `docs/phase2.plan.md`，把 Phase 2 拆成可执行 job。

## 前提

只有当 Phase 1.1 通过 smoke test 后，才允许执行本 prompt。

## 目标

为 Phase 2 生成 job 文档，但不要直接开始编码。

## Phase 2 分组

```txt
Phase 2A: Exam Operation
Phase 2B: Proctor Panel
Phase 2C: Exam Flexibility
Phase 2D: Integration & Export
```

## 要求

每个 job 文档包含：

```txt
1. 目标
2. 非目标
3. 前置依赖
4. 数据模型变化
5. API 合约
6. UI 页面
7. Repository / Service / Command 边界
8. AuditLog 要求
9. 测试计划
10. 验收标准
11. 禁止事项
```

## 优先级

先生成 Phase 2A 细 job：

```txt
P2A-J1 ExamRoom 管理
P2A-J2 IP 限制
P2A-J3 Attempt Heartbeat
P2A-J4 disrupted 检测与恢复
P2A-J5 Proctor Operations
P2A-J6 AuditLog 扩展
```

暂时不要展开 Electron、AI 批改、自适应降级。

## 禁止

- 不要把 Phase 1.1 的 bug 算进 Phase 2。
- 不要破坏 Phase 1 smoke。
- 不要让答案保存依赖 WebSocket。
- 不要绕过 RequestContext。
- 不要跳过 organizationId。
- 不要把监考面板做成无权限的全局视图。

## 输出

生成：

```txt
docs/jobs/phase2a_job01_exam_room.md
docs/jobs/phase2a_job02_ip_restriction.md
docs/jobs/phase2a_job03_attempt_heartbeat.md
docs/jobs/phase2a_job04_disrupted_restore.md
docs/jobs/phase2a_job05_proctor_operations.md
docs/jobs/phase2a_job06_auditlog_expansion.md
```
