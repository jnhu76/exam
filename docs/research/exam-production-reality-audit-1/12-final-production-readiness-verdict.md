# 12 — 最终生产就绪裁决（EXAM-PRODUCTION-REALITY-AUDIT-1 · REPORT-CORRECTIVE-1）

BASE_SHA `b9b0e08c`（corrective 分支 `audit/exam-production-reality-1-corrective` 真正基于该 SHA；树身份：与 CI 跑的 cc3f2c 字节相同）。审计性质：AUDIT ONLY + REPORT-CORRECTIVE，零 production 修改。全部结论的证据与限界见各分报告；本报告只做收敛裁决。证据类型缩写沿用 00 报告。

> **REPORT-CORRECTIVE-1**：本裁决已多维化（§1），并修正旧版四处过强/错误表述：
> ① 删除无边界的 `FUNCTIONAL_CORRECTNESS = PROVEN`（改为 scoped 的 GENERIC_RUNTIME_CORRECTNESS + 显式 UNKNOWN 清单）；
> ② 删除 `UI COMPLETENESS = PROVEN / zero dead UI`（拆分五维）；
> ③ severity/计数统一（89 caps、0 MAJOR、F-08-1=MINOR）；
> ④ "20–100 candidates proven" → "100-candidate generic exam workload SUPPORTED_WITH_GAPS under the measured single-instance topology"。

## 1. 分维度裁决（corrective 多维化）

| 维度 | 裁决 | 依据 |
| --- | --- | --- |
| GENERIC_RUNTIME_CORRECTNESS | **PROVEN**（范围限定：generic exam runtime invariants） | 指：状态机转换闭包、answer save 协议、提交冻结屏障、自动批改、崩溃恢复、单时间 kernel（03/07 报告）；owner-unit 测试 + CI 执行证据 + 本审计 130 人实验零错误。**不主张**：全部产品行为 / 全部路由 / 全部浏览器流程都已被穷举证明（见 UNKNOWN 清单） |
| AUTHZ_CORE | **PROVEN** | 授权链 fail-closed、无 fail-open、攻击模式全负（04 §7）；结构锁 routeRegistryConformanceWholeApp；89 key + 7 角色矩阵机械一致。残留 MINOR：client-events 无所有权（F3-04）、DECLARED_ONLY 8 项（NOTE） |
| RBAC_RESOURCE_SCOPING | **SUPPORTED_WITH_GAPS** | #286 teacher course-assignment 收窄 + teacherCourseScope 套件 + proctor grader scoped carriers 全部在案（04）；F1-04 已 REJECTED——无确认的 examProfile MAJOR；gap = 无 UI 的 carrier 管理（F1-04b）与 client-events 非 course resource 不开 scope（F3-04，已声明 by design） |
| PRODUCT_TRUTHFULNESS | **PROVEN** | #516 收口后不支持的字段在 authoring 层拒绝激活，无 fake UI/inert config（05 §3）；可见性投影单一权威（03 §6） |
| ATTEMPT_STATE_SAFETY | **PROVEN** | 单一 kernel、锁序统一、双提交防护、崩溃恢复真实进程测试（03 §2/§6、07 §2/§4）；状态列裸 text 完整性风险为 MINOR（F1-03） |
| TIME_AUTHORITY | **PROVEN** | ONE semantic kernel 实证成立；无竞争权威、无进程内存真相（03 §4） |
| SUBMISSION_GRADING | **PROVEN**（含尾部延迟 UNKNOWN） | 冻结屏障+workset+pending_manual 不自动终结；130 并发提交 100% 落 graded（03 §6、08 场景 D）；交卷风暴 p95/p99/max = UNKNOWN（08 场景 D corrective 标注） |
| RECOVERY | **SUPPORTED_WITH_GAPS** | SIGKILL 级重启追赶 ≤30s 有测试；路径齐备（07 §4）；gap：compose healthcheck 不 gate DB readiness（F3-05）、备份 RPO/RTO 未承诺（NOT_ENFORCED） |
| OPERATOR_DIAGNOSTICS | **PROVEN** | liveness（/api/health）+ DB-aware readiness（/api/system/health）+ diagnostics + 结构化日志 + 审计闭合 + graceful shutdown 契约（08 §4 五层表） |
| ACTIVE_ALERTING | **NOT PRESENT**（gap） | 无 metrics 推送/告警接线；运维知识 pull-only（F4-05） |
| UI_ROUTE_REACHABILITY | **PROVEN / NONE DEAD FOUND** | 88 页面全可达、无壳页面（06 §2/§7） |
| UI_OPERATIONAL_COMPLETENESS | **SUPPORTED_WITH_GAPS** | 反向缺口：teacher/grader assignment 无 UI（F1-04b）、ScoreListPage 导出按钮可见但服务端 403（F2-04） |
| UI_SECURITY_AUTHORITY | **NOT APPLICABLE** | 服务端始终是授权权威；UI 缺门不构成权限提升（06 §7） |
| CAPACITY_DIRECT_LAN_20 | **SUPPORTED_WITH_GAPS** | 130 人实验覆盖；唯一部署注意点=登录限流 10/min/IP（08 §2-3） |
| CAPACITY_DIRECT_LAN_50 | **SUPPORTED_WITH_GAPS** | 同上（direct-LAN 拓扑下不触发共享 IP 限流） |
| CAPACITY_DIRECT_LAN_100 | **SUPPORTED_WITH_GAPS** | 130 人 A/B/C/D 全过：开局 p95 1.07s（TIER-2）、稳态 CPU 6.6% 单核、错误 0、交卷风暴 100% 落 graded；池 max=10 排队出现且**延迟存在重尾**（answer 端点 p90≈406ms/p95≈552ms，retained log —— corrective 后修正原"p95≤30ms"表述）；**限界**：单实例、WSL2 单机、主场景 RATE_LIMIT_DISABLED（限流单独实验）、刷新风暴/大历史数据集/反代拓扑未测（08 §3.1） |
| CAPACITY_SHARED_NAT_100 | **NOT READY under default limiter config** | 共享出口 IP 时 ~15 人即触顶全局 100/min（F-08-1，MEASURED）——限流配置或限流键调整前不满足 |
| CAPACITY_200 | **NOT_PROVEN** | 未实测 200 人；外推风险点：连接池排队深度、扫描查询大表成本（F7-03） |
| LONG_LIVED_DATASET | **NOT_PROVEN** | client_events 无 retention（F1-05）、incident reconcile 无界扫描（F2-05）、scanner 索引未测（F7-03）；学期级数据量行为未验证 |
| HIGH_ASSURANCE | **NOT_APPLICABLE**（当前产品边界，有意未实现） | Controlled/Strict（#293/#315/#316/#317）未实现且未对外谎称；#534 为 memory roadmap |

UNKNOWN 清单（GENERIC_RUNTIME_CORRECTNESS 的限界，逐项可后续取证）：

```text
所有 454+57 个测试文件的逐条执行（corpus vs executed 分离，09 §4）
E2E spec 覆盖矩阵细目（F2-09）
刷新/重连风暴负载形态（08 §3.1）
大历史数据集查询计划（F7-03 / LONG_LIVED_DATASET）
200+ 并发（CAPACITY_200）
交卷风暴 p95/p99/max（TIER-3，从未记录）；开局/监考/准入恢复延迟为 TIER-2（转录，raw 未保留；08 §2）
生产反代 trustProxy 拓扑
CI workflow 接线细节（已在 09 §4.2 补 CI run 证据）
restore bounded_grace 逐行算术
status 文档逐条对账（F3-10）
```

## 2. Q1 — 今天部署，20/50/100 人真实考试能不能考？

- **20 人（direct-LAN）：能。** 功能正确性、状态安全、时间权威、提交批改均有强证据；注意点：20 人从同一 IP 分批登录（login 限流 10/min/IP）或调高 RATE_LIMIT_MAX。
- **50 人：能，附两个部署前提。** (a) 考群不共享单一出口 IP，或调高限流并接好真实 IP（F-08-1 拓扑表）；(b) 使用 compose 单容器契约（多实例未测）。
- **100 人：基本能，前提同上 + 运维在场。** 实验覆盖 130 人全流程（开局风暴/稳态/监考/交卷风暴）零错误；但"出问题时 operator 能否第一时间知道"的答案是 pull-only（F3-05/F4-05）——建议至少接日志告警。**共享 NAT 或反代无 XFF 接线的拓扑下，默认限流配置不满足 100 人。**

## 3. Q2 — 如果不敢让 100 人考，blocker 是什么？

**没有代码级 BLOCKER，也没有 MAJOR。** 使人犹豫的具体短板（非"需要优化"式空话）：

1. **限流键=裸 IP**（`rateLimitKey.ts:24-30` + 默认 100/min、login 10/min）：**仅共享出口 IP 拓扑**下 ~15 人即被 429 中断答题（实测复现，08 §4；direct-LAN 不触发）——部署配置风险，MINOR。
2. **compose 健康门不 gate DB 就绪 + 无告警推送**（docker-compose.yml:87-96、F3-05/F4-05）：PG 宕机时 compose 仍报 healthy，operator 无推送——pull-only 运维，MINOR。
3. **client_events 无 retention** + incident reconcile 无界扫描：学期级数据量后的慢性退化（未测阈值）。
4. **200+ 容量未证**（池 max=10 固定、扫描查询大表成本未测）——是"未证明"而非"已证不行"。

## 4. Q3 — 如果 100 人基本可以，证据是什么？

- **functional corpus + executed evidence（corrective 修正后分开表述）**：corpus = ≈454 Vitest 测试文件 + 57 Playwright spec（文件存在性，09 §1）；executed = CI run 34767087301 在 cc3f2c（与 BASE 树字节相同）上 9/9 job 全绿（Static checks/Build/API/Web/Package coverage/E2E 4 shards，09 §4.2）+ 结构/竞态/进程重启权威测试 + 本审计 130 人端到端实验（开局→答题→监考→交卷→批改 100% 一致，08 场景 A-D）。**不再把"454 个测试文件存在"表述为"454 个测试通过"。**
- **capacity evidence**：实测工作负载模型（6.6 req/人/min）+ 130 人稳态 CPU 6.6% 单核、错误 0；稳态延迟分布（retained log，TIER-1）：answer 端点 p50≈33ms、p90≈406ms、p95≈552ms、max≈708ms（连接池排队重尾），heartbeat p95≈517ms；开局 p95 1.07s（TIER-2）、交卷 p50 1.3s（TIER-2；p95/p99/max UNKNOWN——TIER-3）；瓶颈排序：限流/IP（仅共享 IP 拓扑）> 连接池（延迟尾部来源）> CPU（08 §2-3）。**单机隔离环境证据，非生产硬件外推。**
- **recovery evidence**：SIGKILL 进程重启 ≤30s 追赶（仓库测试）；重启后 admission/email/批改恢复路径机制验证；9 个真实 Compose 部署/备份/PITR 测试。
- **operational evidence**：审计轨迹闭合、优雅停机预算机器门禁、备份真实性 DB CHECK、liveness+readiness 分层证明（08 §4）；**弱**：主动告警缺失、compose DB-readiness 门缺失（MINOR 已登记）。

## 5. Q4 — 当前系统更接近哪个形态？

```text
DEMO                        — 否（远超）
INTERNAL_TOOL               — 部分是（无告警/容量证据的运维面像内部工具）
SMALL_REAL_EXAM             — ★ 核心答案：20–100 人 direct-LAN 真实考试可信支撑
DEPARTMENT_SCALE_EXAM       — 接近：100–200 人区间功能上具备，容量上界与限流/运维前提是缺口
100+ CANDIDATE PRODUCTION   — 未达：容量仅单机实验证据 + 运维推送面缺失
HIGH_ASSURANCE_EXAM         — 不是，且产品诚实（Controlled/Strict 未实现未谎称，#293 序列在案）
```

多维结论：**GENERAL/GENERIC EXAM RUNTIME 强（attempt/answer/deadline/submission/RBAC-core）；SMALL_REAL_EXAM（20–100 direct-LAN 或适配拓扑）supported with gaps；100 用户共享单限流 IP 在默认配置下 not ready；active alerting 为 gap；long-lived large dataset 与 200+ not proven；HIGH ASSURANCE 有意未实现。**

## 6. 审计方法自述（证据边界，corrective 修订）

- 13 份报告 + 2 份 corrective 交付（13 changelog、14 review）。原审计 5 次 subagent 调用；corrective 使用 1 次 fresh-context reviewer（14 报告），主 agent 亲自重新取证全部纠正点（F1-04/ADR-010/ADR-018/#498/测试证据/ancestry/计数）。
- 实验全部在隔离 `exam_e2e` 与 /tmp 探针完成；production worktree diff=0（corrective 验证见 §7）。
- 原报告自身错误已显式登记为 REPORT_CORRECTIVE RPT-01..07（11 报告），不抹除历史。

## 7. Final validation（corrective，实际执行）

```text
git diff --check                         → PASS（无空白错误）
pnpm verify:static                       → PASS（见输出）
git diff b9b0e08c -- ':(exclude)docs/research/exam-production-reality-audit-1/**'
                                         → 空（production diff = 0）
git merge-base b9b0e08c HEAD             → b9b0e08c...（ancestry PASS）
```