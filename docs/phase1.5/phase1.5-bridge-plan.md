# Phase 1.5 — PostgreSQL-only Database Convergence

**日期**: 2026-06-11
**分支**: `phase1.5-1.6-documentation`
**前置**: Phase1.4-S03a 部分 deadline 策略完成
**定位**: Phase1 收口层第二阶段，数据库运行时统一收敛

---

## 文件索引

| 文件 | 内容 |
|------|------|
| **`phase1.5-bridge-plan.md`** | **总纲 — Single Source of Truth。包含全部 Job Cards、Phase Boundary、Entry Gate、Handoff Notes。** |
| `01-overview.md` | Phase1.5 总览：目的、决策、范围、非目标、验收标准 |

> **若发生冲突，以 `phase1.5-bridge-plan.md` 为准。**

---

## Why Phase1.5 Exists

Phase1.4-S03a 实现过程中暴露了一个更底层的问题：

1. **生产部署使用 PostgreSQL**，但本地/测试中仍存在 SQLite
2. ORM 需要兼容 SQLite / PostgreSQL 两种 dialect
3. SQLite 与 PostgreSQL 在事务、锁、约束、类型、并发语义上不一致
4. 这导致测试可信度不足，AI 修改时也容易在两种数据库语义之间摇摆
5. S03a 的核心问题 `saveAnswers + submitAttempt` 串行化，本质依赖 PostgreSQL 的真实事务和 row-level lock
6. Phase2 还会引入自动提交、late policy、proctor override、session lock、result visibility 等能力，这些都更依赖数据库一致性

Phase1.5 的目标是：在进入 Phase2 前，将项目数据库运行时、测试环境、CI 环境统一收敛到 PostgreSQL，移除 SQLite 作为数据库行为测试后端，降低 ORM 双方言复杂度，并为考试协议中的事务、锁、并发一致性提供可信基础。

---

## Key Decision

```text
PostgreSQL is the only supported database runtime for dev, test, CI, and production.

SQLite is removed as a database behavior test backend.

Pure unit tests should use fake repositories or in-memory objects, not SQLite.
```

---

## Phase1.5 Scope

Phase1.5 至少包含以下任务：

### P1.5-A01: PostgreSQL Baseline

**目标**:

- 统一 dev / test / CI / production 的 PostgreSQL 版本
- 推荐将 PostgreSQL 18 作为项目基线，前提是部署环境可控
- 不使用 `latest` 作为镜像标签
- docker compose / test compose / CI service 统一 PG 版本
- 文档声明数据库基线

**验收**:

- [ ] Local dev uses PostgreSQL
- [ ] Test database uses PostgreSQL
- [ ] CI uses PostgreSQL
- [ ] Migration 可在空 PG 数据库上完整运行
- [ ] 文档写清楚 PG 版本策略

**风险**:

- PostgreSQL 18 较新，如果部署环境不受控可能需要降级到 17/16

---

### P1.5-A02: Remove SQLite Test Backend

**目标**:

- 移除 SQLite 作为 repository / API / transaction tests 的后端
- 所有数据库行为测试迁移到 PostgreSQL
- Pure unit tests 改用 fake repository / in-memory object
- 删除或废弃 SQLite-specific test setup

**验收**:

- [ ] SQLite 不再用于 repository tests
- [ ] SQLite 不再用于 API integration tests
- [ ] SQLite 不再用于 transaction / locking / concurrency tests
- [ ] Pure unit tests 不依赖真实数据库

**风险**:

- 需要识别哪些测试需要保留为 integration test，哪些可以改为 pure unit test
- 可能需要调整测试策略，增加 fake repository 实现

---

### P1.5-A03: ORM Dialect Simplification

**目标**:

- 移除不必要的 SQLite / PG 双 dialect 分支
- 收敛 repository / schema / migration / test setup 到 PostgreSQL
- 不引入新 ORM
- 不重写业务 schema
- 只做必要的兼容删除与边界收敛

**验收**:

- [ ] 代码中不再存在 exam 相关 SQLite 特判
- [ ] Repository 层以 PostgreSQL 行为为准
- [ ] ORM 配置更简单
- [ ] 没有为了 SQLite 保留的生产逻辑分支

**风险**:

- 需要仔细审查代码，确认哪些是真正的 SQLite 特判，哪些是必要的抽象
- 修改后需要验证所有 PG integration tests 仍然通过

---

### P1.5-A04: Database Command Standardization

**目标**:

建立统一命令，例如：

```bash
pnpm db:up
pnpm db:down
pnpm db:reset
pnpm db:migrate
pnpm db:seed
pnpm test:pg
```

如果仓库已有类似命令，请沿用现有命名，不要强行改名。

**验收**:

- [ ] 本地一键启动 PG
- [ ] 本地一键 reset test DB
- [ ] Migration / seed 命令清晰
- [ ] Test database 不污染 dev / production database
- [ ] README 或开发文档有说明

**风险**:

- 需要检查现有 package.json 脚本，避免冲突
- 需要确保 test database 和 dev database 的隔离策略清晰

---

### P1.5-A05: PG-only Integration Test Gate

**目标**:

- Phase2 之前建立 PG integration test gate
- Repository / API / transaction / concurrency tests 都以 PG 为准
- 为 Phase1.6 的 S03a 并发测试铺路

**验收**:

- [ ] `pnpm test` 通过
- [ ] `pnpm test:pg` 或等价命令通过
- [ ] CI 中会启动 PostgreSQL
- [ ] Phase2 entry gate 明确依赖 PG integration tests

**风险**:

- CI pipeline 修改需要验证所有 job 能正确连接 PG service
- 需要确保 PG integration test gate 不会成为阻塞点

---

## Phase1.5 Non-goals

Phase1.5 **明确不**实现以下功能：

- [ ] 不实现 Phase2 功能
- [ ] 不实现自动提交（auto-submit on deadline）
- [ ] 不实现 late policy
- [ ] 不实现 proctor override
- [ ] 不实现 session lock
- [ ] 不实现 result visibility
- [ ] 不拆 `attempt_answers` 表
- [ ] 不重写 ORM
- [ ] 不做数据库性能优化
- [ ] 不做 read replica / HA / backup 策略
- [ ] 不做生产部署架构重构

---

## Phase1.5 Acceptance Criteria

Phase1.5 完成时必须满足：

- [ ] Local dev uses PostgreSQL
- [ ] Test database uses PostgreSQL
- [ ] CI uses PostgreSQL
- [ ] SQLite no longer used for repository/API/transaction tests
- [ ] Pure unit tests do not require database
- [ ] Repository integration tests pass on PostgreSQL
- [ ] API integration tests pass on PostgreSQL
- [ ] Migrations run cleanly on empty PostgreSQL database
- [ ] Database reset/seed commands work
- [ ] Phase1.6 can implement S03a save + submit serialization on PG-only foundation

---

## Phase1.5 Dependencies

### Blocking

- 无外部依赖

### Parallelizable

- P1.5-A01、P1.5-A02、P1.5-A03、P1.5-A04 可以并行开始
- P1.5-A05 必须在 A01-A04 完成后执行

### Blocks

- **Phase1.6-S03a**: PG-only 基础是 S03a 事务硬化的前置条件
- **Phase2 Entry Gate**: Phase2 必须依赖 PG-only integration tests

---

## Handoff Notes to Phase1.6

Phase1.5 完成后，Phase1.6 将基于 PG-only 基础完成 S03a 的事务硬化。Phase1.6 不需要再考虑 SQLite 兼容性，可以专注于 PostgreSQL 的事务边界和并发控制。

Phase1.6 可以假设：
- Dev / test / CI / production 都使用 PostgreSQL
- SQLite 不再参与数据库行为正确性的证明
- ORM 配置已收敛到 PostgreSQL
- Repository integration tests 都以 PG 为准
- 存在统一的 database 命令和 test 命令