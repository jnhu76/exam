# Phase 1.5 — PostgreSQL-only Convergence

**日期**: 2026-06-11
**分支**: `phase1.5-1.6-documentation`
**前置**: Phase1.4 S01 / S02 / S03a 完成
**定位**: Phase1 收口层第二阶段，数据库运行时统一收敛
**核心原则**: 完全移除 SQLite 作为 correctness backend，统一 dev/test/CI/prod 到 PostgreSQL

---

## 1. Purpose

Phase1.4 执行过程中暴露了底层问题：生产部署使用 PostgreSQL，但本地/测试/CI 中仍存在 SQLite。SQLite 与 PostgreSQL 在事务、锁、约束、类型、并发语义上不一致，导致测试可信度不足，AI 修改时容易在两种数据库语义之间摇摆。

Phase1.5 的目标是：在进入 Phase1.6 前，将项目数据库运行时、测试环境、CI 环境统一收敛到 PostgreSQL，移除 SQLite 作为数据库行为测试后端，降低 ORM 双方言复杂度，并为考试协议中的事务、锁、并发一致性提供可信基础。

---

## 2. Background

| 问题 | 影响 | 依据 |
|------|------|------|
| 所有 repo 强类型 `SqliteDatabase` | PG 生产环境 runtime crash | `plugins/db.ts:17` `as unknown as SqliteDatabase` |
| `baseRepo.ts` 引用 SQLite 专用类型 | 无法复用于 PG | `baseRepo.ts:5-6` `AnySQLiteColumn` |
| 7 处 `as unknown as` + 3 处 `as any` | 类型安全被绕过 | `seed.ts`, `systemStatsRepo.ts`, `attemptRepo.ts` |
| Schema 双文件手动同步 | 维护负担，已有 drift | `sqlite.ts` 328 行 vs `pg.ts` 291 行 |
| CI 无 PG 测试 | PG 回归无门禁 | `.github/workflows/ci.yml` 仅 SQLite |
| Seed 仅支持 SQLite | PG 环境无法 seed | `seed.ts:24-27` 拒绝 PG |
| `userRepo` 不接受 ctx | 违反 repo pattern | `userRepo.ts:13,28` |
| `attemptRepo` 用 `as any` | join 查询无类型安全 | `attemptRepo.ts:146,198,249` |

Phase1.5 从 Phase1.4 接收这些债务，在 PG-only 基础上解决。

---

## 3. Scope

Phase1.5 至少包含以下任务：

### P1.5-J1: DB Runtime Inventory

**目标**:
- 全面盘点项目中所有 SQLite 依赖点
- 产出 SQLite 依赖清单

**验收**:
- [ ] 所有 `sqlite.ts` 引用已识别
- [ ] 所有 `better-sqlite3` 引用已识别
- [ ] 所有 `isSqlite()` 运行时分支已识别
- [ ] 所有 SQLite-specific test setup 已识别

---

### P1.5-J2: PG Test Harness

**目标**:
- 建立 PostgreSQL 测试基础设施
- dev/test/CI 统一使用 PostgreSQL

**验收**:
- [ ] Local dev 可一键启动 PG（`pnpm db:up` 或等价命令）
- [ ] Test database 使用 PostgreSQL
- [ ] CI 启动 PostgreSQL service container
- [ ] Test DB 与 dev DB 隔离

---

### P1.5-J3: Migration Convergence

**目标**:
- 收敛 migration 到 PostgreSQL-only
- Migration 可在空 PG 数据库上完整运行

**验收**:
- [ ] PG migrations clean
- [ ] Migration 可在空 PG 数据库上完整运行
- [ ] 无 SQLite-specific migration 逻辑

---

### P1.5-J4: Seed Convergence

**目标**:
- 建立稳定 PG seed
- Seed 数据在 PG 下可重复生成

**验收**:
- [ ] PG seed stable
- [ ] Seed 可在空 PG 数据库上运行
- [ ] Seed 不依赖 SQLite 特有语法

---

### P1.5-J5: Repository Dialect Removal

**目标**:
- 清理 repository 双方言分支
- 移除 SQLite-specific 类型和分支

**验收**:
- [ ] 代码中不再存在 exam 相关 SQLite 特判
- [ ] Repository 层以 PostgreSQL 行为为准
- [ ] `grep -r "as unknown as" packages/db/src/` 返回空
- [ ] `grep -r "as any" packages/db/src/repository/` 返回空

---

### P1.5-J6: CI PG Switch

**目标**:
- CI 从 SQLite 切换到 PostgreSQL
- 建立 PG integration test gate

**验收**:
- [ ] CI 使用 PostgreSQL service container
- [ ] CI job 运行 PG integration tests
- [ ] CI 不再依赖 SQLite for correctness tests

---

### P1.5-J7: SQLite Correctness Removal Report

**目标**:
- 产出 SQLite 移除报告
- 明确记录哪些测试改为 pure unit test（fake repo / in-memory）

**验收**:
- [ ] 报告列出所有已移除的 SQLite 依赖
- [ ] 报告列出所有改为 pure unit test 的测试
- [ ] 报告确认 SQLite 不再作为 correctness backend

---

## 4. Explicit Non-goals

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
- [ ] 不做 S03a 事务硬化（那是 Phase1.6）
- [ ] 不做 S03b submit flush（那是 Phase1.7）
- [ ] 不做 S04-S09 安全 Job（那是 Phase1.7）
- [ ] 不做 UI 样板页（U01-U04 已归 Phase1.4）

---

## 5. Job List

| Job ID | Name | Risk | Duration | Depends On | Parallel | Notes |
|--------|------|------|----------|------------|----------|-------|
| P1.5-J1 | DB Runtime Inventory | Medium | 0.5d | - | Yes | 盘点所有 SQLite 依赖 |
| P1.5-J2 | PG Test Harness | High | 1d | - | Yes | 建立 PG 测试基础设施 |
| P1.5-J3 | Migration Convergence | High | 1d | J1, J2 | Yes | migration 收敛到 PG-only |
| P1.5-J4 | Seed Convergence | High | 1d | J1, J2 | Yes | 稳定 PG seed |
| P1.5-J5 | Repository Dialect Removal | Critical | 2d | J1 | No | 清理 repo 双方言分支 |
| P1.5-J6 | CI PG Switch | High | 1d | J2, J3, J5 | No | CI 切换到 PG |
| P1.5-J7 | SQLite Correctness Removal Report | Low | 0.5d | J5, J6 | Yes | 产出移除报告 |

---

## 6. Exit Criteria

Phase1.5 完成时必须满足：

- [ ] dev/test/CI/prod 默认 PostgreSQL
- [ ] SQLite 不再作为 repository/API/transaction correctness backend
- [ ] PG migrations clean
- [ ] PG seed stable
- [ ] PG integration tests pass
- [ ] `pnpm verify` pass

---

## 7. CI Plan

1. `.github/workflows/ci.yml` 增加/修改 PostgreSQL service container job
2. CI job 使用固定 PG 版本（推荐 PostgreSQL 16 或 18，需与 docker compose 对齐）
3. 移除或标记 SQLite-only CI job（SQLite 可保留作为快速 smoke，但不作为 correctness gate）
4. `pnpm lint:arch` 作为独立 CI step 保留
5. CI 中 database URL 环境变量统一配置

---

## 8. Seed Plan

1. 审查 `seed.ts` 和 `demo-seed.ts` 中的 SQLite 特有逻辑
2. 将 seed 数据生成改为 PG-compatible
3. 确保 seed 密码 >= 8 字符（与 Phase1.7 S07-lite 对齐）
4. seed 脚本在空 PG 数据库上可重复执行
5. test seed 与 dev seed 隔离

---

## 9. Migration Plan

1. 审查现有 migration 文件，确认无 SQLite-specific SQL
2. 在空 PG 数据库上完整运行 migration 验证
3. 如需要，新增 PG-only 的 migration 修正（不破坏已有数据）
4. migration 文件保持 database-agnostic（Drizzle 生成）

---

## 10. Rollback Plan

Phase1.5 的 rollback 场景：

1. **PG 测试不稳定**：保留 SQLite 作为快速 smoke test，但不作为 correctness backend
2. **CI PG 连接失败**：提供本地 CI 调试文档（docker compose test 环境）
3. **seed 在 PG 下失败**：分步骤验证 seed（先 schema，后基础数据，后 demo 数据）
4. **repo 改造引入回归**：按 repo 分批 rollback，不一次回滚全部

---

## Phase1.5 Dependencies

### Blocking

- Phase1.4 S01 / S02 / S03a 完成（确保有基础安全层后再做数据库收敛）

### Blocks

- **Phase1.6**: PG-only 基础是 Phase1.6 事务硬化的前置条件
- **Phase1.7**: PG-only 基础是 Phase1.7 安全完成的前置条件
- **Phase2 Entry Gate**: Phase2 必须依赖 PG-only integration tests
