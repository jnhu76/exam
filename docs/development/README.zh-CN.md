# 开发指南

[English](README.md) · **简体中文**

> 本文面向 Exam 贡献者，介绍本地开发、测试、代码质量与架构入口。
>
> 本指南是便于阅读的工程投影。命令的精确接线由 `package.json` scripts 负责，测试生命周期语义由
> [`docs/standards/testing.md`](../standards/testing.md) 负责，Agent 行为由
> [`AGENTS.md`](../../AGENTS.md) 负责。存在语义化 `pnpm` 命令时，应优先使用它，而不是直接调用底层命令。

## 前置要求

| 要求 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | 24.22.x | `nvm use 24.22` 或等价方式 |
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
  contracts/      Zod schema、API 契约
  db/             Drizzle ORM、迁移、repository
  auth/           Session、RBAC、argon2 密码哈希
  authz/          基于 capability 的授权、scope resolver
  exam-engine/    Timer、答案协议、评分引擎
  import-export/  CSV / Excel 导入导出
```

## 本地初始化

```bash
# 1. 安装依赖
pnpm install

# 2. 启动 PostgreSQL + Redis（宿主机端口仅绑定环回；Redis 容器为需要它的可选消费者
#    提供零配置便利，但应用侧 Redis 模式在未配置 REDIS_URL 时仍保持关闭）
pnpm db:up

# 3. 执行迁移
pnpm db:migrate

# 4. 写入测试用户（admin / candidate / candidate2）
pnpm db:seed

# 5. 启动受管开发循环（先构建 workspace 依赖闭包）
pnpm dev
```

`pnpm dev` 会先构建开发服务器消费的全部 workspace package，然后启动：

- **Web**（Vite）：`http://localhost:5173`
- **API**（Fastify）：`http://localhost:3000`

Vite 开发服务器会自动把 `/api/*` 请求代理到 API。

## 数据库

| 命令 | 用途 |
| --- | --- |
| `pnpm db:up` | 启动/复用开发容器：PostgreSQL + Redis，宿主机端口仅绑定环回（`DB_HOST_PORT` / `REDIS_HOST_PORT`，默认 5432 / 6379） |
| `pnpm db:down` | 拆除开发 Compose 栈并销毁其可丢弃的卷和数据（`docker compose down -v`）——开发数据库状态会被销毁，不会保留 |
| `pnpm db:reset` | 销毁可丢弃的栈/卷并立即启动全新栈；使用 `pnpm db:migrate` + `pnpm db:seed` 重建数据 |
| `pnpm db:migrate` | 执行迁移 |
| `pnpm db:push` | 直接推送 schema 变更 |
| `pnpm db:studio` | 打开 Drizzle Studio |
| `pnpm db:generate` | 生成迁移文件 |

开发栈固定使用 Compose project `exam-dev`（#631），因此从同一 checkout 启动生产演练
不会重建它的开发容器。开发数据库状态被明确设计为**可丢弃**：Postgres 容器没有命名卷。
在 `stop` / `restart` / 宿主机重启之后运行 `pnpm db:up`，会复用既有容器并保留数据；
`pnpm db:down` 则会拆除整个栈，并销毁其可丢弃的容器卷和数据（`down -v`）。
数据重建方式是 `pnpm db:migrate` + `pnpm db:seed`（测试用 `exam_test` 数据库由测试 harness 自行创建）。
固定 project 之前创建的旧开发栈属于 `exam` project，`pnpm db:up` 不会触碰它；
如需启动该旧栈，应显式运行：

```bash
docker compose -p exam -f docker-compose.dev.yml up -d
```

开发环境的 `DATABASE_URL` 由单一来源的 DB resolver（`packages/db/src/databaseUrl.ts`）根据
`DB_HOST_PORT` 构造；如果显式设置 `DATABASE_URL`，则显式值优先。

## Seed 与演示数据

| 命令 | 用途 |
| --- | --- |
| `pnpm db:seed` | 基础 seed：Admin + 2 个 Candidate |
| `pnpm db:seed:demo` | 完整演示数据：5 个用户、3 门课程、10 道题、4 场考试 |
| `pnpm db:seed:demo:verify` | 验证 demo seed 完整性 |

可在 seed 前通过 `.env` 设置自定义账号信息（`SEED_ORG_NAME`、
`SEED_ORG_DISPLAY_NAME`、`SEED_ADMIN_USERNAME`、`SEED_ADMIN_PASSWORD`、
`SEED_CANDIDATE_*`——完整列表见 `docs/deployment/mvp-deployment-runbook.md`
的 *Custom seed credentials* 说明；这些不是 `.env.example` 的键）。
Seed 在 production mode 下会拒绝执行。

## 运行应用

`pnpm dev` 是 canonical 受管开发入口（`turbo watch dev`）：

```bash
pnpm dev                # 受管开发循环（见下方契约）
pnpm --filter web dev   # 仅 Web（非受管）
pnpm --filter api dev   # 仅 API（非受管）
```

**受管入口契约。** 首次 `pnpm dev` 会先构建完整 workspace 依赖闭包
（`dev` 依赖 `^build`），之后才启动任何受管 API/Web 进程——开发服务器
因此不可能静默消费缺失或过期的 `dist`。此后，上游源码变化会重建受影响
的闭包，由 Turbo 重启受管的 `dev` 任务。各任务的重启相互独立：存在一个
瞬态窗口，API 与 Web 应用可能运行不同代际。不存在跨进程的原子代际
切换——失败的构建不输出本次的新产物，旧产物留在磁盘上，进程继续执行旧
版本，直到一次成功的重建将其重启。失败的构建永远不等于成功发布。

**一次性入口。** `pnpm dev:once`（`turbo dev`）在构建依赖闭包后一次性
启动开发服务器。它不启用 Turbo 的跨包增量构建与受管重启：运行期间，
workspace package 源码（`packages/*/src`）的变化不会触发闭包重建。但这
不是"没有热更新"——Vite 与 tsx 保留各自的文件监听，应用内源码变化仍会
正常热更新/重启。适用于脚本化或一次性起栈场景。

**纯产物监听。** `pnpm watch:dist`（`turbo watch build`）只重建构建
产物，从不重启任何进程。它是直接执行构建产物的非受管轨道的显式补充：

| 非受管入口 | 执行内容 |
| --- | --- |
| `pnpm --filter @exam/api start`（及生产镜像） | `apps/api/dist` 经 `node dist/server.js` |
| `pnpm --filter @exam/api worker:email` | `apps/api/dist` 经 `node dist/workers/emailDeliveryWorker.js` |
| seed / admin / rollback CLI（`db:seed`、`bootstrap:admin` 等） | `apps/api/src` 经 tsx（一次性） |

`worker:email:dev` 经 tsx 从源码运行同一 worker；它是否纳入受管 dev
轨道属于独立评估（#938 跟踪）。

**并发构建 watcher。** `pnpm dev` 与 `pnpm watch:dist` 都是 `dist`
构建的所有者。Turbo 没有 workspace 级构建锁：不要在同一 worktree 内
随意并行运行两个构建 watcher。若需要同时运行受管开发循环与非受管
`pnpm start`/worker 的产物重建，请使用不同 worktree，或先停掉其中一个。

| 服务 | 开发端口 | 控制变量 |
| --- | --- | --- |
| Web（Vite） | 5173 | `VITE_PORT` |
| API（Fastify） | 3000 | `DEV_API_PORT` |
| PostgreSQL | 5432 | `DB_HOST_PORT` |

完整端口映射与不同运行模式下的 ownership 规则见 [`ports.md`](ports.md)。

## 常用开发命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | Canonical 受管开发循环：先构建闭包，再监听并重启受管任务 |
| `pnpm dev:once` | 构建闭包后一次性启动开发服务器（无 Turbo 跨包监听） |
| `pnpm watch:dist` | 只重建产物——不重启任何消费者（供 start/worker/CLI） |
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

快速摘要：

- Unit / component 测试：`pnpm test`
- 依赖 DB 的测试（`@exam/db`、`@exam/api`）：需要运行中的 PostgreSQL，可通过 `pnpm db:up` 启动
- 完整验证：`pnpm verify`（format + lint + typecheck + coverage + build）

## 代码质量

代码质量规则、依赖图约束和 AI 编码规则位于
[`docs/standards/code-quality.md`](../standards/code-quality.md)。

常用检查：

```bash
pnpm lint:arch          # 架构边界检查
pnpm lint:db-config     # 数据库配置一致性
pnpm lint:env-contract  # 环境变量契约检查
```

## E2E

Playwright 浏览器测试只有一个 canonical 的宿主机原生 runner：

- **本地 / CI 一致**（`pnpm e2e` → `bash scripts/e2e/run.sh`）— 在宿主机运行 API dev server + Chromium；
  Compose 只负责 PostgreSQL / Redis 依赖。CI 使用 service containers 执行相同的产品契约，
  而不是开发 Compose 栈。

完整 E2E 指南见
[`docs/standards/testing.md`](../standards/testing.md)。

## 架构入口

| 文档 | 用途 |
| --- | --- |
| [`docs/SPEC.md`](../SPEC.md) | 产品规范：不变量、领域模型 |
| [`docs/architecture/authorization.md`](../architecture/authorization.md) | 基于 capability 的授权模型 |
| [`docs/architecture/exam-runtime.md`](../architecture/exam-runtime.md) | Exam / Attempt / Answer / Submit 协议 |
| [`docs/operations/email-config.md`](../operations/email-config.md) | Email outbox / SMTP 运维参考 |
| [`docs/architecture/frontend.md`](../architecture/frontend.md) | 当前前端架构 |
| [`docs/standards/ui-system.md`](../standards/ui-system.md) | UI 系统约束与视觉权威 |
| [`docs/adr/README.md`](../adr/README.md) | ADR 索引 |
| [`docs/contracts/api-contract.md`](../contracts/api-contract.md) | Runtime-first API contract policy |

## AI / Agent 指南

AI 编码代理修改仓库前必须阅读并遵守 [`AGENTS.md`](../../AGENTS.md)。
其中规定工作模式、授权边界、数据库安全、测试策略与修改原则。
