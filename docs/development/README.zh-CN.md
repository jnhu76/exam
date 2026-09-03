# 开发指南

[English](README.md) · **简体中文**

> 本文面向 Exam 贡献者，介绍本地开发、测试、代码质量与架构入口。
> 它是 `README.md` 的简体中文阅读版本，不是第二套工程规则；实际命令以 `package.json` scripts、CI workflow、代码和 [`docs/standards/`](../standards/) 中的规范为准。

## 前置要求

| 要求 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | 24.15.x | `nvm use 24.15` 或等价方式 |
| pnpm | 11.x | `corepack enable && corepack prepare pnpm@11.1.2 --activate` |
| Docker | ≥ 25.x | `pnpm db:up` 会通过 Docker 启动 PostgreSQL |
| Docker Compose | v2 | Docker Desktop 已包含 |

## 仓库结构

```text
apps/
  web/            React 19 + Vite + TypeScript 前端
  api/            Fastify + TypeScript 后端
  e2e/            Playwright E2E 浏览器测试

packages/
  domain/         领域类型、枚举、错误（不依赖框架）
  contracts/      Zod Schema、API 契约
  db/             Drizzle ORM、迁移、repositories
  auth/           Session、RBAC、argon2 密码哈希
  authz/          Capability 授权与 scope resolver
  exam-engine/    Timer、答题协议、评分引擎
  import-export/  CSV / Excel 导入导出
```

## 本地初始化

```bash
# 1. 安装依赖
pnpm install

# 2. 启动 PostgreSQL（以及可选功能需要的 Redis）
pnpm db:up

# 3. 执行迁移
pnpm db:migrate

# 4. 写入测试用户（admin / candidate / candidate2）
pnpm db:seed

# 5. 启动开发服务器
pnpm dev
```

启动后：

- **Web**（Vite）：`http://localhost:5173`
- **API**（Fastify）：`http://localhost:3000`

Vite 开发服务器会自动把 `/api/*` 请求代理到 API。

## 数据库

| 命令 | 用途 |
| --- | --- |
| `pnpm db:up` | 启动 PostgreSQL 容器（端口由 `DB_HOST_PORT` 控制，默认 5432） |
| `pnpm db:down` | 停止 PostgreSQL 容器 |
| `pnpm db:reset` | 重置开发数据库（down + up） |
| `pnpm db:migrate` | 执行迁移 |
| `pnpm db:push` | 直接推送 schema 变更 |
| `pnpm db:studio` | 打开 Drizzle Studio |
| `pnpm db:generate` | 生成迁移文件 |

开发环境的 `DATABASE_URL` 由统一 DB resolver（`packages/db/src/databaseUrl.ts`）根据
`DB_HOST_PORT` 构造；如果显式设置 `DATABASE_URL`，则显式值优先。

## Seed 与演示数据

| 命令 | 用途 |
| --- | --- |
| `pnpm db:seed` | 基础 seed：Admin + 2 个 Candidate |
| `pnpm db:seed:demo` | 完整演示数据：5 用户、3 Course、10 Question、4 Exam |
| `pnpm db:seed:demo:verify` | 验证 demo seed 完整性 |

可在 seed 前通过 `.env` 设置自定义账号信息，完整列表见 `.env.example`。
Seed 在 production mode 下会拒绝执行。

## 运行应用

```bash
pnpm dev                # API + Web，热更新
pnpm --filter web dev   # 仅 Web
pnpm --filter api dev   # 仅 API
```

| 服务 | 开发端口 | 控制变量 |
| --- | --- | --- |
| Web（Vite） | 5173 | `VITE_PORT` |
| API（Fastify） | 3000 | `DEV_API_PORT` |
| PostgreSQL | 5432 | `DB_HOST_PORT` |

完整端口映射与不同运行模式下的 ownership 规则见 [`ports.md`](ports.md)。

## 常用开发命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动全部开发服务 |
| `pnpm build` | 构建所有 package |
| `pnpm test` | 运行全部测试 |
| `pnpm coverage` | 运行带 coverage 的测试 |
| `pnpm lint` | 运行代码质量检查 |
| `pnpm lint:eslint` | 对 Web package 执行 ESLint |
| `pnpm typecheck` | 对所有 package 执行类型检查 |
| `pnpm verify:static` | 运行所有无需数据库的静态门禁 |
| `pnpm verify` | 完整验证：static + coverage + build |

## 测试

测试契约、环境变量、数据库生命周期与 CI 基础设施的权威说明位于
[`docs/standards/testing.md`](../standards/testing.md)。

快速记忆：

- Unit / component：`pnpm test`
- 依赖 DB 的测试（`@exam/db`、`@exam/api`）：需要先运行 `pnpm db:up`
- 完整验证：`pnpm verify`（format + lint + typecheck + coverage + build）

## 代码质量

代码质量、依赖图约束和 AI 编码规则的权威说明位于
[`docs/standards/code-quality.md`](../standards/code-quality.md)。

常用门禁：

```bash
pnpm lint:arch          # 架构边界
pnpm lint:db-config     # 数据库配置一致性
pnpm lint:env-contract  # 环境变量契约
pnpm lint:repo-contract # turbo / package / seed / ADR / topology 契约
pnpm lint:ui-gates      # 前端视觉 authority 门禁
```

## E2E

Playwright 浏览器测试有两种执行方式：

- **WSL / 本地**：`bash scripts/e2e/run-wsl.sh` — 使用开发服务器 + 主机 Chromium，适合开发迭代。
- **Docker**：`bash scripts/e2e/run.sh` — 在容器中构建并运行完整 stack，更接近 CI。

两种方式应得到相同的 pass / fail 集合。完整 E2E 契约见
[`docs/standards/testing.md`](../standards/testing.md)。

## 架构入口

| 文档 | 用途 |
| --- | --- |
| [`docs/SPEC.md`](../SPEC.md) | 产品规范：不变量、领域模型 |
| [`docs/architecture/authorization.md`](../architecture/authorization.md) | Capability 授权模型 |
| [`docs/architecture/exam-runtime.md`](../architecture/exam-runtime.md) | Exam / Attempt / Answer / Submit 协议 |
| [`docs/operations/email-config.md`](../operations/email-config.md) | Email outbox / SMTP 运维参考 |
| [`docs/architecture/frontend.md`](../architecture/frontend.md) | 当前前端架构 |
| [`docs/standards/ui-system.md`](../standards/ui-system.md) | UI 系统约束与视觉 authority |
| [`docs/adr/README.md`](../adr/README.md) | ADR 索引 |
| [`docs/contracts/api-contract.md`](../contracts/api-contract.md) | Runtime-first API contract policy |

## AI / Agent 指南

AI 编码代理修改仓库前必须阅读并遵守 [`AGENTS.md`](../../AGENTS.md)。
其中规定工作模式、authority 边界、数据库安全、测试策略与修改原则。
