# 最终裁决（FINAL-VERDICT）

- 轮次：secure-correlation-audit（终稿交付物 10/10）
- 基线 MASTER_SHA = `423f2945d9feef73a5413e498fb2772cc245c754`（master，Merge PR #915）。
- 归票：issue864 / issue865 / performanceVerdict 取三裁决官（review/security.md、review/performance.md、review/architecture.md）多数，**issue 级三项均为 3:0 一致、无平票**；**option 级存在一例平票**（865-B 三官 DEFER/GO/NO_GO 各一票，按规则取保守值 DEFER）与四例 2:1 分歧，全部记录于 ARCHITECTURE-OPTIONS.md §1–§3 与 INDEPENDENT-REVIEW.md §3。
- 六项判定由证据直接判定，依据行见 §1；productChanges 固定 NONE（本轮为只读审计，未修改任何 git 跟踪文件）；githubWriteback 见 §4。

## 1. 六项判定的证据依据行

| 判定 | 值 | 依据（一行） |
|---|---|--- |
| authorizationIsolation | **PASS** | 只能依据真实实验：族 1–9 共 113+ HTTP 探针 + 只读 psql 终态核验全部 LIVE_VERIFIED（AUTHORIZATION-MATRIX.md §1；adversarial/authz-tenant.md M1–M20、authz-proctor-admin.md 族 3/4/8/9），防御不变量全部 CONFIRMED（review/security.md F1/F2/F3 + 独立重放 R1/R2/R5 一致），零越权/零跨主体注入/零枚举通道——实验已执行且通过，非 NOT_TESTED。 |
| requestIdTrust | **PASS** | server.ts:111-113（genReqId UUIDv4 + requestIdHeader:false，SOURCE_VERIFIED）+ E1a–f 伪造头（含声明他人真实 requestId）全部不采纳、日志 grep=0（correlation/header-influence.md LIVE）+ 裁决官重放 R4 一致 + F7 CONFIRMED + traceparent 无生产消费者（`grep -rni "traceparent|opentelemetry|x-request-id|request-id" apps/api/src --include="*.ts"` 排除测试仅命中 server.ts:112 注释一行，source/server-correlation.md §1；correlation/header-influence.md 以 `grep -rn "traceparent\|opentelemetry\|otel"` 复核同结论）。 |
| logPrivacy | **PARTIAL** | 有效面：pino redact remove:true 17 路径 + err 白名单 serializer（SOURCE_VERIFIED），client metadata/requestId 不进 stdout 日志（61 个生产 log 调用点全量枚举，source/field-provenance.md §10.3），audit_logs/server.log 金丝雀 0 命中（LIVE）。缺口面：①**pino 默认请求行携带原始 req.url 含 query**（LIVE_VERIFIED 探针：`/api/audit-logs?token=SECRET123` 原文进 stdout；redact 路径不覆盖 `req.url`；error 级 16 处 `route: request.url` 原文——source/field-provenance.md §10.1/§10.2）；②**nginx 默认 combined 访问日志记录完整请求行含 query**（deploy/nginx/web.conf 全文无 access_log 覆写，配置级 SOURCE_VERIFIED）——reset-password/invite 页的 token query 全页 GET 不进 Fastify/pino，但**在 nginx 日志机制覆盖范围内**，最坏情况下已写入 access log，运行时是否落盘属部署环境行为（INFRA_ACCESS_NOT_VERIFIED）；③日志文件读取权限 INFRA_ACCESS_NOT_VERIFIED。不判 FAIL 的完整理由：pino 通道机制存在但无已知敏感流实例（当前业务流不触达 Fastify query-token 形态）；nginx 通道机制覆盖但运行时落盘未核验、且无 LIVE 观察到的落盘证据——两个缺口均已登记为待处置风险并附部署侧缓解建议（§4 风险 3），故 PARTIAL 而非 FAIL。 |
| routeSanitization | **FAIL** | 「route 只存 pathname 即可满足 at-rest 凭据最小化」主张被打破（F4 REFUTED, medium）：RT-3/RT-8/RT-12B/RT-12C/RT-14B 以原样/单次解码可还原形态落库并经已授权 proctor-events 再暴露（双通道 LIVE + 裁决官重放 R2/R3 今日再证实 12 canary）——详见 ADVERSARIAL-TEST-RESULTS.md §2。 |
| correlationEffectiveness | **PARTIAL** | 七情形中 1/2/3/4/5/7 live 可解 + receipt 终态权威 + 跨重启唯一性（重启前日志已累计 489 个 distinct reqId、重启后新发 6 个请求产生 6 个新 reqId，交集=0，pb-08-restart-raw.log）；但 200 成功/业务拒绝无客户端可引用服务端 ID（F8 CONFIRMED）、接受类传输归因靠 ±150ms 时间窗推断（窗内 5 候选）、并发重复创建者不可归因（T08）——对应 investigation-playbook.md §4「必须新增能力」清单的**第 1 项（200 响应的客户端可引用 ID）与第 3 项（接受类无损归因/ACK 丢失完成时刻）**，即情形 1/3/6 的缺口（第 2 项并发归因为已接受的 AMBIGUOUS 边界）。 |
| performanceVerdict | **PASS** | 4 变体 × 4 场景 × 3 并发 = 48 配置格、每格 3 次重复共 **144 条测量行**（raw/bench.csv；48 格聚合见 raw/summary.csv）交错实测，吞吐/p95/p99/CPU/pg-xact 差值均在 ±3% 噪声带内且方向不一致；确定性代价封顶——B/D **每响应头行恰 +53B**（`x-request-id: `15 + UUID 36 + CRLF 2 的算术值），跨 12 配置**每请求均值中位 +52.0B**（respB 统计口径，51.1–55.6B 测量波动；两口径之差非矛盾，成因见 PERFORMANCE-RESULTS.md §3/§4）；C 零字节差；性能裁决官独立重算逐格全等；INCONCLUSIVE 项（pg 元组、sink 对比）已如实标注不影响结论（performance/RESULTS.md + review/performance.md）。 |

## 2. 归票结论

- **issue864 = GO（3:0）**：#864 的 DEFER gate「(1) 真实链路 canary 负例」已由本审计产出并经裁决官双通道重放证实；实现锁定 **864-B**（服务端封闭模板投影：动态标识符参数化、未知路径置空；客户端字节零保留+页面级信号保留）。按 Issue 同步协议先 reality audit 更新 scope/acceptance（含模板表单一权威+漂移守卫、禁 Sanitizer Framework、禁 `request.routeOptions.url`、参数化不可降级为 root-allowlist），再施工。
- **issue865 = REOPEN_RECOMMENDED（3:0）**：不是推翻 Owner 决定，而是其关闭文本自设重开条件（「实测运维工作流需要精确的 200-请求日志查找且能证明缺失 join」）被关闭**之后**产生的**两份 post-close 实测证据**满足：① playbook 情形 1/3/6 的缺失 join 实测（2026-11-07T17:12Z > 关闭 13:33:47Z）；② performance 变体 B 的代价实测（22:24Z）——关闭时二者均不存在。外部实践研究（五厂商以服务端生成 ID 头随全部响应公开的一致惯例，EXTERNAL-PRACTICES.md §2）为**佐证性背景，不属触发条件本身、亦非实测**。重开范围锁定 **865-C**（全站 X-Request-Id 响应头，复用 request.id；含接受类 info 日志行替代项的对比裁决）；865-D 维持 NO_GO。**重开是 Owner 动作，本轮不自动执行**。
- **performanceVerdict = PASS（3:0）**：已测候选（865-C 等价变体 B、864-B 门变体 C、叠加 D）无可测回归；范围限定：dev 模式绝对值、未测候选不在此裁决内。

## 3. 推荐架构

**864-B（封闭模板投影）+ 865-C（全站 X-Request-Id 响应头复用 request.id）+ 调查工作流维持现状（stdout/Pino + jq/时间窗）**。两者相互独立可并行推进；唯一排序约束：任何未来调查端点/管理 UI 必须后置于 864-B 落地（否则新特权读面再暴露原始 path）。详见 ARCHITECTURE-OPTIONS.md §6 与过度工程停止清单 §5。

## 4. 未解决安全风险 / 未查明项 / 回写策略

**未解决安全风险**（本轮零产品改动，全部待授权施工）：
1. client_events.route 三条泄露通路（RT-3 path 段 secret / RT-8 编码走私 query / RT-12B·12C opaque-scheme 凭据与 data: 载荷，另 RT-14B 原始 CRLF）——已证实，待 864-B 修复。
2. user_agent 头原样 at-rest（RT-18B，仅 500 截断无形状检测；当前无读取端点返回该列）。
3. **日志通道 URL-query 泄露面（两层）**：pino 默认请求行携带原始 req.url 含 query（探针 LIVE 证实；当前已知业务敏感流 reset-password/invite token query 仅达 nginx 静态分支、不进 Fastify/pino，故 pino 侧无已知实例；若未来出现 `/api/**?token=…` 形态即成实际泄露）；**nginx 默认 combined access log 机制上覆盖该 token query**（web.conf 无 access_log 覆写，配置级 SOURCE_VERIFIED）——最坏情况下 reset-password/invite token 已写入 nginx access log，运行时是否落盘与日志文件读取权均属部署环境（INFRA_ACCESS_NOT_VERIFIED）。**建议部署侧先行缓解**：在 deploy/nginx/web.conf 覆写 log_format 对 $query_string 脱敏，或对 /reset-password、/invite 路径关闭 access_log——属部署配置与 docs/deployment 契约改动（需施工授权），建议登记为 #800 follow-up 候选（本轮不自动创建）。
4. dev/e2e 混跑 stale dist 致 proctor-events 500（可用性、fail-closed；dist 重建后自愈，但 fallback 分支不纠正 occurredAt 类型且无 dist<src mtime 守卫——U6）。
5. 未测攻击面 U1–U6——**U1** CSV 导出公式注入、**U2** 生产模式限流行为（全部探针在 e2e 限流关闭下运行）、**U3** 监考分配撤销 TOCTOU、**U4** operationId 并发碰撞确定性、**U5** route 字段 Web UI 渲染面、**U6** stale-dist 构建卫生（见风险 4）；完整定义与合成验证方向见 review/security.md §3。

**存量数据处置（864-B 落地时）**：已按 RT-3/8/12B 形态落库的 client_events 行（保留期 30 天，apps/api/src/plugins/clientEventRetention.ts:33）遵循 #875 关闭决策的既有先例——**历史行不可变、靠 30 天 retention 自然淘汰，不做迁移/清洗、不新增产品级清洗路径**（source/adrs-issues.md §2.13）；若 Owner 判定存量风险不可接受，可用一次性运维脚本清除带敏感形态的 route 行（无产品工具，需单独授权并满足 testing.md §2 DB 安全前置）。

**独立严重权限漏洞**：未发现。授权不变量全部 CONFIRMED（无越权、无跨主体注入、无枚举 oracle、三路径一致）；上述第 4 项为可用性缺陷而非权限漏洞，不构成需绕过 #864/#865 流程的独立安全修复。

**未查明项**：日志文件读取权限（INFRA_ACCESS_NOT_VERIFIED，域 C）；生产构建模式绝对性能（基准为 dev 拓扑，相对有效）；B/C/D 变体源码 diff 未随 worktree 清理留档（复现需按 RESULTS.md 重构）；「敌意真根+秘密尾段」在 root-allowlist 门变体下存活为推导性质（未入 canary 集，已由 LEAK_COUNT=2 侧面证实）；ATTEMPT_CLOSED（voided）与 DB 事务失败注入两项 NOT_TESTED（live，无可安全注入点，SOURCE_VERIFIED 合同在案）；httperr 场景 per-process 共模偏差根因未定（已排除代码归属）。

**证据归档**：全部原始证据位于 gitignored `.tmp/secure-correlation-audit/`，**本轮无归档时限承诺**——工作区清理后原始文件（bench.csv 144 行、canary dump、replay 输出等）将不可复核。建议发起方在决定回写时至少将以下自包含最小集摘入 Issue 正文：①本文件 §5 严格输出块；②writeback/issue-864.md 的攻击矩阵表（含 31/12 口径解释）；③writeback/issue-865.md 的重开条件证据段；需长期保留 144 测点等原始数据时由发起方复制为 Issue 附件。

**回写策略**：三份草稿已备于 `writeback/issue-864.md`、`writeback/issue-865.md`、`writeback/issue-800.md`——**待运行发起方决定，本轮不自动回写**；证据位于仓库工作区 `.tmp/secure-correlation-audit/`（gitignored），由人工决定是否摘录关键部分入 Issue（建议最小集见上）。

## 5. 严格输出块

```text
BEGIN_EXAM_SECURE_CORRELATION_AUDIT
MASTER_SHA = 423f2945d9feef73a5413e498fb2772cc245c754
AUTHORIZATION_ISOLATION = PASS
REQUEST_ID_TRUST = PASS
LOG_PRIVACY = PARTIAL
ROUTE_SANITIZATION = FAIL
CORRELATION_EFFECTIVENESS = PARTIAL
PERFORMANCE_VERDICT = PASS
ISSUE_864_VERDICT = GO
ISSUE_865_VERDICT = REOPEN_RECOMMENDED
RECOMMENDED_ARCHITECTURE = 864-B 封闭模板投影 + 865-C 全站 X-Request-Id 响应头（复用 request.id）+ 调查工作流维持现状；调查端点/UI 一律后置于 864-B
UNRESOLVED_SECURITY_RISKS = client_events.route 三通路泄露（RT-3/8/12B/12C/14B 已证实待 864-B；存量行按 #875 先例 30 天 retention 自然淘汰，无产品级清洗）；user_agent at-rest 原样留存（RT-18B）；日志通道 URL-query 泄露面（pino 请求行机制 LIVE 证实但无已知敏感流实例；reset-password/invite token query 在 nginx combined 日志机制覆盖内、运行时落盘 IV，建议部署侧 access_log 脱敏缓解并登记 #800 follow-up 候选）；stale-dist 混跑致 proctor-events 500（可用性 fail-closed，fallback 不纠正类型且无 mtime 守卫）；U1-U6 未测攻击面（U1 CSV 公式注入/U2 生产限流/U3 分配撤销 TOCTOU/U4 operationId 并发/U5 route UI 渲染/U6 stale-dist 卫生）；未发现独立严重权限漏洞
REMAINING_UNKNOWN = 日志文件读取权限 INFRA_ACCESS_NOT_VERIFIED；生产构建绝对性能（基准为 dev 拓扑）；B/C/D 源码 diff 未留档；敌意真根+秘密尾段未入 canary 集（推导性质）；ATTEMPT_CLOSED 与 DB 事务失败注入 NOT_TESTED（live）；httperr 共模偏差根因未定；.tmp 证据无归档时限承诺（建议摘录最小集，见 §4 证据归档）
PRODUCT_CHANGES = NONE
GITHUB_WRITEBACK = 待运行发起方决定，本轮不自动回写
END_EXAM_SECURE_CORRELATION_AUDIT
```

## 6. 交付物清单（本轮十份 + 回写草稿）

| # | 文件 | # | 文件 |
|---|---|---|---|
| 1 | BASELINE-AND-SOURCE-MAP.md | 6 | REQUEST-CORRELATION-MATRIX.md |
| 2 | EXTERNAL-PRACTICES.md | 7 | PERFORMANCE-RESULTS.md |
| 3 | TRUST-BOUNDARY-DAG.mmd（校对未改语义；注意：H/CEV 节点「仅 pathname」是 as-built 摄入行为陈述而非安全评价，已证实泄露反例见 5/10 号文件与 INDEPENDENT-REVIEW.md §6 呈现局限说明） | 8 | ARCHITECTURE-OPTIONS.md |
| 4 | AUTHORIZATION-MATRIX.md | 9 | INDEPENDENT-REVIEW.md |
| 5 | ADVERSARIAL-TEST-RESULTS.md | 10 | FINAL-VERDICT.md（本文件） |

回写草稿：writeback/issue-864.md、writeback/issue-865.md、writeback/issue-800.md。
