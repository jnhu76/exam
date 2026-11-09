# 实验二：错误信封 ↔ Pino ↔ audit 三处 requestId 一致性

- 日期：2026-11-08 01:05:51–01:08 (UTC+8)；原始输出：`01-02-header-consistency-raw.log`（curl + 修正版 SQL 查询 + grep 配对分析）。
- 源码依据：信封 `error.requestId = request.id`（`apps/api/src/plugins/errors.ts` 全部 7 个返回路径）；audit `metadata.requestId = truncate(request.id)`（`apps/api/src/audit/auditWriter.ts:83`，HTTP 路径；系统行不伪造 requestId，auditWriter.ts:40-44）；Pino 行由 Fastify 内建 logger 以 `reqId` 序列化（`apps/api/src/server.ts:114-118`）。

## 三处同值验证（LIVE_VERIFIED）

### C1 失败请求（401 login failure，HTTP 层失败 + 业务拒绝合一）

| 载体 | 值 |
|---|---|
| 错误信封 `error.requestId` | `4b5e09fc-2999-4703-b832-6aa77087095f` |
| Pino（server.log） | 同 reqId 的 `incoming request` + `request completed 401` 两行 |
| audit_logs `login.failure` 行 `metadata.requestId` | `4b5e09fc-2999-4703-b832-6aa77087095f`（`reason=invalid_password`，created 01:05:52） |

三处逐字符相等（best-effort audit 异步落库，延迟 <2s 实测可见）。

### C2 失败请求（404 未匹配路由 / 401 未认证 / 400 schema）

`e49d3bc3…`（404）、`cf9a57c4…`（401）、`d3fadd7e…`（400）、`e2d21fed…`（干净 404）：每个信封 requestId 在 server.log 均恰有同 reqId 的 req+res 一对行（raw log“pino pairs”节，逐 ID `lines=2`）。这类请求无 audit 行（404/401 网关类拒绝不审计，符合 auditPolicy 动作集）。

### C3 审计过的成功请求（login.success 200）

`login.success` audit 行 `metadata.requestId=3bd562db-0b7e-473a-836a-bc4c00d5d0e4` ↔ server.log 同 reqId 的 `POST /api/auth/login` req+res(200) 两行。**成功 200 响应体无 requestId**（登录响应只含用户信息）——客户端无法引用，但服务端 Pino↔audit 可互查。

### C4 命令审计行内 requestId 与 operationId 并存且不同（attempt.forceSubmit）

audit `attempt.forceSubmit` 行：`metadata.requestId=59b19aff-2617-4215-b32b-c7fd56dd52ae`（HTTP 写者键，服务端铸）且 `metadata.operationId=1a7589e2-7c28-4b60-954e-8fd4757ec3ef`（客户端提供的命令身份，命令收据主键）。二者并存、不同源、不同值——两类身份在审计层不混用（与 auditWriter.ts:40-44 的系统行注释一致：HTTP 行的键是 requestId，系统行绝不伪造 requestId）。

## HTTP 200 成功 vs 业务拒绝 200 的可关联性差异（LIVE_VERIFIED）

| 维度 | 200 成功（accepted save） | 200 业务拒绝（accepted:false） | 错误信封（4xx/5xx） |
|---|---|---|---|
| 响应体 requestId | 无（契约无字段） | 无（`SaveAnswerRejectedSchema` 无字段） | 有 |
| Pino req/res 行 | 有（reqId） | 有（reqId） | 有（reqId） |
| 额外服务端痕迹 | 无 | **WARN `Answer save rejected`**（#861，reqId + org/actor/attempt/question/clientSeq/reason/serverVersion，无答案内容；本会话共 7 条，与 7 次协议拒绝一一对应） | `request.log.error`（500 路径） |
| audit 行 | 无（saveAnswer 不审计，auditPolicy 已弃用该动作——attempts.admin.ts:325-331 注释） | 无 | 仅审计动作集内的失败（如 login.failure）有 |
| 客户端可引用性 | 不可（无 ID 可报） | 不可（无 ID 可报） | 可 |

差异结论：三种路径服务端都能靠 reqId 串起 Pino 行；但**客户端侧**只有错误信封路径拿到了可引用的 requestId。成功/业务拒绝 200 的客户端报障只能报 attemptId+questionId+clientSeq+时间窗（业务拒绝行的字段恰好覆盖：WARN 行携带 clientSeq 与 reason），配合服务端 WARN 行可定位——业务拒绝因 #861 的 WARN 行比成功保存多一层业务语义（reason/clientSeq/serverVersion），但两者都没有持久化 audit 记录。

## 附带观察

- WARN `Answer save rejected` 行出现重复键（`organizationId`/`actorId`/`actorRole` 在同一 JSON 行出现两次——route 显式传入的字段与 request log 上下午 ctx 合并重复）。值为同值重复，JSON 解析取后者，无语义错误；属日志卫生噪音，低严重度。
- T00b admin time-grant 对 in_progress attempt 返回 409 `INVALID_STATE_TRANSITION`（信封含服务端 requestId `aafc5698…`），且**未写任何 audit 行**（动作表无 attempt.time_grant 新行）——状态守卫先于审计落库，失败命令不产生“已执行”痕迹。
