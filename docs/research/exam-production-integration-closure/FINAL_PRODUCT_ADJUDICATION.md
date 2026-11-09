# FINAL_PRODUCT_ADJUDICATION — 最终产品裁决（本轮 · 基于四份 §7 独立评审的独立复现裁决）

> 裁决员对四份独立评审（REVIEW_SECURITY / REVIEW_PROTOCOL / REVIEW_CI_FLAKE / REVIEW_ARCHITECTURE_DOCS，均审 exact SHA `0b2e2d8a`）、
> 四份研究文档（BASELINE_AND_OWNERSHIP / REQUEST_ID_GLOBAL_CONTRACT / UUID_FIXTURE_RECONCILIATION /
> FLAKE_INVESTIGATION_AND_FIX）、集成树 `/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109`
> 与 CI 证据 FAIL (exit 1) 的独立重裁。SPEC §4/§7/§8 为裁决标准。
> **未接受任何一份评审的结论作为前提**：每项 high/blocker 主张均在本会话独立复现（读代码 / 跑最小命令）后才标 confirmed；
> 不能复现的标 unconfirmed 并说明（见 §2）。
>
> **verdict = BLOCKED**。唯一驱动因素是 required CI 门禁：exact 集成 SHA 上从未有完成的 CI 运行
> （GitHub 账户计费故障——Static checks 未启动、6 个 required job 全部 skipped；本轮经 `gh api` 独立复核确认），
> 以及 flake/occurrence 台账未按 SPEC §7.2 闭合（两条新签名未登记）。产品代码层面：**307 个定向测试 +
> 318/318 归档校验 + 浏览器级 SaveAnswer 链（M3/M4/M5）在本会话全部实跑通过**，未独立复现任何 P0/P1
> 或与本轮相关的产品正确性缺陷。不执行 merge / commit / push。
> 四个 PR disposition = KEEP_AND_MERGE 表示"内容值得保留、门禁绿后可合并"，与全局 verdict 正交，不表示门禁已绿。
>
> **并发写入说明**：本会话执行期间（18:46）检测到另一"第 3 轮"裁决进程覆写过本文件（其结论方向与本裁决一致：
> BLOCKED、11 PASS + UNCHANGED、blockers 1+2 写回）。本文件现为本轮（基于四份 §7 评审的独立裁决）版本；
> 两版在全部裁决字段上一致，本版额外含 §2.3 的一手新证据（A3-F7 `:341` 失败与控制实验）。

---

## 0. 被审对象与元信息（本会话实查）

| 项 | 值 | 证据 |
| --- | --- | --- |
| exact 集成 SHA | `0b2e2d8a1653ebba59326517ec2fdc6b4c7cf4bc`（四 PR 合并完成点） | `git log --oneline -8`：`0b2e2d8a Merge PR #926` ← `9bba9fbf Merge PR #924` ← `4919e534 Merge PR #923` ← `0b1902d0 Merge PR #922` ← `8061d547 docs(research)` |
| worktree HEAD | `a5df2c90ace6366e69c951e6660dc268327b6e8a` = exact SHA + 1 docs-only 提交 | `git rev-parse HEAD`；`git show a5df2c90 --stat` → 仅 `docs/adr/ADR-025-*.md` + `docs/standards/test-flakes.md`（2 files, +75/-13，零代码文件）→ 两 SHA 代码逐字节一致 |
| 分支 / PR #928 | `integration/production-closure-20261109`；GitHub 上 Draft、OPEN、head=`a5df2c90`、CI-only（pr-body: "Draft PR for CI only — do not merge directly"） | `git branch --show-current`；`gh pr view 928`；`pr-body.md:3` |
| 四个源 PR | #922/#923/#924/#926 全部 OPEN + Draft；#923/#924 `mergeStateStatus=UNSTABLE`（CI 红：flake/计费外因） | `gh pr view 922/923/924/926 --json state,isDraft,mergeStateStatus,headRefOid` |
| master | `5140c3dd`，集成树未合并 | `git -C /home/hoo/Source/exam rev-parse HEAD` |
| 受控树状态 | 干净，仅 1 个未跟踪文件 = 本裁决文档（本 ask 指定产物）；四份研究文档已在 `8061d547` 进入受控历史 | `git status --short` |
| 模式 | 调查/评审；除本 ask 指定文档外未改任何受控文件，未 commit/push/merge | — |

---

## 1. 输入材料（ask 给定 + 本会话实读）

- **ask 给定**：`/home/hoo/Source/exam/.tmp/production-closure/reviews/` 下 REVIEW_SECURITY.md、REVIEW_PROTOCOL.md、REVIEW_CI_FLAKE.md、REVIEW_ARCHITECTURE_DOCS.md；`docs/research/exam-production-integration-closure/` 下四份研究文档；集成树；**CI 证据 FAIL (exit 1)**；`SPEC.md` §4（全局行为矩阵与产品价值裁决，L471–563）、§7（独立 Subagent 终审与 §7.2 修复—复审闭环，L771–868）、§8（合并前最终条件与合并顺序，L872–957）。
- **本会话补充实读**：集成树源码与部署配置（`apps/api/src/server.ts`、`plugins/requestIdHeader.ts`、`plugins/cors.ts`、`lib/proctorMonitoringService.ts`、`lib/logRedaction.ts`、`routes/clientEvents.ts`、`lib/errorResponse.ts`、`audit/auditWriter.ts`、`openapi/swagger.ts`、`packages/contracts/src/common.ts`、`packages/contracts/src/clientEventRoute.ts`、`apps/web/src/lib/api.ts`、`apps/web/src/pages/exam/TakeExamPage.tsx`、`deploy/nginx/web.conf`）、`packages/exam-engine/src/saveAnswer.test.ts`、`docs/standards/test-flakes.md`（OBS-2026-11-03-001 段）、`CHANGELOG.md`、`pr-body.md`、`logs/{verify,e2e}.log`。
- **评审留存的证据文件（本会话实读）**：`/tmp/review-ciflake/verify-run1-FAIL-555.log`、`/tmp/pr923-flake/job128847373789.raw.log`、`/tmp/pr923-flake/postfix-summary.txt`。
- **本会话新产生的一手证据**：`/tmp/adjud-e2e-investigation.log`（集成树 run 1）、`/tmp/adjud-e2e-investigation-run2.log`（run 2）、`/tmp/adjud-e2e-pr865-control.log`（控制实验）。

---

## 2. 对评审 high/blocker 主张的独立复现

判定规则：只有本会话亲自复现（读代码命中 / 命令输出吻合）才标 **CONFIRMED**；未能复现或仅采信记录的标 unconfirmed 并说明。

### 2.1 REVIEW_CI_FLAKE F1（高 · 门禁性）：clean-tree exact-SHA required CI 从未完成 — **CONFIRMED**

本会话命令与输出：

- `gh api repos/jnhu76/exam/actions/runs/42572487639` → `{"conclusion":"failure","event":"pull_request","head_sha":"0b2e2d8a1653…","status":"completed"}`；jobs 明细 → `Static checks=failure`，`Build / E2E / API coverage / Web coverage / Production transport regression / Package coverage` 全部 `skipped`（6 个 required job 零执行）。
- `gh api repos/jnhu76/exam/check-runs/129014326750/annotations` → 原文：*"The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings"*。job 2 秒即失败、无 runner、非代码失败。
- `gh api …/actions/runs?head_sha=a5df2c90…` → 唯一 run `42593850473`，`conclusion=failure`（同签名，2026-11-09T09:29Z）。
- `gh issue view 930` → OPEN：`[CI][Infra] GitHub Actions jobs fail pre-start — account billing/spending limit (2026-11-09)`（阻断已登记）。

结论：`1f29b614`（flake 修复）与 exact 集成树从未获得任何完成的 CI 运行。按 SPEC §7.2（"required CI 失败，必须 BLOCKED"）、§8.1.7，**BLOCKED 成立**。此为外部账户条件，任何代码改动不能修复。

### 2.2 REVIEW_CI_FLAKE F2（中）：修复后同测试仍非确定性失败（新签名 `:555`） — **签名记录 CONFIRMED；失败本身未由本会话独立复现（unconfirmed）**

- 评审者的失败日志 `/tmp/review-ciflake/verify-run1-FAIL-555.log` 本会话实读：shard 1 `rich-content-overflow.spec.ts:555 toBeFocused` 超时（`Received: inactive`，timeout 5000ms，`3 did not run`），`EXIT=1`；同日志含完整 2-shard 拓扑（`E2E_WORKERS=2`、端口 21000/21001）。失败点 `:555` 是修复（`1f29b614`，新增断言在 `:560-581`）未触及的原有断言——评审者"修复的 poll 采样未被走到"的刻画与日志吻合。
- CI 权威签名独立核对：`/tmp/pr923-flake/job128847373789.raw.log` 实读命中 `:568 Expected: > 0 / Received: 0`（run 42518523050，head d3580f3e）。
- 登记缺口独立确认：`grep -n '555\|toBeFocused' docs/standards/test-flakes.md` → **0 命中**；`gh issue view 878` → OPEN。新签名未登记。
- 本会话时间预算内优先完成了 SaveAnswer 链与 A3-F7 分类实验，未运行 `rich-content-overflow` 套件，故"该 flake 在本会话再现"为 **unconfirmed**；但失败日志、CI 权威签名与 1/9 post-fix 汇总（评审 C 1F/3R + 调查员 5/5 + full 1×）互相一致，非确定性定性成立。

### 2.3 本会话新发现：`investigation-ui-acceptance.spec.ts:341`（A3-F7）在集成树上 2/2 失败 — **CONFIRMED（条件敏感非确定性，非产品契约回归）**

本会话实跑（全部 `E2E_WORKERS=2 E2E_WORKER_BASE_PORT=21000 bash scripts/e2e/run.sh investigation-ui-acceptance`，仓库唯一 E2E 入口）：

| run | 树 | 结果 |
| --- | --- | --- |
| run 1 | 集成树 `a5df2c90` | **EXIT=1**：`1 failed / 9 passed`；唯一失败 = A3-F7 `:341`（`恢复事件` menuitem 点击：`element is not stable` → `detached from the DOM`，error-context 实读）；**M3(:738) / M4(:930) / M5(:1066) 全部通过** |
| run 2 | 集成树 `a5df2c90` | **EXIT=1**：完全相同的唯一失败点与签名；`1 failed / 9 passed` |
| 控制实验 | pr-865 worktree @ `9dd1d5f4`（#924 head，其 CI E2E 8/8 绿） | **EXIT=0 全绿**——同一时刻、同一机器、同一命令、同一端口拓扑 |

归属分析（全部为本会话实查）：

1. **非集成组合确定性回归的反证**：集成树作者今日 14:13 对**同一代码**全量 2-shard E2E `E2E_EXIT=0`（`logs/e2e.log` + pr-body §Local gates，双 shard ✓）；四个 PR head 的 CI E2E 全部通过（#922 run 42447373825、#924 run 42517384651、#926 run 42517918387 均 8/8）。同一 SHA 既全绿过又失败过 → 非确定性成立。
2. **非四 PR 前端面**：`git diff 5140c3dd..0b2e2d8a --stat -- apps/web/src/pages/admin apps/web/src/components/shared` → **空**；A3-F7 是既有测试（#856 时代），失败交互为纯前端 Radix 下拉时序（菜单项已 resolve，点击时 `not stable` → `detached`）。
3. **不能完全归因于环境负载**：pr-865 控制实验在当前同一条件下通过——"集成内容 × 当前机器条件（含并行 exam-review929 容器栈）"是失败窗口的候选解释，但现有样本（集成树本地 2F/1P、pr-865 本地 1P、CI ≥4P）不足以定位机制。

结论：**条件敏感的非确定性执行失败，新签名，未登记**（`grep '341\|恢复事件\|intercepts pointer\|detached' docs/standards/test-flakes.md` → 0 命中）。不构成可归属于四 PR 的产品正确性缺陷；但按 SPEC §7.2 必须登记（见 blocker 2）。

### 2.4 REVIEW_CI_FLAKE F3（中）：#923/#924 最终头无绿 E2E 即合并 — **CONFIRMED**

`gh pr view` → #923/#924 `mergeStateStatus=UNSTABLE`；flake 修复 `1f29b614` 经 `4919e534`（#923 merge）、夹具修复 `9dd1d5f4` 经 `9bba9fbf`（#924 merge）进入集成树（`git log` 链核实）。兜底的 #928 集成门禁被 F1 阻断。过程性缺口成立，修复路径 = blocker 1（在集成树取得完整绿 CI）。

### 2.5 REVIEW_ARCHITECTURE_DOCS F-01：`getWithMeta` 无生产调用方 — **CONFIRMED**

`grep -rn 'getWithMeta' apps/web/src --include='*.ts*' | grep -v '\.test\.'` → 仅 `api.ts:411`（注释）与 `:417`（定义）；`postWithMeta` 生产调用方仅 `TakeExamPage.tsx:898` 一处。低危：documented forward surface、被 `api.test.ts` 钉住、零运行时成本；按 AGENTS.md §3 属"无调用代码"，记 residual（删除或 Owner 显式授权，随最终 master 收口处理），不单独阻塞合并。

### 2.6 REVIEW_ARCHITECTURE_DOCS F-02：`observability.md:34` 路由示例参数名不一致 — **CONFIRMED**

`docs/contracts/observability.md:34` 示例 `/api/attempts/:id/submit`；真实模板 `/attempts/:attemptId/submit`（`apps/api/src/routes/attempts.candidate.ts:1160`）；同文件 `:270` JSON 示例已用 `:attemptId`。一行文档修正，记 residual。

### 2.7 REQUEST_ID_GLOBAL_CONTRACT §9.1-4：OpenAPI 401/403 顶层 `requestId` — **CONFIRMED（master 预存，非本轮引入）**

- wire 权威：`packages/contracts/src/common.ts` `ErrorResponseSchema` 将 `requestId` 嵌套于 `error` 内（实读）；`apps/api/src/lib/errorResponse.ts` `buildErrorResponse` 同构。
- 制品：`apps/api/src/openapi/swagger.ts` `injectMissingErrorResponses` 的 401/403 fallback schema 把 `requestId` 放在**顶层**（实读）；`jq` 计数 `apps/api/openapi.json` → **203** 个 401/403 response 顶层 `requestId`。
- 归属：`git diff 8061d547..HEAD` 未触达该文件；属 master 预存的契约制品漂移。运行时行为正确（envelope 由 zod schema + buildErrorResponse 权威，并有 wire 测试钉住）。**记 residual + follow-up（修 swagger.ts fallback schema 并重新生成 openapi.json），不构成本轮 merge blocker**——四 PR 不使其恶化，阻塞四 PR 合并不修复该预存缺陷属范围错配。

### 2.8 REVIEW_ARCHITECTURE_DOCS F-04（web 测试一次性并行失败） — **unconfirmed（未复现）**

本会话 web 套件实跑通过（§3.1）。按评审者自述"初判本机资源竞争、应交 flake 台账裁定"，并入 blocker 2 的登记范围作低优先观察项，不单独定级。

### 2.9 F-03（合并门禁三条件）与 F5/F6 — **CONFIRMED / 部分未独立复核**

- F-03 三项独立确认：CI 门禁未完成（§2.1）；工作树含未跟踪裁决文档（本文件）；CHANGELOG `[Unreleased]` 为空、`implementation-status.md` 无 #922–#928 条目（实读）——与 `a5df2c90` 提交信息中的显式 DEFER trace 一致（最终 master merge 交付条件，SPEC §8.4）。
- F5（登记册缺 run 42483066387）与 F6（postfix 日志无内嵌 SHA）：采信评审者的 `gh api`/日志取证，本会话未逐项重查（标注：未独立复核，不影响裁决方向）。

### 2.10 安全与协议评审（REVIEW_SECURITY / REVIEW_PROTOCOL）的 GO 结论 — **关键主张全部由本会话独立验证**

见 §3 逐字段证据。两份评审未报告任何 high/blocker；其 low 项（STALE_VERSION reconcile 遥测命名、Save 相关性测试手动注册 hook、归档 62 文件抽查、`9dd1d5f4` 未单独实跑）均与本会话复核结果相容——其中跨组织夹具修复（`9dd1d5f4`）已由我方在集成树上实跑 `proctorMonitoring.crossOrg.test.ts` 直接覆盖。

---

## 3. 全局一致性裁决（SPEC §4.1 矩阵，本会话实跑证据）

### 3.1 本会话测试台账（全部在集成树 `a5df2c90` 实跑，命令为各包 `pnpm exec vitest run`）

| # | 包 / 文件 | 结果 |
| --- | --- | --- |
| 1 | contracts：`src/__tests__/clientEventRoute.test.ts` | 60/60 ✓ |
| 2 | exam-engine：`src/answerProtocol.test.ts src/saveAnswer.test.ts src/saveAnswerReceipts.test.ts` | 55/55 ✓ |
| 3 | web：`src/lib/spaRouteTemplateVocabulary.test.ts src/lib/api.test.ts` | 45/45 ✓ |
| 4 | api（真实 PostgreSQL）：`requestIdWireContract` `requestIdStatusMatrix` `requestIdRateLimit` `attempts/requestIdSaveRejection` `proctorMonitoring.crossOrg` `clientEvents` `lib/proctorMonitoringService` `nginxWebConf` `httpLogPrivacyWire` | 84/84 ✓（9 files） |
| 5 | api：`server.requestId.test.ts`（spawn 生产入口 `server.ts`） | 2/2 ✓ |
| 6 | api：`plugins/clientEventRetention.contract.test.ts` | 8/8 ✓ |
| 7 | api（真实 PostgreSQL）：`attempts/candidate-save-submit` `attempts/candidate-save-deadline-race.concurrency` `orchestrators/saveAnswerReplayReceipts` | 53/53 ✓ |

合计 **307 tests 全部通过**。另有：`sha256sum -c SHA256SUMS`（`docs/research/exam-secure-observability-remediation/`）→ **318/318 OK / 0 失败**（#922 归档独立复算）；浏览器级 E2E 见 §2.3（集成树 2×1F/9P，唯一失败为 A3-F7 非确定性项，**M3/M4/M5 在两次运行中全部通过**）。

### 3.2 逐面裁决（全局一致性矩阵）

| 系统 | 裁决 | 本会话证据 |
| --- | --- | --- |
| HTTP 请求身份（服务端 UUIDv4） | **PASS** | `server.ts:117` `genReqId: () => randomUUID()`、`:119` `requestIdHeader: false`（实读）；`server.requestId.test.ts` 2/2（生产 boot：伪造双 header 被忽略，全部 reqId 匹配带 version/variant 位的 v4） |
| 响应头（x-request-id == request.id） | **PASS** | `plugins/requestIdHeader.ts` root-scope `onRequest` 透传 `request.id`、无第二 mint（实读）；`server.ts` 中 `setupRequestIdHeader(app)` 在任何注册之前（实读）；`requestIdWireContract.test.ts` 7/7（200/400/404/HEAD header==envelope==pino reqId、两次请求不复用、伪造头零影响） |
| 错误信封（error.requestId 同源） | **PASS** | `ErrorResponseSchema`（`common.ts`）`requestId` 嵌套 `error` 内（实读）；`buildErrorResponse(request.id,…)`（实读）；`requestIdStatusMatrix.test.ts` 实跑通过（200/204/401/403/409/500 每条路径 header==envelope） |
| Pino（reqId 同请求关联 + 无原始 URL） | **PASS** | `logRedaction.ts` `routeTemplateOf`（INVARIANT：永不返回 raw URL）+ `serializeReqForLog`（实读）；`grep -rn 'request\.url\|req\.url' apps/api/src`（排除测试与注释）→ 零命中；`httpLogPrivacyWire.test.ts` 7/7（canary 全矩阵零泄漏 + drift guard） |
| Audit（同一 ID 引用） | **PASS** | `auditWriter.ts`：HTTP writer 注入 `truncate(String(request.id),128)`、system writer 不注入（实读）；载体对应性由 `requestIdSaveRejection.test.ts`（WARN 行 `reqId === header`）实跑钉住 |
| 客户端遥测（仅未核验声明） | **PASS** | `proctorMonitoringService.ts:211` `REQUEST_ID_UUID_SHAPE` + 仅 UUID 形状字符串进入投影（实读）；`crossOrg.test.ts` 实跑（合法 UUID claim 不开跨组织可见性、404 断言本体未削弱）；`proctorMonitoringService.test.ts` 21/21（prose/嵌入 UUID/32KB/非字符串全部丢弃） |
| SaveAnswer（receipt+领域状态为业务权威） | **PASS** | 成功判定仅 `result.accepted === true`（`TakeExamPage.tsx` 实读，成功分支不读 `meta.requestId`）；STALE_VERSION reconcile 走 `details.serverAnswer`；拒绝分支 `setSaveRejectionRequestId(meta.requestId)` 同点覆写、遥测 `...(meta.requestId ? {requestId} : {})` 缺失不伪造（实读）；`requestIdSaveRejection.test.ts` 实跑（真实 STALE_VERSION 200 拒绝，body 无 requestId，header==WARN reqId）；浏览器级 M4（真实 CONFLICTING_PAYLOAD 全链）/M5（abort 后零 id 表面）在本会话集成树实跑通过 |
| SaveAnswer 并发/幂等 | **PASS** | 引擎 55/55（幂等回放零写入、STALE_VERSION、CONFLICTING_PAYLOAD、deadline 权威、clientSeq 重放）；PG 并发套件 53/53（save/submit 边界、deadline 权威 vs 并发 closeAt、回放 receipt）；receipt 联合主键 `(org,attempt,question,clientSeq)` 结构兜底 |
| SaveAnswer receipt 语义 | **UNCHANGED** | `git diff 8061d547..HEAD` 对 `packages/contracts/src/attempt.ts`、`packages/exam-engine/src/answerProtocol.ts`、`apps/api/src/routes/attempts.candidate.ts` → 零改动（本会话核实） |
| Route（新写入封闭模板） | **PASS** | `clientEvents.ts:118` `route: projectClientEventRoute(event.route)`（实读）；`clientEventRoute.test.ts` 60/60（封闭输出不变量 + fuzz 落在封闭集）；SPA 词表 drift guard 4/4 |
| Route 历史（读取侧再投影，免迁移） | **PASS** | 读侧对存储值再投影（fail-deny 方向：少显示，不多信任）；旧 `normalizeRouteForStorage` 已删除（评审 D diff 证实，与 `git log` 相容） |
| nginx access log 隐私 | **PASS** | `web.conf` `log_format exam_privacy`：固定 `$exam_route` 占位、永久禁 `$request`/`$request_uri`/raw `$uri`/Referer/Cookie/Authorization（实读）；`nginxWebConf.test.ts` 7/7（含 HTTPS 模板去注释后钉住） |
| nginx error log 诊断 | **PASS** | `web.conf:65` `error_log … error` 保留（实读）；Owner Decision A（raw request line 残余显式接受、`crit` 禁止、与 access-log 声明分离）注释与契约一致并被测试钉住 |
| 数据保留（client_events 30 天不变） | **PASS** | `clientEventRetention.contract.test.ts` 8/8 实跑 |
| 跨租户权限 | **PASS** | `proctorMonitoring.crossOrg.test.ts` 实跑：跨组织 proctor 404、proctor-events 防枚举 404、合法 UUID claim 不授予跨组织可见性、跨组织 incident 写入 404 且计数零变化 |

无 N/A 项：§4.1 列出的载体在本树全部适用且已验证。

---

## 4. 逐 PR disposition（SPEC §4.2 格式）

> 判定口径：disposition 是"该 PR 内容是否值得保留并在门禁绿后合并"的逐 PR 判断，与全局 verdict（BLOCKED，由外部门禁驱动）正交。四个 PR 均无本会话独立复现的内容级 blocker。

### #922 — **KEEP_AND_MERGE**

- 产品收益：审计证据真正进入版本控制且 clean-checkout 可验证——本会话独立复算 `sha256sum -c SHA256SUMS` → **318/318 OK**；`git log` 确认纯 docs + `.prettierignore`，零运行时代码。
- 复杂度/风险：320 文件 docs 归档；含已接受的主机标识类别与合成压测凭据（评审 A 抽查：仅 `raw/perf-ab/load.mjs:83` 合成 `candidate123`），发布/共享前需按归档 README 的 sanitization 边界处理（residual）。
- 风险：低。归档是历史证据非运行时权威（AGENTS.md §4），与 closure 目录无路径重叠。

### #923 — **KEEP_AND_MERGE**

- 产品收益：以封闭词表投影替换被归档证据证明可泄漏的 pathname 清洗器（RT-3/8/12B/12C/14B）；ingest 与 read 双边界复用单一 `projectClientEventRoute`、fail-closed 到 null、不解码百分号、历史行免迁移；附带 requestId 形状 gate 防管理员时间线内容注入。本会话 60/60 + 21/21 + drift guard 4/4 实跑。
- 跨 PR 夹具依赖已闭合：`req-forged-prt-0001` → `00000000-0000-4000-8000-000000000bad`（spec `:770`）、`req-cross-org-*` → `randomUUID()`（`:232`）——本会话 grep 证实集成树零残留（`grep -rn 'req-forged-prt-0001\|req-cross-org-' apps packages` → 0 命中）；修复方向是"向真实协议收敛"（消除旧夹具被形状门控丢弃导致的正控空转），非掩盖失败——与评审 A 结论独立一致，且形状门控负例有独立单测（我方 21/21 实跑）。
- 风险：低。其 CI 红（UNSTABLE）属 E2E flake/计费外因；残留（词表人工镜像、`MAX_INPUT_LENGTH` 边界）为 low residual。

### #924 — **KEEP_AND_MERGE**

- 产品收益：200 `accepted:false` 业务拒绝首次获得客户端可见关联载体（考生可见"请求编号"、telemetry 带 client-claimed requestId、Pino WARN 可按 reqId 检索）；fp-wrap CORS 修复是真实的潜在缺陷修复（pre-#865 接线使非预检响应从不久携带 ACAO/Expose-Headers——`cors.ts` INVARIANT 注释，实读）。本会话 wire/status/rateLimit/saveRejection + web api 45 + SaveAnswer 全链实跑通过；浏览器级 M4/M5 在集成树实跑通过。
- 风险：低。`getWithMeta` 零生产调用方（§2.5 CONFIRMED）为 low residual；429 路径 NOT_TESTED（测试模式限流关闭）；header 非凭据、非保存成功证明的边界已在 ADR-025 附录与契约文档钉住。
- 复杂度：服务端仅 1 个 root-scope hook + 1 个 fp-wrap 改动；客户端 opt-in 元数据 + 单一消费点（`TakeExamPage.tsx:898`）；无双轨（`requestWithMeta` 共享内核）。

### #926 — **KEEP_AND_MERGE**

- 产品收益：应用侧 Pino 请求行不再落原始 URL（`serializeReqForLog`/`routeTemplateOf` 单一权威，本会话 grep 证实零 raw-url 日志点残留）；nginx access log 换 `exam_privacy` 固定占位格式；error 级诊断按 Owner Decision A 恢复并显式记录残余风险——正面满足 SPEC §5.3"不允许声称所有日志彻底脱敏"。本会话 `nginxWebConf` 7/7 + `httpLogPrivacyWire` 7/7 + `server.requestId` 2/2（含生产 boot canary 注入断言）实跑。
- 风险：低。nginx live 容器故障注入未重放（归档证据 + 配置级钉住代替；评审 D 曾以 stock nginx `nginx -t` 实证语法，我方未重复该容器实验——见 §6 未运行清单）；`/healthz` healthcheck 语义说明（评审 D 说明①）为非本轮回归，记 residual。

---

## 5. verdict 与 blockers

**verdict = BLOCKED**。

独立复现的正当理由：**required CI 失败**（SPEC §7.2 / §8.1.7 明文）——exact 集成 SHA 上零完成 CI（§2.1，本会话 `gh api` 复核）；叠加 **flake/occurrence 台账未按 §7.2 闭合**（§2.2/§2.3，两条新签名未登记）。产品代码无独立复现的 P0/P1；§3.2 全部契约面 PASS / receipt UNCHANGED。

### blockers（仅列 confirmed 且必须修复项）

1. **owner=ci — required CI 在 exact 集成 SHA 上从未完成（GitHub 计费，外部）**
   - summary：exact SHA `0b2e2d8a`（及 HEAD `a5df2c90`）从未获得完成的 CI 运行：run 42572487639 / 42593850473 的 Static checks 因账户计费未启动（annotation 原文已核），6 个 required job 全部 skipped；`gh pr checks 928` 语义 = FAIL (exit 1)。
   - evidence：§2.1 全部命令与输出（本会话实跑）；Issue #930 OPEN。
   - fix：计费恢复后在最终 exact SHA 的 clean tree 重跑完整 CI（Static checks + Build + coverage×3 + Production transport + E2E×2 全部 success）；保留 FAIL 记录不抹除；取得绿 CI 后按 SPEC §7.2 做增量复审（若期间有新提交进入集成线）。本地 `pnpm verify`/`pnpm e2e` 绿灯不替代 required CI（pr-body §Notes 自述）。

2. **owner=ci — flake/occurrence 台账未闭合：两条新签名未登记，#878 修复后无权威绿灯**
   - summary：(a) `:555 toBeFocused` 新签名（评审 C 实测 1F/3P，日志本会话实读）未登记；(b) 本轮新发现 A3-F7 `:341` 条件敏感失败（集成树本地 2F/1P；同代码 14:13 全绿、pr-865 控制实验通过、CI ≥4P，§2.3）未登记；(c) `1f29b614` 部分修复后 #878 仍 OPEN、`ROOT_CAUSE_CONFIDENCE=HYPOTHESIS`、4 处固定 150ms 残留（`:934/:1011/:1092/:1133`，评审 C grep 实证）、无 post-fix 权威 CI 绿灯。
   - evidence：§2.2/§2.3（本会话实跑/实读）；`docs/standards/test-flakes.md` grep 零命中；`gh issue view 878` → OPEN。
   - fix：将 `:555` 与 `:341` 两条 occurrence 登记进 #878 / OBS-2026-11-03-001（同测试同负载拓扑不同站点，除非证明独立根因；F-04 web 一次性并行失败作低优先观察项一并裁定），并补登 run 42483066387；按 Owner 既定 defer 路径，其干净成立依赖 blocker 1 的完整权威绿 CI。不把 #878 表述为"已修复"。登记属受控 docs 变更，走正常 commit（新 SHA 后按 §7.2 复审）。

> 不列为 blocker 的已确认项及理由：OpenAPI 顶层 `requestId`（master 预存制品漂移，运行时正确，四 PR 不使其恶化 → residual + follow-up）；`getWithMeta`（low，residual）；`observability.md:34`（一行文档修正，residual）；CHANGELOG/implementation-status/§9 其余交付物（显式 DEFER 留痕至最终 master merge，SPEC §8.4 本就规定合并后收口）；未跟踪的本裁决文档（本 ask 指定产物，最终合并前须 commit——并入合并条件而非本轮 blocker）。

---

## 6. residualRisks（接受 / 延期）

**接受（有 Owner 决策或边界声明）**
- nginx error log 携带 raw request line：Owner Decision A 显式接受（换 error 级故障诊断），web.conf 注释 / observability.md / operations / 测试钉住四处一致；`INFRA_LOG_ACCESS`（第三方 collector / 日志文件权限）= NOT_VERIFIED。
- #878 几何 flake：Owner 2026-11-09 明确 defer；证据链跨 ≥4 head / 双 shard；`HYPOTHESIS` 级置信不冒充 CAUSALLY_PROVEN；`expect.poll` 5s 有界预算不掩盖产品滚动回归（断言语义不变、前置断言加强——评审 C/D 一致 + 我方日志核对）。
- 429 状态路径 NOT_TESTED；header 在传输边界（连接销毁、socket framing、Node 超时、`FST_ERR_BAD_URL`）不可携带——文档声明边界，本轮未做故障注入。
- #922 归档含已接受的主机标识/地址类别与合成凭据；发布/共享前需 sanitization；SHA256SUMS 本会话复算 318/318 通过。
- 性能：本轮未重放基准。结构性核查：requestIdHeader 仅写响应头、成功路径无新增 DB 写/遥测写（wire 契约测试钉住 200 body 无 requestId；`git diff` 证实引擎/路由零改动）——无新增每请求成本的结构信号。

**延期（非产品缺陷、低危清理或留痕 DEFER）**
- OpenAPI 401/403 顶层 `requestId`（203 处）：master 预存制品漂移（§2.7）；follow-up = 修 `swagger.ts` fallback schema 并重新生成 `openapi.json`，单独授权处理。
- `observability.md:34` 示例参数名（`:id` → `:attemptId`）；ADR 索引 informational 附录括注（F-05，可选）。
- `getWithMeta` 零调用 forward surface：最终 master 收口时删除（连同契约文档句与测试断言）或取得 Owner 显式授权。
- P1 代表性夹具残差：web 单测以 `req-*` 模拟服务端 envelope/header（本会话抽样证实 `TakeExamPage.saveRejectionRequestId.test.tsx:272` `req-rej-865-001`、`TakeExamPage.saveFault.test.tsx:241` `req-500-abc` 等仍在）；不导致集成红（client 不校验形状），按 UUID_FIXTURE_RECONCILIATION §3 在下次触碰文件时统一。
- REVIEW_PROTOCOL low/P3：STALE_VERSION reconcile 分支发 `answer_autosave_success(saveMode:"stale_reconcile")` 的命名精度；Save 相关性测试手动注册 hook（建议后续 CI 补 boot 级 smoke）。
- A3-F7 `:341` 失败机制未定位（dropdown `not stable → detached` 的精确触发路径）；现有证据不支持产品回归定性，但登记后下轮应做条件画像（是否与并行容器栈/负载相关）。
- 合并路径机制：四个源 PR 按序 individual merge；集成树上的 docs 提交（`8061d547` 研究文档、`a5df2c90` ADR/登记册修复）与本裁决文档须经 closeout 提交进入最终 master；PR #928 为 CI-only、不直接合并。CHANGELOG / implementation-status / §9 其余交付物按 DEFER trace 在最终 master merge 落地（SPEC §8.4）。合并后须按 §8.3 跑 master smoke（SaveAnswer accepted/rejected、requestId correlation、cross-org、route projection、Pino、nginx、retention、production build）。
- 本轮未运行（不冒充已跑）：`pnpm verify` 全量、`pnpm test` 全量、全量 `pnpm e2e`（我运行的是 investigation-ui-acceptance 过滤套件与 pr-865 控制实验，非全量套件）、全量 lint/format/typecheck、nginx live 故障注入重放、归档内容语义复核（SHA256 字节校验已做）。
- 人工门禁：merge 属 AGENTS.md §7 人工门禁；READY_FOR_HUMAN_MERGE 仅表示"进入人工合并门禁"，本轮不执行任何 merge/push/commit。
- 并发写入：本会话执行期间检测到另一裁决进程覆写本文件（18:46）；两版裁决字段一致，最终以进入受控历史的一版为准。

---

## 7. 结论

四个 PR 构成一致、无重复实现、无协议扭曲的产品契约改进：requestId 四载体同源、客户端声明与服务器事实的信任边界在各面闭合、route 存储与读取封闭化、日志隐私在应用与边缘两层落地、SaveAnswer 业务契约零改动且 307 个定向测试（含真实 PostgreSQL 与浏览器级 M3/M4/M5）在本会话全部实跑通过。**合并的唯一剩余障碍是外部门禁而非产品**：required CI 因 GitHub 计费从未在集成 SHA 上完成，且 flake 台账欠两条 occurrence 登记。计费恢复 → 集成树（或其 docs 增量后的新 SHA）取得完整绿 CI → 台账闭合 → 增量复审后，本裁决的四个 KEEP_AND_MERGE 即可进入人工合并门禁（按 `#922 → #923 → #924 → #926` 顺序，逐个 merge 并按 SPEC §8.2/§8.3 复验）。

— 裁决员（本轮，基于四份 §7 独立评审），2026-11-09，exact SHA 0b2e2d8a（HEAD a5df2c90，docs-only 差异已说明）

---

## 附录 D — 交付文档编辑附记（2026-11-09，非裁决员结论）

> 本附录由「交付文档编辑」角色追加，**不属于裁决员的独立裁决正文**，不改写上文任何 verdict、blockers、字段或逐 PR disposition。上文仍是本文件唯一的权威裁决内容：**verdict = BLOCKED**；决定性 blocker 1（clean-tree exact-SHA required CI FAIL，外部 GitHub 计费）、blocker 2（flake/occurrence 台账未闭合 / #878）均未解决；四个 PR 均 KEEP_AND_MERGE；产品契约面 PASS / `SAVEANSWER_RECEIPT_SEMANTICS = UNCHANGED`；未合并、未发布、未授权任何 merge。

**并发版本说明（如实记录）**：本会话检测到本文件被并发裁决进程覆写，先后观察到两版——18:46 的「第 3 轮 · 独立重裁」（verdict BLOCKED、2 blockers、4×KEEP_AND_MERGE、11 PASS + 1 UNCHANGED、NO_COMMIT）与 18:57 的「本轮 · 基于四份 §7 独立评审的独立复现裁决」（verdict BLOCKED、2 blockers、4×KEEP_AND_MERGE、307 定向测试 + 318/318 归档校验实跑、新增 A3-F7 `:341` 一手证据）。两版在**全部裁决字段上一致**（BLOCKED / KEEP_AND_MERGE / CI FAIL / 未合并 / 未发布 / receipt UNCHANGED），差异仅在 exact-SHA 口径（前者以 `a5df2c90` 为被审 SHA，后者以 `0b2e2d8a` 为四 PR 合并完成点、`a5df2c90` 为其上的 docs-only 提交）与证据台账规模；两 SHA 的产品代码逐字节一致。按本任务「以最新裁决为准」，本文件当前保留 18:57 版本；本附录与其结论一致，且以进入受控 Git 历史的这一版为准。

本轮交付文档编辑在同一集成分支上落地 SPEC §9 的剩余交付物与证据副本：

- 复制 7 份评审到 `reviews/`（`REVIEW_SECURITY.md`、`REVIEW_PROTOCOL.md`、`REVIEW_CI_FLAKE.md`、`REVIEW_ARCHITECTURE_DOCS.md`、`REVIEW_FIXTURES_FLAKE.md`、`REVIEW_RERUN_1.md`、`REVIEW_RERUN_2.md`，字节一致）；
- 新增 6 份交付文档（`PRODUCT_BEHAVIOR_MATRIX.md`、`SAVEANSWER_END_TO_END.md`、`SECURITY_AND_PRIVACY_VERIFICATION.md`、`DOCUMENTATION_CONSISTENCY_AUDIT.md`、`PERFORMANCE_AND_CI.md`、`FINAL_INTEGRATION_RECORD.md`）与 `SHA256SUMS`；保留既有 4 份研究文档与本裁决文件；
- 按 SPEC §5 核查并最小更新长期文档（`docs/contracts/observability.md`、`docs/operations/save-failure-evidence.md`、`docs/architecture/exam-system/security-model.md`、`docs/adr/ADR-025-…md` 只加信息性附录、`docs/standards/test-flakes.md` 补登两条 occurrence）；其余 4 份核查后无需改动；README / CHANGELOG 按 `docs/releasing.md` 的发布规范不更新（`## [Unreleased]` 保持为空，未发生发布）。

这些动作把证据纳入受控 Git 历史，满足 SPEC §9「不能依赖未跟踪 `.tmp` 作为唯一交付依据」在**集成分支**上的要求；它们**不改变**上文 verdict，也**不完成** SPEC §8.4 的最终 master 收口条件（CHANGELOG / implementation-status 更新、四 PR 逐个合并、门禁绿后的 master smoke）。补登两条 occurrence 只闭合 blocker 2 的「登记」信息面，其闭合前置（#878 Acceptance 或 defer 依赖的完整权威绿灯）仍缺，blocker 1 决定性未解 ⇒ verdict 仍 BLOCKED。本轮为纯文档提交，产品代码、测试、`@exam/contracts` Schema、SaveAnswer 契约与授权代码零改动，故上文针对 `0b2e2d8a` / `a5df2c90` 代码内容的裁决对新 HEAD 的代码事实仍逐字节成立；但**新 HEAD 本身未重新取得 required CI 绿灯**，本次交付时点 `gh pr checks 928` 仍为 FAIL (exit 1)、head_sha run 为 failure、0 green run（外部 GitHub 账户计费，代码/文档改动不能修复）。

分支仍是 `integration/production-closure-20261109` 上的 **Draft PR #928（CI-only，do not merge directly）**；四个源 PR #922 / #923 / #924 / #926 仍为 OPEN / draft / `mergedAt=null`；master 仍为 `5140c3dd…`，集成树未合并。**未合并、未发布。** 交付物清单、命令与退出码、残留风险见 `FINAL_INTEGRATION_RECORD.md` 与 `DOCUMENTATION_CONSISTENCY_AUDIT.md`。

— 交付文档编辑，2026-11-09
