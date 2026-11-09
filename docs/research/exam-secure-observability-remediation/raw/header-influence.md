# 实验一：客户端伪造关联头对服务端请求身份的影响（header-influence）

- 日期：2026-11-08 01:05:51–01:08 (UTC+8)；环境：共享审计环境 `http://localhost:3000`（APP_MODE=e2e，DB `exam_ci_audit`，server pid 773614；worker 01:05:28 被 tsx watcher 因 `packages/db/dist/types.js` 外部变更重启为 783608 —— 非本审计所为，见 raw log 尾注）。
- 原始命令与输出：`01-02-header-consistency-raw.log`（逐请求 curl 命令体、响应体、HTTP 状态、事后 grep 分析）。
- 源码依据：`apps/api/src/server.ts:111-113`（`genReqId: () => randomUUID()` + `requestIdHeader: false`）；`apps/api/src/plugins/errors.ts:97,103,109,115,120,132,137`（所有错误路径均用 `request.id`）；`apps/api/src/lib/errorResponse.ts:74-87`（信封 `error.requestId`）。
- API 源码中无任何 OpenTelemetry/traceparent 消费者（`grep -rn "traceparent\|opentelemetry\|otel" apps/api/src --include="*.ts"` 仅测试命中，无生产代码）。

## 伪造头样本（金丝雀）

| 头 | 值 |
|---|---|
| `request-id` | `EXAMAUDIT-CANARY-HDR-requestid-1111` |
| `x-request-id` | `EXAMAUDIT-CANARY-HDR-xrequestid-2222` |
| `traceparent` | `EXAMAUDIT-CANARY-HDR-traceparent-3333` / `-4444` |
| （E1c）`request-id`+`x-request-id` | `e7a114e3-259c-49d4-a455-d9e4ccb94bae` —— **另一真实请求的服务端 requestId**（T06b 的信封值），模拟“客户端声明他人的 requestId” |

## 结果（LIVE_VERIFIED）

| # | 请求（全部携带上述伪造头） | HTTP | 信封 requestId（服务端新铸） | Pino 行 |
|---|---|---|---|---|
| E1a | GET `/api/EXAMAUDIT-CANARY-NOSUCHROUTE`（未匹配路由） | 404 | `e49d3bc3-b4f6-4349-9b49-fbfc92f217de` | req+res 各 1 行，同 reqId |
| E1b | POST save 无认证 | 401 | `cf9a57c4-bc4d-444c-aa63-a6cb67c7f142` | 同上 |
| E1c | POST save 无认证 + **声明他人真实 requestId** | 401 | `04f96794-d26a-437b-8662-d5364717af2d` | 同上；原主 `e7a114e3…` 仍只有其自己的 2 行（共 2 行，未被复用） |
| E1d | POST save 带 schema 非法 body（clientSeq 字符串） | 400 | `d3fadd7e-c914-48bd-bd84-6d34ffc9b971` | 同上 |
| E1e | POST save 合法（cs=9） | 200 accepted v5 | 200 信封无 requestId（成功契约无此字段）；Pino reqId 为新铸值 | req+res 同 reqId |
| E1f | POST save 同 cs=9 异内容（业务拒绝） | 200 CONFLICTING_PAYLOAD | 200 信封无 requestId；WARN `Answer save rejected` 行 reqId=`cde05ea4-b2fd-40e3-9115-2dff29e0c77b`（新铸） | WARN 行与 req/res 同 reqId |

## 结论

1. **服务端不采纳客户端值**：全部伪造头（含声明他人真实 requestId）下，信封/WARN/Pino 的 requestId 均为服务端新铸 UUIDv4，与金丝雀值及被声明值无一相等（`serverId ≠ EXAMAUDIT-CANARY-HDR-* ≠ e7a114e3…`）。
2. **server-owned 身份未被覆盖或污染**：全量 `grep -c "EXAMAUDIT-CANARY-HDR" server.log` = **0**（会话结束时复测仍 0）；被声明的真实 requestId `e7a114e3…` 在 server.log 中始终只有其原始请求自己的 req+res 2 行，没有第三行（即 E1c 没有挂到他人身份下）。
3. 机制（SOURCE_VERIFIED）：`requestIdHeader: false` 使 Fastify 忽略一切入站请求 ID 头；`genReqId` 每请求铸 UUIDv4（#860 决策，无跨重启计数器复用风险）。traceparent 无任何消费者（无 OTel 插件注册）。
4. 附加观察：业务拒绝 200 与成功 200 的响应体都**不含 requestId**（`SaveAnswerResponseSchema` 契约无该字段，contracts/src/attempt.ts:218-246）；错误信封（4xx/5xx）必含。错误路径客户端可引用信封 requestId 做支持关联，200 路径只能靠服务端日志。
