# REVIEW_ARCHITECTURE_DOCS — 全局架构与文档独立终审

- Reviewed SHA: **`0b2e2d8a`**（四 PR 集成树）。
  注意：worktree `/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109` 的 HEAD 实际为 **`a5df2c90`** =
  `0b2e2d8a` + 一个 **docs-only** commit（仅改 `docs/adr/ADR-025-http-request-correlation-identity.md` 与
  `docs/standards/test-flakes.md`，`git show --stat a5df2c90` 证实 2 files changed, 75 insertions, 13 deletions，零代码文件）。
  因此两棵树的**代码内容逐字节一致**；本文所有代码证据取自 `0b2e2d8a`，文档证据同时标注两个状态（`0b2e2d8a` 版 / `a5df2c90` 版）。
  worktree 中另有一个 **untracked** 文件 `docs/research/exam-production-integration-closure/FINAL_PRODUCT_ADJUDICATION.md`
  （终审裁决交付物，归属其他角色）；按独立性要求**未读取其内容**，仅在本报告 F-03 记录其对 clean-tree 门禁的影响。
- Reviewer scope: Subagent D — 四 PR 整体架构、重复实现/双轨、过度防御、UUID 契约一致性、生产/测试一致性、文档准确性、
  ADR 附录/supersession、每 PR 产品价值裁决、合并顺序与最终行为、可删冗余与文档冲突。
- 独立性：第一轮未读取 REVIEW_SECURITY / REVIEW_PROTOCOL / REVIEW_CI_FLAKE / FINAL_PRODUCT_ADJUDICATION 等其它评审文档。

---

## 1. 执行过的检查（全部为本会话实际运行）

| # | 检查 | 命令 | 结果 |
| --- | --- | --- | --- |
| 1 | HEAD 核对 | `git rev-parse HEAD`（worktree） | `a5df2c90ace6366e69c951e6660dc268327b6e8a` ≠ 目标 SHA；差异为 docs-only commit，见上文说明 |
| 2 | 四 PR diff | `git diff 8061d547..0b1902d0` / `0b1902d0..4919e534` / `4919e534..9bba9fbf` / `9bba9fbf..0b2e2d8a`（merge first-parent 全量） | 已全文读取并逐文件审阅 |
| 3 | #922 归档完整性 | `sha256sum -c SHA256SUMS`（`docs/research/exam-secure-observability-remediation/`，clean checkout 可复算） | **318/318 条目全部 OK，0 失败** |
| 4 | #925 nginx/wire 测试 | `pnpm vitest run src/nginxWebConf.test.ts src/routes/httpLogPrivacyWire.test.ts`（apps/api） | **14/14 通过** |
| 5 | #924 requestId 测试 | `pnpm vitest run src/server.requestId.test.ts src/routes/requestIdWireContract.test.ts src/routes/requestIdRateLimit.test.ts src/routes/requestIdStatusMatrix.test.ts src/routes/attempts/requestIdSaveRejection.test.ts` | **19/19 通过** |
| 6 | #923 投影/保留测试 | `pnpm vitest run src/routes/clientEvents.test.ts src/routes/proctorMonitoring.test.ts src/lib/proctorMonitoringService.test.ts src/plugins/clientEventRetention.contract.test.ts` | **70/70 通过** |
| 7 | 审计对应 + 跨组织 | `pnpm vitest run src/audit/auditWriter.test.ts src/routes/proctorMonitoring.crossOrg.test.ts` | **17/17 通过** |
| 8 | contracts 包 | `pnpm vitest run`（packages/contracts，含 `src/__tests__/clientEventRoute.test.ts` 233 行投影套件） | **475/475 通过** |
| 9 | web 漂移守卫/api | `pnpm vitest run src/lib/spaRouteTemplateVocabulary.test.ts src/__tests__/clientEventRoute.test.ts src/lib/api.test.ts`（apps/web） | **45/45 通过**（SPA 词表漂移守卫 4/4） |
| 10 | web 考生保存页 | `TakeExamPage.saveRejectionRequestId`(13)+`saveState`(7)+`saveFault`(7)，单文件与三文件组合共跑 4 次 | **27/27 通过**；首次三文件并行跑出现 3 个失败，**随后两次（含同组合）全部复绿**，见 F-04 |
| 11 | 架构边界 lint | `pnpm lint:arch` | `Architecture checks passed.` |
| 12 | nginx 实语法验证 | `docker run --rm -v ".../deploy/nginx/web.conf:/etc/nginx/conf.d/default.conf:ro" nginx:stable nginx -t` | `syntax is ok / test is successful`（只读挂载一次性容器） |
| 13 | compose YAML | `POSTGRES_PASSWORD=x JWT_SECRET=x EXAM_IMAGE=x EXAM_WEB_IMAGE=x docker compose config --quiet` | 合法（不带占位 env 时报缺变量，系生产 env 契约，非 YAML 缺陷） |
| 14 | 静态声明核查 | 针对 `routeTemplateOf`/`*WithMeta` 调用方、i18n key、`SPA_ROUTE_TEMPLATES` vs `App.tsx`、`auditWriter.ts:83`、`server.ts:117/119`、`proctorMonitoringService.ts:211/230-232` 的定点 grep/读取 | 全部一致（详见正文） |

**未执行**（明确声明，不冒充）：`pnpm verify` 全量、`pnpm e2e` 全量、GitHub exact-SHA CI。后者被外部因素阻塞
（GitHub 账户计费故障，见 `a5df2c90` commit message 引用的 runs 42572487639 等，Static checks failure + required jobs skipped）。
这是**合并前必须解决的外部门禁**，不是本树代码缺陷。归档中的 live nginx 故障注入 / bench / E2E 证据属于 PR #922 归档记录，
本报告引用但未重放。

---

## 2. 四 PR 整体架构评估

### 2.1 PR #922 — secure-observability 证据归档（0b1902d0）

- 纯文档/证据归档（320 文件，+26151 行）：`docs/research/exam-secure-observability-remediation/` +
  `.prettierignore`（字节完整性优先于格式，理由在 ignore 注释中写明）+ `.gitattributes`。
- SPEC §4.2 三问逐项：①证据真实进入版本控制 ✓（归档在 tree 内，SHA256SUMS 覆盖 318 文件）；②clean checkout 可验证 ✓
  （本会话在第 3 项检查中实际复算通过）；③安全+性能证据齐备 ✓（00–10 编号报告、FINAL-OWNER-DECISIONS、
  SAVEANSWER-*、nginx-fault-injection、bench.csv/bench-devnull.csv、review-* 独立评审均在）。
- 与 `exam-production-integration-closure/` 目录**无路径重叠**（后者由基线 commit 8061d547 落盘，属本轮 §9 交付物 1–4），
  两目录是两次不同 campaign 的历史证据，不构成双真相源（AGENTS.md §4：Archive 只作历史证据）。
- **裁决：KEEP。**

### 2.2 PR #923 — client-event route 封闭词表投影（4919e534）

架构质量高，是本轮最佳结构性修复：

- **单一实现权威**：`projectClientEventRoute` 唯一存在于 `packages/contracts/src/clientEventRoute.ts`（:87-201），
  ingest（`apps/api/src/routes/clientEvents.ts:114-118`）与 read（`apps/api/src/lib/proctorMonitoringService.ts:68-73`）
  两个边界复用同一函数；幂等投影使 read 侧对已安全值零开销。**旧实现 `normalizeRouteForStorage` 已完整删除**
  （diff 证实 −25 行），无新旧双轨。
- **fail-closed 语义**：所有失败路径归 `null`，无 raw/truncated/部分清洗 fallback；不解码百分号转义（关闭 RT-8 走私回潮）；
  非 http(s) scheme 前置拒绝（RT-12B/12C）。设计针对的是**已被归档证据证明的泄漏类**（RT-3/8/12B/12C/14B），
  复杂度有边界：~80 行纯函数 + 数据化的模板表，无内容审查、无回溯。
- **漂移守卫**：`apps/web/src/lib/spaRouteTemplateVocabulary.test.ts` 用结构化（括号感知）解析器把词表与 `App.tsx`
  路由源码钉死，双向失败即红。词表放 contracts 是边界约束下的正确解：api↔web 互不依赖（AGENTS.md §5），
  contracts 是唯一共享点；包内无 DOM 全局依赖（本地 `declare const URL`，注释给出与 `utf8ByteLength` 相同的编译约束）。
- read 侧投影使 pre-#864 原始 pathname 行**只读安全、免迁移、随 30 天保留老化**——正确避免了"为消除历史脏数据而动存储"。
- `security-model.md` INV-CE-005 三段式不变量（写入∈词表∪{null}；授权读∈词表∪{null}；历史字节 immutable+读侧重投影+老化）
  与代码、注释、ADR 附录完全一致。
- **裁决：KEEP。**

### 2.3 PR #924 — x-request-id 响应头与 200 拒绝关联（9bba9fbf）

- **单一 id、四个载体**：`genReqId: () => randomUUID()`（`server.ts:117`）与 `requestIdHeader: false`（:119）不变；
  `requestIdHeader.ts` 只是 root-scope `onRequest` 把**已有的** `request.id` 打到响应头，无第二次 mint。
  四方对应（header==pino reqId==envelope==audit `metadata.requestId`）由结构保证：audit writer 直接写
  `request.id`（`apps/api/src/audit/auditWriter.ts:83`），并经 `auditWriter.test.ts` 覆盖（检查 7 通过）。
- **`requestWithMeta` 共享内核**：`api.ts:306` 单一实现，`request`（:365）与两个 `WithMeta` 变体共用，错误处理/
  401 重定向/遥测行为天然一致——符合 AGENTS.md §3"不建第二条实现路径"。
- **fp-wrap cors 是真实的潜在缺陷修复**：pre-#865 接线把 @fastify/cors 封进无路由 scope，非预检响应从未携带
  ACAO/A-C-Expose-Headers（`cors.ts` INVARIANT 注释）；同源 nginx 部署下不可见，跨源部署与 header 暴露必需。修复正确。
- **200 业务拒绝关联的产品价值真实**：此前 `accepted:false` 不形成 ApiError、无 envelope、无 header，只能靠
  attemptId+questionId+clientSeq+时间窗；现在考生可见"请求编号"、telemetry 带（未核验的）requestId。
  `saveRejectionRequestId` 与 `saveRejection` 同点无条件覆写（TakeExamPage.tsx:413-423 INVARIANT），三处清除点对齐，
  与 `saveFaultRequestId`（不同 writer/生命周期，#800 A2-F2）刻意不合并——状态机正确。
- E2E M4（`investigation-ui-acceptance.spec.ts:924+`）以**真实服务端 CONFLICTING_PAYLOAD 判定**（仅控制到达顺序，
  verdict 由真实状态计算）走完整链：真实 header → 候选人可见告警 → 真实 telemetry batch → 时间线未核验分组。
  无协议扭曲。
- **唯一保留意见见 F-01（`getWithMeta` 无调用方）。
- **裁决：KEEP（含一处小 FIX，见 F-01）。**

### 2.4 PR #925/#926 — HTTP 日志隐私（0b2e2d8a）

- **`routeTemplateOf` 单一权威**（`logRedaction.ts:183-185`）：7 个生产文件消费
  （errors.ts、scores.ts、scopedCapability.ts、scoreCapability.ts、ownAttemptCapability.ts、examEligibilityCapability.ts、
  server.ts 串行器），取代散落的 `request.url` 日志；结构上排除（非清洗）动态段与 query。
  pino `req` 串行器（`serializeReqForLog`，:194-217）替换 Fastify 默认的 raw `req.url` 持久化。
- **404 边界去重**：`sendResourceNotFound` 由 /api scope 与 root boundary 共享（`rootNotFoundBoundary.ts:13-17`），
  消除了与 `apiSurface.ts` 的第二份实现；root 注册仅在 API-only 布局（静态前端存在时由其持有 root 策略，
  `server.ts:173-186` 条件分支），Fastify 单 root handler 约束被正确尊重且注释写明。
- **nginx access-log 隐私格式**：`exam_privacy` 用固定 `$exam_route` 占位符（"/api"、"/spa"），永久禁
  `$request`/`$request_uri`/raw `$uri`/Referer/Cookie/Authorization；`reqid=$sent_http_x_request_id` 与 #924 头衔接
  （依赖方向与合并顺序一致；无头场景记 "-" 并已文档化，优雅降级）。HTTPS 模板块同样携带隐私指令并被
  `nginxWebConf.test.ts` 对**去注释后的模板体**钉住（避免注释副本假绿——这正是本轮 review 修过的坑）。
- **Owner Decision A 的两分法贯穿所有载体**：access log（无原始 URL，永久禁令）与 error log（`error` 级原生日志，
  raw request line 残余风险**显式接受、有界、禁止与 access-log 声明合并表述**）在 web.conf 注释、
  `observability.md:105-131`、`operations/README.md:124-137`、`nginxWebConf.test.ts` 四处一致。
  这正面满足 SPEC §5.3"不允许继续声称 nginx 所有日志都彻底脱敏"。
- docker-compose healthcheck → `/healthz` 与 HTTPS 激活配方的 healthz 豁免互锁，`nginxWebConf.test.ts` 双向钉住
  （conf 指导文本 + compose 探针路径）。
- **裁决：KEEP。**

### 2.5 合并顺序与最终 master 行为

- 实际 first-parent 顺序 `0b1902d0 → 4919e534 → 9bba9fbf → 0b2e2d8a` 与 SPEC §8.2 规定完全一致。
- 跨 PR 依赖核验：#925 nginx 格式依赖 #924 响应头（顺序正确；单独 cherry-pick #925 仅退化为 "-"，已文档化）；
  #923 形状门（read 侧）与 #924 遥测发射（write 侧）相互独立、终树组合正确；#923 分支携带的 E2E fake-UUID 修复
  （`ca7e62ec`/`1f29b614`）与 #924 的 UUIDv4 夹具要求（SPEC §2.2）对齐。
- 最终 master 的行为增量（合并后可见）：所有响应多 `x-request-id`；pino incoming 行以 `route` 模板取代 raw `url`；
  API-only 部署获得 JSON root-404；nginx access log 换格式 + healthcheck 路径变化；`client_events.route` 落库值封闭化
  （历史行读取侧投影）；200 拒绝 UI 增加"请求编号"；CORS hook 升 root scope（跨源部署行为修复）。
  交互面（#923 形状门 × #924 遥测 × #925 nginx reqid）已在测试 4/5/6 中以真实组合验证。

---

## 3. 专项结论

### 3.1 重复实现 / 新旧双轨 — **未发现**

逐一核过：`projectClientEventRoute`（单实现双边界，旧函数已删）、`routeTemplateOf`（7 处消费单实现）、
`sendResourceNotFound`（两 scope 共享）、`requestWithMeta`（三入口共内核）、UUID 校验（服务端 strict v4 正则与
遥测 shape gate 是**不同不变量**而非重复：前者钉服务端 id 的 v4 形状，后者只做客户端声明的形状过滤，ADR 附录明示
"shape != identity"）。`#922` 归档与 closure 目录无路径重叠。

### 3.2 过度防御性编程 — **基本有界，一处例外（F-01）**

有界且正当：`MAX_INPUT_LENGTH=2000`（read 侧上界，注释明示只防"未来 writer 回归"）、Case D envelope/header
分岐 warn（限流器封顶、不升格、不进时间线）、nginx 配置文本漂移守卫（config-as-code 的最低限度钉子，
live `nginx -t` 由归档证据 + 本会话检查 12 另行覆盖）、req 串行器的 `LoggableRequest` 结构类型（exactOptionalPropertyTypes
编译约束）。例外是 `getWithMeta`（见 F-01）：无生产调用的前向表面属于投机性保留。

### 3.3 UUID 契约一致性 — **PASS**

- 服务端 mint：唯一入口 `server.ts:117` `randomUUID()`，`requestIdHeader: false`（:119）；wire 契约测试用 strict
  UUIDv4 正则（`requestIdWireContract.test.ts:44`，版本位 4 + RFC 变体位）钉 header==pino==envelope。
- 客户端声明：`proctorMonitoringService.ts:211` shape gate 只接受格式合法的 UUID 字符串（任意版本、大小写不敏感），
  读投影 default-deny；ADR-025 附录（`a5df2c90` 版）以 "RECORDED (informational)、不窄化 decision 6" 正确记录了
  该规则与历史 `req-*` 不可变规则作用于**不同表面**（live 投影 vs stored history），无矛盾。
- 测试夹具遵守真实协议（SPEC §2.2）：E2E forged id 为合法 RFC 4122 UUIDv4
  （`investigation-ui-acceptance.spec.ts:769` `00000000-0000-4000-8000-000000000bad`），且注释明示"形式合法 ≠ 核验"。
- legacy `req-<base36>` 表述三处一致（ADR-025 decision 6、`observability.md:61-62`、`mvp-deployment-runbook.md:1055`）。
- 归档行号引用核实：`REQUEST_ID_UUID_SHAPE` 确在 `:211`，应用于 `:230-232`（ADR 写 `:230-234`，含 `continue` 边界，成立）。

### 3.4 生产运行与测试环境一致性 — **PASS（含两点说明）**

- header 契约：wire 测试用**生产插件组合**（fp cors + setupRequestIdHeader + apiSurface + 生产 zod compilers），
  `server.requestId.test.ts` 另行 spawn 真实入口点钉 server.ts 接线——两层互补，不存在"只在测试里成立"的接线。
- 日志隐私：`httpLogPrivacyWire.test.ts` 在 buildTestApp 上显式声明生产同款 serializers（文件头注明 wiring 由 spawn 测试
  另行钉住）；`server.requestId.test.ts` Probe 3/4 断言 incoming 行 `req.url` 不存在且 `route` 不含 canary，
  覆盖 static-layout 与 API-only 两种 root 布局。
- nginx：本会话以 stock `nginx:stable` 容器 `nginx -t` 实际验证（检查 12）——文本钉之外的真实语法验证；
  live 行为（故障注入/日志格式运行时观察）依赖归档记录，未重放（见 §1 未执行声明）。
- 说明①：compose healthcheck `/healthz` 在当前（未激活 HTTPS）vhost 经 `try_files` 落到 index.html（200 SPA HTML），
  探的是"nginx 活着"而非"API 健康"——与改动前探测 `/` 语义相同，**非本轮回归**，仅记录。
- 说明②：`docker compose config` 需要生产 env（POSTGRES_PASSWORD 等）——既有生产契约，占位 env 下 YAML 合法（检查 13）。

### 3.5 文档准确性 — **PASS（评审过的载体），遗留两处见 F-02/F-03**

逐项核对结论（全部为实际读取/grep 证据）：

| 载体 | 结论 |
| --- | --- |
| `docs/contracts/observability.md` | request-trace 表、#865 载体段、#925 双分法段、JSON 示例（route 字段）全部与代码一致；`api.getWithMeta` "documented forward surface" 表述与 `api.ts:411` 注释一致（但该保留本身违 AGENTS.md §3，见 F-01）；`:34` 示例参数名与 `:270`/真实路由不一致（F-02） |
| `docs/contracts/api-contract.md` | "Standard response headers" 行完整（含 FST_ERR_BAD_URL 非载体边界，与 `requestIdHeader.ts` 注释一字对应）；CORS `exposedHeaders` 单一条目与 `cors.ts` 一致，"no second CORS authority" 保持 |
| `docs/contracts/api-reference.md` | `:72` 为合法 v4 形 UUID 示例，master..HEAD 该文件 diff 为空（`a5df2c90` commit message 声明并经其验证） |
| `docs/operations/save-failure-evidence.md` | F1–F6 矩阵 + UNKNOWN 不变量 + #924 后的 200-拒绝 header 关联路径齐备；"客户端 telemetry 不是独立服务器证据"定位未松动 |
| `docs/architecture/exam-system/security-model.md` | INV-CE-005 与 §15.7 与代码语义一一对应 |
| `docs/deployment/README.md` + `mvp-deployment-runbook.md` | HTTPS 激活必须同步处置 port 80（healthz 豁免 + catch-all 301，或网络层封 80 并相应迁移探针）与 web.conf 指导一致；runbook log 查找示例用 UUIDv4 + 保留 legacy `req-*` 提示 |
| `docs/operations/README.md` | nginx 边缘日志段：access 无原始 URL / error 级 Decision-A 残余风险、Docker 日志近主机权限边界、轮转与共享前脱敏——齐备 |
| `docs/standards/testing.md` | 无 requestId/UUID 相关内容，本轮无需要更新的过时条款（grep 证实） |
| `docs/standards/test-flakes.md`（`a5df2c90` 版） | OBS-2026-11-03-001 与已交付的 `1f29b614` 部分修复同步：#878 保持 OPEN、1/5 探针、无 post-fix 权威 CI 绿灯、复跑通过 ≠ 根因消除——表述诚实，未宣称修复 |
| ADR-025 | `a5df2c90` 修正了 stale 的 "until they merge" 措辞；两个附录状态标记恰当（#865 = ACCEPTED amended；#923 形状门 = RECORDED informational，明示不 amend/supersede/narrow decision 6） |
| CHANGELOG.md / implementation-status.md | **尚未记录四 PR**（`[Unreleased]` 为空；无 #922–#926 条目）——这是 `a5df2c90` 中**显式 DEFER 到最终 master 合并**的交付物（有留痕），非静默漂移；属合并门禁条件（F-03） |

针对性反例 grep（SPEC §5.5 抽样）：`时间窗/无法获取 requestId`（当前权威文档零命中）、`彻底脱敏/fully redacted`
（仅归档中作为"禁止的表述"出现）、`normalizeRouteForStorage/pathname-only`（仅归档与历史证据引用）——未发现权威文档残留过时机制描述。

### 3.6 ADR 附录 / supersession 需求 — **判定：不需要新的 supersession；当前附录形态正确**

- #865 以 "ACCEPTED (amended)" 附录扩第四载体，沿用 ADR-010/019 先例，decision 1–6 未动——正确。
- #923 形状门以 "RECORDED (informational)" 附录记录，明示不窄化 decision 6、不迁移历史行——正确，且
  `a5df2c90` 删除了 "in-flight / until they merge" 的过时权威声明并逐文件重写 Normative touchpoints
  （五个 touchpoint 文件本会话逐一读过，声明成立）。
- ADR 索引（`docs/adr/README.md`）行仍只标注 #865 amendment——informational 附录不改变 ACCEPTED 状态，可不加行；
  记为可选改进（F-05，非缺陷）。

### 3.7 "为测试而扭曲协议" — **未发现**

- E2E M4 的注入只控制**到达顺序**，CONFLICTING_PAYLOAD 判定由真实服务端基于真实持久化收据计算；
- 夹具修复方向是"向真实协议收敛"（`req-forged-prt-0001` → RFC 4122 UUIDv4），不是放宽；
- `1f29b614`（随 #923 进树）用显式条件等待（settled KaTeX + fonts.ready + 重断言 + 有界 `expect.poll`）替换固定
  `waitForTimeout(150)`，**原断言 `toBeGreaterThan(scrollLeft)` 原样保留**——AGENTS.md §7 要求的修复方向，非扩 timeout 掩盖；
- 日志捕获用 `expect.poll`（有界 2s）等待 pino 异步落盘，无 sleep；
- `server.requestId.test.ts` Probe 3 从 `req.url === path` 改为按 404 reqId 关联定位——是适配新串行器（url 字段已不存在），
  负向断言（url 不存在、route 不含 path）反而增强。

### 3.8 "为安全无限增加复杂度" — **未发现失控**

每项安全复杂度都可追溯到已证明的失败类（归档 RT-* 系列）并有明确边界：封闭词表 ~80 行纯函数+数据表；
shape gate 一条正则+一个分支；日志隐私是"删字段/换字段"而非过滤管线；error-log 残余风险选择**显式接受**而非
建设过滤代理——复杂度克制点在 Decision A（拒绝 `crit` 抑制、拒绝日志过滤层）。唯一反向样本是 F-01。

### 3.9 可删除的冗余代码 / 文档冲突清单

1. **F-01（删除建议）**：`apps/web/src/lib/api.ts:417-424` `api.getWithMeta` —— 无生产调用方
   （grep `postWithMeta|getWithMeta` 全 web 源码：唯一生产调用是 `TakeExamPage.tsx:898` 的 postWithMeta）。
   AGENTS.md §3 禁止"无调用代码"长期保留；`observability.md` 与 `api.ts:411` 注释以"documented forward surface，
   not dead code"为其辩护——**文档不能豁免仓库契约**。建议：现在删除（连同 `observability.md` 对应句子与
   `api.test.ts` 对应断言），读侧消费者出现时随消费代码一起加回；或取得 Owner 对该例外的显式授权。
2. **F-02（措辞修正）**：`docs/contracts/observability.md:34` 示例 `/api/attempts/:id/submit` —— 真实模板是
   `:attemptId`（`apps/api/src/routes/attempts.candidate.ts:1160,952`），同文件 `:270` JSON 示例已用正确参数名，
   两处自相不一致。一行修正。
3. **F-05（可选）**：`docs/adr/README.md:163,297` ADR-025 行未提及 2026-11-09 informational 附录（因它 amend nothing，
   不加不算错误；若求索引完备可加一括注）。
4. 无其它可删项：旧 route 清洗函数、旧 404 双实现、旧 `request.url` 日志点均已在 PR 内删除，未发现遗留死代码。

---

## 4. Findings 汇总（详见 submit_result）

- **F-01** getWithMeta 无调用代码 + 契约文档为其背书，与 AGENTS.md §3 冲突（low；已复现：grep 证据）。
- **F-02** observability.md:34 路由示例参数名与真实路由/同文件 JSON 示例不一致（low；已复现）。
- **F-03** 合并门禁条件（非本树缺陷）：worktree 含 untracked 的 FINAL_PRODUCT_ADJUDICATION.md，SPEC §6.2 要求
  clean-tree exact-SHA 门禁，最终合并前必须处置；GitHub CI exact-SHA 门禁被账户计费故障阻塞（外部，已留痕于
  a5df2c90）；CHANGELOG / implementation-status / §9 其余交付物按留痕 DEFER 到最终合并。三项均为 SPEC §8.1
  "合并前最终条件"未满足项，**不得在未闭环前宣称合并完成**。
- **F-04** 一次性的 web 测试并行失败（3 files / 3 tests）在随后两次重跑（含同一三文件组合）全部复绿，未复现；
  初判为本机资源竞争（该组合首次运行测试时间 419s）。不构成代码缺陷，但该观察应交 Subagent C 并入 flake 台账裁定，
  不得被此报告单方面宣布"与本轮无关"。
- **F-05** ADR 索引可选括注（informational 附录）。

## 5. 每个 PR 的产品价值裁决（SPEC §4.2 格式）

| PR | 裁决 | 一句话依据 |
| --- | --- | --- |
| #922 | KEEP_AND_MERGE | 归档 318/318 SHA256 clean-checkout 验证通过，证据链完整 |
| #923 | KEEP_AND_MERGE | 以封闭词表替换被证明可泄漏的清洗器，单实现双边界，历史数据免迁移 |
| #924 | KEEP_AND_MERGE（含 F-01 小修） | 200 业务拒绝关联的真实产品价值 + fp-cors 潜在缺陷修复；getWithMeta 应删或获显式授权 |
| #925/#926 | KEEP_AND_MERGE | 日志隐私单一权威 + Decision A 两分法一致落地，nginx -t 实证通过 |

## 6. 总判定

**GO（架构与文档范围）** —— 四 PR 构成一致的产品契约改进，无重复实现、无双轨、无失控防御、无协议扭曲；
UUID 契约全局一致；文档与代码在评审过的全部载体上一致。合并前必须闭环 F-03 的三项门禁条件（外部 CI、
clean tree、最终合并交付物），并建议顺手处理 F-01/F-02。

— Subagent D（全局架构与文档评审员），2026-11-09，exact SHA 0b2e2d8a（HEAD a5df2c90，docs-only 差异已说明）
