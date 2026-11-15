# PROTOCOL-v3 — 观测性开销 A/B 实验（v3，v1/v2 阻断后的重预注册）

- **状态**：v3 **新实验预注册**（非 v2 的修订）。依据 v2 §8.1（`PROTOCOL-v2.md:316`）："放宽类修改不属于修订，只能作为新实验另行预注册"——v3 对 v2 的评估面（§3.4档位合取、S 子矩阵、隔离档类集）有显式收缩/重组，故按**新预注册**立项并全文显式声明差异，不做静默放宽。**冻结点 = 首个正式 segment 启动采样**（机械冻结标记见 §9.1 第 5 项）；冻结前允许且仅允许 **§9.1 清单所列项**（该清单为唯一权威：§5 参数回填、§4.1 干扰界与逐 face 刻画登记、K_pilot/MDE 落定、manifest 钉更新、冻结记录、§6.5 机器路径前置、README 同步、R2 原文核对；记录进 pilot register/冻结记录与本文件修订日志，不算改协议）；冻结后按 §9.2，唯一总则是 v2 §8.1 单调性（只能更严或更明确）。
- **角色与授权**：本协议由实验方法学（协议设计）角色在审计树 `/home/hoo/Source/exam-otel-audit` 内撰写；执行（Stage D–G 真实采样）另行授权。本协议本身不授权任何采样、数据库或 Docker 操作。v1（`PROTOCOL.md`）与 v2（`PROTOCOL-v2.md`）保留不动（本会话哈希复核见修订日志与附录 A）。
- **参考输入**：同目录 `PERFORMANCE-REPORT.md`（§3 B1–B4 与 §5 探索值）、`COMPONENT-ATTRIBUTION.md`（§6 解除阻断路径）、`PROTOCOL.md`/`PROTOCOL-v2.md`（继承条款的被引用权威）、`REALITY.md`、`WORKFLOW-INVENTORY.md`、`COVERAGE-MATRIX.md`、`GAPS-AND-PRIORITIES.md`；harness 侧 `scripts/perf/otel-workflows/runner.js`、`configs.json`、`README.md`（R2 修复后工作树版本）；`docs/adr/ADR-028-opentelemetry-technical-telemetry.md`（PROPOSED）；**R2 复核结论 verdict 表（ask 材料，本文件 §1.3 逐字记录）**。
- **证据等级约定**（沿用前版）：`MEASURED`＝本会话实际执行的命令输出；`CODE_VERIFIED`＝本会话读仓库源码/文档定位；`转引`＝来自既有记录/ask 材料，本会话未复核；`UNKNOWN`＝无法验证，禁止当事实使用。
- **本会话验证命令清单**见附录 A；UNKNOWN/SKIPPED 预登记汇总见附录 B。

---

## 1. 为什么 v1/v2 无法完成

### 1.1 采样终态（被引用权威：PERFORMANCE-REPORT.md）

v1/v2 冻结协议下的正式采样全部记录为 **BLOCKED：45 个已记录 segment，0 个有效**（`PERFORMANCE-REPORT.md:6`，§3 `:48-55`【转引｜本会话未重跑普查，但其命令清单见 `COMPONENT-ATTRIBUTION.md` §7】）；重算聚合 `rows: []`（`PERFORMANCE-REPORT.md:23-28`）；有效配对 = 0 < 6 → T1–T4 全部无判定依据、如实报 UNKNOWN（`PERFORMANCE-REPORT.md:55`，引用 v1 §6.4/§7.5）。四个无效原因 B1–B4 在 45/45 已记录段（非 pilot 正式段 40/40）上**全部命中**，即：在 v1/v2 的冻结参数与环境纪律下，**不存在能产出有效段的执行路径**——这是 v3 必须重预注册的直接原因。

### 1.2 B1–B4 逐项（引用 PERFORMANCE-REPORT.md §3，附 v3 处置）

| # | 无效原因（证据行） | 机制 | v3 处置 |
| --- | --- | --- | --- |
| **B1** | `steady window exceeded 180s before quota completion`（`PERFORMANCE-REPORT.md:50`）：混合档配额、`steadyMaxSeconds=180`、`concurrency=10`，实测段吞吐 19.31–23.05 ops/s。报告按当时朴素求和口径 12000 ops 推得需 ~520–620s；**R2-02 修正权威配额口径后为 11000 ops**（harness `buildOpPlan` 只读 16 个逐类键、c4Rejects 组总额不重复计入，`scripts/perf/otel-workflows/README.md:217-228`、`runner.js` precheck item 1 `runner.js:4322-4329`），按同一吞吐区间需 ~477–570s——**超窗 ≥2.6×，结构性互斥，与负载/遥测形态无关** | 配额×时窗×并发三元组不可行，任何段注定无效 | §4.2 可行性判据（ratio ≤ 0.8 才准入）+ §5 三元组回填通道；失败即停规则 4 |
| **B2** | `proc sampler produced no steady-window CPU pair`（`PERFORMANCE-REPORT.md:51`）：旧实现 `await sleep(60)`（60ms）后取 `cpuStart`，而采样 tick 1000ms ⇒ samples 必空 ⇒ `cpuStart` 必 undefined ⇒ 必走 invalid 分支——**任何跑满 180s 的段都必然带此原因**【CODE_VERIFIED，报告会话逐行确认】 | harness 采样时序缺陷（CPU 差分基线取在错误时刻） | 已修复（R2-01，见 §1.3）：sampler 注册即采样、稳态窗只在真实首样本落地后开启、首样本缺失/样本 <2/计数非单调 fail-closed 判段无效（`runner.js:99-102`、`README.md:192-200`；selftest `5c`/`5d` 注入矩阵回归，`README.md:340-346`） |
| **B3** | `1m loadavg X > 4.0 inside segment`（`PERFORMANCE-REPORT.md:52`）：45/45 段段内 max load1 ∈ [4.48, 7.11]，均值 5.90（阈值 4.0）——运行窗内不满足 quiet-machine 纪律；**负载来源未定位（UNKNOWN）** | 入口无干扰界验证 + 段内界 4.0 与（未刻画的）自身负载贡献的关系未知 | §4.1 干扰界程序：实测 idle loadavg 定入口界 + pilot 单段自身负载刻画；自身负载超 4.0 → 正式采样禁止启动、呈报 Owner（失败即停规则 8） |
| **B4** | oracle 正确性失败 15.51%–21.06%（`PERFORMANCE-REPORT.md:53`）：heartbeat 409×351、takeUnchanged 被改写×218、login 401×50、save* 回 ATTEMPT_ALREADY_SUBMITTED×74 等，跨配置同量级、与遥测无单调关系 | 报告当时判"机制假说未证实"；v3 前置工作已行级坐实：fixture 槽位候选人复用（`i % 1200`）× `POST /start` resume 语义 ⇒ 跨池共享同一条 attempt 行 = "后台终态化"根因；另 harness 交错制造同 attempt 并发保存假阳性（R2-03） | 已修复（数据级，不改生产 loop）：每槽位独立候选人（3000 池 ≥2820 槽，owners==slots fail-closed）、标准池与 scanner 池分离、窗入口过期 in_progress 守卫、per-attempt 保存串行锁、W09 专池场景（`README.md:248-302`；修复前后证据 `b4-repro/`，`README.md:430-439`；selftest `7b`/`7c`/`7d`） |

历史探索值（未配对、无效段，PERFORMANCE-REPORT §5 `:89-110`）——H0 vs H1 −0.3%、H2 vs H1 +3.3%、H4 vs H1 +10.8% CPU ms/op 等——按其自身声明**不进任何判定**，v3 亦不沿用其数字；仅作为"方向性先验"记录。

### 1.3 R2 复核结论（verdict 表，ask 材料逐字记录）

R2 复核对 9 项发现的裁决为（ask 材料原样转写；本会话未持有 R2 评审原文，见附录 B.1）：

| id | verdict | 本会话可核对的落盘修复证据 |
| --- | --- | --- |
| R2-01 | VERIFIED | sampler 注册即采样 + fail-closed 判定矩阵：`runner.js:99-102` 注释、`README.md:192-200`；selftest `5c sampler-first-sample-regression`（活进程首样本 t+<100ms）与 `5d cpu-pair-failclosed-injection`（三态注入全判无效）`README.md:340-346` |
| R2-02 | VERIFIED | 权威配额 = buildOpPlan 派生 11000（c4Rejects 组总额不重复计入）：precheck item 1 `runner.js:4322-4329`、`README.md:217-228`；selftest `5b`/`5f` 反例拒绝 `README.md:337-339,351-355` |
| R2-04 | VERIFIED | aggregate 按 workflow 维度分组（mixed + iso-*，跨 workflow 永不交叉）：`runner.js` aggregate 注释（工作树 diff "Workflow-aware (R2-04 fix)"）、`README.md:70-78`；selftest `5e aggregate-workflow-dimensions` `README.md:347-350` |
| R2-03 | **PARTIAL** | 已落盘面：per-attempt 保存串行所有权 `withAttemptSaveLock`（`README.md:248-256`）、concurrent-save 独立实验类与批级 oracle（`README.md:258-265`）、修复前后定向复现 pre-fix 17 违例 → post-fix 0 违例（`README.md:430-439`）、selftest `7c`/`7d`。PARTIAL 的剩余面无法从本会话可得材料重构（R2 评审原文不在审计树，grep 证据见附录 A.6）——处置：v3 将 R2-03 相关不变量全部转为 fail-closed 守卫与回归自检（§6.1 item 2、§6.2 窗入口守卫、失败即停规则 7），并在 Stage D–G 启动前要求执行会话核对 R2-03 原文的未闭合面（§9 冻结前义务） |
| R2-05 | **PARTIAL** | W07 归位项——按 ask 指令落为本文件 §8.3；finding 原文不在审计树 |
| R2-06 | VERIFIED | 可移植性契约：configs.json 零绝对路径 + `${ENV}` 模板 + run-meta 落盘（`configs.json:4`、`README.md:151-161`；selftest `2b portability-manifest` `README.md:356-359`） |
| R2-07 | VERIFIED | 落盘证据无法定位（grep 无命中，附录 A.6）；verdict 以 ask 材料为准记录。Stage D–G 冻结前义务同 R2-03（§9） |
| R2-08 | **PARTIAL** | 落盘证据无法定位（同上）；verdict 以 ask 材料为准记录。同 §9 冻结前义务 |
| R2-09 | VERIFIED | 落盘证据无法定位（同上）；同 §9 冻结前义务 |

**结论**：v1/v2 的阻断四因中，B2/B4 的 harness 面已有修复与回归证据落盘（R2-01/02/03/04/06）；B1/B3 属协议参数与环境纪律问题，正是 v3 §4/§5 的规范对象。v3 的立足点 = **修复后的 harness + pilot 先证可行性/干扰界/自身负载 + 参数回填后冻结**。

---

## 2. 预算与判定不变（继承，不重开）

1. **预算唯一权威：ADR-028 §3 表三**——CPU 额外开销 vs Off 基线 **≤5%**（`docs/adr/ADR-028-opentelemetry-technical-telemetry.md:99`）、p99 额外开销 vs Off 基线 **≤5%**（`:100`）；预算初始值来源 #964（`:104`）。ADR-028 状态 **PROPOSED**（`:5`）——本实验只产出其评审输入，不构成生产启用授权，也不改其状态。
2. **验收基线 = 同 SHA H1**（`1d689b4a2db3501810bfbfeb7b1a7c7c88c0cc65`，master HEAD；`TELEMETRY_ENABLED=false`）。H0（`cb1e614fe087e7ac158deef4a4de7f29268de292`，v0.0.15）仅按 §8.2 边界作背景，不进验收判定（继承 v2 §6.6-4）。臂定义沿用 v2 §1.1，harness 实现在 `configs.json`（`README.md:164-179` 表）。
3. **判定规则沿用 v2 §6.4 表 + §7.5**：95% CI 上界 ≤ +5% → PASS；下界 > +5% → FAIL；CI 跨 +5% → UNKNOWN；有效配对 <6 → UNKNOWN；IQR > 5pp → UNKNOWN；任一指标 UNKNOWN → 该配置对总体 UNKNOWN（合取）。**CI 同时含 0 → 该指标另标 `INCONCLUSIVE@0`**：禁止声称"零开销/0%"，禁止把 INCONCLUSIVE 写成 0%（v2 §6.4/§7.5 原语义，v3 重申）。
4. **不得用历史数据替代本次判定**：PR #980 记录的 pre-#994 栈数字（On/no-export CPU +10.4%、On/full-OTLP +9.1%，v2 §7.4【转引】）与本实验 v1 无效段探索值（§1.2 末）都只是背景；T1–T4 判定只能来自 v3 冻结参数下采出的 ≥6 有效配对。两条历史记录（历史 FAIL 与 v1/v2 UNKNOWN）继续并存呈报 Owner。
5. **验收面其余项沿用 v2 §7.2/§7.3**（T5 Off 零面、T5b H2 零导出面、T6 server span 计数、T7 oracle、T8 故障注入、T9 关机 30s、T10 探针 n=1 口径）。harness 支持状态如实声明：**自动测量** = T7（逐段 oracle + validate 重放，`README.md:312-324`）、T9（逐段 SIGTERM→exit 计时自动执行，`runner.js:89` 预算 30s；T9 的失败判定语义见第 6 条——as-built 为记录不判段无效）；**操作程序（无自动流程，采样阶段由授权会话执行）** = T5/T5b（≥30min 网络/连接审计；H2 的"信号实际产生"旁证通道缺失，见附录 B.4）、T8（otlp-sink reject/slow 手动注入后走 round/validate，`README.md:393-398`）、T10（`--expose-gc` 探针 H0/H1 各一次）、T6（H3 dump 离线审计）。**v3 评估面差异声明**（相对 v2 §7.1，显式非静默）：v2 的"低/典型/拐点三档合取"在 v3 重定义为 §3 的 A/C 类（典型档）承载 T1–T4 判定、B 类（拐点梯度）明确不承载预算判定（§3.B）、低档（C=1）不在 v3 采样计划内（范围收缩，呈报 Owner 的显式范围限制，不是 UNKNOWN 判定）；S 子矩阵不在 v3 默认采样面（§3.5）。
6. **T9 失败处置（v3.1 新增，补验收面分支）**：as-built T9 语义为"记录不判段无效"（`runner.js:2494-2500`：超 30s 仅记 notes "recorded, not segment-invalidating"）。v3 冻结处置：T9 不作废该段**已完成稳态窗**的性能统计（稳态窗在关停前已闭合），但 T9 作为验收项**独立判定**——任一有效段 SIGTERM→exit > 30s 或 exit code 与基线臂不一致 → T9 项 **FAIL** 并强制呈报 Owner（ADR-028 表三业务行为行 `:98` 预算面）；逐段记录、不合并；T9 FAIL 不自动改写 T1–T4 数值判定，但生产启用裁决前 Owner 必须逐项处理（与 FLAGGED-CLASS 同级义务）。
7. **预算口径补齐声明（v3.1 新增）**：ADR-028 表三 `:99-100` 的 ≤5% 未指明负载模型与"Off 基线"所指构建；本协议以"同 SHA H1 基线 + §3 负载模型"补齐该口径——这是协议层对 PROPOSED ADR 的读法（沿用 v2 §7.1，自洽），ADR 被接受时若 Owner 对口径另有裁决，本协议判定面随 ADR 定稿语义走。ADR `:104`"样本不足或波动过大时报告未知，交 Owner 裁决"与本协议 UNKNOWN 语义一致，无冲突。

---

## 3. 实验分类（A/B/C/D：各回答什么、不回答什么）

四类映射到 harness 三套件（`runner.js:124-131` `SUITES`：mixed={H0,H1,H2,H3,H4}；isolated={H1,H2,H4}×{iso-C1 health, iso-C3 save-accepted, iso-C5 submit-grade}；knee={H1,H4} 梯度）：

### 类 A —— 固定负载延迟（mixed 套件 @ 典型档，T3/T4 判定输入）

- **做法**：混合档（C1–C7 配额流，v2 §3.1/§3.2 权重）在固定并发 P_CONC（§5；v3.2 起 **BLOCKED**——§4.1 封锁记录）下采 H0–H4，每单元 ≥6 有效配对。
- **回答**：固定并发闭环负载下，On 态（H2/H4）相对同 SHA Off（H1）的逐操作客户端时延分位（p50/p95/p99）配对增量；承载 T3/T4（p99 ≤ +5%）。
- **闭环语义（显式标注，防误读）**：客户端是闭环固定 worker——C 个 worker 消费有限 op 计划、每 worker 严格串行、think time=0（v2 §3.5；harness `runner.js:147-153` 注释与每个 segment-summary/`###SUMMARY###`/`###AGG###`/`###CAMPAIGN###` 的 `throughputSemantics` 字段，`README.md:304-310`）。`throughputOpsPerSec = C / 平均延迟` 是**固定并发下的饱和度量，不是恒定到达率下的测量**；p50/p95/p99 是"该并发下"的逐操作客户端时延样本。
- **不回答**：恒定到达率（开环）时延与排队论意义上的系统响应；低负载/空闲态时延；生产到达模型的容量或 SLA 数字（WSL2 探索级边界，v2 §2 声明继续适用）。

### 类 B —— 最大吞吐/容量拐点（knee 套件，梯度负载；**不承载预算判定**）

- **做法**：H1/H4 在梯度档 [⌊K_pilot/2⌋, K_pilot, min(2×K_pilot, 200)]（去重升序；`runner.js` `kneeGradientGears`）各采 ≥6 有效配对；单元键 `H1@c25` 形态（config×档位，`README.md:99-100`）。K_pilot 缺失且未显式 `--concurrency` → 拒绝启动（`runner.js:4983-5015`）。
- **回答**：H1/H4 的吞吐-时延形态与容量拐点位置（p99 相对前档 >2× 阶跃，或资源先耗尽档）；On/Off 拐点是否移动；拐点邻域的形态差异证据。
- **不回答**：**T1–T4 预算判定**——拐点邻域属饱和域，闭环饱和语义下 per-op CPU/p99 的含义与运行域不同，v3 不在该域 issuing 预算判定；拐点档的 H4-vs-H1 配对数字按 §6.4 同法计算但**只作报告面证据呈报 Owner**，注明饱和域；H2 不在 knee 套件（harness 组成所限）→ H2 的拐点档证据 = NOT_SAMPLED（显式声明，非 UNKNOWN）；生产容量（探索级）。
- **as-built 聚合封锁（v3.1 显式声明）**：knee 段的 workflow 标签恒为 "mixed"（`SUITES.knee.workflow="mixed"`，`runner.js:129`），而 aggregateCore 配对键 = (round, workflow, config) 且同键后写覆盖（`runner.js:246-281`）→ 同一 sweep 内 H1@c25/H1@c50 同键覆盖、跨档位误配对。**knee 配对数字在 §6.5(b) 落地前不可机器产出**——本类全部产出以该前置落地为条件；未落地时 knee 套件禁止启动正式段（与 (a) 同为冻结前置）。

### 类 C —— 混合负载端到端成本（mixed 套件 @ 典型档，T1/T2 判定输入）

- **回答**：全系统端到端成本——混合档 CPU time/op 配对增量（T1：H2 vs H1 ≤ +5%；T2：H4 vs H1 ≤ +5%）、吞吐、error/oracle 计数、RSS；混合档按 C1–C7 类的时延配对增量中位数与 95% CI 进强制分位报告面（继承 v2 §7.1 分位报告面与 FLAGGED-CLASS 规则：任一类 CI 上界 > +5% → 该类标 FLAGGED-CLASS 强制呈报 Owner；FLAGGED 不改写 T1–T4 数值判定，本协议无权创设 ADR 之外的类级预算）。
- **不回答**：按操作类的 CPU 归因——进程 CPU 是全局量，混合档不可按类分派（v2 §5 冻结声明，harness 同口径）；单因子导出成本——H4−H2 是多因素和（metric provider 装配 + 序列化 + 导出 I/O + 背压），禁止读作"纯网络导出成本"（v2 §6.8）；W13/W14（不在混合档，v2 §3 同）。

### 类 D —— 单工作流隔离成本（isolated 套件；报告面，永不进预算判定）

- **回答**：单类独占段下 H1/H2/H4 的类级 CPU time/op 与时延配对增量（iso-C1 health、iso-C3 save-accepted、iso-C5 submit-grade；类配额从冻结 quotas 投影，`runner.js:112-116`），服务 per-signal/per-class 归因（REALITY E1/E3 的组级近似），进强制分位报告面并适用 FLAGGED-CLASS。
- **不回答**：预算判定（v2 §7.1/§3.2 原语义：隔离档不进 T1–T4）；后台循环/扫描器共存行为（隔离档设计上排除之——共存形态只由 mixed 档承载）；v2 §3.2 曾列的 C6-W08（take）与 C2（login）隔离类**不在 v3 采样面**（harness v3 三类收缩，`README.md:382-387`）——W08 类级隔离归因 = 显式范围收缩项，呈报 Owner。
- **W09/W11/W12 低频腿的归属**：W11（retention 启动 pass 对账）与 W12（fake drain 对账）作为 mixed 段的低频观测腿（`README.md:239-241`）单独报告、不入全局 p99 聚合（继承 v2 §3.1 末）；W09 真实自动提交**不在计量窗内**（B4 隔离设计），由 `runner.js w09` 专池场景作正确性证据（`README.md:108-119`；实测记录 `README.md:440-444`）——W09 的时延/预算 = NOT_SAMPLED（显式声明）。

### 3.5 S 维度（采样率）与 v2 评估面的显式收缩清单

- S 子矩阵（v2 §1.3：{H2,S0}/{H2,S1}/{H4,S0}/{H4,S1}）**不在 v3 默认采样面**：harness 三套件不含 S 配置（manifest 有 S0/S1/S2 命名条目可加，`README.md:177-179,388`）。v1/v2 的 S 面从未产出有效数据；v3 优先解除预算判定阻断。如 Owner 需要 S 面，按 §9 以追加套件方式扩展（新预注册决定，不入本版判定）。
- 显式收缩清单（相对 v2）：低档混合单元（C=1）；拐点档预算判定（改为 B 类报告面）；H2 拐点档采样；W08/W01 隔离类；S 子矩阵。每项都是**新预注册的范围决定**，逐项呈报 Owner，不做静默缩窄。
- **正式采样的承载命令（v3.1 明确）**：正式判定单元统一由 campaign 套件承载（停机规则机器强制）；`round` 命令只承载 round-0 诊断/刻画段（§4.1/§4.2）与操作者手动诊断，**不得承载正式判定单元**——as-built `cmdAggregate` 只读 `rounds/round-N/`（`runner.js:4712-4747`）而 campaign 产物无聚合路径（§6.5(a)），两条命令路径各缺一半能力，本协议以"campaign 承载正式 + 聚合桥前置"封死该缺口。

---

## 4. pilot 规范

pilot 的唯一目的：**在正式采样前证明"该环境 + 该参数三元组"能产出有效段**，并把 §4.1 干扰界与 §5 三元组回填数值落定。pilot 数据（round 0 约定）永不进正式统计（harness `pilot` 命令已实现该约定，`README.md:80-87`；`cmdPilot` `runner.js:4886-4966`）。

### 4.1 干扰界（用实测 idle loadavg 定阈值，依据如下）

**测量程序（冻结）**：pilot 开始前 ≥10 min 宿主静默（无实验负载）；以 30s 间隔采样 `/proc/loadavg` 的 1m 值 ≥20 次（覆盖 ≥10 分钟），记录全序列、取 idleMax（最大）与 idleMed（中位）。宿主常驻拓扑（exam-dev-db/redis、sharp_saha tempo——v2 §2.1 快照项）视为环境组成部分，不算干扰。

**预注册公式**：

- **环境合格判据**：idleMax ≤ 1.0 → 合格；idleMax > 2.0 → **不合格，pilot 中止**（失败即停规则 1）；1.0 < idleMax ≤ 2.0 → 延长静默 ≥10min 重测一轮，仍 >1.0 → 不合格中止。
- **入口界 B_entry = max(1.0, 2 × idleMax)**（上限恒为 4.0）：每次段启动前实测 1m loadavg ≤ B_entry 才允许启动该段。
- **定稿值（v3.2，pilot 实测回填）**：B_entry = **1.24**——实测 idle 序列（2026-11-15，≥10min 静默，30s 间隔 ×24）：idleMax=0.62、idleMed=0.18（`out/otel-w964/workflow-audit-v3/run-meta/idle-loadavg-20261115.txt`，含全序列）；2×0.62=1.24 ≥ 下限 1.0 ✓、≤ 上限 4.0 ✓；idleMax ≤ 1.0 → 环境合格判据一次通过（无延长重测）。
- **段内硬剔除维持 4.0**（v2 §6.5-1 继承；harness `LOADAVG_HARD_LIMIT = 4.0`，`runner.js:93`；段内采样 >4.0 判段无效，`runner.js:2483-2485`）。时钟跳变 >1s 同为硬剔除（`runner.js:94,1018,2490`）。

**依据**：(i) 本会话实测 idle 序列（2026-11-15，6×20s）：1m 0.15→0.03 单调衰减、5m 0.84→0.59、15m 1.68→1.51——空闲宿主 1m 可低至 ~0.03，但 5m/15m 残留证明前序活动衰减需以分钟计；(ii) 1m 均值的物理性质——前一段实验自身负载（历史段内 max 4.48–7.11，`PERFORMANCE-REPORT.md:52`）在段结束后仍计入 1m 窗数分钟，入口界必须吸收该残留，否则要么空转等待、要么带残损入口采样；2× idleMax + 1.0 下限即为此设计，且 4.0 上限保证入口纪律不松于冻结硬界；(iii) B3 教训：v1/v2 **没有入口界**，段内界 4.0 又未区分"外部干扰"与"自身负载贡献"，导致 45/45 全灭而负载来源 UNKNOWN——v3 把两者分开刻画（见下文 face 刻画登记）。

**Face 刻画登记（v3.1 收紧，替换原"pilot 跑 1 个 H1 段"的过宽推断；冻结）**：

- **face = (suite, workflow, gear, config)**。每个将进入正式采样的 face 必须先持有**刻画记录**：一段在冻结参数下**跑完配额**的 `valid:true` 诊断段（round-0 约定），且同时满足：入口 1m loadavg ≤ B_entry 且读数已落盘（见下条落盘义务）、段内 max load1 ≤ 4.0、oracle 零违例、窗入口过期守卫为 0。mixed 与 knee face 的刻画段 as-built 承载命令 = `round --round 0 --configs <config> --concurrency <gear>`（`cmdRound` 支持 `--concurrency`，`runner.js:4406-4409` 与 harness `README.md:146-147`；round-0 为 pilot 约定轮、aggregate 显式排除，`runner.js:4721-4727`）。
- **isolated face 的 as-built 例外（显式声明）**：`cmdRound` 签名无 `--workflow` 参数（`runner.js:4406-4409`，仅 `{round, configs, concurrency, gcObserve}`），单类诊断段无 as-built 命令可产出 → isolated face 以**首个正式段兼任刻画**，并适用 §4.3 规则 10 的即时升级（一旦段内超界即暂停该 face 并呈报 Owner，不烧后续 attempt）。此差异是 as-built 能力边界，如实声明，不假装已刻画。
- **K_pilot 阶梯 = 侦察，不构成刻画许可**：`pilot --config H1` 门控并发钉 `PILOT_GEARS[0]=25`、阶梯固定 {25,50,100,200}、无 `--concurrency` 参数（`runner.js:4877,4886-4895`），只用于 K_pilot 侦察与 knee 档可行性预筛。**机械规则**：阶梯中档 C_g 的段内 max load1 > 4.0 → knee 梯度中该档的两个 face（H1、H4@C_g）从梯度剔除并记录；全部梯度档被剔除 → knee 套件判 NOT_SAMPLED、显式呈报 Owner（C=100/200 在 20 核宿主批量越界的可预期风险，在侦察阶段暴露，不以烧正式 attempt 的方式发现）。
- **刻画许可范围（修正原"pilot 通过 = B3 解除，正式采样放行"的过强表述）**：一条刻画记录只许可**同一 face** 的正式采样。H1@典型档的刻画不外推到 H2/H4（导出 I/O 改变负载形态），不外推到 knee 档（C≤200 自身负载未证），也不外推到 isolated 档（后者按例外条款处理）。未持刻画记录的 mixed/knee face 禁止启动正式段。
- **入口读数落盘义务（v3.1 新增）**：每段的入口 1m loadavg 读数必须落盘。as-built 来源 = 预检门 item 4 的 check detail（`entry loadavg=… ≤ 4.0` 字符串，`runner.js:4352-4360`）与 campaign 段前干扰复查 notes（`runner.js:5130-5138`）；执行会话须将其逐段归档（run-meta 或段目录）。无落盘入口读数的段**不具统计资格**（B_entry 合规不可审计即不可采）。
- **刻画失效与重跑（v3.1 新增，封时间维度缺口）**：刻画段窗口必须等于冻结 P_STEADY——段内 load1 持续最大值随窗长上升（1m 均值向段自身负载稳态收敛），180s 窗通过的刻画**不能外推**到更长窗。任何使 P_STEADY 相对已刻画值上调或 P_CONC 变更的回填，作废受影响 face 的刻画记录并强制重跑；冻结时全部 face 刻画记录必须处于最终参数下。
- **同目录覆盖警示（v3.1 新增）**：同一 face 的探针段与确认段都落 `rounds/round-0/<config>/` 同名目录——执行会话须在每次同三元组复用命令前归档上一段产物（重命名/移入 run-meta 归档目录）并在 pilot register 记录路径；未归档导致的产物覆盖属执行缺陷，被覆盖段须重跑。

**P_CONC 封锁记录（v3.2，pilot 实测；§4.3 规则 8 触发；冻结点未到达，正式采样继续封锁）**：

实测负载阶梯（H1，同 fixture；本会话探针 + H1 阶梯 pilot.json + 13:05 同参数历史段，归档路径见 pilot register）：

| C | ŷ (ops/s) | 段内 maxLoad1 | 来源 |
| --- | --- | --- | --- |
| 1 | 9.738 | **4.86** | 探针（本会话） |
| 2 | 10.532 | **6.00** | 探针（本会话） |
| 5 | 11.298 | **5.80** | 探针（本会话） |
| 10 | 9.774 | **6.72** | 13:05 历史段（同 fixture） |
| 25 | 11.34 | **6.24** | pilot.json 阶梯 |
| 50 | 11.064 | **6.01** | pilot.json 阶梯 |
| 100 | 11.009 | **6.09** | pilot.json 阶梯 |
| 200 | 10.944 | **5.20** | pilot.json 阶梯 |

实测结论：(i) 吞吐在**所有并发档后端饱和于 ~9.7–11.3 ops/s**（C=1 与 C=200 相差 ~14%）——闭环并发不是本机吞吐杠杆；(ii) **段内 maxLoad1 在全部已测档 > 4.0**（最低 4.86 @ C=1；持续自载地板 median 3.9–4.5 与 C 无关，开窗首分钟另叠加 converge/extend/prep/warmup 残留峰 4.3–6.0）；(iii) 缩窗/降配额对负载无效（负载 ∝ 后端吞吐 ~10 ops/s，与配额与窗长无关）。→ §4.3 规则 8 的候选处置中"降 P_CONC"已实测穷尽至 C=1、"缩窗降配额"实测无效；**典型档（与全部档位）无可行 P_CONC，face 刻画不可能通过**。H2/H4 min-over-arms 探针、逐 face 确认段、K_pilot 已定但 knee 梯度已全档剔除（pilot.json notes）均受同一封锁。处置 = 呈报 Owner（已按 §4.3 规则 8 升级）：候选 = Owner 显式批准段内界修订并出 v4（v2 §8.1：放宽类修改只能作为新实验另行预注册）/ 更换宿主 / 重新定义干扰口径（外部-only）。**本协议无权代决；冻结核心 4.0 保持原值不动（这正是不放宽原则的执行）**。

### 4.2 可行性判据（目标并发与时窗下完成工作量；per-arm、两阶段、as-built 可执行）

**v3.1 修正前提**：as-built `cmdPilot` 无 `--concurrency` 参数、门控并发钉死 `PILOT_GEARS[0]=25`、阶梯固定 {25,50,100,200}（`runner.js:4877,4886-4895`）——**(P_CONC, P_QUOTA, P_STEADY) 三元组的刻画不得经由 `pilot` 命令承载**。as-built 承载命令 = `round --round 0 --configs <config> --concurrency <C>`（§4.1 命令锚点）。pilot 程序据此定为两阶段：**v3.2 状态**：H1 吞吐探针已在 C∈{1,2,5}（本会话）与 C∈{25,50,100,200}（pilot.json）实测；H2/H4 探针与全部确认段受 §4.1 封锁记录阻止（无可行 P_CONC），两阶段程序在解封后继续。

- **阶段 1——吞吐探针（backfill 前）**：对将进 T1–T4 验收面的三个臂 H1/H2/H4 各跑 1 段 `round --round 0 --configs <arm> --concurrency P_CONC_candidate`（manifest 现参数：配额 11000、窗 180s）。探针段以"配额超窗"结束是**设计的预期结局**（配额刻意放大以测速率）——仅此 invalid 原因在 round-0 探针段上不触发失败即停；其余无效原因照常触发。产出：各臂实测吞吐 **ŷ_arm**（完成操作数 ÷ 稳态窗秒）与 C=P_CONC_candidate 下 load1 序列。
- **阶段 2——回填与逐 face 确认（backfill 后、冻结参数下）**：
  - **回填报据（v3.1 修正归属，finding：ŷ 不得默认 H1）**：`P_QUOTA ≤ 0.8 × min(ŷ_H1, ŷ_H2, ŷ_H4) × P_STEADY`（min-over-arms；吞吐余量 ≥1.25×）。只以 H1 的 ŷ 通过**不构成**回填依据——闭环下 H2/H4 时延更高、吞吐更低，H4 系统性超窗会表现为正式段结构性 invalid → 单元 UNKNOWN；该 T2 面结局必须在 pilot 阶段可预见。历史对照：v1/v2 全部 45 段该比值 ≈ 2.9–3.4（477–620s vs 180s）——正是 B1 互斥；ratio > 0.8 的三元组禁止进入正式采样。
  - **逐 face 确认段**：mixed 全部 5 个 face（H0–H4）与 knee 存活档的 {H1, H4} face，各跑 1 段冻结参数下的 round-0 确认段：`valid:true`（配额在 P_STEADY 内完成 + §4.1 刻画三条件）= 该 face 的**直接完成性证明**，确认段即该 face 的刻画记录。isolated face 无 as-built 确认命令 → 按 §4.1 例外以首个正式段兼任并即时升级兜底。
  - **轮窗算术（冻结；与 §5 为同一公式，含关停采集项）**：`5 × (overhead + 60 + P_STEADY + s_sc) ≤ 2700`（秒）。overhead = converge+extend+boot 固定开销（确认段实测）；s_sc = 关停+采集收尾秒数（确认段实测；as-built 关停上限参考 `SHUTDOWN_BUDGET_MS = 30_000`，`runner.js:89`）。两项都必须实测记录进 pilot register，不得省略 s_sc 项。
- **K_pilot 阶梯（侦察，B 类输入）**：H1 混合档 C ∈ {25,50,100,200} 各 1 段（`runner.js:4877`）；K_pilot = 首个"p99 相对前档 >2×"档位的前一档；阶梯内无拐点**不自动取值**（`runner.js:4920-4936`，`README.md:80-87`）。落盘 `workflow-audit-v3/pilot.json`。阶梯段同时承担 §4.1 的 knee 档自身负载预筛。
- **机器执行前置（finding：预筛非机器执行，如实声明）**：比值 ≤0.8 与"禁止以注定超窗三元组启动正式段"在 as-built runner 中无对应检查项（七项预检无 feasibility item）。§6.5(c) 将其列为冻结前置；前置落地前为**操作者机械执行**——按本节算式以探针/确认数据计算，输入与结果记入 pilot register，无自由裁量空间。

### 4.3 失败即停规则（不得再跑注定无效的段）

1. 干扰界环境合格判据失败 → **pilot 中止**，不进入任何段。
2. 七项预检门任一项失败 → 无段启动（round/campaign/pilot 入口 fail-closed 已实现：`runner.js:4414-4432,5073-5091,4890-4900`）。
3. pilot 阶梯（侦察，manifest 现参数）段的 **"配额超窗" invalid 为预期结局**（阶梯只读 p99/load1 形态；C=25 邻域可能边际超窗），不触发停止；**其余任何无效原因**（入口门、seed、采样通道、oracle 等）→ 停止 pilot，修复后**重跑整个阶梯**（不续跑、不部分复用）。§4.2 阶段 1 探针段的"配额超窗"同理为预期，其余原因同此条。
4. §4.2 可行性判据不过（含 min-over-arms 比值）→ 该三元组作废；**禁止**以注定超窗的三元组启动任何正式段（B1 复发防线）。机器强制为 §6.5(c) 冻结前置；前置落地前操作者机械执行并记录（§4.2 末）。
5. 段前干扰复查失败 → 推迟该段且**不烧 attempt**；连续 3 次推迟 → 该单元 starved（已实现：`runner.js:5127-5145`）。
6. 单元达到 8 次尝试仍 <6 有效 → 单元停止、判 UNKNOWN（`CAMPAIGN_ATTEMPT_CAP=8`、`CAMPAIGN_VALID_TARGET=6`，`runner.js:144-145,5100-5105`；比 v2 §6.4 的 ≤12 次尝试更严，属收紧）。
7. 同一 face 连续 2 次**同前缀结构性** invalid → 停止该 face：结构因重试不可修复，继续烧 attempt 即"跑注定无效的段"。**结构性由机器生成的 invalid 原因字符串前缀表机械判定**（本会话逐条读码核对，非人工分类）：`steady window exceeded`（`runner.js:2437`）、`proc sampler produced no first sample`（`runner.js:1071,1105`）、`api process exited before quota completion`（`runner.js:1117`）、`proc cpu counter non-monotonic`（`runner.js:1132`）、`op(s) violated the per-op oracle`（`runner.js:1112`）、`seed checksum mismatch`（`runner.js:2289`）、`seed converge failed`（`runner.js:2270`）、`background-interference:`（窗入口过期守卫，`runner.js:2359`）、`1m loadavg … inside segment`（`runner.js:2485`）、`sampler clock jump`（`runner.js:2490`）。as-built **无 unit 停机的结构因实现**（工作树 grep structural 零命中）→ 前置落地前由操作者按前缀表机械执行并记入 campaign.json reasons（invalidReasons 已逐段落盘，`runner.js:5168-5172`）；机器强制 = §6.5(d) 冻结前置。表外原因（瞬时干扰类）按规则 5/6。
8. §4.1 face 刻画失败（确认段段内 max > 4.0 且入口合格）→ **该 face** 的正式采样禁止启动，呈报 Owner（候选处置：降 P_CONC / 缩窗降配额 / Owner 显式批准段内界修订并出 v4——本协议无权代决，`COMPONENT-ATTRIBUTION.md` §6-3 同口径）。刻画许可逐 face 生效，不外推（§4.1）。
9. sweep 总数上限 24（starvation guard，`runner.js:5097`）——到达即停并如实记录。
10. **正式阶段 B3 复发（v3.1 新增，消除 pilot/正式处置不对称）**：任一**正式段**在入口读数合格且已落盘的条件下段内 max load1 > 4.0 → **该 face 立即暂停**（该单元不再烧后续 attempt），按 §9 呈报 Owner——与规则 8 同一物理条件、同一处置；该段本身按 §6.5-1 硬剔除不计入统计。禁止把此情形归入"随机 invalid"继续重试。

---

## 5. 参数占位（pilot 实测回填；定稿冻结前回填不算改协议）

| 参数 | 占位符 | manifest 现值 | 回填来源 | 回填约束（冻结） |
| --- | --- | --- | --- | --- |
| 稳态窗上限 | **P_STEADY** | `steadyMaxSeconds = 180`（`configs.json` workload） | §4.2 轮窗可行性（与 §4.2 **同一公式**） | `P_STEADY ≤ 2700/5 − overhead − 60 − s_sc`（overhead、s_sc 为确认段实测秒数；**必须含 s_sc 关停采集项**——v3.1 修正，原式漏项比 §4.2 宽松一个关停采集时长；两式互斥即缺陷）；段结构其余项（warmup 60s 墙钟、关停计时）不变。→ **v3.2 定稿：300**（预算 343.05s = 540 − overhead 127.248 − 60 − s_sc 9.702，两项均为实测值；300 留 43s/段余量：5×(127.248+60+300+9.702)=2484.75 ≤ 2700；manifest `steadyMaxSeconds` 已同步 180→300） |
| 每段配额总量 | **P_QUOTA** | 派生权威 = **11000 ops**（`buildOpPlan` 只读 16 逐类键；朴素 17 键和 12000 是含 c4Rejects 的口径错误，`README.md:217-228`、precheck item 1） | §4.2 阶段 2 回填报据 | 对 16 键**等比缩放取整**（保持 v2 §3.1 混合权重与 schedule 种子机制不变）；`P_QUOTA ≤ 0.8 × min(ŷ_H1, ŷ_H2, ŷ_H4) × P_STEADY`（min-over-arms，§4.2）；若缩放致单类 < 1000 ops，逐类终值显式记录进 pilot register（v1 ask 的"≥1000/类高频判据"在缩放后的满足状态如实声明，不静默）。→ **v3.2：BLOCKED**（约束依赖最终 P_CONC 下的 min-over-arms 探针；H2/H4 探针受 §4.1 封锁记录同一触发，不发明数值；H1-only 条件参考：任意可行档下 floor(0.8×9.7~11.3×300) ≈ 2340–2712，等比缩放后单类远低于 1000——该注记在解封时必须逐类落 register） |
| 典型档并发 | **P_CONC** | `concurrency = 10`（`configs.json` workload） | §4.2 阶段 1 探针 + 阶段 2 确认 | **回填值必须已被该值下的探针段与确认段实测覆盖**（as-built 承载命令见 §4.1；`cmdPilot` 阶梯固定 {25,50,100,200} 且门控钉 25，`runner.js:4877,4886-4895`，**不承载 P_CONC 刻画**）；变更须附可行性论证（ŷ_arm 随 C 的实测变化 + §4.1 刻画登记全部重跑）；记录进 pilot register。→ **v3.2：BLOCKED**（实测阶梯 C∈{1,2,5,10,25,50,100,200} 段内 maxLoad1 = 4.86/6.00/5.80/6.72/6.24/6.01/6.09/5.20 全部 > 冻结界 4.0——无可行档；§4.1 封锁记录 + §4.3 规则 8 呈报 Owner） |

**回填合法性**：三项占位在**冻结点前**由 pilot 实测回填，回填记录（数值 + 依据 + pilot.json/确认段引用）写入本文件修订日志追加行（内容哈希按 §9.3 口径重算）与 pilot register——**定稿冻结前回填不算改协议**。**失效条款（v3.1 新增）**：任何使 P_STEADY 相对已刻画值上调、或变更 P_CONC 的回填 → 按 §4.1 作废受影响 face 的刻画/确认记录并重跑；冻结时全部 face 刻画记录必须处于最终 (P_CONC, P_QUOTA, P_STEADY) 下，否则冻结点未到达。冻结点后三者与 §4.1 干扰界数值、预检阈值全部为冻结核心，修改只能按 §9.2 出新版本。低频腿（W11 10000 行、W09 专池 12、W12 drain）配额不随 P_QUOTA 缩放（各自独立预算，继承 v2 §3.1 低频腿单独预算条款）。

**v3.2 回填状态（pilot 实测）**：P_STEADY = 300 与 B_entry = 1.24 **已定稿**（manifest `steadyMaxSeconds` 已同步 180→300；实测依据见 §4.1 定稿值与本表 P_STEADY 行）；P_CONC 与 P_QUOTA = **BLOCKED**（§4.1 封锁记录：实测阶梯全部档位段内 maxLoad1 > 冻结界 4.0，§4.3 规则 8 呈报 Owner）。**冻结点未到达、freeze.json 未写、正式采样（Stage D–G）继续封锁**；解封只能经 Owner 裁决通道（v4 修订/换宿主/干扰口径重定义），本协议无权代决。

---

## 6. 正式 segment 规范

### 6.1 七项预检（与 runner 实现一致，逐项；单一权威实现 `precheckGate`，`runner.js:4297-4404`）

| # | item 名（实现原文名） | 内容 | 实现锚点 |
| --- | --- | --- | --- |
| 1 | `workload-plan-count` | 工作量计划数 = 真实 `buildOpPlan` 派生（R2-02：c4Rejects 组总额绝不重复计入；权威 expectedOps=11000，朴素 17 键和 12000 是口径错误） | `runner.js:4322-4329` |
| 2 | `fixture-oracle` | fixture 制备池覆盖配额（owners == slots，3000 候选池 ≥ 2820 槽）+ oracle 注入矩阵（良形全过、注入坏样本全被识别） | `runner.js:4331-4342` |
| 3 | `proc-channel` | /proc 通道可用：对一次性探针进程跑真实 sampler，产出单调首/末 CPU 样本对且 VmRSS 可读（R2-01 回归守卫） | `runner.js:4344-4350`、`:4057-4099` |
| 4 | `interference` | 入口干扰界：1m loadavg ≤ 4.0（§6.5-1/§6.1）且时钟跳变 ≤1000ms（§6.5-3）；v3 叠加 §4.1 入口界 B_entry 为**操作者前置**（runner 比较器仍用 4.0，更严的 B_entry 由 pilot register 记录并在启动前人工/脚本核对） | `runner.js:4352-4360`、`interferenceProblems` `:4037-4050` |
| 5 | `source-sha-env` | 源码/环境一致性：按 (sourceDir, commitSha) 逐血统检查产品树（apps/、packages/）与钉定 SHA 逐字节一致；H0 钉自己的 cb1e614f 血统，checkout 缺席 fail-closed 绝不静默 | `runner.js:4362-4380` |
| 6 | `db-isolation` | 实验库隔离：每段 DB 位于 testing.md §2.8 `exam_e2e_w<N>` 家族且在 full-reset allowlist 上（H0=`exam_e2e_w150` 专用槽，其余 `exam_e2e_w964`；dev `exam` 名即拒绝） | `runner.js:4382-4387`、`README.md:24-46,168` |
| 7 | `h0-comparability` | H0 可比性：H0 所在单元必须持 §6.6-3 oracle 等价性登记（每 workload 每 SHA ≥3 段、跨轮次分布）；H0 进 isolated/knee 套件 → 拒绝；登记缺失 → 整套件拒绝启动 | `runner.js:4389-4401`、`:4290` |

入口 fail-closed：任一项失败 → 不启动任何段（round `runner.js:4414-4432`、campaign `:5073-5091`、pilot `:4890-4900`）；反例注入证明六类反例全部被拒（selftest `5f`，`README.md:351-355`）。此外每段 spawn 前有一次干扰复查（§4.3 规则 5）。

### 6.2 段结构（继承 v2 §3.3 六步 + as-built fail-closed 判定）

继承 v2 §3.3：re-seed 到逐字节相同初态（checksum 核对）→ 每段独立干净 API 进程 → warmup 固定 60s 墙钟（不以操作数封顶；两臂 warmup 完成数差 >20% 软标记）→ steady 稳态窗（= P_STEADY 或配额完成先到者；**配额未完成判段无效**）→ SIGTERM 关停计时（T9）→ 采集收尾。as-built 追加的 fail-closed 段无效判定（`judgeSteadyWindow` 单一权威实现，selftest 注入矩阵共用，`README.md:192-200`）：首样本缺失（5×tick 预算内无样本）、样本 <2（CPU 差分无两个观测点，不得静默报零成本）、utime+stime 非单调、oracle 违例 >0（整段作废，§4.2/v2 §4.2）、进程在配额完成前退出。窗入口过期 in_progress 守卫（`README.md:296-298`）非零 → 段无效。负载发生器模型沿用 v2 §3.5（闭环固定 worker、无 pipelining、think time 0、同种子确定性 schedule、禁止分块相位）。

### 6.3 交错与有效配对（≥6 有效，8 次尝试上限）

- **单元定义**：mixed = config（H0–H4 各一单元）；isolated = config×类；knee = config×档位（`runner.js:5030-5058`）。
- **交错**：每 sweep 对 pending 单元轮转起点（§6.1 轮内交错防 host-load 相位污染，继承 v2 §6.1；实现 `runner.js:5114-5117`；round 命令同法 `:4436-4440`）。
- **停机规则**：单元 **≥6 有效即达标；达到 8 次尝试即停**（先到者；`runner.js:144-145,5100-5105`）；推迟不烧 attempt、连续 3 次推迟 starved（`:5127-5145`）；同因结构性 invalid 连续 2 次即停（§4.3 规则 7）；sweep ≤24。
- **配对语义（v3.1 修正）**：pair = 同 sweep 同 workflow **同档位**下的两配置段；配对相对增量以 vs 同轮同 workflow 的 H1 计算（`README.md:70-78`）。mixed 档位恒典型档；knee 的配对键**必须含 gear 维度**（(gear, config)）。**as-built 差距（显式声明）**：aggregateCore 配对键 = (round, workflow, config) 且同键后写覆盖（`runner.js:246-281`），SUITES.knee.workflow 恒 "mixed"（`runner.js:129`）→ knee 一次 sweep 内 H1@c25/H1@c50 同键覆盖、跨档位误配对——knee 配对在 as-built 聚合机制下不可机器产出，正式 knee 数字在 §6.5(b) 落地前封锁（§3.B 同步声明）；mixed/isolated 的 campaign 单元聚合在 §6.5(a) 落地前同样封锁。
- **追加 replicate**：≥6 之上可追加（只收紧 CI；决定与理由记运行记录，继承 v2 §6.4 末）。

### 6.4 统计规则（冻结）

- **主效应量**：配对相对增量 Δ% = (X_处理 − X_H1) / X_H1（CPU time/op、p50/p95/p99、吞吐、RSS 斜率等按指标逐一定义；X 为单段指标值）。**聚合按 workflow 维度分组**（mixed 与各 iso-* 各自成组、跨 workflow 永不交叉喂入；R2-04 修复），组内配对、同轮配对。
- **报告**：配对 Δ% 的中位数与极差（min–max）；**bootstrap 95% CI**（对配对 Δ% 重采样 **10,000** 次、percentile 法、**固定种子 20261115**——`BOOTSTRAP_RESAMPLES=10_000`/`BOOTSTRAP_SEED=20261115`，`runner.js:95-96`；预注册不得更改）；**效应量 = 配对 Δ% 中位数**。
- **判定表**：§2.3（继承 v2 §6.4）：CI 上界 ≤+5% → PASS（含 0 → `INCONCLUSIVE@0`）；下界 >+5% → FAIL；跨 +5% → UNKNOWN；<6 配对 → UNKNOWN；IQR>5pp → UNKNOWN；任一指标 UNKNOWN → 合取 UNKNOWN。
- **判定力（继承 v2 §6.7）**：pilot + 前 2 个采样轮的配对 Δ% 给出 σ̂；MDE ≈ 2.80·σ̂/√n（80% 功效、双侧 5% 正态近似，只作预期量化不作判定规则）；主判定指标 MDE > +5% → 采样继续前作判定力声明呈报 Owner。MDE 表与 σ̂ 写入 pilot register。
- **B 类（knee）数字**：同法计算与呈报，标注饱和域 + 仅报告面（§3.B）；不进判定表。
- aggregate 契约字段：`workflow, config, comparable, cpuDeltaPct, p50DeltaPct, p95DeltaPct, p99DeltaPct, rssDeltaMb, ciLow, ciHigh, n`（`README.md:77-78`）；n < 6 时 rows 自动带 UNKNOWN notes（`README.md:380-381`）。

### 6.5 聚合与统计的机器路径（v3.1 新增；冻结前置，fail-closed）

**as-built 事实（本会话读码核实）**：正式 campaign 数据写 `campaign-<suite>/sweep-N/`（`runner.js:5093`）与 campaign.json（`runner.js:5191`），而 `cmdAggregate` 只读 `rounds/round-N/`（`runner.js:4712-4747`）、`cmdCampaign` 结尾不计算配对增量/CI（`runner.js:5209-5232` 只回 units/rounds/gate/stoppedReason）——**campaign 路径无配对/CI 机器产出；round 路径有聚合但无停机规则机器强制**（§4.3 规则 5–9 仅 `cmdCampaign` 实现）。两条路径各缺一半，正式采样在 as-built 下无完整路径。处置（全部为冻结前置，未完成即冻结点未到达、正式采样禁止启动）：

- **(a) campaign 聚合桥**：`runner.js aggregate` 扩展读取 campaign 根，以 (suite, workflow, gear, config) 为单元键，沿用 §6.4 配对语义（vs 同 sweep 同 workflow 同档位 H1）产出行与 CI，并以固定输入闭式 selftest 覆盖。落地前**禁止启动任何正式 campaign**；`round` 命令不得承载正式判定单元（§3.5 末条）。
- **(b) knee 配对键含 gear 维度**：修复 §6.3 所述 (round, workflow, config) 同键覆盖问题（knee 段 workflow 标签恒 "mixed"，`runner.js:129`），配对键加 gear 维度 + selftest 覆盖；落地前 knee 正式数字封锁（§3.B）。
- **(c) feasibility 机器检查**：正式入口从 pilot register/刻画登记读取 (P_QUOTA, P_STEADY, P_CONC) 与各 face 确认状态，机器拒绝未满足 §4.2/§4.1 的 face（七项预检无此 item）；落地前操作者按 §4.2 末条机械执行并记录。
- **(d) 规则 7 结构因重复的机器停机**：单元计数器按 §4.3-7 前缀表累计同前缀 invalid 并自动停 face；落地前操作者机械执行并记入 campaign.json reasons。
- **(e) T9 无需 harness 变更**：as-built 语义为 recorded-not-invalidating（`runner.js:2494-2500`），处置按 §2 第 6 条。

---

## 7. 输出指标清单（逐项状态规则）

**状态规则（预注册承诺，沿 v2 §5 纪律）**：
- **MEASURED**：该通道在本实验的**有效段**产出了可核对数据（通道自检通过 + 产物落盘可离线复核）；
- **UNKNOWN**：通道已尝试但不可用/失败，或该指标在本实验设计下结构性不可测——如实记录原因，禁止编造数值；
- **SKIPPED**：本实验按设计/授权边界**不运行**该通道——记录原因；禁止 SKIPPED/UNKNOWN 互冒。
无效段的数据不进任何指标的 MEASURED 统计（作废段原始数据保留）。

| 指标 | 测量通道 | 状态规则（v3） |
| --- | --- | --- |
| CPU time/op | 外部 `/proc/<pid>/stat` utime+stime 差分 ÷ 稳态窗操作数（USER_HZ=100，`runner.js:92`）；采样 fail-closed 见 §6.2 | 有效段 **MEASURED**（主验收指标）；段无效 → 该段此指标不存在；进程 CPU 为全局量，类级归因仅隔离档（§3.C 不回答项） |
| wall p50/p95/p99 | load generator 客户端逐操作计时（类标签），稳态窗、warmup 外 | 有效段 **MEASURED**（客户端口径）；服务端时延分布黑盒不可测 → 服务端口径 **UNKNOWN**（On 态可用 span 时长作旁证，两口径分开报告不混用，继承 v2 §5 受限声明） |
| 吞吐 | 稳态窗有效操作数 ÷ 窗时长；闭环内生量（§3.A 标注） | 有效段 **MEASURED**，强制携带 `throughputSemantics` 闭环标注 |
| error/oracle 计数 | 逐操作 oracle（`checkOp`）+ 段级 invalidReasons + error 率 | 有效段 **MEASURED**（oracle 违例 >0 即整段作废，故有效段违例恒 0；error/oracle 计数作为段质量证据逐段落盘） |
| RSS | `/proc/<pid>/status` VmRSS 逐秒采样；summary `rssMb` = 稳态窗均值，samples.json 留全时序 | 有效段 **MEASURED**；稳态斜率可离线计算 |
| heap (heapUsed/heapTotal/external) | 需进程内通道；常规段黑盒不可测，仅 `--expose-gc` 专用探针 run 自有输出（继承 v2 §5） | 常规段 **UNKNOWN**（结构性不可测）；探针 run（T10/C8）获授权执行时按其自有输出 MEASURED，未执行则 **SKIPPED**（v1 即 SKIPPED，`PERFORMANCE-REPORT.md:118`） |
| GC | `--trace-gc` stdout 解析——专用观察段旗标（有运行时开销，禁入 perf 段；harness perf 段启动前清除 NODE_OPTIONS，`README.md:205-206`） | perf 段 **SKIPPED**（by design）；专用 GC 观察段获授权执行 → 该段 MEASURED；旗标与启动链不兼容 → UNKNOWN |
| event-loop | 无 as-built 通道（harness 未实现 event-loop lag 探针；v2 §5 亦未承诺） | **SKIPPED**（通道未实现；如实声明，不虚构代理指标） |
| DB statements/tx/retry | 权威通道：(a) 测试库 PG 日志/pg_stat_statements；(b) pino "transaction retry" warn 计数（继承 v2 §5 (a)(b)）；进程内 diagnostics() 黑盒不可达【CODE_VERIFIED，v2 §5】；harness 段级另有 DB 终态快照对账（`README.md:317-320`） | 通道 (a)(b) 属采样阶段操作程序：执行 → MEASURED；未执行 → **SKIPPED**；终态对账随有效段 **MEASURED** |
| Trace 计数 | H3：`TELEMETRY_MEMORY_DUMP_FILE` shutdown JSONL witness（逐段行数 + 可解析性）；H4：sink 按路径计数器；Off/H1/H2：对 sink 请求增量恒 0（轮内不变量，v1 七轮实测先例 `PERFORMANCE-REPORT.md:129-141`） | H3/H4/Off 增量 **MEASURED**；H2 span 产生无 witness 通道（dump 仅 memory exporter 模式写出，`apps/api/src/telemetry/runtime.ts:291-301` `if (current.memoryExporter)` 门控【CODE_VERIFIED】）→ H2 的"信号实际产生"旁证 **UNKNOWN**（附录 B.4）；每请求恰 1 server span 精确计数（T6）= H3 dump 离线审计，执行 → MEASURED |
| Metric 计数 | H4 为唯一真 metric 序列形态（sink `/v1/metrics` 计数；H2 无 MeterProvider【CODE_VERIFIED｜v2 §1.1】） | H4 **MEASURED**；H2/H3/H1/H0 metric 面 = 结构性零（静态断言 + sink 零增量），标 **MEASURED（零增量）** |
| exporter/collector 资源 | otlp-sink 计数器（请求/字节/状态码，按路径；`README.md:138-143,215`）；H4 运行窗 sink 由 runner 自动拉起（`runner.js:5095-5096,5119-5122`） | sink 请求/字节 **MEASURED**（H4）；真实 otelcol/tempo 容器资源（v2 §5 collector 资源行）不在 v3 采样拓扑内（sink 替位）→ **SKIPPED** 并注明：H4 数字含 sink 进程共存成本、不含完整观测栈成本——该边界随报告呈报 Owner |

---

## 8. 数据分区与 H0 可比性

### 8.1 新数据分区（与旧无效段严格隔离）

- **v3 唯一产物根**：`/home/hoo/Source/exam-otel-audit/out/otel-w964/workflow-audit-v3/`（harness `OUT_ROOT` 硬编码，`runner.js:84`）。子布局：`rounds/round-N/<config>/`、`campaign-<suite>/sweep-N/...`、`pilot/c<N>/` + `pilot.json`、`w09/`、`b4-repro/`、`run-meta/<ts>-pid<N>-<cmd>.json`（解析后绝对路径/SHA/宿主事实，gitignored）、`aggregate.json`（`README.md:59-63,100-101,156-157`）。
- **旧根只读**：`out/otel-w964/workflow-audit/`（v1/v2 全部 45 无效段 + R1/R2 审计证据）自 v3 起**只读，runner 不再写入**（`README.md:472-474`）。本协议与其执行会话对旧根仅限读取（引用证据），禁止改写、删除或"修复"旧产物；v1/v2 采样数据**永不**混入 v3 聚合（aggregate 只读 v3 根）。
- 两根均在 `out/`（gitignored）下，属运行产物；受控工作树不受影响。

### 8.2 H0 可比性规则（沿用 v2 §6.6 全部条款）

1. H0 上运行 On 态 = 组合不存在 → NON_COMPARABLE，不产出数字（v2 §6.6-1）；
2. S 维度 × Off 态 → NON_COMPARABLE（v2 §6.6-2；v3 的 S 面收缩见 §3.5）；
3. H0↔H1 语义等价核验：每纳入 workload 在两 SHA 各 ≥3 段 oracle 核验、跨轮次/时间分布，任一段任一字段不符 → 该 workload 对 H0 判 NON_COMPARABLE 并记录差异字段（v2 §6.6-3 收紧版；harness gate item 7 以等价性登记 fail-closed 把关，登记缺失整套件拒启，`runner.js:4389-4401,4290`）；
4. 跨 SHA（vs H0）数字只作背景、不进验收判定（v2 §6.6-4）；
5. W7.2 历史 PR 数字（不同 SHA、pre-#994、负载模型未定义）仅背景引用（v2 §6.6-5/§7.4）。

### 8.3 W07 归位（R2-05 修正）

- **事实**：W07 是编号空洞——ask 曾声明 16 条记录、实收 15 条（W00–W06、W08–W15），W07 内容从未提供（`WORKFLOW-INVENTORY.md:5,239-240`；`COVERAGE-MATRIX.md:115`；`grep -rn "W07"` 审计树仅命中"未提供/空洞"记载）。禁止据候选猜测填充（`GAPS-AND-PRIORITIES.md:124`）。
- **归位规则（v3 冻结）**：W07 **不是工作流单元**——不出现在任何 suite、任何 aggregate 行、任何 H0 可比性行、任何预算单元；v3 的计量工作流行集 = W00–W06/W08–W12（mixed 配额绑定）+ 边界行 W13（NOT_IMPLEMENTED，不在混合档）/W14（不在 v3）/W15（关机计时随段观测）。H0 workload 语义排除 W07（与 harness as-built 一致：`configs.json:198` H0 描述"W07 has no record — excluded from H0 workload semantics"）。
- **对 v1 报告表的修正**：`PERFORMANCE-REPORT.md:74` 将 W07 列为"BLOCKED"行——v3 归位为：W07 = **NOT_APPLICABLE（无定义）**，其从来不是 BLOCKED 预算单元（无 workload 定义即无可判定单元）；该行在后续报告中不再出现在 BLOCKED 计数内（45 段 0 有效的统计本就未含 W07 段）。
- **R2-05 verdict = PARTIAL 的诚实记录**：R2-05 的 finding 原文不在本审计树（本会话 grep 无命中，附录 A.6），上述归位是 ask 指令 + as-built 证据的可核对落法；若 R2-05 原文含超出此范围的未闭合面，按 §9 冻结前义务核对补齐。

---

## 9. 冻结与修订规则

### 9.1 冻结点与预授权通道（单一权威清单；卷首状态行与本清单一致）

**冻结点 = 首个正式 segment 启动采样**。冻结前允许且**仅允许**下列各项——本清单是唯一权威，任何他处表述以本清单为准：

1. §5 三参数回填（含 §4.2 两阶段程序的重算）；
2. §4.1 干扰界数值落定（idleMax/B_entry）与**逐 face 刻画登记**（确认段记录）；
3. K_pilot 落定与 MDE/σ̂ 表落定（pilot register）；
4. manifest `protocol` 钉更新到本协议版本（`configs.json` protocol.file/version/sha256——as-built 仍钉 v1 `4eddc216…`，本会话读出）；
5. **冻结记录（机械冻结标记，v3.1 新增）**：执行会话在首个正式段前写 `out/otel-w964/workflow-audit-v3/run-meta/freeze.json`（至少含 protocolVersion、协议内容哈希、frozenAt、P_* 终值、B_entry）；**正式段统计资格 = freeze.json 存在且 mtime 早于该段开始，且 manifest 钉 == 冻结记录所载哈希**——不满足即该段不具统计资格（凭文件与 mtimes 可机械审计）；
6. §6.5(a)–(d) 四项机器路径前置的实现与 selftest 覆盖（属执行会话授权范围内的 harness 代码工作）；
7. harness README 状态同步（`README.md:380-386` 仍称"v3 尚无独立协议文件"——该声明已过期，过渡期以本文件为准；执行会话须在正式采样前更新为指向本文件 + 哈希）；
8. R2-03/05/07/08/09 评审原文核对——凡原文含本协议未反映的未闭合条件，先按 §9.3 出 v3.x/v4 再冻结；
9. 环境冻结快照按 v2 §2.1 重验（Node/pnpm/内核/CPU/内存/容器拓扑）。

以上各项记录进 pilot register/冻结记录/本文件修订日志（内容哈希按 §9.3 口径重算），**不算改协议**。

### 9.2 冻结后

v2 §8.1 单调性总则适用——阈值只能保持或下调、判定/剔除/可比性规则只能收紧或细化；**其余一切修改禁止**，不存在"采样中途改参数"的路径；环境冻结项变化 → 立即暂停采样，按影响面判定已采数据有效性，出 v4 新版本后以新版继续。**失败即停的升级路径**：§4.3 规则 8/10 与任何触发 Owner 裁决的出口，一律**停止采样、保留原始数据、呈报**，不得以放宽阈值、加重试、降断言换绿灯。

### 9.3 版本与哈希

v1 = `PROTOCOL.md`、v2 = `PROTOCOL-v2.md`，均保留不覆写；实质修订新建 `PROTOCOL-vN.md`（小版本 v3.x 不新开文件，追加修订日志行）。哈希口径沿用双口径声明中的**内容哈希口径**：日志中的 sha256 = 该版本文件**去除 `### 修订日志` 节本身**内容的 sha256，验证命令 `awk '/^### 修订日志$/{exit} {print}' PROTOCOL-vN.md | sha256sum`（全文件口径另行记录时显式标注，防 v1 期 8bc7f7cd ≠ 4eddc216 式误读——`PERFORMANCE-REPORT.md:4` 双口径声明）。

---

## 附录 A：本会话已执行的验证（MEASURED 清单）

- **A.1 读取的材料**：`PERFORMANCE-REPORT.md` 全文（§1–§8）；`PROTOCOL-v2.md` 全文；`COMPONENT-ATTRIBUTION.md` §6/§7/§9（awk 定位 `^## 6`）；harness `README.md` 全文；`runner.js` 选段（:84-153 常量、:4020-4099、:4290-4432、:4865-5210）；`configs.json` workload/protocol/portability/H0 条目（python3 -I 解析）；ADR-028 :1-10 与 :85-110；`WORKFLOW-INVENTORY.md`/`COVERAGE-MATRIX.md`/`GAPS-AND-PRIORITIES.md` 的 W07 相关行（grep 定位）；`apps/api/src/telemetry/runtime.ts` :280-320/:430-470（dump 门控）。
- **A.2 干扰界实测**：`cat /proc/loadavg`（初测 0.31/1.39/2.02 → 0.29/1.36/2.00）；序列 6×20s：1m 0.15/0.11/0.08/0.06/0.04/0.03、5m 0.84→0.59、15m 1.68→1.51；`nproc` = 20；`docker ps --format '{{.Names}} {{.Status}}'` → sharp_saha (Up 2 days)、exam-dev-redis-1 (Up 3 days healthy)、exam-dev-db-1 (Up 3 days healthy)。
- **A.3 目录现状**：`ls` 确认 `out/otel-w964/workflow-audit/`（rounds/ + aggregate.json，旧根）与 `out/otel-w964/workflow-audit-v3/`（aggregate.json、b4-repro/、rounds/round-0、run-meta/、w09/，新根已存在且 v3 前置工作产物在其中）。
- **A.4 R2 修复落盘定位**：`grep -n "R2-0"` 于 `scripts/perf/otel-workflows/README.md`（:72,:122,:151,:192,:248,:281,:341,:372,:430,:449 命中 R2-01/02/03/04/06）与 `configs.json`（:4 R2-06 契约）；工作树 diff（`git -C /home/hoo/Source/exam-otel-audit diff scripts/perf/otel-workflows/runner.js | grep R2-0`）命中 R2-01/02/03/04/06 注释锚点。
- **A.5 冻结哈希复核**：验证命令 `awk '/^### 修订日志$/{exit} {print}' PROTOCOL-vN.md | sha256sum`。v1/v2 重算值与各自主记值逐字节一致（v3 撰写会话与 v3.1 修订会话各执行一次）——v1/v2 未被改动；v3 与 v3.1 的内容哈希记录于修订日志（哈希不入正文，避免自引用失效）。
- **A.6 负证据（grep 无命中）**：`grep -rln "R2-05"`、`grep -rn "R2-07\|R2-08\|R2-09"` 于审计树与主仓 docs/scripts → 零命中——R2-05/07/08/09 的 finding 原文不在本地可得材料中，verdict 仅以 ask 材料为准记录。
- **A.7 未执行（如实声明）**：`runner.js selftest`（需 DB 与三次真实 boot，且属执行会话义务）；`pilot`/`campaign`/`round` 真实采样（Stage D–G 另行授权）；任何数据库触达（本协议撰写无需，遵守 §2 调查模式边界）。
- **A.8 v3.1 修订会话新增验证（13 项评审意见的锚点核实）**：`sed -n '2494,2502p' runner.js` → T9 超预算仅 notes.push "recorded, not segment-invalidating"（finding 12 锚点）；`sed -n '4710,4750p'` → `cmdAggregate` 只读 `ROUNDS_DIR` 且显式跳过 round-0（finding 2）；`sed -n '5209,5235p'` → campaign 结尾仅回 units/rounds/gate/stoppedReason、无配对/CI（finding 2）；`sed -n '246,285p'` → aggregateCore 配对键 (round→workflow→config)、`valid.get(wf)[seg.config] = seg.summary` 同键后写覆盖（finding 3）；invalid 原因字符串逐条定位：`runner.js:1071,1105,1112,1117,1132,2270,2289,2359,2437,2485,2490`（§4.3-7 前缀表）；`grep -n 'async function runSegment'` + 签名读段 → `runSegment` 接受 `workflow: workflowArg` 而 `cmdRound` 签名 `{round, configs, concurrency, gcObserve}` 无 workflow（isolated 诊断段无 as-built 命令，§4.1 例外条款锚点）；`sed -n '376,390p' README.md` → "PROTOCOL-v3 草案：v3 尚无独立协议文件"过期声明（finding 11）；`python3 -I` 读 `configs.json` → protocol 钉仍 v1 `4eddc216…`（finding 8）；`sed -n '75,80p' .gitignore` → `out/` 忽略规则。
- **A.9 v3.2 回填会话新增验证（pilot 实测与定稿）**：
  1. 环境核查：`git -C exam-otel-audit branch/rev-parse/status`（perf/otel-workflow-attribution @7a2de31e + R2 工作树改动）；`test -d node_modules && test -f apps/api/dist/server.js` → 均 OK（无需构建）；`ls ../exam-otel-h0` → 不存在（H0 face = gate item 5 fail-closed BLOCKED）；`docker port exam-dev-db-1` → 127.0.0.1:5432。
  2. 磁盘状态盘点：runner.js 已由其他会话扩展至 6303 行（15:22 mtime，含 pilot 判定/预检/reaper/archive 约定）；`pilot.json`（16:32，H1 阶梯 K_pilot=100、四档全剔除）与 `pilot/`（c25-c200）已存在——**H1 阶梯实测由前序会话完成，本会话只读引用**。
  3. idle 序列：后台 24×30s 采样 → `run-meta/idle-loadavg-20261115.txt`；python3 统计 idleMax=0.62/idleMed=0.18 → B_entry=1.24。
  4. 探针（round-0 诊断，配额超窗为预期结局）：`node scripts/perf/otel-workflows/runner.js round --round 0 --configs H1 --concurrency {5,2,1}`；每次段前 1m loadavg ≤ B_entry=1.24 复核（实测入口 0.10/1.09/0.84）；每段后按 §4.1 覆盖警示归档至 `run-meta/archive/round0-probe-H1-c{5,2,1}-<ts>/`（13:05 历史 C=10 段先归档为 `round0-b4-postfix-H1-c10-20261115T1317/`）。段级数据从 `segment-summary.json` + `samples.json` 提取（python3 -I）。
  5. 负载阶梯结论（全部 8 档 maxLoad1 > 4.0）：见 §4.1 封锁记录表；时序证据（残留 vs 持续）逐段记录于 pilot register。
  6. 时序输入提取：overhead = preSteadySeconds − warmupSeconds（C=1/2/5 = 125.275/123.876/124.016s；阶梯 basis 127.248s）；s_sc = shutdown.ms + collect（观测域 [0.041, 9.679]+0.02s，取 9.702 保守）；预算 = 540−127.248−60−9.702 = 343.05s。
  7. selftest 硬编码核查：`grep -n "11000\|expectedOps" runner.js` → `:3377`/`:3514` 硬编码断言 + `fixtureProblems` C4 split 300/400/200/100 硬编码 → **P_QUOTA 缩放若执行须同步 selftest 断言改为 manifest 派生（保留双计守卫/比例/W09=200/W11=10000 不变量）——因 P_CONC BLOCKED 本会话未缩放 quotas、未改 selftest**（解封会话义务，记入 §5 P_QUOTA 行）。
  8. manifest 同步：`configs.json` workload.steadyMaxSeconds 180→300 + protocol 钉更新到本文件 v3.2（sha256 见修订日志）。
  9. 无放宽复核：v3.1 快照 diff（冻结核心节无变化，见 v3.2 执行记录）+ v1/v2 内容哈希复验 + §5 公式复算。
  10. 未执行：H2/H4 探针与全部确认段（受封锁）；K_pilot 阶梯重跑（前序会话已实测）；selftest（未触 harness 逻辑，无需）；freeze.json（冻结点未到达）。

## 附录 B：UNKNOWN / SKIPPED 预登记汇总

1. **R2-05/07/08/09 finding 原文**：UNKNOWN（不在审计树；verdict 表来自 ask 材料）。冻结前核对义务见 §9.1 第 8 项。
2. **B3 历史负载来源**：UNKNOWN（v1 未定位；v3 以 §4.1 自身负载刻画把它转为可判定实验，不再依赖追溯定位）。
3. **K_pilot、P_STEADY/P_QUOTA/P_CONC 终值、B_entry、overhead、MDE/σ̂**：UNKNOWN（待 pilot 实测回填；通道已冻结）。
4. **H2 span 产生 witness**：UNKNOWN——dump 写出被 `current.memoryExporter` 门控（`runtime.ts:291`），exporter=none 无旁证通道；T5b 该子项在 v3 判 UNKNOWN 交 Owner（静态断言"无 sdk-node/NodeSDK"仍作旁证，继承 v2 §7.2 T5b）。
5. **event-loop 指标**：SKIPPED（通道未实现，§7）。
6. **真实 otelcol/tempo 容器资源**：SKIPPED（v3 采样拓扑以 otlp-sink 替位，§7 末行）；H4 数字含 sink 共存成本的边界随报告声明。
7. **WSL2 宿主侧负载盲区**：继承 v2 §2.3（Windows 侧不可见；interop 代理通道可用性 UNKNOWN，不可用则 SKIPPED + 效度声明）。
8. **低档（C=1）、拐点档预算判定、H2 拐点、W08/W01 隔离类、S 子矩阵**：v3 显式范围收缩项（§3.5），呈报 Owner，非 UNKNOWN 判定。
9. **§6.5(a)–(d) 机器路径前置**：as-built 未实现（已知事实，非 UNKNOWN）——campaign 聚合桥、knee gear 配对键、feasibility 机器检查、结构因机器停机全部落地前，正式采样**封锁**；这是 v3.1 对"两条命令路径各缺一半"缺口的 fail-closed 处置。
10. **isolated face 刻画**：as-built 无单类诊断命令（§4.1 例外条款）→ isolated face 以首个正式段兼任刻画，B3 复发由 §4.3 规则 10 即时升级兜底；该残余风险如实呈报 Owner。

---

### 修订日志

| 版本 | 日期 | sha256（内容口径，去修订日志节） | 说明 |
| --- | --- | --- | --- |
| v1 | 2026-11-15 | `4eddc21683a5fae17913e35a59dbbf7dab57ebdd3429d5c22619ed31d0fee5be` | 初版预注册（`PROTOCOL.md`，保留不动） |
| v2 | 2026-11-15 | `e07b39d18ed825785463aaf3f2d713d7eb69e230c83ac00d02c56fedab9b16ab` | 方法学评审修订（`PROTOCOL-v2.md`，保留不动） |
| v3 | 2026-11-15 | `a14e8e30a79ea061ac5f898a1e4629121718d24ca11e0cd99dc34ac6033f4e51` | v1/v2 阻断后重预注册：§1 阻断引用（B1–B4 + R2 verdict 表）、§2 预算不变、§3 A/B/C/D 分类、§4 pilot（可行性/干扰界/失败即停）、§5 参数占位回填、§6 七项预检与统计、§7 指标清单、§8 数据分区与 W07 归位；显式收缩清单见 §3.5 |
| v3.1 | 2026-11-15 | `8ec93e47e94606bd22e64a82e1068f7d906ee8a8b259879997b8923727e4cb1e` | 评审修订（13 项发现：high×3 / medium×5 / low×5；只收紧/更明确、零放宽）。逐项落点：①high pilot 可执行性 → §4.2 两阶段程序（cmdPilot 不承载 P_CONC 刻画，runner.js:4877,4886-4895 锚点；探针/确认段经 `round --round 0 --concurrency`）+ §5 P_CONC"须被该值实测覆盖"；②high campaign 聚合缺口 → 新增 §6.5(a)（cmdAggregate 只读 rounds，runner.js:4712-4747；campaign 尾无 CI，:5209-5232）+ §3.5 末"正式采样由 campaign 独占承载"；③high knee 配对 → §6.3/§3.B/§6.5(b)（aggregateCore 同键覆盖 runner.js:246-281、knee workflow 恒 mixed :129），knee 数字封锁至前置落地；④medium 刻画范围 → §4.1 face 登记逐 face 许可 + isolated 例外声明 + 阶梯机械预筛 knee 档；⑤medium 正式阶段 B3 复发 → 新增 §4.3 规则 10（立即暂停 + 升级 Owner）+ 规则 7 前缀表机械化（10 条原因串逐条读码核对）+ §6.5(d)；⑥medium 公式矛盾 → §5 P_STEADY 约束补 s_sc 项与 §4.2 同式；⑦medium 时间维度缺口 → §4.1 刻画失效条款 + §5 失效条款（窗长上调即作废重刻）；⑧medium 冻结清单矛盾/无标记 → §9.1 单一权威清单 9 项 + freeze.json 机械冻结标记 + manifest 钉核对（as-built 仍钉 v1）；⑨low 预筛非机器 → §6.5(c) + §4.2 末过渡条款；⑩low ŷ 归属 → §4.2 min-over-arms + per-face 确认；⑪low README 漂移 → §9.1 第 7 项同步义务 + 过渡期以本文件为准（README:380-386 过期声明）；⑫low T9 处置 → §2 第 6 条（FAIL 独立判定呈报，不改写 T1–T4；runner.js:2494-2500 锚点）+ §6.5(e)；⑬low 预算口径留白 → §2 第 7 条口径补齐声明（ADR PROPOSED 语义随动）。另：§4.3 规则 3 修正阶梯段"配额超窗为预期结局"（v3 原文会令侦察阶梯必然触发停止）；§4.1 同目录覆盖警示；附录 A.8、B.9/B.10 |
| v3.2 | 2026-11-15 | `cbde752009580af56270cba67f067247a295ccf80b3f3c98f259955ea7174a11` | pilot 实测回填（§9.1 预授权通道第 1/2 项；只收紧、零放宽）：**①B_entry = 1.24 定稿**（idleMax=0.62/idleMed=0.18，n=24×30s 实测序列 run-meta/idle-loadavg-20261115.txt；§4.1 定稿值）；**②P_STEADY = 300 定稿**（预算 343.05s = 540 − overhead 127.248 − 60 − s_sc 9.702，overhead/s_sc 为实测；manifest steadyMaxSeconds 180→300 已同步）；**③P_CONC/P_QUOTA = BLOCKED**——新增 §4.1"P_CONC 封锁记录"：实测负载阶梯 C∈{1,2,5,10,25,50,100,200} 段内 maxLoad1 = 4.86/6.00/5.80/6.72/6.24/6.01/6.09/5.20 **全部 > 冻结界 4.0**（吞吐后端饱和 ~9.7–11.3 ops/s 与 C 无关；持续自载地板 median 3.9–4.5；开窗残留峰 4.3–6.0），§4.3 规则 8 的"降 P_CONC"路径实测穷尽至 C=1、"缩窗降配额"实测无效 → face 刻画不可能通过，呈报 Owner（候选：v4 段内界修订/换宿主/干扰口径重定义——本协议无权代决，冻结核心 4.0 保持原值）。冻结点未到达、freeze.json 未写、正式采样继续封锁；§3.A/§4.2/§5 同步注记 BLOCKED 状态；pilot register = `out/otel-w964/workflow-audit-v3/pilot-register.json`（含全部探针归档路径与无放宽清单）；v3.1 全文快照 = run-meta/protocol-v3.1-snapshot-8ec93e47.md（哈希可验） |

**v3 撰写会话执行记录（2026-11-15）**：`awk '/^### 修订日志$/{exit} {print}' PROTOCOL-v3.md | sha256sum` → `a14e8e30a79ea061ac5f898a1e4629121718d24ca11e0cd99dc34ac6033f4e51`（= 上表 v3 行所记值；v1 重算 `4eddc216…` 与 v2 重算 `e07b39d1…` 均与各自日志记录逐字节一致——v1/v2 未被本会话改动）。

**v3.1 修订会话执行记录（2026-11-15）**：修订全部定稿后 `awk '/^### 修订日志$/{exit} {print}' PROTOCOL-v3.md | sha256sum` → `8ec93e47e94606bd22e64a82e1068f7d906ee8a8b259879997b8923727e4cb1e`（= 上表 v3.1 行所记值；同命令复验 v1/v2 仍为各自原值，未被修订会话改动；中间稿 ff5644ac… 因定稿前修正两处交叉引用被本终稿取代；13 项评审意见的代码锚点核实清单见附录 A.8）。

**v3.2 回填会话执行记录（2026-11-15）**：正文定稿后 `awk '/^### 修订日志$/{exit} {print}' PROTOCOL-v3.md | sha256sum` → `cbde752009580af56270cba67f067247a295ccf80b3f3c98f259955ea7174a11`（= 上表 v3.2 行所记值；日志节内的本行与执行记录不参与内容口径哈希）；同命令复验 v1 = `4eddc216…`、v2 = `e07b39d1…` 仍逐字节一致——v1/v2 未被本会话改动。**无放宽复核（对照 run-meta/protocol-v3.1-snapshot-8ec93e47.md）**：判定表（§2.3）、bootstrap 参数（10000/20261115）、attempt cap（6/8）、段内硬界 4.0、入口机器门 4.0、时钟跳变 1000ms、可行性比值 0.8、oracle 与 fail-closed 判定、§6.5(a)-(d) 前置全部逐字未变；本版变更仅为：B_entry=1.24（新增、严于机器门）、P_STEADY=300（预注册预算公式 343.05s 内）、BLOCKED 记录与封锁注记（新增约束）。pilot register：`out/otel-w964/workflow-audit-v3/pilot-register.json`。
