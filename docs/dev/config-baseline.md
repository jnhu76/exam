# Config Baseline 设计文档

- 日期：2026-06-14
- 阶段：Phase 1.7 Config Baseline 重构
- 任务性质：运行环境边界定义，不改变考试业务语义
- 关联：基于 `docs/dev/phase1-exam-lifecycle-exit-review-2026-06-13.md` 与 `docs/config.md` 的配置扫描

> **绝对限制**：本任务不修改考试生命周期语义、状态机语义、答题保存语义、交卷语义、批改语义。`APP_MODE`、feature flags、heartbeat 配置只做配置归口，不改变当前 Phase 1 行为。

## 1. 运行模式定义

| 模式 | 默认数据库来源 | 允许测试默认 secret | 允许 insecure cookie | 允许本地 CORS | 允许默认端口 | 可与其他模式共享数据库 |
|---|---|---|---|---|---|---|
| `development` | `DATABASE_URL`（本地 PG） | 是 | 是 | 是 | 是（3000） | 不推荐，但允许 |
| `test` | `TEST_DATABASE_URL`（`exam_test`） | 是 | 是 | 是 | 是 | 否——必须 `_test` 库 |
| `e2e` | `TEST_DATABASE_URL`（`exam_test`） | 是 | 是 | 是 | 是 | 允许与 `test` 共享；e2e 不需要独立 DB |
| `ci` | `TEST_DATABASE_URL`（CI service container） | 是 | 是 | 是 | 是 | 否——CI 用独立 container |
| `production` | `DATABASE_URL`（部署 PG） | **否——fail fast** | **否** | **否——显式 origin** | 否（显式 `APP_PORT`） | 否 |

### 模式判定规则

- `APP_MODE` 是应用运行模式的**唯一权威**。
- `NODE_ENV` **只作为构建/工具链信号**（Vite 区分 dev/build、Drizzle/Postgres 客户端行为），**不直接决定业务语义**。
- 当 `APP_MODE` 未设置时，按 `NODE_ENV` 推断 fallback：`production` → `production`，`test` → `test`，其他 → `development`。
- `isProduction = APP_MODE === "production"`。
- `isTestLike = APP_MODE ∈ {test, e2e, ci}`。

## 2. 配置来源优先级

```
1. explicit env（最高优先级）
2. env_file（compose / dotenv 加载）
3. mode default（按 §1 运行模式的安全默认值）
4. hard failure（生产必需变量缺失 → 启动失败）
```

### 规则

- **production 缺少必需变量必须 fail fast**：`JWT_SECRET`、`DATABASE_URL`、`CORS_ORIGIN` 缺失 → 进程退出，不 fallback。
- **test / e2e / ci 可以有安全测试默认值**：如 `JWT_SECRET=ci-test-secret`、`COOKIE_SECURE=false`。
- **禁止用 `NODE_ENV` 直接决定业务语义**：当前 `session.ts`、`security.ts`、`auth.ts` 用 `NODE_ENV` 分支 JWT gating/CSRF/CSP/cookieSecure——Phase C 将改为读 `APP_MODE`。
- **禁止配置项静默 fallback 到危险默认值**：如 `migrate.ts:5` 在 `DATABASE_URL` 缺失时 `process.exit(0)`（掩盖失败）——Phase C 改为 fail fast。

## 3. Docker Compose 变量传递规则

- compose 必须显式传入 `APP_MODE`（当前缺失，Phase E 补）。
- compose 必须显式传入 `DATABASE_URL`（当前已有）。
- API service 访问 postgres 时**必须用 compose 内 DNS**（`db:5432`），不能用宿主机 `localhost`。
- **不允许真实 secret 写入仓库**：当前 `.env:32` 的 `JWT_SECRET=K1/cnDJpi2...` 是硬编码 secret——Phase E 移除并加入 `.gitignore`。
- `.env.docker.example` 只能提供占位符或开发默认值（如 `JWT_SECRET=change-me`）。
- **Docker Compose 只负责运行环境装配，不承担业务逻辑**：compose 不定义 feature flag、不改状态机。

### 当前 compose 文件清单

| 文件 | 用途 | 需修复项 |
|---|---|---|
| `docker-compose.yml` | 生产部署 | 缺 `APP_MODE: production`；`JWT_SECRET` 无默认需 env |
| `docker-compose.dev.yml` | 开发 + e2e | 缺 `APP_MODE: development`；e2e service 已加（profile） |
| `docker-compose.test.yml` | 测试 DB | 仅 DB service，OK |

## 4. API config schema 草案

```ts
export type AppMode = "development" | "test" | "e2e" | "ci" | "production";

export interface ApiConfig {
  app: {
    mode: AppMode;
    isProduction: boolean;
    isTestLike: boolean;
  };
  server: {
    port: number;
    host: string;
  };
  database: {
    url: string;
  };
  auth: {
    jwtSecret: string;
    cookieSecret: string;
    cookieSecure: boolean;
  };
  cors: {
    origin: string | string[] | boolean;
  };
  features: {
    restoreFrontend: boolean;
    manualExamOpenClose: boolean;
    liveScoreList: boolean;
  };
  heartbeat: {
    scanIntervalMs: number;
    timeoutMs: number;
  };
}
```

### 实现要点

- 使用项目已有的 zod 做 schema 校验（`packages/contracts` 已用 zod）。
- `APP_MODE` 非法 → fail fast（不在枚举内则启动失败）。
- boolean env 统一解析（`"true"/"1"` → true，其余 false），禁止散落 `=== "true"`。
- port 支持 string → number（`z.coerce.number()`）。
- production 模式下 `jwtSecret` 为默认值 `"development-only-change-me"` → fail fast。
- `heartbeat.scanIntervalMs` / `timeoutMs` 从 `runtimeConfig` 归口（当前 `heartbeat.ts` 自己读 env，Phase D 统一）。
- **不改变 heartbeat scanner 当前默认行为**（30s/60s），只做配置归口。

## 5. Web config schema 草案

```ts
export interface WebConfig {
  app: {
    mode: AppMode;
  };
  api: {
    basePath: string; // 默认 "/api"
  };
  features: {
    restoreFrontend: boolean;
    manualExamOpenClose: boolean;
    liveScoreList: boolean;
  };
}
```

### 要求

- `VITE_API_BASE_PATH` 默认 `/api`（当前 `api.ts:8` 读 `VITE_API_BASE_URL` 默认 `""`，即同源——保持不变，不改成绝对 URL）。
- `VITE_APP_MODE` 对齐 `APP_MODE`（当前未实现，Phase F 补）。
- 可预留 `VITE_FEATURE_*`，默认全部 false。
- **不改变当前 API client 行为**：当前 `api.ts` 用相对路径 `/api` + cookie credentials，正确，Phase F 只做变量归口。

## 6. Test / E2E 数据库隔离策略

| 场景 | 数据库 | 来源 | seed 策略 |
|---|---|---|---|
| API unit/integration test | `exam_test` | `TEST_DATABASE_URL`（testHelpers.ts:99） | 每个测试文件 `buildTestApp` 重新 migrate + seed，串行隔离 |
| E2E | `exam_test`（与 test 共享） | `TEST_DATABASE_URL` | admin API seed 唯一 course/exam/candidate（timestamp 唯一化），`workers:1` 避免并发污染 |
| CI | CI service container 的 `exam_test` | `TEST_DATABASE_URL`（ci.yml:38-39） | 同 API test |
| production | 部署 PG | `DATABASE_URL` | 无测试 seed |

### 隔离保证

- **不允许 `TEST_DATABASE_URL` 指向生产库**：Phase C 在 config loader 中加 guard（test 模式下 `DATABASE_URL` 若含生产库名 → 警告）。
- 并行测试隔离：当前 `vitest` 各测试文件独立 `buildTestApp`（独立 DB 连接 + migrate + seed），turbo 串行跑 package。E2E `workers:1` + 唯一化数据。
- seed 幂等：`seed.ts` 用 `onConflictDoUpdate`（user/org），e2e seed 用 timestamp 唯一化（不依赖清理）。

## 7. Feature flags 边界

| Flag | 默认 | 含义 | 实现状态 |
|---|---|---|---|
| `restoreFrontend` | `false` | 前端 restore UI（disrupted → in_progress 恢复入口） | 后端 `/restore` 已有，前端 Phase 2 接入 |
| `manualExamOpenClose` | `false` | admin 手动 open/close 考试按钮 | Phase 2C |
| `liveScoreList` | `false` | 考试进行中实时开放成绩列表 | Phase 2 |

### 规则

- 默认 `false`，不改变 Phase 1 行为。
- **不允许因为 flag 存在就实现对应功能**：flag 只表达"未来能力开关"，不是当前功能完成证明。
- Phase C-G 只定义 flag 字段 + 读取，不接线 UI。

## 8. 禁止规则

1. 禁止在业务代码里散落读取 `process.env`（统一经 config loader）。
2. 禁止用 `NODE_ENV` 直接决定业务语义（改用 `APP_MODE`）。
3. 禁止 `docker-compose.yml` 承担业务逻辑。
4. 禁止生产环境使用默认 secret（`JWT_SECRET` 为默认值 → fail fast）。
5. 禁止 test / e2e 共用生产数据库。
6. 禁止配置项静默 fallback 到危险默认值（如 migrate 缺 DB url exit 0）。
7. **禁止 Config Baseline 任务修改考试生命周期语义**。

## 第一轮输出

### 配置扫描表

见 §扫描结果（explore 子代理产出），关键风险：

| 风险 | 当前位置 | 严重度 |
|---|---|---|
| 硬编码 JWT_SECRET 提交仓库 | `.env:32` | 高——secret 泄露 |
| NODE_ENV 驱动业务语义 | `session.ts:10`、`security.ts:46/96`、`auth.ts:165` | 高——违反 §2 |
| 散落 process.env 读取（11+ 文件） | cors/security/auth/heartbeat/session/database/testDb/drizzle/migrate/seed | 中——config loader 未覆盖 |
| docs/config.md 声明的变量未实现 | APP_MODE/COOKIE_SECRET/VITE_API_BASE_PATH/VITE_APP_MODE/E2E_DATABASE_URL/PORT | 中——spec/code drift |
| migrate.ts 缺 DB url 静默 exit 0 | `migrate.ts:5` | 中——掩盖失败 |
| 3 个 origin 变量无单一 owner | CORS_ORIGIN + ALLOWED_ORIGINS + APP_ORIGIN | 低——可收敛 |

### 新的运行模式定义

见 §1。

### 实现计划（按小步 commit 拆分）

1. **Phase C-1**：扩展 `runtimeConfig.ts` → 完整 `ApiConfig`（加 app.mode/server/database/auth/cors/features/heartbeat）；用 zod 校验；写 config loader 测试。
2. **Phase C-2**：`migrate.ts` 缺 DB url 改 fail fast（不再 exit 0）。
3. **Phase D-1**：替换 `session.ts` JWT_SECRET 读取（经 config，prod fail fast）。
4. **Phase D-2**：替换 `auth.ts`/`security.ts` 的 COOKIE_SECURE 读取（经 config，去散落 `=== "true"`）。
5. **Phase D-3**：替换 `cors.ts` CORS_ORIGIN 读取（经 config）。
6. **Phase D-4**：替换 `heartbeat.ts` interval/timeout 读取（经 config，不改默认行为）。
7. **Phase E-1**：移除 `.env` 硬编码 JWT_SECRET，加 `.gitignore`；更新 `.env.example`。
8. **Phase E-2**：compose 文件补 `APP_MODE`。
9. **Phase F**：web `VITE_APP_MODE`/`VITE_API_BASE_PATH` 归口（最小，不改 client 行为）。
10. **Phase G**：config loader 测试 + 回归测试。

### 高风险点

1. `.env` 移除 JWT_SECRET 可能影响依赖它的本地开发——需确保 `.env.example` 提供开发默认值，dev compose 已有 fallback。
2. `NODE_ENV` → `APP_MODE` 迁移需保证 fallback 正确（未设 APP_MODE 时按 NODE_ENV 推断），避免破坏现有部署。
3. `session.ts` 的 JWT gating 改动若出错会影响所有认证——必须配测试。

### 本轮是否修改代码

**没有**。本轮只新增/修改文档（本文件）。
