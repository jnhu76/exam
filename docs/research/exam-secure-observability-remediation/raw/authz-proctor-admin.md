# Adversarial authz：监考分配边界 × 高权限读取面 × 路径一致性 × 投影差异（族 3/4/8/9）

> 红队审查产物（AGENTS.md §2 调查/审计模式）：只读探针 + 受控合成负载，未修改任何 git 跟踪文件。
> 环境：`http://localhost:3000`（PID 773614，APP_MODE=e2e）；DB 身份核验 `current_database()=exam_ci_audit, usr=exam`（docker exec exam-dev-db-1 psql，2026-11-08T00:44 CST）。
> 全部主体/数据为 EXAMAUDIT-CANARY-* 合成标识。角色与权限以源码为准：`packages/authz/src/catalog.ts`、`packages/authz/src/presets.ts`。
> 基线 master @ 423f2945。原始请求/响应/复现输出：本目录 `raw/`。

## 0. 主体与资源（MANIFEST.json + 源码角色）

| Subject | Org | 角色（源码 preset） | 关键事实 |
| --- | --- | --- | --- |
| admin | A | Admin（presets.ts:52-147 compat 超集） | seed 管理员 |
| proctorA1 | A | Proctor（presets.ts:183-199） | **有** active 分配 76d7e9a4→exam 6b8d0782 |
| proctorA2 | A | Proctor | **无**任何分配（负例主体） |
| candA1 | A | Candidate（presets.ts:241-250） | 拥有 attempt f665c325 |
| adminB | B | Admin（minted JWT） | Admin 角色、异组织（跨 org 负例） |
| anon | — | 未认证 | 401 面 |

Proctor preset 实际权限（presets.ts:183-199，本会话读原文）：`ExamRoomView, AttemptTimelineView, IncidentView, IncidentCreate, IncidentInvestigate`；显式不含 `AuditLogView / AttemptExport / IncidentRecoveryView / System* / ScoreExport / grading.*`。分配 gate：scopedCapability.ts:285-346（非 Admin 缺 active 分配→404 反枚举；gate 查询异常→503 fail-closed）。

资源（org A）：exam `6b8d0782-cee9-430f-9253-b0de3a905d07`；attempt `f665c325-f4a1-4547-89f5-5aa97bea026e`（disrupted）；incident `7d6b6bf6-def5-4613-9d04-4ee0838ede4e`（open，heartbeat_timeout 系统生成）。

## 1. 族 3：未分配监考员 × 监考/时间线/事件读取面（raw/f3-proctor-boundary.txt，41 探针）

矩阵（HTTP 状态码）：

| Endpoint（授权检查点源码） | proctorA2（无分配） | proctorA1（有分配） | candA1 | anon | admin |
| --- | --- | --- | --- | --- | --- |
| GET /admin/exams/:E/proctor/attempts（proctorMonitoring.ts:100-112） | **404** | 200 | 403 | 401 | 200 |
| GET /admin/attempts/:A/timeline（attempts.admin.ts:339-351） | **404** | 200 | 403 | 401 | 200 |
| GET /admin/attempts/:A/proctor-events（proctorMonitoring.ts:148-160） | **404** | **500**⚠ | 403 | 401 | **500**⚠ |
| GET /admin/attempts/:A/answer-save-receipt-summary（attempts.admin.ts:415-425） | **404** | 200 | 403 | 401 | 200 |
| GET /admin/exams/:E/incidents（incidents.admin.ts:585-595） | **404** | 200 | 403 | 401 | 200 |
| GET /admin/incidents/:I（incidents.admin.ts:623-633） | **404** | 200 | 403 | 401 | 200 |
| GET /admin/incidents/:I/detail（incidents.admin.ts:1486-1496） | **404** | 200 | 403 | 401 | 200 |
| GET /admin/proctor/exams（LIST，examRepo EXISTS 过滤） | 200, total:0 | 200, total:1（仅本考试） | 403 | 401 | 200 |
| GET /admin/proctor/incidents（LIST，:1436-1449 单一权威判定） | 200, items:[] | 200（仅本考试 incident） | 403 | 401 | 200（collectionScope:organization） |

**结论（族 3）**：分配边界 LIVE_VERIFIED 成立——proctorA2 对 7 个 scoped 端点全部 404 RESOURCE_NOT_FOUND（与资源不存在不可区分，scopedCapability.ts:340-344 反枚举），LIST 端点 SQL 侧过滤为空；proctorA1 同端点全部可达且内容仅限本考试。candA1 403（capability 缺失在分配 gate 之前）。adminB 列表（org B）为空。
⚠ proctor-events 的 500 是**授权通过之后**的可用性缺陷，见 §4。

## 2. 族 4：高权限面必须验证实际 Permission（raw/f4-permission-gate.txt，72 探针）

矩阵（12 端点 × 5 主体 + admin 基线）：

| Endpoint（capability 权威） | proctorA1 | proctorA2 | candA1 | adminB（Admin 角色） | anon | admin |
| --- | --- | --- | --- | --- | --- | --- |
| /system/health（SystemHealthView） | 403 | 403 | 403 | 200 | 401 | 200 |
| /system/diagnostics（SystemDiagnosticsView） | 403 | 403 | 403 | 200（integrity 块全 0，无 org A 数据） | 401 | 200 |
| /system/dashboard（SystemBusinessSummaryView, Admin-only） | 403 | 403 | 403 | 200（totalQuestions:0…recentExams:[]，无 EXAMAUDIT/6b8d0782 命中） | 401 | 200 |
| /admin/audit-logs（AuditLogView, Admin-only） | 403 | 403 | 403 | 200（**仅 org B 行**） | 401 | 200（org A 行） |
| /admin/audit-logs/export（同上） | 403 | 403 | 403 | 200（CSV 仅 org B 1 行） | 401 | 200（org A 29 行） |
| /admin/audit-log/actions | 403 | 403 | 403 | 200 | 401 | 200 |
| /admin/attempts/:A/export（AttemptExport, Admin-only） | **403**（虽有分配） | 403 | 403 | **404**（org 不匹配） | 401 | 200 |
| /admin/attempts/:A/export/csv（同上） | **403** | 403 | 403 | 404 | 401 | 200 |
| /admin/recovery/incidents（IncidentRecoveryView, Admin-only） | 403 | 403 | 403 | 200（org B 空） | 401 | 200 |
| /admin/recovery/attempts/:A（同上） | 403 | 403 | 403 | 404 | 401 | 200 |
| /admin/recovery/exams/:E（同上） | 403 | 403 | 403 | 404 | 401 | 200 |
| /exams/:E/export/scores（ScoreExport, Admin-only） | 403 | 403 | 403 | 404 | 401 | **409**（非终结 attempt，业务规则，权限已过） |

**结论（族 4）**：LIVE_VERIFIED——所有高权限端点按实际 capability 裁决而非登录角色：已分配 Proctor 在 Admin-only 面（含 diagnostics/audit/recovery/export 全家族）一律 403；Candidate 全 403；anon 全 401。adminB 持 Admin 角色可过 capability 面（system/audit 全局运维面），但触及 org A 资源时被 resolver org 边界折叠为 404，且其 200 响应内容全部 org B 化（audit JSON/CSV、dashboard、diagnostics、recovery 队列实测零 org A 泄露，grep EXAMAUDIT/6b8d0782/saveanswer 0 命中）。admin 的 scores 导出 409 证明权限层先于业务校验通过。

## 3. 族 8：同一数据三路径访问控制一致性（raw/f8-consistency.txt + raw/f8-*.{json,csv}）

**数据 1：audit 日志行（读取路径=admin UI 支撑 API JSON / 导出路径=CSV export）**

| Subject | GET /admin/audit-logs（读） | GET /admin/audit-logs/export（导出） | 一致性 |
| --- | --- | --- | --- |
| admin | 200，org A 行 | 200，org A 29 行 | ✅ |
| adminB | 200，仅 org B 行 | 200，仅 org B 1 行 | ✅ 同 deny-scope，org 过滤两侧一致 |
| proctorA1 | 403 | 403 | ✅ |
| candA1 | 403 | 403 | ✅ |
| anon | 401 | 401 | ✅ |

**数据 2：attempt 证据（读路径=timeline/proctor-events；导出路径=export json/csv）**

| Subject | timeline（AttemptTimelineView+assignment） | proctor-events（同左） | export json（AttemptExport） | export csv（同左） |
| --- | --- | --- | --- | --- |
| admin | 200 | 500⚠（§4，授权已过） | 200 | 200 |
| proctorA1（有分配） | 200 | 500⚠（§4） | 403（无 capability） | 403 |
| proctorA2（无分配） | 404 | 404 | 403 | 403 |
| candA1 | 403 | 403 | 403 | 403 |
| adminB | 404 | 404 | 404 | 404 |
| anon | 401 | 401 | 401 | 401 |

**数据 3：incident（scoped 读 / recovery 聚合 / proctor 工作列表）**：proctorA2 在 exam-incidents/incident-one/detail 全 404、两列表空；proctorA1 全 200 且内容限本考试；adminB 列表空；recovery 聚合面（IncidentRecoveryView）proctor 全 403、adminB 200 但 org B 空。三路径对每个主体的 allow/deny 裁决一致，无任一路径弱于兄弟路径（未发现"导出面绕过读面"或反之）。

**结论（族 8）**：CONFIRMED——同数据的多路径访问控制一致：能力+org+分配三因子在每个路径独立执行；唯一的路径差异是**声明的能力需求本身不同**（timeline=AttemptTimelineView vs export=AttemptExport），由 routeRegistry 声明且实测相符。500（§4）是可用性中断，不是授权旁路：授权失败主体仍被正确拒绝。

## 4. ⠇可用性缺陷（REFUTED 可用性主张）：proctor-events 对已授权主体 500

主张："已分配监考员/同 org Admin 可读取 attempt 合并监控时间线（client_events+audit）"——**REFUTED（本环境 LIVE_VERIFIED）**：

- Live：GET /admin/attempts/f665c325…/proctor-events（proctorA1 与 admin）→ 500 INTERNAL_ERROR；server.log:618/661 `ResponseSerializationError … cause ZodError`（原始行号见 env/server.log）。
- 行依赖：同 org 零 client_events 的 attempt（c814247e…）→ 200 `{"items":[],...}`（raw 记录于本文件 §4 命令序列）；即**只要有 client_events 行该端点即死**。
- 根因链（复现脚本 repro3/repro4/drivertest，输出存 raw/f9-500-*.txt）：
  1. src 服务层（PR-R 22bdce42，Nov 7 00:34）假定 repo SELECT 返回 `occurredAt` 为 SQL to_char 产生的 **string**（clientEventRepo.ts:223）；
  2. 但运行中的 tsx dev server 经 `@exam/db/repository/clientEventRepo` 解析到 **dist**（packages/db/package.json exports default→dist/index.js；实测 `require.resolve("@exam/db")=…/packages/db/dist/index.js`，构建于 Nov 6 23:46 = PR-R **之前**），该旧 repo 仍选原生 timestamptz 列 → drizzle 解码为 **Date**；
  3. src 服务把 Date 原样放入 `ProctorAttemptEventSchema`（z.string().datetime()，proctorMonitoring.ts:120）→ 逐项 safeParse 的 fallback 同样携带 Date → 响应序列化失败 → Fastify 500。
- 定性：**授权后可用性中断**（构建陈旧性：dist 未随 PR-R 重建，dev server 混跑 src+stale dist），非越权/泄露。生产影响取决于部署是否重建 dist（`pnpm verify` 含 build）；master 源码自身 src+src 一致（repro3 用 src repo 直连时 schema 通过的对照在 repro5 中：投影层产出 string 无异常——注意 repro3 因经 @exam/db 同样命中 stale dist，其"通过"版本为 dist 服务+dist repo 的旧旧组合）。
- 附加观察（低危）：404（无分配/无资源）vs 500（有分配且有事件行）的状态差异对 org A 内 Proctor 构成微弱的分配存在性 oracle，但仅在已授权 exam 范围内可见，无跨边界泄露。

## 5. 族 9：投影差异泄露（raw/f9-craft-post.txt、f9-stored-rows.txt、f9-projection-readback.txt、f9-scores-export-admin.csv）

受控注入：candA1 POST /api/client-events（200 accepted:2），2 条合成事件携带超白名单键（EXAMAUDIT-CANARY-extra/answerText/token/nested.deep）、未知事件名、query/fragment route、credential-shaped clientSessionId（payload 副本 raw/f9-craft-payload.json）。

**层 1 持久化消毒（psql 实读存储行）**：`token`/`answerText`/credential-shaped 值 → `[redacted]`；`route` 仅存 pathname（`?EXAMAUDIT-CANARY-token=…#frag` 被剥离，clientEvents.ts:31-44 LIVE_VERIFIED）；`clientSessionId` "Bearer …" → `[redacted]`；`EXAMAUDIT-CANARY-extra`、`nested.deep` 按契约原样入库（存储层只做 credential 消毒，不做白名单——白名单在投影层）。

**层 2 监考投影面（src service 真实投影代码 buildProctorAttemptEventTimeline，与路由同一函数）**：
- `answer_autosave_failed` → metadata keys 恰为 SAVE_ERROR_METADATA 7 键（questionId/saveMode/durationMs/errorCode/clientSeq/requestId/status）；`EXAMAUDIT-CANARY-extra`、`nested.deep`、`token`、`answerText` **全部丢弃**；
- 未知事件名 `EXAMAUDIT-CANARY-unknown-event` → `{}`（default-deny，proctorMonitoringService.ts:204-205 LIVE_VERIFIED）；
- 时间线行不含 `userAgent`/`clientSessionId`/`userId`（hasUserAgent:false 等，行字段集= id/serverRecordedAt/occurredAt/name/level/kind/metadata/route?/source）。
- 注：该读回的 HTTP 端点即 §4 的 500 面（授权后中断），故投影以服务层函数验证（同一代码路径产出 items 后才序列化失败）；HTTP 层读回 NOT_TESTED-live（500），见 §4。

**层 3 管理导出面字段集对比（admin 面）**：
- audit：JSON item 11 键（含 metadata/userAgent/organizationId）vs CSV 9 列（时间/操作/操作/操作者ID/对象类型/对象ID/IP/请求ID/操作ID）——CSV 刻意不含 metadata/userAgent（audit.ts:80-130），两侧实测相符；
- attempt export：JSON questionResults 含 standardAnswer/candidateAnswer/candidateAnswerIntegrity（原始证据面）vs CSV 10 列（题号/题型/题目内容/考生答案/标准答案/得分/满分/是否正确/考生答案模式/考生答案状态）——同为 Admin-only（AttemptExport）域内一致，无跨权限面泄露；
- scores export（72b9050a demo exam，200）：CSV 7 列（考生姓名/编号/部门/成绩/及格状态/尝试次数/提交时间），**无标准答案、无答案内容**（export.ts:100-132 LIVE_VERIFIED）。

**结论（族 9）**：CONFIRMED——各投影面字段集与源码声明一致；监考投影白名单丢弃全部超集键与未知事件 metadata；route 持久层即剥 query/fragment；CSV 面不携带 JSON 面的 PII 载体列。未发现投影差异导致的额外数据泄露。

## 6. 三类权限域结论

| 域 | 结论 | 证据 |
| --- | --- | --- |
| A. 应用 HTTP 权限 | 族 3/4/8/9 全部 LIVE_VERIFIED（本文件 §1-§5） | raw/f3、f4、f8、f9 |
| B. 数据库连接账号边界 | 单一 `exam` 账号、无角色分离（设计事实）：本审计 psql 即以同一账号跨 org 读取（exam_incidents/audit_logs 全表可读），org 隔离完全由 repository 谓词承担。与 authz-observability.md §4.B 一致 | docker exec psql 实测；docker-compose.dev.yml:13-14 |
| C. 部署环境日志文件权限 | **INFRA_ACCESS_NOT_VERIFIED**：源码内无日志文件配置（pino→stdout，server.ts:113-119；compose 无 logging 段）；本会话 server.log 是 harness 重定向产物，不代表生产宿主权限 | authz-observability.md §4.C + 本会话 grep 复核 |

## 7. 复查命令与原始文件索引

- 探针套件：`bash .tmp/secure-correlation-audit/adversarial/run-probes.sh`（113 探针，curl 逐条记录 status+body）
- 复现：`node --import tsx repro3.mts / repro4.mts / drivertest.mts / repro5-projection.mts`（apps/api cwd；输出已存 raw/）
- DB（只读）：`docker exec exam-dev-db-1 psql -U exam -d exam_ci_audit …`（身份核验先行）
- raw/：f3-proctor-boundary.txt、f4-permission-gate.txt、f8-consistency.txt + f8-*{json,csv}、f9-craft-payload.json、f9-craft-post.txt、f9-stored-rows.txt、f9-projection-readback.txt、f9-scores-export-admin.csv、f9-500-repro-src.txt、f9-500-repro-resolution.txt、f9-500-driver-decode.txt
