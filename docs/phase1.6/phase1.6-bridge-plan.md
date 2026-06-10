# Phase 1.6 — Exam Protocol Hardening on PG-only Foundation

**日期**: 2026-06-11
**分支**: `phase1.5-1.6-documentation`
**前置**: Phase1.5 完成 PostgreSQL-only 收敛
**定位**: Phase1 收口层第三阶段，考试协议事务硬化

---

## 文件索引

| 文件 | 内容 |
|------|------|
| **`phase1.6-bridge-plan.md`** | **总纲 — Single Source of Truth。包含全部 Job Cards、Phase Boundary、Entry Gate、Handoff Notes。** |
| `01-overview.md` | Phase1.6 总览：目的、背景、范围、非目标、验收标准 |

> **若发生冲突，以 `phase1.6-bridge-plan.md` 为准。**

---

## Why Phase1.6 Exists

Phase1.5 完成了 PostgreSQL-only 数据库收敛，移除了 SQLite 作为数据库行为测试后端。Phase1.6 将在 PG-only 基础上继续完成 S03a 的协议硬化，重点解决 `saveAnswers` 与 `submitAttempt` 的 PostgreSQL 事务边界与 attempt-level serialization。

S03a 已完成或部分完成：

- Deadline 固定策略已有初步实现
- Submit 超时应返回 `409 ATTEMPT_DEADLINE_EXCEEDED`
- Submit 幂等已有基础状态机保护
- 但答案保存事务保护和 save + submit 并发安全尚未完成
- Phase1.6 将在 PG-only 基础上完成这部分

---

## Phase1.6 Scope

Phase1.6 至少包含以下任务：

### P1.6-S03a-1: Deadline Error Code Convergence

**目标**:

- 将 deadline exceeded 相关错误码统一为 `ATTEMPT_DEADLINE_EXCEEDED`
- 不再使用 `EXAM_TIME_EXPIRED` 作为协议错误码
- Domain / contracts / route / tests 保持一致

**验收**:

- [ ] `now > deadlineAt` submit → `409 ATTEMPT_DEADLINE_EXCEEDED`
- [ ] `now == deadlineAt` submit → success
- [ ] `now < deadlineAt` submit → success
- [ ] Timeout submit 不计分、不自动提交、不改变为 graded/submitted

**风险**:

- 需要检查所有使用 deadline 检查的代码路径
- 需要确保错误码在 domain、contracts、route、tests 中保持一致

---

### P1.6-S03a-2: saveAnswers PostgreSQL Transaction Boundary

**目标**:

- `saveAnswers` 的 read → merge/compute → write 必须在同一个 `db.transaction()` 内
- Route 不直接裸写 repository
- Command/service 层负责 transaction boundary
- Repository 支持 tx client
- 禁止 read 在 transaction 外、write 在 transaction 内的假事务

**反例（禁止）**:

```ts
// Wrong: read is outside transaction
const attempt = await repo.findById(id)

await db.transaction(async tx => {
  await repo.update(tx, id, nextAnswers)
})
```

**正确方向**:

```ts
await db.transaction(async tx => {
  const attempt = await repo.findByIdForUpdate(tx, attemptId)
  // validate status
  // merge answers
  // write answers
})
```

**验收**:

- [ ] saveAnswers 的 read → merge/compute → write 在同一个 PG transaction 内
- [ ] Route 不直接裸写 repository
- [ ] Command/service 层负责 transaction boundary
- [ ] Repository 支持 tx client

**风险**:

- 需要重构 saveAnswers 的调用链，确保 transaction 边界正确
- 需要修改 repository 方法签名，支持 tx client 参数

---

### P1.6-S03a-3: saveAnswers and submitAttempt Attempt-level Serialization

**目标**:

- `saveAnswers` 与 `submitAttempt` 必须对同一个 attempt 使用一致的 serialization strategy
- PostgreSQL 下优先使用 ORM 支持的 row-level lock 或等价的 `SELECT ... FOR UPDATE`
- 防止 submit 后旧 save 覆盖答案
- 防止 grading 使用的答案与最终保存答案不一致
- 防止 attempt status 与 answers 不一致
- Graded/submitted 后 save 必须被拒绝

**验收**:

- [ ] saveAnswers 和 submitAttempt 锁同一条 attempt row
- [ ] Graded/submitted 后 save 被拒绝
- [ ] Submit 不会被并发 save 破坏
- [ ] 最终状态与答案一致

**风险**:

- 需要选择合适的 serialization strategy（row-level lock、pessimistic lock、optimistic lock）
- 需要测试各种并发场景，确保没有 data race
- 需要考虑性能影响，避免过度锁表

---

### P1.6-S03a-4: PostgreSQL Concurrency Tests

**目标**:

- 新增 PG integration tests
- 验证 rollback
- 验证 concurrent save + submit
- 验证 submit 使用的答案与事务提交顺序一致
- 不允许只用普通 `Promise.all` 碰运气

**测试建议**:

- Barrier
- Delayed repository
- Transaction lock
- Controlled interleaving
- 或项目已有测试工具

**验收**:

- [ ] PG 下 saveAnswers rollback 测试通过
- [ ] PG 下 graded/submitted 后 save 被拒绝测试通过
- [ ] PG 下 concurrent save + submit 不损坏数据测试通过
- [ ] PG 下 submit 使用的答案与事务提交顺序一致测试通过

**风险**:

- 需要设计可靠的并发测试策略，避免 flaky tests
- 需要确保测试覆盖所有关键边界场景

---

### P1.6-S03a-5: Phase1.3 P0 Student Submit Scenario Regression

**目标**:

- 复测正常考生提交场景
- 确认新事务边界不破坏正常流程

**验收**:

- [ ] 正常答题
- [ ] 保存答案
- [ ] Submit
- [ ] Graded/submitted 状态符合既有预期
- [ ] Deadline 新逻辑不误伤正常提交

**风险**:

- 需要确保新事务边界不会影响现有正常流程
- 需要确认 deadline 新逻辑不会误伤正常提交

---

## Phase1.6 Non-goals

Phase1.6 **明确不**实现以下功能：

- [ ] 不实现自动提交超时试卷（auto-submit on deadline）
- [ ] 不实现 voidAttempt
- [ ] 不实现 showResultImmediately 服务端检查
- [ ] 不拆 attempt_answers 表
- [ ] 不实现多标签页会话锁
- [ ] 不做前端 submit flush，留给 S03b
- [ ] 不实现 late submit
- [ ] 不实现 proctor override
- [ ] 不重新引入 SQLite 并发测试
- [ ] 不做数据库性能优化

---

## Phase1.6 Acceptance Criteria

Phase1.6 完成时必须满足：

- [ ] `now > deadlineAt` submit → `409 ATTEMPT_DEADLINE_EXCEEDED`
- [ ] `now == deadlineAt` submit 正常
- [ ] `now < deadlineAt` submit 正常
- [ ] 超时 submit 不计分、不自动提交、不改变为 graded/submitted
- [ ] saveAnswers read → merge/compute → write 在同一 PG transaction 内
- [ ] saveAnswers 与 submitAttempt 对同一 attempt row 串行化
- [ ] Graded/submitted 状态下 save 被拒绝
- [ ] PG 并发 save + submit 不导致数据损坏
- [ ] PG integration tests 通过
- [ ] Phase1.3 P0 考生提交场景复测通过
- [ ] `pnpm test` 通过
- [ ] `pnpm test:pg` 或等价命令通过

---

## Phase1.6 Dependencies

### Blocking

- **Phase1.5**: PostgreSQL-only 收敛是 S03a 事务硬化的前置条件

### Parallelizable

- P1.6-S03a-1、P1.6-S03a-2、P1.6-S03a-3 可以并行开始（如果逻辑允许）
- P1.6-S03a-4 必须在 S03a-2、S03a-3 完成后执行
- P1.6-S03a-5 必须在所有 S03a job 完成后执行

### Blocks

- **Phase2 Entry Gate**: Phase2 必须依赖 S03a 的 save + submit 并发测试
- **Phase2-Auto-submit**: Phase2 的自动提交依赖 S03a 的事务硬化

---

## Handoff Notes to Phase2

Phase1.6 完成后，S03a 的事务硬化已完成，Phase2 可以放心地构建自动提交、late policy、proctor override、session lock、result visibility 等能力。

Phase2 可以假设：
- `saveAnswers` 和 `submitAttempt` 对同一 attempt row 正确串行化
- Deadline 超时提交会返回 `409 ATTEMPT_DEADLINE_EXCEEDED`
- 答案保存的 read → merge/compute → write 在同一个 PG transaction 内
- PG integration tests 已通过
- 正常考生提交场景不受影响