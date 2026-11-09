# REVIEW_PROTOCOL — Subagent B（SaveAnswer 与并发）独立终审

- **exact 集成 SHA**：`0b2e2d8a1653ebba59326517ec2fdc6b4c7cf4bc`
- **被审工作树**：`/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109`
- **审查日期**：2026-11-09
- **角色/模式**：独立终审子代理（调查/评审模式）；未修改任何受控文件、未 commit/push、未阅读其它评审的文档或结论（目录下 `REVIEW_FIXTURES_FLAKE.md` 仅列出文件名，未打开）。
- **文档来源说明**：本文件初稿由同一 ask 的打断前 pass 写入；打断重发后本 pass 重新确认 HEAD/clean-tree，并**补跑**初稿引用而本会话尚未执行的全部测试命令（含 `saveAnswer.timingModes.test.ts`）。§4 现列出的每一条运行均为本会话在 exact SHA clean 工作树上实际执行的命令与输出。
- **结论**：**GO**（无 P0/P1/P2 阻塞发现；2 项 low/P3 观察，均不阻断上线，见 §5）。

---

## 1. 前置确认（本 ask 实际执行）

| 检查 | 命令 | 输出 |
| --- | --- | --- |
| HEAD == 目标 SHA | `cd /home/hoo/Source/exam-gap-worktrees/integration-closure-20261109 && git rev-parse HEAD` | `0b2e2d8a1653ebba59326517ec2fdc6b4c7cf4bc` |
| clean worktree | 同命令中的 `git status --short` | 空输出（clean） |
| 合并序列 | `git log --oneline -5` | `0b2e2d8a Merge PR #926 …` / `9bba9fbf Merge PR #924 …` / `4919e534 Merge PR #923 …` / `0b1902d0 Merge PR #922 …` / `8061d547 docs(research)…` |

HEAD 与工作树在复查请求重新下发后再次确认，结果一致。

## 2. 审查依据（已读材料，精确到文件/行）

- `/home/hoo/Source/exam/.tmp/production-closure/SPEC.md` **§7 Subagent B（第 792–808 行）**：clientSeq / answerIdentity / receipt / accepted:true,false / STALE_VERSION / CONFLICTING_PAYLOAD / retries / ACK 丢失 / 多题并发 / 旧 attempt 迟到响应 / UI requestId 与真实请求关联；重点「是否新增伪造业务成功或错误失败」。另读 §7.1 独立性要求（840–856 行）与 §7.2 修复—复审闭环（858–868 行）。
- 工作树 `docs/architecture/exam-runtime.md`：§3 命令表（340–353 行，`saveAnswer` 经 EA 锁序 + mutation context 锁内更新 draft answers）、§4.1–4.4 答案协议与提交冻结（359–458 行，尤其 421–427 行「Save 幂等：相同 clientSeq + baseVersion 的重复 save 不产生副作用；不触发评分、不写 submitted_answers、不改 attemptStatus」、445–457 行 Save After Submit / Save/Submit Race）。
- 工作树 `docs/architecture/exam-semantic-boundaries.md`：EXSEM-007（第 74 行，草稿答案只能经服务器版本/幂等/冲突检查协议接受；未被接受的本地输入不自动成为交卷答案）、EXSEM-008 / EXSEM-013 / EXSEM-014（75、80–81 行）、EXSEM-019（86 行）。
- 工作树 `docs/adr/ADR-025-http-request-correlation-identity.md` Decision 1–6 与 PR #924 diff 中的 **2026-11-08 Addendum（865-C x-request-id response header：header IS decision-1 的同一个 id，decisions 1–6 不变，非凭据）**。
- 契约：`packages/contracts/src/attempt.ts:50-58`（`SaveAnswerRejectReasonEnum` 七种 reason：STALE_VERSION / FUTURE_VERSION / ATTEMPT_ALREADY_SUBMITTED / ATTEMPT_CLOSED / DEADLINE_EXCEEDED / CONFLICTING_PAYLOAD / INVALID_ANSWER）、`:203-210`（`SaveAnswerRequestSchema`）、`:218-246`（`SaveAnswerAcceptedSchema`/`SaveAnswerRejectedSchema` 均 `.strict()`——200 body 里没有、也不能塞 requestId）、`:252-255`（discriminated union）、`:274-278`（`AnswerSaveReceiptSummarySchema`：receipt 只证明协议在服务端时刻接受了该 replay key，绝不证明内容正确或客户端收到 ACK）；`packages/db/src/schema/pg.ts:2235-2274`（`exam_answer_save_receipts` 联合主键 `(organizationId, attemptId, questionId, clientSeq)` + `client_seq>=0` CHECK + identity/legacyAnswer 互斥 CHECK + 随 attempt 级联删除）。
- 文档契约（PR #924 diff）：`docs/contracts/api-contract.md` §Standard response headers、`docs/contracts/observability.md`（#865 段落：header 是 server-owned 值、客户端遥测绝不升级为 server-verified）、`docs/operations/save-failure-evidence.md`（F2/F6、receipt / domain state / WARN 行 / envelope / client telemetry 五种证据的「能证明什么 / 不能证明什么」矩阵）。
- PR diff：`gh pr diff 924`（2915 行）与 `gh pr diff 923`（2110 行），输出到 `/tmp/pr924.diff`、`/tmp/pr923.diff` 并逐段阅读；另用 `git diff 8061d547..HEAD --stat` 核对 SaveAnswer 相关文件的改动面。

## 3. 已验证事实

### 3.1 clientSeq / answerIdentity / receipt / 幂等（引擎未被本轮改动）

- `packages/exam-engine/src/answerProtocol.ts:36-95`：`canonicalAnswerIdentity` 只对 **D1 写入边界已接受的 canonical 值**求 SHA-256（序列化对值域单射）；`:209-231` 已知 receipt 时：identity 相同 → `accepted:true` 原样回放、**零写入**；identity 不同 → `accepted:false / CONFLICTING_PAYLOAD`。`:238-265` `baseVersion < currentVersion` → `STALE_VERSION` 并回传 `latestAnswer`；`> currentVersion` → `FUTURE_VERSION`；`:267-287` 仅 `== currentVersion` 才产出 `newAnswer + newReceipt`。
- `answerProtocol.ts:402-487`：`saveAnswer` 在同一个事务 scoped repository 内先 `findAnswerReceipt(attemptId, questionId, clientSeq)`（`:430-434`），接受新答案时 `attemptRepo.update({answers,lastActivityAt})` + `appendAnswerReceipt(...)` **同一协议提交**（`:471-485`）；幂等回放与所有拒绝分支 **NO WRITE**；`:392` 断言 repo affinity（P2），`:396` 绑定 attemptId，`:414-421` 冻结题目成员合法性（P1）；`:445-460` deadline 决策使用 mutation context 的 canonical effective deadline 与 checkedAt（P3），不用 `attempt.deadlineAt` 或第二时钟。
- `apps/api/src/routes/attempts.candidate.ts:992-1104`：整段 save 在 `executeInTransaction` 内，经 `lockEnrollmentAndAttempt`（EA 锁序，`:1015-1019`）→ `prepareReconciledAttemptMutation`（canonical effective deadline + checkedAt，`:1058-1070`）→ `saveAnswer`（`:1090-1102`）；`:986` `fastify.now()` 为单一时间权威，客户端 `clientSavedAt` 不参与决策（EXSEM-007 成立）；`:1071-1074` 所有权检查。
- 并发下重复 `(attemptId, questionId, clientSeq)` 由 `pg.ts:2251-2258` 的联合主键兜底（两个并发同 key 接受不可能都提交 receipt，第二个违反 PK 并整体回滚）；不同题目的 save 通过 attempt 行锁串行化，各题 `clientSeq` 独立。

### 3.2 200 accepted:false 与 X-Request-Id / Pino / receipt 关联

- `apps/api/src/plugins/requestIdHeader.ts`（PR #924 新增，38 行）：root-scope `onRequest` hook 用 `reply.header("x-request-id", request.id)`，无第二个 id 被 mint；`server.ts:117-119` `genReqId: () => randomUUID()` + `requestIdHeader: false`（客户端头不影响），`:140` 在任何注册之前调用 `setupRequestIdHeader(app)`；`plugins/cors.ts` 用 `fp` 包裹并 `exposedHeaders: ["x-request-id"]`（只暴露给配置的 web origin，不扩大 origin 反射——由 wire-contract 测试断言）。
- `attempts.candidate.ts:1106-1149`：接受路径 `SaveAnswerAcceptedSchema.parse({accepted:true,serverVersion,savedAt})`；拒绝路径先打一条 `request.log.warn({organizationId, actorId, actorRole, attemptId, questionId, clientSeq, reason, serverVersion}, "Answer save rejected")`（`:1124-1138`，pino 自动带 `reqId`），再回 `SaveAnswerRejectedSchema.parse({accepted:false,reason,message,serverVersion,savedAt,details})`（`:1139-1149`）。两个 schema 均 `.strict()`，**200 body 里没有、也不能塞 requestId**；注释（1114–1123 行）明确这是「最大复用既有机制、不持久化、不改契约、不含答案内容」的 WARN，不是 durable refusal record（#861 决策框）。
- `apps/api/src/routes/attempts/requestIdSaveRejection.test.ts`（PR #924 新增 182 行）：用真实 PostgreSQL 状态产生**真实 STALE_VERSION 200 拒绝**，断言 `body.accepted===false`、`body` 无 `requestId`/`error`，且 **`entry.reqId === header`**（WARN 行的 reqId 等于 `x-request-id` 响应头），并断言 `entry.attemptId/questionId/clientSeq/reason` 一致；正对照用例断言 accepted save 也带 header。该测试已在本次复审实际运行通过（见 §4）。
- **关于 receipt 的准确边界**：receipt 只在 `accepted:true` 时写入（`answerProtocol.ts:471-485`；`AnswerSaveReceiptSummarySchema` 注释明确「zeros/nulls 表示无 accepted save receipts，绝不表示考生没保存」）。`accepted:false` **没有 receipt**，其关联是：响应头 `x-request-id` == Pino WARN 行 `reqId`，辅以 `attemptId + questionId + clientSeq + 时间窗`（`docs/operations/save-failure-evidence.md` F2/F6）。这是既有契约的有意设计，不是缺陷；证据文档明确「no match is an evidence gap (F6), never proof of non-arrival」。#924 后候选还可直接报拒绝 alert 的请求编号并按 id 检索 WARN 行（文档已同步）。
- `docs/contracts/observability.md` / ADR-025 Decision 5：客户端 telemetry 里的 `requestId` 仍是 **unverified client claim**；管理端时间线把它投影在「客户端声明，未经服务端核验」组下（`apps/api/src/lib/proctorMonitoringService.ts:144-170, 202-247`，`requestId` 还受 UUID 形状门控 `:211-236`）。PR #924 的 E2E M4（diff 881–1067 行）用真实 `CONFLICTING_PAYLOAD` 拒绝验证「真实响应头 id → 考生可见 请求编号 → 时间线未核验组」整条链，M5 验证传输层 abort 后任何表面都不出现 id。**这两个 E2E 用例本次独立复审未运行**（见 §4 末尾）。
- 请求 id 全状态/全 wire 证据：`requestIdWireContract.test.ts`（生产组合：genReqId + requestIdHeader:false + fp-cors + root hook + /api surface，真实 wire 监听）断言 UUIDv4 格式、200/400/404/HEAD 的 header==envelope==pino reqId、两次请求 id 不复用、伪造 `x-request-id`/`request-id`/`traceparent` 头零影响且不出现在服务端日志；`requestIdStatusMatrix.test.ts`（真实 DB fixture）断言 200/204/401/403/409/500 每条状态路径 header 存在且与 envelope 相等。

### 3.3 requestId 不被当成保存成功证明

- `apps/web/src/lib/api.ts`（PR #924）：`requestWithMeta` 仅在 `response.ok` 之后从**同一个 Response 对象**取 `meta.requestId = response.headers.get("x-request-id")`；非 2xx 仍 `throw await responseToApiError(response)`（envelope `requestId` 来自同一响应体）。Case D（diff `:232-268`）：header 与 envelope 不一致时只发一条有界 `logger.warn("api.request_id_correlation_mismatch")`（`telemetryRateLimit.ts` 固定窗口 5 次/60s，键 `api.request_id_correlation_mismatch`），**不把 header 值提升到 ApiError**；envelope 保持权威。
- `apps/web/src/pages/exam/TakeExamPage.tsx:915-931`：保存成功**只由 `result.accepted === true`（200 body）判定**；成功分支不读 `meta.requestId`（只清 `saveRejectionRequestId`），`answer_autosave_success` 遥测不含 requestId。`grep -n "requestId" TakeExamPage.tsx` 全部 14 处命中逐一核对：classifyWireFailure（156–167）、拒绝分支（972、983）、catch 分支（1028–1040）、heartbeat 分支（1239–1242，只写 server-fault 三元组）、1589/1620 两处**纯展示**；没有任何以 requestId 存在/匹配为条件置 `saveState:"saved"` 的路径。
- `TakeExamPage.tsx:934-965`（STALE_VERSION + serverAnswer 的 reconcile）：既有分支，#924 只加 `setSaveRejectionRequestId(null)`；测试「STALE_VERSION reconciliation is unchanged by a present header id」断言「有 header id 也不能把 reconcile 变成失败事实」，失败遥测 0、成功遥测 1 且无 requestId（本次运行通过）；`TakeExamPage.saveState.test.tsx` 还反向加固：header 存在时 reconcile 不得出现 rejection alert。
- `TakeExamPage.tsx:967-996`（普通拒绝）：`rejected=true` → `setSaveState("error")` + `save-rejection-alert` + `setSaveRejectionRequestId(meta.requestId)`（null 也覆写，`:970-972` 同点无条件写）+ `answer_autosave_failed` 带 `requestId`（仅当 header 存在，缺失则不伪造，`:980-984`）+ 抛错让队列记 failed；仅 `isTerminalSaveRejection` 触发一次权威快照 reconcile（`:993-995`）。三段式契约（transport→连接异常 / 5xx→服务器错误 / 4xx→都不声称）由 `classifyWireFailure`（`:156-167`）保持。

### 3.4 重试 / ACK 丢失（UNKNOWN）/ 多题并发 / 旧 attempt 迟到响应

- **重试**：`TakeExamPage.tsx:481-501` `retryFailedSaves` 只对 failed 题经**同一个** `saveAnswer → scheduleSave → flush` 编排重发，不建第二套实现；`clientSeq` 在 `:875-876` 每次调度递增、`baseVersion` 取 `versionsRef`，重试是「新 clientSeq + 当前已知版本」，不会重用已接受 key 造成 CONFLICTING_PAYLOAD。UI 测试「transport failure then online retry」断言两次 HTTP、两个不同 clientSeq、NETWORK 行无 requestId、成功行无 requestId（本次运行通过）。静态断言（同测试文件）`api.postWithMeta<SaveAnswerResponseDTO>` 恰好 1 处、`api.post<SaveAnswerResponseDTO>` 0 处——单一 save 实现面。
- **ACK 丢失 / UNKNOWN**：传输失败时没有响应可观察 → `classifyWireFailure` 给 `requestId:null`，任何表面不声称 id（M5 与 UI 测试均覆盖，本次运行通过 UI 侧）；服务端「请求到底有没有被接受」由 receipt / domain state 判定，找不到 receipt 只是 F6 证据缺口、不证明未到达。若其实已被接受，下一次 save 因本地 `baseVersion` 落后收到 `STALE_VERSION + serverAnswer`，客户端按既有 reconcile 采用服务器权威值——不伪造 ACK。
- **多题并发**：`apps/web/src/hooks/useSubmitFlush.ts:31-48, 130-173`：每题独立 `inflight` promise，同题串行（`previous.then(execute)`）、不同题并行；`questionGenerations` 防乱序状态写；`:287-310` scopeKey（attemptId）切换时清旧 scope 的 pending timer、保留旧 scope 让 in-flight 自然 settle、新 scope 空 maps。服务端每题 save 各自事务 + EA 锁 + receipt 主键，幂等不受并行影响。
- **旧 attempt 迟到响应**：`TakeExamPage.tsx:847-848, 850-856, 909-913, 1003-1005` 四处 `saveStale()`（schedule / debounce 后 / await 后 / catch 顶部）以 `scopeGenAtSchedule !== getScopeGeneration()` 阻断旧请求写新页面状态；`useSubmitFlush.ts:104-123` 旧 scope 的 status 写不泄漏到 `failedQuestionIds`；`:1100-1119`（页面侧 `runSubmitFlush`）attemptId+generation 双 stale 守卫。测试「an old attempt's delayed rejection (with header id) never writes the new attempt's state or telemetry」断言旧 att-1 迟到拒绝（含 header id）后新页面零污染（failed=0、success=0，本次运行通过）。
- **请求 id 与状态配对**：`:410-423` `saveRejectionRequestId` 与 `saveRejection` 同点无条件覆写（null 也清），与 `saveFaultRequestId`（heartbeat live-probe supersede 语义，`:404` 注释）是结构分离的两个 writer；「mixed sequence」（q1 有 id 拒绝 → q2 无 header 拒绝：alert 显示 q2 文案且无残留 id；两行遥测各带自己的观察）、「heartbeat never overwrites the save-rejection id」、「later successful save clears both」均覆盖并运行通过。

### 3.5 未扩大 SaveAnswer 业务状态/事务契约；并发与幂等仍成立

- `git diff 8061d547..HEAD --stat -- packages/contracts packages/exam-engine apps/api/src/routes/attempts.candidate.ts` 输出只有 4 个文件、441 行插入，全部是 #923 的 `clientEventRoute.ts` / `proctorMonitoring.ts`（6 行）/ 导出与测试；`packages/contracts/src/attempt.ts`、`packages/exam-engine/src/answerProtocol.ts`、`apps/api/src/routes/attempts.candidate.ts`（SaveAnswer route 本体）**自基线以来零改动**（`git log --oneline -5 -- <上述文件>` 亦确认最近一次触及是 #866）。
- #924 改动面：API 侧只有 `cors.ts`（fp + exposedHeaders）、新增 `requestIdHeader.ts`、`server.ts` 注册 hook、新增测试；Web 侧 `api.ts`（`requestWithMeta`/`postWithMeta`/`getWithMeta`、Case D 有界 warn）、`TakeExamPage.tsx`（+60 行：一个 state、meta 解构、三处 id 清写、alert 展示）、既有测试 mock 适配（`postWithMeta` 委托同一 `apiPost` mock，另加固一条 reconcile 负断言，无断言被放宽）、i18n 一条文案（`zh-CN.ts:682` `candidateRuntime.saveRejection.requestId`）、E2E M4/M5、ADR-025 附录与契约/运维文档。#923 是 client-event route 封闭模板投影（读写两侧 fail-closed 到 `null`、不解码百分号、拒绝非 http(s) scheme）与监控投影，**不触达 SaveAnswer 状态机、receipt、事务或 wire schema**。
- 未发现新增状态、新增 reason、新增持久化、新增「每请求 DB 写入」、成功 SaveAnswer 遥测写入或第二套 save 实现。EXSEM-007 / exam-runtime §4.3 的不变量全部保持。

## 4. 本次实际执行的检查（命令与输出）

> 以下均为**本次 ask 内**在 exact SHA clean 工作树执行的命令；DB-backed 测试使用仓库既有 `docker-compose.dev.yml` 本地依赖栈（`docker compose -f docker-compose.dev.yml ps`：`exam-dev-db-1` postgres:18.4 `Up 4 days (healthy)`、`exam-dev-redis-1` healthy），未创建/销毁任何新资源。

1. `cd …/packages/exam-engine && pnpm vitest run src/answerProtocol.test.ts src/saveAnswer.test.ts src/saveAnswerReceipts.test.ts` → `Test Files 3 passed (3) | Tests 55 passed (55)`；随后补跑 `pnpm vitest run src/saveAnswer.timingModes.test.ts` → `1 passed | 4 passed`（引擎合计 59）。
2. `cd …/apps/web && pnpm vitest run src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx` → `1 passed | 13 passed`；`pnpm vitest run src/hooks/useSubmitFlush.test.ts src/lib/api.test.ts` → `2 passed | 56 passed`（15 队列 + 41 api）。
3. `cd …/apps/api && pnpm vitest run src/routes/attempts/requestIdSaveRejection.test.ts src/routes/requestIdStatusMatrix.test.ts src/routes/requestIdWireContract.test.ts src/routes/requestIdRateLimit.test.ts`（真实 PostgreSQL / 真实 wire）→ `4 passed | 17 passed`（2+6+7+1+1；输出中 `reportDependentObjects` 为测试清理期既有非致命信息，全部文件 `✓`）。
4. `cd …/apps/api && pnpm vitest run src/routes/attempts/candidate-save-submit.test.ts src/routes/attempts/candidate-save-deadline-race.concurrency.test.ts src/orchestrators/saveAnswerReplayReceipts.test.ts src/routes/attempts/richAnswerProtocol.test.ts`（真实 PostgreSQL：save/submit 边界、EXAM-543 deadline 权威 vs 并发 closeAt 变更、回放 receipt、富答案协议）→ `4 passed | 59 passed`。
5. `cd …/apps/api && pnpm vitest run src/lib/proctorMonitoringService.test.ts src/routes/clientEvents.test.ts` → `2 passed | 46 passed`；`cd …/packages/contracts && pnpm vitest run src/__tests__/clientEventRoute.test.ts` → `1 passed | 60 passed`。
6. `grep -rn "getWithMeta" apps/web/src --include="*.ts*"`（排除 `*.test.*`）→ 仅 `apps/web/src/lib/api.ts:411,417`（定义与注释），**无生产调用者**；`postWithMeta` 生产调用者仅 `TakeExamPage.tsx:898` 一处。

定向套件合计 306 个用例全部通过（55+4+13+56+17+59+46+60）。

**未执行**（如实声明，不声称通过）：`pnpm verify`、`pnpm test`（turbo 全量）、`bash scripts/e2e/run.sh` / `pnpm e2e`（含 E2E M4/M5）、`pnpm verify:static`、typecheck / lint / format:check、build 等全量门禁——本独立复审按 SPEC §7 Subagent B 的证据需要只运行了上面列出的定向套件；定向测试不等于全量门禁。

## 5. 发现（已确认问题）

无 P0/P1/P2。以下 2 项为 **low / P3 观察**，均已从 exact SHA 复核，不构成本轮引入的缺陷，不需要最小修复即可 GO。

1. **【low，非本轮引入】STALE_VERSION reconcile 分支发出 `answer_autosave_success`（`saveMode: "stale_reconcile"`）遥测**：`TakeExamPage.tsx:934-965`（事件在 956–963 行）在服务器拒绝本次 save、客户端改用服务器权威答案后记为"成功"。证据：PR #924 diff 941–955 行显示该 `trackExamEvent` 是未改的上下文行；本次运行的 UI 测试「STALE_VERSION reconciliation is unchanged…」断言失败遥测 0、成功遥测 1 且无 requestId。语义上它表示"与服务器权威值已对账"（`versionsRef` 更新、答案被替换为 `serverAnswer`），并非伪造服务端 ACK；事件名是既有命名选择，调查者需靠 `saveMode` 区分。**复现**：读 `TakeExamPage.tsx:934-965` 或运行该测试文件同名用例。**最小修复**：无需；若未来收紧遥测语义可考虑事件改名 `answer_reconciled`（超出本轮范围，须单独授权）。风险：仅调查语义精度，不影响产品正确性。
2. **【low，证据组合边界】Save 路由的相关性测试手动注册 hook，未直接执行生产 `server.ts` 组合**：`requestIdSaveRejection.test.ts` 用 `buildTestApp(combinedPlugin)` 显式 `setupRequestIdHeader(fastify)`（文件头注释自述）；生产 wiring（`genReqId`/`requestIdHeader:false`/hook/CORS/apiSurface）由 `requestIdWireContract.test.ts` 另行手工拼装（生产组合、真实 wire），没有任何单个测试调用 `server.ts main()` 后再打 SaveAnswer 路由。**复现**：读上述两份测试的 `beforeAll`；本次两文件均运行通过。**最小修复**：无需；`server.ts:117-140` 的静态接线 + wire-contract 测试的组合证据已覆盖同一事实（header 是 `request.id`，每个请求路径都经过 root-scope hook）。风险：若未来 `server.ts` 注册顺序被改，现有测试组合仍可能全绿——建议后续 CI 层补一个 boot 级 smoke（非本轮门禁）。

## 6. 观察（非缺陷，记录以免被误读）

- `api.getWithMeta` 无生产调用者，但 `api.ts:410-416` 与 `docs/contracts/observability.md` 明确标注为 documented forward surface（read-side counterpart，契约由 `api.test.ts` 钉住），不是意外死代码；是否保留属 Subagent D 的冗余审阅范围。
- 200 `accepted:false` 的 body **故意不含 requestId**（`SaveAnswerRejectedSchema.strict()`），唯一客户端可见载体是响应头；运维文档已写明「before/alongside that, correlate F2 by attemptId + questionId + clientSeq + 时间」。receipt 只存在于 accepted 侧——这是 #861/#866 的既有设计，非本轮新增缺口。
- WARN 行不含答案内容、无 durable refusal record（#861 决策框的必要性/写放大论证失败），因此「服务器拒绝过」可 grep，但「考生 UI 显示了什么 / 30 天以外的历史」仍只能靠客户端声明与 receipt/domain state 联合推断。
- ADR-025 Decision 5 与 `proctorMonitoringService.ts:152-161` 的 TRUST 注释一致：时间线里所有 `requestId` 都是客户端声明，调查者须用服务器自身 request log 确认（0 匹配 = 证据缺口，多个匹配 = AMBIGUOUS）；投影层 UUID 形状门控保证该字段不被用作内容注入槽。
- 非载体边界（连接中途销毁、socket framing 失败、Node 超时、router lookup 前的 `FST_ERR_BAD_URL`）由 `requestIdHeader.ts` 注释与运维文档声明为 transport boundary，服务端日志仍按同一 id 键控。

## 7. 未知边界（诚实声明）

- 未运行 E2E（M4/M5）、全量 `pnpm verify` / `pnpm test` / `pnpm e2e` / typecheck / lint / format / build：本复审的通过结论限于 §4 列出的定向套件与静态/契约证据，**不声称全量门禁通过**。
- 未阅读其它三位 Subagent 的评审文档或结论（§7.1 独立性要求）；未审 #922 / #926 的完整内容（仅确认其合并存在及 `server.ts`/`errors.ts` 的少量 diff stat），其安全/日志边界由 Subagent A 负责。
- 未对 `docs/adr/ADR-006`、`ADR-012`、`ADR-026` 全文逐字审读；本复审引用的时间权威、恢复契约、client-event 证据边界来自 `exam-runtime.md`、代码注释、`answerProtocol.ts:142-148`、ADR-025 Decision 5 与运维文档中的对应条款。
- 未在真实浏览器/多进程/多 API 实例下重放并发；多题并发结论基于 `useSubmitFlush.ts` 的 per-question inflight/scope 设计、EA 行锁、`exam_answer_save_receipts` 联合主键与本次运行的并发/回放 PostgreSQL 测试。
- 非载体边界的故障注入（连接销毁等）本次未执行，依赖文档与注释声明。

## 8. 结论

**GO**。在 exact SHA `0b2e2d8a1653ebba59326517ec2fdc6b4c7cf4bc` 上：

- 200 `accepted:false` 可通过 `x-request-id`（== `request.id` == pino WARN 行 `reqId`，并辅以 attemptId/questionId/clientSeq/时间）关联；receipt 关联仅存在于 accepted 侧（既有设计）。`requestId` 在成功路径、成功遥测、reconcile 路径均不被当作保存成功证明，客户端声明也不升级为服务端事实。
- 未新增伪造业务成功或错误失败：成功仍只由 `result.accepted===true` 判定；拒绝仍 `saveState:"error"` + rejection alert + failed telemetry + 队列 failed；header 缺失、transport 失败、成功遥测三处均有「不伪造 id」断言（本次运行通过）。
- SaveAnswer 的业务状态/事务契约未被扩大：engine、route、wire schema 自基线 `8061d547` 起零改动；#923/#924 只加了响应头载体、opt-in 客户端元数据和只读投影。
- 并发与幂等仍成立：同题串行、异题并行、scope generation 隔离旧 attempt 迟到响应、EA 锁 + receipt 联合主键保证「相同 clientSeq+canonical identity 零副作用写入 / 不同 identity CONFLICTING_PAYLOAD / 版本落后 STALE_VERSION / ACK 丢失走 F6 UNKNOWN 与权威值 reconcile」。
