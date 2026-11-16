# FINAL-ADJUDICATION — 观测性战役最终裁决

- **裁决角色**：首席性能工程师（成本/价值最终裁决）。裁决只认证据。
- **协议哈希（双口径声明，复核轮修订）**：全文件口径（`sha256sum` 实测）PROTOCOL.md = `8bc7f7cdf06353b80d149336e492cbb41b0896a844a5781a34ee03fdee80df63`（与 ask 提供值一致）；内容哈希口径（去除修订日志节，`awk '/^### 修订日志$/{exit} {print}' | sha256sum` 实测）= `4eddc216…`，恰为 harness manifest 所钉值——两组值各自为真、口径不同，冻结正文未被篡改（详见 PERFORMANCE-REPORT 文件头）。
- **裁决日期**：2026-11-15。
- **协议哈希（v4，当前生效预注册；v3 修订轮 2026-11-15 21:42 +08:00 追加）**：PROTOCOL-v4.md 全文件 `sha256sum` = `1605a7ca79ff5fef4554989b1f0cef8c5851f6bf89fb24b800aec3c883a55059`（本会话实测）；harness manifest `configs.json` protocol 钉已指 v4（内容口径 `6739a741…`，本会话实读）。**v1（`8bc7f7cd…`）/v2（`7feefa72…`）/v3（全文件 `b564ba6a…`）全文与哈希原样保留**（三者本会话 `sha256sum` 实测逐字节一致）；**v4 为当前生效预注册**（Owner 2026-11-15 代理裁决选项 (c)：干扰口径重定义为外部增量，全部条款留 Owner 复核，`PROTOCOL-v4.md:3,34-41`）。§0–§7 为 v1/v2 时点裁决原样保留；**v3 裁决修订只在 §8 分区呈报，并取代 §0 表中对应行的时点判定**。
- **证据等级**：`MEASURED`＝本会话执行；`CODE_VERIFIED`＝本会话读源码/文档；`转引`＝既有记录未复核；`UNKNOWN`＝无法验证。

---

## 0. 裁决总览

| # | Gate | Verdict | 一句话依据 |
| --- | --- | --- | --- |
| G1 | API 进程性能（ADR-028 T1–T4） | **INCONCLUSIVE** | 0/45 有效 segment，无任何配对预算数字 |
| G2 | 全栈运行成本 | **INCONCLUSIVE** | exporter/collector 资源面未采集，benchmark 无效 |
| G3 | 长稳内存 | **INCONCLUSIVE** | 无长稳 run，C8/#994 探针未执行 |
| G4 | exporter 故障隔离 | **PASS**（附场景完备性缺口） | campaign 故障注入矩阵运行见证业务行为与关机语义一致 |
| G5 | 工作流覆盖 | **PASS**（缺口如实列账） | 覆盖矩阵建立：FULL×3 + PARTIAL×10，高频 rank1–6 全部≥PARTIAL |
| B-1 | **BLOCKER**：D1 日志通道 SQL 全列 + 绑定参数值泄漏（privacy） | **FAIL** | 默认 Off 态现在就在发生，含真实组织 ID 与用户名 |

## **PRODUCTION_ENABLEMENT = NO_GO**

判定规则（ask 冻结，不得 waiver）：GO 仅当 ADR-028 表三预算 **CPU ≤5% 与 p99 ≤5% 两项均 PASS 且证据充分**（`docs/adr/ADR-028-opentelemetry-technical-telemetry.md:93-104` 表三，PROPOSED；预算来源 #964）。现状：

- G1 = INCONCLUSIVE（0 有效配对；PROTOCOL §6.4：有效配对 <6 判 UNKNOWN，禁止出 PASS，`PROTOCOL.md:206,211-212,275`）→ 两项预算**均无法出 PASS** → GO 条件不满足 → **NO_GO**。
- 佐证（背景，非本实验判定依据）：PR #980 历史记录（转引，PROTOCOL §7.4）在同族栈上实测 On/no-export +10.4% / On/full-OTLP +9.1% CPU time/op，双双超 ≤5% 预算，当时已判 NO_GO（默认保持 Off）。
- 生产默认保持 **Off**（`apps/api/src/telemetry/runtime.ts:208` `if (!config.enabled) return null;`【CODE_VERIFIED】）。本裁决不构成对 ADR-028（PROPOSED）的接受或拒绝；本实验产出其评审输入。

---

## 1. G1 — API 进程性能：INCONCLUSIVE

**Gate 定义**：ADR-028 表三 T1–T4——H2（On/无导出）与 H4（On/完整 OTLP）分别 vs 同 SHA H1（Off），稳态 CPU time/op 与 wall p99 各 ≤+5%（`PROTOCOL.md:238-249`；判定规则 `:199-208`）。

**依据**【MEASURED】：

1. 45 个已记录 segment（round-0 pilot 5 + round-1..6 每轮 5×6 轮=30 + round-20 中断 1 + round-101..103 9）**全部 `valid:false`**（逐段读取 `rounds/*/round.json`）。
2. 官方聚合 `node scripts/perf/otel-workflows/runner.js aggregate` → `rows: []`【MEASURED】。四类阻断原因（详见 PERFORMANCE-REPORT §3）：
   - **B1** 配额结构性不可完成：权威配额 **11000 ops/段**（R2-02 口径：`buildOpPlan` 只 push 16 个逐类键、c4Rejects 组总额不重复计入，`PROTOCOL-v3.md:21`）vs 180s 窗 vs 实测 19.31–23.05 ops/s（需 ~477–570s，最快段超窗 ≥2.65×；撰写时点 manifest 锚点 `configs.json:30,33,35`）。【v3 复核轮修正（2026-11-15）：初版按朴素 17 键求和写 "12000 ops/段 / ~520–620s"，与本战役 R2-02 修正后的权威口径冲突，已按 11000 改写；结构性互斥结论不变。】
   - **B2** harness CPU 采样缺陷：`runner.js:1858` `await sleep(60)` < `PROC_SAMPLE_MS=1000`（`runner.js:87`）⇒ cpuStart 恒 undefined【CODE_VERIFIED，本会话逐行确认；:1858 为撰写时点工作树行号，HEAD `7a2de31e` 实测对应 `:1866`（sleep）/`:1911`（invalid push）——见 PERFORMANCE-REPORT §3 B2 行号注记；R2-01 修复后现行工作树该行已移除】——CPU 主指标必然缺失；
   - **B3** quiet-machine 违反：45/45 已记录段（含 pilot）段内 max load1 ∈ [4.48, 7.11] > 4.0（§6.5-1 硬剔除；均值含 pilot 5.90 / 非 pilot 40 段 5.97）；
   - **B4** oracle 失败 15.51%–21.06%（§4.2 整段作废）——跨配置同量级、无遥测单调关系（逐文件违规中位数，口径=全部 46 个已落盘 ops.jsonl 含 pilot 与中断段 round-20/H2：W10-heartbeat H0 330/H1 341/H2 326/H3 342/H4 323；W08-take 239/260/249/252/233；W01-login 恒 50；W03/W04-save 72/104/62/103/120），指向 harness fixture × 后台 scanner 竞态（机制假说未证实，不构成产品缺陷证据）。
3. 有效配对 = 0 < 6 → 全部指标 UNKNOWN（PROTOCOL §6.4/§7.5 禁止以不足样本出 PASS、禁止把 INCONCLUSIVE 写成 0%）。

**背景数据（不作判定）**：本实验未配对探索中位 CPU ms/op：H1 45.4 → H2 46.9（+3.3%）/ H3 46.6（+2.7%）/ H4 50.3（+10.8%），CPU 饱和域（~100% 单核）、loadavg 超限段、未配对——仅方向参考；与历史 PR #980 记录（+10.4%/+9.1%，转引）方向一致。**H4−H2 差异含 batch/序列化/metric provider/flush/背压多因素，不得命名为纯网络导出成本。**

**解除条件**：`COMPONENT-ATTRIBUTION.md` §6（修 B2 → B1/B3/B4 → Stage D–G 授权 → ≥6 有效配对重跑聚合）。

## 2. G2 — 全栈运行成本：INCONCLUSIVE

**Gate 定义**：OTel On 态对全栈（API + exporter + collector/sink + DB/Redis 宿主共置）的运行成本。

**依据**：benchmark 无效（同 G1）；exporter 面仅有请求数通道——每 H4 段 2452–2509 trace posts + 6 metric posts（≈13.6–14.0 posts/s，`sinkCounters`【MEASURED】），**字节量/payload 分布/collector CPU·内存/DB·Redis 容器资源全部未采集**（PROTOCOL §2.2 要求的 `docker stats` 干扰监测未见于段产物）。无任何全栈成本数字可呈报。S 子矩阵（S0/S1/S2 采样敏感性）同样 0 有效——"采样率降低是否回收成本"（历史：`SAMPLE_RATIO=0` 无改善，转引）未获复测。

## 3. G3 — 长稳内存：INCONCLUSIVE

**Gate 定义**：长时运行内存稳定性（C8 长事务内存探针、RSS 斜率、#994 修复后回收形态对照 T10）。

**依据**：

1. **C8/#994 探针未执行**：rounds 内无 `--expose-gc` 探针运行产物（PROTOCOL §3.1 C8）【MEASURED｜目录普查】→ T10 无判定依据。
2. 最长观测窗 181s（全部段无效）；180s 窗内 RSS max 中位 H0 736.4 / H1 848.5 / H2 801.8 / H3 791.1 / H4 795.2 MB，段末低于段内 max——无单调增长形态，但窗口过短且段无效，不构成斜率/长稳证据【MEASURED，探索级】。
3. H3 memory ring 有界性有运行见证（7/7 段 shutdown dump 恰 1000 spans 全部解析成功，`h3DumpParsedOk=true`）【MEASURED】；ring 成本未隔离测量。
4. W7.2 历史 RSS +5~+16%（转引，容量数据、不在 ≤5% 预算内）未复测。GC 面 SKIPPED（无采集通道）。

## 4. G4 — exporter 故障隔离：PASS（附场景完备性缺口）

**Gate 定义**：T8/ADR-028 表三故障注入行——Collector 不可达/假死/队列满/导出超时/关机 flush 下，业务行为（Save/Submit/Deadline/Restore/审计 drain/关机 30s）与基线一致；应用层零信号是预期确认对象（G4 containment），不是反证对象（`PROTOCOL.md:263`）。

**依据**：

1. **campaign 故障注入矩阵有运行见证**（同目录 COVERAGE-MATRIX §1 W15 行、§2.2；E4 reject / E5 slow-hang / E6 queue-pressure / E7 memory / SIGTERM 全形态矩阵 / E8 配对【转引｜三族 campaign 产物，落盘复核由覆盖矩阵综合员执行，本会话未重跑注入】）：业务行为与基线一致；挂死 collector 下整进程 exit 5.10–5.23s < 30s 预算（#351/compose stop_grace 45s 均满足）。
2. **本 benchmark 的 T8 配额未重跑**：45 段 sink 全部 `mode="ok"`、`delayMs=0`，无 reject/slow 注入【MEASURED】——G4 的 PASS 立于 campaign 记录证据，不立于本次 benchmark。
3. **场景完备性缺口（如实列账，不推翻 PASS）**：T8 要求的场景中 unreachable / blackhole 仅有 PR #980 历史（pre-#994 栈，转引 PROTOCOL §7.4）；假死 accept-but-never-answer 与 BSP 队列满 2048 的**当前 SHA 精确形态**仅部分对应 E5/E6（slow-hang/queue-pressure）；"观测缺失读作 UNKNOWN"的应用层零信号为有意 containment（ADR-028 D1；GAPS O5）——isolation 成立，自诊断面缺失另列改进项（GAPS P7 最小信号面建议）。
4. **证据等级显式声明（复核轮）**：G4 是非数字预算门——不适用 PROTOCOL §6.4 的 CI/有效配对判定规则（该规则只约束数字预算 T1–T4，不存在"CI 含 0"通道）；本 PASS 立于**转引级 campaign 记录证据**（三族产物、落盘复核由覆盖矩阵综合员执行），本裁决会话未重跑任何故障注入，benchmark 侧 T8 配额未执行（sink 全程 mode=ok）。
5. 本实验独立正面信号：45 段全部 SIGTERM→exit code 0、53–1222ms，远小于 30s 预算【MEASURED】。

## 5. G5 — 工作流覆盖：PASS（缺口如实列账）

**Gate 定义**：16 工作流 × 必需信号的覆盖证据面是否建立到可裁决程度。

**依据**（`COVERAGE-MATRIX.md` §1/§2【转引｜campaign 收敛产物，含复核轮落盘复现记录】）：

- **FULL_RUNTIME_VERIFIED ×3**：W01（认证/考试列表）、W03（答案保存——40001/40P01/锁等待四注入端到端）、W09（deadline auto-submit——span/metric/DB 三方对账）。
- **PARTIAL_RUNTIME_VERIFIED ×10**：W00/W02/W04/W05/W06/W08/W10/W12/W14/W15（缺证集中在故障腿注入与部分 otlp-face 导出见证）。
- **TEST_ONLY ×1**：W11（三族均未触达，零运行证据）；**NOT_IMPLEMENTED ×1**：W13（有意边界）；**UNKNOWN ×1**：W07（输入从未提供定义，编号空洞）。
- **高频路径（频率 rank1–6：W03/W01/W05/W10/W08/W06）全部 ≥PARTIAL**，其中两条 FULL——覆盖面足以支撑 G1–G4 的裁决与 NO_GO 结论；剩余缺口（W05 幂等/crash/锁竞争、W06 terminal、W08 frozen、W04 ATTEMPT_ALREADY_SUBMITTED/E9、W11 整工作流）已在 GAPS §3 列账并排优先级。
- 覆盖矩阵的引用纪律经复核轮修正（E1 sink body-cap 假引用撤除、坏过滤器伪影剔除）——证据卫生合格。

## 6. BLOCKER-1 — D1 日志通道 SQL 全列 + 绑定参数值泄漏：FAIL（privacy BLOCKER）

- 500 路径 "Unhandled request error" 的 `err.message` 含 DrizzleQueryError 全列 SQL 文本**与绑定参数值**（org ID UUID + 用户名；样本 `/tmp/w964-gfamily/h3/server-out.log:99`【转引｜GAPS D1，复核轮落盘确认】）。
- **它是清单上唯一"现在就在发生"的隐私缺陷**：发生在生产默认 Off 态的 stdout 排障主通道，任意 500（含最高频 W03 保存/W01 登录 DB 异常分支）即触发，不依赖遥测启用决策。span/导出面干净（P1–P5 隐私边界实现完好；D1 是日志通道上的已知违例）。
- 处置要求：owner 裁定日志面契约归属并修复（错误消息脱敏/仅留 error kind），**先于任何 On 态启用讨论**。checkpoint 扫描器对该泄漏漏报（`analyze.mjs:203` 大写模式假阴性【转引】）——干净判定须大小写不敏感复验。

---

## 7. 裁决陈述的边界

1. **历史漂移与 OTel 增量分开**：H1−H0（跨 SHA，含 OTel 战役+#994+其他提交，非单一 A/B）本实验无数字；H2/H3/H4−H1（同 SHA）正式判定 UNKNOWN，探索点差仅方向参考。
2. **H4−H2 不命名**为纯网络导出成本（多因素：batch/序列化/metric provider/flush/背压）。
3. **WSL2 探索级**：全部数字仅机制归因，不支持生产容量外推（PROTOCOL §2）。
4. 本裁决不修改任何产品代码、契约或 ADR 状态；Stage D–G 重跑需另行授权（PROTOCOL §4，`PROTOCOL.md:4`）。
5. 协议版本裁决（manifest 钉 v1 vs 已有 v2）留给 Owner。

---

## 8. v3 裁决修订（R2 修复与重跑后；PROTOCOL-v3/v4 分区，2026-11-15 21:42 +08:00）

> **分区与取代声明**：本节使用 `out/otel-w964/workflow-audit-v3/` 分区数据与 R2 复核新证据重裁五门。§0 表保留为 v1/v2 时点历史记录；本节判定**取代** §0 表对应行的时点值。v1/v2 的失败证据（45 无效段、B1–B4）原样保留、不回溯翻案（`PROTOCOL-v4.md:3`），只作参考不作判定。

### 8.0 裁决总览（v3，取代 §0 表对应行）

| # | Gate | v3 Verdict | 一句话依据 |
| --- | --- | --- | --- |
| G1 | API 进程性能（ADR-028 T1–T4，CPU/p99 各 ≤5% vs 同 SHA H1） | **INCONCLUSIVE** | v3 有效配对 0（mixed=0/isolated=0/knee=0）；`aggregate.json` `rows: []`；PROTOCOL §6.4：配对 <6 判 UNKNOWN，禁止出 PASS |
| G2 | 全栈运行成本 | **INCONCLUSIVE** | v3 无 H4 有效段，exporter 字节面/collector 资源未采集；benchmark 仍无全栈成本数字 |
| G3 | 长稳内存 | **INCONCLUSIVE** | 无长稳 run；C8/#994 探针 SKIPPED；单段 RSS（knee H1@c50 rssMaxMb=2527.33，C=50 档）非斜率证据 |
| G4 | exporter 故障隔离 | **PASS**（维持；附 R2-08 拆账与场景完备性缺口） | 立于 campaign 转引级证据（§4 + COVERAGE-MATRIX §5 拆账）；v3 benchmark 无 T8 重跑（sink 全程 mode=ok） |
| G5 | 工作流覆盖 | **PASS**（维持；计数更新 FULL×4） | W07 归位后 FULL×4（W01/W03/W07/W09）+ PARTIAL×10 + TEST_ONLY×1 + NOT_IMPLEMENTED×1；四维分账 ④ 生产验收 16/16 未验收 |
| B-1 | **BLOCKER**：D1 日志通道 SQL 全列 + 绑定参数值泄漏 | **FAIL（存续）** | 本会话 gh 只读实查：无修复 PR、无专用跟进 issue（§8.4） |

### 8.1 G1–G5 逐项裁决（v3）

**G1 — API 进程性能：INCONCLUSIVE（维持，证据更新）**【MEASURED 除注明外】

- v3 三套件有效配对 = **0**：mixed 零段启动（预检门拒绝，唯一拒绝项 = H0 §6.6-3 register 缺失，`h0-equivalence.json` 不存在，仅 3 份 superseded 中间证据；`BLOCKED-20261115-hostside-docker-desktop-shutdown.md:34-36`）；isolated **51 个已记录段全部无效**（49 `SEED_CONVERGE_DB_UNREACHABLE` ECONNREFUSED + 1 `SEED_CONVERGE_DB_STARTING` sweep-6/H1-iso-C1 + 1 `CPU_PAIR_FAIL_CLOSED` sweep-6/H2-iso-C1——该段 seed 收敛成功、382 ops/0 errors、稳态窗样本 <2 fail-closed 作废；另 27 次 entry defer + 9 次 starved；`campaign-isolated/campaign.json` + sweep-*/segment-summary.json 逐段分类实读，`data-v3/segments.jsonl` 重算一致）；knee 6 单元仅 **1 个 H1@c50 harness-valid 基线段**（H4 全部 starved）→ 配对 0【`campaign-knee/campaign.json` 实读】。
- `workflow-audit-v3/aggregate.json`：`rows: []`（官方 `runner.js aggregate` 产物；`rounds/` 空；campaign 段不进聚合——`cmdAggregate` 只读 `ROUNDS_DIR`，`runner.js:5201-5244`）【MEASURED】。
- `freeze.json` 不存在 → v4 §6 正式采样程序序未到达；knee H1@c50 是梯度侦察段而非预注册正式单元，其单段数字（cpuMsPerOp=96.2619、p99=12168ms，closed-loop C=50 语义）**不作预算判定**。
- **预算判定规则不受数据影响**：有效配对 0 < 6 → T1–T4 全部 UNKNOWN（PROTOCOL §6.4 `:206,211-212,275`）；"数据不足以判定 ≤5%" → 两项预算均无法出 PASS → GO 条件不满足。
- 背景（非判定）：历史 PR #980（+10.4%/+9.1%，转引）与 v1 探索值（H2 +3.3%/H4 +10.8%，饱和域未配对）方向一致，均只作参考。
- 解除条件：`PERFORMANCE-REPORT.md` §9.5 第 4 条（H0 等价登记 → freeze.json → 确认段 → 正式采样 ≥6 配对 → §6.5(a)/(b) 落地后聚合）。

**G2 — 全栈运行成本：INCONCLUSIVE（维持）**：v3 无任何 H4 有效段（knee H4@c50/c100/c200 全部 starved；isolated H4 三个单元零有效段——51 段无效分解见 G1）→ 无 OTLP 导出运行数字；sink 仍只计请求数；collector 资源、字节量、DB/Redis 容器面未采集。S 子矩阵维持 SKIPPED（v3 §3.5 显式收缩）。

**G3 — 长稳内存：INCONCLUSIVE（维持）**：无长稳 run；GC/C8/#994 探针 SKIPPED（run-meta 无探针调用）；v3 唯一 RSS 数据点 = knee H1@c50 `rssMaxMb=2527.33`（C=50 档单段，与 v1 C=10 档 ~800MB 档位不同不可比）——非斜率、非长稳证据【MEASURED｜segment-summary.json】。

**G4 — exporter 故障隔离：PASS（维持，拆账如实）**：PASS 依据不变（campaign 故障注入矩阵 E4–E8、SIGTERM 全形态，关机 5.10–5.23s < 30s；转引级证据，落账见 COVERAGE-MATRIX §5——除 W07 外各分类本体维持转引级，不得当已独立重跑）。v3 benchmark 侧 T8 配额未重跑：全部 v3 段 sink `mode="ok"`、`delayMs=0`【MEASURED｜knee segment-summary.json sinkCounters】。v3 新增背景信号：knee H1@c50 段 shutdown exit 0 / 7045ms < 30s（单段，非验收）【MEASURED】。

**G5 — 工作流覆盖：PASS（维持；计数由 FULL×3 更新为 FULL×4）**：W07（Admin 强制交卷/操作员补时）经调度方补发定义 + CoverageCheck 归位为 FULL_RUNTIME_VERIFIED（静态锚点全命中 + 两段真实运行全 outcome 矩阵 + H3 dump face + 409/404/403 诊断链；三测试文件 25/25 复跑——`COVERAGE-MATRIX.md` 文件头 v3 修订记录【转引｜修订会话执行】）。覆盖态：**FULL×4（W01/W03/W07/W09）+ PARTIAL×10 + TEST_ONLY×1（W11）+ NOT_IMPLEMENTED×1（W13）**；四维分账（R2-08）生产验收维 16/16 未验收（`COVERAGE-MATRIX.md` §2.4 全局行）；高频 rank1–6 全部 ≥PARTIAL。G5 PASS 只覆盖"运行级可观测性证据面"，不构成生产验收（④）。

### 8.2 PRODUCTION_ENABLEMENT = **NO_GO**（v3 维持）

判定规则不变（ask 冻结，不得 waiver）：GO 仅当 ADR-028 表三 **CPU ≤5% 与 p99 ≤5% 两项均 PASS 且证据充分**（`docs/adr/ADR-028-opentelemetry-technical-telemetry.md:93-104`，PROPOSED；预算来源 #964）。v3 现状：G1 = INCONCLUSIVE（0 有效配对）→ 两项预算**均无法出 PASS** → GO 条件不满足 → **NO_GO**。数据不足以判定 ≤5% 时维持 NO_GO（本裁决纪律；PROTOCOL-v4 §1.3 第 5 条同款：预算判定只认 v4 下实测配对数据，不足则维持 NO_GO）。

生产默认保持 **Off**（`apps/api/src/telemetry/runtime.ts:208`【CODE_VERIFIED】）。本裁决不构成对 ADR-028（PROPOSED）的接受或拒绝（§8.5）。

### 8.3 Q1–Q8（含 R2 新证据；每条标 MEASURED / CODE_VERIFIED / INFERRED / UNKNOWN）

- **Q1 OTel 成本多少**：v3 正式数字仍为零（0 有效配对，`rows: []`【MEASURED】）；唯一同族实测成本 = 历史 PR #980 记录 On/no-export +10.4%、On/full-OTLP +9.1% CPU time/op（转引，超 ≤5% 预算）；v1 探索值 H2 +3.3%/H4 +10.8%（饱和域未配对，不作判定）。**答：无有效配对数字；历史记录双双超预算。**【UNKNOWN（本实验）+ 转引（历史）】
- **Q2 最贵三组件**：消融未启动（前置 mixed validPaired≥6 不满足）→ 无组件级成本实测。结构候选（非成本证明）：db.statement 语句 span（每 accepted-save trace 19 条，最大 span 体量）、后台 loop cycle 全量 tick 面、OTLP batch/序列化+metric provider（H4 相对 H2 多因素）。**答：INCONCLUSIVE——不得以 span 数量推 CPU 占比。**【UNKNOWN（成本）/ INFERRED（结构候选）】
- **Q3 哪些工作流最受影响**：无 v3 每工作流成本数据（isolated 三个隔离类零有效段、aggregate 无行）。结构面：W03（语句 span 密度最高）、W09/W10/W12（cycle span ∝ tick 频率）、W15（负增量：exporter 自身故障零信号）。**答：成本面 UNKNOWN；价值增量最高为 W03/W09/W07（三证 FULL）。**【UNKNOWN（成本）/ MEASURED（覆盖价值，转引级 campaign 证据）】
- **Q4 哪些关键链路覆盖不足**：W11 retention 整工作流 TEST_ONLY 零运行证据；W05 幂等/crash/grade leg、W06 terminal/disruption、W08 frozen、W04 ATTEMPT_ALREADY_SUBMITTED（E9 反常未根因）缺注入见证；otlp-face 导出见证大面积缺（E17/E18）；生产验收维（④）16/16 未验收；W14 取消/断连为运行实证盲区（B1）。**答：如上六类。**【MEASURED｜COVERAGE-MATRIX §2.4（转引级合成，本会话读取）】
- **Q5 OTel 真实诊断价值**：已证增量集中在——W03 DB 故障端到端定位（40001/40P01/锁等待，唯一通道）、W09 后台 deadline 决策链三方实时对账、W07 命令式幂等全 outcome 矩阵 + reqId↔trace_id 互证、W01 日志↔链路逐字节对账；W15 为负增量（exporter 故障应用层零信号，O5）；D2（biz span url.path="(unrouted)"）为全局已裁决缺陷。**答：有真实、已运行的诊断增量，但集中在 DB/后台/命令式链路；Off 态 WARN+reqId+audit 面已覆盖多数低频场景。**【MEASURED（运行见证，campaign 证据转引级 + W07 部分已独立复现）】
- **Q6 保留裁剪还是局部替换**：处置分级维持（GAPS §8.2）——主骨架 KEEP；条件性 SLIM 候选 = db.statement 非业务语句/preHandler 读 + loop cycle 采样比（仅 On 态超预算时审议）；Loki leg 与 collector 部署面 DISABLE_BY_DEFAULT；H3 ring/自诊断面/HTTP metric INSUFFICIENT_EVIDENCE；无 EXPERIMENTAL_REPLACE_CANDIDATE。**执行前置不变：先有 ≥6 有效配对成本数字。**【CODE_VERIFIED（分级依据读取）+ INFERRED】
- **Q7 是否满足生产预算**：**NO_GO（维持）**——CPU ≤5% 与 p99 ≤5% 均无有效配对数字可判 PASS；历史记录（+10.4%/+9.1%）超预算；D1 privacy BLOCKER 存续。**答：不满足（证据不足即不满足）。**【UNKNOWN（本实验数字）→ 判定 NO_GO（纪律确定）】
- **Q8 下一步最值得的 1–3 个优化**：①**D1 日志通道脱敏修复**（privacy BLOCKER，Off 态现在就在发生，不依赖成本数字——P1，成本无关）；②**打通预注册采样链**：完成 H0 §6.6-3 等价登记（run3 已有 1 对 verified 证据可续）→ §6.5(a)/(b) 机器路径 → freeze.json → 确认段 → 正式采样 ≥6 有效配对（R2 修复已被 knee H1@c50 首个 valid 段证明可用——B2/B4 修复与 v4 判据成立）；③**有数字后跑剖析+顺序消融**，量化 SLIM 候选（db.statement 非业务语句、loop cycle 采样比）收益，支撑裁剪决策。**答：如上三项，按序。**【CODE_VERIFIED（前置状态）+ INFERRED（优先级排序）】

**R2 新证据对裁决的影响（九项复核）**：R2-01（CPU 采样缺陷）/02（配额 11000 权威口径）/03（B4 fixture×scanner 竞态行级坐实 + per-attempt 保存所有权）/04（aggregate 按 workflow 维度分组）/06（configs 去机器路径）= VERIFIED 且已修复（selftest 23/23，`PROTOCOL-v4.md:131` 附录 A.3）；R2-05（W07 归位）→ G5 计数更新 FULL×4；R2-08（G4/G5 证据分账）→ §8.1 G4 拆账 + COVERAGE-MATRIX §2.4/§5；R2-07/09（README 过时、manifest 引用 gitignored 原始数据）→ 可复核性缺口如实列账（GAPS 既有记录）。**R2-03 PARTIAL 剩余面与 R2-07/08/09 finding 原文不在审计树（grep 零命中，`PROTOCOL-v3.md:316` A.6）——verdict 以 ask 材料为准记录，冻结前核对义务未免除。**

### 8.4 D1 修复 PR 实际状态（本会话 gh 只读实查，MEASURED）

- `gh issue view 964 --repo jnhu76/exam --json state,title,updatedAt` → `{state:"OPEN", title:"[Umbrella][Architecture][Observability] Exam Observability V1 — OTel 统一迁移与独立 Drizzle/Postgres.js 插桩插件", updatedAt:"2026-11-15T03:14:46Z"}`；`gh api repos/jnhu76/exam/issues/964/comments --jq length` → **1 条**。
- `gh pr list --repo jnhu76/exam --state open` → 仅 **#996**（perf(telemetry) 审计开销与覆盖，分支 `perf/otel-workflow-attribution`，head `7a2de31e`，state OPEN、mergedAt null——`gh pr view 996` 实查）与 **#995**（commit policy）。**无 D1 修复 PR**。
- 修复关键词 PR 搜索（"D1"/"log redaction SQL"/"leak params"/"privacy SQL"/"redact log"）→ 命中均为无关/已合并历史 PR，无 D1 修复。
- **结论：BLOCKER 存续——D1 隐私缺陷无修复 PR、无专用跟进 issue；任何 On 态启用讨论前必须先修复 D1**（判定原文归属 #964 checkpoint，GAPS §1 维护修复状态，本裁决不重判泄漏本体）。

### 8.5 ADR-028 状态：保持 **PROPOSED**

`docs/adr/ADR-028-opentelemetry-technical-telemetry.md` 状态行实测 = **PROPOSED**（"未接受前不构成施工授权，也不改变任何现行契约"，文件 `:5`）【CODE_VERIFIED｜本会话读取】。本裁决不修改其状态；本实验产出其评审输入。PROTOCOL-v4 的 Owner 代理裁决（选项 (c)，B_self=6.8/上限 8.0/增量 1.5）全部条款留 Owner 复核（`PROTOCOL-v4.md:3,142`）——Owner 复核若推翻，按其 §1.3 程序出 v5 并重估已采数据有效性。

### 8.6 v3 裁决的边界

1. 全部 v3 数字仍为 **WSL2 探索级**，仅机制归因，不外推生产容量（PROTOCOL-v4 §5 口径变更声明随附）。
2. knee H1@c50 单段数字（CPU 96.26 ms/op、p99 12168ms、RSS 2527MB）是 C=50 梯度档 closed-loop 侦察值，**禁止**读作典型档成本或容量拐点。
3. H1−H0 历史漂移与 H2/H3/H4−H1 OTel 增量继续分开陈述（§7 边界 1 不变）；H4−H2 不命名纯网络导出成本。
4. 本裁决不修改产品代码、契约或 ADR 状态；正式采样（Stage D–G）另行授权。

## 9. v3.1 裁决修订（正式 campaign 配对数据落地；2026-11-16）

> **取代声明**：本节以 PROTOCOL-v4 冻结参数下采出的正式配对数据（`campaign-mixed/aggregate-campaign.json`；评审侧交叉验证 `data-v3/stats-output.json`，两实现逐位一致）取代 §8.0/§8.1 中 G1 与 Q1 的对应行；其余裁决（G2–G5、B-1、§8.4/§8.5）不变。执行链与读数边界详见 `PERFORMANCE-REPORT.md` §9.6。

### 9.1 G1 — API 进程性能：**H4 FAIL 方向实测 / H2·H3 UNKNOWN**（取代 §8.1 G1 的 INCONCLUSIVE-by-no-data）

| 配置对 | n | CPU Δ% 中位 [95% CI] | p99 Δ% 中位 [95% CI] | 判定 |
| --- | --- | --- | --- | --- |
| H2（On/无导出） | 10 | +3.91 [+2.878, +5.370] | +2.29 [+1.259, +10.248] | UNKNOWN（CPU CI 上界超预算 0.37pp；p99 IQR 8.09pp） |
| H3（On+dump） | 9 | +4.78 [+3.226, +7.166] | +2.42 [+1.389, +9.971] | UNKNOWN（双指标 CI 跨 +5） |
| H4（On+全 OTLP） | 8 | **+10.14 [+8.374, +16.943]** | +5.74 [+4.692, +17.249] | **CI 下界 +8.37% > +5% → FAIL 条件成立**；同时命中 IQR>5pp → UNKNOWN 条件——v2 §6.4 冻结表对二者无优先级，双条件并呈 Owner；**任何读法不可 PASS** |
| H0（血缘背景） | 10 | +0.30 [−0.696, +7.535] | — | CI 含 0 → INCONCLUSIVE@0（无可测血缘漂移） |

- 判定依据：ADR-028 表三（CPU/p99 各 ≤5% vs 同 SHA H1）；统计 = 配对 Δ%、bootstrap 10000/固定种子 20261115、效应量中位（PROTOCOL §6.3/§6.4 冻结）；47 个 valid 段全部经 7 项预检 + v4 干扰判据（外部增量全为负或 ≤1.5）。
- **G1 门总结论：≤5% CPU 预算在全 OTLP 配置上实测不满足**（+10.14% 中位，CI 全程高于预算线）；On/无导出与 On+dump 处于预算边缘（中位 +3.91%/+4.78%）但判定力不足以二分。p99 无配置收敛可判。
- 程序性缺口如实呈 Owner：`run-meta/freeze.json` 机械标记未落盘（as-built 无写入方；正式段均在 v4 冻结参数 + 7/7 门下执行）；H4 的 FAIL/IQR 双条件需 Owner 依冻结表裁决。

### 9.2 Q1（OTel 成本多少）——首次实测答案

**On/无导出 ≈ +3.9% CPU、On+dump ≈ +4.8%、On+全 OTLP ≈ +10.1% CPU ms/op（中位，CI 见 §9.1）；p99 中位 +2.3%/+2.4%/+5.7%（判定力不足）；RSS 增量 ≈ +43MB。**方向与历史 PR #980（+10.4%/+9.1%）一致。全部为 WSL2 探索级、C=1 闭环吞吐语义，不外推生产容量。

### 9.3 PRODUCTION_ENABLEMENT = **NO_GO**（v3.1 维持，依据升级为实测）

GO 条件（CPU ≤5% 且 p99 ≤5% 双 PASS 且证据充分）在当前数据下**无配置可满足**：H4 实测超预算；H2/H3 判定力不足（不足以二分即不足以 PASS）；D1 privacy BLOCKER 存续（§8.4）。生产默认保持 Off（`runtime.ts:208`）。ADR-028 保持 PROPOSED；本节产出其评审输入。
