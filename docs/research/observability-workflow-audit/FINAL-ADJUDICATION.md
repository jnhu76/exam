# FINAL-ADJUDICATION — 观测性战役最终裁决

- **裁决角色**：首席性能工程师（成本/价值最终裁决）。裁决只认证据。
- **协议哈希（双口径声明，复核轮修订）**：全文件口径（`sha256sum` 实测）PROTOCOL.md = `8bc7f7cdf06353b80d149336e492cbb41b0896a844a5781a34ee03fdee80df63`（与 ask 提供值一致）；内容哈希口径（去除修订日志节，`awk '/^### 修订日志$/{exit} {print}' | sha256sum` 实测）= `4eddc216…`，恰为 harness manifest 所钉值——两组值各自为真、口径不同，冻结正文未被篡改（详见 PERFORMANCE-REPORT 文件头）。
- **裁决日期**：2026-11-15。
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
   - **B1** 配额结构性不可完成：12000 ops/段 vs 180s 窗 vs 实测 19.31–23.05 ops/s（需 ~520–620s），`configs.json:30,33,35`；
   - **B2** harness CPU 采样缺陷：`runner.js:1858` `await sleep(60)` < `PROC_SAMPLE_MS=1000`（`runner.js:87`）⇒ cpuStart 恒 undefined【CODE_VERIFIED，本会话逐行确认】——CPU 主指标必然缺失；
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
