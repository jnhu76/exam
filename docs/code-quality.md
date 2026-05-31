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

---

## 2. Tooling

| Tool | Purpose |
|------|---------|
| Prettier | Formatter |
| ESLint + typescript-eslint | Lint |
| TypeScript strict mode | Type safety |
| Vitest | Unit/integration test |
| Vitest coverage v8 | Coverage |
| Playwright | E2E/smoke test |
| Lefthook | Git hooks |
| turbo | Monorepo runner |
| dependency-cruiser | Architecture boundary lint |
| pnpm | Package manager |

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

| Package | console.log | console.warn/error |
|---------|-------------|-------------------|
| apps/api | 禁止，必须用 logger | 必须用 logger |
| apps/web | 禁止（生产构建） | 开发期允许 |
| packages/domain | 禁止 | 禁止 |
| packages/exam-engine | 禁止 | 禁止 |
| packages/db | 禁止 | 必须用 logger |
| packages/auth | 禁止 | 必须用 logger |

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

## 5. Prettier

配置 `prettier.config.*`，CI 中检查：

```bash
pnpm format:check
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

---

## 7. Repository Guard

Route handler 不允许直接访问 db。所有业务数据访问必须走 repository。

### 规则

- 所有 repository 方法必须接收 `RequestContext`
- 所有业务查询必须带 `organizationId`
- SuperAdmin 跨租户操作必须显式传 `targetOrganizationId`

### 禁止

```ts
await db.select().from(questions)
```

### 允许

```ts
await questionRepo.list(ctx, filters)
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
TenantAccessDeniedError     — 403 cross-tenant
ValidationError             — 400
NotFoundError               — 404
InvalidStateTransitionError — 409 state machine
AttemptAlreadyStartedError  — 409
AttemptClosedError          — 409
AnswerVersionConflictError  — 409 stale version
ExamNotOpenError            — 409
ExamTimeExpiredError        — 409
```

### Fastify Error Handler

domain error → stable HTTP response（映射到对应 status code）
unknown error → 500 + requestId

### 统一错误响应

```ts
{
  error: {
    code: string
    message: string
    requestId: string
  }
}
```

### 禁止

- 到处 `throw new Error("xxx")` — 必须使用 domain error types
- 直接把数据库错误暴露给前端
- API response 错误格式不统一

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
- 完整身份证号 / 手机号等敏感字段
- 完整 answer 内容（除非 debug 模式且本地开发）

---

## 11. Environment Variable Validation

使用 Zod 校验环境变量，启动时 fail fast。

必须校验：

```
DATABASE_URL
SESSION_SECRET / JWT_SECRET
NODE_ENV
APP_PORT
COOKIE_SECURE
CORS_ORIGIN
```

可在 `apps/api/src/config.ts` 或独立 `packages/config` 中实现。

---

## 12. Database Migration

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

## 14. Pre-commit / Pre-push Hooks

使用 Lefthook：

### pre-commit

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

### pre-push

```bash
pnpm test
pnpm coverage
```

---

## 15. CI Quality Gate

CI 必须包含：

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm lint:arch
pnpm typecheck
pnpm test
pnpm coverage
pnpm build
pnpm test:integration
```

J9 最终增加：

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
15. 是否通过 `pnpm verify`？

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

1. 修改了哪些文件
2. 新增了哪些测试
3. 覆盖率结果
4. verify 命令结果
5. 是否存在已知限制

---

## 18. Verify Commands

根目录 `package.json` scripts：

```json
{
  "scripts": {
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "turbo run lint",
    "lint:arch": "dependency-cruiser .",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "coverage": "turbo run coverage",
    "test:integration": "turbo run test:integration",
    "test:e2e": "turbo run test:e2e",
    "smoke": "turbo run smoke",
    "build": "turbo run build",
    "verify": "pnpm format:check && pnpm lint && pnpm lint:arch && pnpm typecheck && pnpm test && pnpm coverage && pnpm build"
  }
}
```

### 按 Job 类型额外运行

| Job 类型 | 额外命令 |
|---------|---------|
| 涉及数据库 | `pnpm db:generate && pnpm db:migrate && pnpm test:integration` |
| 涉及 UI 主流程 | `pnpm test:e2e` |
| Phase 1 完成 | `pnpm smoke` |
