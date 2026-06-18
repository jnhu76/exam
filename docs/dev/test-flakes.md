# 测试 Flake 登记册

本文档登记 `pnpm verify` 期间在主分支或 Phase1.7 工作分支上观察到的、**与当前改动无因果关系**的偶发测试失败（flaky tests）。

每条记录的目的：

- 让接手的人不要把 flake 当成真 bug 去回滚或修
- 让我们能识别出"反复在同一个测试上出现"的趋势——若一条 flake 升级为高频问题，就要从登记册升级为正式 Bug
- 给将来 Phase1.5/1.6/1.7 测试基础设施收紧时（统一隔离、串行化、独立 PG schema）留下证据

## 登记规则

1. **必须有再现一次"同代码再跑就过"的证据**才能记入此处，否则按真实 bug 处理。
2. 每条至少含：日期、Job 上下文、失败测试 file:line、错误片段、根因假设、当前缓解、后续动作。
3. 同一条目复发 ≥3 次 → 升级为正式跟踪条目（本文档"已升级条目"段，或 issue tracker），并在原条目末尾标记"已升级"。

---

## 已升级条目

### BUG-FLAKE-001 — `attempts.test.ts:1070` 后台扫描在 coverage 模式下 5s timeout

**状态**: 已升级（≥3 次复发，2026-06-13）。已从单点 timeout 缓解升级为 **apps/api coverage serial containment**（A′ 方案）。

**当前缓解**:

1. **A′ 方案（主缓解，现行）**: `apps/api/vitest.config.ts` 与 `packages/db/vitest.config.ts` 均设置 `fileParallelism: false`，让两个共享 `exam_test` PostgreSQL 实例的 package 内部测试文件串行执行。从源头消除 vitest 跨文件并行 + 共享 PostgreSQL schema + coverage instrumentation + turbo 跨 package 并发四者叠加导致的 DB 资源争用。
   - 影响范围：仅 `apps/api` 和 `packages/db`（即唯一两个使用 `exam_test` PG 的 package）。`web`、`contracts`、`domain`、`import-export`、`exam-engine`、`auth` 不受影响，仍然并行。
   - turbo 层面：`@exam/api` 和 `@exam/db` 仍然在 turbo 调度下跨 package 并行，但每个 package 内部测试文件串行；这是 vitest config 的官方推荐做法（见 vitest "Parallelism > File Parallelism"：当测试共享外部资源如数据库时，应禁用文件并行）。
   - 代价：受影响 package 测试时间约翻倍（apps/api 70s → ~71s，packages/db 11s → ~16s 量级），但稳定。
   - 兼容：`vitest watch`（`pnpm --filter ... dev`）仍可走默认配置；CLI 行为保持透明。
2. **C 方案（遗留安全网，保留）**: `apps/api/src/routes/attempts.test.ts:1070` 该 it() 仍带 positional `15_000` ms timeout。在 A′ 生效后此 timeout 已变成 redundant safety net；不主动移除，避免再次回退。如果后续做 B 方案恢复并行，此 timeout 应一并 review。

**已知根因（已部分验证）**: vitest 默认按文件并行调度 + 全部测试文件共享同一本地 PG 实例 + c8 instrumentation 在 coverage 模式下放大 I/O 与调度争用。导致 `scanDatabaseForDisruptedAttempts` 的 PG 调用在某些瞬间无法在 5s 默认 testTimeout 内回包。A′ 通过让测试文件串行执行验证了 "并行 + 共享 schema" 是触发条件之一。

**后续根因修复（B 方案，待启动）**:

- 给 `apps/api` 测试加上"每测试文件 / 每 worker 独立 PostgreSQL schema"机制：测试 setup 阶段为每个 worker 创建一个独立 schema 并 `SET search_path`，把"共享 schema 下并行写入"这一类争用从源头消除。
- 完成后可恢复 `fileParallelism` 默认值（删除 A′ 配置中的 `fileParallelism: false`），并 review 是否同步移除 `attempts.test.ts:1070` 的 15_000 ms timeout。
- 推荐基础设施：扩展 `@exam/db` 提供 `withTestSchema(workerId)` helper，或封装在 `apps/api` 的 `tests/setup.ts` 里。

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

---

### BUG-FLAKE-002 — 跨 package / 跨 task 共享 `exam_test` DB 导致 seed/cleanup 互相覆盖

**状态**: 已缓解（Option A：DB-touching turbo 任务严格串行化）。Option B（per-task 独立 DB/schema）为后续根因修复。

**失败链**:

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

- 不是单 package 内并行（`fileParallelism: false` 已分别作用于 `apps/api` 与 `packages/db`，见 BUG-FLAKE-001 A′ 方案）
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

**Option B（后续根因修复，待启动）**:

> 根因修复属于 Phase 1 测试基础设施收紧范畴（`docs/phase-roadmap.md` Phase 1: Minimal Deliverable Exam System），在当前 Phase 1 工作窗口内规划但尚未启动。

- 给每个 DB-touching 测试任务 / worker 分配独立的 PostgreSQL database 或 schema（例如 `exam_test_db_test`、`exam_test_api_coverage`，或 per-worker `SET search_path`），从源头解除"共享 default 组织 + 共享 schema"约束。
- 完成后可恢复 turbo 对 DB 任务的并行调度，并 review 是否回滚 Option A 的串行脚本（`verify` 可改回 `pnpm test && pnpm coverage`）。
- 推荐基础设施：扩展 `@exam/db` 提供 `withIsolatedTestDb(taskName)` / `withTestSchema(workerId)` helper，并在 `apps/api`、`packages/db` 的 vitest setup 里调用。

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

---

### BUG-FLAKE-003 — deadline scanner tests leak expired attempts across repeated runs

**状态**: 已确认复现（2026-06-18，38 次运行 1 次失败，2.6% 触发率）。

**失败位置**:

- 文件：`apps/api/src/routes/attempts.test.ts:1959`
- 用例：`deadline scanner — scanDatabaseForExpiredAttempts > does not touch a voided attempt whose deadline has passed`
- 断言：`expect(result.submittedCount).toBe(0)` — 实际收到 `3`

**错误**:

```
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
