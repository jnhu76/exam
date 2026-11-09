# UUID_FIXTURE_RECONCILIATION

- 状态：只读审计与整改建议文档；未修改任何测试或产品代码，未 commit / push / merge。
- 审计基线：`master @ 5140c3dd0f9dbde1bdad8f5b757161f3ed96945d`。
- 在途 PR head：`#923 @ d3580f3e46e2292317dfe831efd982d475d163e8`、
  `#924 @ e81b76a17212c8e321a83f1b0522e54a049326f1`。
- 本地集成参照：`final-closure-integration @ 1f644725d574dd669081b3008a73122c1a55641c`
  （local-only；含 `3e97c497` 两处夹具修复）。
- 关联契约：`REQUEST_ID_GLOBAL_CONTRACT.md`（同目录）。
- 证据纪律：本文件只记录实际检索到的事实；未运行 `pnpm test` / `pnpm e2e`。
  文件行号来自对应 worktree/commit；不同分支的行号差异已标注。

## 0. 结论

| 项目 | 结论 |
| --- | --- |
| SPEC §2.2 点名的两处非 UUID 夹具 | `master` 有 E2E 一处；`#923` 有 E2E 一处；`#924` 有 E2E + crossOrg 两处；仅在本地 `integration-final` 的 `3e97c497` 修复 |
| 其它 P1 级客户端/envelope/header 夹具 | **大量存在**（以 `req-*` 冒充服务端 UUID）；不导致集成红，但违反“真实协议形状”的测试契约 |
| 历史 `req-*` / legacy 兼容夹具 | **合规，不得修改**（audit CSV / pagination / 历史 operationId 场景） |
| C 场景非法夹具 | **合规，保留**（proctor 形状 gate 的负例） |
| 过期/错误文档断言 | 存在（OpenAPI 401/403 顶层 requestId；api-contract/observability/save-failure 措辞；#923 gate 未写入契约） |

**`UUID_FIXTURE_CONTRACT` 当前为 FAIL**；`SERVER_ID_AUTHORITY` 不受影响（见契约文档 §0）。

## 1. 分级定义

| 级别 | 定义 | 处置 |
| --- | --- | --- |
| **P0 — merge-blocking** | 直接违反 SPEC §2.2/§2.4：用非 UUID 字符串测试“合法/真实形状”的 requestId，或导致 #923 gate 后正控制/断言失效 | 必须在合并前修复；必须在目标 PR 分支上修复，不能只留在本地 |
| **P1 — contract-representative drift** | 测试模拟服务端 envelope/header 或“客户端伪造的合法 claim”，但使用非 UUID 字面量；当前因 client 不校验形状而通过，但不再代表真实协议 | 应在同一 #924 跟进或下一次触碰该文件时改为确定性 UUIDv4；不单独阻塞合并 |
| **P2 — fixture hygiene** | 测试模拟服务端 4xx/5xx envelope 或 client logger 的 requestId，但该测试不验证 requestId 语义；非 UUID 不影响断言 | 可与 P1 一起清理；低优先级 |
| **P3 — non-wire unit stub** | `FastifyRequest` stub、纯格式化函数参数、直接构造 `ApiError` 等，不对应 wire 值 | 不需要改；若顺手统一可改为 UUID，但不是契约要求 |
| **ALLOW — intentional** | 历史 `req-*` / legacy operationId / opaque audit metadata / C 场景非法值 / 只做载体相等性的 `req-N` 测试 | **禁止为了统一而修改**；修改会破坏历史兼容或负例语义 |

## 2. P0 — 必须修复

### 2.1 `req-cross-org-<uuid>`（#924 分支）

- 位置（#924 head `e81b76a1`）：
  `apps/api/src/routes/proctorMonitoring.crossOrg.test.ts:229`
  ```ts
  const claimedRequestId = `req-cross-org-${randomUUID()}`;
  ```
- 场景：跨组织测试的“owning org 管理员能看到 client-claimed requestId”正控制。
- 违反：`req-cross-org-<uuid>` 不匹配 #923 的
  `REQUEST_ID_UUID_SHAPE`（`apps/api/src/lib/proctorMonitoringService.ts:211-212`），
  投影会丢弃该 claim，正控制被 void。
- 修复（已存在于本地 `integration-final` 的 `3e97c497`）：
  `apps/api/src/routes/proctorMonitoring.crossOrg.test.ts:232` 改为 `const claimedRequestId = randomUUID();`。
- 归属：SPEC §2.4 建议跨组织新增测试由 #924 负责；该 hunk 应提交到 #924 分支。

### 2.2 `req-forged-prt-0001`（master / #923 / #924）

- 位置（master `5140c3dd`、#923 `d3580f3e`、#924 `e81b76a1` 同一行）：
  `apps/e2e/e2e/investigation-ui-acceptance.spec.ts:765`
  ```ts
  const forgedRequestId = "req-forged-prt-0001";
  ```
- 场景：E2E M3 注入“real-shaped server-fault envelope with a FORGED requestId”，
  并断言 banner、proctor 时间线、attempt detail 都显示该值。
- 违反：它不是 UUID 形状；#923 的 gate 会丢弃 telemetry claim，导致
  `expect(clientDialogText).toContain(forgedRequestId)` 等断言失败（#923 的 CI 已红）。
- 修复（已存在于本地 `integration-final` 的 `3e97c497`）：
  `apps/e2e/e2e/investigation-ui-acceptance.spec.ts:768` 改为
  `const forgedRequestId = "00000000-0000-4000-8000-000000000bad";`
  （RFC 4122 v4：version 4、variant 8）。
- 归属：旧 E2E 夹具兼容由 #923 负责（SPEC §2.4）；该 hunk 应提交到 #923 分支。

### 2.3 修复未进入受控历史

- `3e97c497` 只在本地 `final-closure-integration`；`git ls-remote origin
  refs/heads/final-closure-integration` 为空。
- 两个 PR 分支的 head 仍未包含修复；`#923` 的 CI 仍红
  （`BASELINE_AND_OWNERSHIP.md` §2.3 记录 E2E shard 1 的
  `Expected substring: "req-forged-prt-0001"`）。
- 结论：**不能把 `integration-final` 的本地状态当作已合并/已评审状态**；
  在修复 hunk 落到对应 PR 分支并重新跑 CI 前，P0 仍成立。

## 3. P1 — 代表性漂移（应修，不单独阻塞）

以下测试用 `req-*` 字符串模拟**服务端生成的 envelope requestId、header requestId
或“客户端伪造的合法 claim”**。因为 web client 明确把 requestId 当作不透明字符串
（`apps/web/src/lib/api.ts:219-292`，I），这些测试当前不会失败；但它们不再代表真实协议形状，
且与 E2E M3 的 B 语义不一致。建议改为 `crypto.randomUUID()` 或确定性 UUIDv4 常量。

行号均为 **integration-final `1f644725`**（除特别标注）；master 行号通常少 9 行左右
（#924 在文件顶部增加了注释/状态）。

### 3.1 SaveAnswer 相关

| 文件:行（I） | 值 | 角色 | 说明 |
| --- | --- | --- | --- |
| `apps/web/src/pages/exam/TakeExamPage.saveFault.test.tsx:241` | `req-500-abc` | A（5xx envelope） | 模拟服务端错误 envelope；master `:232` |
| `apps/web/src/pages/exam/TakeExamPage.saveFault.test.tsx:310` | `req-409-xyz` | A（409 envelope） | master `:301` |
| `apps/web/src/pages/exam/TakeExamPage.saveFault.test.tsx:437` | `req-hb` | A（heartbeat 5xx envelope） | master `:428` |
| `apps/web/src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx:272` | `req-rej-865-001` | A（200 rejection header） | 新文件（#924） |
| `apps/web/src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx:341` | `req-conflict-865` | A（header） | 同上 |
| `apps/web/src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx:389` | `req-stale-865` | A（header） | 同上 |
| `apps/web/src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx:444` | `req-401-env` | A（401 envelope） | 同上 |
| `apps/web/src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx:488` | `req-403-env` | A（403 envelope） | 同上 |
| `apps/web/src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx:524` | `req-retry-865` | A（header） | 同上 |
| `apps/web/src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx:595` | `req-att1-late` | A（header） | 同上 |
| `apps/web/src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx:651` | `req-q1-rej` | A（header） | 同上 |
| `apps/web/src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx:654` | `req-q2-ok` | A（header） | 同上 |
| `apps/web/src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx:702` | `req-q1-rej` | A（header） | 同上 |
| `apps/web/src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx:788` | `req-rej-hb-865` | A（header） | 同上 |
| `apps/web/src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx:814` | `req-hb-500` | A（heartbeat 5xx envelope） | 同上 |
| `apps/web/src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx:897` | `req-q1-rej` | A（header） | 同上 |
| `apps/web/src/pages/exam/TakeExamPage.saveState.test.tsx:416` | `req-p6-stale-865` | A（header） | 新文件（#924） |

### 3.2 Proctor / admin 时间线（B 语义）

| 文件:行（I） | 值 | 角色 | 说明 |
| --- | --- | --- | --- |
| `apps/web/src/pages/admin/ExamMonitoringPage.test.tsx:263` | `req-42` | B（client-claimed timeline metadata） | 测试 “forged requestId/status” 的 unverified 标签 |
| `apps/web/src/pages/admin/AttemptDetailPage.test.tsx:703` | `req-42` | B（client-claimed timeline metadata） | 同上 |

这两个测试直接 mock proctor-events 响应，绕过服务端投影；#923 gate 后真实 API
不会再返回非 UUID claim。它们应使用 UUIDv4，否则组件测试的状态不再可达。

### 3.3 API client / auth context

| 文件:行（I） | 值 | 角色 | 说明 |
| --- | --- | --- | --- |
| `apps/web/src/lib/api.test.ts:229` | `req-web` | A（validation envelope） | master 同行 |
| `apps/web/src/lib/api.test.ts:253` | `req-web` | A | 同上 |
| `apps/web/src/lib/api.test.ts:463` | `req-c3-1` | A（401 envelope） | 同上 |
| `apps/web/src/lib/api.test.ts:480` | `req-c3-1` | A | 同上 |
| `apps/web/src/lib/api.test.ts:492` | `req-c3-2` | A（401 envelope） | 同上 |
| `apps/web/src/lib/api.test.ts:546` | `req-c3-4` | A（401 envelope） | 同上 |
| `apps/web/src/lib/api.test.ts:649` | `req-c3-5` | A（401 envelope） | 同上 |
| `apps/web/src/lib/api.test.ts:668` | `req-c3-5` | A | 同上 |
| `apps/web/src/lib/api.test.ts:801` | `envelope-req-id` | A（400 envelope） | #924 Case D；断言在 `:815` |
| `apps/web/src/lib/api.test.ts:842` | `envelope-req-id` | A（500 envelope） | #924 mismatch；断言在 `:865` |
| `apps/web/src/lib/api.test.ts:849` | `header-req-id` | A（header） | 同上；warn 断言在 `:876-877` |
| `apps/web/src/lib/api.test.ts:900` | `same-id` | A（envelope+header 相等） | #924 |
| `apps/web/src/lib/api.test.ts:919` | `env-only` | A（仅 envelope） | #924 |
| `apps/web/src/contexts/AuthContext.test.tsx:316` | `req-login` | A（401 envelope） | — |
| `apps/web/src/contexts/AuthContext.test.tsx:346` | `req-login` | A（401 envelope） | — |

`apps/web/src/lib/api.test.ts:437` 的 `req-class` 是直接 `new ApiError(...)` 的参数
（`:445` 断言），不是 wire 模拟；归 P3。
表中 `:253`、`:480`、`:668` 是同一 fixture 的断言行，对应 fixture 分别为
`:229`、`:463`、`:649`。

### 3.4 为什么 P1 不是 P0

- P1 测试不经过服务端的 #923 gate；它们直接构造 `Response` / 组件 props，
  所以非 UUID 不会让集成 CI 变红。
- 但它们模拟的是“服务端会发出的值”；真实服务端只会发出 UUIDv4（A）或
  合法 UUIDv4 的伪造 claim（B）。保留 `req-*` 会掩盖未来客户端若意外增加形状假设时的回归。
- 建议在 #924 的 follow-up 或下一次触碰文件时统一改为确定性 UUIDv4；不为此单独扩大 PR 范围。

## 4. P2 / P3 — 低优先级

### 4.1 P2（fixture hygiene）

| 文件:行 | 值 | 说明 |
| --- | --- | --- |
| `apps/web/src/lib/clientEvents.test.ts:188` | `req-prw-test` | 模拟 400 VALIDATION_ERROR envelope；client logger 不校验形状 |
| `apps/web/src/lib/clientEvents.test.ts:293` | `req-x` | 同上（401/403/429 类） |
| `apps/api/src/routes/audit.test.ts:1034` | `test-req-id` | 直接构造 `FastifyRequest`，经 HTTP audit writer 写入；不验证 requestId 语义 |
| `apps/api/src/routes/audit.test.ts:1085` | `test-req-id-2` | 同上 |

### 4.2 P3（non-wire unit stub）

| 文件:行 | 值 | 说明 |
| --- | --- | --- |
| `apps/api/src/authz/candidateContextCapability.test.ts:39` | `id: "req-1"` | `FastifyRequest` stub，只用于 authz |
| `apps/api/src/authz/examEligibilityCapability.test.ts:107` | `id: "req-1"` | 同上 |
| `apps/api/src/authz/ownAttemptCapability.test.ts:93` | `id: "req-1"` | 同上 |
| `apps/api/src/authz/scoreCapability.test.ts:90` | `id: "req-1"` | 同上 |
| `apps/api/src/routes/helpers.test.ts:14`（断言 `:18`） | `req-1` | `formatZodError(requestId, ...)` 纯格式化参数 |
| `apps/web/src/lib/apiErrors.test.ts:41` | `req-t1` | 直接 `new ApiError(...)` |
| `apps/web/src/lib/apiErrors.test.ts:133` | `req-t4` | 同上 |
| `apps/web/src/lib/api.test.ts:437`（断言 `:445`） | `req-class` | 直接 `new ApiError(...)`；不是 wire 模拟 |

这些不是 wire fixture，不需要为了统一而修改。

## 5. ALLOW — 有意保留

### 5.1 历史只读兼容

| 文件:行 | 值 | 为什么保留 |
| --- | --- | --- |
| `apps/api/src/routes/audit.test.ts:870` | `req-123` | 审计 CSV 历史行；断言按 key 投影、不按形状重分类（`:886`） |
| `apps/api/src/routes/audit.test.ts:938` | `req-4` | HTTP 审计历史行；断言 “请求ID” 列保留 `req-4`（`:974`） |
| `apps/api/src/routes/audit.test.ts:895-975` | pre-split operationId 存于 `metadata.requestId` | 历史 operationId 兼容；不得迁移/重写 |
| `apps/api/src/routes/proctorMonitoring.pagination.test.ts:155` | `pagination-test` | 分页测试的 opaque audit metadata；不验证 requestId 语义 |
| `apps/api/src/routes/proctorMonitoring.pagination.test.ts:337` | `p4-irrelevant` | 同上（不相关 audit 行） |
| `apps/api/src/routes/proctorMonitoring.pagination.test.ts:386` | `p4b-irrelevant` | 同上 |
| `apps/api/src/routes/audit.test.ts:493` / `:582` | `"t"` | 分页/游标测试的 opaque metadata 占位，不是 requestId 语义 |

### 5.2 C 场景（非法输入负例）

| 文件:行 | 值 | 为什么保留 |
| --- | --- | --- |
| `apps/api/src/lib/proctorMonitoringService.test.ts:201` | `req-500-abc` | 断言非 UUID claim 被投影丢弃 |
| `apps/api/src/lib/proctorMonitoringService.test.ts:213` | `"x".repeat(32_768)` | 超长值被丢弃 |
| `apps/api/src/lib/proctorMonitoringService.test.ts:229` | `not-a-uuid` | 非法形状被丢弃 |
| `apps/api/src/routes/requestIdWireContract.test.ts:159` | `00000000-dead-beef-0000-000000000000` | 非 RFC 4122 v4（version `b`、variant `0`）；是合法的 C 场景，但**不满足 B**；见 §7 |
| `apps/api/src/server.requestId.test.ts:168-169` | `forged-lower-header-id-prt` / `forged-upper-header-id-prt` | 非法 header 值；C 场景；**不满足 B**；见 §7 |

### 5.3 只做载体相等性的测试

| 文件:行 | 说明 |
| --- | --- |
| `apps/api/src/routes/requestIdStatusMatrix.test.ts:14` | 文件明确声明 `buildTestApp` 使用 Fastify 默认 `req-N`，本文件只断言 header presence / envelope equality，不断言 UUID 形状 |
| `apps/api/src/routes/requestIdSaveRejection.test.ts:24-25` | `buildTestApp` 不安装 `setupRequestIdHeader`，测试显式安装；但它没有声明 id 形状，测试 app 仍用默认 `req-N`。这是载体相等性测试，不是 A 形状证据；建议在注释中补一句或改用生产 `genReqId`（P2） |

这些不是“fake 字面量”，而是测试组合选择；不要为了统一而全局修改 `buildTestApp` 的
`genReqId`（那会扩大测试基础设施变更面）。需要 A 形状证据的测试应局部组合生产
`genReqId: () => randomUUID()`（如 `requestIdWireContract.test.ts:74-78`）。

### 5.4 契约 schema 容忍非 UUID

| 文件:行 | 值 | 说明 |
| --- | --- | --- |
| `packages/contracts/src/__tests__/contracts.test.ts:83` | `req-contract` | `ErrorResponseSchema` 只要求非空字符串；该测试证明 wire schema 对历史/opaque 值兼容，**不是**“合法 UUID 伪造”场景 |

## 6. 过期/错误文档与契约断言

| 文件:行 | 断言 | 问题 | 建议 |
| --- | --- | --- | --- |
| `apps/api/src/openapi/swagger.ts:229` | 401 fallback schema `properties.requestId` 顶层 | 实际 envelope 是 `{ error: { requestId } }`；OpenAPI 与 `buildErrorResponse`/`ErrorResponseSchema` 矛盾 | 把 `requestId` 移入 `error.properties`，重新生成 `apps/api/openapi.json` |
| `apps/api/src/openapi/swagger.ts:258` | 403 fallback 同上 | 同上 | 同上 |
| `apps/api/openapi.json`（artifact） | 203 个 401/403 response 的顶层 `requestId`；48 个正确嵌套 | `jq` 计数见 §8；`api:openapi:check` 只保证 byte parity，不保证语义 | 生成后重跑 `pnpm --filter @exam/api api:openapi:check` |
| `docs/contracts/api-contract.md:81` | `error.requestId` = “Fastify request id” | 未说明 live 值是 server UUIDv4、历史值可为 `req-*`/任意 legacy；与 ADR-025 的权威措辞不一致 | 改为 server-generated UUIDv4（live）/ opaque legacy（historical） |
| `docs/contracts/observability.md:43` | “requestId/method/path/... 由 Fastify's pino integration 产生” | requestId 由 Fastify `genReqId` 产生、pino 记录；表述不精确 | 区分 `genReqId` 与 pino logging |
| `docs/contracts/observability.md:289`（I） | “Request trace ... Done (pino default)” | 生产 requestId 不是 pino default；且未反映 #924 `x-request-id` 载体 | 改为 “Done (Fastify genReqId UUIDv4 + pino logging)”；补 header 行 |
| `docs/contracts/observability.md:100-105`（I） | client claim 是 unverified | 未记录 #923 的 UUID 形状 gate：非 UUID/非字符串 claim 会被丢弃；调查者可能把“缺失”误读为“客户端没声明” | 补一段：投影只保留 UUID 形状，gate 不核验身份 |
| `docs/operations/save-failure-evidence.md:21`（M） | 200 `accepted:false` body 无 requestId；“correlate F2 by attemptId+questionId+clientSeq+time” | #924 后 response header 是客户端可见的同一 request id 载体；master 文本未更新 | 采用 integration-final 的已更新文本；保持 body 无 requestId 的区分 |
| `docs/operations/save-failure-evidence.md:58`（I） | 步骤 1 只收集 envelope requestId | #924 后 200 rejection alert 的 请求编号 也应收集（步骤 4 已提，步骤 1 未提） | 步骤 1 补 rejection alert 请求编号 |
| `docs/architecture/exam-system/security-model.md:267-275`（I） | §15.2 server-owned facts 未列 `metadata.requestId` | 缺一条“client claim、不是 server-owned、不用于 authz、读取时形状 gate”的不变量 | 建议新增 INV-CE-006（#923 文档后续） |
| `docs/contracts/api-contract.md:141` | bare OPTIONS 400 “carries no requestId” | body 确实没有 error envelope requestId；但 #924 后 response 可能带 `x-request-id` header；措辞可能被误读 | 改为 “no error-envelope requestId”；header 语义另述（OPTIONS 是否实际带 header 未测，见契约 §11） |
| `docs/contracts/observability.md:32`（M） | requestId 载体只列 envelope/Pino/audit | master 无 #924 header；合并后过期 | 采用 integration-final 的 `:32`（含 header） |
| `docs/contracts/observability.md:66-72`（M） | end-to-end correlation 未列 header | 同上 | 采用 integration-final 的 `:92-99` |
| `docs/contracts/api-contract.md`（M） | 无 `Standard response headers` 章节 | #924 新增；master 缺 | 合并 #924 后采用 `:89-93` |
| `docs/adr/ADR-025-http-request-correlation-identity.md:141-146` | 声明 api-contract/api-reference/runbook 由 in-flight 变更更新 | #924 已更新 observability/api-contract/runbook，但未更新 `api-reference.md` 的 header 说明；api-contract `:81` 仍不完整 | 补 api-reference header 说明；修 api-contract `:81` |

**注意：** `docs/releases/v0.0.12.md` 是历史发布记录，不按当前文档修改；其中对 ADR-025 的描述
（`:107-123,500-503`）是当时事实，不列为 stale。`docs/status/implementation-status.md:21`
只是高层摘要，不含 requestId 细节，不列为错误断言。

## 7. B 场景覆盖缺口（不是 fixture 违规）

SPEC §2.5 要求“合法 UUID 伪造”和“非法 UUID”是**两个独立场景**。当前：

- **B（合法 UUID 伪造 header）缺失**：
  `apps/api/src/server.requestId.test.ts:168-169` 使用 prose；
  `apps/api/src/routes/requestIdWireContract.test.ts:159` 使用非 v4 的 UUID 形状。
  两者都只能证明 C。服务端行为由 `requestIdHeader: false` 结构性保证，
  但没有测试证明“客户端提交**合法 UUIDv4** header 仍被忽略”。
- **B（合法 UUID 伪造 envelope/claim）存在**：
  E2E M3（integration-final `:768`）与 crossOrg（integration-final `:232`）覆盖了
  client-claimed / injected envelope 的合法 UUIDv4 伪造。
- **四载体直接对比缺失**：
  header↔pino↔envelope 有；audit↔request.id 有；但没有单个 HTTP 请求的
  header↔audit 直接断言。建议集成阶段补一个写 audit 的 HTTP 路由测试。
- **OPTIONS header 未测**：CORS 早返回路径没有 `x-request-id` 断言。

建议的最小补测（不扩大产品契约）：

1. 在 `requestIdWireContract.test.ts` 增加一个使用 `crypto.randomUUID()` 伪造
   `x-request-id`/`request-id` header 的 B 测试，断言服务端 header 不等于伪造值且 pino 不含它。
2. 保留现有 prose/非 v4 值为独立的 C 测试，明确标题为 invalid-UUID。
3. 在集成树增加一个写 audit 的 HTTP 路由四载体断言（header == pino == envelope/audit
   按存在性比较）。

## 8. 本次扫描命令与输出（可复核）

```bash
# 0. 基线
git -C /home/hoo/Source/exam rev-parse HEAD
# 5140c3dd0f9dbde1bdad8f5b757161f3ed96945d
git -C /home/hoo/Source/exam-gap-worktrees/integration-final rev-parse HEAD
# 1f644725d574dd669081b3008a73122c1a55641c

# 1. P0 夹具在分支上的位置
git -C /home/hoo/Source/exam show e81b76a1:apps/api/src/routes/proctorMonitoring.crossOrg.test.ts \
  | grep -n 'claimedRequestId ='
# 229:      const claimedRequestId = `req-cross-org-${randomUUID()}`;
git -C /home/hoo/Source/exam show d3580f3e:apps/e2e/e2e/investigation-ui-acceptance.spec.ts \
  | grep -n 'forgedRequestId ='
# 765:    const forgedRequestId = "req-forged-prt-0001";
git -C /home/hoo/Source/exam show e81b76a1:apps/e2e/e2e/investigation-ui-acceptance.spec.ts \
  | grep -n 'forgedRequestId ='
# 765:    const forgedRequestId = "req-forged-prt-0001";
grep -n 'forgedRequestId =' \
  /home/hoo/Source/exam/apps/e2e/e2e/investigation-ui-acceptance.spec.ts
# 765:    const forgedRequestId = "req-forged-prt-0001";

# 2. integration-final 的修复
grep -n 'claimedRequestId = ' \
  /home/hoo/Source/exam-gap-worktrees/integration-final/apps/api/src/routes/proctorMonitoring.crossOrg.test.ts
# 232:      const claimedRequestId = randomUUID();
grep -n 'forgedRequestId = ' \
  /home/hoo/Source/exam-gap-worktrees/integration-final/apps/e2e/e2e/investigation-ui-acceptance.spec.ts
# 768:    const forgedRequestId = "00000000-0000-4000-8000-000000000bad";
git -C /home/hoo/Source/exam-gap-worktrees/integration-final merge-base --is-ancestor 3e97c497 HEAD
# exit 0

# 3. 全部非 UUID requestId 字面量（测试）
cd /home/hoo/Source/exam-gap-worktrees/integration-final
rg -n --no-heading 'req-[A-Za-z0-9_.-]+' apps packages \
  --glob '*.test.ts' --glob '*.test.tsx' --glob '*.spec.ts' | sort
# 输出见 §3/§4/§5；命中包括 req-* 与 test-req-id

# 4. 生产形状 gate 单一调用点
rg -n 'REQUEST_ID_UUID_SHAPE' apps/api/src/lib/proctorMonitoringService.ts
# 211:const REQUEST_ID_UUID_SHAPE =
# 231:        if (typeof val === "string" && REQUEST_ID_UUID_SHAPE.test(val)) {

# 5. OpenAPI 401/403 顶层 requestId 计数（错误）
jq -r '[.paths | to_entries[] | .key as $p | .value | to_entries[]
  | select(.key|test("get|post|put|patch|delete")) | .key as $m
  | .value.responses // {} | to_entries[]
  | select(.key=="401" or .key=="403")
  | select(.value.content["application/json"].schema.properties.requestId != null)
  | "\($p) \($m|ascii_upcase) \(.key)"] | length' apps/api/openapi.json
# 203
jq -r '[.paths | to_entries[] | .key as $p | .value | to_entries[]
  | select(.key|test("get|post|put|patch|delete")) | .key as $m
  | .value.responses // {} | to_entries[]
  | select(.key=="401" or .key=="403")
  | select(.value.content["application/json"].schema.properties.error.properties.requestId != null)
  | "\($p) \($m|ascii_upcase) \(.key)"] | length' apps/api/openapi.json
# 48
jq -r '.paths["/api/auth/me"].get.responses["401"].content["application/json"].schema.properties | keys' \
  apps/api/openapi.json
# ["error","requestId"]

# 6. 过期文档断言检索
grep -n 'requestId\|pino default\|Fastify request id' \
  docs/contracts/api-contract.md docs/contracts/observability.md \
  docs/operations/save-failure-evidence.md \
  docs/architecture/exam-system/security-model.md
# 关键行见 §6
```

本次**未执行**：`pnpm test`、`pnpm verify`、`pnpm e2e`、`pnpm --filter @exam/api api:openapi:check`、
`sha256sum` 等。上述测试/检查的通过状态均为 **NOT_RUN**；不要引用本文件声称它们已通过。

## 9. 修复后的目标状态

1. `git grep 'req-cross-org-' <target-ref>` 无命中。
2. `git grep 'req-forged-prt-0001' <target-ref>` 无命中。
3. 所有 A/B 测试的 requestId fixture 匹配 UUIDv4（或使用 `randomUUID()`）。
4. 所有 C 测试显式命名为非法 UUID，且与 B 分开。
5. 历史 `req-*` / operationId 兼容测试保持原样。
6. OpenAPI 401/403 的 `requestId` 全部位于 `error` 内；`jq` 顶层计数为 0。
7. observability/api-contract/save-failure/security-model 的 requestId 措辞一致：
   live = server UUIDv4；header = 同一值；client claim = unverified + 形状 gate；
   historical = opaque/no rewrite。

## 10. 明确不做

- 不修改历史只读数据、audit 行、CSV 或 client_events 行。
- 不为了统一而修改 `audit.test.ts` 的历史 `req-123` / `req-4` / pre-split operationId 测试。
- 不修改 C 场景的非法值测试（`proctorMonitoringService.test.ts:201-229`）。
- 不扩大 requestId 的权限/查询能力；不新增 requestId 查询 API。
- 不把 `buildTestApp` 全局改为 UUID generator；只在需要形状证据的测试局部组合生产 `genReqId`。
- 不引入通用 ID Generator Framework 或共享 requestId 模块（除非出现第二个相同语义的生产调用点）。

## 11. 独立复核确认（2026-11-09，夹具独立复核员 · 事实追加）

以下为本文件 §9 目标状态的独立复核事实（在 PR 工作树核对，非集成树）：

- §9.1 `req-cross-org-`：pr-865 @ `9dd1d5f4` 的 `proctorMonitoring.crossOrg.test.ts:232` 已改为 `randomUUID()`，该文件无 `req-cross-org-` 残留（`git show 9dd1d5f4` 全文核对）。
- §9.2 `req-forged-prt-0001`：pr-864 @ `ca7e62ec` 的 `investigation-ui-acceptance.spec.ts:770` 已改为 `"00000000-0000-4000-8000-000000000bad"`，无 `req-forged-prt-0001` 残留。
- §9.3 两个夹具均程序化验证匹配 UUIDv4 正则（version nibble `4`、variant nibble `8`）；#923 服务端 shape gate（`proctorMonitoringService.ts:211` `REQUEST_ID_UUID_SHAPE`）接受该形状、拒绝 `req-*`。
- 运行验证（本会话执行，均 PASS / exit 0）：
  - pr-865 `pnpm vitest run src/routes/proctorMonitoring.crossOrg.test.ts`：7 passed（含正向对照与跨组织 404 断言，断言未删除）。
  - pr-864 `bash scripts/e2e/run.sh rich-content-overflow`：2 shard 全部通过（4 tests in 1 file）。
- flake 提交 `1f29b614`（pr-864）：以 settled-state 等待（`.katex` + `fonts.ready` + `data-overflowing` 重断言）+ `expect.poll`（timeout 5s = Playwright 未覆盖时的框架默认，config `retries: 0`）替代固定 `waitForTimeout(150)`；无 timeout 膨胀、无 retry、无 skip、无断言删除。
- 证据文档：`/home/hoo/Source/exam/.tmp/production-closure/reviews/REVIEW_FIXTURES_FLAKE.md`。
