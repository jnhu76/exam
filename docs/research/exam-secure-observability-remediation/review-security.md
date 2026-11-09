# review-security.md — Security / Privacy Red Team（契约 §7.1 Subagent A）

- 评审日期：2026-11-09
- Reviewed SHA（集成 HEAD）：`5d4b2773cf62f93e40fa5661e0d5e19700f40b17`（worktree
  `/home/hoo/Source/exam-gap-worktrees/integration-final`；任务文本中的截断 SHA
  `5d4b2773cf62f93e1970f40b17` 经 `git rev-parse HEAD` 修正为上值）
- 冻结 master 基线：`5140c3dd0f9dbde1bdad8f5b757161f3ed96945d`
- 四 PR exact HEAD 核对：#922 `7243aa5c`、#923 `871d0a4f`、#924 `872a244f`、
  #926 `a9155634`（`git log --oneline -5` 显示四个 merge commit 与之一致）
- 评审方式：只读静态审计 + 隔离一次性反例探测（/tmp，用后即删）+ 在集成 worktree
  上按文件运行真实测试（真实 PostgreSQL 隔离测试库，由仓库 vitest 生命周期创建/删除）。
  未修改任何受控文件；未 commit/push。

## Reviewed files

代码（集成 HEAD，均相对 worktree 根）：

- `packages/contracts/src/clientEventRoute.ts`（新，封闭投影实现）
- `packages/contracts/src/sanitizeClientEvent.ts`（metadata sanitizer）
- `packages/contracts/src/clientEvent.ts`（wire 尺寸上限：route≤500、metadata≤32KiB）
- `packages/contracts/src/proctorMonitoring.ts`（timeline DTO）
- `apps/api/src/routes/clientEvents.ts`（ingest 投影，:118）
- `apps/api/src/lib/proctorMonitoringService.ts`（读取端投影 :68-104、
  SAFE_METADATA_ALLOWLIST :183-197、SAVE_ERROR_METADATA :162-170）
- `apps/api/src/plugins/requestIdHeader.ts`（新，root-scope x-request-id）
- `apps/api/src/server.ts`（genReqId=randomUUID、requestIdHeader:false、
  req serializer、root 404 boundary 条件注册）
- `apps/api/src/plugins/cors.ts`（fp-wrap + exposedHeaders x-request-id）
- `apps/api/src/plugins/errors.ts`、`rootNotFoundBoundary.ts`、`apiSurface.ts`
- `apps/api/src/lib/logRedaction.ts`（routeTemplateOf / serializeReqForLog /
  serializeErrorForLog / REDACT_CONFIG）
- `apps/api/src/authz/{scopedCapability,examEligibilityCapability,ownAttemptCapability,scoreCapability}.ts`
  （request.url → routeTemplateOf 替换，13 处）
- `apps/api/src/routes/scores.ts`（同上 1 处）
- `apps/api/src/plugins/clientEventRetention.ts`（未逐行，经其 772 行契约测试覆盖）
- `packages/db/src/repository/clientEventRepo.ts`（route 列全读取端枚举）
- `apps/web/src/lib/api.ts`（postWithMeta / headerRequestId / correlation mismatch warn）
- `apps/web/src/pages/exam/TakeExamPage.tsx`（saveRejectionRequestId 状态机）
- `apps/web/src/lib/logger.ts`、`apps/web/src/lib/sanitizeClientEvent.ts`（re-export）
- `deploy/nginx/web.conf`（exam_privacy access 格式 + error_log error）
- 测试：`clientEventRoute.test.ts`、`spaRouteTemplateVocabulary.test.ts`、
  `clientEvents.test.ts`、`proctorMonitoring.test.ts`、`proctorMonitoring.crossOrg.test.ts`、
  `requestIdWireContract.test.ts`、`requestIdStatusMatrix.test.ts`、
  `requestIdRateLimit.test.ts`、`server.requestId.test.ts`、`requestIdSaveRejection.test.ts`、
  `httpLogPrivacyWire.test.ts`、`nginxWebConf.test.ts`、
  `clientEventRetention.contract.test.ts`、`TakeExamPage.saveRejectionRequestId.test.tsx`、
  `api.test.ts`、e2e `investigation-ui-acceptance.spec.ts`（仅审阅，未运行）

证据（s0-evidence）：`07-NGINX-DIAGNOSTICS-AND-PRIVACY.md`、
`08-CLIENT-EVENT-RETENTION-VERIFICATION.md`、`09-HISTORICAL-DATA-AND-BACKUP-BOUNDARY.md`、
`10-INTEGRATION-CI-AND-PERFORMANCE.md`（安全数字三行）、
`raw/nginx-fault-injection/`（MANIFEST、confs/web-error.conf、canary-master-scan）、
`raw/replay-db-routestorage.txt`。

## Threat / invariant coverage

| # | 威胁/不变量（契约 §7.1 Subagent A 职责） | 结论 | 依据（本 session 实跑/实读） |
| --- | --- | --- | --- |
| T1 | #923 路由封闭输出可绕过（输出集合逃逸） | 未发现绕过 | 我方 41 个对抗反例（含 RT-3/8/12B/12C/13/14B 再现 + 新反例：`\x00`/`\t` 剥离、大写 scheme、反斜杠、protocol-relative、全路径百分号编码、CRLF、2500 超长、unicode 动态段）全部输出为 `SPA_ROUTE_TEMPLATES` 成员或 `null`；49 模板读取端幂等 0 失败。命令：`node run-probe.mjs`（/tmp/sec-review-probe，源文件用 worktree `node_modules/.bin/tsc` 从集成 HEAD 源码编译）→ `total=41 leaks=0`、`idempotence … failures=0` |
| T2 | legacy 数据其他未保护读取端 | 未发现 | 独立 grep：`client_events` 的 `route` 列仅在 `clientEventRepo.ts:235`（listTimelinePrefixByAttempt SELECT）带出，唯一消费者 `proctorMonitoringService.ts:72` 强制 `projectClientEventRoute`；:103 为 insert 值。`apps/api` 全部 `clientEvent` 消费者逐一检查（clientEvents.ts / proctorMonitoring.ts / proctorMonitoringService.ts / clientEventRetention.ts / operabilityMonitor.ts / attempts.admin.ts 仅注释 / registerApiRouteModules.ts / server.ts），无第二个返回 route 的端点；attempt JSON/CSV 导出（attempts.admin.ts:500-605）只含答案快照。与 08 号文件 §5.4"4 个 SELECT"审计独立交叉一致 |
| T3 | #924 requestId 被错误视为凭据 | 未发现 | 服务端：`server.ts:117-119` `genReqId: () => randomUUID()` + `requestIdHeader: false`（客户端 header 不影响 request.id）；`requestIdWireContract.test.ts:158` "client-forged x-request-id / request-id / traceparent never influence the value" 实跑通过。客户端：`api.ts` ApiResponseMeta 注释 "never a credential or business identity…OPAQUE"；timeline 投影注释（proctorMonitoringService.ts:152-161）明确 client-claimed correlation candidate，无任何以 requestId 为键的授权判定。跨租户反例（T6）实测它不授予访问 |
| T4 | SaveAnswer 失败遥测泄露答案/用户数据/非授权信息 | 未发现 | 失败遥测 metadata 仅 `saveMode/durationMs/errorCode/clientSeq(/requestId)`（TakeExamPage.tsx:970-984）；无 answer 内容。ingest 双侧 sanitize（web logger + API `sanitizeClientEvent` 共享实现，web 侧为 re-export）；读取端 `SAVE_ERROR_METADATA` allowlist + `projectSafeMetadata` 默认拒绝。`requestIdSaveRejection.test.ts`（真实 PG）断言 200 拒绝响应 body 不含 requestId、header==服务端 WARN 日志 reqId；`clientEvents.test.ts` 25 用例（含 RT 攻击矩阵）通过 |
| T5 | #926 access log 重新泄露原始 URL | 未发现 | `deploy/nginx/web.conf:49-52`：`$request_method $exam_route`，`$exam_route` 为 location 内固定值 `/api`/`/spa`；禁用变量由 `nginxWebConf.test.ts:72-80` pin（`$request`/`$request_uri`/`$uri`/`$http_referer|cookie|authorization` 全禁，实跑 5 passed）；HTTPS 注释模板同格式同级别被 pin（:82-85）。07 号文档 22 次容器运行 canary 扫描 access log 0 命中。Pino 侧：`serializeReqForLog` 替换默认序列化器（server.ts:120-128）、rootNotFoundBoundary 替换 basic404（raw url 日志）、authz/errors/scores 全部 14 处 `request.url` 改 `routeTemplateOf`；全仓 grep `request.url|raw.url|req.url` 无生产日志残留（仅注释） |
| T6 | 跨租户、跨角色负例 | 通过 | `proctorMonitoring.crossOrg.test.ts` 实跑 7/7 passed（真实 PG）：Org A Proctor → Org B 监控/时间线/事件 404 anti-enumeration（含 MUTATION B kill point）；**client-claimed requestId 注入 telemetry 后跨 org 仍 404、同 org 正控制可见**（#924 专属负例）；`requestIdStatusMatrix.test.ts` 覆盖 401/403/409/500 + 顺序请求 fresh id |
| T7 | nginx error log 风险接受记录准确性（不与 access log 混同） | 记录准确（一处标注歧义见 F1） | 07 号文档 §4 拆分四行结论（ACCESS=PASS / ERROR_DIAG=PASS / RAW_URL_RISK=ACCEPTED / INFRA=NOT_VERIFIED），§2 crit/error/warn 实测对比（warn 新增 uninitialized-variable 泄露面）、§3 六项部署 UNKNOWN 清单；web.conf:33-47 注释同语义。无"所有 nginx 日志已脱敏"的合并声明 |
| T8 | 契约红线：成功路径新增持久化遥测 / requestId DB 表 | 未违反（采信证据报告，未复跑 perf） | `10-INTEGRATION-CI-AND-PERFORMANCE.md` §3 保护指标表：NEW_SUCCESS_TELEMETRY_WRITES=0（三重证据）、NEW_REQUEST_ID_DB_WRITES=0（隔离库 schema diff 逐字节相同、repo 层 grep 0、migrations diff 空）；与我方静态审计一致（TakeExamPage 成功分支无新 trackExamEvent；db 层无 requestId 列/方法） |

对抗性覆盖矩阵（§7.3）：

- 正常路径：`requestIdStatusMatrix`（200/204 + fresh id）+ `requestIdSaveRejection`
  positive control（accepted save 也带 header）— 实跑通过。
- 错误路径：`requestIdStatusMatrix`（401/403/409/500）、真实 HTTP 200 业务拒绝
  （`requestIdSaveRejection`：header==rejection WARN reqId、body 无 requestId）、
  transport failure（web `TakeExamPage.saveRejectionRequestId.test.tsx`）— 实跑通过。
- 并发/生命周期边界：`clientEventRetention.contract.test.ts` 8/8（并发 ingest+cleanup
  双物理连接、shutdown 等待 in-flight sweep、restart 补偿、单 org 失败隔离与恢复）；
  web "old attempt's delayed rejection never writes the new attempt's state" — 实跑通过。
- 跨权限边界：crossOrg 7/7（见 T6）。
- 现有测试尚未充分覆盖的反例：我方 41 个自建投影反例（多个不在现有 60 用例内：
  `\x00` 剥离、大写 scheme、`\` 路径、protocol-relative、2500 超长、全百分号编码）
  — 全部 fail-closed；另识别 F2/F3 两个测试缺口。

## Concrete findings

### F1 — 07 号文档受测对象标注与最终交付物之间的证据链歧义

- 位置：`07-NGINX-DIAGNOSTICS-AND-PRIVACY.md` 头部（"受测对象：…@ `623bc4b4…` 的
  `deploy/nginx/web.conf`（Decision-A 形态…），sha256 `4edca523…ddc0053`"）；
  `raw/nginx-fault-injection/MANIFEST.md:17`。
- 问题：`623bc4b4` commit 的 web.conf 实为 **crit** 版（我核对的版本链：
  d7c85b59=c5747fc2 → c813360b=e65cd9f9 → a9155634=ff4f7518，无任何 commit 的
  hash 等于 4edca523）；实测对象是 pr-log-privacy worktree 的**未提交** Decision-A
  状态（快照 `confs/web-error.conf`，4edca523），与最终交付文件（ff4f7518 =
  集成 HEAD = a9155634，`git diff a9155634..HEAD -- deploy/nginx/web.conf` 为空）
  差 **4 行注释**（把"warn 级 uninitialized-variable 泄露"实测发现回填进注释），
  指令字节（resolver/log_format/access_log/error_log/两个 location 的 set 与
  proxy 头覆写）逐字节等同（`diff confs/web-error.conf …/web.conf` 仅 43-47 注释行）。
- Reproduction：`git -C integration-final log --all --format=%h -- deploy/nginx/web.conf`
  逐版本 `git show $c:deploy/nginx/web.conf | sha256sum`；
  `diff raw/nginx-fault-injection/confs/web-error.conf integration-final/deploy/nginx/web.conf`。
- 影响：不改变安全结论（受测指令与交付指令等同；4 行注释差异恰是把实测发现写回
  文档），但 07 正文单独阅读时会让人误以为 623bc4b4 commit 本身就是 Decision-A
  形态，需交叉 MANIFEST 才能还原。
- Severity：P3（证据链可追溯性瑕疵，非代码缺陷）。
- 标签：CONFIRMED。
- Proposed minimal fix：07 号文档头部补一句："实测快照 = `confs/web-error.conf`
  （4edca523，worktree 未提交 Decision-A 状态）；最终交付 a9155634（ff4f7518）
  与快照仅差 4 行注释（§2 warn 泄露发现的回填），指令逐字节等同。"

### F2 — proctor timeline 的 client-claimed `metadata.requestId` 无格式/长度形状约束

- 位置：`apps/api/src/lib/proctorMonitoringService.ts:162-170`（SAVE_ERROR_METADATA
  allowlist 含 `requestId`）、:206-228（`projectSafeMetadata` 对 string 值原样投影）；
  wire 上限 `packages/contracts/src/clientEvent.ts:24`（metadata 整体 ≤32KiB）。
- 问题：恶意 authenticated 客户端可自发一条 `answer_autosave_failed` 事件，把
  `metadata.requestId` 设为任意 ≤32KiB 字符串（他人真实 UUID、非 UUID 文本、
  钓鱼文案），经 allowlist 投影后在授权 proctor timeline 以"请求编号"语义展示。
  该值定位已正确标注为 client-claimed correlation candidate（:152-161 注释 + UI
  "客户端声明，未经服务端核验"标签），不授予任何访问权（T6 跨 org 实测 404），
  服务端日志关联也不受影响——但"候选值无形状 gate"意味着调查者需要额外警惕
  被故意伪造的 requestId 指向无关请求。跨租户正控制测试（crossOrg :227-297）
  本身就以任意字符串 `req-cross-org-<uuid>` 作为 claimed 值通过，证明无 gate。
- Reproduction：静态审计 + 上述测试行为；未单独构造恶意注入运行（注入通路与
  已跑通的正控制相同，仅值内容不同）。
- Severity：P3（调查误导/内容注入到授权 UI，无越权、无答案泄露；信任标注已存在）。
- 标签：INFERRED（通路与无 gate 为 CONFIRMED 事实；实际社工影响为推断）。
- Proposed minimal fix：`projectSafeMetadata` 对 `requestId` 键加形状 gate
  （如 ≤64 chars 且 UUID 形状，不符则丢弃该键——非 UUID 不投影），一行 allowlist
  级改动；或在 timeline UI 值渲染处截断。不建议做语义校验（保持 client-claimed 定位）。

### F3 — 契约 §3.4 "Heartbeat 的 requestId 不覆盖 SaveAnswer 拒绝 ID" 缺直接负例测试

- 位置：`apps/web/src/pages/exam/TakeExamPage.tsx`（saveRejectionRequestId 写入点
  仅 4 处：:736 reset、:921/:951 SAVE_SUCCESS、:969 拒绝同点覆写；heartbeat 失败
  路径 :1237-1243 只写 `setSaveFaultRequestId`，与 rejection 状态分离——结构性满足）；
  `TakeExamPage.saveRejectionRequestId.test.tsx` 11 个用例无 heartbeat 交互负例。
- Reproduction：`grep -n "setSaveRejection\b" TakeExamPage.tsx`（4 写入点）+
  `sed -n '1237,1252p'`（heartbeat 仅写 saveFaultRequestId）；测试名清单 grep
  无 heartbeat 用例。
- Severity：P3（测试缺口；当前代码结构已满足契约语义）。
- 标签：CONFIRMED（缺口本身）；当前实现满足契约为静态确认。
- Proposed minimal fix：`TakeExamPage.saveRejectionRequestId.test.tsx` 增加一条：
  rejection 展示后触发 heartbeat 5xx 失败（携带 envelope requestId），断言 rejection
  alert 与其 requestId 不变、server-fault banner 独立更新。

### F4 —（非缺陷，边界确认）legacy at-rest 残留与备份 UNKNOWN 的记录如实

- 位置：`09-HISTORICAL-DATA-AND-BACKUP-BOUNDARY.md`（备份保留/加密/权限全
  UNKNOWN，恢复后 legacy 字节重现且读取端仍投影）；`raw/replay-db-routestorage.txt`
  （真实 DB 转储显示 RT canary 原始字节仍在库中）；retention 契约测试 8/8 +
  `proctorMonitoring.test.ts` "#864 LEGACY rows" 16/16 实跑通过。
- 结论：Decision B 的"不隐藏历史原始字节仍存在"要求被诚实执行。列此条为对
  Owner 风险接受边界的确认，不要求修复。
- 标签：CONFIRMED（as-designed）。

## 本 session 实际运行的命令与结果（可复核）

均在 `/home/hoo/Source/exam-gap-worktrees/integration-final` 对应 package 目录：

| 命令 | 结果 |
| --- | --- |
| `node run-probe.mjs`（/tmp/sec-review-probe；源码经 worktree tsc 编译） | 41 反例 0 leak；49 模板幂等 0 失败 |
| `pnpm exec vitest run src/routes/proctorMonitoring.crossOrg.test.ts`（apps/api，真实 PG） | 7 passed |
| `pnpm exec vitest run src/routes/requestIdWireContract.test.ts src/routes/requestIdStatusMatrix.test.ts src/routes/requestIdRateLimit.test.ts src/server.requestId.test.ts` | 4 files / 17 tests passed |
| `pnpm exec vitest run src/__tests__/clientEventRoute.test.ts`（packages/contracts） | 60 passed |
| `pnpm exec vitest run src/plugins/clientEventRetention.contract.test.ts`（真实 PG） | 8 passed |
| `pnpm exec vitest run src/nginxWebConf.test.ts src/routes/httpLogPrivacyWire.test.ts` | 12 passed |
| `pnpm exec vitest run src/routes/attempts/requestIdSaveRejection.test.ts`（真实 PG） | 2 passed（注：与 clientEvents.test.ts 同批并发首跑 vitest 崩溃，单跑通过——测试隔离 DB 并发资源问题，非断言失败） |
| `pnpm exec vitest run src/routes/clientEvents.test.ts`（真实 PG） | 25 passed |
| `pnpm exec vitest run src/routes/proctorMonitoring.test.ts`（真实 PG，含 #864 LEGACY rows） | 16 passed |
| `pnpm exec vitest run src/pages/exam/TakeExamPage.saveRejectionRequestId.test.tsx src/lib/api.test.ts`（apps/web） | 2 files / 52 tests passed |
| `sha256sum deploy/nginx/web.conf` + `git diff a9155634..HEAD -- deploy/nginx/web.conf` | ff4f7518…；diff 为空（HEAD == #926 PR HEAD） |
| `git log --all --format=%h -- deploy/nginx/web.conf` + 逐版本 sha256 | 见 F1 |
| `diff raw/…/confs/web-error.conf integration-final/deploy/nginx/web.conf` | 仅 4 行注释差异 |

未运行（如实标注）：

- `apps/e2e/e2e/investigation-ui-acceptance.spec.ts`（真实浏览器 E2E）：NOT RUN —
  需要完整 docker compose 栈与 Playwright 浏览器，超出本轮只读评审选择的隔离测试
  范围。其断言目标（save-fault banner 展示 envelope requestId、client-claimed
  标签、forged requestId 场景）已由上述 API 集成 + web 组件测试覆盖大部分；
  浏览器级"考生实际能取得编号"的最终证明依赖调度方在集成门禁中运行 E2E。
- nginx 故障注入矩阵未重跑：采信 07 号文档 22 次容器级运行证据（confs 快照与
  交付指令等同已由我核对；canary-master-scan access 0 命中为归档事实，未复现）。
- `pnpm verify` / 全量 CI / 性能 A-B 复测：NOT RUN（评审范围外；性能安全数字
  采信 10 号报告并与静态审计交叉一致）。

## Remaining uncertainty

1. **生产部署边界（契约 §4.3/§5.5 明示 UNKNOWN 项）**：Docker daemon 日志驱动/
   轮转、宿主日志文件权限、journald、备份 dump 保留期/加密/读取权、第三方收集器、
   HTTPS 实际激活状态——07/09 号文档已如实标 NOT_VERIFIED/UNKNOWN，本评审无部署
   访问权，无法升级这些项。error log 原始请求行泄露（7 个故障场景）为 Owner 已
   接受风险，其现实暴露面取决于上述未验证项。
2. **E2E 浏览器级验收**未由本评审运行（见上）；"考生在失败后能从 UI 取得编号"
   的浏览器级证据依赖集成门禁的 E2E 运行结果。
3. F2 的实际社工影响（proctor 被伪造 requestId 误导的概率）为推断；未做人为
   可用性验证。
4. legacy 备份层：≥30 天前的 dump 若存在，其中 legacy route 原始字节保留期
   UNKNOWN（09 号已记录；本轮无法访问部署）。
5. 单 PR worktree（s0-evidence/pr-864/pr-865/pr-log-privacy）未逐一重新 diff——
   评审以集成 HEAD 组合 diff 为权威输入（任务指定的组合 diff + 集成 worktree 文件）。

## Verdict

**SECURITY_REVIEW = PASS**

- 契约 §7.1 Subagent A 的七项职责全部核验：#923 封闭输出无绕过（41 反例实测）、
  legacy 无未保护读取端（独立枚举 + 交叉 08 审计）、#924 requestId 未被当作凭据
  （服务端 mint + 伪造 header 无影响实测 + 跨租户不授权实测）、SaveAnswer 失败
  遥测无答案/用户数据泄露（双侧 sanitize + allowlist + 真实 PG 200 拒绝契约）、
  #926 access log 无原始 URL（格式 pin 测试 + 22 次 canary 0 命中证据 + Pino
  全路径审计）、nginx error log 风险接受记录准确且未与 access log 混同、
  跨租户/跨角色负例 7/7 实测通过。
- Findings：0×P0/P1/P2，3×P3（F1 证据链标注、F2 requestId 形状 gate、F3 测试
  缺口）+ 1×INFO（F4 边界确认）。P3 均不阻塞合并；F1 建议随 #922 证据归档补注，
  F2/F3 建议记为 focused follow-up（不属本轮授权代码范围，按契约 §7.4 不得借
  评审偷偷施工）。
- 剩余不确定性均为部署侧 UNKNOWN（已被 07/09 如实记录）与本评审未运行的 E2E
  门禁项，不构成 BLOCKED 依据。

---

## 编纂补记（2026-11-09；评审正文未改动）

- **运行环境（宿主实测）**：WSL2 Linux 6.18.54.1-microsoft-standard-WSL2；Node
  v24.22.1；pnpm 11.1.2；PostgreSQL 18.4（`exam-dev-db-1`）；nginx
  1.30.5-alpine3.24（容器）。评审命令在 `integration-final` worktree 执行。
- **SHA 追溯**：评审对象是 `5d4b2773`。其后的 review-fix：
  `d3580f3e`（F2 requestId 形状 gate 已落地）、`e81b76a1`（F3 heartbeat 负例已补、
  未用 `ApiError.headerRequestId` 已删）、`1dd4d206`（#926 80 端口配方）；最终
  集成 `a84b416a`。本评审结论**未在最终 SHA 重跑**，F1 已在 07 号文档补注。
- 交付物重命名后，正文引用的性能文件为
  `10-INTEGRATION-CI-AND-PERFORMANCE.md`。
- **结论可信度**：高——关键断言均有正文所列实跑命令与输出；未运行项（浏览器
  E2E、perf 复测）已在“未运行”与 Remaining uncertainty 中列明，未冒充已执行。
