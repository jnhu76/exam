# Code Quality Gate

> Phase 1 代码质量规范。所有 Job 必须通过这些门禁才能算完成。

---

## 1. Quality Goals

Phase 1 代码质量目标：

1. 类型安全 — strict TypeScript，无 any
2. 代码风格统一 — Prettier + ESLint
3. 架构边界清晰 — 依赖方向正确，无循环依赖
4. 没有裸 db 查询绕过 repository
5. 没有 route 直接写复杂业务逻辑
6. 没有重复定义核心 DTO
7. 没有跳过测试
8. 没有临时 mock 混进正式代码
9. 没有 console.log 乱飞
10. AI 生成代码必须可 review、可验证、可回滚
11. 产品文案配置驱动 — 不把具体学校、课程、考试场景写死进生产代码

---

## 2. Tooling

| Tool                       | Purpose                    |
| -------------------------- | -------------------------- |
| Prettier                   | Formatter                  |
| ESLint + typescript-eslint | Lint                       |
| TypeScript strict mode     | Type safety                |
| Vitest                     | Unit/integration test      |
| Vitest coverage v8         | Coverage                   |
| Playwright                 | E2E/smoke test             |
| Husky                     | Git hooks                  |
| turbo                      | Monorepo runner            |
| dependency-cruiser         | Architecture boundary lint |
| check-db-config.mjs        | DB/test config consistency lint |
| config-contract.mjs        | Semantic-settings topology binding gate |
| pnpm                       | Package manager            |

---

## 3. TypeScript Strict Mode

`tsconfig.base.json` 必须包含：

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

### 禁止

- 随意使用 `any`
- 用 `as any` 绕过类型
- 用 `unknown` 后不做 schema 校验
- route body 不校验直接使用
- API response 没有类型

### 允许例外

- 第三方库类型缺失时可以局部使用 `unknown`，但必须用注释解释原因
- 不允许全局关闭 strict

---

## 4. ESLint Rules

必须启用：

```
@typescript-eslint/no-explicit-any          — 禁止 any
@typescript-eslint/no-floating-promises     — 禁止未 await 的 Promise
@typescript-eslint/consistent-type-imports  — 统一 type import
@typescript-eslint/no-unused-vars           — 清理未使用变量
@typescript-eslint/switch-exhaustiveness-check — switch 穷尽检查
import/no-cycle                             — 禁止循环依赖
no-console                                  — 禁止 console.log
```

### no-console 分级

| Package              | console.log         | console.warn/error |
| -------------------- | ------------------- | ------------------ |
| apps/api             | 禁止，必须用 logger | 必须用 logger      |
| apps/web             | 禁止（生产构建）    | 开发期允许         |
| packages/domain      | 禁止                | 禁止               |
| packages/exam-engine | 禁止                | 禁止               |
| packages/db          | 禁止                | 必须用 logger      |
| packages/auth        | 禁止                | 必须用 logger      |

### 复杂度限制

```
max-lines-per-function: 80
complexity: 12
max-depth: 4
```

例外（不适用复杂度限制）：

- Schema 定义文件
- Migration 文件
- 测试数据 fixture
- UI table columns 配置

如果函数超过限制，应拆成：command / policy / validator / mapper / repository method。

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

建议增加脚本：

```bash
pnpm lint:copy
```

检查 `apps/**` 和 `packages/**` 中是否出现上述禁用词，并排除 test/story/demo 文件。

---

## 5. Prettier

配置 `prettier.config.*`，CI 中检查：

```bash
pnpm format:check
pnpm lint:copy
```

---

## 6. Architecture Boundaries

### 允许依赖

```
apps/api            → packages/contracts / domain / db / auth / exam-engine
apps/web            → packages/contracts / domain
packages/db         → packages/domain
packages/auth       → packages/domain / db
packages/exam-engine → packages/domain / db
packages/contracts  → packages/domain
packages/domain     → no internal package dependency
```

### 禁止依赖

```
packages/domain       → Fastify / React / Drizzle
packages/contracts    → Fastify
packages/exam-engine  → Fastify
packages/db           → apps/api
apps/web              → packages/db / database schema directly
```

### Architecture Lint

使用 dependency-cruiser 检查：

```bash
pnpm lint:arch
```

检查项：

1. domain 不依赖 Fastify
2. contracts 不依赖 Fastify
3. web 不直接依赖 db
4. 没有循环依赖
5. packages 之间依赖方向正确
6. P3-FORMAL-P0-D2: attemptId-rooted dual-lock transactions mint the EA
   capability via `lockEnrollmentAndAttempt` — no `as LockedEnrollmentAttemptIdentity`
   cast, no exported brand/affinity symbol, no exported capability type guard

### Enrollment ↔ Attempt Lock Order (P3-FORMAL-P0-D2)

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

The 7 attemptId-rooted AE production entry points (submitAndGradeAttempt,
candidate take/save/restore, admin force-submit, deadline autoSubmitAndGrade,
manual gradeQuestion route) each mint via the seam and thread the SAME repo
pair + capability from mint to terminal consumer. `startOrRestoreAttempt`
keeps its natural Enrollment→Attempt order as the explicit EA exception.

**Runtime repo-affinity assertion is the correctness boundary.** Static
lint rules (`pnpm lint:arch` + the structural test
`apps/api/src/runtime/lock-order.structural.test.ts`) are guardrails, NOT a
TypeScript lifetime proof. They do NOT claim that:

- TypeScript proves transaction lifetime
- AST proves arbitrary capability escape impossible
- `assertCapabilityFor` alone proves the transaction session is live

Cross-transaction / expired-witness safety is correct even if a future static
escape rule misses a leak, because the consume-time `assertCapabilityFor`
reference-identity check rejects any capability minted against a different
repo pair, and the underlying tx-bound repo session rejects further use
after commit/rollback.

---

## 7. Repository Guard

Route handler 不允许直接访问 db。所有业务数据访问必须走 repository。

### 规则

- 所有 repository 方法必须接收 `RequestContext`
- 所有业务查询必须带 `organizationId`
- Phase 1 的 `organizationId` 来自 internal default organization
- `tenantGuard` / organization guard 在 Phase 1 表示 organization data boundary guard，不表示可见多租户
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

Phase 1 acceptance requires E2E artifacts for diagnosis:

```txt
server.log, screenshot, video, Playwright trace
```

E2E server logs should preserve `requestId` so a failed browser step can be matched to API logs.

---

## 11. Environment Variable Validation

使用 Zod 校验环境变量，启动时 fail fast。

Phase 1 runtime config 必须校验：

```txt
APP_MODE
DATABASE_URL
TEST_DATABASE_URL
JWT_SECRET
CORS_ORIGIN
COOKIE_SECURE
RATE_LIMIT_DISABLED
DEFAULT_TENANT_SLUG
DEPLOYMENT_MODE
```

规则：

- `DEPLOYMENT_MODE` 只能为 `singleTenant` 或未设置。
- `DEPLOYMENT_MODE=multiTenant` 当前必须 fail fast。
- `DEFAULT_TENANT_SLUG` 仅作为 internal default organization 兼容配置，不代表 organizationSlug login。
- `JWT_SECRET` 生产环境必须显式设置且不能使用默认弱值。

可在 `apps/api/src/config.ts` 或独立 `packages/config` 中实现。

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

E2E may be disabled temporarily only during transition, but Phase 1 acceptance requires re-enable as blocking CI.

Minimal E2E paths:

1. candidate happy path
2. resume attempt
3. submit flush

Artifacts must include `server.log`, screenshot, video, and Playwright trace where available.

### API Route 测试（apps/api）

所有 API route 测试使用 **PostgreSQL 临时数据库** 来确保测试隔离。

**架构：**

- `apps/api/src/plugins/db.ts` — 注册 `fastify.db` 装饰器，使用 `createDatabase()`
- `apps/api/src/routes/testHelpers.ts` — 提供 `buildTestApp()` 函数，注入测试数据库
- Route handlers 通过 `fastify.db` 访问数据库，永不直接调用 `createDatabase()`

**测试模式：**

```typescript
import { buildTestApp } from "./testHelpers.js";
import myRoutes from "./myRoutes.js";

describe("my routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(myRoutes);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("returns data", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/my-endpoint",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
  });
});
```

**规则：**

1. Route handlers 绝不直接调用 `createDatabase()` — 必须通过 `fastify.db` 装饰器
2. 每个 `buildTestApp()` 调用创建独立的数据库实例，测试之间零共享状态

**验证：**

```bash
pnpm --filter api test        # API route tests (in-memory)
pnpm --filter @exam/db test   # DB repository tests (in-memory)
```

---

## 14. Pre-commit / Pre-push Hooks

使用 Husky（`.husky/` 目录，`package.json` 的 `prepare` 脚本自动安装）。实际钩子内容以 `.husky/` 为准；下表是当前配置：

### pre-commit (`.husky/pre-commit`)

```bash
pnpm exec lint-staged   # Prettier --write on staged files
pnpm lint:copy          # hardcoded copy guard
pnpm lint:arch          # architecture boundary lint
```

### pre-push (`.husky/pre-push`)

```bash
pnpm typecheck
```

### commit-msg (`.husky/commit-msg`)

```bash
pnpm exec commitlint --edit "$1"   # Conventional Commits 校验
```

---

## 15. CI Quality Gate

CI 运行三个并行 job，由 `static` job 门控：

### static job (必须先通过)

```bash
pnpm verify:static
# 展开为：
# pnpm format:check && pnpm lint && pnpm lint:copy && pnpm lint:arch && pnpm lint:db-config && pnpm typecheck
```

### verify job (全量测试)

```bash
pnpm verify
# 展开为 static + coverage + build：
# ... && TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm coverage && pnpm build
```

### e2e job

```bash
pnpm test:e2e
```

J9 最终增加 smoke：

```bash
pnpm smoke
```

PR 不通过 CI，不允许合并。

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

### 每个 Job 完成后必须输出

1. 修改了哪些文件及其语义影响
2. 新增或更新了哪些测试/characterization evidence
3. 实际执行的命令和结果
4. 未执行或不适用的门禁及原因
5. 已知限制与剩余风险

---

## 18. Verify Commands

根目录 `package.json` scripts：

```json
{
  "scripts": {
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "node scripts/check-code-quality.mjs",
    "lint:copy": "node scripts/check-hardcoded-copy.mjs",
    "lint:arch": "node scripts/check-architecture.mjs",
    "lint:db-config": "node scripts/check-db-config.mjs",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "coverage": "turbo coverage",
    "test:integration": "turbo test:integration",
    "test:e2e": "turbo test:e2e",
    "smoke": "turbo smoke",
    "build": "turbo build",
    "verify:static": "pnpm format:check && pnpm lint && pnpm lint:copy && pnpm lint:arch && pnpm lint:db-config && pnpm typecheck",
    "verify": "pnpm format:check && pnpm lint && pnpm lint:copy && pnpm lint:arch && pnpm lint:db-config && pnpm typecheck && TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm coverage && pnpm build"
  }
}
```

### 按 Job 类型额外运行

| Job 类型       | 额外命令                                                       |
| -------------- | -------------------------------------------------------------- |
| 涉及数据库     | `pnpm db:generate && pnpm db:migrate && pnpm test:integration` |
| 涉及 UI 主流程 | `pnpm test:e2e`                                                |
| Phase 1 完成   | `pnpm smoke`                                                   |
