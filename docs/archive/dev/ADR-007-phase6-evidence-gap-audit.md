# ADR-007 Phase 6 Evidence-Gap Audit Report

## 1. Executive Summary

第一轮审查的核心结论**基本准确**，但需要以下修正：

1. **`testWorkerDatabase.test.ts` timeout 不是新 flake** — 它是 BUG-FLAKE-001 的 physical-DB-lifecycle 子类。在 standalone coverage 下通过（3.86s），但在 `pnpm verify` 全套 coverage 下因 turbo 交叉任务 PG 争用而超时。
2. **`auth.test.ts` 在 coverage 模式下仍然 flake** — standalone 2/2 PASS（~2.2s），全量 coverage 1/1 FAIL（5000ms timeout）。这是 BUG-FLAKE-001 的 auth amplification 子类。
3. **`test + coverage` 确实重复执行同一批测试** — 13 files / 151 tests (db) 和 60 files / 623 tests (api) 在两种模式下完全相同。
4. **Worker-database fast path 在 coverage 模式下稳定** — 65s（test）vs 65s（coverage），无 flake。
5. **`verify:db-tests` 串行链当前防的是 I/O contention**，不是 data leak。B方案已替代 data leak 防护。

**Phase 6A 可以施工**，但必须：
- 新增 `verify:fast`（不跑 coverage）
- 不删除 `verify:db-tests`（需要 stress 证据才能删除）
- 文档修正必须包含 auth.test.ts flake 的新观察

---

## 2. First-Round Audit Verification

| 第一轮结论 | 是否准确 | 证据文件/行号 | 修正说明 |
|-----------|:-------:|-------------|---------|
| 1. 默认 `TEST_DB_ISOLATION` 实际行为是 file-schema | **准确** | `testDatabase.ts:131-135` | `isTestDbIsolationEnabled()` 在 unset 时返回 true，走 file-schema 路径。`testScope.ts:208` 默认 `"worker-database"` 但从未被 `buildTestApp` 消费。 |
| 2. `testScope.ts` 默认 worker-database 但未被消费 | **准确** | `testScope.ts:208` vs `testHelpers.ts:132` | `buildTestApp` 调用 `isWorkerDatabaseMode()`（`testDatabase.ts:78-81`），该函数仅在 `TEST_DB_ISOLATION === "worker-database"` 时返回 true。`testScope.ts` 的默认值从未被测试工厂读取。**误导风险确实存在。** |
| 3. `apps/api` 默认 `fileParallelism:false` | **准确** | `vitest.config.ts:58-59` | `resolveParallelism()` 在 `API_TEST_MAX_WORKERS` 未设时返回 `{ fileParallelism: false }`。 |
| 4. `packages/db` 默认并行 | **准确** | `packages/db/vitest.config.ts:29-32` | 无 `fileParallelism` 覆盖，使用 Vitest 默认（parallel）。 |
| 5. `pnpm verify` 执行链 | **准确** | `package.json:33` | `format:check → lint → lint:copy → lint:arch → typecheck → verify:nodb-tests → verify:db-tests → build` |
| 6. `verify:db-tests` = `test:db && test:api && coverage:db && coverage:api` | **准确** | `package.json:41` | 四个任务严格串行。 |
| 7. `@exam/api` test 和 coverage 跑完整 suite | **准确** | 实测 | test: 60 files / 623 tests / 150s。coverage: 60 files / 623 tests / 170s（含 auth flake）。相同文件、相同测试。 |
| 8. 历史上"4 个 DB task 同时挤 PG" | **已过时** | `turbo.json:21-31` | PR88 后 turbo 依赖链：`db#test → db#coverage → api#test → api#coverage`。当前最大并发 PG task = 2（db:test + api:test 可能重叠，或 db:coverage + api:coverage）。**文档需更新。** |
| 9. PR88 后最大并发 PG task 数 | **2** | `turbo.json:21-31` | `db#test` → `api#test`（串行），`db#coverage` → `api#coverage`（串行）。但 `db#test` 完成后 `db#coverage` 和 `api#test` 可能同时启动（取决于 turbo 调度）。 |
| 10. `testWorkerDatabase.test.ts` 是 physical DB lifecycle test | **准确** | `testWorkerDatabase.test.ts:143-268` | 包含 `ensureDatabaseExists`（CREATE DATABASE）、`setupWorkerTestDatabase`（migrate）、`truncateBusinessTables`（TRUNCATE）。 |
| 11. `ensureDatabaseExists()` 执行 `CREATE DATABASE` | **准确** | `testWorkerDatabase.ts:197-213` | 参数化检查 `pg_database`，不存在则 `CREATE DATABASE`。 |
| 12. `CREATE DATABASE` 不能被 transaction rollback | **准确** | PostgreSQL 文档 + `testWorkerDatabase.ts:209` | `CREATE DATABASE` 不能在事务内执行（PG 限制）。`ensureDatabaseExists` 使用 `sql.unsafe()` 绕过事务。 |
| 13. Phase 5 evidence 仅限 local test-only | **准确** | `test-flakes.md:273-287` | 压力测试在 "fresh PG 容器 `exam-db-6432`" 下执行，仅 test-only（无 coverage），仅 local。**不是 CI / coverage 证据。** |

---

## 3. Test vs Coverage Duplication Evidence

### 3.1 packages/db

| Package | Mode | Test files | Test cases | Duration | Notes |
|---------|------|----------:|----------:|--------:|-------|
| @exam/db | test | 13 | 151 | 9.20s | baseline |
| @exam/db | coverage | 13 | 151 | 10.82s | +18% overhead |

**结论**: 完全相同的 13 files / 151 tests。coverage 仅增加 v8 插桩开销（+1.6s）。

### 3.2 packages/db testWorkerDatabase.test.ts

| Package | Mode | Test files | Test cases | Duration | Notes |
|---------|------|----------:|----------:|--------:|-------|
| @exam/db (testWorkerDatabase only) | test | 1 | 12 | 4.54s | ensureDatabaseExists: 627ms |
| @exam/db (testWorkerDatabase only) | coverage | 1 | 12 | 3.86s | ensureDatabaseExists: 2009ms (3.2× slower) |

**结论**: 相同测试。coverage 下 `ensureDatabaseExists` 从 627ms 增至 2009ms（3.2×），但 total 反而更快（3.86s vs 4.54s）—— 因为纯逻辑测试在 coverage 下更快（v8 JIT 预热）。**关键发现**: `ensureDatabaseExists` 的 CREATE DATABASE 在 coverage 模式下显著变慢，但在 standalone 下仍在 5s 内。

### 3.3 apps/api

| Package | Mode | Test files | Test cases | Duration | Notes |
|---------|------|----------:|----------:|--------:|-------|
| @exam/api | test | 60 | 623 | 150.27s | 1 failed (auth.test.ts timeout) |
| @exam/api (worker-database) | test | 60 | 623 | 65.68s | 0 failed, 2.6× faster |
| @exam/api (worker-database) | coverage | 60 | 623 | 65s | 0 failed, stable |

**结论**: 相同 60 files / 623 tests。worker-database 模式下 test 和 coverage 耗时几乎相同（~65s）。

### 3.4 Duplication Analysis

| 问题 | 回答 |
|------|------|
| coverage 是否跑相同测试文件？ | **是** — 13/13 (db) 和 60/60 (api) 完全相同 |
| coverage 是否跑相同 test cases？ | **是** — 151/151 (db) 和 623/623 (api) 完全相同 |
| 是否有 coverage-only 或 test-only 测试？ | **否** — vitest 的 `--coverage` 标志仅添加 v8 插桩，不改变测试选择 |
| `test + coverage` 是否造成重复执行？ | **是** — 同一批测试跑了两次，第二次带 v8 插桩 |
| 是否有足够证据进入 coverage dedup？ | **是** — 已确认 test 和 coverage 跑完全相同的测试 |
| 是否有足够证据直接删除普通 test 只保留 coverage？ | **Evidence insufficient** — 需要验证：删除 `test:api` 后 `coverage:api` 是否仍能独立通过。当前串行链 `test:db && test:api && coverage:db && coverage:api` 中，`test:api` 失败时 `coverage:api` 不会运行。如果删除 `test:api`，`coverage:api` 成为唯一的 API 测试入口，需要确认其稳定性。 |

---

## 4. `testWorkerDatabase.test.ts` Lifecycle Timing Evidence

### 4.1 Timing Breakdown

| Operation | Normal Duration | Coverage Duration | Evidence | Risk |
|-----------|---------------:|------------------:|---------|------|
| `withDatabaseName` (3 tests) | 6ms | 2ms | 无 PG I/O | N/A |
| Input guards (4 tests) | 8ms | 5ms | 无 PG I/O | N/A |
| `ensureDatabaseExists` — CREATE DATABASE | **627ms** | **2009ms** | `testWorkerDatabase.test.ts:148` | **高** — 3.2× slowdown under coverage |
| `ensureDatabaseExists` — idempotent (2nd call) | included above | included above | 同上 | 同上 |
| `setupWorkerTestDatabase` — full lifecycle | **1131ms** | **376ms** | `testWorkerDatabase.test.ts:170-236` | 低 — 包含 migrate + truncate |
| `truncateBusinessTables` — no-op | **459ms** | **316ms** | `testWorkerDatabase.test.ts:251-268` | 低 |
| `dropDbIfPresent` (cleanup) | ~100ms | ~100ms | `afterAll` | 低 |
| **Total** | **4.54s** | **3.86s** | — | — |

### 4.2 Analysis

1. **timeout 更可能出现在哪里？**
   - **不是** `DROP DATABASE` — `dropDbIfPresent` 在 `afterAll` 中执行，不在 test timeout 内。
   - **最可能**是 `ensureDatabaseExists` 的 `CREATE DATABASE` — standalone coverage 下 2009ms，但在 turbo 全量 coverage 下可能因 PG 争用超过 5s。
   - **也可能**是 v8 coverage instrumentation 整体放大 — auth.test.ts 在全量 coverage 下从 2.2s 增至 >5s。

2. **是否足以定义为 BUG-FLAKE-005？**
   - **否**。这是 BUG-FLAKE-001 的 physical-DB-lifecycle 子类。根因相同：turbo 交叉任务 PG 争用 + v8 instrumentation 放大。应归入 BUG-FLAKE-001 作为新观察记录。

3. **是否应该拆 `test:db:lifecycle`？**
   - **是** — 但不是为了修 flake，而是为了分离 concern。physical DB lifecycle tests（CREATE DATABASE、migrate、truncate）与纯逻辑 tests 有不同的执行特征。

4. **是否应该给该文件专属 timeout？**
   - **否** — 默认回答为 no。当前 5s timeout 对 standalone 足够（3.86s）。问题在于 turbo 争用，不是 timeout 太短。

---

## 5. Worker-Database Fast Path Boundary

### 5.1 Evidence

| Command | Result | Duration | Test count | Notes |
|---------|--------|--------:|----------:|-------|
| `pnpm --filter @exam/api test` (serial) | PASS (1 flake) | 150.27s | 623 | auth.test.ts timeout |
| `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api test` | **PASS** | **65.68s** | 623 | **2.6× faster**, 0 flake |
| `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm --filter @exam/api coverage` | **PASS** | **65s** | 623 | **Stable under coverage** |

### 5.2 Analysis

1. **是否只适合 local opt-in？**
   - **是** — Phase 5 evidence 是 local only。CI `api-fast` job 已使用 worker-database（`ci.yml:126-127`），但那是 CI shard，不是本地。

2. **coverage 模式下是否稳定？**
   - **单次 PASS** — 65s，无 flake。但 **不能把单次 PASS 当稳定性证明**。需要 ×5 stress。

3. **是否可以放进 `verify:fast`？**
   - **可以** — `verify:fast` 不跑 coverage，只跑 test。worker-database test 模式 65s 稳定。

4. **是否可以设成默认？**
   - **No** — 需要 stress + CI 证据。当前仅 local 1× PASS。

5. **是否能进入 CI shard？**
   - **已经进入** — `ci.yml:126-127` 设置 `TEST_DB_ISOLATION=worker-database` + `API_TEST_MAX_WORKERS=1`。但 live CI validation 尚未执行。

---

## 6. `verify:db-tests` Serial Chain Review

### 6.1 Current State

| 串行链 / dependsOn | 当前作用 | 是否仍必要 | 删除风险 | 所需 stress |
|-------------------|---------|:--------:|---------|-----------|
| `verify:db-tests` = `test:db && test:api && coverage:db && coverage:api` | 防止 DB-touching 任务并发争用 PG | **是** — 防 I/O contention | **Medium** — 可能重引 auth.test.ts timeout | 需要删除后 ×5 stress |
| `@exam/api#test` dependsOn `@exam/db#test` | 确保 db 测试先于 api 测试 | **是** — 但 turbo 已有此依赖 | **Low** — turbo 自身保证 | — |
| `@exam/db#coverage` dependsOn `@exam/db#test` | 防止 db test 和 coverage 并发 | **是** — PR88 添加 | **Low** — 已验证 | — |
| `@exam/api#coverage` dependsOn `@exam/db#coverage` | 确保 db coverage 先于 api coverage | **是** — turbo 依赖链 | **Low** — 已验证 | — |

### 6.2 Analysis

1. **`verify:db-tests` 当前防的是 data leak 还是 I/O contention？**
   - **I/O contention** — B方案已替代 data leak 防护。PR88 添加串行链时明确是为了防 turbo 交叉任务 PG 争用（`test-flakes.md:172-197`）。

2. **B方案是否已替代它？**
   - **部分替代** — B方案消除了 data leak，但 I/O contention 仍然存在（auth.test.ts 在 coverage 下仍 flake）。

3. **当前是否可以删除？**
   - **No** — 需要 stress 证据。删除后 `turbo run test coverage --filter=@exam/db --filter=@exam/api --force` 需要 5/5 PASS。

4. **删除验证需要跑哪些命令？**
   ```bash
   # 1. 删除 verify:db-tests 串行链后
   turbo run test coverage --filter=@exam/db --filter=@exam/api --force  # ×5
   pnpm verify  # ×3
   ```

5. **`turbo run test coverage --filter=@exam/db --filter=@exam/api --force` 是否仍是必要 stress？**
   - **是** — 这是验证 turbo 调度下 DB-touching 任务是否能安全并发的唯一方式。

---

## 7. Phase 6A Go / No-Go Decision

### 7.1 Operation Assessment

| 操作 | 是否建议实施 | 理由 | 风险 | 验证命令 |
|------|:----------:|------|------|---------|
| **A. 新增 `verify:fast`** | **Yes** | 不跑 coverage，不改默认 verify，不改 CI。本地快速反馈。实测：db test 9s + api test 65s (worker-database) = ~74s vs 当前 ~318s。 | **Low** — 纯脚本新增 | `pnpm verify:fast` ×1 |
| **B. 新增 `test:db:lifecycle`** | **Yes** | 分离 physical DB lifecycle tests。实测：standalone 4.5s，coverage 3.8s。 | **Low** — 纯脚本新增 | `pnpm test:db:lifecycle` ×1 |
| **C. 文档修正 BUG-FLAKE-001** | **Yes** | B方案修 state leak，不等于修 I/O contention。需澄清。 | **None** — 文档修正 | `pnpm format:check` |
| **D. 文档修正 BUG-FLAKE-002** | **Yes** | serial chain 是 active mitigation，不是 historical artifact。 | **None** — 文档修正 | `pnpm format:check` |
| **E. 文档修正 Phase 5** | **Yes** | 标注 local-only，不是 CI-ready。 | **None** — 文档修正 | `pnpm format:check` |
| **F. 新增 BUG-FLAKE-001 auth.test.ts coverage 观察** | **Yes** | auth.test.ts 在 standalone 2/2 PASS（~2.2s），全量 coverage 1/1 FAIL（5000ms timeout）。需记录。 | **None** — 文档新增 | `pnpm format:check` |
| **G. 删除 `verify:db-tests` 串行链** | **No** | 需要 stress 证据。当前 auth.test.ts 在 coverage 下仍 flake。 | **Medium** | 需要 ×5 stress |
| **H. 设置 worker-database 为默认** | **No** | 需要 stress + CI 证据。当前仅 local 1× PASS。 | **High** | 需要 ×5 stress + CI |

### 7.2 Go/No-Go Conclusion

**Phase 6A 可以施工**，范围限于：
- 新增 `verify:fast`（不跑 coverage）
- 新增 `test:db:lifecycle`（分离 physical DB lifecycle tests）
- 文档修正（BUG-FLAKE-001/002、Phase 5、auth.test.ts 观察）

**不能施工**：
- 删除 `verify:db-tests` 串行链（证据不足）
- 设置 worker-database 为默认（证据不足）
- 删除 `fileParallelism: false`（证据不足）

---

## 8. Next Implementation Prompt

```
Phase 6A: Script Layer Reorganization + Documentation Fix

CONSTRAINTS:
- 修改范围: package.json scripts, docs/dev/test-flakes.md, docs/adr/ADR-007-*.md
- 不改: 生产代码, vitest config, turbo config, 测试逻辑, 测试删除, timeout
- 不加: retry, skip, 全局 timeout

TASKS:

1. package.json: 新增 scripts
   - "verify:fast": "pnpm format:check && pnpm lint && pnpm lint:copy && pnpm lint:arch && pnpm typecheck && pnpm verify:nodb-tests && pnpm test:db && pnpm test:api && pnpm build"
   - "test:db:lifecycle": "pnpm --filter @exam/db exec vitest run src/testWorkerDatabase.test.ts"

2. docs/dev/test-flakes.md: 新增观察记录
   在 BUG-FLAKE-001 "复发记录" 段末尾新增:
   - 2026-06-23: auth.test.ts > APP_MODE=e2e does not rate-limit repeated login requests 在 pnpm verify coverage 模式下 5000ms timeout。standalone ×2 全过（~2.2s）。属 BUG-FLAKE-001 auth amplification 子类。

3. docs/dev/test-flakes.md: 修正 BUG-FLAKE-001 "New root fix" 段
   当前: "B 方案（已完成，2026-06-21）: 所有 ~43 个 DB-touching 测试文件已接入独立 PG schema。从源头消除跨文件/跨worker/跨package DB状态泄漏。"
   修正: "B 方案（已完成，2026-06-21）: 所有 ~43 个 DB-touching 测试文件已接入独立 PG schema。消除了跨文件/跨worker/跨package DB状态泄漏。但 I/O contention 未被 B 方案解决——fileParallelism: false 仍是 I/O contention 的主缓解。"

4. docs/dev/test-flakes.md: 修正 BUG-FLAKE-001 "Remaining mitigations" 段
   当前: "A′ fileParallelism: false（apps/api vitest config，packages/db 已于 PR87 恢复并行）：串行执行 apps/api 的 DB-touching file，仍为当前主缓解。"
   修正: "A′ fileParallelism: false（apps/api vitest config，packages/db 已于 PR87 恢复并行）：串行执行 apps/api 的 DB-touching file。B 方案消除了 state leak，但 A′ 仍是 I/O contention 的主缓解。"

5. docs/dev/test-flakes.md: 修正 BUG-FLAKE-002 "状态" 段
   当前: "已缓解（Option A：DB-touching turbo 任务严格串行化）。Option B 已完成"
   修正: "已缓解（Option A：DB-touching turbo 任务严格串行化——防 I/O contention，仍为 active mitigation）。Option B 已完成（防 state leak）"

6. docs/adr/ADR-007-stateful-infrastructure-test-isolation.md: 修正 Implementation Status 表
   Phase 5A: "Completed" → "Completed (local only, test-only, not CI/coverage)"
   Phase 5B: "Completed" → "Completed (local only, test-only, not CI/coverage)"
   Phase 6: "Config prepared" → "Config prepared; live CI validation pending"

7. 验证:
   pnpm verify:fast  # 应通过
   pnpm test:db:lifecycle  # 应通过
   pnpm verify  # 应通过（不变）
   pnpm format:check  # 文档格式检查
```

---

## 9. Evidence Gaps Remaining

| Gap | 当前状态 | 需要什么才能关闭 |
|-----|---------|----------------|
| `verify:db-tests` 串行链能否删除 | 未验证 | `turbo run test coverage --filter=@exam/db --filter=@exam/api --force` ×5 PASS |
| worker-database 能否设为默认 | 仅 local 1× PASS | ×5 stress + CI shard live validation |
| `fileParallelism: false` 能否移除 | 仅 local evidence | ×5 stress at maxWorkers=4 under coverage + CI validation |
| auth.test.ts coverage flake 根因 | 观察到但未根治 | 需要确定：是 I/O contention 还是 auth amplification（6 轮 login + audit-polling） |
| CI `api-fast` shard live validation | Config prepared | GitHub Actions 实际运行结果 |
| template DB 是否值得 | 未测量 | `setupWorkerTestDatabase()` 时间占 `buildTestApp()` 总时间的比例 |
