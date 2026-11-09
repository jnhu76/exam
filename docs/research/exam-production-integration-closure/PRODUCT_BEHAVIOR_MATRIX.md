# PRODUCT_BEHAVIOR_MATRIX — 四 PR 集成后的全局产品行为矩阵

- 状态：**最终交付文档**（SPEC §4.1 / §9 交付物 5）。只读记录当前集成树的 as-built 行为，不修改产品代码。
- 任务给定的 exact 集成 SHA：`52a58d4da7ec51423381510d5e19bff6425965b7`（本轮收口时点 = worktree HEAD = PR #928 headRefOid；本会话 `git rev-parse HEAD` 实查一致）。自四 PR 合并完成点 `0b2e2d8a1653ebba59326517ec2fdc6b4c7cf4bc` 起的全部演进（含早期收口时点 `a5df2c90…`）均为纯 docs 提交，产品代码逐字节一致；本矩阵全部代码锚点对该代码树有效。
- 分支 / PR：`integration/production-closure-20261109` → Draft PR #928（CI-only，do not merge directly）；本会话 `gh pr view 928` 实查 `state=OPEN, isDraft=true, mergedAt=null, mergeStateStatus=CLEAN, headRefOid=52a58d4d…`。
- 裁决权威：`FINAL_PRODUCT_ADJUDICATION.md`（**第 3 轮**，2026-11-09）：**verdict = READY_FOR_HUMAN_MERGE** —— required CI 门禁已由 exact SHA `52a58d4d` 上 run 42611431690 **attempt 2** 全绿解除（8 job 全 success，`gh pr checks 928` exit=0，本会话实查；历史 FAIL run 全部保留）；四个 PR 均 **KEEP_AND_MERGE**，产品运行时契约 **11 PASS + `SAVEANSWER_RECEIPT_SEMANTICS = UNCHANGED`**。merge 属人工门禁，未执行；**未合并、未发布**。
- 本会话实查：`gh api repos/jnhu76/exam/actions/runs/42611431690` → `conclusion=success, run_attempt=2`；`gh pr checks 928` → `PR_CHECKS_EXIT=0`；四个源 PR #922/#923/#924/#926 全 `OPEN / draft=true / mergedAt=null`；#878 / #930 均 OPEN；master `5140c3dd…`；`git merge-base --is-ancestor 52a58d4d master` → exit 1（未合并）。
- 证据纪律：代码锚点为本会话 `grep` / `nl` 实读；测试数字来自给定材料（四份评审、`FINAL_PRODUCT_ADJUDICATION.md`、`pr-body.md`、`.tmp/production-closure/logs/`），本会话**未复跑**全量测试套件，不把给定材料报为本会话实跑。

---

## 1. 全局行为矩阵（SPEC §4.1）

| 系统 | 必须保持的一致性 | 权威实现锚点（本会话实读） | 裁决 |
| --- | --- | --- | --- |
| HTTP 请求身份 | UUIDv4 由服务端唯一铸造；客户端头不可影响 | `apps/api/src/server.ts:3` `import { randomUUID } from "node:crypto"`、`:117` `genReqId: () => randomUUID()`、`:119` `requestIdHeader: false`；ADR-025 decision 1/2 | **PASS** |
| 响应头 | `X-Request-Id` 与 `request.id` 相等（同一值，不二次铸造） | `apps/api/src/plugins/requestIdHeader.ts:34-35` root-scope `onRequest` `reply.header("x-request-id", request.id)`；`server.ts:140` `setupRequestIdHeader(app)` 注册于任何 scope 之前 | **PASS** |
| 错误信封 | 与 HTTP 请求 ID 一致，`requestId` 嵌套在 `error` 内 | `packages/contracts/src/common.ts` `ErrorResponseSchema`；`apps/api/src/lib/errorResponse.ts` `buildErrorResponse(request.id,…)`；`docs/contracts/api-contract.md:93` | **PASS** |
| Pino | `reqId` 关联同一次请求；请求行不落原始 URL | `apps/api/src/lib/logRedaction.ts` `routeTemplateOf` / `serializeReqForLog`；`apps/api/src/server.ts` req 串行器 | **PASS** |
| Audit | 有审计记录时引用同一 ID；系统行不伪造 | `apps/api/src/audit/auditWriter.ts:83` HTTP writer 注入 `truncate(String(request.id),128)`；`systemEvent()` 不注入 | **PASS**（见 §2 N/A） |
| 客户端遥测 | `requestId` 仅为未核验声明，受形状门控 | `apps/api/src/lib/proctorMonitoringService.ts:211` `REQUEST_ID_UUID_SHAPE`、`:230-234` 仅合法 UUID 字符串进入投影、`i18n/locales/zh-CN.ts:1784/2186` 「客户端声明，未经服务端核验」 | **PASS** |
| SaveAnswer | receipt 和领域状态仍为业务权威；`requestId` 不参与成功判定 | `apps/web/src/pages/exam/TakeExamPage.tsx:915` `if (result.accepted)`；`packages/contracts/src/attempt.ts:218-246` 两个 `.strict()` schema；`git diff` 对 receipt/engine/route 零改动 | **PASS / UNCHANGED** |
| Route | 存储与读取使用封闭安全模板；历史行读时再投影、免迁移 | `apps/api/src/routes/clientEvents.ts:118` `route: projectClientEventRoute(event.route)`；`apps/api/src/lib/proctorMonitoringService.ts:72` 读侧再投影；`packages/contracts/src/clientEventRoute.ts` | **PASS** |
| nginx access log | 结构化、必要字段、无原始 URL | `deploy/nginx/web.conf:49` `log_format exam_privacy`（固定 `$exam_route`）、`:64` `access_log … exam_privacy` | **PASS** |
| nginx error log | `error` 级原生诊断，已接受隐私残余风险 | `deploy/nginx/web.conf:65` `error_log /var/log/nginx/error.log error;`；Owner Decision A（`web.conf:33-47`、`observability.md:114-131`） | **PASS（含已接受残余）** |
| 数据保留 | `client_events` 30 天策略不变 | `apps/api/src/plugins/clientEventRetention.ts:36` daily sweep、`:61-62` `receivedAt < cutoff`、startup convergence；INV-CE-004 | **PASS / UNCHANGED** |
| 跨租户权限 | 不因关联功能新增访问能力 | `apps/api/src/routes/proctorMonitoring.crossOrg.test.ts`（跨组织 404、防枚举、合法 UUID claim 不开可见性）；`authz` / `attempts` 生产路径无 client-claimed `requestId` 读者 | **PASS** |

矩阵结论：SPEC §4.1 列出的 12 个系统面在集成树全部适用且验证通过；`SAVEANSWER_RECEIPT_SEMANTICS` 保持 **UNCHANGED**。第 1/2 轮的 **BLOCKED** 由 required CI 门禁失败（外部账户计费）驱动，与任一产品契约面的 PASS 正交；该门禁已在 exact SHA `52a58d4d` 上由 run 42611431690 attempt 2 全绿解除（第 3 轮裁决 READY_FOR_HUMAN_MERGE），merge 待人工门禁。

---

## 2. 不适用载体（N/A，SPEC §4.1 要求显式标注）

「系统面适用」不等于「每个 HTTP 请求都有每个载体」。以下 N/A 是当前产品的有意边界，不是缺陷：

| 载体 | N/A 场景 | 依据 |
| --- | --- | --- |
| Error envelope `error.requestId` | 所有 2xx 成功 / 业务拒绝响应（无标准化错误信封）；`accepted:false` 200 body 由 `.strict()` schema 保证不含 `requestId` | `packages/contracts/src/attempt.ts:229-246`；`docs/contracts/api-contract.md:93` |
| Audit `metadata.requestId` | 不是每个 HTTP 请求都写 audit 行；系统/后台行不注入 HTTP 请求 id | `docs/contracts/observability.md:92-95`；`auditWriter.ts` |
| `x-request-id` 响应头 | 响应从未发出：连接中途销毁、socket 级 HTTP framing 失败、Node request/keepAlive 超时；router lookup 前的框架错误（如 `FST_ERR_BAD_URL`） | `apps/api/src/plugins/requestIdHeader.ts:16-22`；`docs/contracts/observability.md:86-91` |
| OPTIONS / CORS 预检 400 | `strictPreflight` 协议拒绝不是标准化 API 错误，carries no `requestId` | `docs/contracts/api-contract.md:141` |
| 客户端 telemetry `requestId` | 作为**独立服务器证据**永远 N/A——它是未核验声明，不能单独证明任何服务端事实 | `docs/operations/save-failure-evidence.md:22, 90-97` |
| `requestId` 作为保存成功证明 | 永远 N/A——保存成功只由 `accepted === true` / receipt / 领域状态决定 | `TakeExamPage.tsx:915`；`docs/contracts/observability.md` §Save success, retries and UNKNOWN |

---

## 3. 权威分层（不混淆）

| 层 | 权威 | 非权威 / 禁止升级 |
| --- | --- | --- |
| HTTP 请求身份 | 服务端 `randomUUID()`（`server.ts:117`） | 客户端 `request-id` / `X-Request-Id` 头（`requestIdHeader: false`）；客户端声明的合法 UUID 形状 ≠ 已核验身份 |
| 保存结果 | `accepted: true` + `exam_answer_save_receipts` + `exam_attempts.answers` | `x-request-id`、`error.requestId`、客户端 `answer_autosave_failed` telemetry |
| 调查证据 | 服务端 request log / `Answer save rejected` WARN / receipt / domain state | 仅客户端可见的请求编号、错误 banner 文本、时间窗内近似匹配 |
| 故障分类 | F1–F6 + UNKNOWN 边界 | 「没有 row / 没有日志」= 证据缺口，绝不证明请求未到达 |

---

## 4. 逐 PR 产品价值裁决（SPEC §4.2，与全局 verdict 正交）

| PR | disposition | 真实产品收益 | 主要残余 |
| --- | --- | --- | --- |
| #922 | KEEP_AND_MERGE | 安全/性能证据进入版本控制，`sha256sum -c SHA256SUMS` 318/318 可 clean-checkout 复算（给定材料） | 归档含已接受的主机标识/地址类别与合成凭据，发布/共享前需 sanitization |
| #923 | KEEP_AND_MERGE | `projectClientEventRoute` 封闭词表投影消除任意 route 原始 pathname 落库；ingest+read 双侧、历史行读时重投影免迁移、fail-closed；UUID shape gate 防管理员时间线内容注入 | 词表人工镜像、不可达 `MAX_INPUT_LENGTH`、P1 `req-*` 代表性夹具 |
| #924 | KEEP_AND_MERGE | 补齐 2xx 侧第四载体 `x-request-id`；CORS `exposedHeaders` 真实缺陷修复；200 `accepted:false` 考生可见「请求编号」+ Pino WARN 按 reqId 关联 | `getWithMeta` 零生产调用方、429 路径 NOT_TESTED、web 单测 `req-*` 残差 |
| #926 | KEEP_AND_MERGE | Pino 请求行与应用侧日志不再落原始 URL（`routeTemplateOf` 单一权威）；nginx `exam_privacy` access log；`error` 级诊断按 Owner Decision A 恢复并显式接受残余 | nginx error log raw request line 残余（已接受有界）、第三方 log collector `NOT_VERIFIED`、`/healthz` 探针语义 |

四个 PR 同为 KEEP_AND_MERGE 也**不授权**任何合并：merge 属 AGENTS.md §7 人工门禁，按裁决 §5 以 `#922 → #923 → #924 → #926` 顺序逐个 ready + merge（#928 不直接合并）。当前四个源 PR 仍 OPEN/draft，未合并到 master，未发布；全局门禁已绿（exact SHA `52a58d4d` run 42611431690 attempt 2）。

---

## 5. 验证边界（诚实声明）

- 本会话实跑：`gh api …/runs/42611431690`（绿 run 取证）、`gh pr checks 928`（exit 0）、PR / Issue 状态、`git` 差异/祖先/状态、代码锚点 `grep`、**`pnpm format:check` 与 `pnpm docs:build`**（见 `DOCUMENTATION_CONSISTENCY_AUDIT.md` §8 / `PERFORMANCE_AND_CI.md` §8 的命令与退出码）。
- 本会话**未复跑**：`pnpm verify` 全量、`pnpm test` 全量、`bash scripts/e2e/run.sh` 全量、浏览器级 E2E、nginx 容器故障注入、性能基准。矩阵中的测试数字来自给定材料（四份评审、历版裁决的 307 / 342 定向测试、`pr-body.md` 的本地 gates 表、`logs/`）与绿 CI run 42611431690 attempt 2（exact SHA 上 8 job 全 success，含两个 E2E shard），不作为本会话本地复跑。
- required CI 已在 exact SHA `52a58d4d` 上全绿（run 42611431690 attempt 2；历史 FAIL run 为外部计费、保留未删）。本矩阵不声称已合并、不声称已发布；交付提交自身触发的新 run 结局由 GitHub run 历史承载（`FINAL_INTEGRATION_RECORD.md` §10.4）。
