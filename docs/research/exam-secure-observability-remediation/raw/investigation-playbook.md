# Investigation Playbook — 客户端报障 → 服务端证据定位（最小安全流程，实测版）

- 日期：2026-11-07T17:12–17:21Z；环境：共享审计环境（API :3000 / `exam_ci_audit`，身份核验 `pb-00-db-identity.txt`；重启一次后 pid 787438）。
- 输入：`env/server.log`（Pino JSONL，单文件跨 3 个进程代 773644→783608→787468，1204+ 行）、`env/MANIFEST.json`、本目录前阶段实验（`02-consistency.md`、`saveanswer-matrix.md`、`header-influence.md`）。
- 本文档所有命令都在本机实际执行；每情形的原始命令与输出在本目录 `pb-s<N>-scenario<N>-raw.log`。金丝雀主体全部 `EXAMAUDIT-CANARY-*`。
- 活体载体：candA2 新 retake attempt **C = `db3a024d-07e3-4517-9aee-33896939bca3`**（本会话建立；heartbeat 已标 disrupted，保存照常接受——与矩阵实验一致）。

## 0. 流程总纲（六段式）

```text
Client Report ──► Correlation Candidate ──► Scoped Pino Lookup ──► Server Request
（客户端给了什么）   （能定位服务端记录的键）     （组织/主体/时间窗收敛后查询）    （req/res/WARN 三类行）
                                                                      │
                                              Receipt/Domain Verification ◄─┘
                                              （DB receipt / attempt / audit 终态）
                                                                      │
                                                                                  Verdict
                                              （CONFIRMED / REFUTED / UNSUPPORTED / INSUFFICIENT）
```

### 0.1 日志载体清单（查询前必读；实测字段见 `pb-03-log-scoping-facts.txt`）

| 行类型 | 携带字段 | 组织/主体上下文 | 业务语义 |
|---|---|---|---|
| `incoming request` | `reqId`, `req{method,url,host,remoteAddress,remotePort}` | **无** | 请求到达 |
| `request completed` | `reqId`, `res.statusCode`, `responseTime` | **无** | 传输层完成 |
| `Answer save rejected`（WARN，`attempts.candidate.ts:1123-1138`） | `reqId`+`organizationId`+`actorId`+`actorRole`+`attemptId`+`questionId`+`clientSeq`+`reason`+`serverVersion` | **全** | 协议拒绝（HTTP 仍 200） |
| `Login accepted/denied` | **字段名是 `requestId`（非 `reqId`）**+`organizationId`+`actorId` | 全 | 登录结果 |
| `Response serialization error` 等 error 行 | `reqId`+`actorId`+`actorRole`+`organizationId`+`url`+`method` | 全 | 500 路径 |
| 心跳/deadline 扫描行 | 仅计数 | 无 | 后台事件（不带 requestId） |

⚠️ 两个易错点：(1) **req/res 行没有任何组织/主体字段**——只查 reqId 得到的是"无主"记录；(2) Login 行用 `requestId` 字段名，只按 `.reqId` 查会漏。

### 0.2 授权模型（先收敛，后查询）

契约依据：`docs/contracts/observability.md:40`（organizationId 是 log search 的 tenant scoping 字段）、`:57-62`（#860：requestId 不是 tenant/auth/operation 身份，不得仅凭 ID 形状推断出处）。

1. **调查范围先行**：工单必须先落成 (organizationId, subject userId/candidateId, 时间窗)。requestId/attemptId 等键只是"在已授权范围内检索"的定位键，**不是授权凭据**。
2. **日志侧收敛**：优先用自带组织字段的行（WARN/error/Login）按 `organizationId` 过滤；对 req/res 行，用 `req.url` 中的 attemptId/examId 做 pivot，回 DB 核对归属（实测见各情形步骤 C）。
3. **DB 侧收敛**：`exam_answer_save_receipts` PK 自带 `organization_id`；`audit_logs` 有 `organization_id` 索引——一切终态查询都以 org 为第一谓词。
4. **requestId 碰撞面**：UUIDv4 每请求新铸（`server.ts:111-113`，`requestIdHeader:false` 拒收客户端头——前阶段 E1c 已证伪造无效）。实测 489+6 个请求跨 3 个进程代零复用（`pb-03`、`pb-08`）。

## 1. 通用查询配方（jq + psql，全部实测）

```bash
LOG=.tmp/secure-correlation-audit/env/server.log
# A. requestId 直查（情形1/2/4/5）
jq -cR 'fromjson? // empty | select(.reqId=="<ID>") |
  {t:(.time/1000|todateiso8601),msg,url:.req.url,status:.res.statusCode,rt:.responseTime}' $LOG
# B. 业务键直查（情形3 path A：拒绝类）
jq -cR 'fromjson? // empty | select(.msg=="Answer save rejected"
  and .attemptId=="<ATTEMPT>" and .clientSeq==<N>)' $LOG
# C. 时间窗 + URL 收敛（情形3 path B：接受类；epoch ms）
jq -cR 'fromjson? // empty | select(.msg=="incoming request"
  and (.req.url|contains("<ATTEMPT>")) and (.time >= T0 and .time <= T1)) | {reqId,t:.time}' $LOG
# D. DB 终态（receipt 是保存事实的唯一权威）
docker exec exam-dev-db-1 psql -U exam -d exam_ci_audit -c \
 "SELECT client_seq,accepted_version,answer_identity,saved_at,(saved_at AT TIME ZONE 'UTC') AS utc \
  FROM exam_answer_save_receipts WHERE organization_id='<ORG>' AND attempt_id='<A>' \
  AND question_id='<Q>' AND client_seq=<N>"
# E. 归属核验（req/res 行无主 → url pivot → DB）
docker exec exam-dev-db-1 psql -U exam -d exam_ci_audit -tAc \
 "SELECT organization_id,candidate_id,exam_id FROM exam_attempts WHERE id='<ATTEMPT-from-url>'"
```

**请求归因规则（saved_at 包含判据，实测有效）**：接受类保存没有日志行携带 clientSeq；判定"哪个 requestId 执行了写"用 `receipt.saved_at ∈ [incoming.t, completed.t]` 区间包含判据（情形3/6 实测）。例外：并发重复请求同窗重叠时不可分（见情形6）；ACK 丢失请求无 completed 行（见情形6 part4）。

**判定纪律**：`HTTP 200 ≠ 保存成功`（协议拒绝走 200 信封，WARN 行才是拒绝痕迹）；`日志命中 ≠ 业务事实`（receipt/DB 终态是唯一权威）；`无日志行 ≠ 未发生`（ACK 丢失时写已发生而无 res 行）。

## 2. 七情形实测结果

| # | 情形（客户端报告内容） | 查询路径 | 命中 | 误关联 | Verdict | 现状可解？ |
|---|---|---|---|---|---|---|
| 1 | 响应头 requestId（现状无响应头，用日志真实 ID `0c31ea1d…` 模拟） | A 直查 → E 归属 → D receipt | 2 行（req+res） | 0 | 保存成功 CONFIRMED（receipt v1 + sha256(true) 吻合） | **服务端可解；客户端输入需新增能力**（成功响应头/体均无 requestId，`pb-02` S1-1 头清单实测） |
| 2 | 仅错误信封 requestId `48fcd633…`（400 VALIDATION_ERROR） | A 直查 → D | 2 行 | 0 | 请求已识别=参数校验拒绝，零业务写（DB 无行） | **可解**（信封是客户端唯一现实可得的服务端 ID；schema 拒绝无 WARN——拒绝发生在 handler 之前） |
| 3 | 仅 attemptId+questionId+clientSeq（无任何 requestId） | 拒绝类：B 直查 WARN（全字段+reqId 一步到位）；接受类：D receipt（业务事实直接可证）+ C 时间窗回找请求 | B=1 行；C=±150ms 窗 5 候选 → 状态码+包含判据收敛到 1 | 窗内 401/403/400 请求是天然假阳性，status 过滤可除 | 业务问题（存没存/版本）**可解**；传输归因在窗口干净时可解 | **可解（有残余歧义）**：接受类无 WARN、receipt 不记 requestId，归因靠时间窗推断 |
| 4 | 伪造/不存在 requestId（随机 UUID、金丝雀串、他人真实 ID） | A 直查 | 0 / 0 / 3（他人请求的行） | 不存在 ID：0；**声称他人 ID：命中他人请求=必然误关联**，靠上下文行（error/WARN 行 actorId）或 url→DB pivot 识破（实测 candA2 工单声称 proctorA1 的 `99442870…`，其 500 行带 actorId=4837ff2c → 主体不符拒绝） | 伪造 ID 不可定位；跨主体声称可被 0.2 授权模型拦截 | **可解**（前提：授权模型执行 0.2——req/res 行本身无主体字段，纯 200 请求只能靠 url pivot 识破） |
| 5 | 有 receipt 但请求日志已过期（拷贝日志，截断至 17:15:30Z 后） | A/C 在截断日志上重放 | 0 / 0 | 0 | **业务事实仍 CONFIRMED**（receipt 在，append-only 无删除路径）；传输层归因丢失，verdict 降级为"DB 事实成立、请求层不可考" | **可解**（业务事实）；日志侧不可恢复是接受的限制 |
| 6 | 一个逻辑保存对应多个 requestId（cs=2：创建/重放/冲突 三请求；cs=1 跨重启重放；历史 T08 并发对） | C+A 全请求枚举 + WARN join + D + 包含判据 | cs=2 三请求：创建者 `54b7b764`（saved_at .174 ∈ [168,193] 唯一包含）、重放 `17dde44c`（200 但窗内无 receipt 时刻=零写 verbatim ACK）、拒绝 `8d751675`（WARN） | T08 并发对 `afa8dc35`/`3cf7742c` **同窗重叠，包含判据失效**——两请求都可能创建了那一行 receipt | 串行多请求可归因；**并发重复不可归因**（receipt 无 request 标记列，schema 实测：PK=(org,attempt,question,clientSeq) 仅此 8 列） | **部分可解**：串行归因现状可解；并发归因需新增能力（receipt/audit 增 request 标记）或接受不可分 |
| 7 | 客户端声称成功但服务端证据不足 | D + B + C 三层核验 | 见下 | — | 四类判定全实测（下表） | **可解**（判定框架现状完备）；见 INSUFFICIENT 类限制 |

### 情形7 判定矩阵（实测，`pb-s7-scenario7-raw.log`）

| 声称 | 服务端证据 | Verdict |
|---|---|---|
| P: cs=1 true 已保存 | receipt cs=1 v1，answer_identity=sha256("true") 逐字符相等 | **CONFIRMED** |
| N1: cs=99 true 已保存（坚称收到成功提示） | 无 receipt、无 WARN、attempt 的 receipt 全集={1,2}（append-only，无删除路径 ⇒ cs=99 不可能被接受过） | **REFUTED（UNSUPORTED claim）** |
| N2: cs=2 已保存 true | receipt cs=2 在但 identity=sha256("false")≠声称内容；且 cs=2 true 的请求有 WARN CONFLICTING_PAYLOAD | **REFUTED（内容级证伪）** |
| N3: 请求 8d751675 返回 200 所以保存成功 | 同 reqId 有 WARN（协议拒绝走 200 信封）+ 零新 receipt | **REFUTED（200≠成功）** |
| N4: 日志已过期（截断后）+ 声称 cs=99 | 无 receipt + 无任何留存日志 ⇒ 无法区分"从未到达 / 到达被拒已轮转" | **INSUFFICIENT（如实降级，不得臆断）** |

## 3. 重启/多进程唯一性（本轮允许的一次重启，`pb-08-restart-raw.log`）

- 停整进程组（RUNBOOK §4.2）→ 原命令重启（>> 追加同一 server.log）→ ~5s 健康，新 pid 787438。
- 重启前 489 个 distinct reqId，重启后 6 个新请求：**交集 = 0**；无任何 reqId 跨重启边界重复出现；单日志共 3 个进程代（773644/783608/787468）零复用。机制与 #860 注释一致（`server.ts:108-113`：UUIDv4 规避跨重启计数器复用）。
- 附带验证：跨重启 receipt 重放（重启后重发 cs=1）返回 **重启前的原 savedAt**（17:14:50.108Z verbatim ACK），receipt 零变化——重启不影响幂等语义，且为情形6 又添一个"同逻辑保存的第 4 个 requestId"实例。

## 4. 结论：现状可解 vs 必须新增能力

**现状可解决（无需改代码）**
1. 情形2（错误信封）与情形1 的服务端侧：requestId → 2 行 Pino → 归属核验 → receipt 终态，全链闭环。
2. 情形3 业务问题：receipt 直接证明"是否保存/版本/内容身份"（sha256 规范化身份），不需要 requestId。
3. 情形4：不存在 ID 零命中；跨主体/跨组织声称可被"组织先行 + url→DB 归属核验"拦截（0.2 授权模型）。
4. 情形5：日志过期时业务事实仍由 receipt 独立支撑（append-only）。
5. 情形7 判定框架：CONFIRMED/REFUTED/UNSUPPORTED/INSUFFICIENT 四类均可依证据落判。
6. requestId 跨进程/重启唯一性（UUIDv4 + 拒收客户端头）。

**必须新增能力才可解决**
1. **情形1 的客户端输入**：成功（200）响应的头与体均无 requestId（契约 `contracts/src/attempt.ts:218-246` 无字段）。要让"客户端报 ID"成为真实路径，需新增响应头（如 `x-request-id` 回写）或成功体加字段——属契约变更，须走合同流程。
2. **情形6 并发归因**：receipt 表无 request 标记列（实测 schema 8 列）；并发重复请求（T08 型）创建者不可分。需 receipt 或 WARN/audit 增 request 维度（注意 #861 已否决"持久拒绝记录"，增列须重新过决策框架）。
3. **情形3 接受类的无损归因 / ACK 丢失的完成时刻**：接受保存无业务日志行（含 clientSeq 的只有拒绝 WARN）；无 res 行时包含判据失效。可选补救：接受时也记一行带业务键的 info 日志（同 observability.md `:43-47` 的 SHOULD 方向），比持久化便宜。
4. **N4 类 INSUFFICIENT 的彻底消除**：本质上要回答"请求是否到达过"，需请求级留痕覆盖全部路径（含 401/403/400 网关拒绝已天然有 req 行；缺口在保留期与接受类业务键缺失，同上第 3 点）。

## 5. 证据索引（本目录）

| 文件 | 内容 |
|---|---|
| `pb-00-db-identity.txt` | DB 身份再核验（exam_ci_audit/exam@exam-dev-db-1） |
| `pb-01-live-traffic.sh/.log`、`pb-attempt-c.id` | attempt C 建立 + 首轮流量（含 body 缺字段 400 负例） |
| `pb-02-live-traffic-fixed.sh/.log` | S1/S2/S6/S7 活体流量（含完整响应头证明无 request-id 头） |
| `pb-03-log-scoping-facts.txt` | req/res 行字段清单、reqId 唯一性、unpaired 请求、requestId/reqId 字段名差异 |
| `pb-s1-scenario1.md` + `-raw.log` | 情形1 全链 |
| `pb-s2-scenario2-raw.log` | 情形2 全链 |
| `pb-s3-scenario3-raw.log` | 情形3（WARN 直查 + 时间窗 ms 级时间线） |
| `pb-s4-scenario4-raw.log` | 情形4（0 命中 + 跨主体声称识破） |
| `pb-s5-scenario5-raw.log` | 情形5（截断日志重放 + 双向"日志↔事实"不对应证明） |
| `pb-s6-scenario6-raw.log` | 情形6（三请求归因 + T08 并发不可分 + schema 证明 + ACK 丢失） |
| `pb-s7-scenario7-raw.log` | 情形7（四类声称判定） |
| `pb-08-restart-raw.log` | 重启实验（跨重启唯一性 + 跨重启重放） |

源码依据（本会话复核）：`apps/api/src/server.ts:108-113`（genReqId/requestIdHeader）、`apps/api/src/routes/attempts.candidate.ts:1118-1140`（#861 WARN 行及 org scoping 注释）、`apps/api/src/audit/auditWriter.ts:82-84`（audit metadata.requestId）、`docs/contracts/observability.md:40,43-47,57-63`（scoping 字段与 #860 语义）。
