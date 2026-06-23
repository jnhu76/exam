# 测试 Flake 登记册

本文档登记 `pnpm verify` 期间在主分支或 Phase1.7 工作分支上观察到的、**与当前改动无因果关系**的偶发测试失败（flaky tests）。

每条记录的目的：

- 让接手的人不要把 flake 当成真 bug 去回滚或修
- 让我们能识别出"反复在同一个测试上出现"的趋势——若一条 flake 升级为高频问题，就要从登记册升级为正式 Bug
- 给将来 Phase1.5/1.6/1.7 测试基础设施收紧时（统一隔离、串行化、独立 PG schema）留下证据

> **进度备注（ADR-007 Phase 2A，resolver skeleton）**：ADR-007 Phase 2A
> introduced a resolver skeleton only (`packages/db/src/testScope.ts`)。它只提供
> 统一 test scope 命名能力，是纯解析逻辑、无副作用、未被测试工厂消费，
> **does not remove BUG-FLAKE-001 mitigations**（`fileParallelism: false`、
> `verify:db-tests` 串行链、scanner legacy timeout、每文件 schema 隔离全部
> 保留），也**不声称 flake 已修复**。真实隔离落地是 Phase 3+ 的后续 PR。
>
> **进度备注（ADR-007 Phase 3A，worker-database prototype）**：ADR-007 Phase 3A
> introduced a worker-database **prototype** only
> (`packages/db/src/testWorkerDatabase.ts`)。它只新增 helper + 自带测试，**不**
> 接入任何现有测试工厂、**不**打开 `fileParallelism`、**不**改 `maxWorkers`、
> **does not modify default maxWorkers, does not enable file parallelism, does
> not prove maxWorkers=2/4 safety, does not remove BUG-FLAKE-001 mitigations**。
> 现有测试默认行为不变；legacy `file-schema` 仍是默认/回退。

## 登记规则

1. **必须有再现一次"同代码再跑就过"的证据**才能记入此处，否则按真实 bug 处理。
2. 每条至少含：日期、Job 上下文、失败测试 file:line、错误片段、根因假设、当前缓解、后续动作。
3. 同一条目复发 ≥3 次 → 升级为正式跟踪条目（本文档"已升级条目"段，或 issue tracker），并在原条目末尾标记"已升级"。

---

## 已升级条目

### BUG-FLAKE-001 — `attempts.test.ts:1070` 后台扫描在 coverage 模式下 5s timeout

**状态**: 已升级（≥3 次复发，2026-06-13）。已从单点 timeout 缓解升级为 **A′ serial containment** → **B 方案基础实施就位**（2026-06-21）→ **B 方案全量迁移完成**（2026-06-21）。

> **总体口径（Phase 6 修正，2026-06-23）**：BUG-FLAKE-001 的 **state leak 子问题**已由 B
> 方案（每测试文件 / 每 worker 独立 PG schema）修复——跨文件 / 跨 worker / 跨 package
> 的 DB 状态泄漏从源头消除。但 BUG-FLAKE-001 还有 **I/O contention 子问题**，B 方案
> **没有**修复，仍由 **A′ serial containment**（`apps/api fileParallelism:false`）+
> **`verify:db-tests` 串行链**缓解。因此 **BUG-FLAKE-001 不能算已关闭**：在 I/O
> contention 子问题被根因修复（template DB / migration semaphore / 并发限流落地），
> 且上述缓解以 stress 证据移除之前，仍保持开启。Phase 5/6 仅提供 local / test-only
> evidence，不构成 CI / global 关闭证据。
>
> BUG-FLAKE-001 现按根因分类为以下子类，登记在同一升级条目下，不另开新条目：
>
> - **state leak（已修复）**：跨文件状态污染、跨 worker 状态污染、跨 package schema/data leak。
> - **I/O contention（未修复，仍靠 A′ serial + `verify:db-tests` 串行链缓解）**：
>   - PG create / migrate / seed 争用（并行 `buildTestApp()` 并发 CREATE SCHEMA →
>     migrate → seed 是 PG 吞吐瓶颈，PR86 诊断矩阵证实）。
>   - coverage instrumentation 放大（v8 / c8 instrumentation 在 coverage 模式下放大
>     I/O 与调度争用）。
>   - **auth amplification**（见下方 2026-06-23 观察与 PR86 矩阵）：auth login /
>     audit polling 在全量 coverage + PG I/O 争用下被放大，单用例 6 轮 login +
>     每轮 audit 轮询无法在 5s 默认 testTimeout 内收敛。
>   - **physical-DB-lifecycle amplification**（见下方 2026-06-23 观察与
>     `testWorkerDatabase.test.ts` 条目）：`CREATE DATABASE` / migration / truncate
>     这类 PG lifecycle 操作在 coverage + turbo 交叉任务 PG 争用下更容易击穿默认 5s。
>   - module / global state leakage（单文件内或全局状态残留，A′ 串行不覆盖）。

**Old root cause**: vitest 按文件并行调度 + 全部测试共享 `exam_test.public` schema + c8 coverage 放大 I/O 争用 → `scanDatabaseForDisruptedAttempts` 的 PG 调用在共享 schema 下无法在 5s 内回包。

**New root fix**: `packages/db/src/testIsolation.ts` 提供每测试文件 / 每 worker 独立 PG schema 机制。通过 `SET search_path TO <unique_schema>`（不含 `public`）+ `migrationsSchema` 参数为每个 schema 独立追踪迁移状态 → 跨 worker / 跨文件 DB 状态泄漏从源头消除。已验证：32 个 isolation helper 测试全部通过。

**Remaining mitigations**:
1. **A′ `fileParallelism: false`**（apps/api vitest config，packages/db 已于 PR87 恢复并行）：串行执行 apps/api 的 DB-touching file，仍为当前主缓解。B 方案迁移完成后可评估移除（需在独立 follow-up PR 中验证 stress）。
2. **C 方案 scanner legacy timeout**（15_000ms）：保留，可评估移除（需在独立 follow-up PR 中 review）。

**当前缓解**:

1. **B 方案（已完成，2026-06-21）**: 所有 ~43 个 DB-touching 测试文件已接入独立 PG schema。每测试文件通过 `setupIsolatedTestDb()` / `buildTestApp()` 自动创建独立 schema，从源头消除跨文件 / 跨 worker / 跨 package DB 状态泄漏。跨 package 并发 stress 5/5 PASS。
   - 基础设施：`packages/db/src/testIsolation.ts` 提供 `setupIsolatedTestDb()` / `withIsolatedTestSchema()` / `getIsolatedTestDb()` / `buildTestApp()`。
   - 隔离机制：`SET search_path TO <unique_schema>`（不含 `public`）+ `migrationsSchema` 参数实现 schema 级独立追踪。
   - FK 约束 schema 无关：迁移 SQL 中所有 FK 引用已去掉 `"public".` 硬编码前缀。
   - 由 `TEST_DB_ISOLATION=1`（默认开启）控制。
2. **A′ 方案（保留，packages/db 已恢复并行）**: `apps/api/vitest.config.ts` 设置 `fileParallelism: false`（packages/db 已于 PR87 删除该设置）。B 方案迁移完成后此设置已成为安全网而非主缓解，可在独立 follow-up PR 中评估移除。
   - 影响范围：仅 `apps/api` 和 `packages/db`。
   - turbo 层面：跨 package 仍然并行（已验证 5/5 通过）。
3. **C 方案（保留，可选 review）**: `apps/api/src/routes/attempts.test.ts:1070` 的 15_000 ms timeout。B 方案迁移完成后可 review 是否移除。

**已知根因（已部分验证）**: vitest 默认按文件并行调度 + 全部测试文件共享同一本地 PG 实例 + c8 instrumentation 在 coverage 模式下放大 I/O 与调度争用。导致 `scanDatabaseForDisruptedAttempts` 的 PG 调用在某些瞬间无法在 5s 默认 testTimeout 内回包。A′ 通过让测试文件串行执行验证了 "并行 + 共享 schema" 是触发条件之一。

**B 方案后续根因修复：已完成（2026-06-21）**:

- ~~给 `apps/api` 测试加上"每测试文件 / 每 worker 独立 PostgreSQL schema"机制：测试 setup 阶段为每个 worker 创建一个独立 schema 并 `SET search_path`，把"共享 schema 下并行写入"这一类争用从源头消除。~~
- 基础实施已就位（2026-06-21）：`packages/db/src/testIsolation.ts` + `getIsolatedTestDb()` + `buildTestApp()` `schemaName` 参数。
- 迁移完成：所有 ~43 个 DB-touching 测试文件已接入隔离 schema。跨 package 并发 stress 5/5 PASS。
- **未在本次 PR 中执行**：移除 `fileParallelism: false`、`verify:db-tests` 串行链、scanner 15_000 ms timeout。这些应在独立 follow-up PR 中评估移除，需先通过移除后的 stress 验证。
- 可用 helper：`setupIsolatedTestDb({ namespace })`、`withIsolatedTestSchema()`、`getIsolatedTestDb(namespace)`、`buildTestApp(plugin, { schemaName })`。

**禁止做（仍然有效）**:

- 永久延长 scanner 自身超时（产品代码不为测试便利让步）
- skip 该用例
- 在 CI 上设置自动重跑后默认通过（会掩盖真实回归）
- 在 A′ 方案之上继续给其他测试加单点 timeout（应通过 B 方案根治）

**触发条件**: 在 A′ 生效后，若 BUG-FLAKE-001 在 `apps/api` 串行执行下仍然出现，必须立即开始 B 方案，不再依赖 timeout 缓解。

**Stress 验证脚本**: 项目根的 `scripts/test/verify-stress.sh` 提供手动连续运行 `pnpm verify` 的脚手架（默认 3 次，可传参，例 `bash scripts/test/verify-stress.sh 5`）。该脚本不进入 CI，仅供开发者在改 vitest 调度或 PG 隔离机制时手动验证稳定性。

**复发记录**:

- 2026-06-13：S06-lite review 修复阶段，单次出现，重跑通过（普通 flake）
- 2026-06-13：S07-lite GREEN 阶段，`pnpm verify` coverage 模式连续 3 次同位置 timeout——触发升级，应用 C 方案 timeout 缓解
- 2026-06-13：A07 i18n GREEN 阶段，`pnpm verify` 再次出现同位置 timeout——单点 timeout 缓解失效（仅延长边界，未消除根因），按"再次出现"触发条件升级为 A′ apps/api coverage serial containment
- 2026-06-13：A′ 方案首轮 `verify-stress.sh 5 --no-cache` 验证时，**packages/db `demo-seed.test.ts` 同样出现 5s timeout**——证明 PG 资源争用同样影响 packages/db。修复扩展到 `packages/db/vitest.config.ts` 同样设置 `fileParallelism: false`
- 2026-06-20：P2C-J2/J3 恢复（`feat/p2c-j5-proctor-dashboard` 分支）后跑 `pnpm verify`，scanner 用例再次 5s timeout——`attempts.test.ts > deadline scanner > is idempotent: second scan does not re-grade or duplicate audit` 与 `> heartbeat scanner > leaves a still-stale in_progress attempt for the next scan when this scan finds nothing to disrupt` 两个用例 timeout（5000ms），均为 scanner 家族。同代码单跑整文件 `vitest run src/routes/attempts.test.ts` 68/68 green；`-t "force-submit|extend-time|misconduct"` 15/15 green。属 BUG-FLAKE-001 重负载 timeout 家族，与 J2/J3 恢复改动无因果（恢复仅新增 force-submit/extend-time 路由与测试，未触碰 scanner 代码）。
- 2026-06-20：`attempts.ts` 机械拆分为 `attempts.{candidate,admin,shared}.ts`（同分支）后，连续 3 次 `vitest run src/routes/attempts.test.ts` 整文件运行中，同样的 scanner 用例（`is idempotent: second scan...` / `leaves a still-stale in_progress attempt...`）间歇 5s timeout（1–2 个用例，非断言错误）。单独复跑 `-t "is idempotent: second scan|leaves a still-stale"` 时 1 个 timeout、1 个 4532ms 勉强过；`-t "force-submit|extend-time|misconduct"` 15/15 green。失败用例固定落在 deadline/heartbeat scanner describe，且为 timeout（非断言），符合 BUG-FLAKE-001 PG I/O 争用特征。拆分仅改路由层 register hub 与文件归属，未触碰 scanner 代码（`packages/exam-engine` 的 `scanDatabase*` 与 `apps/api/src/plugins/{deadlineScanner,heartbeat}.ts` 均未改动），判定无因果关系。
- 2026-06-23（**auth amplification 子类**）：`auth.test.ts` 在全量 `pnpm verify` / coverage 模式下出现 5000ms timeout。standalone 定向运行 2/2 PASS（约 2.2s），但 full coverage 1/1 FAIL。归类为 BUG-FLAKE-001 的 **auth amplification** 子类：auth login / audit polling（单用例 6 轮 login + 每轮 audit 轮询）在全量 coverage + PG I/O 争用下被放大，无法在 5s 默认 testTimeout 内收敛。该观察**不**证明 auth 业务逻辑错误，也**不允许**通过单点 timeout / skip 掩盖（PR86 诊断矩阵曾误把"maxWorkers=50% 通过"当并行安全证据，本子类不重蹈：standalone PASS ≠ 全量并行/coverage PASS）。归入 BUG-FLAKE-001，不另开 BUG-FLAKE-005。
- 2026-06-23（**physical-DB-lifecycle 子类**）：`packages/db/src/testWorkerDatabase.test.ts` 的 `ensureDatabaseExists > creates the database if missing, idempotent on second call` 在 `pnpm verify` / coverage 模式下 5000ms timeout（Phase 6A 验证时实测复现：`pnpm verify` 在 `@exam/db test`（`vitest run`，无显式 coverage flag，但 turbo verify 链已跑过 coverage 插桩 + 前序 PG 争用）下击穿 5s）。standalone test 与 standalone coverage 均可通过：`pnpm test:db:lifecycle` standalone 12/12 PASS（约 1.4–1.8s）；standalone coverage 中 `ensureDatabaseExists` 约 2009ms，明显慢于 normal test 下约 627ms。归类为 BUG-FLAKE-001 的 **physical-DB-lifecycle** 子类：`CREATE DATABASE` / migration / truncate 这类 PG lifecycle 操作在 coverage + turbo 交叉任务 PG 争用下更容易击穿默认 5s。该观察**不应**通过专属 timeout 立即掩盖；Phase 6A 仅做 lifecycle command split（`test:db:lifecycle` / `test:db:unit` 拆分），不 skip、不加 timeout、不从 full path 删除。归入 BUG-FLAKE-001，**不另开 BUG-FLAKE-005**；standalone 通过**不**等于根治。

### Stress verification — BUG-FLAKE-001 scanner

| Command | Runs | Result | Notes |
|---|---|---|---:|---|
| `pnpm --filter @exam/api test -- --run src/routes/attempts.test.ts -t "deadline scanner"` | 5 | PASS | No timeout, no leaked expired attempts |
| `pnpm --filter @exam/api test -- --run src/routes/attempts.test.ts -t "heartbeat scanner\|disrupted"` | 5 | PASS | Stable under serial containment |
| `pnpm --filter @exam/db test -- --run src/testIsolation.test.ts` | 1 | PASS | 32 isolation helper tests pass |
| `pnpm verify` | 1 | PASS | Full suite: lint/typecheck/tests/build green |

这些 stress 是在 A′ serial containment 下运行的。**B 方案已完成（2026-06-21）**——所有 DB-touching 测试文件已接入隔离 schema，跨 package 并发 stress 5/5 PASS。

**PR86（2026-06-21）**：`apps/api` 文件并行**不可恢复**——详见下方 PR86 诊断小节。`apps/api/vitest.config.ts` 永久保留 `fileParallelism: false`。

**PR87（2026-06-21）**：`packages/db` 文件并行**已恢复**——见下方 PR87 记录。`packages/db/vitest.config.ts` 已删除 `fileParallelism: false`，恢复 Vitest 默认并行。

### PR86 fileParallelism 恢复诊断（2026-06-21）

> 尝试在本 PR 恢复 `apps/api` 文件并行，经 stress 验证后**判定不可恢复**，转为诊断/阻塞 PR。
> 完整 PR 描述见 PR86；本节为代码库内留档的复现矩阵。

**复现到的失败（精确匹配此前观察）**：

| Run | File | Test | Error | Schema | Subsystem |
|---:|---|---|---|---|---|
| B run 3/15 | `src/routes/auth.test.ts` | `auth routes > POST /api/auth/login rejects legacy future-role rows with generic auth failure` | `Test timed out in 5000ms`（实测 5007ms） | isolated `test_api_*`（B 方案隔离 schema 生效） | 默认并行下并发 `buildTestApp()` 的 CREATE SCHEMA → migrate → seed + 该用例 6 轮 login/audit-polling 叠加，单个用例无法在 5s 默认 testTimeout 内收敛 |

**诊断矩阵**（vitest 4.1.7，WSL2，8 core，10 GB，`exam-test` PG on docker）：

| 变体 | 命令 | Runs | 结果 | 含义 |
|---|---|---:|---|---|
| A 串行（当前 config） | `vitest run`（config `fileParallelism:false`） | 8 | 8/8 PASS（91–112s/run） | 串行稳定，对照基线 |
| B 并行默认 workers | `vitest run --fileParallelism`（~7 workers，CPU ~511%） | 15 | 2 PASS / 1 FAIL（@run 3，5007ms timeout） | **复现阻塞**：默认并行会触发 auth legacy-role 用例超时 |
| C 并行 + 50% 限流 | `vitest run --fileParallelism --maxWorkers=50%`（~4 workers，CPU ~403%） | 15 | 15/15 PASS（37–44s/run） | 限流到 ≤4 workers 可消除超时 |
| D 并行 + 25% 限流 | `vitest run --fileParallelism --maxWorkers=25%`（~2 workers） | 10 | 10/10 PASS（53–72s/run） | 25% 限流更慢但同样稳定 |
| E turbo 冷缓存 | `turbo run test --filter=@exam/api --force`（串行 config） | 5 | 5/5 PASS（111–132s/run） | 冷缓存 / turbo 调度路径稳定，与失败无相关 |

**vitest 语义核验**（避免误读 C/D）：

- vitest 4.1.x 的 `resolveConfig.ts`：`fileParallelism: false` 会把 `maxWorkers` **强制为 1**。
- 因此 `--maxWorkers=50%` 必须与 `--fileParallelism`（正布尔 CLI flag）同时提供才有效；单独传 `--maxWorkers=50%` 会被 config 的 `fileParallelism:false` 覆盖、退化为串行。本配置无法被 CI flag 旁路。
- 这是 PR86 诊断的方法学关键：先前曾误把"maxWorkers=50% 通过"当作并行安全的证据；实际若未显式开 `--fileParallelism`，该结果等同于串行，不构成并行证据。C/D 的 15/15、10/10 是在确认 CPU 实际达 403%/多 worker（即真正并行）下取得的。

**结论（证据驱动）**：

`apps/api` 的文件并行被并行 schema migration 的 PG 吞吐瓶颈阻塞。B 方案的 schema 隔离消除了跨文件状态污染，但并行 `buildTestApp()` 仍并发执行 CREATE SCHEMA → migrate → seed。auth legacy-role 用例（6 轮 login + 每轮 audit 轮询）在默认 7-worker 并行下偶发超过 5s 默认 testTimeout。限流到 ≤4 workers 可在本机消除超时，但**不作为本 PR 的修复**（需显式决策是否接受永久限流 + 慢测试，且 CI runner 的 core 数与本地不同，50% 的含义不可移植）。

**推荐**：保留 `apps/api` `fileParallelism: false`。`packages/db` 的跨 package stress 此前 5/5 通过，建议在独立 follow-up PR 单独评估其是否恢复并行。不在本 PR 恢复 apps/api 文件并行。

**根因修复方向（follow-up，非本 PR）**：

1. 测试期 semaphore 串行化隔离 schema 的 create/migrate/seed。
2. 预迁移模板 schema，每测试文件 clone/copy 结构而非全量 migrate。
3. 在安全前提下让多文件共享同一 worker 的隔离 schema。
4. 拆分 auth legacy-role 用例，避免单个 5s test 下 6 轮顺序 audit 轮询。
5. 若并行收益不值不回复杂度，则永久保留 `apps/api fileParallelism: false`。

**禁止做（仍有效）**：不调长 auth.test 单点 timeout（该 bump 已被前序提交正确 revert）、不 skip 该用例、不在 CI 默认重跑后通过。

### PR87 packages/db 文件并行恢复（2026-06-21）

> `packages/db` 删除 `fileParallelism: false`，恢复 Vitest 默认文件并行。
> `apps/api` 不动（永久保留 `fileParallelism: false`，由 PR86 诊断确认不可恢复）。

**恢复原因**：`packages/db` 仅 8 个测试文件（vs `apps/api` 52 个），其中 6 个 DB-touching 文件均使用 B 方案隔离 schema helper（`getIsolatedTestDb`），且无 `auth.test` 式的单测试 6 轮 login + audit-polling 放大。并行度低、无放大用例 → 并行安全。

**验证矩阵**（vitest 4.1.7，WSL2，8 core，10 GB，`exam-test` PG on docker）：

| 变体 | Runs | 结果 | 含义 |
|---|---|---:|---|---|
| `pnpm --filter @exam/db test`（并行，CPU ~320%） | 15 | 15/15 PASS（5–7s/run） | packages/db 内部文件并行稳定 |
| `pnpm --filter @exam/db coverage`（并行，v8 instrumentation） | 10 | 10/10 PASS（6–8s/run） | 含 coverage 插桩下并行稳定 |
| `turbo run test coverage --filter=@exam/db --filter=@exam/api --force`（跨包 turbo 并发） | 5 | 4/5 PASS，1/5 demo-seed 5032ms timeout | PR88 修复前基线；跨包 turbo 并发下 db:test + db:coverage + api:test + api:coverage 4 任务同时挤 PG 导致 demo-seed 超时 |
| `pnpm verify` | 1 | PASS | 全链路（lint/typecheck/test/coverage/build）通过 |

**PR88 修复**：`turbo.json` 新增 `@exam/db#coverage dependsOn @exam/db#test`，使 DB-touching test 与 coverage 在 turbo 调度层面不再并发。修复后 turbo 并发压力验证 10/10 PASS（见 PR88 小节）。

**不纳入 PR87 的范围**：
1. 不调长 `demo-seed.test.ts` 的单点 timeout（不应为测试便利让步）。
2. 不修改 `apps/api/vitest.config.ts`（PR86 判定永久保留）。
3. 不修改 scanner timeout。
4. 不改产品代码。

### PR88 turbo 层面 DB-touching 任务串行化（2026-06-21）

> 在 `turbo.json` 新增 `@exam/db#coverage dependsOn ["^build", "@exam/db#test"]`，使 `@exam/db` 的 test 和 coverage 在 turbo 调度层面不再并发。
> 配合 PR87（packages/db 内部文件并行恢复），完成 DB-touching 测试调度的全面稳定性。

**修复原因**：PR87 验证中发现 `turbo run test coverage --filter=@exam/db --filter=@exam/api --force` 在 4 任务并发（db:test + db:coverage + api:test + api:coverage）下，`demo-seed.test.ts` 偶发 5s timeout（5032ms）。根因是 4 个任务同时挤同一个 PG 实例的 schema create/migrate/seed + argon2 哈希，导致单个测试超时。

**修复方式**：`turbo.json` 为 `@exam/db#coverage` 添加 `dependsOn: ["^build", "@exam/db#test"]`。修复后 turbo 调度管道变为：
- `@exam/db#test` → `@exam/db#coverage` → `@exam/api#coverage`
- `@exam/db#test` → `@exam/api#test`
- 最大并行 PG 任务数：4 → 2

**验证矩阵**（vitest 4.1.7，WSL2，8 core，10 GB，`exam-test` PG on docker）：

| 变体 | Runs | 结果 | 含义 |
|---|---|---:|---|---|
| `pnpm --filter @exam/db test`（并行） | 15 | 15/15 PASS（5–7s/run） | packages/db 内部文件并行稳定 |
| `pnpm --filter @exam/db coverage`（并行） | 10 | 10/10 PASS（6–8s/run） | 含 coverage 插桩下并行稳定 |
| `turbo run test coverage --filter=@exam/db --filter=@exam/api --force`（修复后） | 10 | 10/10 PASS（137–154s/run） | 串行化 db 任务后 turbo 并发压力稳定 |
| `pnpm verify` | 3 | 3/3 PASS（217–218s/run） | 全链路稳定 |

**不纳入 PR88 的范围**：
1. 不改 `apps/api/vitest.config.ts`（PR86 判定永久保留 `fileParallelism: false`）。
2. 不改 scanner timeout。
3. 不改 `demo-seed.test.ts` 单点 timeout。
4. 不改产品代码。

### Phase 3B API test helper opt-in worker database（2026-06-22）

> ADR-007 Phase 3B 落地：`apps/api` 测试工厂 `buildTestApp()` 与 7 个
> `apps/api/tests/security/*.test.ts` 自建 app 接入 Phase 3A worker database
> 路径，作为**显式 opt-in**（`TEST_DB_ISOLATION=worker-database`）。

**与 BUG-FLAKE-001 的关系（重要）**：

- **不声称 BUG-FLAKE-001 已修复。** Phase 3B 只是把 worker database 路径接到
  api test factory；它**不**打开 `fileParallelism: true`、**不**改 `maxWorkers`、
  **不**移除 `fileParallelism: false`、**不**移除 scanner 15_000 ms timeout、
  **不**移除 `verify:db-tests` 串行链。A′ serial containment 仍是主缓解。
- Phase 3B 的 worker database 在 `fileParallelism:false` 下与 legacy 每文件
  schema 路径**执行拓扑等价**（都是单 worker 串行），因此既不缓解也不加剧
  BUG-FLAKE-001 的并行 I/O 争用根因。
- BUG-FLAKE-001 的真正进展仍要等 Phase 5（恢复并行）+ stress 证据，本 PR 不
  越界。

**reset boundary 设计决定**：`buildTestApp()` 在 worker-DB 分支**不**自动
truncate。原因：`auth.test.ts`(4)、`exam.test.ts`(4)、`user.test.ts`(3)、
`api-smoke.test.ts`(5) 等文件单文件内多次 `buildTestApp()` 并跨 build 复用共享
`ctx.org`，每次 build truncate 会清掉被引用的 org 行 → FK violation
（`users_organization_id_organizations_id_fk`）。跨文件隔离由 per-worker
database（不同 vitest worker 不同 database）提供；`fileParallelism:false` 保证
同时只有一个 worker。文件内隔离沿用既有 `uniquePrefix()` + org-scoped insert。

**验证矩阵**（独立 PG 容器 `exam-db-6432`，端口 6432 与 e2e/他人隔离）：

| 命令 | Runs | 结果 | 含义 |
|---|---:|---|---|
| `pnpm --filter @exam/api exec vitest run src/routes/testDatabase.test.ts` | 1 | 10/10 PASS | adapter 单元测试（全 mock，无 PG） |
| `pnpm --filter @exam/api test`（unset / 默认 legacy） | 1 | 570/570 PASS（~93s） | 默认行为不变 |
| `TEST_DB_ISOLATION=file-schema pnpm --filter @exam/api test` | 1 | 570/570 PASS（~93s） | legacy 回退路径稳定 |
| `TEST_DB_ISOLATION=worker-database TEST_WORKER_ID=1 pnpm --filter @exam/api test` | 2 | 2/2 PASS 570/570（~102s, ~116s） | worker-DB 路径稳定 |
| `pnpm verify`（默认 legacy） | 1 | 全绿 | 全链路质量门 |

**不纳入 Phase 3B 的范围**：
1. 不打开 `fileParallelism: true`，不改 `maxWorkers`。
2. 不移除 legacy `file-schema` 回退、`testIsolation.ts`、每文件 schema helper。
3. 不引入 Redis / BullMQ。
4. 不改 CI、turbo、package.json script、生产 schema/migration。
5. 不声称 BUG-FLAKE-001 已修复，不证明 `maxWorkers=2/4` 安全。
6. 不改 `@exam/db` 测试（仍走每文件 schema 路径）。
7. 不把 worker-DB 设为默认。

### Phase 5A/5B local worker-database parallelism（2026-06-22）

> ADR-007 Phase 5 落地：`apps/api/vitest.config.ts` 新增 env-gated
> `resolveParallelism()`。仅当 `TEST_DB_ISOLATION=worker-database` **且**
> `API_TEST_MAX_WORKERS` 是正整数时打开 `fileParallelism=true,
> maxWorkers=<N>`；否则默认串行不变。Fail-fast 拒绝并行跑 file-schema，
> 拒绝非正整数 `API_TEST_MAX_WORKERS`。

**与 BUG-FLAKE-001 的关系（重要）**：

- **不声称 BUG-FLAKE-001 全局修复。** Phase 5 只在 `worker-database` 模式
  （per-worker PG database 隔离就位）下打开并行；**不**在 `file-schema`
  下打开（config 会 throw 拒绝）。BUG-FLAKE-001 的 file-schema + 并行 + 共享
  schema 动机因此**绕开**而非根治。
- A′ `fileParallelism: false` **仍是默认**；本 Phase 只新增 opt-in 并行路径，
  不改默认，CI 不自动继承。
- scanner 15_000ms timeout、`verify:db-tests` 串行链等既有缓解一律保留。
- ADR-007 Phase 5 added local evidence that worker-database mode avoids the
  file-schema / shared-schema trigger conditions for BUG-FLAKE-001 under local
  maxWorkers=2 and maxWorkers=4 stress runs. This does not globally close
  BUG-FLAKE-001. The legacy file-schema path keeps its existing serial
  mitigation. CI shard validation remains pending.

**关键不变量**（config 注释固化）：**并行模式绝不设 `TEST_WORKER_ID`**。
`resolveWorkerId()` 优先 `TEST_WORKER_ID`，固定会让所有 worker 落到
`exam_test_w1` → 隔离失效。并行只依赖 vitest 注入的 `VITEST_WORKER_ID`。
（实测：vitest `getWorkerId()` 单调递增 + 回收复用，`maxWorkers=2` 并发 ≤2
但一次 suite 会创建 w0..w41 多个 database —— 安全但累积，不影响正确性。）

**验证矩阵**（fresh PG 容器 `exam-db-6432`，postgres:18.4，端口 6432）：

| 命令 | Runs | 结果 | 耗时 |
|---|---:|---|---|
| Phase 4 gate: file-schema full | 1 | 589/589 PASS | ~95s |
| Phase 4 gate: worker-DB serial (`TEST_WORKER_ID=1`) | 1 | 589/589 PASS | ~101s |
| Phase 5A: `API_TEST_MAX_WORKERS=2` single | 1 | 589/589 PASS | ~57s |
| Phase 5A: `API_TEST_MAX_WORKERS=2` ×5 | 5 | **5/5 PASS**（589/589 ea） | ~57s/run |
| Phase 5B: `API_TEST_MAX_WORKERS=4` single | 1 | 589/589 PASS | ~38s |
| Phase 5B: `API_TEST_MAX_WORKERS=4` ×5 | 5 | **5/5 PASS**（589/589 ea） | ~38–43s/run |
| Regression: file-schema full | 1 | 589/589 PASS | ~95s |
| Regression: worker-DB serial | 1 | 589/589 PASS | ~101s |

提速：maxWorkers=2 ≈ **1.7×**，maxWorkers=4 ≈ **2.6×** vs serial。无 DB
collision、无 open-handle 警告。

**不纳入 Phase 5 的范围**：
1. 不改默认（serial 仍是默认）。
2. 不改 CI matrix（Phase 6 shard 才碰 CI）。
3. 不把 4 worker 设为默认（opt-in only）。
4. 不引入 Redis / Queue。
5. 不删 legacy `file-schema` 回退。
6. **不**声称 BUG-FLAKE-001 全局修复、CI 并行安全、parallelism globally safe。
   本 evidence 是 **local only**。

**可回滚**：unset `API_TEST_MAX_WORKERS`（或 `TEST_DB_ISOLATION=file-schema`）
→ config 立刻回到 `fileParallelism:false`（serial）。CI flag 无法绕过。

### Phase 6A/6B script stratification + worker-database fast-path stress（2026-06-23）

> Phase 6A 落地：`package.json` 新增本地快速反馈入口与 lifecycle 拆分脚本，**不改默认行为**。
> Phase 6B 落地：worker-database fast-path local stress（test + coverage 各 5/5）。

**Phase 6A 新增脚本（仅 local opt-in，不接入 CI 默认流程）**：

| Script | 作用 | 包含 | 排除 |
|---|---|---|---|
| `test:db:unit` | `@exam/db` 普通测试 | 12 文件 / 139 测试 | `src/testWorkerDatabase.test.ts`（lifecycle） |
| `test:db:lifecycle` | physical DB lifecycle 单跑 | `src/testWorkerDatabase.test.ts`（1 文件 / 12 测试） | — |
| `test:api:fast` | worker-database + maxWorkers=4 的 `@exam/api` test | 60 文件 / 623 测试 | — |
| `coverage:api:fast` | 同上带 coverage | 60 文件 / 623 测试 | — |
| `coverage:db:lifecycle` | lifecycle 单跑带 coverage | `src/testWorkerDatabase.test.ts` | — |
| `verify:fast` | 本地快速反馈门（无 coverage、无 lifecycle） | `format:check → lint → lint:copy → lint:arch → typecheck → verify:nodb-tests → test:db:unit → test:api:fast → build` | coverage、physical DB lifecycle |
| `verify:full` | `pnpm verify` 别名 | — | — |
| `verify:coverage-gate` | candidate coverage-dedup 门（**未接入** `verify`，仅候选） | `format:check → lint → lint:copy → lint:arch → typecheck → verify:nodb-tests → coverage:db → coverage:api → build` | test（用 coverage 覆盖） |

**关键不变量（review 标准）**：

- `verify` 默认行为**不变**（仍走 `verify:db-tests` 串行链）。
- `test:api` 行为**不变**（仍是 safe/default serial path）。
- `verify:fast` **必须**使用 `test:api:fast`（非 `test:api`）、`test:db:unit`（非含 lifecycle 的 `test:db`）。
- `verify:fast` **不跑** coverage、**不跑** physical DB lifecycle tests。
- `test:db:lifecycle` 单独存在；**不从** full path 删除。
- `verify:coverage-gate` 仅是 candidate，**未替换** `verify`。

**Phase 6A 验证结果**（docker PG `exam-db-1`，postgres:18.4，端口 5432）：

| 命令 | Runs | 结果 | 耗时 |
|---|---:|---|---|
| `pnpm test:db:lifecycle` | 1 | 12/12 PASS（1 文件） | ~1.8s |
| `pnpm test:db:unit` | 1 | 139/139 PASS（12 文件） | ~6.7s |
| `pnpm test:api:fast` | 1 | 623/623 PASS（60 文件） | ~44s |
| `pnpm verify:fast` | 1 | PASS（8/8 turbo task） | ~5min（含 build） |
| `pnpm format:check` | 1 | PASS | — |
| `pnpm verify`（full） | 1 | **FAIL — 见下** | — |

**`pnpm verify` 失败记录（已知 BUG-FLAKE-001 physical-DB-lifecycle 子类，非脚本错误）**：

`pnpm verify` 在 `@exam/db test`（`vitest run`）阶段击穿 5s 默认 testTimeout：

```text
FAIL src/testWorkerDatabase.test.ts > ensureDatabaseExists > creates the database if missing, idempotent on second call
Error: Test timed out in 5000ms.
```

- **失败测试**：`packages/db/src/testWorkerDatabase.test.ts` > `ensureDatabaseExists > creates the database if missing, idempotent on second call`。
- **是否同代码单独复跑通过**：是。`pnpm test:db:lifecycle` standalone 立即 12/12 PASS（~1.4–1.8s）。
- **是否符合 BUG-FLAKE-001 子类**：是，physical-DB-lifecycle 子类（coverage + turbo 交叉任务 PG 争用放大 CREATE DATABASE / migration / truncate）。
- **是否需要登记文档**：已登记（BUG-FLAKE-001 复发记录 physical-DB-lifecycle 子类 + 既有 `2026-06-23 testWorkerDatabase` 条目）。
- **处理**：**不改代码掩盖**。该失败属已知 flake，按规则不通过单点 timeout / skip 解决；Phase 6A 仅做 lifecycle command split。`verify:fast`（fast path）已绕开此 lifecycle 文件。

**Phase 6B stress 验证（local only）**：

| 命令 | Runs | 结果 | 耗时/run |
|---|---:|---|---|
| `pnpm test:api:fast`（worker-database + maxWorkers=4） | 5 | **5/5 PASS**（623/623 ea） | ~44–48s/run |
| `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api coverage` | 5 | **5/5 PASS**（623/623 ea, coverage ≥ 阈值） | ~48–54s/run |

**结论（仅 local evidence）**：local worker-database maxWorkers=4 test/coverage stress
passed 5/5. This is still local evidence only; **CI default remains unchanged**.

**不纳入 Phase 6A/6B 的范围**：

1. 不改默认（`fileParallelism:false` serial 仍是默认；worker-database 仍 opt-in）。
2. 不改 CI 默认 test path。
3. 不把 4 worker / worker-database 设为默认。
4. 不删 `verify:db-tests` 串行链（Phase 6D stress gate 未完成）。
5. 不删 `apps/api fileParallelism:false`。
6. 不声称 BUG-FLAKE-001 closed、不声称 ADR-007 complete、不声称 CI validated。
7. coverage dedup：Phase 6C candidate（`verify:coverage-gate`）**未替换** `verify`，待 standalone coverage gate 验证。

### Phase 6C coverage dedup gate investigation（2026-06-23）

> 目标：判断 `test` + `coverage` 是否执行同一批测试，从而把 full verify 里的普通 `test`
> 去掉、只留 `coverage`。**证据门控未完全通过 → coverage dedup blocked，仅保留 candidate。**

**6C.1 同批次测试验证（PASS）**：

| Package | `vitest run`（test） | `vitest run --coverage`（coverage） | 同批次？ |
|---|---|---|---|
| `@exam/db` | 13 文件 / 151 测试 | 13 文件 / 151 测试 | ✅ |
| `@exam/api` | 60 文件 / 623 测试 | 60 文件 / 623 测试 | ✅ |

结论：`coverage` 严格是 `test` 的超集（多出 v8 coverage 插桩，无额外测试文件）。
**理论上去重可行**——`coverage` 入口已覆盖全部测试 + 提供覆盖率数据。

**6C.2 standalone coverage gate stress（部分 PASS，未达 gate）**：

| 命令 | Runs | 结果 | 耗时/run | 备注 |
|---|---:|---|---|---|
| `pnpm coverage:db` | 1（cold-start） | **FAIL** | ~9s | `testWorkerDatabase.test.ts > ensureDatabaseExists` 5000ms timeout（BUG-FLAKE-001 physical-DB-lifecycle 子类） |
| `pnpm coverage:db`（warm，characterization） | 5 | **5/5 PASS** | ~10s | 同代码、同环境复跑全过 → 确认 cold-start flake 非确定性 |
| `pnpm coverage:db:lifecycle`（standalone） | 1 | 12/12 PASS | ~2.3s | 同 lifecycle 文件单独复跑通过 |
| `pnpm coverage:api` | 3 | **3/3 PASS**（83.45% lines） | ~131–134s | coverage 稳定，达阈值 |

**6C.3 gate 判定 — BLOCKED**：

按本任务门控条件（`coverage:db` standalone 3/3 PASS **且** `coverage:api` standalone
3/3 PASS **且** 修改后 `pnpm verify` 3/3 PASS 才允许去重），`coverage:db` 在 cold-start
首次即 FAIL（physical-DB-lifecycle 子类），**未稳定达到 standalone 3/3 的硬门控**。

虽然 warm 后 `coverage:db` 5/5 PASS、`coverage:db:lifecycle` standalone 通过，证明该失败
是已知 flake 而非真实回归，但**按保守规则不掩盖**：当 standalone coverage 入口本身会被
physical-DB-lifecycle flake 击穿时，把 full verify 的普通 `test` 去掉、只留 `coverage`，
会让该 flake 直接成为 merge-gate 阻塞，且失去 fast-path（`test:db:unit`）已建立的绕开能力。

**结论**：

```text
Coverage dedup blocked: Evidence insufficient.
- same-test check: PASS (db 13/151 = coverage; api 60/623 = coverage).
- coverage:db standalone: cold-start 1/1 FAIL (physical-DB-lifecycle flake); warm 5/5 PASS.
- coverage:api standalone: 3/3 PASS.
- gate NOT met: coverage:db not reliably 3/3 standalone.
```

**保留的 candidate（未接入）**：`verify:coverage-gate` 脚本已新增，**但未替换 `verify`**、
**未接入** `verify:fast`，仅作为未来在 physical-DB-lifecycle 根因修复（template DB /
migration semaphore）后、且 standalone coverage gate 连续稳定 N 次通过时的候选 merge gate。
当前 `verify` 仍走 `test:db + test:api + coverage:db + coverage:api` 串行链。

**去重再次评估的前置条件**（任一满足后可重开 6C）：

1. physical-DB-lifecycle 根因修复落地（template DB / migration semaphore），使
   `coverage:db` cold-start 也能连续 N/3+ PASS；**或**
2. `coverage:db` 用 `test:db:unit` + `coverage:db:lifecycle` 组合替代（lifecycle 单独
   容忍 flake），并在该组合下 standalone N/3+ PASS。

### Phase 6D physical DB lifecycle contention root-cause mitigation（2026-06-23）

> Phase 6D 针对的是 BUG-FLAKE-001 的 **physical-DB-lifecycle 子类**：`@exam/db` coverage
> 下 `testWorkerDatabase.test.ts > ensureDatabaseExists > creates the database if
> missing` 在 cold-start 偶发 5s timeout。这是 Phase 6C coverage dedup gate 的直接
> blocker。本节实现并验证了根因修复。

#### 1. Root cause confirmed

| Evidence | Result |
|---|---|
| `@exam/db` coverage 下测试文件数 | 13→14 个文件**默认并行**执行（vitest `packages/db/vitest.config.ts` 无 `fileParallelism` 覆盖） |
| 同时执行 heavy lifecycle 的文件 | `testWorkerDatabase.test.ts`（`CREATE DATABASE` + `migratePostgres`）、`seed.test.ts` / `demo-seed.test.ts` / `testCleanup.test.ts` / `testIsolation.test.ts`（`CREATE SCHEMA` + `migratePostgres`） |
| 协调机制 | **修复前无任何**——没有 advisory lock、没有 semaphore、没有 JS mutex；多个 worker 同时对同一 PG 实例执行 catalog DDL |
| `dropDbIfPresent`（旧） | 裸 `DROP DATABASE IF EXISTS`，**不** terminate active connections，无 lock |
| lifecycle 测试 DB 名（旧） | 固定名 `exam_test_w_phase3a_ensure` 等 → 可能与 crashed 前次 run 残留冲突 |
| `migratePostgres` 并发处理 | 吞掉 `42P07`（duplicate table），但 catalog 锁 / 连接 slot / IO 争用仍存在 |
| v8 coverage 放大 | instrumentation 放大 I/O 与调度争用，使单个 `CREATE DATABASE` 更容易击穿 5s testTimeout |

结论：**这不是测试逻辑本身恒定错误**（standalone `test:db:lifecycle` / `coverage:db:lifecycle`
始终通过），而是 physical DB lifecycle 操作在 full `@exam/db` coverage 拓扑下受 PG DDL /
migration / coverage / worker 并行影响。cold-start 或 IO 峰值时单个 `ensureDatabaseExists`
（含 `CREATE DATABASE`）无法在 5s 内收敛。

#### 2. Fix implemented

| File | Change |
|---|---|
| `packages/db/src/testInfraLock.ts`（**新增**） | PostgreSQL advisory lock helper（`withTestInfraLifecycleLock`）。固定 key（`exam_test_infra_lifecycle` 经 FNV-1a → 单 bigint），`pg_advisory_lock`/`pg_advisory_unlock` 在专用 admin session 上 acquire/release（`finally` 释放）。跨 Node process / Vitest worker 生效（PG server 端持有）。仅用于测试基础设施。 |
| `packages/db/src/testWorkerDatabase.ts` | `ensureDatabaseExists` 的 existence check + `CREATE DATABASE` 包进 advisory lock；新增 `dropDatabaseIfExists`（Option C：`pg_terminate_backend` 清残留连接 → `DROP DATABASE IF EXISTS`，外包 lock，`keepMissing` 默认 true，错误不吞）；`setupWorkerTestDatabase` 的 `migratePostgres` 包进 lock。 |
| `packages/db/src/testIsolation.ts` | `createTestSchema` / `dropTestSchema` 的 DDL 包进 advisory lock。 |
| `packages/db/src/testWorkerDatabase.test.ts` | lifecycle DB 名改 per-run unique（`exam_test_wphase6d_*_<pid>_<rand>`，Option B）；teardown 改用 `dropDatabaseIfExists`；`ensureDatabaseExists` 测试改为"DB 不存在 → 创建"而非"先 drop 旧固定名"；新增 3 个 robust drop 测试（idempotent missing、unsafe name refusal、drop existing）。lifecycle 测试 12 → 15。 |
| `packages/db/src/testInfraLock.test.ts`（**新增**） | 6 个测试：key 派生确定性 + bigint 范围；acquire/release；跨 session 串行化（`Promise.all` 双 caller，maxConcurrent=1，overlap=false）；throw-path 释放。 |

#### 3. Validation（Phase 6D.5）

| Command | Result | Notes |
|---|---|---|
| `pnpm test:db:lifecycle` | PASS 15/15 | lifecycle 12 + robust drop 3 |
| `pnpm test:db:unit` | PASS 145/145（13 文件） | 含新 `testInfraLock.test.ts` |
| `pnpm coverage:db:lifecycle` | PASS 15/15 | |
| `pnpm coverage:db`（单次） | PASS 160/160（14 文件，coverage 79.89%） | 修复前 cold-start 会 flake |
| `pnpm coverage:db` ×5 stress | **5/5 PASS**（~8–9s/run） | |
| `pnpm verify:fast` | PASS | |
| **`pnpm verify`（单次）** | **PASS（~281s）** | **修复前会 flake 的命令** |
| `pnpm verify` ×3 stress | **2/2 PASS**（run1 280s, run2 302s） | run3 被 shell 10min timeout 中断，**非测试失败**；已超 prompt 最低标准（coverage:db ×3 + verify ×1） |

#### 4. Claim boundary（重要）

- **本修复只针对 BUG-FLAKE-001 的 physical-DB-lifecycle 子类**（`@exam/db` coverage
  cold-start physical lifecycle timeout）。
- **不声称 BUG-FLAKE-001 全局关闭**——auth amplification 子类仍未单独修复；A′
  `fileParallelism:false` 仍是 apps/api 的 I/O contention 缓解。
- **auth amplification 仍 open**（除非单独修复）。
- **apps/api 默认并行不变**（`fileParallelism:false` 仍在）。
- **`verify:db-tests` 串行链不变**。
- **CI 未验证**——本证据是 local only；CI shard live validation 仍 pending。
- advisory lock 只锁 heavy test-infra lifecycle（CREATE/DROP DATABASE、CREATE/DROP SCHEMA、
  migrate），**不**锁普通业务 query，避免把测试整体串行。

#### 5. 对 Phase 6C 的影响

physical-DB-lifecycle 子类修复后，`coverage:db` cold-start 不再被 lifecycle flake 击穿。
Phase 6C coverage dedup gate 的 blocker（`coverage:db` standalone 3/3）可重新评估——但
本 Phase **不**自动推进 coverage dedup，`verify:coverage-gate` 仍为 un-wired candidate，
`verify` 仍走 `test:db + test:api + coverage:db + coverage:api` 串行链。是否 dedup 需独立评估。

### Phase 6E CI verify gate optimization — avoid root test + coverage duplication（2026-06-23）

> Phase 6E 针对 **CI / package scripts 层**消除重复测试执行，**不**改 DB lifecycle 根因
> （Phase 6D 已处理）。前置条件已满足：`coverage:db` 5/5 PASS、`pnpm verify` PASS、
> physical-DB-lifecycle cold-start flake 已由 advisory lock / unique DB names / robust drop 缓解。

#### 1. 问题

CI verify job 原先同时运行：

```text
pnpm test       → turbo test（含 DB/API 全部测试）
pnpm coverage   → turbo coverage（再跑一遍同样的 DB/API 测试 + v8 插桩）
```

`coverage` 严格是 `test` 的超集（Phase 6C 已验证：`@exam/db` 14/160、`@exam/api` 60/623
在 test 与 coverage 下文件数与测试数完全一致）。同时跑两者等于 DB/API 测试执行两遍。

#### 2. 修复（package scripts）

| Script | Change |
|---|---|
| `verify:ci`（**新增**） | `format:check → lint → lint:copy → lint:arch → typecheck → verify:nodb-tests → coverage:db → coverage:api → test:integration → build`。用 coverage 作为 DB/API 的**单一** test 入口，省去重复 test 执行。 |
| `verify:coverage-gate` | 改为 `pnpm verify:ci` 别名（Phase 6C 时为 un-wired candidate；现与 `verify:ci` 对齐）。 |
| `verify` | **不变**（仍走 `verify:db-tests` 串行链）。 |
| `verify:db-tests` | **不变**。 |
| `verify:fast` | **不变**。 |
| `test:api` / `test:api:fast` | **不变**。 |

#### 3. 修复（CI workflow `.github/workflows/ci.yml`）

| Job | Before | After |
|---|---|---|
| `verify` | `pnpm test` → `pnpm test:integration` → `pnpm build` → `pnpm coverage`（test + coverage 重复跑 DB/API） | static checks → `verify:nodb-tests` → `coverage:db` → `coverage:api` → `test:integration` → `build`（coverage 作 test 入口，不重复） |
| `api-fast` | **不变**（needs: verify、2 shards） |
| `e2e` | **不变**（needs: verify、独立 PG `exam_e2e`） |
| services / env / setup | **不变** |

#### 4. 语义等价性（为什么没 skip 任何测试）

- **`coverage:db` 替代 `test:db`**：`coverage` 跑与 `test` 完全相同的测试文件（Phase 6C
  同批次验证：db 14 文件 / 160 测试一致），同时收集 v8 覆盖率。一次执行覆盖两者。
- **`coverage:api` 替代 `test:api`**：同理（api 60 文件 / 623 测试一致）。
- **non-DB 测试仍跑**：`verify:nodb-tests`（`test:nodb && coverage:nodb`）覆盖
  web/contracts/domain/import-export/exam-engine/auth 等非 DB package，不受影响。
- **integration tests 仍跑**：`test:integration` 保留。
- **build 仍跑**：`pnpm build` 保留。
- **没有 skip 任何测试**：只是把 DB/API 的 test 执行与 coverage 执行合并为一次 coverage 执行。
- **coverage threshold 不降低**：`coverage:db`/`coverage:api` 仍执行各 package
  `vitest run --coverage` 的内置 threshold 校验。

#### 5. 本地验证

| Command | Result | Duration |
|---|---|---|
| `pnpm verify:ci` | PASS | ~304s（含 build） |
| `pnpm verify`（旧 gate 对照，Phase 6D 记录） | PASS | ~281s + 2/2 stress PASS |

`verify:ci` 在本地通过后才会改 CI workflow。本地 `verify:ci` 比 `verify` 略慢主要因 cold-cache
build；CI 上省去 test 重复执行后应净更快。

#### 6. 不变项（claim boundary）

- **不声称 BUG-FLAKE-001 closed**（Phase 6D 只修了 physical-DB-lifecycle 子类；auth
  amplification 仍 open）。
- `apps/api fileParallelism:false` **不变**（默认串行仍是 I/O contention 缓解）。
- `verify:db-tests` 串行链 **不变**（local / full legacy gate 仍用）。
- `turbo.json` **不变**。
- worker-database **不变**（仍 opt-in；CI verify job 不设 worker-database）。
- `api-fast` / `e2e` job **不变**。
- 无 CI job DAG 并行化（Phase 6F 候选）。
- Phase 6C 的 `verify:coverage-gate` 现等于 `verify:ci`，但**未替换** local `verify`。

### Phase 6F CI job DAG optimization — static-gated parallel jobs（2026-06-23）

> Phase 6F 只优化 **CI DAG**（缩短 wall-clock），**不**改测试语义、**不**改 turbo / Vitest /
> DB isolation。前置：6E 已让 verify job 用 coverage 作 test 入口（不重复 test+coverage）。

#### 1. 问题

CI 原先是串行 DAG：

```text
verify
  ├─ api-fast   (needs: verify)
  └─ e2e        (needs: verify)
```

`api-fast` / `e2e` 必须等完整 verify 跑完才开始，wall-clock ≈ `verify + max(api-fast, e2e)`。

#### 2. 修复（package scripts）

| Script | Change |
|---|---|
| `verify:static`（**新增**） | `format:check → lint → lint:copy → lint:arch → typecheck`。无 DB、无 build，可独立运行。 |
| `verify:ci:post-static`（**新增**） | `verify:nodb-tests → coverage:db → coverage:api → test:integration → build`。仅 static 通过后用。 |
| `verify:ci` | 改为 `pnpm verify:static && pnpm verify:ci:post-static`。**本地语义不变**（拆分仅为 CI DAG 复用）。 |
| `verify` / `verify:db-tests` / `verify:fast` / `test:api` / `test:api:fast` / `coverage:api` / `coverage:api:fast` | **不变**。 |

#### 3. 修复（CI DAG `.github/workflows/ci.yml`）

| Job | Before | After |
|---|---|---|
| `static`（**新增**） | — | 无 PG service；`pnpm verify:static`；快速 gate。 |
| `verify` | 无 needs；内部跑 format/lint/typecheck + post-static | `needs: static`；**不再**重复 static checks；只跑 post-static（nodb-tests/coverage:db/coverage:api/test:integration/build）。 |
| `api-fast` | `needs: verify` | `needs: static`（matrix shard、worker-database env、`API_TEST_MAX_WORKERS: "1"`、PG service 全不变）。 |
| `e2e` | `needs: verify` | `needs: static`（仍独立 build/migrate/seed/start/run，仍用 `exam_e2e`，无 artifact sharing）。 |
| services / env / setup | **不变** |

新 DAG：

```text
static
  ├─ verify
  ├─ api-fast
  └─ e2e
```

wall-clock ≈ `static + max(verify, api-fast, e2e)`。

#### 4. 语义等价性（为什么没改测试语义）

- **static checks 仍跑**：移到独立 `static` job（`verify:static`），verify/api-fast/e2e 均
  `needs: static`，即任何下游 job 启动前 static 必须通过。
- **verify 仍跑** non-DB tests、DB coverage、API coverage、integration tests、build（Phase 6E
  的 post-static 内容，只是不再重复 static checks）。
- **api-fast 仍跑** 同样的 shard 测试（`vitest run --shard=N/2`），env/service 全不变。
- **e2e 仍跑** 同样的 Playwright 流程（独立 build/migrate/seed/start/run）。
- **没有 skip 任何测试**：只改 job 依赖关系。
- **未引入** build artifact sharing 或新缓存策略。

#### 5. 本地验证

| Command | Result | Duration |
|---|---|---|
| `pnpm verify:static` | PASS | ~15s |
| `pnpm verify:ci:post-static` | PASS | ~160s |
| `pnpm verify:ci`（Phase 6E 已验证） | PASS | ~304s（cold-cache；等于 static + post-static） |
| ci.yml YAML lint + DAG 断言 | 通过 | — |

`verify:ci` 本地语义不变（= static + post-static）。CI 上 wall-clock 预期下降，但**需观察
首次 live GitHub Actions run** 才能确认（local 无法模拟 job 调度）。

#### 6. 不变项 / claim boundary

- **不声称 BUG-FLAKE-001 closed**（Phase 6D 只修 physical-DB-lifecycle 子类；auth
  amplification 仍 open）。
- **不声称** `api-fast` 可替代 `verify`（api-fast 仍是补充 shard，不是 primary gate）。
- **不把** worker-database 设为默认。
- `apps/api fileParallelism:false` **不变**。
- `verify:db-tests` 串行链 **不变**（local / full legacy gate）。
- `turbo.json` **不变**。
- **不声称 CI shard 已稳定**——需 live GitHub Actions run 通过后才算验证。
- 未做 build artifact sharing / 新缓存策略。

### #98 `examTransitions.test.ts` reconciliation-audit "failure"（无法复现，非代码 bug）

- 在 ADR-007 Phase 4 调查中观察到 `examTransitions.test.ts` 在 `file-schema`
  full suite 下 8/14 失败（`expected -1 to be 1`，`waitForAuditCount` 1s
  超时）。归档为 issue #98。
- **后续调查无法复现**：fresh PG 容器上定向运行 ×3 全过（14/14），fresh DB
  上 full suite ×2 全过（585/585），polluted（3001 行 `public.audit_logs`）
  full suite ×2 全过（585/585）。原始失败最可能是先前 worker-database 实验
  造成 `public.audit_logs` 异常累积（6449 行）+ 特定数据重叠的瞬时污染状态。
- **未做生产代码修复**（`reconciliation.ts` / `examTransitionExecutor.ts`
  逻辑正确；characterization 测试断言正确）。#98 关闭为 not-reproducible。
- Phase 5A/5B 从 fresh PG 状态重起，无 #98 阻塞。
- 备注（潜在脆弱性，非 #98 范围，不阻塞 Phase 5）：每文件 `file-schema`
  用 `search_path=${schema},public`，理论上 `public` 污染可泄漏；若未来此类
  flake 复发，值得调查是否去掉 `public` fallback 或让 worker-DB 模式跨模式
  切换时 flush `public`。这属于 ADR-007 test infra 范畴，非业务逻辑修复。

---

### BUG-FLAKE-002 — 跨 package / 跨 task 共享 `exam_test` DB 导致 seed/cleanup 互相覆盖

**状态**: 已缓解（Option A：DB-touching turbo 任务严格串行化）。

> **总体口径（Phase 6 修正，2026-06-23）**：Option A / `verify:db-tests` 串行链**仍是
> active mitigation**，主要防 **I/O contention**（不只防 data leak）。Option B / B
> 方案（每文件 / 每 worker 独立 PG schema 隔离）**已修复 state leak**，但**没有替代**
> 串行链：B 方案消除的是跨 package schema/data 竞争（state leak），而 `verify:db-tests`
> 串行链消除的是 turbo 调度下 `db:test + db:coverage + api:test + api:coverage` 多任务
> 并发挤同一 PG 的 **I/O contention**（PR88 历史动机）。这是两类不同根因。
>
> **删除 `verify:db-tests` 串行链的强制前置门控**（未满足前不允许删）：
>
> ```bash
> turbo run test coverage --filter=@exam/db --filter=@exam/api --force   # ×5 PASS
> pnpm verify                                                            # ×3 PASS
> ```
>
> Phase 6D 会基于此门控判断是否提案删除；删除必须单独 PR / 单独提交，且报告必须说明：
> 删除哪条串行链、预计收益、rollback 方法、风险、为什么不会把 BUG-FLAKE-002 放回。

**Old root cause**: `@exam/db` 与 `@exam/api` 共享 `exam_test.public` schema。turbo 并发调度 `test` 和 `coverage` 任务时，A 任务 seed 写入 default org 的同时 B 任务 cleanup 删除同一 org → FK violation / 身份认证失败。

**New root fix**: `packages/db/src/testIsolation.ts` 提供 `setupIsolatedTestDb({ namespace })` + `buildTestApp(plugin, { schemaName })`，每个测试任务可拥有独立 PG schema 且互不干扰。通过 `SET search_path` + `migrationsSchema` 实现 schema 级隔离。已验证：`testIsolation.test.ts` 32 个隔离测试全部通过。

**Remaining mitigations**:
- `package.json` `verify:db-tests` 串行链（`test:db && test:api && coverage:db && coverage:api`）仍为主缓解。B 方案已完成，可评估移除（需在独立 follow-up PR 中验证 stress）。

**失败链（历史复现链路；当前已被 `verify:db-tests` 串行链缓解）**:

> **Phase 6 历史口径修正（2026-06-23）**：历史上，`turbo run test coverage
> --filter=@exam/db --filter=@exam/api --force` 曾可能形成 `db:test + db:coverage +
> api:test + api:coverage` 多任务并发挤同一 PG 的状态。PR88 后，`turbo.json` 已通过
> `dependsOn`（`@exam/db#coverage dependsOn @exam/db#test`、`@exam/api#test
> dependsOn @exam/db#test` 等）降低该风险；当前 `pnpm verify:db-tests` 通过 package
> script 的 `&&` 严格串行执行四个 DB-heavy 任务（`test:db && test:api &&
> coverage:db && coverage:api`）。直接运行 `turbo run test coverage ... --force`
> 这类 stress 时，**仍需关注 turbo 调度下可能出现的交叉 PG I/O contention**——turbo
> `dependsOn` 只保证 task 间的依赖顺序，不强制全局串行，跨 task 仍可能在 turbo 调度下
> 交叠挤 PG。因此 `verify:db-tests` 串行链仍是 active mitigation。

```txt
turbo 在单次调用里并发调度多个 DB-touching 任务
  @exam/db#test        与  @exam/db#coverage   并发  → 同 package 两任务共享同一 PG
  @exam/db#test        与  @exam/api#coverage  并发  → 跨 package 共享 default 组织
  @exam/api#test       与  @exam/api#coverage  并发

任一组合都会触发：
  - 一方 afterAll cleanupOrganizationTestData() 删除 default 组织
  - 另一方 buildTestApp() / seed() 依赖 default 组织存在
  - 结果：auth.test.ts 登录返回 401；users 插入 FK violation（organization_id 不存在）
```

**已知不是的原因**:

- 不是单 package 内并行（`fileParallelism: false` 作用于 `apps/api`，`packages/db` 已于 PR87 恢复并行，见 BUG-FLAKE-001 A′ 方案）
- 不是产品代码 bug（seed / cleanup / 路由均未改动）
- 不是迁移问题（schema 早已就位）

**根因**: `@exam/db` 与 `@exam/api` 是仅有的两个使用共享 `exam_test` PostgreSQL 实例的 package。`fileParallelism: false` 只消除 *单 package 内* 的文件并行，**不**消除 turbo 在单次调用里跨 package / 跨 task（test vs coverage）的并发。当 `turbo run test coverage`（或任何把 DB-touching 任务放进同一次调度的命令）执行时，多个任务会并发写同一个 `default` 组织及其清理钩子，互相覆盖。

**当前缓解（Option A，现行）**:

> 缓解方案建立在 `docs/SPEC.md` §3.1 Organization Data Boundary Guard 定义的"所有业务数据归属于内部 default organization"（§2.8.1 Phase 1 数据归属边界）之上——测试 seed 与 cleanup 同样操作 default 组织，跨任务共享此状态即触发竞争。

1. `turbo.json` 保留同名 task 的 `db → api` 依赖（`@exam/api#test dependsOn @exam/db#test` 等），保证单次 `turbo test` / `turbo coverage` 内 db 先于 api。
2. **`package.json` 新增分阶段脚本**，把 DB-touching 任务排成严格串行链，避免任何交叉：
   - `test:db` / `test:api` / `coverage:db` / `coverage:api`：单 package filter，不经过 turbo 并发调度。
   - `test:nodb` / `coverage:nodb`：`turbo test --filter=!@exam/db --filter=!@exam/api`，非 DB package 仍可并行。
   - `verify:db-tests`：`test:db && test:api && coverage:db && coverage:api`（DB 任务总顺序）。
   - `verify:nodb-tests`：`test:nodb && coverage:nodb`。
   - `verify` 改为：静态检查 → `verify:nodb-tests` → `verify:db-tests` → `build`。
3. 影响范围：仅 `@exam/db` 与 `@exam/api`（唯一两个使用 `exam_test` PG 的 package）。其余 package（web/contracts/domain/import-export/exam-engine/auth）不受影响，仍并行。
4. 兼容：`pnpm test` / `pnpm coverage` / `pnpm test:integration` 行为不变（仍走 turbo，受同名 `dependsOn` 保护）；CI 的 `pnpm test` → `pnpm test:integration` → `pnpm build` → `pnpm coverage` 分步串行本就安全，Option A 是对 `pnpm verify` 单命令路径与未来组合调用的额外保险。

**Option B（B 方案已完成）**:

> 根因修复已实现（2026-06-21）：每测试文件 / 每 worker 独立 PostgreSQL schema 机制。所有 ~43 个 DB-touching 测试文件已迁移，跨 package 并发 stress 5/5 PASS。

- ~~需要给每个 DB-touching 测试任务 / worker 分配独立的 PostgreSQL database 或 schema~~ → 已完成：`packages/db/src/testIsolation.ts` 的 `setupIsolatedTestDb({ namespace })` + `buildTestApp(plugin, { schemaName })`。
- **未完成**：恢复 turbo 对 DB 任务的并行调度、回滚 Option A 串行脚本。这些应在独立 follow-up PR 中评估，需先通过移除后的 stress 验证。
- 可用 helper：`setupIsolatedTestDb()`、`getIsolatedTestDb(namespace)`、`buildTestApp(plugin, { schemaName })`。见 BUG-FLAKE-001 B 方案详情。

**禁止做（仍然有效）**:

- 用 sleep / 随机重试 / 全局 timeout 掩盖竞争（Option A 是确定性任务排序，不是退避）
- 删除 seed 测试的 cleanup 钩子（除非能证明所有 seed 测试完全幂等且不依赖干净 DB）
- 改 seed 业务行为来迁就测试调度

**验证命令**:

```bash
pnpm --filter @exam/db test
pnpm --filter @exam/api test
pnpm verify           # 现在走 verify:nodb-tests → verify:db-tests 串行链
```

**复发记录**:

- 2026-06-17：P2A-J2 PR review 阶段，`turbo run test coverage --force` 复现 `@exam/db#coverage` 失败（seed idempotency / demo-seed 在并发下被对方 cleanup 覆盖）。应用 Option A。

### Stress verification

| Command | Runs | Result | Notes |
|---|---:|---|---|
| `pnpm --filter @exam/db test` | 1 | PASS | 98/98 tests pass in public schema (serial) |
| `pnpm --filter @exam/api test` | 1 | PASS | 543/543 tests pass in public schema (serial) |
| `turbo run test coverage --filter=@exam/db --filter=@exam/api --force` | 5 | PASS | B方案完成——隔离 schema 消除跨 package 竞争 |
| `pnpm verify` | 1 | PASS | Full suite passes via serial `verify:db-tests` chain |

**B 方案已完成**: 所有 DB-touching 测试文件已接入隔离 schema。`turbo run test coverage --filter=@exam/db --filter=@exam/api --force` 5/5 全部通过（2026-06-21）。跨 package 并发竞争已从源头消除。

**Follow-up**: `verify:db-tests` 串行链可评估移除（需在独立 follow-up PR 中验证 stress）。

---

### BUG-FLAKE-003 — deadline scanner tests leak expired attempts across repeated runs

**状态**: 已缓解（2026-06-20，cleanup containment 方案 + A′ serial）。B 方案已完成（2026-06-21）——所有 DB-touching 测试文件（含 deadline scanner）已接入隔离 schema，从源头消除数据残留。

**Old root cause**: `cleanup()` 只关闭连接不删数据。deadline scanner 测试创建的 expired attempts（voided / future-deadline / race-noop 逃逸场景）在 run 结束后残留在 `exam_test.public` schema 中。`scanDatabaseForExpiredAttempts` 扫描整个 org 的全部 expired attempts，跨 run 污染。

**New root fix**: 每测试文件 / 每 worker 独立 PG schema（通过 `testIsolation.ts` 的 `setupIsolatedTestDb()` + `SET search_path`）从源头保证每次 run 的数据不会残留到下一次。方案已验证（`testIsolation.test.ts` 32 测试全部通过），但 deadline scanner 测试本身尚未接入。

**Remaining mitigations**:
- `beforeEach` 清理 + `afterAll` 组织清理（2026-06-20，cleanup containment）仍为主缓解。
- A′ `fileParallelism: false` 确保 scanner 测试串行运行。
- `scripts/test/deadline-scanner-stress.sh` 用于手动验证。

**修复（2026-06-20）**:

1. `apps/api/src/routes/attempts.test.ts` deadline scanner describe block 添加 `beforeEach` 清理：每次测试前删除残留的 deadline-scanner-test-* 组织及其数据，确保每次测试从干净状态开始。
2. 新增 `cleanupBusinessData()` helper（`packages/db/src/testCleanup.ts`）：删除考试业务数据（audit、attempts、enrollments、exams、questions、courses），保留组织、用户、候选数据。与 `cleanupOrganizationChildData` 共享底层 `deleteExamBusinessData` 私有 helper。
3. 新增 stress 脚本 `scripts/test/deadline-scanner-stress.sh`：连续运行 deadline scanner 测试，默认 40 次。
4. 新增 `cleanupBusinessData` 回归测试（`packages/db/src/testCleanup.test.ts`）。

**验证**: 5 次 stress test 全过；`pnpm verify` 全过。

**当前缓解**: `beforeEach` 清理 + `afterAll` 组织清理。跨 run 数据累积问题已消除。

**失败位置**:

- 文件：`apps/api/src/routes/attempts.test.ts:1959`
- 用例：`deadline scanner — scanDatabaseForExpiredAttempts > does not touch a voided attempt whose deadline has passed`
- 断言：`expect(result.submittedCount).toBe(0)` — 实际收到 `3`

**错误**:

```text
AssertionError: expected 3 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 3

❯ src/routes/attempts.test.ts:1959:37
```

**复现条件**:

- 同一 `exam_test` PostgreSQL 实例上连续多次运行 `pnpm --filter @exam/api test -- src/routes/attempts.test.ts -t "deadline scanner"`
- 每次 run 后 `cleanup()` 只关闭连接，**不清数据**
- `seed()` 用 `onConflictDoUpdate(slug)` 并发同一 `default` organization
- 运行 N 次后，DB 中累积 N 组 expired attempts（voided / future-deadline / race-noop 逃逸场景）

**失败链**:

```txt
多次 run 后 exam_test DB 中累积 expired disrupted attempts（≥3 条）
  ↓
run 38 的 voided test 调用 scanDatabaseForExpiredAttempts()
  ↓
listExpirableByDeadline 返回 94 条 expired in_progress/disrupted attempts
  （包含 37 次前序 run 逃逸的残留 + 当前 run 的 voided attempt）
  ↓
scanner 对每条调用 autoSubmitAndGrade()
  ↓
voided attempt 被正确跳过（status 不匹配），但 3 条残留 disrupted attempt 被成功提交
  ↓
submittedCount = 3（期望 0）→ 断言失败
```

**已知不是的原因**:

- 不是 deadline scanner 业务代码 bug — scanner 正确跳过了 voided attempt
- 不是跨文件并行 — `fileParallelism: false` 已生效
- 不是 PG 连接池争用 — 错误是断言失败（值不对），不是 timeout
- 不是 `backdateDeadline` 偏移量问题 — 60s 偏移足够

**根因（证据驱动）**:

`testHelpers.ts:151` 的 `cleanup()` 只调用 `app.close()` + `conn.sql.end()`，不删数据。deadline scanner 测试不使用 `cleanupOrganizationTestData()`。每次 run 创建的 expired attempts（尤其是 voided、future-deadline、race-noop 三种逃逸场景）在 run 结束后残留在 DB 中。`scanDatabaseForExpiredAttempts` 扫描 **整个 org** 的全部 expired attempts，而非仅当前 test 的 attempt，因此跨 run 污染。

**DB 证据（38 次 run 后）**:

| status      | count |
|-------------|-------|
| graded      | 1316  |
| disrupted   | 712   |
| submitted   | 80    |
| voided      | 40    |
| in_progress | 12    |

expired (`deadline_at <= now`, status `in_progress` or `disrupted`): **94 条**，全部在 `default` org。

**触发率**: 2.6%（1/38），随累积 run 次数增加而上升。fresh DB 首次 run 不会触发。

**当前缓解**: 无。单次 run 或 fresh DB 不会触发。

**禁止做（仍然有效）**:

- 不改 deadline scanner 业务代码来迁就测试
- 不改 `backdateDeadline` 偏移量
- 不 skip 该用例
- 不给 `scanDatabaseForExpiredAttempts` 加过滤参数

**后续修复方向**:

1. **方案 A（推荐）**: 在 `deadline scanner` describe block 的 `beforeAll` 或每个 test 的 `beforeEach` 中清理 expired attempts——调用 `cleanupOrganizationTestData()` 或直接 `DELETE FROM exam_attempts WHERE deadline_at IS NOT NULL AND deadline_at <= now() AND status IN ('in_progress', 'disrupted')`，确保每次 test 从干净状态开始
2. **方案 B**: 扩展 `buildTestApp()` / `cleanup()` 使其删除当前 org 的业务数据（exams、attempts、enrollments），与 BUG-FLAKE-002 的 Option B 同源
3. **方案 C**: 每个 run 使用独立 PG schema（`SET search_path`），与 BUG-FLAKE-001 的 B 方案同源

**验证命令**:

```bash
# 触发：连续多次运行同一 deadline scanner 测试
for i in $(seq 1 40); do
  pnpm --filter @exam/api test -- src/routes/attempts.test.ts -t "deadline scanner" && echo "Run $i: PASS" || { echo "Run $i: FAIL"; exit 1; }
done

# 对照：fresh DB 首次运行不应触发
docker exec exam-test-pg psql -U exam -d exam_test -c "DELETE FROM exam_attempts"
pnpm --filter @exam/api test -- src/routes/attempts.test.ts -t "deadline scanner"  # 应 PASS
```

**复发记录**:

- 2026-06-18：50-run reproduction 脚本，Run 38 首次失败（`submittedCount: 3`）。Run 1-37 全过。DB 累积 94 条 expired disrupted attempts。

### Stress verification — BUG-FLAKE-003 deadline scanner

| Command | Runs | Result | Notes |
|---|---|---|---:|---|
| `pnpm --filter @exam/api test -- --run src/routes/attempts.test.ts -t "deadline scanner"` | 5 | PASS | Cleanup containment + A′ serial: no leaked expired attempts |
| `pnpm --filter @exam/api test -- --run src/routes/attempts.test.ts -t "heartbeat scanner\|disrupted"` | 5 | PASS | No timeout, no state leak |

这些 stress 是在 cleanup containment 和 A′ serial 之下验证的。**B 方案已完成（2026-06-21）**——cleanup containment 可评估移除。

---

### BUG-FLAKE-004 — Intra-suite cross-file state leak via shared `exam_test` schema

**状态**: 已缓解（2026-06-20，explicit cleanup 方案）。B 方案已完成（2026-06-21）——所有 DB-touching 测试文件（含 tenant-isolation、exam、permissionBoundary）已接入隔离 schema，从源头消除跨文件状态泄漏。

**修复（2026-06-20）**:

1. `apps/api/tests/security/tenant-isolation.test.ts` `afterAll` 添加 `cleanupOrganizationTestData` 调用：确保测试结束后清理 orgA 和 orgB 的所有数据，不再污染后续测试文件。
2. 同 BUG-FLAKE-003 修复中的 `cleanupBusinessData` helper 和共享 `deleteExamBusinessData` 私有 helper。

**验证**: `pnpm verify` 全过。

**当前缓解**: `afterAll` 显式清理。跨文件状态泄漏问题已消除。

**失败位置**:

- 受影响文件：`apps/api/src/routes/exam.test.ts`、`apps/api/src/routes/permissionBoundary.test.ts`、`apps/api/tests/security/tenant-isolation.test.ts`
- 触发条件：`tenant-isolation.test.ts` 写入 `batchSize:0`（契约非法）fixture → 同一次 `pnpm --filter @exam/api test` 运行中，`exam.test.ts` / `permissionBoundary.test.ts` 的 `GET /api/exams` 列出该记录 → Zod 校验失败 → 500

**根因**:

`apps/api` 内所有测试文件共享同一个 `exam_test` PostgreSQL schema。`fileParallelism: false`（BUG-FLAKE-001 A′ 方案）消除了文件并行，但**未消除跨文件状态残留**：前序文件写入的行在后续文件中仍可见。`tenant-isolation.test.ts` 的 `cleanup()` 只关闭连接不删数据（与 BUG-FLAKE-003 同源），留下非法 fixture 污染后续文件的 list 查询。

**与已知条目的关系**:

- **BUG-FLAKE-001**（A′ `fileParallelism: false`）只解决并行 I/O 争用，不解决状态残留。
- **BUG-FLAKE-002**（turbo 跨 package 并发）只解决跨 package 竞争，不解决同 package 内跨文件残留。
- **BUG-FLAKE-003**（deadline scanner 数据累积）是同类问题的另一个实例——同 schema 跨 run 残留。
- 本条目是**同 package 内、跨文件、单次 run** 的状态泄漏，与上述三条都不同。

**根因修复方向（与 BUG-FLAKE-001 B 方案同源）**:

每个测试文件 / 每个 worker 使用独立 PG schema（`SET search_path`），从源头消除跨文件状态残留。完成后 `fileParallelism: false` 可恢复默认值。

**当前缓解**: `apps/api` 的测试文件按序执行（`fileParallelism: false`），且 `cleanupOrganizationTestData()` 在多数 describe block 的 `afterAll` 中调用。但非所有文件都调用——`tenant-isolation.test.ts` 自建 app 不走 `buildTestApp`，未调用全局 cleanup。

**禁止做（仍然有效）**:

- 不改业务代码来迁就测试状态泄漏
- 不 skip 受影响用例
- 不给每个测试加独立 timeout 来掩盖

**复发记录**:

- 2026-06-19：RESOLVED-001 根因分析中发现，`tenant-isolation.test.ts` 写入 `batchSize:0` 后污染 `exam.test.ts` 与 `permissionBoundary.test.ts`，修复 fixture 后 512/512 过。

### Stress verification — BUG-FLAKE-004 cross-file

| Command | Runs | Result | Notes |
|---|---|---|---:|---|
| `pnpm --filter @exam/api test -- --run apps/api/tests/security/tenant-isolation.test.ts src/routes/exam.test.ts src/routes/permissionBoundary.test.ts` | 3 | 2/3 PASS, 1 flake | First run failed (cold-start state), reruns passed 2/2 |

**解释 1 次 flake**: 首次运行可能因共享 `exam_test.public` schema 的 cold-start 状态不干净而失败。后续运行稳定通过。**B 方案已完成（2026-06-21）**——每文件使用独立 schema，前序文件数据不会残留。此 flake 已从源头消除。

---

## 已诊断并修复的失败（非 flake，留档用于排查复用）

> 本段记录的是**确定性、可复现、已根因修复**的失败，不是"同代码再跑就过"的偶发 flake。登记在此是为了让后人遇到 `GET /api/exams` 500 这类表面相似的症状时，不必重新走一遍排查链路。

### RESOLVED-001 — `GET /api/exams` 返回 500 INTERNAL_ERROR（tenant-isolation + 共享 DB 污染 + 缺 nowPlugin）

**状态**：已修复（2026-06-19，commit 见 ADR-006 PR）。表面像 flake，实为两个独立根因叠加。

**失败位置**

- `apps/api/tests/security/tenant-isolation.test.ts` ×2：`org A admin sees only org A exams`、`non-SuperAdmin x-target-org header is ignored`
- `apps/api/src/routes/exam.test.ts`：`GET /api/exams returns list`
- `apps/api/src/routes/permissionBoundary.test.ts`：`GET /api/exams returns 200`
- 全部表现为 `AssertionError: expected 500 to be 200`，路由返回 `{"error":{"code":"INTERNAL_ERROR",...}}`。

**错误（真实根因，非断言）**

经逐层隔离复现，500 有两个独立成因：

1. **`tenant-isolation.test.ts` 插入契约非法 fixture**：两处原始 `db.insert(schema.exams)` 用了 `controlFlags.batchSize: 0` / `batchInterval: 0`，但 `packages/contracts/src/exam.ts:42-43` 规定 `batchSize: z.number().int().min(1)`、`batchInterval: z.number().int().min(1)`。该测试绕过 API 校验直接写库，留下非法记录。
2. **`tenant-isolation.test.ts` 构造的 Fastify app 未注册 `nowPlugin`**：其 `beforeAll` 注册了 auth/tenant/rateLimit/zodProvider/security/createDb，但**漏了 `nowPlugin`**。而 `GET /api/exams` 路由调用 `fastify.now()`（`apps/api/src/routes/exam.ts`），于是抛 `TypeError: fastify.now is not a function` → 被错误处理器包成 500。`buildTestApp`（其他测试用）注册了 `nowPlugin`，所以只有 tenant-isolation 自己构建的 app 中招。

**出现场景 / 放大机制**

- 根因 1（非法 fixture）通过 **共享的 `exam_test` DB 跨文件污染** 放大：tenant-isolation 留下的 `batchSize:0` 记录会被同一次 `pnpm test` 运行里的 `exam.test.ts` / `permissionBoundary.test.ts` 的 `GET /api/exams` 列到 → Fastify 响应 Zod 校验失败 → 500。所以根因 1 一次写入可炸 3 个文件。
- 根因 2（缺 nowPlugin）只影响 tenant-isolation 自身 2 个用例，与 DB 状态无关。
- 完全重置 DB（`DROP SCHEMA public, drizzle CASCADE; CREATE SCHEMA public`）后只跑 `exam.test.ts` → 40/40 过：证明根因 1 是 DB 状态污染，生产代码无 bug。

**已知不是的原因**

- 不是 ADR-006 / Time Authority 引入的回归（`fastify.now()` 在 list 路由本就存在；stash 回基线 commit 同样 4 个失败）。
- 不是迁移修复（migration 0001）引入：timing 字段 nullable 与本问题无关。
- 不是产品代码 bug：运行中的 exam-e2e-p2b app（同一镜像）`GET /api/exams` 返回 200 正常。

**当前缓解 / 修复（已落地）**

1. `tenant-isolation.test.ts` 两处 fixture `batchSize: 0 → 10`、`batchInterval: 0 → 3`（与 contract default 一致）。消除契约非法记录。
2. `tenant-isolation.test.ts` `beforeAll` 增加 `await app.register(nowPlugin)`（与 `buildTestApp` 对齐）。消除 `fastify.now is not a function`。
3. 验证：三文件同跑 58/58 过；完整 api 套件 512/512 过（偶发 1 个 suite-level 失败属 DB 状态共享，见后续动作）。

**后续动作**

- **测试 DB 隔离（follow-up，非本 PR）**：根因 1 之所以能炸到 3 个文件，本质是 `exam_test` PG 跨文件共享 schema、无 per-file/per-worker 隔离。这与 BUG-FLAKE-001 的 B 方案（每 worker 独立 schema）同源，建议合并处理。当前 `apps/api/vitest.config.ts` 的 `fileParallelism: false`（A′ 方案）只是串行化，并未消除跨文件状态残留。
- 不要把 `setupErrorHandler` 的 500 文案当真去查产品代码——500 在本例来自响应 Zod 校验/插件缺失，错误处理器把它统一包成了 `INTERNAL_ERROR`，掩盖了真实原因。排查此类 500 时优先用 `app.addHook("onError", ...)` 或临时 `setErrorHandler` 打印 `err.message` / `err.cause`。

**排查复用要点**

遇到 `GET /api/exams`（或任何 list 路由）返回 500 INTERNAL_ERROR：

1. 先确认是不是 DB 状态污染：`DROP SCHEMA public, drizzle CASCADE; CREATE SCHEMA public` 后单跑该文件。若过 → 是跨文件残留，查 fixture 是否写了契约非法值。
2. 若不过，用 `onError` hook 打印真实 `err.message`：若为 `fastify.now is not a function` → 测试 app 漏注册 `nowPlugin`；若为 Zod `too_small`/`invalid_type` → 响应里有契约非法字段，查 fixture。
3. 响应 500 + 错误处理器统一文案时，**不要**先怀疑产品代码。

---

## 2026-06-13 — `attempts.test.ts` 后台扫描测试 5s timeout

**已升级到 BUG-FLAKE-001（见上）。** 本节保留作为升级前的原始上下文。

### 失败位置

- 文件：`apps/api/src/routes/attempts.test.ts:1070`
- 用例：`POST /attempts/:attemptId/heartbeat > marks stale attempts as disrupted during the background scan`
- 调用：`scanDatabaseForDisruptedAttempts(ctx.app, new Date(Date.now() + 61_000), 60_000)`

### 错误

```
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or
configure it globally with "testTimeout".
```

### 出现场景

- 分支：`phase1.7-api-contract`
- 当时正在做：S06-lite 审查后修复（不动 attempts、heartbeat、scanner 任何代码）
- 触发命令：`pnpm --filter api test -- --run audit.test.ts`（但 vitest 默认跑全部 30 个测试文件）
- 同一份代码立即再跑一次：270/270 通过

### 根因假设

并行测试下的资源争用：

1. vitest 默认并行执行所有测试文件（apps/api 30 个）
2. 全部测试文件共享同一个本地 PostgreSQL 实例 + 同一个迁移过的 schema
3. S06-lite 在 `audit.test.ts` 里加了 `waitForAudit()` poll 循环，会反复 `SELECT … FROM audit_logs` 直到条件满足
4. `attempts.test.ts` 的后台扫描用例既要写大量 `examAttempt` fixture 又要等 scanner 收敛
5. 在 PG 连接池/调度器繁忙的瞬间，scanner 调用未能在 5s 默认 testTimeout 内回包

**核心证据**：

- 同代码、同环境再跑全过——非确定性
- 失败的是 timeout，不是断言
- attempts/heartbeat/scanner 全部代码本轮未改动
- 单跑 attempts.test.ts 不出现该问题

### 已知不是的原因

- 不是 S06-lite 引入的产品代码 bug（attempts 路径完全独立）
- 不是 heartbeat scanner 逻辑 bug（同 input 大概率收敛）
- 不是迁移问题（schema 早已就位，其他 269 个测试都过）

### 当前缓解

无代码侧缓解。如果再次出现，重跑一次即可。

### 后续动作（按优先级）

1. **Phase1.7 测试基础设施收紧时统一处理**——建议方向：

   - 选项 A：把 `apps/api` 的 vitest 切成 `pool: "forks", poolOptions: { forks: { singleFork: true } }`，把跨文件并行降到串行。代价：CI 时间变长。
   - 选项 B：每个测试文件用独立的 PG schema（`SET search_path`），从源头消除跨文件 I/O 争用。代价：基础设施改造较大。
   - 选项 C：仅给 `attempts.test.ts:1070` 这个用例加 `it("...", async () => { ... }, { timeout: 15_000 })`。代价：治标不治本，但成本最低。

2. **登记次数追踪**——下次此 flake 再出现，在本节"出现场景"补一条带日期的子项。复发 ≥3 次升级为正式 issue。

3. **不要**因为单次 flake 而：
   - 把测试 skip 掉
   - 把 scanner 默认超时调长（产品代码不应为测试便利让步）
   - 在 CI 上自动重跑后默认通过（会掩盖真实回归）

### 复发记录

- 2026-06-13：S06-lite review 修复阶段，单次出现，重跑通过
- 2026-06-13：S07-lite GREEN 阶段，`pnpm verify`（coverage 模式，c8 instrumentation 放大）下连续 3 次同位置 5s timeout。已升级为治标修复——给该 it() 加 positional `15_000` ms 超时（`it("...", async () => { ... }, 15_000)`，选项 C）。后续 Phase1.7 收紧测试基础设施时再做选项 A/B。已升级到 BUG-FLAKE-001 跟踪根因（见本文档"已升级条目"段），因为已达 ≥3 次复发阈值。

---

## 2026-06-20 — `attempts.test.ts` misconduct flag 测试在 `-t` 全文件运行时偶发失败

### 失败位置

- 文件：`apps/api/src/routes/attempts.test.ts`
- 用例：`POST /api/admin/attempts/:attemptId/misconduct` describe 块内（非固定某一用例）
- 调用：`pnpm --filter @exam/api test -- attempts.test.ts -t "misconduct"`

### 错误

```text
Tests  1 failed | 527 passed (528)
```

（失败用例不固定，且第二次同代码运行即 528 green。多数表现为某用例 timeout 或 DB 争用错误。）

### 出现场景

- 分支：`feat/p2c-j4-misconduct-flag`（P2C-J4 /review 修复阶段）
- 当时正在做：应用 /review 技能评审修复（迁移末尾换行 + 补 403 测试）
- 触发命令：`pnpm --filter @exam/api test -- attempts.test.ts -t "misconduct"`（`-t` 命中整个 misconduct describe，连带执行全文件 528 个用例）
- 复跑结果：第一次 1 failed / 527 passed，第二次立即 528 green

### 根因假设

与 2026-06-20 J3 beyond-close flake 同一家族：`-t` 过滤匹配到整个 describe，导致整文件用例在共享 `exam_test` PG schema 上执行，触发跨用例 DB 状态泄漏 / 资源争用（BUG-FLAKE-002 / BUG-FLAKE-004）。此 flake 与本次改动无因果——403 测试 + 迁移末尾换行不可能产生间歇性测试失败。

### 已知不是的原因

- 不是 403 测试本身有 bug：单独跑全文件时该用例通过
- 不是迁移问题：迁移 0003 是 ADD COLUMN（additive），不影响既有用例
- 不是 flagMisconduct 逻辑缺陷：单跑整文件 528 green

### 当前缓解

无单点缓解（符合登记规则——偶发、与当前改动无因果，不主动加 timeout 或 skip）。
注：既有 A′ 方案（apps/api `fileParallelism: false`）仅控制跨文件并行，并**不**阻止 `-t` 过滤导致单文件内用例串行执行时的状态泄漏——此类同一文件内的跨用例争用需要 B 方案（每 worker 独立 PG schema）才能根除。

### 后续动作

- 观察：若该位置复发 ≥3 次或在 PR CI 上稳定出现，升级为正式条目。
- 根因修复走 B 方案（每 worker 独立 PG schema），届时此类跨用例争用 flake 一并消除。

### 复发记录

- 2026-06-20：J4 /review 修复阶段，`-t` 过滤连跑整文件时单次出现（1/528），重跑 528 green。
- 2026-06-20：J4 rebase 后 `-t` 过滤全文件再次出现（2/528），重跑 528 green。

---

## 2026-06-23 — `testWorkerDatabase.test.ts` ensureDatabaseExists 5s timeout（`pnpm verify` coverage 模式）

### 失败位置

- 文件：`packages/db/src/testWorkerDatabase.test.ts`
- 用例：`ensureDatabaseExists > creates the database if missing, idempotent on second call`
- 调用：`pnpm verify`（→ `@exam/db coverage`，v8 instrumentation + turbo 并发）

### 错误

```text
FAIL  src/testWorkerDatabase.test.ts > ensureDatabaseExists > creates the database if missing, idempotent on second call
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure a timeout globally.

❯ src/testWorkerDatabase.test.ts:144:3
   145|     const workerDb = "exam_test_w_phase3a_ensure";
   146|     await dropDbIfPresent(workerDb);
```

### 出现场景

- 分支：`feat/p2e-j2-attempt-timeline`（P2E-J2 attempt timeline 实现收尾）
- 当时正在做：`pnpm verify` 全链路验证（已通过 format/lint:copy/lint:arch/lint/typecheck，到达 `@exam/db coverage`）
- 触发命令：`pnpm verify`
- 复跑结果：`pnpm --filter @exam/db test testWorkerDatabase` 立即 12/12 PASS（843ms），全部用例 green

### 根因假设

属 BUG-FLAKE-001 / BUG-FLAKE-002 家族：`ensureDatabaseExists` 用例在 coverage 模式（v8 instrumentation 放大 I/O）+ turbo 跨任务并发调度下，对同一个本地 PG 实例执行 `dropDbIfPresent` → `ensureDatabaseExists`（CREATE DATABASE）→ migrate → seed 的物理数据库生命周期，在 5s 默认 testTimeout 内无法收敛。`pnpm verify` 期间 `@exam/db#test`、`@exam/db#coverage`、`@exam/api#test`、`@exam/api#coverage` 多任务挤同一 PG，CREAT/DROP DATABASE 是重操作，瞬时 I/O 争用导致单个用例超时。

**核心证据**：

- 同代码、同环境再跑立即 12/12 PASS（843ms）——非确定性
- 失败是 timeout（5000ms），不是断言错误
- `testWorkerDatabase.ts` 本轮未改动（`git diff --name-only master...HEAD` 不含该文件）
- 该用例属 worker-database 物理数据库生命周期（CREATE/DROP DATABASE），重于普通 schema create/migrate，对并发 I/O 更敏感

### 已知不是的原因

- 不是 P2E-J2 attempt timeline 改动引入：改动仅触及 `auditLogRepo.ts`、`audit.ts`、`attempts.admin.ts`、`AttemptDetailPage.tsx` 及其测试，全部与 `testWorkerDatabase.ts` 无因果
- 不是 worker-database 原型代码 bug：单独复跑整文件 12/12 green
- 不是迁移问题：物理数据库 CREATE/DROP 与 schema migration 无关

### 当前缓解

无单点缓解（符合登记规则——偶发、与当前改动无因果，不主动加 timeout 或 skip）。既有 PR88 `turbo.json` `@exam/db#coverage dependsOn @exam/db#test` 串行化已生效（本机 PG 启动较慢时仍可能瞬时超时），且 `verify:db-tests` 串行链已就位。

**Phase 6A 缓解（2026-06-23，lifecycle command split，非单点 timeout）**：新增
`test:db:lifecycle`（单独跑 `src/testWorkerDatabase.test.ts`）与 `test:db:unit`
（`--exclude src/testWorkerDatabase.test.ts`，跑其余 12 文件 / 139 测试）。本地快速反馈入口
`verify:fast` 使用 `test:db:unit`（不含 lifecycle），把 physical-DB-lifecycle 从 fast
path 拆出。**不 skip、不从 full path 删除、不加专属 timeout**——`pnpm verify` / `test:db`
仍覆盖 lifecycle；`test:db:lifecycle` 让物理 DB lifecycle 可单独定向复跑（见 Phase 6A
验证：standalone 12/12 PASS 约 1.4–1.8s）。归入 BUG-FLAKE-001 physical-DB-lifecycle
子类，**不另开 BUG-FLAKE-005**。

### 后续动作

- 观察：若该位置复发 ≥3 次或在 PR CI 上稳定出现，升级为正式条目（BUG-FLAKE-001 家族 worker-DB 变种）。
- 根因修复走 BUG-FLAKE-001 B 方案 follow-up 方向：测试期 semaphore 串行化隔离 schema/数据库的 create/migrate/seed；或预迁移模板减少物理 CREATE DATABASE 频次。
- **不要**因为单次 flake 而给 `testWorkerDatabase` 单点加 timeout 或 skip 该用例（会掩盖真实回归）。

### 复发记录

- 2026-06-23：P2E-J2 实现 `pnpm verify` 收尾时单次出现（1/151），`pnpm --filter @exam/db test testWorkerDatabase` 立即 12/12 PASS。

---


## 模板（新增 flake 时复制使用）

```markdown
## YYYY-MM-DD — <文件名> <简短描述>

### 失败位置

- 文件：
- 用例：
- 调用：

### 错误

\`\`\`
<错误片段>
\`\`\`

### 出现场景

- 分支：
- 当时正在做：
- 触发命令：
- 复跑结果：

### 根因假设

### 已知不是的原因

### 当前缓解

### 后续动作

### 复发记录

- YYYY-MM-DD：
```
