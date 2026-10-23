# 测试非确定性与 Flake 证据登记册（Test Nondeterminism & Flake Evidence Register）

本登记册记录 `pnpm verify` / CI / E2E 期间观察到的非确定性测试失败，并把三类信息严格分开：

1. **观察到了什么**（occurrence：失败的事实核心，不可改写）；
2. **证明了什么**（非确定性是否成立、根因置信级别、与当时改动的因果关系）；
3. **还不知道什么**（未建立的结论、待证伪的假设、下一步诊断动作）。

核心纠偏：**观察 ≠ 根因**。`同代码重跑通过` 只证明非确定性，不证明无害、不证明与当时改动无因果、不证明根因是宿主负载。本文件 FORMAT_VERSION=2 起禁止把症状直接升级为结论。

---

## Document metadata

```text
DOCUMENT_KIND = TEST_NONDETERMINISM_EVIDENCE_REGISTER
FORMAT_VERSION = 2
LAST_RECONCILED_AT = 2026-10-12T19:55:00+08:00
RECONCILED_FROM_REVISION = da4823db6351e1a2628ad295103181b6fbec67c2
RECONCILED_FROM_BLOB = 1db986885be0759e9e704ef013d0b91e0df3036c
LAST_RECONCILIATION_RESULT = PASS
POST_WRITE_VERIFIED = YES
HISTORICAL_EVIDENCE_LOSS = 0
UNMAPPED_SOURCE_RECORDS = 0
UNSUPPORTED_CAUSAL_PROMOTIONS = 0
SOURCE_REALITY_CHECKED_AGAINST = da4823db6351e1a2628ad295103181b6fbec67c2
  （REC-2026-10-12-002 以该 revision 的仓库源码为准复核：BUG-FLAKE-006 的历史
  测试形态在该 revision 已不存在）
```

> 版本 1 的登记规则、模板与"已修复事故/已升级条目"分段已被本版取代并迁移；原文保留在
> [Historical Evidence](#historical-evidence历史证据) 与各案例记录中。迁移审计见
> [Reconciliation History](#reconciliation-history)。

---

## How to record a nondeterministic / flaky test failure（首屏：如何登记一次 flaky 失败）

本节给第一次遇到失败的人或代理使用。目标：**先保全证据，再做诊断**。

### STEP 1 — 保全失败的那次执行

失败发生时，**不要立即重跑到绿**。先记录：

```text
OBSERVED_AT =
GIT_SHA =
BRANCH =
COMMAND =
LANE =
TEST_TOPOLOGY =
FAILED_FILE =
FAILED_TEST =
FAILURE_PHASE =
ERROR_CLASS =
ERROR_TEXT =
ASSERTION_FAILURE = YES/NO
HOST_OR_RUNNER_CONTEXT =
RELEVANT_CONCURRENCY =
DB_ISOLATION_MODE =
TRACE_OR_LOG_LOCATION =
```

确切值不可得时写 `UNKNOWN`，禁止编造。

### STEP 2 — 先登记 occurrence，再谈 case

单次真实失败可立即登记为 **occurrence**（观测记录），标识符 `OBS-YYYY-MM-DD-NNN`。
occurrence 只记录发生了什么，**不要求**任何根因知识。

### STEP 3 — 重跑是诊断证据，不是结论

原始失败已保全后，同代码重跑才有价值。若 `同代码 FAIL + 同代码 PASS`，只能得出：

```text
NONDETERMINISM_CONFIRMED = YES
```

**禁止**自动得出 `FLAKE_IS_HARMLESS = YES`、`CURRENT_CHANGE_CAUSALITY = EXCLUDED`、
`ROOT_CAUSE = HOST_LOAD`、`ROOT_CAUSE = I/O CONTENTION`、`ROOT_CAUSE = BUG-FLAKE-001`。
隔离单文件重跑本身就是一种不同的执行拓扑；隔离改变了因果 DAG。

### STEP 4 — 不得改写权威 run 的结果

权威 run（门禁、CI、验证 run）失败即保持 FAIL。之后的重跑是**追加的诊断证据**，
不会追溯地把失败 run 变成 PASS。表述用：

```text
AUTHORITATIVE_RUN = FAIL
DIAGNOSTIC_RERUN = PASS
```

而不是 `FINAL RESULT = PASS`——除非一个**新的**权威 gate run 按门禁契约重新执行并通过；
此时两个 run 都要记录，不得抹掉第一个。

### STEP 5 — 聚合成 case 必须写明聚合依据

多个 occurrence 只有在给出显式 `AGGREGATION_BASIS` 时才能合并为一个 case。合格的依据
是**机制级**的：同一资源所有者缺陷、同一缺失 happens-before 边、同一进程/资源身份错误、
同一状态泄漏机制、同一可复现生命周期竞态。

以下**单独不构成**聚合依据：都超时在 5000ms；都在 coverage 下；隔离重跑都过；都用
PostgreSQL；都在同一文件；都在 4 worker 下。机制未建立时保持 occurrence 独立，或以
`AGGREGATION_CONFIDENCE = PROVISIONAL` 临时聚合。

### STEP 6 — 根因必须带置信级别

每条根因陈述必须且只能带一个置信状态（定义见 [Status vocabulary](#status-vocabulary状态词汇表)）：

```text
ROOT_CAUSE_CONFIDENCE = UNKNOWN | HYPOTHESIS | CORRELATED | CAUSALLY_PROVEN | FALSIFIED
```

禁止写不带置信级别的裸 `ROOT_CAUSE = ...`。

### STEP 7 — "与当时改动的关系"是独立轴

使用 `CURRENT_CHANGE_CAUSALITY =
PROVEN_RELATED | PROVEN_UNRELATED | PLAUSIBLY_RELATED | PLAUSIBLY_UNRELATED | UNKNOWN`。

"受害文件没被改"**不足以**支撑 PROVEN_UNRELATED：改动可以通过调度、测试数量、worker
占用、模块初始化、全局 setup、DB 负载、后台异步、资源身份、teardown 时序、进程拓扑
影响执行。证据弱时写 UNKNOWN。

`PROVEN_UNRELATED` 的准入依据只有两类（REC-2026-10-12-002 明确化）：

- `(a) VACUOUS` — 失败 run 中不存在候选改动（未改动的 revision / 干净工作树 / 纯诊断
  run）。这是唯一"无需对照即成立"的排除形式，须写明该 run 的 revision 与工作树状态。
- `(b) CONTROLLED_EXCLUSION` — 同一失败签名在受控条件下被重现或消除，且被操纵的变量
  **与候选改动无关**（命令/进程拓扑、跨 run 残留、注入的 deferred、oracle 可见性窗口、
  纯文档改动不可能触达的通道）；须写明操纵的变量与该签名如何被重现/消除。

以下单项**不构成**准入（STEP 7 已声明，本次复核再次确认）：受害文件未被改动、无 import
边、隔离/单文件复跑通过、缺陷早已存在、产品代码无缺陷、同一 run 中相关模块的测试通过。
这些只支撑 `PLAUSIBLY_UNRELATED`；记录不得用"已排除""无因果"等措辞表述它们。

镜像要求：`CURRENT_CHANGE_CAUSALITY = PROVEN_RELATED` 同样需要逐条证据（例如失败点本身
随该改动进入仓库）。

### STEP 8 — 次数决定优先级，不决定真相

`3+ 次相似 occurrence → 必须做聚合复审（MUST REVIEW AGGREGATION BASIS）`。
但 3 次 ≠ 同一根因；1 次 ≠ 不是真实并发缺陷。

### STEP 9 — 保全自然失败

带日志/trace 的一次自然失败往往比十次绿色重跑更有价值。不得丢弃或覆盖：原始日志、
等待/锁 trace、backend/session 身份、进程号、worker 槽位身份、失败时的执行顺序、
teardown/setup 重叠证据。

### 快速登记模板（复制使用）

```text
OBSERVATION_ID =
OBSERVED_AT =
GIT_SHA =
COMMAND =
EXECUTION_TOPOLOGY =
FAILED_FILE =
FAILED_TEST =
FAILURE_CLASS =
ERROR =
ASSERTION_FAILURE =
AUTHORITATIVE_RUN_RESULT =

RERUN_PERFORMED =
RERUN_TOPOLOGY =
RERUN_RESULT =

NONDETERMINISM_CONFIRMED =
CURRENT_CHANGE_CAUSALITY = UNKNOWN
ROOT_CAUSE_CONFIDENCE = UNKNOWN
ROOT_CAUSE_HYPOTHESIS =

CASE_ID = UNASSIGNED
AGGREGATION_BASIS = NONE

TRACE_AVAILABLE =
NEXT_DIAGNOSTIC_ACTION =
```

---

## Epistemic rules（认识论规则）

1. **观察 ≠ 根因**：`同代码再跑就过` 证明的只有非确定性。重跑通过 ≠ 当前改动被排除
   无关 ≠ 宿主负载被证明 ≠ 可以无视。
2. **AUTHORITATIVE FAILURE REMAINS FAILURE**：权威 run 的失败结果不可被后续重跑改写；
   重跑单独记录为诊断证据。新的完整 gate run 通过时，两个 run 并存。
3. **聚合需要机制依据**（见 STEP 5）；次数（≥3）只触发强制聚合复审，不建立共同根因。
   本登记册 v1 的"同一条目复发 ≥3 次 → 升级为正式 Bug/同一 bug"规则已废止并被本条取代。
4. **因果证明标准**：`CAUSALLY_PROVEN` 只授予满足以下之一的证据——受控调度/barrier 暴露
   出边界；trace 指明 wait-for/所有权依赖；直接观测到进程/资源身份错配；受控变量操纵
   改变失败行为；变异/还原证明被修复机制；失败/成功执行 DAG 暴露首个因果分歧。
   `workers=4 更容易失败` 这类相关性有用，但**不是**因果证明。要归因**历史**失败，
   受控操纵必须改变该次失败的行为（或由失败时间窗内的归属证据链闭合）；仅证明某机制
   **能**制造同类症状（能力演示）不满足本条（REC-2026-10-12-004）。
5. **BUG-FLAKE-001 不是通用桶**：它的两个已修复根因（共享 schema 状态泄漏；槽位身份
   错绑 + DDL 队列放大）是**特定机制**。"coverage + PG + 超时 + 重跑过"的后来 occurrence
   不得仅凭签名相似就归入 BUG-FLAKE-001；必须有机制证据，否则保持独立 occurrence 或
   PROVISIONAL 聚合的新 case。
6. **历史事实不可改写**：occurrence 的事实核心不可变；理解变化时新增
   `CURRENT_INTERPRETATION`，保留 `INTERPRETATION_AT_RECORD_TIME`。
7. **与 `docs/standards/testing.md` 的关系**：环境变量契约、数据库生命周期所有权以
   testing.md §2 为权威；本文件只登记非确定性证据，不定义第二套测试基础设施规则。

---

## Status vocabulary（状态词汇表）

```text
NONDETERMINISTIC:            YES | NO | UNKNOWN
ROOT_CAUSE_CONFIDENCE:       UNKNOWN | HYPOTHESIS | CORRELATED | CAUSALLY_PROVEN | FALSIFIED
CURRENT_CHANGE_CAUSALITY:    PROVEN_RELATED | PROVEN_UNRELATED | PLAUSIBLY_RELATED | PLAUSIBLY_UNRELATED | UNKNOWN
CASE_STATE:                  OPEN | INVESTIGATING | REPAIRED | OPERATIONAL_CONSTRAINT | CLOSED_NOT_REPRODUCED | SUPERSEDED
AGGREGATION_CONFIDENCE:      PROVISIONAL | SUPPORTED | CAUSALLY_PROVEN
CLASSIFICATION (non-flake):  NOT_A_FLAKE | MISCLASSIFIED_AS_FLAKE
```

定义：

- `UNKNOWN`：尚无可辩护的机制。
- `HYPOTHESIS`：有合理机制且有一些支持性观察。
- `CORRELATED`：机制与失败可复现地相关，但与有意义的备择解释的判别未完成。
- `CAUSALLY_PROVEN`：证据把该机制与竞争解释区分开，且操纵/修复该机制会改变失败行为。
- `FALSIFIED`：受控证据反驳了该假设。
- `CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED`：候选改动被排除为失败的原因（准入依据
  见 STEP 7：VACUOUS 或 CONTROLLED_EXCLUSION）。`PROVEN_RELATED` 表示改动确证在失败
  路径上（例如失败点随该改动进入仓库），不表示产品代码有缺陷。
- `AGGREGATION_CONFIDENCE`：PROVISIONAL（签名级临时聚合）/ SUPPORTED（有机制性支持）/
  CAUSALLY_PROVEN（聚合的各 occurrence 与机制的因果均已证明）。

禁止用 `FLAKY = YES` 一类单一布尔替代以上轴。

---

## Current Case Registry（当前案例注册表）

导航索引，不是详细证据的替代。详细记录见对应章节。

| Case | State | Failure signature | Nondeterministic | Root-cause confidence | Current-change causality | Aggregation confidence | Last reviewed | Next action |
|---|---|---|---|---|---|---|---|---|
| BUG-FLAKE-005 | INVESTIGATING | `bootstrap-admin.test.ts` 1–3 用例 5s 超时，仅在 `pnpm verify` 全量 4-worker coverage lane；无断言失败；单文件复跑 20/20（受害用例 ≈13% 预算）；**受害身份 = 该文件在 `it` 体内 provision 隔离 schema 的 4 个用例** | YES | HYPOTHESIS（宿主负载/调度包络；或用例预算与共享 DDL/锁成本的所有权不匹配） | PLAUSIBLY_UNRELATED | PROVISIONAL（签名级） | 2026-10-12 | REC-2026-10-12-006：W1-r1 插桩 witness lane 已执行（预算恰好 1 lane；IF_GREEN 白名单失败，全 lane 0 testTimeout，victim 20/20）；真实负载下自然观测 lifecycle-lock 排队 **5169/4704ms**（慢持有者 = `dropDatabaseIfExists` 体内 `DROP DATABASE` 被 checkpoint 门控 ≈4.4s；backend 身份链与 lock-request 事件顺序均核验，ELD max 741.9ms → H1 本轮无指示）；**NATURAL_BF005_FAILURE = NO、历史归因仍 UNKNOWN**（0 提升 0 降级）；下一步 = 评审独立 schema 测试生命周期所有权的窄范围结构加固设计（以 B3 为受控机制见证；未授权实施） |
| BUG-FLAKE-006 | SUPERSEDED | 历史（2026-07-25 / 09-19 / 10-03）：`ea-lock-order.test.ts:292` 的 `repaired contention schedule is stable across 100 consecutive runs` 用例 5s 超时；**该用例形态在当前源码中已不存在**（2026-10-07 `e60a7edd` / PR #721 以真实双会话重叠 + PG 锁观测的证明替换整个文件） | YES（历史） | HYPOTHESIS（负载下累积延迟）——原失败机制既未证明也未修复 | PLAUSIBLY_UNRELATED（逐次记录；三次均未建立判别证据） | PROVISIONAL（同测试同错误行 3 次） | 2026-10-12（REC-002 对照 current source 后置为 SUPERSEDED） | 无（历史测试身份已消失；若当前 EA 锁序用例出现新签名，另立 occurrence） |
| BUG-FLAKE-001 | REPAIRED | 历史：deadline/heartbeat scanner 等漂移性 5s 超时（共享 schema 泄漏 + 槽位身份错绑两机制） | YES（历史） | CAUSALLY_PROVEN（两机制，变异+自然失败闭环） | 历史条目各自记录 | CAUSALLY_PROVEN（机制级） | 2026-10-12 | 无（禁止把新 occurrence 自动归入） |
| CASE-2026-09-01-CI-BOOTSTRAP | REPAIRED | CI API coverage 4-worker 下 DB 生命周期钩子漂移超时（beforeAll/afterAll 10s） | YES（历史） | CAUSALLY_PROVEN（per-file bootstrap 重复取锁风暴，变异+前后对比） | PLAUSIBLY_UNRELATED（REC-002 降级：原依据为文件级论证；且该 PR 在同一 lane 内改动了 DB-touching 测试文件） | SUPPORTED | 2026-10-12 | 无 |
| BUG-FLAKE-002 | REPAIRED | 跨 package/task 共享 `exam_test` seed/cleanup 互相覆盖（401/FK violation） | YES（历史） | CAUSALLY_PROVEN（复现链 + 隔离修复 stress 5/5） | PROVEN_UNRELATED（CONTROLLED_EXCLUSION：并发拓扑受控复现同一竞争链；隔离域落地后该链消失） | CAUSALLY_PROVEN | 2026-10-12 | 无 |
| BUG-FLAKE-003 | REPAIRED | deadline scanner 跨 run 残留 expired attempts → `submittedCount` 断言漂移 | YES（历史） | CAUSALLY_PROVEN（38-run 复现 + DB 普查 94 行 + fresh-DB 对照） | PROVEN_UNRELATED（CONTROLLED_EXCLUSION：38 连跑在改动无关的变量上重现同签名；fresh-DB 对照归零） | CAUSALLY_PROVEN | 2026-10-12 | 无 |
| BUG-FLAKE-004 | REPAIRED | 同 suite 跨文件状态泄漏（非法 fixture 毒化后续文件 list 查询 → 500） | YES（历史） | CAUSALLY_PROVEN（逐层隔离复现 + schema 隔离后消除） | PROVEN_UNRELATED（CONTROLLED_EXCLUSION：逐层隔离受控复现 + schema 隔离后消除 + 3 连跑 stress 对照） | CAUSALLY_PROVEN | 2026-10-12 | 无 |
| CASE-2026-07-21-AUDIT | REPAIRED | fire-and-forget audit 与破坏性清理生命周期竞态（FK violation / 跨测试晚行污染） | YES（历史） | CAUSALLY_PROVEN（deferred Promise + 真实 PG 确定性复现） | PROVEN_UNRELATED（CONTROLLED_EXCLUSION：操纵的变量是缺 owner 的 Promise，注入 deferred 即在真实 PG 确定性重现 23503 与晚行污染） | CAUSALLY_PROVEN | 2026-10-12 | 无 |
| CASE-2026-08-01-LOCK-SCOPE | REPAIRED | PR #242 多文件偶发失败后重跑过（原失败未复现；修复 4 处源码级非确定性来源） | YES（历史） | 修复机制 CAUSALLY_PROVEN（源码证据+确定性回归）；原 occurrence 归因 UNKNOWN | UNKNOWN（原失败未复现） | PROVISIONAL（修复与原失败的链接未证明） | 2026-10-12 | 无 |
| CASE-2026-07-30-RATELIMIT | REPAIRED | #231 auth route E2E bypass 用例 CI 偶发 5s 超时（12 次完整登录放大） | YES（历史） | CORRELATED（成本/预算算术 + 修复后无复发） | PLAUSIBLY_UNRELATED（REC-002 降级：原依据是"测试所有权问题，非产品回归"，属产品回归论证而非改动排除；当时候选改动未识别，也无受控复现） | SUPPORTED | 2026-10-12 | 无 |
| CASE-2026-09-28-PGSTAT | REPAIRED | `failurePath.test.ts` beforeAll `otherBackendCount` 瞬时读到 1（期望 0） | YES | CAUSALLY_PROVEN（~12% 单文件复现率 + 30 连跑归零 + 阴性对照变异） | PROVEN_RELATED（REC-002 更正：失败点 `expect(await otherBackendCount()).toBe(0)` 随 #648 提交 `2e2bc4e2` 新增该文件进入仓库；触发机制是 PostgreSQL/postgres.js 既有退出可见性语义） | CAUSALLY_PROVEN | 2026-10-12 | 无 |
| CASE-2026-09-24-MOBILE-RACE | REPAIRED | `getByText(...).first()` 命中 CSS 隐藏 mobile 卡片（4 轮全量 2 过 2 败） | YES | CAUSALLY_PROVEN（双峰观察 + role 断言修复） | PROVEN_UNRELATED（CONTROLLED_EXCLUSION：失败表达式为改动前既有代码，改动自身 diff 将其移除；机制在断言策略而非改动主题） | CAUSALLY_PROVEN | 2026-10-12 | 无 |
| #98-examTransitions | CLOSED_NOT_REPRODUCED | `examTransitions.test.ts` file-schema 全套 8/14 失败（`waitForAuditCount` 1s 超时） | UNKNOWN（再未复现） | HYPOTHESIS（worker-database 实验期 `public.audit_logs` 瞬时污染） | UNKNOWN | NONE | 2026-10-12 | 无（复发再开） |
| RUN-LEASE-OP-MODE | OPERATIONAL_CONSTRAINT（NOT_A_FLAKE） | 同 PG 并发两个 worker-database run：后启动方 run-lease 测试立即失败（错误即契约） | NO（给定操作模式必现） | CAUSALLY_PROVEN（契约设计 + 复现实验非对称签名） | 不适用 | 不适用 | 2026-10-12 | 无（串行执行即可） |

未进入任何 case 的独立 occurrence 见 [Unresolved Occurrence Ledger](#unresolved-occurrence-ledger未解决的发生记录账本)。

---

## Active Cases（活跃案例）

### BUG-FLAKE-005 — `src/scripts/bootstrap-admin.test.ts` 单点 5s 超时（`pnpm verify` 4-worker coverage lane）

#### Status

```text
CASE_STATE = INVESTIGATING
CASE_CREATED_AT = 2026-10-08（同签名第 3 次复发时升级）
CASE_LAST_REVIEWED_AT = 2026-10-12T19:55:00+08:00（REC-2026-10-12-006：W1-r1 插桩
  witness lane 执行记录；自然长锁排队观测；依赖链/事件顺序核验与精度修正）
CASE_LAST_MODIFIED_AT = 2026-10-12T19:55:00+08:00

NONDETERMINISTIC = YES
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED
AGGREGATION_CONFIDENCE = PROVISIONAL
NATURAL_FAILURE_CAPTURED = NO（REC-2026-10-12-005 A1 与 REC-2026-10-12-006 W1-r1 两次
  完整 4-worker coverage lane 实跑均 0 testTimeout；W1-r1 victim 文件 PASS 20/20
  （15711ms，victim 用例 1341–1915ms），且该次 PG 采样全程覆盖 lane 窗口）
NATURAL_LONG_LOCK_WAIT = YES（REC-2026-10-12-006 / W1-r1：真实 lane 负载下 lifecycle-lock
  排队 5169ms / 4704ms 两次 >4.3s，发生在 @exam/db schema 清理路径，未落入任何 victim
  窗口。**NATURAL_LONG_LOCK_WAIT = YES 与 NATURAL_BF005_FAILURE = NO 是两条不同层级的
  声明，不得合并**）
COUNTERFACTUAL_EXECUTED = YES（REC-2026-10-12-005 / RUN B3：外部持锁受控反事实，
  选择性复现同形失败 = 能力证明；HISTORICAL_FAILURE_ATTRIBUTION_PROVEN = NO）

AGGREGATION_BASIS = 同文件 + 同 lane（TEST_DB_ISOLATION=worker-database
API_TEST_MAX_WORKERS=4 + v8 coverage）+ 同失败类（5s testTimeout 超时，无断言失败、
无 hook 级联，受害用例在同文件内漂移）跨 3 次 occurrence 复现；因果机制未证明。
```

#### Failure signature

```text
LANE = pnpm verify → @exam/api#coverage（turbo 全量）
EXECUTION_TOPOLOGY = 4 worker × 216–222 文件 × v8 coverage × 真实 PG（worker-database 隔离）
FAILURE_CLASS = testTimeout（vitest 默认 5000ms）；无 assertion 失败；无 hook 级联
TYPICAL_VICTIMS = bootstrap-admin.test.ts 内漂移（:449 audit metadata 用例两次命中；
:375 原子回滚、:493 首装竞态、resolveOrCreateDefaultOrganization 显示名用例各一次）
VICTIM_SET_STRUCTURE = 上述全部 victim 身份恰好是该文件内**在 `it` 体内自行 provision
  隔离 schema 的 4 个用例**（`apps/api/src/scripts/bootstrap-admin.test.ts` :379 / :453 /
  :494 / :615）；同文件另外 18 个用例在 `beforeAll`（30s 预算）provision，从未成为 victim。
  这 4 个用例的 it 体预算为 **vitest 默认 5000ms**（文件内唯一显式超时是 6 处钩子
  `30_000`）。在 `apps/api` 全包内，本文件是**唯一**在 `it` 体内 provision 隔离 schema 的
  测试文件（其余 17 个 provisioning 文件全部在 `beforeAll`/describe 预算内，且多数带
  30s/45s/90s/120s 显式预算）。
```

#### What is established（证据已确立）

- 3 次 occurrence（OBS-2026-10-06-001、OBS-2026-10-07-001、OBS-2026-10-08-001），全部
  `NONDETERMINISM_CONFIRMED = YES`：同 head 同 lane 单文件定向复跑 20/20 PASS。
- 受害用例定向实测 630–700ms（≈5000ms 预算的 13–14%），远低于预算。
  （REC-2026-10-12-005 以 canonical env 重测更新：0.66–0.85s，争用下 1.17–1.43s；
  历史数值按原样保留于本行与相关 hypothesis 记录。）
- 前两次 occurrence 所在 head 有同 hash 或同代码全量重跑 EXIT=0 的对照（10-07 条目①；
  10-06 条目③）。
- 无断言失败；失败点均为 it 体。
- **受害代码的确定性回归未获支持**（不是"被排除"：该论证为文件/复跑级，按 STEP 7 只
  支撑 PLAUSIBLY_UNRELATED）：同 head serial `pnpm test` 与单文件 coverage 均稳定通过。
- 被验证 Phase 的 diff 均未触碰 `bootstrap-admin.test.ts` 及其被测脚本（10-08 R5 时
  workspace 无任何 `.env`，R5 移除的 dotenv side effect 本地为 no-op）。

#### What is NOT established（明确未确立）

以下每一条都只是假设，**均无证据**：

- 宿主 CPU 饥和；
- PostgreSQL I/O 饥和；
- lifecycle-lock 排队放大（注意：BUG-FLAKE-001 的队列放大机制已随 2026-08-26/09-24
  修复大幅削减，lane 获取从 322→107/run，但慢 DDL 持有者仍存在，机制未被排除也未被证明）；
- 后台异步竞态 / 跨测试干扰 / 共享状态竞态；
- 与当时分支的精确因果关系（"受害文件未被改"不足以排除调度级影响：#716 本身是测试
  收敛改动，会改变测试数量与调度）。

#### Hypotheses

```text
HYPOTHESIS_ID = BF005-H1
STATEMENT = 满负载 lane（220 文件 × coverage 插桩 × 4 worker 同机）下瞬时调度无法在
  5s 默认 testTimeout 内收敛（宿主负载/调度包络）
STATUS = HYPOTHESIS（v1 曾表述为"BUG-FLAKE-001 宿主负载/I/O 争用家族"的事实性根因，
  本轮降级）
SUPPORTING_EVIDENCE = 失败仅出现在满负载 lane；隔离重跑远低于预算；无断言失败；
  三个 head 的全量 lane 在其他时点通过
CHALLENGING_EVIDENCE = 无 lane 级 trace / wait 分布 / CPU-IO 采样；无法与其他机制判别
FALSIFICATION_TEST = 复发时连续采集受害用例在定向 lane 与全量 coverage lane 的实测
  耗时分布 + TEST_INFRA_TRACE wait 分布；若全量 lane 下受害用例耗时仍远低于预算而
  仍超时，则需寻找 scheduling-starvation 之外的机制
```

```text
HYPOTHESIS_ID = BF005-H2
STATEMENT = lifecycle-lock 队列 / 慢 DDL 持有者偶发把受害用例的取锁等待放大过 5s
STATUS = HYPOTHESIS
SUPPORTING_EVIDENCE = 该 lane 历史上确证过 DROP DATABASE 23.4s 病态持有
  （2026-08-26 参考案例的自然失败）
CHALLENGING_EVIDENCE = 2026-09-24 bootstrap server-side 预检修复后 lane 获取已降到
  107/run；三 occurrence 均未开启 trace，无等待证据
FALSIFICATION_TEST = 复发 run 开 TEST_INFRA_TRACE=1，检查受害时间窗内 advisory lock
  等待分布与持有者身份
```

```text
HYPOTHESIS_ID = BF005-H3（REC-2026-10-12-003 新增）
STATEMENT = 受害用例的 it 体在 5000ms 默认预算内承担了由**共享测试基础设施**拥有的
  成本：`setupIsolatedTestDb()` → CREATE SCHEMA（需全局 test-infra lifecycle advisory
  lock，阻塞式、无超时）→ `createDatabase` → `migratePostgres`（45 个迁移文件，未持锁）
  → 断言 → `iso.cleanup()` → DROP SCHEMA CASCADE（同一把锁）。该成本与"普通进程内单元
  测试"的成本所有权不匹配：同仓库对同类工作的既有约定是显式放大预算
  （`testIsolation.test.ts` 30s/60s、`0028-rollback.test.ts` describe 90s、
  `0023` / rollback CLI 的 provisioning 钩子 120s、`rollback-*-tables` it 45s），
  并在 CASE-2026-08-01-LOCK-SCOPE 中记为"确定性队列的 hang protection，不作为排序机制"
STATUS = HYPOTHESIS
SUPPORTING_EVIDENCE = ① victim 身份集合恰好等于该文件在 it 体内 provision 的用例集合
  （5/5 victim 实例落在 4 个身份上，`apps/api` 内本文件是唯一这样的文件）；
  ② 该路径上确有**已测量**的多秒级成本项（同一把锁上实测慢持有者 4.3–5.7s、历史
  23.4s DROP DATABASE），且 lane 的 107 次/run 获取中有 96 次属于这条 file-schema
  路径（CASE-2026-09-01 的量化结论）；
  ③ 受害用例单文件实测仅 630–700ms，5s 预算的缺口（≥4.3s）在该路径上只有锁排队这
  一类已测量的来源
CHALLENGING_EVIDENCE = 这 4 个用例同时是该文件**最昂贵**的用例（多一次 45 迁移链），
  所以"最贵者先超时"的统一放大解释同样能预测同一 victim 集合；两者未被判别。
  另外 `packages/db` 的 `0023-incident-fk-and-rollback.test.ts` 也有 it 体内
  provisioning 且未见放大预算，却没有同签名记录（记录缺失 ≠ 未发生）
FALSIFICATION_TEST = 复发 run 开 TEST_INFRA_TRACE=1，比较受害用例两次取锁的
  `acquired wait=` 与文件内非 provisioning 用例的耗时分布：H3 预测受害时间窗内
  出现与预算缺口同量级的 wait 且非 provisioning 用例未见成比例放大；若受害用例
  in-vitro 耗时被等比放大而 wait≈0，则 H3 被削弱、H1 占优
```

> **观测仪器限额（REC-2026-10-12-004）**：H1/H2/H3 当前的 falsification test 都以
> `TEST_INFRA_TRACE=1` 为主要仪器，而该仪器**单独不足以判别**——`acquired wait=` 只在
> 成功获得锁之后才打印（等待期间被 5s 预算中止的取锁不留下可归属的 wait 记录），
> `pid` 是 Node 进程 PID（非 PostgreSQL backend PID），`caller` 为首个外部栈帧文本、
> 不保证区分同文件内的 4 个用例。判别前须按修正后的 Next action 协议，把
> **test ID / 生命周期阶段 / 锁请求起点-获得-释放** 在同一 execution 内关联起来。

#### Causal model

```text
G_REQUIRED = UNKNOWN（并发正确性所需的 happens-before / 所有权 DAG 未重建）。仅确立
  **budget 约束**（BUDGET_CONSTRAINT）：这 4 个用例的完整基础设施生命周期
  （setupIsolatedTestDb → CREATE SCHEMA（全局 lifecycle advisory lock，阻塞式）→
  createDatabase → migratePostgres 45 个迁移 → 断言 → iso.cleanup → DROP SCHEMA
  CASCADE（同一把锁））被要求落在 vitest 默认 5000ms it 预算内——这是当前测试的预算
  约束，不是并发正确性要求
G_CLAIMED = UNKNOWN（仅有的声明侧事实是"未声明 timeout 的 it() 隐式声明 vitest 默认
  5s"；执行侧声明的阶段切片未测量）
G_PASS = PARTIAL（仅 run 结果 + 局部时间观测：同 head 单文件 coverage 20/20、serial
  pnpm test 通过、受害用例定向实测 630–700ms；execution graph 未重建）
G_FAIL = PARTIAL（三次 occurrence 的 run 结果与失败类已知（5s testTimeout，无断言
  失败）；无 lane 内耗时 / 取锁等待 / 阶段切片证据，FAIL 图未重建）
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
  （候选：受害用例在 it 体内的 lifecycle 锁获取上被慢持有者排队，把 630–700ms 的
  未争用成本推过 5000ms；未能与"最贵用例在统一放大下超时"判别）
```

#### Occurrences

- OBS-2026-10-06-001（PR #717 / #716 验证期间，1 用例）
- OBS-2026-10-07-001（PR #735 / #733 R2，3 用例）
- OBS-2026-10-08-001（#733 R5，1 用例）

#### Repair

```text
REPAIR_STATUS = NONE
REPAIR_MECHANISM = 无代码改动（不调 timeout、不 skip、不 retry、不给单用例叠加预算）
REPAIR_EVIDENCE = 不适用
```

#### Exit criterion

- 达到 `CAUSALLY_PROVEN`：需要 lane 级证据判别机制（trace 指明 wait-for/所有权依赖，
  或受控变量操纵改变失败行为，或变异/还原证明）。
- 达到 `REPAIRED`：修复被证明的机制后，同 lane 连续 stress（如 `verify-stress.sh`）
  0 复发且机制回归测试守卫。
- 预算调整的先行条件（沿用作弊线）：仅当实测收敛分布逼近 5s 预算时，才按 testing.md
  的 call-site 显式预算先例评估数值预算（须附依据）；禁止为消灭本签名给单用例叠加
  timeout 或 skip。

#### 本轮再分类记录（CASE MODIFICATION HISTORY）

```text
CASE_LAST_MODIFICATION = ROOT_CAUSE_RECLASSIFIED
CASE_LAST_MODIFICATION_RESULT = PASS
PREVIOUS_CLASSIFICATION = "BUG-FLAKE-001 宿主负载 / I/O 争用家族的漂移性单点超时"
  （v1 以根因/根因假设口吻写在 2026-10-06、2026-10-07、2026-10-08 三条目与
  BUG-FLAKE-005 案例体中，部分条目以"根因："而非"根因假设："表述）
CURRENT_CLASSIFICATION = ROOT_CAUSE_CONFIDENCE = HYPOTHESIS；
  CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED；
  AGGREGATION_CONFIDENCE = PROVISIONAL
CLASSIFICATION_CHANGE_REASON = 现有证据确立了非确定性与签名复发，但未确立宿主负载
  因果；BUG-FLAKE-001 的两个已证明机制（状态泄漏、槽位身份错绑）在本三 occurrence
  之前已被修复，把新 occurrence 自动挂到该家族属于签名级归类而非机制级证明
```

#### REC-2026-10-12-003 — 有界因果调查（B1–B4）与执行阻断记录

```text
INVESTIGATION_AT = 2026-10-12T10:43:23+08:00
BASE_SHA = 008989514a74837a7cde70035cfcba8c25ca89c7（REC-002 提交；调查期间无源码改动）

AUTHORITATIVE_HISTORICAL_FAILURES = 3（OBS-2026-10-06-001 / -10-07-001 / -10-08-001）
NATURAL_FAILURE_CAPTURED = NO
EXECUTION_BLOCKED_BY = 环境无可用 PostgreSQL：本机无 postgres 二进制、5432 未监听、
  Docker Desktop Linux engine 未运行（`docker` 不在该 WSL2 distro 内）；
  `pnpm db:up` 实测 EXIT=1（"The command 'docker' could not be found in this WSL 2
  distro"）。仓库唯一的 DB 生命周期入口不可用，故任何 DB-touching lane 都无法执行。
EXPERIMENT_BUDGET_DECLARED = 1 次 4-worker coverage 基线 + 最多 2 次聚焦诊断 + 1 次
  受控反事实（按任务默认）；BUDGET_CONSUMED = 0（未执行任何 lane 命令）

VICTIM_IDENTITY_RESULT = 全部 5 个 victim 实例（4 个身份：:449 ×2、:375、:493、
  displayName 用例）都是该文件在 it 体内自行 provision 隔离 schema 的用例；
  `apps/api` 全包内本文件是唯一这样的文件。这是源码可核事实，已并入 Failure signature。
STATIC_FINDING = 该 4 个用例的 it 体预算为 vitest 默认 5000ms（文件内无 call-site
  timeout），而同仓库同等工作在别处一律配显式放大预算（30s/45s/90s/120s）；
  该路径包含两个阻塞式全局 advisory-lock 获取（CREATE SCHEMA / DROP SCHEMA CASCADE）
  与一条 45 迁移链。
NOT_DISCRIMINATED = 受害身份集合同时等于"该文件最昂贵的用例集合"（统一放大解释同样
  能预测它），因此本次静态证据**不能**在 BF005-H1 与 BF005-H2/H3 之间判别

NEW_HYPOTHESIS = BF005-H3（it 体预算与共享测试基础设施成本的所有权不匹配）
HYPOTHESES_SUPPORTED = 0（无任何机制达到 CAUSALLY_PROVEN 或 CORRELATED）
HYPOTHESES_FALSIFIED = 0
HYPOTHESES_UNRESOLVED = BF005-H1 / H2 / H3（H3 为新增）
CONTROLLED_COUNTERFACTUAL = NOT_EXECUTED（受阻；设计已记录：用同一 lifecycle key 的
  外部持有者在受控时长内占锁，判别是否只有 provisioning 用例击穿 5s）
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS（不变）
REPAIR_PROPOSAL = 见 Next action；**未授权、未实施**
TEMPORARY_INSTRUMENTATION_ADDED = NONE（本次未添加任何临时插桩，无需回滚）
```

#### REC-2026-10-12-004 — 人类复核裁决、因果模型字段精度更正与下一轮取证协议修正

```text
REVIEWED_AT = 2026-10-12（人类复核 REC-2026-10-12-003 调查报告与 PR #770 讨论）
CORRECTED_AT = 2026-10-12T11:41:15+08:00
SOURCE_REVISION = 7e7027b866a6d780f6d5b41717f3780ebe80937b（复核对象：本 case 详情
  在 REC-003 后的形态）
SOURCE_BLOB_SHA = e83c6c14fd9a9dd97870e3e84e2d0f6c9255f12f
SOURCE_BYTES = 184249
SOURCE_LINES = 3045

OPERATION = REVIEW_RESPONSE_CORRECTION（更正记录形状与下一轮协议；不改变分类轴值）

REVIEW_VERDICT = PHASE_B = PARTIAL（接受）；V2_RECONCILIATION = SELF_VERIFIED；
  BUG-FLAKE-006 = SUPERSEDED；
  BUG-FLAKE-005：STRUCTURAL_EXPOSURE = ESTABLISHED；ROOT_CAUSE = HYPOTHESIS；
  FIRST_CAUSAL_DIVERGENCE = UNKNOWN；REPAIR = NOT AUTHORIZED（人工门禁，另行决定）
NEXT = CAPTURE_BOUND_LIFECYCLE_EVIDENCE →（判别后才考虑）CONTROLLED_COUNTERFACTUAL

CORRECTION_1 = 结构暴露复核成立，保留：4 个 victim 用例各自在 it() 体内创建 / 迁移 /
  销毁独立隔离 schema，完整基础设施生命周期被计入默认 5000ms 预算（已并入
  Failure signature 的 VICTIM_SET_STRUCTURE）。
CORRECTION_2 = `TEST_INFRA_TRACE=1` 单独不足以判别根因（源码证据，
  `packages/db/src/testInfraLock.ts` 本 revision）：
  - :270–274 `acquired wait=` 只在 acquireAdvisoryLock 成功返回后打印——在等待期间
    被 5s 预算中止的取锁不会留下可归属的完整 wait 记录；
  - :272 / :285 `pid=${process.pid}` 是 Node 进程 PID，不是 PostgreSQL backend PID；
  - :263 `caller = firstExternalFrame()` 是首个外部栈帧文本，不保证区分同文件内的
    4 个测试用例。
  CONSEQUENCE = REC-003「Next action」原第①步（仅开 trace 取 wait/hold）不充分；
  下一轮必须在同一 execution 内关联 具体 test ID / 生命周期阶段（create vs drop）/
  锁请求起点 / 获得锁 / 释放锁，必要时才增加临时插桩（记录并回滚，工件不入库）。
CORRECTION_3 = 反事实的证明力上限：受控操纵「人工持有同一 advisory lock 使测试超时」
  至多证明该机制**能**制造同类症状（能力演示），不能把历史 occurrence 归因于该机制；
  升级 `CAUSALLY_PROVEN` 需要失败时间窗内的归属证据（Epistemic rule 4 本轮补句）。

REPAIR_SPACE_CONSTRAINTS（复核裁定，供未来授权后使用）:
- 禁止把 4 个用例合并为共享 `beforeAll` / 统一前置：原子回滚用例要求无残留 org/user，
  organizationDisplayName 用例刻意另建新 schema；合并会改变测试隔离语义，可能让错误
  实现通过。
- 正确候选（仅在取证证明问题确为生命周期成本归属后）：每个用例保留独立 schema，
  把 provisioning 放在该用例专属的 setup/hook 边界。
- 禁止未经证明把 CREATE+migrate+DROP 整体纳入更大的 advisory-lock 临界区：扩大单次
  持锁时间会放大其他 worker 的等待。

FIELD_PRECISION_CORRECTION（记录形状更正，非 reclassification）:
- G_REQUIRED：UNKNOWN（原先把「当前测试的 5000ms 预算约束」写成并发正确性所需的
  happens-before DAG；该预算约束单独记入 G_REQUIRED 的 BUDGET_CONSTRAINT 说明）
- G_CLAIMED：UNKNOWN（原先只有声明侧隐式声明这一事实）
- G_PASS / G_FAIL：PARTIAL（仅有 run 结果与局部时间观测，未重建 execution graph）
- FIRST_CAUSAL_DIVERGENCE：UNKNOWN（不变）
- 分类轴值 ROOT_CAUSE_CONFIDENCE / CURRENT_CHANGE_CAUSALITY / AGGREGATION_CONFIDENCE
  未变更：0 提升、0 降级。

RULE_AMENDED = 1（Epistemic rule 4：能力演示 ≠ 历史归因证明）
BUDGET_CONSUMED = 0（复核同时重验：本机无可用 PostgreSQL——docker 为 Windows shim 且
  未接入该 WSL2 distro、无 psql/postgres 二进制、5432 未监听）

VALIDATION:
- classification values unchanged: PASS（HYPOTHESIS / PLAUSIBLY_UNRELATED / PROVISIONAL）
- history preserved: PASS（REC-003 原文、三 hypothesis 的 FALSIFICATION_TEST 原句逐字保留）
- registry/detail consistency: PASS（注册表 BUG-FLAKE-005 行的 Next action 已同步）
- trace limitation cited to source: PASS（testInfraLock.ts:263 / 270–274 / 283–287）
- no repair claim / no authorization: PASS（REPAIR = NOT AUTHORIZED 未变）
- Markdown/code-fence integrity: PASS（写后回读校验）
- single-file write boundary: PASS（git diff --name-only 仅本文档）

WRITE_APPLIED = YES
POST_WRITE_VERIFIED = YES
MODIFICATION_SUCCESS = YES
```

#### REC-2026-10-12-005 — Phase C 有界取证执行记录（A1/B1/B2/B3）与 B3 受控能力证明及其限制

> 本记录由人类复核授权写入（仅本文档）。它登记 Phase C 的**执行事实**、**字段精度
> 修正**与**受控能力证明**；不改变任何分类轴值（`ROOT_CAUSE_CONFIDENCE = HYPOTHESIS`、
> `CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED`、`AGGREGATION_CONFIDENCE = PROVISIONAL`：
> 0 提升、0 降级），不宣称历史根因已确定。本记录同时修正 Phase C PR 评论
> （[issuecomment-6117841001](https://github.com/jnhu76/exam/pull/770#issuecomment-6117841001)）
> 中 B2 的「上界」措辞与 `G_REQUIRED` / `G_CLAIMED` 的写法；历史评论保留、不追改。

```text
RECORDED_AT = 2026-10-12T13:10:00+08:00
BASE_SHA = be97ba991a6c50c70b756aa913bff2ee4fef2715（执行期间固定；PR #770 OPEN / UNMERGED）
REPOSITORY_FILES_MODIFIED = NONE（Phase C 全程；git status 仅既有未跟踪 .env.deploy）
COMMITS_CREATED = 0（Phase C 未提交；本 REC 单独授权写入）

ENVIRONMENT_UNBLOCK = 此前三轮 BLOCKED 的直接原因 = Docker Desktop 引擎未运行；本 WSL
  distro（Ubuntu-26.04）本已在 Docker Desktop 的 IntegratedWslDistros 中。`docker desktop
  start` 后 `pnpm db:up` EXIT=0，PostgreSQL 18.4（docker-compose.dev.yml，127.0.0.1:5432）
  可用；未改动任何 WSL/Docker 配置，未安装任何组件。

EXECUTION_BUDGET_DECLARED = 1 完整 coverage lane + 2 聚焦诊断 + 1 受控反事实
BUDGET_CONSUMED = 4 次实际启动的 run（A1/B1/B2/B3）＝ 声明上限；0 次中断、0 次 preflight
  失败、无额外运行。环境 preflight 命令与 `turbo --dry=json`（只输出任务图与缓存状态、
  不执行测试）不计入预算。

RUN A1 = 完整 4-worker coverage lane（权威运行）
  EXACT_COMMAND = TEST_INFRA_TRACE=1 TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm coverage
  EXIT_CODE = 1；RUNTIME = turbo 3m20.69s；api lane Start 12:11:19 / Duration 199.46s
  LOG_ID = 1288883 bytes；sha256 27b9fbab7286ecab8a4ac4f851cfef050ad67d22d6842ae45f657b591995aa98
  CACHE_STATUS = 15 cached / 16 total；@exam/api#coverage = cache miss（实跑）；
    @exam/db#coverage = cache hit（未执行）——与三次历史 occurrence 的"仅 api 实跑"形态一致
  TEST_COUNTS = 226 文件（1 failed | 221 passed | 4 skipped）；2791 用例
    （1 failed | 2779 passed | 11 skipped）
  FAILURE = src/config/envSurfaceGuard.test.ts（确定性策略冲突；独立记录见下，不属本 case）
  BF005_SIGNATURE = NOT_OBSERVED（全 lane 0 个 testTimeout、0 个 hook 超时）
  VICTIM_FILE_RESULT = src/scripts/bootstrap-admin.test.ts（20 tests）PASS 7856ms
  INFRA_LOCK_TRACE_LINES = 0（原因见 NEW_FINDING_2，不等于"未发生取锁"）
  PG_SAMPLER_COVERAGE = 仅 lane 末尾 102.2s（171 次采样；12:12:57 → 约 12:14:39）。
    **bootstrap-admin 的执行窗口不在该采样窗口内**（该文件 schema 活动位于日志字节
    约 770K/1289K 处，采样自约 878K 处开始）。因此本采样**不能**用于排除该测试当时发生
    过更长等待；可报告的只是"采样实际覆盖的时间范围内"的观测。
  PG_SAMPLER_OBSERVED（仅覆盖范围内）= advisory-lock 等待最长观测运行 0.6s（采样间隔
    约 0.55s；单点等待 6 次）；holder 观测 ≤1.1s；DDL 语句 age ≤0.14s

RUN B1 = 聚焦诊断（victim 文件单跑；canonical env + trace + 逐用例耗时）
  EXACT_COMMAND = TEST_INFRA_TRACE=1 TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4
    pnpm --filter @exam/api exec vitest run --coverage src/scripts/bootstrap-admin.test.ts --reporter=verbose
  NOTE = 经 pnpm exec 直接调用 vitest（绕过 turbo，否则 TEST_INFRA_TRACE 会被 turbo 严格
    env 过滤丢弃，见 NEW_FINDING_2）；--reporter=verbose 仅改变输出详略，不改变执行拓扑
    （并行度 / 隔离模型 / 预算均未改）。
  EXIT_CODE = 1（仅 coverage threshold；测试 20/20 PASS）；Duration 8.05s（tests 6.14s）
  LOG_ID = 47392 bytes；sha256 77f9d4d09b88c0abfa6fd483d3eb5a05c80112dd8eaad831c77e58f966e8b9fa
  VICTIM_BODIES = atomic 802ms / adapter source 661ms / duplicate first-install 851ms /
    displayName 725ms；其余 16 个 2–175ms（登记册原 630–700ms 实测更新为 661–851ms）
  TRACE = 15 次取锁：wait 11–30ms；hold 18–114ms（create 18–32ms / drop 74–114ms）

RUN B2 = 聚焦诊断（apps/api 内全部 22 个 provisioning 测试文件并发；env 同 B1）
  EXIT_CODE = 1（仅 coverage threshold；22 文件 / 142 用例全 PASS）；Duration 33.93s
  LOG_ID = 212981 bytes；sha256 3fed0dc4e86aeff98ce232a6984434533e92ce4f08cdbfe200662a7ace72f476
  TRACE = 89 次取锁：wait min 13 / p50 24 / p90 327 / max 1050ms；hold max 980ms
  VICTIM_BODIES（争用下）= 1174–1433ms（≈ B1 的 1.6–1.8×）
  PRECISION = 1050ms 是**本次调度顺序下观测到的最大值，不是锁等待的理论上界**；
    22 个文件共同调度**不能证明所有可能的并发顺序已被覆盖**，也不能排除其他顺序下
    出现更大等待。
  PG_SAMPLER = 54 次采样 / 32.5s；覆盖范围内最长等待运行 1.1s；DDL age ≤0.08s

RUN B3 = 受控反事实（CONTROLLED_COUNTERFACTUAL；预测事先登记于私有工件）
  MANIPULATION = 外部 psql 会话在 exam-dev-db-1 / postgres 库持有 test-infra lifecycle
    advisory key 6746943423375374743（= getTestInfraLifecycleLockKey()，已对
    packages/db/dist 核验），按 8s hold / 0.4s gap 循环 8 次；同时按 B1 的 env 运行 victim
    文件。无任何仓库文件改动，无插桩入库。
  EXIT_CODE = 1；RESULT = 4 failed | 16 passed (20)；Duration 49.83s
  LOG_ID = 44638 bytes；sha256 6affcfd0107dcf0bd801c9fb16eb450449504ff3b1006980b8fb6b650ec11c0c
  OUTCOME = 恰好 4 个 in-body provisioning 用例 "Test timed out in 5000ms"
    （atomic 5003ms / adapter source 5001ms / duplicate first-install 5023ms /
    displayName 5018ms）；16 个 beforeAll provisioning 用例全部通过（另有一次
    ensureDatabaseExists wait=6231ms，由非 5s 预算的路径吸收）；0 断言失败
  TRACE = 14 次取锁：wait 1.2–7.9s（max 7884ms，dropTestSchema）；hold 正常（约 80ms）
  PG_SAMPLER = 130 次采样 / 68.0s；等待者运行最长 7.9s（14 个连续采样）；holder 会话
    被观测在 pg_sleep(8) 内 —— 与 trace 独立互证
  PRE_REGISTERED_PREDICTIONS = P1 至少一个 in-body 用例 5000ms 超时；P2 beforeAll
    provisioning 用例仍通过；P3 无断言失败；P4 trace 出现多秒级等待 → 全部命中
  EVIDENCE_IDENTITY = 4 份 run 日志 + 4 份 PG 采样器日志 + 预登记设计文件
    （sha256 0ffbac2a5b87ebdf5ef05ae89c5914d4d28a64553c27333320cf75d4a480ad6a）
    保存于仓库外私有目录（本机 /tmp/exam-bf005.st3gOU/ 与 $HOME 下证据副本）；日志不入库。

G_REQUIRED = UNKNOWN（维持 REC-2026-10-12-004；本轮测量不改写该字段）
G_CLAIMED = UNKNOWN（同上；仅有"未声明 timeout 的 it() 隐式使用 vitest 默认 5s"这一事实）
BUDGET_CONSTRAINT（独立于 G_REQUIRED 记录，不构成并发正确性因果图）= 4 个 in-body 用例把
  完整基础设施生命周期（CREATE SCHEMA（lifecycle 锁）→ createDatabase → migratePostgres
  45 迁移 → 断言 → DROP SCHEMA（同一锁））计入 vitest 默认 5000ms it 预算；实测该生命
  周期为 0.66–0.85s（未争用，B1）/ 1.17–1.43s（争用，B2）。
G_PASS / G_FAIL = PARTIAL（维持 REC-004：无失败 run 的 execution graph）
FIRST_CAUSAL_DIVERGENCE = UNKNOWN（历史 occurrence 仍无失败 run 级归属证据）
CAPABILITY_CHAIN（受控，仅由 B3 建立）= in-body 取锁等待 > (5000ms − 主体成本) → 该用例
  testTimeout；同一 stall 下仅 in-body provisioning 用例被击穿、hook 路径不受影响。
  该链条来自**受控执行**，不是历史 G_fail，也不描述任一历史 occurrence。
MECHANISM_CAN_CAUSE_SIMILAR_FAILURE = YES（受控；选择性 victim 集与历史签名同形）
HISTORICAL_FAILURE_ATTRIBUTION_PROVEN = NO（能力演示不得升级 CAUSALLY_PROVEN；人工 8s
  hold 远大于自然观测最大值（B2 1.05s），且三次历史 occurrence 未在任何本轮执行中复现）
HYPOTHESIS_CHANGES = 0 提升、0 降级（H1 未获支持为唯一解释；H2 机制能力已受控复现、
  历史归因仍 UNKNOWN；H3 的脆弱面已量化；H4 无新证据）
REPAIR_AUTHORIZED = NO；REPAIR_IMPLEMENTED = NO

VALIDATION（REC-005）:
- classification values unchanged: PASS（HYPOTHESIS / PLAUSIBLY_UNRELATED / PROVISIONAL；
  0 提升、0 降级）
- history preserved: PASS（REC-003 / REC-004 原文、三条 occurrence、三 hypothesis 与
  FALSIFICATION_TEST 原句未改；Phase C PR 评论未追改）
- registry/detail consistency: PASS（注册表 BUG-FLAKE-005 行与 Status 块已同步至 REC-005）
- field precision corrections recorded: PASS（G_REQUIRED / G_CLAIMED = UNKNOWN；B2 观测
  最大值 ≠ 理论上界；A1 采样覆盖范围与未覆盖面；B3 = 受控能力链 ≠ 历史 G_fail）
- no repair claim / no authorization: PASS（REPAIR = NOT AUTHORIZED 未变）
- raw logs kept private: PASS（仓库内仅登记 SHA-256 / 字节数；原始日志不入库）
- Markdown/code-fence integrity: PASS（写后回读校验）
- single-file write boundary: PASS（git diff --name-only 仅本文档）

WRITE_APPLIED = YES
POST_WRITE_VERIFIED = YES
MODIFICATION_SUCCESS = YES
```

**字段精度修正（对本轮报告与 Phase C 评论，历史文本不追改）**：

1. `G_REQUIRED` / `G_CLAIMED` 继续保持 `UNKNOWN`。5000ms 是**当前测试的预算约束**
   （`BUDGET_CONSTRAINT`），不是并发正确性所需的 happens-before DAG；本轮测得的
   0.66–0.85s / 1.17–1.43s 只用于描述该预算约束的现状，不进入这两个字段。
2. B2 的 1050ms 是**本次调度顺序下的观测最大值**，不是锁等待的理论上界；22 文件共同
   调度不构成对所有可能并发顺序的覆盖证明。
3. A1 的 PostgreSQL 采样**未覆盖** bootstrap-admin 的执行窗口；该采样不能用于排除该
   测试当时发生过更长等待，只能报告采样实际覆盖的时间范围（lane 末尾 102.2s）。
4. B3 建立的是**受控执行中的能力链**，不是历史 `G_fail`；`FIRST_CAUSAL_DIVERGENCE`
   对历史 occurrence 仍为 `UNKNOWN`。

**NEW_FINDING_2（结构性发现，与修复无关，供下一轮归因使用）** — lane 内经 turbo 执行时
`TEST_INFRA_TRACE` 不会到达 worker：`turbo.json` 的 `coverage` / `@exam/api#coverage`
任务 `env` 列表不含该变量，turbo 2.x 严格 env 模式会把它过滤掉。证据为两相对照：A1
（经 turbo）0 条 trace，B1/B2/B3（`pnpm --filter @exam/api exec vitest …`，绕过 turbo）
trace 正常。后果：任何"lane 级 trace 归因"要么把该变量加入 `turbo.json` 任务 env 列表
（仓库改动，需授权；本次未做），要么绕过 turbo 直接调用 vitest（本次聚焦诊断采用）。
这也意味着：即便当时的 lane 设置了该变量，历史 occurrence 也不会留下 trace。

#### 独立记录：`envSurfaceGuard.test.ts` × 未跟踪 `.env.deploy`（确定性策略冲突，NOT_A_FLAKE，不并入本 case 聚合）

A1 的唯一失败是**确定性**的，不是 flaky：仓库根存在既有未跟踪 `.env.deploy`，`#741`
env 表面守卫判定该名字"无准入所有者、必须不存在"，因此
`src/config/envSurfaceGuard.test.ts`（`passes the live repository tree`）必然断言失败。

```text
CLASSIFICATION = DETERMINISTIC_POLICY_CONFLICT（NOT_A_FLAKE；与 BUG-FLAKE-005 无因果）
NONDETERMINISTIC = NO
EVIDENCE = A1 原始日志（1288883 bytes；sha256 27b9fbab…aa98）FAIL 段逐字输出：
  ".env.deploy: unsupported root env file — supported names are .env, .env.test.local,
  .env.production, .env.example, .env.production.example; this variant has no admission
  owner and must not exist (silent-drift guard, #741)."
RESOLUTION_CONSTRAINT = 禁止通过删除 / 弱化 / 跳过 envSurfaceGuard 换取全绿；也不得把它
  当作 flaky 重跑处理。处置属于 .env.deploy 的所有者（移除或改名），或经由有权路径变更
  #741 表面策略。Phase C 未删除该文件，工作树保持原样。
CONSEQUENCE = 该文件存在于工作树期间，本机 `pnpm verify` 必然 FAIL；该 FAIL 不得用于任何
  与 flake 相关的判定。
```

#### REC-2026-10-12-006 — W1-r1 自然观测 lifecycle-lock 长排队、已核验依赖链与历史归因边界

> 本记录由人类授权写入（docs-only 归档）。它登记 W1-r1 插桩 witness lane 的**执行事实**、
> **自然长锁排队观测**、**依赖链与事件顺序核验**，以及三条对执行期报告草稿的精度修正；
> 分类轴 0 提升、0 降级，历史 occurrence 归因维持 UNKNOWN。证据交付评论见
> [issuecomment-6123709503](https://github.com/jnhu76/exam/issues/771#issuecomment-6123709503)。

```text
RECORDED_AT = 2026-10-12T19:55:00+08:00
BASE_SHA = b408a69522900fbdbe0563c01c86647c6bb80867（执行与归档期间 master HEAD）
REPOSITORY_FILES_MODIFIED = NONE（W1-r1 执行期间；插桩按 06-r1 全部临时并已回滚）

RUN_ID = W1-r1
RUN_KIND = INSTRUMENTED_AUTHENTIC_COVERAGE_LANE
DESIGN_AUTHORITY = Issue #771 评论 06-r1 + 一次性执行 prompt（含 4 条补充约束）
RUN_OUTCOME = IF_GREEN_WITH_WHITELISTED_FAILURE
LANE_EXIT_CODE = 1（完全归属 envSurfaceGuard.test.ts 确定性策略冲突，见上方独立记录，
  不属本 case；全 lane 0 testTimeout）
LANE_RUNS = 1；EXTRA_FULL_LANE_RUNS = 0；AUTOMATIC_RETRY = NONE
BUDGET_CONSUMED = 1 lane + 2 门禁探针（G-PROP db / API 定向）+ 1 次 3s sampler 自测
  ＝ 声明上限

REAL_COVERAGE_PACKAGES = 9（api auth authz contracts db domain exam-engine
  import-export web）——06-r1 的「5 包」为设计文件过期计数，入口命令不受影响
API_TEST_COUNTS = 2791 用例（2779 passed | 1 failed（白名单）| 11 skipped）；
  226 文件（1 failed | 221 passed | 4 skipped）——失败面与 A1 完全一致，不属本 case
VICTIM_FILE_RESULT = bootstrap-admin.test.ts 20/20 PASS（15711ms；4 个 in-body victim
  用例 1341–1915ms ＝ 预算的 27–38%）
BF005_NATURAL_FAILURE_CAPTURED = NO

G_PROP = VERIFIED（db 探针 exit=0、4/4 任务 cache-MISS；API 定向探针内
  `@exam/api:coverage: [w1-eld] … setup loaded trace=1 progress=1` 且 api 任务自身出现
  `[infra-lock] requested … backend=` 行——两个 trace 变量均被证明到达 @exam/api#coverage
  worker；探针 exit=1 仅为单文件 coverage 阈值工件 26.1% < 60%，非测试失败）
G_CACHE = PASS（turbo --dry=json 预测 6 cached；实际 6 cached + 10 executed，
  @exam/api#coverage = MISS → 插桩代码真实执行）

LOCK_ACQUISITIONS = 357（api 任务 135 / db 任务 222）；RELEASES = 357（0 泄漏）
LOCK_WAITS_GT_4300MS = 2（5169ms、4704ms，均在 @exam/db dropTestSchema）
LOCK_WAITS_GT_5000MS = 1（5169ms）
SLOW_HOLDER_HOLD = 4641ms（dropDatabaseIfExists 的锁会话 59228）
API_TASK_MULTI_SECOND_WAITS = 4048ms（dropTestSchema）/ 3025ms（createTestSchema）
  ——同样未落入任何 victim 窗口

W1_LOCK_HOLDER_BACKEND = 59228（持锁会话；持有期间 idle/ClientRead）
W1_DROP_DATABASE_EXECUTOR_BACKEND = 59230（dropDatabaseIfExists 体内 withAdminConnection
  另开的会话；与 59228 不是同一 backend）
DROP_DATABASE_GATE = IPC/CheckpointStart（08:28:07.570–11.573Z，17 拍）→
  IPC/CheckpointDone（11.824Z）；语句实测 age 124→4381ms
LOCK_REQUEST_EVENT_ORDER = VERIFIED（`requested` 使用独立 pre-lock
  `SELECT pg_backend_pid()` 查询，先于阻塞式取锁语句发出；取锁/解锁语句的同语句身份选择
  仅用于授权边界的交叉验证。5169ms 实例全链：L1838 requested(13ms) → L1840–1883 十拍
  still-waiting(501–5007ms) → L1885 acquired(5169ms) → L1941 released(108ms)；与 sampler
  query_start=08:28:06.905Z、连续 20 拍 granted=false、(11.824,12.075] 首拍 granted=true
  三方互锁，论证存证据目录 11-lock-request-order-verification.md）
W1_PG_BACKEND_IDENTITY = VERIFIED（357/357 requested==acquired==released，0 不匹配；
  外部 sampler join 234 个 backend PID）

DEPENDENCY_CHAIN（方向 = 阻塞/队首在前）：
  59229（排队 5169ms）/ 59231（排队 4704ms，dropTestSchema 取锁会话）
    →[PostgreSQL advisory-lock wait；证据 = pg_blocking_pids 采样边 59228→59229 ×20 拍、
      59228→59231 ×18 拍 + granted 翻转拍]
  59228（持锁会话，hold=4641ms）
    →[应用层 Node await——不是 PG 锁边（59230 不出现在任何 blockers 边中）；依据 = 源码
      结构 + 时间对齐：59230 的 DROP DATABASE query_start ≈08:28:07.44Z，紧随 59228 在
      (07.317,07.570] 拍间获锁]
  59230（DROP DATABASE IF EXISTS "exam_test_wphase6d_ensure_151383_uh…"，被 checkpointer
    门控 ≈4.4s）
  FIFO 链 59214→59218→59228→(59229,59231) 逐跳采样边：59214→59218 ×2、59218→59228 ×3、
  59228→59229 ×20、59228→59231 ×18；另有队列序边 59218→59229 ×2、59229→59231 ×19。

PRECISION_CORRECTIONS（对执行期报告草稿；原始工件已核验，历史文本不追改）：
1. 执行 DROP DATABASE 的是 59230，不是持锁的 59228（同一 withTestInfraLifecycleLock
   调用的锁会话与体内连接）。
2. 报告引用的「active age 4851ms」属于另一次更晚的独立 DROP DATABASE（backend 60444，
   08:30:37–42Z，exam_test_wsrmv4zs5peea0fe6）；59230 自身实测 age 区间 124–4381ms。
3. ELD「p99 ≤ 56ms」不精确：89 条 exit 线中 22 条 p99 > 60ms（max 530.1ms，全部来自
   19–57 样本的短命 worker，p99≈runMax 属构造效应）。承重事实不变：全局 runMax =
   741.9ms，无任何样本接近 H1 所需的多秒级停顿——H1 在本 run 无指示。

PHASE_COST_DISTRIBUTIONS_MS（n=357 取锁 / 113 迁移；p50/p90/p99/max）：
  connect（opening→requested）20/42/90/123；总获取（opening→acquired）49/895/3025/5169；
  派生纯排队 7/857/2993/5156；hold CREATE SCHEMA（n=90）36/55/129/129；
  hold DROP SCHEMA（n=137）119/150/173/190；hold 其他（DATABASE 生命周期/迁移/env，
  n=130）814/1199/4641/5136；migratePostgres 825/1108/1335/1500；
  still-waiting 心跳（n=148）502/2501/4506/5007
INSTRUMENTATION_OVERHEAD_CAVEAT = victim 文件 15711ms vs A1 7856ms、victim 用例
  1.34–1.91s vs B2 争用 1.17–1.43s：方向与争用一致，但单次 green run 无法分离插桩自效应
  与负载方差（记录，不作声明）；外部 sampler 1333 拍 0 错误，dur p50=4.4ms max=66.2ms
CLEANUP_STATE = 0 残留 vitest/turbo/sampler 进程；PG 非 self 会话仅 8 个内部后台
  worker；11 个既有 test_* schema 残留（嵌入 pid 在 lane 范围外）按契约未触碰
ROLLBACK_VERIFIED = YES（git status 回到 `?? .env.deploy` only；diff 空；HEAD=b408a695）

NATURAL_LONG_LOCK_WAIT = OBSERVED（两次 >4.3s 自然排队；机制量级已达历史预算缺口
  ≥4.3s，但未落入受害窗口）
MECHANISM_CAPABILITY = PREVIOUSLY_DEMONSTRATED_BY_B3（本 run 未重复、无需重复）
HISTORICAL_FAILURE_ATTRIBUTION_PROVEN = NO（自然长排队 ≠ 自然受害失败 ≠ 历史归因：
  四层声明——自然长排队（YES）/ 受控能力（YES，B3）/ 自然 BF005 失败（NO）/ 历史归因
  （NO）——各自独立，不得合并或换用）
G_REQUIRED = UNKNOWN（维持 REC-2026-10-12-004 / 005）
G_CLAIMED = UNKNOWN（同上）
G_PASS = PARTIAL；G_FAIL = PARTIAL（仍无失败 run 的 execution graph）
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
BUDGET_CONSTRAINT = 5000ms（4 个 in-body 用例的 it 预算，现状不变）
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS（0 提升）；AGGREGATION_CONFIDENCE = PROVISIONAL
HYPOTHESIS_CHANGES = 0 提升、0 降级。H2 机制获自然观测支持（受控能力 + 自然存在，
  仍非历史归因）；H1 本 run 无指示（ELD max 741.9ms）；H3 脆弱面不变；H4 无新证据。
REPAIR_AUTHORIZED = NO；REPAIR_IMPLEMENTED = NO

EVIDENCE_PROVENANCE = 原始工件存研究主机私有目录 ~/.local/share/exam-bf005-w1r1-
  run-20261012/（不入库、非公开可下载工件）；仓库内仅登记哈希（哈希与字节数由执行
  wrapper 在任何分析之前写入 lane-integrity.txt，本 REC 写入前重算复核一致）：
  lane-stdout-stderr.log 1681843B
    sha256=5a29c69f2ea190eabc426ee417ce8a3c84c61f3f04a38f017c84352722beb481
  pg-sampler.log 4717334B
    sha256=d40280a916be58d40dfa07570d7c6f291976ebb830125372c25485bc86d86d65
  api-coverage.json 2842242B
    sha256=b6b2c5f5b0d989bc5a6f3b9f2d374b38c22901cc38f44c4d3a4a8dfd7ee9fe22
  w1r1-instrumentation.patch 10987B
    sha256=95322c028d99c5cc24f423619b79978be839c0f3f8cf5066c49a8edb22e968f2

VALIDATION（REC-006）:
- classification values unchanged: PASS（HYPOTHESIS / PLAUSIBLY_UNRELATED / PROVISIONAL；
  0 提升、0 降级）
- history preserved: PASS（REC-003 / REC-004 / REC-005 原文、三条 occurrence、hypothesis
  与 FALSIFICATION_TEST 原句未改；A1–B3 与 envSurfaceGuard 独立记录未动）
- registry/detail consistency: PASS（注册表 BUG-FLAKE-005 行与 Status 块同步至 REC-006）
- four-claim boundary recorded: PASS（自然长排队 / B3 能力 / 自然 BF005 失败 / 历史归因
  四层声明各自状态明确，无合并）
- no repair claim / no authorization: PASS（REPAIR = NOT AUTHORIZED 未变）
- raw logs kept private: PASS（仓库内仅哈希/字节数）
- Markdown/code-fence integrity: PASS（写后回读校验）
- single-file write boundary: PASS（git diff --name-only 仅本文档）

WRITE_APPLIED = YES
POST_WRITE_VERIFIED = YES
```

#### Next action（REC-2026-10-12-006 后更新）

- **已确立（截至 REC-006）**：B3 受控能力链（REC-005）+ W1-r1 自然观测（真实 lane 负载
  下 lifecycle-lock 排队 5169/4704ms，慢持有者为被 checkpoint 门控 ≈4.4s 的
  `DROP DATABASE`；backend 身份链与 lock-request 事件顺序均核验；ELD max 741.9ms →
  H1 本轮无指示）。**仍未确立**：三次历史 occurrence 实际消耗 ≥4.3s 缺口的机制（无失败
  run 的 execution graph；两次完整 lane 实跑均 0 testTimeout）。
- **下一步工程动作（未授权实施）**：评审一份**窄范围结构加固设计**——目标 = 消除 4 个
  in-body 用例的基础设施生命周期成本与 5000ms it 预算的耦合（independent-schema test
  lifecycle ownership：每用例保留独立 schema，把 provisioning 移到该用例专属 setup/hook
  边界，或按 call-site 显式预算先例附实测依据）；**B3 配方作为受控机制回归见证**。验收
  只能声称"消除了 B3 所见证的受控失败机制与 W1-r1 所观测的自然排队耦合面"，不得声称
  修复三次历史事故。4 个用例必须各自保留独立 schema（禁止合并为共享 `beforeAll`）；
  禁止把 CREATE+migrate+DROP 整体塞进更大的 advisory-lock 临界区；禁止以扩大 timeout、
  skip、retry 消灭签名。
- **NEW_FINDING_2 的 trace 接线已被 W1-r1 临时验证**（`turbo.json` `passThroughEnv` 方案
  有效，G-PROP 双探针证明，含 API worker），但插桩已按协议回滚；**永久接线与插桩保留
  仍需单独授权**。
- **待人工决定（未变）**：是否把 `ENVSURFACE-DEPLOY-CONFLICT` 提升为注册表一级条目（按
  `RUN-LEASE-OP-MODE` 的 NOT_A_FLAKE 行形式）。
- **进一步实验（H1+H2 复合反事实、再次完整 lane、自然失败捕获窗口）**：均需新授权；
  两个声明预算（REC-005 Phase C 与 REC-006 W1-r1）均已用尽。

---

### BUG-FLAKE-006 — `ea-lock-order.test.ts` `...stable across 100 consecutive runs` 用例在满负载 lane 下 5s 超时（历史测试形态已被替换）

> 本 case 由 v1 → v2 调解新建：同测试同错误行 3 次 occurrence 触发"3+ 相似 occurrence →
> 必须聚合复审"。v1 把三次记录在同一条目的复发记录里但从未按其自身规则（≥3 升级）
> 建案，属登记缺口。
>
> **REC-2026-10-12-002 复核 current source 后的更正**：本 case 的受害测试形态
> （`repaired contention schedule is stable across 100 consecutive runs`，
> `apps/api/tests/concurrency/ea-lock-order.test.ts:292`）**在当前源码中已不存在**。
> 该文件于 2026-10-07 由 `e60a7edd`（"test(pg): deterministic EA lock-order owner +
> tx-bound lifecycle proof"，经 PR #721 / `e62d317e` 合入）整体替换为真实双会话重叠、
> 显式同步、`pg_locks` 观测与独立生命周期证明。三次 occurrence 因此**不再可能是当前
> 复现器**（`REPRODUCER = NONE`）；其历史事实、错误文本与解释按原样保全。详情见
> [REC-2026-10-12-002 再分类记录](#rec-2026-10-12-002-再分类记录case-modification-history)。

#### Status

```text
CASE_STATE = SUPERSEDED（历史测试身份被测试契约替换取代；原失败机制未被证明也未被修复）
CASE_CREATED_AT = 2026-10-12（履行强制聚合复审）
CASE_LAST_REVIEWED_AT = 2026-10-12T10:24:59+08:00
CASE_LAST_MODIFIED_AT = 2026-10-12T10:24:59+08:00

NONDETERMINISTIC = YES（历史）
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS（原失败机制）
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED（逐 occurrence 记录；未建立判别证据）
AGGREGATION_CONFIDENCE = PROVISIONAL（签名级；聚合依据的测试身份已消失）

REPRODUCER = NONE（历史测试形态已从源码移除，无法再复现该签名）
HISTORICAL_TEST_IDENTITY = apps/api/tests/concurrency/ea-lock-order.test.ts
  @ blob 3dc187909db736542204b4d97b93b50d8a720d9f
  （含 `it("repaired contention schedule is stable across 100 consecutive runs")`；
  由 c56bae154a4a4310fdd3e1654ac489f3756517e3 于 2026-07-08 新增）
HISTORICAL_TEST_IDENTITY_REPLACED_BY = e60a7eddcefa9d5999f7f5b7ab8e31a361a540b6
  （PR #721；2026-10-07）
REPLACEMENT_REASON = 旧文件的"屏障调度"从未真正运行（T1 在 T2 开始前就已完整提交，
  零重叠；deferred/expectStillPending 是死 helper；100 轮循环以 expect(true).toBe(true)
  结束），故其宣称的死锁环故障模型没有 owner；定向变异（反转 seam 锁序）可存活整个旧
  文件
REPAIR_OF_ORIGINAL_FAILURE_MECHANISM = NOT_ESTABLISHED（这是测试契约替换，不是对原
  超时机制的修复证明）

AGGREGATION_BASIS = 同一测试（repaired contention schedule is stable across 100
consecutive runs）+ 同一错误签名（Test timed out in 5000ms @ ea-lock-order.test.ts:292）
+ 均仅在满负载 lane（插桩或宿主重负载）出现 + standalone 均 3/3 PASS；因果机制未证明。
注意三次 occurrence 的负载形态并不相同（coverage+4worker / 纯 turbo+soak 余波 /
coverage+4worker），这是 PROVISIONAL 而非 SUPPORTED 的原因之一。**该聚合依据为签名级
（同文件 + 同用例名 + 同行号），其载体现已不存在，故本 case 状态置为 SUPERSEDED 而非
REPAIRED——它从未达到机制级聚合。**
```

#### Failure signature

```text
LANE = pnpm verify（coverage + API_TEST_MAX_WORKERS=4）/ pnpm test（turbo 全量，宿主重负载）
EXECUTION_TOPOLOGY = 见各 occurrence
FAILURE_CLASS = testTimeout（5000ms）；无断言失败
TYPICAL_VICTIMS = tests/concurrency/ea-lock-order.test.ts:292（固定，不漂移）
CURRENT_REPRODUCER = NONE（对应源码位置现由不同用例占据，见 REC-002 更正）
```

#### What is established

- 3 次 occurrence（OBS-2026-07-25-001、OBS-2026-09-19-001、OBS-2026-10-03-001），
  `NONDETERMINISM_CONFIRMED = YES`（standalone 复跑 3/3 PASS，100 轮循环实测 1.2–1.8s）。
- 失败点固定在 `:292`，错误逐字一致（10-03 与 07-25 首登完全一致）。
- 三次的宿主背景都有明确额外负载（coverage 插桩 / 95-min soak 后 turbo 15 包并行）。
- **（REC-002 新增的已确立事实）** 受害测试形态的源码生命周期已核实：该用例由
  `c56bae15` 引入，由 `e60a7edd`（PR #721，2026-10-07）随整个文件替换而移除；替换原因
  见 Status 块。历史失败与替换之间没有"该超时机制已被修复"的证据。

#### What is NOT established

- "累积延迟击穿 5s"只是假设：没有 lane 内该用例的耗时采样，无法与其它机制
  （调度饥饿、锁等待、DB 争用）判别。
- 三次是否同一机制未证明。
- **（REC-002 追加）** 旧用例的超时是否与其"零重叠"的假故障模型有关（例如循环本身在
  插桩下的成本）尚未建立；旧文件被替换不是对该问题的回答。替换后的用例是否继承或消除
  了原超时机制**也未证明**——当前用例的签名从未在 lane 中出现过（既有 0 次记录）。

#### Hypotheses

```text
HYPOTHESIS_ID = BF006-H1
STATEMENT = 100 轮真实 PG 事务 + advisory lock 争用循环在插桩/满负载下累积延迟击穿
  5s 默认 testTimeout
STATUS = HYPOTHESIS（载体已移除；该假设在当前源码上不可再检验）
SUPPORTING_EVIDENCE = standalone 无插桩时 100 轮仅 ~1.2s；三次均有明确宿主负载背景
CHALLENGING_EVIDENCE = 无 lane 内耗时分布；无法排除单点调度停顿而非累积；旧文件的
  100 轮循环实际不含跨会话重叠（其"争用"未按宣称发生）
FALSIFICATION_TEST = N/A（历史测试形态已不存在；若要在当前文件上检验负载包络假设，
  必须新建一条针对当前双会话用例的 occurrence 与独立假设，不得沿用本条的历史权重）
```

#### Causal model

```text
G_REQUIRED = UNKNOWN
G_CLAIMED = UNKNOWN
G_PASS = UNKNOWN
G_FAIL = UNKNOWN
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
```

#### Occurrences

- OBS-2026-07-25-001、OBS-2026-09-19-001、OBS-2026-10-03-001（事实全部保全）

#### Repair

```text
REPAIR_STATUS = NONE（针对原失败机制）
REPAIR_MECHANISM = 无（明确不采用单点 positional timeout；见 v1 禁止项，继续有效）
REPAIR_EVIDENCE = 不适用
TEST_CONTRACT_CHANGE = e60a7edd（PR #721）替换了受害测试契约本身——**不得**表述为
  "已修复"
```

#### Exit criterion

- 本 case 不再有"达到 CAUSALLY_PROVEN"的路径：其历史测试身份已消失，无法在 current
  source 上取得 lane 级证据。若当前的 EA 锁序证明用例出现 5s 超时，按 STEP 2/STEP 5
  另立 occurrence 并按机制重新评估聚合，禁止把新签名直接挂回本 case。
- `REPAIRED` 不再适用（原机制既未证明也未被修复）。

#### REC-2026-10-12-002 再分类记录（CASE MODIFICATION HISTORY）

```text
CASE_LAST_MODIFICATION = CASE_STATE_RECLASSIFIED（INVESTIGATING → SUPERSEDED）
CASE_LAST_MODIFICATION_RESULT = PASS
PREVIOUS_CLASSIFICATION = CASE_STATE = INVESTIGATING；failure signature 表述为
  "`ea-lock-order.test.ts:292` 100 轮 contention 循环 5s 超时，仅在满负载/插桩 lane"；
  Next action = "第 4 次复发前先取 lane 级 trace 证据"——即把该用例当作现存的活跃
  复现器
CURRENT_CLASSIFICATION = CASE_STATE = SUPERSEDED；REPRODUCER = NONE；
  HISTORICAL_TEST_IDENTITY_REPLACED_BY = e60a7edd（PR #721）；
  REPAIR_OF_ORIGINAL_FAILURE_MECHANISM = NOT_ESTABLISHED
EVIDENCE = ① `git log --follow apps/api/tests/concurrency/ea-lock-order.test.ts`：
  现场只有 c56bae15（新增，2026-07-08）→ ece042db → f3ee18c2 → e60a7edd（替换）；
  ② `git show e60a7edd^:<file> | grep "100 consecutive"` 命中 :292，而
  `git show da4823db:<file>` 与工作树均无 `100 consecutive` / 该用例名；
  ③ e60a7edd 提交说明给出替换理由（旧文件宣称的屏障调度从未运行、100 轮循环以
  `expect(true).toBe(true)` 结束、定向变异可存活）
CLASSIFICATION_CHANGE_REASON = 登记册 v2 写于 2026-10-12，但把 2026-10-07 已被整体
  替换的测试形态描述为现存活跃复现器；这是"描述与 current source 不一致"的缺陷，按
  第 4 节权威路由以源码为准收敛。替换是**测试契约替换**，不是对原超时机制的修复证明，
  故不得标 REPAIRED，也不得保留 INVESTIGATING 的活跃复现器语义。
PRESERVED = 三次 occurrence 的 OBSERVED_AT / GIT_SHA / COMMAND / EXECUTION_TOPOLOGY /
  FAILED_FILE / FAILED_TEST / FAILURE_PHASE / FAILURE_CLASS / ERROR /
  AUTHORITATIVE_RUN_RESULT / RERUN_EVIDENCE / DIFF_RELATION / INTERPRETATION_AT_RECORD_TIME
  全部逐字保留；本记录只追加 `HISTORICAL_TEST_IDENTITY_STATUS` 字段
```

---

## Resolved Causal Cases（已解决的因果案例）

> 本段案例的机制均达到 CAUSALLY_PROVEN（个别标注为 CORRELATED 的除外），修复均附
> 证据。它们是本登记册的证据质量基准；**其机制不得自动外推到后来的 occurrence**。

### BUG-FLAKE-001 — `routes/attempts/deadline-scanner.test.ts` 后台扫描在 coverage 模式下 5s timeout（含 2026-08-26 槽位身份根因调查——参考因果案例）

#### Status

```text
CASE_STATE = REPAIRED
CASE_CREATED_AT = 2026-06-13（≥3 次复发升级）
CASE_LAST_REVIEWED_AT = 2026-10-12T09:48:53+08:00
CASE_LAST_MODIFIED_AT = 2026-10-12T09:48:53+08:00

NONDETERMINISTIC = YES（历史）
ROOT_CAUSE_CONFIDENCE = CAUSALLY_PROVEN（两个机制，见下）
CURRENT_CHANGE_CAUSALITY = 历史条目各自记录（多数 PROVEN_UNRELATED / PLAUSIBLY_UNRELATED）
AGGREGATION_CONFIDENCE = CAUSALLY_PROVEN（机制级）

AGGREGATION_BASIS = 两个被因果证明的机制各自解释其受害面：
  (a) 共享 exam_test.public schema 的跨文件/跨 run 状态泄漏；
  (b) 槽位身份错绑（VITEST_WORKER_ID）→ 物理库基数失控 + advisory-lock 队列放大。
```

> **NOT A GENERIC CATCHALL**：本 case 的有效性口径仅限上述两个已修复机制。它**不是**
> "coverage + PG + timeout + rerun pass"的通用标签。2026-08-26 修复之后出现的任何超时
> occurrence（如 BUG-FLAKE-005、BUG-FLAKE-006 或账本中的独立 occurrence）**不得**仅凭
> 签名相似归入本 case；必须有机制证据。

#### 两类根因（均已修复，这是本条目唯一仍有效的口径）

1. **state leak** — 全部测试文件共享 `exam_test.public` schema：跨文件 / 跨 worker /
   跨 package 的状态残留。由每文件独立 schema（`packages/db/src/testIsolation.ts`）与
   每执行槽位物理库（`packages/db/src/testWorkerDatabase.ts`）隔离消除。
2. **slot 身份错绑导致的 DDL 队列负载** — `testScope.resolveWorkerId` 曾把槽位域资源
   绑到 `VITEST_WORKER_ID`（每文件一个新实例 id），使 `maxWorkers` 形同虚设，并把
   advisory-lock 队列深度放大成无关文件的 hook 超时。2026-08-26 审计改为
   `VITEST_POOL_ID`（见下方参考因果调查）。

> **本条目早期的权宜缓解（串行脚本链、scanner legacy timeout、lifecycle command
> split）已随根因修复从 `package.json` 与 CI 接线中删除；不要按历史版本重新引入。**

#### 当前缓解（现行配置；2026-10-12 对照 current master 复核仍成立）

1. **隔离边界**：每文件独立 schema + 每执行槽位物理库（`exam_test_w<VITEST_POOL_ID>`，
   基数受 `maxWorkers` 约束、跨 run 复用）+ `withTestInfraLifecycleLock` 单键临界区。
   细节与生命周期所有者见 [`docs/standards/testing.md` §2.8](./testing.md#28-test-database-lifecycle-ownership)。
2. **串行仍是 `apps/api` 默认**：`fileParallelism: false`。并行是 env-gated opt-in：
   `TEST_DB_ISOLATION=worker-database` 且 `API_TEST_MAX_WORKERS` 为正整数；CI 与
   `pnpm verify` 走该路径（4 worker）。配置权威见 `apps/api/vitest.config.ts` /
   `apps/api/vitest.parallelism.ts`。
3. **长循环用例显式传预算**：scanner / contention 类用例在调用点显式传 timeout
   （如 `heartbeat.test.ts` 的 15_000 ms），而不是放宽包级 `hookTimeout`。

#### 禁止做（仍然有效）

- 永久延长 scanner 自身超时（产品代码不为测试便利让步）
- skip 该用例
- 在 CI 上设置自动重跑后默认通过（会掩盖真实回归）
- 为消灭本家族继续给单个用例叠加 timeout，而不是修隔离 / 调度根因

**Stress 验证脚本**: 项目根的 `scripts/test/verify-stress.sh` 提供手动连续运行 `pnpm verify`
的脚手架（默认 3 次，可传参，例 `bash scripts/test/verify-stress.sh 5`）。该脚本不进入
CI，仅供开发者在改 vitest 调度或 PG 隔离机制时手动验证稳定性。

#### 历史 occurrence 列表（事实保全；逐条归因置信见各条附注）

以下复发记录是历史证据。修复（2026-06-21 schema 隔离；2026-08-26 身份重绑）**之前**
的 occurrence 处于机制活跃期，逐条归因为"时代一致"（era-plausible）：机制被证明存在于
该时期且产生过同签名失败（2026-08-26 修复中捕获的自然失败），但多数单条 occurrence
未做逐条因果证明。修复之后的同签名失败一律不得回填到本列表。

- 2026-06-13：S06-lite review 修复阶段，单次出现，重跑通过（普通 flake）。
- 2026-06-13：S07-lite GREEN 阶段，`pnpm verify` coverage 模式连续 3 次同位置
  timeout——触发升级，应用 C 方案 timeout 缓解。
- 2026-06-13：A07 i18n GREEN 阶段，`pnpm verify` 再次出现同位置 timeout——单点
  timeout 缓解失效（仅延长边界，未消除根因），按"再次出现"触发条件升级为 A′
  apps/api coverage serial containment。
- 2026-06-13：A′ 方案首轮 `verify-stress.sh 5 --no-cache` 验证时，**packages/db
  `demo-seed.test.ts` 同样出现 5s timeout**——证明 PG 资源争用同样影响 packages/db。
  修复扩展到 `packages/db/vitest.config.ts` 同样设置 `fileParallelism: false`。
- 2026-06-20：P2C-J2/J3 恢复（`feat/p2c-j5-proctor-dashboard` 分支）后跑 `pnpm verify`，
  scanner 用例再次 5s timeout——`attempts.test.ts > deadline scanner > is idempotent:
  second scan does not re-grade or duplicate audit` 与 `> heartbeat scanner > leaves a
  still-stale in_progress attempt for the next scan when this scan finds nothing to
  disrupt` 两个用例 timeout（5000ms），均为 scanner 家族。同代码单跑整文件
  `vitest run src/routes/attempts.test.ts` 68/68 green；`-t "force-submit|extend-time|
  misconduct"` 15/15 green。与 J2/J3 恢复改动无因果（恢复仅新增 force-submit/
  extend-time 路由与测试，未触碰 scanner 代码）。
- 2026-06-20：`attempts.ts` 机械拆分为 `attempts.{candidate,admin,shared}.ts`（同分支）
  后，连续 3 次 `vitest run src/routes/attempts.test.ts` 整文件运行中，同样的 scanner
  用例间歇 5s timeout（1–2 个用例，非断言错误）。单独复跑 `-t "is idempotent: second
  scan|leaves a still-stale"` 时 1 个 timeout、1 个 4532ms 勉强过。失败用例固定落在
  deadline/heartbeat scanner describe，且为 timeout（非断言）。拆分仅改路由层 register
  hub 与文件归属，未触碰 scanner 代码（`packages/exam-engine` 的 `scanDatabase*` 与
  `apps/api/src/plugins/{deadlineScanner,heartbeat}.ts` 均未改动），判定无因果关系。
- 2026-06-23（**auth amplification 子类**）：`auth.test.ts` 在全量 `pnpm verify` /
  coverage 模式下出现 5000ms timeout。standalone 定向运行 2/2 PASS（约 2.2s），但
  full coverage 1/1 FAIL。归类（时代一致假设）为 auth login / audit polling（单用例
  6 轮 login + 每轮 audit 轮询）在全量 coverage + PG I/O 争用下被放大。该观察**不**
  证明 auth 业务逻辑错误，也**不允许**通过单点 timeout / skip 掩盖（历史诊断曾误把
  "maxWorkers=50% 通过"当并行安全证据；standalone PASS ≠ 全量并行/coverage PASS）。
- 2026-06-23（**physical-DB-lifecycle 子类**）：`packages/db/src/testWorkerDatabase.test.ts`
  的 `ensureDatabaseExists > creates the database if missing, idempotent on second call`
  在 `pnpm verify` / coverage 模式下 5000ms timeout（详见账本外历史条目，全文见下）。
- 2026-07-20（**WSL2 host-performance 子类**，wide-surface 复发）：在 M10-E typecheck
  修复 unblock 后跑 `pnpm verify`（`TEST_DB_ISOLATION=worker-database
  API_TEST_MAX_WORKERS=4` + coverage instrumentation），出现大规模 timeout 失败：
  31 个文件 fail / 13 个测试 fail，全部是 5000ms timeout（`api-smoke.test.ts`、
  `auth.test.ts` SuperAdmin/ContentManager/ResultViewer login 用例、
  `examStateMachine.test.ts` auto-open 用例、`@exam/db` 的 `testWorkerDatabase` /
  `testInfraLock` / `seed` 等）。同代码 standalone / serial 全部通过：
  `pnpm --filter @exam/api test`（serial）→ 1479/1479 PASS（281s）；`pnpm --filter
  @exam/db exec vitest run --no-file-parallelism` → 231/231 PASS（27.5s）连续两次；
  失败文件 standalone 复跑 15/15（2.72s）、10/10（2.56s）。时代一致假设：WSL2 在
  4-worker × v8 coverage × 每 worker 持续 `buildTestApp()`（CREATE SCHEMA → migrate →
  seed）下瞬时 I/O 调度无法收敛；8 core / 11 GB / load avg 3+。M10-E 修复仅触及
  testHelpers 类型、E19 测试、migration 0015 guard、openapi.json，不影响 runtime
  性能。当时的后续动作（用户决定）：迁移 Linux 实体机后重跑验证是否 WSL2-only；此前
  本机 verify 用 serial baseline。
- 2026-08-11（**0027-convergence 子类**，issue #280）：
  `packages/db/src/migrations/0027-convergence.test.ts` > `fails closed when a required
  column is missing` 在全量 `pnpm verify`（4-worker + coverage）下 5000ms timeout
  （`@exam/db#coverage` 564/565，与 issue #280 正文逐字一致）；standalone coverage
  通过。该用例是 0027 文件里唯一在 `it` 体内二次 bootstrap 隔离 schema（`makeEnv` →
  全量 migrate → sabotage DDL）的用例。同家族 artifact：`testCleanup.test.ts` 的
  `cleanup is not a function` afterAll 是 `beforeAll` 超时被掩盖的次生错误。**应用
  `packages/db/vitest.config.ts` stress-note 规定的定向修复**：仅给该 `it` 加
  `{ timeout: 15_000 }`（沿用 `testWorkerDatabase` 15s / `demo-seed` 30s 既有预算
  惯例），未做 package-wide serial override、未做 blanket timeout bump、无 retry /
  skip / 断言弱化。CI（独立 job 拆分）全程 green。

**physical-DB-lifecycle 子类的完整历史条目（2026-06-23 standalone entry，事实保全）**：

- 失败位置：`packages/db/src/testWorkerDatabase.test.ts`，用例 `ensureDatabaseExists >
  creates the database if missing, idempotent on second call`；调用 `pnpm verify`
  （→ `@exam/db coverage`，v8 instrumentation + turbo 并发）。
- 错误：

```text
FAIL  src/testWorkerDatabase.test.ts > ensureDatabaseExists > creates the database if missing, idempotent on second call
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it with a timeout globally.

❯ src/testWorkerDatabase.test.ts:144:3
   145|     const workerDb = "exam_test_w_phase3a_ensure";
   146|     await dropDbIfPresent(workerDb);
```

- 场景：分支 `feat/p2e-j2-attempt-timeline`（P2E-J2 收尾）；复跑 `pnpm --filter @exam/db
  test testWorkerDatabase` 立即 12/12 PASS（843ms）。
- 已知不是的原因：P2E-J2 改动（仅 auditLogRepo/audit/attempts.admin/AttemptDetailPage
  及测试）；worker-database 原型代码 bug（单跑 12/12 green）；迁移问题。
- 处置：无单点缓解；定向复跑取证；不 skip、不从 full path 删除、不加专属 timeout；
  归入 BUG-FLAKE-001 physical-DB-lifecycle 子类（时代一致归因，当时身份错绑机制活跃）。
- 复发：2026-07-21 ADR-006 proportionality corrective 的 `pnpm verify` 在 full turbo
  coverage 负载下再次命中同一 `ensureDatabaseExists` 用例；本次 suite timeout 已是
  15,000ms，失败仍是超时而非断言或 PostgreSQL 错误。失败后 `pg_stat_activity` 无
  `exam_test%` 活动/等待连接；当时有 84 个历史 `exam_test_w%` worker database（与
  2026-08-26 调查的"身份高水位残留"观察吻合——机制活跃期证据）。同代码立即隔离复跑
  15/15 PASS（2.18s），随后 `@exam/db` 全 coverage 233/233 PASS（13.38s）。继续按
  既有处置：不加单点 timeout、不 skip，full-turbo PG DDL 争用作独立 test-infrastructure
  议题，不与 audit 业务改动混合。

#### 参考因果调查：2026-08-26 漂移型 5s/10s 超时根因链——worker identity 错绑（第一层）→ DDL advisory-lock 队列负载（第二层）（S0 审计 follow-up ×2 轮审查）

> 本小节是本登记册的**证据质量基准（REFERENCE CAUSAL CASE）**：插桩测量、假设证伪、
> 语义证据（源码+官方文档）、自然失败捕获、确定性回归/变异、多轮对抗审查。机制保持
> `ROOT_CAUSE_CONFIDENCE = CAUSALLY_PROVEN`。**不得**把它的机制自动外推到之后任何
> 超时 occurrence（见 Epistemic rules #5）。

**现象**：`pnpm verify` / coverage 下漂移型超时，victim 位置不固定：auth.test.ts
login-limiter（5s）、e2eReset.test.ts 首用例（5s）、examProfileRepo.test.ts
beforeAll（10s，次生 "cleanup is not a function"）、0027 sabotage 用例、历史
testWorkerDatabase/seed 条目。单文件复跑必过，失败点随调度漂移。

**证据一（TEST_INFRA_TRACE 插桩 + pg 采样，packages/db coverage 默认并行，第一轮审查）**：

- 单次 run **244 次** lifecycle-lock 获取；等待 **p50≈730ms、p95≈2.2s、max≈4.8s**；
  每轮 72-93 次等待 >1s、5-7 次 >3s —— 全绿 run 也如此。
- 并发单调恶化：workers=1 → p50=19ms/max=265ms（队列消失）；2 → max 2s；
  4 → p95 884ms/max 4s；8（默认）→ p95 2.2s/max 4.8s。
- 池/连接排除：峰值 22-28 连接 ≪ max_connections=100；采样同时最多 6 个
  backend 等 advisory lock（1 持有 + 队列）。
- 纯 CPU 假设证伪：auth limiter 单跑 1032ms，4 个 argon2 燃烧器下仅 1173ms
  （+14%），纯 CPU 饥和不构成 5s 击穿。

**证据二（定向探针，第二轮审查——第一层根因实证）**：固定 16 个 api 测试文件、
`API_TEST_MAX_WORKERS=2`、清空 `exam_test_w*` 冷启动：

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

**根因（分层因果链）**：

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

**修复中捕获的自然失败（根因证据闭环）**：修复迭代中一次 `@exam/db`
coverage run 复现了完整 victim 链：trace 显示一次病态
`dropDatabaseIfExists` **持锁 23.4s**（WSL2 I/O 长尾的 DROP DATABASE），
其后 schema setup 排队等待 23.5-23.9s ≫ 10s hookTimeout → testCleanup ×2 +
0027 ×2 共 6 个 suite "Hook timed out in 10000ms" + 次生 "cleanup is not a
function"。与 S0 会话 examProfileRepo victim 完全同签名。

**修复（最小结构，非 timeout/skip/retry）**：

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

**已试并撤回的方案（第 1 轮修法，第 2 轮审查否决）**：

- ~~锁键拆类（schema/database 双键）~~：撤回理由：(a) 动机性队列负载本身
  是 identity 症状，identity 修复后 wait max 58ms，无拆键需要；(b)
  "跨类竞争由 30s budget 承接"不成立——**timeout 预算不是并发控制**；
  (c) 单键正是引擎级保证（CREATE/DROP DATABASE 不与 migrate
  并发打 catalog），拆键是在撤销旧安全设计。单键恢复，并保留"任意临界区
  持有 THE 单键、探针 try-lock 必败"的确定性回归。
- ~~包级 `hookTimeout: 30_000`~~：作用域过度扩大（把 @exam/db 全部
  beforeAll/afterAll 一律放宽到 30s，无关坏 hook 的暴露延迟 3 倍）。改为
  仅生命周期 hook 显式传参。

**回归测试（旧实现必败，stash/变异实证）**：`testScope.test.ts` 同槽位
稳定名 / 异槽不同名 / POOL>WORKER 优先级 / legacy 回退 / 空值穿透 /
charset 校验（旧实现按 WORKER_ID 取名必败）；`testIsolation.test.ts`
"acquires the lifecycle lock exactly once"（旧实现 2≠1 FAIL）；
`testWorkerDatabase.test.ts` "second setup … does not re-acquire"（旧实现
2≠0 FAIL）；`testInfraLock.test.ts` 单键回归："any critical section holds
THE single lifecycle key (probe try-lock must fail)"（重引入分键或改路由
变异 FAIL，pg_locks try-lock 无竞速无时序）+ 跨库协同 pg_locks 本会话
过滤证明。

**round-3 合同收口（2026-08-27，第三轮对抗审查，全部变异实证）**：

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

**遗留（follow-up，不本 PR）**：模板库克隆（CREATE DATABASE … TEMPLATE）
可把 slot 冷启动从 CREATE+migrate 进一步降到 clone；api 全量并行铺开时
关注 slot 复用率与 @exam/db file-schema 路径的 migrate 串行利用率。

#### 2026-10-12 复核

对照 current master（`0044e2a0`）：`apps/api/vitest.config.ts` 仍以
`fileParallelism: false` 为默认、worker-database 并行仍为 env-gated opt-in；
`packages/db/src/testScope.ts` 解析序仍为 `TEST_WORKER_ID` → `VITEST_POOL_ID` →
缺省 fail，`VITEST_WORKER_ID` 未被消费；`scripts/test/verify-stress.sh` 仍在。本条
"当前缓解"小节描述的结构与 current master 一致。

---

### CASE-2026-09-01-CI-BOOTSTRAP — CI API coverage 4-worker 并行下 DB 生命周期钩子漂移超时（PR #362 S1 anti-decay → 2026-09-24 bootstrap lifetime 结构修复）

#### Status

```text
CASE_STATE = REPAIRED
CASE_CREATED_AT = 2026-09-01（首次 CI occurrence 登记）
CASE_LAST_REVIEWED_AT = 2026-10-12T09:48:53+08:00
CASE_LAST_MODIFIED_AT = 2026-10-12T09:48:53+08:00

NONDETERMINISTIC = YES（历史）
ROOT_CAUSE_CONFIDENCE = CAUSALLY_PROVEN（per-file bootstrap 重复取锁风暴 + 慢 DDL
  持有者队列放大；变异回归 + 修复前后量化对比 + 受控 5 连跑）
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED（REC-2026-10-12-002 降级，原为
  PROVEN_UNRELATED；准入依据见 STEP 7：原依据为文件级论证，不构成排除）
AGGREGATION_CONFIDENCE = SUPPORTED（2026-09-01 occurrence 为签名级归因
  [CORRELATED]；2026-09-23 复发进入机制调查后被实证）
```

#### 首次 occurrence（2026-09-01，历史事实保全）

- **现象**：CI run 33425276029（2026-08-31T18:29Z，pull_request，
  `chore/recovery-anti-decay-s1` @ cdafbd38）的 API coverage job
  （`TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4`）失败；同 run 其余
  job（Build / Static / E2E×2 / Web / Package）全部通过。3 个文件 6 个错误，全部为
  DB 生命周期钩子超时，无任何断言失败：
  - `src/routes/clientEvents.test.ts:20` — `beforeAll` 内 `buildTestApp`
    `Hook timed out in 10000ms` → `:29` afterAll 次生 `TypeError: Cannot read
    properties of undefined (reading 'db')`；7 tests skipped
  - `src/routes/importLogs.test.ts:11` — 同上 10000ms → `:37` 次生
    `(reading 'cleanup')`；10 tests skipped
  - `src/email/emailDeliveryService.test.ts:155` — BUSINESS SAFETY 用例
    `Test timed out in 5000ms` + `:50` afterAll `cleanup` `Hook timed out in 10000ms`
- **证据（同代码再跑就过）**：本地同一 commit 用与 CI 完全相同的命令全绿：184 文件 /
  2447 passed + 12 skipped（总数 2459 与 CI 一致），0 超时，EXIT=0。
- **排除回归**：3 个失败文件不导入该 PR 改动的任何模块（recoveryRepo /
  incidents.admin / pending*Authority）；同一 CI run 中导入这些模块的测试
  （incidents.admin.test.ts、pendingForceSubmitAuthority.test.ts 等）全部通过；
  Package coverage（含 recoveryRepo 生命周期矩阵）通过。
- **失败签名**：3 个文件的钩子在 ~23s 窗口（18:34:41–18:35:04）内同时漂移越界，而
  同窗口其他 worker 的 DB 测试正常完成（settings 847ms、api-smoke 639ms、
  submitAndGradeAttempt 1273ms）—— PG 服务健康，是 runner 负载（4 vCPU 上 4 个
  coverage-instrumented worker + PG + Redis；import 阶段 137.97s）下的调度漂移，
  失败点落在 DB 生命周期钩子（10s hookTimeout / 5s testTimeout）。
- **当时处置**：无代码改动（不调 timeout、不 skip、不 retry）；推送登记提交触发新
  CI run 验证转绿。

#### 复发与根因实证（2026-09-23 → 2026-09-24 结构性修复）

2026-09-23 PR #603 CI（run 35851583114）同签名复发（`importLogs.test.ts:11` hook
timeout → `:37` 次生 cleanup TypeError），触发根因调查。机制确认：

- Vitest 4 forks + `isolate: true` **每个 test file 一个全新 worker process**，
  per-process bootstrap memo 跨 file 必然失效 → 每 file 首个 `buildTestApp` 重复
  ensure+migrate 两次取锁（实测 ~220 次/run，占全 run 322 次 lane 获取的 68%）；
- 队列深度把 lane 上的慢持有者（slot-reuse 隔离证明的 `DROP DATABASE`，实测
  4.3–5.7s、历史 23.4s）放大为无关文件 `beforeAll` 的 10s hookTimeout 超时。

**修复**：bootstrap 事实改为 **server-side**——无锁只读预检（库存在且
`drizzle.__drizzle_migrations` 行数 == append-only journal 条目数，journal 不变性由
`lint:db-journal` 门禁保证），未命中才取 ONE 个合并 ensure+migrate 临界区（锁内复检）；
per-file 业务数据 reset 保持 per-file（跨 file 隔离边界，`workerDbTruncated` 更名
`fileBusinessDataReset` 并改写"once per worker process"失实注释）。

**证据（变异 + 量化）**：同 slot 双文件生命周期回归（`apps/api/tests/bootstrapLifetime/`，
单次子 vitest 调用 + maxWorkers=1 + 角色锁文件选举）双向变异实证：禁用预检 → 第二文件
0-acquisition 断言红；跳过 per-file reset → sentinel 断言红。实测（本地 taskset 4-CPU、
`API_TEST_MAX_WORKERS=4`、5 连跑）：bootstrap lane 获取 220→**2**/run（4 outer slots 温库
预检全中 + slot-reuse stage-A 冷建 1）、总 lane 获取 322→**107**/run（其余为 file-schema
路径 create/drop schema 96 + 生命周期证明类），预检成本 p50 ~63ms，**0 hook/test 超时**；
2 次失败为环境伪影（遗留 tsx watcher 占用 3000 端口 / 调查中进程清理扰动），与 worker
路径无关。

#### 本轮再分类记录

```text
CASE_LAST_MODIFICATION = ROOT_CAUSE_RECLASSIFIED（2026-09-01 occurrence 的归因级别）
CASE_LAST_MODIFICATION_RESULT = PASS
PREVIOUS_CLASSIFICATION = 2026-09-01 条目把根因假设写作"BUG-FLAKE-001 I/O
  contention / 宿主负载家族在 CI runner 上的首次发生"
CURRENT_CLASSIFICATION = 机制（bootstrap 重复取锁 + 慢 DDL 队列放大）为
  CAUSALLY_PROVEN；2026-09-01 单次 occurrence 对该机制的归因为 CORRELATED
  （签名一致 + 机制活跃，未逐条取证）；"宿主负载"作为独立根因保持 HYPOTHESIS
CLASSIFICATION_CHANGE_REASON = 2026-09-24 调查把机制实证到取锁计数与变异回归级别；
  对首 occurrence 的链接是签名级而非逐条因果证明
```

```text
CASE_LAST_MODIFICATION = CURRENT_CHANGE_CAUSALITY_RECLASSIFIED（REC-2026-10-12-002）
CASE_LAST_MODIFICATION_RESULT = PASS
PREVIOUS_CLASSIFICATION = CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（两次 occurrence
  的受害文件均不导入改动模块，且同一 CI run 中导入这些模块的测试全过；同 commit 本地
  全绿）
CURRENT_CLASSIFICATION = CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED
EVIDENCE = ① 原依据属 STEP 7 明确排除的准入形式（受害文件未被改动 / 无 import 边 /
  隔离复跑通过）；② 本次复核 `git diff --stat 9586f7c9^1 9586f7c9`（PR #362，
  `chore/recovery-anti-decay-s1`）显示该 PR 在同一 API coverage lane 内改动了
  DB-touching 测试文件：`packages/db/src/repository/recoveryRepo.test.ts`（+115）与
  `apps/api/src/.../pendingForceSubmitAuthority.test.ts`（532 行改写），另有
  `recoveryRepo.ts`、`incidents.admin.ts` 等生产文件；已证明机制（per-file bootstrap
  重复取锁 → lane 队列深度放大）对 lane 内文件数/工作量敏感，故改动经队列压力影响失败
  的通路未被排除
CLASSIFICATION_CHANGE_REASON = 原分类把"改动后的产物被测通过"与"受害文件不在依赖图"
  当作对改动的排除，但两者都不排除调度/队列级影响；在机制确定为队列放大的情况下，
  同一 lane 内测试文件被改动是必须排除却未被排除的备择解释
REVIEWED_AT = 2026-10-12T10:24:59+08:00
```

---

### BUG-FLAKE-002 — 跨 package / 跨 task 共享 `exam_test` DB 导致 seed/cleanup 互相覆盖

#### Status

```text
CASE_STATE = REPAIRED
CASE_CREATED_AT = 2026-06-17
CASE_LAST_REVIEWED_AT = 2026-10-12T09:48:53+08:00

NONDETERMINISTIC = YES（历史）
ROOT_CAUSE_CONFIDENCE = CAUSALLY_PROVEN
CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（CONTROLLED_EXCLUSION：并发拓扑受控
  复现同一竞争链；隔离域落地后该链消失）
AGGREGATION_CONFIDENCE = CAUSALLY_PROVEN

AGGREGATION_BASIS = 同一资源所有者缺陷：turbo 并发调度下多任务共享同一 default
  组织的 seed 写入与 cleanup 删除（FK/身份竞争链被复现并随隔离域修复消除）
```

**状态**: 已关闭（2026-06-17 缓解 → 2026-06-21 根因修复）。曾经用于缓解的分阶段串行
脚本已随根因落地从 `package.json` 删除，不再是本仓库的可用命令，也不是本条目要求的缓解。

**Old root cause**: `@exam/db` 与 `@exam/api` 共享 `exam_test.public` schema。turbo
并发调度 `test` 和 `coverage` 任务时，A 任务 seed 写入 default org 的同时 B 任务
cleanup 删除同一 org → FK violation / 身份认证失败。

**New root fix**: `packages/db/src/testIsolation.ts` 提供
`setupIsolatedTestDb({ namespace })` + `buildTestApp(plugin, { schemaName })`，每个测试
任务可拥有独立 PG schema 且互不干扰。通过 `SET search_path` + `migrationsSchema`
实现 schema 级隔离。已验证：`testIsolation.test.ts` 32 个隔离测试全部通过。

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

**根因**: `@exam/db` 与 `@exam/api` 是仅有的两个使用共享 `exam_test` PostgreSQL 实例的
package。`fileParallelism: false` 只消除 *单 package 内* 的文件并行，**不**消除 turbo 在
单次调用里跨 package / 跨 task（test vs coverage）的并发。当 `turbo run test coverage`
（或任何把 DB-touching 任务放进同一次调度的命令）执行时，多个任务会并发写同一个
`default` 组织及其清理钩子，互相覆盖。

**根因修复（2026-06-21，已完成）**: 每个测试任务拥有独立 PostgreSQL 隔离域——
`packages/db/src/testIsolation.ts` 的每文件 schema（`setupIsolatedTestDb({ namespace })` +
`buildTestApp(plugin, { schemaName })`，`SET search_path` + `migrationsSchema`）与
`packages/db/src/testWorkerDatabase.ts` 的每执行槽位物理库。跨 package 并发 stress 5/5
PASS。缓解方案建立在 `docs/SPEC.md` §3.1 Organization Data Boundary Guard 定义的"所有
业务数据归属于内部 default organization"之上——测试 seed 与 cleanup 同样操作 default
组织，跨任务共享此状态即触发竞争。

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

**Occurrence**:

- 2026-06-17：P2A-J2 PR review 阶段，`turbo run test coverage --force` 复现
  `@exam/db#coverage` 失败（seed idempotency / demo-seed 在并发下被对方 cleanup 覆盖）。

---

### BUG-FLAKE-003 — deadline scanner tests leak expired attempts across repeated runs

#### Status

```text
CASE_STATE = REPAIRED
CASE_CREATED_AT = 2026-06-18（50-run 复现）
CASE_LAST_REVIEWED_AT = 2026-10-12T09:48:53+08:00

NONDETERMINISTIC = YES（历史；触发依赖累积状态，fresh DB 不触发）
ROOT_CAUSE_CONFIDENCE = CAUSALLY_PROVEN（38-run 复现 + DB 普查 + fresh-DB 对照 +
  修复后 stress 5/5）
CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（CONTROLLED_EXCLUSION：38 连跑在改动
  无关的变量上重现同签名；fresh-DB 对照归零；原 occurrence 本身即为受控复现 run）
AGGREGATION_CONFIDENCE = CAUSALLY_PROVEN

AGGREGATION_BASIS = 同一状态泄漏机制：cleanup() 只关连接不删数据，expired attempts
  跨 run 累积，scanner 扫全 org
```

**状态**: 已关闭（2026-06-20 缓解 → 2026-06-21 根因修复）。deadline scanner 套件与其余
DB-touching 文件一样接入隔离域，跨 run 数据残留从源头消除。

**Old root cause**: `cleanup()` 只关闭连接不删数据。deadline scanner 测试创建的 expired
attempts（voided / future-deadline / race-noop 逃逸场景）在 run 结束后残留在
`exam_test.public` schema 中。`scanDatabaseForExpiredAttempts` 扫描整个 org 的全部
expired attempts，跨 run 污染。

**root fix**: 每测试文件 / 每执行槽位独立 PG 隔离域（`testIsolation.ts` 的
`setupIsolatedTestDb()` + `SET search_path`；worker-database 模式下为每槽位物理库），
从源头保证每次 run 的数据不会残留到下一次。

**当前缓解**:

- `beforeEach` 清理 + `afterAll` 组织清理（2026-06-20，cleanup containment）仍为主缓解。
- `apps/api` 默认串行（`fileParallelism: false`）确保 scanner 测试串行运行。
- `scripts/test/deadline-scanner-stress.sh` 用于手动验证。

**修复（2026-06-20）**:

1. `apps/api/src/routes/attempts/deadline-scanner.test.ts` 添加 `beforeEach` 清理：每次
   测试前删除残留的 deadline-scanner-test-* 组织及其数据，确保每次测试从干净状态开始。
2. 新增 `cleanupBusinessData()` helper（`packages/db/src/testCleanup.ts`）：删除考试业务
   数据（audit、attempts、enrollments、exams、questions、courses），保留组织、用户、候选
   数据。与 `cleanupOrganizationChildData` 共享底层 `deleteExamBusinessData` 私有 helper。
3. 新增 stress 脚本 `scripts/test/deadline-scanner-stress.sh`：连续运行 deadline scanner
   测试，默认 40 次。
4. 新增 `cleanupBusinessData` 回归测试（`packages/db/src/testCleanup.test.ts`）。

**验证**: 5 次 stress test 全过；`pnpm verify` 全过。

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

- 同一 `exam_test` PostgreSQL 实例上连续多次运行
  `pnpm --filter @exam/api test -- src/routes/attempts/deadline-scanner.test.ts`
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

**DB 证据（38 次 run 后）**:

| status      | count |
|-------------|-------|
| graded      | 1316  |
| disrupted   | 712   |
| submitted   | 80    |
| voided      | 40    |
| in_progress | 12    |

expired (`deadline_at <= now`, status `in_progress` or `disrupted`): **94 条**，全部在
`default` org。

**触发率**: 2.6%（1/38），随累积 run 次数增加而上升。fresh DB 首次 run 不会触发。

**禁止做（仍然有效）**:

- 不改 deadline scanner 业务代码来迁就测试
- 不改 `backdateDeadline` 偏移量
- 不 skip 该用例
- 不给 `scanDatabaseForExpiredAttempts` 加过滤参数

**后续修复方向（历史记录；根因修复已用隔离域方案落地）**:

1. **方案 A（当时推荐）**: describe block 的 `beforeAll`/`beforeEach` 清理 expired
   attempts（`cleanupOrganizationTestData()` 或定向 DELETE）
2. **方案 B**: 扩展 `buildTestApp()` / `cleanup()` 删除当前 org 业务数据（与
   BUG-FLAKE-002 的 Option B 同源）
3. **方案 C**: 每个 run 独立 PG schema（与 BUG-FLAKE-001 的 B 方案同源）

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

**Occurrence**:

- 2026-06-18：50-run reproduction 脚本，Run 38 首次失败（`submittedCount: 3`）。Run 1-37
  全过。DB 累积 94 条 expired disrupted attempts。

#### Stress verification — BUG-FLAKE-003 deadline scanner

| Command | Runs | Result | Notes |
|---|---|---|---:|
| `pnpm --filter @exam/api test -- --run src/routes/attempts/deadline-scanner.test.ts` | 5 | PASS | Cleanup containment + 串行默认: no leaked expired attempts |
| `pnpm --filter @exam/api test -- --run src/routes/attempts/heartbeat.test.ts` | 5 | PASS | No timeout, no state leak |

这些 stress 是在 cleanup containment + `apps/api` 串行默认之下验证的。

---

### BUG-FLAKE-004 — Intra-suite cross-file state leak via shared `exam_test` schema

#### Status

```text
CASE_STATE = REPAIRED
CASE_CREATED_AT = 2026-06-19（RESOLVED-001 根因分析中发现）
CASE_LAST_REVIEWED_AT = 2026-10-12T09:48:53+08:00

NONDETERMINISTIC = YES（历史；同 run 内顺序依赖）
ROOT_CAUSE_CONFIDENCE = CAUSALLY_PROVEN（逐层隔离复现；schema 隔离后源头消除）
CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（CONTROLLED_EXCLUSION：逐层隔离受控
  复现；schema 隔离后源头消除，3 连跑 stress 对照）
AGGREGATION_CONFIDENCE = CAUSALLY_PROVEN

AGGREGATION_BASIS = 同一状态泄漏机制：同 package 内跨文件单次 run 的共享 schema
  残留（与 BUG-FLAKE-003 同源不同受害面）
```

**状态**: 已缓解（2026-06-20，explicit cleanup 方案）。B 方案已完成（2026-06-21）——所有
DB-touching 测试文件（含 tenant-isolation、exam、permissionBoundary）已接入隔离 schema，
从源头消除跨文件状态泄漏。

**修复（2026-06-20）**:

1. `apps/api/tests/security/tenant-isolation.test.ts` `afterAll` 添加
   `cleanupOrganizationTestData` 调用：确保测试结束后清理 orgA 和 orgB 的所有数据，不再
   污染后续测试文件。
2. 同 BUG-FLAKE-003 修复中的 `cleanupBusinessData` helper 和共享
   `deleteExamBusinessData` 私有 helper。

**验证**: `pnpm verify` 全过。

**失败位置**:

- 受影响文件：`apps/api/src/routes/exam.test.ts`、`apps/api/src/routes/permissionBoundary.test.ts`、
  `apps/api/tests/security/tenant-isolation.test.ts`
- 触发条件：`tenant-isolation.test.ts` 写入 `batchSize:0`（契约非法）fixture → 同一次
  `pnpm --filter @exam/api test` 运行中，`exam.test.ts` / `permissionBoundary.test.ts`
  的 `GET /api/exams` 列出该记录 → Zod 校验失败 → 500

**根因**: `apps/api` 内所有测试文件共享同一个 `exam_test` PostgreSQL schema。
`fileParallelism: false`（`apps/api` 串行默认）消除了文件并行，但**未消除跨文件状态
残留**：前序文件写入的行在后续文件中仍可见。`tenant-isolation.test.ts` 的 `cleanup()`
只关闭连接不删数据（与 BUG-FLAKE-003 同源），留下非法 fixture 污染后续文件的 list 查询。

**与已知条目的关系**:

- **BUG-FLAKE-001**（`fileParallelism: false` 串行默认）只解决并行 I/O 争用，不解决状态残留。
- **BUG-FLAKE-002**（turbo 跨 package 并发）只解决跨 package 竞争，不解决同 package 内
  跨文件残留。
- **BUG-FLAKE-003**（deadline scanner 数据累积）是同类问题的另一个实例——同 schema 跨
  run 残留。
- 本条目是**同 package 内、跨文件、单次 run** 的状态泄漏，与上述三条都不同。

**根因修复方向（与 BUG-FLAKE-001 B 方案同源；已落地）**: 每个测试文件 / 每个 worker
使用独立 PG schema（`SET search_path`），从源头消除跨文件状态残留。

**当前缓解**: `apps/api` 的测试文件按序执行（`fileParallelism: false`），且
`cleanupOrganizationTestData()` 在多数 describe block 的 `afterAll` 中调用。但非所有文件
都调用——`tenant-isolation.test.ts` 自建 app 不走 `buildTestApp`，未调用全局 cleanup。

**禁止做（仍然有效）**:

- 不改业务代码来迁就测试状态泄漏
- 不 skip 受影响用例
- 不给每个测试加独立 timeout 来掩盖

**Occurrence**:

- 2026-06-19：RESOLVED-001 根因分析中发现，`tenant-isolation.test.ts` 写入
  `batchSize:0` 后污染 `exam.test.ts` 与 `permissionBoundary.test.ts`，修复 fixture 后
  512/512 过。

#### Stress verification — BUG-FLAKE-004 cross-file

| Command | Runs | Result | Notes |
|---|---|---|---:|
| `pnpm --filter @exam/api test -- --run apps/api/tests/security/tenant-isolation.test.ts src/routes/exam.test.ts src/routes/permissionBoundary.test.ts` | 3 | 2/3 PASS, 1 flake | First run failed (cold-start state), reruns passed 2/2 |

**解释 1 次 flake**: 首次运行可能因共享 `exam_test.public` schema 的 cold-start 状态
不干净而失败。后续运行稳定通过。**B 方案已完成（2026-06-21）**——每文件使用独立
schema，前序文件数据不会残留。此 flake 已从源头消除。

---

### CASE-2026-07-21-AUDIT — fire-and-forget audit 生命周期竞态与 ADR-006 口径演进（三阶段）

#### Status

```text
CASE_STATE = REPAIRED（phase 1 竞态修复；phase 2 中间态合同被 phase 3 比例性
  corrective 取代——SUPERSEDED）
CASE_CREATED_AT = 2026-07-21
CASE_LAST_REVIEWED_AT = 2026-10-12T09:48:53+08:00

NONDETERMINISTIC = YES（历史）
ROOT_CAUSE_CONFIDENCE = CAUSALLY_PROVEN（deferred Promise + 真实 PostgreSQL 确定性
  复现 23503 与跨测试晚行污染；trigger 注入覆盖多写入家族）
CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（CONTROLLED_EXCLUSION：操纵的变量是缺
  owner 的 Promise；注入 deferred 即在真实 PostgreSQL 上确定性重现 23503 与跨测试
  晚行污染，该结构独立于当时改动）
AGGREGATION_CONFIDENCE = CAUSALLY_PROVEN
```

#### Phase 1 — fire-and-forget audit 与破坏性清理发生生命周期竞态（2026-07-21，已修复）

- **现象**：attempt 路由测试偶发命中
  `audit_logs_organization_id_organizations_id_fk`；把 `beforeEach` 改成
  `cleanupBusinessData` 后 FK 错误消失，但上一测试的延迟 audit 行仍可进入下一测试。
- **已证实根因**：`recordAudit` 创建的 Promise 没有 owner，HTTP 响应、`beforeEach`、
  `afterAll`、`app.close()` 和连接池关闭都没有 pending-work barrier。受控 deferred
  Promise + 真实 PostgreSQL 确定性复现了 audit delete 与 organization delete 之间落入
  INSERT 的 `23503`，也复现了清理后的跨测试 late-row 污染。
- **错误缓解**：只保留 organization、删除 business rows 是 FK containment，不是同步；
  它把 FK 失败换成了隔离失败。删除重试或真实延时同样不构成修复。
- **最终不变量**：上一测试关联的 side effect 尚未 drain 时，不得开始破坏性 fixture
  清理；优雅关闭不得早于所有已接收、已跟踪的 audit 写入 settle。
- **修复提交**：`1b01925`（tracked audit registry、显式 drain、Fastify close / scanner /
  DB pool 顺序）；七个套件恢复每测试 organization 生命周期，并在 `beforeEach` 与
  nested `afterAll` 明确 drain。
- **回归测试**：`routes/auditLifecycle.test.ts` 覆盖非阻塞响应、真实 DB drain、跨测试
  污染、破坏性清理、失败日志和 `app.close`；`plugins/auditLifecycle.test.ts` 覆盖同步
  注册、乱序完成、多写入、拒绝清除和 drain 期间的新工作；`plugins/db.test.ts` 覆盖
  audit drain 先于 pool close。

#### Phase 2 — ADR-006 审计原子性、崩溃耐久性与无界关闭缺口（2026-07-21，历史中间态，已被比例性 corrective 修正）

- **现象**：前一项 lifecycle 修复只保证优雅关闭会等待已登记的异步写入；业务事务仍先
  提交、审计随后异步执行。因此审计 INSERT 失败或进程在两者之间 SIGKILL 时，API 已成功
  但审计永久缺失；永久不 settle 的 Promise 还会使 `app.close()` 永不返回。
- **已证实根因**：旧的通用 audit helper 同时承载不同可靠性要求，却只暴露 fire-and-forget
  语义，并固定使用根 DB 连接。调用者不能把写入加入当前事务，action vocabulary 也没有
  逐项耐久性分类，drain 没有 deadline 或退出策略。
- **历史中间态**：该修复把 48/58 个 action 归入事务关键，并把登录、答案保存、自动提交/
  中断、自动开闭都放入审计可用性边界；还让"可丢失"的后台观察在 drain 超时后写
  `process.exitCode = 1`。后续独立 review 证明这些口径过宽且互相矛盾，不能作为当前合同。
- **保留的真实修复**：原子 writer 必须使用同一个 branded transaction；真实 PostgreSQL
  trigger failure injection 继续作为高价值证据；后台 Promise 必须有 lifecycle owner 和
  有限 drain。
- **被撤销的合同**：登录不再因 tenant audit 失败而拒绝；答案保存和自动领域迁移不再写
  compliance audit；best-effort 超时不再导致非零退出。
- **结论**：本条作为根因演进历史保留。当前权威口径见 Phase 3 和 ADR-006 的 "Audit
  contract proportionality corrective"。

#### Phase 3 — ADR-006 audit contract proportionality corrective（2026-07-21，现行口径）

- **已证实根因**：旧分类把"mutation"近似等同于"必须与审计原子提交"，混淆 enum 完整性
  与运行时 emitter 完整性，并让 candidate runtime、普通登录和 routine authoring 依赖
  `audit_logs` 可用性。
- **当前不变量**：只有 authority、credential、privileged mutation 的窄集合使用 atomic
  writer；三个明确的敏感读取在响应前同步落审计；普通登录和 routine observation 使用
  tracked best-effort；`attempt.saveAnswer`、自动提交/中断、自动开闭属于 canonical
  domain state，不进入 compliance audit。
- **lifecycle**：ACTIVE、RESERVED、DEPRECATED 与 durability 独立。三个 `email.*`
  action 是 RESERVED，不能计入 active coverage。递归 production inventory 要求
  active-zero、reserved-emitter、direct-writer-bypass 全为零。
- **关闭策略**：lifecycle 只返回 `{ timedOut, pendingCount }`，不处理 signal、不改
  `process.exitCode`。server 在 timeout 时记录 warning 并继续有界关闭；仅真正的
  graceful-shutdown failure 才选择非零退出。
- **确定性回归**：trigger 注入覆盖 route-owned、admin invariant、submit/grading
  service、exam transition executor、CLI/bootstrap、bulk import 和 manual grading 家族；
  sensitive-read 测试证明 audit 失败时响应不含受保护数据；best-effort 测试使用
  deferred Promise + fake timer，无 wall-clock sleep。
- **测试隔离口径**：只有 best-effort action 需要 drain。atomic action 与业务事务一起
  settle；domain-history exclusion 不得靠 drain 伪装成审计保证。

---

### CASE-2026-08-01-LOCK-SCOPE — PR #242 flake closeout: advisory-lock database scope + time-based concurrency sync（REC-I6-I1-INCIDENT-PERSISTENCE-COMMANDS）

#### Status

```text
CASE_STATE = REPAIRED（四处机制修复均落地并有确定性回归；原始 occurrence 从未复现，
  与修复机制的链接 UNPROVEN）
CASE_CREATED_AT = 2026-08-01
CASE_LAST_REVIEWED_AT = 2026-10-12T09:48:53+08:00

NONDETERMINISTIC = YES（历史——原始失败重跑通过）
ROOT_CAUSE_CONFIDENCE = 修复的四处机制各自 CAUSALLY_PROVEN（源码证据 + 确定性回归）；
  原始 occurrence 的根因 UNKNOWN（未能复现）
CURRENT_CHANGE_CAUSALITY = UNKNOWN（原始失败未复现，无判别证据）
AGGREGATION_CONFIDENCE = PROVISIONAL（"修复与原始失败相关"是以源码证据为底的假设）
```

- **现象**：PR #242 的本地全套测试曾出现失败后重跑通过（`incidents.admin.concurrency.test.ts`、
  `0023-incident-fk-and-rollback.test.ts`、`testInfraLock.test.ts`、
  `testWorkerDatabase.test.ts`）。本次 closeout 未能复现原始失败（baseline 全部通过），
  但按源码证据修复了三处确定的非确定性。
- **根因 1（advisory lock 是 database-local）**：`withTestInfraLifecycleLock` 直接连接
  调用者传入的任意数据库。schema lifecycle 调用者锁在 `exam_test`，database lifecycle
  调用者锁在 `postgres`，worker-DB 调用者锁在 worker database——即使 key 相同也**不能
  相互协调**（PostgreSQL advisory lock 只在同一 database 内互斥）。修复：
  `testInfraLock.ts` 新增 `resolveTestInfraCoordinationUrl`，把任意输入 URL 规范化到单一
  coordination database（`TEST_ADMIN_DATABASE` ?? `postgres`，剥离 search_path/options，
  校验名字安全），`withTestInfraLifecycleLock` 内部统一到该 URL；
  `testWorkerDatabase.ts` 的 `resolveAdminUrl` 复用同一 resolver。
- **根因 2（incident 并发测试用时间同步）**：`incidents.admin.concurrency.test.ts` 用
  `setTimeout(150)` / `setTimeout(100)` head-start 制造竞态，`t1Committed`/`t2Release`
  两个 deferred 创建但不承担调度。修复：test-only `IncidentRepo` proxy 在事务内精确门控
  （T2 pre-read 完成后等待 → T1 获取行锁后等待 → T2 在真实 `findByIdForUpdate` 前
  signal `t2LockAttempted` → 释放 T1 提交 → T2 用旧 REPEATABLE READ snapshot 醒来冲突 →
  recovery → idempotent_replayed），并记录两个 primary transaction 的
  `pg_backend_pid()` / `txid_current()` 断言；resolve-vs-dismiss 改为双 pre-read 完成后
  同时释放、行锁选胜者。全部 `setTimeout` / head-start 删除，deferred 在 `finally` 中
  dispose（断言失败也不留挂起事务/连接/timer）。
- **根因 3（新 migration tests 未进 lifecycle lock）**：0023 的 `applyAllMigrations`、
  `incidents.admin.concurrency.test.ts` 的 `migratePostgres`、`getIsolatedTestDb()` 的
  `migratePostgres` 都在 lock 外。修复：全部包进 `withTestInfraLifecycleLock`（canonical
  到同一 coordination DB，与 CREATE/DROP DATABASE、CREATE/DROP SCHEMA 真正互斥）。
- **根因 4（catalog 查询跨 schema 误读）**：0023 的 FK 断言按 `conname` 查全库并读
  `rows[0]`，可能读到并行 schema 的同名 constraint。修复：`pg_constraint JOIN pg_class
  JOIN pg_namespace` 限定 `nspname = iso.schemaName`、`relname = exam_incidents`，
  `rows.length === 1`。
- **修复 5（testInfraLock sleep 测试）**：串行化测试的 `setTimeout(120)` hold 改为
  deferred-gated critical section + 真实 `pg_locks` 证据（one granted holder + ≥1
  ungranted waiter，classid/objid 重构 key 一致）；新增跨数据库真实 PostgreSQL 回归测试
  （holder 走 `exam_test` URL、contender 走 `postgres` URL，同一把锁）。
- **单队列预算（hang protection，非掩盖）**：统一 coordination DB 后所有 heavy DDL 在同
  一队列串行；并行 `@exam/db` 下快操作可能排在秒级 CREATE/DROP DATABASE 之后，默认 5s
  testTimeout 不够。为参与队列的测试/describe 增加显式 timeout（testIsolation 30s/60s、
  testWorkerDatabase 30s、testInfraLock 30s、0023 60s、seed/testCleanup 60s），注释明确
  这是确定性队列的 hang protection，不参与排序。实测修复前 full `@exam/db` 4 次中 1 次
  击穿 5s；修复后连续 5/5 PASS。
- **没有掩盖**：未用 retry / skip / quarantine；未仅调 timeout 掩盖竞态（竞态已由确定性
  barrier / 统一锁根除）；无固定 sleep 作为排序机制（`pg_locks` 轮询是 bounded polling，
  谓词必须被真实锁状态满足才继续）。

---

### CASE-2026-07-30-RATELIMIT — #231 auth route E2E rate-limit amplification test（测试所有权与成本不匹配）

#### Status

```text
CASE_STATE = REPAIRED
CASE_CREATED_AT = 2026-07-30
CASE_LAST_REVIEWED_AT = 2026-10-12T09:48:53+08:00

NONDETERMINISTIC = YES（历史——CI 下偶发 5000ms 超时）
ROOT_CAUSE_CONFIDENCE = CORRELATED（成本/预算算术 + 所有权分析；修复后无复发记录；
  未做受控失败复现，故不标 CAUSALLY_PROVEN）
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED（REC-2026-10-12-002 降级，原为
  PROVEN_UNRELATED；原依据是"测试所有权/成本不匹配、非产品回归"，属产品回归论证而非
  对当时改动的排除；记录中未识别当时候选改动，也无受控复现；根因置信保持 CORRELATED）
AGGREGATION_CONFIDENCE = SUPPORTED
```

```text
CASE_LAST_MODIFICATION = CURRENT_CHANGE_CAUSALITY_RECLASSIFIED（REC-2026-10-12-002）
CASE_LAST_MODIFICATION_RESULT = PASS
PREVIOUS_CLASSIFICATION = CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（测试所有权/成本
  问题，非产品回归）
CURRENT_CLASSIFICATION = CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED
EVIDENCE = ① 原依据回答的是"缺陷位于测试所有权而非产品代码"（ROOT_CAUSE 轴），不是
  "与当时改动无关"（CURRENT_CHANGE_CAUSALITY 轴）；② 记录未识别失败当时的候选改动，
  也没有把改动移除/重现的对照；③ 根因置信本身为 CORRELATED（未做受控失败复现）
CLASSIFICATION_CHANGE_REASON = 该轴的原值把产品回归论证当成改动排除；两轴必须分开。
  本 case 的 CORRELATED 根因与 SUPPORTED 聚合保持不变——修复机制（测试所有权迁移）仍然
  成立，但"与当时改动无关"从未被证明
REVIEWED_AT = 2026-10-12T10:24:59+08:00
```

- **现象**：`apps/api/src/routes/auth.test.ts` 的 `APP_MODE=e2e does not rate-limit
  repeated login requests` 用例在 CI 下偶发 5000ms 超时。该用例连续 12 次走完整登录流程
  （argon2 密码哈希 + audit 写入），证明一个 **plugin-level** 的 E2E bypass。
- **真正的问题（测试所有权 / 成本不匹配）**：该 proof 的被测对象是 `rateLimitPlugin`
  （`APP_MODE=e2e` 时整插件不注册），但证明手段是 auth route 的 12 次端到端登录放大。
  登录路由拥有 route-level `rateLimit.max = 10`，因此第 11 次请求才会越过登录路由自身的
  限制——既不能机械地把 12 次减到 2 次或 5 次（那样测的是 route limiter，不是 E2E
  bypass），又用 12 × 完整认证流程证明一个不依赖数据库的 plugin 行为，测试所有权和
  成本严重不匹配。issue #231 原始修复方案（"12 → 5"）的根因描述（"argon2 400ms × 12
  ≈ 4800ms"）也不准确：放大来自 12 次完整认证（哈希 + audit），不是单纯哈希。
- **修复（测试所有权迁移，非 timeout/skip/retry）**：
  1. **删除** auth route 的 `APP_MODE=e2e does not rate-limit repeated login requests`
     用例。该 proof 不属于 auth route 测试。
  2. **保留** auth route 的 `non-e2e mode enforces the route-level login limiter` 用例
     不动——它继续负责证明真实登录路由的 route-level `max=10` 行为（10 次成功 + 第 11
     次 429，不减少 10+1 边界）。
  3. **扩展** `apps/api/src/plugins/rateLimit.test.ts`：每个测试创建并关闭自己的 Fastify
     app（`buildRateLimitProbeApp()` + `finally { app.close() }` + `afterEach` unstub env
     + reset runtime config），避免 runtime config 缓存与请求计数跨测试泄漏。新增 E2E
     bypass proof：route `max=1` 时第 2 次请求仍返回 200（route `max=1` 下，第 2 次请求
     就是 limiter 是否生效的完整边界证明）。
- **没有掩盖问题**：未使用单测试 timeout、未 skip、未 retry。生产 rate-limit 与 auth
  行为未改动。plugin-level E2E bypass proof 迁移到一个无数据库、无 argon2、无 audit 的
  纯 plugin 测试，证明成本与被测对象匹配。
- **未误套其他条目**：本修复不涉及旧文档中 legacy-role 测试的"6 轮 login + audit
  polling"放大（那是 BUG-FLAKE-001 auth amplification 子类的另一用例），也未声称根因
  是固定的"argon2 400ms"。

---

### CASE-2026-09-28-PGSTAT — `testDbWorkerScoped.failurePath.test.ts` beforeAll 与 `pg_stat_activity` 后端退出可见性竞态（#648 P1-3 所有权证明；升级 → issue #650；已修复）

#### Status

```text
CASE_STATE = REPAIRED（2026-09-28，issue #650）
CASE_CREATED_AT = 2026-09-28（同日 3 次同签名 → 升级）
CASE_LAST_REVIEWED_AT = 2026-10-12T09:48:53+08:00

NONDETERMINISTIC = YES
ROOT_CAUSE_CONFIDENCE = CAUSALLY_PROVEN（单文件 ~12% 复现率 + 修复后 30 连跑归零 +
  阴性对照变异在截止时刻失败）
CURRENT_CHANGE_CAUSALITY = PROVEN_RELATED（REC-2026-10-12-002 更正，原为
  PROVEN_UNRELATED：失败点 `expect(await otherBackendCount()).toBe(0)`
  （`beforeAll`）随 #648 的提交 2e2bc4e2 新增该文件进入仓库——`--diff-filter=A` 与
  该 revision 的文件内容均可核；触发机制（客户端 close 完成 ≠ 服务端 backend 行即时
  消失）是 PostgreSQL/postgres.js 既有语义。限定：改动经其新增测试预言机成为该次失败
  的必要条件，产品代码无缺陷）
AGGREGATION_CONFIDENCE = CAUSALLY_PROVEN

AGGREGATION_BASIS = 同一可复现生命周期竞态：客户端 close 完成 ≠ 服务端 backend 行即时
  消失；同日 3 次同签名（全套件 1 + 单文件 2/17）
```

#### 本轮再分类记录（REC-2026-10-12-002）

```text
CASE_LAST_MODIFICATION = CURRENT_CHANGE_CAUSALITY_RECLASSIFIED（PROVEN_UNRELATED →
  PROVEN_RELATED）
CASE_LAST_MODIFICATION_RESULT = PASS
PREVIOUS_CLASSIFICATION = CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（"退出可见性窗口
  属 PostgreSQL/postgres.js 语义，非 #648 改动引入"）
CURRENT_CLASSIFICATION = CURRENT_CHANGE_CAUSALITY = PROVEN_RELATED（限定：改动经其
  新增的测试预言机成为该次失败的必要条件；机制本身是 PostgreSQL/postgres.js 既有语义，
  产品代码无缺陷）
EVIDENCE = ① `git log --diff-filter=A -- packages/db/src/testDbWorkerScoped.failurePath.test.ts`
  只有 2e2bc4e2（"test(db): release worker handle when the reset boundary throws (#648)"，
  2026-09-28T15:24+08:00，178 行新增）与 4ebe50ae（"#650"，同日 23:30 修复）；
  ② 该 revision 的文件内容中 `beforeAll` 直接断言 `expect(await otherBackendCount())
  .toBe(0)`（该文件 :95 / :120），即失败点本身随 #648 进入仓库；
  ③ 本 case 记录的失败点为 `beforeAll otherBackendCount 瞬时读到 1（期望 0）`，与该断言
  逐字对应；④ 修复提交 4ebe50ae 把两处瞬时断言替换为 bounded polling
  `waitForNoOtherBackends()`
CLASSIFICATION_CHANGE_REASON = 原表述把"触发机制属 PostgreSQL 语义"错误地外推为
  "该次失败与 #648 无关"。触发机制确实既存，但**失败点（过严的瞬时断言）是 #648 新增
  测试代码的一部分**，改动是必要条件的证明是可核的源码事实。这属于两轴混淆的更正，
  不改变本 case 的 ROOT_CAUSE_CONFIDENCE（CAUSALLY_PROVEN）与修复机制
REVIEWED_AT = 2026-10-12T10:24:59+08:00
```

#### 失败位置与错误（历史事实保全）

- 文件：`packages/db/src/testDbWorkerScoped.failurePath.test.ts:120`
- 用例：describe `getWorkerScopedTestDb — reset-boundary failure releases the handle
  (#648 P1-3)` 的 `beforeAll`（`predecessor.close()` + 阻断 trigger 安装之后的
  `expect(await otherBackendCount()).toBe(0)`）
- 调用：`pnpm --filter @exam/db test`（全套件）与单文件 `vitest run`。

```text
FAIL  src/testDbWorkerScoped.failurePath.test.ts > getWorkerScopedTestDb — reset-boundary failure releases the handle (#648 P1-3)
AssertionError: expected 1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 1

 ❯ src/testDbWorkerScoped.failurePath.test.ts:120:41
    120|       expect(await otherBackendCount()).toBe(0);
```

全套件形态：`Test Files 1 failed | 58 passed (59)`，`Tests 705 passed | 2 skipped
(707)`，失败文件 1757ms（其余两用例 skipped 为 beforeAll 失败的次生）。

#### 出现场景

- 基线：master `a4a813fa`（#649 合并后）；post-#649 `@exam/db` 性能归因测量会话（报告在
  `research/db-test-post-649-perf` 分支），WSL2 + 本地 docker PG 18.4，warm 槽位
  `exam_test_db_w1..w3`。
- 触发：全套件 1 次（基线 N=5 的 test-5）+ 单文件 17 次中 2 次（~12%）——同日共 3 次
  同签名。每次失败后立即单文件复跑 2/2 PASS；同会话其余全部全套件运行 707/707 全绿。

#### 根因（CAUSALLY_PROVEN，含 provenance 限定）

- 客户端 close 正确（`postgres.js` `close()` 在发出 Terminate、关闭 socket 后即返回）；
  服务端 backend 进程异步退出，其 `pg_stat_activity` 行要等进程真正退出才消失——瞬时
  读取撞上这个毫秒级退出可见性窗口。不是真实 pool 泄漏（#648 P1-3 的泄漏形态是
  backend 永久存活、count 永不归零）。
- **观测归属（provenance）**：beforeAll 复现路径只支持较弱陈述——唯一一次性槽位上一条
  刚 close 的连接，在客户端 close 完成后仍可能在 `pg_stat_activity` 中短暂可见；未做
  PID 归因，瞬时观测到的 backend 无法区分是 predecessor 池连接还是随后的短命 DDL 连接，
  故不表述为「predecessor 的 backend 仍可见」。根因类别不受影响：客户端连接拆除 ≠
  服务端 backend 可观测性即时消失。更强的直接 #648 P1-3 证明是第二个所有权断言：
  reset 抛错 → adapter 关闭自持 handle → backend count 最终必须恰好归 0。
- 复现条件是本文件自身的 DDL/连接 churn（每文件执行都对全新一次性槽位
  `exam_test_db_wfailpath<rand>` 走完整 CREATE DATABASE + migrate + 多次连接开/关），
  不是套件并行（单文件也 ~12% 复现；负载只放大退出滞后窗口）。

#### 已知不是的原因

- 不是 adapter 泄漏 handle（#648 P1-3 泄漏模式是 backend **永久**存活 → 确定性
  count≥1；本 flake 瞬态、复跑即过，所有权不变量成立）。
- 不是 trigger/DDL 冲突：失败点在 trigger 安装成功之后的 count 断言，且
  `rejects.toThrow(/test_block_reset/)` 用例未及执行。
- 不是全套件负载限定：单文件复现排除调度/争用为必要条件。

#### 修复（2026-09-28，issue #650）

- **修复机制（测试预言机，仅测试文件）**：`testDbWorkerScoped.failurePath.test.ts` 内
  新增**文件局部** `waitForNoOtherBackends()`，替换 `beforeAll` 与 it 体内两处瞬时
  `expect(await otherBackendCount()).toBe(0)` 断言：立即查询 `otherBackendCount()`，为
  0 立即通过；否则以 50ms 间隔轮询**真实** `pg_stat_activity` 状态，谓词保持精确为
  `otherBackendCount() === 0`；到 2000ms 截止仍非 0 则响亮失败，错误信息携带槽名与最后
  观测 count。沿用 `testInfraLock.test.ts` `pollAdvisoryLocks` 的 bounded-polling 先例
  （谓词必须被真实状态满足才继续，无固定 sleep 充当排序 oracle）。截止 2000ms / 间隔
  50ms：观测到的退出滞后为毫秒级（#650 仅在 count 查询紧跟 close ~1 个 round-trip 时
  命中），2s 高出真实窗口数个量级，同时真实泄漏仍在 2s 内快速响亮失败——远在未改动的
  30s hook/test 预算之内。30s hook/test 超时未动，测试文件外的任何生产/测试基建代码
  未动。
- **为什么不是 retry / sleep 掩盖**：最终谓词不变（仍是 count===0，不弱化为 `<=1`、
  不忽略 PID）；轮询读的是真实服务端状态，没有任何固定 sleep 充当排序保证；失败仍响亮
  （到截止即抛错）。反掩盖阴性对照已做：临时绕过 `testDb.ts` 失败路径的
  `handle.close()`（模拟真实泄漏）→ 所有权用例恰在 settle 截止失败
  （`otherBackendCount=1`，2000ms）→ 完整还原、未提交该变异。结构论证：瞬态退出滞后 →
  最终归零 → PASS；真实泄漏（max:1 pool 未关闭）→ count 恒 ≥1 → 到截止 → FAIL。
- **验证**：修复后单文件 `vitest run src/testDbWorkerScoped.failurePath.test.ts` 连续
  30 次（阴性对照前后各 15 次）全绿、0 失败（修复前同命令 17 跑 2 败）；命中率归零。
  全套件与静态门禁见该 issue closeout。

#### 后续动作

无（已修复并经阴性对照验证证明力不变）。若 settle 截止在无泄漏证据下反复到期触发失败，
按 issue #650 的既定处置停止并调查真实泄漏，不加大截止时间。

---

### CASE-2026-09-24-MOBILE-RACE — `getByText(...).first()` 命中 CSS 隐藏的 mobile 卡片（#601 Phase F 全量 E2E run4；已修复）

#### Status

```text
CASE_STATE = REPAIRED
CASE_CREATED_AT = 2026-09-24
CASE_LAST_REVIEWED_AT = 2026-10-12T09:48:53+08:00

NONDETERMINISTIC = YES（4 轮全量 2 过 2 败的双峰行为）
ROOT_CAUSE_CONFIDENCE = CAUSALLY_PROVEN（机制由 DOM 结构 + 竞态窗口分析确立；
  断言修复后带永久回归）
CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（CONTROLLED_EXCLUSION：失败表达式
  `getByText(...).first()` 是改动前的既有代码——改动自身 diff 把它作为 `-` 行替换为
  role 断言；机制在断言策略（按 DOM 顺序命中 CSS 隐藏卡片）而非 #601 改动主题）
AGGREGATION_CONFIDENCE = CAUSALLY_PROVEN
```

**失败位置**：`apps/e2e/e2e/admin-flow.spec.ts`（:210）；调用 `bash scripts/e2e/run.sh`
（全量，2 shard）。

```text
Error: expect(locator).toBeVisible() failed
Locator: getByText('E2E-Enroll-1790249744976').first()
32 × locator resolved to <div data-field-id="name" class="min-w-0 break-words">…</div>
   - unexpected value "hidden"
```

- **根因（非确定性来源）**：`ExamDetailPage` 报考区在 `DataTableShell` 内同时渲染
  desktop 表格与 mobile 卡片列表（`ResponsiveRepresentation` 的 mobile region 在 DOM 中
  位于 desktop 之前、由 `lg:hidden` 隐藏）。断言用 `getByText(name).first()` 依赖"提交
  后选择对话框关闭动画窗口内 refetch 先落地"的竞态：窗口内 first 命中对话框里尚存的
  可见文本 → 通过；refetch 晚于对话框卸载 → first 永久落在隐藏 mobile 卡片 → 失败。
  宿主负载决定窗口开闭，故 4 轮全量 2 过 2 败。
- **修复**：断言改为 `getByRole("row", { name })`（role 引擎默认排除 hidden 元素，且
  mobile 卡片无 row role），并保留移除后的 `toHaveCount(0)` 双表示计数。
- **后续动作**：全量 E2E 复跑验证；修复带永久回归（E2E 断言），无需额外跟踪。

> 同一条 v1 条目还包含另外两项，已拆分：ExamEditPage 题目列表分页缺陷（确定性产品
> 缺陷 → Non-Flake 段）、run5 `ERR_NETWORK_CHANGED`（→ OBS-2026-09-24-002）。

---

## Unresolved Occurrence Ledger（未解决的发生记录账本）

以下 occurrence 均未建立因果证明的根因。事实核心不可改写；`CURRENT_INTERPRETATION`
为 2026-10-12 调解后的当前理解。

### OBS-2026-06-20-001 — misconduct flag 测试在 `-t` 全文件运行时偶发失败（第 1 次）

```text
OBSERVED_AT = 2026-06-20（无时刻记录）
GIT_SHA = UNKNOWN
BRANCH = feat/p2c-j4-misconduct-flag（P2C-J4 /review 修复阶段）
COMMAND = pnpm --filter @exam/api test -- src/routes/attempts/admin-misconduct.test.ts -t "misconduct"
EXECUTION_TOPOLOGY = -t 过滤命中整个 misconduct describe，连带执行单文件内 528 个用例（当时共享 exam_test PG schema）
FAILED_FILE = apps/api/src/routes/attempts/admin-misconduct.test.ts
FAILED_TEST = POST /api/admin/attempts/:attemptId/misconduct describe 块内（非固定某一用例）
FAILURE_PHASE = UNKNOWN
FAILURE_CLASS = timeout / DB 争用错误（多数表现为某用例 timeout 或 DB 争用错误）
ERROR = Tests  1 failed | 527 passed (528)
ASSERTION_FAILURE = NO（多数为 timeout）
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = 第二次同代码运行即 528 green
DIFF_RELATION = 当时正在做 /review 修复（迁移末尾换行 + 补 403 测试）
TRACE_AVAILABLE = NO
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = 与 2026-06-20 J3 beyond-close flake 同一家族：-t 过滤
  连跑整文件触发跨用例 DB 状态泄漏/资源争用（BUG-FLAKE-002 / BUG-FLAKE-004）
CURRENT_INTERPRETATION = 时代一致假设：当时（2026-06-21 隔离修复之前）共享 schema
  状态泄漏机制活跃；单条归因未逐条证明
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED（403 测试 + 迁移末尾换行无产生间歇
  失败的机制路径，但按 STEP 7 不写成 PROVEN）
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
```

已知不是的原因（v1 记录）：403 测试本身 bug（单跑全文件通过）；迁移 0003（ADD
COLUMN，additive）；flagMisconduct 逻辑缺陷。缓解：无单点缓解；注：`apps/api` 串行
默认不阻止 `-t` 过滤导致的同文件跨用例争用，此类由每文件/每槽位隔离域覆盖。

### OBS-2026-06-20-002 — 同上（第 2 次）

```text
OBSERVED_AT = 2026-06-20（J4 rebase 后；无时刻记录）
GIT_SHA = UNKNOWN
COMMAND = 同 OBS-2026-06-20-001
FAILED_FILE = 同上
FAILED_TEST = 不固定
FAILURE_CLASS = 同上（2/528 失败）
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = 重跑 528 green
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME / CURRENT_INTERPRETATION / CAUSALITY / CONFIDENCE = 同
  OBS-2026-06-20-001
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
```

### OBS-2026-07-25-001 — `ea-lock-order.test.ts` 100 轮 contention 循环在全量 coverage 下超时（BUG-FLAKE-006 第 1 次）

```text
OBSERVED_AT = 2026-07-25（P5-N1 review 修复阶段；无时刻记录）
GIT_SHA = UNKNOWN
BRANCH = feat/p5-n1-notification-inbox
COMMAND = pnpm verify（TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 + coverage instrumentation）
EXECUTION_TOPOLOGY = full turbo coverage
FAILED_FILE = apps/api/tests/concurrency/ea-lock-order.test.ts
FAILED_TEST = repaired contention schedule is stable across 100 consecutive runs
FAILURE_PHASE = it 体
FAILURE_CLASS = testTimeout 5000ms
ERROR = Error: Test timed out in 5000ms. ❯ tests/concurrency/ea-lock-order.test.ts:292:3
ASSERTION_FAILURE = NO
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = 同代码单文件 npx vitest run tests/concurrency/ea-lock-order.test.ts
  --testTimeout=15000 → 3/3 PASS（100 次循环 1251ms）
DIFF_RELATION = P5-N1 通知改动（notifications 模块、contracts、文档）与 ea-lock-order 无交集
TRACE_AVAILABLE = NO
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = 属 BUG-FLAKE-001 家族：coverage 插桩 + 4 worker 并行
  下累积延迟击穿 5s
CURRENT_INTERPRETATION = BUG-FLAKE-006（本轮新建 PROVISIONAL case）；机制 HYPOTHESIS；
  不再自动归入 BUG-FLAKE-001（其机制已于 2026-08-26 修复）
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = BUG-FLAKE-006
HISTORICAL_TEST_IDENTITY_STATUS = SUPERSEDED（REC-2026-10-12-002）——`FAILED_TEST` 与
  `ERROR` 所指的用例在 current source 中已不存在（`e60a7edd` / PR #721，2026-10-07
  整体替换该文件）。本 occurrence 的失败事实、错误文本与原始解释不变；
  `REPRODUCER = NONE`，本行以下字段不得被读作"当前可复现"。
```

已知不是的原因（v1 记录）：P5-N1 改动引入；锁序逻辑回归（standalone 100 轮稳定）；
PG 连接池耗尽（错误是 timeout）。v1 后续动作明确不采用单点 positional timeout。

### OBS-2026-08-31-001 — 并行跑 api + web 两个独立套件引发宿主负载型 5s 超时（#301 deletion audit 观察）

```text
OBSERVED_AT = 2026-08-31（无时刻记录）
GIT_SHA = UNKNOWN
COMMAND = pnpm --filter @exam/api test 与 pnpm --filter @exam/web test 作为两个独立
  pnpm 进程同时在后台运行
EXECUTION_TOPOLOGY = 两 vitest 进程并发，同一 WSL2 8-core 主机、同一 PG 容器
FAILED_FILE = apps/api/src/routes/auth.test.ts:126；apps/api/src/scripts/backup-evidence.test.ts:303/334；
  apps/api/tests/concurrency/ea-lock-order.test.ts:292；apps/web/src/pages/admin/QuestionPage.test.tsx:153
FAILED_TEST = non-e2e mode enforces the route-level login limiter（5 轮 login + audit）；
  --size-bytes reject/accept 两用例（CLI + ledger 写入）；repaired contention schedule…100 runs；
  clears filters and keeps the page shell visible during table reload（debounce + 异步 reload）
FAILURE_PHASE = it 体
FAILURE_CLASS = testTimeout 5000ms ×5（api 4 + web 1），无断言失败
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = 改为串行重跑（web 完成后跑 api）：web 123 文件 / 1706 测试全过、
  api 184 文件 / 2460 passed + 12 skipped 全过，两次 EXIT=0；唯一变量是去掉两套件并发
DIFF_RELATION = 与 rich-content 相关改动文件无交集
TRACE_AVAILABLE = NO
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = 与 BUG-FLAKE-001 的 I/O contention / WSL2
  host-performance 家族同机制（见 2026-07-20 复发记录）——两进程占满 CPU，操作方式
  引入的负载，非代码回归
CURRENT_INTERPRETATION = 并发双套件这一负载形态与失败的关联有受控对照支持（去掉并发
  即全过，n=1）；具体资源机制（CPU 调度 vs I/O vs DB）未判别 → HYPOTHESIS；
  不归入 BUG-FLAKE-001（其机制已修复，且本 occurrence 晚于修复）
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（CONTROLLED_EXCLUSION：唯一变量是去掉
  两套件并发（并发→5 处超时；串行→两次 EXIT=0 全过），操纵的变量是进程拓扑而非 diff；
  n=1。受害面与 rich-content 改动零交集属附带观察，不作为准入依据）
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = UNASSIGNED（AGGREGATION_BASIS = NONE；与其它宿主负载签名 occurrence 仅
  签名级相似，未建 case）
```

缓解（v1 记录，仍有效）：开发机重套件串行执行；CI 各 job 独立 runner 不受影响。

### OBS-2026-09-19-001 — `ea-lock-order.test.ts` 纯 turbo 负载下超时（BUG-FLAKE-006 第 2 次）

```text
OBSERVED_AT = 2026-09-19（#550 corrective-1 campaign 门禁；无时刻记录）
GIT_SHA = UNKNOWN
COMMAND = pnpm test（plain turbo 无 coverage）
EXECUTION_TOPOLOGY = turbo 15 包并行；同机数分钟前刚结束 95-min production-mode soak 测量
FAILED_FILE = apps/api/tests/concurrency/ea-lock-order.test.ts
FAILED_TEST = 同 OBS-2026-07-25-001
FAILURE_CLASS = testTimeout 5000ms
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = standalone 立即 3/3 PASS（tests 1.8s）；全量 pnpm test 复跑 EXIT=0
  （2,813 passed / 12 skipped）
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = 与 2026-08-31 条目同机制（宿主负载型，操作背景引入）
CURRENT_INTERPRETATION = BUG-FLAKE-006 第 2 次；负载形态与第 1 次不同（无 coverage
  插桩、有 soak 余波）——这正是聚合仅 PROVISIONAL 的原因
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = BUG-FLAKE-006
HISTORICAL_TEST_IDENTITY_STATUS = SUPERSEDED（REC-2026-10-12-002）——`FAILED_TEST`
  （同 OBS-2026-07-25-001）所指用例在 current source 中已不存在（`e60a7edd` / PR #721）。
  失败事实与原始解释不变；`REPRODUCER = NONE`。
```

### OBS-2026-09-24-001 — assignment-affordances Story C 单次 transport 失败（#601 Phase F E2E 全量）

```text
OBSERVED_AT = 2026-09-24（无时刻记录）
GIT_SHA = UNKNOWN
COMMAND = bash scripts/e2e/run.sh（全量，2 shard，宿主 dev server + Playwright）
EXECUTION_TOPOLOGY = 2 shard 并行；同 shard 并行跑数据视图夹具
FAILED_FILE = apps/e2e/e2e/assignment-affordances.spec.ts
FAILED_TEST = Story C: a course beyond the first 100 is reachable via catalog search and
  assignable (issue 548 corrective)
FAILURE_PHASE = 断言等待窗口
FAILURE_CLASS = locator 断言失败（element not found）+ 两条客户端 toast
ERROR = expect(locator).toContainText(expected) failed; Locator: getByRole('dialog');
  Expected substring: "管理「E2E548教师1790246061073-fitl-c」的授课课程";
  Error: element(s) not found；页面快照同时显示 toast「加载课程分配失败，请稍后重试」
  与「网络连接失败，请稍后重试」
ASSERTION_FAILURE = YES
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = 同代码聚焦复跑 run.sh data-view-1 table-contract-2
  assignment-affordances 两个 shard 全绿
DIFF_RELATION = #601 Phase F 与用户/课程分配数据路径零交集
TRACE_AVAILABLE = 页面快照（v1 记录）
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = refreshAssignments() 读 GET /api/admin/users/:id/
  course-assignments?status=all 失败按契约关对话框 + toast；第二条 toast 来自 lib/api.ts
  errors.network 分支——fetch 抛非 ApiError/非 AbortError 的 transport 错误（连接被拒/
  重置），非 4xx/5xx 语义失败。用例失败前刚连续创建 101 门课程，宿主 API 进程在连接层
  出现一次瞬时失败
CURRENT_INTERPRETATION = 同 v1（transport 层瞬时失败假设有 toast 分支证据支持）；根因
  （连接池/backlog/宿主网络）未判别
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED（REC-2026-10-12-002 降级，原为
  PROVEN_UNRELATED：原依据"路由存在性、同轮无 5xx、Phase F 无因果路径"不构成排除——
  该次失败是 transport 层瞬时失败（连接被拒/重置），无 5xx 与路由存在是该类失败的
  预期表现，不能排除同一 run 内改动经调度/资源的影响；记录亦无受控复现）
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = UNASSIGNED（AGGREGATION_BASIS = NONE）
```

已知不是的原因（v1 记录）：路由缺失（`teacherAssignments.admin.ts` 注册）；服务端 5xx
（同轮 API 日志无）；#601 Phase F 因果路径。后续动作：复发 ≥3 次升级并调查宿主 API 并行
shard 下的连接接受行为，而不是在用例侧加等待。

### OBS-2026-09-24-002 — run5 `recovery-operations-a11y.spec.ts:80` `ERR_NETWORK_CHANGED`（独立环境事件）

```text
OBSERVED_AT = 2026-09-24 run5（无时刻记录）
COMMAND = bash scripts/e2e/run.sh（全量，2 shard）
EXECUTION_TOPOLOGY = shard 2；2 例未执行为 serial 级联
FAILED_FILE = apps/e2e/e2e/recovery-operations-a11y.spec.ts
FAILED_TEST = :80 用例（v1 未记录用例名）
FAILURE_CLASS = page.goto transport 错误
ERROR = page.goto: net::ERR_NETWORK_CHANGED at http://localhost:3101/login
ASSERTION_FAILURE = NO
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = 同代码复跑 run6 两 shard 全绿
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = Chromium 网络栈对宿主网络接口变化的报错，非应用代码
  可达路径（WSL2 网络瞬时抖动）
CURRENT_INTERPRETATION = 同 v1（HYPOTHESIS：WSL2 网络瞬时变化；无进一步判别证据）
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（CONTROLLED_EXCLUSION：`ERR_NETWORK_CHANGED`
  是 Chromium 网络栈在宿主网络接口变化时产生的错误码，应用代码无法触达该路径——这是
  错误类别的机制事实，不是"受害文件未被改动"一类的文件级论证）
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = UNASSIGNED（AGGREGATION_BASIS = NONE）
```

处置（v1 记录）：不设 timeout/skip/retry。

### OBS-2026-09-26-001 — `repository.test.ts` tenant-isolation 3× 5s timeout（并发 docker build 负载下）

```text
OBSERVED_AT = 2026-09-26（无时刻记录）
BRANCH = cleanup/634-package-script-surface（本次仅 docs/** 改动）
COMMAND = pnpm test:integration（@exam/db#test:integration）；宿主同时跑 docker build
EXECUTION_TOPOLOGY = @exam/db 文件并行 + 宿主额外 docker build 负载
FAILED_FILE = packages/db/src/repository/repository.test.ts:57 / :86 / :120
FAILED_TEST = keeps tenant-scoped course queries isolated；updates and deletes tenant
  records without crossing tenant boundaries；Admin repository ops are scoped to
  organizationId, not targetOrganizationId (Phase 1 single-tenant)
FAILURE_CLASS = testTimeout 5000ms ×3，无断言失败；日志同窗口可见 DROP DATABASE 的
  drop cascades NOTICE
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = 单跑 vitest run src/repository/repository.test.ts → 10/10 PASS
  （2.83s）；宿主安静后整套 pnpm test:integration 重跑 EXIT=0（@exam/db 671/671）
DIFF_RELATION = 634 文档清理（仅 docs/**）
TRACE_AVAILABLE = NO
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = BUG-FLAKE-001 physical-DB-lifecycle / DDL 争用家族：
  文件并行 + 每文件 schema/database 生命周期在宿主 I/O 争用下击穿 5s；额外争用来自
  并发 docker build
CURRENT_INTERPRETATION = 机制为 HYPOTHESIS：宿主 I/O 争用与失败的关联有对照（安静重跑
  全过），但未与其它机制判别；不归入 BUG-FLAKE-001（本 occurrence 晚于其机制修复，
  且 DDL 慢持有者结构属 lane 已知事实而非本条因果证明）
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（CONTROLLED_EXCLUSION：该分支为纯文档改动
  （`cleanup/634-package-script-surface`，仅 `docs/**`），不改变测试数量、worker 占用、
  模块初始化、全局 setup 或 DB 负载——即 STEP 7 列举的全部间接通道；不属于"受害文件
  未被改动"式的文件级论证）
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = UNASSIGNED（AGGREGATION_BASIS = NONE）
```

已知不是的原因（v1 记录）：634 文档清理；repository 语义回归；断言失败。缓解：无代码
改动；重套件不与 docker build 等重负载并行。后续动作：若在无额外宿主负载下同位置复发
≥3 次，升级并评估单键 DDL 临界区在该文件的持有/排队时长与 5s 预算耦合。

### OBS-2026-09-26-002 — `admin-nav-continuity.spec.ts` NAV-6 折叠导航当前项在 4-shard 下未收敛

```text
OBSERVED_AT = 2026-09-26（无时刻记录）
BRANCH = cleanup/634-package-script-surface
COMMAND = E2E_WORKERS=4 bash scripts/e2e/run.sh（CI e2e job 4-shard 本地等价）
EXECUTION_TOPOLOGY = 4 shard 并行；宿主同时 4 个 shard API server + 4 个 worker DB
FAILED_FILE = apps/e2e/e2e/admin-nav-continuity.spec.ts:542（断言 :550）
FAILED_TEST = NAV continuity contract (#494) > NAV-6: collapsed rail keeps the current
  destination discoverable at 1100x800
FAILURE_PHASE = 自动重试断言未在 expect 超时内收敛
FAILURE_CLASS = toHaveCount(1) 断言失败（aria-current="page" 未出现）
AUTHORITATIVE_RUN_RESULT = FAIL（shard 1/4 = 1 failed / 42 passed；其余 3 shard 通过）
RERUN_EVIDENCE = ① 该 spec 单独复跑（2 shard 模式）通过；② 同参数 4-shard 全量重跑
  166/166 通过（43/41/41/41），exit 0
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = 4 shard 负载下 /admin/settings 侧栏 aria-current 标记
  在 5s expect 预算内未收敛（几何/导航态收敛慢于预算）；非确定性
CURRENT_INTERPRETATION = 同 v1，HYPOTHESIS；未判别是数据加载依赖（收敛路径）还是
  等待预算问题
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（CONTROLLED_EXCLUSION：该分支为纯文档改动
  （仅 `docs/**`），不改变测试数量、worker 占用、模块初始化、全局 setup 或 DB 负载，
  即不触达 STEP 7 列举的间接通道；"同类几何断言宿主与镜像栈均通过"属附带观察，不作为
  准入依据）
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = UNASSIGNED（AGGREGATION_BASIS = NONE）
```

后续动作（v1 记录）：4-shard 同位置复发 ≥3 次升级，并调查 1100px 断点处
current-destination 标记是否依赖数据加载完成。

### OBS-2026-09-27-001 — 首次 run-lease 事件中 `recoveryRepo.test.ts` 3 个失败（机制未观测）

```text
OBSERVED_AT = 2026-09-27（PR #643 closure 修复验证期间，head 4250aea7；无时刻记录）
COMMAND = pnpm --filter @exam/api run coverage + pnpm --filter @exam/web run coverage +
  pnpm --filter @exam/db run coverage 三进程并发（同一 docker-compose.dev PG）
EXECUTION_TOPOLOGY = 三个独立 pnpm/vitest 进程同时后台运行
FAILED_FILE = packages/db/src/repository/recoveryRepo.test.ts（3 个失败；文件耗时拉长到
  ~63s；同 run 的 testInfraLock.test.ts 3 个失败为 run-lease 契约行为，见
  RUN-LEASE-OP-MODE——非本 occurrence 范围）
FAILED_TEST = UNKNOWN（首次输出被过滤，v1 未记录用例名）
FAILURE_CLASS = UNKNOWN（错误片段未捕获）
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = ① 首次失败后立即单独重跑两个失败文件：96/96 全过（7.6s）；② 完整
  db coverage：55 文件 / 669 测试全过；③ 复现实验（同 commit 同操作模式三进程并发）
  中 recoveryRepo 3 失败未再出现
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = v1 原文："归入宿主负载型超时家族（见 2026-08-31 姊妹
  条目），机制未捕获到错误片段（首次输出被过滤），不作断言"
CURRENT_INTERPRETATION = ROOT_CAUSE_CONFIDENCE = UNKNOWN（v1 已谨慎不归类；本轮保持，
  且明确不并入任何"宿主负载家族"case）
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = UNKNOWN（错误片段缺失，无判别材料）
ROOT_CAUSE_CONFIDENCE = UNKNOWN
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = UNASSIGNED（AGGREGATION_BASIS = NONE）
```

### OBS-2026-10-03-001 — `ea-lock-order.test.ts` D5 门禁超时（BUG-FLAKE-006 第 3 次）

```text
OBSERVED_AT = 2026-10-03（#669 Phase D5 门禁；无时刻记录）
COMMAND = pnpm verify（coverage + API_TEST_MAX_WORKERS=4）
EXECUTION_TOPOLOGY = full turbo coverage，4 worker
FAILED_FILE = apps/api/tests/concurrency/ea-lock-order.test.ts
FAILED_TEST = 同 OBS-2026-07-25-001
FAILURE_CLASS = testTimeout 5000ms；错误与 2026-07-25 首登完全一致（@ :292）
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = standalone 立即 3/3 PASS（tests 1.5s）；全量 verify 复跑通过
DIFF_RELATION = D5 改动（Rich 静态读信任、KaTeX 证据、文档）无因果路径
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = 机制同前两条（coverage 插桩 + 并行负载），无代码改动
CURRENT_INTERPRETATION = BUG-FLAKE-006 第 3 次；触发 3+ 强制聚合复审（本轮已建案）
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = BUG-FLAKE-006
HISTORICAL_TEST_IDENTITY_STATUS = SUPERSEDED（REC-2026-10-12-002）——本 occurrence 是
  该签名的最后一次；其后的 `e60a7edd`（PR #721，2026-10-07）已把整个文件替换。
  失败事实与原始解释不变；`REPRODUCER = NONE`。
```

### OBS-2026-10-06-001 — `bootstrap-admin.test.ts` 单点 5s 超时（BUG-FLAKE-005 第 1 次；PR #717 / #716 验证期间）

```text
OBSERVED_AT = 2026-10-06（无时刻记录）
GIT_SHA = 219eafc5
BRANCH = PR #717（#716 test 收敛）
COMMAND = pnpm verify（.env.test.local 钉定 TEST_DB_ISOLATION=worker-database
  API_TEST_MAX_WORKERS=4，v8 coverage）
EXECUTION_TOPOLOGY = 216 文件 × 4 worker × coverage × 真实 PG；turbo 其余 15 任务
  缓存命中，仅 @exam/api#coverage 实跑（244s）
FAILED_FILE = src/scripts/bootstrap-admin.test.ts
FAILED_TEST = :449 "records the adapter source in the admin.bootstrap audit metadata…"
FAILURE_PHASE = it 体
FAILURE_CLASS = testTimeout 5000ms（vitest 默认）；无 assertion 错误、无 hook 级联；
  文件级 1 failed | 211 passed | 4 skipped (216)；测试级 1 failed | 2736 passed |
  11 skipped (2748)
AUTHORITATIVE_RUN_RESULT = FAIL（该次 verify run；后续同 head 全量重跑见 RERUN_EVIDENCE③）
RERUN_EVIDENCE = ① 同一 commit 裸 pnpm test（同 lane env）数分钟前 16/16 全绿
  （api 2737 passed | 11 skipped）；② 同 coverage lane 单文件复跑 20/20 PASS，受害
  用例实测 697ms（预算 14%）；③ 全量 pnpm verify 原样重跑 exit 0（16/16 + 9/9）
DIFF_RELATION = git diff b7d76ec5..HEAD -- apps/api/src/scripts/ 为空（PR #716 未触碰
  scripts/ 及其被测生产代码）
TRACE_AVAILABLE = NO
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = "根因：BUG-FLAKE-001 宿主负载 / I/O 争用家族的又一次
  漂移性单点超时……与本 PR 改动无因果"
CURRENT_INTERPRETATION = 事实（受害、拓扑、复跑、diff 检查）全部保留；"BUG-FLAKE-001
  家族根因"降级为 HYPOTHESIS 并移入 BUG-FLAKE-005；注意 #716 是测试收敛改动，
  调度级影响不能仅凭 diff 排除 → PLAUSIBLY_UNRELATED
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = BUG-FLAKE-005
```

### OBS-2026-10-07-001 — `bootstrap-admin.test.ts` 三用例 5s 超时（BUG-FLAKE-005 第 2 次；PR #735 / #733 R2）

```text
OBSERVED_AT = 2026-10-07（无时刻记录）
GIT_SHA = e0d94dda（R2 final head，PR #735）
COMMAND = pnpm verify（TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4，v8 coverage）
EXECUTION_TOPOLOGY = 220 文件 × 4 worker × coverage；仅 @exam/api#coverage 实跑失败
  （cache miss，hash 3b07b736d614d797）
FAILED_FILE = src/scripts/bootstrap-admin.test.ts
FAILED_TEST = :375（audit 插入失败的原子回滚）、:449（audit metadata——与 10-06 同一
  受害用例）、:493（首装竞态唯一胜者）
FAILURE_CLASS = testTimeout 5000ms ×3；无 assertion 错误、无 hook 级联；文件级
  1 failed | 215 passed | 4 skipped (220)；测试级 3 failed | 2749 passed | 11 skipped (2763)
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = ① 同 head 原样全量重跑 pnpm verify → exit 0（9/9；coverage 真实
  重跑 216 文件全过 / 2752 passed）；② 同 lane 单文件复跑 20/20 PASS，三受害用例
  651/631/653ms（各约 13%）；③ 同 head 非 coverage pnpm test EXIT=0（api 2742
  passed | 21 skipped）
DIFF_RELATION = git diff 209e36a2..e0d94dda 仅为 testDatabase.test.ts 模块 doclet 注释；
  与数分钟前同一 lane 实跑通过的 verify（head 209e36a2）生产代码完全一致
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = "根因：BUG-FLAKE-001 宿主负载 / I/O 争用家族的又一次
  漂移性单点超时……与 R2 改动无因果（①②③）"
CURRENT_INTERPRETATION = 事实保留；家族根因降级为 HYPOTHESIS（BUG-FLAKE-005）；受害面
  从 1 用例扩大为同文件 3 用例这一观察保留为签名事实
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED（diff 仅注释，且同 head 全量重跑过；
  仍不写 PROVEN——调度级影响不可凭 diff 排除）
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = BUG-FLAKE-005
```

v1 缓解记录：无代码改动；门禁按最终全量 PASS 记录、超时 run 在 #733 R2 review record
评论中如实记录。按 FORMAT_VERSION=2 口径：AUTHORITATIVE_RUN = FAIL 与后续全量 PASS
并存，均为证据。

### OBS-2026-10-07-002 — 裸 `pnpm test` 全量下 `slot-reuse-isolation.test.ts` 的 `afterAll` 吃穿 30s 钩子预算（#733 R4 施工前基线表征）

```text
OBSERVED_AT = 2026-10-07（无时刻记录）
GIT_SHA = 94dc798c（未改动的 master head；工作树干净）
COMMAND = pnpm test（非 coverage lane；全量 513.32s）
EXECUTION_TOPOLOGY = 212 文件 × 真实 PG 满负载（turbo 15 successful, 16 total，13
  cached，仅 @exam/api#test 实跑失败）
FAILED_FILE = apps/api/tests/slotReuse/slot-reuse-isolation.test.ts
FAILED_TEST = slot-reuse data isolation (sequential files, same pool slot)——失败点是
  该用例专用 slot 库的 afterAll 清理钩子（:152:3，文件内注释 "Dedicated slot DB is
  disposable evidence: drop it"），不是测试体
FAILURE_PHASE = afterAll hook
FAILURE_CLASS = hookTimeout 30000ms（"If this is a long-running hook, pass a timeout
  value … hookTimeout"）；无断言失败、无 hook 级联；文件级 1 failed | 212 passed |
  7 skipped (220)；测试级 2741 passed | 21 skipped (2762)
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = 同 head 未改动任何文件单文件复跑：EXIT=0，1 passed (1)，用例本体
  6183ms、整体 7.38s（远在 30s 内）
DIFF_RELATION = 无可归因改动（发生在任何候选改动之前的基线 run）
TRACE_AVAILABLE = NO
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = BUG-FLAKE-001 宿主编排 / I/O 争用家族在 afterAll
  维度的形态；2026-09-24 根因分析已指出 slot-reuse 的 DROP DATABASE 是 lane 上的慢
  持有者（实测 4.3–5.7s、历史 23.4s），队列深度会放大
CURRENT_INTERPRETATION = 机制 HYPOTHESIS：DROP DATABASE 慢持有 + 满负载排队与 30s
  预算的耦合有 lane 级结构性证据（慢持有者存在已被 2026-08-26/09-24 因果调查证明是
  lane 上的真实机制），但本条 occurrence 与该机制的逐条因果未取证；不归入 BUG-FLAKE-001
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（VACUOUS：该 run 发生在任何候选改动之前
  ——`GIT_SHA = 94dc798c` 为未改动的 master head 且工作树干净，不存在可比对的改动）
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = UNASSIGNED（AGGREGATION_BASIS = NONE）
```

v1 后续动作（保留）：若在未改动被测代码前提下再次出现（尤其串行/单文件下），或同签名
≥3 次，升级为正式跟踪条目；届时评估 slot-reuse 库清理路径是否应从"钩子内同步 DROP
DATABASE"改为可被负载隔离的实现（测试基础设施设计问题，不构成放宽断言的理由）。

### OBS-2026-10-08-001 — `bootstrap-admin.test.ts` 单点 5s 超时（BUG-FLAKE-005 第 3 次；#733 R5 → 升级建案）

```text
OBSERVED_AT = 2026-10-08（无时刻记录）
BRANCH = fix/733-r5-seed-dotenv-admission（R5 候选）
COMMAND = pnpm verify（TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4，v8 coverage）
EXECUTION_TOPOLOGY = 218 文件 × 4 worker × coverage；仅 @exam/api#coverage 实跑失败
FAILED_FILE = src/scripts/bootstrap-admin.test.ts
FAILED_TEST = resolveOrCreateDefaultOrganization > uses organizationDisplayName when
  supplied（受害用例继续在同文件内漂移，与前两次不重合）
FAILURE_CLASS = testTimeout 5000ms；无断言失败；文件级 1 failed | 217 passed | 4
  skipped (222)；测试级 1 failed | 2756 passed | 11 skipped (2768)
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = 同 lane 单文件定向复跑（同 head + coverage）：20/20 PASS（整体 8.88s）
DIFF_RELATION = R5 diff 未触碰 bootstrap-admin 及其被测脚本；本 workspace 无任何 .env
  文件，R5 移除的 seed 模块 dotenv side effect 在本地各 lane 本来就是 no-op
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = BUG-FLAKE-001 宿主负载 / I/O 争用家族漂移性单点超时，
  第 3 次落在同一文件；按登记规则 #3 升级 BUG-FLAKE-005
CURRENT_INTERPRETATION = 升级有效（3 次签名复发触发建案）；根因降级为 HYPOTHESIS，
  聚合 PROVISIONAL（见 BUG-FLAKE-005 案例记录）
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = BUG-FLAKE-005
```

### OBS-2026-10-08-002 — `admissions.durability.process.test.ts` 断言漂移（本签名第 1 次）

```text
OBSERVED_AT = 2026-10-08（同日第一次 pnpm verify，R5 候选分支；无时刻记录）
GIT_SHA = UNKNOWN（R5 候选 head）
COMMAND = pnpm verify（同上 lane）
EXECUTION_TOPOLOGY = 同上；2 个测试失败分布 2 个文件
FAILED_FILE = src/routes/admissions.durability.process.test.ts（另一失败文件因该次
  日志仅保留 tail 输出未能取证；同日第二次全量 run 中该文件群通过，唯一失败为
  bootstrap-admin → OBS-2026-10-08-001）
FAILED_TEST = D2 场景 "process B reported its own candidate"
FAILURE_PHASE = it 体断言
FAILURE_CLASS = 断言值漂移（非 timeout）
ERROR = expect(asRecord(qb2.json)).toMatchObject({ status: "waiting", position: 2 })
  （admissions.durability.process.test.ts:363-366 附近）
ASSERTION_FAILURE = YES
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = 同 head 同 lane 定向复跑 vitest run --coverage src/routes/
  admissions.durability.process.test.ts src/config/managedSeedAdmission.process.test.ts
  → 4/4 PASS（D1 2945ms / D2 5600ms / D3 2738ms）
DIFF_RELATION = R5 与 seed dotenv admission 无交互；本 workspace 无 .env，side effect
  本为 no-op；同 head 复跑全绿
TRACE_AVAILABLE = NO
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = 多真实 OS 进程（spawn API server ×2 + SIGKILL/restart）
  在 4-worker coverage 满负载下的调度/就绪时序抖动——BUG-FLAKE-001 宿主负载家族在
  process-boundary 断言维度的新受害点；process B 的观测时序在负载下滑出预期窗口
CURRENT_INTERPRETATION = 机制 HYPOTHESIS（负载下观测窗口漂移）；与 BUG-FLAKE-005
  不同失败类（断言漂移 vs 纯超时）、不同受害面，不聚合；不归入 BUG-FLAKE-001
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = UNASSIGNED（AGGREGATION_BASIS = NONE）
```

v1 后续动作（保留）：若再现（尤其同断言重复漂移），按规则升级，并评估该 process 测试的
观测窗口是否应按 2026-09-24 先例改为显式 convergence 谓词。

### OBS-2026-10-08-003 — turbo 并行下 `RichTextAnswerInput.readTrust.test.tsx` 单点 "editor not mounted"

```text
OBSERVED_AT = 2026-10-08（#741 验证期间；无时刻记录）
COMMAND = pnpm test（turbo 全量：api/db/web 并行）
EXECUTION_TOPOLOGY = turbo 多套件并行（同一工作树）
FAILED_FILE = apps/web/src/components/exam/RichTextAnswerInput.readTrust.test.tsx
FAILED_TEST = R1 positive control: a string on a plain-mode slot upgrades into the editor
FAILURE_PHASE = it 体
FAILURE_CLASS = Error: editor not mounted（Tiptap 挂载等待窗口内未收敛）；同套件其余
  2327 测试全过
ASSERTION_FAILURE = NO
AUTHORITATIVE_RUN_RESULT = FAIL
RERUN_EVIDENCE = 单文件隔离重跑 9/9 过；随后完整 web 套件串行重跑 165 文件 / 2328
  测试全过（EXIT=0）
DIFF_RELATION = #741 新增的 vite-env-file-admission.test.ts（子进程 vite build，~2s
  CPU 突发）是套件内新增负载之一，但失败签名与该测试无执行交集
TRACE_AVAILABLE = NO
NONDETERMINISM_CONFIRMED = YES
INTERPRETATION_AT_RECORD_TIME = 与 2026-08-31 宿主负载型家族同机制（turbo 并行多套件
  瞬时饱和，jsdom+Tiptap 挂载时序敏感用例最先受害）
CURRENT_INTERPRETATION = 机制 HYPOTHESIS（并行饱和 + 时序敏感用例）；与 OBS-2026-08-31-001
  仅签名级相似（同为多套件并行受害），未聚合；不归入 BUG-FLAKE-001。注意 #741 向套件
  新增了负载源，当前改动与失败的调度级关系并非零 → PLAUSIBLY_UNRELATED 而非更强
CURRENT_INTERPRETATION_UPDATED_AT = 2026-10-12T09:48:53+08:00
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = UNASSIGNED（AGGREGATION_BASIS = NONE）
```

v1 缓解（保留）：无代码改动（不调 timeout、不 skip）；重套件串行执行（既有约定）。
后续动作：若串行执行下同签名复发 ≥3 次，升级；届时再评估 build 探针测试的调度隔离。

---

### OBS-2026-10-23-001 — `recoveryRepo.test.ts` 单点 5s 超时（v0.0.10 发布审计本地 coverage；宿主 node 版本与 `.nvmrc` 偏差上下文）

```text
OBSERVED_AT = 2026-10-23T16:23+08:00（@exam/db vitest "Start at 16:21:23"，包耗时
  131.88s；turbo 全量 2m14.856s）
GIT_SHA = b9b7fabb2ac693c1995042f036d9842950637f7a（= origin/master，v0.0.10 发布审计
  基线）
BRANCH = master（无 tracked 未提交改动；ignored 本地 .env / .env.deploy /
  .env.test.local 在场，与本 run 失败无执行交集）
COMMAND = TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=4 pnpm coverage
EXECUTION_TOPOLOGY = 全 turbo coverage（15 tasks，7 cached）；@exam/db lane：
  worker-database 隔离，65 文件 / 748 用例；API_TEST_MAX_WORKERS=4 按根 coverage 编排
  传入（@exam/db vitest 实际 maxWorkers 未单独观测，不得推断）
FAILED_FILE = packages/db/src/repository/recoveryRepo.test.ts
FAILED_TEST = "recovery incident aggregate detail repository > fails closed when a
  candidate-focused incident's action link belongs to a different candidate"
  （it 定义于 :2458）
FAILURE_PHASE = it 体内（非钩子）
FAILURE_CLASS = testTimeout 5000ms
ERROR = Error: Test timed out in 5000ms.；Tests: 1 failed | 747 passed (748)；
  Test Files: 1 failed | 64 passed (65)
ASSERTION_FAILURE = NO
AUTHORITATIVE_RUN_RESULT = FAIL（v0.0.10 发布审计的本地验证 run；非 CI 门禁。同基线
  组合的 CI Package coverage 两次 SUCCESS，见 RERUN_EVIDENCE ③——两者并存，互不改写）
HOST_OR_RUNNER_CONTEXT = 本地 WSL2 开发机；失败 run 使用 node v24.15.0（nvm 默认），
  与 .nvmrc 24.22.1 存在宿主偏差（失败后才发现；24.22.1 本地已安装）。该偏差是否
  参与失败未知（见 ROOT_CAUSE_CONFIDENCE）
DB_ISOLATION_MODE = worker-database
TRACE_OR_LOG_LOCATION = 会话临时输出文件（ephemeral，不持久）；完整流被 `tail -30`
  截断，失败头（文件/用例/错误类）与统计尾部已逐字保全于本条目（STEP 9 保全范围
  以此为限）
RERUN_EVIDENCE =
  ① 同机同 node v24.15.0，单文件 -t 过滤重跑该用例：3 passed | 72 skipped（tests
     1.33s）——PASS；
  ② 切换 node v24.22.1（= .nvmrc）后整包 `TEST_DB_ISOLATION=worker-database pnpm
     coverage`（packages/db）：65 文件 / 748/748 全过，exit 0——PASS；
  ③ 同基线 GitHub Actions Package coverage 两次 SUCCESS：PR #807 head CI run
     39921646313（head 851f8f9f）、PR #808 head CI run 39925426281（head 1a364ace）
NONDETERMINISM_CONFIRMED = YES（同代码 FAIL + 同代码 PASS）
CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED（VACUOUS，准入依据 STEP 7(a)：失败 run
  位于干净工作树 b9b7fabb，无候选改动；纯诊断 run）
ROOT_CAUSE_CONFIDENCE = UNKNOWN
ROOT_CAUSE_HYPOTHESIS = 满负载 coverage lane 下该用例 5s 预算不充足（宿主调度/负载
  包络）；node 版本偏差是否参与未知——同一 v24.15.0 上单文件重跑通过（证据①）说明
  偏差本身不必然失败，但①②各自改变了执行拓扑与宿主状态，不构成对任何假设的判别
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = UNASSIGNED（AGGREGATION_BASIS = NONE——与 BUG-FLAKE-005 同 lane、同错误类
  但受害文件/受害身份不同；与 OBS-2026-09-27-001 同文件但失败形态不同且该次机制
  未观测；按 STEP 5 均不聚合）
OWNER_DISPOSITION = 仅登记（2026-10-23 Owner 指示）；诊断/修复推迟到 v0.0.10 发布
  流程结束后进行，本条目不触发任何测试或基础设施改动
```

---

### OBS-2026-10-23-002 — `admin-list-query-state.spec.ts` A04/A06 `waitForResponse` 15s 超时（PR #809 CI E2E shard 2/2；纯文档 diff 的 CI run）

```text
OBSERVED_AT = 2026-10-23T08:52Z 前后（CI run 39927162323，E2E shard 2/2；shard 内
  "10 passed (41.2s)"）
GIT_SHA = 5da7d6950e7d4eca21b198daf39d2498e6ecfec5（PR #809 head；唯一 diff =
  docs/standards/test-flakes.md +55 行 Markdown，产品代码与 b9b7fabb 完全一致）
BRANCH = docs/flake-obs-2026-10-23-recoveryrepo（PR #809）
COMMAND = CI `E2E (shard 2/2)` job（--shard=2/2，1 worker，13 tests）
EXECUTION_TOPOLOGY = GitHub Actions ubuntu-latest + 服务容器 postgres:18.4；E2E 在
  钉定 Playwright 容器镜像内运行（--ipc=host）（#805 topology）
FAILED_FILE = apps/e2e/e2e/admin-list-query-state.spec.ts
FAILED_TEST = "admin list URL query state (#784 A3 BDD L3) > A04/A06: Back restores
  the query, and the next write does not revive what Back left"（:299；同 shard 后续
  2 个用例 did not run——serial describe）
FAILURE_PHASE = it 体 ⑤ 步：从题目编辑器 `goBack()` 返回列表时，`nextListResponse`
  的 `page.waitForResponse`（15s 默认超时）未等到任何匹配的列表 GET（:371-376）
FAILURE_CLASS = test timeout（waitForResponse 15000ms）；无断言失败
ERROR = TimeoutError: page.waitForResponse: Timeout 15000ms exceeded while waiting
  for event "response"（at nextListResponse ... spec.ts:71:26 / :376:25 / :379:8）
ASSERTION_FAILURE = NO
AUTHORITATIVE_RUN_RESULT = FAIL（CI 门禁 run 39927162323：shard 2/2 failure，
  shard 1/2 cancelled by matrix；其余 job success。结果不可被重跑改写）
HOST_OR_RUNNER_CONTEXT = CI runner（非本地）；trace.zip、error-context.md、失败截图
  与 server log 由 CI artifacts 保全（run 39927162323，
  artifact `e2e-failure-diagnostics-2` id 12489703964）
RELEVANT_OBSERVED_STATE = 失败时页面快照显示列表状态本身已正确恢复：URL 处于
  /admin/questions、搜索框含 KEYWORD（a3kwmvkqdt1b）、"共 21 条，显示 1-20 条"、
  "上一页" disabled（= 第 1 页）——即 Back 后 UI 正确，但未观测到新的列表 GET 响应
RERUN_EVIDENCE = 尚未重跑（登记先于重跑）。对照证据：
  ① PR #808 CI run 39925426281（head 1a364ace：同一产品代码基线 b9b7fabb + 三个
     发布权威文件的纯文档 diff）同日更早时刻全绿，shard 2/2（含本用例）SUCCESS；
  ② 该用例在 PR #786/#787 的实现期 CI 与其合并后的 exact-head CI 中均通过
NONDETERMINISM_CONFIRMED = PENDING（等待重跑；当前证据 = 同代码在对照 run 通过 +
  本次失败，符合非确定性的一般形态，但按本册规则以重跑确认）
CURRENT_CHANGE_CAUSALITY = PLAUSIBLY_UNRELATED（对照 run ① 与失败 run 的产品代码
  完全相同，候选改动为纯 Markdown；但该对照是两个自然 run 的比较，非受控操纵实验，
  不写 PROVEN_UNRELATED）
ROOT_CAUSE_CONFIDENCE = UNKNOWN
ROOT_CAUSE_HYPOTHESIS = ⑤ 步 goBack() 返回的列表参数组合（search=KEYWORD &
  difficulty=2 & page=1）与 ④ 步刚提交并请求过的组合完全相同；若列表数据层在 Back
  恢复时命中同 key 缓存/既有状态而不发起新 GET（或真实请求先于监听注册完成），
  waitForResponse 将无事件可等。该假设可解释"页面状态正确但响应事件缺失"，尚未
  用 trace 复核，不作为结论
FIRST_CAUSAL_DIVERGENCE = UNKNOWN
CASE_ID = UNASSIGNED（AGGREGATION_BASIS = NONE；签名首登）
OWNER_DISPOSITION = 登记 + 在本 PR 内重跑 CI 获取新权威 run（失败 run 保持 FAIL
  并存）；机制诊断与测试加固推迟到 v0.0.10 发布流程结束后（与
  OBS-2026-10-23-001 同一 Owner 指示）
```

---

### #98 `examTransitions.test.ts` reconciliation-audit "failure"（无法复现，非代码 bug）

```text
CASE_STATE = CLOSED_NOT_REPRODUCED
CASE_CREATED_AT = 2026（ADR-007 Phase 4 调查期间；issue #98）
CASE_LAST_REVIEWED_AT = 2026-10-12T09:48:53+08:00

NONDETERMINISTIC = UNKNOWN（原始失败后再未复现）
ROOT_CAUSE_CONFIDENCE = HYPOTHESIS
CURRENT_CHANGE_CAUSALITY = UNKNOWN
AGGREGATION_CONFIDENCE = NONE
```

- 在 ADR-007 Phase 4 调查中观察到 `examTransitions.test.ts` 在 `file-schema` full suite
  下 8/14 失败（`expected -1 to be 1`，`waitForAuditCount` 1s 超时）。归档为 issue #98。
- **后续调查无法复现**：fresh PG 容器上定向运行 ×3 全过（14/14），fresh DB 上 full
  suite ×2 全过（585/585），polluted（3001 行 `public.audit_logs`）full suite ×2 全过
  （585/585）。原始失败最可能是先前 worker-database 实验造成 `public.audit_logs` 异常
  累积（6449 行）+ 特定数据重叠的瞬时污染状态（HYPOTHESIS，无法进一步验证）。
- **未做生产代码修复**（`reconciliation.ts` / `examTransitionExecutor.ts` 逻辑正确；
  characterization 测试断言正确）。#98 关闭为 not-reproducible。
- 备注（潜在脆弱性，非 #98 范围）：每文件 `file-schema` 用
  `search_path=${schema},public`，理论上 `public` 污染可泄漏；若未来此类 flake 复发，
  值得调查是否去掉 `public` fallback 或让 worker-DB 模式跨模式切换时 flush `public`。
  这属于 ADR-007 test infra 范畴，非业务逻辑修复。

---

## Non-Flake / Misclassification Lessons（非 Flake / 误分类教训）

> 以下是最终被证明为**确定性**产品/测试/环境缺陷或既定契约行为的记录。它们不属于活跃
> 非确定性注册表；保留在此用于排查复用，防止症状相似时重走弯路。

### RESOLVED-002 — migration 0015 step 3 stuck-state（SuperAdmin / 非 assignable orphan user 触发 CHECK violation，migration 永久卡死）

```text
CLASSIFICATION = NOT_A_FLAKE（确定性 migration 正确性 bug）
```

**状态**：已修复（2026-07-20，本分支 `feat/rbac-M10-E`）。表面像 BUG-FLAKE-001 family
的 timeout，实为**确定性的 migration 正确性 bug**——只是长期被 `pnpm verify` 在
typecheck 阶段 fail 掩盖，typecheck unblock 后才暴露。

**失败位置**

- 文件：`packages/db/migrations/postgres/0015_crazy_anita_blake.sql` step 3（INSERT
  backfill orphaned users）
- 现象：`pnpm verify` 到 coverage 阶段时，`@exam/db` / `@exam/api` 的 worker database
  在 `setupWorkerTestDatabase` 的 `migratePostgres` 步骤抛 `PostgresError: new row for
  relation "user_role_assignments" violates check constraint
  "user_role_assignments_role_check"`，detail 显示失败行的 `role` 列是 `SuperAdmin`。
- 受影响 worker database（实测）：`exam_test_w0`（15/16 migrations, 1 non-assignable
  user）、`exam_test_w3`（15/16, 3）、`exam_test_w11`（15/16, 1）、`exam_test_w75`
  （15/16, 0 non-assignable，但 primary 多重导致 step 5 index 失败）。这些 DB 进入永久
  卡死状态：每次 `migratePostgres` 都会重跑 0015 → 都 fail → migration 永不记录为
  applied。

**根因（证据驱动）**

1. `user_role_assignments.role` 有 CHECK 约束 `IN ('Admin','Teacher','Proctor','Grader',
   'Candidate')`（`packages/db/src/schema/pg.ts:674-677`）。
2. `users.role` 列**没有** CHECK 约束（`pg.ts:111`），可持有 `SuperAdmin` / `System` /
   `ContentManager` / `ResultViewer` 等非 assignable 值——测试 negative fixture
   （`createUnassignedUserForTest`）和 legacy 数据都用这种"非 assignable sentinel"role。
3. migration 0015 step 3 的 INSERT backfill 对每个"无 assignment row"的 user，用
   `u."role"` 作为新 assignment 的 role。若 `u."role"` 非 assignable → 违反 CHECK →
   整个 migration 事务回滚。
4. **Drizzle 的 `migrate()` 把所有 pending migration 包在一个 transaction 里**
   （`drizzle-orm/pg-core/dialect.js:60`）。一旦某个 statement fail → 整个事务
   ROLLBACK → `__drizzle_migrations` 没有记录任何 applied 行 → 下次 `migratePostgres`
   重跑同一批 pending migrations → 同样 fail → **infinite stuck**。
5. 触发条件：测试在 worker database（持久、跨 run 复用）创建
   `users.role='SuperAdmin'` 且无 assignment → 下一轮 run 的
   `setupWorkerTestDatabase` → `migratePostgres` → step 3 INSERT → CHECK fail →
   stuck。

**修复（已落地，2026-07-20）**

- `packages/db/migrations/postgres/0015_crazy_anita_blake.sql` step 3 加 `WHERE
  u."role" IN ('Admin','Teacher','Proctor','Grader','Candidate')` 守卫。非 assignable
  orphan 被故意跳过：它们没有合法 role 可分配，runtime resolver
  （`deriveAssignmentAuthority`）本就 fail-closes on "no active primary assignment" →
  跳过**保留**了安全不变量，而不是削弱。
- DROP 4 个卡死的 worker database（`exam_test_w0/w3/w11/w75`）。Worker DB 是
  per-worker、disposable，DROP 后下一轮 run 重建即恢复。
- Drizzle 行为核验（Context7 + 源码）：Drizzle 用 `folderMillis`（timestamp）比较决定
  是否 run，**不**比较 hash；编辑已 applied 的 migration 文件不会 trigger 重跑，hash
  mismatch 仅在 v0→v1 upgrade path 才检查。本次编辑对已 applied 的 DB（w1/w2/w4 等
  16/16 migrations 的）无影响。

**为什么不是 flake**

- **确定性**：只要 worker DB 里有非 assignable orphan user + migration 0015 未
  applied，**必然** fail，不会"再跑就过"。
- **代码 bug**：migration 0015 step 3 的 INSERT 缺少 role 守卫，是产品迁移逻辑错误，
  不是 I/O 争用。
- **生产影响**：这不只是测试 bug——任何升级到 M10-E 且 DB 里有 `users.role` 为非
  assignable 值的 orphan user 的部署，都会 stuck migration。修复 migration 是必需的，
  不只是清理测试。

**排查复用要点**

遇到 `setupWorkerTestDatabase` / `migratePostgres` 抛
`user_role_assignments_role_check` violation：

1. 查 `users` 表里是否有 `role NOT IN ('Admin','Teacher','Proctor','Grader',
   'Candidate')` 的 row：`SELECT role, count(*) FROM users GROUP BY role;`
2. 查 `__drizzle_migrations` 的 count：`SELECT count(*) FROM
   drizzle.__drizzle_migrations;`（当时应有 16 条；少于 16 即 stuck）
3. 若 stuck，DROP 该 worker database 重建；migration 0015 已加守卫，不会再因 orphan
   user 卡死。
4. 若在生产 deploy 看到，先清理或 reassign 这些 orphan user（或接受它们保持
   no-assignment），再跑 migration。

### RESOLVED-001 — `GET /api/exams` 返回 500 INTERNAL_ERROR（tenant-isolation + 共享 DB 污染 + 缺 nowPlugin）

```text
CLASSIFICATION = NOT_A_FLAKE（两个独立确定性根因叠加）
```

**状态**：已修复（2026-06-19，commit 见 ADR-006 PR）。表面像 flake，实为两个独立根因
叠加。

**失败位置**

- `apps/api/tests/security/tenant-isolation.test.ts` ×2：`org A admin sees only org A
  exams`、`non-SuperAdmin x-target-org header is ignored`
- `apps/api/src/routes/exam.test.ts`：`GET /api/exams returns list`
- `apps/api/src/routes/permissionBoundary.test.ts`：`GET /api/exams returns 200`
- 全部表现为 `AssertionError: expected 500 to be 200`，路由返回
  `{"error":{"code":"INTERNAL_ERROR",...}}`。

**错误（真实根因，非断言）**

经逐层隔离复现，500 有两个独立成因：

1. **`tenant-isolation.test.ts` 插入契约非法 fixture**：两处原始 `db.insert(schema.exams)`
   用了 `controlFlags.batchSize: 0` / `batchInterval: 0`，但
   `packages/contracts/src/exam.ts:42-43` 规定 `batchSize: z.number().int().min(1)`、
   `batchInterval: z.number().int().min(1)`。该测试绕过 API 校验直接写库，留下非法记录。
2. **`tenant-isolation.test.ts` 构造的 Fastify app 未注册 `nowPlugin`**：其 `beforeAll`
   注册了 auth/tenant/rateLimit/zodProvider/security/createDb，但**漏了 `nowPlugin`**。
   而 `GET /api/exams` 路由调用 `fastify.now()`（`apps/api/src/routes/exam.ts`），于是抛
   `TypeError: fastify.now is not a function` → 被错误处理器包成 500。`buildTestApp`
   （其他测试用）注册了 `nowPlugin`，所以只有 tenant-isolation 自己构建的 app 中招。

**出现场景 / 放大机制**

- 根因 1（非法 fixture）通过**共享的 `exam_test` DB 跨文件污染**放大：
  tenant-isolation 留下的 `batchSize:0` 记录会被同一次 `pnpm test` 运行里的
  `exam.test.ts` / `permissionBoundary.test.ts` 的 `GET /api/exams` 列到 → Fastify
  响应 Zod 校验失败 → 500。所以根因 1 一次写入可炸 3 个文件。
- 根因 2（缺 nowPlugin）只影响 tenant-isolation 自身 2 个用例，与 DB 状态无关。
- 完全重置 DB（`DROP SCHEMA public, drizzle CASCADE; CREATE SCHEMA public`）后只跑
  `exam.test.ts` → 40/40 过：证明根因 1 是 DB 状态污染，生产代码无 bug。

**已知不是的原因**

- 不是 ADR-006 / Time Authority 引入的回归（`fastify.now()` 在 list 路由本就存在；
  stash 回基线 commit 同样 4 个失败）。
- 不是迁移修复（migration 0001）引入：timing 字段 nullable 与本问题无关。
- 不是产品代码 bug：运行中的 exam-e2e-p2b app（同一镜像）`GET /api/exams` 返回 200
  正常。

**当前缓解 / 修复（已落地）**

1. `tenant-isolation.test.ts` 两处 fixture `batchSize: 0 → 10`、`batchInterval: 0 → 3`
   （与 contract default 一致）。消除契约非法记录。
2. `tenant-isolation.test.ts` `beforeAll` 增加 `await app.register(nowPlugin)`（与
   `buildTestApp` 对齐）。消除 `fastify.now is not a function`。
3. 验证：三文件同跑 58/58 过；完整 api 套件 512/512 过（偶发 1 个 suite-level 失败属
   DB 状态共享，见 BUG-FLAKE-004）。

**排查复用要点**

遇到 `GET /api/exams`（或任何 list 路由）返回 500 INTERNAL_ERROR：

1. 先确认是不是 DB 状态污染：`DROP SCHEMA public, drizzle CASCADE; CREATE SCHEMA
   public` 后单跑该文件。若过 → 是跨文件残留，查 fixture 是否写了契约非法值。
2. 若不过，用 `onError` hook 打印真实 `err.message`：若为 `fastify.now is not a
   function` → 测试 app 漏注册 `nowPlugin`；若为 Zod `too_small`/`invalid_type` →
   响应里有契约非法字段，查 fixture。
3. 响应 500 + 错误处理器统一文案时，**不要**先怀疑产品代码。

### ExamEditPage 只读题目列表默认第一页（2026-09-24 run4 B-inline；产品缺陷，已修复）

```text
CLASSIFICATION = NOT_A_FLAKE（确定性产品缺陷；题量 ≤20 时通过，>20 时必现）
```

**失败位置**：`apps/e2e/e2e/data-view-1.spec.ts:519`（B compressed inline panel）；
调用 `bash scripts/e2e/run.sh`（全量，2 shard）。

```text
Error: expect(locator).toBeVisible() failed
Locator: … [data-slot="admin-table-shell"] … [data-slot="table-row"]
heading "已选题目 (1)" 与 heading "尚未选择题目" 同时出现
```

- **根因**：`ExamEditPage` 以裸 `GET /api/questions`（默认 pageSize=20，
  `questionRepo.listFiltered` 按 `createdAt` 升序）填充已选题目面板；seed 的题目是库内
  最新记录，worker 库累计 >20 条题目时它落在第一页之外 → `selectedQuestions` 过滤为空 →
  面板永久空态。题量 ≤20 时通过，故此前聚焦复跑全绿；是真实产品缺陷（任何较新题目在
  编辑页都不可见），不是测试不稳定。
- **修复**：新增 `apps/web/src/lib/allQuestions.ts` `fetchAllPickerQuestions()`
  （pageSize=100 顶格 + 翻完全部页），`ExamEditPage` 与 `ExamCreatePage`（wizard 内联的
  第二份翻页实现）统一收敛到该唯一入口，并附 transport 边界 mock 的单元测试。

### RUN-LEASE-OP-MODE — 多 package coverage 并发跑触发 worker-database 运行租约互斥（2026-09-27；操作模式限制，非回归）

```text
CLASSIFICATION = MISCLASSIFIED_AS_FLAKE（v1 置于 flake 事故列表；实为既定契约在
  不支持的操作模式下的确定性行为，NONDETERMINISTIC = NO）
CASE_STATE = OPERATIONAL_CONSTRAINT
ROOT_CAUSE_CONFIDENCE = CAUSALLY_PROVEN（契约设计 + 复现实验非对称签名）
```

- **现象**：本地（WSL2，PR #643 closure 修复验证期间，head `4250aea7`）把三个 coverage
  套件作为独立 pnpm/vitest 进程**同时**在后台运行（`pnpm --filter @exam/api run
  coverage` + `pnpm --filter @exam/web run coverage` + `pnpm --filter @exam/db run
  coverage`，共用 docker-compose.dev 的同一 PG 实例）。db coverage 失败而 api/web 全绿。
  首次发生：`packages/db/src/testInfraLock.test.ts` 3 个失败 + `packages/db/src/
  repository/recoveryRepo.test.ts` 3 个失败（两文件耗时分别被拉长到 ~44.6s / ~63s，
  其余 53 文件全过）。
- **错误片段（复现时完整捕获）**：两个 run-lease 契约测试失败，错误相同——
  `Error: [testInfraLock] another worker-database test run is already active on this
  PostgreSQL server (run lease exam_test_worker_database_run is held). Concurrent local
  worker-database runs are not supported: both runs derive the same slot databases from
  VITEST_POOL_ID. Wait for the running invocation to finish, or point TEST_DATABASE_URL
  at a separate PostgreSQL instance.`（抛出于 `src/testInfraLock.ts:425`）：
  - `acquireTestInfraRunLease — run B fails IMMEDIATELY while run A holds; release is
    idempotent and unblocks` — `testInfraLock.test.ts:765`（测试里 run-A 的 acquire
    本身被外部租约拒绝）
  - `run lease is CLUSTER-scoped: alien TEST_ADMIN_DATABASE is rejected, not honored
    (round-5)` — `testInfraLock.test.ts:799`（"canonical domain is still free" 的收尾
    acquire 被外部租约拒绝）
- **证据**：① 首次失败后立即单独重跑两个失败文件：96/96 全过（7.6s）；② 再单独跑完整
  db coverage：55 文件 / 669 测试全过；③ 复现实验（同一 commit、同一操作模式，api +
  web + db 三进程并发）：db coverage 2 个失败（如上，均为 run-lease 测试），api
  coverage（租约持有方）与 web coverage 同时全绿——非对称签名与租约机制完全吻合（先
  启动者持约正常运行，后启动者取不到租约）。首次发生的 recoveryRepo 3 个失败在复现中
  未再出现 → 拆出为独立 occurrence OBS-2026-09-27-001（UNKNOWN，不归入任何家族）。
- **根因（契约行为）**：不是产品/测试回归，而是**集群级运行租约的既定契约与"同一 PG
  上并发跑两个 worker-database 隔离的测试套件"这一操作模式的必然冲突**：
  `acquireTestInfraRunLease` 每个 PG server 只发放一把
  `exam_test_worker_database_run` 租约（slot 库 `exam_test_w1..wN` 由 `VITEST_POOL_ID`
  派生，两套并发运行会在同一批 slot 库内互踩），API coverage 全程持约 ~3.5 分钟，期间
  启动的 db coverage 取约失败——包括那两个**用真实 acquire 断言租约契约**的测试。租约
  错误消息本身已写明原因与 remedy。（该 run lease 的设计与证据见 BUG-FLAKE-001 参考因果
  调查 round-3→5 合同收口第 4 条。）
- **当前缓解**：开发机多套件**串行**执行（同 2026-08-31 缓解），不并发跑两个使用
  worker-database 隔离的 vitest 进程；CI 各 job 独立 runner，不受此操作模式影响。无
  代码改动：失败行为**就是**租约契约在工作（fail loud + 指明 remedy）。
- **后续动作**：无。串行执行下同签名再出现即为真回归，按 bug 处理。

### server-shutdown EADDRINUSE 3000 环境敏感（2026-09-24 附带确认；设计事实）

```text
CLASSIFICATION = NOT_A_FLAKE（给定环境确定性：宿主持有 3000 端口即必败）
```

2026-09-24 同轮 `pnpm verify` 期间确认 `src/server.shutdown.test.ts` 的
`EADDRINUSE 127.0.0.1:3000`：该用例子进程以 `NODE_ENV=development` 启动，而
development 模式的端口所有权是 `DEV_API_PORT ?? 3000`（`runtimeConfig.ts`，`APP_PORT`
被有意忽略），因此宿主上任何持有 3000 端口的 dev server 都会让它失败。环境敏感为既有
设计，非当时改动引入；端口空闲时（含 CI）稳定通过。

---

## Historical Evidence（历史证据）

### v1 登记规则（已废止，原文保全）

> 以下规则在 FORMAT_VERSION=2 中被 [Epistemic rules](#epistemic-rules认识论规则) 取代。
> 废止原因：规则 #1 把"同代码再跑就过"同时当作可登记性与无害性门槛，混淆了非确定性
> 证明与根因排除；规则 #3 把复发次数直接等同于"同一 bug"，次数只应触发聚合复审。

```text
1. 必须有再现一次"同代码再跑就过"的证据才能记入此处，否则按真实 bug 处理。
2. 每条至少含：日期、Job 上下文、失败测试 file:line、错误片段、根因假设、当前缓解、
   后续动作。
3. 同一条目复发 ≥3 次 → 升级为正式跟踪条目（本文档"已升级条目"段，或 issue tracker），
   并在原条目末尾标记"已升级"。
```

v1 开篇语曾把登记范围定义为"与当前改动**无因果关系**的偶发测试失败"——该默认断言在
FORMAT_VERSION=2 中不再使用：与当时改动的因果关系是独立证据轴（见 STEP 7），默认
UNKNOWN，只有在取证后才写 PLAUSIBLY_* / PROVEN_*。

### v1 条目模板（已废止，原文保全）

> 被 [Investigation Template](#investigation-template调查模板) 取代；保留以读懂历史
> 条目结构。

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

---

## Investigation Template（调查模板）

新 occurrence 用 [How to record](#how-to-record-a-nondeterministic--flaky-test-failure首屏如何登记一次-flaky-失败)
中的快速登记模板立即登记；进入调查后升级为以下完整模板（组合了 v1 的结构化小节与
FORMAT_VERSION=2 的认识论字段）：

```markdown
### OBS-YYYY-MM-DD-NNN — <文件名> <简短描述>

OBSERVED_AT =
GIT_SHA =
BRANCH =
COMMAND =

EXECUTION_TOPOLOGY =
FAILED_FILE =
FAILED_TEST =
FAILURE_PHASE =
FAILURE_CLASS =
ERROR =
ASSERTION_FAILURE =

AUTHORITATIVE_RUN_RESULT =

RERUN_EVIDENCE =

DIFF_RELATION =

TRACE_AVAILABLE =

NONDETERMINISM_CONFIRMED =

INTERPRETATION_AT_RECORD_TIME =

CURRENT_INTERPRETATION =
CURRENT_INTERPRETATION_UPDATED_AT =

CURRENT_CHANGE_CAUSALITY =
ROOT_CAUSE_CONFIDENCE =
FIRST_CAUSAL_DIVERGENCE =

CASE_ID =
AGGREGATION_BASIS =

### 已知不是的原因（附证据）

### 当前缓解

### 后续动作 / NEXT_DIAGNOSTIC_ACTION
```

Case 建案时使用 Active Cases 中 BUG-FLAKE-005/006 的完整小节结构（Status / Failure
signature / What is established / What is NOT established / Hypotheses / Causal model /
Occurrences / Repair / Exit criterion / 修改历史）。

---

## Reconciliation History

### REC-2026-10-12-001 — FORMAT_VERSION 1 → 2 认识论调解

```text
STARTED_AT = 2026-10-12T09:42:45+08:00
COMPLETED_AT = 2026-10-12T09:48:53+08:00

SOURCE_REVISION = 0044e2a0a859427aa6927d19a0ff939525a60130
SOURCE_BLOB_SHA = 0686986f4c4a5857e73e062385f6d9bed97aa874
SOURCE_BYTES = 118806
SOURCE_LINES = 1430

OPERATION = EPISTEMIC_RECONCILIATION_V1_TO_V2

FILES_CHANGED = docs/standards/test-flakes.md

CODE_CHANGED = NO
TEST_CODE_CHANGED = NO
PRODUCTION_BEHAVIOR_CHANGED = NO

HISTORICAL_FACTS_DELETED = 0
HISTORICAL_FACTS_SILENTLY_REWRITTEN = 0

INTERPRETATIONS_RECLASSIFIED = 13
  （BUG-FLAKE-005 案例体；OBS-2026-10-06-001 / -10-07-001 / -10-08-001（原
  2026-10-06/07/08 bootstrap-admin 三条目）；OBS-2026-10-08-003（readTrust）；
  OBS-2026-10-08-002（admissions）；OBS-2026-10-07-002（slot-reuse afterAll）；
  OBS-2026-08-31-001；OBS-2026-09-26-001；BUG-FLAKE-006（原 ea-lock-order 三条复发）；
  BUG-FLAKE-001（子类标签降级为时代一致假设）；OBS-2026-06-20-001/002（misconduct）；
  CASE-2026-09-01（2026-09-01 occurrence 归因定为 CORRELATED，"宿主负载家族"表述降级））

CASES_SPLIT = 2
  （#1: v1 "2026-09-24 run4 双失败"条目 → CASE-2026-09-24-MOBILE-RACE +
   ExamEditPage 分页 non-flake 记录 + OBS-2026-09-24-002（ERR_NETWORK_CHANGED），
   EADDRINUSE 附注单列；
   #2: v1 挂在 BUG-FLAKE-001 名下的修复后"宿主负载家族"签名 → 拆出为独立
   occurrence（OBS-2026-08-31-001 / 09-26-001 / 10-07-002 / 10-08-002 / 10-08-003
   及 ea-lock-order → BUG-FLAKE-006），BUG-FLAKE-001 收窄为两个已证明机制）

CASES_MERGED = 2
  （#1: v1 "2026-08-26 根因链"独立条目并入 BUG-FLAKE-001 作为其参考因果调查核心；
   #2: v1 三个 2026-07-21 audit 条目合并为 CASE-2026-07-21-AUDIT 三阶段）

CASES_DOWNGRADED = 1
  （BUG-FLAKE-005：家族事实性根因 → ROOT_CAUSE_CONFIDENCE = HYPOTHESIS、
   AGGREGATION_CONFIDENCE = PROVISIONAL）

CASES_UPGRADED_TO_CAUSALLY_PROVEN = 0
  （新建 BUG-FLAKE-006 不是升级——它是把 3 个既有 occurrence 按 3+ 规则建案，置信为
   HYPOTHESIS/PROVISIONAL）

UNRESOLVED_ROOT_CAUSES = 18
  （17 条账本 occurrence + #98 closed-not-reproduced；不含已修复案例）

SOURCE_RECORDS_ACCOUNTED_FOR = 36 / 36
UNMAPPED_SOURCE_RECORDS = 0
```

#### 源记录 → 新位置迁移表（紧凑版）

| # | v1 源记录 | 新位置 | 分类 | PRESERVED |
|---|---|---|---|---|
| 1 | 开篇目的段 | 开篇（认识论重构）+ Historical Evidence（v1 断言废止说明） | 重构 | YES |
| 2 | 登记规则（3 条） | Historical Evidence（原文）+ Epistemic rules（替代） | 废止→替代 | YES |
| 3 | 2026-10-08 readTrust | OBS-2026-10-08-003 | occurrence（HYPOTHESIS） | YES |
| 4 | 2026-10-08 bootstrap-admin R5 | OBS-2026-10-08-001 + BUG-FLAKE-005 | occurrence+case | YES |
| 5 | 2026-10-08 admissions | OBS-2026-10-08-002 | occurrence（HYPOTHESIS） | YES |
| 6 | 2026-10-07 slot-reuse afterAll | OBS-2026-10-07-002 | occurrence（HYPOTHESIS） | YES |
| 7 | 2026-10-07 bootstrap-admin R2 | OBS-2026-10-07-001 + BUG-FLAKE-005 | occurrence+case | YES |
| 8 | 2026-10-06 bootstrap-admin | OBS-2026-10-06-001 + BUG-FLAKE-005 | occurrence+case | YES |
| 9 | 2026-09-27 run-lease 事件 | RUN-LEASE-OP-MODE（non-flake/操作约束）+ OBS-2026-09-27-001（recoveryRepo 部分） | 拆分 | YES |
| 10 | 2026-09-01 CI hook drift（含 09-23 复发与 09-24 结构修复） | CASE-2026-09-01-CI-BOOTSTRAP | resolved causal | YES |
| 11 | 2026-08-31 并行双套件 | OBS-2026-08-31-001 | occurrence（HYPOTHESIS） | YES |
| 12 | 2026-08-26 槽位身份根因链 | BUG-FLAKE-001 参考因果调查（全文保全） | resolved causal（REFERENCE） | YES |
| 13 | 2026-07-21 audit 生命周期竞态 | CASE-2026-07-21-AUDIT Phase 1 | resolved causal | YES |
| 14 | 2026-07-21 ADR-006 中间态 | CASE-2026-07-21-AUDIT Phase 2 | resolved causal（历史中间态） | YES |
| 15 | 2026-07-21 比例性 corrective | CASE-2026-07-21-AUDIT Phase 3 | resolved causal | YES |
| 16 | 2026-07-30 #231 rate-limit | CASE-2026-07-30-RATELIMIT | resolved causal（CORRELATED） | YES |
| 17 | 2026-08-01 PR #242 closeout | CASE-2026-08-01-LOCK-SCOPE | resolved causal（原 occurrence UNKNOWN） | YES |
| 18 | BUG-FLAKE-001（含复发列表） | BUG-FLAKE-001（含 10-12 复核） | resolved causal | YES |
| 19 | #98 examTransitions | #98 案例记录（账本段末） | CLOSED_NOT_REPRODUCED | YES |
| 20 | BUG-FLAKE-002 | BUG-FLAKE-002 | resolved causal | YES |
| 21 | BUG-FLAKE-003 | BUG-FLAKE-003 | resolved causal | YES |
| 22 | BUG-FLAKE-003 stress 表 | BUG-FLAKE-003 内 | stress evidence | YES |
| 23 | BUG-FLAKE-004 | BUG-FLAKE-004 | resolved causal | YES |
| 24 | BUG-FLAKE-004 stress 表 | BUG-FLAKE-004 内 | stress evidence | YES |
| 25 | BUG-FLAKE-005 | BUG-FLAKE-005（再分类记录） | active case（HYPOTHESIS） | YES |
| 26 | RESOLVED-002 | Non-Flake 段 | NOT_A_FLAKE | YES |
| 27 | RESOLVED-001 | Non-Flake 段 | NOT_A_FLAKE | YES |
| 28 | 2026-06-20 misconduct | OBS-2026-06-20-001/002 | occurrence（HYPOTHESIS） | YES |
| 29 | 2026-06-23 testWorkerDatabase（含 07-21 复发） | BUG-FLAKE-001 历史 occurrence（全文保全） | resolved-case 历史明细 | YES |
| 30 | 2026-07-25 ea-lock-order（含 09-19、10-03 复发） | BUG-FLAKE-006 + OBS-2026-07-25-001/09-19-001/10-03-001 | active case（PROVISIONAL） | YES |
| 31 | 2026-09-24 assignment-affordances | OBS-2026-09-24-001 | occurrence（HYPOTHESIS） | YES |
| 32 | v1 模板 | Historical Evidence（原文）+ Investigation Template（替代） | 废止→替代 | YES |
| 33 | 2026-09-24 run4 双失败（含 run5、EADDRINUSE） | CASE-2026-09-24-MOBILE-RACE + ExamEditPage non-flake + OBS-2026-09-24-002 + EADDRINUSE 记录 | 拆分 | YES |
| 34 | 2026-09-26 repository | OBS-2026-09-26-001 | occurrence（HYPOTHESIS） | YES |
| 35 | 2026-09-26 admin-nav | OBS-2026-09-26-002 | occurrence（HYPOTHESIS） | YES |
| 36 | 2026-09-28 #650 | CASE-2026-09-28-PGSTAT | resolved causal | YES |

#### 无未支持的因果提升（final audit）

本轮没有任何记录从 UNKNOWN/HYPOTHESIS/CORRELATED 提升到 CAUSALLY_PROVEN。所有
CAUSALLY_PROVEN 的案例（BUG-FLAKE-001/002/003/004、CASE-2026-09-01、
CASE-2026-07-21-AUDIT、CASE-2026-09-28、CASE-2026-09-24、RUN-LEASE-OP-MODE）在 v1
中即已带有同等强度的证据（变异回归、自然失败捕获、确定性复现、量化前后对比），本轮仅
保持并显式标注其证据类型；CASE-2026-08-01 的修复机制与 CASE-2026-07-30 的根因均**未**
标为 CAUSALLY_PROVEN（分别为源码证据回归 + CORRELATED）。CASE-2026-09-01 的首
occurrence 归因被**降级**为 CORRELATED。

```text
UNSUPPORTED_CAUSAL_PROMOTIONS = 0

VALIDATION:
- source record accounting: PASS（36/36，见迁移表）
- historical evidence preservation: PASS（所有错误片段、失败链、DB 普查表、stress 表、
  复现命令、回归清单、撤回方案原文保全；v1 规则与模板原文保全于 Historical Evidence）
- unsupported causal promotion check: PASS（0 提升；2 项显式降级/限定）
- registry/detail consistency: PASS（注册表 14 行与各案例详情的 state/置信一致）
- Markdown/code-fence integrity: PASS（写后回读校验）
- post-write readback: PASS
- single-file write boundary: PASS（git diff --name-only 仅本文档）

WRITE_APPLIED = YES
POST_WRITE_VERIFIED = YES
MODIFICATION_SUCCESS = YES
```

### REC-2026-10-12-002 — current-source 现实核对与因果归因级别更正

```text
STARTED_AT = 2026-10-12T10:12:00+08:00
COMPLETED_AT = 2026-10-12T10:24:59+08:00

SOURCE_REVISION = da4823db6351e1a2628ad295103181b6fbec67c2
SOURCE_BLOB_SHA = 1db986885be0759e9e704ef013d0b91e0df3036c
SOURCE_BYTES = 153250
SOURCE_LINES = 2676

OPERATION = CURRENT_SOURCE_REALITY_RECONCILIATION
  （REC-2026-10-12-001 建立 v2 认识论结构后，用 current master 源码与 Git 历史复核
  登记册中的"现状型"断言与因果归因级别）
SUPERSEDES = REC-2026-10-12-001 的迁移表第 30 行仅描述 REC-001 当时的动作
  （"active case（PROVISIONAL）"）——该状态已由本轮置为 SUPERSEDED（见下）

FILES_CHANGED = docs/standards/test-flakes.md

CODE_CHANGED = NO
TEST_CODE_CHANGED = NO
PRODUCTION_BEHAVIOR_CHANGED = NO

HISTORICAL_FACTS_DELETED = 0
HISTORICAL_FACTS_SILENTLY_REWRITTEN = 0
SOURCE_OCCURRENCES_LOST = 0（17 条 OBS-* 全部在位 + 1 条模板标题；新增内容一律为字段
  追加）

RECLASSIFICATIONS = 5（见下表）
EVIDENCE_BASIS_STRENGTHENED = 10（分类值不变，仅把准入依据写明为
  CONTROLLED_EXCLUSION / 不计入分类变更）
WORDING_DOWNGRADED = 1（BUG-FLAKE-005："被排除" → "未获支持"，分类值不变）
RULE_ADDED = 1（STEP 7 + Status vocabulary：PROVEN_UNRELATED 的准入依据）
CAUSAL_PROMOTIONS_TO_CAUSALLY_PROVEN = 0
```

#### 分类变更表（每项均含依据、理由、复核时间与结果）

| # | 记录 | 先前分类 | 现分类 | 依据（可核） | 复核时间 | 结果 |
|---|---|---|---|---|---|---|
| 1 | BUG-FLAKE-006（注册表行 + 案例体 + 3 条 occurrence） | `CASE_STATE = INVESTIGATING`；failure signature 描述为现存活跃的 100 轮 contention 用例 | `CASE_STATE = SUPERSEDED`；`REPRODUCER = NONE` | `c56bae15`（2026-07-08）新增该用例 → `e60a7edd`（PR #721，2026-10-07）整体替换该文件；`e60a7edd^` blob `3dc18790…` 含 `:292` 的 `100 consecutive runs`，`da4823db` 与工作树均无 | 2026-10-12T10:24:59+08:00 | PASS |
| 2 | CASE-2026-09-01-CI-BOOTSTRAP | `CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED` | `PLAUSIBLY_UNRELATED` | 原依据为文件级（受害文件不导入改动模块 + 同 commit 本地全绿；STEP 7 排除的准入形式）；该 PR（`9586f7c9^1..9586f7c9`）在同一 API coverage lane 内改动 2 个 DB-touching 测试文件，而机制是 lane 队列深度放大 | 2026-10-12T10:24:59+08:00 | PASS |
| 3 | CASE-2026-09-28-PGSTAT | `CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED` | `PROVEN_RELATED`（限定：改动经其新增测试预言机成为该次失败的必要条件；产品代码无缺陷） | `git log --diff-filter=A` 该测试文件只由 `2e2bc4e2`（#648，同日 15:24，178 行新增）与 `4ebe50ae`（#650 修复）触及；该 revision 的 `beforeAll` 即含失败断言 `expect(await otherBackendCount()).toBe(0)` | 2026-10-12T10:24:59+08:00 | PASS |
| 4 | CASE-2026-07-30-RATELIMIT | `CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED` | `PLAUSIBLY_UNRELATED` | 原依据（"测试所有权/成本不匹配、非产品回归"）是 ROOT_CAUSE 轴论证，不是改动排除；记录未识别当时的候选改动，也无受控复现；根因置信保持 CORRELATED | 2026-10-12T10:24:59+08:00 | PASS |
| 5 | OBS-2026-09-24-001 | `CURRENT_CHANGE_CAUSALITY = PROVEN_UNRELATED` | `PLAUSIBLY_UNRELATED` | "路由存在性 + 同轮无 5xx"与 transport 层瞬时失败（连接被拒/重置）相容而非互斥，不构成排除；无受控复现 | 2026-10-12T10:24:59+08:00 | PASS |

#### 保留 PROVEN_UNRELATED 的依据（逐条写明准入类型，避免机械降级）

| 记录 | 准入类型 | 具体依据 |
|---|---|---|
| BUG-FLAKE-002 | CONTROLLED_EXCLUSION | 用 `turbo run test coverage --force` 受控制造并发拓扑即重现同一跨任务竞争链；隔离域落地后该链消失（stress 5/5） |
| BUG-FLAKE-003 | CONTROLLED_EXCLUSION | 38 连跑在"跨 run 残留"这一改动无关变量上重现同签名；fresh-DB 对照归零；原 occurrence 本身即受控复现 run |
| BUG-FLAKE-004 | CONTROLLED_EXCLUSION | 逐层隔离受控复现；schema 隔离后源头消除；3 连跑 stress 对照表 |
| CASE-2026-07-21-AUDIT | CONTROLLED_EXCLUSION | 被操纵变量是"缺 owner 的 Promise"；注入 deferred 即在真实 PostgreSQL 上确定性重现 23503 与跨测试晚行污染 |
| CASE-2026-09-24-MOBILE-RACE | CONTROLLED_EXCLUSION | 失败表达式是改动前的既有代码（出现在改动自身 diff 的 `-` 侧）；机制在断言策略而非改动主题 |
| OBS-2026-08-31-001 | CONTROLLED_EXCLUSION | 唯一变量是去掉两套件并发（并发→5 处超时；串行→两次 EXIT=0）；n=1 |
| OBS-2026-09-24-002 | CONTROLLED_EXCLUSION | `ERR_NETWORK_CHANGED` 是 Chromium 网络栈错误码，应用代码不可达（错误类别机制事实） |
| OBS-2026-09-26-001 | CONTROLLED_EXCLUSION | 该分支为纯文档改动，不触达 STEP 7 列举的任何间接通道（测试数量/worker 占用/模块初始化/全局 setup/DB 负载） |
| OBS-2026-09-26-002 | CONTROLLED_EXCLUSION | 同上（仅 `docs/**`） |
| OBS-2026-10-07-002 | VACUOUS | run 发生在任何候选改动之前：`GIT_SHA = 94dc798c` 为未改动的 master head 且工作树干净 |

#### 明确未做的分类动作（防止过度更正）

- 未把任何记录的 `ROOT_CAUSE_CONFIDENCE` 提升到 `CAUSALLY_PROVEN`；本轮 0 提升。
- 未把 `CORRELATED` 根因改写为其他级别（CASE-2026-07-30-RATELIMIT 保持 CORRELATED）。
- 未把 `PROVISIONAL` 聚合提升（BUG-FLAKE-006 未升为 SUPPORTED，而是因为聚合载体的
  测试身份消失置为 SUPERSEDED）。
- 未把 `CAUSALLY_PROVEN` 的已修复案例降级（BUG-FLAKE-001/002/003/004、
  CASE-2026-09-01、CASE-2026-07-21-AUDIT、CASE-2026-09-28、CASE-2026-09-24、
  RUN-LEASE-OP-MODE 的机制证据未受本轮影响）。
- 未把 BUG-FLAKE-006 的替换表述为"已修复"：`REPAIR_OF_ORIGINAL_FAILURE_MECHANISM =
  NOT_ESTABLISHED`（测试契约替换 ≠ 原失败机制的修复证明）。

```text
VALIDATION:
- occurrence preservation: PASS（17/17 OBS-* 记录在位，另 1 条为模板标题；三次
  BUG-FLAKE-006 occurrence 的 OBSERVED_AT / GIT_SHA / COMMAND / ERROR / RERUN_EVIDENCE /
  INTERPRETATION_AT_RECORD_TIME 逐字保留，仅追加 HISTORICAL_TEST_IDENTITY_STATUS）
- registry/detail consistency: PASS（注册表 BUG-FLAKE-006 / CASE-2026-09-01 /
  CASE-2026-09-28-PGSTAT / CASE-2026-07-30-RATELIMIT / CASE-2026-09-24-MOBILE-RACE
  与各案例体的 state + CURRENT_CHANGE_CAUSALITY 一致）
- unsupported causal promotion check: PASS（0 提升；5 项归因级别更正，其中 1 项为
  UNRELATED → RELATED 的"取消无关断言"，附带源码可核证据）
- no-unsupported-repair-claim check: PASS（无任何历史缺陷因测试被替换而标为已修复）
- Markdown/code-fence integrity: PASS（写后回读校验）
- post-write readback: PASS
- single-file write boundary: PASS（git diff --name-only 仅本文档）

WRITE_APPLIED = YES
POST_WRITE_VERIFIED = YES
MODIFICATION_SUCCESS = YES
```
