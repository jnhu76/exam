# Code Quality Gate

> 代码质量与边界执行契约。本文按“真实执行层”描述每条规则；只有标注为可执行仓库门禁（A）的条目才是 Job 的完成条件。

---

## 1. Quality Goals

代码质量目标。本文用四类标签标注每条规则的**真实执行层**，不把目标当成已执行门禁：

- **(A) 可执行仓库门禁** — 由 `package.json` 脚本或 CI 实际执行，失败即 RED。
- **(B) 部分静态/文本检查** — 有脚本执行，但只覆盖声明的有限形状，不能外推为完整保证。
- **(C) 人工评审规则** — 由 code review / ADR 把关，没有机器执行点。
- **(D) 未实现的治理目标** — 目前没有任何执行点，不得表述为已生效。

目标：

1. 类型安全 — strict TypeScript（A：`pnpm typecheck`，选项见 §3）；禁止 `any` 是评审规则（C），没有全仓执行器（D）。
2. 代码风格统一 — Prettier（A：`pnpm format:check`）；ESLint 仅覆盖 `apps/web` 视觉规则（A，见 §4），不是全仓 lint。
3. 架构边界清晰 — `pnpm lint:arch` 执行命名的边界禁令（B，见 §6.2）；“依赖方向正确 / 无循环依赖”目前没有机器检查（D）。
4. 没有裸 db 查询绕过 repository — route 层有文本禁令（B，见 §6.2/§7），repository 语义由评审把关（C）。
5. 没有 route 直接写复杂业务逻辑（C）
6. 没有重复定义核心 DTO（C）
7. 没有跳过测试（C）
8. 没有临时 mock 混进正式代码（C）
9. 没有 console.log 乱飞 — `pnpm lint` 只做 `console.log` / `console.error` 文本扫描（B，见 §4）。
10. AI 生成代码必须可 review、可验证、可回滚（C）
11. 产品文案配置驱动 — i18n copy policy 是评审规则（C）；机器 guard 已由 #634 移除（见 `docs/standards/i18n-copy-policy.md`）。

---

## 2. Tooling

工具接线的唯一权威是根 `package.json` scripts 与 `.github/workflows/*`；下表回答“每个执行点实际做什么”，不复制脚本快照：

| Tool / script                                                                 | 实际作用                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Prettier（`pnpm format:check`）                                               | 格式化检查（仓库使用 Prettier 默认配置）                                                                     |
| `pnpm lint`（`scripts/check-code-quality.mjs`）                               | 对 apps+packages 做 `console.log` / `console.error` 文本扫描                                                 |
| `pnpm lint:arch`（`scripts/check-architecture.mjs`）                          | 命名的边界禁令 + #794 workspace resolution 契约（清单见 §6.2）                                               |
| `pnpm lint:eslint`（仅 `apps/web`）                                           | `exam-ui/*` 视觉规则（业务 9 条、layout 8 条）+ 不执行任何检查的兼容 no-op stub（见 §4）                     |
| `pnpm lint:db-config`（`scripts/check-db-config.mjs`）                        | DB URL 单源、测试运行时模式、hook 超时预算等回归守护                                                         |
| `pnpm lint:db-journal`（`scripts/db/check-postgres-migration-journal.mjs`）   | Drizzle migration journal 结构、单调性与文件一致性                                                           |
| `pnpm lint:env-contract`（`scripts/repository-contract/config-contract.mjs`） | settings 语义模型 ↔ 各拓扑（compose/CI/WSL）绑定关系                                                         |
| `pnpm lint:env-surface`（`scripts/check-env-surface.mjs`）                    | env 文件物理表面、根文件 allowlist 与 reader allowlist                                                       |
| `pnpm lint:prod-resolution`（`scripts/check-production-resolution.mjs`）      | 生产 artifact 解析 oracle（在 `pnpm verify` 内运行）                                                         |
| `pnpm lint:deploy-payload`（`scripts/check-deploy-payload.mjs`）              | 部署 payload 内容 oracle（CI 以 payload 目录参数调用）                                                       |
| `pnpm typecheck`（turbo → `tsc`）                                             | 各 workspace strict typecheck（见 §3）                                                                       |
| Vitest / `@vitest/coverage-v8`                                                | 单元 / 集成测试与覆盖率（`pnpm test`、`pnpm coverage`）                                                      |
| Playwright（`pnpm e2e`、`pnpm smoke`）                                        | 浏览器 E2E / 冒烟                                                                                            |
| Husky + lint-staged + commitlint                                              | Git hooks（见 §14）                                                                                          |
| turbo                                                                         | monorepo task runner                                                                                         |
| pnpm                                                                          | package manager                                                                                              |

---

## 3. TypeScript Strict Mode

`tsconfig.base.json` 启用以下严格性选项（该文件还包含其他编译选项）；`pnpm typecheck` 经 turbo 对每个 workspace 的 `typecheck` script 执行 TypeScript（可执行仓库门禁，A）：

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true
  }
}
```

事实说明：`apps/e2e` 只有 `tsconfig.json`、没有 `tsconfig.typecheck.json`，其 `typecheck` 按 `exports` 的 `types` 条件解析到生产 dist typings——这是设计选择（见 workspace 模块解析契约），不是缺失配置。

### 禁止（评审规则）

- 随意使用 `any` — 无全仓执行器（D）；`apps/web` 的 `@typescript-eslint/no-explicit-any` 是 no-op stub（§4）
- 用 `as any` 绕过类型（C）
- 用 `unknown` 后不做 schema 校验（C）
- route body 不校验直接使用（C）
- API response 没有类型（C）

### 允许例外

- 第三方库类型缺失时可以局部使用 `unknown`，但必须用注释解释原因
- 不允许全局关闭 strict

---

## 4. ESLint Rules

### 实际执行的 ESLint（仅 `apps/web` 视觉规则）

仓库唯一的 ESLint 配置是 `apps/web/eslint.config.ts`，由 `pnpm lint:eslint`（`pnpm --filter @exam/web lint:eslint`）执行。它只包含本地 `exam-ui/*` 视觉权威规则，不是通用 linter：

- 业务/功能源码 9 条：`prefer-inline-error-banner`、`no-business-shadow`、`no-arbitrary-typography`、`no-arbitrary-inline-typography`、`no-typography-authority-conflict`、`no-heavy-font-weight`、`no-recipe-recomposition`、`no-dialog-spatial-override`、`no-arbitrary-filter-width`；
- `components/layout` 子集 8 条（不含 `no-business-shadow`：topbar/sidebar 拥有有意的 sticky elevation）；
- `src/components/ui/**`（生成的 shadcn primitive）、`src/lint/**` 与测试文件不参与 lint。

兼容层（保留，不是遗漏）：配置为历史源码里既有的 `eslint-disable` 指令注册了 `react-hooks/exhaustive-deps` 与 `@typescript-eslint/no-explicit-any` 的 **no-op 规则**——它们不执行任何检查，只让旧指令可解析；单独删除会让 `pnpm lint:eslint` 失败。用途见 `apps/web/eslint.config.ts` 头注释。

`apps/api`、`apps/e2e`、`packages/*` 没有 ESLint 配置，`pnpm lint:eslint` 不会检查它们。

### 声明的规则与真实执行层

以下规则没有对应的机器执行（除注明外），不得写成“必须通过的门禁”：

| 规则                                                                                               | 分类              | 真实执行点                                                                                                |
| -------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `console.log` / `console.error`                                                                    | (B) 部分文本检查  | `pnpm lint`（`scripts/check-code-quality.mjs`）只扫描 apps+packages 的这两类调用；不覆盖其他 console 形态 |
| 分 package 的 `console.warn/error` 等级与结构化日志要求                                            | (C) 评审规则      | code review；日志契约见 §10                                                                               |
| `no-explicit-any` / 禁止 `as any`                                                                  | (D) 未实现        | 无 ESLint 执行；`apps/web` 只有 no-op stub；`any` 清理属评审（§3、§16）                                   |
| `no-floating-promises`、`consistent-type-imports`、`no-unused-vars`、`switch-exhaustiveness-check` | (D) 未实现        | 无执行点                                                                                                  |
| `import/no-cycle`、全仓循环依赖检测                                                                | (D) 未实现        | 无执行点；`pnpm lint:arch` 不做循环检测（§6.2）                                                           |
| `max-lines-per-function: 80`、`complexity: 12`、`max-depth: 4`                                     | (D) 未实现        | 未配置任何执行器。真实的评审规则是：单文件超过 2000 行触发结构审查（`AGENTS.md` §3），不触发机械拆分      |

需要新增执行点时按正常变更流程立项，并同步更新本节；不在文档里虚构门禁。

---

## 4.1 Hardcoded Business Copy Guard

产品需要适配不同机构和考试类型，因此生产代码不得硬编码具体业务场景。

### 禁止出现在生产代码中的默认文案

```text
校内 / 校园 / 大学 / 学生 / 学号 / 工号 / 实验室 / 化学 / 物理 / 数学
University / campus / student
```

### 允许出现的位置

- `docs/**` 文档示例；
- `*.test.ts` / `*.spec.ts` 测试；
- `*.stories.tsx` 组件示例；
- `seed/demo/**` 明确标记为 demo 的种子数据。

### 生产实现要求

- 登录页标题、侧栏产品名、考生端页头、页脚、机构显示名必须从 `OrganizationSettings` / `BrandingView` 读取。
- 考试名称必须来自 `Exam.title`。
- 考生身份列必须来自 `CandidateField`，不能假设一定存在"学号"或"工号"。
- 示例数据不得进入正式 fallback 文案。

本规则由 code review 依据 [`AGENTS.md`](../../AGENTS.md) §1 与
[`docs/standards/i18n-copy-policy.md`](i18n-copy-policy.md) 把关；
生产源码中的用户可见中文遵循 i18n copy policy（`t()` + zh-CN catalog）。

---

## 5. Prettier

仓库不维护 Prettier 配置文件（使用 Prettier 默认风格）；CI 与 `verify:static` 通过以下命令检查：

```bash
pnpm format:check
```

---

## 6. Architecture Boundaries

### 6.1 Current declared dependencies（as-built 证据，非批准）

以下 workspace 运行时边来自各 workspace `package.json` 的 `dependencies`（基线 `1bd8602`）：

```text
@exam/api            → @exam/auth @exam/authz @exam/contracts @exam/db @exam/domain @exam/exam-engine @exam/import-export
@exam/web            → @exam/authz @exam/contracts @exam/domain
@exam/auth           → @exam/contracts @exam/domain
@exam/authz          → @exam/domain
@exam/contracts      → @exam/domain
@exam/db             → @exam/domain
@exam/exam-engine    → @exam/authz @exam/contracts @exam/domain
@exam/import-export  → (no internal dependency)
@exam/domain         → (leaf)
```

仅 `devDependencies` 的 workspace 边（不是运行时依赖）：`@exam/e2e` → `@exam/contracts` / `@exam/domain`、`@exam/db` → `@exam/auth`（测试见证 session/token）、`@exam/source-fixture` → `@exam/source-fixture-dep`，以及 `apps/api`、`apps/web` 与除 fixture 包外的每个 `packages/*` → `@exam/source-fixture`（Vitest 解析 oracle fixture）。

声明不等于实际使用：例如 `@exam/auth` 声明了 `@exam/contracts`，但基线提交的非测试源码中未观察到对应 import。此表只记录 manifest 声明，不证明每条边在运行期被使用，也不构成“允许新增依赖”的白名单。

### 6.2 Existing machine-enforced boundary bans

`pnpm lint:arch`（`scripts/check-architecture.mjs`）只执行**命名的文本/结构禁令**，每一条针对具体失败模式：

- `packages/domain/src` 是叶子：禁止 import `fastify` / `react` / `drizzle-orm` / 其他 `@exam/*`；
- `packages/authz/src`：禁止 `fastify` / `react` / `drizzle-orm`，且只允许 `@exam/domain`（禁止其他 `@exam/*` 子路径）；
- `packages/contracts/src`：禁止 `fastify`；
- `packages/auth/src`：禁止读取 `process.env`；
- `apps/api/src` 与 `packages/db/src`：禁止直接读取 `process.env.APP_MODE` / `NODE_ENV`（运行时模式只能经 `@exam/db` 的 `parseAppMode` 解析）；
- `packages/db/src`：禁止引入或调用 `dotenv`（env 文件 admission 归入口点）；
- `packages/exam-engine/src`：禁止 `fastify`；禁止 `as LockedEnrollmentAttemptIdentity` / `as ReconciledAttemptMutationContext` 伪造 capability；
- `apps/api/src`：禁止上述两种 capability cast；
- `apps/web/src`：禁止 import `@exam/db`；
- `apps/api/src/routes`：禁止裸 `db.select|insert|update|delete`、禁止 import `drizzle-orm`、禁止 import `@exam/db/schema`；
- #794 workspace resolution 契约：manifest 表校验（`config/workspace-resolution.mjs`）、禁止 `@exam/*/src/` 物理路径与跨 package 相对 import、每个 vitest config 必须消费共享 resolution plugin、resolution oracle 存在性（fixture marker、dot-segment grammar probe、fail-closed 分类）、该 gate 覆盖的每个 typecheck 入口（apps/api、apps/web、packages/*）必须有带 `TEST_SOURCE_CONDITION` 的 `tsconfig.typecheck.json`。

**真实不覆盖**（不得外推）：没有 package 依赖 allow-list、没有循环依赖检测、没有 manifest ↔ 实际 import 一致性检查。上述禁令是文本形状检查，动态 `import()` / `require()` / `vi.mock()`、别名/解构读取，以及 `@exam/*` 根导入（例如 authz 的子路径禁令不覆盖 `from "@exam/db"`）都可能逃逸。因此“新增这条依赖是否被允许”**不是机器回答的问题**。

### 6.3 Review-enforced architecture policy

以下方向规则是真实架构策略，但由评审/ADR 执行，不是机器门禁：

- `packages/domain` 是领域叶子，不得依赖 Fastify / React / Drizzle 或其他内部 package（机器只覆盖部分 import 形状）；
- `packages/contracts`、`packages/exam-engine` 不依赖 Fastify；
- `fastify` 只出现在 `apps/api`；
- `packages` 不反向依赖 `apps`（例如 `packages/db` → `apps/api`）；
- `apps/web` 不直接依赖数据库或服务端 package（机器只挡住 `@exam/db` 这一条 import）；
- 业务数据访问经 repository 并显式接收 `RequestContext`，route 不写复杂业务逻辑；
- 领域类型来自 `@exam/domain`，API 输入/输出 DTO 来自 `@exam/contracts`。

### 6.4 新增跨 package 依赖

新增跨 package 依赖是设计变更，须走正常评审/ADR 权威；§6.1 的 as-built 表不是预批准。

### Enrollment ↔ Attempt Lock Order

AttemptId-rooted dual-lock transactions use `lockEnrollmentAndAttempt`
(`packages/exam-engine/src/lockSeam.ts`). The returned witness
(`LockedEnrollmentAttemptIdentity`) represents:

- canonical E-before-A acquisition provenance
- Enrollment / Attempt identity binding
- affinity to the exact tx-bound repo pair used at mint time

`finalizeTerminalGrading` asserts repo affinity (`assertCapabilityFor`)
before repository operations. The Enrollment `UPDATE` remains a
lock-acquiring operation and is protected by the current-transaction EA
protocol (removing the explicit Enrollment `FOR UPDATE` does NOT remove the
Enrollment lock dependency).

The 8 attemptId-rooted AE production entry points recorded by `AE_ENTRY_POINTS`
in `apps/api/src/runtime/lock-order.structural.test.ts` (submitAndGradeAttempt,
candidate take/save/restore, admin force-submit, admin time-grant, deadline
autoSubmitAndGrade, manual gradeQuestion route) each mint via the seam and
thread the SAME repo pair + capability from mint to terminal consumer.
`startOrRestoreAttempt` keeps its natural Enrollment→Attempt order as the
explicit EA exception.

**Runtime repo-affinity assertion is the correctness boundary.** Static
lint rules (`pnpm lint:arch` + the structural test
`apps/api/src/runtime/lock-order.structural.test.ts`) are guardrails, NOT a
TypeScript lifetime proof. They do NOT claim that:

- TypeScript proves transaction lifetime
- AST proves arbitrary capability escape impossible
- `assertCapabilityFor` alone proves the transaction session is live

Cross-transaction / expired-witness safety relies on the consume-time
`assertCapabilityFor` reference-identity check, which rejects any capability
minted against a different repo pair. NOTE (empirically characterized by
`apps/api/tests/concurrency/ea-lock-order.test.ts`): the tx-bound repository
does NOT reject use after its transaction ends — a post-end write executes in
autocommit on the pooled connection and lands durably. Safety must not be
argued from driver-level post-end rejection; hardening the capability
boundary is tracked in #720.

---

## 7. Repository Guard

Route handler 不允许直接访问 db。所有业务数据访问必须走 repository。

### 规则

- 所有 repository 方法必须接收 `RequestContext`
- 所有业务查询必须带 `organizationId`
- Phase 1 的 `organizationId` 来自 internal default organization
- HTTP surface 归属由 Fastify 路由/插件 scope 决定(见 `docs/adr/ADR-020-http-surface-routing-authority.md`);`organizationId` 来自 `RequestContext`,不通过路径解析判定
- SuperAdmin 跨租户操作只属于 Phase 4 optional multiTenant，不能作为 Phase 1 当前产品路径要求

### 禁止

```ts
await db.select().from(questions);
```

### 允许

```ts
await questionRepo.list(ctx, filters);
```

---

## 8. Route Handler Complexity

Fastify route handler 只允许做：

1. 读取 request
2. Schema 校验（Zod from `@exam/contracts`）
3. 生成 RequestContext
4. 调用 command / service / repo
5. 返回 response

### 禁止在 route 里做

- 复杂状态机判断
- 复杂批改逻辑
- 直接写多表事务
- 手写权限分支
- 直接操作 questionSnapshot
- 直接操作 answer version conflict

复杂逻辑必须进入：`packages/exam-engine` / `packages/auth` / `packages/db` / `packages/domain`。

---

## 9. Error Handling

### Domain Error Types

`packages/domain/src/errors.ts` 定义：

```
AppError                    — base domain error
PermissionDeniedError       — 403
TenantAccessDeniedError     — 403 cross-tenant（legacy/future domain type；Phase 1 不作为当前产品路径）
ValidationError             — 400
NotFoundError               — 404
InvalidStateTransitionError — 409 state machine
AttemptAlreadyStartedError  — 409
AttemptClosedError          — 409
AnswerVersionConflictError  — 409 stale version
ExamNotOpenError            — 409
AttemptDeadlineExceededError — 409 (was ExamTimeExpiredError)
```

### Fastify Error Handler

domain error → stable HTTP response（映射到对应 status code）
unknown error → 500 + requestId

### 统一错误响应

```ts
{
  error: {
    code: string;
    message: string;
    requestId: string;
  }
}
```

### Startup configuration errors

See `docs/SPEC.md` and `docs/roadmap/phase-roadmap.md` for the authoritative startup-configuration policy.

Startup configuration validation is intentionally outside the domain/runtime HTTP error hierarchy.

Errors thrown while building runtime configuration, validating deployment mode, or checking required production secrets MUST fail fast with a standard `Error`.

Do not use `ValidationError`, `NotFoundError`, `InvalidStateTransitionError`, or other domain errors for startup configuration failures.

Do not add configuration/bootstrap errors to `packages/domain/src/errors.ts`.

Rationale:

- startup configuration failures are not user-input validation errors
- they are not expected to be serialized as HTTP responses
- they happen before normal request handling
- keeping them as plain `Error` avoids coupling infrastructure/bootstrap code to domain error types

Examples:

- invalid `APP_MODE`
- invalid `DEPLOYMENT_MODE`
- missing production `DATABASE_URL`
- missing production `JWT_SECRET`
- missing production `CORS_ORIGIN`

### 禁止

- 到处 `throw new Error("xxx")` — 必须使用 domain error types（startup config 失败除外）
- 直接把数据库错误暴露给前端
- API response 错误格式不统一
- 用 `ValidationError` 表示 startup 配置缺失或部署模式错误
- 在 `packages/domain/src/errors.ts` 中新增 `ConfigurationError` 或类似启动配置错误类型

---

## 10. Logging

Fastify 使用 pino 结构化日志。

### 日志必须包含

```
requestId, actorId, organizationId, route, action, targetId, durationMs
```

### 考试答案保存日志只记录

```
attemptId, questionId, serverVersion, save result, durationMs
```

### 禁止记录

- 密码
- 完整 token
- 完整标准答案
- 完整身份证号 / 手机号等敏感身份字段
- 完整 answer 内容（除非 debug 模式且本地开发）

### E2E artifacts

E2E 失败诊断的实际产物由 `.github/workflows/ci.yml` 的 e2e job 与 `apps/e2e/playwright.config.ts` 决定（本节不复制 CI 快照）：

- Playwright 默认 `trace: "off"`、`video: "off"`、`screenshot: "only-on-failure"`；trace 仅在 `E2E_TRACE=1` 时启用（`retain-on-failure`），CI 只在 production-transport regression job 设置该变量；
- e2e job 失败时上传 `e2e-failure-diagnostics-*`：`server.log`（含 tail）、失败用例的 `error-context.md` 与 `*.png`，retention 1 天；成功时删除本地 blob report zip，blob report 与 trace 均不上传。

E2E 服务端日志应保留 `requestId`，便于把失败的浏览器步骤对应到 API 日志。

---

## 11. Environment Variable Validation

环境变量契约（名称、默认值、优先级、set-but-empty 语义、env 文件表面与数据库生命周期）的唯一权威是 [`docs/standards/testing.md` §2](testing.md#2-environment-variable-contract)，测试数据库生命周期见 §2.8；本文不维护第二份清单。

实现入口（代码即权威）：

- 语义设置模型与默认值：`apps/api/src/config/settings.ts`；
- 运行时 facade 与跨字段策略、启动 fail fast：`apps/api/src/config/runtimeConfig.ts`；
- env 文件 admission 与支持集合：`config/envFilePolicy.ts` + `apps/api/src/config/loadRootEnv.ts`；
- DB URL 解析：`packages/db/src/databaseUrl.ts`；
- 机器校验：`pnpm lint:env-contract`（settings 模型 ↔ 各拓扑绑定）与 `pnpm lint:env-surface`（env 文件表面）。

---

## 12. Database Migration

### 数据库说明

- PostgreSQL 是唯一受支持的数据库。
- repository 和 service 代码必须保持数据库无关。
- Phase 1 发布前必须在 PostgreSQL 上运行 migration、integration test 和 smoke test。

规则：

1. Schema 修改必须生成 migration
2. Migration 文件不能手动乱改，除非有说明
3. 不允许生产环境自动 drop table
4. 不允许随意清空业务数据
5. Seed 只用于 dev/test，不用于生产覆盖数据
6. 所有 migration 必须在 CI/test db 上跑过

涉及 DB 的 Job 必须运行：

```bash
pnpm db:generate
pnpm db:migrate
pnpm test:integration
```

---

## 13. Dependency Management

规则：

1. 不随意引入大依赖
2. 新依赖必须说明用途
3. UI 小功能优先自己实现，不引入整套库
4. 后端安全相关库必须成熟稳定
5. 定期运行 `pnpm audit`
6. Lockfile 必须提交

命令：

```bash
pnpm audit
```

---

## 13.5. Testing Strategy

### E2E acceptance

E2E 保持为 blocking CI 门禁；最小路径（candidate happy path、resume attempt、submit flush）、分片拓扑与本地入口以 [`docs/standards/testing.md`](testing.md) §4/§6 和 `.github/workflows/ci.yml` 为准，本地唯一入口是 `pnpm e2e`（`bash scripts/e2e/run.sh`）。失败诊断产物见 §10 的 E2E artifacts。

### API Route 测试（apps/api）

API route 测试使用**真实 PostgreSQL**，不是内存数据库：默认按测试文件 schema 隔离，canonical 证据 lane 使用 worker-database 隔离。命令、隔离模式、环境变量与数据库生命周期以 [`testing.md` §5.2](testing.md#52-api-integration-tests) 和 [`testing.md` §2.8](testing.md#28-test-database-lifecycle-ownership) 为唯一权威，本节不复制。

不变量：应用运行时经 `apps/api/src/plugins/db.ts` 注册 `fastify.db` 装饰器；route handler 通过 `fastify.db` 访问数据库，不自行创建连接。测试应用通过 `apps/api/src/routes/testHelpers.ts` 的 `buildTestApp()` 构建，每个上下文独立创建、零共享状态（`testHelpers.ts` 与 seed/verify 脚本是 `createDatabase()` 的受控例外）。

---

## 14. Pre-commit / Pre-push Hooks

Husky 钩子的唯一权威是 `.husky/` 目录（`package.json` 的 `prepare` 脚本安装）。本节只记录钩子职责，不复制命令快照——以钩子文件为准：

- `pre-commit`：`lint-staged`（对 staged 文件跑 Prettier）+ `pnpm lint:arch`；
- `pre-push`：`pnpm typecheck` + `pnpm --filter @exam/api api:openapi:check`（OpenAPI drift 检查）；
- `commit-msg`：commitlint（Conventional Commits）。

---

## 15. CI Quality Gate

CI job 拓扑、命令与 env 接线的唯一权威是 `.github/workflows/ci.yml`，本文档不维护它的副本。需要记住的约束只有三条：

- `static` 必须先通过，其余 job 才开跑；
- 本地等价入口是 `pnpm verify`（可执行组成以根 `package.json` 为准）与 `pnpm e2e`（host-native runner）；冒烟门是 `pnpm smoke`；
- PR 不通过 CI，不允许合并。

---

## 16. Code Quality Review Checklist

每个 Job 的 Review Checklist 必须包含以下代码质量项：

1. 是否有重复 DTO？（应该从 `@exam/domain` 或 `@exam/contracts` 导入）
2. 是否有 `any` / `as any`？
3. Route 是否直接访问 db？
4. Route 是否包含复杂业务逻辑？
5. Repository 是否接收 RequestContext？
6. 查询是否带 organizationId？
7. 状态变更是否通过 command function？
8. 答案保存是否幂等？
9. 错误是否使用统一 domain error type？
10. 是否写入必要 AuditLog？
11. 是否有测试？
12. 覆盖率是否达标？
13. 是否有 console.log？
14. 是否引入了不必要依赖？
15. 是否存在硬编码业务场景文案？
16. 是否运行了与变更风险匹配的门禁，并如实记录未运行项？

---

## 17. AI Coding Rules

1. 不允许一次性修改无关文件
2. 每个 Job 只改该 Job 范围内的文件
3. 不允许绕过测试
4. 不允许删除测试来通过 CI
5. 不允许用 `any` 消灭类型错误
6. 不允许用 TODO 代替核心逻辑
7. 不允许把 mock 数据写进生产逻辑
8. 不允许未经说明新增依赖
9. 不允许把业务逻辑写进 React component
10. 不允许把考试状态机写进 route handler

### 17.1 Permanent Semantic Naming

永久标识符与文件名必须描述当前领域/技术职责，不得以临时阶段、审计编号或
活动代号命名（如 `Phase A`、`D2`、`I5`、`P3-FORMAL-P0-D2`、`Wave 1`）。
命名回答 "这个东西现在做什么"，而不是 "哪次审计发现了它"。

- 函数、参数、常量、类型、fixture、测试标题、文件名一律语义命名。
- 历史/追溯引用（Issue、PR、audit）可以留在注释中，但不得作为行为的主名称。
- 豁免：wire/公共字段、持久化枚举值、数据库 migration 顺序号、HTTP 状态码、
  环境变量、外部协议标识符、语义化版本类型（如 `ContentDocumentV1`）、
  HTML `h3` 等。

### 每个 Job 完成后必须输出

1. 修改了哪些文件及其语义影响
2. 新增或更新了哪些测试/characterization evidence
3. 实际执行的命令和结果
4. 未执行或不适用的门禁及原因
5. 已知限制与剩余风险

---

## 18. Verify Commands

可执行命令的唯一权威是根 `package.json` 的 `scripts`（CI 接线为 `.github/workflows/*`）；本文档不复制脚本快照，避免出现第二份 package.json。需要命令时直接读 `package.json`：常用入口是 `pnpm verify`、`pnpm verify:static`、`pnpm test`、`pnpm test:integration`、`pnpm e2e`、`pnpm smoke`。

### 按 Job 类型额外运行

| Job 类型             | 额外命令                                                       |
| -------------------- | -------------------------------------------------------------- |
| 涉及数据库           | `pnpm db:generate && pnpm db:migrate && pnpm test:integration` |
| 涉及 E2E / UI 主流程 | `pnpm e2e`                                                     |
| Phase 1 完成         | `pnpm smoke`                                                   |
