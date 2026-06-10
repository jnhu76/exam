# Phase 1.6 Job Cards

本文档是 Phase1.6 的详细 Job Cards，每个 Job 都包含 Purpose / Scope / Non-goals / Acceptance Criteria / Risk。

---

## P1.6-S03a-1: Deadline Error Code Convergence

### Purpose

将 deadline exceeded 相关错误码统一为 `ATTEMPT_DEADLINE_EXCEEDED`，避免 `EXAM_TIME_EXPIRED` 等不一致的错误码，提高协议一致性。

### Scope

- [ ] 审查所有 deadline 相关错误码
- [ ] 统一为 `ATTEMPT_DEADLINE_EXCEEDED`（409 Conflict）
- [ ] 更新 domain errors 定义
- [ ] 更新 contracts schemas
- [ ] 更新 route handlers
- [ ] 更新 tests（包括 integration tests 和 unit tests）
- [ ] 验证错误码一致性

### Non-goals

- [ ] 不改变 deadline 检查逻辑
- [ ] 不改变 deadline 策略
- [ ] 不引入新的错误码

### Acceptance Criteria

- [ ] `now > deadlineAt` submit → `409 ATTEMPT_DEADLINE_EXCEEDED`
- [ ] `now == deadlineAt` submit → success
- [ ] `now < deadlineAt` submit → success
- [ ] Timeout submit 不计分、不自动提交、不改变为 graded/submitted
- [ ] Domain errors、contracts schemas、route handlers、tests 保持一致
- [ ] `pnpm verify` 通过

### Risk

- 需要检查所有使用 deadline 检查的代码路径
- 需要确保错误码在 domain、contracts、route、tests 中保持一致
- 可能存在隐藏的 deadline 检查点

### Dependencies

- Phase1.5（PG-only 基础）

### Parallelizable

- 是（可以与 P1.6-S03a-2、P1.6-S03a-3 并行开始）

---

## P1.6-S03a-2: saveAnswers PostgreSQL Transaction Boundary

### Purpose

确保 `saveAnswers` 的 read → merge/compute → write 在同一个 PG transaction 内，防止并发问题，避免 read-modify-write race condition。

### Scope

- [ ] 审查 saveAnswers 的调用链
- [ ] 重构 saveAnswers，将 read → merge/compute → write 放在同一个 `db.transaction()` 内
- [ ] 确保 route 不直接裸写 repository
- [ ] Command/service 层负责 transaction boundary
- [ ] 修改 repository 方法签名，支持 tx client 参数
- [ ] 添加 `findByIdForUpdate` 等 repository 方法（使用 `SELECT ... FOR UPDATE`）
- [ ] 更新 tests（包括 integration tests 和 unit tests）
- [ ] 验证 transaction 边界正确

### Non-goals

- [ ] 不改变 saveAnswers 的业务逻辑
- [ ] 不改变 answer protocol 的版本化和幂等机制
- [ ] 不引入新的事务策略

### Acceptance Criteria

- [ ] saveAnswers 的 read → merge/compute → write 在同一个 PG transaction 内
- [ ] Route 不直接裸写 repository
- [ ] Command/service 层负责 transaction boundary
- [ ] Repository 支持 tx client 参数
- [ ] 存在 `findByIdForUpdate` 等 repository 方法（使用 `SELECT ... FOR UPDATE`）
- [ ] `pnpm test` 通过
- [ ] `pnpm test:pg` 通过
- [ ] `pnpm verify` 通过

### Risk

- 需要重构 saveAnswers 的调用链，确保 transaction 边界正确
- 需要修改 repository 方法签名，支持 tx client 参数
- 需要确保 transaction 失败时正确 rollback
- 需要避免嵌套事务问题

### Dependencies

- Phase1.5（PG-only 基础）

### Parallelizable

- 是（可以与 P1.6-S03a-1、P1.6-S03a-3 并行开始）

---

## P1.6-S03a-3: saveAnswers and submitAttempt Attempt-level Serialization

### Purpose

确保 `saveAnswers` 与 `submitAttempt` 对同一个 attempt 使用一致的 serialization strategy，防止 submit 后旧 save 覆盖答案，防止 grading 使用的答案与最终保存答案不一致。

### Scope

- [ ] 选择 serialization strategy（推荐使用 row-level lock / `SELECT ... FOR UPDATE`）
- [ ] 确保 saveAnswers 和 submitAttempt 使用相同的 serialization strategy
- [ ] 在 graded/submitted 状态下拒绝 save
- [ ] 防止 submit 后旧 save 覆盖答案
- [ ] 防止 grading 使用的答案与最终保存答案不一致
- [ ] 防止 attempt status 与 answers 不一致
- [ ] 更新 tests（包括 integration tests 和 unit tests）
- [ ] 验证 serialization 正确

### Non-goals

- [ ] 不实现新的 serialization strategy（使用 PG 现有能力）
- [ ] 不改变 saveAnswers 和 submitAttempt 的业务逻辑
- [ ] 不引入新的锁机制

### Acceptance Criteria

- [ ] saveAnswers 和 submitAttempt 使用相同的 serialization strategy
- [ ] saveAnswers 和 submitAttempt 锁同一条 attempt row
- [ ] Graded/submitted 后 save 被拒绝（返回 409 Conflict 或类似错误）
- [ ] Submit 不会被并发 save 破坏
- [ ] 最终状态与答案一致
- [ ] `pnpm test` 通过
- [ ] `pnpm test:pg` 通过
- [ ] `pnpm verify` 通过

### Risk

- 需要选择合适的 serialization strategy（row-level lock、pessimistic lock、optimistic lock）
- 需要测试各种并发场景，确保没有 data race
- 需要考虑性能影响，避免过度锁表
- 需要确保死锁不会发生

### Dependencies

- Phase1.5（PG-only 基础）
- P1.6-S03a-2（saveAnswers transaction boundary）

### Parallelizable

- 是（可以与 P1.6-S03a-1、P1.6-S03a-2 并行开始，但建议在 S03a-2 完成后执行）

---

## P1.6-S03a-4: PostgreSQL Concurrency Tests

### Purpose

新增 PG integration tests，验证 rollback、concurrent save + submit、submit 使用的答案与事务提交顺序一致，确保并发场景下的正确性。

### Scope

- [ ] 设计并发测试策略（barrier、delayed repository、transaction lock、controlled interleaving 等）
- [ ] 实现 saveAnswers rollback 测试
- [ ] 实现 graded/submitted 后 save 被拒绝测试
- [ ] 实现 concurrent save + submit 不损坏数据测试
- [ ] 实现 submit 使用的答案与事务提交顺序一致测试
- [ ] 确保测试可靠（不 flaky）
- [ ] 验证所有 PG integration tests 通过

### Non-goals

- [ ] 不重写现有 tests
- [ ] 不改变测试目的

### Acceptance Criteria

- [ ] PG 下 saveAnswers rollback 测试通过
- [ ] PG 下 graded/submitted 后 save 被拒绝测试通过
- [ ] PG 下 concurrent save + submit 不损坏数据测试通过
- [ ] PG 下 submit 使用的答案与事务提交顺序一致测试通过
- [ ] 测试可靠（不 flaky）
- [ ] `pnpm test:pg` 通过
- [ ] `pnpm verify` 通过

### Risk

- 需要设计可靠的并发测试策略，避免 flaky tests
- 需要确保测试覆盖所有关键边界场景
- 并发测试可能耗时较长，需要考虑 CI 时间

### Dependencies

- P1.6-S03a-2（saveAnswers transaction boundary）
- P1.6-S03a-3（attempt-level serialization）

### Parallelizable

- 否（必须在 S03a-2、S03a-3 完成后执行）

---

## P1.6-S03a-5: Phase1.3 P0 Student Submit Scenario Regression

### Purpose

复测正常考生提交场景，确认新事务边界不破坏正常流程，确保 deadline 新逻辑不误伤正常提交。

### Scope

- [ ] 复测正常考生提交场景（答题 → 保存答案 → submit → graded/submitted）
- [ ] 确认 graded/submitted 状态符合既有预期
- [ ] 确认 deadline 新逻辑不误伤正常提交（`now <= deadlineAt`）
- [ ] 运行现有 Phase1.3 smoke tests
- [ ] 运行现有 Phase1.3 integration tests
- [ ] 验证所有 tests 通过

### Non-goals

- [ ] 不改变正常考生提交的业务流程
- [ ] 不引入新的业务逻辑

### Acceptance Criteria

- [ ] 正常答题 → 保存答案 → submit → graded/submitted 流程正常
- [ ] Graded/submitted 状态符合既有预期
- [ ] Deadline 新逻辑不误伤正常提交（`now <= deadlineAt`）
- [ ] Phase1.3 smoke tests 通过
- [ ] Phase1.3 integration tests 通过
- [ ] `pnpm test` 通过
- [ ] `pnpm test:pg` 通过
- [ ] `pnpm verify` 通过

### Risk

- 需要确保新事务边界不会影响现有正常流程
- 需要确认 deadline 新逻辑不会误伤正常提交
- 可能存在隐藏的正常流程回归

### Dependencies

- P1.6-S03a-1（deadline error code convergence）
- P1.6-S03a-2（saveAnswers transaction boundary）
- P1.6-S03a-3（attempt-level serialization）
- P1.6-S03a-4（PG concurrency tests）

### Parallelizable

- 否（必须在所有 S03a job 完成后执行）

---

## Dependencies Summary

### Blocking

- Phase1.5（PG-only 基础）

### Parallelizable

- P1.6-S03a-1、P1.6-S03a-2、P1.6-S03a-3 可以并行开始（如果逻辑允许）
- P1.6-S03a-4 必须在 S03a-2、S03a-3 完成后执行
- P1.6-S03a-5 必须在所有 S03a job 完成后执行

### Blocks

- Phase2 Entry Gate：Phase2 必须依赖 S03a 的 save + submit 并发测试
- Phase2-Auto-submit：Phase2 的自动提交依赖 S03a 的事务硬化