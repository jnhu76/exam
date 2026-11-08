# Issue #865 回写草稿 — 200 响应请求关联契约（建议重开，**不自动重开**）

> 状态：草稿，**不自动回写、不自动重开 Issue**。重开是 Owner 动作；由发起方/Owner 决定。
> 证据基线：master @ `423f2945d9feef73a5413e498fb2772cc245c754`（2026-11-08 审计）。本 Issue 当前 CLOSED（2026-11-07 13:33:47Z，`NO_GO_NEW_200_REQUEST_ID_CONTRACT` / `CLOSE_AS_NOT_PLANNED`）。

## 结论

三裁决官一致（3:0）建议 **REOPEN_RECOMMENDED**——不是推翻本 Issue 关闭裁决，而是**执行其自设的重开条款**。关闭评论[1]原文明示：「若未来实测运维工作流需要精确的 200-请求日志查找且能证明缺失 join，重开此窄选项（X-Request-Id 响应头）而非改领域响应」。该条件在关闭**之后**被**两份 post-close 实测证据**满足（关闭时二者均不存在）：

1. **缺失 join 的实测**（2026-11-07T17:12Z > 关闭 13:33:47Z）：investigation playbook 七情形 live 演练证明——200 成功响应客户端零可引用服务端 ID（成功头/体均无，pb-02 头清单实测）；接受类保存传输归因仅能靠 ±150ms 时间窗包含判据（窗内实测出现 5 候选需状态码过滤排除假阳性）；并发重复保存创建者不可归因（T08 两请求同窗、receipt 无 request 标记列）。
2. **代价实测**（22:24Z 后）：性能变体 B（onSend 全局 `x-request-id` 复用 `request.id`，+8 行）实测（4 变体×4 场景×3 并发=48 格、每格 3 次重复共 144 条测量行，performance/raw/bench.csv）——**每响应头行恰 +53B**（`x-request-id: `15 + UUID 36 + CRLF 2 的算术值；跨 12 配置每请求均值中位 +52.0B，系另一统计口径、含 51.1–55.6B 测量波动，两口径之差非矛盾），吞吐/p95/p99/CPU/pg-xact 全在 ±3% 噪声带内，日志字节 Δ≤0.1%、DB 零增量。

**佐证性背景（非触发条件、非实测）**：外部实践研究显示五家厂商一致以「服务端生成、随全部响应（含 200）返回的关联 ID 头」为公开协议——其中 **Stripe 经实测**（curl api.stripe.com，2026-11-07，401/404 响应头）与 **GitHub 经官方文档示例**将关联 ID 头列入 CORS `Access-Control-Expose-Headers` 主动暴露给浏览器 JS；GitLab（文档）、AWS extendedRequestId（文档「每个响应头返回」）、Cloudflare CF-Ray（文档「每个响应与发往源站值相同」）为全响应返回。来源：external/stripe-github.md §1.1/§2.1、external/aws-cloudflare.md §1.2/§2.1（汇总见 EXTERNAL-PRACTICES.md §1/§2）。共同启示：秘密性在 ID 的生成权不在 ID 值。

## HTTP 200 关联的必要性（为何缺口真实）

- 错误路径客户端可引用信封 `error.requestId`（唯一现实通道）；成功与业务拒绝 200 则**无任何载体**（`SaveAnswerResponseSchema`/`ClientEventBatchResponseSchema` 等契约无字段；`requestIdHeader:false` 不发出站头；`apps/web/src/lib/api.ts:269-273` 对 2xx 直接 `response.json()` 不读任何响应头，SOURCE_VERIFIED 见 source/client-contracts.md §5）——200 报障只能报 attemptId+questionId+clientSeq+时间窗。
- 业务真相本身不缺（receipt append-only 永远先回答「存没存/版本/内容身份」）；缺的是**传输层归因**：哪个 requestId 执行了这次写。三态语义（NO_MATCH/ONE_CANDIDATE/AMBIGUOUS）覆盖了残余歧义，但 200-ID 能把最常见的「考生说保存了但没看到成功」工单从时间窗推断降为直查。

## A–D 方案对比（三官归票）

| 方案 | 归票 | 理由 |
|---|---|---|
| A 维持现状 | NO_GO（2:1） | 缺口被 post-close 实测证实；永久维持=无视 Owner 自设触发器 |
| B 仅 SaveAnswer 加头 | DEFER（平票保守） | 覆盖最高价值场景但制造端点不一致；Owner 坚持最小足迹时可接受，不作首选 |
| **C 全站统一服务端生成 X-Request-Id 响应头（复用 request.id）** | **GO（3:0）** | 见下 |
| D SaveAnswer .strict() 体加 requestId | NO_GO（3:0） | 与 verbatim 重放语义结构性冲突（T02/R1 实测同键重放逐字复用原 ACK、savedAt 为原始时刻——体含 requestId 则重放要么携带原请求 ID 误导关联、要么破坏逐字复用）；**永不翻案项** |

**865-C 的硬约束全部满足并实测**：复用既有 `request.id`（genReqId UUIDv4，微基准中位 103.3 ns/op——crypto.randomUUID() 200k×5 次，performance/RESULTS.md §环境、原始数据 performance/raw/uuid-bench.txt；属 A/B/C/D 四变体共同存量成本，非 C 的新增）；无新 ID 生成、无 Correlation Service；**不因响应头为成功请求新增持久化 client_event**（实测 pg xact 零增量）；`requestIdHeader:false` 继续拒入站头（伪造/冒充头零影响，E1a–f + 裁决官重放 R4）；跨主体冒充 requestId 可被「组织先行 + url→DB 归属核验」识破且与授权零耦合（playbook 情形 4 实测）；不触碰 SaveAnswer 响应体，幂等 ACK 语义零影响。

**权限与性能证据**：响应头对所有请求者可见——与错误信封 `error.requestId` 同等暴露级别（信封早已对发起者可见），无新增权限面；性能证据见上（每响应 +53B 头行封顶、均值口径 +52.0B、无回归）。落地要求：契约以 ADR-025 为权威更新（响应头与既有**三载体**——错误信封 `error.requestId`、Pino `reqId`、audit `metadata.requestId`（ADR-025 D3 身份对应不变量）——同值，成为身份对应的**第四载体**，无需 superseding ADR）；测试钉死全状态码携带 + 入站仍忽略 + 遥测回显仍标 client_claimed；onSend 内禁新增日志调用（保住 +53B 头行封顶的代价模型）。**Owner 替代项**：接受类保存记一条带业务键的 info 日志行（非 wire、多关 ACK-丢失归因、代价 answers 路径日志 ≈×2）——重开裁决中与 C 二择一，审计倾向 C。

**消费端配套（重开 scope 必须明确，本轮裁决未覆盖）**：本轮裁决对象是服务端 wire 契约；「把工单从时间窗推断降为直查」的最后一公里需要客户端与流程配套——(a) web 侧消费：`apps/web/src/lib/api.ts` 目前对 2xx 不读响应头（api.ts:269-273），可镜像既有错误路径先例（`responseToApiError` 读信封存 `ApiError.requestId`，api.ts:226-244；TakeExamPage 错误横幅展示 + i18n「错误编号：{{requestId}}」文案，apps/web/src/pages/exam/TakeExamPage.tsx:1576-1586、apps/web/src/i18n/locales/zh-CN.ts:657-659）改为在成功路径 `response.headers.get('x-request-id')` 采集；(b) 工单/支持流程：考生与支持人员的报障单增加「响应编号」字段。两项均属重开 Issue 的 scope 决策（本审计未裁决、未测），不随服务端头自动成立。

## 关键证据摘录

- pb-02 活体流量完整响应头清单证明 200 无任何 request-id 头；`contracts/src/attempt.ts:218-246` 两分支 `.strict()` 无 requestId 字段。
- `performance/RESULTS.md` 快照（12 配置中位）：A 185.2 rps / B 187.6 (+1.3%) / respB 增量 +52.0B（**每请求均值口径**；每响应头行确定值 53B，口径差异见上文第 2 条）/ Pino B/req 491.0（四变体同值）。
- `correlation/header-influence.md` E1c：客户端声明他人真实 requestId → 服务端新铸 UUID、原主日志行未被复用（grep=0）。

## 复现命令

```bash
# 200 无 ID + 信封有 ID 对照
bash .tmp/secure-correlation-audit/correlation/exp1-2.sh     # → 01-02-header-consistency-raw.log
# 调查缺口（情形1/3/6）
bash .tmp/secure-correlation-audit/correlation/pb-s1-scenario1.sh   # 其余 pb-s2..s7 同目录
# 响应头代价（4 变体基准）
bash .tmp/secure-correlation-audit/performance/scripts/run-bench.sh
```

## 证据持久位置说明

全部证据在仓库工作区 `.tmp/secure-correlation-audit/`（gitignored，**无归档时限承诺——工作区清理后将不可复核**）：`correlation/`（header 影响/三处同值/SaveAnswer 矩阵/playbook 七情形 + raw log）、`performance/`（RESULTS.md + raw/bench.csv 144 条测量行 + logs/）、`external/`（五厂商 + Fastify/Pino + OWASP/W3C/OTel 研究，本草稿引用的来源链接均已内联于「佐证性背景」段）、`review/`（三裁决官意见与独立重放）。**是否摘录关键部分入本 Issue 由人工决定**；建议最小摘录集 = 本草稿「结论」段的两条 post-close 实测证据 + 「A–D 方案对比」表 + 「消费端配套」段（自包含可复核）；需长期保留 bench.csv 原始数据时由发起方复制为 Issue 附件。

## 明确声明

本轮审计为只读：未修改任何 git 跟踪文件、未重开本 Issue、未创建 PR。重开与否及范围（锁定 865-C 窄选项）由 Owner 决定；865-D 的 NO_GO 与「业务收据身份、requestId、clientSeq、operationId 保持分离」的保留断言不受重开影响。
