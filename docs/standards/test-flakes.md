# 测试 Flake 登记册

本文档登记 `pnpm verify` / CI 期间观察到的、**与当前改动无因果关系**的偶发测试失败（flaky tests）。

每条记录的目的：

- 让接手的人不要把 flake 当成真 bug 去回滚或修
- 让我们能识别出"反复在同一个测试上出现"的趋势——若一条 flake 升级为高频问题，就要从登记册升级为正式 Bug
- 为后续调整测试隔离 / 调度基线留下可对照的证据

## 登记规则

1. **必须有再现一次"同代码再跑就过"的证据**才能记入此处，否则按真实 bug 处理。
2. 每条至少含：日期、Job 上下文、失败测试 file:line、错误片段、根因假设、当前缓解、后续动作。
3. 同一条目复发 ≥3 次 → 升级为正式跟踪条目（本文档"已升级条目"段，或 issue tracker），并在原条目末尾标记"已升级"。

---

## 已修复事故

### 2026-09-01 — CI API coverage 4-worker 并行下 DB 生命周期钩子漂移超时（PR #362 S1 anti-decay）

- **现象**：CI run 33425276029（2026-08-31T18:29Z，pull_request，`chore/recovery-anti-decay-s1` @ cdafbd38）的 API coverage job（`TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4`）失败；同 run 其余 job（Build / Static / E2E×2 / Web / Package）全部通过。3 个文件 6 个错误，全部为 DB 生命周期钩子超时，无任何断言失败：
  - `src/routes/clientEvents.test.ts:20` — `beforeAll` 内 `buildTestApp` `Hook timed out in 10000ms` → `:29` afterAll 次生 `TypeError: Cannot read properties of undefined (reading 'db')`；7 tests skipped
  - `src/routes/importLogs.test.ts:11` — 同上 10000ms → `:37` 次生 `(reading 'cleanup')`；10 tests skipped
  - `src/email/emailDeliveryService.test.ts:155` — BUSINESS SAFETY 用例 `Test timed out in 5000ms` + `:50` afterAll `cleanup` `Hook timed out in 10000ms`
- **证据（同代码再跑就过，登记规则 #1）**：本地同一 commit 用与 CI 完全相同的命令（`TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api coverage`）全绿：184 文件 / 2447 passed + 12 skipped（总数 2459 与 CI 一致），0 超时，EXIT=0。
- **排除回归**：3 个失败文件不导入该 PR 改动的任何模块（recoveryRepo / incidents.admin / pending*Authority）；同一 CI run 中导入这些模块的测试（incidents.admin.test.ts、pendingForceSubmitAuthority.test.ts 等）全部通过；Package coverage（含 recoveryRepo 生命周期矩阵）通过。
- **失败签名**：3 个文件的钩子在 ~23s 窗口（18:34:41–18:35:04）内同时漂移越界，而同窗口其他 worker 的 DB 测试正常完成（settings 847ms、api-smoke 639ms、submitAndGradeAttempt 1273ms）—— PG 服务健康，是 runner 负载（4 vCPU 上 4 个 coverage-instrumented worker + PG + Redis；import 阶段 137.97s）下的调度漂移，失败点落在 DB 生命周期钩子（10s hookTimeout / 5s testTimeout）。
- **根因假设**：BUG-FLAKE-001 I/O contention / 宿主负载家族（见 2026-08-31、2026-08-26 条目）在 CI runner 上的首次发生；CI 4-worker worker-database 模式放大了单 runner 上的 CPU/IO 争用。注：2026-08-29 fix/351 分支的 API coverage 失败为 `server.shutdown.test.ts` 断言失败，不属于本家族。
- **当前缓解**：无代码改动（不调 timeout、不 skip、不 retry）；推送本登记提交触发新 CI run 验证转绿。
- **后续动作**：CI API coverage 同家族失败累计 ≥3 次时，按登记规则升级为正式跟踪条目（届时再评估结构性减负；worker-DB bootstrap 已有 per-process memo，warm 路径无重复全局锁获取）。
- **结构性修复（2026-09-24，`fix/api-worker-bootstrap-lifetime`）**：2026-09-23 PR #603 CI（run 35851583114）同签名复发（`importLogs.test.ts:11` hook timeout → `:37` 次生 cleanup TypeError），触发根因调查，机制确认为：Vitest 4 forks + `isolate: true` **每个 test file 一个全新 worker process**，per-process bootstrap memo 跨 file 必然失效 → 每 file 首个 `buildTestApp` 重复 ensure+migrate 两次取锁（实测 ~220 次/run，占全 run 322 次 lane 获取的 68%），队列深度把 lane 上的慢持有者（slot-reuse 隔离证明的 `DROP DATABASE`，实测 4.3–5.7s、历史 23.4s）放大为无关文件 `beforeAll` 的 10s hookTimeout 超时。修复：bootstrap 事实改为 **server-side**——无锁只读预检（库存在且 `drizzle.__drizzle_migrations` 行数 == append-only journal 条目数，journal 不变性由 `lint:db-journal` 门禁保证），未命中才取 ONE 个合并 ensure+migrate 临界区（锁内复检）；per-file 业务数据 reset 保持 per-file（跨 file 隔离边界，`workerDbTruncated` 更名 `fileBusinessDataReset` 并改写"once per worker process"失实注释）。同 slot 双文件生命周期回归（`apps/api/tests/bootstrapLifetime/`，单次子 vitest 调用 + maxWorkers=1 + 角色锁文件选举）双向变异实证：禁用预检 → 第二文件 0-acquisition 断言红；跳过 per-file reset → sentinel 断言红。实测（本地 taskset 4-CPU、`API_TEST_MAX_WORKERS=4`、5 连跑）：bootstrap lane 获取 220→**2**/run（4 outer slots 温库预检全中 + slot-reuse stage-A 冷建 1）、总 lane 获取 322→**107**/run（其余为 file-schema 路径 create/drop schema 96 + 生命周期证明类），预检成本 p50 ~63ms，**0 hook/test 超时**；2 次失败为环境伪影（遗留 tsx watcher 占用 3000 端口 / 调查中进程清理扰动），与 worker 路径无关。

### 2026-08-31 — 并行跑 api + web 两个独立测试套件引发的宿主负载型 5s 超时（#301 deletion audit 观察）

- **现象**：`pnpm --filter @exam/api test` 与 `pnpm --filter @exam/web test` 作为两个独立 pnpm 进程**同时**在后台运行（同一 WSL2 8-core 主机），api 出现 4 个、web 出现 1 个 `Test timed out in 5000ms`。失败位置互不相干，且与本次改动的 rich-content 相关测试文件无任何交集：
  - `apps/api/src/routes/auth.test.ts:126` — `non-e2e mode enforces the route-level login limiter`（5 轮 login + audit）
  - `apps/api/src/scripts/backup-evidence.test.ts:303 / 334` — `--size-bytes` reject/accept 两个用例（CLI + ledger 写入）
  - `apps/api/tests/concurrency/ea-lock-order.test.ts:292` — `repaired contention schedule is stable across 100 consecutive runs`（100 轮真实锁竞争）
  - `apps/web/src/pages/admin/QuestionPage.test.tsx:153` — `clears filters and keeps the page shell visible during table reload`（debounce + 异步 reload）
- **错误片段**：全部为 `Error: Test timed out in 5000ms.`，无任何断言失败。
- **证据（同代码再跑就过，登记规则 #1）**：改为**串行**重跑（web 跑完才跑 api），web 123 文件 / 1706 测试全过、api 184 文件 / 2460 passed + 12 skipped 全过，两次 EXIT=0。同一工作树、同一 PG 容器，唯一变量是去掉了两个套件的并发。
- **根因假设**：与 BUG-FLAKE-001 的 I/O contention / WSL2 host-performance 家族同机制（见 2026-07-20 复发记录）——两个 vitest 进程同时占满 CPU，瞬时调度无法在 5s 默认 testTimeout 内收敛；失败点落在已知的时序敏感用例（login limiter、CLI 证据写入、100 轮 lock 竞争、带 debounce 的页面 reload）。是**操作方式引入的负载**，不是产品代码 / 测试代码回归。
- **当前缓解**：开发机重套件**串行**执行，不并行跑两个独立测试进程；CI 各 job 独立 runner，不受此操作模式影响。
- **后续动作**：无代码改动（不调 timeout、不 skip、不 retry）。若在**串行**执行下同一批用例再次出现 ≥3 次，按登记规则升级为正式跟踪条目。

### 2026-08-26 — 漂移型 5s/10s 超时的根因链：worker identity 错绑（第一层）→ DDL advisory-lock 队列负载（第二层）（S0 审计 follow-up ×2 轮审查）

- **现象**：`pnpm verify` / coverage 下漂移型超时，victim 位置不固定：auth.test.ts
  login-limiter（5s）、e2eReset.test.ts 首用例（5s）、examProfileRepo.test.ts
  beforeAll（10s，次生 "cleanup is not a function"）、0027 sabotage 用例、历史
  testWorkerDatabase/seed 条目。单文件复跑必过，失败点随调度漂移。
- **证据一（TEST_INFRA_TRACE 插桩 + pg 采样，packages/db coverage 默认并行，
  第一轮审查）**：
  - 单次 run **244 次** lifecycle-lock 获取；等待 **p50≈730ms、p95≈2.2s、max≈4.8s**；
    每轮 72-93 次等待 >1s、5-7 次 >3s —— 全绿 run 也如此。
  - 并发单调恶化：workers=1 → p50=19ms/max=265ms（队列消失）；2 → max 2s；
    4 → p95 884ms/max 4s；8（默认）→ p95 2.2s/max 4.8s。
  - 池/连接排除：峰值 22-28 连接 ≪ max_connections=100；采样同时最多 6 个
    backend 等 advisory lock（1 持有 + 队列）。
  - 纯 CPU 假设证伪：auth limiter 单跑 1032ms，4 个 argon2 燃烧器下仅 1173ms
    （+14%），纯 CPU 饥和不构成 5s 击穿。
- **证据二（定向探针，第二轮审查——第一层根因实证）**：固定 16 个 api 测试
  文件、`API_TEST_MAX_WORKERS=2`、清空 `exam_test_w*` 冷启动：
  - 修复前创建 **13 个**物理 worker 库 —— `maxWorkers=2` 名不副实；
  - 绑定 `VITEST_POOL_ID` 后恰好 **2 个**；温跑 trace 32 次获取、wait
    **p50=30ms / max=58ms**、hold 总量 1.36s —— 第二层队列压力随第一层修复
    自然消失，无需动锁键。
  - vitest 语义证据（安装版 4.1.7 dist + 官方文档）：`VITEST_POOL_ID`
    "Value is between 1-maxWorkers"，是 Jest `JEST_WORKER_ID` 对应物、执行
    槽位、任务结束即回收（scheduler `getWorkerId`/`freeWorkerId` 源码）；
    `VITEST_WORKER_ID` "unique per each isolated worker"、官方 migration
    guide 明言不受 maxWorkers 限制、单调递增。另实证 per-file `run` 消息只
    重置 `VITEST_WORKER_ID`，`VITEST_POOL_ID` 整个进程生命周期不变。
- **根因（分层因果链）**：
  1. **第一层（identity 错绑，本轮新发现）**：`testScope.resolveWorkerId`
     把槽位域资源（物理库名 / Redis / queue 前缀）绑到 `VITEST_WORKER_ID`
     （worker 实例 id）。isolate 默认下每文件一个新实例 ⇒ 每文件唯一实例 id
     ⇒ 每文件独立物理库 + 全量 migrate（每次冷跑的物理库基数 ≈ 每文件一库，
     以残留形式留存），`maxWorkers=2` 形同虚设。"worker database" 名实不符
     的真正原因不是 "vitest worker 生命周期奇怪"，而是**选错了 Vitest
     identity**。
     **残留 vs 泄漏（round-3 修正，2026-08-27 实证）**：错绑产生的是
     **错误基数的持续残留**，不是无界累积泄漏 —— 旧序（WORKER_ID 优先、
     重建 dist）下 8 文件 run 1 物化 `exam_test_w0..w7`，同命令 run 2
     **零新增**（实例 id 每次运行从 0 重启，同名复用）。历史观测到的
     "84 个 exam_test_w%" 是不同形态 run 的实例 id 高水位，不是每次
     run 的增量。修复后活跃集恰为 maxWorkers 个（w=2→{w1,w2}、w=4→
     {w1..w4}，温跑复用零增长）；maxWorkers 收缩后高槽位库按设计留存为
     空闲残留，不自动清扫。
  2. **第二层（放大结构，第一轮审查发现，修复保留）**：
     - worker 路径 `setupWorkerTestDatabase` 无进程内记忆化：每次
       `buildTestApp()` 重新 ensure+migrate-check 两次取锁（351→255 次/run）；
     - file-schema 路径 `getIsolatedTestDb` 把 CREATE SCHEMA 与 migrate 拆成
       两次取锁（最坏两轮全队列等待，吃穿 10s hookTimeout 的机制）。
  3. 预算耦合是受害面而非根因：5s testTimeout / 10s hookTimeout 同时承担
     测试逻辑与隔离基建排队；queue 塌缩后预算自然够用。
- **修复中捕获的自然失败（根因证据闭环）**：修复迭代中一次 `@exam/db`
  coverage run 复现了完整 victim 链：trace 显示一次病态
  `dropDatabaseIfExists` **持锁 23.4s**（WSL2 I/O 长尾的 DROP DATABASE），
  其后 schema setup 排队等待 23.5-23.9s ≫ 10s hookTimeout → testCleanup ×2 +
  0027 ×2 共 6 个 suite "Hook timed out in 10000ms" + 次生 "cleanup is not
  a function"。与 S0 会话 examProfileRepo victim 完全同签名。
- **修复（最小结构，非 timeout/skip/retry）**：
  1. **worker identity 重绑（第一层修复，`testScope.ts`）**：解析序改为
     `TEST_WORKER_ID`（显式覆盖）→ `VITEST_POOL_ID` → Vitest 下缺
     `VITEST_POOL_ID` 直接 FAIL（绝不静默回退到已知坏身份）→ 非 Vitest
     才 `"1"`；`VITEST_WORKER_ID` 彻底退出解析（round-3 起无任何仓库消费方
     只注入它；serial/parallel 两种模式均实测注入 POOL_ID）。效果：探针冷启
     13→2 个物理库；温跑 wait max 58ms。顺序文件共享同一 slot 库时，隔离由
     `buildTestApp` 的每进程一次 truncate 边界保持（并发文件永在异槽：槽位
     任务结束才回收）。
  2. `testWorkerDatabase.ts`：per-process bootstrap 记忆化（URL→ensure+migrate
     promise，失败驱逐）——同进程第二次 setup 取锁 **0 次**（auth limiter
     温构建零锁）。
  3. `testDb.ts` `getIsolatedTestDb`：CREATE SCHEMA + migrate 合并为**一次**
     锁临界区（连接建立移出锁外；`testIsolation.ts` 新增
     `createTestSchemaUnlocked`）——最坏暴露从两轮全队列等待减为一轮。
  4. `e2eReset.test.ts`：对齐 demo-seed 预计算 hash 先例（memoizedHash）+
     bootstrap（ensure+migrate）移入 beforeAll；首用例 1881ms→1007ms；
     beforeAll/afterAll 在调用点显式传 30s 数值超时（见修复 6）。
  5. `testInfraLock.ts`：新增 `getTestInfraLockAcquisitionCount()`（回归测试
     断言用）与 `TEST_INFRA_TRACE=1` 门控的 wait/hold 结构化诊断日志；
     computeLockKey 补上真正的 int64 折叠（`BigInt.asIntN(64,…)`）。
  6. **hook 预算显式化（vitest 语义实证）**：describe 的 `{ timeout }` 只
     作用于测试体，hook 独立走全局 `hookTimeout`（默认 10s），且**超时的
     hook 不会被取消**（orphan promise 继续持锁引发级联，观察值 23.8s）。
     排队取锁的生命周期 hook 改为调用点显式 `beforeAll(fn, 30_000)` /
     `afterAll(fn, 30_000)`；**不再设包级 `hookTimeout` 放宽** —— 无关坏
     hook 必须仍在 10s 默认暴露。
- **已试并撤回的方案（第 1 轮修法，第 2 轮审查否决）**：
  - ~~锁键拆类（schema/database 双键）~~：撤回理由：(a) 动机性队列负载本身
    是 identity 症状，identity 修复后 wait max 58ms，无拆键需要；(b)
    "跨类竞争由 30s budget 承接"不成立——**timeout 预算不是并发控制**；
    (c) 单键正是引擎级保证（CREATE/DROP DATABASE 不与 migrate
    并发打 catalog），拆键是在撤销旧安全设计。单键恢复，并保留"任意临界区
    持有 THE 单键、探针 try-lock 必败"的确定性回归。
  - ~~包级 `hookTimeout: 30_000`~~：作用域过度扩大（把 @exam/db 全部
    beforeAll/afterAll 一律放宽到 30s，无关坏 hook 的暴露延迟 3 倍）。改为
    仅生命周期 hook 显式传参。
- **回归测试（旧实现必败，stash/变异实证）**：`testScope.test.ts` 同槽位
  稳定名 / 异槽不同名 / POOL>WORKER 优先级 / legacy 回退 / 空值穿透 /
  charset 校验（旧实现按 WORKER_ID 取名必败）；`testIsolation.test.ts`
  "acquires the lifecycle lock exactly once"（旧实现 2≠1 FAIL）；
  `testWorkerDatabase.test.ts` "second setup … does not re-acquire"（旧实现
  2≠0 FAIL）；`testInfraLock.test.ts` 单键回归："any critical section holds
  THE single lifecycle key (probe try-lock must fail)"（重引入分键或改路由
  变异 FAIL，pg_locks try-lock 无竞速无时序）+ 跨库协同 pg_locks 本会话
  过滤证明。
- **round-3 合同收口（2026-08-27，第三轮对抗审查，全部变异实证）**：
  1. **TEST_ADMIN_DATABASE 权威穿透（CodeRabbit round-2 发现，round-3
     实证+修复）**：`withTestInfraLifecycleLock` 曾在 seam 之下静默重读
     `process.env.TEST_ADMIN_DATABASE`——调用方以显式 env 解析的
     coordination DB 与锁会话实际落库不一致（advisory lock 是
     database-local，协调静默失效）。修复：`options.env` 自调用方穿透
     （resolve once, pass authority down）。回归：注入 env ≠ process.env
     时，pg_locks 中 lifecycle 键的 granted 行 `database` OID 必须等于
     注入权威库的 OID（唯一专用库，无兄弟噪声）；旧实现该行永不存在、
     轮询超时 FAIL。
  2. **bootstrap memo 权威域（key 加强）**：memo key 从 workerUrl 单键
     改为 `(coordination admin URL, worker URL)`——同一 worker 库经不同
     coordination 权威到达时不得复用他人 authority 之下的 ensure+migrate
     （否则第二个权威静默跳过自己的串行化引导）。回归：同 workerUrl、
     不同 `TEST_ADMIN_DATABASE` 的两次 setup，第二次锁获取数必须 >0
     （旧 key 下为 0，变异 FAIL）。
  3. **slot 复用的数据隔离（不止名字复用）**：`apps/api/tests/slotReuse/`
     两阶段子 Vitest 运行（父测试控制顺序，真实 PostgreSQL）：stage A
     经 canonical `buildTestApp` 写哨兵业务行后正常退出；stage B 稍后
     以同槽位进入同一物理库——不得看到哨兵、必须看到 canonical seed
     基线、migration metadata 必须原样。去掉 truncate 边界的变异使
     stage B "does NOT see sentinel" 用例 FAIL（实证）。子运行以每次调用
     唯一的 `TEST_WORKER_ID` 绑定专用槽库，绝不与外层并行 run 的
     w1..wN 相撞。
  4. **单一本地 run 合同（并发本地 run 不支持）**：两个独立本地 run 从
     `VITEST_POOL_ID` 推导出相同槽库名，无守卫时并发共享物理库——实验
     （变异禁用守卫后重建 dist）实测：run B 的行在 run A 的槽库中
     可见（foreignRows=5），且 B 的 reset 边界抹掉 A 的行。合同选择
     Option B（放弃 run namespace，复杂度更低）。round-3 曾以
     `setupWorkerTestDatabase` 内的 per-slot-database lease 实施；
     round-4 **撤销该设计并上移生命周期层级**：per-slot lease 实为
     worker-process 占用 lease（顺序槽位交接可让 run B 抢到空档、反而
     使 run A 失败），其 10s 有界等待重新制造了本 PR 消灭的
     timeout-coupling 失败模式，且按库名单维 key 的 lease map 复刻了
     第 1 条的缺权威维度缺陷。现行实施（round-4 定层，round-5 定域）：
     `apps/api` Vitest `globalSetup` 在任何 worker 进程存在之前对单键
     `exam_test_worker_database_run` 做一次 `pg_try_advisory_lock`
     （无重试、无等待、无超时覆盖），整个 invocation 持有、global
     teardown 释放；第二个 run 在自己的 globalSetup **立即**失败
     （实测约 1.8s 内中止，其中绝大部分是 vitest 启动本身）。崩溃的
     run 随进程会话死亡自动释放。CI 各 job 独立 PG service，不受影响。
     **lease 作用域（round-5）**：锁命名空间必须等于被保护资源的命名
     空间——槽库按 server 命名（VITEST_POOL_ID），故 lease 恒定挂在目标
     server 的 canonical `postgres` 库，绝不由 `TEST_ADMIN_DATABASE` 决定。
     round-4 把它挂在 coordination DB 上时，两个不同 coordination DB 的
     run 各自拿到互不冲突的 lease、随后撞进同一批槽库（advisory lock 是
     database-local 的）；当时还把"权威域分离"写成了正向回归。现
     `TEST_ADMIN_DATABASE` 对 worker-database run 只允许 unset/`postgres`，
     其他值在建立任何连接之前确定性 fail-fast（全仓审计无真实消费方设
     置它；它仍是第 1 条 lifecycle lock 的 caller-authority 旋钮）。嵌套
     proof run（slot-reuse fixtures）不再以私有 coordination DB 逃逸，
     改走无 globalSetup 的专用子配置
     （`tests/slotReuse/vitest.child.config.ts`；vitest 不提供 globalSetup
     的 CLI 覆盖）——它们是持有 lease 的父 invocation 的 fixtures，安全性
     来自唯一 `TEST_WORKER_ID` 槽位命名空间。该子配置的 fixture-only
     约束是**机器级**而非注释级：加载期强制
     `SLOT_REUSE_STAGE=A|B` + 非空 `SLOT_REUSE_HANDOFF`（否则在配置
     加载即失败、任何测试不会运行），`test.root`/`test.include` 钉死为
     对应唯一 stage fixture（positional 过滤只能与之求交；未钉死时该
     配置可发现全部普通 API 测试），且不存在通用绕过 env
     （`TEST_DISABLE_RUN_LEASE` 等发明变量既过不了守卫也不放宽发现
     范围）。回归：`child-config.contract.test.ts`（误用加载期失败、
     两 stage 各自仅发现唯一 fixture、positional 逃逸无测试可跑、
     变异移除 include 钉死后该配置可执行普通 API 测试且回归必红）。
     另有：two-run
     immediate-conflict（<2s，无有界等待）、release 幂等 + 解锁后可
     重新获取、cluster-scope 拒绝（两个 alien TEST_ADMIN_DATABASE 均
     fail-fast，变异回 round-4 行为后该用例必红）、对 enclose run 真实
     持有 lease 的压缩版端到端冲突。
  5. **TEST_WORKER_ID × 并行的可执行不变量**：并行不变量从
     vitest.config 注释升级为启动前 throw（`apps/api/vitest.parallelism.ts`，
     含 10 项 config-contract 单测）：`TEST_WORKER_ID` 显式设置 +
     `API_TEST_MAX_WORKERS>1` ⇒ 测试启动前失败。serial 调试路径
     （无/1 worker + TEST_WORKER_ID）保持文档化支持。
  6. **round-3→5 新增概念清单**：净零——新增 run-level lease
     （globalSetup 层，替代 round-3 的 per-slot lease）的同时删除了
     per-slot lease 全套概念（10s 有界等待、`TEST_SLOT_LEASE_WAIT_MS`、
     per-slot 键空间、进程内 lease map）、VITEST_WORKER_ID legacy 兜底
     分支，以及 round-5 删除的"coordination DB 即隔离域"概念
     （lease 恒挂 canonical `postgres`，`TEST_ADMIN_DATABASE` 对
     worker-database run 收窄为 unset/`postgres`，slot-reuse 子运行
     改用无 globalSetup 的专用子配置而非私有 coordination DB）。
     round-4 另关闭
     `ensureDatabaseExists`/`dropDatabaseIfExists` 的 wrapper 级 env
     权威透传漏洞（round-3 只修了 lock helper 本体；wrapper 回归以
     blocked-waiter 证明锁定，两个 wrapper 分别变异验证必红）。
- **遗留（follow-up，不本 PR）**：模板库克隆（CREATE DATABASE … TEMPLATE）
  可把 slot 冷启动从 CREATE+migrate 进一步降到 clone；api 全量并行铺开时
  关注 slot 复用率与 @exam/db file-schema 路径的 migrate 串行利用率。

### 2026-07-21 — fire-and-forget audit 与破坏性清理发生生命周期竞态

- **现象**：attempt 路由测试偶发命中
  `audit_logs_organization_id_organizations_id_fk`；把 `beforeEach` 改成
  `cleanupBusinessData` 后 FK 错误消失，但上一测试的延迟 audit 行仍可进入下一测试。
- **已证实根因**：`recordAudit` 创建的 Promise 没有 owner，HTTP 响应、
  `beforeEach`、`afterAll`、`app.close()` 和连接池关闭都没有 pending-work
  barrier。受控 deferred Promise + 真实 PostgreSQL 确定性复现了 audit delete
  与 organization delete 之间落入 INSERT 的 `23503`，也复现了清理后的跨测试
  late-row 污染。
- **错误缓解**：只保留 organization、删除 business rows 是 FK containment，
  不是同步；它把 FK 失败换成了隔离失败。删除重试或真实延时同样不构成修复。
- **最终不变量**：上一测试关联的 side effect 尚未 drain 时，不得开始破坏性
  fixture 清理；优雅关闭不得早于所有已接收、已跟踪的 audit 写入 settle。
- **修复提交**：`1b01925`（tracked audit registry、显式 drain、Fastify close /
  scanner / DB pool 顺序）；七个套件恢复每测试 organization 生命周期，并在
  `beforeEach` 与 nested `afterAll` 明确 drain。
- **回归测试**：`routes/auditLifecycle.test.ts` 覆盖非阻塞响应、真实 DB drain、
  跨测试污染、破坏性清理、失败日志和 `app.close`；
  `plugins/auditLifecycle.test.ts` 覆盖同步注册、乱序完成、多写入、拒绝清除和
  drain 期间的新工作；`plugins/db.test.ts` 覆盖 audit drain 先于 pool close。

### 2026-07-21 — ADR-006 审计原子性、崩溃耐久性与无界关闭缺口（历史中间态，已被比例性 corrective 修正）

- **现象**：前一项 lifecycle 修复只保证优雅关闭会等待已登记的异步写入；业务
  事务仍先提交、审计随后异步执行。因此审计 INSERT 失败或进程在两者之间
  SIGKILL 时，API 已成功但审计永久缺失；永久不 settle 的 Promise 还会使
  `app.close()` 永不返回。
- **已证实根因**：旧的通用 audit helper 同时承载不同可靠性要求，却只暴露
  fire-and-forget 语义，并固定使用根 DB 连接。调用者不能把写入加入当前事务，
  action vocabulary 也没有逐项耐久性分类，drain 没有 deadline 或退出策略。
- **历史中间态**：该修复把 48/58 个 action 归入事务关键，并把登录、答案保存、
  自动提交/中断、自动开闭都放入审计可用性边界；还让“可丢失”的后台观察在
  drain 超时后写 `process.exitCode = 1`。后续独立 review 证明这些口径过宽且互相
  矛盾，不能作为当前合同。
- **保留的真实修复**：原子 writer 必须使用同一个 branded transaction；真实
  PostgreSQL trigger failure injection 继续作为高价值证据；后台 Promise 必须有
  lifecycle owner 和有限 drain。
- **被撤销的合同**：登录不再因 tenant audit 失败而拒绝；答案保存和自动领域
  迁移不再写 compliance audit；best-effort 超时不再导致非零退出。
- **结论**：本条作为根因演进历史保留。当前权威口径见下一条和 ADR-006 的
  “Audit contract proportionality corrective”。

### 2026-07-21 — ADR-006 audit contract proportionality corrective

- **已证实根因**：旧分类把“mutation”近似等同于“必须与审计原子提交”，混淆
  enum 完整性与运行时 emitter 完整性，并让 candidate runtime、普通登录和 routine
  authoring 依赖 `audit_logs` 可用性。
- **当前不变量**：只有 authority、credential、privileged mutation 的窄集合使用
  atomic writer；三个明确的敏感读取在响应前同步落审计；普通登录和 routine
  observation 使用 tracked best-effort；`attempt.saveAnswer`、自动提交/中断、自动
  开闭属于 canonical domain state，不进入 compliance audit。
- **lifecycle**：ACTIVE、RESERVED、DEPRECATED 与 durability 独立。三个
  `email.*` action 是 RESERVED，不能计入 active coverage。递归 production inventory
  要求 active-zero、reserved-emitter、direct-writer-bypass 全为零。
- **关闭策略**：lifecycle 只返回 `{ timedOut, pendingCount }`，不处理 signal、不改
  `process.exitCode`。server 在 timeout 时记录 warning 并继续有界关闭；仅真正的
  graceful-shutdown failure 才选择非零退出。
- **确定性回归**：trigger 注入覆盖 route-owned、admin invariant、submit/grading
  service、exam transition executor、CLI/bootstrap、bulk import 和 manual grading
  家族；sensitive-read 测试证明 audit 失败时响应不含受保护数据；best-effort 测试
  使用 deferred Promise + fake timer，无 wall-clock sleep。
- **测试隔离口径**：只有 best-effort action 需要 drain。atomic action 与业务事务
  一起 settle；domain-history exclusion 不得靠 drain 伪装成审计保证。

### 2026-07-30 — #231 auth route E2E rate-limit amplification test（测试所有权与成本不匹配）

- **现象**：`apps/api/src/routes/auth.test.ts` 的 `APP_MODE=e2e does not
  rate-limit repeated login requests` 用例在 CI 下偶发 5000ms 超时。该用例
  连续 12 次走完整登录流程（argon2 密码哈希 + audit 写入），证明一个
  **plugin-level** 的 E2E bypass。
- **真正的问题（测试所有权 / 成本不匹配）**：该 proof 的被测对象是
  `rateLimitPlugin`（`APP_MODE=e2e` 时整插件不注册），但证明手段是 auth
  route 的 12 次端到端登录放大。登录路由拥有 route-level `rateLimit.max = 10`，
  因此第 11 次请求才会越过登录路由自身的限制——既不能机械地把 12 次减到 2 次或
  5 次（那样测的是 route limiter，不是 E2E bypass），又用 12 × 完整认证流程
  证明一个不依赖数据库的 plugin 行为，测试所有权和成本严重不匹配。issue #231
  原始修复方案（"12 → 5"）的根因描述（"argon2 400ms × 12 ≈ 4800ms"）也不准确：
  放大来自 12 次完整认证（哈希 + audit），不是单纯哈希。
- **修复（测试所有权迁移，非 timeout/skip/retry）**：
  1. **删除** auth route 的 `APP_MODE=e2e does not rate-limit repeated login
     requests` 用例。该 proof 不属于 auth route 测试。
  2. **保留** auth route 的 `non-e2e mode enforces the route-level login
     limiter` 用例不动——它继续负责证明真实登录路由的 route-level `max=10`
     行为（10 次成功 + 第 11 次 429，不减少 10+1 边界）。
  3. **扩展** `apps/api/src/plugins/rateLimit.test.ts`：每个测试创建并关闭自己
     的 Fastify app（`buildRateLimitProbeApp()` + `finally { app.close() }` +
     `afterEach` unstub env + reset runtime config），避免 runtime config 缓存
     与请求计数跨测试泄漏。新增 E2E bypass proof：route `max=1` 时第 2 次请求仍
     返回 200（route `max=1` 下，第 2 次请求就是 limiter 是否生效的完整边界证明）。
- **没有掩盖问题**：未使用单测试 timeout、未 skip、未 retry。生产 rate-limit 与
  auth 行为未改动。plugin-level E2E bypass proof 迁移到一个无数据库、无 argon2、
  无 audit 的纯 plugin 测试，证明成本与被测对象匹配。
- **未误套其他条目**：本修复不涉及旧文档中 legacy-role 测试的"6 轮 login + audit
  polling"放大（那是 BUG-FLAKE-001 auth amplification 子类的另一用例），也未声称
  根因是固定的"argon2 400ms"。

### 2026-08-01 — PR #242 flake closeout: advisory-lock database scope + time-based concurrency sync（REC-I6-I1-INCIDENT-PERSISTENCE-COMMANDS）

- **现象**：PR #242 的本地全套测试曾出现失败后重跑通过（`incidents.admin.concurrency.test.ts`、
  `0023-incident-fk-and-rollback.test.ts`、`testInfraLock.test.ts`、`testWorkerDatabase.test.ts`）。
  本次 closeout 未能复现原始失败（baseline 全部通过），但按源码证据修复了三处确定的非确定性。
- **根因 1（advisory lock 是 database-local）**：`withTestInfraLifecycleLock` 直接连接调用者传入的
  任意数据库。schema lifecycle 调用者锁在 `exam_test`，database lifecycle 调用者锁在 `postgres`，
  worker-DB 调用者锁在 worker database——即使 key 相同也**不能相互协调**（PostgreSQL advisory lock
  只在同一 database 内互斥）。修复：`testInfraLock.ts` 新增 `resolveTestInfraCoordinationUrl`，
  把任意输入 URL 规范化到单一 coordination database（`TEST_ADMIN_DATABASE` ?? `postgres`，剥离
  search_path/options，校验名字安全），`withTestInfraLifecycleLock` 内部统一到该 URL；
  `testWorkerDatabase.ts` 的 `resolveAdminUrl` 复用同一 resolver。
- **根因 2（incident 并发测试用时间同步）**：`incidents.admin.concurrency.test.ts` 用
  `setTimeout(150)` / `setTimeout(100)` head-start 制造竞态，`t1Committed`/`t2Release` 两个 deferred
  创建但不承担调度。修复：test-only `IncidentRepo` proxy 在事务内精确门控（T2 pre-read 完成后等待 →
  T1 获取行锁后等待 → T2 在真实 `findByIdForUpdate` 前 signal `t2LockAttempted` → 释放 T1 提交 →
  T2 用旧 REPEATABLE READ snapshot 醒来冲突 → recovery → idempotent_replayed），并记录两个 primary
  transaction 的 `pg_backend_pid()` / `txid_current()` 断言；resolve-vs-dismiss 改为双 pre-read
  完成后同时释放、行锁选胜者。全部 `setTimeout` / head-start 删除，deferred 在 `finally` 中
  dispose（断言失败也不留挂起事务/连接/timer）。
- **根因 3（新 migration tests 未进 lifecycle lock）**：0023 的 `applyAllMigrations`、
  `incidents.admin.concurrency.test.ts` 的 `migratePostgres`、`getIsolatedTestDb()` 的
  `migratePostgres` 都在 lock 外。修复：全部包进 `withTestInfraLifecycleLock`（canonical 到同一
  coordination DB，与 CREATE/DROP DATABASE、CREATE/DROP SCHEMA 真正互斥）。
- **根因 4（catalog 查询跨 schema 误读）**：0023 的 FK 断言按 `conname` 查全库并读 `rows[0]`，
  可能读到并行 schema 的同名 constraint。修复：`pg_constraint JOIN pg_class JOIN pg_namespace`
  限定 `nspname = iso.schemaName`、`relname = exam_incidents`，`rows.length === 1`。
- **修复 5（testInfraLock sleep 测试）**：串行化测试的 `setTimeout(120)` hold 改为
  deferred-gated critical section + 真实 `pg_locks` 证据（one granted holder + ≥1 ungranted waiter，
  classid/objid 重构 key 一致）；新增跨数据库真实 PostgreSQL 回归测试（holder 走 `exam_test` URL、
  contender 走 `postgres` URL，同一把锁）。
- **单队列预算（hang protection，非掩盖）**：统一 coordination DB 后所有 heavy DDL 在同一队列
  串行；并行 `@exam/db` 下快操作可能排在秒级 CREATE/DROP DATABASE 之后，默认 5s testTimeout
  不够。为参与队列的测试/describe 增加显式 timeout（testIsolation 30s/60s、testWorkerDatabase 30s、
  testInfraLock 30s、0023 60s、seed/testCleanup 60s），注释明确这是确定性队列的 hang protection，
  不参与排序。实测修复前 full `@exam/db` 4 次中 1 次击穿 5s；修复后连续 5/5 PASS。
- **没有掩盖**：未用 retry / skip / quarantine；未仅调 timeout 掩盖竞态（竞态已由确定性 barrier /
  统一锁根除）；无固定 sleep 作为排序机制（`pg_locks` 轮询是 bounded polling，谓词必须被真实锁
  状态满足才继续）。

---

## 已升级条目

### BUG-FLAKE-001 — `routes/attempts/deadline-scanner.test.ts` 后台扫描在 coverage 模式下 5s timeout

**状态**: 已关闭（≥3 次复发，2026-06-13 升级；2026-08-26 完成槽位身份根因修复）。当前处置见下方「当前缓解」，不依赖任何已删除的串行脚本。

**两类根因（均已修复，这是本条目唯一仍有效的口径）**:

1. **state leak** — 全部测试文件共享 `exam_test.public` schema：跨文件 / 跨 worker /
   跨 package 的状态残留。由每文件独立 schema（`packages/db/src/testIsolation.ts`）与
   每执行槽位物理库（`packages/db/src/testWorkerDatabase.ts`）隔离消除。
2. **slot 身份错绑导致的 DDL 队列负载** — `testScope.resolveWorkerId` 曾把槽位域资源
   绑到 `VITEST_WORKER_ID`（每文件一个新实例 id），使 `maxWorkers` 形同虚设，并把
   advisory-lock 队列深度放大成无关文件的 hook 超时。2026-08-26 审计改为
   `VITEST_POOL_ID`（见下方该日条目）。

> **本条目早期的权宜缓解（串行脚本链、scanner legacy timeout、lifecycle command
> split）已随根因修复从 `package.json` 与 CI 接线中删除；不要按历史版本重新引入。**

**当前缓解（现行配置，不是本条目遗留项）**:

1. **隔离边界**：每文件独立 schema + 每执行槽位物理库（`exam_test_w<VITEST_POOL_ID>`，
   基数受 `maxWorkers` 约束、跨 run 复用）+ `withTestInfraLifecycleLock` 单键临界区。
   细节与生命周期所有者见 [`docs/standards/testing.md` §2.8](./testing.md#28-test-database-lifecycle-ownership)。
2. **串行仍是 `apps/api` 默认**：`fileParallelism: false`。并行是 env-gated opt-in：
   `TEST_DB_ISOLATION=worker-database` 且 `API_TEST_MAX_WORKERS` 为正整数；CI 与
   `pnpm verify` 走该路径（4 worker）。配置权威见 `apps/api/vitest.config.ts` /
   `apps/api/vitest.parallelism.ts`。
3. **长循环用例显式传预算**：scanner / contention 类用例在调用点显式传 timeout
   （如 `heartbeat.test.ts` 的 15_000 ms），而不是放宽包级 `hookTimeout`。

**禁止做（仍然有效）**:

- 永久延长 scanner 自身超时（产品代码不为测试便利让步）
- skip 该用例
- 在 CI 上设置自动重跑后默认通过（会掩盖真实回归）
- 为消灭本家族继续给单个用例叠加 timeout，而不是修隔离 / 调度根因

**Stress 验证脚本**: 项目根的 `scripts/test/verify-stress.sh` 提供手动连续运行 `pnpm verify` 的脚手架（默认 3 次，可传参，例 `bash scripts/test/verify-stress.sh 5`）。该脚本不进入 CI，仅供开发者在改 vitest 调度或 PG 隔离机制时手动验证稳定性。

**复发记录**:

- 2026-06-13：S06-lite review 修复阶段，单次出现，重跑通过（普通 flake）
- 2026-06-13：S07-lite GREEN 阶段，`pnpm verify` coverage 模式连续 3 次同位置 timeout——触发升级，应用 C 方案 timeout 缓解
- 2026-06-13：A07 i18n GREEN 阶段，`pnpm verify` 再次出现同位置 timeout——单点 timeout 缓解失效（仅延长边界，未消除根因），按"再次出现"触发条件升级为 A′ apps/api coverage serial containment
- 2026-06-13：A′ 方案首轮 `verify-stress.sh 5 --no-cache` 验证时，**packages/db `demo-seed.test.ts` 同样出现 5s timeout**——证明 PG 资源争用同样影响 packages/db。修复扩展到 `packages/db/vitest.config.ts` 同样设置 `fileParallelism: false`
- 2026-06-20：P2C-J2/J3 恢复（`feat/p2c-j5-proctor-dashboard` 分支）后跑 `pnpm verify`，scanner 用例再次 5s timeout——`attempts.test.ts > deadline scanner > is idempotent: second scan does not re-grade or duplicate audit` 与 `> heartbeat scanner > leaves a still-stale in_progress attempt for the next scan when this scan finds nothing to disrupt` 两个用例 timeout（5000ms），均为 scanner 家族。同代码单跑整文件 `vitest run src/routes/attempts.test.ts` 68/68 green；`-t "force-submit|extend-time|misconduct"` 15/15 green。属 BUG-FLAKE-001 重负载 timeout 家族，与 J2/J3 恢复改动无因果（恢复仅新增 force-submit/extend-time 路由与测试，未触碰 scanner 代码）。
- 2026-06-20：`attempts.ts` 机械拆分为 `attempts.{candidate,admin,shared}.ts`（同分支）后，连续 3 次 `vitest run src/routes/attempts.test.ts` 整文件运行中，同样的 scanner 用例（`is idempotent: second scan...` / `leaves a still-stale in_progress attempt...`）间歇 5s timeout（1–2 个用例，非断言错误）。单独复跑 `-t "is idempotent: second scan|leaves a still-stale"` 时 1 个 timeout、1 个 4532ms 勉强过；`-t "force-submit|extend-time|misconduct"` 15/15 green。失败用例固定落在 deadline/heartbeat scanner describe，且为 timeout（非断言），符合 BUG-FLAKE-001 PG I/O 争用特征。拆分仅改路由层 register hub 与文件归属，未触碰 scanner 代码（`packages/exam-engine` 的 `scanDatabase*` 与 `apps/api/src/plugins/{deadlineScanner,heartbeat}.ts` 均未改动），判定无因果关系。
- 2026-06-23（**auth amplification 子类**）：`auth.test.ts` 在全量 `pnpm verify` / coverage 模式下出现 5000ms timeout。standalone 定向运行 2/2 PASS（约 2.2s），但 full coverage 1/1 FAIL。归类为 BUG-FLAKE-001 的 **auth amplification** 子类：auth login / audit polling（单用例 6 轮 login + 每轮 audit 轮询）在全量 coverage + PG I/O 争用下被放大，无法在 5s 默认 testTimeout 内收敛。该观察**不**证明 auth 业务逻辑错误，也**不允许**通过单点 timeout / skip 掩盖（历史诊断曾误把"maxWorkers=50% 通过"当并行安全证据；standalone PASS ≠ 全量并行/coverage PASS）。归入 BUG-FLAKE-001，不另开 BUG-FLAKE-005。
- 2026-06-23（**physical-DB-lifecycle 子类**）：`packages/db/src/testWorkerDatabase.test.ts` 的 `ensureDatabaseExists > creates the database if missing, idempotent on second call` 在 `pnpm verify` / coverage 模式下 5000ms timeout。standalone test 与 standalone coverage 均可通过：单跑 `src/testWorkerDatabase.test.ts` 12/12 PASS（约 1.4–1.8s）；standalone coverage 中 `ensureDatabaseExists` 约 2009ms，明显慢于 normal test 下约 627ms。归类为 BUG-FLAKE-001 的 **physical-DB-lifecycle** 子类：`CREATE DATABASE` / migration / truncate 这类 PG lifecycle 操作在 coverage + turbo 交叉任务 PG 争用下更容易击穿默认 5s。该观察**不应**通过专属 timeout 掩盖，不 skip、不加 timeout、不从 full path 删除。归入 BUG-FLAKE-001，**不另开 BUG-FLAKE-005**；standalone 通过**不**等于根治。
- 2026-07-20（**WSL2 host-performance 子类**，wide-surface 复发）：在 M10-E typecheck 修复 unblock 后跑 `pnpm verify`（`TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4` + coverage instrumentation），出现大规模 timeout 失败：31 个文件 fail / 13 个测试 fail，全部是 5000ms timeout（`api-smoke.test.ts`、`auth.test.ts` SuperAdmin/ContentManager/ResultViewer login 用例、`examStateMachine.test.ts` auto-open 用例、`@exam/db` 的 `testWorkerDatabase` / `testInfraLock` / `seed` 等）。同代码 standalone / serial 全部通过：
    - `pnpm --filter @exam/api test`（serial，`fileParallelism:false` 默认）→ **1479/1479 PASS（281s）**，与此前记录的 stable baseline 完全一致。
    - `pnpm --filter @exam/db exec vitest run --no-file-parallelism` → **231/231 PASS（27.5s）**，连续两次稳定。
    - 失败的 `testWorkerDatabase.test.ts` / `testInfraLock.test.ts` / `seed.test.ts` standalone 复跑：15/15 PASS（2.72s）、10/10 PASS（2.56s）——同代码、同 DB、同 PG 容器，**仅去掉并行负载即全过**。
    - **根因假设（host-performance bound，非代码回归）**：本机 WSL2 在 4-worker × v8 coverage × 每 worker 持续 `buildTestApp()`（CREATE SCHEMA → migrate → seed）下，瞬时 I/O 调度无法在 5s testTimeout 内收敛。8 core / 11 GB / load avg 3+；`pnpm verify` ~281s PASS 的基线是在更安静的本机状态下取得的，本机当前性能更差。**这是 BUG-FLAKE-001 I/O contention + physical-DB-lifecycle 子类的宿主性能放大，不是产品代码 / 测试代码 bug**——M10-E 修复仅触及 testHelpers 类型、E19 测试、migration 0015 guard、openapi.json，全部不影响 runtime 性能。
    - **不掩盖**：不调长 `api-smoke` / `auth` / `testWorkerDatabase` 单点 timeout，不 skip，不在 CI 默认重跑后通过。serial baseline 已充分证明改动正确性。
    - **后续动作（用户决定）**：等迁移到 **Linux 实体机**后重跑 `pnpm verify`，确认 parallel+coverage 在真实硬件下是否稳定。若实体机上 parallel `pnpm verify` 连续 N 次 PASS，则本子类可视为 WSL2-only，更新本条目。在此之前，本机 verify 用 serial baseline（`pnpm --filter api test` + `pnpm --filter db exec vitest run --no-file-parallelism` + `pnpm build` + `pnpm verify:static`）。
- 2026-08-11（**0027-convergence 子类**，issue #280）：`packages/db/src/migrations/0027-convergence.test.ts` > `fails closed when a required column is missing` 在全量 `pnpm verify`（`TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4` + coverage）下 5000ms timeout（`@exam/db#coverage` 564/565，与 issue #280 正文逐字一致）；`pnpm --filter @exam/db coverage` standalone 通过。该用例是 0027 文件里唯一在 `it` 体内二次 bootstrap 隔离 schema（`makeEnv` → 全量 migrate → sabotage DDL）的用例，覆盖插桩 + 跨包 PG 争用下无法在默认 5s 内收敛。同家族 artifact：`testCleanup.test.ts` 的 `cleanup is not a function` afterAll 是 `beforeAll` 超时被掩盖的次生错误。**应用 `packages/db/vitest.config.ts` stress-note 规定的定向修复**：仅给该 `it` 加 `{ timeout: 15_000 }`（沿用 `testWorkerDatabase` 15s / `demo-seed` 30s 既有预算惯例），**未**做 package-wide serial override、**未**做 blanket timeout bump、无 retry / skip / 断言弱化。归入 BUG-FLAKE-001，不另开新条目；CI（独立 job 拆分）全程 green。

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
- 备注（潜在脆弱性，非 #98 范围）：每文件 `file-schema`
  用 `search_path=${schema},public`，理论上 `public` 污染可泄漏；若未来此类
  flake 复发，值得调查是否去掉 `public` fallback 或让 worker-DB 模式跨模式
  切换时 flush `public`。这属于 ADR-007 test infra 范畴，非业务逻辑修复。

---

### BUG-FLAKE-002 — 跨 package / 跨 task 共享 `exam_test` DB 导致 seed/cleanup 互相覆盖

**状态**: 已关闭（2026-06-17 缓解 → 2026-06-21 根因修复）。曾经用于缓解的分阶段串行脚本已随根因落地从 `package.json` 删除，不再是本仓库的可用命令，也不是本条目要求的缓解。

**Old root cause**: `@exam/db` 与 `@exam/api` 共享 `exam_test.public` schema。turbo 并发调度 `test` 和 `coverage` 任务时，A 任务 seed 写入 default org 的同时 B 任务 cleanup 删除同一 org → FK violation / 身份认证失败。

**New root fix**: `packages/db/src/testIsolation.ts` 提供 `setupIsolatedTestDb({ namespace })` + `buildTestApp(plugin, { schemaName })`，每个测试任务可拥有独立 PG schema 且互不干扰。通过 `SET search_path` + `migrationsSchema` 实现 schema 级隔离。已验证：`testIsolation.test.ts` 32 个隔离测试全部通过。

**失败链（历史复现链路，2026-06-17 观察）**:

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

- 不是单 package 内并行（`fileParallelism: false` 只作用于 `apps/api`）
- 不是产品代码 bug（seed / cleanup / 路由均未改动）
- 不是迁移问题（schema 早已就位）

**根因**: `@exam/db` 与 `@exam/api` 是仅有的两个使用共享 `exam_test` PostgreSQL 实例的 package。`fileParallelism: false` 只消除 *单 package 内* 的文件并行，**不**消除 turbo 在单次调用里跨 package / 跨 task（test vs coverage）的并发。当 `turbo run test coverage`（或任何把 DB-touching 任务放进同一次调度的命令）执行时，多个任务会并发写同一个 `default` 组织及其清理钩子，互相覆盖。

**根因修复（2026-06-21，已完成）**: 每个测试任务拥有独立 PostgreSQL 隔离域——
`packages/db/src/testIsolation.ts` 的每文件 schema（`setupIsolatedTestDb({ namespace })` +
`buildTestApp(plugin, { schemaName })`，`SET search_path` + `migrationsSchema`）与
`packages/db/src/testWorkerDatabase.ts` 的每执行槽位物理库。跨 package 并发 stress 5/5 PASS。
缓解方案建立在 `docs/SPEC.md` §3.1 Organization Data Boundary Guard 定义的"所有业务数据
归属于内部 default organization"之上——测试 seed 与 cleanup 同样操作 default 组织，
跨任务共享此状态即触发竞争。

**禁止做（仍然有效）**:

- 用 sleep / 随机重试 / 全局 timeout 掩盖竞争
- 删除 seed 测试的 cleanup 钩子（除非能证明所有 seed 测试完全幂等且不依赖干净 DB）
- 改 seed 业务行为来迁就测试调度

**验证命令**:

```bash
pnpm --filter @exam/db test
pnpm --filter @exam/api test
pnpm verify           # 当前组成以根 package.json 为准：verify:static → coverage → build
```

**复发记录**:

- 2026-06-17：P2A-J2 PR review 阶段，`turbo run test coverage --force` 复现 `@exam/db#coverage` 失败（seed idempotency / demo-seed 在并发下被对方 cleanup 覆盖）。

---

### BUG-FLAKE-003 — deadline scanner tests leak expired attempts across repeated runs

**状态**: 已关闭（2026-06-20 缓解 → 2026-06-21 根因修复）。deadline scanner 套件与其余
DB-touching 文件一样接入隔离域，跨 run 数据残留从源头消除。

**Old root cause**: `cleanup()` 只关闭连接不删数据。deadline scanner 测试创建的 expired attempts（voided / future-deadline / race-noop 逃逸场景）在 run 结束后残留在 `exam_test.public` schema 中。`scanDatabaseForExpiredAttempts` 扫描整个 org 的全部 expired attempts，跨 run 污染。

**root fix**: 每测试文件 / 每执行槽位独立 PG 隔离域（`testIsolation.ts` 的
`setupIsolatedTestDb()` + `SET search_path`；worker-database 模式下为每槽位物理库），
从源头保证每次 run 的数据不会残留到下一次。

**当前缓解**:

- `beforeEach` 清理 + `afterAll` 组织清理（2026-06-20，cleanup containment）仍为主缓解。
- `apps/api` 默认串行（`fileParallelism: false`）确保 scanner 测试串行运行。
- `scripts/test/deadline-scanner-stress.sh` 用于手动验证。

**修复（2026-06-20）**:

1. `apps/api/src/routes/attempts/deadline-scanner.test.ts` 添加 `beforeEach` 清理：每次测试前删除残留的 deadline-scanner-test-* 组织及其数据，确保每次测试从干净状态开始。
2. 新增 `cleanupBusinessData()` helper（`packages/db/src/testCleanup.ts`）：删除考试业务数据（audit、attempts、enrollments、exams、questions、courses），保留组织、用户、候选数据。与 `cleanupOrganizationChildData` 共享底层 `deleteExamBusinessData` 私有 helper。
3. 新增 stress 脚本 `scripts/test/deadline-scanner-stress.sh`：连续运行 deadline scanner 测试，默认 40 次。
4. 新增 `cleanupBusinessData` 回归测试（`packages/db/src/testCleanup.test.ts`）。

**验证**: 5 次 stress test 全过；`pnpm verify` 全过。

**当前缓解**: `beforeEach` 清理 + `afterAll` 组织清理。跨 run 数据累积问题已消除。

**失败位置**:

- 文件：`apps/api/src/routes/attempts/deadline-scanner.test.ts`（原 `routes/attempts.test.ts:1959`）
- 用例：`scanDatabaseForExpiredAttempts > does not touch a voided attempt whose deadline has passed`
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

- 同一 `exam_test` PostgreSQL 实例上连续多次运行 `pnpm --filter @exam/api test -- src/routes/attempts/deadline-scanner.test.ts`
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
  pnpm --filter @exam/api test -- src/routes/attempts/deadline-scanner.test.ts && echo "Run $i: PASS" || { echo "Run $i: FAIL"; exit 1; }
done

# 对照：fresh DB 首次运行不应触发
docker exec exam-test-pg psql -U exam -d exam_test -c "DELETE FROM exam_attempts"
pnpm --filter @exam/api test -- src/routes/attempts/deadline-scanner.test.ts  # 应 PASS
```

**复发记录**:

- 2026-06-18：50-run reproduction 脚本，Run 38 首次失败（`submittedCount: 3`）。Run 1-37 全过。DB 累积 94 条 expired disrupted attempts。

### Stress verification — BUG-FLAKE-003 deadline scanner

| Command | Runs | Result | Notes |
|---|---|---|---:|---|
| `pnpm --filter @exam/api test -- --run src/routes/attempts/deadline-scanner.test.ts` | 5 | PASS | Cleanup containment + 串行默认: no leaked expired attempts |
| `pnpm --filter @exam/api test -- --run src/routes/attempts/heartbeat.test.ts` | 5 | PASS | No timeout, no state leak |

这些 stress 是在 cleanup containment + `apps/api` 串行默认之下验证的。

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

`apps/api` 内所有测试文件共享同一个 `exam_test` PostgreSQL schema。`fileParallelism: false`（`apps/api` 串行默认）消除了文件并行，但**未消除跨文件状态残留**：前序文件写入的行在后续文件中仍可见。`tenant-isolation.test.ts` 的 `cleanup()` 只关闭连接不删数据（与 BUG-FLAKE-003 同源），留下非法 fixture 污染后续文件的 list 查询。

**与已知条目的关系**:

- **BUG-FLAKE-001**（`fileParallelism: false` 串行默认）只解决并行 I/O 争用，不解决状态残留。
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

### RESOLVED-002 — migration 0015 step 3 stuck-state（SuperAdmin / 非 assignable orphan user 触发 CHECK violation，migration 永久卡死）

**状态**：已修复（2026-07-20，本分支 `feat/rbac-M10-E`）。表面像 BUG-FLAKE-001 family 的 timeout，实为**确定性的 migration 正确性 bug**——只是长期被 `pnpm verify` 在 typecheck 阶段 fail 掩盖，typecheck unblock 后才暴露。

**失败位置**

- 文件：`packages/db/migrations/postgres/0015_crazy_anita_blake.sql` step 3（INSERT backfill orphaned users）
- 现象：`pnpm verify` 到 coverage 阶段时，`@exam/db` / `@exam/api` 的 worker database 在 `setupWorkerTestDatabase` 的 `migratePostgres` 步骤抛 `PostgresError: new row for relation "user_role_assignments" violates check constraint "user_role_assignments_role_check"`，detail 显示失败行的 `role` 列是 `SuperAdmin`。
- 受影响 worker database（实测）：`exam_test_w0`（15/16 migrations, 1 non-assignable user）、`exam_test_w3`（15/16, 3）、`exam_test_w11`（15/16, 1）、`exam_test_w75`（15/16, 0 non-assignable，但 primary 多重导致 step 5 index 失败）。这些 DB 进入永久卡死状态：每次 `migratePostgres` 都会重跑 0015 → 都 fail → migration 永不记录为 applied。

**根因（证据驱动）**

1. `user_role_assignments.role` 有 CHECK 约束 `IN ('Admin','Teacher','Proctor','Grader','Candidate')`（`packages/db/src/schema/pg.ts:674-677`）。
2. `users.role` 列**没有** CHECK 约束（`pg.ts:111`），可持有 `SuperAdmin` / `System` / `ContentManager` / `ResultViewer` 等非 assignable 值——测试 negative fixture（`createUnassignedUserForTest`）和 legacy 数据都用这种"非 assignable sentinel"role。
3. migration 0015 step 3 的 INSERT backfill 对每个"无 assignment row"的 user，用 `u."role"` 作为新 assignment 的 role。若 `u."role"` 非 assignable → 违反 CHECK → 整个 migration 事务回滚。
4. **Drizzle 的 `migrate()` 把所有 pending migration 包在一个 transaction 里**（`drizzle-orm/pg-core/dialect.js:60` `await session.transaction(async (tx) => { for ... })`）。一旦某个 statement fail → 整个事务 ROLLBACK → `__drizzle_migrations` 没有记录任何 applied 行 → 下次 `migratePostgres` 重跑同一批 pending migrations → 同样 fail → **infinite stuck**。
5. 触发条件：测试在 worker database（持久、跨 run 复用）创建 `users.role='SuperAdmin'` 且无 assignment → 下一轮 run 的 `setupWorkerTestDatabase` → `migratePostgres` → step 3 INSERT → CHECK fail → stuck。

**修复（已落地，2026-07-20）**

- `packages/db/migrations/postgres/0015_crazy_anita_blake.sql` step 3 加 `WHERE u."role" IN ('Admin','Teacher','Proctor','Grader','Candidate')` 守卫。非 assignable orphan 被故意跳过：它们没有合法 role 可分配，runtime resolver（`deriveAssignmentAuthority`）本就 fail-closes on "no active primary assignment" → 跳过**保留**了安全不变量，而不是削弱。
- DROP 4 个卡死的 worker database（`exam_test_w0/w3/w11/w75`）。Worker DB 是 per-worker、disposable，DROP 后下一轮 run 重建即恢复。
- Drizzle 行为核验（Context7 + 源码）：Drizzle 用 `folderMillis`（timestamp）比较决定是否 run，**不**比较 hash；编辑已 applied 的 migration 文件不会 trigger 重跑，hash mismatch 仅在 v0→v1 upgrade path 才检查。本次编辑对已 applied 的 DB（w1/w2/w4 等 16/16 migrations 的）无影响。

**为什么不是 flake**

- **确定性**：只要 worker DB 里有非 assignable orphan user + migration 0015 未 applied，**必然** fail，不会"再跑就过"。
- **代码 bug**：migration 0015 step 3 的 INSERT 缺少 role 守卫，是产品迁移逻辑错误，不是 I/O 争用。
- **生产影响**：这不只是测试 bug——任何升级到 M10-E 且 DB 里有 `users.role` 为非 assignable 值的 orphan user 的部署，都会 stuck migration。修复 migration 是必需的，不只是清理测试。

**排查复用要点**

遇到 `setupWorkerTestDatabase` / `migratePostgres` 抛 `user_role_assignments_role_check` violation：

1. 查 `users` 表里是否有 `role NOT IN ('Admin','Teacher','Proctor','Grader','Candidate')` 的 row：`SELECT role, count(*) FROM users GROUP BY role;`
2. 查 `__drizzle_migrations` 的 count：`SELECT count(*) FROM drizzle.__drizzle_migrations;`（当前应有 16 条；少于 16 即 stuck）
3. 若 stuck，DROP 该 worker database 重建；migration 0015 已加守卫，不会再因 orphan user 卡死。
4. 若在生产 deploy 看到，先清理或 reassign 这些 orphan user（或接受它们保持 no-assignment），再跑 migration。

---

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

- **测试 DB 隔离（follow-up，非本 PR）**：根因 1 之所以能炸到 3 个文件，本质是 `exam_test` PG 跨文件共享 schema、无 per-file/per-worker 隔离。这与 BUG-FLAKE-001 的隔离修复（每文件 / 每槽位独立隔离域）同源。当前 `apps/api/vitest.config.ts` 的 `fileParallelism: false`（A′ 方案）只是串行化，并未消除跨文件状态残留。
- 不要把 `setupErrorHandler` 的 500 文案当真去查产品代码——500 在本例来自响应 Zod 校验/插件缺失，错误处理器把它统一包成了 `INTERNAL_ERROR`，掩盖了真实原因。排查此类 500 时优先用 `app.addHook("onError", ...)` 或临时 `setErrorHandler` 打印 `err.message` / `err.cause`。

**排查复用要点**

遇到 `GET /api/exams`（或任何 list 路由）返回 500 INTERNAL_ERROR：

1. 先确认是不是 DB 状态污染：`DROP SCHEMA public, drizzle CASCADE; CREATE SCHEMA public` 后单跑该文件。若过 → 是跨文件残留，查 fixture 是否写了契约非法值。
2. 若不过，用 `onError` hook 打印真实 `err.message`：若为 `fastify.now is not a function` → 测试 app 漏注册 `nowPlugin`；若为 Zod `too_small`/`invalid_type` → 响应里有契约非法字段，查 fixture。
3. 响应 500 + 错误处理器统一文案时，**不要**先怀疑产品代码。

---

## 2026-06-20 — misconduct flag 测试在 `-t` 全文件运行时偶发失败

### 失败位置

- 文件：`apps/api/src/routes/attempts/admin-misconduct.test.ts`
- 用例：`POST /api/admin/attempts/:attemptId/misconduct` describe 块内（非固定某一用例）
- 调用：`pnpm --filter @exam/api test -- src/routes/attempts/admin-misconduct.test.ts -t "misconduct"`

### 错误

```text
Tests  1 failed | 527 passed (528)
```

（失败用例不固定，且第二次同代码运行即 528 green。多数表现为某用例 timeout 或 DB 争用错误。）

### 出现场景

- 分支：`feat/p2c-j4-misconduct-flag`（P2C-J4 /review 修复阶段）
- 当时正在做：应用 /review 技能评审修复（迁移末尾换行 + 补 403 测试）
- 触发命令：`-t "misconduct"` 命中整个 misconduct describe，连带执行当时单文件内的其余 528 个用例
- 复跑结果：第一次 1 failed / 527 passed，第二次立即 528 green

### 根因假设

与 2026-06-20 J3 beyond-close flake 同一家族：`-t` 过滤匹配到整个 describe，导致整文件用例在共享 `exam_test` PG schema 上执行，触发跨用例 DB 状态泄漏 / 资源争用（BUG-FLAKE-002 / BUG-FLAKE-004）。此 flake 与本次改动无因果——403 测试 + 迁移末尾换行不可能产生间歇性测试失败。

### 已知不是的原因

- 不是 403 测试本身有 bug：单独跑全文件时该用例通过
- 不是迁移问题：迁移 0003 是 ADD COLUMN（additive），不影响既有用例
- 不是 flagMisconduct 逻辑缺陷：单跑整文件 528 green

### 当前缓解

无单点缓解（符合登记规则——偶发、与当前改动无因果，不主动加 timeout 或 skip）。
注：`apps/api` 串行默认（`fileParallelism: false`）仅控制跨文件并行，并**不**阻止 `-t` 过滤导致单文件内用例串行执行时的状态泄漏——此类同一文件内的跨用例争用由每文件 / 每槽位隔离域覆盖。

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
- 当时正在做：`pnpm verify` 全链路验证（已通过 static checks，到达 `@exam/db coverage`）
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

无单点缓解（符合登记规则——偶发、与当前改动无因果，不主动加 timeout 或 skip）。
定向复跑用 `pnpm --filter @exam/db test -- --run src/testWorkerDatabase.test.ts`；
覆盖闸门 `pnpm verify` 仍覆盖该文件。**不 skip、不从 full path 删除、不加专属
timeout**。归入 BUG-FLAKE-001 physical-DB-lifecycle 子类，**不另开 BUG-FLAKE-005**。

### 后续动作

- 观察：若该位置复发 ≥3 次或在 PR CI 上稳定出现，升级为正式条目（BUG-FLAKE-001 家族 worker-DB 变种）。
- 根因修复走 BUG-FLAKE-001 B 方案 follow-up 方向：测试期 semaphore 串行化隔离 schema/数据库的 create/migrate/seed；或预迁移模板减少物理 CREATE DATABASE 频次。
- **不要**因为单次 flake 而给 `testWorkerDatabase` 单点加 timeout 或 skip 该用例（会掩盖真实回归）。

### 复发记录

- 2026-06-23：P2E-J2 实现 `pnpm verify` 收尾时单次出现（1/151），`pnpm --filter @exam/db test testWorkerDatabase` 立即 12/12 PASS。
- 2026-07-21：ADR-006 proportionality corrective 的 `pnpm verify` 在 full turbo
  coverage 负载下再次命中同一 `ensureDatabaseExists` 用例；本次 suite
  timeout 已是 15,000ms，失败仍是超时而非断言或 PostgreSQL 错误。失败后
  PostgreSQL `pg_stat_activity` 中无 `exam_test%` 活动/等待连接；当时有 84 个
  历史 `exam_test_w%` worker database。同代码立即隔离复跑整文件 15/15 PASS
  （2.18s），随后 `@exam/db` 全 coverage 233/233 PASS（13.38s）。继续按已有
  处置：不增加单点 timeout、不 skip，将 full-turbo PG DDL 争用作为独立
  test-infrastructure follow-up，不与本次 audit 业务改动混合。

---

## 2026-07-25 — `ea-lock-order.test.ts` 100 次并发 contention 循环在全量 coverage 下超时

### 失败位置

- 文件：`apps/api/tests/concurrency/ea-lock-order.test.ts`
- 用例：`repaired contention schedule is stable across 100 consecutive runs`
- 调用：`pnpm verify`（`TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4` + coverage instrumentation）

### 错误

```text
Error: Test timed out in 5000ms.
  ❯ tests/concurrency/ea-lock-order.test.ts:292:3
```

### 出现场景

- 分支：`feat/p5-n1-notification-inbox`（P5-N1 review 修复阶段）
- 当时正在做：应用 CodeRabbit review 意见修复后跑 `pnpm verify`
- 触发命令：`pnpm verify`（full turbo coverage）
- 复跑结果：同代码单独运行立即通过（`npx vitest run tests/concurrency/ea-lock-order.test.ts --testTimeout=15000` → 3/3 PASS，100 次循环 1251ms）

### 根因假设

属 BUG-FLAKE-001 家族：100 次连续 contention schedule 循环（每次含 PG 事务 + advisory lock 争用）在全量 coverage（v8 instrumentation 放大 I/O）+ 4 worker 并行调度下，累积延迟击穿 5s 默认 testTimeout。standalone 无 coverage 插桩时 100 次循环仅需 ~1.2s，远低于阈值。

### 已知不是的原因

- 不是 P5-N1 通知改动引入：改动仅触及 notifications 模块、contracts、文档，与 `ea-lock-order.test.ts`（exam attempt 锁序）无因果
- 不是锁序逻辑回归：同代码 standalone 100 次循环稳定通过
- 不是 PG 连接池耗尽：错误是 timeout，不是连接错误

### 当前缓解

无单点缓解（符合登记规则——偶发、与当前改动无因果，不主动加 timeout 或 skip）。该测试 standalone 稳定通过，仅在全量 coverage 并行负载下偶发超时。

### 后续动作

- 不采用单点 positional timeout（如 `15_000` ms）。在既有隔离与调度缓解之上继续给单个用例加 timeout 只会掩盖 I/O 争用根因（见 BUG-FLAKE-001「禁止做」与登记规则）。若复发 ≥3 次，按登记规则升级为正式跟踪条目，并在原条目标记「已升级」。
- 根因修复统一走 BUG-FLAKE-001 B 方案后续（coverage 插桩下 PG 争用基线改善）：降低 coverage 放大、评估 worker-database 并行基线、或在更接近 CI 的硬件上重测以判定是否为 WSL2 host-performance 放大。在根因收敛前，本机 verify 继续用 serial baseline，不针对本用例做单点缓解。

### 复发记录

- 2026-07-25：P5-N1 review 修复阶段，`pnpm verify` 全量 coverage 下单次出现（1/1598），standalone 立即 3/3 PASS（1.2s）。
- 2026-09-19：#550 corrective-1 campaign 门禁（`pnpm test`，plain turbo 无 coverage）单次出现——同机数分钟前刚结束 95-min production-mode soak 测量，turbo 15 包并行负载击穿 5s 默认 testTimeout；standalone `npx vitest run tests/concurrency/ea-lock-order.test.ts` 立即 3/3 PASS（tests 1.8s），全量 `pnpm test` 复跑 EXIT=0（2,813 passed / 12 skipped）。与 2026-08-31 条目同机制（宿主负载型，操作背景引入），无代码改动、不调 timeout、不 skip。

---

## 2026-09-24 — assignment-affordances Story C 单次 transport 失败（#601 Phase F E2E 全量）

### 失败位置

- 文件：`apps/e2e/e2e/assignment-affordances.spec.ts`
- 用例：`Story C: a course beyond the first 100 is reachable via catalog search and assignable (issue 548 corrective)`
- 调用：`bash scripts/e2e/run.sh`（全量，2 shard，宿主 dev server + Playwright）

### 错误

```text
Error: expect(locator).toContainText(expected) failed
Locator: getByRole('dialog')
Expected substring: "管理「E2E548教师1790246061073-fitl-c」的授课课程"
Error: element(s) not found
```

失败时的页面快照同时显示两条客户端 toast：
`加载课程分配失败，请稍后重试` 与 `网络连接失败，请稍后重试`。

### 根因假设

`refreshAssignments()`（`apps/web/src/pages/admin/UsersPage.tsx`）在读取
`GET /api/admin/users/:id/course-assignments?status=all` 失败时按既有契约关闭对话框
（`setAssignmentsUser(null)`）并给出 toast；第二条 toast 来自 `lib/api.ts` 的
`errors.network` 分支——即 `fetch` 本身抛出非 `ApiError`/非 `AbortError` 的
transport 错误（连接被拒/重置），而不是 4xx/5xx 语义失败（语义失败走
`responseToApiError`，不会同时给出 `errors.network`）。用例在失败前刚通过 API 连续
创建 101 门课程，同 shard 还在并行跑数据视图夹具，宿主 API 进程在连接层出现一次
瞬时失败。

### 已知不是的原因

- 不是路由缺失：`/admin/users/:userId/course-assignments` 由
  `apps/api/src/routes/teacherAssignments.admin.ts` 注册。
- 不是服务端 5xx：同轮 API 日志中无 `statusCode:5xx`。
- 不是 #601 Phase F 的因果路径：该 spec 与数据视图几何零交集，Phase F 未触碰用户
  或课程分配的任何数据路径与组件。

### 当前缓解

无单点缓解（登记规则：偶发、与当前改动无因果，不加 timeout/skip/retry，也不弱化
断言）。

### 后续动作

- 同代码复跑聚焦 E2E 全绿（见「复发记录」）。若复发 ≥3 次，按登记规则升级为正式
  跟踪条目，并调查宿主 API 进程在并行 shard 下的连接接受行为（连接池 / backlog），
  而不是在用例侧加等待。

### 复发记录

- 2026-09-24：#601 Phase F 全量 E2E（2 shard）单次出现（1/94）；同代码聚焦复跑
  `run.sh data-view-1 table-contract-2 assignment-affordances` 两个 shard 全绿。

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
## 2026-09-24 — #601 Phase F 全量 E2E run4 shard1 双失败：mobile 卡片文本竞态（已修复）+ ExamEditPage 题目列表分页缺陷（已修复）

### 失败位置

- 文件：`apps/e2e/e2e/admin-flow.spec.ts`（:210）与 `apps/e2e/e2e/data-view-1.spec.ts`（:519，B compressed inline panel）
- 调用：`bash scripts/e2e/run.sh`（全量，2 shard）
- 同一轮 `pnpm verify` 期间还确认了 `src/server.shutdown.test.ts` 的 `EADDRINUSE
  127.0.0.1:3000`：该用例子进程以 `NODE_ENV=development` 启动，而 development 模式
  的端口所有权是 `DEV_API_PORT ?? 3000`（`runtimeConfig.ts`，`APP_PORT` 被有意忽略），
  因此宿主上任何持有 3000 端口的 dev server 都会让它失败。环境敏感为既有设计，
  非本次改动引入；端口空闲时（含 CI）稳定通过。

### admin-flow：`getByText(...).first()` 命中 CSS 隐藏的 mobile 卡片（已修复）

```text
Error: expect(locator).toBeVisible() failed
Locator: getByText('E2E-Enroll-1790249744976').first()
32 × locator resolved to <div data-field-id="name" class="min-w-0 break-words">…</div>
   - unexpected value "hidden"
```

- **根因（非确定性来源）**：`ExamDetailPage` 报考区在 `DataTableShell` 内同时渲染
  desktop 表格与 mobile 卡片列表（`ResponsiveRepresentation` 的 mobile region 在
  DOM 中位于 desktop 之前、由 `lg:hidden` 隐藏）。断言用 `getByText(name).first()`
  依赖"提交后选择对话框关闭动画窗口内 refetch 先落地"的竞态：窗口内 first 命中
  对话框里尚存的可见文本 → 通过；refetch 晚于对话框卸载 → first 永久落在隐藏
  mobile 卡片 → 失败。宿主负载决定窗口开闭，故 4 轮全量 2 过 2 败。
- **修复**：断言改为 `getByRole("row", { name })`（role 引擎默认排除 hidden
  元素，且 mobile 卡片无 row role），并保留移除后的 `toHaveCount(0)` 双表示计数。

### data-view-1 B-inline：ExamEditPage 只读题目列表默认第一页（产品缺陷，已修复）

```text
Error: expect(locator).toBeVisible() failed
Locator: … [data-slot="admin-table-shell"] … [data-slot="table-row"]
heading "已选题目 (1)" 与 heading "尚未选择题目" 同时出现
```

- **根因**：`ExamEditPage` 以裸 `GET /api/questions`（默认 pageSize=20，
  `questionRepo.listFiltered` 按 `createdAt` 升序）填充已选题目面板；seed 的题目
  是库内最新记录，worker 库累计 >20 条题目时它落在第一页之外 →
  `selectedQuestions` 过滤为空 → 面板永久空态。题量 ≤20 时通过，故此前聚焦复跑
  全绿；是真实产品缺陷（任何较新题目在编辑页都不可见），不是测试不稳定。
- **修复**：新增 `apps/web/src/lib/allQuestions.ts`
  `fetchAllPickerQuestions()`（pageSize=100 顶格 + 翻完全部页），`ExamEditPage` 与
  `ExamCreatePage`（wizard 内联的第二份翻页实现）统一收敛到该唯一入口，并附
  transport 边界 mock 的单元测试。

### 后续动作

- 全量 E2E 复跑验证；两者修复均带永久回归（E2E 断言/单元测试），无需额外跟踪。

### 复发记录（同日全量复跑中的独立环境事件）

- 2026-09-24 run5：`recovery-operations-a11y.spec.ts:80` 以
  `page.goto: net::ERR_NETWORK_CHANGED at http://localhost:3101/login` 一次性
  失败（shard 2，2 例未执行为 serial 级联）。ERR_NETWORK_CHANGED 是 Chromium
  网络栈对宿主网络接口变化的报错，非应用代码可达路径（WSL2 网络瞬时抖动）；
  同代码复跑 run6 两 shard 全绿。按登记规则不设 timeout/skip/retry。

## 2026-09-26 — `repository.test.ts` tenant-isolation 3× 5s timeout（并发 docker build 负载下）

### 失败位置

- 文件：`packages/db/src/repository/repository.test.ts:57` / `:86` / `:120`
- 用例：`repository tenant isolation > keeps tenant-scoped course queries isolated`、
  `> updates and deletes tenant records without crossing tenant boundaries`、
  `> Admin repository ops are scoped to organizationId, not targetOrganizationId (Phase 1 single-tenant)`
- 调用：`pnpm test:integration`（`@exam/db#test:integration`），**同时宿主在跑 `docker build`**（镜像构建）

### 错误

```text
FAIL  src/repository/repository.test.ts > repository tenant isolation > keeps tenant-scoped course queries isolated
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/repository/repository.test.ts:57:3
```

同文件三处均为 timeout，无断言失败；日志同窗口可见 `DROP DATABASE` 的
`drop cascades to table …` NOTICE。

### 出现场景

- 分支：`cleanup/634-package-script-surface`（本次仅 `docs/**` 改动，未触碰代码）
- 当时正在做：`pnpm test:integration` 与 docker image build 并行（宿主额外负载由我引入）
- 触发命令：`pnpm test:integration`
- 复跑结果：单跑 `pnpm --filter @exam/db exec vitest run src/repository/repository.test.ts` → **10/10 PASS（2.83s）**；
  宿主安静后整套 `pnpm test:integration` 重跑 → EXIT=0（`@exam/db` 671/671）

### 根因假设

BUG-FLAKE-001 physical-DB-lifecycle / DDL 争用家族：`@exam/db` 文件并行 + 每文件
schema / database 生命周期（CREATE/DROP SCHEMA、DROP DATABASE 级联）在宿主 I/O
争用下击穿 5s 默认 testTimeout。本次额外争用来自并发 `docker build`，不是测试进程之间。

### 已知不是的原因

- 不是 634 文档清理引入：该变更只改 `docs/**`，无 `packages/**` / `apps/**` 代码改动
- 不是 repository 语义回归：同代码隔离复跑与安静重跑均通过
- 不是断言失败：三处均为 timeout

### 当前缓解

无代码改动（不调 timeout、不 skip、不 retry）。重套件（`pnpm test` / `pnpm test:integration`）
不与 docker build 等重负载并行执行。

### 后续动作

若在**无额外宿主负载**下同位置复发 ≥3 次，按登记规则升级为正式条目，届时评估单键
DDL 临界区在该文件的持有/排队时长是否仍与 5s 预算耦合。宿主负载型单次不升级。

### 复发记录

- 2026-09-26：`pnpm test:integration` 与 docker image build 并行时单次出现（3/671），
  隔离复跑与安静重跑均通过。

## 2026-09-26 — `admin-nav-continuity.spec.ts` NAV-6 折叠导航当前项在 4-shard 下未收敛

### 失败位置

- 文件：`apps/e2e/e2e/admin-nav-continuity.spec.ts:542`（断言在 `:550`）
- 用例：`NAV continuity contract (#494) > NAV-6: collapsed rail keeps the current destination discoverable at 1100x800`
- 调用：`E2E_WORKERS=4 bash scripts/e2e/run.sh`（CI `e2e` job 4-shard 的本地等价）

### 错误

```text
    > 550 |     await expect(currents).toHaveCount(1);
          |                            ^
      551 |     // Accessible label stays present in the collapsed state via title.
    at /home/hoo/Source/exam/apps/e2e/e2e/admin-nav-continuity.spec.ts:550:28
```

`getByTestId("app-sidebar").locator('a[aria-current="page"]')` 的自动重试断言
未在 expect 超时内收敛；同 shard 其余 42 例通过。

### 出现场景

- 分支：`cleanup/634-package-script-surface`
- 当时正在做：CI 模拟（4 shard 并行，宿主同时有 4 个 shard API server + 4 个 worker DB）
- 触发命令：`E2E_WORKERS=4 bash scripts/e2e/run.sh`
- 复跑结果：shard 1/4 = 1 failed / 42 passed，其余 3 shard 通过；① 该 spec 文件单独复跑
  （2 shard 模式）通过；② 同参数 4-shard 全量重跑 **166/166 通过**（43/41/41/41），exit 0

### 根因假设

4 shard × 独立 API server × worker DB 的宿主负载下，`/admin/settings` 侧栏的
`aria-current="page"` 标记在 5s expect 预算内未收敛（几何/导航态收敛慢于预算）。
同一 spec 在同一 session 早先的 2-shard 运行与镜像栈运行均通过，属非确定性。

### 已知不是的原因

- 不是 634 文档清理引入（仅 `docs/**`，未触碰 web/api）
- 不是断言逻辑错误或 app-shell 契约回归：`admin-shell-viewport` 同类几何断言在宿主与镜像栈均通过
- 不是产品路径缺失：`/admin/settings` 可达，导航标记在低负载下稳定出现

### 当前缓解

无代码改动（不加 timeout、不加 retry、不 skip、不弱化断言）。重 E2E 运行不与其它重负载并行。

### 后续动作

若 4-shard 下同位置复发 ≥3 次，升级为正式条目，并调查 1100px 断点处
current-destination 标记是否依赖数据加载完成（收敛路径而非等待预算问题）。

### 复发记录

- 2026-09-26：4-shard 首跑单次出现（1/166），隔离复跑与 4-shard 重跑均通过。
