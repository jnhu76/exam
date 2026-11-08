# 基线与源码测绘总图（BASELINE-AND-SOURCE-MAP）

- 轮次：secure-correlation-audit（终稿交付物 1/10）
- **MASTER_SHA = `423f2945d9feef73a5413e498fb2772cc245c754`**（Merge PR #915）
- 本文件汇总 `baseline/FACTS.md` 与 `source/*.md` 五份测绘笔记；所有断言的原始证据在对应笔记中，此处标注来源文件与 path:line。
- 工作模式：只读审计 + 受控实验；git 跟踪文件零改动（各阶段 `git status --short` 均仅会话前已存在的 `?? test-results/`）。

## 图例（本轮统一标注语义）

| 标注 | 语义 |
| --- | --- |
| `SOURCE_VERIFIED` | 本轮会话读到该 `path:line` 的源码/配置并核实语义 |
| `LIVE_VERIFIED` | 本轮会话实际运行动态验证（命令与输出存证于 `.tmp/secure-correlation-audit/`） |
| `INFERRED` | 由已验证事实 + 文档化默认行为推导，未本地执行 |
| `UNKNOWN` | 源码/证据内无信息 |
| `INFRA_ACCESS_NOT_VERIFIED` | 需要部署环境访问，本轮不可验证 |

## 1. Git 基线（来源：baseline/FACTS.md §1）

| 项 | 值 | 证据 |
| --- | --- | --- |
| master HEAD | `423f2945d9feef73a5413e498fb2772cc245c754` | `git rev-parse HEAD`（baseline/FACTS.md:9） |
| 当前分支 | master，工作树干净（仅未跟踪 `?? test-results/`） | `git branch --show-current` / `git status --short` |
| 历史审查基线 | `3bece086`（#914 ADR-026 采纳）是 HEAD 祖先；`3bece086..HEAD` 共 7 commit（含 #915/#916 命名重构），diffstat 29 files +127/−156，按标题判断无功能变更（未逐行核对——不确定性标注） | baseline/FACTS.md:12-20 |
| 发布状态 | 最新 tag v0.0.11（2026-11-02）；#850/#853/#887-#893/#902-#916 等 PR 均在其后合并 = **关联性相关实现（reqId UUIDv4、correlation 遥测链、client-event 保留/最小化、audit 游标）处于「已合并、未发布」窗口**，master as-built 即审计对象 | baseline/FACTS.md:98-120 |

## 2. 版本表（来源：baseline/FACTS.md §2；SOURCE_VERIFIED）

| 组件 | 版本 | 证据 |
| --- | --- | --- |
| Node（宿主） | v24.22.1 | `node --version` |
| pnpm | 11.1.2（root packageManager 钉定） | `pnpm --version`；package.json |
| Fastify | 5.8.5（声明 `^5.3.3`） | apps/api/package.json；pnpm-lock.yaml |
| Pino | 10.3.1，**纯传递依赖**（fastify@5.8.5 直接依赖；全仓无直接声明） | pnpm-lock.yaml fastify snapshot |
| postgres.js | 3.4.9（不是 node-pg） | apps/api/package.json；pnpm-lock.yaml |
| drizzle-orm | 0.45.2 | 同上 |
| ioredis | 5.11.1 | 同上 |
| PostgreSQL 服务器 | `postgres:18.4-bookworm`（dev/prod compose 一致） | docker-compose.dev.yml:6；docker-compose.yml |
| Redis 服务器 | `redis:7-alpine`（profile 门控，requirepass+AOF） | docker-compose.dev.yml:33 |
| @fastify 插件 | cookie 10.0.1 / cors 11.2.0 / rate-limit 10.3.0 / sensible 6.0.4 / static 9.1.3 / swagger 9.7.0 | pnpm-lock.yaml |

未核对：root package.json `engines` 字段（baseline/FACTS.md:37）。

## 3. 部署架构（来源：baseline/FACTS.md §3；SOURCE_VERIFIED）

- **单进程 API，无独立 worker**：`start = node dist/server.js`（apps/api/package.json:16）；后台循环（heartbeat/deadlineScanner/clientEventRetention/emailOutboxLoop/operabilityMonitor）全部是进程内 Fastify 插件（apps/api/src/server.ts:128-146）。无 BullMQ/队列。
- **Redis 三态**（apps/api/src/redis/redisRuntime.ts:31-34）：`off`/`optional`（降级本地限流）/`required`（有界启动窗口 fail-closed）；消费方仅限流、capacityResearch、system 探针、operabilityMonitor——**无消息队列用途**。
- **生产拓扑**（docker-compose.yml）：web(nginx 唯一公网入口) → app(内部 :3000) → db；redis 可选 profile；全部挂 exam-net（默认 subnet 与 TRUSTED_PROXY_CIDRS 兜底联动，compose INVARIANT 注释钉死）。
- **日志**：pino JSON 仅 stdout 单通道（runbook:1043）；`level:"info"`、redact remove 策略（apps/api/src/lib/logRedaction.ts:4-11）、err 白名单 serializer；`genReqId` UUIDv4 + `requestIdHeader:false`（apps/api/src/server.ts:111-120）。
- **保留**：仓库**不拥有**日志保留/轮转（compose 无 `logging:` 段，grep 退出码 1）；由 Docker 引擎默认与运维侧决定——环境所有事实，非 repo 契约（baseline/FACTS.md:71）。

## 4. 测试环境与主体（来源：baseline/FACTS.md §4）

- CI verify 库 `exam_test`（worker-database 隔离）、E2E 库 `exam_e2e`（host-native，#626）；DB resolver 强制 test/ci/e2e 用 `TEST_DATABASE_URL` 绝不回落（testing.md:190）。
- 本轮受控实验环境：**`exam_ci_audit`**（身份核验 `current_database()=exam_ci_audit, current_user=exam`，adversarial/db-identity.txt）+ 共享 dev 服务 localhost:3000（APP_MODE=e2e）。e2e seed 后在库主体 = 1 Admin + 6 Candidate；Teacher/Proctor/Grader/Maintainer 须测试自行经 API 创建（本审计以管理 API 造 proctorA1/proctorA2 等，MANIFEST.json）。

## 5. 已决决策时间线（来源：source/adrs-issues.md §1-§2；gh issue view 全读）

| 日期 | 载体 | 与本轮相关的决定 |
| --- | --- | --- |
| 2026-07-26 | ADR-012 | 考生恢复契约：服务端权威保存、失败分类 F1-F6、遥测允许/禁止清单 |
| 2026-09-10 | ADR-020 | Fastify 拥有路由身份；raw URL 再解析仅限 logging/telemetry 等四类例外 |
| 2026-11-05 | #875/#866/#861 | metadata 最小收敛（PR #888）；receipt 三标量摘要（PR #891）；拒绝证据=恰一条 WARN（PR #892），禁 durable refusal 表、禁复活 deprecated `attempt.saveAnswer` |
| 2026-11-07 | #860 → ADR-025 | Owner 改判 server UUIDv4（PR #912）：`genReqId:()=>randomUUID()`、`requestIdHeader:false`；三态调查契约（NO_MATCH=UNKNOWN/ONE_CANDIDATE/AMBIGUOUS）冻结；audit 双键分离（PR #906） |
| 2026-11-07 | #874 → ADR-026 | occurredAt advisory / receivedAt 权威；UTC ISO 读投影；year-0000 毒批 400 原子拒绝 |
| 2026-11-07 13:33 | **#864 / #865 终局** | #864 `DEFER_IMPLEMENTATION_PENDING_LIVE_NEGATIVES_AND_OWNER_POLICY`（OPEN）；#865 `NO_GO_NEW_200_REQUEST_ID_CONTRACT`，`CLOSE_AS_NOT_PLANNED`（关闭文本自设重开条件：「若未来实测运维工作流需要精确的 200-请求日志查找且能证明缺失 join，重开此窄选项（X-Request-Id 响应头）而非改领域响应」） |

「不可重新发明」清单（adrs-issues §3，12 条）核心：身份种类分离（requestId≠operationId≠eventId≠clientSeq≠answerIdentity）、身份对应不变量（pino reqId=信封=audit metadata.requestId）、200 响应不加 requestId（#865 NO_GO 状态）、client_events 净化单一权威（@exam/contracts sanitizeClientEvent + SAFE_METADATA_ALLOWLIST）、route 只存 pathname（#875）且进一步收敛属 #864 未决 scope、后台身份不伪造 HTTP requestId。

## 6. 九字段信任溯源总览（来源：source/field-provenance.md §0-§9，全部 SOURCE_VERIFIED 除另注）

| # | 字段 | 创建者 | 信任级别 | 关键落点 |
| --- | --- | --- | --- | --- |
| 1 | server-owned requestId | Fastify genReqId（server.ts:111） | 服务端可信 | 错误信封 / pino reqId / audit metadata.requestId（auditWriter.ts:83 截断 128） |
| 2 | client-claimed requestId | 客户端（抄自信封，TakeExamPage.tsx:156-167） | 不可信声明 | client_events.metadata（30 天）；proctor 时间线「客户端声明」标签 |
| 3 | operationId | 客户端（危险命令）/系统上下文 | 服务端 receipt 仲裁 | attempt_command_receipts 唯一索引 + audit metadata.operationId（系统行） |
| 4 | clientSeq | 客户端计数器 | 不可信候选键 | exam_answer_save_receipts 复合 PK 第 4 列；拒绝 WARN 行 |
| 5 | eventId | 客户端 | 不可信幂等键 | (org,userId,eventId) 唯一去重 first-write-wins |
| 6 | route | 客户端 | 不可信声明 | client_events.route（仅 pathname、500 截断；**#864 泄露反例见 ADVERSARIAL-TEST-RESULTS**） |
| 7 | metadata | 客户端自由 JSON | 不可信 | sanitize（键名 denylist+凭证形状）落库；读取端 default-deny allowlist |
| 8 | error code/status | 服务端（信封权威）/客户端（遥测声明） | 分裂 | 53 个 ErrorCode 不可变契约；遥测 errorCode 是声明 |
| 9 | SaveAnswer receipt identity | 服务端引擎 canonical SHA-256 | 服务端可信 | append-only，与答案写同一事务；admin 只读三标量摘要 |

服务端侧补充（source/server-correlation.md）：
- requestId 是唯一服务端自有关联身份；入站头（request-id/x-request-id/traceparent）零影响——生产代码无 traceparent 消费者（grep 仅 server.ts:112 注释一行）。
- operationId 冲突即抛错拒绝（auditWriter.ts:117-129）；receipt 不含 userId/requestId，归属由 (org,attemptId) 外键承载（answerProtocol.ts:280-286）。
- normalizeRouteForStorage 精确语义（clientEvents.ts:31-44）：哑基址 URL 解析只留 pathname → 500 截断 → 空串 null；不可解析 fallback 在首个 `?`/`#` 截断。**不拒绝未知路由、不 redact path 段、不解码 percent-encoded 文本**（#864 已证边界）。
- 引用信任边界（clientEventReferenceNormalizer.ts:72-110）：examId 永取 attempt canonical exam；questionId 仅冻结快照内；不可证全 NULL；staff 无特权例外；固定 3 次 DB 往返 O(1)；快照缺失 fail-closed。

客户端侧补充（source/client-contracts.md）：
- 前端获得服务端 requestId 的唯一通道 = 错误信封（api.ts:226-244）；**成功 200 不可获得**：api.ts request() 对 2xx 不读任何响应头（:269-273）、`requestIdHeader:false` 不发出响应头、成功 DTO 均无 requestId 字段（attempt.ts:218-224、clientEvent.ts:187-194）。
- 缓冲语义：批 20/间隔 5s/上限 200 丢最旧/退避 10s→5min；ACK 三分法（ACKNOWLEDGED 连续前缀 / REJECTED 仅字段路径指向本批的 400 / RETRY 其余全部）；eventId 幂等兜 ACK 丢失。
- 已知关联缺口：`answer_autosave_success` 遥测不带 clientSeq（TakeExamPage.tsx:906-910），成功保存遥测行无法按 clientSeq 与 receipt join。

授权读取面（source/authz-observability.md）：7 内置角色、Permission catalog 唯一权威（catalog.ts:23-173）；运行时 assignment-backed capability union（users.role/JWT role 仅投影）；观测面端点全景（audit 搜索/导出、timeline、receipt-summary、proctor-events、recovery、diagnostics、scores 导出）各自的 capability × resolver × 分配门 × org 谓词；反枚举约定全局一致（跨 org/跨考生/未分配→404；org 链不一致→403；解析失败→503）。

## 7. 三类权限域（来源：source/authz-observability.md §4；实验复核 adversarial 两份）

| 域 | 边界 | 标注 |
| --- | --- | --- |
| A. 应用 HTTP 用户权限 | capability × resolver（org/父链）× 分配 gate × 所有权，全链路在 apps/api/src/authz/ | LIVE_VERIFIED（本轮 113+ 探针） |
| B. 数据库连接账号边界 | 单一 `exam` 账号、无 CREATE ROLE/只读账号/按角分离；租户隔离完全由 repository org 谓词承担 | SOURCE_VERIFIED + psql 实测 |
| C. 部署环境 stdout/日志文件读取权限 | pino→stdout，无文件 destination、compose 无 logging 段；读取权由宿主 Docker daemon/部署环境决定，源码不可判定 | **INFRA_ACCESS_NOT_VERIFIED** |

## 8. 本轮 LIVE 补充事实（来源：source/field-provenance.md §10）

- **默认请求日志携带原始 URL 含 query**（LIVE_VERIFIED，fastify@5.8.5 探针）：`incoming request` 行 `url` 为 `req.raw.url` 原文（`/api/reset-password?token=RESET-TOKEN-ABC` 等），redact 不覆盖 `req.url`；SPA 全页 GET（reset-password/invite 携 token 于 query）只到 nginx 静态分支不进 Fastify（field-provenance §10.4），但任何 `/api/**?secret=…` 的 API 调用会以原文进 pino stdout。
- nginx `deploy/nginx/web.conf` 全文无 `access_log` 覆写 → 默认 combined 访问日志记录完整请求行含 query 与 referer（配置级 SOURCE_VERIFIED，运行时行为 INFRA_ACCESS_NOT_VERIFIED）。
- 61 个生产 log 调用点全量枚举：client_events metadata/requestId 不进 stdout 日志；error 级路径携带 `route: request.url` 原文（scopedCapability 等 16 处）。

## 9. 证据文件索引

| 文件 | 内容 |
| --- | --- |
| baseline/FACTS.md | 基线冻结（git/版本/架构/seed/发布状态） |
| source/server-correlation.md | 服务端关联链路精读（requestId/eventId/clientSeq/operationId/audit/WARN/引用信任） |
| source/client-contracts.md | 契约与前端（schema/sanitize/缓冲 ACK/200 无 requestId/receipt 消费） |
| source/authz-observability.md | 角色与 Permission 权威 + 观测读取面全景 + 三类权限域 |
| source/adrs-issues.md | ADR/契约/Issue 考古（时间线、边界条件、不可重新发明清单、EXSEM 映射） |
| source/field-provenance.md | 九字段溯源矩阵（含 §10 动态验证与 61 log 调用点枚举） |
