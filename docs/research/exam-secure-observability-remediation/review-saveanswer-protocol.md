# Independent Review — SaveAnswer Protocol & Concurrency（契约 §7.1 Subagent B）

- **Role**: SaveAnswer Protocol & Concurrency（独立评审，未参考其他评审结论）
- **Reviewed SHA（integration HEAD）**: `5d4b2773cf62f93e40fa5661e0d5e19700f40b17`（integration-final worktree，clean）
- **Frozen master baseline**: `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d`
- **Combined diff**: `git -C /home/hoo/Source/exam-gap-worktrees/integration-final diff 5140c3dd0f9dbde1bdad8f5b757161f3ed96945d..HEAD`
- **Reviewer date**: 2026-11-09
- **Verdict**: **PASS**（0 P0/P1/P2；3 条 P3 观察 + 1 条建议补测试；§3.7 七项业务门禁全部满足）

---

## 1. Reviewed files

组合 diff 中与本角色相关的全部改动面（其余 diff 文件——nginx/日志隐私/retention/文档归档——仅在与 SaveAnswer 交叉处审阅）：

| 文件 | 改动 | 与本角色关系 |
| --- | --- | --- |
| `apps/web/src/pages/exam/TakeExamPage.tsx` | +60/−? | 保存主链路：`postWithMeta` 接入、`saveRejectionRequestId` 状态、telemetry requestId、alert 渲染 |
| `apps/web/src/lib/api.ts` | +109 | `requestWithMeta` 核心、`postWithMeta/getWithMeta`、错误路径 `headerRequestId` 捕获与 mismatch 有界 warn |
| `apps/web/src/i18n/locales/zh-CN.ts` | +4 | `candidateRuntime.saveRejection.requestId` 文案 |
| `apps/api/src/plugins/requestIdHeader.ts` | 新增 38 行 | root-scope onRequest 钩子，`x-request-id = request.id` |
| `apps/api/src/plugins/cors.ts` | +21/−3 | fp 包裹 + `exposedHeaders: ["x-request-id"]`（跨域可读性） |
| `apps/api/src/server.ts` | +29/−? | 钩子注册点、req serializer |
| `apps/web/src/lib/examTelemetry.ts` / `useSubmitFlush.ts` / `packages/contracts/src/attempt.ts` / `apps/api/src/routes/attempts.candidate.ts` / `packages/exam-engine/**` | **不在 diff 中** | 保存协议权威（clientSeq/answerIdentity/receipt/reconcile）结构性未动——这是本轮最重要的负面事实，经 diff stat 核实 |
| 新测试 | — | `TakeExamPage.saveRejectionRequestId.test.tsx`(757 行)、`attempts/requestIdSaveRejection.test.ts`、`requestIdWireContract/StatusMatrix/RateLimit.test.ts`、`api.test.ts`(+218)、E2E `investigation-ui-acceptance.spec.ts` M4/M5 |

## 2. Threat / invariant coverage（§7.3 对抗性覆盖记录）

### 2.1 正常路径（Case A，accepted:true）
- 代码：`TakeExamPage.tsx:915-931` —— 成功分支不捕获 requestId、不新增含 id 的成功事件（`meta` 变量被丢弃）；`versionsRef` 更新 `serverVersion`；同时清空 rejection 两个状态。
- 运行证据：`requestIdSaveRejection.test.ts` "accepted save carries the x-request-id header too (positive control)" 通过（真实 PostgreSQL）；`TakeExamPage.saveRejectionRequestId.test.tsx` 两处断言成功 telemetry `not.toHaveProperty("requestId")`（`saveRejectionRequestId.test.tsx:681-683` 及 `:569-571`）。
- 判定：PASS——无 NEW_SUCCESS_TELEMETRY_WRITES，requestId 未被当作保存成功证据。

### 2.2 错误路径
- **200 accepted:false 带 header**（Case B）：`TakeExamPage.tsx:967-987` —— `setSaveRejectionRequestId(meta.requestId)` 与 `setSaveRejection(result)` 同点同写；telemetry `errorCode=result.reason` + `...(meta.requestId ? {requestId} : {})`，无 header 时省略（不伪造）。测试 `:263-300`、`:332-360` 通过。
- **200 accepted:false 无 header**：测试 `:302-330` 通过——alert 无「请求编号」占位，telemetry 无 requestId 键。
- **STALE_VERSION + serverAnswer**（Case C）：`TakeExamPage.tsx:934-964` —— reconcile 分支先于 rejection 分支判断，`details.serverAnswer` 覆盖本地答案、更新 `serverVersion`、emit `saveMode:"stale_reconcile"` 成功事件、**零失败 telemetry**、清空 rejection 对（`:951-952`）。requestId 不参与内容比较。测试 `:362-425` 通过。
- **HTTP 401/403**（Case D 子集）：`classifyWireFailure`（`TakeExamPage.tsx:156-167`）promote 信封 `apiError.requestId`；4xx 不设 connectivity/server-fault；telemetry 带 `status`+`requestId`（信封）。测试 `:427-510` 通过。
- **HTTP 500**：真实 DB 测试 `requestIdStatusMatrix.test.ts` "500 thrown handler: header present on the unified error response" 通过；信封与 header 同源（`errors.ts:98-138` 全部用 `request.id`；`requestIdHeader.ts:31-36` 同样用 `request.id`）——直连拓扑下两载体恒相等，mismatch 只可能来自中间人改写，正是 `api.ts:246-263` 有界 warn 的对象。
- **Transport / ACK 丢失**（Case E）：`api.ts:344-365` 网络层失败构造 `ApiError(0)`，无任何 header 可读；`classifyWireFailure` transport 分支 `requestId=null`；telemetry `errorCode:"NETWORK"` 无 requestId 键。测试 `:512-572`（含重试后两 HTTP 尝试、独立 clientSeq）与 E2E M5（实现方归档证据，本评审未重跑）。
- 判定：六类结果区分正确，无虚假失败、无 200→500 误分类、无伪造 id。

### 2.3 并发或生命周期边界
- **旧 attempt 迟到响应**（Case F）：三重守卫——(1) debounce 期内 route change 由 `useSubmitFlush.ts:293-310` useLayoutEffect 清除旧 scope pending 定时器；(2) 执行时 `saveStale()`（`TakeExamPage.tsx:855-857`）；(3) post-await `saveStale()`（`:911-913`，在**所有**状态写之前，含 rejection 对）与 catch 顶部守卫（`:1003-1005`）。运行证据：测试 `:574-633`（att-1 延迟 rejection 带 id 在 att-2 页面零写入：无 alert、无 telemetry 行）通过。
- **同题并发/串行**：`useSubmitFlush.ts:130-173` per-question inflight 链式串行——同 scope 同题永不并发两个 HTTP 请求，requestId 不会跨请求复用；跨 scope 由 scope generation 隔离。文件未在本 diff 中改动。
- **debounce 合并**：`scheduleSave`（`useSubmitFlush.ts:186-212`）后写覆盖前写，仅最后一次编辑的闭包 `answer` 发出；clientSeq 在执行时自增（`TakeExamPage.tsx:874-876`，与 master 逐行相同）。
- **retry/flush**：`retryFailedSaves`（`:488-501`）复用同一 `saveAnswer` 编排；测试 `:744-756` 静态断言单一保存实现（`postWithMeta` 1 处、无第二 `api.post<SaveAnswerResponseDTO>`）通过。
- **TOCTOU 窗口**：post-await 守卫（`:911`）与 rejection 对写入（`:969-972`）之间为同一同步微任务段，scope 切换（useLayoutEffect，commit 阶段）无法插入——无竞态窗口（代码论证）。
- 判定：STALE_ATTEMPT_ISOLATION = PASS。

### 2.4 跨权限边界
- requestId 不构成任何凭据：全仓无任何端点接受 requestId 作为查询参数；它是浏览器观察到的响应头值，读取端仅 `projectSafeMetadata` allowlist 投影（`proctorMonitoringService.ts:162-197, 206-228`，`requestId` 自 #800/#860 起已在 allowlist，master 上已存在——经 `git show 5140c3dd:...proctorMonitoringService.ts` 核实）。
- 伪造面：考生可在**自己的** client_events 里伪造 `answer_autosave_failed.requestId` 指向任意字符串，但 timeline 渲染受「客户端声明，未经服务端核验」标签约束（#860 PR-T 既有信任定位，E2E M4 断言该标签），且行维度绑定本人 attempt——无跨租户查询能力、无提升。属既接受姿态，非本轮引入。
- 运行证据：`requestIdRateLimit.test.ts`（429 也带 header==信封 id）通过；实现方 live 矩阵 T07a/b/c（404/401/403 越权负例、零 DB 写、信封 requestId 正常）——`raw/saveanswer-matrix.md` 读得。
- 判定：requestId 未扩大任何访问面。

### 2.5 现有测试尚未充分覆盖的反例
见 Finding 4（heartbeat/断网三步交错下 rejection id 对的存续与重现无测试钉住）与 Finding 1（跨题成功清除 alert 的交错）。

## 3. Concrete findings

> 严重度分级：P0 阻断 / P2 应修 / P3 观察或后续。本轮 **0 P0、0 P1、0 P2**。

### Finding 1 — 跨题成功保存会清除另一题仍在生效的 rejection alert 及其请求编号（既有语义，非本轮回归）
- **位置**: `apps/web/src/pages/exam/TakeExamPage.tsx:915-922`（accepted 分支无条件 `setSaveRejection(null)` + `setSaveRejectionRequestId(null)`）。
- **问题**: q2 的 200 rejection（alert+id=q2）展示期间，q1 一笔更晚落地的 accepted 保存会清掉整个 rejection 对——q2 的拒绝事实从 alert 面消失。失败**并未漏报**：per-question 队列的 `failedQuestionIds` 驱动的重试 banner（`:1646-1670`）仍然展示 q2 失败并可重试；且 id 与 copy 永远成对清除，不产生「q2 文案配 q1 编号」的错配（新状态的 INVARIANT 声明在所有交错下成立，两状态唯一写入点 `:969-972` 同步成对写入）。
- **Reproduction**: 代码推演 + master 对照——master `git show 5140c3dd:apps/web/src/pages/exam/TakeExamPage.tsx` 第 ~908 行 accepted 分支同样清 `setSaveRejection(null)`；本轮只是让 id 搭乘同一生命周期。未编写复现测试（交错依赖两题并发落地顺序）。
- **Severity**: P3（UI 瞬时性，既有行为；非 requestId 引入的不一致）。
- **标签**: CONFIRMED（代码级；行为等价性经 master 对照确认）。
- **Proposed minimal fix**（后续 follow-up，不属本轮 scope）: accepted 分支仅当 `questionId` 与当前 `saveRejection` 所属题目一致时清除 rejection 对；或把 rejection alert 迁移为 per-question 展示。需先定义「alert 属于哪道题」的产品语义再动。

### Finding 2 — 断网期间 rejection alert（连同可读的请求编号）整体隐藏（既有渲染门）
- **位置**: `TakeExamPage.tsx:1571-1572`（`saveRejection && !isDisconnected && ...`）；master 第 1543-1544 行同门。
- **问题**: q1 rejection（含编号）展示后若发生 transport 失败（q2 保存或 heartbeat 置 `isDisconnected=true`），alert 暂时不可见；连接恢复（heartbeat 成功 `:1201`）后原样重现（id 对未被 heartbeat 触碰——heartbeat 只写 `saveFaultRequestId`，`:1203/:1242`）。编号短暂不可读，但状态无损、恢复后一致。
- **Reproduction**: 代码级（渲染条件 + heartbeat 写点清单 grep：`setSaveRejectionRequestId` 全仓仅 4 个写入点 `:737/:922/:952/:972`，均非 heartbeat）。未运行浏览器复现。
- **Severity**: P3（UX 边缘；契约 §3.4「考生能取得编号」在连接正常时成立，E2E M4 已证）。
- **标签**: CONFIRMED（代码级；门条件与 master 逐字相同——回归面为零）。
- **Proposed minimal fix**: 无需本轮处理；若要改善，可考虑 `!isDisconnected` 门只作用于 connectivity/server-fault alert 的排布而非隐藏 rejection 事实（属 UI 语义调整，建议独立 Issue）。

### Finding 3 — `getWithMeta` 无生产调用方；`ApiError.headerRequestId` 无生产消费方（受控的最小多余面）
- **位置**: `apps/web/src/lib/api.ts:416-424`（getWithMeta 仅测试调用）；`api.ts:205,281`（headerRequestId 仅 `api.test.ts` 断言）。
- **问题**: 两个无调用者的公开面。设计注释表明 getWithMeta 是「callers opt in as needed」的预留、headerRequestId 是「captured for diagnostics only」的记录事实（mismatch warn 才是事实的消费点 `api.ts:255-263`）。不构成行为风险，仅是最小性(KISS)层面的冗余。
- **Reproduction**: `grep -rn "getWithMeta\|headerRequestId" apps/web/src --include="*.ts" --include="*.tsx" | grep -v test` → 仅 api.ts 定义处。
- **Severity**: P3。
- **标签**: CONFIRMED。
- **Proposed minimal fix**: 二选一——删除 `getWithMeta` 直至出现真实调用方（最小改动），或在注释中显式标注「reserved, no caller yet」。属架构角色裁量，不阻断协议裁决。

### Finding 4 — 建议补测试：rejection id 对在「断网→heartbeat 恢复」交错下的存续无测试钉住
- **位置**: 覆盖缺口在 `TakeExamPage.saveRejectionRequestId.test.tsx`（现有 11 例未含此三步序列）。
- **问题**: 契约 §3.4 明确「不因 Heartbeat 的 requestId 覆盖一次 SaveAnswer 的拒绝 ID」。当前由代码结构保证（heartbeat 仅写 `saveFaultRequestId`），并有 M3（save-fault banner 与 heartbeat live-probe supersede）覆盖 fault 侧，但「q1 rejection(id) → q2 transport fail（isDisconnected 隐藏 alert）→ heartbeat 成功」这一序列后 alert+id 原样重现、且 heartbeat 的成功路径（`:1203` 清 saveFaultRequestId）不触碰 rejection 对——无测试钉住。若未来有人在 heartbeat 恢复路径里加「清一切失败提示」，该契约将无声破坏。
- **Reproduction**: 代码推演（写点清单）；未编写新测试（本评审只读，不改仓库文件）。
- **Severity**: P3（测试缺口，非缺陷）。
- **标签**: INFERRED（行为正确性由代码推演得出，未执行复现）。
- **Proposed minimal fix**: 在 `TakeExamPage.saveRejectionRequestId.test.tsx` 增加一例：rejection 带_id → 第二题 transport 失败 → heartbeat mock 成功 → 断言 alert 重现且编号不变、`saveFaultRequestId` 面清空。

### 附：主动寻找但**未成立**的反例（记录为 NOT_REPRODUCED / 排除依据）
1. ** poisoned header 撑爆 telemetry batch**（假设：恶意中间人注入超长 x-request-id → metadata 超 32KiB → 整批 client_events 400 → 失败漏报）：NOT_REPRODUCED-排除——HTTP 头受 Node ~16KiB 帧上限约束，`answer_autosave_failed` 其余字段极小，总量不可能超过 `CLIENT_EVENT_METADATA_MAX_BYTES = 32*1024`（`packages/contracts/src/clientEvent.ts:24`）；且值仅是 client-claimed 字符串，读取端 allowlist 原样放行 string（`proctorMonitoringService.ts:214-226`），无权威提升。
2. **200 响应体 JSON 解析失败被误分类为 NETWORK/断网**：与 master `request()` 逐行为等价（`api.ts:311-366` 的 catch 形状未变，`request` 现为薄包裹 `:369-372`），非本轮引入；服务端 200 必为合法 envelope（contract zod 序列化）。
3. **同一 rejection 被重复计费 telemetry（重复行）**：rejection 分支 throw 后自身 catch 的 `if (!rejected)` 守卫（`:1008`）确保单行；测试 `:293-294` 断言 `toHaveLength(1)`。
4. **requestId 跨 attempt 残留**：render-phase 重置（`:736-737`）+ 作用域守卫 + 测试 `:574-633` 三重覆盖。
5. **mismatch warn 泄入监考 timeline**：事件名 `api.request_id_correlation_mismatch` 不在 `SAFE_METADATA_ALLOWLIST`（`proctorMonitoringService.ts:183-197`）→ 投影为 `{}`（default-deny），且 kind:"log" 无 attemptId 维度——代码级排除。

## 4. 本评审实际执行的检查（命令与结果）

| # | 命令（在 integration-final worktree 执行） | 结果 |
| --- | --- | --- |
| 1 | `pnpm --filter @exam/web exec vitest run src/lib/api.test.ts` | 41/41 通过 |
| 2 | `pnpm --filter @exam/web exec vitest run src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx` | 11/11 通过 |
| 3 | `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=1 pnpm --filter @exam/api exec vitest run src/routes/attempts/requestIdSaveRejection.test.ts` | 2/2 通过（首次因 run lease `exam_test_worker_database_run` 被并发 run 持有而 fail-closed 拒绝；等待 90s 重试通过——fail-closed 保护按 testing.md §2.8 工作） |
| 4 | `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=1 pnpm --filter @exam/api exec vitest run src/routes/requestIdWireContract.test.ts src/routes/requestIdStatusMatrix.test.ts src/routes/requestIdRateLimit.test.ts` | 15/15 通过 |
| 5 | `pnpm --filter @exam/web exec vitest run src/hooks/useSubmitFlush.test.ts src/pages/exam/TakeExamPage.saveState.test.tsx src/pages/exam/TakeExamPage.saveFault.test.tsx` | 29/29 通过 |

**未执行（如实声明）**：
- E2E `investigation-ui-acceptance.spec.ts`（M4/M5）：需 `bash scripts/e2e/run.sh` 全链路+Docker，本轮评审未重跑；M4/M5 的实现方归档证据（本证据库内 spec 源码 + 实现方报告）已被通读，其断言与我的代码级结论一致。
- `TakeExamPage.reconcile/restore/lockOverlay/snapshot` 四个页面测试文件：属于本会话中被用户拒绝的 7 文件批量命令的一部分，未单独重跑；其覆盖面与本次改动的交集（reconcile 分支）已由第 2 项的 STALE_VERSION 用例（`:362-425`）运行覆盖。
- `pnpm verify` / 全量套件：超出评审范围。
- DB 对象检查：仅以只读 `psql` 查看 `pg_stat_activity`（确认 lease 争用场景），未写任何数据；未触碰 `exam` 开发库。

## 5. 契约 §3.7 门禁复核

| 门禁 | 判定 | 依据 |
| --- | --- | --- |
| SAVEANSWER_RECEIPT_SEMANTICS = UNCHANGED | PASS | `attempts.candidate.ts`、`exam-engine/answerProtocol.ts`、`contracts/attempt.ts` 均不在组合 diff（diff stat 核实）；实现方 live 矩阵 T02/T08/T10（receipt 幂等/并发单行/ACK 丢失仍提交）与代码一致 |
| CLIENT_SEQ_SEMANTICS = UNCHANGED | PASS | 客户端 `TakeExamPage.tsx:874-876` 与 master 逐行相同；服务端未动 |
| ANSWER_IDENTITY_SEMANTICS = UNCHANGED | PASS | 未动；requestId 不参与内容比较（reconcile 分支 `:934-964` 无 id 参与） |
| RETRY_SEMANTICS = UNCHANGED | PASS | retry 复用单一编排；静态断言测试通过（§2.3） |
| STALE_ATTEMPT_ISOLATION = PASS | PASS | 三重守卫 + 测试 `:574-633` 实跑通过 |
| FALSE_FAILURE_TELEMETRY = 0 | PASS | reconcile 走 success(stale_reconcile)、零 failed 行（`:362-425` 实跑）；skip 分支不伪造（`:862-871` 无 id 参与） |
| REJECTION_REQUEST_ID_CORRELATION = PASS | PASS | 真实 DB 测试：header == `Answer save rejected` WARN reqId（实跑）；CORS expose + nginx 透传（`deploy/nginx/web.conf:72-94` 无 hide_header、无自铸 id）链路完整 |

## 6. Remaining uncertainty

1. **E2E 未独立重跑**：M4/M5 的浏览器级证据取自实现方归档；本评审以组件级实跑 + 代码审阅交叉验证。置信度高，但非本评审者亲手浏览器复现。
2. **中间人拓扑**：`x-request-id` 透传仅在随附 `deploy/nginx/web.conf` 形态下核实；外部反代/HTTPS 激活形态（conf 内注释块）未实机验证。任何改写该头的中间层都会让浏览器观察值偏离服务端事实——代码已以 client-claimed 定位 + mismatch 有界 warn 兜住语义，但部署侧仍需按 runbook 不改写该头。
3. **多标签同 attempt 并发**（两 tab 各自 clientSeq 计数器 → 服务端 CONFLICTING_PAYLOAD 路径）：既有可能性未新增测试；该域本轮零改动，风险敞口不变。
4. **Finding 4 的交错行为**为代码推演（INFERRED），未运行复现。
5. 本评审只读约束下未能在仓库内新增验证测试；Finding 4 的建议用例需由施工方落地。

## 7. Verdict

**PROTOCOL_REVIEW = PASS**

requestId 引入未产生任何「UI/telemetry/保存事实」三者不一致的新路径：六类结果区分正确；rejection id 与 rejection 事实在所有写入/清除点严格成对；heartbeat、跨 attempt、并发、ACK 丢失各边界均有守卫且关键者有实跑测试；保存协议四要素（clientSeq/answerIdentity/baseVersion/receipt）与服务端判定链结构性未动。3 条 P3 观察（两条为 master 既有 UI 语义、一条为最小性裁量）+ 1 条补测试建议，均不构成本轮阻断项。

---

## 编纂补记（2026-11-09；评审正文未改动）

- **运行环境（宿主实测）**：WSL2 Linux 6.18.54.1-microsoft-standard-WSL2；Node
  v24.22.1；pnpm 11.1.2；PostgreSQL 18.4（`exam-dev-db-1`）。评审命令在
  `integration-final` worktree 执行。
- **SHA 追溯**：评审对象是 `5d4b2773`。其后的 review-fix：`e81b76a1` 补了
  Finding 4 建议的两条 heartbeat/rejection 交错负例，并按 ARCH-DUP 删除了
  未消费的 `ApiError.headerRequestId`（`getWithMeta` 改为文档化前瞻面）；
  `d3580f3e` 加 requestId 形状 gate；`1dd4d206` 为 #926 配方。最终集成
  `a84b416a`，本评审结论未在最终 SHA 重跑。
- Finding 1/2 属 master 既有 UI 语义，已列为 follow-up（见
  `FINAL-OWNER-DECISIONS.md` §5）。
- **结论可信度**：高——协议四要素 diff 为空、关键分支逐文件实跑；浏览器 E2E
  未由评审者独立重跑（正文已声明）。

---

## 8. Recheck 附录（§7.4 修复轮复核，2026-11-09）

- **Recheck SHA**：`3e97c4977ca4e5f8b3fe30f4adeddb39269b8981`（fix 轮集成 HEAD；worktree 实际 HEAD 为其上多一个无关 e2e 提交 `1f644725`，仅触及 `apps/e2e/e2e/rich-content-overflow.spec.ts`，与本四项无关——`git show --stat 1f644725` 核实）。代码读取用 `git show 3e97c497:<file>` 定位 exact SHA；测试在含该 SHA 的工作树上运行。
- 修复提交：`1dd4d206`（#926 ops F1/F2）、`d3580f3e`（#923 security F2 shape-gate）、`3e97c497`（fixture 对齐）、`e81b76a1`（#924 protocol F3/F4 + security F3）。

### 逐项复核

1. **HTTPS Mode B 配方（ops F1+F2 → #926）— RESOLVED**。`git show 3e97c497:deploy/nginx/web.conf`（80 server 内指引块）：`location = /healthz { return 200; }` 豁免 + `location / { return 301 https://$host$request_uri; }` catch-all 重定向，并明确说明 server-level return 301 先于 location 匹配不可用；`docker-compose.yml` healthcheck 改探 `/healthz`（一行，带注释）；`docs/deployment/README.md` Mode B 增补 80 端口强制处置清单（301+豁免或网络层封堵）；`nginxWebConf.test.ts` 新增 2 pin（指引配方含豁免、compose 探测路径）。实跑：`TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=1 pnpm --filter @exam/api exec vitest run … src/nginxWebConf.test.ts …` → 7/7 通过（含 2 新 pin）。注：commit 声称的 nginx:1.30.5 一次性容器 live 验证未由本评审重跑（静态 pin+配置读取核实）。
2. **requestId 形状 gate（security F2 → #923）— RESOLVED**。`d3580f3e`：`proctorMonitoringService.ts` 新增 `REQUEST_ID_UUID_SHAPE` 正则，`projectSafeMetadata` 对 `requestId` 键仅投影 well-formed UUID 字符串（prose/超长/嵌 UUID 文本/非字符串一律丢弃）；字段仍为 client-claimed 定位（注释明示 gate 限制内容注入、不验证身份）。新增 shape-gate 测试 5 组负例/正例；`3e97c497` 将 crossOrg 集成测试与 E2E M4 的伪造 requestId fixture 对齐为 UUID 形状（保持「伪造但形状合法仍投影、垃圾不投影」的测试意图）。实跑：`proctorMonitoringService.test.ts` 21/21、`proctorMonitoring.crossOrg.test.ts` 7/7 通过。
3. **api.ts 无消费面（protocol F3 合并 → #924）— RESOLVED（采用处置建议的推荐项）**。`e81b76a1`：`ApiError.headerRequestId` 第 7 构造参数与属性整体删除，Case D mismatch 有界 warn 保留（header 值改为 `responseToApiError` 局部变量）；`getWithMeta` 保留并在 `api.ts` 注释 + `docs/contracts/observability.md` 显式文档化为「documented forward surface, no production caller yet, delete only together with that contract note」。`api.test.ts` 同步移除 `headerRequestId` 断言（mismatch warn 断言保留）。实跑：`pnpm --filter @exam/web exec vitest run src/lib/api.test.ts …` → 41/41 通过；grep 确认 `headerRequestId` 生产代码零命中。
4. **heartbeat×rejection §3.4 契约测试钉（protocol F4 合并 security F3 → #924）— RESOLVED**。`e81b76a1` 新增 describe「heartbeat never overwrites the save-rejection id」两例：(a) heartbeat 5xx 携自己的信封 id 更新 server-fault banner（断言 banner 含 `错误编号：req-hb-500` 且不含 rejection id），恢复后 rejection alert 原样重现且不含 heartbeat id；(b) rejection(带id) → 保存路径 transport 失败（isDisconnected 隐藏 alert）→ 恢复仅清 fault 三件套，alert+编号原样重现、全程无 错误编号，telemetry 行各自只带自己的观察（rejection 行带 id、transport/4xx 行无 id）。我的原始三步序列（保存侧断连+heartbeat 恢复的 literal 交叉）被拆为两例互补覆盖（断连源=heartbeat/保存，恢复源=heartbeat/online），两个状态机写点共享，方向性断言双向钉住契约。实跑：`TakeExamPage.saveRejectionRequestId.test.tsx` 13/13（11→13）通过。commit 声称的 M1/M2 反事实（改坏即红）未由本评审重放（需改工作树）；断言的方向性经通读判定为真实钉住而非同义反复。

### 复核运行汇总

| 命令（integration-final worktree，含 3e97c497） | 结果 |
| --- | --- |
| `pnpm --filter @exam/web exec vitest run src/lib/api.test.ts src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx` | 54/54 通过 |
| `TEST_DB_ISOLATION=worker-database API_TEST_MAX_WORKERS=1 pnpm --filter @exam/api exec vitest run src/lib/proctorMonitoringService.test.ts src/routes/proctorMonitoring.crossOrg.test.ts src/nginxWebConf.test.ts src/routes/attempts/requestIdSaveRejection.test.ts src/routes/requestIdWireContract.test.ts src/routes/requestIdStatusMatrix.test.ts src/routes/requestIdRateLimit.test.ts` | 52/52 通过（worker-database 隔离，本轮无 lease 争用） |

未重跑：nginx live 容器验证、E2e 全链路、M1/M2 反事实变异（原因如上）。第一轮回归面（requestIdSaveRejection/wire/status/rateLimit）全部复绿，shape-gate 未破坏真实 UUID 关联链路。

### Recheck 结论

**四项全部 RESOLVED。PROTOCOL_REVIEW = PASS 维持。**
