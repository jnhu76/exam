# 测试分类法（Test Suite Taxonomy）

> **状态**: Proposed（仅文档）。本文件与
> `docs/adr/ADR-007-stateful-infrastructure-test-isolation.md`（架构约束）、
> `docs/dev/test-ci-parallelism-plan.md`（实施计划）共同构成 Phase 0 文档交付。
> **本 PR 不改业务代码、不改测试代码、不改 CI。**

## 目的

为 exam 项目定义一套统一的测试分类法，让每一个测试文件 / describe 都能被归
入确定的 group，并因此绑定确定的基础设施隔离规则、调度方式与执行位置。

ADR-007 的核心约束"每个 test scope 独占 PG database / Redis prefix /
Queue prefix / background worker lifecycle"只有在测试被正确分类后才可执行。
本文件就是分类的权威依据。

## 分类总表

| Group          | 用途                                                       | 隔离                                                       | 执行                                   |
| -------------- | ---------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------- |
| ordinary API   | 单链路 route / flow / validation / auth / admin / candidate / grading | PG worker database；Redis worker prefix；queue producer-only 或 disabled；background jobs 默认关闭 | 本地 `maxWorkers=4`；CI shard `maxWorkers=1~2` |
| background-job | deadline scanner、heartbeat disrupted、audit polling、outbox processor、queue worker、async audit writer | dedicated PG database；dedicated Redis prefix/service；dedicated queue prefix；worker 显式启用 | serial 或低 worker count               |
| true concurrency | start attempt race、submit idempotency race、restore race、`FOR UPDATE` 行为、scanner 幂等性、并发下租户隔离 | dedicated infrastructure；测试内部显式制造并发             | runner 通常 serial                       |
| E2E            | Playwright、admin/candidate demo flow、refresh during exam、全浏览器流程 | dedicated seeded PG；dedicated Redis/Queue namespace；worker 显式 | PR smoke；main/nightly full             |

每组对应一个 scope id（见 ADR-007 §1）：

- ordinary API：本地 `local_w{w}`，CI `s{shard}_w{w}`。
- background-job：`background`。
- true concurrency：`concurrency`。
- E2E：`e2e`。

## 判定原则

把一个测试归入哪个 group，按以下顺序判定（先命中先用）：

1. **是否跨进程 / 跨真实浏览器？** 是 → E2E。
2. **是否在测试内部显式制造并发（`Promise.all`、多请求竞态、多 worker）？**
   是 → true concurrency。
3. **是否依赖 background worker / scanner / poller / queue consumer 真正运
   行？** 是 → background-job。
4. **其余（单链路 route / flow / validation / auth / admin / candidate /
   grading）** → ordinary API。

边界情形：

- 测试**只 enqueue 但不期望 consumer 消费**：ordinary API，`TEST_QUEUE_MODE=
  producer-only`。
- 测试**期望 consumer 消费**（retry / delay / 实际处理）：background-job，
  `TEST_QUEUE_MODE=worker-enabled`。
- 测试**手动调用 `scanDatabaseFor*` 但不启动 setInterval**：ordinary API
  （scanner 是函数调用，不是 background worker）。当前
  `apps/api/src/routes/attempts.test.ts` 中多数 scanner 用例属于此类。
- 测试**依赖 setInterval 驱动的 scanner 周期性触发**：background-job。

## Group 1 — ordinary API / integration tests

### 用途

验证普通单链路行为：

- route handler 正确返回（成功 / 错误码 / 校验失败）。
- validation（Zod 契约、参数边界）。
- auth（登录、token、角色拒绝）。
- admin 流程（candidates / courses / questions / exams / assignments /
  grading / diagnostics / exports 配置）。
- candidate 流程（登录、考试进入、答题保存、提交、查看允许的结果）。
- grading（auto-grading、fill-blank 匹配、multi-select 评分）。
- 命令函数语义（`publishExam`、`startAttempt`、`submitAttempt` 等）。

### 隔离

```
PG:          worker database (exam_test_w{w} 或 exam_test_s{shard}_w{w})
Redis:       worker prefix (exam:test:local:w{w}: 等)
Queue:       disabled 或 producer-only
background:  默认关闭
```

- `buildTestApp()`（或等价工厂）默认不启动 scanner / poller / queue worker
  （Phase 4 后）。
- 测试之间用 `TRUNCATE ... RESTART IDENTITY CASCADE` 重置（Phase 3 后）。

### 执行

```
本地:  API_TEST_MAX_WORKERS=4，fileParallelism=true
CI:    api-fast shard，maxWorkers=1~2
```

### 归入此组的典型文件（基于当前仓库，仅作示例，不作硬编码绑定）

- `apps/api/src/routes/auth.test.ts`（除依赖 worker 的部分）
- `apps/api/src/routes/exam.test.ts`
- `apps/api/src/routes/question.test.ts`
- `apps/api/src/routes/course.test.ts`
- `apps/api/src/routes/grading.test.ts`
- `apps/api/src/routes/user.test.ts`（list / pagination / role filter）
- `apps/api/src/routes/permissionBoundary.test.ts`（单请求权限判定）

> 注：当前仓库尚未完成 Phase 1 打标，上述归属仅为示例，最终归属以打标 PR
> 为准。`user.test.ts` 的 list-pagination 既有隔离问题见
> `docs/known-test-isolation-issues.md` K-1，归 ordinary API 后由 Phase 3 的
> per-worker database + truncate 处理。

## Group 2 — background-job tests

### 用途

验证依赖 background worker / scanner / poller / queue consumer 真正运行的
行为：

- deadline scanner（`scanDatabaseForExpiredAttempts` 周期触发版）
- heartbeat disrupted scanner（`scanDatabaseForDisruptedAttempts` 周期触发版）
- audit polling（`waitForAudit()` 类长轮询，等待异步落库）
- outbox processor
- queue worker（BullMQ consumer 真正消费）
- async audit writer
- retry / delay / dead-letter

### 隔离

```
PG:          dedicated database (exam_test_background)
Redis:       dedicated prefix/service (exam:test:background:)
Queue:       dedicated prefix (exam:test:background)，worker-enabled
background:  显式启用
```

### 执行

```
serial 或低 worker count
CI:  api-background job，独立 PG/Redis service 或独立 database/prefix
```

### 归入此组的典型用例

- `apps/api/src/routes/attempts.test.ts` 中 `describe("deadline scanner")` /
  `describe("heartbeat scanner")` 下**依赖 setInterval 周期触发**的用例。
  （当前多数 scanner 用例是**直接函数调用**，归 ordinary API；只有依赖周期
  触发的归 background-job。打标 PR 需逐用例区分。）
- 未来 `audit-polling` / `outbox-processor` / `queue-worker` / `async-audit`
  测试文件。

### 约束

- worker 必须显式启用，不能默认随 `buildTestApp()` 启动。
- teardown 必须关闭 Worker / QueueEvents / timer，且清空当前 queue prefix。

## Group 3 — true concurrency tests

### 用途

验证真实并发下的正确性：

- start attempt race（同一 enrollment 下并发 start，唯一 attempt 约束）。
- submit idempotency race（同一 attemptId 并发 submit，幂等性）。
- restore race（disrupted 恢复 + 并发 answer save）。
- `FOR UPDATE` 行锁（advisory / row lock 实际生效）。
- scanner 幂等性（并发扫描不重复提交）。
- 并发下租户隔离（跨 org 并发请求不串数据）。

### 隔离

```
PG:          dedicated database (exam_test_concurrency)
Redis:       dedicated prefix/service
Queue:       视用例，可能 worker-enabled
background:  视用例
```

### 执行

```
测试内部显式制造并发（例如 Promise.all）
runner 通常 serial（避免框架意外并行污染）
CI:  api-concurrency job，serial
```

### 约束

- **不依赖测试框架的意外并行**来制造并发。并发必须在测试内部显式构造。
- dedicated infrastructure，不与 ordinary / background 共享。

### 归入此组的典型用例

- 未来 `concurrency/start-attempt-race.test.ts`。
- 未来 `concurrency/submit-idempotency.test.ts`。
- `apps/api/tests/security/tenant-isolation.test.ts` 中**显式并发请求**的用例
  （非并发单请求权限判定仍归 ordinary API）。

## Group 4 — E2E tests

### 用途

验证真实浏览器全链路：

- Playwright 驱动的 admin/candidate demo flow。
- refresh during exam（断网刷新恢复）。
- 全浏览器流程（登录 → 进入考试 → 答题 → 提交 → 查看结果）。
- full happy path / resume / submit-flush（roadmap 中作为 blocking CI 的目标）。

### 隔离

```
PG:          dedicated seeded database (exam_test_e2e，e2e seed)
Redis:       dedicated namespace
Queue:       视用例
background:  显式
```

### 执行

```
PR smoke:    子集（happy path）
main/nightly: full
CI:          e2e job，独立 PG service（POSTGRES_DB: exam_e2e，已存在）
```

### 归入此组的典型位置

- `apps/e2e/`（Playwright 测试，当前 CI 已有独立 `e2e` job，独立 PG
  `exam_e2e`）。
- `pnpm test:e2e` / `pnpm --filter @exam/e2e test:e2e`。

## 打标规则（Phase 1 实施细节）

具体打标形式由 Phase 1 实施 PR 决定，本文件只定约束：

- 每个**测试文件**至少有一个 group 标签。
- 一个文件可含多个 group 的 describe；describe 级标签优先于文件级。
- 默认 group 是 `fast`（ordinary API）。未被显式标记的文件按 ordinary API
  处理。
- 标签必须可被 `API_TEST_GROUP` 过滤识别（fast / background / concurrency /
  e2e / all）。
- 打标**不改测试逻辑、不改断言、不改现有隔离 helper 调用**。

建议的候选形式（实施 PR 选其一或提出等价方案）：

- 文件头注释：`// @group fast`
- describe tag：`describe("...", { tags: ["background"] }, () => ...)`
- 命名约定：目录分组 `tests/background/`、`tests/concurrency/`

## 与调度 / 执行位置的映射

| Group          | scope id                | 本地                                  | CI job               |
| -------------- | ----------------------- | ------------------------------------- | -------------------- |
| ordinary API   | `local_w{w}` / `s{shard}_w{w}` | `maxWorkers=4`，`fileParallelism=true` | `api-fast` shard 1..N |
| background-job | `background`            | serial / 低 worker                    | `api-background`     |
| concurrency    | `concurrency`           | serial                                | `api-concurrency`    |
| E2E            | `e2e`                   | 手动 / smoke                          | `e2e`（已有）/ `e2e-smoke` |

## 常见误判

- **"scanner 测试都归 background"** —— 错。直接调用
  `scanDatabaseForDisruptedAttempts()` 验证函数语义的是 ordinary API；只有
  依赖 setInterval 周期触发或 queue consumer 真正运行的才是 background-job。
- **"用了 Promise 的就是 concurrency"** —— 错。`await Promise.all([setupA(),
  setupB()])` 只是并行准备 fixture，不是并发竞争。concurrency 要求**被测系统
  在并发输入下**的正确性。
- **"tenant-isolation 测试都归 concurrency"** —— 错。单请求权限判定
  （`GET /api/exams` 只返回本 org）是 ordinary API；并发请求下不串数据才是
  concurrency。
- **"E2E 就是慢的 API 测试"** —— 错。E2E 是真实浏览器全链路（Playwright），
  不是更慢的 supertest。后者归 ordinary API。

## 与既有文档的关系

- `docs/adr/ADR-007-stateful-infrastructure-test-isolation.md` —— 架构约束，
  本文件是其分类法细节。
- `docs/dev/test-ci-parallelism-plan.md` —— 实施计划，Phase 1 即"按本文件分
  类打标"。
- `docs/dev/test-flakes.md` —— flake 登记册（背景，不被本文件修改）。
- `docs/known-test-isolation-issues.md` —— 既有隔离问题，归 ordinary API 的
  受影响测试由 Phase 3 per-worker database + truncate 处理。
- `.github/workflows/ci.yml` —— 当前 CI 已有独立 `e2e` job（独立 PG
  `exam_e2e`），与本文件 Group 4 一致；Phase 6 才新增 `api-fast` shard /
  `api-background` / `api-concurrency`。

## 进度备注（Phase 2A，resolver skeleton）

- `packages/db/src/testScope.ts` 已落地（纯解析，无副作用），能按本文件的
  group 概念派生 `scopeId` / `postgresDatabaseName` / `redisPrefix` /
  `queuePrefix` / `queueMode`。其中 `API_TEST_GROUP=background` 默认推导出
  `queueMode=worker-enabled`，`concurrency` / `e2e` / `fast` 默认
  `producer-only`，与上表"worker 是否显式启用"的语义一致。
- 这只是命名能力，**不**改变现有测试执行拓扑，**不**消费 resolver 的派生
  database/prefix。打标（Phase 1）与真实隔离落地（Phase 3+）仍是后续 PR。

## 进度备注（Phase 3A，worker-database prototype）

- `packages/db/src/testWorkerDatabase.ts` 已落地（test-only prototype）。它
  消费 Phase 2A resolver 的 `postgresDatabaseName`，提供
  `setupWorkerTestDatabase()` → `WorkerDatabaseHandle`（ensure database →
  migrate once → `resetPostgres()` truncate → `close()`）。
- **不**改变现有测试执行拓扑：现有 `@exam/db` / `@exam/api` 测试仍走
  `testIsolation.ts` 每文件 schema 路径（legacy default）。worker-database
  路径目前只由其自带 12 个测试驱动。
- **不**打开 `fileParallelism`，**不**改 `maxWorkers`，**不**改 CI。
- Phase 3B（把 API test helper 接入 worker database）才是真正切换默认行为
  的下一步，需要独立 PR + stress 证据。
