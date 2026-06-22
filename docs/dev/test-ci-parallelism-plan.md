# Test CI 并行化与有状态基础设施隔离 — 实施计划

> **状态**: Proposed（仅文档）。本文件与
> `docs/adr/ADR-007-stateful-infrastructure-test-isolation.md`（ADR，架构约束）、
> `docs/dev/test-suite-taxonomy.md`（测试分类法）共同构成 Phase 0 文档交付。
> **本 PR 不改业务代码、不改测试代码、不改 CI。**

## 目的

把 ADR-007 的长期方向拆成可独立交付、可独立验证的阶段。每个阶段（Phase 1
及以后）都是一个独立 PR，必须自带 stress 证据才能合入。Phase 0 仅交付文档。

本计划同时回答两个问题：

1. 如何把 `apps/api` 测试从"串行 + 每文件 schema"安全迁移到"并行 + 每
   worker database"，同时为未来的 Redis / Queue / background worker 预留
   统一隔离契约。
2. 如何把 CI 从"单 job 内 Vitest workers"升级到"分片 + 专项 job"，并为
   background / concurrency / e2e 各自分配 dedicated 基础设施。

## 不变量（贯穿所有阶段）

无论处于哪个阶段，以下不变量都必须成立，违反任意一条都算 test-defining
bug，不能被当作"偶发 flake"容忍：

- 不泄漏 PostgreSQL 连接池。
- 不泄漏 Redis 连接。
- 不泄漏 `Queue` / `Worker` / `QueueEvents` / `FlowProducer`。
- 不泄漏 timer / interval。
- ordinary 测试默认不启动 background jobs。
- worker 之间无共享可变状态。
- CI shard 之间无共享可变状态。

## 与现有 flake 登记的关系

本计划受 `docs/dev/test-flakes.md` 启发，但**不**修改任何既有缓解。特别地：

- `BUG-FLAKE-001`（scanner 在并行 + 共享 schema 下 5s timeout）是当前
  `apps/api/vitest.config.ts` 设置 `fileParallelism: false` 的历史动机。本计划
  把它当作**背景**，**不**声称已修复，也**不**在本 PR 移除 `fileParallelism:
  false`。
- `BUG-FLAKE-002 / 003 / 004` 是"跨 scope 共享状态"问题的不同实例。本计划
  设计的 per-worker database + per-worker Redis/Queue prefix 模型，目标是从
  结构上消除这一类失败，但每一条既有缓解都保留到对应 Phase 用证据移除为止。
- `verify:db-tests` 串行链、scanner legacy timeout、`packages/db/vitest.config.ts`
  的 `fileParallelism: false`（PR86/PR87/PR88 已对 `packages/db` 恢复并行）等
  既有机制一律保留，除非对应 Phase 显式移除。

## 统一 test scope 模型

ADR-007 定义的唯一 test scope 模型，本计划所有阶段都基于它：

| Scope kind               | Scope id 格式   | 用途                              |
| ------------------------ | --------------- | --------------------------------- |
| 本地 ordinary worker     | `local_w{w}`    | 本地 `pnpm --filter @exam/api test` |
| CI shard worker          | `s{shard}_w{w}` | CI `api-fast` 分片矩阵             |
| background 专项          | `background`    | background-job 测试组              |
| concurrency 专项         | `concurrency`   | 真并发测试组                       |
| E2E 专项                 | `e2e`           | Playwright / 全浏览器测试          |

同一个 scope id 绑定：PostgreSQL database、Redis key prefix、Queue prefix、
background worker lifecycle。资源不得跨 scope。

资源命名：

```
PG database:   exam_test_{scope}        # 例如 exam_test_w1, exam_test_s2_w3
Redis prefix:  exam:test:{scope}:       # 例如 exam:test:local:w1: , exam:test:s2:w3:
Queue prefix:  exam:test:{scope}        # 例如 exam:test:local:w1 , exam:test:s2_w3
```

## 阶段总览

| Phase | 内容                                          | 是否改代码 | 是否改 CI | 必备 stress 证据 |
| ----- | -------------------------------------------- | ---------- | --------- | ---------------- |
| 0     | 仅文档（ADR + plan + taxonomy）              | 否         | 否        | 否               |
| 1     | 测试分类打标（ordinary / bg / concurrency / e2e） | 是（测试标记） | 否        | 是               |
| 2     | datasource / scope resolver                  | 是         | 否        | 是               |
| 3     | PostgreSQL per-worker database               | 是         | 否        | 是               |
| 4     | background jobs 显式 opt-in                  | 是         | 否        | 是               |
| 5     | 本地并行（fileParallelism=true）             | 是         | 否        | 是               |
| 6     | CI 分片                                      | 是         | 是        | 是               |
| 7     | Redis / Queue 集成                           | 是         | 是        | 是               |
| 8     | 可选：template database                      | 是         | 否        | 是               |

---

## Phase 0 — 仅文档（本 PR）

**范围**：仅新增三份文档。

- `docs/adr/ADR-007-stateful-infrastructure-test-isolation.md`
- `docs/dev/test-ci-parallelism-plan.md`（本文件）
- `docs/dev/test-suite-taxonomy.md`

**禁止**：

- 不改业务代码。
- 不改测试代码。
- 不改 `apps/api/vitest.config.ts`、`packages/db/vitest.config.ts`、
  `turbo.json`、`package.json` 的任何 script、`.github/workflows/*`。

**验收**：

- 三份文档存在且 prettier 通过（`pnpm format:check`）。
- ADR 措辞谨慎：只把 `BUG-FLAKE-001` 当作历史背景和动机，不声称已修复。

---

## Phase 1 — 测试分类打标

**目标**：给每个测试文件 / describe 打上 group 标签，便于后续 Phase 用
`API_TEST_GROUP` 过滤调度，但不改变当前执行方式。

**范围**：

- 在测试文件顶部用统一标记（建议 `// @group fast|background|concurrency|e2e`
  或 describe 层级 `tags`，具体形式由实施 PR 决定）声明所属 group。
- 不改测试逻辑、不改测试断言、不改现有隔离 helper 调用。

**分类规则**：见 `docs/dev/test-suite-taxonomy.md`。简要：

- `fast`：普通 route / flow / validation / auth / admin / candidate /
  grading 单链路。
- `background`：deadline scanner、heartbeat disrupted、audit polling、
  outbox processor、queue worker、async audit writer。
- `concurrency`：start attempt race、submit idempotency race、restore
  race、`FOR UPDATE` 行为、scanner 幂等性、并发租户隔离。
- `e2e`：Playwright、admin/candidate demo flow、refresh during exam。

**验收（stress 证据）**：

- 标记前后 `pnpm verify` 全绿。
- 可按 group 过滤运行（例如 `API_TEST_GROUP=fast pnpm --filter @exam/api test`）
  且结果与全量一致（除被过滤的 group）。
- 标记不打散既有隔离 schema 调用。

**不纳入 Phase 1**：不引入 Redis / Queue 隔离、不改 vitest config、不改 CI。

---

## Phase 2 — datasource / scope resolver

> **进度**: Phase 2A 已落地（resolver skeleton，见下方小节）。Phase 2B
> （把 resolver 接入测试工厂、消费派生命名）尚未开始。

**目标**：引入一个统一的 scope resolver，把"当前在哪运行 / 当前是哪个
worker"映射成一个 scope id，再由 scope id 解析出 PG database、Redis
prefix、Queue prefix。本阶段先只解析 scope，PG 切换在 Phase 3。

**范围**：

- 新增 resolver，支持：
  - 本地 worker：`TEST_INFRA_SCOPE=local` → `local_w{worker}`。
  - CI shard + worker：`TEST_INFRA_SCOPE=ci` → `s{shard}_w{worker}`。
- **保留 legacy 回退**：`TEST_DB_ISOLATION=file-schema` 走既有
  `packages/db/src/testIsolation.ts` 每文件 schema 路径。这是 ADR-007 明确
  保留的回退杠杆。
- 不改 CI。

**环境变量（契约，由 ADR-007 定义）**：

```
TEST_INFRA_SCOPE=local|ci
TEST_SHARD_INDEX=local|1|2|3
TEST_WORKER_ID={vitest worker id}
TEST_DB_ISOLATION=worker-database|file-schema
TEST_DATABASE_URL_TEMPLATE=postgres://.../exam_test_s{shard}_w{worker}
```

### Phase 2A — resolver skeleton（已完成）

落地内容（`packages/db/src/testScope.ts`，并通过 `@exam/db` 公共导出）：

- 纯解析逻辑，**无任何副作用**：不连 PG、不建库、不建 schema、不跑
  migration、不连 Redis、不建 queue、不启 worker、不起 timer。
- `resolveTestScope(env)` → `ResolvedTestScope`，派生 `scopeId` / `kind` /
  `group` / `dbIsolation` / `postgresDatabaseName` / `redisPrefix` /
  `queuePrefix` / `queueMode` / `shardIndex` / `workerId` / `isCi`。
- worker id 解析顺序：`TEST_WORKER_ID`（fallback lever）→ `VITEST_WORKER_ID`
  （runner 自动注入）→ `"1"`。**不要求**开发者手动传 `TEST_WORKER_ID`。
- 输入校验：worker id 仅允许 `[A-Za-z0-9_-]`；shard index 仅允许 `local`
  或正整数；group / db isolation / queue mode 必须属于允许集合；派生的 PG
  database name 仅允许 `[a-z0-9_]` 且 ≤63 字符。非法输入**直接报错**，不静默
  生成奇怪名字。
- 命名规则（与 ADR-007 §2/§3/§4 一致）：
  - local: `scopeId=local_w{w}`，`db=exam_test_w{w}`，
    `redis=exam:test:local:w{w}:`，`queue=exam:test:local:w{w}`。
  - CI: `scopeId=s{shard}_w{w}`，`db=exam_test_s{shard}_w{w}`，
    `redis=exam:test:s{shard}:w{w}:`，`queue=exam:test:s{shard}:w{w}`。
  - dedicated（background/concurrency/e2e）：`scopeId=<group>`，
    `db=exam_test_<group>`，`redis=exam:test:<group>:`，
    `queue=exam:test:<group>`。
- legacy `TEST_DB_ISOLATION=file-schema`：`postgresDatabaseName=null`，
  `isLegacyFileSchemaMode()=true`，resolver **不**派生 worker database。
- 单元测试 `packages/db/src/testScope.test.ts`（26 用例，hermetic，无需 PG
  服务）覆盖默认值、local/CI/dedicated 命名、file-schema 回退、各类非法输入
  拒绝、Redis prefix 必以 `:` 结尾、Queue prefix 不得以 `:` 结尾、PG name
  安全字符与长度。

**Phase 2A 严格不做**：

- **不**打开 `fileParallelism: true`，**不**改 `maxWorkers`。
- **不**创建真实 worker database（那是 Phase 3）。
- **不**移除 `packages/db/src/testIsolation.ts` 每文件 schema helper。
- **不**移除 `TEST_DB_ISOLATION=file-schema` 回退。
- **不**引入 Redis / BullMQ 依赖。
- **不**改 CI。
- **不**声称修复 `BUG-FLAKE-001`。
- 现有测试执行拓扑与结果**完全不变**；resolver 仅提供命名能力，尚未被
  测试工厂消费。

**Phase 2A 验收**：`pnpm --filter @exam/db exec vitest run src/testScope.test.ts`
全绿（26/26）；`pnpm --filter @exam/db typecheck` 通过；既有 `@exam/db` /
`@exam/api` 测试行为不变。

**验收（stress 证据，Phase 2B 及以后）**：

- `TEST_DB_ISOLATION=file-schema`（默认回退）下 `pnpm verify` 全绿，行为与
  Phase 0 一致。
- resolver 单元测试覆盖 local / ci 两种 scope 的命名规则。
- resolver 不引入运行时 Redis / Queue 依赖（本阶段 Redis/Queue 尚未落地）。

---

## Phase 3 — PostgreSQL per-worker database

> **进度**: Phase 3A 已落地（worker-database **prototype**）。Phase 3B 已
> 落地（API test helper opt-in worker database）。Phase 3 主目标的剩余部分
> （每文件/每用例 `TRUNCATE` 重置、`closeInfra()` 统一关闭、提速收益验证）
> 尚未开始，见下方小节。

**目标**：把 ordinary API / integration 测试从"每文件 schema + 每文件
migrate + drop"迁移到"每 worker 一个 database，migrate once，文件之间
`TRUNCATE ... RESTART IDENTITY CASCADE`"。

### Phase 3A — worker-database prototype（已完成）

落地内容（`packages/db/src/testWorkerDatabase.ts`，test-only，**不**在
`index.ts` barrel 导出，遵循 `testIsolation.ts` 同样的非公共导出约定）：

- `setupWorkerTestDatabase({ env, truncateSchema })` → `WorkerDatabaseHandle`：
  - 复用 Phase 2A `resolveTestScope()` 派生 `postgresDatabaseName`。
  - 生产模式守卫：`APP_MODE=production` 或 `NODE_ENV=production`（且
    `APP_MODE` 未设置）时**拒绝运行**（test-only）。
  - `ensureDatabaseExists(adminUrl, name)`：连 maintenance DB，参数化
    `SELECT 1 FROM pg_database WHERE datname = $1` 探测，缺失则
    `CREATE DATABASE "<safe-quoted>"`。幂等。
  - 复用现有 `migratePostgres(db)`（无 `migrationsSchema`，即默认 `public`
    业务表 + `drizzle` 迁移元数据），Drizzle `migrate()` 幂等。
  - `handle.resetPostgres()`：`TRUNCATE ... RESTART IDENTITY CASCADE` 目标
    schema（默认 `public`）所有业务表，**排除**迁移元数据表
    （`__drizzle_migrations` / `drizzle_migrations`）。表名来自
    `pg_tables` catalog，标识符严格 quote。
  - `handle.close()`：关闭 worker pool，幂等。
- 辅助：`withDatabaseName(url, name)`、`truncateBusinessTables(sql, schema)`、
  `ensureDatabaseExists(adminUrl, name)`。
- 测试 `packages/db/src/testWorkerDatabase.test.ts`（12 用例）：URL 派生、
  生产守卫、`file-schema` 拒绝、不安全 URL/标识符/schema 拒绝、
  `ensureDatabaseExists` 幂等、完整生命周期（migrate → connect → insert →
  truncate → 迁移元数据保留 → close 幂等）、no-op truncate。PG 集成用例在
  PG 不可达时自动 `describe.skip`。

**Phase 3A 严格不做**（与本计划"不纳入 Phase 3"一致，且更窄）：

- **不**把 `@exam/api` 测试工厂接入 worker database（那是 Phase 3B）。
- **不**把 `@exam/db` 现有测试文件切到 worker database —— 现有文件仍走
  `testIsolation.ts` 每文件 schema 路径（`isTestDbIsolationEnabled()` 把
  `"worker-database"` 当 truthy，继续走 schema 隔离）。本 PR 只新增 helper
  prototype + 其自带测试。
- **不**打开 `fileParallelism: true`，**不**改 `maxWorkers`。
- **不**改 CI、turbo、package.json、生产 schema/migration。
- **不**引入 Redis / BullMQ。
- **不**移除 `testIsolation.ts` 或 `TEST_DB_ISOLATION=file-schema` 回退。
- **不**声称 `BUG-FLAKE-001` 已修复，**不**证明 `maxWorkers=2/4` 安全。

**Phase 3A 验收**（独立 PG，端口与 e2e/他人隔离）：

| 命令 | 结果 | 粗略耗时 |
|---|---|---:|
| `pnpm --filter @exam/db exec vitest run src/testWorkerDatabase.test.ts` | 12/12 PASS | ~2s |
| `pnpm --filter @exam/db test`（legacy 默认） | 149/149 PASS | ~7s |
| `TEST_DB_ISOLATION=worker-database TEST_WORKER_ID=1 pnpm --filter @exam/db test` | 149/149 PASS | ~8s |
| `pnpm --filter @exam/api test`（legacy 默认，串行） | 560/560 PASS | ~110s |

> 注：db suite 两种 env 耗时基本相同，因为现有 db 测试两种 env 下都走
> legacy 每文件 schema 路径；worker-database 路径当前只由新 12 个测试驱动。
> 提速收益要等 Phase 3B 把 api suite 接入 worker database 后才会显现。

**Phase 3A 可回滚**：`TEST_DB_ISOLATION=file-schema`（或任何非
`worker-database` 值）下，`setupWorkerTestDatabase()` 会在入口拒绝；现有测试
行为完全不变。即使删掉这两个新文件，旧模式仍正常工作。

### Phase 3B — API test helper opt-in worker database（已完成）

**目标**：把 `apps/api` 的测试工厂 `buildTestApp()` 与 7 个
`apps/api/tests/security/*.test.ts` 自建 app 接入 Phase 3A 的 worker
database 路径，作为**显式 opt-in**。默认行为不变。

**范围**：

- 新增 `apps/api/src/routes/testDatabase.ts`（adapter，single chokepoint）：
  - `setupApiTestDatabaseFromEnv({ namespace, databaseUrl })` →
    `ApiTestDatabaseHandle`：根据 `TEST_DB_ISOLATION` 选择 worker-database 或
    legacy 每文件 schema 路径。
  - `isWorkerDatabaseMode(env)`：**仅**当 `TEST_DB_ISOLATION` 字面等于
    `"worker-database"` 时返回 true。**故意不**沿用 Phase 2A resolver 的
    `worker-database` 默认值（resolver 在 env 未设时默认 worker-database）——
    Phase 3B 的非目标之一是"不强制把所有测试切到 worker-DB"。adapter 必须只在
    开发者/CI 显式 opt-in 时切换。
  - `ApiTestDatabaseHandle`：统一 `mode` / `databaseUrl` / `schemaName` /
    `resetPostgres()` / `close()`，legacy 路径下 `resetPostgres()` 是 no-op
    （每文件 schema 自身隔离，无需 truncate）。
- `apps/api/src/routes/testHelpers.ts` 的 `buildTestApp()`：拆出共享尾部
  `finishBuildTestApp()`，新增 worker-DB 分支（在 caller 未传 `schemaName` 且
  `isWorkerDatabaseMode()` 为 true 时走 adapter）。
- 7 个 `apps/api/tests/security/*.test.ts`：把 `setupIsolatedTestDb` 改为
  `setupApiTestDatabaseFromEnv`，setup 块改为 `resetPostgres()` + `close()`
  统一形态。
- 新增 `apps/api/src/routes/testDatabase.test.ts`（10 用例，全 mock，不依赖
  PG）：覆盖 mode 选择、namespace/databaseUrl 透传、worker/legacy 包装、close
  幂等、production 守卫委托。

**RESET BOUNDARY（重要设计决定）**：

`buildTestApp()` 在 worker-DB 分支**不**调用 `adapter.resetPostgres()`。原因：
若干 `apps/api` 测试文件（`auth.test.ts` 4 次、`exam.test.ts` 4 次、
`user.test.ts` 3 次、`api-smoke.test.ts` 5 次等）在同一文件内**多次**调用
`buildTestApp()`，并跨这些 build 复用 `beforeAll` 里的共享 `ctx.org`。如果在
每次 build 时 truncate，文件后段的 build 会清掉前段 build 写入并被共享 ctx
引用的 org 行，触发 FK violation（`users_organization_id_organizations_id_fk`）。

隔离来源：
- **跨文件**：每个 vitest worker 拥有自己的 database（resolver 派生
  `exam_test_w{w}`），`fileParallelism:false` 保证同一时刻只有一个 worker 在
  跑。worker-DB 模式下文件之间不复用 schema，跨文件脏数据落在不同 database。
- **文件内**：每个测试已用 `uniquePrefix()` + org-scoped insert 生成不冲突
  数据，无需 truncate；与 legacy 每文件 schema 路径行为一致。

若未来某文件需要显式 worker-DB truncate，可直接调
`setupApiTestDatabaseFromEnv()` 并使用返回 handle 的 `resetPostgres()`。

**Phase 3B 严格不做**：

- **不**打开 `fileParallelism: true`，**不**改 `maxWorkers`。
- **不**移除 legacy `file-schema` 回退、`testIsolation.ts`、每文件 schema
  helper。
- **不**引入 Redis / BullMQ。
- **不**改 CI、turbo、package.json script、生产 schema/migration。
- **不**声称 `BUG-FLAKE-001` 已修复，**不**证明 `maxWorkers=2/4` 安全，
  **不**把 worker-DB 设为默认。
- **不**改 `@exam/db` 测试（它们仍走每文件 schema 路径）。

**Phase 3B 验收**（独立 PG，端口 6432 与 e2e/他人隔离）：

| 命令 | 结果 | 粗略耗时 |
|---|---|---:|
| `pnpm --filter @exam/api exec vitest run src/routes/testDatabase.test.ts` | 10/10 PASS | ~0.1s |
| `pnpm --filter @exam/api test`（unset / 默认 legacy） | 570/570 PASS | ~93s |
| `TEST_DB_ISOLATION=file-schema pnpm --filter @exam/api test` | 570/570 PASS | ~93s |
| `TEST_DB_ISOLATION=worker-database TEST_WORKER_ID=1 pnpm --filter @exam/api test`（×2 连跑） | 570/570 PASS ×2 | ~102s / ~116s |
| `pnpm verify`（默认 legacy 路径） | 全绿 | — |

> 注：worker-DB 模式比 legacy 略慢（~102s vs ~93s），因为同一 worker database
> 跨文件累积数据，单文件 migrate/seed 之外没有 schema 重建带来的天然清空；
> 但 `fileParallelism:false` 下二者都在串行执行，差距主要来自额外的 database
> bootstrap。提速收益要等 Phase 5 恢复并行后才会显现，本阶段不追求提速。

**Phase 3B 可回滚**：`TEST_DB_ISOLATION` 未设或为任何非 `"worker-database"`
值时，`isWorkerDatabaseMode()` 返回 false，`buildTestApp()` 与 7 个 security
文件全部走 legacy 每文件 schema 路径，行为与 Phase 3A 完全一致。adapter 与
security 文件的改写是纯增量分支，删掉 worker 分支即回到旧形态。

**Phase 3B 及以后**（后续 PR）才会做本 Phase 3 主目标的剩余部分：

- 启动时确保 worker database 存在（`CREATE DATABASE IF NOT EXISTS` 等价，
  PostgreSQL 无此语法，用 `SELECT 1 FROM pg_database` 探测 + 条件
  `CREATE DATABASE`）。
- 每个 worker database migrate once。
- 测试文件 / 测试用例之间用 `TRUNCATE ... RESTART IDENTITY CASCADE`
  重置，而不是重建 schema。
- `closeInfra()` 关闭 PG 连接池。

**与现有机制的关系**：

- `packages/db/src/testIsolation.ts` 的每文件 schema 路径作为
  `TEST_DB_ISOLATION=file-schema` 回退保留。
- 本阶段不删除 `apps/api/vitest.config.ts` 的 `fileParallelism: false`。
  移除在 Phase 5。

**验收（stress 证据）**：

- `pnpm --filter @exam/api test`（worker database 模式）全绿。
- `API_TEST_MAX_WORKERS=2` ×5 全绿。
- `API_TEST_MAX_WORKERS=4` ×5 全绿。
- 对照 `TEST_DB_ISOLATION=file-schema`（回退）×5 全绿。
- `pnpm verify` 全绿。
- 无连接池泄漏（teardown 后 PG 连接数回到基线）。
- `BUG-FLAKE-001` 家族（scanner timeout）在 worker database 模式下不复发；
  若复发，不调长 timeout、不 skip、记录最小复现并回退到 Phase 2 状态。

**不纳入 Phase 3**：

- 不恢复 `fileParallelism`。
- 不改 CI。
- 不引入 template database（那是 Phase 8）。

---

## Phase 4 — background jobs 显式 opt-in

**目标**：让 `buildTestApp()`（或等价测试工厂）默认**不**启动 deadline
scanner / heartbeat poller / queue worker。需要 worker 的测试必须显式
opt-in。

**范围**：

- ordinary `buildTestApp()` 默认 disabled：
  - 不启动 `scanDatabaseForDisruptedAttempts` 定时器。
  - 不启动 heartbeat 轮询。
  - 不启动 outbox / queue consumer。
- background / concurrency 测试通过显式参数启用（例如
  `buildTestApp(plugin, { workers: { scanner: true } })`，具体 API 由实施
  PR 决定）。
- 显式关闭路径：`closeInfra()` 关闭 worker / timer。

**为什么放这里**：

- Phase 3 之后 ordinary 测试才具备独立 database，此时把 worker 默认关掉
  不会让普通测试依赖跨文件的 scanner 行为。
- 这是 Phase 5（本地并行）的前置条件：默认不启动 worker 才能安全并行。

**验收（stress 证据）**：

- ordinary API 测试在"worker 默认关闭"下全绿。
- background 测试在"显式启用 worker"下全绿。
- `pnpm verify` 全绿。
- 无泄漏 worker / timer（teardown 后无残留 `setInterval`）。

### Phase 4 状态 — audit-confirmed default-off + regression guard（已完成）

**审计结论**：`buildTestApp()` 当前**已经**满足 Phase 4 目标 —— 默认**不**启动任何
background timer。具体证据：

- `buildTestApp()` / `finishBuildTestApp()` 只注册：security、errorHandler、
  zodProvider、cookie、db、now、auth、tenant（+ 可选 rateLimit）、caller 传入的
  routePlugin。**不**注册 `heartbeatPlugin` / `deadlineScannerPlugin`。
- `apps/api/src/**` 内仅有的两个 `setInterval` 周期定时器分别位于
  `plugins/heartbeat.ts:216`（disrupted-attempt scanner）和
  `plugins/deadlineScanner.ts:204`（expired-attempt auto-submit scanner）。
  两者都是 Fastify plugin，**仅**由生产 `server.ts:58-59` 注册，**任何测试都不
  注册它们**。
- 两个 scanner plugin 都已挂 `onClose → clearInterval`
  （heartbeat.ts:243、deadlineScanner.ts:226），teardown 路径完整。
- scanner 测试（`src/plugins/heartbeat.test.ts`、
  `src/plugins/deadlineScanner.test.ts`、`src/routes/attempts/heartbeat.test.ts`、
  `src/routes/attempts/deadline-scanner.test.ts`）直接调用 scan **函数**
  （`scanDatabaseForExpiredAttempts`、`scanDatabaseForDisruptedAttempts`），
  不经过定时器驱动的 plugin lifecycle。
- **不存在** audit polling 实现。`apps/api/vitest.config.ts` 注释里提到的
  "audit-polling" 是历史措辞；`audit.test.ts:114` 唯一的 `setTimeout` 是 25ms
  测试等待，不是轮询。

**回归 guard**：新增 `apps/api/src/routes/testBackgroundJobs.test.ts`（4 用例）：

1. ordinary `buildTestApp()` 不注册 `heartbeatPlugin`（`hasPlugin` 断言）。
2. ordinary `buildTestApp()` 不注册 `deadlineScannerPlugin`。
3. ordinary `buildTestApp()` 启动**零** `setInterval`（spy `global.setInterval`，
   name-independent，能捕获任何未来以任意名注册的 scanner / poller / worker）。
4. ordinary build 仍能正常 seed 并 ready，且不依赖任何 background tick。

**不引入 opt-in API**：本 PR **不**添加 `enableScanners` /
`enableDeadlineScanner` / `enableHeartbeatScanner` 等参数。原因：当前没有任何
测试需要 plugin-level scanner lifecycle（都直接调函数）。在没有具体需求前加
unused API 会增加 `buildTestApp` 的表面积而无收益。

**Follow-up note**：如果未来某个 background / concurrency 测试需要真实的
timer-driven scanner plugin lifecycle，再在 `buildTestApp()` 增加显式 opt-in
参数（例如 `enableDeadlineScanner: true`），ordinary 测试保持 default-off。
本回归 guard 会确保任何"偷偷在 ordinary build 里注册 scanner"的改动被立即发现。

**Phase 4 验收**（独立 PG `exam-db-6432`，端口 6432）：

| 命令 | 结果 |
|---|---|
| `pnpm --filter @exam/api exec vitest run src/routes/testBackgroundJobs.test.ts` | 4/4 PASS |
| `pnpm --filter @exam/api exec vitest run src/plugins/heartbeat.test.ts src/plugins/deadlineScanner.test.ts` | PASS |
| `pnpm --filter @exam/api exec vitest run src/routes/attempts/heartbeat.test.ts src/routes/attempts/deadline-scanner.test.ts` | PASS |
| `TEST_DB_ISOLATION=file-schema pnpm --filter @exam/api test` | 570/570 PASS |
| `TEST_DB_ISOLATION=worker-database TEST_WORKER_ID=1 pnpm --filter @exam/api test` | 570/570 PASS |

**Phase 4 可回滚**：删除 `testBackgroundJobs.test.ts` + 还原文档，不影响任何
行为（纯测试 + 纯文档）。

---

## Phase 5 — 本地并行

**目标**：在 Phase 3 + Phase 4 稳定后，把 `apps/api` 从串行恢复到受控并行。

**范围**：

- `apps/api/vitest.config.ts`：`fileParallelism=true`。
- 先 `maxWorkers=2`，stability 通过后再 `maxWorkers=4`。
- 目标状态：

  ```
  fileParallelism=true
  maxWorkers=4
  TEST_INFRA_SCOPE=local
  TEST_DB_ISOLATION=worker-database
  ```

- 本地普通 API 测试布局：

  ```
  worker 1 -> PG exam_test_w1, Redis exam:test:local:w1:, Queue prefix exam:test:local:w1
  worker 2 -> PG exam_test_w2, Redis exam:test:local:w2:, Queue prefix exam:test:local:w2
  worker 3 -> PG exam_test_w3, Redis exam:test:local:w3:, Queue prefix exam:test:local:w3
  worker 4 -> PG exam_test_w4, Redis exam:test:local:w4:, Queue prefix exam:test:local:w4
  ```

**vitest 语义提醒**（来自 PR86 诊断矩阵 + Vitest `resolveConfig` 源码）：

- `fileParallelism: false` 会把 `maxWorkers` **强制为 1**，因此
  `--maxWorkers=50%` 必须与 `--fileParallelism` 同时提供才有效；单独传会被
  config 覆盖退化为串行。本 Phase 要并行，必须显式改 config。
- 回退杠杆：把 config 改回 `fileParallelism: false` 即可立刻回到串行，CI
  flag 无法绕过，因此这是可靠的回退。

**验收（stress 证据）**：

- `API_TEST_MAX_WORKERS=2` ×5 全绿。
- `API_TEST_MAX_WORKERS=4` ×5 全绿。
- `pnpm verify` ×3 全绿。
- 若 `BUG-FLAKE-001` 家族在 maxWorkers=4 下复发，先回退到 maxWorkers=2，
  不调长 timeout、不 skip、记录证据。

**不纳入 Phase 5**：不改 CI（CI 分片在 Phase 6）。

---

## Phase 6 — CI 分片

**目标**：CI 不再只靠单 job 内 Vitest workers，而是用 GitHub Actions matrix
分片 + 专项 job。

**范围**：

- `api-fast` shard 矩阵（1/N, 2/N, 3/N …）。
- 每个 shard 自带 PostgreSQL service / Redis service，或至少有唯一
  database / prefix。
- 每个 shard `maxWorkers=1~2`。
- `api-background`（serial）、`api-concurrency`（serial）、`e2e-smoke` 作为
  独立 job。

- CI ordinary API shard 资源命名：

  ```
  maxWorkers=1~2
  PG:          exam_test_s{shard}_w{worker}
  Redis:       exam:test:s{shard}:w{worker}:
  Queue prefix: exam:test:s{shard}:w{worker}
  ```

**验收（stress 证据）**：

- 每个 shard 在 CI 上 ×5 全绿。
- `api-background` / `api-concurrency` / `e2e-smoke` 各自 ×3 全绿。
- 无跨 shard 状态泄漏（每个 shard 独立 service 或独立 prefix）。

**不纳入 Phase 6**：不引入 Redis / Queue 运行时依赖（它们落地后才进 Phase 7）。

---

## Phase 7 — Redis / Queue 集成

**前置条件**：ADR-001（Redis）或 ADR-003（Job Queue）中的某个 Trigger for
Adoption 被真实命中（例如多实例部署、共享 rate limit、持久化队列需求）。本
Phase 不会为了让 Phase 0–6 的隔离机制有用而提前引入 Redis / Queue。

**目标**：把 Redis / Queue 纳入统一 scope 模型。

**范围**：

- Redis prefix resolver（`exam:test:{scope}:`）。
- Queue prefix resolver（`exam:test:{scope}`）。
- `TEST_QUEUE_MODE`：

  - `disabled`：不涉及 enqueue 的 ordinary 测试。
  - `producer-only`（ordinary API 默认）：验证 enqueue 成功 + job 行存在，
    但不跑 consumer。
  - `worker-enabled`：仅在 background / concurrency 测试，显式 worker
    lifecycle + teardown。

- BullMQ 隔离用 `prefix`，**不**用 ioredis `keyPrefix`。
- 统一 cleanup API：`resetRedisByPrefix()`、`resetQueues()`、`closeInfra()`。

**验收（stress 证据）**：

- queue producer 测试 ×5 全绿。
- queue worker 测试 ×5 全绿（含 retry / delay）。
- Redis prefix 隔离：两 worker 同时跑，互不见对方 key。
- teardown 后无泄漏 Redis 连接 / Queue / Worker。
- `FLUSHDB` / `FLUSHALL` 仅在 dedicated Redis 上调用，shared Redis 只清当前
  prefix。

---

## Phase 8 — 可选：template database

**触发条件**：Phase 3 之后，若 per-worker database 的 migration/seed 成本仍
然是瓶颈（每个 worker database 仍要跑全量 migrate）。

**目标**：用 PostgreSQL template database 把"migrate"变成一次性的模板克隆。

**范围**：

```
migrationHash -> template database
CREATE DATABASE exam_test_s{shard}_w{worker} TEMPLATE exam_template_{hash}
```

- 同一 migration hash 复用同一 template。
- migration 变化时重建 template。

**为什么不放前面**：

- ADR-007 明确 template database 是"未来 migration/seed 成本过高时的二阶段
  优化，不是第一阶段必做"。Phase 3 的 per-worker database + migrate once +
  truncate 在大多数场景已经够快。

**验收（stress 证据）**：

- 相同 migration 下，per-worker database 创建时间显著下降（量化对比）。
- migration 变化时 template 正确重建。
- 测试结果与 Phase 3 一致。

---

## 验证矩阵（贯穿所有阶段）

本地（适用于 Phase 3+）：

```
pnpm --filter @exam/api test
API_TEST_MAX_WORKERS=2 pnpm --filter @exam/api test
API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api test
repeat maxWorkers=4 five times
pnpm verify
```

CI（适用于 Phase 6+）：

```
api-fast shard 1/N
api-fast shard 2/N
api-fast shard 3/N
api-background serial
api-concurrency serial
e2e-smoke
```

专项 stress（适用于对应 Phase）：

```
auth tests x5
candidate flow tests x5
admin flow tests x5
deadline scanner tests x5
audit polling tests x5
queue producer tests x5
queue worker tests x5
tenant isolation tests x5
```

失败原则（适用于所有阶段）：

- 不要通过提高 timeout 掩盖失败。
- 不要 silent skip flaky tests。
- 必须记录最小复现、失败日志、怀疑违反的 invariant。
- 若疑似违反某条 cleanup invariant，按 ADR-007 §Cleanup invariants 对照。

## 回退路径

任何阶段失败时，按以下顺序回退，每一步都是确定性的、不需要猜测：

1. **Phase 7 / 8**：关闭 Redis / Queue 运行时（ADR-001/ADR-003 本就是
   Deferred），回退到 Phase 6 状态。
2. **Phase 6**：CI 回退到单 job 内 Vitest workers，回退到 Phase 5 状态。
3. **Phase 5**：`apps/api/vitest.config.ts` 改回 `fileParallelism: false`
   （vitest `resolveConfig` 会强制 `maxWorkers=1`，CI flag 无法绕过，可靠）。
4. **Phase 3**：`TEST_DB_ISOLATION=file-schema` 回退到既有每文件 schema 路径
   （`packages/db/src/testIsolation.ts`）。
5. **任何阶段**：保留 `verify:db-tests` 串行链与 scanner legacy timeout 作为
   最后安全网，移除它们需要独立 PR 的 stress 证据。

## 与既有脚本的关系

- 现有 `verify:db-tests` 串行链、`verify:nodb-tests`、`test:db` / `test:api` /
  `coverage:db` / `coverage:api` 单 package 脚本：本计划不修改它们，直到对应
  Phase 用证据移除。
- 现有 `scripts/test/verify-stress.sh`、`scripts/test/deadline-scanner-stress.sh`：
  继续作为手动 stress 工具，各 Phase 的 stress 证据可用它们采集。
- `turbo.json` 的 `@exam/db#coverage dependsOn @exam/db#test`（PR88）：保留，
  直到 Phase 6 重新评估 turbo 调度。

## 参考

- `docs/adr/ADR-007-stateful-infrastructure-test-isolation.md` — 架构约束。
- `docs/dev/test-suite-taxonomy.md` — 测试分类与打标规则。
- `docs/dev/test-flakes.md` — flake 登记册（背景，不被本计划修改）。
- `docs/known-test-isolation-issues.md` — 既有隔离问题。
- `apps/api/vitest.config.ts` — 当前 `fileParallelism: false` 与
  `resolveConfig` 语义。
- `packages/db/src/testIsolation.ts` — 既有每文件 schema 隔离（回退路径）。
- `docs/adr/ADR-001-redis.md`、`docs/adr/ADR-003-job-queue.md` — Redis / Queue
  采用触发条件（均 Deferred）。
