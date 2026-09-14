# 14 — Fresh-Context Corrective Review（REPORT-CORRECTIVE-1）

> 本文件保存 fresh-context 对抗复核（SA2）的最终结果与主 agent disposition。
> Reviewer 未被告知"预期通过"；只获得 BASE_SHA、corrected 报告、repository 与
> review mandate。Reviewer 结论（原样摘要）与主 agent 处置如下。

## 1. Reviewer 方法

- 打开原始来源验证（代码、schema、ADR、contracts、gh API、git 对象、/tmp/exam-audit-notes 保留探针输出），不只 review markdown。
- 攻击面：unsupported PROVEN、authority misread、legacy header 误读、Issue 状态过期、从 capability 名发明 resource ownership、TEST_EXISTS vs EXECUTED、容量外推、severity 漂移、矛盾计数、原始测量被改以迎合结论。

## 2. Reviewer 验证通过项（全部 7 项关键 disposition 正确）

1. **F1-04 REJECTED** ✓ — `exam_policy_profiles` 无 courseId（pg.ts，表注释明示 "Excluded from profiles (by design): courseId"）；P7-M2 §6 把 courseId 列入排除；§15 文档化 capability 复用；presets.ts F-04 marker boundary rule 只覆盖 course-resident resource。
2. **F1-10 REJECTED** ✓ — ADR-010 header legacy `Proposed` vs 权威 Status 节 `Accepted — infrastructure implemented`；无机制消费 header（adr-status-contract.mjs 只解析 ADR-007 的 Status 节）。
3. **ADR-018 ALIGNED** ✓ — ACCEPTED (2026-08-14)；D1/D3 当前 /system/* = realization；anti-goals 列明 OTel/收集器/platform。
4. **#498 CLOSED / TRACKER_POINTER_DRIFT** ✓ — gh 实测；#534 自称 memory roadmap；13 处 doc 引用确认。
5. **Health 五层模型** ✓ — /api/health 静态 liveness（apiSurface.ts:42-53）；/api/system/health DB ping（system.ts:304-323）；compose healthcheck 只探 liveness。
6. **submit 尾部 p95/p99/max = UNKNOWN** ✓（但见 defect 2 的 p50 对称性）；report() 内置分位数但无 SUBMIT BURST 输出被保留。
7. **capability = 89** ✓ — 机械计数；7 角色预设数全部复核（Admin 76/Teacher 18/Proctor 6/Grader 4/Candidate 8/Maintainer 5/System 4）。

另确认：树身份/ancestry（diff 空、merge-base=b9b0e08c、production diff=0）、CI run 34767087301（9 job 全绿）、corpus 计数（454 层计数可复现、469–472 波动披露一致）、register 计数机械一致（12/16/7/2/0/0）、关键 MINOR 锚点（F1-03/F2-03/F2-05/F2-04/F3-04/F1-04b/限流 HMAC key）。

## 3. Reviewer 缺陷清单与主 agent disposition

Reviewer 总体 verdict：**REJECT with precise bounded fixes**。11 项 defect 逐项处置：

| # | defect | disposition | 落实 |
| --- | --- | --- | --- |
| 1 | 00:101 "12 MINOR / 11 NOTE" 与 register 16 NOTE 矛盾 | **ACCEPT**——count drift，同类 RPT-06 | 00 §4 → 16 NOTE |
| 2 | submit p50≈1.3s 保留而同一行 p95/p99/max UNKNOWN 属证据不对称（同源未保留输出） | **ACCEPT**——建立三档证据层级，p50 与尾部同标准 | 08 §2 TIER-1/2/3 规则；场景 A/D/E 标注 |
| 3 | #540 issue body 仍携带 pre-corrective 结论，报告未 flag | **ACCEPT（记录不修改）**——corrective 授权不含 Issue 写路径；显式记录供 human 决定 | 00 §6、13 §9 |
| 4 | 01:25 "8 个部署测试" vs 实际 9 | **ACCEPT** | 01 §1 → 9 |
| 5 | contracts "32 源文件" 不可复现（实际 30） | **ACCEPT** | 00/01 → 30 |
| 6 | 02:46 "route module ×26" vs 27 | **ACCEPT** | 02 → ×27 |
| 7 | 04 UI_EXPOSED "39" 不可复现（grep=37） | **ACCEPT**——basis 记录为 grep 去重 | 04 §6 → 37 |
| 8 | 05 用未定义 severity "LOW" | **ACCEPT**——词表统一 | 05 §4 → NOTE |
| 9 | **场景 B "p50 17-30ms / p95 ≤30ms / 无跨端点劣化" 与 retained steady-out.log 矛盾**（answer 780 端点中约半数 >30ms、p90≈406ms、max≈708ms；heartbeat p95≈517ms） | **ACCEPT（最严重项）**——原审计结论与其自留 artifact 的直接矛盾；corrective 从 artifact 重新推导 | 08 场景 B/§3、12 CAPACITY_100/Q3 重写 |
| 10 | 开局风暴百分位数（905/1070/1073/1075ms）同属未保留输出，却被当 MEASURED | **ACCEPT**——同一证据标准 | 08 场景 A TIER-2 标注 |
| 11 | "8 处" vs 13 处 tracker 引用 | **ACCEPT** | 13 §5、11 RPT-03 → 13 处 |

主 agent 对 defect 9 的独立复核：对 `steady-out.log` 重新统计（每端点 2 样本，n=2 时 p50=p95=p99=max=端点延迟）→ answers p50≈33/p90≈406/p95≈552/max≈708ms；heartbeat p50≈126/p95≈517ms；take p50≈32/p95≈95ms；0 错误。与原"p95≤30ms 无劣化"不符；API 侧 pino 日志仅记录 incoming request（无 responseTime），无法提供第二来源——以 retained artifact 为准。**该修正不改变正确性结论（错误 0、落库 100%），改变的是延迟形态与"余量"表述。**

## 4. Review-repair 循环结果（主 agent 复核后）

- Reviewer REJECT → 11 项全部处置 → 修正后的一致性 re-sweep（13 §8）通过。
- 主 agent 复核结论：reviewer 的 11 项 defect 全部成立或可接受；其中 defect 9 属于原审计"结论与自留证据矛盾"类，由 corrective 修复；defect 3 属授权边界（不改 Issue，显式记录）。
- 修正后整体 verdict（主 agent）：**corrected 报告集通过对抗复核**——七大关键 disposition 全对、证据层级统一、无剩余已知计数矛盾；残余风险见 §5。

## 5. 残余风险（human 仍应检查）

1. **场景 B 延迟重尾**（answer p90≈406ms/p95≈552ms；heartbeat p95≈517ms）在 100 人稳态已是可观测形态；若真实考场对端到端延迟敏感（如心跳超时阈值 30s 级，实际余量仍大），部署验收应重测连接池行为（池 max=10 无配置面）。
2. **submit/start 风暴延迟**：TIER-2/3——如需精确尾部承诺，需重跑实验并持久化 report() 输出。
3. **#540**：由 human 决定更新或追加 corrective 评论（13 §9 提供了两种选项）。
4. **tracker 指针**（#498 CLOSED 仍被引为 live；#534 前置文本未 reconcile）：由 human 收敛 docs 指针（本 corrective 不修改）。
5. **LONG_LIVED_DATASET / CAPACITY_200**：仍未证明——属后续容量专项。

## 6. SA 调用计数（corrective）

```text
SA_CALL_COUNT = 1（fresh-context reviewer，本报告）
MAX_SUBAGENT_CALLS = 2（预算内）；MAX_CONCURRENT = 1；无递归 subagent
```