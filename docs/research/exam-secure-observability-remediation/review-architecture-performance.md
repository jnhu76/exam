# §7 独立评审 D — Architecture & Performance

- 评审角色：Subagent D（Architecture & Performance，TASK-CONTRACT §7.1D）
- 评审时间：2026-11-09（本地证据采集窗口 01:30–03:00 UTC+8）
- 独立性声明：本评审独立完成，未读取本轮其他三路评审（security / saveanswer-protocol / nginx-operations）的任何结论文件；`raw/review-*.md` 为 PR #922 归档的前一轮审计证据，仅作为被审对象对待。
- 评审环境：WSL2 6.18.54.1，Node v24.22.1，直接在集成 worktree 执行只读命令与仓库语义测试命令；未修改任何受控文件（本报告与测试产生的 gitignored 缓存除外）。

## Reviewed SHA

- 实际评审集成 HEAD：`5d4b2773cf62f93e40fa5661e0d5e19700f40b17`（`git -C integration-final rev-parse HEAD` 实测；任务书中给出的 SHA 串 `5d4b2773cf62f93e1970f40b17-corrected-below` 为截断/注记形态，以实测为准）。
- 冻结 master 基线：`5140c3dd0f9dbde1bdad8f5b757161f3ed96945d`。
- 组合拓扑实测（`git log --graph 5140c3dd..HEAD`）：#922(7243aa5c) → #923(871d0a4f) → #924(872a244f) → #926(a9155634) 四个 exact HEAD 依序 merge，与契约 §6 顺序一致。四个 PR 分支均直接基于冻结 master（merge-base 全等于 5140c3dd，非堆叠分支；我第一轮 diffstat 显示四 PR 同值是 zsh `set -- $pr` 不分词导致的自误，已用显式 SHA 重跑纠正）。
- 跨 PR 重叠文件仅 2 个：`apps/api/src/server.ts`、`docs/contracts/observability.md`（#924 与 #926 均触碰）；合并解决结果见下文验证。

## Reviewed files

生产代码（逐行读 diff，基线 5140c3dd..HEAD）：

- `apps/web/src/lib/api.ts`（+109：requestWithMeta 共享核心、postWithMeta/getWithMeta、ApiError.headerRequestId、Case D mismatch warn）
- `apps/web/src/pages/exam/TakeExamPage.tsx`（+60：saveRejectionRequestId 状态、postWithMeta 接入、Alert 展示）
- `apps/api/src/plugins/requestIdHeader.ts`（新 38 行）、`plugins/rootNotFoundBoundary.ts`（新 32 行）、`plugins/cors.ts`（fp 根作用域 + exposedHeaders）、`plugins/errors.ts`、`server.ts`
- `apps/api/src/lib/logRedaction.ts`（+65：serializeReqForLog / routeTemplateOf / UNROUTED_LOG_PLACEHOLDER）、`lib/proctorMonitoringService.ts`
- `apps/api/src/routes/clientEvents.ts`（删 normalizeRouteForStorage，换 projectClientEventRoute）、`routes/apiSurface.ts`、`routes/scores.ts`、`authz/{scopedCapability,examEligibilityCapability,ownAttemptCapability,scoreCapability}.ts`（均为 request.url → routeTemplateOf 的机械替换）
- `packages/contracts/src/clientEventRoute.ts`（新 201 行）、`contracts/src/proctorMonitoring.ts`、`contracts/src/index.ts`
- `deploy/nginx/web.conf`（+66：exam_privacy log_format、error_log error、$exam_route 占位、HTTPS 模板同步）
- `.prettierignore`、`apps/web/src/i18n/locales/zh-CN.ts`、`docs/adr/ADR-025-*`、`docs/contracts/observability.md`、`docs/contracts/api-contract.md`、`docs/operations/*`

测试（结构审读 + 实际运行）：requestIdWireContract / requestIdStatusMatrix / requestIdRateLimit / httpLogPrivacyWire / logRedaction / nginxWebConf / clientEvents / proctorMonitoring.crossOrg / server.requestId / api.test.ts / spaRouteTemplateVocabulary / TakeExamPage.saveRejectionRequestId(757 行) / clientEventRetention.contract(772 行，结构审读未逐行) / e2e/investigation-ui-acceptance.spec.ts（审读，未运行）。

证据：`10-INTEGRATION-CI-AND-PERFORMANCE.md`、`raw/perf-ab/`（66 文件全目录清点，重点核 analysis.json、micro-*.json ×3、schema-diff.txt、两份 client-events 普查、pino 样例、nginx-ab-results.json、requestid-repository-grep.txt、request-id-columns.txt）。

## Threat / invariant coverage（含 §7.3 对抗性映射）

### 本角色核心问题的判定（全部有执行证据）

**1. postWithMeta 是否造成重复 Fetch / 重复解析 / 业务协议变化 — 否。**

- 单一实现核心：`request<T>()` 改为委托 `requestWithMeta<T>()` 并解包 `data`（apps/web/src/lib/api.ts:368-371）；fetch、错误解析、401 重定向、网络遥测只有一份实现。`api.test.ts:777`（"the plain request<T> API is unchanged (no meta leakage)"，随 45 个用例实测通过）钉住旧签名行为。
- 无重复解析：成功路径一次 `response.json()`，meta 只多一次 `headers.get("x-request-id")` 与两个对象分配（api.ts:336-345）。
- 业务协议零变化（我独立复核，非转述报告）：`git diff 5140c3dd..HEAD --stat -- apps/api/src/routes/attempts.candidate.ts packages/contracts/src/attempt.ts apps/web/src/hooks/useSubmitFlush.ts apps/web/src/lib/examTelemetry.ts` 输出为空 —— SaveAnswer 服务端路由、DTO 契约、flush、遥测库全部未触碰。
- UI 消费唯一入口：TakeExamPage 的保存调用唯一换成 `postWithMeta<SaveAnswerResponseDTO>`（TakeExamPage.tsx:897-908），且 `TakeExamPage.saveRejectionRequestId.test.tsx:744-757` 用源码文本断言"全文件恰 1 处 postWithMeta、0 处对同一 DTO 的 api.post"——防止第二条未关联保存路径复活的架构性回归测试，实测通过（11/11）。

**2. 是否增加不必要的 React 状态 — 恰好 1 个，且为契约明示授权的最小形态。**

- 新状态仅 `saveRejectionRequestId`（TakeExamPage.tsx:413-421），TASK-CONTRACT §3.4 明文允许（"允许增加一个最小、明确属于 Save Rejection 的 requestId 状态"），注释明确记录了为何不与 `saveFaultRequestId`（心跳活性探测语义、不同 writer/生命周期）合并。
- 同点无条件覆写 + 与 `setSaveRejection` 完全相同的 3 个清除点（attempt reset :737、成功 :922、STALE 协调 :952）；Alert 仅在非 null 时渲染（:1585-1592），无虚假占位。
- 并发/生命周期防护在位：await 后 `saveStale()` 守卫（:911）先于一切状态写入；catch 顶部同守卫（:1003）覆盖 ApiError/网络失败迟到场景。`saveRejectionRequestId.test.tsx:574`（"an old attempt's delayed rejection (with header id) never writes the new attempt's state or telemetry"）实测通过。
- 无复杂全局诊断 Context、无新 ref/状态机。

**3. 过度抽象 / 重复实现 — 未发现结构性问题；两个小的未消费 API 面（见 findings）。**

- 旧实现已删：`normalizeRouteForStorage` 从 clientEvents.ts 整体删除（grep 全仓库 0 残留），由 `@exam/contracts` 的 `projectClientEventRoute` 单一权威替代；ingest 与 read（proctorMonitoringService.ts:68-84）两侧复用同一函数，幂等。
- SPA 路由词表单一真相源：`SPA_ROUTE_TEMPLATES` 只存在于 contracts；web 侧仅有 drift-guard 测试（spaRouteTemplateVocabulary.test.ts，结构化解析 App.tsx 源文本钉住两侧一致），非第二份实现。
- 404 边界单一实现：`sendResourceNotFound` 同时供 /api 作用域与根作用域复用（apiSurface.ts:107 / rootNotFoundBoundary.ts），无双轨。
- `rootNotFoundBoundary` 与 staticFrontend 的互斥有 OWNERSHIP 注释 + fastify "Not found handler already set" 硬约束；server.ts 条件注册（存在静态面时归 static 所有）。
- cors fp 包装是真实 bug 修复而非抽象扩张：封装式注册使非预检响应从未真正携带 CORS 头；wire 级测试（requestIdWireContract，真实监听器 + 生产插件组合）实测通过，expose-headers 可见。
- authz/scores/errors 的 9 处 `request.url → routeTemplateOf(request)` 为机械日志隐私替换，无逻辑变化。

**4. 性能成本与日志放大（对照 10-INTEGRATION-CI-AND-PERFORMANCE.md 与 raw/perf-ab）**

保护四指标我逐项独立复核，均成立：

| 指标 | 报告声明 | 我的独立复核 | 结论 |
| --- | --- | --- | --- |
| NEW_SUCCESS_TELEMETRY_WRITES = 0 | census 仅 perf.load.event | `cat client-events-census-*.txt`：base 729,760 行 perf.load.event、int 717,270 + 1 行 perf.probe；TakeExamPage 成功分支 diff 无新增 trackExamEvent | 成立 |
| NEW_REQUEST_ID_DB_WRITES = 0 | schema 逐字节相同 + repo grep 0 | `git diff --name-only -- packages/db/` = 0 文件；`grep -rn requestId packages/db/src/repository/` exit=1（0 命中，与 0 字节的 requestid-repository-grep.txt 互证）；schema-diff.txt 仅 2 行 pg_dump 随机 token；request-id-columns.txt 仅 2 个既有列 | 成立 |
| SAVEANSWER_DOMAIN_WRITES = UNCHANGED | receipts ≡ accepted:true | analysis.json protection 段：11316=11316 / 11534=11534；服务端保存路径 diff 为空 | 成立 |
| PERFORMANCE_VERDICT = NOT_DETECTED | 带内 ±5% | §2.1/§2.2 主表数字与 analysis.json 逐格一致（我抽验 answers-c1 rps/cpu/pino、reject-c8、httperr-c8、heartbeat 等 7 相位 × 3 指标） | 成立（数字引用瑕疵见 ARCH-PERF-1） |

日志放大为负向（缩减）：pino 字节/请求 −4.9%~−13.7%（#925 req 序列化器；pino-int-sample.txt 实样 `req:{route:"/api/auth/login",method,remoteAddress,remotePort}` 无 url/host）；nginx access −36%~−57%（nginx-ab-results.json 实测 api-200 195.8→125 B/req，带 token query 229.8→125 恒定，与报告 §2.3 一致）。新增客户端 warn `api.request_id_correlation_mismatch` 经模块级限流器有界（telemetryRateLimit.ts：per-key 5 次/60s 固定窗；key 与 `api.network_failed|<pattern>` 独立，互不挤占预算），且监测投影 allowlist 不投影未知 log name——不构成时间线放大。确定性新成本（+53B/响应头、404 微路径 +36µs/req、投影 +0.4~0.5µs/事件、postWithMeta +ns 级、1 个 useState 槽）机制上均与 diff 自洽，量级远低于 DB 路径分辨率。

**5. CI / 构建产物可信度（#920 stale-dist）**

- GitHub CI：四 PR 当前远端 headRefOid 与冻结 HEAD 逐一相等（gh pr view 实测），checks 全绿（API coverage/Build/E2E/Package coverage/Web coverage/Production transport regression/Static checks）。但这是 per-PR CI；集成 SHA `5d4b2773` 不在任何远端分支上（`git branch -r --contains` 为空）——组合结果本身无 CI 记录（见 ARCH-CI-1）。
- stale-dist 实测：`packages/contracts/dist/clientEventRoute.js` 存在、晚于 src（22:48 vs 22:46）、49 个模板与 src 逐字相同、`projectClientEventRoute` 已导出；web vitest 有 workspace source-resolution 插件（#794 防旧 dist），我运行的全部测试走 src；生产路径 dist 与 src 内容一致性已核。`pnpm typecheck` 全仓 17/17 FULL TURBO 缓存命中（缓存日志回放显示部分条目产于 pr-864 worktree——turbo 缓存键按输入哈希，命中即证明该包输入与缓存创建时一致；exam-engine/db 两包四 PR 均未触碰，跨 worktree 命中合理），为排除缓存假阴性，我另以 `tsc -p tsconfig.typecheck.json` 直接编译 apps/api 与 apps/web，均通过。
- 四 PR 组合结果（重叠文件合并质量）：server.ts 中 #924 的 `setupRequestIdHeader`（根作用域、注册最前）与 #926 的 `serializeReqForLog`、条件 rootNotFoundBoundary 共存无冲突；observability.md 两 PR 增补互补不矛盾（#865 载体段落 + #925 隐私段落，且明确"do not merge them into one statement"）。直接编译 + 41 个 API 侧新测试 + 56 个 web 侧测试在集成树上通过。

### §7.3 对抗性覆盖记录（每项至少一条）

| 项 | 覆盖方式 | 结果 |
| --- | --- | --- |
| 正常路径 | requestIdWireContract.test.ts 真实临时监听器 + 生产插件组合（7 tests，我运行通过）；perf-ab 实测 B 侧 549,938/549,938 响应携带 x-request-id | PASS |
| 错误路径 | api.test.ts:835/893（envelope/header 不一致：envelope 保持权威、header 捕获、恰一条有界 warn；一致或单侧存在不告警）随 45 tests 通过；requestIdStatusMatrix（401/403/409/500 带 header）7 tests 通过；httpLogPrivacyWire（404 边界 + 日志投影，DB-backed）7 tests 通过 | PASS |
| 并发/生命周期边界 | 旧 attempt 迟到拒绝响应不得污染新 attempt：saveRejectionRequestId.test.tsx:574 实测通过；代码层 saveStale() 双守卫（TakeExamPage.tsx:911、:1003）先于新状态一切写入 | PASS |
| 跨权限边界 | requestId 非凭据：无新路由/查询 API/DB 写（上表三项独立复核）；proctorMonitoring.crossOrg.test.ts（7 tests，DB-backed）与 clientEvents.test.ts（25 tests，含 legacy 再投影）我运行通过 | PASS |
| 现有测试未充分覆盖的反例 | 两个：(a) `api.getWithMeta` 全仓库零生产消费者（见 ARCH-DUP-1）；(b) `ApiError.headerRequestId` 属性无任何读取方（见 ARCH-DUP-2）。另探得 e2e investigation-ui-acceptance.spec.ts 为真实浏览器级验收但本轮未由我执行（见 Remaining uncertainty） | 已记录为 findings |

## Concrete findings

### ARCH-PERF-1 — 性能报告 §2.1/§2.3 引用数字无法从归档原始数据再生（证据溯源断裂）

- 位置：`10-INTEGRATION-CI-AND-PERFORMANCE.md` §2.1 httperr 行、§2.3 全节；对应 `raw/perf-ab/micro-api-wrapper.json`、`micro-projection.json`、`micro-react-state.json`、`analysis.json`（**编纂注记 2026-11-09：四处引用值已按归档 JSON 修正并附“数字勘误”表，见该文件**）
- 问题：四处引用值与归档 JSON 不符——
  1. §2.1 "httperr CPU B/A = 1.152（+15%）"：analysis.json 实为 `ratioBA=1.2355`（0.191/0.155=1.232，与报告自己的 A/B 值也矛盾）；
  2. §2.3 "postWithMeta +48.5ns（+0.83%）"：micro-api-wrapper.json 实为 `bMinusANs=162.7, bMinusAPercent=2.95`；
  3. §2.3 "投影 +415~538ns（realistic-mix +525ns）"：micro-projection.json 实为 397.9~520.2ns（realistic-mix 502.8）；
  4. §2.3 "12→13 槽 6.2→8.1µs/render"：micro-react-state.json 实为 5994→7978 ns（5.99→7.98µs）。
  方向与量级全部一致（ns~µs 级，结论不翻转），但按 §6.1"报告必须包含…原始数据"与 §9 可追溯要求，引用值必须能从归档数据再生——目前不能（疑引自一次未归档的更早运行；所有归档 mtime 均为同一拷贝时刻 01:19:41，无法用时序区分）。
- Reproduction：`python3 -c "import json;print(json.load(open('raw/perf-ab/micro-api-wrapper.json'))['bMinusANs'])"` → 162.7；对照报告 §2.3 的 48.5。其余三项同理（本评审"Threat coverage"节已列实测命令）。
- Severity：P2（证据完整性缺陷；不影响代码与判定方向）
- 标签：CONFIRMED
- Proposed minimal fix：用归档 JSON 的实际值改写报告 §2.1 httperr 比率（1.2355 / +23.5%，绝对值 +36µs 不变）与 §2.3 三行数字；或归档真正被引用的那次运行输出。二选一，勿改原始 JSON。

### ARCH-DUP-1 — `api.getWithMeta` 零生产消费者

- 位置：apps/web/src/lib/api.ts:411-419；唯一引用 apps/web/src/lib/api.test.ts:772
- 问题：导出的公开 API 面（含 ApiRequestOptions 转发）当前无任何生产调用方。缓解事实：`docs/contracts/observability.md` 已将其文档化为 `getWithMeta / postWithMeta` opt-in 对的一部分，属"已文档化的前瞻面"而非意外遗留；但按 AGENTS.md §3"无调用代码"应给出明确取舍。
- Reproduction：`grep -rn "getWithMeta" apps/ packages/ --include="*.ts" --include="*.tsx" | grep -v "lib/api.ts"` → 仅 api.test.ts:772 一行。
- Severity：P3
- 标签：CONFIRMED
- Proposed minimal fix（二选一，可验证）：(a) 删除 getWithMeta + 其测试块 + observability.md 中 `api.getWithMeta` 字样（约 −15 行），待真实消费者出现再加；(b) 保留并在 #800 台账记一条"首个 GET 消费者落地前为文档化前瞻面"的明示决定。推荐 (b)（契约文档刚发布该 API 对，删除反致文档-代码漂移），但必须留痕而非默认沉默。

### ARCH-DUP-2 — `ApiError.headerRequestId` 属性无读取方

- 位置：apps/web/src/lib/api.ts:199-206（构造参数）、:281（附加）
- 问题：Case D 的契约要求（"记录为 correlation inconsistency"、envelope 保持权威）已由 responseToApiError 内的有界 warn（api.ts:246-268）独立满足；附加在错误对象上的属性目前没有任何消费者读取（TakeExamPage 错误路径只用 `classifyWireFailure` 返回的 envelope `requestId`）。同为未消费 API 面。
- Reproduction：`grep -rn "headerRequestId" apps/web/src | grep -v test` → 命中全部位于 api.ts 自身（声明、捕获、比较、传参），无外部读取。
- Severity：P3
- 标签：CONFIRMED
- Proposed minimal fix：若近期无 4xx/5xx 路径展示 header id 的产品决定，删除第 6 个构造参数与属性（warn 逻辑保留，改用局部变量即可，api.ts:281 一并删）；若保留，需在 observability.md Case D 段补一句其用途，避免"捕获但无人用"的暗面。

### ARCH-CI-1 — 集成 SHA 无组合级 CI 证据；组合门禁依赖本地运行

- 位置：集成 worktree（本地分支 final-closure-integration）；`git branch -r --contains 5d4b2773...` 为空
- 问题：四个 PR 的 GitHub CI 全绿且 head 与冻结 HEAD 相等（实测），但重叠文件（server.ts、observability.md）的合并解决只被本地验证覆盖：我运行了直接 tsc（api/web 均过）+ 8 个新增 API 测试文件（41 tests）+ web 2 文件（56 tests）+ contracts 全套（475 tests），全部通过；`pnpm typecheck` 全仓为 FULL TURBO 缓存命中（输入一致性有效，但我另以直编译排除缓存假阴性）。契约 §6 的 12 项门禁（含真实 E2E、Security Canary、Nginx live、生产构建一致性、lint/format）未在集成 SHA 上有已归档的完整运行记录（INTEGRATION-CI-AND-PERFORMANCE.md 尚未交付）。
- Reproduction：`git branch -r --contains 5d4b2773cf62f93e40fa5661e0d5e19700f40b17`（空输出）；`gh pr checks <922|923|924|926>` 全 pass（per-PR）。
- Severity：P3（流程缺口；合并前必须补齐为门禁条件）
- 标签：CONFIRMED
- Proposed minimal fix：主执行方在集成 SHA 上跑完整 `pnpm verify` + `bash scripts/e2e/run.sh` + lint:arch/format:check 并归档为 INTEGRATION-CI-AND-PERFORMANCE.md（交付物 7）；或推送集成分支触发 CI。本 finding 不要求改代码。

### ARCH-EVID-1 — 最终收口证据尚未入 git（唯一载体是 worktree 未跟踪文件）

- 位置：`git -C s0-evidence status --short`：07/08/09/10 号文档、BASELINE.md、TASK-CONTRACT.md、raw/perf-ab/、raw/nginx-fault-injection/ 均为 `??`，SHA256SUMS 为已修改未提交
- 问题：契约 §9"禁止把临时目录当成唯一长期证据位置"、§10"所有证据可追溯至最终 exact SHA"——当前状态不满足；若 worktree 丢失证据即丢失。（调度方声明 SHA256SUMS 由其统一更新，此处仅记录状态事实。）
- Severity：P3（流程，收尾时必须完成）
- 标签：CONFIRMED
- Proposed minimal fix：最终裁决前将本目录全部新证据 + 四份 review-*.md 提交到 #922 分支并重生成 SHA256SUMS。

## 未构成 finding 的正面验证（防复核重复劳动）

- `postWithMeta` 无重复 fetch/解析、无协议变化；SaveAnswer 服务端四文件 diff 为空（实测命令见 Threat coverage 节）。
- React 状态净增恰 1 个且契约授权；同点批处理（micro-react-state.json：2 个同点 setState → 1 次 render）。
- 重复实现已删除且无新双轨（normalizeRouteForStorage、词表、404 边界、保存调用点均有单一权威 + 守卫测试）。
- 日志净缩（pino/nginx 实测负增量），新 warn 有界，无成功遥测新增。
- 保护四指标独立复核全部成立。
- stale-dist：contracts dist 与 src 逐字一致且更新；测试走 src 解析；直编译排除缓存假象。

## Remaining uncertainty

1. **我未运行的门禁**（非 substitude，如实列示）：完整 `pnpm verify`、`bash scripts/e2e/run.sh`（真实浏览器 E2E，含 investigation-ui-acceptance.spec.ts——我仅审读其断言为真实浏览器级）、`pnpm lint`/`lint:arch`/`format:check`、nginx live-container 实验、Security Canary 套件。这些只能采信 per-PR CI（exact head 全绿）与归档证据（07 号报告、nginx-out/），组合级仍待主执行方补跑（ARCH-CI-1）。
2. **微基准数字真值**：ARCH-PERF-1 的差异无法判定是报告误引还是存在未归档运行（所有归档 mtime 同为拷贝时刻）；我只确认"引用值 ≠ 归档值"，不推断哪次更接近真值——量级与方向两组数字一致，不影响判定。
3. **生产构建产物的完整一致性**：我核验了 contracts dist 与 src、api/web typecheck；未对 apps/web/dist 与 api/public 做逐字节重建比对（受只读约束未重跑 build），采信 10 号报告 §0 的 FULL TURBO 重建声明 + CI Build lane。
4. **perf-baseline worktree 保留状态**：报告称保留供复审；我未启动 A/B 复测（本轮判定不需要），其当前存在性未核验。
5. **6 文件合并单次调用的 vitest 失败**：一次把 6 个 API 测试文件同时传给 vitest 时 global setup 失败（DB-backed 文件混跑竞争）；逐文件运行全部通过。已如实记录，判定以逐文件结果为准，未深究组合调用的 setup 竞争根因（疑似多 DB-backed 文件并行建库竞争，不影响任何单一门禁）。

## Verdict

**ARCHITECTURE_REVIEW = PASS**（附必须处理的非阻塞 findings）

- 无过度抽象：新增面（requestWithMeta/postWithMeta、requestIdHeader、rootNotFoundBoundary、serializeReqForLog、projectClientEventRoute、exam_privacy 格式）各为一个明确语义边界，旧实现已删，无双轨。
- 无重复 Fetch/解析，业务协议（SaveAnswer receipt/clientSeq/version/retry/flush）diff 为空。
- React 状态净增 1 个且为契约明示授权的最小形态，并发/迟到防护与测试在位。
- 保护四指标证据独立复核成立；性能判定 NOT_DETECTED 依据的 §2.1/§2.2 主表与归档数据逐格一致；日志为净缩，无放大。
- stale-dist 风险在测试与运行时两侧均有结构性防护，且我实测 dist≠stale。
- 条件：ARCH-PERF-1（P2）必须在归档前修正数字或补归档被引运行；ARCH-CI-1 的组合级完整门禁与 ARCH-EVID-1 的证据入库必须在宣布 FINAL_REMEDIATION_MERGE_READY 前完成。ARCH-DUP-1/2 按 Proposed fix 二选一处置并留痕即可。

— Subagent D（Architecture & Performance），2026-11-09

---

## 编纂补记（2026-11-09；评审正文未改动）

- **SHA 追溯**：评审对象是 `5d4b2773`。其后 `d3580f3e`（形状 gate）、
  `e81b76a1`（heartbeat 负例、删除 `ApiError.headerRequestId`、`getWithMeta`
  改为文档化前瞻面）、`1dd4d206`（#926 80 端口配方）为 review-fix；最终集成
  `a84b416a`。本评审结论未在最终 SHA 重跑。
- **findings 处置**：ARCH-PERF-1 已在
  `10-INTEGRATION-CI-AND-PERFORMANCE.md` 顶部“数字勘误”按归档 JSON 修正四组
  数字；ARCH-DUP-1/2 按“文档化留痕 + 删除 headerRequestId”落地（`e81b76a1`）；
  ARCH-CI-1 的实测更新见该文件“CI 分册”（最终 head #923 E2E 红，未解决）；
  ARCH-EVID-1 仍存在（证据文件仍未跟踪，待收口提交）。
- **运行环境**已在正文“评审环境”行记录；宿主本次实测：WSL2 6.18.54.1、
  Node v24.22.1、pnpm 11.1.2、PostgreSQL 18.4。
