# Phase 1.6 Job Cards

本文件是 Phase1.6 的可执行 Job Cards 列表，与 `phase1.6-bridge-plan.md` 一一对应，提供更紧凑的施工 checklist 视图。**若两文件冲突，以 `phase1.6-bridge-plan.md` 为准。**

> Phase1.6 使用唯一一套 Job 编号 `P1.6-S03a-1..5`。任何 `P1.6-J1..J5` 旧编号已废弃。

---

## P1.6-S03a-1: Submit Deadline E2E Hardening

### Purpose

Phase1.4 已经把 deadline 错误码统一为 `ATTEMPT_DEADLINE_EXCEEDED`（HTTP 409），但 submit 路由层缺少端到端 HTTP 集成测试断言；同时清理任何残留的 `EXAM_TIME_EXPIRED` 字符串。

### Scope

- [ ] `rg -n "EXAM_TIME_EXPIRED" apps/ packages/` 返回空（仅 `docs/` 历史改名记录章节可保留）
- [ ] 在 `apps/api/src/routes/attempts.test.ts` 增加 HTTP 集成测试，覆盖三个时点分支
- [ ] 验证错误响应文案 zh-CN

### Non-goals

- [ ] 不修改 `AttemptDeadlineExceededError` 类与 errorCode
- [ ] 不引入新错误码
- [ ] 不实现自动提交（auto-submit）

### Acceptance Criteria

- [ ] `now > deadlineAt` 时 `POST /attempts/:id/submit` → `409 { error: { code: "ATTEMPT_DEADLINE_EXCEEDED", message: "<zh-CN>" } }`
- [ ] `now == deadlineAt` 时 → `200`，attempt.status = `submitted`
- [ ] `now < deadlineAt` 时 → `200`，attempt.status = `submitted`
- [ ] 超时 submit 不计分、不写 grading 字段、不修改 enrollment 终态
- [ ] `pnpm verify` 通过

### Risk

- 时间断言在 CI 上易 flaky，建议通过 server 端注入 `now` 或 fake-timer 控制

### Dependencies

- 无

### Parallelizable

- 是（与 S03a-2 / S03a-3 并行）

---

## P1.6-S03a-2: Submit Route Row-level Lock Alignment

### Purpose

Phase1.6 唯一的核心代码动作。让 `POST /attempts/:id/submit` 在事务内对同一 attempt 行加 `FOR UPDATE` 行锁，与 `saveAnswers` 锁同一行，关闭 lost-update / submit-after-save 竞争窗口。

### Scope

- [ ] 修改 `apps/api/src/routes/attempts.ts` submit 路由：在 `executeInTransaction` 内先取行锁再做 ownership 校验
- [ ] 视情况在 `attemptRepo` 新增 `findByIdAndCandidateForUpdate` 复合方法
- [ ] 保持 `submitAttempt` 命令（`packages/exam-engine/src/attemptCommands.ts`）对外签名不变
- [ ] 单元 / 集成测试覆盖「无 candidate profile」「attempt 不属于该 candidate」分支

### Non-goals

- [ ] 不修改 `submitAttempt` 命令对外签名
- [ ] 不更换隔离级别（保持 PG 默认 `read committed`）
- [ ] 不引入 advisory lock 作为业务锁
- [ ] 不实现 optimistic lock 替代方案

### Acceptance Criteria

- [ ] submit 路由在事务内使用 `findByIdForUpdate(ctx, attemptId)`（或 `findByIdAndCandidateForUpdate`）
- [ ] Candidate ownership 校验在取行锁之后、调用 `submitAttempt` 之前完成
- [ ] 双连接同时调用 saveAnswers 与 submit 时：后启动者必须等待先启动者事务结束（由 S03a-4 测试断言）
- [ ] `pnpm typecheck` / `pnpm lint:arch` / `pnpm test` / `pnpm test:pg` 通过

### Risk

- `attemptRepo` 公开方法签名变化需同步 fake repository（如有）
- `submitAttempt` 命令内部仍会再次 `findById`；保留命令现签名 + adapter 注入即可
- PG 默认 `read committed` + `FOR UPDATE` 已足够串行化两事务对同一行的写

### Drizzle API 锚定（context7 核对，2026-06）

- `db.transaction(async tx => {...}, { isolationLevel: "read committed", accessMode: "read write" })`
- `tx.select().from(t).for("update").where(...)` 对应 `SELECT ... FOR UPDATE`
- 路由层沿用 `executeInTransaction`（`packages/db/src/types.ts`）

### Dependencies

- 无（与 S03a-1 / S03a-3 并行）

### Parallelizable

- 是

---

## P1.6-S03a-3: Graded/Submitted Save Rejection E2E

### Purpose

确认 `POST /attempts/:id/answers/:qid` 在 attempt 状态为 `submitted` / `graded` 时端到端被拒绝，事务回滚不留半状态。`processSaveAnswer` 已含 status 判断；本 Job 只补缺失的 HTTP 集成断言。

### Scope

- [ ] HTTP 集成测试覆盖：状态 = `submitted` 时 save 被拒绝
- [ ] HTTP 集成测试覆盖：状态 = `graded` 时 save 被拒绝
- [ ] 拒绝场景下断言数据库 attempt 行未被修改

### Non-goals

- [ ] 不修改 `processSaveAnswer` 业务逻辑
- [ ] 不修改 `AttemptStatus` 枚举
- [ ] 不引入新错误码（沿用 `processSaveAnswer` 已抛出的错误）

### Acceptance Criteria

- [ ] 两类 HTTP 集成测试存在并通过
- [ ] 拒绝场景下 `answers` / `lastActivityAt` 不变
- [ ] 错误响应文案 zh-CN
- [ ] `pnpm verify` 通过

### Risk

- 需与 S03a-2 协调，确认 submit 后的最终 attempt 状态以决定测试 fixture

### Dependencies

- 无（与 S03a-1 / S03a-2 并行）

### Parallelizable

- 是

---

## P1.6-S03a-4: PostgreSQL Concurrency Test Suite

### Purpose

编写真正可重现的 PG 并发集成测试，覆盖 saveAnswers 与 submitAttempt 在同一 attempt 行上的关键交错。**禁止用 `Promise.all` 碰运气。**

### Scope

- [ ] 选定 barrier 实现：`pg_advisory_lock` / `pg_advisory_unlock` 或 controlled interleaving（手动 `await` 阶段控制）
- [ ] 使用真实双 PG client（独立连接 + 独立事务）
- [ ] 测试位置：`packages/db/src/__tests__/` 或 `apps/api/tests/concurrency/`
- [ ] 通过 `pnpm test:pg` 入口运行

### 必须覆盖的 4 类场景

- [ ] **rollback**：事务在 saveAnswers 内抛错 → 事务回滚 → attempt 行的 `answers` / `lastActivityAt` / `status` 与事务前一致
- [ ] **submit-then-save**：submit 已 commit（status = `submitted` / `graded`）→ 后续 save 被拒绝
- [ ] **save-then-submit**：save 持有 `FOR UPDATE` 行锁 → submit 必须等待 → save commit 后 submit 才返回 → 最终 status = `submitted` 且 `answers` 包含 save 写入的版本
- [ ] **N-parallel save**（建议 N=10）：N 个并发 save 同一 attempt → 最终 `answers` 中每个 questionId 的 `version` 单调递增、不丢失任何 accepted save、idempotency 保护幂等重复

### Non-goals

- [ ] 不测试 application-level mutex
- [ ] 不测试 PG advisory lock 作为业务锁（仅作为测试 barrier）
- [ ] 不引入 `vitest.concurrent`（避免 worker 并发干扰真实事务时序）
- [ ] 不测试 cross-attempt 串行化（不同 attempt 行不应互相阻塞）

### Acceptance Criteria

- [ ] 上述 4 类测试全部存在并通过
- [ ] 在 CI 上跑 10 次不 flaky（PR review 阶段抽样验证）
- [ ] 测试不依赖 `sleep` / `setTimeout` 等时间魔法
- [ ] `pnpm test:pg` 通过

### Risk

- 跨连接 barrier 实现复杂度高，需谨慎管理连接释放避免耗尽 PG `max_connections`
- N-parallel save 的 N 取值不可过大以免拖慢 CI

### Dependencies

- S03a-2（必须先完成 row-level lock 对齐）
- S03a-3（拒绝行为需要先定义）

### Parallelizable

- 否（必须在 S03a-2 与 S03a-3 都合入 master 后开始）

---

## P1.6-S03a-5: Phase1.3 P0 Submit Regression on New Transaction Boundary

### Purpose

S03a-1..4 全部合入 master 后，复测 Phase1.3 标记为 P0 的「正常考生提交」端到端场景，确认新事务边界 + 行锁不破坏正常流程。

### Scope

- [ ] 跑 Phase1.3 现有 smoke / integration / e2e tests
- [ ] 跑 `pnpm test` / `pnpm test:pg` / `pnpm verify`
- [ ] 重点观察 `lastActivityAt` 在新事务边界下是否被多写或漏写

### Non-goals

- [ ] 不重写 Phase1.3 的测试
- [ ] 不引入新业务流程
- [ ] 不扩展为 stress test

### Acceptance Criteria

- [ ] 正常答题 → save → submit → graded/submitted 流程在 master 当前代码上跑通
- [ ] `now == deadlineAt` 边界 submit 不被新逻辑误伤
- [ ] enrollment 终态、scoreStrategy 选分行为符合 Phase1.3 既有预期
- [ ] Phase1.3 现有测试全部通过
- [ ] `pnpm verify` 通过

### Risk

- 隐藏的正常流程回归（如 `lastActivityAt` 多写一次导致 heartbeat 行为变化）

### Dependencies

- S03a-1 + S03a-2 + S03a-3 + S03a-4

### Parallelizable

- 否（最后一步）

---

## Dependencies Summary

### Blocking（外部）

- Phase1.4-S03a 已合并
- Phase1.5 已合并（PR #33 / commit `dec707c`）

### Internal Order

```text
S03a-1 ─┐
S03a-2 ─┼─→ S03a-4 ─→ S03a-5
S03a-3 ─┘
```

- S03a-1 / S03a-2 / S03a-3 三者并行启动
- S03a-4 必须在 S03a-2 + S03a-3 都合入 master 后开始
- S03a-5 必须在前 4 个 Job 全部合入 master 后开始

> 旧版「S03a-3 与 S03a-2 并行 + 建议在 S03a-2 之后」的自相矛盾表述已废弃。

### Blocks

- **Phase2 Entry Gate**：依赖 S03a-4 PG 并发测试套件
- **Phase2 Auto-submit**：依赖 S03a-2 row-level lock 对齐
- **Phase1.7 安全 Job**：依赖 S03a-2 行锁基础
