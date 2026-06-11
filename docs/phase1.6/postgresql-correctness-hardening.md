# Phase 1.6 — PostgreSQL Correctness Hardening

**日期**: 2026-06-11
**分支**: `phase1.5-1.6-documentation`
**前置**: Phase1.5 PostgreSQL-only convergence 完成
**定位**: Phase1 收口层第三阶段，数据库正确性收敛
**核心原则**: PG-only 基础上的事务正确性验证，不是 UI 阶段

---

## 1. Purpose

Phase1.5 完成了 PostgreSQL-only 数据库收敛，移除了 SQLite 作为数据库行为测试后端。Phase1.6 将在 PG-only 基础上完成数据库正确性、事务正确性、migration、seed、CI、并发测试和回归门禁。

Phase1.6 是数据库正确性收敛，不是 UI 阶段，也不是新考试功能开发阶段。

---

## 2. Scope

Phase1.6 至少包含以下任务：

### P1.6-J1: Transaction Correctness

**目标**:
- `saveAnswers` 的 read -> merge/compute -> write 必须在同一个 `db.transaction()` 内
- `submitAttempt` 的 deadline check + status update 在单个事务内完成
- Route 不直接裸写 repository
- Command/service 层负责 transaction boundary
- Repository 支持 tx client

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
- [ ] saveAnswers 的 read -> merge/compute -> write 在同一个 PG transaction 内
- [ ] submitAttempt 的 deadline check + status update 在事务内
- [ ] Route 不直接裸写 repository
- [ ] Command/service 层负责 transaction boundary
- [ ] Repository 支持 tx client 参数

---

### P1.6-J2: Concurrency Tests

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
- [ ] 测试可靠（不 flaky）

---

### P1.6-J3: S03a PG Verification

**目标**:
- 在 PG-only 基础上验证 S03a 的服务端考试协议
- 验证 deadline 强制 409
- 验证 submit 幂等
- 验证 save + submit 并发安全

**验收**:
- [ ] `now > deadlineAt` submit -> 409 ATTEMPT_DEADLINE_EXCEEDED
- [ ] `now <= deadlineAt` submit 正常
- [ ] 并发 save + submit 不导致数据损坏
- [ ] `pnpm verify` 通过

---

### P1.6-J4: Migration/Seed Regression

**目标**:
- migration reset 稳定性
- seed reset 稳定性
- 在空 PG 数据库上可重复执行

**验收**:
- [ ] migration reset clean
- [ ] seed reset clean
- [ ] 空 PG 数据库上 migration + seed 可重复执行

---

### P1.6-J5: CI Gate

**目标**:
- CI 中 PG integration gate 稳定
- `pnpm verify` 在 CI 中通过

**验收**:
- [ ] CI 中 `pnpm verify` 稳定通过
- [ ] CI 中 PG integration tests 稳定通过
- [ ] CI 中 `pnpm lint:arch` 通过

---

## 3. Explicit Non-goals

Phase1.6 **明确不**实现以下功能：

- [ ] 不做 UI 样板
- [ ] 不做 S03b submit flush
- [ ] 不做 S04/S07 账号安全
- [ ] 不做 Phase2 监考功能
- [ ] 不恢复 SQLite correctness backend
- [ ] 不实现自动提交超时试卷（auto-submit on deadline）
- [ ] 不实现 voidAttempt
- [ ] 不实现 showResultImmediately 服务端检查
- [ ] 不拆 attempt_answers 表
- [ ] 不实现多标签页会话锁
- [ ] 不实现 late submit
- [ ] 不实现 proctor override
- [ ] 不做数据库性能优化

---

## 4. Exit Criteria

Phase1.6 完成时必须满足：

- [ ] saveAnswers PG concurrency test pass
- [ ] submitAttempt PG transaction test pass
- [ ] save + submit race test pass
- [ ] deadline protocol test pass
- [ ] Phase1.3 P0 student submit regression pass
- [ ] migration reset clean
- [ ] seed reset clean
- [ ] `pnpm verify` pass

---

## 5. CI Gate

1. CI 必须运行 PG integration tests
2. CI 必须运行并发测试
3. CI 必须验证 migration reset + seed reset
4. CI 必须验证 `pnpm verify`

---

## 6. Migration/Seed Regression

1. 每次 PR 必须验证 migration 在空 PG 数据库上可运行
2. seed 数据必须可重复生成
3. test seed 与 dev seed 隔离
4. migration 文件保持 database-agnostic

---

## Phase1.6 Dependencies

### Blocking

- Phase1.5 PostgreSQL-only convergence 必须已完成

### Blocks

- **Phase1.7**: Phase1.7 安全完成依赖 Phase1.6 的数据库正确性
- **Phase2 Entry Gate**: Phase2 必须依赖 Phase1.6 的 PG correctness hardening
