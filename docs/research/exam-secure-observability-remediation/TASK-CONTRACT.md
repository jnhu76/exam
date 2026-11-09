# EXAM — Final Security, SaveAnswer Correlation & Operational Logging Closure

## Role

你是 GPT-6 Flash，担任 Exam 项目的实施负责人和多专家审查协调者。

你需要完成一次**以真实源码、实际故障注入、攻击性测试、性能测量和独立 Subagent Review 为依据的最终工程收口**。

项目：

https://github.com/jnhu76/exam

关联 PR：

- #922 — 审计证据归档
- #923 — client_events.route 安全模板投影
- #924 — 全站 X-Request-Id 响应头
- #926 — Pino / nginx 日志隐私

关联 Issue：

- #800 — Observability 总台账
- #864 — route 隐私
- #865 — SaveAnswer requestId
- #925 — HTTP 日志隐私
- #919 — user_agent 最小化，独立 P2
- #920 — stale-dist，独立 P2
- #921 — 新日志平台 NO_GO

本轮任务类型：

**TARGETED IMPLEMENTATION + REAL SYSTEM VERIFICATION + ADVERSARIAL REVIEW + INDEPENDENT SUBAGENT FINAL ADJUDICATION**

本轮不从零开始重建方案，而是在已有四个 Draft PR 的基础上完成最终修复。

---

# 0. Owner 最终决策

以下三项 Owner 决策已经明确，本轮不得重复争论是否需要实施。

## Decision A — #926 保留上游诊断日志

不接受通过 `error_log crit` 压制 nginx 正常故障诊断的方案。

对于本地、自管的 Exam 部署，优先保留 nginx 原生 error-level 故障信息。

默认候选：

`error_log /var/log/nginx/error.log error;`

允许通过真实故障注入比较 `error` 与 `warn`，但不恢复到 `crit`，也不为了安全直接关闭错误日志。

同时保留 #926 已实现的安全 access-log 格式。

**明确接受的风险：nginx 原生 error log 可能包含完整请求行，且某些请求行可能携带敏感 URL。**

这是一项有边界的风险接受，不是宣称所有日志完全脱敏。

必须验证并记录：

- 原生日志实际泄露范围；
- 谁能读取它；
- 它在哪里持久化；
- 它保留多长时间；
- 本地运维诊断的收益；
- 无法在当前环境验证的部署边界。

不得将安全的 access log 与可能包含原始 URL 的 error log 混为同一个安全声明。

## Decision B — #923 接受历史数据临时残余风险

接受：

- 不迁移历史 client_events.route。
- 不批量删除现有生产数据。
- 保留读取端安全模板再投影。
- 历史记录按照现有 30 天 retention 机制自然清理。

但必须验证：

1. 清理任务确实能够删除过期记录。
2. cutoff 使用服务器可信时间。
3. 清理遵守组织隔离。
4. 重启或错过周期后能够恢复收敛。
5. 失败不会永久静默。
6. 备份保留范围和权限边界被记录。

如果无法访问实际部署或备份，必须注明 UNKNOWN，不能宣布整个历史数据风险已经消除。

## Decision C — #924 必须完成真实 SaveAnswer 消费

只提供 `api.postWithMeta()` 不足以完成 #865。

本轮必须把 requestId 接入真实自动保存流程：

`HTTP SaveAnswer → response header → API client → TakeExamPage → failure/rejection diagnosis → authorized server log lookup`

确保 HTTP 200 的业务拒绝、HTTP 4xx/5xx、网络失败和成功保存都有正确且不同的证据语义。

但不允许为了记录每个成功请求而新增持久化 telemetry。

---

# 1. 工作权限与基本规则

允许：

- 读取仓库、Issues、PR、ADR、测试和文档；
- 使用独立 worktree；
- 在现有 PR 分支修复代码；
- 编写必要的单元、集成、E2E 和故障注入测试；
- 使用隔离 PostgreSQL；
- 使用 nginx 测试容器；
- 运行 benchmark 和完整 CI；
- 提交并 push 到对应 PR 分支；
- 更新 PR 描述、评论和对应 Issue；
- 生成并归档可复核证据；
- 使用独立 Subagent 进行最终 Review。

禁止：

- 直接修改 master 工作树；
- 自动合并；
- 自动发布；
- force push；
- 修改 SaveAnswer 后端保存收据语义；
- 改动 clientSeq、answerIdentity、version 权威；
- 新建日志平台、查询 API、管理调查 UI；
- 新建 requestId 数据库表；
- 修改生产数据；
- 将真实凭据、考生答案或敏感日志提交到 GitHub；
- 顺手处理 #919、#920 或其他不属于本轮的 P2。

**任何必要但超出本次授权的修改，须独立记录，不得隐式施工。**

---

# 2. 第一阶段：重新冻结基线与 PR

首先获取：

`origin/master`

以及四个 PR 的最新 HEAD、base、diff、检查状态、评论与 Review。

此前记录：

- #922 — `7243aa5c`
- #923 — `038bcdbc`
- #924 — `9e1b8a75`
- #926 — `623bc4b4`

这些仅是历史参考，不是可以直接使用的冻结版本。

检查：

1. 是否已合并其他相关修复；
2. 工作树是否干净；
3. AGENTS.md 是否允许当前 git 写操作；
4. 每个 PR 的 HEAD 是否发生变化；
5. 是否有最新 review comments；
6. 是否存在重复修改与合并冲突；
7. #865 的当前状态和 Owner 决策记录。

建立：

`BASELINE.md`

记录：

- MASTER_SHA
- PR_HEAD_SHA
- Node / Fastify / Pino / nginx 版本
- PostgreSQL 版本
- pnpm / Turbo 构建路径
- 生产启动方式
- 实际日志输出路径

**必须注意 #920 stale-dist 风险。**

实验和最终测试必须确保实际加载的依赖产物对应预期源码版本。

不能把旧 dist 导致的行为错误归因于本轮 PR。

---

# 3. 第二阶段：#924 SaveAnswer 真实消费端修复

这是本轮最重要的应用层工作。

## 3.1 真实调用链

必须审计：

- `apps/web/src/pages/exam/TakeExamPage.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/examTelemetry.ts`
- `apps/web/src/exam/*`
- `apps/web/src/hooks/useSubmitFlush.ts`
- `packages/contracts/src/attempt.ts`
- `apps/api/src/routes/attempts.candidate.ts`
- `apps/api/src/lib/proctorMonitoringService.ts`
- `docs/operations/save-failure-evidence.md`

当前已知保存流程：

`saveAnswer → scheduleSave → api.post → SaveAnswerResponseDTO → UI state/telemetry`

#924 已建立：

`api.postWithMeta<T>()`

返回：

`{ data, meta: { requestId } }`

但真正的 `TakeExamPage` 保存调用尚未使用它。

## 3.2 最小改造目标

把实际保存请求改为使用 `postWithMeta`，复用现有业务请求体。

示意：

```typescript
const { data: result, meta } =
  await api.postWithMeta<SaveAnswerResponseDTO>(
    `/api/attempts/${attemptId}/answers/${questionId}`,
    payload,
  );

const requestId = meta.requestId;
```

这是语义草案，不是允许直接机械替换全部调用的命令。

必须先检查：

- 泛型推导；
- 现有 payload 类型；
- debounced callback；
- request scope generation；
- catch/finally；
- UI state reducer；
- retry；
- 提交前 flush；
- 恢复流程。

不得因为多了一个 metadata wrapper 就改变任何 SaveAnswer 请求、重试或版本处理语义。

## 3.3 必须正确区分六类结果

### Case A — HTTP 200 accepted:true

服务端确认本次保存被接受。

要求：

- 更新 serverVersion；
- 维持原有 saved 状态；
- 不改变 SaveAnswer receipt identity；
- 允许捕获这次请求的服务端 requestId；
- 不自动新增一条包含 requestId 的持久化成功事件；
- 不把 requestId 当成保存成功的证据。

如果需要保留成功请求编号供当前页面的人工诊断使用，只允许采用轻量、临时、attempt-scoped 的内存记录。

必须证明它不会无限增长、跨考试残留或泄露答案。

优先复用已有状态与 ref，避免新增复杂的关联状态机。

### Case B — HTTP 200 accepted:false

这是重点。

该响应具有服务端 HTTP requestId，但不会形成 ApiError。

当前 `answer_autosave_failed` 的业务拒绝分支缺少 requestId。

修复后：

- 继续使用 `result.reason` 判断业务拒绝；
- 在失败遥测中附上实际响应头中的 requestId（仅存在时）；
- 保持 clientSeq、durationMs、reason；
- 保持原本的拒绝分类；
- UI 在适当的失败提示位置提供诊断编号；
- 不把 HTTP 200 错误分类成 500；
- 不声称发生网络中断。

元数据示意：

```typescript
{
  saveMode: "autosave",
  durationMs,
  errorCode: result.reason,
  clientSeq,
  ...(requestId ? { requestId } : {}),
}
```

这只是示意。必须复用现有 telemetry allowlist 和 sanitizer 约束。

### Case C — STALE_VERSION + serverAnswer

这是最容易产生语义回归的分支。

当前逻辑会根据服务器提供的答案执行协调，并恢复 UI 状态。

必须保持：

- serverAnswer 为服务器权威数据；
- 正确更新 serverVersion；
- 不新增假的失败记录；
- 不把原有协调成功路径改成 Save Failure；
- 不暴露 answer 内容到日志；
- requestId 不参与内容比较和版本判断。

可以捕获对应 HTTP requestId，但不能因为收到 `accepted:false` 就忽略现有 reconciliation 分支。

### Case D — HTTP 4xx/5xx

继续兼容现有 ApiError。

检查 Error Envelope 的 requestId 与 `X-Request-Id` 的一致性。

如果两者都存在但不一致：

- 不静默选择一个当作可信事实；
- 记录为 correlation inconsistency；
- 遵守现有错误传播路径；
- 不将客户端输入的 Header 当成服务器权威。

如需在客户端使用某个值，必须定义明确优先级和可信程度。

禁止引入新的全站错误处理框架。

### Case E — Transport failure / ACK 丢失

如果响应根本未抵达客户端：

`requestId = null / unknown`

不能用：

- clientSeq；
- attemptId；
- 时间窗；
- 本地 UUID；
- 上一次请求的 requestId；

伪造当前 HTTP 尝试的 requestId。

必须保持 `UNKNOWN` 调查语义。

重试是否保存成功仍需依赖服务端 receipt 与领域状态核验。

### Case F — 多请求并发与旧请求迟到

测试：

- 1500ms debounce；
- 连续修改同一答案；
- 多道题交错保存；
- 同一道题多次重试；
- 用户切换 attempt；
- 导航离开考试页面；
- reset/recovery；
- old response 晚于 new response；
- 同一 clientSeq 不同内容的 T09 情形。

严格保护现有：

`scopeGenAtSchedule`

`saveStale()`

以及 attempt-scoped 版本与 clientSeq 状态。

**迟到请求不能覆盖新 attempt 的 requestId、Save State 或诊断信息。**

## 3.4 UI 交付要求

真正的端到端调查能力必须能被使用。

优先在现有 Save Rejection Alert 或服务器故障提示中展示：

`请求编号：<requestId>`

要求：

- 仅在实际收到 ID 时展示；
- 缺失 ID 不显示虚假占位；
- 优先复用现有翻译与 Alert 组件；
- 不暴露答案内容；
- 不改变原有失败原因文本；
- 既不能把业务拒绝说成断网，也不能把服务端 500 说成保存成功；
- 恢复成功、重新进入新 attempt 后清除过期失败提示；
- 不因 Heartbeat 的 requestId 覆盖一次 SaveAnswer 的拒绝 ID。

需要特别审查当前：

`saveFaultRequestId`

与：

`saveRejection`

是否属于同一 UI 语义。

如果两者不同，允许增加一个最小、明确属于 Save Rejection 的 requestId 状态。

禁止为了合并两个概念而创建复杂的全局诊断 Context。

如现有 UI 不适合直接展示，应选定最小可用的支持信息展示方式，并通过真实浏览器测试证明考生在失败发生后能够取得对应编号。

## 3.5 客户端遥测的安全边界

当前 Monitoring 对 requestId 的定位是：

**client-claimed correlation candidate**

不能改变这一性质。

验证：

- `answer_autosave_failed` 允许必要的 requestId 字段；
- 共享 sanitizer 不会错误删除有效 UUID；
- 非法、超长、恶意输入不会被当作权威证据；
- 读取端仅投影 allowlisted 字段；
- 监考时间线仍将这些值标注为客户端声明；
- 不产生新跨租户查询能力。

HTTP Header 是浏览器观察到的值，不能因此认定该字段已成为数据库权威事实。

## 3.6 必须完成的测试

至少构造以下矩阵：

| 场景 | 预期 |
| --- | --- |
| accepted:true | 保存正常，业务状态不变 |
| accepted:false | 失败遥测含正确 requestId |
| accepted:false 无 Header | 遥测不伪造 ID |
| STALE_VERSION + serverAnswer | 正常协调，不新增错误失败事实 |
| CONFLICTING_PAYLOAD | 正确保留 reason 和 requestId |
| 401/403/409 | ApiError 与关联编号正确 |
| 500 | 服务器故障提示和 requestId 正确 |
| transport error | UNKNOWN，无服务端 ID |
| ACK 丢失后重试 | 多 HTTP ID，业务身份仍独立 |
| old attempt delayed response | 不能污染新 attempt |
| 多问题并发 | 不混用其他题目的 requestId |
| retry/flush | 不产生新的保存实现 |
| 手动诊断 | 能从实际 UI 或支持信息取得编号 |
| 跨租户 | requestId 不提供额外访问权限 |

要求测试既覆盖 mock HTTP，也覆盖真实浏览器 + 实际 API + PostgreSQL。

必须包含真实 SaveAnswer HTTP 200 的业务拒绝，不能仅模拟 HTTP 500。

## 3.7 业务正确性门禁

以下必须全部保持：

`SAVEANSWER_RECEIPT_SEMANTICS = UNCHANGED`

`CLIENT_SEQ_SEMANTICS = UNCHANGED`

`ANSWER_IDENTITY_SEMANTICS = UNCHANGED`

`RETRY_SEMANTICS = UNCHANGED`

`STALE_ATTEMPT_ISOLATION = PASS`

`FALSE_FAILURE_TELEMETRY = 0`

`REJECTION_REQUEST_ID_CORRELATION = PASS`

修订并 push 到现有 PR #924，不创建重复 PR。

---

# 4. 第三阶段：#926 恢复 nginx 原生故障诊断

## 4.1 明确区分两类日志

### Access Log

继续使用 #926 已实现的安全格式。

允许：

- HTTP method
- 安全的固定路径类别
- status
- response bytes
- request time
- upstream status
- upstream response time
- 可信上游 X-Request-Id

禁止把原始 query/path、Cookie、Authorization 或 Referer 恢复到 access log。

### Error Log

恢复 nginx 原生错误诊断。

默认候选：

```nginx
error_log /var/log/nginx/error.log error;
```

这部分保留 nginx 实际输出的 upstream error message。

Owner 明确接受：部分 error message 可能包含原始请求行。

不能为了让 Canary 全为零而重新设置 `crit`。

也不能修改 nginx 上游源代码，或添加未经必要性证明的日志过滤代理。

## 4.2 真实故障注入矩阵

用隔离 nginx 容器测试：

1. API upstream 正常。
2. API upstream 容器停止。
3. Connection refused。
4. Upstream timeout。
5. 上游关闭连接。
6. nginx DNS 解析失败。
7. 不存在的 upstream host。
8. upstream 返回 502/503/504。
9. malformed URI。
10. 客户端提前断开连接。
11. 静态 SPA 请求。
12. HTTP 与项目已配置的 HTTPS 激活形态。

每个场景记录：

- access log
- error log
- HTTP status
- upstream status
- duration
- requestId（如果由 API 实际生成）
- 是否记录了客户端敏感 URL
- 是否能凭原生 error message 识别根因

对比：

`crit / error / warn`

优先选择 `error`，除非真实测试表明 `warn` 对本项目具有明确必要的诊断收益。

不得把 debug 作为常规默认级别。

## 4.3 安全边界与日志权限

恢复原始 error log 后，更新风险模型。

必须独立评估：

- nginx 容器 stdout/stderr；
- 宿主机日志；
- Docker 日志驱动；
- systemd / journald（若实际使用）；
- 已配置的日志轮转；
- 备份；
- 本地管理员和 Docker 用户的读取权限；
- 第三方日志收集器（如存在）。

注意 Docker 宿主机权限可能足以读取容器日志，且部分 Docker 管理权限接近宿主机高权限。

不要用应用 RBAC 证明 OS 日志权限安全。

如果没有真实部署环境：

`INFRA_LOG_ACCESS = NOT_VERIFIED`

不能假装完成了生产权限审计。

建议给出最小必要的部署建议：

- 限制日志读取主体；
- 保留既有轮转与容量保护；
- 避免无限保留错误日志；
- 不将原始 error log 暴露给考生或普通管理员；
- 排障材料必须先脱敏再共享。

不允许仅为了这次修复引入新日志平台。

## 4.4 安全结论必须拆分

完成后分别输出：

`NGINX_ACCESS_LOG_PRIVACY = PASS / FAIL`

`NGINX_ERROR_LOG_DIAGNOSTIC = PASS / FAIL`

`NGINX_ERROR_LOG_RAW_URL_RISK = ACCEPTED / NOT_ACCEPTED`

`INFRA_LOG_ACCESS = VERIFIED / PARTIAL / NOT_VERIFIED`

不能再用单一：

`NGINX_RAW_SECRET_EXPOSURE = 0`

概括 nginx 所有日志。

## 4.5 回写

更新 #925、PR #926 的：

- Owner Decision
- 隐私/诊断取舍
- 故障注入结果
- 真实权限边界
- 未验证部署项
- 与原 `crit` 版本的差异

将代码推送至现有 PR #926。

---

# 5. 第四阶段：#923 Retention 与历史数据风险验收

本阶段主要是验证和文档收口，不预先要求修改产品代码。

## 5.1 审查现有机制

核对：

`apps/api/src/plugins/clientEventRetention.ts`

以及对应 repository、测试和部署初始化代码。

已知设计：

- `CLIENT_EVENT_RETENTION_DAYS = 30`
- `CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS = 24h`
- 启动后执行一次清理
- 每日定期清理
- Organization-scoped DELETE
- 服务端 `receivedAt` 决定 cutoff
- 清理失败有结构化日志和 operability 信号
- 关闭时等待正在执行的清理

这些只是需要重新核验的设计事实，不能自动当成已执行的运行时保证。

## 5.2 必测条件

使用隔离 PostgreSQL 和可控时钟：

- 29 天事件保留。
- 超过 30 天事件删除。
- 恰好 cutoff 的边界行为。
- 多组织清理。
- 某组织清理失败。
- 其他组织不受失败影响。
- 失败后下一轮恢复。
- 进程重启后补偿清理。
- 没有过期数据时的空清理。
- 清理任务启动、完成和失败日志。
- 并发写入与清理。
- shutdown 正在执行时的行为。

不得为了让测试通过直接修改 retention 政策。

## 5.3 明确最终保证的边界

特别注意：

**30 天 cutoff 并不自动意味着数据在精确满 30 天的瞬间已经物理删除。**

每日 Sweep、启动补偿和停机期间的时间差可能导致删除延迟。

必须分别报告：

- Retention eligibility horizon
- Sweep cadence
- 实际清理完成时间
- Failure recovery
- Downtime effects
- Historical backup retention

不能将“到达可删除年龄”写成“已经从所有介质删除”。

## 5.4 Legacy route

用真实旧格式记录验证：

- 原始 legacy route 在清理前仍可能保存在数据库中。
- 经过当前读取端时必须投影为安全模板或 null。
- 过期行在执行清理后被删除。
- 删除不会影响其他组织有效行。
- 任何读取端不得因历史记录绕过安全投影。

## 5.5 备份边界

枚举真实存在的备份机制：

- PostgreSQL backup
- Docker volume backup
- SQL dump
- 离线备份
- 项目已有的部署/恢复工具
- 其他明确配置的备份入口

如果相关机制不存在，应明确说明。

如果存在，调查：

- 备份保留期；
- 加密；
- 文件读取权限；
- 恢复后旧事件是否重新出现；
- 备份清理与业务 retention 是否独立。

如果无部署权限，记录尚未验证的事实。

禁止自动清理生产备份。

## 5.6 最终裁决

Owner 已接受无需生产迁移。

只要：

- 新写入安全；
- legacy 授权读取安全；
- 30 天清理机制已得到真实验证；
- 备份残余风险已清楚标记；

即可将 #923 判为满足当前获授权的产品修复范围。

不能把历史原始字节仍存在的事实隐藏掉。

---

# 6. 第五阶段：组合集成与性能

四个 PR 合并顺序为：

`#922 → #923 → #924 → #926`

不直接合并 master。

创建独立 integration worktree，在同一冻结 master 基线上按上述顺序应用四个 exact HEAD。

如果 PR 之间存在相同文件修改，应正确解决最终组合，而不是只依赖单 PR 的 CI。

重点检查：

- `server.ts`
- `cors.ts`
- `requestIdHeader.ts`
- `logRedaction.ts`
- `TakeExamPage.tsx`
- `api.ts`
- `proctorMonitoringService.ts`
- `clientEventRetention.ts`
- nginx 配置
- observability / API contract / ADR-025

执行：

1. Typecheck
2. Lint
3. Format
4. Unit tests
5. API integration tests
6. Web tests
7. PostgreSQL tests
8. Real browser E2E
9. Security Canary tests
10. Nginx live-container tests
11. 完整项目 CI 对应门禁
12. 生产构建一致性检查

不要因为某个测试 historically flaky 就自动豁免新失败。

必须在未改基线上复现同签名 flake，才能将其排除在本轮回归之外。

## 6.1 性能测量

至少包含：

- SaveAnswer p50/p95/p99
- SaveAnswer throughput
- CPU/request
- `postWithMeta` 前端开销
- 临时关联状态的额外分配
- route projection cost
- nginx access log bytes
- nginx error log 在故障注入下的输出量
- Pino bytes
- client-events 写入次数
- PostgreSQL transactions/operation

重点保护：

`NEW_SUCCESS_TELEMETRY_WRITES = 0`

`NEW_REQUEST_ID_DB_WRITES = 0`

`SAVEANSWER_DOMAIN_WRITES = UNCHANGED`

`PERFORMANCE_REGRESSION = NOT_DETECTED / DETECTED / INCONCLUSIVE`

采用交错 A/B 和足够重复次数。

报告必须包含噪声、置信区间及原始数据。

不能把测试环境中没有检测到回归解释成理论零成本。

---

# 7. 第六阶段：必须使用独立 Subagent Review

**这是本轮强制阶段，不得跳过，也不得把主执行 Agent 对自己实现的 Review 冒充独立审查。**

必须在所有功能修复和集成测试完成后启动。

优先使用可用的 Subagent/Agent 执行接口。

如果执行环境不支持创建真正独立的 Subagent，应明确记录：

`SUBAGENT_REVIEW = NOT_RUN`

这种情况不能声称最终独立复核完成，也不能自动以主 Agent 自审替代。

## 7.1 四个独立审查角色

创建四个互相隔离的审查任务。

### Subagent A — Security / Privacy Red Team

职责：

- 检查 #923 路由封闭输出是否存在可绕过路径。
- 检查 legacy 数据是否有其他未保护读取端。
- 检查 #924 requestId 是否被错误视为凭据。
- 检查 SaveAnswer 失败遥测是否泄露答案、用户数据或非授权信息。
- 检查 #926 的 access log 是否重新泄露原始 URL。
- 检查 nginx error log 风险接受是否被准确记录。
- 核验跨租户、跨角色负例。

必须主动寻找新反例，而非只审阅现有测试名称。

### Subagent B — SaveAnswer Protocol & Concurrency

职责：

独立审核：

- accepted:true
- accepted:false
- STALE_VERSION reconciliation
- clientSeq
- answerIdentity
- baseVersion
- save receipt
- debounce
- retry
- flush
- attempt generation
- route change
- old response
- concurrent saves
- ACK loss

重点寻找：

**因为引入 requestId 而使 UI、telemetry 与真实保存事实不一致的情况。**

必须检查是否产生虚假失败、漏报失败、错误关联或跨 attempt 污染。

### Subagent C — Linux/Nginx/Ops Reliability

职责：

- 检查 nginx `error` / `warn` 选择。
- 通过实际故障注入确定诊断价值。
- 检查 HTTP/HTTPS 配置一致性。
- 检查日志权限与容器日志保留方式。
- 检查 30 天 retention 的真实运行收敛。
- 检查备份残余风险。
- 审查异常情况下的可诊断性。

不得仅因为 error log 可能含 URL 就要求重新设置 `crit`；必须尊重已接受的本地运维取舍，并指出仍需满足的隔离条件。

### Subagent D — Architecture & Performance

职责：

- 判断新代码是否有过度抽象。
- 检查是否增加不必要的 React 状态。
- 检查 `requestWithMeta` 是否造成重复 Fetch、重复解析或业务协议变化。
- 检查性能成本、allocations、日志放大。
- 检查 CI/构建产物是否可信。
- 检查四 PR 的组合结果。
- 审核能否删除重复实现，保留最小必要改动。

必须提出可验证的简化建议，不能只提出代码风格意见。

---

## 7.2 Subagent 输入隔离要求

四个 Subagent 必须使用：

- 同一个冻结集成 SHA；
- 同一个确切的 PR diff 集合；
- 相同的正式任务契约；
- 各自领域需要的原始测试证据。

**第一轮不向 Subagent 提供其他 Subagent 的结论。**

不要在审查任务里直接告知：

“前面三个审查都通过了。”

这样会造成确认偏差。

每个 Subagent 必须独立提交：

- Reviewed SHA
- Reviewed files
- Threat / invariant coverage
- Concrete findings
- Reproduction
- Severity
- Proposed minimal fix
- Remaining uncertainty
- Verdict

结果单独归档：

- `review-security.md`
- `review-saveanswer-protocol.md`
- `review-nginx-operations.md`
- `review-architecture-performance.md`

## 7.3 对抗性 Review

要求每个 Subagent 至少检查：

- 正常路径；
- 一个错误路径；
- 一个并发或生命周期边界；
- 一个跨权限边界；
- 一个当前测试尚未充分覆盖的反例。

发现问题时区分：

`CONFIRMED`

`INFERRED`

`NOT_REPRODUCED`

`UNKNOWN`

不得将猜测直接写成已确认漏洞。

## 7.4 修复—复审闭环

主执行 Agent 收集 findings 后：

1. 将问题去重。
2. 归属到 #923、#924、#926 或独立剩余风险。
3. 针对真实问题编写失败测试。
4. 在正确 PR 分支修复。
5. 重新运行受影响的测试。
6. 更新集成 SHA。
7. **由原发现者或另一独立 Subagent 对新的 exact SHA 复审。**
8. 重新运行整个集成门禁。

不得仅凭“我已经修好了”关闭 Subagent finding。

P0/P1 finding 不允许以单方口头解释豁免。

P2 finding 可以在有明确风险和工程成本说明后，给出修复或 Owner 风险接受建议。

如果发现超出当前授权的安全问题，必须创建独立 Issue 候选，不可借本轮偷偷扩大代码范围。

最终审查结果：

`SECURITY_REVIEW = PASS / BLOCKED`

`PROTOCOL_REVIEW = PASS / BLOCKED`

`OPS_REVIEW = PASS / CONDITIONAL / BLOCKED`

`ARCHITECTURE_REVIEW = PASS / BLOCKED`

`PERFORMANCE_REVIEW = PASS / INCONCLUSIVE / BLOCKED`

---

# 8. GitHub 回写与状态管理

对现有 PR 更新：

- #923：Retention 与 legacy 风险验收证据；
- #924：真实 SaveAnswer 调用链、UI、遥测、并发测试；
- #926：nginx 原生日志恢复、故障注入与风险接受；
- #922：如需补充审计证据，仅追加有必要且安全的归档。

对 Issue：

- #864：#923 最终验证；
- #865：#924 端到端交付；
- #925：nginx 错误诊断 Owner 决策；
- #800：最终联合裁决与依赖顺序。

不自动关闭任何仍有未处理验收项的 Issue。

不自动合并 PR。

不发布版本。

不得把 Draft PR 的 CI PASS 写成 master 已交付。

---

# 9. 最终交付物

生成：

1. `FINAL-OWNER-DECISIONS.md`
2. `SAVEANSWER-CORRELATION-E2E.md`
3. `SAVEANSWER-PROTOCOL-REGRESSIONS.md`
4. `NGINX-DIAGNOSTICS-AND-PRIVACY.md`
5. `CLIENT-EVENT-RETENTION-VERIFICATION.md`
6. `HISTORICAL-DATA-AND-BACKUP-BOUNDARY.md`
7. `INTEGRATION-CI-AND-PERFORMANCE.md`
8. `review-security.md`
9. `review-saveanswer-protocol.md`
10. `review-nginx-operations.md`
11. `review-architecture-performance.md`
12. `FINAL-ADJUDICATION.md`
13. `SHA256SUMS`

每份报告必须有：

- 真实代码 SHA；
- 运行环境；
- 执行命令；
- 关键测试结果；
- 原始证据路径；
- 已知边界；
- 结论可信度。

禁止把临时目录当成唯一长期证据位置。

任何归档到 GitHub 的测试材料必须脱敏。

---

# 10. 最终输出契约

严格输出：

```text
BEGIN_EXAM_FINAL_OBSERVABILITY_CLOSURE

MASTER_SHA = ...
INTEGRATION_SHA = ...

PR_922_HEAD = ...
PR_923_HEAD = ...
PR_924_HEAD = ...
PR_926_HEAD = ...

SAVEANSWER_REAL_CLIENT_CONSUMPTION = PASS / FAIL
SAVEANSWER_200_REJECTION_CORRELATION = PASS / FAIL
SAVEANSWER_HTTP_ERROR_CORRELATION = PASS / FAIL
SAVEANSWER_SUCCESS_SEMANTICS = PASS / FAIL
SAVEANSWER_STALE_RECONCILIATION = PASS / FAIL
SAVEANSWER_CONCURRENT_SCOPE_ISOLATION = PASS / FAIL
SAVEANSWER_UNKNOWN_SEMANTICS = PASS / FAIL

REQUEST_ID_SERVER_AUTHORITY = PASS / FAIL
REQUEST_ID_AUTHORIZATION_BOUNDARY = PASS / FAIL

NGINX_ACCESS_LOG_PRIVACY = PASS / FAIL
NGINX_ERROR_LOG_DIAGNOSTIC = PASS / FAIL
NGINX_ERROR_LOG_LEVEL = ...
NGINX_ERROR_LOG_RAW_URL_RISK = ACCEPTED / NOT_ACCEPTED
INFRA_LOG_ACCESS = VERIFIED / PARTIAL / NOT_VERIFIED

RETENTION_30D_CONTRACT = PASS / FAIL
RETENTION_STARTUP_CONVERGENCE = PASS / FAIL
RETENTION_FAILURE_RECOVERY = PASS / FAIL
RETENTION_TENANT_ISOLATION = PASS / FAIL
LEGACY_ROUTE_READ_PRIVACY = PASS / FAIL
HISTORICAL_AT_REST_RISK = ACCEPTED
BACKUP_RETENTION = VERIFIED / PARTIAL / UNKNOWN

SECURITY_SUBAGENT_REVIEW = PASS / BLOCKED / NOT_RUN
PROTOCOL_SUBAGENT_REVIEW = PASS / BLOCKED / NOT_RUN
OPS_SUBAGENT_REVIEW = PASS / CONDITIONAL / BLOCKED / NOT_RUN
ARCHITECTURE_SUBAGENT_REVIEW = PASS / BLOCKED / NOT_RUN
SUBAGENT_FINDINGS_UNRESOLVED = ...

PERFORMANCE_VERDICT = PASS / REGRESSION / INCONCLUSIVE
FULL_INTEGRATION_CI = PASS / FAIL / NOT_RUN

GITHUB_WRITEBACK = ...
PR_MERGE_READINESS = ...
MERGE_STATUS = NOT_MERGED
RELEASE_STATUS = NOT_RELEASED

REMAINING_RISKS = ...
BLOCKERS = ...

END_EXAM_FINAL_OBSERVABILITY_CLOSURE
```

最后用中文解释：

1. SaveAnswer 的真实客户端消费链路是否完整；
2. 实际 HTTP 200 业务拒绝是否能精确定位服务器请求；
3. 是否保持全部保存、重试和恢复语义；
4. nginx 原始错误日志提供了哪些新增诊断能力；
5. 原始 error log 的敏感 URL 风险如何被接受和限制；
6. 30 天清理机制的实际证明；
7. 历史数据库和备份的剩余风险；
8. 四个 Subagent 分别发现、修复了什么；
9. 修改后的性能和运行成本；
10. 四个 PR 是否可以按照既定顺序人工合并。

## 最终成功条件

只有同时满足以下条件才能宣布：

`FINAL_REMEDIATION_MERGE_READY`

- 真实 SaveAnswer 调用方能够使用响应头 requestId；
- HTTP 200 业务拒绝可以精确关联服务器日志；
- 成功、拒绝、协调、网络失败和并发路径未发生语义回归；
- nginx 保留必要的原生故障诊断；
- access log 仍保持安全字段投影；
- 历史路由读取安全、30 天清理机制已验证；
- 剩余部署和备份风险明确标记；
- 组合 CI 与性能门禁通过；
- 四个独立 Subagent 完成审查，关键 findings 已修复并复审；
- 所有证据可追溯至最终 exact SHA。

不满足这些条件时必须给出准确的 BLOCKED/PARTIAL 判定，不能虚报 PASS。

**最高目标不是增加观测功能，而是让一次真实的考生保存异常，能够以最小复杂度、安全且可信地定位到对应 HTTP 请求，并且在故障发生时保留足够的底层诊断能力。**
