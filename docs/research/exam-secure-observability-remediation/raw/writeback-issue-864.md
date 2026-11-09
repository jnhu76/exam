# Issue #864 回写草稿 — client_event route 存储 scope（audit 结果）

> 状态：草稿，**不自动回写**。由发起方/Owner 决定是否摘录发布。
> 证据基线：master @ `423f2945d9feef73a5413e498fb2772cc245c754`（2026-11-08 审计）。

## 结论

安全关联审计完成了本 Issue DEFER gate (1)「真实链路 canary 负例」，结果为**负例成立（泄露证实）**，建议从 `DEFER_IMPLEMENTATION_PENDING_LIVE_NEGATIVES_AND_OWNER_POLICY` 推进为**施工授权，方案锁定 B（服务端封闭模板投影）**。三裁决官一致（3:0 GO）。

## 现有保护（as-built，均经源码+实验证实）

- `normalizeRouteForStorage`（`apps/api/src/routes/clientEvents.ts:31-44`）：哑基址 URL 解析只留 pathname（query/fragment 剥离）→ 500 截断 → 空串 null；不可解析 fallback 在首个 `?`/`#` 截断——设计内目标全部生效：RT-4/5（query/fragment token）、RT-12（http 形 userinfo）、RT-13/13B（malformed query）、RT-14（CRLF/NUL 规范化）均被剥离。
- handler 认证 + metadata 服务端再消毒（sanitizeClientEvent）+ 读取端 `SAFE_METADATA_ALLOWLIST` default-deny（未知事件名 → `{}`，实测 36 items 中 35×`{}`）。
- 读取边界：proctor-events 需要 AttemptTimelineView + active 监考分配 + org 谓词（未分配 404 反枚举，实测）。

## 攻击矩阵（金丝雀全部 `EXAMAUDIT-CANARY-*`，单元级=生产代码文本逐字提取执行，HTTP 级=真实 server+PG，双通道 LIVE_VERIFIED）

| 通路 | 投放 | at-rest 终态 | 读取面再暴露 |
|---|---|---|---|
| RT-3 token 在 path | `/password-reset/<canary>` | **原样入库** | **是**（已授权 proctor-events 原样返回） |
| RT-8 编码走私 query | `/a%2Fb%3Ftoken%3D<canary>` | **编码形态，单次解码即得完整 query** | **是** |
| RT-12B opaque-scheme userinfo | `user:<canary>@example.com/path` | **凭据成为 pathname 原样入库**（URL 解析器 quirk） | **是** |
| RT-12C data: URL | `data:text/html,<canary>` | **opaque path 整体保留** | **是** |
| RT-14B malformed+原始 CRLF | `http://[\r\n<canary>?x=y` | **原始 CR/LF 字节入库**（fallback 不清洗控制字符） | 是（JSON 转义，无日志注入） |
| RT-18B User-Agent 头 | UA `<canary>` | 31/31 行 user_agent 列原样（无形状检测） | 否（当前无读取端点返回） |

裁决官独立重放再证实：at-rest 31 行（review/replay-db-routestorage.txt）+ 读取面 12 canary（review/replay-timeline-proctorA1.json）。零泄露面：server.log、audit_logs、CSV 导出（0 canary）。

**口径说明（at-rest 31 行 vs 读取面 12 canary 的差值）**：31 = 主批投放的事件总数（全部可在 client_events 表检索到，db-route-dump.txt 等）；timeline 出现金丝雀的 12 行 = **11 个 route 存储值仍含金丝雀的行**（RT-1/2/2B/3/8/9/11/12B/12C/14B/15）+ **1 个 name 通道行**（RT-18C）。其余 19 个事件的金丝雀不可见于 timeline 的原因：RT-4/5/12/13/13B/14 的金丝雀位于 query/fragment/userinfo（被设计内剥离，route 存储值已不含金丝雀）；RT-15B 截断丢失；RT-16/17 在 metadata 通道（读取端 allowlist 默认拒绝，投影为 `{}`）；RT-18B 在 user_agent 列（timeline 不返回该列）。**不可见于 timeline ≠ 未落库**——RT-18B 等 at-rest 敏感留存正是读取面之外的第二类风险。

**核心判定**：#875 的「query-free at rest」在字节层面成立，但敏感值本身完整保留——一个把 `encodeURIComponent(location.href)` 当 route 发送的 buggy sender（正是该函数注释声称要兜住的场景）会把整条 query 含 token 送入库。route 通道没有 metadata 通道已有的 containsUserinfoUrl 等价防线。

## 方案裁决（三官多数）

| 方案 | 裁决 | 一句话理由 |
|---|---|---|
| A 维持现状 | **NO_GO（3:0）** | gate 已满足，维持=保留已证实泄露通路 |
| **B 模板投影（动态标识符参数化、未知置空）** | **GO（3:0）** | 唯一「客户端字节零保留 + 保留哪场考试哪一页信号」；wire/存储/读取面零契约变更；实测零可测开销 |
| C 有限 category/name | DEFER（2:1） | 并不比 B 小（须先有 B 的模板知识再丢信息）；gate(2) 效用损失量化未完成；作 B 回退 |
| D 完全停存 | NO_GO（2:1） | 过度删除正常诊断信号 + 全部发送方契约翻搅 |

**B 的落地约束（必须写入 acceptance）**：模板表单一权威（共享常量 `@exam/contracts` 优先，否则 API 侧表 + 对 `apps/web/src/App.tsx` 52 模板的漂移守卫测试）；段级线性匹配、禁回溯正则；**禁用 `request.routeOptions.url`**（API 路由模板≠浏览器 SPA 导航路径）；禁通用 Sanitizer Framework、禁新 schema/迁移/持久字段（存储仍 `string|null`）；**参数化不可降级为 root-allowlist**（性能实验门变体 LEAK_COUNT=2：已知根下尾段字节仍落库）；以本审计 31 用例 canary 矩阵 + 补充「敌意真根+秘密尾段」组合作回归验收。

**存量已落库行的处置（施工时须一并决策）**：修复只影响新摄入；已按 RT-3/8/12B 形态落库的 client_events 行保留期 30 天（apps/api/src/plugins/clientEventRetention.ts:33）。遵循 #875 关闭决策的既有先例（source/adrs-issues.md §2.13 摘录：存量行靠 30 天 retention 自然淘汰、历史行不可改写）——**不做迁移/清洗、不新增产品级清洗路径**；若 Owner 判定存量风险不可接受，可用一次性运维脚本清除带敏感形态的 route 行（无产品工具，需单独授权并满足 docs/standards/testing.md §2 DB 安全前置）。

## 关键证据摘录

- `/admin/attempts/:id/proctor-events` 已授权读取响应中 route 字段原样携带 `/password-reset/EXAMAUDIT-CANARY-RT-3`（timeline-proctorA1.json；`apps/api/src/lib/proctorMonitoringService.ts:76,95` 逐字透传）。
- psql at-rest：`SELECT … FROM client_events WHERE event_id LIKE 'rtcanary-%'` → 31 行，RT-3 37B 原样、RT-8 38B 走私结构、RT-12B/12C/14B 如上（db-route-dump.txt）。
- 性能：门变体（root allowlist + 置空）在 events 10 事件批目标路径及全部场景吞吐/p95/p99/CPU/xact 零可测开销（performance/RESULTS.md，4 变体×4 场景×3 并发=48 格、每格 3 次重复共 144 条测量行，raw/bench.csv）；完整参数化为同量级纯字符串工作（性能裁决官估计 <10µs/事件 vs events 路径实测 2.3–2.9ms CPU/req——该估计为 **INFERRED 未直接测量**、受 ±3% 噪声带封顶，出处 review/performance.md §3；2.3–2.9ms 见 performance/RESULTS.md 分场景要点）。

## 复现命令

```bash
node .tmp/secure-correlation-audit/canary/unit-normalize.mjs          # 单元级（生产代码文本）
node .tmp/secure-correlation-audit/adversarial/post-canaries.mjs      # HTTP 级（真实 server+PG）
docker exec exam-dev-db-1 psql -U exam -d exam_ci_audit -c \
 "SELECT event_id,left(route,80) FROM client_events WHERE event_id LIKE 'rtcanary-%' ORDER BY event_id"
```

## 证据持久位置说明

全部原始命令与输出保存于仓库工作区 `.tmp/secure-correlation-audit/`（gitignored，不入版本控制，**无归档时限承诺——工作区清理后将不可复核**）：矩阵 `adversarial/canary-matrix.md`，原始请求/响应 `adversarial/post-canaries.*`，DB dump `adversarial/db-route-dump.txt` 等，读取面 `adversarial/timeline-proctorA1.json`，独立重放 `review/replay-*`，性能 `performance/`。**是否摘录关键部分入本 Issue 由人工决定**；建议最小摘录集 = 本草稿「攻击矩阵」表 + 「口径说明」段 + 「B 的落地约束」段（三者自包含、可脱离 .tmp 复核结论）；如需长期保留 canary dump 原始数据，请在决定回写时由发起方复制为 Issue 附件。
