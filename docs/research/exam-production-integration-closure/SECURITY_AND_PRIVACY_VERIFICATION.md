# SECURITY_AND_PRIVACY_VERIFICATION — 安全与隐私边界验证

- 状态：**最终交付文档**（SPEC §9 交付物 7）。记录 as-built 信任边界、隐私投影与已接受残余风险，不修改产品代码。
- 集成 SHA：`a5df2c90ace6366e69c951e6660dc268327b6e8a`（任务给定 exact 集成 SHA；本会话 `git rev-parse HEAD` 一致）。
- 裁决权威：`FINAL_PRODUCT_ADJUDICATION.md` — verdict **BLOCKED**（required CI FAIL，外部计费，非产品代码缺陷）；安全 / 协议 / 架构三个 Subagent 均 GO，CI/Flake Subagent BLOCKED，复审 NO_GO。未合并、未发布。
- 证据纪律：代码锚点本会话 `grep` / 实读；测试数字来自给定材料（REVIEW_SECURITY 164 定向测试、REVIEW_PROTOCOL 306、`FINAL_PRODUCT_ADJUDICATION.md` 307/342、`pr-body.md`、`logs/`），本会话未复跑这些套件。

---

## 1. 信任边界：服务器权威 vs 客户端声明

| 事实 | 权威来源 | 信任级别 | 锚点 |
| --- | --- | --- | --- |
| HTTP `request.id`（UUIDv4） | 服务端 `randomUUID()` | 服务端内部权威 | `apps/api/src/server.ts:117`；`requestIdHeader: false`（`:119`） |
| `x-request-id` / `error.requestId` / pino `reqId` / HTTP audit `metadata.requestId` | 同一 `request.id` 的载体 | 服务端权威（有审计行时） | `requestIdHeader.ts:34-35`；`audit/auditWriter.ts:83` |
| `organizationId` / `userId` / `receivedAt` | `request.ctx` / `fastify.now()` | 服务端权威 | `docs/architecture/exam-system/security-model.md` §15.2 |
| `kind` / `level` / `name` / `occurredAt` / `metadata.requestId` | 客户端遥测 payload | **未核验声明** | §15.2；`proctorMonitoringService.ts:211-236` |
| `warningLevel` | 服务端计算但输入含客户端遥测 | advisory，非 incident/violation/scoring 权威 | INV-CE-001 |
| 保存结果 | `accepted:true` / receipt / `exam_attempts.answers` | 最高业务证据 | `TakeExamPage.tsx:915`；`answerProtocol.ts` |

**INVARIANT**：`requestId` 不是凭据、不是业务身份、不是授权输入、不是消息来源证明，也**不是保存成功的证明**。客户端 telemetry 永远不升级为独立服务器证据；管理端时间线把它投影在「客户端声明，未经服务端核验」组下（`apps/web/src/i18n/locales/zh-CN.ts:1784/2186`）。

---

## 2. UUID 形状 ≠ 身份

- 服务端 live 铸造用严格 UUIDv4（version/variant 位）正则；`apps/api/src/lib/proctorMonitoringService.ts:211` 的 `REQUEST_ID_UUID_SHAPE` 只验证「合法 UUID 字符串形状」，作用于**客户端声明的渲染白名单**（`:230-234`），不强制 version/variant。
- 两者是**不同不变量**，不是重复实现：前者钉服务端 id 的 v4 形状，后者只过滤「渲染什么声明」。ADR-025 「Addendum — 2026-11-09, #923」明确 `Shape is not identity (decisions 4–5)`、`No authorization or SaveAnswer production path reads client-claimed telemetry requestId`、`Decision 6 is not narrowed`。
- 本会话实查：`grep -rn 'requestId' apps/api/src/authz apps/api/src/routes/attempts --include='*.ts'` 的非测试路径读者数为 0（给定材料一致）；ADR-025 附录所记权威位置 `:211` 与代码行号对应。
- 两处 P0 测试夹具已向真实协议收敛（`req-forged-prt-0001` → `00000000-0000-4000-8000-000000000bad`；`req-cross-org-*` → `randomUUID()`），目的是消除旧值被形状门控正确丢弃导致的**正控空转通过**，属加强测试而非掩盖失败；形状门控负例有独立单测。详见 `UUID_FIXTURE_RECONCILIATION.md` 与 `reviews/REVIEW_FIXTURES_FLAKE.md`。

---

## 3. 跨组织 / 跨考生授权

- `apps/api/src/routes/proctorMonitoring.crossOrg.test.ts`：同组织正控 200；跨组织 proctor → 404（scoped resolver 退化会返回 200 空列表，404 vs 200 为 kill point）；proctor-events 跨组织 404 防枚举；**合法 UUID 形状的 client-claimed requestId 不授予任何跨组织可见性**、不是查询键；跨组织 incident 写入 404 且 audit/client_events 计数零变化。
- #926 对 4 个 authz 文件的改动全部是日志字段替换（`request.url` → `routeTemplateOf(request)`），fail-closed 分支逐行核对未动（REVIEW_SECURITY §2.3）。
- 跨考生 `requireOwnAttempt` 404 防枚举语义未被四个 PR 触碰；`organizationId` 内部数据归属边界不新增任何访问能力。

---

## 4. Route 隐私（新写入 / 授权读取 / 历史行）

| 面 | 行为 | 锚点 |
| --- | --- | --- |
| 写入 | `route: projectClientEventRoute(event.route)`，封闭词表或 `null`；永不落原始字节 | `apps/api/src/routes/clientEvents.ts:118` |
| 授权读取 | 读侧对存储值再投影（历史行含 raw pathname 也不能再进入授权响应） | `apps/api/src/lib/proctorMonitoringService.ts:72` |
| 历史行 | 不可变、不迁移、读时重投影、随 30 天保留老化 | INV-CE-005（`docs/architecture/exam-system/security-model.md` §15.7） |
| 失败路径 | fail-closed 到 `null`；拒绝非 http(s) scheme、不解码百分号转义、动态段整段丢弃；无 raw/截断/部分净化回退 | `packages/contracts/src/clientEventRoute.ts` |
| 漂移守卫 | SPA 词表与 `App.tsx` 路由精确相等 | `apps/web/src/lib/spaRouteTemplateVocabulary.test.ts` |

旧 `normalizeRouteForStorage` 已完整删除，无新旧双轨（给定材料：REVIEW_ARCHITECTURE_DOCS §3.1）。

---

## 5. 日志隐私：应用侧 Pino 与 nginx 边缘（两个独立裁决）

- **Pino / 应用侧**：`apps/api/src/lib/logRedaction.ts` 的 `routeTemplateOf`（INVARIANT：永不回退原始 pathname）与 `serializeReqForLog` 只留 method / route template / socket 地址；`server.ts` req 串行器接管；`rootNotFoundBoundary.ts` 替换 Fastify 默认会打印 `Route <raw url>` 的 `basic404`。`httpLogPrivacyWire.test.ts` 的 canary 全矩阵（query/path/编码/畸形 `%zz`/CRLF/unicode、403/404/500 状态线）零泄漏，并带 drift guard。
- **nginx access log**：`deploy/nginx/web.conf:49` `log_format exam_privacy` 使用固定 `$exam_route` 占位（`/api` / `/spa`）与服务端观测字段；`$request` / `$request_uri` / raw `$uri` / Referer / Cookie / Authorization **永久禁用**；`:64` `access_log … exam_privacy`。`nginxWebConf.test.ts` 对去注释后的 HTTPS 模板体钉住。
- **nginx error log**：`deploy/nginx/web.conf:65` `error_log … error`（原生 `error` 级，按 Owner Decision A 恢复故障诊断）。nginx core 在上游/DNS 故障的 error 级消息中会**引用完整请求行（含 query 中的秘密）**——这是容器故障注入验证过的、**显式接受且有界的残余风险**（禁止 `crit` 抑制、不建日志过滤代理）。
- **明确禁止的表述**：不得声称「nginx 所有日志都彻底脱敏」。`docs/contracts/observability.md:114-131` 与 `docs/operations/README.md:124-137` 把 access-log 隐私与 error-log 暴露作为**两个独立 verdict** 分开陈述。
- **运维边界**：`docker logs web` / 宿主机 `/var/lib/docker/containers/**.log` 属近主机权限（app RBAC 不覆盖 OS 日志）；需显式日志轮转（compose `logging:` 或 daemon 默认，bundled compose 不自限增长）；日志共享出运维团队前必须脱敏 query string；第三方 log collector 在部署边界之外，`INFRA_LOG_ACCESS = NOT_VERIFIED`、`BACKUP_RETENTION = UNKNOWN`（见 `security-model.md` §15.6 与归档 `09-HISTORICAL-DATA-AND-BACKUP-BOUNDARY.md`）。
- **XFF / 代理信任**：`web.conf:96-101` `X-Forwarded-For` 必须 REPLACE 不允许 append，防客户端伪造 XFF 进入 trusted-proxy walk 伪造 audit/限流身份（`docs/deployment/README.md` §Network / TLS 同述）。

---

## 6. 客户端 telemetry 不升级为服务器事实

ingest 端 org/user 来自 `request.ctx`、`receivedAt` 服务端时钟、引用三元组经 `normalizeClientEventReferences` 否则 NULL 化且响应恒 `{accepted: N}` 无存在 oracle、metadata 服务端再净化；读取端默认拒绝白名单、未知事件名 → 空对象、`kind:"proctor"` 仅显示标签、排序权属服务端 `receivedAt + id`、`occurredAt` 仅显示。INV-CE-001..005 与代码一致：未发现任何路径把 telemetry 提升为 incident / violation / scoring / attempt-state 权威。

---

## 7. 已确认的残余风险（接受 / 延期，不隐瞒）

**已接受（有 Owner 决策或边界声明）**
- nginx error log 携带 raw request line（Owner Decision A，换 error 级诊断）；第三方 collector / 日志文件权限 `NOT_VERIFIED`。
- #878 几何 flake：Owner 2026-11-09 明确 defer，`ROOT_CAUSE_CONFIDENCE = HYPOTHESIS`，4 处固定 150ms 残留；新签名 `:555` 与 A3-F7 `:341` 已补登 `docs/standards/test-flakes.md`（登记信息面），但 #878 仍 OPEN、4 条 Acceptance 未勾选、无 post-fix 权威绿灯。
- #922 归档含已接受的主机标识/地址类别与合成压测凭据；发布/共享前需 sanitization；归档内 `SHA256SUMS` 318/318 复算通过（给定材料）。
- 429 状态路径 `NOT_TESTED`；多实例 / 跨进程日志关联未验证（ADR-025 明确非多实例支持）。
- transport 边界（连接销毁、socket framing 失败、Node 超时、`FST_ERR_BAD_URL`）的 header 缺失：文档声明为协议边界，未做故障注入。

**延期（非产品缺陷，low/medium 一致性或清理）**
- OpenAPI 401/403 fallback schema 把 `requestId` 放顶层（203 处，`apps/api/src/openapi/swagger.ts` / `openapi.json`）：master 预存制品漂移，四 PR 未触达、运行时 envelope 正确；建议单独 follow-up 修 `swagger.ts` 并重新生成。
- `api.getWithMeta` 无生产调用方（documented forward surface）：AGENTS.md §3 张力，最终 master 收口时删除或取得 Owner 显式授权；本轮为文档角色，不改产品代码。
- P1 代表性夹具残差：web 单测仍以 `req-*` 模拟服务端 envelope/header（client 不校验形状，不导致集成红），按 `UUID_FIXTURE_RECONCILIATION.md` §3 下次触碰时统一。
- REVIEW_PROTOCOL low/P3：`answer_autosave_success(saveMode:"stale_reconcile")` 命名精度；Save 相关性测试手动注册 hook（建议后续 CI 补 boot 级 smoke）。
- `observability.md:34` 路由示例参数名已在本次交付修正为 `:attemptId`（见 `DOCUMENTATION_CONSISTENCY_AUDIT.md`）。

---

## 8. 验证边界（诚实声明）

- 本会话实跑：代码锚点 `grep` / `nl`、`gh pr checks 928`（exit 1）、PR / Issue 状态、`git` 差异/祖先、`pnpm format:check`、`pnpm docs:build`（命令与退出码见 `DOCUMENTATION_CONSISTENCY_AUDIT.md` / `PERFORMANCE_AND_CI.md`）。
- 本会话**未复跑**：164 / 306 / 307 / 342 定向测试、全量 `pnpm verify` / `pnpm test` / `pnpm e2e`、浏览器级 E2E、nginx 容器故障注入、性能基准、归档 318 文件语义复核。
- required CI 在 exact SHA 上 FAIL（外部 GitHub 计费，#930 OPEN）；本地绿灯不替代 required CI。本文档不声称 CI 通过、不声称已合并、不声称已发布。
