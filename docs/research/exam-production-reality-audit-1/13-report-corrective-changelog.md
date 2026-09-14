# 13 — REPORT-CORRECTIVE-1 变更日志

> 本文件记录 EXAM-PRODUCTION-REALITY-AUDIT-1 从审计分支（HEAD `385e836c`）到
> corrective 分支（`audit/exam-production-reality-1-corrective`，基于 `b9b0e08c`）
> 的每一条实质性修正：original claim → corrected claim → reason → evidence →
> affected reports。原则：**保留代码事实与实验事实，删除错误推论，修正 severity
> 与 authority 解读；不改 production。** 原始审计版本保留在审计分支，不重写历史。

---

## 1. F1-04（examProfile teacher scope）→ REJECTED

| 项 | 内容 |
| --- | --- |
| original claim | MAJOR CONFIRMED：examProfile 5 路由平铺 `requireCapability(ExamView/ExamCreate/ExamUpdate)`，未应用 #286 teacher course-assignment 收窄；Teacher 可读/创建/修改组织内**任意课程**的考试策略 profile（04 §5/§9、05 §3、11 MAJOR 节） |
| corrected claim | **REJECTED**。profile 是 organization-owned authoring template，不是 course resource；不存在 teacher course-scope 可施加的 course 维度 |
| reason | ① schema：`exam_policy_profiles` 无 courseId（pg.ts:403-470），ownership 仅 org 级；② 权威契约 P7-M2（docs/contracts/exam-profile-templates.md）§1/§8 明示 organization-owned，§6 将 `courseId` 列入 **Explicitly excluded fields**；③ §15 文档化 RBAC 复用 "no new permission family"（read→ExamView / create→ExamCreate / update+delete→ExamUpdate），route 注释 examProfile.ts:119-127 同文；④ #286 的 marker boundary rule 明确只标记 "permission whose resource lives under a course"（presets.ts F-04 注释）——examProfile 资源不在其内。原审计把 course ownership 投射到 org-owned resource：**interpretation error，不是 production authorization defect** |
| evidence | pg.ts:403-470；exam-profile-templates.md §6/§8/§15；examProfile.ts:119-127；presets.ts F-04 注释（marker boundary rule） |
| affected reports | 04（§5 表、§9、§10）、05（§3 表）、11（MAJOR 节 → REJECTED appendix）、12（AUTHZ/RBAC 行、Q2、Q3） |

## 2. F1-10（ADR-010 状态漂移）→ REJECTED

| 项 | 内容 |
| --- | --- |
| original claim | NOTE：ADR-010 状态 Proposed vs 已全面实现 → ADR_BEHIND_CODE / DOCUMENTATION_DRIFT（10 §1 表、11 NOTE） |
| corrected claim | **REJECTED**。ADR-010 = **ALIGNED**：当前权威 Status 节明确 "Accepted — infrastructure implemented" |
| reason | 文件内同时存在两处状态信息：头部 legacy metadata（`> **Status:** Proposed`，ADR-010-scoped-rbac-architecture.md:6，Phase 3 pre-implementation 时期的历史字段）与**当前权威 `## Status` 节**（:10-12，明示 Accepted — infrastructure implemented）。无 repository machinery 消费 header 状态（scripts/ 与 package.json 中无读取 ADR status 的脚本；adr-status-contract.mjs 只做契约格式类校验）。可记录 "file contains stale historical metadata near the header"，但不升级为 architecture drift |
| evidence | ADR-010-scoped-rbac-architecture.md:6 vs :10-12；grep scripts/（无 header 消费） |
| affected reports | 10（§1 表、§4）、11（NOTE → REJECTED appendix）、12（无直接引用，计数联动） |

## 3. ADR-018 CODE_BEHIND_ADR → ALIGNED（保留 operability gaps）

| 项 | 内容 |
| --- | --- |
| original claim | ADR-018 分类 CODE_BEHIND_ADR：liveness DB-blind、无 metrics 推送、指标易失 → "窗口承诺未完全落地"（10 §1、05 §3、11 原计数） |
| corrected claim | **ALIGNED**。当前 `/system/*` 面就是契约的 current realization；Metrics/Logs/Events/Materials 是 future、需 per-source ADR（D7）；Prometheus/OTel/generic observability platform 是**显式 anti-goal**（"out of scope for the current milestone"）。"无 metrics 推送/告警"="**生产可运维性缺口**"，不是 ADR violation |
| reason | ADR-018 Status：ACCEPTED（2026-08-14）；D1 明示 "Today the window is realized by the existing read-only /system/* routes"；D3 明示当前面为 partial realization（health/diagnostics/backups/restore-readiness/ops-policy）；D5 把 Metrics/Logs/Events/Materials 全部标 future；Context anti-goals 列出 Loki/ES/ClickHouse/OTel collectors/log shipping/generic observability platform；docs/contracts/observability.md Non-goals 同文（"No metrics aggregation system (Prometheus/Grafana) — /system/health and /system/diagnostics suffice for Phase 2 single-instance LAN"） |
| evidence | ADR-018 D1/D3/D5/D7/anti-goals；observability.md Non-goals；system.ts:304-323（/system/health DB ping） |
| affected reports | 05（§3 表、§4）、08（§4）、10（§1）、11（F3-05/F4-05 分类）、12（OPERATOR_DIAGNOSTICS/ACTIVE_ALERTING 行） |

## 4. F3-05 / health 模型 → 五层拆分

| 项 | 内容 |
| --- | --- |
| original claim | F3-05 MINOR："/api/health DB-blind + 全 pull 运维"（health endpoint is DB-blind 混合表述，08 §4/11/12） |
| corrected claim | 五层分别裁决（08 §4）：**PROCESS LIVENESS**（/api/health 静态 ok，apiSurface.ts:42-53）= PROVEN；**APPLICATION READINESS**（/api/system/health，`statsRepo.pingDb()` → dbResponseMs，system.ts:304-323）= PROVEN；**OPERATOR DIAGNOSTICS**（/system/diagnostics）= PROVEN；**DEPLOYMENT HEALTH GATING**（compose healthcheck 不 gate 流量于 DB readiness，docker-compose.yml:87-96）= **NOT PRESENT**；**ACTIVE ALERTING** = **NOT PRESENT**。F3-05 保留为 MINOR（reframed：gating/alerting 缺口），禁止 "health broken" 式合并 |
| reason | 两个 health 端点职责不同：/api/health 是**按设计**的 liveness（route 注释 "public liveness probe"）；DB-aware readiness 由 /api/system/health 承担（本审计实测 DB 指空库时 /api/system/health 能反映 dbResponseMs 且 /api/health 仍 200）。真实缺口在 compose 健康门与主动告警 |
| evidence | apiSurface.ts:42-53；system.ts:304-323；docker-compose.yml:87-96；MEASURED（api-fg.log） |
| affected reports | 05（F3-05）、08（§4 五层表）、11（F3-05 reframed）、12（OPERATOR_DIAGNOSTICS/ACTIVE_ALERTING/RECOVERY 行） |

## 5. Tracker 对账：#498 CLOSED；F2-10 重写为 TRACKER_POINTER_DRIFT

| 项 | 内容 |
| --- | --- |
| original claim | F2-10 NOTE（流程）："#534 tracker 漂移 + #498/#534 双语义位"；10 §2 表把 #498 记为 OPEN、把 #534 与 #498 列为 DUPLICATE_EXECUTION_AUTHORITY 候选；05 §3 "#534 … wait for #516，#516 已关闭" 笼统 NEEDS_HUMAN_RECONCILIATION |
| corrected claim | **#498 = CLOSED**（2026-09-11 COMPLETED，gh issue view 实测）。#534 = OPEN 但**自称 MEMORY ROADMAP — NOT CURRENT EXECUTION AUTHORITY**，其 "current execution authority remains #516 until #516 is formally completed and closed" 的前置文本在 #516 关闭后未 reconcile。合并结论：**CLOSED_TRACKER_STILL_REFERENCED_AS_CURRENT（#498）+ POST-#516_TRACKER_TEXT_NOT_RECONCILED（#534）= TRACKER_POINTER_DRIFT**——documentation/governance finding（NOTE），非 runtime finding，**不存在 duplicate execution authority** |
| reason | ① gh 实测（2026-09-14）：#498 state=CLOSED（"COMPLETED — 2026-09-11"）；#516 state=CLOSED（COMPLETED）；#534 state=OPEN（status 节自述 memory roadmap）；#293 state=OPEN（umbrella，一致）。② live docs **13 处引用**（6 个文件）仍把 #498 标为 live/current tracker：README.md:134、README.zh-CN.md:121、CONTRIBUTING.md:9、docs/README.md:28,52、docs/roadmap/current.md:6,15,28,40,61、docs/roadmap/post-mvp-issues.md:5,11,70。③ 原报告把 CLOSED 的 #498 报为 OPEN（RPT-03）。本 corrective 不修改 tracker |
| evidence | gh issue view 498/516/534/293（OBSERVED_RUNTIME）；grep -rn "498" README*/CONTRIBUTING/docs（13 处引用） |
| affected reports | 10（§2 表、§4）、05（§3 表）、11（F2-10 重写、RPT-03）、12（HIGH_ASSURANCE 行引用 #534 措辞微调） |

## 6. TEST_EXISTS ≠ TEST_EXECUTED：corpus / executed 分离

| 项 | 内容 |
| --- | --- |
| original claim | "454 单测 + 57 E2E" 被当作 executed functional evidence（12 Q3/§1 FUNCTIONAL_CORRECTNESS 依据）；09 §1 "计数（主 agent 实测）" |
| corrected claim | 两套口径分离（09 §1/§4.2）：**corpus** = ≈454 个 Vitest/unit/integration **测试文件**（层计数 54+40+35+181+144；同树不同包含模式 find 结果 469–472 ±3%，如实标注）+ 57 个 Playwright **spec 文件**——**不得写作 "454 个测试通过"**。**executed evidence** = ① CI run 34767087301（event=pull_request，head=cc3f2c9660，2026-09-13）9/9 job 全绿：Static checks / Build / API coverage / Web coverage / Package coverage / E2E shard 1-4/4；② 本审计隔离实验（场景 A–E + 限流，08）；③ 本审计 local verify-static。树身份诚实说明：CI 在 cc3f2c 上执行，`b9b0e08c` 是同一 production tree 的 merge commit（`git diff cc3f2c b9b0e08c` 为空，字节同一性验证）——不隐瞒 SHA 差异 |
| reason | 报告方法论自述 "TEST_EXISTS ≠ TEST_EXECUTED" 但最终裁决又把文件数当执行证据（RPT-05） |
| evidence | .github/workflows/ci.yml（9 job 定义）；gh run view 34767087301（全部 success）；git diff cc3f2c b9b0e08c（空）；find 计数（469–472 波动） |
| affected reports | 09（§1/§4 重写）、12（§1 GENERIC_RUNTIME_CORRECTNESS 依据、Q3、UNKNOWN 清单）、00（§2.1 词汇） |

## 7. Capability 计数统一：89

| 项 | 内容 |
| --- | --- |
| original claim | 04 §2 写 89 但 §6 标题写 "74 caps 汇总"（SA 输出残留）；12 写 "74 caps 闭集"——两数并存 |
| corrected claim | **89**（唯一数字）：`packages/authz/src/catalog.ts` `export const Permission = {…}` 对象体机械计数（正则 `^\s{2}\w+:`）= 89 keys；Admin 预设授予 = 76（同法计数一致）。全报告集与 Issue 摘要统一 89；04 §6 分类矩阵标为 **non-disjoint classification**（SERVER_ENFORCED ≈85 为"89 − 8 DECLARED_ONLY"的上界估计，非逐 key 穷举；任何分类合计不得与 89 直接相减） |
| reason | 内部计数不一致（RPT-06）；分类统计被当作 partition 求和（规则违反） |
| evidence | node/awk 机械计数（89；76） |
| affected reports | 04（§2/§6）、11（统计节）、12（RBAC 行、§1） |

## 8. UI 裁决拆分（五维）

| 项 | 内容 |
| --- | --- |
| original claim | 12 §1 "UI COMPLETENESS = PROVEN（就绪面）/零 dead UI" |
| corrected claim | 06 §7 五维拆分：**UI_ROUTE_REACHABILITY** = PROVEN / NONE DEAD FOUND；**DEAD_PAGE_CENSUS** = ZERO；**UI_OPERATIONAL_COMPLETENESS** = SUPPORTED_WITH_GAPS（teacher/grader assignment 无 UI = F1-04b；ScoreListPage 导出按钮可见但服务端 403 = F2-04）；**UI_CAPABILITY_AFFORDANCE** = SUPPORTED_WITH_GAPS；**UI_SECURITY_AUTHORITY** = NOT APPLICABLE（服务端始终是权威）。禁止 "NO DEAD PAGE ⇒ UI COMPLETE" |
| reason | "零 dead page"只证明可达性，不证明操作完整性；已发现两个反向操作缺口（UI 缺席 / UI 暴露但服务端拒绝） |
| evidence | 06 §2/§7；F1-04b/F2-04（11） |
| affected reports | 06（§7 新增）、12（§1 三行替换） |

## 9. Detection taxonomy 拆分

| 项 | 内容 |
| --- | --- |
| original claim | 05 §1 把 "系统 incident reconcile" 列为 detection 的第三类（"三类：心跳超时、deadline 到期、系统 incident reconcile（→incident+event）"） |
| corrected claim | 分层：**DETECTION**（durable fact 产生）= 心跳超时 predicate（锁下）+ deadline 到期 kernel 复查，恰好两类；**RECONCILIATION / INCIDENT MATERIALIZATION** = episode → incident 的幂等收敛（UUIDv5，dedupe UNIQUE(org,operation)），**不是 detector**；**JUDGMENT** = 人（调查/resolve/dismiss/处分） |
| reason | 检测在 episode 层已结束；reconcile 只回答"已检测 episode 是否物化为 incident"；把 materialization 叫 detector 混淆检测与收敛（00 §2.1 词汇修正） |
| evidence | 05 §1 心跳链重写；systemIncidentCommands.ts:49-71,147-269；incidentOperationRecovery.ts |
| affected reports | 05（§1 表）、00（§2.1）、11（无 ID 变化，register 引用表述随之） |

## 10. F-08-1 severity 统一 + topology 拆分

| 项 | 内容 |
| --- | --- |
| original claim | 08 §4 写 "（F-08-1，MAJOR）"，11 登记为 MINOR——severity 漂移；io 表述 "共享单一出口 IP 的考群约 15 人即触顶" 未区分拓扑 |
| corrected claim | severity 统一 **MINOR（部署敏感）**。按拓扑分别裁决（08 §4 表）：DIRECT LAN（默认 compose）= 不触发；SHARED NAT ≈15 人触顶；REVERSE PROXY WITHOUT TRUSTED CLIENT-IP WIRING = 全体共享反代 IP。finding 统一表述：**DEFAULT RATE LIMIT IS TOPOLOGY-SENSITIVE**（不是 "100 candidates fail"） |
| reason | 限流失败需特定部署配置（共享出口 IP）；默认拓扑（EXAM_PORT 直连、每考生独立 IP）下按设计工作。原始测量数字（30 用户/单 IP、10 login 后 429、全局 100/min）**未修改** |
| evidence | 08 §4（MEASURED）；rateLimitKey.ts:24-30；auth.ts:120 |
| affected reports | 08（§4 重写）、11（F-08-1 表）、12（CAPACITY_SHARED_NAT_100、Q1/Q2） |

## 11. 容量裁决措辞 + 显式 caveats + 交卷风暴尾部延迟

| 项 | 内容 |
| --- | --- |
| original claim | 12 §5 "SMALL_REAL_EXAM（成立）→ … 20-100 candidates proven"；08 场景 D 只给 p50 |
| corrected claim | ① 措辞改为 "**100-candidate generic exam workload SUPPORTED_WITH_GAPS under the measured single-instance topology**"（08 §3 表、12 §1 CAPACITY_* 行）；② 显式 caveats 清单（08 §3.1）：single machine（WSL2）/API+PG+load-gen co-located/one instance/main scenario RATE_LIMIT_DISABLED/rate limiter separately tested/refresh-reconnect storm not tested/large historical dataset not tested/200 not tested/production reverse-proxy topology unknown——任一不成立则该裁决自动降级 NOT_PROVEN；③ 交卷风暴 **p95/p99/max = UNKNOWN / NOT RECORDED**（探针 report() 内置分位数但 submit 模式输出未持久化），禁止从 p50=1.3s 推导尾部 |
| reason | 单机隔离环境一次性实验不足以外推绝对容量；原始数字全部保留；尾部延迟无记录证据（00 §6 补充 UNKNOWN） |
| evidence | 08 §2 场景 A–E / §3.1 / §4（全部 MEASURED 数字原样）；/tmp/exam-audit-notes 无 SUBMIT BURST 输出行 |
| affected reports | 08（§3/§3.1/场景 D）、00（§6）、12（§1/§4/Q1/Q3） |

## 12. Findings register 重建 + RPT findings + REJECTED appendix

| 项 | 内容 |
| --- | --- |
| original claim | 0 BLOCKER / 1 MAJOR / 12 MINOR / 12 NOTE（11 旧统计）；12 引用旧计数 |
| corrected claim | **0 BLOCKER / 0 MAJOR / 12 MINOR / 16 NOTE + 7 REPORT_CORRECTIVE + REJECTED appendix（2）**。变化：F1-04、F1-10 → REJECTED appendix（ID/原始 claim/final disposition/why/evidence 完整可追溯）；F2-10 重写（TRACKER_POINTER_DRIFT，仍 NOTE）；F3-05 reframed；F-08-1 severity 统一；新增 5 条 consolidated NOTE（F2-06/F1-09/F2-09/F3-10/F5-05——存在于分报告但原登记遗漏，登记完整性修正）；新增 RPT-01..07（REPORT_CORRECTIVE 类：false resource-scope projection / ADR status parsing error / tracker state freshness error / authority-vs-operability category error / TEST_EXISTS-TEST_EXECUTED conflation / internal capability count inconsistency / branch ancestry not rooted at declared BASE） |
| reason | 不在旧数字上打补丁，从修正后 findings 机械重算；历史误报不抹除（REJECTED appendix + RPT 显式记录审计自身错误） |
| evidence | 本 changelog 全部条目；git merge-base/rev-list（RPT-07） |
| affected reports | 11（全文件重建）、12（§1/§3 引用计数）、00（§4 索引） |

## 13. Branch ancestry / BASE 标签 / 树身份

| 项 | 内容 |
| --- | --- |
| original claim | 00 报 BASE_SHA=b9b0e08c、分支 master；实际审计 commit `385e836c` merge-base 为 `cc3f2c`（与 b9b0e08c diverged，ahead=1/behind=1），**声明 BASE 不是实际 parent**（RPT-07） |
| corrected claim | corrective 分支真正基于 `b9b0e08c`（`git merge-base b9b0e08c HEAD` = b9b0e08c…，ancestry PASS）；`git diff b9b0e08c -- ':(exclude)docs/research/exam-production-reality-audit-1/**'` 为空（production diff = 0）；树身份：b9b0e08c 与 cc3f2c 字节相同，CI 证据按树身份引用 |
| reason | audit commit 重造了 merge commit（385e836c = Merge ae1052f8 cc3f2c96），未经过 b9b0e08c；corrective 要求 "b9b0e08c ↓ REPORT-CORRECTIVE docs commit(s)" 的干净图 |
| evidence | git merge-base/rev-list --left-right（corrective 前后）；git diff cc3f2c b9b0e08c（空） |
| affected reports | 00（§4/头部）、12（§7）、13（本条目） |

---

## 7. Corrective 验证记录（实际执行）

```text
git diff --check                                   → PASS
pnpm verify:static                                 → PASS（见 12 §7 与 terminal output）
git diff b9b0e08c -- ':(exclude)docs/research/exam-production-reality-audit-1/**' → 空（ZERO production diff）
test "$(git merge-base b9b0e08c HEAD)" = b9b0e08c… → PASS
```

## 8. 一致性命中（consistency gate）

```text
capability count     89（全报告集；无 74）
BLOCKER count        0      MAJOR count  0
MINOR count          12     NOTE count   16
RPT count            7      REJECTED     2
F1-04 disposition    REJECTED（04/05/11/12 一致）
F1-10 disposition    REJECTED（10/11 一致）
F-08-1 severity      MINOR（08/11/12 一致）
#498 state           CLOSED（10/11/05 一致）
ADR-010 status       Accepted（10/11 一致）
ADR-018 classification ALIGNED + operability gaps（05/08/10/11/12 一致）
CAPACITY_100 wording "SUPPORTED_WITH_GAPS under the measured single-instance topology"（08/12 一致）
UI completeness      无单维 PROVEN（06/12 一致）
deployment suites    9（01/08/11/12 一致）
route modules        27（00/02 一致）
contracts sources    30（00/01 一致）
UI_EXPOSED keys      37（04 唯一计数点，basis=grep）
```

## 9. Issue #540（audit issue）状态说明

- 本 corrective 的授权写路径只有 `docs/research/exam-production-reality-audit-1/**`；**未修改任何 GitHub Issue**（包括 #540）。
- #540 body 目前仍携带 pre-corrective 结论：F1-04 MAJOR（CONFIRMED）、"0 BLOCKER · 1 MAJOR · 12 MINOR · 12 NOTE"、"UI COMPLETENESS PROVEN（零 dead UI）"、"454 单测 + 57 E2E" executed 表述（仅 capability 行碰巧为 89）。**这些与 corrected 报告集不一致**。
- 处理选项（human 决定）：(a) 更新 #540 顶部标注 `REPORT-CORRECTIVE-1 APPLIED` 并列出 F1-04 REJECTED / ADR-010 ALIGNED / ADR-018 ALIGNED / #498 CLOSED / evidence labels corrected，把 current authoritative report 指针指向 corrective HEAD；(b) 追加 corrective 评论保留原版；(c) 两者皆可。原始审计结论作为历史版本保留在分支 `audit/exam-production-reality-1`（HEAD `385e836c`），不会因任何操作被改写。

## 10. Fresh-context 复核（SA2）处置

14 报告记录 fresh-context reviewer（无预设结论）对 corrected 报告集的攻击结果。其 11 项 defect 已逐项处置：

| defect | 处置 |
| --- | --- |
| 1. 00 "11 NOTE" vs register 16 | 修正为 16（00 §4） |
| 2. submit p50 与尾部证据不对称 | 建立三档证据层级（TIER-1 retained / TIER-2 prose / TIER-3 unknown），p50 与尾部同标准标注（08 §2） |
| 3. #540 仍携带旧结论 | 显式记录（本 §9、00 §6）；不改 Issue（授权外） |
| 4. 01 "8 个部署测试" vs 9 | 修正为 9（01 §1） |
| 5. contracts "32 源文件" vs 30 | 修正为 30（00/01） |
| 6. 02 "route module ×26" vs 27 | 修正为 27（02） |
| 7. UI_EXPOSED "39" vs 37 | 修正为 37，basis=grep（04 §6） |
| 8. 05 severity "LOW" 不在词表 | 改 NOTE（05 §4 + ADR-011 行） |
| 9. 场景 B "p95 ≤30ms 无跨端点劣化" 与 retained log 矛盾 | **接受**：从 steady-out.log 重新推导真实分布（answer p50≈33/p90≈406/p95≈552/max≈708；heartbeat p95≈517；take p95≈95），改写 08 场景 B、08 §3、12 相关行 |
| 10. 开局风暴百分位数同属未保留输出 | 标注 TIER-2（08 场景 A；12 UNKNOWN 清单同步） |
| 11. "8 处" vs 13 处 tracker 引用 | 修正为 13 处（13 §5、11 RPT-03） |

除 defect 9 外均为计数/标签修正；defect 9 是 corrective 最重要的收获之一——原审计对稳态延迟的"p95≤30ms 无劣化"结论与其自留 artifact 矛盾，已按 artifact 重写为池排队重尾形态（正确性证据不变：0 错误）。