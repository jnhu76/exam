# 授权攻击·租户与考生 — 负例实验证据（authz-tenant）

> 红队审查产物。只读审计 + 受控实验：未修改任何 git 跟踪文件；全部脚本/日志在本目录（`.tmp/secure-correlation-audit/adversarial/`，gitignored）。
> 主体/资源全部为合成金丝雀（`EXAMAUDIT-CANARY-*`）。数据库身份先核验：`current_database()=exam_ci_audit`（db-identity.txt；容器 `exam-dev-db-1`，manifest 所指测试库，psql 只读）。
> 基线 master @ 423f2945；服务 `pnpm --filter @exam/api dev`（PID 773614，e2e 模式）。执行时间 2026-11-07T16:41Z–16:50Z（UTC）。

## 0. 主体 × 组织 × 资源 × 权限 × 端点 × 预期 矩阵

角色权威：`packages/authz/src/catalog.ts:213-221`（7 preset）；Candidate 权限集 `packages/authz/src/presets.ts:241-250`；Proctor `presets.ts:183-199`；Admin compat 超集 `presets.ts:52-147`。运行时权威 = assignment-backed capability union（`docs/architecture/authorization.md`）。

| # | 主体（org/role） | 目标资源（owner org） | 端点（源码检查点） | 预期 | 实测 | 证据 |
|---|---|---|---|---|---|---|
| M1 | adminB（B/Admin） | attempt A1（A） | GET /admin/attempts/:id/timeline（attempts.admin.ts:339-351） | 404 | 404 | run-01 L7-9 |
| M2 | adminB | attempt A1 | GET .../answer-save-receipt-summary（attempts.admin.ts:415-425） | 404 | 404 | run-01 L11-13 |
| M3 | adminB | attempt A1 | GET .../proctor-events（proctorMonitoring.ts:148-160） | 404 | 404 | run-01 L15-17 |
| M4 | adminB | attempt A1 | GET .../export（attempts.admin.ts:472-478, AttemptExport Admin-only） | 404 | 404 | run-01 L19-21 |
| M5 | adminB | attempt A1 | GET .../result（scores.ts:439-470） | 404 | 404 | run-01 L23-25 |
| M6 | adminB | exam A | GET /admin/exams/:id/proctor/attempts（proctorMonitoring.ts:100-112） | 404 | 404 | run-01 L28-30 |
| M7 | adminB | exam A | GET /admin/exams/:id/incidents | 404 | 404 | run-01 L32-34 |
| M8 | adminB | audit 行（A） | GET /admin/audit-logs（audit.ts:146-152, org 谓词） | 200 但 items:[] | 200 items:[]（含 targetId=A1 attempt 过滤亦空） | run-01 L37-43 |
| M9 | candB1（B/Candidate） | attempt A1 | GET /attempts/:id（ownAttemptCapability.ts:70-157） | 404 | 404 | run-01 L46-48 |
| M10 | candB1 | attempt A1 | GET /candidate/attempts/:id/take | 404 | 404 | run-01 L50-52 |
| M11 | candB1 | attempt A1 | GET /scores/attempts/:id（scores.ts:344-348） | 404 | 404 | run-01 L54-56 |
| M12 | candA1（A/Candidate） | attempt A2（同 org 他人） | GET /attempts/:id、/take、/scores/attempts/:id | 404 反枚举 | 3×404 | run-02 |
| M13 | candA1 | attempt A2 | POST /attempts/:id/answers/:qid、/heartbeat、/submit | 404 | 404/404/404（schema 合法体） | run-02 |
| M14 | candA2 | attempt A1 | 同 M12/M13 双向 | 404 | 全 404 | run-02 |
| M15 | candA1/candA2 | attempt（他人） | GET /admin/attempts/:id/{timeline,proctor-events,receipt-summary} | 403（无 capability，先于 resolver） | 3×403 | run-02 |
| M16 | proctorA2（A，未分配） | attempt A1 | timeline / proctor-events / receipt-summary / exam attempts | 404（分配门折叠） | 4×404 | run-02 |
| M17 | proctorA1（A，已分配金丝雀考试） | 其他考试的 attempt | timeline / proctor-events | 404（分配按考试粒度） | 2×404 | run-02b |
| M18 | 任意未授权主体 | 存在 vs 不存在 id | 见族5 12 格 | 不可区分 | 状态/码/字节全同，耗时重叠 | run-05 |
| M19 | candA2/candB1/proctorA1/adminA | client_events 冒用他人 attemptId/examId/questionId/eventId | POST /client-events（clientEvents.ts:87-98） | accepted=N，引用置空/规范 | 如设计，DB 终态核验 | run-06-07 |
| M20 | candA1/candA2 | 任意 | header x-request-id/request-id 冒用（server.ts:111-113） | 忽略，authz 结论不变 | 实测忽略 | run-01（全请求附带）、run-06-07 §7.1 |

正例对照（证明端点可用、非"全 404 假阳性"）：candA1→own attempt 200（run-01 L59-61）；proctorA1→A1/A2 timeline 200（run-01 L63-65 / run-02 §2.6）；candA2→own attempt 200（run-02 §2.6）；proctorA1→考试监控列表 200 items=2（run-01 末行）；adminB→自身 org 列表 200（空集）。

## 1. 族1 跨组织（run-01-cross-org.txt，脚本 f1-cross-org.sh）

adminB 携带 Org A attemptId/examId + 伪造 `x-request-id: EXAMAUDIT-CANARY-forged-request-id-0001` 访问 M1-M7 全部 404 `RESOURCE_NOT_FOUND`（响应 requestId 均为服务端新 UUID，伪造头未被采纳）。resolver 链 org 谓词：`packages/db/src/repository/attemptRepo.ts:288-292`（`eq(examAttempts.organizationId, orgId)`）→ 跨 org 行不可解析 → `resource_not_found` → 404（attemptResolver.ts:84-86 + scopedCapability.ts:258-261 映射）。
审计列表 M8：adminB 得 `items:[]`；`targetId=<OrgA attempt>` 过滤仍空 —— `auditLogRepo` org 谓词生效，无跨 org 行泄露。
candB1 M9-M11 全 404：own-attempt resolver 同 org 锚定。

## 2. 族2 同组织考生互读/互写（run-02-cross-candidate.txt，脚本 f2-cross-candidate.sh；run-02b）

- 读面 M12/M14：A1↔A2 互取 attempt/take/score → 全 404（ownAttemptCapability.ts:148-156 反枚举约定）。
- 写面 M13：heartbeat/submit → 404；save-answer 首轮 400 是**请求体 schema 缺 attemptId/questionId**（SaveAnswerRequestSchema 要求体内携带且与 path 一致，contracts/src/attempt.ts:203-210 + attempts.candidate.ts:988）；补测合法形状体 → 404 双向。path=自己 attempt + body=他人 attemptId → 400（path/body 一致性校验前置，无 smuggling 通道）。
- DB 终态：A1 answers=1（仅启动阶段合法保存）、A2 answers=0 —— 越权写零污染（run-02 末表）。
- M15 考生→监考端点 403（capability 拒绝先于资源解析，无存在泄露）；M16 未分配 proctor 404；M17 已分配 proctor 跨考试 404（分配门按考试粒度，plugins/authz.ts:79-92 每请求查 active 分配）。

## 3. 族5 资源枚举（run-05-enumeration.txt + f5-samples.tmp，脚本 f5-enumeration.sh）

12 格（6 端点面 × 存在/不存在）× 每格 5 次采样。汇总表（run-05 末段）：所有格 HTTP 404 / `RESOURCE_NOT_FOUND` / 118 字节（错误信封仅 requestId 随机变化）；耗时 min/med/max 全部重叠在 6.1–8.3ms 区间（唯一离群 candA1take/NONEXIST 0.0117s，方向上不构成"存在性更慢/更快"的稳定信号）。结论：未授权主体无枚举通道。

## 4. 族6 client_events 冒用他人引用（run-06-07-clientevents-requestid.txt，脚本 f6-client-events.sh；DB 终态 L79-101）

写入面 `POST /client-events`（authenticate-only，clientEvents.ts:87-98）→ 引用信任边界 `clientEventReferenceNormalizer.ts`（attempt 归属 = org + `candidateProfiles.userId===actor`，staff 无例外 :21-24/:149-160）。DB 终态（10 行）：

| 发送者 | 声称 | 终态 attempt_id / exam_id / question_id | 判定 |
|---|---|---|---|
| candA1（own） | own attempt+exam+q | 全保留 | 正例 ✓ |
| candA2 | **A1 的** attempt+exam+q+eventId+clientSessionId | attempt **NULL**；exam 保留（本人 enrollment）；q 保留（冻结快照内） | 符合设计（exam-anchored 路径 :96-106）✓ |
| candB1（Org B） | Org A attempt+exam+q | 全 **NULL** | 跨 org 无证明 ✓ |
| proctorA1（已分配 staff） | A1 attempt | 全 **NULL** | 无特权例外 ✓ |
| adminA | A1 attempt | 全 **NULL** | 同上 ✓ |
| candA1 | own attempt + **伪造 examId** | attempt 保留；exam 被替换为 canonical exam | 服务端派生关系胜出 :78-90 ✓ |
| candA1 | own attempt + **快照外 questionId** | q **NULL**，attempt/exam 保留 | :112-122 ✓ |
| candA2 | own enrollment exam | exam+q 保留 | 正例 ✓ |
| eventId 重放（candA1 原样重发） | 同 eventId | 行数 10（不新增）| 去重键 (org,user,eventId)，contracts/src/clientEvent.ts:106-110 ✓ |
| 混合批次（candA2：1 可证明 + 1 冒用） | — | accepted:2；冒用行全 NULL | **无存在 oracle**（accepted 恒=N）✓ |

冒用他人 eventId（candA2 用 `EXAMAUDIT-CANARY-EV-A1-0001`）→ 落为**冒用者自己**的新行（去重按 user 隔离），不会归入/去重命中受害者行；clientSessionId 冒用仅作为字符串存于冒用者自己行（非引用字段，credential-shape redact 之外无归属语义）。
受害者时间线核验：A1 attempt 关联行仅 candA1 自己 3 条 —— 无跨主体注入（run-06-07 L95-101）。

## 5. 族7 客户端自报 requestId（run-06-07 §7.1；run-01 全请求附带伪造头）

- header 注入：`x-request-id`/`request-id` 携带**他人真实 requestId**（取自 run-01 L8 服务端 requestId e3fd1e42…）→ 跨考生读仍 404、own 读仍 200（授权结论不变）；响应 requestId 恒为服务端新 UUID（server.ts:111-113 `genReqId` UUID + `requestIdHeader:false`）。
- 遥测通道：candA2/candB1 在 metadata 声称他人 requestId → 按客户端声明原样存于**自己**行（run-06-07 L82-83 claimed_request_id 列），且该行 attempt_id 已 NULL → 结构上不可能进入受害者 proctor-events 时间线（时间线按 attempt_id 关联，clientEventRepo.ts:241-243）。
- requestId 与授权零耦合：授权链（capability→resolver→分配门→所有权）无任何 requestId 输入。

## 6. 发现的真实问题：已授权 proctor-events 时间线 500（可用性，fail-closed）

**现象（LIVE_VERIFIED）**：proctorA1（已分配）GET `/api/admin/attempts/:id/proctor-events` 对**任何含 client_events 行**的 attempt 返回 500 INTERNAL_ERROR；空时间线 200。分页逐条隔离：limit=1 page=1..3 全 500；最小事件（无 metadata/route）单行亦 500（run-07b）。
**根因链（离线复现，run-07c..07f + 源码/构建产物对照）**：
1. server.log：`FST_ERR_RESPONSE_SERIALIZATION`，cause ZodError；
2. 调用真实 `buildProctorAttemptEventTimeline`（proctorMonitoringService.ts:371-429）对输出跑 `ProctorAttemptEventListResponseSchema.safeParse` → `items[i].occurredAt: Expected string, received date`（run-07d）；
3. 直查真实 repo `listTimelinePrefixByAttempt` 返回 occurredAt 为 **string**（run-07e）——但那是因为我的探针用**相对路径导入 src**；服务进程经包名 `@exam/db` 解析，`packages/db/package.json` exports `default → ./dist/*.js`（docs/architecture/workspace-module-resolution.md:36 生产/Node 上下文），而 `dist/repository/clientEventRepo.js`（2026-11-06 23:46 构建）仍是旧投影 `occurredAt: clientEvents.occurredAt`（dist L132，无 to_char）→ 驱动解码为 JS Date；src 的 #874 to_char 文本投影修复（clientEventRepo.ts:223，mtime 11-07 17:58）**晚于 dist 构建**；
4. `toTimelineEventFromClient`（proctorMonitoringService.ts:64-98）safeParse 失败落入 fallback，fallback 只纠正 level/kind、原样透传 occurredAt(Date) → 响应序列化失败 → 500。
**定性**：审计环境 stale dist（dev 进程跨包解析到未重建的 dist），非当前源码缺陷——以当前 src 行为构造的条目通过完整响应 schema（run-07c 3/3 PASS）。产品侧遗留加固观察：fallback 分支不纠正 occurredAt 的类型，未来任何回归仍会整端点 500（SOURCE_VERIFIED, proctorMonitoringService.ts:80-97）。
**影响**：仅可用性（fail-closed，无数据泄露、无越权）；本环境中 proctor-events 的 200-path 元数据白名单投影（SAFE_METADATA_ALLOWLIST, proctorMonitoringService.ts:177-205）无法 LIVE 验证 → 仅 SOURCE_VERIFIED。

## 7. 三类权限域区分

| 域 | 结论 | 证据 |
|---|---|---|
| A. 应用 HTTP 用户权限 | 本文档全部 LIVE 实验 | run-01/02/02b/05/06-07 |
| B. 数据库连接边界 | 单一 `exam` 账号直连 `exam_ci_audit`（manifest 连接串 + db-identity.txt：current_user=exam）；psql 仅执行 SELECT；租户隔离由应用层 org 谓词承担（attemptRepo.ts:290 等已实测） | db-identity.txt |
| C. 部署环境日志文件权限 | **INFRA_ACCESS_NOT_VERIFIED**：日志为 pino stdout（server.ts:114-118，无文件 destination），文件读取权限由部署环境决定，本审计不可测 | source/authz-observability.md §4C（继承） |

## 8. 证据文件清单（本目录）

- `db-identity.txt` / `db-state-baseline.txt` — DB 身份与初始状态
- `setup-01-candA2-login.txt` / `setup-02-candA2-start-attempt.txt` — candA2 登录 + 启动 canary attempt（d9bc2a50，受控实验，经应用 API）
- `f1-cross-org.sh` → `run-01-cross-org.txt` — 族1 + 正例对照 + 考试监控列表 200
- `f2-cross-candidate.sh` → `run-02-cross-candidate.txt`；`run-02b-proctor-cross-exam.txt` — 族2 + DB 终态
- `f5-enumeration.sh` / `f5-samples.tmp` → `run-05-enumeration.txt` — 族5 60 采样
- `f6-client-events.sh` → `run-06-07-clientevents-requestid.txt` — 族6+7 + DB 终态
- `run-07b-proctorevents-500-isolation.txt`；`repro-proctorevents-schema.ts`→`run-07c`；`repro-proctorevents-service.ts`→`run-07d`；`repro-repo-row.ts`→`run-07e`；`repro-service-typedump.ts`→`run-07f` — 500 复现与根因定位

## 9. 未测/受限项（如实）

- proctor-events 200-path 的 metadata 白名单投影与 SAVE 错误投影：因 §6 的 500 无法 LIVE 验证（SOURCE_VERIFIED only）。
- CSV/JSON attempt 导出、scores CSV 导出的**内容投影**：仅验证了授权边界（404/403 路径），内容级投影未展开（属读取面投影阶段，非本任务负例族）。
- Org B 侧正例（org B 自身资源读取）：org B 无自有考试/attempt fixture，仅 audit-logs 空集正例。
- 族3/族4 未在本任务范围（按 ask 执行 1/2/5/6/7）。
