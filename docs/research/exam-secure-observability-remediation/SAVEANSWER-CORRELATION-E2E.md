# SAVEANSWER-CORRELATION-E2E — 真实消费链路与浏览器级证据

- 契约出处：`TASK-CONTRACT.md` §0 Decision C、§3.1/§3.3/§3.4/§3.5。
- 目标链路：`HTTP SaveAnswer → response header → API client → TakeExamPage →
  failure/rejection diagnosis → authorized server log lookup`。
- 本文的浏览器证据由**本次编纂会话实际运行**产生（不是引用实现方报告）；
  未运行的部分明确标注。

## 七要素（本文自证）

| 要素 | 值 |
| --- | --- |
| 真实代码 SHA | 运行对象 `a84b416a0c58cd73a7143eef274ef2c68f0f4fcc`（final-closure-integration）；链路代码 final 于 #924 `e81b76a17212c8e321a83f1b0522e54a049326f1`（已含于集成）；基线 master `5140c3dd0f9dbde1bdad8f5b757161f3ed96945d` |
| 运行环境 | `integration-final` worktree；WSL2 Linux 6.18.54.1-microsoft-standard-WSL2；Node v24.22.1；pnpm 11.1.2；PostgreSQL 18.4（`exam-dev-db-1`）；Playwright Chromium；`APP_MODE=e2e` |
| 执行命令 | `DEV_API_PORT=3520 E2E_WORKERS=1 E2E_PRT_SHOT_DIR=/tmp/m4-evidence2 bash scripts/e2e/run.sh --grep "M4:" --keep-server` → 1 passed；M5 同构 → 1 passed；另见 §6 |
| 关键测试结果 | M4：真实 HTTP 200 `CONFLICTING_PAYLOAD`；UI `请求编号：e0289b97-f55e-4ee6-8864-6472faf51116`；服务器 WARN `reqId` 同值；管理员时间线同一值。M5：transport 无编号（UNKNOWN）。 |
| 原始证据路径 | `raw/saveanswer-e2e/`：`05-save-rejection-request-id.png`、`06-timeline-client-claimed-request-id.png`、`07-transport-unknown-no-request-id.png`、`server-rejection-line.json`、`run.txt`、`m4-run.log`、`m5-run.log`、`README.md` |
| 已知边界 | M3 修复未提交；#923 最终 head CI 红；无服务器日志查询 API/UI；中间层可改写 header；M4/M5 为合成 seed |
| 结论可信度 | 高（同一 UUID 三处互证 + 通过的浏览器断言）；集成 CI 受 §5 约束 |

运行对象说明：worktree 在 `a84b416a` 之上有 **2 个未提交测试文件改动**
（`investigation-ui-acceptance.spec.ts` 的 M3 forged id 改 UUID 形状、
`proctorMonitoring.crossOrg.test.ts` 5 行）。M4/M5 的测试体与全部产品代码与
exact SHA 相同；该改动只影响 M3 的伪造值（`git diff` 仅 `:762`）。

## 1. 逐跳链路（代码事实）

| # | 跳 | 发生什么 | 证据（final） |
| --- | --- | --- | --- |
| 1 | 服务端 mint | Fastify `genReqId = randomUUID()`；`requestIdHeader:false` 使客户端头永不生效 | `apps/api/src/server.ts:112,114` @ `e81b76a1` |
| 2 | 响应头 | root-scope `onRequest` 钩子 `reply.header("x-request-id", request.id)`，覆盖所有下游状态路径（含统一错误处理器）；未到达 reply 的请求是文档化例外 | `apps/api/src/plugins/requestIdHeader.ts`（`setupRequestIdHeader`） |
| 3 | 保存判定 | 真实领域判定产生 `accepted:false` / `reason`；HTTP 状态仍为 200 | `apps/api/src/routes/attempts.candidate.ts:1106-1149` |
| 4 | 服务端可检索事实 | `request.log.warn({organizationId, actorId, actorRole, attemptId, questionId, clientSeq, reason, serverVersion}, "Answer save rejected")`；Pino 自动带 `reqId` | 同上 `:1124-1138` |
| 5 | API client | `requestWithMeta`：`fetch` → `!ok` 走 `responseToApiError`；2xx 读 `x-request-id` 为 `meta.requestId`；`postWithMeta` 复用同一核心 | `apps/web/src/lib/api.ts:306-338`（meta `:331-333`）、`:426-434` |
| 6 | API client（错误路径） | envelope `requestId` 是唯一被 `ApiError` 暴露的关联事实；header 只作局部变量，二者不一致时有界 warn | `apps/web/src/lib/api.ts:235-268` |
| 7 | TakeExamPage 调用 | 唯一保存实现：`api.postWithMeta<SaveAnswerResponseDTO>(url, {attemptId,questionId,answer,clientSeq,clientSavedAt,baseVersion})` | `apps/web/src/pages/exam/TakeExamPage.tsx:897-908` @ `a84b416a` |
| 8 | 失败/拒绝诊断（UI） | 200 拒绝：`setSaveRejection(result)` + `setSaveRejectionRequestId(meta.requestId)`；alert 只在有 id 时渲染 `请求编号` | `:967-987`、`:1585-1594` |
| 9 | 失败遥测（client-claimed） | `answer_autosave_failed` metadata：`saveMode/durationMs/errorCode/clientSeq` + 仅存在时 `requestId` | `:974-987` |
| 10 | 授权读取与展示 | 监考时间线读 `client_events` 后投影 allowlist；`requestId` 仅接受 UUID 形状；行标注“客户端声明，未经服务端核验” | `apps/api/src/lib/proctorMonitoringService.ts:72,152-170,202-231` @ `d3580f3e` |
| 11 | 授权服务端日志查询 | 运维在宿主/`docker logs` 的 Pino 输出中按同一 `reqId` 检索 WARN 行；产品不提供查询 API/UI（契约禁止新建） | `docs/contracts/observability.md:32,63-73,155-166`；07 §3 |

**每一跳的证据强度**（不混为一谈）：

- `x-request-id` 是**服务端铸造、浏览器观察**的值；头本身可被中间层改写，故代码
  在错误路径以 envelope 为权威、并在两者不一致时记录有界 warn。
- DB 中的 `metadata.requestId` 是 **client-claimed correlation candidate**，不是
  身份或保存成功的证据；读取端只投影 allowlist + UUID 形状。
- 保存是否成功仍由服务端 receipt/领域状态决定，requestId 不参与。

## 2. 六类结果的证据语义（与 §3.3 对应）

| Case | 客户端看到什么 | 关联编号来自哪里 | 是否持久化 | 证据 |
| --- | --- | --- | --- | --- |
| A 200 accepted | saved；无失败提示 | 不消费（成功路径无 id 需求） | 无新增成功遥测 | `TakeExamPage.tsx:915-931`；`requestIdSaveRejection.test.ts:120` |
| B 200 accepted:false | 拒绝 alert + 请求编号 | **响应头**（`meta.requestId`），缺失则不显示 | `client_events.answer_autosave_failed.metadata.requestId`（client-claimed） | **本次 M4**；`TakeExamPage.saveRejectionRequestId.test.tsx:269/308` |
| C STALE_VERSION | 协调为 saved，应用服务器答案 | 可捕获但不参与协调 | 零 failed 遥测 | `:934-965`；`:368` |
| D 4xx/5xx | 服务器故障/权限错误提示 | envelope `requestId` | 既有错误遥测路径 | `api.ts:235-268`；`TakeExamPage.saveFault.test.tsx:225/299` |
| E transport | 连接异常 + 保存失败，**无编号** | 无（unknown） | 遥测省略 requestId | **本次 M5**；`:518`；`saveFault.test.tsx:349` |
| F 并发/迟到 | 旧响应不改变新 attempt 的提示/编号 | 仅当前 scope 的响应 | 旧 attempt 不写遥测 | `:847-848,909-913,997-1005`；`:580-639` |

## 3. 浏览器级证据（本次执行）

### 3.1 M4 — 真实 200 业务拒绝

```text
DEV_API_PORT=3520 E2E_WORKERS=1 E2E_PRT_SHOT_DIR=/tmp/m4-evidence2 \
  bash scripts/e2e/run.sh --grep "M4:" --keep-server
✓ investigation-ui-acceptance.spec.ts:928 M4 (7.2s)
1 passed (8.0s)   EXIT=0
```

用例构造（`apps/e2e/e2e/investigation-ui-acceptance.spec.ts:949-1005` @ `a84b416a`，
committed 文件 M4 起始行 `:925`；运行输出显示 `:928`，是 worktree 未提交 M3 注释
带来的 +3 行偏移）：
在页面真实保存请求放行前，先以同一 `(attemptId, questionId, clientSeq=1)` 写一条
不同内容的 receipt，使真实服务端计算出 `CONFLICTING_PAYLOAD`；随后：

- `saveResponse.status() === 200`、`accepted === false`、`reason === "CONFLICTING_PAYLOAD"`；
- `headerRequestId` 必须存在；
- 页面 `save-rejection-alert` 可见且包含“请求编号”与该 header 值；
- 客户端遥测批次被服务端接受；
- 管理员时间线 `answer_autosave_failed` 行含“客户端声明，未经服务端核验”与同一 id。

本次运行产物（同一 UUID `e0289b97-f55e-4ee6-8864-6472faf51116`）：

| 证据 | 观察 |
| --- | --- |
| `05-save-rejection-request-id.png` | 考生页面 alert：`请求编号：e0289b97-f55e-4ee6-8864-6472faf51116`（“如需联系管理员，请提供此编号”） |
| `server-rejection-line.json` | `{"level":40,…,"reqId":"e0289b97-f55e-4ee6-8864-6472faf51116",…,"reason":"CONFLICTING_PAYLOAD","msg":"Answer save rejected"}` |
| `06-timeline-client-claimed-request-id.png` | `answer_autosave_failed` 行 metadata 前缀 `e0289b97-f55e-4ee6-8864-6472faf511…`，分组标签“客户端声明，未经服务端核验” |

**结论**：一次真实的考生保存异常，考生可在 UI 读到编号；同一编号同时存在于
服务端 WARN 与授权调查时间线。这是契约 §9“最高目标”的浏览器级证明。

### 3.2 M5 — transport failure 的 UNKNOWN 语义

```text
DEV_API_PORT=3510 E2E_WORKERS=1 E2E_PRT_SHOT_DIR=/tmp/m5-evidence \
  bash scripts/e2e/run.sh --grep "M5:" --keep-server
✓ investigation-ui-acceptance.spec.ts:1064 M5 (3.4s)
1 passed (4.1s)   EXIT=0
```

`07-transport-unknown-no-request-id.png`：页面显示“连接异常 / 部分答案尚未保存成功”，
**没有**“请求编号”。即响应未抵达时客户端不伪造任何服务端 id。

### 3.3 与 API 集成测试的互补关系

浏览器证据证明“浏览器读到的值 == 服务端日志的值”在一次真实链路中成立；
`apps/api/src/routes/attempts/requestIdSaveRejection.test.ts:139` 则在真实
PostgreSQL 上直接断言：200 拒绝响应头 == 该请求 WARN 行的 `reqId`，且响应体不带
requestId（归档/评审实跑）。两者一个覆盖“人能看到”，一个覆盖“状态码/日志协议”。

## 4. “授权服务端日志查询”到底指什么

- **存在**：Pino 结构化 WARN（含 `reqId/organizationId/actorId/actorRole/
  attemptId/questionId/clientSeq/reason/serverVersion`），落在 API stdout →
  部署侧 `docker logs`/daemon 日志（07 §3 的落点分析）。
- **不存在（按契约禁止新建）**：日志查询 API、管理调查 UI、requestId 数据库表。
  `git diff --stat 5140c3dd a84b416a -- packages/db/migrations` 为空（本次执行）。
- **权限**：读取服务端日志依赖宿主/容器管理权限，不是产品 RBAC 能力；`INFRA_LOG_ACCESS
  = NOT_VERIFIED`（07 §4）。
- **隐私边界**：`x-request-id` 是 UUID，不含答案内容；服务器 WARN 行不含
  `answer` 字段（`attempts.candidate.ts:1124-1138` 的字段清单）。

## 5. 边界与合并风险（必须与结论一起读）

1. **M3 修复未提交**：`#923` `d3580f3e` 的 requestId 形状 gate 使既有 M3 用例的
   `req-forged-prt-0001` 不再被投影；GitHub CI 在 #923 final head 上
   `E2E (shard 1/2)` 失败（`investigation-ui-acceptance.spec.ts:844`）。修复（改为
   UUID 形状）只存在于 integration worktree 未提交 diff，任何 commit 都不含
   （`git log --all -S "00000000-0000-4000-8000-000000000bad"` 为空）。按当前已提交
   内容合并，E2E 仍会红；收口提交必须纳入该测试修复或等价 pin。
2. **本次 M4/M5 的运行对象**是 `a84b416a` + 上述未提交测试改动；产品代码与 exact
   SHA 相同，M4/M5 测试体未受改动影响。
3. **没有服务器日志查询产品能力**：关联是“考生报编号 → 运维在授权宿主机日志中
   检索”，不是自助查询；这符合契约“不新建查询 API/管理调查 UI”的边界。
4. **中间层**：任何改写/剥离 `x-request-id` 的反代会破坏浏览器观察值；代码只保证
   直接响应下的服务端铸造语义，并以 envelope 优先 + 有界 mismatch warn 降低误判。
5. **合成数据**：截图与日志来自 E2E seed（`E2E Candidate reqid-rej …`、合成题目），
   不含真实考生/答案/凭据；UUID 每轮不同。
6. **失败尝试**：3400/3460 两次因宿主端口瞬时占用在 API 启动阶段 `EADDRINUSE`，
   未进入 Playwright，已记录在 `raw/saveanswer-e2e/run.txt`，不作为证据。

## 6. 复现

```bash
cd /home/hoo/Source/exam-gap-worktrees/integration-final   # HEAD a84b416a
DEV_API_PORT=3520 E2E_WORKERS=1 E2E_PRT_SHOT_DIR=/tmp/m4-evidence2 \
  bash scripts/e2e/run.sh --grep "M4:" --keep-server
DEV_API_PORT=3510 E2E_WORKERS=1 E2E_PRT_SHOT_DIR=/tmp/m5-evidence \
  bash scripts/e2e/run.sh --grep "M5:" --keep-server
# 服务器行（M4 运行期间）：
grep "Answer save rejected" /tmp/e2e-wsl-api.log | tail -1
# 归档副本与校验和：raw/saveanswer-e2e/README.md
```

## 7. 结论可信度

- **高**：链路代码逐跳可读、single `postWithMeta` 调用点（`git grep -c` = 1，本次
  执行）、本次 M4 三处同一 UUID、M5 UNKNOWN。
- **中高**：错误路径一致性由组件/API 用例覆盖（归档实跑），本次未逐条重跑。
- **受约束**：合并就绪受 §5.1（M3 修复未提交、#923 CI 红）约束；不影响“链路已真实
  打通”的结论，但影响“四 PR 现可合并”的结论。
