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

**状态**: 已升级（≥3 次复发，2026-06-13）。

**当前缓解**: `apps/api/src/routes/attempts.test.ts:1070` 用例加 positional `15_000` ms 超时（即 `it("...", async () => { ... }, 15_000)`，"已知非确定性 flake 登记册"中的选项 C）。该缓解只是延长单个用例的 timeout 边界，并未消除根因。

**已知根因（待验证）**: vitest 默认按文件并行调度 + 全部测试文件共享同一本地 PG 实例 + c8 instrumentation 在 coverage 模式下放大 I/O 与调度争用。导致 `scanDatabaseForDisruptedAttempts` 的 PG 调用在某些瞬间无法在 5s 默认 testTimeout 内回包。

**建议根因修复（按优先级）**:

1. 选项 A：`apps/api` vitest 切到 `pool: "forks"` + `singleFork: true`，跨文件串行。代价：CI 时间增加。
2. 选项 B：每个测试文件用独立 PG schema（`SET search_path`）从源头消除共享状态争用。代价：基础设施改造。

**禁止做**:
- 永久延长 scanner 自身超时（产品代码不为测试便利让步）
- skip 该用例
- 在 CI 上设置自动重跑后默认通过（会掩盖真实回归）

**触发条件**: 若 BUG-FLAKE-001 在 Phase1.7 后续 Job 中再次出现（即使是 coverage 模式），必须立即开始选项 A 或 B 的根因修复，不再追加 timeout。

**复发记录**:
- 2026-06-13：S06-lite review 修复阶段，单次出现，重跑通过（普通 flake）
- 2026-06-13：S07-lite GREEN 阶段，`pnpm verify` coverage 模式连续 3 次同位置 timeout——触发升级，应用选项 C 缓解

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
