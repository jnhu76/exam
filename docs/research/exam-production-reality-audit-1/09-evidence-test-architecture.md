# 09 — 测试证据架构（按不变量分类）

scope：把测试证据按"它证明了哪个不变量"分类，不只数数量。method：SA3+4 全仓普查 + 主 agent 亲自计数复核。**本报告是 TEST CORPUS（文件存在性）与 EXECUTED EVIDENCE（实际执行）的分离点**：所有数量一律指*测试文件*，不是"已通过的测试数"；执行证据独立列于 §4。

> **REPORT-CORRECTIVE-1**：原报告（及 12 报告引用）把 "454 单测 + 57 E2E" 当作
> executed functional evidence，违反报告自身 "TEST_EXISTS ≠ TEST_EXECUTED" 纪律。
> 本 corrective 建立 corpus / executed 两套口径（§1/§4），并修正树身份表述
> （CI 证据在 cc3f2c 上执行，b9b0e08c 与 cc3f2c 树字节相同）。

## 1. Test corpus（文件存在性，OBSERVED_CODE）

| 层 | 文件数（报告计数） | 备注 |
| --- | --- | --- |
| packages/db | 54 | co-located + __tests__ |
| packages/exam-engine | 40 | |
| packages/domain / contracts / auth / authz / import-export | 35 | |
| apps/api | 181 | routes/plugins/runtime/security 等 |
| apps/web | 144 | |
| apps/e2e（Playwright spec） | 57 | spec 文件 |
| **合计** | **≈454 个 Vitest/unit/integration 测试文件 + 57 个 Playwright spec 文件** | ≈511 |

**不得写作 "454 个测试通过"**。文件数口径说明：以 `*.test.ts(x)` + Playwright spec 白名单统计；同一棵树上用不同包含模式（如含 `*.spec.ts`、含 security 目录变体）的 `find` 结果在 469–472 之间波动（±3%）。本报告保留报告层计数 ≈454 作为 corpus 标签，波动范围如实标注。另有非 vitest 断言脚本测试（node --test）：e2e runner、db journal、generate-env、copy-guard、UI 门禁、formal runner 自测等（根 package.json test:* 系列）；tests/deployment 9 个 bash 套件。

## 2. 按不变量分类

| 不变量类别 | 证据 | 评价 |
| --- | --- | --- |
| owner unit proof | exam-engine 40 文件（状态机/answerProtocol/grading/operatorGrant/admission/timer 纯函数级）+ domain/contracts | 强：领域不变量在 owner 层闭合 |
| integration wiring proof | apps/api routes 同目录 co-located 测试（181 文件主体）；真实 PostgreSQL（TEST_DB_ISOLATION=worker-database 每 worker 独立 schema/库 + testInfraLock） | 强：非 mock-heavy，数据库语义真实 |
| DB concurrency proof | 双连接并发测试断言真实 SQLSTATE（40001/23505）：admin-force-submit.concurrency、admin-time-grants.concurrency（可重复跑 test:operator-grant-race:repeat）、publishResults.concurrency、submitFreezeBarrier、incidents.admin.concurrency、attemptLifecycleRaceTraces（EXAM-341 确定性锁序竞态轨迹 S1A save-wins 等） | 强：竞态是确定性构造而非 sleep 竞猜 |
| process restart proof | `runtime/processRestartDeadline.process.test.ts` + `restartProcessHarness.ts`：真实子进程 SIGKILL 后扫描追赶 ≤30s | 强：非 app.close 等价物 |
| API security proof | permissionBoundary（42 its：跨角色拒绝+零写入+无审计副作用）、m10dPermissionBoundary（17 路由×4 角色=68×403+零写）、proctorAuthorization.e2e（allow/deny 全矩阵+吊销/角色丧失）、routeRegistryConformanceWholeApp（结构锁：全 app 恰一门/受保护路由）、presets-boundaries/maintainerPreset（预设精确钉死） | 强；缺口：examProfile 收窄与 clientEvents 所有权无负测试（与 F1-04/F4-04 对应） |
| browser E2E proof | 57 Playwright spec + patrol 配置 | 存在；覆盖面未逐条审计（UNKNOWN 细目） |
| load/capacity proof | **不存在**（仓库内无负载测试/容量 harness；无 k6/autocannon/artillery 依赖） | 缺失——本审计以 /tmp 一次性探针补做（08 报告），非仓库证据 |
| deployment/recovery proof | tests/deployment 9 套件：compose 契约、fresh-install、launchpad、持久化+冷恢复、冷备、逻辑备恢复、PITR、升级/卸载、清理边界；backup_runs 表 DB 级真实性 CHECK | 强（真实 Docker Compose） |
| formal proof | formal/tla：recovery（safety/liveness/route/submission configs+counterexamples）+ operator-grant（server/client/witnesses），TLC runner + runner 自测 | 存在；模型-代码同构性未验证（UNKNOWN） |

## 3. 结构性测试（authority tests，本仓库特色）

`apps/api/src/runtime/`：lock-order、deadline-authority、time-authority、gradingArchitecture、interruption-recovery、answer-protocol-ownership、test-only-exports——把"只有一个权威/固定锁序"这类跨文件不变量做成可执行断言。加上 scripts/ 的架构/契约门禁（check-architecture、repository-contract/*、config-contract、deployment-topology-contract、ui-gates 系列）。**评价：这是仓库证据体系最强的部分——把审计中最容易漂移的结构约束机械化了。**

## 4. 反面检查（规范要求）+ EXECUTED EVIDENCE（corrective 新增）

### 4.1 反面检查（规范要求）

- 大量测试同一 oracle？未发现（断言分布到状态机/路由/DB/结构各层）。
- fake process restart / fake concurrency？未发现（真实 SIGKILL harness、真实 SQLSTATE 断言）。
- mock-heavy？未发现；fake 仅两处且合理：email sender（部署测试有 witness 文件验证）、时钟（显式注入 now）。
- UI snapshot 冒充 runtime proof？未发现（web 144 文件以行为测试为主，另加 pageGeometryContract 等结构契约）。
- 测试绿但真实 failure mode 未覆盖：**容量/负载**（corpus 中无负载 harness）、clientEvents 污染路径、trailer：examProfile 越权路径一行——**corrective 修正**：原 F1-04（examProfile 越权）已 REJECTED，其"无负测试覆盖"评价相应撤回；examProfile 的 org-scope fail-closed 本身有负测试（examProfile.test.ts RBAC denial + foreign-org matrix，见 P7-M2 §19）。
- 高价值测试清单（评级最高）：processRestartDeadline.process、attemptLifecycleRaceTraces、routeRegistryConformanceWholeApp、admin-time-grants.concurrency（含 repeat 模式）、proctorAuthorization.e2e、deployment/pitr。

### 4.2 EXECUTED EVIDENCE（实际执行过的，与 corpus 分离）

**A. 仓库 CI（exact-tree）**：CI workflow run **34767087301**（事件 pull_request，head = `cc3f2c9660`，2026-09-13 15:56Z，conclusion=success），9 个 job 全部成功：

```text
Static checks      PASS      Build            PASS
API coverage       PASS      Web coverage     PASS
Package coverage   PASS      E2E shard 1/4    PASS
E2E shard 2/4      PASS      E2E shard 3/4    PASS
E2E shard 4/4      PASS
```

树身份说明（不隐瞒 SHA 差异）：BASE_SHA `b9b0e08c` 不是这个 CI 运行的 head SHA；`b9b0e08c` 是 PR #539 的 merge commit，合并结果树与其 PR head `cc3f2c` **字节相同**（`git diff cc3f2c b9b0e08c` 为空，corrective 亲自验证）。因此该 exact-tree CI 证据可作 BASE evidence，依据是树字节同一性而非 SHA 相同。

**B. 本审计实验**（隔离 exam_e2e + /tmp 探针，08 报告）：场景 A–E + 限流实验，全部 MEASURED；主负载场景 RATE_LIMIT_DISABLED=true（限流单独实验）。

**C. 本审计门禁运行**：本地 verify-static 运行记录见审计 notes（verify-static.log）；最终 corrective 门禁运行见 13 报告 §7 与 12 尾部。

**明确不做的主张**：本报告不声称"454 个测试文件全部在 BASE 上逐条执行过"；corpus 与 executed 是两套口径。

## 5. Findings / Unknowns

- F1-09 NOTE：仓库无任何容量/负载证据（本审计补做一次性实验，未入仓——按审计规范不新建 LoadTestFramework）。
- F2-09 NOTE：E2E spec 细目覆盖矩阵未逐条核（57 条），存在重复面或缺口的可能性。
- Unknown：E2E 在 CI 的实际接线与运行时长（.github/workflows 未逐行审计）。
