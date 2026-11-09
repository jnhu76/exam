# SAVEANSWER_END_TO_END — SaveAnswer 端到端协议与调查证据

- 状态：**最终交付文档**（SPEC §5.2 / §9 交付物 6）。记录 as-built 协议与运维调查链，不修改产品代码。
- 集成 SHA：`a5df2c90ace6366e69c951e6660dc268327b6e8a`（任务给定 exact 集成 SHA；本会话 `git rev-parse HEAD` 一致）。父提交 `0b2e2d8a…` 为四 PR 合并完成点，二者产品代码逐字节一致。
- 裁决权威：`FINAL_PRODUCT_ADJUDICATION.md`（verdict **BLOCKED**，由 required CI FAIL 驱动；产品契约面全 PASS、`SAVEANSWER_RECEIPT_SEMANTICS = UNCHANGED`）。未合并、未发布。
- 证据纪律：代码锚点本会话 `grep` 实读；测试数字来自给定材料（REVIEW_PROTOCOL / REVIEW_SECURITY / FINAL_PRODUCT_ADJUDICATION / `pr-body.md` / `logs/`），本会话未复跑定向或全量测试套件。

---

## 1. 协议权威链（本会话实读）

| 环节 | 权威 | 锚点 |
| --- | --- | --- |
| HTTP 请求 id | 服务端单一铸造 UUIDv4 | `apps/api/src/server.ts:117` `genReqId: () => randomUUID()`、`:119` `requestIdHeader: false` |
| 响应头载体 | root-scope hook 透传同一值 | `apps/api/src/plugins/requestIdHeader.ts:34-35` `reply.header("x-request-id", request.id)` |
| 200 业务拒绝体 | 不含 `requestId`，由 `.strict()` 保证 | `packages/contracts/src/attempt.ts:229-246` `SaveAnswerRejectedSchema`、`:218-224` `SaveAnswerAcceptedSchema` |
| 拒绝 WARN 行 | pino 自动带同一 `reqId` | `apps/api/src/routes/attempts.candidate.ts` 拒绝路径（REVIEW_PROTOCOL §3.2） |
| 保存成功判定 | 仅 `result.accepted === true` | `apps/web/src/pages/exam/TakeExamPage.tsx:915` |
| receipt | 只在 `accepted:true` 写入；联合主键 `(organizationId, attemptId, questionId, clientSeq)` | `packages/db/src/schema/pg.ts`；`packages/contracts/src/attempt.ts:274-282` `AnswerSaveReceiptSummarySchema` |
| 幂等 / 冲突 / 版本 | `canonicalAnswerIdentity`、STALE_VERSION / FUTURE_VERSION / CONFLICTING_PAYLOAD | `packages/exam-engine/src/answerProtocol.ts`（REVIEW_PROTOCOL §3.1） |
| 客户端元数据 | opt-in，仅在 response 成功后从同一 Response 取 header | `apps/web/src/lib/api.ts:242` `response.headers.get("x-request-id")`、`:306` `requestWithMeta`、`:426` `postWithMeta` |

**INVARIANT**：`requestId` 只回答「哪一个 HTTP 请求」，不回答「谁、能访问什么、保存是否成功、业务操作是否幂等」。任何把 `requestId`（或 2xx 响应、或 `x-request-id` 的存在）写成「保存成功证明」的表述都是错误的。客户端 telemetry 里的 `requestId` 是**未核验声明**，不是独立服务器证据（`docs/operations/save-failure-evidence.md:22, 90-97`）。

---

## 2. 完整调查示例（SPEC §5.2）

```
Candidate receives 200 accepted:false → X-Request-Id → Pino WARN → Receipt/Domain Verification
```

场景：考生报告「答案没保存」，拒绝告警显示「请求编号 `R`」。`R` 是 200 响应 `x-request-id` 头的值（#924 新增的客户端可见载体），不是 200 body 字段。

1. **业务拒绝（F2）**：`POST /attempts/:attemptId/answers/:questionId` 返回 HTTP 200 `accepted:false` + `reason` + `serverVersion` + `savedAt`。这是协议裁决，**不是传输失败**；不产生新 receipt、不改答案。200 body 故意无 `requestId`（`.strict()`）。
2. **X-Request-Id**：`R == request.id`（单一铸造、root-scope hook 透传）。在应用日志按 `reqId = R` 精确检索，并以 `attemptId + questionId + clientSeq + 服务端时间窗` 复核。
3. **Pino WARN**：`"Answer save rejected"` 行带同一自动 `reqId`，字段仅 `organizationId / actorId / actorRole / attemptId / questionId / clientSeq / reason / serverVersion`，不含答案内容。无 WARN 行 = 证据缺口，不证明请求未到达。
4. **Receipt / Domain Verification**：查 `exam_answer_save_receipts`（按 `(org, attemptId, questionId, clientSeq)`）与 `exam_attempts.answers` 的当前版本。`accepted:false` 对该 `clientSeq` 无 receipt；但同一 key 的**更早** receipt 可能仍存在（`CONFLICTING_PAYLOAD`），receipt-first 调查不能停在「存在 receipt」。当前权威保存值/版本是领域状态，不是客户端信念。
5. **客户端 telemetry 的边界**：`answer_autosave_failed` metadata 可能带同一 `R`，但它是浏览器对所见 header 的声明，投影在「客户端声明，未经服务端核验」组下，须与服务端自身 request log 对照才能成为「一次请求身份」的工作假设；1 个匹配 = 工作假设，多个 = AMBIGUOUS，0 个 = 证据缺口（F6），**绝不**证明未到达。
6. **分类与处置**：有 200 拒绝体 + 匹配 WARN 行 ⇒ **F2**，按 `reason` 处置（见 `docs/operations/save-failure-evidence.md` §Operator procedure step 6）。

可复算的完整 worked example（含 SQL 与每条证据「能证明什么 / 不能证明什么」）见 `docs/operations/save-failure-evidence.md` §Worked example。

---

## 3. 七种结果的证据矩阵（SPEC §5.2 要求覆盖）

| 结果 | 服务端事实 | `requestId` 的角色 | 分类 |
| --- | --- | --- | --- |
| 已接受保存（保存成功） | receipt + `accepted:true` 被客户端观察 | 成功只由 `accepted === true` 判定；成功路径不读 `meta.requestId`、成功遥测不含 `requestId` | **F5** |
| 业务拒绝 | 200 `accepted:false` + WARN 行；无新 receipt | header `R` == WARN `reqId`，是关联键；不是保存裁决 | **F2** |
| 协调成功（STALE_VERSION reconcile） | 服务器拒绝本次 save，客户端采用 `details.serverAnswer` 权威值 | 有 header id 也不能把 reconcile 变成失败事实；`saveMode:"stale_reconcile"` 遥测为既有命名（REVIEW_PROTOCOL low/P3） | **F4 方向 / F2 分支** |
| 传输失败 | 无响应可观察 | `classifyWireFailure` 给 `requestId: null`，任何表面不声称 id | **F1 / F3** |
| 服务器异常 | 5xx 错误信封 `error.requestId` = 同一请求 id | 关联键 only；可重试，先检查并发 winner 的 receipt | **F3** |
| 证据缺失 | 日志轮转、无 `reqId` 保留、时间窗模糊、receipts 级联删除 | 0 匹配 = 证据缺口，不证明未到达 | **F6** |
| UNKNOWN（ACK 丢失 / 网络中断） | receipt 存在但客户端未观察到 `accepted:true`，或完全无响应 | 无客户端可见 id；由 receipt / domain state 判定；下一次 save 因 `baseVersion` 落后收到 STALE_VERSION + `serverAnswer` 并按既有 reconcile 采用权威值，不伪造 ACK | **F4 / F6** |

**UNKNOWN 边界**（`docs/operations/save-failure-evidence.md:42-46`）：「没有 row + 没有日志」最多与 F1 一致，只有在独立客户端侧证据下才成为 F1；否则一律显式报告 UNKNOWN。

---

## 4. 并发、重试、迟到响应

- **幂等 / 冲突**：相同 `(clientSeq, canonical identity)` 回放 `accepted:true`、零写入；不同 identity ⇒ `CONFLICTING_PAYLOAD`；`baseVersion < currentVersion` ⇒ `STALE_VERSION` + `latestAnswer`；`>` ⇒ `FUTURE_VERSION`。`answerProtocol.ts` 在同一事务内 `findAnswerReceipt` → `update({answers,lastActivityAt})` + `appendAnswerReceipt`；所有拒绝 / 回放分支 **NO WRITE**。
- **事务与锁**：save 路由整段在 `executeInTransaction`，`lockEnrollmentAndAttempt`（EA 锁序）→ canonical effective deadline / checkedAt → `saveAnswer`；`fastify.now()` 单一时间权威，客户端 `clientSavedAt` 不参与决策。`exam_answer_save_receipts` 联合主键兜底并发同 key。
- **重试**：`retryFailedSaves` 经同一 `saveAnswer → scheduleSave → flush` 编排；每次调度新 `clientSeq` + 当前已知 `baseVersion`，不重用已接受 key。单一 save 实现面（`postWithMeta` 仅 `TakeExamPage.tsx:898` 一处生产调用）。
- **多题并发 / 旧 attempt 迟到响应**：`useSubmitFlush.ts` 每题独立 inflight、同题串行、异题并行，`questionGenerations` 防乱序；`TakeExamPage.tsx` 四处 `saveStale()` 以 scope generation 阻断旧请求写新页面状态。
- **请求 id 配对**：`saveRejectionRequestId` 与 `saveRejection` 同点无条件覆写（null 也清），与 `saveFaultRequestId`（不同 writer/生命周期）刻意分离；mixed sequence / heartbeat 不覆写 / later success 清除均被测试覆盖（给定材料：REVIEW_PROTOCOL §3.4）。

---

## 5. 200 拒绝为何没有 durable refusal record（#861 决策）

拒绝裁决与 reason 由 200 响应 + 一条结构化 WARN 行承载；receipt + domain state 证明已接受保存。没有业务决策消费 durable refusal 行，且「无 receipt」本身不证明拒绝（UNKNOWN 边界）。新增表会带来写放大、事务原子性分叉和独立生命周期，#861 决策框明确拒绝。`docs/operations/save-failure-evidence.md` §Why there is no durable refusal record 为权威。

---

## 6. 验证证据与边界

- 给定材料中的实跑证据：REVIEW_PROTOCOL §4 定向 306 用例全通过（引擎 59 / web 69 / api 含真实 PostgreSQL 76 / contracts 60 / clientEvents 46），并含 `candidate-save-deadline-race.concurrency`、`saveAnswerReplayReceipts`、`requestIdSaveRejection`（真实 STALE_VERSION 200 拒绝、`entry.reqId === header`、body 无 requestId）；`FINAL_PRODUCT_ADJUDICATION.md` 两版分别记录 307 / 342 定向测试全通过；浏览器级 M3/M4/M5（真实 `CONFLICTING_PAYLOAD` 全链、abort 后零 id 表面）在裁决员会话实跑通过（A3-F7 `:341` 为非确定性 E2E 失败，非产品契约回归）。
- `git diff 5140c3dd..a5df2c90` 对 `packages/contracts/src/attempt.ts`、`packages/exam-engine/src/answerProtocol.ts`、`apps/api/src/routes/attempts.candidate.ts` 零改动 ⇒ **receipt 语义 UNCHANGED**（给定材料 + 本会话 `git diff` 复核）。
- 本会话**未复跑**：上述定向套件、全量 `pnpm verify` / `pnpm test` / `pnpm e2e`、浏览器级 E2E、nginx 故障注入。本会话实跑的是 `pnpm format:check`、`pnpm docs:build` 与 `gh`/`git` 查询（见 `PERFORMANCE_AND_CI.md`）。
- required CI 在 exact SHA 上 FAIL (exit 1)（外部 GitHub 计费，#930 OPEN）；本地绿灯不替代 required CI。本文档不声称 CI 通过、不声称已合并、不声称已发布。
