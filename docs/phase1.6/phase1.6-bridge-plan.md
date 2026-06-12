# Phase 1.6 — Exam Protocol Hardening on PG-only Foundation

**日期**: 2026-06-12
**分支**: `feat/phase1.6-pg-correctness-hardening`
**前置**: Phase1.4-S03a + Phase1.5（PR #33 / commit `dec707c`）已合并入 master
**定位**: Phase1 收口层第三阶段，考试协议事务硬化收尾

---

## 文件索引

| 文件 | 内容 |
|------|------|
| **`phase1.6-bridge-plan.md`** | **总纲 — Single Source of Truth。包含全部 Job Cards、依赖、Entry / Exit Gate、Handoff Notes。** |
| `01-overview.md` | Phase1.6 总览：定位、前置事实、剩余范围、允许 / 禁止、完成条件 |
| `jobs.md` | Job Cards 详细版，与本文件 Job 列表一一对应 |
| `s03a-status-adjustment.md` | S03a 三态演进 + Phase1.4-S03a / Phase1.5 已交付清单 + Phase1.6 实际剩余 |
| `postgresql-correctness-hardening.md` | 历史背景 + 决策附录（不再作为 Job 来源） |

> **若发生冲突，以 `phase1.6-bridge-plan.md` 为准。**
> **本文件使用唯一一套 Job 编号 `P1.6-S03a-1..5`。任何 `P1.6-J1..J5` 的旧编号已废弃，仅作为历史保留在附录文件中。**

---

## Why Phase1.6 Exists

Phase1.4-S03a 与 Phase1.5 已经在 master 落地了 deadline 错误码统一、`findByIdForUpdate` 行级锁支持、saveAnswers 路由事务化、PG-only 收敛、CI / seed / migration gate。

但 S03a 的核心目标 ——「`saveAnswers` 与 `submitAttempt` 对同一 attempt 行串行化」—— 仍未完成：

1. `POST /attempts/:id/submit` 路由（`apps/api/src/routes/attempts.ts:734`）仍读 `findByIdAndCandidate`，未取得行锁
2. saveAnswers 与 submit 锁的不是同一行，存在 lost-update / submit-after-save 竞争窗口
3. 现有测试只能覆盖单事务路径，没有真正的双连接并发测试
4. Submit 路由的 deadline 行为没有端到端 HTTP 层断言
5. Graded / submitted 状态下 save 被拒绝的行为没有端到端 HTTP 层断言
6. Phase1.3 P0 正常考生提交场景未在新事务边界下复测

Phase1.6 收尾这 6 项。

---

## Phase1.6 Scope（5 个 Job）

### P1.6-S03a-1: Submit Deadline E2E Hardening

**目标**:

- 清理代码与文档中残留的 `EXAM_TIME_EXPIRED` 字符串引用（错误码本体已在 Phase1.4 统一为 `ATTEMPT_DEADLINE_EXCEEDED`，本 Job 只做扫尾）
- 在 `apps/api/src/routes/attempts.test.ts` 增加端到端断言：通过 HTTP 调用 `POST /attempts/:id/submit`，覆盖三个时点分支
- 验证 candidate-facing 错误文案为 zh-CN

**HTTP 层 acceptance**:

```text
fixedNow >  attempt.deadlineAt → POST /submit → 409 { error: { code: "ATTEMPT_DEADLINE_EXCEEDED", message: "<zh-CN>" } }
fixedNow == attempt.deadlineAt → POST /submit → 200, attempt.status = "submitted"
fixedNow <  attempt.deadlineAt → POST /submit → 200, attempt.status = "submitted"
超时 submit 不计分、不写 submittedAt 之外的 grading 字段、不修改 enrollment 终态
```

**Non-goals**:

- 不修改 `AttemptDeadlineExceededError` 类与 errorCode
- 不引入新错误码
- 不实现自动提交（auto-submit）

**Acceptance**:

- [ ] `rg -n "EXAM_TIME_EXPIRED" apps/ packages/ docs/` 返回空（仅文档历史改名记录章节可保留）
- [ ] 上述三时点分支的 HTTP 集成测试存在并通过
- [ ] 错误响应文案为 zh-CN
- [ ] `pnpm verify` 通过

**Risk**:

- 时间断言在 CI 上易 flaky；建议把 `now` 通过 server-side 注入或 fake-timer 控制，避免依赖真实时间

**Dependencies**: 无

**Parallelizable**: 是（与 S03a-2 / S03a-3 并行）

---

### P1.6-S03a-2: Submit Route Row-level Lock Alignment

**目标**:

让 `POST /attempts/:id/submit` 在事务内对同一 attempt 行加 `FOR UPDATE` 锁，与 saveAnswers 锁同一行，关闭 lost-update / submit-after-save 竞争窗口。这是 Phase1.6 唯一的核心代码动作。

**当前缺口（master 现状）**:

```ts
// apps/api/src/routes/attempts.ts:725-748
await executeInTransaction(fastify.db, async (tx) => {
  const txAttemptRepo = createAttemptRepo(tx);
  const candidateProfile = await createCandidateRepo(tx).findByUserId(ctx, ctx.actorId);
  if (!candidateProfile) throw new NotFoundError("Candidate profile not found");

  // 没有 FOR UPDATE，与 saveAnswers 不锁同一行
  const attempt = await txAttemptRepo.findByIdAndCandidate(ctx, attemptId, candidateProfile.id);
  if (!attempt) throw new NotFoundError("Attempt not found");

  await submitAttempt(createAttemptRepoAdapter(txAttemptRepo, ctx), attemptId, new Date());
});
```

**正确方向（行为锁定，实现细节由施工时定）**:

- 在事务内先用 `findByIdForUpdate(ctx, attemptId)` 取行锁
- 再做 candidate ownership 校验（避免跨租户 / 跨 candidate 访问）
- 然后调用 `submitAttempt(...)` 命令完成状态机转换 + update
- saveAnswers 与 submit 通过同一把 `FOR UPDATE` 行锁串行化
- 可选：在 `attemptRepo` 新增 `findByIdAndCandidateForUpdate` 复合方法

**反例（禁止）**:

- 事务外 `findById` 后再进入事务（read-modify-write race）
- 事务内只读不锁就调 `update`（与 saveAnswers 不锁同一行 = 没串行化）
- 用 application-level mutex 替代行锁（多实例部署失效）

**Drizzle API 锚定**（context7 核对，2026-06）:

- `db.transaction(async tx => {...}, { isolationLevel: "read committed", accessMode: "read write" })`
- `tx.select().from(t).for("update").where(...)` 对应 `SELECT ... FOR UPDATE`
- 嵌套 `tx.transaction(...)` 走 SAVEPOINT，本 Job 不引入嵌套
- 路由层沿用项目已有的 `executeInTransaction` 抽象（`packages/db/src/types.ts`）

**Non-goals**:

- 不修改 `submitAttempt` 命令（`packages/exam-engine/src/attemptCommands.ts`）的对外签名
- 不更换隔离级别（保持 PG 默认 `read committed`）
- 不引入 advisory lock 作为业务锁（仅在测试 barrier 中使用，见 S03a-4）
- 不实现 optimistic lock 替代方案

**Acceptance**:

- [ ] submit 路由在事务内使用 `findByIdForUpdate`（或 `findByIdAndCandidateForUpdate`）
- [ ] Candidate ownership 校验在取行锁之后、调用 `submitAttempt` 之前完成
- [ ] 两连接同时调用 saveAnswers 与 submit：后启动者等待先启动者事务结束（PG 集成测试断言）
- [ ] 单元 / 集成测试覆盖「无 candidate profile」「attempt 不属于该 candidate」分支
- [ ] `pnpm typecheck` / `pnpm lint:arch` / `pnpm test` / `pnpm test:pg` 通过

**Risk**:

- `attemptRepo` 公开方法签名变化需同步 fake repository（如有）
- `submitAttempt` 命令在路由层已持锁的前提下，内部会再次 `findById`；保留命令现有签名 + adapter 注入即可，不必改命令本体
- PG 默认 `read committed` + `FOR UPDATE` 已足够串行化两事务对同一行的写，不需要升级到 `repeatable read`

**Dependencies**: 无

**Parallelizable**: 是（与 S03a-1 / S03a-3 并行）

---

### P1.6-S03a-3: Graded/Submitted Save Rejection E2E

**目标**:

确认 `POST /attempts/:id/answers/:qid` 在 attempt 状态为 `submitted` / `graded` 时返回明确的拒绝响应，事务回滚不留半状态。

**现状**:

`processSaveAnswer`（`packages/exam-engine/src/answerProtocol.ts`）已有 status 判断；saveAnswers 路由已包在 `executeInTransaction` 内。本 Job 只补缺失的端到端 HTTP 层断言。

**Acceptance**:

- [ ] HTTP 集成测试覆盖：状态 = `submitted` 时 save → 拒绝（4xx，沿用 `processSaveAnswer` 已抛出的错误）
- [ ] HTTP 集成测试覆盖：状态 = `graded` 时 save → 拒绝
- [ ] 拒绝场景下数据库 attempt 行未被修改（`answers` / `lastActivityAt` 不变）
- [ ] 错误文案 zh-CN
- [ ] `pnpm verify` 通过

**Non-goals**:

- 不修改 `processSaveAnswer` 业务逻辑
- 不修改 `AttemptStatus` 枚举
- 不引入新错误码

**Risk**:

- 需与 S03a-2 协调，确认 submit 完成后的最终 attempt 状态（`submitted` 还是 `graded`）以决定测试 fixture

**Dependencies**: 无（与 S03a-1 / S03a-2 并行）

**Parallelizable**: 是

---

### P1.6-S03a-4: PostgreSQL Concurrency Test Suite

**目标**:

编写真正可重现的 PG 并发集成测试，覆盖 saveAnswers 与 submitAttempt 在同一 attempt 行上的所有关键交错。禁止用 `Promise.all` 碰运气。

**测试设计要求**:

- 使用真实双 PG client（不是同一连接的两次调用），分别开启独立事务
- 跨连接同步使用 `pg_advisory_lock` / `pg_advisory_unlock` 作为 barrier，或 controlled interleaving（手动 `await` 阶段控制）
- 必须**断言等待行为**：先启动者持锁时，后启动者必须阻塞，直到先启动者 commit / rollback 才返回
- 测试位置建议放在 `packages/db/src/__tests__/` 或 `apps/api/tests/concurrency/`，遵循已有 PG integration test 风格
- 通过 `pnpm test:pg` 入口运行

**必须覆盖的 4 类场景**:

1. **rollback**：事务在 saveAnswers 内抛错 → 事务回滚 → attempt 行的 `answers` / `lastActivityAt` / `status` 与事务前一致
2. **submit-then-save**：submit 已 commit（status = `submitted` / `graded`）→ 后续 save 被拒绝（沿用 S03a-3 的拒绝错误）
3. **save-then-submit**：save 进行中（持有 `FOR UPDATE` 行锁）→ submit 必须等待 → save commit 后 submit 才返回 → 最终 status = `submitted` 且 `answers` 包含 save 写入的版本
4. **N-parallel save**：N 个并发 save 同一 attempt → 最终 `answers` 中每个 questionId 的 `version` 单调递增、不丢失任何 accepted save、`processSaveAnswer` idempotency 保护幂等重复

**Non-goals**:

- 不测试 application-level mutex（项目不使用）
- 不测试 PG advisory lock 作为业务锁（仅作为测试 barrier）
- 不引入 `vitest.concurrent`（避免 vitest 自己的 worker 并发干扰真实事务时序）
- 不测试 cross-attempt 串行化（不同 attempt 行不应互相阻塞）

**Acceptance**:

- [ ] 上述 4 类测试全部存在并通过
- [ ] 测试在 CI 上跑 10 次不 flaky（由 PR review 阶段抽样验证）
- [ ] 测试不依赖 sleep / setTimeout 等时间魔法
- [ ] `pnpm test:pg` 通过

**Risk**:

- 跨连接 barrier 的实现复杂度高，需要谨慎管理连接释放避免 CI 上耗尽 PG `max_connections`
- N-parallel save 测试需选定合理的 N（建议 N=10），过大会拖慢 CI

**Dependencies**: S03a-2（必须先完成 submit row-level lock 对齐，否则 save-then-submit / submit-then-save 测试无法成立）+ S03a-3（拒绝行为已定义）

**Parallelizable**: 否（必须在 S03a-2 与 S03a-3 完成后开始）

---

### P1.6-S03a-5: Phase1.3 P0 Submit Regression on New Transaction Boundary

**目标**:

在 S03a-1..4 全部合入 master 后，跑一遍 Phase1.3 标记为 P0 的「正常考生提交」端到端场景，确认新事务边界 + 行锁不破坏正常流程。

**Acceptance**:

- [ ] 正常答题 → save answer → submit → graded/submitted 流程在 master 当前代码上跑通
- [ ] `now == deadlineAt` 边界 submit 不被新逻辑误伤
- [ ] enrollment 终态、scoreStrategy 选分行为符合 Phase1.3 既有预期
- [ ] Phase1.3 现有 smoke / integration / e2e tests 全部通过
- [ ] `pnpm test` / `pnpm test:pg` / `pnpm verify` 通过

**Non-goals**:

- 不重写 Phase1.3 的测试
- 不引入新业务流程
- 不扩展为 stress test

**Risk**:

- 隐藏的正常流程回归（如 `lastActivityAt` 在新事务边界下被多写一次导致 heartbeat 行为变化）

**Dependencies**: S03a-1 + S03a-2 + S03a-3 + S03a-4

**Parallelizable**: 否（最后一步）

---

## Phase1.6 Non-goals（整阶段）

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

## Dependencies Summary

### Blocking（外部依赖）

- Phase1.4-S03a 已合并（deadline 错误码 + 基础 submit 幂等 + saveAnswers 路由事务化）
- Phase1.5 已合并（PG-only / SQLite 移除 / `findByIdForUpdate` / `db:up` / `test:pg` / CI PG gate）

### Internal Order

```text
S03a-1 ─┐
S03a-2 ─┼─→ S03a-4 ─→ S03a-5
S03a-3 ─┘
```

- S03a-1 / S03a-2 / S03a-3 三者并行启动
- S03a-4 必须在 S03a-2 + S03a-3 都合入 master 后才能开始（PG 并发测试依赖 row-level lock 已对齐 + 拒绝行为已定义）
- S03a-5 必须在前 4 个 Job 全部合入 master 后才能开始

> 旧文档中「S03a-3 与 S03a-2 并行 + 建议在 S03a-2 之后」的自相矛盾表述已废弃，以本节为准。

### Blocks（被本阶段阻塞）

- **Phase2 Entry Gate**：Phase2 必须依赖 S03a-4 的 PG 并发测试套件作为前置门
- **Phase2 Auto-submit**：Phase2 自动提交依赖 S03a-2 完成的 row-level lock 对齐
- **Phase1.7 安全 Job**：依赖 S03a-2 行锁基础以避免在硬化期叠加事务竞争问题

---

## Phase1.6 Exit Criteria

Phase1.6 完成时必须满足：

- [ ] 代码与文档中无残留 `EXAM_TIME_EXPIRED`（仅历史改名记录章节可保留）
- [ ] `POST /attempts/:id/submit` 在事务内对同一 attempt 行使用 `FOR UPDATE`
- [ ] saveAnswers 与 submit 在 PG 上对同一 attempt 行串行化（双连接集成测试断言通过）
- [ ] `now > deadlineAt` submit 端到端返回 `409 ATTEMPT_DEADLINE_EXCEEDED`，文案 zh-CN
- [ ] `now == deadlineAt` 与 `now < deadlineAt` submit 端到端正常返回 200
- [ ] 状态 ∈ {`submitted`, `graded`} 时 save 端到端被拒绝，事务回滚不留半状态
- [ ] PG 并发测试套件 4 类场景全部通过，且 10 次重跑不 flaky
- [ ] Phase1.3 P0 正常考生提交场景在新事务边界下回归通过
- [ ] `pnpm verify` 通过
- [ ] `pnpm test:pg` 通过

---

## Handoff Notes to Phase2

S03a 三段（Phase1.4 / Phase1.5 / Phase1.6）合计交付后，Phase2 可以放心地构建自动提交、late policy、proctor override、session lock、result visibility 等能力。

Phase2 可以假设：

- `POST /attempts/:id/answers/:qid` 与 `POST /attempts/:id/submit` 对同一 attempt 行串行化（PG `FOR UPDATE` 行锁）
- Deadline 超时 submit 端到端返回 `409 ATTEMPT_DEADLINE_EXCEEDED`
- 状态 ∈ {`submitted`, `graded`} 下 save 被端到端拒绝且事务回滚不留半状态
- PG 并发集成测试套件作为 Phase2 entry gate 前置依赖
- Phase1.3 P0 正常考生提交场景在新事务边界下回归通过
- 路由层使用 `executeInTransaction(...)` + `findByIdForUpdate(ctx, id)` 是 attempt-level mutation 的标准模式
