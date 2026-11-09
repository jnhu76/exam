# Client-Event Retention Verification（TASK-CONTRACT §5.1–§5.4）

- Reviewed SHA: `038bcdbcba93a0419250484f8f4d1186552786ca`（PR #923 分支
  `fix/security-client-event-route-projection`，worktree
  `/home/hoo/Source/exam-gap-worktrees/pr-864`）
- 新增测试文件（本阶段唯一仓库改动，无产品代码改动；已提交并 push 为
  `871d0a4fcaadc4f682673893f40915f3afdd9696`）:
  `apps/api/src/plugins/clientEventRetention.contract.test.ts`
  （§B 的最终全绿门禁运行于该文件的同一工作树内容——commit 仅将其纳入版本控制，
  pre-commit prettier 无实质改动，门禁所验内容与提交内容一致）
- 运行环境: WSL2 linux 6.18.54.1；Node v24.22.1；pnpm 11.1.2；
  PostgreSQL 18.4（容器 `exam-dev-db-1`，`postgres:18.4-bookworm`，本地测试库
  `exam_test` — vitest globalSetup 自供，testing.md §2.8 所有权契约内；
  隔离 schema `test_api_client_event_retention_contract_*` /
  `test_api_client_event_retention_legacy_*` 用后即 drop，已验证无残留）
- 执行命令与结果见 §A；产品代码零改动（`git status --short` 仅新增上述测试文件）

## 七要素（本文自证）

| 要素 | 值 |
| --- | --- |
| 真实代码 SHA | 撰写时 #923 head `038bcdbcba93a0419250484f8f4d1186552786ca`；测试提交 `871d0a4fcaadc4f682673893f40915f3afdd9696`；最终 #923 head `d3580f3e46e2292317dfe831efd982d475d163e8`；最终集成 `a84b416a…`；master `5140c3dd…` |
| 运行环境 | WSL2 Linux 6.18.54.1；Node v24.22.1；pnpm 11.1.2；PostgreSQL 18.4（`exam-dev-db-1`，`postgres:18.4-bookworm`）；隔离 schema 用后即 drop |
| 执行命令 | §A（4 个 vitest 命令 + typecheck + code-quality + prettier）、§B（`pnpm test` 全量）、§C（形状 gate red→green） |
| 关键测试结果 | retention 契约 8/8；4 文件 55 passed；`-t "LEGACY"` 1 passed；repo 15 passed；contracts 60 passed；全量 `pnpm test` 16 tasks 成功、api 2871 passed；§C 2 files/37 passed |
| 原始证据路径 | 测试文件 `apps/api/src/plugins/clientEventRetention.contract.test.ts`；§B 全量日志 `/tmp/gate-rerun-full.log`（一次性见证，**未归档**，见下） |
| 已知边界 | 全量门禁日志只存 `/tmp`；时钟为冻结值；pass 级“启动/完成”无专用日志行（metrics 承担）；生产实际收敛取决于进程在位时间 |
| 结论可信度 | 高（真实 PG 终态 + 结构化日志断言）；证据归档完整性受 `/tmp` 一行约束 |

## §5.1 设计事实核对（file:line @ 038bcdbc）

| 设计事实 | 结论 | 证据 |
| --- | --- | --- |
| `CLIENT_EVENT_RETENTION_DAYS = 30` | 属实 | `apps/api/src/plugins/clientEventRetention.ts:33` |
| `CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS = 24h` | 属实 | `clientEventRetention.ts:36` |
| 启动后执行一次清理 | 属实（注册即 `runPass()`） | `clientEventRetention.ts:203-205` |
| 每日定期清理 | 属实（`setInterval` 24h + `unref()`） | `clientEventRetention.ts:207-211` |
| Organization-scoped DELETE | 属实（枚举 org 逐 org 清理；SQL `eq(organizationId)`；无 tenant-less API） | `clientEventRetention.ts:107-122`；`packages/db/src/repository/clientEventRepo.ts:293-301` |
| 服务端 `receivedAt` 决定 cutoff | 属实（cutoff 源自 `fastify.now()` 服务端时钟；谓词 `lt(receivedAt, cutoff)`；ingest 时 `receivedAt` 由 `fastify.now()` 打戳） | `clientEventRetention.ts:103,106`；`clientEventRepo.ts:298`；`apps/api/src/routes/clientEvents.ts:85,120`；`apps/api/src/plugins/now.ts:25-27` |
| 清理失败有结构化日志和 operability 信号 | 属实（per-org error 日志、tick 级 error 日志、`consecutiveFailedTicks`/`activeSince` 指标由 operabilityMonitor 消费） | `clientEventRetention.ts:139-147,186-189,51-59`；`apps/api/src/plugins/operabilityMonitor.ts:430-432,487-489` |
| 关闭时等待正在执行的清理 | 属实（`onClose`: `closing=true` → `clearInterval` → `await activeRun`） | `clientEventRetention.ts:213-217,163` |

部署初始化：插件注册于 `apps/api/src/server.ts:139`（`nowPlugin` 之后、
`operabilityMonitor` 之前）；表由迁移 `packages/db/migrations/postgres/0008_client_events.sql`
创建；`client_events_org_received_at_idx`（`packages/db/src/schema/pg.ts:1141`）
支撑删除谓词。PR #923 diff 不含 `clientEventRetention.ts`（验证收口，与契约 §5 一致）。

## §5.2 条件矩阵（全部为本次实际执行的测试）

新增 `clientEventRetention.contract.test.ts`（真实隔离 PG + 可控时钟
`NOW=2026-11-08T12:00:00Z` / 显式 `now` 参数 + PG 原生故障注入
BEFORE DELETE trigger）：

| §5.2 条件 | 测试 | 结果 |
| --- | --- | --- |
| 29 天事件保留 | contract T1（29d 行保留） | PASS |
| 超过 30 天事件删除 | contract T1（cutoff−1ms 与 −40d 删除） | PASS |
| 恰好 cutoff 边界 | contract T1（`==cutoff` 保留，严格小于删除）；repo 层 T12 佐证 | PASS |
| 多组织清理 | contract T1（一次 pass 清理 orgA+orgB，`organizationCount=2`） | PASS |
| 某组织清理失败 | contract T3（trigger 注入，`failedOrganizationCount=1`，失败 org 行原样保留） | PASS |
| 其他组织不受失败影响 | contract T3（同一 pass 内 orgOk 过期行照删、fresh 保留） | PASS |
| 失败后下一轮恢复 | contract T4（移除故障后下一 pass 收敛，`failedOrganizationCount=0`） | PASS |
| 进程重启后补偿清理 | contract T5（停机跨窗口期间过期的行由 startup pass 删除，fresh 保留） | PASS |
| 空清理 | contract T2（无过期数据 → clean settle、`consecutiveFailedTicks=0`、`classifyLoopStall=healthy`、按设计零日志） | PASS |
| 启动/完成/失败日志 | contract T3：成功 info 日志（`subsystem/organizationId/cutoff/deletedCount/durationMs`）+ 失败 error 日志（`err` 携带注入的 PG 异常文本）；T2/T5：start/settle 信号经 metrics（`lastStartedAt/lastSettledAt/activeSince`）。**边界**：pass 级「启动/完成」无专用日志行（设计事实，非缺陷——#544 注释 clientEventRetention.ts:17-25 明确无 durable evidence，信号通道为 metrics+operabilityMonitor） | PASS（含上述边界刻画） |
| 并发写入与清理 | contract T6（两条物理连接：4 writer × 10 行 与 3 cleaner × 5 pass 并发；无拒绝；20 条 fresh 全保留；writers 停止后一次 pass 全收敛） | PASS |
| shutdown 正在执行时的行为 | contract T7（advisory-lock 门控 DELETE：pass 在飞时 `close()` 确定性不 resolve；释放后 close 完成、行已删、`activeSince=null`、settle 落戳） | PASS |

首次 TDD 运行 8 测试中 1 失败——根因是**测试自身缺陷**（`Promise.all`
传入了未调用的 map 函数数组，writer/cleaner 从未执行），修复测试后 8/8；
**未暴露产品缺陷，产品代码零改动**。

## §5.3 分项报告（不得把「到达可删除年龄」写成「已从所有介质删除」）

- **Retention eligibility horizon**：30 天，按服务端 `receivedAt` 严格小于
  cutoff 判定（`==cutoff` 保留）。T1 已验证边界。
- **Sweep cadence**：24h interval + 每次进程启动补偿 pass
  （clientEventRetention.ts:205,207-211）。
- **实际清理完成时间**：删除发生在 pass 内同步执行；一次 pass 内即完成
  （T1/T3/T4/T7）。错过窗口期间行保持 at-rest 可删除状态，由下一次 tick 或
  重启 startup pass 收敛（T5）。**到达 30 天 ≠ 已物理删除**：最坏删除延迟
  ≈ 一个 sweep 间隔（停机时为停机时长 + 启动 pass）。
- **Failure recovery**：per-org 失败不阻塞他 org（T3）；故障消失后下一 pass
  即收敛（T4）；连续失败经 `consecutiveFailedTicks` 升级
  （operabilityMonitor，既有 fake 时钟测试覆盖 counter 语义，
  clientEventRetention.test.ts:235-318）。
- **Downtime effects**：停机跨窗口的过期数据在重启后立即被 startup pass
  清理（T5）；停机期间无清理发生（单进程执行器，无外部 worker）。
- **Historical backup retention**：见
  `09-HISTORICAL-DATA-AND-BACKUP-BOUNDARY.md`（备份保留期 UNKNOWN，operator 所有）。

## §5.4 Legacy route 验证（真实旧格式记录）

| 条件 | 结果 | 证据 |
| --- | --- | --- |
| 原始 legacy route 清理前仍可能保存在数据库中 | 属实并已执行验证 | contract legacy T（raw pathname / 带 query 模板路径 / 带 userinfo 绝对 URL / `data:` scheme 逐字节 SELECT 断言 at-rest 原样存在） |
| 经过当前读取端必须投影为安全模板或 null | 已执行验证 | 授权读取端：`proctorMonitoring.test.ts` "#864 LEGACY rows" 测试（真实路由 + 真实 DB，canary/走私字节不出现在响应，已-safe 模板原样保留）——本次 `-t "LEGACY"` 单独运行 1 passed；repo 层 witness：`listTimelinePrefixByAttempt` 返回原始字节（投影位于其上 proctorMonitoringService.ts:68-82） |
| 过期行执行清理后被删除 | 已执行验证 | contract legacy T（5 条过期 legacy 行被 owning org pass 精确删除；仍 fresh 的 raw 行按同一 30 天规则保留） |
| 删除不影响其他组织有效行 | 已执行验证 | contract legacy T（orgOther 的 valid+expired 行不受 orgLeg pass 影响；其自身 pass 只删自己的 expired） |
| 任何读取端不得绕过安全投影 | 已审计并执行验证 | `client_events` 全部 4 个 SELECT（clientEventRepo.ts:150/238/260/320）中唯一带出 `route` 列的是 `listTimelinePrefixByAttempt`（:235），唯一消费者 `toTimelineEventFromClient` 强制投影（proctorMonitoringService.ts:72）；ingest 写入前投影（routes/clientEvents.ts:118）；其余读取端不返回 route 列——无绕过路径 |

## §A 自证命令与输出（全部在本阶段实际执行）

工作目录 `pr-864`：

```
apps/api$ pnpm exec vitest run src/plugins/clientEventRetention.contract.test.ts
  → Test Files 1 passed (1) / Tests 8 passed (8)          [prettier 后复跑]
apps/api$ pnpm exec vitest run src/plugins/clientEventRetention.contract.test.ts \
    src/plugins/clientEventRetention.test.ts src/routes/proctorMonitoring.test.ts \
    src/routes/clientEvents.test.ts
  → Test Files 4 passed (4) / Tests 55 passed (55)
apps/api$ pnpm exec vitest run src/routes/proctorMonitoring.test.ts -t "LEGACY"
  → 1 passed | 15 skipped（授权读取端 legacy 投影单测）
packages/db$ pnpm exec vitest run src/repository/clientEventRepo.retention.test.ts \
    src/repository/clientEventRepo.test.ts
  → Test Files 2 passed (2) / Tests 15 passed (15)
packages/contracts$ pnpm exec vitest run src/__tests__/clientEventRoute.test.ts
  → Test Files 1 passed (1) / Tests 60 passed (60)
$ pnpm --filter @exam/api typecheck        → tsc -p tsconfig.typecheck.json 无错误
$ node scripts/check-code-quality.mjs      → "Code quality checks passed."
$ pnpm exec prettier --check apps/api/src/plugins/clientEventRetention.contract.test.ts
  → "All matched files use Prettier code style!"
$ git status --short                        → 仅 ?? apps/api/src/plugins/clientEventRetention.contract.test.ts
```

未执行（并如实记录）：完整 `pnpm verify` / `pnpm e2e`（本阶段范围内未要求；
新文件只增测试，静态门禁与相关套件已全绿）。

## §B 决定性门禁 `pnpm -C pr-864 test` 收口（2026-11-08 22:11–22:37）

- **第 1 轮失败（@exam/api#test）**：globalSetup 的 `acquireApiRunLease` 被
  `exam_test_worker_database_run` advisory lease fail-fast 拒绝
  （vitest.globalSetup.ts:153 → testInfraLock.ts:497），发生在测试文件收集
  之前，与仓库 diff 无关。根因实证：同宿主机另一 worktree（pr-865）遗留的
  孤儿 vitest worker（PID 1095387，20:25 启动，父进程已死被 /init 收养，
  与门禁 run 共享同一 PostgreSQL 测试服务器的 lease 命名空间）。lease 机制
  为 pg_try_advisory_lock + dedicated session + 进程死自动释放
  （testInfraLock.ts:449-513）——环境干扰，非产品/测试缺陷。处置：终止该
  孤儿进程（非受控文件、非破坏性数据操作），确认 advisory lock 归零后重跑。
- **第 2 轮失败（@exam/web#test，1/2661）**：
  `QuestionPage.queryState.test.tsx` R1「a delete confirmed after the user
  moved on does not strand the …」时序类失败。单文件复跑 34/34 通过
  （`apps/web$ pnpm exec vitest run src/pages/admin/QuestionPage.queryState.test.tsx`）、
  完整重跑未复现；本分支 diff 不含任何 web 文件（git status 仅
  apps/api 新增测试文件，web 侧与 master 逐字节一致），无因果通道。
  flake 台账（docs/standards/test-flakes.md CASE-2026-11-03）有
  QuestionPage 家族资源超订时序史，按其条款未把新 occurrence 自动归入。
  如实记录，未以重跑掩盖判定：该次失败以「diff 无关 + 不可复现 + 全量
  重跑通过」三重证据排除为本轮回归。
- **第 3 轮（最终）全绿**：`pnpm -C /home/hoo/Source/exam-gap-worktrees/pr-864 test`
  → `Tasks: 16 successful, 16 total / Cached: 14 / Time: 13m10s / EXIT=0`；
  `@exam/api#test` cache miss 完整执行：Test Files 221 passed | 7 skipped
  (228)、Tests 2871 passed | 21 skipped (2892)、Duration 788.99s，其中
  `src/plugins/clientEventRetention.contract.test.ts (8 tests) ✓` 与
  `src/plugins/clientEventRetention.test.ts (6 tests) ✓`；
  `@exam/web:test` Test Files 183 passed (183)。完整日志：
  /tmp/gate-rerun-full.log（一次性见证，未归档入 git）。

## 已知边界与结论可信度

- 测试时钟为冻结固定值（`NOW=2026-11-08T12:00:00Z`）与显式 `now` 参数——
  无 wall-clock 依赖；shutdown 测试用 advisory-lock 门控达到确定性在飞状态，
  无 sleep 型负证。
- 「启动/完成」pass 级日志行不存在（metrics 承担）——按 #544 设计刻画为
  边界事实，非缺陷，未改产品代码。
- 30 天清理机制在隔离 PostgreSQL 18.4 上以真实 PG 语义（trigger 故障注入、
  双连接并发、advisory-lock 门控）验证；生产部署的实际收敛仍取决于进程在位
  时间与失败恢复（本验证覆盖该两轴）。
- 结论可信度：高（全部断言基于真实数据库终态与真实结构化日志输出）。

## §C §7.4 Review fix loop — security F2: requestId shape gate（2026-11-09）

- Finding（security F2 / PR #923 / FIX_NOW）：`SAVE_ERROR_METADATA` 允许
  `requestId`，`projectSafeMetadata` 对 string 原样投影——恶意 authenticated
  客户端可在 `answer_autosave_failed.metadata.requestId` 注入任意文本
  （≤32KiB、他人真实 UUID 嵌入文本、非 UUID 散文）到授权调查 timeline 的
  「请求编号」语义位。
- 复现（TDD red）：`apps/api$ pnpm exec vitest run
  src/lib/proctorMonitoringService.test.ts -t "shape-gates"` → 1 failed
  （`requestId: "req-500-abc"` 被现状投影，期望 `{}`）。
- 最小修复：`apps/api/src/lib/proctorMonitoringService.ts` 新增
  `REQUEST_ID_UUID_SHAPE`（服务端 mint 形状 = `genReqId → randomUUID`，
  server.ts:111，且 :112-113 禁止客户端 header 覆盖），`projectSafeMetadata`
  对 `requestId` 键仅投影 well-formed UUID string；散文/超长/文本内嵌他人
  UUID/非 string 一律不投影。字段仍为 client-claimed correlation candidate
  （gate 只限内容注入面，不构成身份核验）。
- 既有测试样例 `"req-500-abc"` 同步为真实 UUID 形状（服务端只会发出该形状）。
- Green：`pnpm exec vitest run src/lib/proctorMonitoringService.test.ts
  src/routes/proctorMonitoring.test.ts` → 2 files / 37 passed；typecheck、
  `node scripts/check-code-quality.mjs`、prettier --check 全过。
- Commit/push：`d3580f3e46e2292317dfe831efd982d475d163e8`
  （871d0a4f..d3580f3e，分支 fix/security-client-event-route-projection）。
