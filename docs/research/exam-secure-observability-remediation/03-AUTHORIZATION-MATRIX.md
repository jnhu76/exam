# 授权矩阵（AUTHORIZATION-MATRIX）

- 轮次：secure-correlation-audit（终稿交付物 4/10）
- 汇总来源：`adversarial/authz-tenant.md`（族 1/2/5/6/7，M1–M20）与 `adversarial/authz-proctor-admin.md`（族 3/4/8/9），全部为 **LIVE_VERIFIED** 真实实验（2026-11-07T16:41Z–2026-11-08，共享审计环境 localhost:3000 + `exam_ci_audit` 测试库，身份核验先行）。
- 主体全部为 `EXAMAUDIT-CANARY-*` 合成身份；psql 仅只读 SELECT；git 跟踪文件零改动。
- 角色/权限权威：`packages/authz/src/catalog.ts:23-173`（Permission）与 `:213-221`（7 内置角色）；运行时 = assignment-backed capability union（docs/architecture/authorization.md:52-63）。

## 0. 主体与资源

| Subject | Org | 角色 | 关键事实（证据） |
| --- | --- | --- | --- |
| admin（adminA） | A | Admin（compat 超集，presets.ts:52-147） | seed 管理员 |
| proctorA1 | A | Proctor（presets.ts:183-199） | **有** active 分配 76d7e9a4→exam 6b8d0782 |
| proctorA2 | A | Proctor | **无**任何分配（负例主体） |
| candA1 | A | Candidate（presets.ts:241-250） | 拥有 attempt f665c325 |
| candA2 | A | Candidate | canary attempt d9bc2a50（受控建立） |
| adminB | B | Admin（minted JWT） | 异组织跨 org 负例 |
| candB1 | B | Candidate | 异组织负例 |
| anon | — | 未认证 | 401 面 |

资源（org A）：exam `6b8d0782…`；attempt `f665c325…`（candA1）/`d9bc2a50…`（candA2）；incident `7d6b6bf6…`。

## 1. 主矩阵：Subject × Org × Endpoint × 期望/实际（全 LIVE_VERIFIED）

### 1.1 跨组织（族 1；run-01-cross-org.txt；重放 review/replay-f1-cross-org.txt 一致）

| # | 主体（org/role） | 目标资源（owner org） | 端点（源码检查点） | 期望 | 实测 |
|---|---|---|---|---|---|
| M1 | adminB（B/Admin） | attempt A1（A） | GET /admin/attempts/:id/timeline（attempts.admin.ts:339-351） | 404 | 404 |
| M2 | adminB | attempt A1 | GET .../answer-save-receipt-summary（attempts.admin.ts:415-425） | 404 | 404 |
| M3 | adminB | attempt A1 | GET .../proctor-events（proctorMonitoring.ts:148-160） | 404 | 404 |
| M4 | adminB | attempt A1 | GET .../export（attempts.admin.ts:472-478） | 404 | 404 |
| M5 | adminB | attempt A1 | GET .../result（scores.ts:439-470） | 404 | 404 |
| M6 | adminB | exam A | GET /admin/exams/:id/proctor/attempts（proctorMonitoring.ts:100-112） | 404 | 404 |
| M7 | adminB | exam A | GET /admin/exams/:id/incidents | 404 | 404 |
| M8 | adminB | audit 行（A） | GET /admin/audit-logs（audit.ts:146-152 org 谓词） | 200 但 items:[] | 200 items:[]（targetId 过滤亦空） |
| M9–M11 | candB1（B/Candidate） | attempt A1 | GET /attempts/:id、/candidate/attempts/:id/take、/scores/attempts/:id | 404 | 3×404 |

### 1.2 同组织考生互读/互写与分配门（族 2/3；run-02、run-02b、raw/f3）

| # | 主体 | 目标 | 端点 | 期望 | 实测 |
|---|---|---|---|---|---|
| M12/M14 | candA1↔candA2 | 他人 attempt | GET /attempts/:id、/take、/scores/attempts/:id | 404 反枚举 | 双向 3×404 |
| M13 | candA1/candA2 | 他人 attempt | POST answers/heartbeat/submit | 404 | 404（schema 合法体；首试 400 为 path/body 一致性校验前置，无 smuggling 通道）；DB 终态零污染 |
| M15 | candA1/candA2 | 任意 | GET /admin/attempts/:id/{timeline,proctor-events,receipt-summary} | 403（capability 先于 resolver） | 3×403 |
| M16 | proctorA2（未分配） | attempt A1 | timeline / proctor-events / receipt-summary / exam attempts | 404（分配门折叠） | 4×404 |
| M17 | proctorA1（已分配） | 其他考试 attempt | timeline / proctor-events | 404（分配按考试粒度，plugins/authz.ts:79-92 每请求查询） | 2×404 |
| 族3 扩展 | proctorA2 | 7 scoped 端点 + 2 LIST | 见 authz-proctor-admin §1 | 404/空集 | 7×404 + LIST total:0/items:[]（与不存在不可区分）；proctorA1 同端点 200 且内容限本考试 |

### 1.3 高权限面 Permission 裁决（族 4；raw/f4-permission-gate.txt，72 探针）

| Endpoint（capability） | proctorA1 | proctorA2 | candA1 | adminB（Admin 角色、org B） | anon | admin |
| --- | --- | --- | --- | --- | --- | --- |
| /system/health（SystemHealthView） | 403 | 403 | 403 | 200 | 401 | 200 |
| /system/diagnostics（SystemDiagnosticsView） | 403 | 403 | 403 | 200（integrity 块全 0，无 org A 数据） | 401 | 200 |
| /system/dashboard（SystemBusinessSummaryView, Admin-only） | 403 | 403 | 403 | 200（全 org B 化，零 org A 泄露） | 401 | 200 |
| /admin/audit-logs（AuditLogView, Admin-only） | 403 | 403 | 403 | 200（**仅 org B 行**） | 401 | 200（org A 行） |
| /admin/audit-logs/export | 403 | 403 | 403 | 200（CSV 仅 org B 1 行） | 401 | 200（org A 29 行） |
| /admin/attempts/:A/export（AttemptExport, Admin-only） | **403**（虽有分配） | 403 | 403 | **404**（org 不匹配） | 401 | 200 |
| /admin/attempts/:A/export/csv | 403 | 403 | 403 | 404 | 401 | 200 |
| /admin/recovery/incidents（IncidentRecoveryView, Admin-only） | 403 | 403 | 403 | 200（org B 空） | 401 | 200 |
| /admin/recovery/attempts/:A、/exams/:E | 403 | 403 | 403 | 404 | 401 | 200 |
| /exams/:E/export/scores（ScoreExport, Admin-only） | 403 | 403 | 403 | 404 | 401 | 409（非终结 attempt，业务规则，权限已过） |

结论：所有高权限端点按**实际 capability** 裁决而非登录角色；adminB 可过全局运维 capability 面，但触及 org A 资源被 resolver org 边界折叠 404，其 200 响应内容全部 org B 化（grep EXAMAUDIT/6b8d0782 0 命中）。

### 1.4 client_events 冒用与请求头冒充（族 6/7；run-06-07 + review/replay-f6-trustboundary.txt）

| # | 主体 | 声称 | 终态（DB 实读） | 判定 |
|---|---|---|---|---|
| M19a | candA2 | A1 的 attempt+exam+q+eventId+clientSessionId | attempt **NULL**；exam 保留（本人 enrollment）；q 保留（冻结快照内） | exam-anchored 路径 ✓ |
| M19b | candB1（org B） | Org A attempt+exam+q | 全 **NULL** | 跨 org 无证明 ✓ |
| M19c | proctorA1（已分配 staff） | A1 attempt | 全 **NULL** | **staff 无特权例外**（normalizer :21-24）✓ |
| M19d | adminA | A1 attempt | 全 **NULL** | 同上 ✓ |
| M19e | candA1 | own attempt + 伪造 examId | exam 被替换为 canonical exam | 服务端派生关系胜出 ✓ |
| M19f | candA1 | own attempt + 快照外 questionId | q NULL，attempt/exam 保留 | 冻结快照约束 ✓ |
| M19g | candA2 | 冒用 candA1 的 eventId | 落为冒用者自己的新行 | (org,user,eventId) 去重隔离 ✓ |
| M19h | 混合批 | 1 可证明 + 1 冒用 | accepted:2；冒用行全 NULL | **无存在 oracle** ✓ |
| M20 | candA1/A2/B1/proctor | header x-request-id/request-id 冒用（含他人真实 requestId） | 响应 requestId 恒服务端新 UUID；授权结论不变；log 零残留（grep=0） | requestId 与授权零耦合 ✓ |

受害者时间线核验：A1 attempt 关联行仅 candA1 本人——零跨主体注入（run-06-07 L95-101 + 裁决官 R5 重放 36 行复核）。

### 1.5 枚举与三路径一致性（族 5/8）

- 族 5（run-05）：12 格（6 端点面 × 存在/不存在）× 5 采样，全部 HTTP 404 / `RESOURCE_NOT_FOUND` / 118 字节（仅 requestId 随机变），耗时重叠 6.1–8.3ms——**无枚举通道**。
- 族 8（raw/f8-consistency.txt）：同数据三路径（audit 读 vs CSV 导出；timeline/proctor-events vs export json/csv；incident scoped 读 vs recovery 聚合 vs proctor 列表）对每个主体 allow/deny 一致，无任一路径弱于兄弟路径；唯一路径差异是声明的能力需求不同（AttemptTimelineView vs AttemptExport），由 routeRegistry 声明且实测相符。

## 2. 唯一 REFUTED 主张（可用性，非越权）

**已授权 proctor-events 时间线 500**（authz-tenant §6 + authz-proctor-admin §4 + 裁决官 R6）：proctorA1/admin 对含 client_events 行的 attempt GET proctor-events → 500 `ResponseSerializationError`（cause ZodError: `occurredAt: Expected string, received date`）。根因 = **审计环境 stale dist**（`@exam/db` dist 2026-11-06 23:46 构建，早于 src 的 #874 to_char 修复 11-07 17:58；tsx dev 经 workspace-module-resolution 解析 default→dist）——当前源码行为通过完整响应 schema（run-07c 3/3 PASS）；裁决官复查时 dist 已重建，端点恢复 200/36 items（R2）。定性：fail-closed 可用性中断，无数据泄露、无越权，medium。产品遗留加固观察：fallback 分支不纠正 occurredAt 类型（proctorMonitoringService.ts:80-97），未来回归仍会整端点 500；U6 建议增加 dist<src mtime 守卫。

## 3. 三类权限域与 INFRA_ACCESS_NOT_VERIFIED

| 域 | 结论 | 标注 |
| --- | --- | --- |
| A. 应用 HTTP 用户权限 | §1 全矩阵 LIVE_VERIFIED；防御不变量全部 CONFIRMED | LIVE_VERIFIED |
| B. 数据库连接账号边界 | 单一 `exam` 账号（current_user=exam），无角色分离；本审计 psql 即以同一账号跨 org 全表可读——**org 隔离完全由应用层 repository 谓词承担**（与源码盘点一致） | SOURCE_VERIFIED + 实测 |
| C. 部署环境 stdout/日志文件读取权限 | pino→stdout（server.ts:113-119，无文件 destination）、compose 无 logging 段；本会话 server.log 是 harness 重定向产物，不代表生产宿主权限 | **INFRA_ACCESS_NOT_VERIFIED** |

## 4. 复现命令（证据持久位置：adversarial/ 与 review/）

```bash
# 环境（RUNBOOK.md；DB 身份先核验）
docker exec exam-dev-db-1 psql -U exam -d exam_ci_audit -tAc "select current_database(), current_user"
# 族1 跨组织 + 正例对照
bash .tmp/secure-correlation-audit/adversarial/f1-cross-org.sh        # → run-01-cross-org.txt
# 族2 考生互读/互写 + DB 终态
bash .tmp/secure-correlation-audit/adversarial/f2-cross-candidate.sh  # → run-02-cross-candidate.txt
# 族5 枚举（12格×5采样）
bash .tmp/secure-correlation-audit/adversarial/f5-enumeration.sh      # → run-05-enumeration.txt
# 族6/7 client_events 冒用 + header 冒充
bash .tmp/secure-correlation-audit/adversarial/f6-client-events.sh    # → run-06-07-clientevents-requestid.txt
# 族3/4/8/9 全套（113 探针）
bash .tmp/secure-correlation-audit/adversarial/run-probes.sh          # → raw/f3-*, f4-*, f8-*, f9-*
# 裁决官独立重放（与原始脚本仅输出路径不同，diff 已验证）
bash .tmp/secure-correlation-audit/adversarial/f1-cross-org.sh        # → review/replay-f1-cross-org.txt
```
