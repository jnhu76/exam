# Phase 1.5 Job Cards

本文档是 Phase1.5 的详细 Job Cards，每个 Job 都包含 Purpose / Scope / Non-goals / Acceptance Criteria / Risk。

---

## P1.5-A01: PostgreSQL Baseline

### Purpose

统一 dev / test / CI / production 的 PostgreSQL 版本，确保所有环境使用一致的数据库名称，为 Phase1.6 的事务硬化和 Phase2 的并发控制提供可信基础。

### Scope

- [ ] 确定目标 PostgreSQL 版本（推荐 PostgreSQL 18）
- [ ] 更新 `docker-compose.yml` 使用固定版本标签（不使用 `latest`）
- [ ] 更新 `docker-compose.test.yml` 使用相同 PG 版本
- [ ] 更新 `.github/workflows/ci.yml` 使用相同 PG 版本
- [ ] 更新 Dockerfile 使用相同 PG 版本
- [ ] 更新文档（README.md、开发文档）声明数据库版本策略
- [ ] 验证 migration 可在空 PG 数据库上完整运行
- [ ] 验证 dev / test / production 使用一致的数据库名称

### Non-goals

- [ ] 不重写现有 migration
- [ ] 不修改 schema 定义
- [ ] 不调整数据库性能参数
- [ ] 不实现 read replica / HA / backup 策略

### Acceptance Criteria

- [ ] `docker-compose.yml` 使用 `postgres:18` 或指定版本
- [ ] `docker-compose.test.yml` 使用相同 PG 版本
- [ ] `.github/workflows/ci.yml` 使用相同 PG 版本
- [ ] Dockerfile 使用相同 PG 版本
- [ ] README.md 或开发文档声明数据库版本策略
- [ ] Migration 可在空 PG 数据库上完整运行（`pnpm db:migrate` 成功）
- [ ] Dev / test / production 使用一致的数据库名称（如 `exam_db`、`exam_test_db`）

### Risk

- PostgreSQL 18 较新，如果部署环境不受控可能需要降级到 17/16
- 需要确认 Docker 镜像是否支持目标 PG 版本
- 需要确认 CI 环境（GitHub Actions）是否支持目标 PG 版本

### Dependencies

- 无

### Parallelizable

- 是（可以与其他 P1.5 job 并行开始）

---

## P1.5-A02: Remove SQLite Test Backend

### Purpose

移除 SQLite 作为 repository / API / transaction tests 的后端，降低 ORM 双方言复杂度，提高测试可信度。

### Scope

- [ ] 审查所有 repository tests，识别哪些需要保留为 integration test
- [ ] 审查所有 API integration tests，识别哪些需要迁移到 PG
- [ ] 审查所有 transaction / locking / concurrency tests，迁移到 PG
- [ ] 为 pure unit tests 创建 fake repository 或 in-memory object
- [ ] 删除或废弃 SQLite-specific test setup
- [ ] 更新 CI 配置，移除 SQLite test service

### Non-goals

- [ ] 不重写测试逻辑
- [ ] 不删除必要 integration tests
- [ ] 不降低测试覆盖率
- [ ] 不改变测试目的

### Acceptance Criteria

- [ ] SQLite 不再用于 repository tests
- [ ] SQLite 不再用于 API integration tests
- [ ] SQLite 不再用于 transaction / locking / concurrency tests
- [ ] Pure unit tests 不依赖真实数据库
- [ ] CI 配置移除 SQLite test service
- [ ] `pnpm test` 通过（所有 tests 都使用 PG 或 fake repo）

### Risk

- 需要仔细识别哪些测试需要保留为 integration test，哪些可以改为 pure unit test
- 可能需要调整测试策略，增加 fake repository 实现
- Fake repository 的行为必须与真实 repository 一致，否则测试可能不再有效

### Dependencies

- 无

### Parallelizable

- 是（可以与其他 P1.5 job 并行开始）

---

## P1.5-A03: ORM Dialect Simplification

### Purpose

移除不必要的 SQLite / PG 双 dialect 分支，收敛 repository / schema / migration / test setup 到 PostgreSQL，降低维护复杂度。

### Scope

- [ ] 审查所有 exam 相关 SQLite 特判
- [ ] 移除或重构 SQLite-specific repository 逻辑
- [ ] 收敛 ORM 配置到 PostgreSQL dialect
- [ ] 收敛 test setup 到 PostgreSQL
- [ ] 移除或重构 schema 双文件同步（如果有）
- [ ] 验证所有 PG integration tests 通过

### Non-goals

- [ ] 不引入新 ORM
- [ ] 不重写业务 schema
- [ ] 不修改数据库性能参数
- [ ] 不改变 repository method 签名（除非必要）

### Acceptance Criteria

- [ ] 代码中不再存在 exam 相关 SQLite 特判
- [ ] Repository 层以 PostgreSQL 行为为准
- [ ] ORM 配置更简单（只配置 PG dialect）
- [ ] 没有为了 SQLite 保留的生产逻辑分支
- [ ] 所有 PG integration tests 通过
- [ ] `pnpm verify` 通过

### Risk

- 需要仔细审查代码，确认哪些是真正的 SQLite 特判，哪些是必要的抽象
- 修改后需要验证所有 PG integration tests 仍然通过
- 可能存在隐藏的 SQLite 依赖，需要全面测试

### Dependencies

- 无

### Parallelizable

- 是（可以与其他 P1.5 job 并行开始）

---

## P1.5-A04: Database Command Standardization

### Purpose

建立统一的 database 命令，方便开发、测试、CI 使用，降低使用复杂度。

### Scope

- [ ] 审查现有 package.json 脚本
- [ ] 确定统一的 database 命令命名（如 `pnpm db:up`、`pnpm db:down`、`pnpm db:reset`、`pnpm db:migrate`、`pnpm db:seed`、`pnpm test:pg`）
- [ ] 更新 package.json 脚本
- [ ] 确保 dev / test database 隔离（不污染生产 database）
- [ ] 更新 README.md 或开发文档，说明 database 命令

### Non-goals

- [ ] 不强行改名现有命令（除非确实不合理）
- [ ] 不引入新的 database 工具或框架
- [ ] 不改变 migration 文件结构

### Acceptance Criteria

- [ ] 存在 `pnpm db:up` 命令（启动 dev database）
- [ ] 存在 `pnpm db:down` 命令（停止 dev database）
- [ ] 存在 `pnpm db:reset` 命令（重置 dev database）
- [ ] 存在 `pnpm db:migrate` 命令（运行 migration）
- [ ] 存在 `pnpm db:seed` 命令（运行 seed）
- [ ] 存在 `pnpm test:pg` 命令（运行 PG tests）
- [ ] Test database 不污染 dev / production database
- [ ] README.md 或开发文档说明 database 命令

### Risk

- 需要检查现有 package.json 脚本，避免冲突
- 需要确保 test database 和 dev database 的隔离策略清晰
- 命令命名需要与现有风格一致，避免混淆

### Dependencies

- P1.5-A01（需要确定 PG 版本）

### Parallelizable

- 是（可以与 P1.5-A01、P1.5-A02、P1.5-A03 并行开始）

---

## P1.5-A05: PG-only Integration Test Gate

### Purpose

Phase2 之前建立 PG integration test gate，确保 repository / API / transaction / concurrency tests 都以 PG 为准，为 Phase1.6 的 S03a 并发测试铺路。

### Scope

- [ ] 审查所有 PG integration tests
- [ ] 确认 `pnpm test` 通过（所有 tests 都使用 PG 或 fake repo）
- [ ] 确认 `pnpm test:pg` 或等价命令通过
- [ ] 更新 CI 配置，确保 CI 会启动 PostgreSQL
- [ ] 更新 Phase2 entry gate 文档，明确依赖 PG integration tests

### Non-goals

- [ ] 不重写测试逻辑
- [ ] 不降低测试覆盖率
- [ ] 不改变测试目的

### Acceptance Criteria

- [ ] `pnpm test` 通过（所有 tests 都使用 PG 或 fake repo）
- [ ] `pnpm test:pg` 或等价命令通过
- [ ] CI 配置启动 PostgreSQL service
- [ ] CI job 运行 PG integration tests
- [ ] Phase2 entry gate 文档明确依赖 PG integration tests

### Risk

- CI pipeline 修改需要验证所有 job 能正确连接 PG service
- 需要确保 PG integration test gate 不会成为阻塞点
- CI 环境的 PG 连接可能需要特殊配置

### Dependencies

- P1.5-A01、P1.5-A02、P1.5-A03、P1.5-A04

### Parallelizable

- 否（必须在 A01-A04 完成后执行）

---

## Dependencies Summary

### Blocking

- 无外部依赖

### Parallelizable

- P1.5-A01、P1.5-A02、P1.5-A03、P1.5-A04 可以并行开始
- P1.5-A05 必须在 A01-A04 完成后执行

### Blocks

- **Phase1.6-S03a**: PG-only 基础是 S03a 事务硬化的前置条件
- **Phase2 Entry Gate**: Phase2 必须依赖 PG-only integration tests