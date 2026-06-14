# Phase 1.6 Overview

## 定位

Phase1.6 是 Phase1 收口层第三阶段，**不是 Phase2 提前开工**。

它在 Phase1.5 已交付的 PostgreSQL-only 基础上，完成 S03a 真正剩余的考试协议事务硬化：把 `submitAttempt` 与 `saveAnswers` 在同一条 `examAttempts` 行上正确串行化，并补齐尚未存在的 PG 并发集成测试与 deadline 端到端断言。

---

## 前置事实（写入文档时点：2026-06-12）

Phase1.4-S03a 与 Phase1.5 已经实际落地以下能力，Phase1.6 不再重复做：

- ✅ Deadline 错误码已统一为 `ATTEMPT_DEADLINE_EXCEEDED`（`packages/domain/src/errors.ts` `AttemptDeadlineExceededError`，HTTP 409），代码中已不存在 `EXAM_TIME_EXPIRED`
- ✅ `attemptRepo.findByIdForUpdate(ctx, id)` 已实现，使用 Drizzle `.for("update")`（`packages/db/src/repository/attemptRepo.ts:22`）
- ✅ `POST /attempts/:id/answers/:qid` 已整体包在 `executeInTransaction` 内：read（`findByIdForUpdate`）→ merge（`processSaveAnswer`）→ write 在同一 PG 事务内（`apps/api/src/routes/attempts.ts:611-690`）
- ✅ Phase1.5 PR #33 / commit `dec707c` 已合并：SQLite schema/migrations/`sqlite.ts` 全删，repository 收敛 PG-only，`packages/db` 中已无 `as any` / `as unknown as` 类型逃逸
- ✅ `package.json` 已具备 `db:up` / `db:down` / `db:reset` / `db:migrate` / `db:seed` / `test:pg`
- ✅ CI workflow 已切到 PostgreSQL service container 并通过

---

## Phase1.6 真正剩余的工作

1. **`POST /attempts/:id/submit` 仍未对同一行加 `FOR UPDATE` 锁**（`apps/api/src/routes/attempts.ts:734` 仍调用 `findByIdAndCandidate`），导致 saveAnswers 与 submit 不锁同一行，存在 lost-update / submit-after-save 竞争窗口
2. **`exam-engine` 的 `submitAttempt(attemptRepo, attemptId, now)`** 命令内部仍走 `findById` + `update` 两步，事务隔离依靠路由层包裹；row-level lock 必须由路由层在调用 command 前显式获取
3. ~~缺少端到端集成测试断言「`now > deadlineAt` 提交 → HTTP 409」~~ 已澄清并补测试：Phase 1 中 submit **不**受 deadline 限制；deadline 仅限制 save-answer（返回 `DEADLINE_EXCEEDED`）
4. **缺少**真正的 PG 并发测试套件（双 client + advisory lock barrier 或 controlled interleaving），现有测试只能覆盖单事务路径
5. **Phase1.3 P0** 正常考生提交回归未在新事务边界基础上复测

---

## Phase1.6 允许

- 让 `POST /attempts/:id/submit` 路由在事务内使用 `findByIdForUpdate`（或新增 `findByIdAndCandidateForUpdate`），与 saveAnswers 锁同一行
- 补齐 submit 路由 deadline 行为的端到端集成测试
- 编写 PG 并发集成测试套件（rollback / submit-then-save / save-then-submit / N-parallel save）
- 补齐 graded/submitted 状态下 save 被拒绝的端到端断言
- 在新事务边界基础上跑 Phase1.3 P0 考生提交回归

---

## Phase1.6 禁止

- 不实现自动提交超时试卷（auto-submit on deadline）
- 不实现 voidAttempt
- 不实现 showResultImmediately 服务端检查
- 不拆 `attempt_answers` 表
- 不实现多标签页会话锁
- 不做前端 submit flush（留给 S03b）
- 不实现 late submit
- 不实现 proctor override
- 不重新引入 SQLite 并发测试
- 不做数据库性能优化
- 不重复 Phase1.5 已交付内容（PG 收敛 / SQLite 移除 / migration / seed / CI gate）

---

## Phase1.6 完成后

S03a 在协议、错误码、事务边界、attempt-level serialization、并发测试五个维度上全部交付。Phase2 可以放心地构建自动提交、late policy、proctor override、session lock、result visibility 等能力。

Phase2 可以假设：

- `POST /attempts/:id/answers/:qid` 与 `POST /attempts/:id/submit` 对同一 attempt 行串行化（PG row-level lock）
- Deadline 超时后 save-answer 被拒绝（`DEADLINE_EXCEEDED`）；submit 不受 deadline 限制（Phase 1 语义）
- Graded / submitted 状态下 save 被拒绝且事务回滚不留半状态
- PG 并发集成测试套件作为 Phase2 entry gate
- Phase1.3 P0 正常考生提交场景在新事务边界下回归通过
