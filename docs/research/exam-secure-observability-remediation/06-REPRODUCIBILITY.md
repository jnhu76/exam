# RUNBOOK — 安全关联审计（secure-correlation audit）隔离实验环境

> 审计纪律：只读审计 + 受控实验。本文所有命令只写入 `.tmp/secure-correlation-audit/`
> 或 `/tmp`；不修改 git 跟踪文件；不 commit/push/切分支。数据库操作遵循
> `docs/standards/testing.md` §2（尤其 §2.8 所有权契约）；只触碰测试/E2E 家族库；
> 禁止 `pnpm db:down` / `pnpm db:reset`（含 `down -v` 删卷）。
>
> **本文每一步都在本机实际执行过**，证据在 `.tmp/secure-correlation-audit/evidence/`
> （下文以 `[证据 NN]` 引用）。未执行的步骤明确标注。

## 0. 权威依据（读码出处）

| 事实 | 出处 |
|---|---|
| E2E 唯一入口与 env 合同（host-native、`APP_MODE=e2e`、`TEST_DATABASE_URL`、心跳 env、`PUBLIC_WEB_ORIGIN`、unset `DATABASE_URL`/`TEST_DB_URL`） | `scripts/e2e/run.sh:15-22,148-162`（env 权威）、`run.sh:734-737`（migrate/seed 命令）、`run.sh:746-768`（launch_api env 合同）、`run.sh:770-781`（wait_health） |
| 依赖容器拓扑（postgres:18.4、`exam:exam`、`127.0.0.1:${DB_HOST_PORT:-5432}`、Redis `127.0.0.1:${REDIS_HOST_PORT:-6379}`、loopback-only） | `docker-compose.dev.yml:5-40` |
| 测试库生命周期所有权（§2.8：PostgreSQL server 归 developer 的 `pnpm db:up`；`exam_e2e*` 归 E2E runner；worker 库 `exam_test_w<N>` 归 harness；`TEST_DATABASE_URL` 显式值必胜且库名须含 test/e2e/ci） | `docs/standards/testing.md` §2.8（L321-390） |
| full-reset（E2E seed 的 truncate 步骤）allowlist = `exam_e2e`、`exam_e2e_w<N>`、`exam_ci[_-]<suffix>`；dev `exam`、`exam_test*`、`exam_e2e_w<N>_prior` 一律拒绝 | `packages/db/src/scripts/destructiveDbNameGuard.ts:110-119`（`FULL_RESET_LITERALS` + `isFullResetTarget`） |
| run.sh cleanup 只 DROP `exam_e2e(_w<N>)?`（锚定正则），不触碰 `exam_ci_*` | `scripts/e2e/run.sh:219`（`WORKER_DB_NAME_RE`）、`run.sh:513-582` |
| API 绑定端口所有权：test/e2e/ci 模式 = `APP_PORT ?? DEV_API_PORT`（默认 3000）；`EXAM_PORT` 只是生产 Compose 的宿主发布口，**不是** dev/E2E API 端口变量 | `apps/api/src/config/runtimeConfig.ts:429-436`；`EXAM_PORT` 出现处：`docker-compose.yml`（prod） |
| APP_MODE=e2e 结构性关闭限流（`enabled: mode==="production" || (mode!=="e2e" && !RATE_LIMIT_DISABLED)`） | `apps/api/src/config/runtimeConfig.ts:712-714` |
| e2e seed 产物（reset→migrate→seed→seedDemo→verify；demo 账号 candidate1-4/candidate123） | `apps/api/src/e2e-seed.ts:14-27`；`packages/db/src/e2eSeedOrchestrator.ts:93-139` |
| 测试 fixture 权威（`createAssignedUserForTest`、`createExamViaApi`、`submitExamAsCandidate` 等同构 API 调用序列） | `apps/api/src/routes/testHelpers.ts:369-418,556-614,623-696,724-796` |
| 单租户 login 只解析 default 组织（Org B 无法经 login 路由登录，fixture 铸 JWT 是测试权威路径） | `apps/api/src/routes/auth.ts:138-166`（`resolveBrandingTenant(defaultTenantSlug)`）；`testHelpers.ts:407-417`（signJWT 铸 token） |
| JWT_SECRET 默认值（本地 .env 未设置时两进程同用 `development-only-change-me`） | `apps/api/src/config/settings.ts:672-674` |
| API 日志 = Fastify 内建 Pino（level info + redact），输出 stdout | `apps/api/src/server.ts:114-120` |
| worker-database 机制（单容器多库：`exam_test_w<VITEST_POOL_ID>`，名字跨 run 复用，无 GC） | `docs/standards/testing.md` §2.8 L373-390；`packages/db/src/testWorkerDatabase.ts` |

## 1. 共享实验环境（一套）：启动

已按本节完整执行并验证（证据 01-06、17）。当前状态：**环境在运行**（API :3000 健康，DB `exam_ci_audit`）。

### 1.0 前置：依赖容器

```bash
pnpm db:up        # docker compose -f docker-compose.dev.yml up -d（幂等，已验证 rc=0 [证据 17]）
```

- 若默认端口被其它 worktree 的 dev 栈占用：`DB_HOST_PORT=5433 REDIS_HOST_PORT=6380 pnpm db:up`
  （run.sh:34-37 记录的官方重映射用法），后续所有 URL 跟着改。
- **注意**：本机该栈在审计开始前已由 harness 长期持有（`exam-dev-db-1`/`exam-dev-db-1` healthy，
  [证据 01]）。它不是本次审计启动的 —— **cleanup 时绝不对它执行 `down`/`down -v`**。

### 1.1 目标库身份核验（动手前必做，§2.8 契约）

审计库选名 **`exam_ci_audit`**。理由：
- 命中 full-reset allowlist 家族 `exam_ci[_-]<suffix>`（seed 的 reset 步骤可合法收敛基线）；
- 命中 resolver 名字安全守卫（含 `ci`，`TEST_DATABASE_URL` 显式值合法）；
- **不在** run.sh cleanup 的 DROP 范围（`exam_e2e*` 才会被并行 E2E run 清掉）；
- **不在** vitest 领地（`exam_test*`/`exam_test_db_w*`，§2.8 归 harness 所有）。

```bash
# (a) 容器侧身份：确认连的是 exam-dev 栈的 postgres、角色 exam
docker exec exam-dev-db-1 psql -U exam -d postgres -tAc \
  "SELECT current_database(), current_user, current_setting('server_version')"
# 实测： postgres | exam | 18.4 (Debian ...)  [证据 01]

# (b) 宿主侧 URL 身份：用 API 将使用的确切连接串查询落点库名
docker exec exam-dev-db-1 psql -U exam -d exam_ci_audit -tAc "SELECT current_database()"
# 或经宿主 TCP（实测： {"db":"exam_ci_audit","usr":"exam","addr":"172.18.0.3/32","port":5432} [证据 03]）
```

### 1.2 建库 + 迁移 + e2e seed（全部仓库语义命令）

```bash
# 建库 —— 镜像 run.sh:722-730 ensure_db_exists（幂等）
CID=$(docker compose -f docker-compose.dev.yml ps -q db)
docker exec "$CID" psql -U exam -tAc \
  "SELECT 1 FROM pg_database WHERE datname='exam_ci_audit'" | grep -q 1 \
  || docker exec "$CID" psql -U exam -c "CREATE DATABASE exam_ci_audit"

# 迁移 —— 即 run.sh:734 migrate_db 的原命令
APP_MODE=e2e TEST_DATABASE_URL="postgresql://exam:exam@localhost:5432/exam_ci_audit" \
  pnpm --filter @exam/api exec tsx src/scripts/migrate.ts        # 实测 rc=0 [证据 04]

# e2e seed（reset:true 收敛 canonical 基线）—— 即 run.sh:737 seed_db 的原命令
APP_MODE=e2e TEST_DATABASE_URL="postgresql://exam:exam@localhost:5432/exam_ci_audit" \
  pnpm seed:e2e                                                   # 实测 rc=0 [证据 05]
```

⚠️ `APP_MODE=e2e` **必须显式导出**：根 `.env` 的 `APP_MODE=development` 会让 resolver 走
dev `exam` 库分支。shell 导出优先于 `.env`（testing.md §2.0）。同时确保 `DATABASE_URL`/
`TEST_DB_URL` 未在 shell 中残留（run.sh:162 同样的防御）。

seed 产物（[证据 05]）：`admin/admin123`；`candidate|candidate2 / candidate123`；
demo `candidate1..4 / candidate123`（in_progress/available/resumable/graded 四态）。

### 1.3 host-native API 启动（stdout/stderr → server.log）

```bash
cd /home/hoo/Source/exam
env -u DATABASE_URL -u TEST_DB_URL \
  APP_MODE=e2e \
  TEST_DATABASE_URL="postgresql://exam:exam@localhost:5432/exam_ci_audit" \
  APP_PORT=3000 DEV_API_PORT=3000 \
  PUBLIC_WEB_ORIGIN="http://localhost:3000" \
  HEARTBEAT_TIMEOUT_MS=15000 HEARTBEAT_SCAN_INTERVAL_MS=5000 DEADLINE_SCAN_INTERVAL_MS=5000 \
  setsid pnpm --filter @exam/api dev \
  > .tmp/secure-correlation-audit/env/server.log 2>&1 &
echo $! > .tmp/secure-correlation-audit/env/server.pid
```

- env 集合 = run.sh launch_api（run.sh:762-766）的逐项复刻；e2e 模式绑定端口 owner 是
  `APP_PORT ?? DEV_API_PORT`（runtimeConfig.ts:436），两个都设避免歧义。
- `setsid` 建独立进程组，停止时 `kill -- -<pid>` 整组停（run.sh:293-324 同语义）。
- **端口选择**：默认 3000（实测空闲）。冲突时改 `APP_PORT`/`DEV_API_PORT`（如 3001）并同步
  `PUBLIC_WEB_ORIGIN`。注意 **`EXAM_PORT` 是生产 Compose 的宿主发布变量，不用于本拓扑**
  （§0 表）；避开 `3100+` 区间（run.sh 并行 E2E shard 默认占用 `E2E_WORKER_BASE_PORT..+N`）
  与 5173（vite）。
- 实测：1-3 秒健康（[证据 06][证据 16]）；Pino JSON 行（`reqId`/`res.statusCode`/
  `responseTime`/redact）完整落入 server.log（[证据 11]，实测 55 行结构化日志）。

### 1.4 健康检查

```bash
curl -sf http://localhost:3000/api/health        # → {"status":"ok"}  [证据 06]
```

慢启动排障：`tail -40 .tmp/secure-correlation-audit/env/server.log`（进程退出时 run.sh
wait_health 同样打印日志尾部）。

## 2. 合成测试主体创建方案（优先 seed:e2e / 既有 fixture，零新协议）

以下**全部活体验证过**（证据 07-15）。金丝雀命名统一 `EXAMAUDIT-CANARY-*`；密码统一
`Examaudit-Canary-123`。

| 主体 | 创建方式（已验证的命令面） | 证据 |
|---|---|---|
| **Org A**（= seed default org `default`） | §1.2 的 `pnpm seed:e2e` 自带；Org A admin = `admin/admin123` | 05, 07 |
| Candidate A1、A2 | Org A admin cookie → `POST /api/candidates`（**必填 org 级 CandidateField `candidateNo`**，缺省 400；testHelpers.createCandidateViaApi 同样先读字段配置再填） | 09→10 |
| Org A admin（第二管理员，如需） | `POST /api/users` `{"role":"Admin",...}`（`ensureTargetOrg` 限定本 org） | 08 §3 同构 |
| **监考员（已获分配）** `EXAMAUDIT-CANARY-proctorA1` | `POST /api/users` role=Proctor → `POST /api/admin/exams/:examId/proctors`（**`operationId` 必须是 UUID**，幂等恢复键；任意字符串 → VALIDATION_ERROR） | 08, 09 |
| **监考员（未获分配）** `EXAMAUDIT-CANARY-proctorA2` | 仅 `POST /api/users`，不调分配端点 | 08, 15 |
| **最小可答题链路**（SaveAnswer 实验） | course → `true_false` question → exam → `POST /api/exams/:id/publish` → enroll candidate → candidate `POST /api/attempts/:examId/start` → `POST /api/attempts/:attemptId/answers/:questionId`（版本化协议体：`{answer, clientSeq, clientSavedAt, baseVersion}`；实测 `{"accepted":true,"serverVersion":1}`）——与 testHelpers.createExamViaApi/submitExamAsCandidate 的调用序列逐端点同构 | 08, 10 |
| **Org B**（org 行 + adminB + candB1） | 单租户**没有**建 org / 跨 org 用户的 REST 路由（auth login 只解析 default tenant，auth.ts:138-166）。用 `.tmp` 驱动脚本 `scripts/make-org-b.ts`：**先 `SELECT current_database()` 核验身份再写**（错库拒绝 exit 3，实测负例通过），行结构与 `testHelpers.createAssignedUserForTest`（users + primary active role assignment）和 `audit.test.ts:1020-1030` 的第二 org insert 逐列一致 | 12, 18 |
| Org B 认证 | login 路由按设计不可用；`scripts/mint-org-b-jwt.ts` 铸 JWT（signJWT + 同一 loadRootEnv/JWT_SECRET 解析面），作 `auth-token` cookie 使用 —— 与测试 fixture 的 token 铸造同路径 | 14 |

运行 fixture 驱动（tsx 经 @exam/api 包解析；脚本内导入全部为相对路径，因 `.tmp` 无包解析锚点）：

```bash
APP_MODE=e2e TEST_DATABASE_URL="postgresql://exam:exam@localhost:5432/exam_ci_audit" \
  pnpm --filter @exam/api exec tsx /home/hoo/Source/exam/.tmp/secure-correlation-audit/scripts/make-org-b.ts
```

已验证的边界行为（供实验设计直接引用）：
- 跨 org 隔离：Org B admin（铸 JWT）读 Org A 考试 → `RESOURCE_NOT_FOUND`；列考试 → `items:[]`（[证据 14]）。
- 监考分配边界：`GET /admin/proctor/exams` 已分配 proctorA1 → `total:1`（金丝雀考试）；
  未分配 proctorA2 → `total:0`（[证据 15]）。
- 登录路由对 Org B 用户返回 `AUTH_INVALID_CREDENTIALS`（default-tenant-only，设计行为，[证据 13]）。

## 3. 多环境并行方案（共享 1 套 + 性能 worktree A/B/C/D）

**未执行**（属后续性能实验步骤）；以下是经端口/库名/allowlist 核实过的方案。

原则：**单容器多库**（仓库 worker-database 机制同款：一个 postgres 容器内按库名隔离，
`exam_test_w<N>` 即此模式，§2.8 L373-390），不开第二个 Compose 栈。

| 环境 | 检出位置 | API 端口 | 库名 | 说明 |
|---|---|---|---|---|
| 共享实验环境 | `/home/hoo/Source/exam`（主检出） | 3000 | `exam_ci_audit` | 已运行（§1） |
| 性能 A | worktree `<repo>/.tmp/wt-perf-a`（或 /tmp 下） | 3201 | `exam_ci_perf_a` | |
| 性能 B | worktree …-b | 3202 | `exam_ci_perf_b` | A/B/C/D 对照 = 各自 commit/分支的代码变体 |
| 性能 C | worktree …-c | 3203 | `exam_ci_perf_c` | |
| 性能 D | worktree …-d | 3204 | `exam_ci_perf_d` | |

- 库名 `exam_ci_perf_[a-d]` 命中 full-reset allowlist `exam_ci[_-]<suffix>`，且不被
  run.sh/vitest 触碰；端口 3201-3204 实测空闲，避开 3100+（E2E shard）与 5173（vite）。
- worktree 创建：`git worktree add <abs-path> <ref>`（不切主检出分支、不产生 commit）；
  每个 worktree 内 `pnpm install` 后按 §1.2/§1.3 各自执行（替换库名与 `APP_PORT`）。
  worktree 放 `.tmp/` 或 `/tmp` 下，避免落入受控工作树。
- 共享 db 容器是唯一有状态依赖；A-D 同时压测时连接上限注意（postgres 默认 max_connections，
  每实例一个池）。
- 各环境 server.log 分开：`env/server-perf-<a|b|c|d>.log`。
- Redis 相关行为（如需）：`REDIS_URL=redis://localhost:6379` 显式导出才启用（§2.6；
  本审计未启用，`NOT_TESTED`）。

## 4. 健康检查 / 故障重启 / 清理（不删卷）

### 4.1 健康

```bash
curl -sf http://localhost:3000/api/health
tail -f .tmp/secure-correlation-audit/env/server.log     # Pino 实时流
```

### 4.2 故障重启（实测 [证据 16]：停 → 端口释放 → 起 → 3s 健康 → 数据仍在）

```bash
PID=$(cat .tmp/secure-correlation-audit/env/server.pid)
kill -TERM -- -$PID                      # 整进程组（setsid 语义，run.sh stop_process_group 同款）
# 轮询确认停止且端口释放后，按 §1.3 原命令重启（>> 追加 server.log）
```

### 4.3 清理（分级，均不删卷、不触碰 dev 数据）

| 级别 | 操作 | 命令 | 已验证 |
|---|---|---|---|
| L1 停服务 | 停 API 进程组（DB/容器保留） | §4.2 的 kill 序列 | ✅ [证据 16] |
| L2 清金丝雀 Org B | 复用仓库原语 `cleanupOrganizationTestData`（audit.test.ts finally 同款） | `pnpm --filter @exam/api exec tsx …/scripts/remove-org-b.ts`（同样先核验库名） | ✅ [证据 18]（清后 0 行，可重建） |
| L3 收敛基线 | 重跑 e2e seed（reset:true 截断全部业务表 → 重建 canonical 基线；金丝雀主体随之消失，需重跑 §2） | §1.2 的 `pnpm seed:e2e` | ✅（reset 语义，[证据 05]） |
| L4 删审计库 | `DROP DATABASE`（破坏性；仅审计收尾、经人工确认后） | `docker exec exam-dev-db-1 psql -U exam -d postgres -c 'DROP DATABASE exam_ci_audit WITH (FORCE)'` | NOT_TESTED（无必要执行） |
| — 禁止 | `pnpm db:down`/`db:reset`（`down -v` 删卷，波及 harness 持有的 worker 槽库与 `exam_e2e`） | — | — |

注意：dev compose 栈**保持运行**（非本审计启动，属 harness 持有；§2.8 worker 槽库跨 run
保留契约依赖它）。

## 5. `.tmp` 安全性确认

- `git check-ignore -v .tmp/secure-correlation-audit` → `.gitignore:39:.tmp/`（[会话起始即验]，
  §4.3 前复查一次：工作树仅剩会话前已存在的 `?? test-results/`，无任何受控文件改动）。
- 所有脚本/日志/证据仅存在于 `.tmp/secure-correlation-audit/` 与 `/tmp/e2e-wsl-*`（后者为
  run.sh 自有 artifact，非本审计产生）。
- fixture 驱动脚本位于 `.tmp`（无包解析锚点），不向仓库 `apps/`/`packages/` 写任何文件。

## 6. 证据索引（`.tmp/secure-correlation-audit/evidence/`）

| 文件 | 内容 |
|---|---|
| 01-db-identity.txt | compose ps + 容器侧 `current_database()` + 既有库清单（worker 库布局实证） |
| 02-create-audit-db.txt | `CREATE DATABASE exam_ci_audit`（幂等守卫） |
| 03-host-url-identity.txt | 宿主 TCP URL 落点核验 JSON |
| 04-migrate.txt / 05-seed.txt | 迁移 rc=0 / seed rc=0 + 凭据输出 |
| 06-health.json | `{"status":"ok"}` |
| 07-admin-login-exams.txt | admin 登录（capabilities 全量）+ 考试列表 |
| 08/09/10 | 主体与考试链路：proctor 建立、UUID operationId 要求、candidateNo 必填、SaveAnswer `accepted:true` |
| 11-pino-log.txt | server.log Pino JSON 样本（reqId 关联请求/响应行） |
| 12/18 | Org B fixture 建立 + 错库拒绝 + 清理/重建 |
| 13/14 | Org B login 不可用（设计）/ 铸 JWT + 跨 org 隔离 |
| 15-proctor-boundary.txt | 已分配 vs 未分配监考员可见性 |
| 16-restart.txt | 停 → 端口释放 → 重启 → 健康 → 数据存活 |
| 17-db-up-idempotent.txt | `pnpm db:up` 幂等 rc=0 |

## 7. 已知限制 / 风险

1. **APP_MODE=e2e 下限流结构性关闭**（runtimeConfig.ts:712-714）。凡审计主张涉及限流的
   负例，需另用 `APP_MODE=test` profile（同路由到 `TEST_DATABASE_URL`，限流默认开启，
   testing.md §2.5）重启服务验证 —— 本 runbook 未部署该 profile（NOT_TESTED）。
2. Org B 主体只能经 fixture 铸 JWT 认证（login 路由 default-tenant-only 是产品行为，非环境缺陷）。
3. `exam_e2e`（串行 E2E 持久库）与本审计共存于同一容器；审计不触碰它，但它承担 `--no-reseed`
   语义 —— 任何对它的写都会污染 E2E 基线，禁止。
4. 并行性能 worktree 需各自 `pnpm install`（磁盘/时间成本），且共享容器的连接数上限需监控。
5. server.log 以 `>>` 追加跨重启；长期实验按需轮转（`mv` 后重启）。
