# Phase 1.5 Overview

## 定位

Phase1.5 是 Phase1 收口层第二阶段，**不是 Phase2 提前开工**。

它只做一件事：将项目数据库运行时、测试环境、CI 环境统一收敛到 PostgreSQL，为 Phase1.6 的事务硬化和 Phase2 的并发控制提供可信基础。

---

## 核心决策

```text
PostgreSQL is the only supported database runtime for dev, test, CI, and production.

SQLite is removed as a database behavior test backend.

Pure unit tests should use fake repositories or in-memory objects, not SQLite.
```

---

## 为什么需要 Phase1.5

Phase1.4-S03a 实现过程中暴露了一个更底层的问题：

1. **生产部署使用 PostgreSQL**，但本地/测试中仍存在 SQLite
2. ORM 需要兼容 SQLite / PostgreSQL 两种 dialect
3. SQLite 与 PostgreSQL 在事务、锁、约束、类型、并发语义上不一致
4. 这导致测试可信度不足，AI 修改时也容易在两种数据库语义之间摇摆
5. S03a 的核心问题 `saveAnswers + submitAttempt` 串行化，本质依赖 PostgreSQL 的真实事务和 row-level lock
6. Phase2 还会引入自动提交、late policy、proctor override、session lock、result visibility 等能力，这些都更依赖数据库一致性

---

## Phase1.5 允许

- 统一 dev / test / CI / production 的 PostgreSQL 版本
- 移除 SQLite 作为 repository / API / transaction tests 的后端
- Pure unit tests 改用 fake repository / in-memory object
- 移除或重构 SQLite / PG 双 dialect 分支
- 收敛 repository / schema / migration / test setup 到 PostgreSQL
- 建立统一的 database 命令
- 建立 PG integration test gate

---

## Phase1.5 禁止

- 不实现 Phase2 功能
- 不实现自动提交（auto-submit on deadline）
- 不实现 late policy
- 不实现 proctor override
- 不实现 session lock
- 不实现 result visibility
- 不拆 `attempt_answers` 表
- 不重写 ORM
- 不做数据库性能优化
- 不做 read replica / HA / backup 策略
- 不做生产部署架构重构

---

## Phase1.5 完成后

Phase1.5 完成后，Phase1.6 将基于 PG-only 基础完成 S03a 的事务硬化。Phase1.6 不需要再考虑 SQLite 兼容性，可以专注于 PostgreSQL 的事务边界和并发控制。

Phase1.6 可以假设：
- Dev / test / CI / production 都使用 PostgreSQL
- SQLite 不再参与数据库行为正确性的证明
- ORM 配置已收敛到 PostgreSQL
- Repository integration tests 都以 PG 为准
- 存在统一的 database 命令和 test 命令