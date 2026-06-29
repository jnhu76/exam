# S03a Status Adjustment

## 时点

本文档反映的是 **Phase1.6 文档修订时（2026-06-12）的真实代码状态**，第三态。前两态分别是 Phase1.4-S03a 启动时与 Phase1.5/1.6 计划文档撰写时。

## 三态演进

```text
Phase1.4-S03a 启动: 整块 S03a（deadline + idempotency + answer save transaction）
                     ↓
Phase1.5/1.6 规划:  S03a 拆三段（1.4 / 1.5 / 1.6），DB 收敛先行
                     ↓
Phase1.6 文档修订:  Phase1.4-S03a + Phase1.5 已合并入 master，
                     S03a 实际剩余只剩 submit row-level lock + 测试补齐
```

## 三段拆分

| 段 | 归属 | 内容 |
|---|---|---|
| 1 | Phase1.4 | Deadline 策略文档化 / 错误码定义 / 初始 deadline 检查 / 基础 submit 幂等（已合并） |
| 2 | Phase1.5 | PG-only 收敛 / SQLite 测试后端移除 / PG integration test foundation（PR #33 / commit `dec707c` 已合并） |
| 3 | Phase1.6 | submit 路由 row-level lock 对齐 + saveAnswers/submitAttempt attempt-level serialization 验证 + PG 并发测试套件 + Phase1.3 P0 回归（**当前阶段**） |

## Phase1.4-S03a 与 Phase1.5 已交付清单

按代码证据列出，Phase1.6 不再重复：

| 已交付项 | 证据 |
|---|---|
| 错误码 `ATTEMPT_DEADLINE_EXCEEDED`（HTTP 409）取代 `EXAM_TIME_EXPIRED` | `packages/domain/src/errors.ts:68` `AttemptDeadlineExceededError` |
| `attemptRepo.findByIdForUpdate(ctx, attemptId)` 使用 Drizzle `.for("update")` | `packages/db/src/repository/attemptRepo.ts:22-38` |
| saveAnswers 路由整体包在 `executeInTransaction` 内 | `apps/api/src/routes/attempts.ts:611-690` |
| saveAnswers 在事务内 `findByIdForUpdate` 锁同一行后再 read/merge/write | `apps/api/src/routes/attempts.ts:620` |
| TOCTOU 修复：candidate ownership 校验已移入事务内 | commit `7db6bca fix(security): eliminate TOCTOU in saveAnswers route by moving ownership check inside transaction` |
| SQLite schema / migrations / `packages/db/src/schema/sqlite.ts` / `packages/db/src/sqlite.ts` 全删 | commit `71dea67` |
| `packages/db/src/` 内 `as any` / `as unknown as` 清零 | `rg "as unknown as\|as any" packages/db/src/` 仅剩 `postgres.test.ts` 反向断言 |
| `pnpm db:up` / `db:down` / `db:reset` / `db:migrate` / `db:seed` / `test:pg` | `package.json:16-26` |
| CI workflow 切换至 PostgreSQL service container | `.github/workflows/ci.yml`（commit `71dea67`） |
| seed.ts 改 `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` 防 TOCTOU | commit `71dea67` |
| turbo.json `@exam/api#test` 在 `@exam/db#test` 之后串行，避免共享 `exam_test` DB 污染 | commit `71dea67` |

## Phase1.6 实际剩余

| 剩余项 | 缺口 |
|---|---|
| `POST /attempts/:id/submit` 仍读 `findByIdAndCandidate`，未与 saveAnswers 锁同一行 | `apps/api/src/routes/attempts.ts:734` |
| `exam-engine.submitAttempt` 命令是 `findById` + `update` 两步，事务/锁需由路由层负责 | `packages/exam-engine/src/attemptCommands.ts:141-172` |
| Submit 路由层 deadline 端到端断言（`now > deadlineAt` → 409）缺失 | `apps/api/src/routes/attempts.test.ts` 未覆盖 |
| Graded / submitted 状态下 save 被拒绝的端到端断言缺失 | 同上 |
| PG 并发测试套件（双 client + barrier / controlled interleaving）缺失 | 没有相关 test 文件 |
| Phase1.3 P0 正常考生提交在新事务边界下的回归未跑 | — |

## 完成 Phase1.6 后

S03a 全部三段交付，可在 phase 进度表中标记为 complete。Phase2 entry gate 把这三段全部纳入前置依赖。
