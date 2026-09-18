# #549 — Product-requirement audit: ELIGIBILITY_AT_T vs MATERIALIZED_AT_T

问题：是否存在**现行**产品契约要求"即使无考生轮询，批次 N 也必须在 T 附近放行"？
逐来源分类（ELIGIBILITY GUARANTEE / MATERIALIZATION GUARANTEE / UI ESTIMATE /
IMPLEMENTATION DETAIL / HISTORICAL / AMBIGUOUS）。

## 逐条分类

| 来源 | 原文（摘） | 分类 | 依据 |
| --- | --- | --- | --- |
| docs/SPEC.md §2.7（控制旗标表） | "每批放行人数""批次间隔秒数""首批即时放行，批不满按时放行" | **ELIGIBILITY GUARANTEE** | 描述批次策略的放行数/节奏语义（releasedBatches 公式），未指定"谁在 T 写库"。同一节明确 admission 是"与计时正交的准入维度" |
| docs/SPEC.md §4.4（排队分批进入） | "每批放行 N 人，间隔 3-5 秒……轮到时自动跳转到考试页面" | **UI ESTIMATE / Phase-2 流程草图** | 该图明确标注 Phase 2 `timed_sync` 流程（操作员点击开考触发），Phase 1 未激活；"轮到时自动跳转"是考生端 poll loop 看到就绪后导航（StartExamPage.tsx:86），Model A 完全满足 |
| packages/contracts/src/attempt.ts:960-968 | "Shows the candidate's position and **estimated** wait time." | **UI ESTIMATE** | 契约用词 estimated；`estimatedWaitSeconds` 由谓词推导 |
| apps/web/src/i18n/locales/zh-CN.ts:3112 | "预计等待约 {{seconds}} 秒" | **UI ESTIMATE** | 显式"约"；就绪判定 `status==="ready"` 来自服务器持久事实 |
| docs/architecture/exam-runtime.md §3.1.1 | "需求驱动：join/status/start 三条 canonical 路径上按需 reconcile（CAS 写 admitted_at，幂等），**无后台 scheduler/worker**" | **IMPLEMENTATION DETAIL（现行权威 as-built）** | 现行架构文档把需求驱动写成设计语义，即现行契约就是 lazy |
| exam-runtime §3.1.1 批次策略行 | "releasedBatches = floor(elapsed/interval)+1" | **ELIGIBILITY GUARANTEE** | 资格谓词的数学定义 |
| docs/research/exam-production-reality-audit-1/08（F-08-2） | "停轮询期间积压批次在下次轮询一次性补放（56 人同刻 ready）" | **HISTORICAL / 观测** | 审计见证（已在本分支 harness 复现，见 02）；描述行为，不是要求 |
| product-semantics-audit-1-authority-diff.md #20 | "estimatedWaitSeconds 公式……展示精度无 owner"（UNDERSPECIFIED） | **AMBIGUOUS（展示精度）** | 只涉及估计值显示精度，不涉及物化保证 |
| admin admissions 契约（contracts/attempt.ts:978-994） | 只读列出 joinedAt/admittedAt/consumedAt | **IMPLEMENTATION DETAIL** | 展示持久事实；未承诺 admittedAt 会在 T 推进 |
| 全仓 "released/ready/放行" 其余出现 | — | **ELIGIBILITY GUARANTEE** | 无一处把 human-facing 措辞绑定为服务器自主写保证 |

**HUMAN-FACING WORDING AUDIT**：`released/放行` 在 SPEC/文档中一律描述资格节奏；
`ready` 的可观察定义（wire + UI）都是"服务器持久 admitted 事实存在"。没有任何
来源把措辞实现为 durable 写保证。

## 结论

```text
PRODUCT_REQUIREMENT: ELIGIBILITY_AT_T
```

- 批次时刻 T 的产品含义是**资格边界**：从 T 起，考生下一次权威交互即被放行。
- **MATERIALIZED_AT_T 无任何现行契约要求**；现状（需求驱动物化）反而是 exam-runtime
  §3.1.1 的明文设计语义。
- 因此按 prompt §4/§15 规则：NOT_SPECIFIED 的部分取与可观察行为一致的最少机制
  → 倾向 KEEP_LAZY（burst 成本证据见 02，Option B 成本见 03）。
