# Phase 1.6 — PostgreSQL Correctness Hardening（历史 / 决策附录）

> ⚠️ **本文件不再作为 Job 来源**。
>
> Phase1.6 的可执行 Job 列表在 [`phase1.6-bridge-plan.md`](./phase1.6-bridge-plan.md) 与 [`jobs.md`](./jobs.md) 中定义，使用唯一一套编号 `P1.6-S03a-1..5`。
>
> 本文件的旧版 `P1.6-J1..J5` 编号体系已**废弃**，仅作为决策背景与历史记录保留。

---

## 1. 背景与决策（仍然有效）

Phase1.4 执行过程中暴露了底层问题：生产部署使用 PostgreSQL，但本地 / 测试 / CI 中仍存在 SQLite。SQLite 与 PostgreSQL 在事务、锁、约束、类型、并发语义上不一致，导致测试可信度不足，AI 修改时容易在两种数据库语义之间摇摆。

围绕这个根因，团队做出了三段拆分决策：

1. **Phase1.4-S03a**：deadline 策略文档化、错误码定义（`ATTEMPT_DEADLINE_EXCEEDED`）、初始 deadline 检查、基础 submit 幂等
2. **Phase1.5**：PG-only 数据库收敛、SQLite 测试后端移除、PG integration test foundation
3. **Phase1.6**：考试协议事务硬化收尾（saveAnswers + submitAttempt attempt-level serialization、PG 并发测试、Phase1.3 P0 回归）

详情见 `s03a-status-adjustment.md`。

---

## 2. 历史 Job 编号映射（已废弃）

| 旧编号（已废弃） | 旧描述 | 当前归属 |
|---|---|---|
| `P1.6-J1` Transaction Correctness | saveAnswers / submitAttempt 事务边界 | 已被 `P1.6-S03a-2`（Submit Route Row-level Lock Alignment）取代；saveAnswers 主路径已在 Phase1.4-S03a 完成 |
| `P1.6-J2` Concurrency Tests | PG 并发测试 | 已被 `P1.6-S03a-4` 取代 |
| `P1.6-J3` S03a PG Verification | submit + 并发场景验证 | 已分摊到 `P1.6-S03a-1` / `P1.6-S03a-4` / `P1.6-S03a-5` |
| `P1.6-J4` Migration / Seed Regression | migration / seed 在空 PG 数据库可重复执行 | **Phase1.5 已交付**，不再作为 Phase1.6 Job |
| `P1.6-J5` CI Gate | CI 中 PG integration gate 稳定 | **Phase1.5 已交付**，不再作为 Phase1.6 Job |

---

## 3. 已废弃 Job 的代码证据（说明为何不再列入 Phase1.6）

### 旧 J4（migration / seed regression）已在 Phase1.5 完成

- `seed.ts` 改为 `INSERT ... ON CONFLICT (organization_id, username) DO UPDATE ... RETURNING`，消除 SELECT-then-INSERT TOCTOU
- `seed.test.ts` 增加 `Promise.all([seed, seed, seed])` 并发幂等测试
- `turbo.json` 把 `@exam/api#test` 串行在 `@exam/db#test` 之后，避免共享 `exam_test` DB 的并行污染
- 全部见 commit `71dea67 feat(phase1.5): converge to PostgreSQL-only and fix test pollution`

### 旧 J5（CI Gate）已在 Phase1.5 完成

- `.github/workflows/ci.yml` 增加 PostgreSQL service container job，固定 PG 版本
- 移除 SQLite-only CI service
- `pnpm verify` 已在 PG service container 上跑通
- `pnpm db:up` / `db:down` / `db:reset` / `db:migrate` / `db:seed` / `test:pg` 命令在 `package.json` 落地
- 见 commit `71dea67`

---

## 4. 仍然有效的指导原则

下列原则在 Phase1.6 实际 Job（`P1.6-S03a-1..5`）中仍然适用：

- **路由不裸写 repository**：所有 attempt mutation 路径走 command / service 层 + `executeInTransaction`
- **Repository 接收 ctx**：`packages/db` 的所有方法第一参数为 `TenantContext | RequestContext`
- **read → merge / compute → write 同事务**：禁止事务外读、事务内写的假事务
- **PG 行锁优先**：使用 Drizzle `.for("update")` 而非 application-level mutex
- **测试不允许碰运气**：禁止 `Promise.all` 替代真实并发测试（详见 `P1.6-S03a-4`）

---

## 5. 不在 Phase1.6 范围（保留作为反例提醒）

- 不实现自动提交超时试卷
- 不实现 voidAttempt / late submit / proctor override
- 不实现 showResultImmediately 服务端检查
- 不拆 `attempt_answers` 表
- 不实现多标签页会话锁
- 不做前端 submit flush（S03b）
- 不重新引入 SQLite 并发测试
- 不做数据库性能优化
- 不重复 Phase1.5 已交付内容

---

## 6. Rollback 备忘（如需回退 Phase1.6 改动）

1. submit 路由改回 `findByIdAndCandidate`：行锁丢失但功能仍工作（与 Phase1.5 后状态一致）
2. PG 并发测试套件可独立回退；不影响生产
3. 不需要回退 errors.ts 错误码（Phase1.4 即定）
4. 不需要回退 `findByIdForUpdate`（Phase1.5 已实现且 saveAnswers 已使用）
