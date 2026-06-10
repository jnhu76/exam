# Architecture Job Cards (A00–A05)

> 本文档是 `phase1.4-bridge-plan.md` 的展开。若发生冲突，以 bridge plan 为准。

---

## P1.4-A00: DB Reality Check Spike

### Purpose

验证 PostgreSQL + SQLite 双方言在 Drizzle ORM 下的统一方案可行性，产出技术结论，**不做全量迁移**。

### Background

所有 repository 强类型为 `SqliteDatabase`。`baseRepo.ts` 引用 `AnySQLiteColumn` 和 `SQLiteUpdateSetSource`。7 处 `as unknown as` + 4 处 `as any`。`systemStatsRepo.ts` 是唯一双方言 repo（用运行时 `isSqlite()` 分支，维护成本随 repo 数量线性增长）。

需要验证：Drizzle async API 是否同时支持 `better-sqlite3`（同步库）和 `postgres-js`（异步），以及统一路径是否可行。

### Scope

- 创建实验性 `AnyDatabase` 接口定义
- 选 1 个简单 repo（如 `courseRepo`）做概念验证
- 在 SQLite 和 PG 两种环境下运行测试
- 产出 ADR 文档

### Explicit Non-goals

- 不做全量迁移
- 不修改业务路由、domain 层、schema 文件

### Allowed Changes

- `packages/db/src/types.ts` — 可能扩展定义
- 新建实验性文件
- 修改 1 个 repo 做验证

### Forbidden Changes

- 禁止新增 `as any` / `as unknown as`
- 禁止修改 domain / contracts / routes / schema

### Acceptance Criteria

- [ ] ADR 文档产出，明确选定方案及理由
- [ ] 验证 repo 在 SQLite 和 PG 下的 list/getById/create 均通过
- [ ] 方案明确回答：是否统一到 async API
- [ ] 方案明确回答：现有 sync 调用点的迁移策略

### Required Tests

- 1 个 repo 的 SQLite 测试通过
- 1 个 repo 的 PG 测试通过

### Required Docs / Screenshots

- `docs/phase1.4/adr-db-dual-dialect.md`

### Dependencies

无

### Estimated Duration

0.5 天

### Risk

Critical

---

## P1.4-A01: DB Context / Repository Contract Design

### Purpose

基于 A00 的技术结论，定义正式的 DB Context 类型和 Repository 接口契约。

### Background

当前 repo 接受的参数不统一。需要建立三类 Repo 上下文：

| 分类 | 适用 Repo | Context 要求 |
|------|----------|-------------|
| **TenantScopedRepo** | exam, question, candidate, course, enrollment, attempt, audit, candidateField | TenantContext (organizationId + actorId + permissions) |
| **PlatformRepo** | organization, systemStats, migration/meta | PlatformContext (actorId + permissions, 无 organizationId) |
| **AuthLookupRepo** | login lookup, branding resolve, slug resolve | AuthLookupContext (轻量，不要求完整 RequestContext) |

### Scope

- 定义 `TenantContext`, `PlatformContext`, `AuthLookupContext` 类型
- 定义 `AnyDatabase` 正式类型
- 定义 `BaseTenantRepo<Table>` 和 `BasePlatformRepo<Table>` 泛型工厂
- 更新 `baseRepo.ts` 签名

### Explicit Non-goals

- 不做全量 repo 迁移（A02）
- 不修改路由层、domain、contracts

### Allowed Changes

- `packages/db/src/types.ts`
- `packages/db/src/repository/baseRepo.ts`
- `packages/db/src/database.ts`

### Forbidden Changes

- 禁止修改任何现有 repo 的实现（只改签名/接口）
- 禁止新增 `as any`
- 禁止让 AuthLookupRepo 接受完整 RequestContext
- 禁止在 route handler 中裸传 organizationId 字符串
- 禁止写"所有 repo 第一个参数都是 RequestContext"

### Acceptance Criteria

- [ ] 三类 Context 类型定义完成，TypeScript strict mode 通过
- [ ] `baseRepo.ts` 工厂方法签名使用新 Context 类型
- [ ] 现有调用方编译通过（可暂时用 adapter）
- [ ] `pnpm typecheck` 通过

### Required Tests

- `packages/db/src/__tests__/context-types.test.ts`

### Required Docs / Screenshots

- ADR 补充 Repository Contract 章节

### Dependencies

A00

### Estimated Duration

1 天

### Risk

Critical

---

## P1.4-A02: Repository 双方言迁移

### Purpose

将所有 13 个 repo 迁移到基于 A01 定义的正式类型。

### Background

| 优先级 | Repo | 特殊处理 |
|--------|------|---------|
| 简单 | course, exam, question, candidateField, auditLog | 简单委托 |
| 中等 | candidate, enrollment | 有自定义查询 |
| 复杂 | attempt | join 查询用 `as any`，需消除 |
| 复杂 | user | 需迁移到 AuthLookupRepo |
| 复杂 | organization, settings | PlatformRepo |
| 已适配 | systemStats | 需适配新类型 |

### Scope

逐个迁移。建议每次不超过 3 个 repo，迁移后立即跑测试。

### Explicit Non-goals

- 不修改路由层逻辑
- 不修改 domain / contracts
- 不拆 `attempt_answers` 表

### Allowed Changes

- `packages/db/src/repository/*.ts` — 所有 13 个 repo
- `packages/db/src/seed.ts`, `demo-seed.ts` — 适配
- `apps/api/src/plugins/db.ts` — 消除 `as unknown as SqliteDatabase`

### Forbidden Changes

- 禁止新增 `as any` / `as unknown as`
- 禁止绕过类型系统
- 禁止只跑 SQLite 后宣称 PG 可用
- 禁止一次修改超过 3 个 repo 而不跑测试

### Acceptance Criteria

- [ ] `grep -r "as unknown as" packages/db/src/` 返回空
- [ ] `grep -r "as any" packages/db/src/repository/` 返回空
- [ ] 所有 repo 方法第一个参数是 Context 类型
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 在 SQLite 下全部通过

### Required Tests

- 每个 repo 迁移后立即跑 `pnpm test`
- attemptRepo join 查询有类型安全测试

### Required Docs / Screenshots

- 迁移记录

### Dependencies

A01

### Estimated Duration

2 天

### Risk

Critical

---

## P1.4-A03: Docker + PostgreSQL Smoke Test

### Purpose

让 `docker-compose up --build` 使用 PostgreSQL 完成完整考试闭环。

### Background

- Dockerfile COPY 路径错误（migration 不在 `packages/db/src/migrations`）
- `pnpm@latest` 不确定
- JWT_SECRET 默认 `change-me-in-production`
- PG 版本不一致（test 18 vs prod 16）
- Seed 仅支持 SQLite
- Migration 路径在容器中可能错位

### Scope

- `Dockerfile` — 修复 COPY，固定 pnpm
- `docker-compose.yml` — JWT_SECRET 无默认值
- `docker-compose.test.yml` — PG 版本对齐 16
- `docker-compose.dev.yml` — 确认 dev SQLite
- `docker-entrypoint.sh` — migration 路径修正
- `.env.example` — 更新

### Explicit Non-goals

- 不修改 migration 文件
- 不做 prod seed 自动执行

### Allowed Changes

- Dockerfile, docker-compose*.yml, docker-entrypoint.sh, .env.example

### Forbidden Changes

- 禁止在 prod compose 保留 seed 自动执行
- 禁止硬编码密码
- 禁止修改业务代码

### Acceptance Criteria

- [ ] `docker-compose up --build` 成功启动
- [ ] 容器内 migration 自动执行成功
- [ ] 未设 `JWT_SECRET` 时拒绝启动
- [ ] 手动 smoke test：完整考试闭环
- [ ] `docker-compose -f docker-compose.dev.yml up` 使用 SQLite 正常

### Required Tests

- 手动 Docker smoke test
- Migration 幂等性测试

### Required Docs / Screenshots

- Docker 部署 smoke test 截图
- 环境变量清单

### Dependencies

A02

### Estimated Duration

1 天

### Risk

High

---

## P1.4-A04: CI PostgreSQL Gate

### Purpose

CI 增加 PostgreSQL service container job。

### Background

当前 CI 仅 SQLite。生产用 PG 但无 CI 覆盖。A04 不是第一个实现的 Job，但 **Phase2 前必须完成**。早期可手动跑 PG 测试，但 CI gate 必须在 Phase2 Entry Gate 前就绪。

### Scope

- `.github/workflows/ci.yml` — 增加 PG job
- `pnpm lint:arch` 加入 CI step

### Explicit Non-goals

- 不去掉 SQLite CI job

### Allowed Changes

- CI 配置文件

### Forbidden Changes

- 禁止 PG job 失败时允许 merge

### Acceptance Criteria

- [ ] CI 有 SQLite + PG 两个独立 job
- [ ] PG job 用 PostgreSQL 16 service container
- [ ] 两个 job 都 pass 才允许 merge
- [ ] `pnpm lint:arch` 作为独立 CI step

### Required Tests

- 复用现有 test suite

### Required Docs / Screenshots

- CI pipeline 截图

### Dependencies

A02

### Estimated Duration

1 天

### Risk

Medium

---

## P1.4-A05: Redis / MQ ADR

### Purpose

为 Phase2 技术选型提供决策依据。纯文档，不写代码。

### Scope

- `docs/phase1.4/adr/adr-redis-mq.md`

### Explicit Non-goals

- 不写代码
- 不引入依赖

### Acceptance Criteria

- [ ] 明确每类数据归属（answers → DB sync, heartbeat → Redis, PDF → MQ, realtime → Redis pub/sub）
- [ ] 明确 Phase2 引入顺序
- [ ] 明确禁止答案保存走 MQ

### Required Docs / Screenshots

- `docs/phase1.4/adr/adr-redis-mq.md`

### Dependencies

无

### Estimated Duration

0.5 天

### Risk

Low
