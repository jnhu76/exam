# 请求关联矩阵（REQUEST-CORRELATION-MATRIX）

- 轮次：secure-correlation-audit（终稿交付物 6/10）
- 汇总来源：`correlation/header-influence.md`（header 影响）、`correlation/02-consistency.md`（三处同值）、`correlation/saveanswer-matrix.md`（SaveAnswer 矩阵）、`correlation/investigation-playbook.md`（调查七情形）。
- 全部实验 LIVE_VERIFIED（2026-11-08 01:02–01:08 UTC+8 及 2026-11-07T17:12–17:21Z），环境与 DB 身份核验同前；原始输出在同目录 `*-raw.log`。

## 1. Header 影响矩阵（E1a–f：伪造 request-id / x-request-id / traceparent，含「声明他人真实 requestId」）

| # | 请求（全部携带伪造头） | HTTP | 信封 requestId（服务端新铸） | Pino 行 | 结论 |
|---|---|---|---|---|---|
| E1a | GET /api/EXAMAUDIT-CANARY-NOSUCHROUTE | 404 | `e49d3bc3…`（新 UUID） | req+res 同 reqId | 客户端值不采纳 |
| E1b | POST save 无认证 | 401 | `cf9a57c4…` | 同上 | 同上 |
| E1c | POST save 无认证 + **声明他人真实 requestId `e7a114e3…`** | 401 | `04f96794…`（新） | 原主 `e7a114e3…` 仍只有自己 2 行，未被复用 | 服务端身份未被覆盖或污染 |
| E1d | POST save schema 非法 body | 400 | `d3fadd7e…` | 同上 | 同上 |
| E1e | POST save 合法（cs=9） | 200 accepted | **响应体无 requestId**（成功契约无此字段） | reqId 新铸 | 200 路径客户端不可引用 |
| E1f | POST save 同 cs 异内容 | 200 CONFLICTING_PAYLOAD | 同上；WARN 行 reqId 新铸 | WARN 与 req/res 同 reqId | 业务拒绝 200 亦无 ID |

机制（SOURCE_VERIFIED）：`requestIdHeader: false`（server.ts:113）使 Fastify 忽略一切入站请求 ID 头；`genReqId` 每请求 UUIDv4（server.ts:111）；traceparent 无任何消费者（grep 生产代码零命中）。全日志 `grep -c EXAMAUDIT-CANARY-HDR` = 0（会话结束时复测仍 0）。

三处同值（02-consistency.md C1–C4，LIVE_VERIFIED）：错误信封 `error.requestId` = Pino `reqId` = audit `metadata.requestId` 逐字符相等（401 login.failure 实测三处同值，best-effort audit 延迟 <2s）；404/401/400 网关类拒绝有 Pino 行无 audit 行；`attempt.forceSubmit` audit 行 requestId 与 operationId 并存且不同值——两类身份不混用。

## 2. SaveAnswer 12 场景矩阵（T01–T10/S1/S3/R1 + 2 项 NOT_TESTED）

| # | 场景 | HTTP | 响应 | DB 侧写 |
|---|---|---|---|---|
| T01 | 新答案保存 cs=1 | 200 | accepted v1 | +receipt cs=1/v1 |
| T02 | 同 cs+同规范化内容重放 | 200 | **savedAt 与 T01 逐字符相同**（verbatim 原 ACK） | 零新写 |
| T09 | 同 cs+不同内容 | 200 | **CONFLICTING_PAYLOAD** | 零写 |
| T03/T04/T05 | 新版本 / STALE_VERSION / FUTURE_VERSION | 200 | accepted v2 / STALE+serverAnswer / FUTURE | +receipt / 零写 / 零写 |
| T06a/b/c | 答案形状非法 / 请求 schema 非法 / 路径体不一致 | 200 / 400 / 400 | INVALID_ANSWER(+WARN) / 信封 requestId=e7a114e3… / 信封 400 | 全零写 |
| T07a/b/c | 越权（他人 attempt）/ 未认证 / 错误角色 | 404 / 401 / 403 | 信封各带服务端 requestId，不泄露存在性 | 零写 |
| T08 | 并发重复（两请求同 cs=7 同内容） | 200/200 | 两请求均 accepted v3，savedAt 逐字符相同 | **只有一行 receipt**（行锁串行化，后者走幂等重放） |
| T10 | ACK 丢失（raw socket FIN） | 客户端无响应 | — | **服务端照常提交**（+receipt cs=10/v6）；重放同键返回 verbatim ACK（savedAt=提交瞬间）——「没收到 ACK≠没保存」 |
| S1/S3 | deadline 自动提交后 / 主动 submit 后保存 | 200 | ATTEMPT_ALREADY_SUBMITTED | 零写 |
| R1 | 跨重启前 receipt 重放（30 分钟前 cs=1） | 200 | verbatim ACK，savedAt=16:34:23.258Z（boot 时刻原 ACK） | 零写 |
| — | ATTEMPT_CLOSED（voided） | — | **NOT_TESTED（live）**：本部署无 void 管理路由，无安全途径造出 voided attempt。SOURCE_VERIFIED：answerProtocol.ts:150-157 返回 ATTEMPT_CLOSED 且零写 | — |
| — | DB 事务失败注入 | — | **NOT_TESTED（live）**：无可安全注入点（不重启共享服务、不 ALTER 共享配置、pg_terminate_backend 无法定向）。SOURCE_VERIFIED 原子性合同：答案写与 receipt 写同一事务（answerProtocol.ts:471-485），任一失败整体回滚 | — |

四身份区分（同一请求同框实测）：requestId（服务端 HTTP）/ operationId（客户端命令幂等键）/ SaveReceiptIdentity（服务端 canonical SHA-256，与 DB answer_identity 逐字符相等、独立复算验证）/ clientSeq（客户端重放键）——互不等价、不可互换。附带 LIVE 观察：disrupted 状态下保存仍被接受（status guards 只拦 voided/submitted/graded）。

## 3. 调查七情形：现状可解性（investigation-playbook.md，六段式流程 + jq/psql 配方全部实测）

| # | 情形（客户端报告内容） | 命中/误关联 | Verdict | 现状可解？ |
|---|---|---|---|---|
| 1 | 响应头 requestId（现状无响应头，用日志真实 ID 模拟） | 2 行，0 误关联 | 保存成功 CONFIRMED（receipt+sha256 吻合） | **服务端可解；客户端输入需新增能力**（成功响应头/体均无 requestId，pb-02 头清单实测） |
| 2 | 仅错误信封 requestId（400） | 2 行，0 | 请求已识别=校验拒绝，零业务写 | **可解**（信封是客户端唯一现实可得的服务端 ID） |
| 3 | 仅 attemptId+questionId+clientSeq | 拒绝类 WARN 直查 1 行；接受类 ±150ms 窗 5 候选→状态码+包含判据收敛到 1 | 业务问题可解；传输归因窗干净时可解 | **可解（有残余歧义）**：接受类无 WARN、receipt 不记 requestId，归因靠时间窗推断 |
| 4 | 伪造/不存在/他人真实 requestId | 0 / 0 / 3（他人行） | 伪造不可定位；跨主体声称被 url→DB 归属核验识破（实测） | **可解**（前提：组织先行的授权模型——req/res 行本身无主体字段） |
| 5 | 有 receipt 但请求日志已过期 | 0/0 | 业务事实仍 CONFIRMED（receipt append-only） | **可解**（业务事实）；传输层不可恢复是接受的限制 |
| 6 | 一个逻辑保存对应多个 requestId | 串行三请求可归因（包含判据唯一）；**T08 并发对同窗重叠，包含判据失效** | 串行可归因；并发不可归因（receipt 无 request 标记列，schema 实测 8 列） | **部分可解**：并发归因需新增能力或接受不可分（AMBIGUOUS 为既定三态语义） |
| 7 | 客户端声称成功但服务端证据不足 | — | 四类判定全实测：CONFIRMED / REFUTED-UNSUPORTED / REFUTED-内容级 / REFUTED-200≠成功 / INSUFFICIENT（N4 日志过期如实降级） | **可解**（判定框架现状完备） |

跨重启唯一性（pb-08）：停整进程组→重启，重启前 489 个 distinct reqId 与重启后 6 个新请求**交集=0**；单日志 3 个进程代零复用。跨重启 receipt 重放返回重启前原 savedAt（幂等语义不受影响）。

易错点（playbook §0.1，实测字段清单）：req/res 行**无任何组织/主体字段**（只查 reqId 得到无主记录）；Login 行字段名是 `requestId` 而非 `reqId`；WARN 行是唯一自带全业务键（org/actor/attempt/question/clientSeq/reason）的行。

## 4. 200 vs 错误信封可关联性差异（02-consistency.md §表）

| 维度 | 200 成功 | 200 业务拒绝 | 错误信封 4xx/5xx |
|---|---|---|---|
| 响应体 requestId | 无 | 无 | **有** |
| Pino req/res 行 | 有 | 有 | 有 |
| 额外服务端痕迹 | 无 | **WARN 行**（#861，全业务键+reqId） | request.log.error（500） |
| 客户端可引用性 | 不可 | 不可 | 可 |

## 5. 复现命令

```bash
# 伪造头影响 + 三处同值
bash .tmp/secure-correlation-audit/correlation/exp1-2.sh            # → 01-02-header-consistency-raw.log
# SaveAnswer 矩阵
bash .tmp/secure-correlation-audit/correlation/matrix.sh            # → 03-saveanswer-matrix-raw.log
# 调查 playbook（七情形逐场景）
bash .tmp/secure-correlation-audit/correlation/pb-s1-scenario1.sh   # 其余 pb-s2..s7 同目录
# requestId 直查配方
jq -cR 'fromjson? // empty | select(.reqId=="<ID>")' .tmp/secure-correlation-audit/env/server.log
```

证据持久位置：`.tmp/secure-correlation-audit/correlation/`（gitignored），本轮不自动回写。
