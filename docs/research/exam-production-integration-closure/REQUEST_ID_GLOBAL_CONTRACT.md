# REQUEST_ID_GLOBAL_CONTRACT

- 状态：只读审计与契约文档，不是产品代码变更；未 commit / push / merge。
- 审计基线：`master @ 5140c3dd0f9dbde1bdad8f5b757161f3ed96945d`（本 worktree
  `integration/production-closure-20261109` 的 HEAD）。
- 在途实现：`#923 @ d3580f3e46e2292317dfe831efd982d475d163e8`、
  `#924 @ e81b76a17212c8e321a83f1b0522e54a049326f1`。
- 本地集成参照：`final-closure-integration @ 1f644725d574dd669081b3008a73122c1a55641c`
  （**local-only，未 push**；包含四个 PR 与本地集成修复 `3e97c497`）。
- 依据：`.tmp/production-closure/SPEC.md` §2、`docs/adr/ADR-025-http-request-correlation-identity.md`、
  `docs/contracts/observability.md`、`docs/contracts/api-contract.md`、
  `docs/architecture/exam-system/security-model.md`、`docs/operations/save-failure-evidence.md`，
  以及本文件 §8 列出的代码与测试。
- 证据纪律：本文件只记录本次实际读取/检索到的事实。未运行 `pnpm test` / `pnpm verify` / `pnpm e2e`；
  任何“测试已通过”的表述都只引用已有测试文件的存在与断言内容，不代表本次执行过。

## 0. 结论摘要

| Gate | 结论 | 说明 |
| --- | --- | --- |
| `SERVER_ID_AUTHORITY` | **PASS** | 生产只有 `apps/api/src/server.ts` 的 `genReqId: () => randomUUID()` 铸造 HTTP request id；`requestIdHeader: false`；error envelope、Pino、HTTP audit 都读取同一个 `request.id`。 |
| `CLIENT_CLAIM_ISOLATION` | **PASS（目标语义）** | `client_events.metadata.requestId` 是客户端声明；proctor timeline 只做 allowlist + UUID 形状投影；不是查询键、不是授权输入、不能伪造保存成功。`master` 尚无 #923 的形状 gate，故该结论以 #923/integration-final 为目标态。 |
| `UUID_FIXTURE_CONTRACT` | **FAIL** | `master`/`#923` 上 E2E `req-forged-prt-0001` 仍在；`#924` 另有 `req-cross-org-<uuid>`。两处都只在本地 `integration-final` 的 `3e97c497` 修复，未进入任何 PR 分支或 `origin`；另有大量 P1 级客户端测试夹具以 `req-*` 冒充服务端 UUID（详见 `UUID_FIXTURE_RECONCILIATION.md`）。 |
| `CORRELATION_GLOBAL_CONSISTENCY` | **FAIL** | OpenAPI 的 401/403 注入 schema 把 `requestId` 放在顶层而不是 `error.requestId`（`apps/api/src/openapi/swagger.ts:229,258`）；`docs/contracts/api-contract.md:81`、`docs/contracts/observability.md:43,238`（M）/ `:43,289`（I）等仍使用过期/不完整的实现状态措辞；#923 的 UUID 形状 gate 未写入 observability 契约。 |

**总体 verdict：FAIL**。失败不是“服务端权威模型不成立”，而是“全局契约尚未在测试夹具、OpenAPI 与长期文档中一致落地”。
服务端权威链本身是单一、正确且可审计的；需要收敛的是夹具与文档，而不是扩大权限、改写历史数据或新增 requestId 查询能力。

## 1. 概念与权威矩阵

| 概念 | 权威性 | 载体 | 形状要求 | 谁可以写入 | 读取方信任级别 |
| --- | --- | --- | --- | --- | --- |
| 服务端 UUIDv4（HTTP 请求身份） | **唯一权威** | `request.id`（Fastify `genReqId`） | UUIDv4（RFC 4122 version/variant） | 仅生产入口 `apps/api/src/server.ts` | 服务端内部权威 |
| 响应头 `x-request-id` | 服务端值的**第四载体**（#924） | HTTP response header | 原样透传 `request.id`，不重新铸造 | 根作用域 hook | 客户端可观察，但不是凭据 |
| Error Envelope `error.requestId` | 错误响应的**类型化载体** | `{ error: { code, message, requestId, details? } }` | 原样透传 `request.id`；wire schema 只要求非空字符串 | error handler / 标准 envelope 调用点 | 错误路径权威；客户端按不透明字符串处理 |
| Pino `reqId` | 服务端日志**实际关联值** | pino JSON | 原样透传 `request.id` | Fastify/pino integration | 服务端权威 |
| Audit `metadata.requestId` | HTTP 请求身份在审计行的**关联字段** | `audit_logs.metadata.requestId` | 原样透传 + 128 字符截断；不校验 | 仅 HTTP audit writer | 服务端权威（系统行不伪造） |
| `client_events.metadata.requestId` | **未核验的客户端声明** | client_events JSON metadata | 任意 JSON 字符串可入库；读取投影只保留 UUID 形状 | 客户端（authenticated，但内容不可信） | 低信任关联候选 |
| `clientSeq` / `operationId` | **独立业务身份** | SaveAnswer 请求字段 / 命令 receipt 键 | `clientSeq` 是整数；`operationId` 是 UUID | 客户端（按协议） | 业务协议身份，与 requestId 无关 |
| SaveAnswer receipt | **业务事实** | `exam_answer_save_receipts` 行 | 键 `(organizationId, attemptId, questionId, clientSeq)` | 服务端 save 事务 | 最高业务证据（仅证明协议接受） |

### 1.1 一句话规则

**requestId 只回答“哪一个 HTTP 请求”，不回答“谁、能访问什么、保存是否成功、业务操作是否幂等”。**

## 2. 服务端权威链

### 2.1 唯一铸造入口

- `apps/api/src/server.ts:111`（M）与 `apps/api/src/server.ts:117`（I）：
  `genReqId: () => randomUUID()`。
- `apps/api/src/server.ts:113`（M）与 `:119`（I）：`requestIdHeader: false`。
- `apps/api/src/server.ts` 是唯一生产 HTTP Fastify 入口；`apps/api/src/openapi/swagger.ts:105`
  的 Fastify 实例只用于生成文档，不服务请求，没有 `genReqId`。
- 因此不存在第二个生产 requestId 铸造点，也不需要为“统一”新增一个 requestId 服务、公共模块或 ID registry。

### 2.2 同一请求的身份对应不变量

在同一个 HTTP 请求内，**凡是存在的载体必须是同一个 `request.id`**：

```text
x-request-id response header (when sent)
  == pino reqId (all log lines of that request)
  == error.requestId (when a standardized error envelope exists)
  == audit.metadata.requestId (when an HTTP audit row exists)
```

依据与实现：

- header：`apps/api/src/plugins/requestIdHeader.ts:24-35`（I）的根作用域 `onRequest`
  `reply.header("x-request-id", request.id)`；注册点 `apps/api/src/server.ts:140`（I）。
- envelope：`apps/api/src/plugins/errors.ts:97,103,109,115,120,132,137` 全部使用
  `request.id`；`apps/api/src/lib/errorResponse.ts:79-85` 写入 `error.requestId`。
- Pino：Fastify 对每个请求自动以 `request.id` 作为 `reqId`；`apps/api/src/server.ts:114-118`（M）
  / `:120-127`（I）只配置 logger，不覆盖 reqId 生成。
- audit：`apps/api/src/audit/auditWriter.ts:81-84` 的 `requestEvent()` 注入
  `requestId: truncate(String(request.id), AUDIT_REQUEST_ID_MAX_LENGTH)`；系统行
  `systemEvent()`（`:111-143`）不注入 `requestId`，只允许 `metadata.operationId`。
  生产 UUIDv4 是 36 字符，不受 128 字符截断影响；截断只为非符合形状的历史/异常值提供存储上界。
  因此“同一请求四个载体相同”在生产 UUIDv4 上严格成立；如果未来 id 超过 128 字符，
  audit 列会截断，这是存储边界而不是新的身份语义。

### 2.3 不是所有请求都有四个载体

- 只有错误响应才有 error envelope；成功响应没有。
- 只有部分业务动作写 audit 行；不是每个请求都有 audit。
- 连接被中断、socket framing 失败、Node request/keepAlive timeout 等“响应从未发出”的路径没有 header；
  这是传输边界，不是关联断裂（服务端日志仍以同一 `request.id` 记录）。
- 在 router lookup 之前就失败、尚未构造 request 的协议级框架错误（例如 `FST_ERR_BAD_URL`）没有 header。

这些边界已由 `apps/api/src/plugins/requestIdHeader.ts:10-22`（I）、
`docs/contracts/observability.md:66-91`（I）、`docs/contracts/api-contract.md:89-93`（I）声明；
但 **OPTIONS 早返回路径是否实际携带 header 没有专门测试**，见 §10 UNKNOWN。

## 3. 各载体语义

### 3.1 服务端 `request.id`

- 每个 HTTP 请求一个新 UUIDv4；跨进程、跨重启不复用计数器。
- 不是租户、认证、答案、事件、事务或 operation 身份（ADR-025 Decision 4，
  `docs/adr/ADR-025-http-request-correlation-identity.md:47-51`）。
- 不接受客户端 header 影响；`requestIdHeader: false` 是生产配置的一部分
  （ADR-025 Decision 2，`:38-42`）。

### 3.2 响应头 `x-request-id`（#924 目标态；master 尚无）

- 只在 #924/integration-final 存在；`master @ 5140c3dd` 没有该 header。
- 根作用域 `onRequest` 设置，值就是 `request.id`，不产生第二个 id。
- 覆盖所有 Fastify-managed response：成功、200 业务拒绝、校验错误、404 未匹配路由、500 异常。
- CORS 只对配置的 web origin 暴露：`apps/api/src/plugins/cors.ts:20-32`（I）；
  不反射未配置 origin。
- 客户端读到 header 只获得关联能力；它不是凭据，不证明请求来源、授权或业务成功
  （ADR-025 Addendum，`docs/adr/ADR-025-http-request-correlation-identity.md:94-101`）。
- 代理/中间层可以删除或替换 header；客户端不能验证其端到端真实性，只能作为观察值。

### 3.3 Error Envelope `error.requestId`

- 标准 envelope 的唯一权威形态是：
  `packages/contracts/src/common.ts:65-84` 的 `ErrorResponseSchema`，`requestId` 位于
  `error` 对象内，类型为 `z.string().min(1)`（**不校验 UUID 形状**）。
- 服务端所有标准错误由 `buildErrorResponse(request.id, ...)` 生成
  （`apps/api/src/lib/errorResponse.ts:74-87`）。
- 历史/遗留的非 envelope 错误（例如 `course.ts` 的旧路径，
  `docs/contracts/api-contract.md:648`）可能没有 `requestId`；这是已知遗留缺口，
  不改变标准 envelope 的契约。
- 客户端必须把 envelope 的 `requestId` 当作不透明字符串；不得 parse 形状、不得据此授权。
  依据：`apps/web/src/lib/api.ts:219-278`（I）只读取并透传，不做 UUID 校验。

### 3.4 Pino `reqId`

- 服务端日志的实际关联值；pino 对每个请求的所有行使用同一个 `reqId`。
- 与 header/envelope/audit 同源；运行手册按精确相等过滤
  （`docs/deployment/mvp-deployment-runbook.md:1054-1055` 明确 UUIDv4 与历史 `req-<base36>`）。
- 日志中不记录原始 URL（#926 目标态）；这与 requestId 语义正交，不改变本契约。

### 3.5 Audit `metadata.requestId`

- 只在 HTTP writer 注入；系统 writer 绝不伪造 HTTP requestId
  （`apps/api/src/audit/auditWriter.ts:41-45,81-84,111-143`）。
- 写入前只做 `truncate(String(request.id), 128)`；不校验、不改写形状。
- 历史行可能：
  - 含 Fastify 默认 `req-<base36>`；
  - 含 pre-PR-A 写入的 system `operationId`（当时放在 `metadata.requestId`）；
  - 含其他任意历史字符串。
- CSV 导出按 **metadata key** 投影：`请求ID` = `metadata.requestId`，
  `操作ID` = `metadata.operationId`；**绝不按值形状重新分类**
  （`apps/api/src/routes/audit.ts:83-128`；测试 `apps/api/src/routes/audit.test.ts:895-975`）。
- 这是历史只读数据的兼容边界：不得迁移、不得重写、不得为了统一而“修正”旧值。

### 3.6 `client_events.metadata.requestId`

- 客户端声明，不是服务端事实。`ClientEventSchema.metadata` 是
  `z.record(z.string(), z.unknown())`（`packages/contracts/src/clientEvent.ts:117`），
  **不校验 requestId 形状**；这是有意的低信任遥测边界，不应在 ingestion 增加 UUID 校验
  （见 §4）。
- `sanitizeClientEvent` 只去除凭据/答案内容，不删除 `requestId` 键
  （`packages/contracts/src/sanitizeClientEvent.ts:24-44`）；route 在持久化前再次 sanitize
  （`apps/api/src/routes/clientEvents.ts:151`）。
- 读取面只有 proctor timeline：`projectSafeMetadata` 对
  `answer_autosave_failed` / `answer_manual_save_failed` 的 `requestId` 做
  UUID 形状 gate（`apps/api/src/lib/proctorMonitoringService.ts:156-164,200-236`，
  #923/integration-final）。
- 该 gate 是**内容注入限制**，不是身份核验：它只决定“是否把客户端字符串显示给调查者”，
  不证明该 id 属于任何服务器请求。
- 客户端声明不能：
  - 影响服务端 `request.id`（`requestIdHeader: false`）；
  - 扩大查询/授权范围（timeline 仍按 `attemptId` + org + scoped capability 查，
    `apps/api/src/routes/proctorMonitoring.ts:140-205`）；
  - 伪造保存成功（SaveAnswer 的 `accepted`/`reason`/receipt 是业务权威，见 §3.9）；
  - 被提升为服务端审计事实（audit 行与 client_events 行是不同模型）。

### 3.7 Proctor timeline 的投影与信任标签

- API 只返回 allowlist 后的 metadata（`apps/api/src/routes/proctorMonitoring.ts:140-205`）；
  原始 `client_events.metadata` 不直接返回。
- UI 在 admin 页面把 client_event 行标注为“客户端声明，未经服务端核验”
  （`apps/web/src/pages/admin/ExamMonitoringPage.tsx:441-445`、
  `apps/web/src/pages/admin/AttemptDetailPage.tsx:354-380`）；
  audit 行不标注。
- 即使客户端提交的是**合法 UUIDv4**，它也仍是未核验声明；匹配 UUID 形状不等于匹配服务器日志。
- 形状 gate 的副作用：历史 client_events 中以 `req-*` 等形式存在的 requestId 声明
  不会再显示在 timeline 的该字段上（行本身仍显示）。这是 #923 的 fail-closed 读取策略，
  不是数据迁移；见 §6。

### 3.8 Web API client 与 SaveAnswer UI

- `apps/web/src/lib/api.ts:306-361`（I）的 `requestWithMeta` 是唯一的响应元数据核心；
  `request<T>` 行为不变；`getWithMeta` / `postWithMeta` 是 opt-in
  （`apps/web/src/lib/api.ts:406-431`）。
- 成功路径：`meta.requestId = response.headers.get("x-request-id")`，缺失为 `null`
  （`apps/web/src/lib/api.ts:280-292,331-333`）；不校验形状。
- 错误路径：`responseToApiError` 以 envelope `error.requestId` 为准；
  header 只在本地用于比较，不提升到 `ApiError`；二者不一致时发一条有界 client warn
  `api.request_id_correlation_mismatch`（`apps/web/src/lib/api.ts:235-268`）。
- SaveAnswer UI：
  - 200 `accepted: false`：用 `postWithMeta` 的 `meta.requestId` 显示“请求编号”，
    并写入 `answer_autosave_failed` telemetry（`apps/web/src/pages/exam/TakeExamPage.tsx:893-1005`，I）。
  - HTTP 4xx/5xx/transport：用 envelope `requestId` 显示“错误编号”并写入 telemetry
    （`apps/web/src/pages/exam/TakeExamPage.tsx:1007-1045,1209-1215,1580-1592`，I）。
  - 两种 id 的生命周期被明确分开：`saveFaultRequestId` vs `saveRejectionRequestId`；
    不允许合并或互相覆盖（`apps/web/src/pages/exam/TakeExamPage.tsx:404-425`，I）。
  - header 缺失时不伪造 id；UI 省略该行。
  - header 存在不代表保存成功；业务 verdict 只看 `accepted`/`reason`；durable 事实看 receipt。

### 3.9 `clientSeq` / `operationId` / SaveAnswer receipt

- `clientSeq`：`SaveAnswerRequestSchema` 中的整数（`packages/contracts/src/attempt.ts:203-210`），
  每个 `(attemptId, questionId)` 的客户端重放键；不是时钟、不是内容身份、不是 requestId。
- `operationId`：命令 receipt 的客户端 UUID（如
  `packages/contracts/src/attempt.ts:603,619,694,828`；audit payload schema 也要求
  `z.string().uuid()`，`apps/api/src/audit/auditPolicy.ts:267,292-311`）。
  它按 organization 作用域做幂等（`packages/db/src/repository/attemptCommandReceiptRepo.ts:98-160`），
  与 HTTP requestId 是两个独立身份。
- SaveAnswer receipt：每个 ACCEPTED `(organization, attempt, question, clientSeq)` 一条不可变行，
  与 answer 状态在同一事务写入；键定义见
  `packages/db/src/repository/attemptRepo.ts:85-110`。
  receipt 证明“协议在该服务端时刻接受了该 replay key”，不证明内容正确、不证明客户端收到 ACK、
  也不证明后来没有失败。
- `SaveAnswerRejectedSchema` 是 `.strict()` 且**没有 `requestId` 字段**
  （`packages/contracts/src/attempt.ts:229-246`）；200 业务拒绝的 body 不携带 requestId，
  #924 的 header 是客户端可见的关联载体，不是业务结论。
- 重试同一 `clientSeq` 使用同一业务 replay key，但每个 HTTP attempt 有新的 requestId；
  requestId 不能用于去重保存，也不能替代 receipt 查询。

## 4. 边界校验矩阵

| 边界 | 输入信任 | 是否必须校验 UUID | 规则与理由 |
| --- | --- | --- | --- |
| `genReqId` 铸造 | 服务端自身 | 不运行时校验；按构造必须 UUIDv4 | 单一生产入口；测试（`server.requestId.test.ts:24-25,164-239`）断言 UUIDv4。 |
| `x-request-id` header 发射 | 服务端 `request.id` | **不校验** | 已经是权威值；重新校验会产生第二权威且可能拒绝合法值。 |
| Error Envelope 构造 | 服务端 `request.id` | **不校验** | envelope 是服务端输出；wire schema 只要求非空字符串以兼容历史/代理。 |
| Audit HTTP writer | 服务端 `request.id` | **不校验** | 只截断到 128；校验会让审计写入失败或丢弃合法历史值。 |
| Audit CSV export | 已存储 metadata | **不校验、不按形状重分类** | 按 key 投影；历史 operationId 在 请求ID 下保持原样。 |
| `POST /client-events` 输入 schema | 客户端不可信 | **禁止校验 UUID** | metadata 是低信任遥测；要求 UUID 会拒绝合法事件、迫使客户端伪造形状，并形成第二个形状权威。 |
| Proctor timeline `projectSafeMetadata` | 客户端不可信 | **必须做 UUID 形状 gate** | 唯一需要形状校验的生产读取边界：只允许 UUID 形状字符串进入调查者视图；非字符串/ prose/ 嵌入文本/ 超长值丢弃。 |
| Web `responseToApiError` | 服务端/代理响应 | **不校验** | envelope 为权威；客户端只透传/展示，不能验证来源。 |
| Web `ApiResponseMeta.requestId` | 服务端/代理 header | **不校验** | 缺失为 null；不解析、不当作凭据。 |
| SaveAnswer UI | header/envelope | **不校验** | 仅显示/复制关联编号；业务 verdict 由 `accepted`/`reason`/receipt 决定。 |
| E2E / unit fixtures | 测试 | **A/B 场景必须 UUIDv4；C 场景可非法** | 见 §7；不得用 `req-*` 冒充合法服务端值或“格式合法但来源不可信”的伪造值。 |
| 日志/运维查询 | 日志/审计 | **不做形状推断** | 按精确字符串匹配；`req-*` 与 UUIDv4 都当作不透明关联串。 |
| 历史只读数据 | 历史 | **不迁移、不重写** | ADR-025 Decision 6；audit CSV 按 key 投影。 |

### 4.1 为什么只有 proctor timeline 需要生产形状 gate

- 它是唯一把**客户端提供的 requestId 字符串**直接渲染给授权调查者的生产读取面。
- 不加 gate 时，恶意 authenticated client 可以把任意 prose、他人 UUID 嵌入文本或 32 KiB 字符串
  注入调查者视图（#923 的 Security F2 动机）。
- 该 gate 只限制**内容形状**；它不验证 id 是否真实存在、是否属于该用户、是否对应服务器日志。
- 其他边界要么是服务端输出（envelope/audit/header），要么是客户端不透明透传（web parser/UI），
  要么是低信任入库（client_events ingest）；在这些边界重复 UUID 正则不会增加安全性。

### 4.2 最小公共函数政策

- **现在不新增任何共享 requestId 模块。** 生产形状 gate 只有一个调用点
  `projectSafeMetadata`；服务端其他载体都是 `request.id` 的直接透传。
- 只有当**第二个生产调用点需要完全相同的不可信 claim 校验语义**时，才提取一个最小函数
  （例如 `isUuidShapedRequestIdClaim(value: unknown): value is string`），并让两个调用点共享；
  不为测试、日志或单一入口机械抽模块。
- 测试中重复的 `UUID_V4` 正则是独立断言边界，不是生产重复实现；不需要抽公共测试框架。

## 5. UUID 形状规则（分层）

| 层 | 规则 | 依据 |
| --- | --- | --- |
| 服务端 live 铸造 | 严格 UUIDv4：`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`（大小写不敏感） | `randomUUID()`；测试 `apps/api/src/server.requestId.test.ts:24-25`、`apps/api/src/routes/requestIdWireContract.test.ts:39-40`、`apps/api/src/routes/requestIdRateLimit.test.ts:22-23`（I） |
| 不可信 claim 读取投影 | 一般 UUID 形状：`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`（大小写不敏感；不强制 version/variant） | `apps/api/src/lib/proctorMonitoringService.ts:211-212`（#923/I） |
| Error Envelope / client 解析 / audit / export | 不透明字符串；只要求非空（envelope）或不校验（audit/export/client） | `packages/contracts/src/common.ts:83`；`apps/api/src/audit/auditWriter.ts:83` |
| 历史数据 | 不透明；`req-*`、任意字符串、历史 operationId 都按原样读取 | ADR-025 Decision 6；`apps/api/src/routes/audit.ts:83-128` |

**决策：** 一般 UUID 形状 gate 不收紧为严格 v4，因为它是内容注入限制而非身份核验；
严格 v4 会拒绝历史/未来版本 UUID 形状的 claim，却无法增加任何“已验证”的事实。
如果 Owner 要求严格 v4，应作为单独的安全策略变更记录，而不是在本契约中默认收紧。

## 6. 历史 `req-*` 只读数据兼容

1. **不迁移、不重写、不按形状重分类。** ADR-025 Decision 6
   （`docs/adr/ADR-025-http-request-correlation-identity.md:54-56`）与
   `docs/contracts/observability.md:191-198`（I）明确。
2. **Audit / 日志 / CSV：** `req-<base36>`、历史 operationId、任意字符串都继续按原 key 读取；
   CSV 仍把它们放在“请求ID”列，不因为看起来像 UUID 就移到“操作ID”。
   测试 `apps/api/src/routes/audit.test.ts:895-975` 钉住该行为。
3. **Client claim：** `client_events.metadata.requestId` 的历史非 UUID 值不会通过 #923 的读取投影
   （该字段被丢弃，事件行仍显示其他 allowlist 字段）。这是 fail-closed 的显示策略，
   不是数据迁移；如果 Owner 要求历史 claim 也显示，需要单独的 legacy-claim 标签决策，
   不属于本契约的默认行为。
4. **测试夹具：** `req-*` 只能用于“历史只读兼容”或“非法输入 C 场景”的测试；
   不得用于 A（真实服务端值）或 B（合法 UUID 伪造）。见 §7。

## 7. A/B/C 测试契约（SPEC §2.2/§2.5）

### 7.1 三种场景必须分开

- **A — 合法 UUID，真实服务器产生。** 用于证明同一请求的
  `Header == Pino == Error Envelope / Audit`（只在载体存在时比较）。
  生产构造必须使用 `genReqId: () => randomUUID()`；不得用 `req-*`。
- **B — 合法 UUID，由测试客户端伪造。** 用于证明：
  - 可以作为 unverified claim；
  - 不能影响服务端 request id；
  - 不能扩大查询/授权；
  - 不能伪造保存成功；
  - 不能被提升为服务器权威事实。
- **C — 非法 UUID。** 用于证明：形状不满足时被投影丢弃/拒绝、不进入受控字段、不引发 500、
  不污染合法请求或授权判断。

**禁止把 B 与 C 混成同一个测试。** 也不要用 `req-cross-org-<uuid>`、`req-forged-prt-0001`
这类字符串去测试“格式合法但来源不可信”。

### 7.2 确定性 UUIDv4 fixture

- 优先 `crypto.randomUUID()`；需要稳定输出时使用满足 RFC 4122 v4 version/variant 的固定值，
  例如 `00000000-0000-4000-8000-000000000bad`、`00000000-0000-4000-8000-000000000bee`。
- 现有仓库已有同类确定性约定，例如
  `apps/api/src/routes/proctorMonitoring.pagination.test.ts:444`
  的 `00000000-0000-4000-8000-...` 形态；复用它，不引入通用 ID Generator Framework。
- **反例：** `00000000-dead-beef-0000-000000000000` 第三段 `beef` 的 version nibble 是 `b`，
  第四段 `0000` 的 variant 是 0，不是 RFC 4122 v4；只能作为 C 场景，不能作为 B 的“合法 UUID”。

### 7.3 每个场景应覆盖的载体

| 场景 | Header | Pino | Envelope | Audit | client_events / timeline |
| --- | --- | --- | --- | --- | --- |
| A | 断言 UUIDv4 且等于 pino reqId | 断言存在且等于 header | 错误时断言等于 header | 有 audit 时断言等于 header | 不适用 |
| B | 伪造合法 UUID header 不得影响服务端 id | 服务端 id 不等于伪造值 | 不采用伪造值 | 不采用伪造值 | timeline 只作为 unverified claim 显示，且不扩大访问 |
| C | 非法 header 不生效、不 500 | 不出现伪造值 | 不出现伪造值 | 不出现伪造值 | 非法 claim 被投影丢弃；不影响合法行 |

### 7.4 现有覆盖与缺口

已存在（文件存在与断言内容，非本次执行）：

- A：`apps/api/src/routes/requestIdWireContract.test.ts:100-201`（I）覆盖
  header == pino == envelope（200/400/404/HEAD/CORS/双请求 freshness）。
- A：`apps/api/src/routes/requestIdStatusMatrix.test.ts:41-168`（I）覆盖
  200/204/401/403/409/500 + 每请求 freshness；该文件明确声明使用 `buildTestApp` 的默认
  `req-N`，只做载体相等性，不做形状断言。
- A：`apps/api/src/routes/requestIdRateLimit.test.ts:52-67`（I）覆盖 429。
- A：`apps/api/src/routes/requestIdSaveRejection.test.ts:120-170`（I）覆盖
  200 accept + 200 `accepted:false`，header == `Answer save rejected` WARN reqId。
- A：`apps/api/src/server.requestId.test.ts:164-239`（M/I）覆盖生产 boot、header guard、
  envelope↔pino、跨进程/重启 freshness。
- B（客户端 claim）：`apps/e2e/e2e/investigation-ui-acceptance.spec.ts:768`
  （I，`00000000-0000-4000-8000-000000000bad`）与
  `apps/api/src/routes/proctorMonitoring.crossOrg.test.ts:232`（I，`randomUUID()`）。
- A/B（真实 200 rejection）：`apps/e2e/e2e/investigation-ui-acceptance.spec.ts:928-1060`
  （I，M4）用真实 `CONFLICTING_PAYLOAD` 读取实际 `x-request-id`，并证明客户端 claim
  只进入 unverified 组；该测试断言 header 非空，但未显式断言 UUIDv4 形状。
- UNKNOWN（transport）：同文件 `:1061-1096`（I，M5）证明被 abort 的请求没有任何
  requestId surface；这是 UNKNOWN 边界的浏览器级证据。
- C：`apps/api/src/lib/proctorMonitoringService.test.ts:192-234`（I）覆盖
  prose/embedded UUID/oversized/non-string/`not-a-uuid` 被丢弃。
- 历史：`apps/api/src/routes/audit.test.ts:895-975`（M/I）覆盖 pre-split operationId 与
  `req-4` 不被重分类。

缺口（本次未执行测试，仅静态发现）：

> 说明：大量路由测试只写 `requestId: expect.any(String)`（例如
> `apps/api/src/routes/candidateField.test.ts:238`）；这是**允许**的。
> UUID 形状由专门的 requestId 套件拥有，不需要在每个路由测试里重复正则——
> 全局一致性是一个权威契约，不是所有模块复制同一个 regex。

1. **B 的 header 场景缺失**：`server.requestId.test.ts:168-169` 使用
   `forged-lower-header-id-prt` / `forged-upper-header-id-prt`（非法字符串，C 场景）；
   `requestIdWireContract.test.ts:159` 的 `00000000-dead-beef-0000-000000000000` 也不是 v4。
   没有测试证明“合法 UUIDv4 header 仍被忽略”。服务端行为由 `requestIdHeader: false`
   结构性保证，但 SPEC 的 B 矩阵要求显式测试。
2. **四载体直接对比缺失**：header == pino == envelope 有测试；audit metadata == request.id
   有测试（`apps/api/src/routes/audit.test.ts:1115-1160`）；但没有一个 HTTP 请求同时断言
   header == audit metadata。建议在集成阶段补一个写 audit 的 HTTP 路由四载体测试。
3. **OPTIONS 早返回的 header 未测**：`@fastify/cors` 在 onRequest 早返回 400/204；
   根 hook 先注册，理论上 header 会被设置，但 `optionsCorsWireContract.test.ts` 只断言 body
   不含 requestId，未断言 `x-request-id` header。见 §10 UNKNOWN。
4. **历史 client claim 的显示策略未文档化**：#923 的 gate 会丢弃非 UUID 历史 claim；
   当前 observability 契约只说“unverified claim”，没说“非 UUID 形状会被丢弃”。

## 8. As-built 状态矩阵（master / PR head / integration-final）

| 面 | master `5140c3dd` | #923 `d3580f3e` | #924 `e81b76a1` | integration-final `1f644725` |
| --- | --- | --- | --- | --- |
| `genReqId` UUIDv4 | 有（`server.ts:111`） | 同 master | 同 master | 有（`server.ts:117`） |
| `requestIdHeader: false` | 有（`:113`） | 同 master | 同 master | 有（`:119`） |
| `x-request-id` response header | **无** | 无 | 有（`plugins/requestIdHeader.ts`；`server.ts:140`） | 有 |
| Error Envelope requestId | 有 | 有 | 有 | 有 |
| Pino reqId | 有 | 有 | 有 | 有 |
| Audit metadata.requestId | 有（HTTP only） | 有 | 有 | 有 |
| Proctor client-claim UUID gate | **无**（任意字符串可投影） | 有（`proctorMonitoringService.ts:211-236`） | 无（在 #923） | 有 |
| Client `postWithMeta` / header consumption | **无** | 无 | 有（`api.ts` / `TakeExamPage.tsx`） | 有 |
| `req-cross-org-<uuid>` 夹具 | 无此测试 | 无此测试 | **有（`:229`，P0）** | 已修为 `randomUUID()`（`:232`） |
| `req-forged-prt-0001` 夹具 | **有（E2E `:765`，P0）** | **有（`:765`，P0）** | **有（`:765`，P0）** | 已修为 v4 固定值（`:768`） |
| OpenAPI 401/403 requestId 位置 | 顶层（错误） | 同 | 同 | 同（`swagger.ts:229,258`） |
| observability 形状 gate 文档 | 无 | 无 | 无 | **无（缺口）** |

结论：

- 服务端权威链在 master 与 #924 都是正确的；#924 只是增加 header 载体，不改变铸造。
- #923 的 gate 与 #924 的夹具存在跨 PR 语义依赖；集成修复 `3e97c497` 只在本地
  `integration-final`，未进入 PR 分支或 `origin`。
- 因此不能把任一 PR 单体的绿灯当作集成绿灯；必须在集成树重跑 A/B/C 矩阵。

## 9. 最小整改建议（不实施，仅契约建议）

### 9.1 必须先修（P0）

1. `apps/api/src/routes/proctorMonitoring.crossOrg.test.ts:229`（#924）：
   `req-cross-org-${randomUUID()}` → `randomUUID()`（integration-final `3e97c497` 已做）。
2. `apps/e2e/e2e/investigation-ui-acceptance.spec.ts:765`（master/#923/#924）：
   `req-forged-prt-0001` → `00000000-0000-4000-8000-000000000bad`
   （integration-final `3e97c497` 已做）。
3. 把 `3e97c497` 的两个 hunk 归属到正确的 PR 分支（跨组织新增测试由 #924 负责；
   旧 E2E 夹具兼容由 #923 负责），不能让修复只停留在本地分支。
4. 修 OpenAPI 注入 schema：`apps/api/src/openapi/swagger.ts:222-269` 的 401/403
   `requestId` 必须在 `error` 内，与 `ErrorResponseSchema` 一致；重新生成
   `apps/api/openapi.json`。
5. 更新 `docs/contracts/api-contract.md:81`：说明 live 值 = server UUIDv4；历史值可为
   `req-<base36>`/任意 legacy；客户端按不透明字符串处理。

### 9.2 应该修（P1/P2）

1. 客户端测试中以 `req-*` 冒充服务端 envelope/header 的 fixture（见 reconciliation 文档）
   改为确定性 UUIDv4；这些测试当前不失败，因为 client 不校验形状，但会误导“真实协议形状”。
2. `docs/contracts/observability.md:43,289`：把“pino default”改为
   “Fastify `genReqId` UUIDv4；pino 记录”；补一行 #924 `x-request-id` 载体状态。
3. `docs/contracts/observability.md:100-105`：补充 #923 的 UUID 形状 gate：
   只保留 UUID 形状的 client claim；非 UUID/非字符串被丢弃；gate 不核验身份。
4. `docs/operations/save-failure-evidence.md:58`（master & I）：步骤 1 也收集 200 rejection
   alert 的 请求编号（#924 header），不只 envelope requestId。
5. `docs/architecture/exam-system/security-model.md:266-274`：补一条 client-event requestId
   信任不变量（client claim、不用于 authz、读取时形状 gate）。建议作为 #923 的文档后续，
   不修改历史条款。

### 9.3 不做什么

- **不**迁移/重写任何历史 `req-*`、audit 行、CSV 导出或 client_events 行。
- **不**为 requestId 新增查询 API、日志平台、Correlation Service 或管理 UI（#921 仍约束）。
- **不**在 client_events ingestion 增加 UUID 校验；读取投影是唯一 gate。
- **不**为单一生产入口抽公共 requestId 模块；只有出现第二个相同语义的生产调用点时才提取最小 helper。
- **不**把 header 当作凭据、授权依据、保存成功证明或跨重启唯一性证明。
- **不**把 `clientSeq` / `operationId` / receipt 塞进 requestId 语义。

## 10. 验收检查（集成阶段应执行）

以下命令用于后续集成验证；本次审计只执行了静态检索，未执行测试。

```bash
# 1. 两处 P0 夹具在目标分支必须消失
git grep -n 'req-cross-org-' <target-ref> -- apps/api/src/routes/proctorMonitoring.crossOrg.test.ts
git grep -n 'req-forged-prt-0001' <target-ref> -- apps/e2e/e2e/investigation-ui-acceptance.spec.ts

# 2. UUID 形状 gate 只有一个生产调用点
git grep -n 'REQUEST_ID_UUID_SHAPE' <target-ref> -- apps/api/src
git grep -n 'setupRequestIdHeader' <target-ref> -- apps/api/src

# 3. OpenAPI 的 error.requestId 必须嵌套在 error 内
jq -r '[.paths | to_entries[] | .key as $p | .value | to_entries[]
  | select(.key|test("get|post|put|patch|delete")) | .key as $m
  | .value.responses // {} | to_entries[]
  | select(.key=="401" or .key=="403")
  | select(.value.content["application/json"].schema.properties.requestId != null)
  | "\($p) \($m|ascii_upcase) \(.key)"] | length' apps/api/openapi.json
# 期望 0（当前为 203）

# 4. 相关测试（集成阶段执行）
pnpm --filter @exam/api test -- src/routes/requestIdWireContract.test.ts \
  src/routes/requestIdStatusMatrix.test.ts src/routes/requestIdRateLimit.test.ts \
  src/routes/attempts/requestIdSaveRejection.test.ts \
  src/lib/proctorMonitoringService.test.ts src/server.requestId.test.ts
```

验收标准：

- `UUID_FIXTURE_CONTRACT = PASS`：上述两处 P0 消失；所有 A/B fixture 为 UUIDv4；
  C fixture 明确标注为非法；历史 `req-*` 只出现在历史兼容测试。
- `SERVER_ID_AUTHORITY = PASS`：生产 boot 的 Pino reqId、header、envelope 全部 UUIDv4 且同源。
- `CLIENT_CLAIM_ISOLATION = PASS`：合法 UUID 伪造 claim 仍不能扩大访问、不能影响服务端 id、
  不能伪造保存成功；timeline 只显示为 unverified claim。
- `CORRELATION_GLOBAL_CONSISTENCY = PASS`：OpenAPI、api-contract、observability、
  save-failure-evidence、security-model 对 requestId 的表述一致；没有顶层 requestId 的错误 schema。

## 11. UNKNOWN（不猜测）

1. OPTIONS 早返回的 `x-request-id` header 是否实际存在：根 hook 先于 CORS 注册，
   理论上应存在；但 `apps/api/src/routes/optionsCorsWireContract.test.ts` 只断言 body 不含
   requestId，未断言 header。**NOT_RUN / UNKNOWN**。
2. `#923` gate 是否应保留历史非 UUID client claim 的显示：当前实现丢弃；
   是否满足产品调查需求需要 Owner 决策。**UNKNOWN**。
3. `integration-final` 的 `3e97c497` 是否已在任何 CI 上执行：本次只读 commit；
   `git ls-remote origin refs/heads/final-closure-integration` 为空，说明未推送。**NOT_RUN**。
4. `docs/contracts/api-contract.md:141` 的 “carries no requestId” 是否会被理解为
   “连 header 也没有”：body 语义确定；header 语义见 1。**UNKNOWN（措辞歧义）**。
5. `apps/api/openapi.json` 是否被下游工具用于生成客户端/文档：本次只确认它是 tracked
   artifact 且 `api:openapi:check` 以它为准；下游消费方不在本仓库。**UNKNOWN**。
6. 是否存在本仓库之外的服务（nginx/代理/日志采集器）会改写 `x-request-id`：
   ADR-025 明确 header 可被中间层替换；具体部署的代理行为不在本次静态审计范围。**UNKNOWN**。
