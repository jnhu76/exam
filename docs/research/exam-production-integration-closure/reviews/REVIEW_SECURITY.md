# REVIEW_SECURITY — Subagent A（安全与信任边界）

- 审查对象 SHA：`0b2e2d8a1653ebba59326517ec2fdc6b4c7cf4bc`
- 工作树：`/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109`
- 审查日期：2026-11-09
- 独立性：第一轮未读取其它 Subagent 评审文档内容（仅确认输出目录存在）。PR #922 归档内的 `review-*.md` 属于他人评审产物，未作为判断依据。
- 结论：**GO**（安全范围无阻塞缺陷；2 个低级别流程性 finding，见第 3 节）。

---

## 0. Exact-SHA 确认与中途 HEAD 移动事件

```
$ git -C /home/hoo/Source/exam-gap-worktrees/integration-closure-20261109 rev-parse HEAD
0b2e2d8a1653ebba59326517ec2fdc6b4c7cf4bc        ← 审查开始时确认，等于指定 SHA
```

全部代码阅读与本报告第 4 节测试运行均在 HEAD=`0b2e2d8a` 确认之后、工作树与之匹配时完成
（初始 `git status --short` 为空）。审查收尾时复查发现 HEAD 已被外部推进：

```
$ git -C … rev-parse HEAD        （收尾复查）
a5df2c90ace6366e69c951e6660dc268327b6e8a
$ git -C … log --oneline 0b2e2d8a..a5df2c90
a5df2c90 docs(closure): align ADR-025 touchpoints and OBS registry with delivered code
$ git -C … merge-base --is-ancestor 0b2e2d8a a5df2c90 && echo YES
YES
$ git -C … diff --stat 0b2e2d8a a5df2c90
 docs/adr/ADR-025-http-request-correlation-identity.md | 46 +++++++++-（信息性附录）
 docs/standards/test-flakes.md                         | 42 +++++-（flake 登记更新）
 2 files changed, 75 insertions(+), 13 deletions(-)
```

**两个 SHA 之间零代码差异（仅 2 个文档文件）**，因此本报告全部代码证据与测试结果对
exact SHA `0b2e2d8a` 的代码内容逐字节有效。同时发现工作树出现一个非本人创建的
untracked 文件 `docs/research/exam-production-integration-closure/FINAL_PRODUCT_ADJUDICATION.md`，
见 Finding F-2。

---

## 1. 审查范围（SPEC §7 Subagent A）

1. UUID 格式、来源、可信度区分；
2. 测试伪造 UUID 的正确性（是否合法且仍不可信）；
3. 跨组织、跨考生授权；
4. route 隐私（新写入与历史读取）；
5. nginx/Pino 日志边界；
6. client telemetry 不升级为服务器证据；
7. requestId 是否影响授权或保存成功判定；
8. 重点：有没有通过修改夹具掩盖真正的安全失败；有没有把"合法形状"误当成"已验证身份"；历史 `req-*` 读取是否安全。

权威输入：`SPEC.md §7`、仓库 `AGENTS.md`、`docs/architecture/exam-system/security-model.md`（INV-CE-001..005、§15 信任边界）、`docs/contracts/observability.md`（request trace / correlation semantics / audit identity）、`docs/adr/ADR-025-http-request-correlation-identity.md`（决策 1–6 + 865-C 附录）、PR #922/#923/#924/#926 增量 diff。

四个 PR 的增量内容（以合并第一父链逐段 `git diff <parent1> <merge>` 求解）：

| PR | merge | 增量内容 |
| --- | --- | --- |
| #922 | `0b1902d0` | 纯证据归档：`docs/research/exam-secure-observability-remediation/`（320 文件，全部 docs/research/conf/csv/json/log/md/png/sh/sql/txt） |
| #923 | `4919e534` | #864 route 封闭词表投影：`packages/contracts/src/clientEventRoute.ts`、ingest（clientEvents.ts）、读侧（proctorMonitoringService.ts）、攻击矩阵测试、App.tsx drift guard |
| #924 | `9bba9fbf` | #865-C `x-request-id` 响应头：`requestIdHeader.ts`、server.ts 根注册、cors fp-wrap + expose、web 端 `getWithMeta/postWithMeta`、TakeExamPage 保存拒绝消费、wire/status/rateLimit/crossOrg 测试 |
| #926 | `0b2e2d8a` | #925 原始 URL 日志隐私：`logRedaction.ts` routeTemplateOf/序列化器、authz 错误日志字段替换、rootNotFoundBoundary、`deploy/nginx/web.conf` exam_privacy 格式、nginxWebConf/httpLogPrivacyWire 测试 |

---

## 2. 已验证事实（代码层，均读自 exact SHA 工作树）

### 2.1 UUID 格式、来源、可信度区分 — 通过

- 服务端唯一 id 源：`apps/api/src/server.ts:117` `genReqId: () => randomUUID()`（`node:crypto`），`:119` `requestIdHeader: false` —— 客户端 header 无法成为/影响服务端 id（ADR-025 决策 1/2）。
- 第四载体：`apps/api/src/plugins/requestIdHeader.ts:34-37` 根作用域 `onRequest` 钩子写 `x-request-id: request.id`，不产生第二个 id；`server.ts:140` 在任何注册之前挂载。
- 真实生产入口验证（非复刻构造器）：`apps/api/src/server.requestId.test.ts` 直接 spawn `server.ts`，伪造 `request-id`/`X-Request-Id` 双 header 后断言 404 envelope 与 pino reqId 均为服务端 UUIDv4 且不等于任一伪造值（`:171-223`）；全 boot 日志所有 reqId 逐条匹配带 version/variant 位的 `UUID_V4_REQUEST_ID_RE`（`:25-26,288-296`）。
- 形状门控（客户端声明渲染白名单）：`apps/api/src/lib/proctorMonitoringService.ts:211-212` `REQUEST_ID_UUID_SHAPE`，`:230-234` 仅当声明为合法 UUID 字符串才进入 timeline 投影；注释明确"shape-gate the claim … rather than an authorized-content injection slot"。
- 可信度标注不升级：timeline 前端对 client_event 行渲染"客户端声明，未经服务端核验"分组，对 audit 行渲染真实来源（E2E `investigation-ui-acceptance.spec.ts:848/859/897/906` 双向断言）。observability.md:100-104 将该标注定为契约。
- ADR-025 决策 4/5 原文与实现一致：requestId 不是业务身份、不是授权/来源证明；新提交 `a5df2c90` 的附录再次固化"shape is not identity"，且其引用的权威位置 `proctorMonitoringService.ts:211` 与 exact SHA 代码行号精确对应（已核对）。

### 2.2 测试伪造 UUID 合法且仍不可信 — 通过（未掩盖安全失败）

两个夹具变更 commit 逐一审查：

- `ca7e62ec`（#923 E2E）：`req-forged-prt-0001` → `"00000000-0000-4000-8000-000000000bad"`。旧值是 legacy `req-*` 形状，会被新形状门控正确丢弃——若不改，正控将**空转通过**（forged 值根本不进入投影，测试失去检出力）。新值为带 version=4/variant=8 位的合法 UUIDv4，使伪造声明真正穿过投影、接受"仍不可信"的完整检验。commit message 与行内注释（`investigation-ui-acceptance.spec.ts:762-770`）明确"shape legality is form only, not verification"。
- `9dd1d5f4`（#924 cross-org）：`req-cross-org-${randomUUID()}` → `randomUUID()`。同理：使"最强合法声明形状"仍被证明不授予任何跨组织访问。跨组织 404 断言本体未削弱（`proctorMonitoring.crossOrg.test.ts:290-298`）。

判定：**这两处是消除空转通过、加强测试，不是掩盖失败**。反向证据齐全：

- 形状门控负面单测独立存在且我已运行通过（见第 4 节）：`req-500-abc`、UUID 内嵌文本（`investigate <uuid> please`）、32KB 超长、数字、null、布尔值全部被丢弃（`proctorMonitoringService.test.ts:192-234`）。
- 合法形状 ≠ 已验证身份：E2E 断言伪造 UUID 只出现在"客户端声明，未经服务端核验"组内（`:848` dialog、`:897` detail），且服务端 audit 行**不得**带该标注（`:859/906`）——双向防止"合法形状被当已验证身份"和"服务端事实被当客户端声明"。
- 服务端 id 格式与客户端声明门控是两个松紧度不同的规则：服务端用带 version/variant 位的 v4 正则（`server.requestId.test.ts:25-26`），客户端声明门控只验 hex 形状——更宽的门控只作用于"渲染什么声明"，不产生任何信任提升，方向安全。

### 2.3 跨组织 / 跨考生授权 — 通过

- `apps/api/src/routes/proctorMonitoring.crossOrg.test.ts`（我已运行，8 测试通过）：
  - 同组织正控（Admin 200，`:135-184`）；
  - 跨组织 proctor → 404，注释标明 MUTATION B KILL POINT：若 gate 退化回平面 `requireCapability`，handler 会返回 200 空列表，404 vs 200 证明 scoped resolver 在位（`:199-211`）；
  - proctor-events 跨组织 404 防枚举（`:213-221`）；
  - 客户端声明 requestId 不授予任何跨组织可见性：正控证明属主组织可读、跨组织仍 404 且该 id 不是任何查询键（`:223-299`）；
  - 跨组织 incident 写入 404 且 audit/client_events 计数零变化（`:301-346`）。
- PR #926 对 4 个 authz 文件的全部改动是**日志字段替换**（`request.url` → `routeTemplateOf(request)`），fail-closed 分支（503 AUTHZ_UNAVAILABLE、403/404 映射）逐行核对未动：`examEligibilityCapability.ts:115-121`、`ownAttemptCapability.ts:87-93`、`scopedCapability.ts:221-462`（各 resolver/gate 缺失分支）、`scoreCapability.ts:111-203`。
- 跨考生 own-attempt 语义（`requireOwnAttempt` 404 防枚举，security-model §4.1/§4.2）未被四个 PR 触碰。

### 2.4 route 隐私（新写入与历史读取）— 通过

- 新写入：`apps/api/src/routes/clientEvents.ts:118` `route: projectClientEventRoute(event.route)` —— 封闭词表或 null，永不落原始字节。
- 历史读取：`apps/api/src/lib/proctorMonitoringService.ts:72` 读侧对存储值重新投影（pre-#864 历史行含原始 pathname 也不能再进入授权响应）；投影幂等（模板 → 自身），安全值透传。
- 投影实现 `packages/contracts/src/clientEventRoute.ts`：非 http(s) scheme（含 `user:…@`、`data:`）先拒绝（`:159`）、解析失败 fail-closed null（`:161-165`）、百分号转义不解码（`:174-176`，防 `%2F/%3F` 分隔符走私）、动态段整段丢弃不回显（`:188`）、2000 字符上界（`:127`）、**无任何 raw/截断/部分净化回退**。
- 词表与 SPA 路由 drift guard：`apps/web/src/lib/spaRouteTemplateVocabulary.test.ts`（我已运行，4 测试通过）断言 `SPA_ROUTE_TEMPLATES` 与 `App.tsx` 声明精确相等，并有解析器自测防空转。
- 攻击矩阵与封闭输出不变量测试（60 测试，我已运行通过）：RT-3/4/5/8/12/12B/12C/13/14B 全序列、corpus canary 字节零存活、5000 次确定性 fuzz 输出永远落在封闭集。

### 2.5 nginx / Pino 日志边界 — 通过

- nginx access log：`deploy/nginx/web.conf:49-52` `exam_privacy` 格式，字段仅服务端观测值；`$request`/`$request_uri`/raw `$uri`/`$http_referer`/`$http_cookie`/`$http_authorization` 永久禁用（`:14-19` 注释 + `nginxWebConf.test.ts` 钉住，7 测试我已运行通过）；`$exam_route` 固定占位 `/api`、`/spa`（`:83,109`）。
- nginx error log：保持原生 `error` 级（`:65`），原始请求行暴露是**单独声明的 Owner Decision A 已接受风险**（`:33-47`），access-log 隐私与 error-log 暴露作为两个独立 verdict 记录，observability.md:114-131 同样分开陈述——文档与实现一致。`crit` 被禁止、`warn` 有泄漏证据说明；HTTPS 激活模板携带同一隐私指令（`:121-160`，测试钉住）。
- XFF/代理信任：`web.conf:96-101` `X-Forwarded-For` 必须 REPLACE 不允许 append，注释明确 client 伪造 XFF 进入 trusted-proxy walk 会伪造 audit/限流身份。
- Pino 侧：`logRedaction.ts:189-191` `routeTemplateOf` 永不回退原始 pathname；`:214-223` `serializeReqForLog` 只留 method/route template/socket 地址；err 白名单序列化器防止 payload 经 cause 链泄漏（`:102-158`）；`server.ts:127` 序列化器接管 req 通道；`rootNotFoundBoundary.ts:30-32` 替换 Fastify 默认 `basic404`（其会打印 `Route <raw url>`）；根策略在 API-only 布局注册、静态布局由 SPA fallback 持有且不打 URL（`server.ts:175-186`）。
- 生产级 canary 证据：`httpLogPrivacyWire.test.ts`（7 测试我已运行通过）query/path/编码/畸形 %zz/CRLF/unicode canary 全矩阵零泄漏（`:214-233`），403/404/500 各状态线零 canary（`:151-169/195-212`），并带 drift guard：任何非测试 api 源码再引入 `(route|url|path|uri)\s*:\s*(request|req)\.(raw\.)?url` 直接失败（`:171-193`）。`server.requestId.test.ts:247-283` 在生产入口对根 404 注入 `?token=<CANARY>` 并断言 stdout 永不包含。
- 证据归档（PR #922）敏感信息扫描：`grep -rIl` JWT/私钥/密码模式仅命中 `raw/perf-ab/load.mjs:83` 的合成压测凭据 `candidate123`（本地压测脚本），无活体凭证。

### 2.6 client telemetry 未升级为服务器证据 — 通过

- ingest 端（`clientEvents.ts`）：org/user 来自 `request.ctx`（`:79,107`），`receivedAt` 服务端时钟（`:85`），引用三元组经 `normalizeClientEventReferences` 证明否则 NULL 化且响应恒 `{accepted: N}` 无存在 oracle（`:92-101,142`），metadata 服务端再净化 `sanitizeClientEvent`（`:133`）。
- 读取端（`proctorMonitoringService.ts`）：metadata 默认拒绝白名单（`:183-197`），未知事件名 → 空对象；`kind:"proctor"` 只是显示标签非溯源（`:36-38`）；`warningLevel` 计算注释钉死 advisory（`:269-274`）；排序权属服务端 `receivedAt+id`，`occurredAt` 仅显示（`:386-394,448-491`）。
- requestId/status/errorCode/clientSeq 全部标注为客户端声明投影（`:144-161`），UI 渲染在"客户端声明，未经服务端核验"组（E2E 断言）。
- 未发现任何路径把 telemetry 提升为 incident/violation/scoring/attempt-state 权威；INV-CE-001..005 与 security-model §15 陈述与代码一致。

### 2.7 requestId 不影响授权或保存成功判定 — 通过

- 服务端：`grep -rn "request-id|x-request-id" apps/api/src/routes/attempts/ apps/api/src/lib/`（非测试、非 requestIdHeader.ts）零命中——没有任何业务路径读取客户端 request-id。
- 客户端保存成功判定唯一依据服务端 DTO：`TakeExamPage.tsx:915` `result.accepted`、STALE_VERSION 以 `result.details.serverAnswer` 对账（`:934-965`）；`meta.requestId` 仅进入 `setSaveRejectionRequestId`（`:972`，拒绝告警"请求编号"显示）与 telemetry metadata（`:983`，注释"never fabricated"）；错误路径同构（`:1028-1044`）。成功路径不读 requestId，保存状态机不接受它为输入。
- wire 契约钉住 200 业务拒绝体**不含** requestId（`requestIdSaveRejection.test.ts:160-163`，header 是唯一客户端可见载体）；错误响应上 header 与 envelope 分歧时 envelope 保持权威、分歧仅记录有界 client-log warn 且永不晋升到错误对象（`api.ts:242-268`）。
- 429/401/403/409/500 状态矩阵与限流场景 header==envelope==pino reqId（`requestIdStatusMatrix.test.ts`、`requestIdRateLimit.test.ts`，我已运行通过）。

### 2.8 历史 req-* 读取安全 — 通过

- 决策 6（ADR-025:54-56）：历史日志/audit 行/CSV 不迁移不改写，读取方把 `req-*` 与 UUID 都当不透明关联串。
- observability.md:191-197：provenance 永不从字符串形状推断；旧行把 system operationId 存在 `metadata.requestId` 下属历史证据按原样保留。
- 交互面：客户端 telemetry 里的 legacy `req-*` 声明被形状门控从 timeline 投影丢弃（不落库、不返回；`a5df2c90` 附录明确"该规则作用于活投影面，不改写任何存储行，决策 6 未被收窄"）——降级方向安全（少显示一个候选，而不是多信任一分）。
- 服务端历史日志中的 `req-*` 仍按 equality 参与检索（runbook 保留 legacy 示例），不因形状被区别信任。

---

## 3. Findings

### F-1（LOW，流程性，非产品缺陷）：审查期间 worktree HEAD 被外部推进

- 位置：`/home/hoo/Source/exam-gap-worktrees/integration-closure-20261109`（分支指针）
- 证据：审查开始 `rev-parse HEAD` = `0b2e2d8a…`（与指定 SHA 相等）；收尾复查 = `a5df2c90`；`git log 0b2e2d8a..a5df2c90` 显示新增 1 个 docs 提交；`git diff --stat 0b2e2d8a a5df2c90` 仅 `ADR-025-*.md` 与 `test-flakes.md` 两个文档文件。
- 影响：零代码差异，本报告证据对 exact SHA 代码仍成立。但 SPEC §7 要求"必须在最终修改提交之后执行，审查 exact 集成 SHA"——若 `a5df2c90` 之后还有新提交进入集成线，需对本报告未覆盖的增量做补充复审（docs-only 增量按 SPEC §6.2 只需确认与 as-built 一致；已核对附录引用 `proctorMonitoringService.ts:211` 与 exact SHA 代码一致）。
- 复现：第 0 节命令，从 exact SHA 复现（是）。
- 最小修复建议：集成编排方冻结集成分支；任何新提交进入后按 §7.2 走修复—复审闭环或显式 docs-only 复核记录。

### F-2（LOW，流程性）：worktree 出现非本审查创建的 untracked 文件

- 位置：`docs/research/exam-production-integration-closure/FINAL_PRODUCT_ADJUDICATION.md`（untracked，`git status --short` 输出 `??`）
- 证据：审查收尾 `git -C … status --short`。本人未创建该文件；SPEC §6.2 要求最终证明基于 clean worktree、"禁止本地未提交夹具"。
- 影响：不触代码与测试；但它出现在被指定为 exact-SHA 审查对象的工作树内，最终 CI/合并门禁前应提交或移除，避免 dirty-state 依赖。
- 复现：`git -C /home/hoo/Source/exam-gap-worktrees/integration-closure-20261109 status --short`（从 exact SHA 复现：是——该文件在 exact SHA 树上即为未跟踪状态）。
- 最小修复建议：由其作者将其纳入对应 docs 提交或移出该 worktree。

无 HIGH/MEDIUM 安全 finding。四个重点问题的直接回答：

1. **是否通过修改夹具掩盖真正的安全失败？** 否。两处夹具修改（`ca7e62ec`、`9dd1d5f4`）都是因 #923 新增形状门控使旧 fixture 值被正确丢弃、正控面临空转通过而调整；调整后伪造值穿过更完整的"合法形状→仍不可信"检验，负面用例（req-* 丢弃）有独立单测且我已运行通过，跨组织拒绝断言本体未被削弱。
2. **是否把"合法形状"误当成"已验证身份"？** 否。合法 UUID 形状只是 timeline 渲染白名单，语义钉死在"客户端声明，未经服务端核验"组；服务端 id 格式由独立的生产启动测试用带 version/variant 位的 v4 正则钉住；E2E 双向断言防止两类误标。
3. **历史 req-* 读取是否安全？** 是。存储历史不改写；服务端日志检索按 equality 处理、不按形状推断 provenance；客户端遥测中的 legacy 形状声明在授权读取投影处被丢弃（fail-deny），不产生任何信任。

---

## 4. 测试证据（本审查实际运行）

全部运行于 exact SHA 代码内容（第 0 节已证明两 SHA 代码零差异）；命令逐条列出：

| # | 命令（cwd） | 结果 |
| --- | --- | --- |
| 1 | `./node_modules/.bin/vitest run src/__tests__/clientEventRoute.test.ts`（packages/contracts） | 1 file / **60 passed** |
| 2 | `./node_modules/.bin/vitest run src/lib/spaRouteTemplateVocabulary.test.ts`（apps/web） | 1 file / **4 passed** |
| 3 | `./node_modules/.bin/vitest run src/lib/logRedaction.test.ts src/nginxWebConf.test.ts src/lib/proctorMonitoringService.test.ts`（apps/api） | 3 files / **42 passed** |
| 4 | `./node_modules/.bin/vitest run src/routes/requestIdWireContract.test.ts src/routes/requestIdRateLimit.test.ts src/routes/httpLogPrivacyWire.test.ts`（apps/api） | 3 files / **15 passed** |
| 5 | `./node_modules/.bin/vitest run src/routes/proctorMonitoring.crossOrg.test.ts src/routes/attempts/requestIdSaveRejection.test.ts src/routes/requestIdStatusMatrix.test.ts`（apps/api） | 3 files / **16 passed** |
| 6 | `./node_modules/.bin/vitest run src/routes/clientEvents.test.ts`（apps/api） | 1 file / **25 passed** |
| 7 | `./node_modules/.bin/vitest run src/server.requestId.test.ts`（apps/api，真实生产入口 boot） | 1 file / **2 passed**（19.5s） |

合计 7 个套件、164 个测试，全部通过。PG 目标为 testing.md §2 契约的 `exam_test`（harness 自建，非开发库 `exam`）；`server.requestId.test.ts` 子进程使用封闭白名单 env 与测试专属 DB URL。

**未运行（明确声明，不以部分代全量）**：`pnpm verify`、全量 `pnpm test`、`pnpm e2e`（含 `investigation-ui-acceptance.spec.ts` M3/M4 浏览器套件——其断言我已静态审查，见 §2.2/§2.6，但浏览器级执行不在本轮）、nginx 容器级故障注入（#925 的 access/error log 分离 verdict 依赖归档证据 `docs/research/…/07-NGINX-DIAGNOSTICS-AND-PRIVACY.md`，本轮以 `nginxWebConf.test.ts` 配置钉住 + 归档核对代替实机复跑）。全量门禁属于 SPEC §5 的 Gate Agent 范围。

---

## 5. 未知边界

- `x-request-id` 的"永不携带"边界（连接中途销毁、socket 层帧错误、Node 级超时、`FST_ERR_BAD_URL` 路由前框架错误）按契约记录为文档边界，测试无法在进程内确定性注入，本轮未实测（与 `requestIdHeader.ts:16-22`、observability.md:86-91 陈述一致）。
- PR #922 归档 62 文件 SHA256SUMS 未逐文件重验 hash（抽查性敏感信息扫描通过）；归档字节完整性以归档内 `SHA256SUMS` 与 PR #922 验证记录为准。
- E2E 浏览器套件与 nginx 实机故障注入如上未运行。

## 6. 结论

安全与信任边界范围 **GO**：UUID 来源/格式/可信度区分、伪造 UUID 测试合法性、跨组织/跨考生授权、route 新写入与历史读取隐私、nginx/Pino 日志边界、telemetry 不升级、requestId 与授权及保存判定解耦，全部在 exact SHA 代码上核验通过并有运行中的测试证据。F-1/F-2 为流程性 LOW 项，不阻塞产品上线，但 F-1 要求集成线冻结后再有增量时触发补充复核。
