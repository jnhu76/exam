# S03a Status Adjustment

## 原状态

Phase1.4-S03a originally contained both deadline hardening and answer save transaction protection.

## 调整后

Phase1.4-S03a 被拆分为三部分：

1. **Phase1.4**: Deadline policy / error code / initial deadline check / basic submit idempotency
2. **Phase1.5**: PostgreSQL-only database convergence / remove SQLite as correctness backend / PG integration test foundation
3. **Phase1.6**: Complete S03a transaction hardening / saveAnswers + submitAttempt attempt-level serialization / PG concurrency tests

## 拆分原因

S03a 的事务与并发部分依赖 PostgreSQL-only foundation。SQLite 相关事务兼容要求废弃，PG-only 成为 S03a 的最终验收基础。

Phase1.4-S03a 实现过程中暴露了一个更底层的问题：

1. **生产部署使用 PostgreSQL**，但本地/测试中仍存在 SQLite
2. ORM 需要兼容 SQLite / PostgreSQL 两种 dialect
3. SQLite 与 PostgreSQL 在事务、锁、约束、类型、并发语义上不一致
4. 这导致测试可信度不足，AI 修改时也容易在两种数据库语义之间摇摆
5. S03a 的核心问题 `saveAnswers + submitAttempt` 串行化，本质依赖 PostgreSQL 的真实事务和 row-level lock
6. Phase2 还会引入自动提交、late policy、proctor override、session lock、result visibility 等能力，这些都更依赖数据库一致性

因此决定：

1. 在 Phase2 前增加 **Phase1.5: PostgreSQL-only Database Convergence**
2. 将 S03a 中依赖 PG 事务/并发的部分延后到 **Phase1.6: Exam Protocol Hardening on PG-only Foundation**
3. SQLite 不再作为数据库行为正确性的测试后端
4. Pure unit tests 使用 fake repository / in-memory object，而不是 SQLite
5. PostgreSQL 作为 dev / test / CI / production 的唯一数据库运行时

## 建议状态

```text
S03a Status: Split

Phase1.4:
- Deadline policy documentation
- Initial deadline check
- Basic submit idempotency

Phase1.5:
- PostgreSQL-only database convergence
- Remove SQLite as correctness backend
- PG integration test foundation

Phase1.6:
- Complete S03a transaction hardening
- saveAnswers + submitAttempt attempt-level serialization
- PG concurrency tests
```

## Phase1.6 完成 S03a 后

Phase1.6 完成后，S03a 的所有部分都已完成：

- Deadline policy / error code / initial deadline check / basic submit idempotency（Phase1.4）
- PostgreSQL-only database convergence / remove SQLite as correctness backend / PG integration test foundation（Phase1.5）
- Complete S03a transaction hardening / saveAnswers + submitAttempt attempt-level serialization / PG concurrency tests（Phase1.6）

S03a 可以标记为 complete。