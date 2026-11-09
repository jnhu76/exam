# 实验三：SaveAnswer 关联与幂等矩阵（saveanswer-matrix）

- 日期：2026-11-08 01:02–01:08 (UTC+8)；原始输出：`03-saveanswer-matrix-raw.log`（每步 curl 请求体、响应、HTTP 状态 + 步间 DB 快照 `exam_answer_save_receipts` / `exam_attempts`）。
- 对象：exam `6b8d0782-cee9-430f-9253-b0de3a905d07`（timed_window 30min，question `c9e708fe…` true_false，max_attempts=1，retake=unlimited）。
  - candA1 attempt `f665c325…`（boot 期建立：cs=1/v1 已保存，boot 后被心跳扫描标 disrupted，deadline 01:04:23）。
  - candA2 attempt `d9bc2a50…`（本会话 01:02 start；矩阵主载体；01:04:08 起连续实验，其间被心跳扫描标 disrupted 但保存继续被接受；01:07:31 submit→graded）。
  - candA2 retake attempt `ec7730e0…`（01:08 start，用于 operationId 演示后 force-submit→graded）。
- 源码依据：决策核 `packages/exam-engine/src/answerProtocol.ts:137-288`（顺序：status guards → deadline → canonicalize → 幂等键 → 版本）；receipt 键=(attemptId,questionId,clientSeq)，内容身份=canonicalAnswerIdentity（SHA-256，:91-95）；路由 `apps/api/src/routes/attempts.candidate.ts:951-1151`（#861 WARN 行 :1124-1138）。

## 身份概念区分记录（全程坚持，LIVE_VERIFIED 单请求同框）

| 概念 | 来源/所有者 | 实测样本 |
|---|---|---|
| requestId | 服务端每 HTTP 请求铸 UUIDv4（#860），信封/Pino/audit 三处同值 | `59b19aff-2617-4215-b32b-c7fd56dd52ae`（force-submit 请求） |
| operationId | 客户端提供、命令级幂等键（attempt command receipt 主键成分） | `1a7589e2-7c28-4b60-954e-8fd4757ec3ef`（同一次 force-submit，与 requestId 不同值、不同源；audit 行两者并存） |
| SaveReceiptIdentity | 服务端对**规范化后答案**算的 SHA-256 内容身份（receipt 键的内容判据） | `true→b5bea41b6c62…67e12b`、`false→fcbcf165908d…f8aa`（与 DB answer_identity 逐字符相等，sha256 独立复算验证） |
| clientSeq | 客户端提供的重放键（receipt PK 成分），与内容无关 | 1,2,7,8,9,10（candA2 attempt）；同值跨 attempt 互不抵消 |

四者互不等价、不可互换：clientSeq 相同≠内容相同（T09 证伪）；内容相同≠同一请求（T02/T08 replay 复用旧 ACK）；operationId 与 requestId 在同一审计行并存且不同值。

## 矩阵结果（HTTP 状态 / 协议结果 / DB 侧写）

| # | 场景 | 请求 | HTTP | 响应 | DB 侧写（receipts/answers） |
|---|---|---|---|---|---|
| T01 | 新答案保存 | cs=1 bv=0 ans=true | 200 | accepted v1 savedAt=17:04:08.504 | +receipt cs=1/v1；answers[0] v1 |
| T02 | 同 cs+同规范化内容重放（clientSavedAt 不同） | cs=1 ans=true | 200 | accepted v1 **savedAt 与 T01 逐字符相同** | 零新写（receipt 仍 1 行，answers 不变）——原样旧 ACK |
| T09 | 同 cs+不同内容 | cs=1 ans=false | 200 | **CONFLICTING_PAYLOAD** serverVersion=1 | 零写 |
| T03 | 新版本 | cs=2 bv=1 ans=false | 200 | accepted v2 | +receipt cs=2/v2 |
| T04 | STALE_VERSION | cs=3 bv=0 | 200 | **STALE_VERSION** v2 + `details.serverAnswer=false` | 零写 |
| T05 | 版本超前（附加） | cs=3 bv=5 | 200 | **FUTURE_VERSION** v2 | 零写 |
| T06a | 答案形状非法 | cs=4 ans="yes" | 200 | **INVALID_ANSWER** v2（+WARN 行） | 零写 |
| T06b | 请求 schema 非法 | cs=-1（类型/边界违例） | 400 | 信封 VALIDATION_ERROR，fields[clientSeq=TOO_SMALL]，requestId=e7a114e3… | 零写 |
| T06c | 路径/体不一致（他题 UUID） | body.q≠path.q | 400 | 信封 VALIDATION_ERROR requestId=a96a8d50… | 零写 |
| T07a | 越权：candA2→candA1 attempt | 合法协议体 | 404 | 信封 RESOURCE_NOT_FOUND requestId=349b5256…（不泄露存在性） | 零写 |
| T07b | 未认证 | 无 cookie | 401 | 信封 AUTH_REQUIRED requestId=14a695e7… | 零写 |
| T07c | 错误角色（Proctor） | proctor token | 403 | 信封 PERMISSION_DENIED requestId=1f5e1b70… | 零写 |
| T08 | 并发重复（两请求同 cs=7 同内容 bv=2） | 同时 2 个 POST | 200/200 | **两请求均 accepted v3，savedAt 逐字符相同**（17:04:10.503Z） | **只有一行 receipt cs=7/v3**——行锁串行化，后者走幂等重放分支，无重复写 |
| T10 | ACK 丢失（raw socket：发完整请求后 FIN，不读响应；cs=8 见 raw log / cs=10 原始套接字） | cs=10 bv=5 ans=true | 客户端无响应可读 | — | **服务端照常提交**：+receipt cs=10/v6，answers v6；随后重放同键返回 verbatim ACK（v6, savedAt=17:07:15.994Z=提交瞬间），证明“没收到 ACK≠没保存” |
| S1 | 已终结后保存（candA1 attempt，deadline 01:04:23 由 deadline scanner 于 01:04:25 auto-submit→graded） | cs=11 | 200 | **ATTEMPT_ALREADY_SUBMITTED** serverVersion=0 | 零写 |
| S3 | 已提交后保存（candA2 主动 submit→graded） | cs=12 | 200 | **ATTEMPT_ALREADY_SUBMITTED** | 零写 |
| R1 | 跨重启前 receipt 重放（candA1 cs=1，30 分钟前保存；attempt 已 disrupted） | cs=1 ans=true | 200 | verbatim ACK v1 savedAt=**16:34:23.258Z**（boot 时的原 ACK） | 零写（该 attempt 仍只有 cs=1 一行 receipt） |
| E1e/f | 伪造关联头下的保存 | cs=9 头伪造 | 200/200 | accepted v5 / CONFLICTING_PAYLOAD | 正常（+receipt cs=9/v5；拒绝零写）；requestId 不受影响（见 header-influence.md） |
| — | ATTEMPT_CLOSED（voided） | — | — | **NOT_TESTED（live）**：本部署无 void 管理路由（attempts.admin.ts 仅 misconduct/force-submit/time-grants），无安全途径造出 voided attempt。SOURCE_VERIFIED：answerProtocol.ts:150-157 对 voided 返回 ATTEMPT_CLOSED 且零写 |
| — | DB 事务失败注入 | — | — | **NOT_TESTED（live）**：无可安全注入点——不重启服务（本阶段禁止）；不 ALTER ROLE/DB 共享配置（影响同库其他连接与后台扫描 loop）；pg_terminate_backend 无法定向命中目标事务且可能误伤 scanner。SOURCE_VERIFIED 原子性合同：答案写与 receipt 写同一事务（answerProtocol.ts:471-485“one protocol commit”），任一失败整体回滚；未处理异常→500 信封（errors.ts:134-137，带 request.id） |

## 关键判定纪律验证

- **不能凭 HTTP 200 判定保存成功**：T02/T04/T05/T06a/T09/S1/S3 全部 HTTP 200 但 accepted:false（7 次协议拒绝 = server.log 7 条 WARN `Answer save rejected`，逐一对应）；判定依据必须是 `accepted`+`serverVersion`，且以 DB receipt/answers 为最终事实。
- **不能凭同 clientSeq 判定同内容已保存**：T09 用同 cs=1 提交不同内容得到 CONFLICTING_PAYLOAD 而非静默覆盖；内容判据是服务端对规范化值的 SHA-256（answer_identity，实测与 sha256('true'/'false') 逐字符相等）。
- **重放幂等返回的是“原 ACK”而非新确认**：T02/R1/T10-recovery 的 savedAt 均为原始接受时刻（逐字符复用），零新写。
- 附带 LIVE 观察：attempt 状态 **disrupted 下保存仍被接受**（引擎 status guards 只拦 voided/submitted/graded；candA2 attempt 矩阵全程 disrupted 仍 +5 receipt）——与“disrupted 可恢复”语义一致。
- 附带环境事件：01:05:28 tsx watcher 因 `packages/db/dist/types.js` 外部变更重启 worker（773644→783608，非本审计触发）；重启前后 receipt/version 连续（E1e bv=4→v5），requestId 无复用（UUIDv4）。重启唯一性实验归后续阶段，此处仅记录为环境事实。
- T00b admin time-grant 对 in_progress attempt 返回 409 INVALID_STATE_TRANSITION（operator 补时窗口与 attempt 状态不符），未留 audit/receipt/mutation——操作身份（operationId=e8ebd2d4…）与 HTTP requestId（aafc5698…）不同值的又一实例。
