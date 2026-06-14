# Phase 1.4 — Release Hardening / 基础收口层

**日期**: 2026-06-10
**分支**: `phase1.4-bridge-plan`
**状态**: S03a.1 Attempt Lifecycle State Machine 实现中

---

## 定位

Phase1.4 是 Phase1 收口层，**不是 Phase2 提前开工**。

它只做三件事：
1. 让架构地基真实可用（PostgreSQL / Docker / Repository）
2. 让安全边界真实生效（多租户 / RBAC / 考试协议 / 认证）
3. 让 UI 有样板基准（3 个样板页，不全站重写）

## 文件索引

| 文件 | 内容 |
|------|------|
| **`phase1.4-bridge-plan.md`** | **总纲 — Single Source of Truth。包含全部 Job Cards、Phase Boundary、Entry Gate、Handoff Notes。** |
| `01-overall-assessment.md` | 整体评估：当前状态、遗留债务、Job 总览、执行顺序 |
| `02-architecture-jobs.md` | 架构 Job Cards (A00–A05) |
| `03-security-jobs.md` | 安全 Job Cards (S01–S09, S03a/S03b) |
| `04-ui-jobs.md` | UI Job Cards (U01–U04) |
| `05-dependency-graph.md` | 依赖关系图、Wave 执行顺序、并行策略 |

> **若发生冲突，以 `phase1.4-bridge-plan.md` 为准。**

## Phase1.4 禁止事项

- 禁止 Proctor Panel / 监考面板
- 禁止 Redis / WebSocket 代码实现（ADR 文档可以写）
- 禁止 Proctor Force Submit / 延长时间 / 标记违规
- 禁止自动提交超时试卷
- 禁止随机组卷
- 禁止 PDF / Excel async worker
- 禁止外部系统集成 / Pass Gate API / Service Token
- 禁止 UI 全站重写
- 禁止引入大型 UI 框架、图表库、动画库
- 禁止把答案保存主链路放入 MQ / 异步队列
- 禁止实现新的 timing mode（timed_sync / deadline / untimed）
- 禁止实现 `voidAttempt()` 命令
- 禁止实现 `showResultImmediately` 服务端检查
- 禁止 Proctor 业务路由（权限枚举可定义，路由不新增）

## 当前状态

- [x] Bridge plan 已完成并通过 review
- [x] Phase1.3 安全清单已合并
- [x] 文档收敛完成（本文件 + 所有子文件与 bridge 对齐）
- [x] S03a.1 Attempt Lifecycle State Machine — 纯函数状态机 + deadline guard + 集成到 attemptCommands / answerProtocol / grading
- [ ] S03a.1 测试通过 + pnpm verify 通过
- [ ] S03a.1 PR 合并

**下一步**: Run `pnpm verify` to validate S03a.1 implementation.
