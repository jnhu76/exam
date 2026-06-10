# Phase 1.6 Overview

## 定位

Phase1.6 是 Phase1 收口层第三阶段，**不是 Phase2 提前开工**。

它只做一件事：在 Phase1.5 完成的 PostgreSQL-only 基础上，完成 S03a 的考试协议事务硬化，重点解决 `saveAnswers` 与 `submitAttempt` 的 PostgreSQL 事务边界与 attempt-level serialization。

---

## 为什么需要 Phase1.6

Phase1.5 完成了 PostgreSQL-only 数据库收敛，移除了 SQLite 作为数据库行为测试后端。Phase1.6 将在 PG-only 基础上继续完成 S03a 的协议硬化。

S03a 已完成或部分完成：
- Deadline 固定策略已有初步实现（Phase1.4）
- Submit 超时应返回 `409 ATTEMPT_DEADLINE_EXCEEDED`（Phase1.4）
- Submit 幂等已有基础状态机保护（Phase1.4）
- 但答案保存事务保护和 save + submit 并发安全尚未完成

Phase1.6 将在 PG-only 基础上完成这部分。

---

## Phase1.6 允许

- Deadline error code convergence（统一为 `ATTEMPT_DEADLINE_EXCEEDED`）
- saveAnswers PostgreSQL transaction boundary（read → merge/compute → write 在同一个 transaction 内）
- saveAnswers 和 submitAttempt attempt-level serialization
- PostgreSQL concurrency tests（rollback、concurrent save + submit）
- Phase1.3 P0 Student Submit Scenario Regression

---

## Phase1.6 禁止

- 不实现自动提交超时试卷（auto-submit on deadline）
- 不实现 voidAttempt
- 不实现 showResultImmediately 服务端检查
- 不拆 attempt_answers 表
- 不实现多标签页会话锁
- 不做前端 submit flush，留给 S03b
- 不实现 late submit
- 不实现 proctor override
- 不重新引入 SQLite 并发测试
- 不做数据库性能优化

---

## Phase1.6 完成后

Phase1.6 完成后，S03a 的事务硬化已完成，Phase2 可以放心地构建自动提交、late policy、proctor override、session lock、result visibility 等能力。

Phase2 可以假设：
- `saveAnswers` 和 `submitAttempt` 对同一 attempt row 正确串行化
- Deadline 超时提交会返回 `409 ATTEMPT_DEADLINE_EXCEEDED`
- 答案保存的 read → merge/compute → write 在同一个 PG transaction 内
- PG integration tests 已通过
- 正常考生提交场景不受影响