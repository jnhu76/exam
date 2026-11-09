# SAVEANSWER-PROTOCOL-REGRESSIONS — §3.3 Case A–F、§3.6 十四行矩阵、§3.7 八项门禁

- 契约出处：`TASK-CONTRACT.md` §3.3/§3.4/§3.6/§3.7。
- 本文只回答一件事：**引入 requestId 消费后，SaveAnswer 的保存、重试、协调、
  并发与拒绝语义有没有回归**。链路与浏览器证据见 `SAVEANSWER-CORRELATION-E2E.md`；
  性能数字见 `10-INTEGRATION-CI-AND-PERFORMANCE.md`。
- 判定纪律：本次会话**实跑**的用例标“本次执行”；只读代码/测试文件或采信归档与
  独立评审的标“归档/评审实跑，本次未重跑”。不把未执行写成 PASS。

## 七要素（本文自证）

| 要素 | 值 |
| --- | --- |
| 真实代码 SHA | #924 final `e81b76a17212c8e321a83f1b0522e54a049326f1`；最终集成 `a84b416a0c58cd73a7143eef274ef2c68f0f4fcc`；基线 master `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d` |
| 运行环境 | WSL2 Linux 6.18.54.1-microsoft-standard-WSL2；Node v24.22.1；pnpm 11.1.2；PostgreSQL 18.4（`exam-dev-db-1`）；Playwright Chromium |
| 执行命令 | 本次：`git diff`/`git grep` 静态核对（§4）、M4 浏览器 E2E（1 passed）、M5 浏览器 E2E（1 passed）；归档：§3.6 表中标注的 vitest 命令 |
| 关键测试结果 | M4（真实 200 CONFLICTING_PAYLOAD）1 passed；M5（transport → UNKNOWN）1 passed；其余 14 行矩阵由归档/评审实跑覆盖（逐行标注） |
| 原始证据路径 | `raw/saveanswer-e2e/`（05/06/07 截图、服务器拒绝行、运行记录）；测试源码路径见各表；`review-saveanswer-protocol.md` §4–§5 |
| 已知边界 | 本会话未重跑 14 行矩阵的全部 vitest 用例；#923 最终 head 的 GitHub E2E 红（M3 与形状 gate 的交互）见 §5；M3 修复未提交 |
| 结论可信度 | 高（协议路径结构性未动 + 关键行有本次实跑/最近归档实跑）；中（未逐条重跑全矩阵） |

## 1. §3.3 Case A–F 逐案结论

| Case | 契约要求 | 结论 | 证据 |
| --- | --- | --- | --- |
| **A** HTTP 200 accepted:true | 更新 serverVersion、维持 saved、不改 receipt identity、不新增含 requestId 的成功持久化 | PASS | `TakeExamPage.tsx:915-931` @ `a84b416a`：只写 version/UI/既有 `answer_autosave_success`（无 requestId）；组件用例 `TakeExamPage.saveState.test.tsx:249`（idle→saving→saved）；API 正对照 `requestIdSaveRejection.test.ts:120`（accepted 也带头） |
| **B** HTTP 200 accepted:false | 附实际响应头 requestId（仅存在时）、保留 reason/clientSeq/durationMs、UI 展示诊断编号、不误报 500/断网 | PASS | `TakeExamPage.tsx:967-987`；`meta.requestId` 缺失时展开为空对象（不伪造）；UI 仅在有 id 时渲染 `:1585-1594`；用例 `TakeExamPage.saveRejectionRequestId.test.tsx:269`（有头）与 `:308`（无头不伪造）；**本次 M4 真实 200 拒绝实跑通过** |
| **C** STALE_VERSION + serverAnswer | 应用服务器答案、更新 version、不新增失败事实、requestId 不参与比较 | PASS | `TakeExamPage.tsx:934-965`：`serverAnswer` 写回、`saveState("saved")`、零 failed 遥测；用例 `:368`（“zero failure telemetry”）、`TakeExamPage.saveState.test.tsx:380` |
| **D** HTTP 4xx/5xx | envelope requestId 与 `X-Request-Id` 一致性检查；不一致记录 correlation inconsistency；客户端输入头不作权威 | PASS | `apps/web/src/lib/api.ts:235-268` @ `e81b76a1`：header 仅函数内局部变量，不一致时有界 warn `api.request_id_correlation_mismatch`；envelope 是唯一被 ApiError 暴露的值；用例 `TakeExamPage.saveFault.test.tsx:225`（500）、`:299`（409 三方语义）、`requestIdStatusMatrix.test.ts:86,107,127,147`（401/403/409/500） |
| **E** transport failure / ACK 丢失 | `requestId = null/unknown`；不得用 clientSeq/attemptId/本地 UUID/上一次 id 伪造；重试仍由服务端 receipt/领域状态判定 | PASS | 客户端 `api.ts:339-359`（网络失败抛 `ApiError(0)`，无 id）；`TakeExamPage.tsx:1028-1041`（transport 不写 server fault id）；用例 `:518`（transport→online retry，两次 HTTP 独立 clientSeq、无伪造 id）、`:887`（断连隐藏 alert，恢复后原样重现）；**本次 M5 浏览器实跑通过（`07-…png`，页面无“请求编号”）** |
| **F** 并发与旧请求迟到 | 保护 `scopeGenAtSchedule`/`saveStale()`；迟到响应不得覆盖新 attempt 的 requestId、Save State、诊断 | PASS | `TakeExamPage.tsx:847-848`（scope 代际）、`:909-913`（post-await 守卫）、`:997-1005`（catch 顶部守卫）；用例 `:580-639`（旧 attempt 迟到拒绝+id，零状态/零遥测）；路由重置清空 `:737` |

## 2. §3.6 十四行矩阵逐行结论

| # | 场景 | 结论 | 证据（文件:行；执行性质） |
| --- | --- | --- | --- |
| 1 | accepted:true | PASS | `TakeExamPage.saveState.test.tsx:249`；`requestIdSaveRejection.test.ts:120`（归档/评审实跑） |
| 2 | accepted:false | PASS | `TakeExamPage.saveRejectionRequestId.test.tsx:269`（归档）；**M4 真实 200 拒绝（本次执行，1 passed）** |
| 3 | accepted:false 无 Header | PASS | `:308`（断言两个 surface 都不出现伪造 id；归档） |
| 4 | STALE_VERSION + serverAnswer | PASS | `:368`（协调 + 零失败遥测）；`saveState.test.tsx:380`（归档） |
| 5 | CONFLICTING_PAYLOAD | PASS | `:338`（保留 reason 与 id）；**M4 真实服务端判定（本次执行）** |
| 6 | 401/403/409 | PASS | `:433`（401 三方契约）、`:477`（403）；`saveFault.test.tsx:299`（409）；`requestIdStatusMatrix.test.ts:86,107,127`（归档/评审实跑） |
| 7 | 500 | PASS | `saveFault.test.tsx:225`（服务器故障 banner + requestId）；`requestIdStatusMatrix.test.ts:147`（header 在统一错误响应上）；M3 浏览器用例存在但**本次未重跑**且 CI 红（§5） |
| 8 | transport error | PASS | `:518`、`:887`；`saveFault.test.tsx:349`（不伪造 status/requestId）；**M5 实跑（本次执行）** |
| 9 | ACK 丢失后重试 | PASS | `:518-579`（两次 HTTP 尝试、两个独立 clientSeq、业务身份独立）；`useSubmitFlush.test.ts` 15 例（归档） |
| 10 | old attempt delayed response | PASS | `:580-639`（带 id 的迟到拒绝不写新 attempt 状态/遥测；归档实跑，调度记录为绿） |
| 11 | 多问题并发 | PASS | `:692-748`（q1 拒→q2 无头拒绝：alert 用 q2 copy、无残留 id）；`saveState.test.tsx:439`（后续题保存不清除失败题 banner） |
| 12 | retry/flush 不产生新保存实现 | PASS | `:750-771`（恰一个 `api.postWithMeta<SaveAnswerResponseDTO>` 调用点，无第二保存实现）；`git grep -c api.postWithMeta` = 1（本次执行）；`useSubmitFlush.test.ts` 15 例（归档） |
| 13 | 手动诊断能从 UI 取得编号 | PASS | **M4 本次执行**：alert `请求编号：<UUID>`；`05-…png` 与服务器 WARN `reqId` 同一值 |
| 14 | 跨租户不因 requestId 获得额外访问 | PASS | `proctorMonitoring.crossOrg.test.ts:223`（client-claimed requestId 不授予跨 org 可见性）；review-security 实跑该文件 7 passed（归档） |

## 3. §3.7 八项门禁

| 门禁 | 判定 | 依据 |
| --- | --- | --- |
| `SAVEANSWER_RECEIPT_SEMANTICS = UNCHANGED` | **PASS** | 本次 `git diff --stat 5140c3dd a84b416a -- apps/api/src/routes/attempts packages/exam-engine packages/db`：只有新增测试 `requestIdSaveRejection.test.ts`；`attempts.candidate.ts` 与域/引擎/db 源码零改动。归档 live 矩阵 T02/T08/T10（receipt 幂等/并发单行/ACK 丢失仍提交）与代码一致 |
| `CLIENT_SEQ_SEMANTICS = UNCHANGED` | **PASS** | 本次逐行比对：final `TakeExamPage.tsx:874-875` 与 master `:860-861` 相同（`versionsRef`/`clientSeqsRef` 计算）；服务端未动。用例 `:518` 断言两次 started 的 clientSeq 独立且 started/failed/POST body 共享同值 |
| `ANSWER_IDENTITY_SEMANTICS = UNCHANGED` | **PASS** | 本次 diff：`packages/exam-engine`、`packages/db`、`packages/contracts` 的答案协议文件零改动（contracts 仅新增 `clientEventRoute.ts` 与 timeline DTO）；STALE 分支 `:934-965` 不比较 requestId |
| `RETRY_SEMANTICS = UNCHANGED` | **PASS** | 本次 `git diff --stat 5140c3dd a84b416a -- apps/web/src/hooks apps/web/src/exam` 为空；单一保存编排 + `useSubmitFlush` 15 例（归档）；`:750` 结构断言钉死单调用点 |
| `STALE_ATTEMPT_ISOLATION = PASS` | **PASS** | 三重守卫：调度代际 `:847-848`、post-await `:909-913`、catch 顶部 `:997-1005`；新增 requestId 状态写入全部在守卫之后；路由重置 `:737` 同步清除；`:580-639` 用例（归档） |
| `FALSE_FAILURE_TELEMETRY = 0` | **PASS** | STALE 协调分支只发 `answer_autosave_success(saveMode:"stale_reconcile")`（`:956-963`）；`:368` 断言零 failed 行；M4 只产生一条真实 failed（本次实跑）；成功分支无 requestId 遥测 |
| `REJECTION_REQUEST_ID_CORRELATION = PASS` | **PASS** | 服务端 `attempts.candidate.ts:1124-1149` WARN `reqId` + 响应头同源；API 用例 `requestIdSaveRejection.test.ts:139`（header == WARN reqId、body 无 requestId，归档）；**M4 本次执行：UI 编号 == 服务器 WARN reqId**；nginx 透传（`web.conf` 不 hide/不自铸） |
| 修订并 push 到现有 PR #924，不创建重复 PR | **DONE** | `gh pr view 924`：head `e81b76a1`，分支 `feat/http-request-id-response-header`（本次执行）；`872a244f` 与 `e81b76a1` 同分支祖先链（`git log`）；无新 PR |

## 4. 本次执行命令（可复核）

```bash
# §3.7 结构与 diff（在 /home/hoo/Source/exam，对象为 commit 而非工作树）
git diff --stat 5140c3dd a84b416a -- apps/api/src/routes/attempts \
  packages/exam-engine packages/contracts packages/db
# → 仅 requestIdSaveRejection.test.ts / clientEventRoute.test.ts /
#   clientEventRoute.ts / contracts index.ts / proctorMonitoring.ts
git diff --stat 5140c3dd a84b416a -- apps/web/src/hooks apps/web/src/exam   # → 空
git diff --stat 5140c3dd a84b416a -- packages/db/migrations               # → 空
git grep -c "api.postWithMeta" a84b416a -- apps/web/src/pages/exam/TakeExamPage.tsx  # → 1
git grep -n "setSaveRejectionRequestId" a84b416a -- apps/web/src/pages/exam/TakeExamPage.tsx
# → 423 声明 / 737 路由重置 / 922 接受清空 / 952 协调清空 / 972 拒绝写入
git show 5140c3dd:apps/web/src/pages/exam/TakeExamPage.tsx | grep -n "clientSeq ="
# → :861（final :875，逐行相同）
# 浏览器（本次执行）
DEV_API_PORT=3450 … scripts/e2e/run.sh --grep "M4:" --keep-server   # 1 passed
DEV_API_PORT=3510 … scripts/e2e/run.sh --grep "M5:" --keep-server   # 1 passed
```

## 5. 与 #923 的已知交互与合并边界

- `#923` `d3580f3e` 引入的 requestId 形状 gate（`proctorMonitoringService.ts:202-231`）
  使既有 M3 用例的伪造值 `req-forged-prt-0001` 不再被时间线投影。
- GitHub CI（本次 `gh pr checks 923`）：`E2E (shard 1/2) fail`，job
  `128847373789`；失败含
  `investigation-ui-acceptance.spec.ts:844 expect(clientDialogText).toContain(forgedRequestId)`
  与另一条 `rich-content-overflow…:568` 的滚动几何断言。前者是**协议形状 gate 与
  既有测试的真实交互**，后者与本轮无因果通道（未归因）。
- 修正（把 forged id 改成 UUID 形状）**只存在于 integration worktree 的未提交
  diff**（`apps/e2e/e2e/investigation-ui-acceptance.spec.ts:762`；
  `git log --all -S "00000000-0000-4000-8000-000000000bad"` 为空）。因此按当前
  已提交内容合并，E2E 仍会红；收口提交必须包含该测试修复或等价 pin。
- 这不改变保存协议结论：M3 断言的是“时间线拒绝非 UUID 形状的伪造值”，与 A–F
  六类保存语义无关；M4/M5 本次均通过。

## 6. 非回归的既有行为（不属本轮缺陷）

1. **跨题成功保存清空拒绝对**：任意题 accepted 后无条件
   `setSaveRejection(null)`/`setSaveRejectionRequestId(null)`（final `:921-922`），
   与 master `:902` 同型，非本轮回归；产品语义待定，已列入 follow-up
   （review-saveanswer Finding 1）。
2. **断连期间拒绝 alert 不可见**：`saveRejection && !isDisconnected`（final
   `:1571-1572`；master `:1543` 同门），恢复后原样重现；非本轮回归。
3. `api.getWithMeta` 为**文档化前瞻面**（无生产调用方，
   `apps/web/src/lib/api.ts:411-425` 注释 + `docs/contracts/observability.md`）；
   `ApiError.headerRequestId` 已删除（final `api.ts:235-242` 改为函数内局部变量）。
   这是 #924 收口时对 ARCH-DUP-1/2 的处置，不构成双轨。

## 7. 边界与结论可信度

- 14 行矩阵中，本次会话亲手运行的是第 2/5/8/13 行的浏览器半边（M4/M5）；其余行
  依赖归档/评审实跑，本次**未逐条重跑**。表内已逐行标注执行性质。
- 未运行：`pnpm verify`、全量 E2E、四文件以上并发 vitest 组合（评审记录显示
  多 DB-backed 文件并发会触发 setup 竞争，逐文件运行通过）。
- M4 运行对象为 `a84b416a` + 2 个未提交测试文件改动（M3 forged id、crossOrg
  测试微调）；M4 的测试体与全部产品代码与 exact SHA 相同（`git diff` 证实）。
- 可信度：保存协议结构性结论**高**（diff 为空 + 单调用点 + 守卫链可读）；
  行为覆盖**中高**（最近归档实跑 + 本次 M4/M5）；CI 合并就绪**受 §5 约束**。
