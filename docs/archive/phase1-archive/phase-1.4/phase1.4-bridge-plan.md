# Phase 1.4 Bridge Plan — Release Hardening / 基础收口层

**日期**: 2026-06-10
**分支**: `phase1.4-bridge-plan`
**前置**: Phase1–1.3 基础考试闭环已完成，Phase1.3 安全计划未执行
**定位**: Phase1 收口层，不是 Phase2 提前开工
**核心原则**: 只修基础，不堆功能；只做样板，不全站重写
**重要状态（2026-06-11）**: Phase1.4 当前状态为 partial closeout。S01/S02/S03a 和 U01-U04 仍归属 Phase1.4。S03b-S09 已迁移到 Phase1.7。数据库收敛工作（原 A00-A04）已迁移到 Phase1.5/1.6。

---

# Phase 1.4 Bridge Summary

## Why Phase1.4 Exists

Phase1–1.3 产出了一个"能跑的 MVP"：本地 SQLite 开发环境下可以完成注册→创建考试→发布→答题→交卷→查看成绩的完整闭环。

但这个 MVP 有四类结构性债务，如果不解决就直接进入 Phase2，会把 Phase1 的问题放大到监考、导出、集成等更复杂的场景中：

1. **生产部署不可用** — Docker + PostgreSQL 链路从类型系统到运行时会 crash
2. **安全边界不生效** — 多租户隔离、RBAC、认证会话都是空壳或未实现
3. **考试协议不闭环** — 服务端不拒绝超时提交，答案保存无事务保护
4. **UI 缺少产品基准** — 页面能用但没有统一设计系统，无法支撑 Phase2 监考端

Phase1.4 不做 Phase2 的任何功能。它只做三件事：让地基真实可用、让边界真实生效、让 UI 有样板基准。

## What Phase1–1.3 Already Gave Us

| 领域 | 已完成 | 代码依据 |
|------|--------|---------|
| 考试闭环 | 注册→创建→发布→答题→交卷→评分→查分 | `attempts.test.ts` 1033 行集成测试 |
| 答案保存协议 | 版本化 + clientSeq 幂等 + baseVersion 冲突检测 | `answerProtocol.ts` 91 行，`answerProtocol.test.ts` |
| 服务端时间权威 | deadlineAt 在服务端计算 | `timer.ts`, `attemptCommands.ts:100` |
| 题目快照冻结 | questionSnapshot 在 attempt 创建时拷贝 | `attemptCommands.ts`, `examCommands.ts` |
| 状态机 | exam 和 attempt 状态通过 command 函数转换 | `examCommands.ts` 145 行, `attemptCommands.ts` 192 行 |
| 自动评分 | 单选/多选/判断/填空 + 多选部分得分 + 填空关键词匹配 | `gradingEngine.ts` 155 行 |
| 审计日志基础 | CRUD 操作 + 考试操作已有审计 | `routes/audit.ts`, 12 种 action |
| UI 完整页面 | Admin 16 页 + Candidate 5 页，全部功能可用 | `pages/admin/`, `pages/exam/` |
| 多组织数据模型 | 11 张表全部含 organizationId | `schema/sqlite.ts`, `schema/pg.ts` |
| 品牌定制 | productName / subtitle / footer 远程加载 | `BrandProvider.tsx`, `settingsRepo.ts` |
| 密码哈希 | argon2id | `packages/auth/src/password.ts` |

## What Phase1–1.3 Did Not Close

### 架构债

| 债务 | 影响 | 阻塞 Phase2？ | 依据 |
|------|------|-------------|------|
| 所有 repo 强类型 `SqliteDatabase` | PG 生产环境 runtime crash | **是** | `plugins/db.ts:17` `as unknown as SqliteDatabase` |
| `baseRepo.ts` 引用 SQLite 专用类型 | 无法复用于 PG | **是** | `baseRepo.ts:5-6` `AnySQLiteColumn` |
| 7 处 `as unknown as` + 3 处 `as any` | 类型安全被绕过 | **是** | `seed.ts`, `systemStatsRepo.ts`, `attemptRepo.ts` |
| Dockerfile COPY 路径错误 | migration 在容器中找不到 | **是** | Dockerfile:46 引用不存在的 `packages/db/src/migrations` |
| JWT_SECRET 默认值 `change-me-in-production` | 生产环境 secret 可预测 | **是** | `docker-compose.yml:8` |
| CI 无 PG 测试 | PG 回归无门禁 | **是** | `.github/workflows/ci.yml` 仅 SQLite |
| Schema 双文件手动同步 | 维护负担，已有 drift | 中 | `sqlite.ts` 328 行 vs `pg.ts` 291 行 |
| `userRepo` 不接受 ctx | 违反 repo pattern | **是** | `userRepo.ts:13,28` |
| `attemptRepo` 用 `as any` | join 查询无类型安全 | 中 | `attemptRepo.ts:146,198,249` |

### 安全债

| 债务 | 影响 | 阻塞 Phase2？ | 依据 |
|------|------|-------------|------|
| tenant plugin 空函数 | 多租户隔离不生效 | **是** | `plugins/tenant.ts:6-10` `// TODO` |
| `rbac.ts` 文件不存在 | 权限系统不存在 | **是** | `packages/auth/src/rbac.ts` 404 |
| `tenantGuard.ts` 文件不存在 | 无租户守卫 | **是** | `packages/auth/src/tenantGuard.ts` 404 |
| `ctx.permissions` 永远 `[]` | 22 个权限全部失效 | **是** | `plugins/auth.ts:35` |
| Proctor 角色零路由 | 监考功能无法开始 | **是** | 无任何 route 检查 Proctor |
| `submitAttempt()` 不拒绝超时 | 违反 SPEC 3.4 | **是** | 测试明确验证 "accepts late submission" |
| 答案保存无事务 | PG 并发写入丢数据 | **是** | `attempts.ts` answers read-modify-write |
| JWT secret 硬编码 fallback | 非生产环境 secret 可预测 | **是** | `session.ts:12` |
| Logout 不注销 JWT | token 在有效期内仍可用 | 中 | `auth.ts:128-131` 仅清 cookie |
| CSV 公式注入漏洞 | 数据安全 | **是** | `csv.ts` 不处理 `=` `+` `-` `@` 开头 |
| 无 CSP / HSTS header | 浏览器级防护缺失 | 中 | `security.ts` |
| 登录/登出/失败无审计 | 安全事件不可追溯 | 中 | `auth.ts` 无 recordAudit |
| 密码最小长度 6 | 弱口令风险 | 中 | `contracts/src/auth.ts:10` |
| 无账户锁定 | 暴力破解 | 中 | `auth.ts` 无 lockout 逻辑 |
| `system/health` 任何角色可访问 | 信息泄露 | 低 | `system.ts:43-76` 无 role check |

### 考试协议债

| 债务 | 影响 | 阻塞 Phase2？ | 依据 |
|------|------|-------------|------|
| 服务端不拒绝超时提交 | 考试时间可被绕过 | **是** | `attemptCommands.ts` submit 不检查 deadlineAt |
| 答案保存无事务保护 | PG 并发丢数据 | **是** | `attempts.ts:559-662` |
| 多标签页无会话锁 | 答案乱序覆盖 | 中 | 无 session 绑定 |
| 前端 submit 不 flush pending | 可能丢最后一笔答案 | **是** | `TakeExamPage.tsx` submit 不等待 pending saves |
| submit 不显示未保存/失败题数 | 考生可能误交 | 中 | `TakeExamPage.tsx` 仅通用 confirm |

### UI 债

| 债务 | 影响 | 阻塞 Phase2？ | 依据 |
|------|------|-------------|------|
| 状态标签在 4+ 页面重复定义 | 维护负担 | 低 | `ExamPage`, `ExamDetailPage`, `DashboardPage` |
| 颜色不走 semantic token | 视觉不一致 | 低 | `QuestionNav.tsx` 用 `bg-green-500` |
| BrandProvider fallback 硬编码中文 | 违反产品通用化 | 低 | `BrandProvider.tsx:13` `"内网考试平台"` |
| 无 Error Boundary | render crash 白屏 | 中 | `App.tsx` 无 ErrorBoundary |
| `/exam/settings` 路由不可达 | 导航断裂 | 低 | ExamLayout 有链接但 App.tsx 无路由 |
| AttemptDetailPage 分数 bug | UI 显示错误 | 低 | `AttemptDetailPage.tsx:114` 显示 totalScore |
| ScoreListPage export URL 缺 `/api` | 导出功能不可用 | 中 | `ScoreListPage.tsx:129` |

## What Phase2 Wants To Build

Phase2 计划 4 个 Track，25 个 Job：

- **2A Exam Operation**: ExamRoom 管理、IP 限制、心跳增强、disrupted 恢复、proctor 操作、审计扩展
- **2B Proctor Panel**: WebSocket 基础设施、监考 Dashboard、候选状态卡、事件流、实时操作、polling fallback
- **2C Exam Flexibility**: 随机组卷、timed_sync/deadline/untimed 模式、retake 策略、score 策略
- **2D Integration & Export**: Pass Gate API、Service Token、PDF 导出、attempt detail 导出、审计导出、CAS/OAuth

这些功能全部依赖 Phase1.4 完成后的地基。如果地基不实，Phase2 的每一步都会出问题。

## What Must Be Hardened Before Phase2

Phase2 启动前必须完成：

1. **Phase1.4 UI Jobs U01-U04 complete** — 建立产品基准
2. **Phase1.5 PostgreSQL-only convergence complete** — PG 作为唯一数据库运行时
3. **Phase1.6 PostgreSQL correctness hardening complete** — 事务和并发验证
4. **Phase1.7 security baseline complete** — S03b + S04-lite + S05-lite + S06-lite + S07-lite + S08-lite + S09-lite
5. **S01 多租户隔离真实生效** — Phase2 的 proctor、导出、集成全部涉及组织边界
6. **S02 RBAC 必须真实生效** — Phase2 新增 Proctor 角色，必须在现有 RBAC 框架上扩展
7. **S03a 考试协议服务端闭环** — deadline 强制执行、事务保护
8. **CI 必须覆盖 PG** — Phase2 的每个 PR 都必须验证 PG 不回归

Phase1.4 不再负责完成所有安全 Job。S03b-S09 已迁移到 Phase1.7。

---

# Phase Boundary

## Phase1.4 Allows

- 修复 PostgreSQL / Docker / migration / repository 的不一致
- 实现多租户 tenant guard 和 RBAC 权限矩阵
- 修复考试协议服务端缺口（deadline 强制执行、答案事务、submit flush）
- 补齐安全基础（JWT、CSV、headers、审计、密码策略、Origin 校验）
- 建立 UI Design System 基准 + 3 个样板页
- 创建自动化安全测试套件
- 编写 Redis / MQ ADR 文档（不写代码）
- 修改 schema 增加 `sessionVersion`、`mustChangePassword`、`loginFailCount`、`lockedUntil` 等安全字段

### Public vs Protected Endpoints

| Endpoint | Auth | Tenant Guard | Purpose |
|----------|------|-------------|---------|
| `GET /api/health` | None | None | Public liveness probe for Docker / load balancer. Must not expose sensitive system details. |
| `GET /api/settings/branding` | None | None | Public branding for login page. Resolved by slug. |
| `GET /api/system/health` | Required | Yes | Authenticated system dashboard. Requires RBAC permission. Candidate/Proctor must receive 403. |
| `GET /api/system/dashboard` | Required | Yes | Same as system/health. |

## Phase1.4 Forbids

- Proctor Panel / 监考面板
- Redis / WebSocket 实现（ADR 文档可以写，代码不行）
- 强制交卷（proctor force submit）
- 延长时间（proctor extend time）
- 标记违规（proctor mark misconduct）
- 自动提交超时试卷（auto-submit on deadline）
- 随机组卷（random paper builder）
- PDF / Excel async worker
- 外部系统集成 / Pass Gate API / Service Token
- UI 全站重写
- 引入大型 UI 框架、图表库、动画库
- 把答案保存主链路放进 MQ / 异步队列
- 实现监考相关业务路由（Proctor 角色权限定义保留，但路由不新增）
- 实现新的 timing mode（timed_sync / deadline / untimed）
- 实现 `voidAttempt()` 命令
- 实现 `showResultImmediately` 服务端检查
- 实现 dark mode
- 拆 `attempt_answers` 表

## Deferred To Phase1.5

| 功能 | Phase1.5 Job | 说明 |
|------|-------------|------|
| PostgreSQL-only database convergence | P1.5-J1-J7 | 统一 dev / test / CI / production 为 PostgreSQL，移除 SQLite 作为 correctness backend |
| PG Test Harness | P1.5-J2 | 建立 PG 测试基础设施 |
| Migration Convergence | P1.5-J3 | migration 收敛到 PG-only |
| Seed Convergence | P1.5-J4 | 稳定 PG seed |
| Repository Dialect Removal | P1.5-J5 | 清理 repo 双方言分支 |
| CI PG Switch | P1.5-J6 | CI 切换到 PG |

## Deferred To Phase1.6

| 功能 | Phase1.6 Job | 说明 |
|------|-------------|------|
| Transaction Correctness | P1.6-J1 | saveAnswers + submitAttempt PG transaction boundary |
| Concurrency Tests | P1.6-J2 | PG 并发 save + submit 测试 |
| S03a PG Verification | P1.6-J3 | 在 PG-only 基础上验证 S03a |
| Migration/Seed Regression | P1.6-J4 | migration reset + seed reset 稳定性 |
| CI Gate | P1.6-J5 | CI 中 PG integration gate 稳定 |

## Deferred To Phase1.7

| 功能 | Phase1.7 Job | 说明 |
|------|-------------|------|
| S03b Client Submit Flush Protocol | P1.7-S03b | 考试协议前端半部分，必须在 Phase2 前完成 |
| S04 Auth Session Security | P1.7-S04-lite | baseline：JWT secret, cookie secure, dummy verify |
| S05 CSV Injection + Security Headers | P1.7-S05-lite | baseline：CSV escape, CSP, HSTS, Origin |
| S06 Audit Log Completion | P1.7-S06-lite | baseline：login/logout/audit-logs API |
| S07 Password Policy + Account Security | P1.7-S07-lite | baseline：min length 8, config policy |
| S08 Red-Team Security Test Suite | P1.7-S08-lite | baseline suite，不要求 full S04/S07 |
| S09 Phase1.3 Security Validation | P1.7-S09-lite | Phase1.7 baseline validation |

## Deferred To Phase2

| 功能 | Phase2 Track | 说明 |
|------|-------------|------|
| ExamRoom 模型 | 2A-J1 | 考场管理 |
| IP 限制 | 2A-J2 | 按考场限制来源 IP |
| 心跳增强 | 2A-J3 | WebSocket 心跳替代 HTTP polling |
| Proctor 操作（强制交卷/延时/违规） | 2A-J5 | 需要先有 ExamRoom |
| WebSocket 基础设施 | 2B-J1 | Redis pub/sub 背板 |
| Proctor Panel UI | 2B-J2-J6 | 实时监考界面 |
| 随机组卷 | 2C-J1-J2 | 随机 paper snapshot |
| timed_sync / deadline / untimed 模式 | 2C-J3-J5 | 新 timing mode |
| retake 策略增强 | 2C-J6 | 冷却期、每日/每周限制 |
| Pass Gate API | 2D-J1 | 外部系统查询成绩 |
| Service Token / API Key | 2D-J2 | 机器对机器认证 |
| PDF 导出 | 2D-J3 | 成绩单 PDF |
| CAS / OAuth | 2D-J6 | 外部身份集成 |
| 自动提交超时试卷 | 2A | 依赖心跳 + ExamRoom |
| `voidAttempt()` 命令 | 2A | 需要审计和权限基础 |
| `showResultImmediately` 服务端执行 | 2A | 需要考试配置完善 |
| 审计日志自动清理 | 2D | 数据保留策略 |
| tree 组织层级 | Phase3 | 多级组织 |

## Deferred To Phase3

- Electron 锁屏客户端
- AI 辅助评分
- 自适应降级
- tree 组织层级
- 富文本 / LaTeX / 化学
- 编程题 / 画图题
- 移动端适配
- 题库共享

---

# Phase1.4 Draft Audit — What Changed From The Previous Draft

## 对上一版草案的修正

| 项目 | 上一版草案 | 校准后 | 原因 |
|------|-----------|--------|------|
| A01 粒度 | 1 个 3 天 Job | 拆成 A00-A04 共 5 个 Job | 单个 Job 太大，风险不可控 |
| Repo ctx 模式 | "所有 repo 第一个参数都是 ctx" | 三类 Repo 分类 | 登录前无用户上下文，强行统一不现实 |
| SuperAdmin targetOrg | 不带则访问自己组织 | 不带则 400 | 防止操作误落到默认组织 |
| Proctor 角色 | "增加监考相关路由" | 只定义权限枚举，不新增业务路由 | 监考属 Phase2 |
| S03 粒度 | 1 个 Job | 拆成 S03a（服务端）+ S03b（前端 flush） | 协议问题不能伪装成 UI 美化 |
| Deadline 策略 | "409 或标记为超时" | 固定为 409 ATTEMPT_DEADLINE_EXCEEDED | 模糊策略会导致实现不一致 |
| Logout | "清 cookie + 短过期" | sessionVersion 方案 | 清 cookie 不能让 JWT 失效 |
| CSRF | 口径不一致 | sameSite + Origin/Referer 校验 | sameSite 不能单独当作完整 CSRF 防护 |
| Timing-safe 测试 | "响应时间差 < 5ms" | mock verifyPassword 确认路径调用 | wall-clock 不能作为 CI 硬验收 |
| U04 Take Exam | 包含 submit flush | submit flush 移到 S03b | 协议问题不在 UI Job 中解决 |

## 上一版草案中可以保留的内容

- S01 多租户隔离的背景问题分析 ✓
- S02 RBAC 的权限矩阵（需删除 Proctor 业务路由行）✓
- S04 认证安全的背景问题分析 ✓
- S05 CSV 注入 + 安全 Header 的目标 ✓
- S06 审计日志补齐 ✓
- S07 红队测试套件 ✓
- S08 密码策略 ✓
- U01 Design System 基准 ✓
- U02 Dashboard 样板页（需删掉"不新增后端筛选 API"以外的内容）✓
- U03 Exam Detail 样板页 ✓
- A04 Redis/MQ ADR ✓

## 上一版草案中必须拆分的 Job

| 原 Job | 拆成 | 原因 |
|--------|------|------|
| A01 (3d) | A00 + A01 + A02 + A03 | 单个 3 天 Job 风险不可控，必须先 spike 再分批迁移 |
| S03 (2d) | S03a + S03b | 服务端协议和前端 flush 是两个独立关注点 |

## 上一版草案中越界进入 Phase2 的内容

| 内容 | 原位置 | 归属 |
|------|--------|------|
| "修复 Proctor 角色：增加监考相关路由" | S02 目标第 5 条 | Phase2 2B |
| "超时提交标记 timedOut: true" | S03 目标第 1 条 | Phase2 自动提交策略 |
| "submit 返回时所有 pending answers 已持久化" | S03 验收标准 | 这是前端 flush 的职责，归 S03b |
| U04 中隐含的 submit flush | U04 | 归 S03b |

---

# Corrected Phase 1.4 Job List

## Architecture Jobs

| Job ID | Name | Risk | Duration | Depends On | Parallel | Notes |
|--------|------|------|----------|------------|----------|-------|
| P1.4-A00 | DB Reality Check Spike | Critical | 0.5d | - | No | 验证方案，不全量迁移 |
| P1.4-A01 | DB Context / Repository Contract | Critical | 1d | A00 | No | 定接口和类型，不改业务 |
| P1.4-A02 | Repository 双方言迁移 | Critical | 2d | A01 | No | 按 repo 分批迁移 |
| P1.4-A03 | Docker + PostgreSQL Smoke Test | High | 1d | A02 | No | Dockerfile + migration + seed + env |
| P1.4-A04 | CI PostgreSQL Gate | Medium | 1d | A02 | Yes | 尽早加入 CI |
| P1.4-A05 | Redis / MQ ADR | Low | 0.5d | - | Yes | 纯文档 |

## Security Jobs (Phase1.4)

| Job ID | Name | Risk | Duration | Depends On | Parallel | Notes |
|--------|------|------|----------|------------|----------|-------|
| P1.4-S01 | Multi-Tenant Isolation (tenant guard) | Critical | 2d | - | No | 实现真实 tenant plugin |
| P1.4-S02 | RBAC Permission Matrix | High | 2d | S01 | No | 激活权限，不含 Proctor 路由 |
| P1.4-S03a | Server-side Exam Protocol | High | 1.5d | - | No | Deadline 强制 409 + 基础事务保护 |

## Security Jobs (Deferred to Phase1.7)

以下安全 Job 已迁移到 Phase1.7，在 `docs/archive/phase-1.7/security-completion-plan.md` 中重新编排为 baseline/lite 版本：

| Job ID | Name | 新归属 | 说明 |
|--------|------|--------|------|
| P1.4-S03b | Client Submit Flush Protocol | **Phase1.7-S03b** | 前端 flush + 确认 UI |
| P1.4-S04 | Auth Session Security | **Phase1.7-S04-lite** | baseline：JWT secret, cookie secure, dummy verify |
| P1.4-S05 | CSV Injection + Security Headers | **Phase1.7-S05-lite** | baseline：CSV escape, CSP, HSTS, Origin |
| P1.4-S06 | Audit Log Completion | **Phase1.7-S06-lite** | baseline：login/logout/audit-logs API |
| P1.4-S07 | Password Policy + Account Security | **Phase1.7-S07-lite** | baseline：min length 8, config policy |
| P1.4-S08 | Red-Team Security Test Suite | **Phase1.7-S08-lite** | baseline suite，不要求 full S04/S07 |
| P1.4-S09 | Phase1.3 Security Validation | **Phase1.7-S09-lite** | Phase1.7 baseline validation |

> 原始 Job Cards 的历史背景保留在本文档下方和 `03-security-jobs.md` 中，仅供追溯。

## UI Jobs

| Job ID | Name | Risk | Duration | Depends On | Parallel | Notes |
|--------|------|------|----------|------------|----------|-------|
| P1.4-U01 | UI Design System Baseline | Medium | 1d | - | Yes | 共享常量 + ErrorBoundary |
| P1.4-U02 | Admin Dashboard Sample | Medium | 1.5d | U01 | Yes | 样板页 + screenshot review |
| P1.4-U03 | Exam Detail Sample | Medium | 1.5d | U01 | Yes | 样板页 + screenshot review |
| P1.4-U04 | Take Exam Sample | Medium | 1.5d | U01 | Yes | 样板页，不含 submit flush |

## Architecture Jobs (Deferred to Phase1.5/1.6)

原 A00-A05 已迁移到 Phase1.5/1.6，详见 `docs/archive/phase-1.5/postgresql-only-convergence.md` 和 `docs/archive/phase-1.6/postgresql-correctness-hardening.md`。

## Validation Jobs

| Job ID | Name | Risk | Duration | Depends On | Parallel | Notes |
|--------|------|------|----------|------------|----------|-------|
| P1.4-V01 | Phase2 Entry Gate Check | High | 0.5d | All | No | 最终门禁（移至 Phase1.7 S09-lite 后执行） |

**Total Phase1.4 Jobs: 8 (S01-S03a + U01-U04 + V01)**
**Phase1.4 critical path: S01(2) → S02(2) = 4 days**
**全阶段 critical path 见 `05-dependency-graph.md`**

---

# Job Cards — Architecture

> **重要更新（2026-06-11）**：A00-A05 已迁移到 Phase1.5/1.6。
> 当前执行以 `docs/archive/phase-1.5/postgresql-only-convergence.md` 和 `docs/archive/phase-1.6/postgresql-correctness-hardening.md` 为准。
> 本文档保留历史背景，仅供追溯。

---

## P1.4-A00: DB Reality Check Spike

> **状态：已迁移到 Phase1.5 (P1.5-J1)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.5/postgresql-only-convergence.md` 为准。

### Purpose

验证 PostgreSQL + SQLite 双方言在 Drizzle ORM 下的统一方案可行性，产出技术结论，**不做全量迁移**。

### Background

所有 repository 强类型为 `SqliteDatabase`。`baseRepo.ts` 引用 `AnySQLiteColumn` 和 `SQLiteUpdateSetSource`。`systemStatsRepo.ts` 是唯一同时支持两种方言的 repo，但它用的是运行时 `isSqlite()` 分支，维护成本随 repo 数量线性增长。

Drizzle ORM 的 async API 理论上同时支持 SQLite 和 PostgreSQL。但需要验证：
- `better-sqlite3` driver 是否真正支持 Drizzle async API（它是同步库）
- 统一到 async 后，现有 sync 调用点（`.get()`, `.all()`, `.run()`）是否全部需要改写
- 或者是否有更好的方案（如 `drizzle-orm/better-sqlite3` 的 sync wrapper + `drizzle-orm/postgres-js` 的 async，通过统一接口抽象）

### Scope

- 在 `packages/db/src/` 创建一个**实验性**的 `AnyDatabase` 接口定义
- 选 1 个简单 repo（如 `courseRepo`）做概念验证
- 在 SQLite 和 PG 两种环境下运行 `pnpm test`
- 产出技术结论文档

### Explicit Non-goals

- 不做全量迁移
- 不修改业务路由
- 不修改 domain 层
- 不修改 schema 文件

### Allowed Changes

- `packages/db/src/types.ts` — 可能扩展 `AnyDatabase` 定义
- 新建 `packages/db/src/db-context.ts` 或类似文件（实验性）
- 修改 1 个 repo 文件做验证

### Forbidden Changes

- 禁止新增 `as any` / `as unknown as`
- 禁止修改 domain / contracts / routes
- 禁止修改 schema

### Acceptance Criteria

- [ ] 技术方案文档产出（1 页），明确选定方案及理由
- [ ] 验证 repo 在 SQLite 和 PG 下的 `list()`, `getById()`, `create()` 均通过
- [ ] 方案明确回答：是否统一到 async API，还是有其他路径
- [ ] 方案明确回答：现有 sync 调用点的迁移策略

### Required Tests

- 1 个 repo 的 SQLite 测试通过
- 1 个 repo 的 PG 测试通过（可用 docker-compose.test.yml 的 PG container）

### Required Docs / Screenshots

- `docs/archive/phase-1.4/adr-db-dual-dialect.md` — 技术方案 ADR

### Dependencies

无前置依赖。

### Estimated Duration

0.5 天

### Risk

Critical — 方案选错会导致 A01-A02 全部返工

---

## P1.4-A01: DB Context / Repository Contract Design

> **状态：已迁移到 Phase1.5 (P1.5-J5)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.5/postgresql-only-convergence.md` 为准。

### Purpose

基于 A00 的技术结论，定义正式的 DB Context 类型和 Repository 接口契约。

### Background

当前 repo 接受的参数不统一：
- 大多数 repo 接受 `ctx: RequestContext`（含 `organizationId`, `actorId`, `permissions` 等）
- `userRepo.findByOrganizationAndUsername()` 接受裸 `organizationId: string`
- `organizationRepo` 是全局 scope，无 organizationId
- 登录路由在认证前无法构造 `RequestContext`

需要建立三类 Repo 上下文：

| 分类 | 适用 Repo | Context 要求 |
|------|----------|-------------|
| **TenantScopedRepo** | exam, question, candidate, course, enrollment, attempt, audit, candidateField | 必须携带 tenant context (organizationId + actorId + permissions) |
| **PlatformRepo** | organization, systemStats, migration/meta | 必须携带 platform context (actorId + permissions)，无 organizationId |
| **AuthLookupRepo** | login lookup, branding resolve, slug resolve | 接受轻量 lookup context，不要求完整 RequestContext |

### Scope

- 定义 `TenantContext`, `PlatformContext`, `AuthLookupContext` 类型
- 定义 `AnyDatabase` 正式类型（基于 A00 结论）
- 定义 `BaseTenantRepo<Table>` 和 `BasePlatformRepo<Table>` 泛型工厂
- 更新 `baseRepo.ts` 签名

### Explicit Non-goals

- 不做全量 repo 迁移（那是 A02）
- 不修改路由层
- 不修改 domain / contracts

### Allowed Changes

- `packages/db/src/types.ts` — 新增 context 类型
- `packages/db/src/repository/baseRepo.ts` — 重写工厂签名
- `packages/db/src/database.ts` — 可能调整返回类型

### Forbidden Changes

- 禁止修改任何现有 repo 的实现（只改签名/接口）
- 禁止新增 `as any`
- 禁止让 AuthLookupRepo 接受完整 RequestContext（登录前不存在）
- 禁止在 route handler 中裸传 organizationId 字符串

### Acceptance Criteria

- [ ] 三类 Context 类型定义完成且 TypeScript strict mode 通过
- [ ] `baseRepo.ts` 的工厂方法签名使用新 Context 类型
- [ ] 现有调用方（routes）编译通过（可暂时用 adapter 适配旧签名）
- [ ] `pnpm typecheck` 通过

### Required Tests

- `packages/db/src/__tests__/context-types.test.ts` — 验证类型约束

### Required Docs / Screenshots

- 在 ADR 中补充 Repository Contract 设计章节

### Dependencies

A00

### Estimated Duration

1 天

### Risk

Critical

---

## P1.4-A02: Repository 双方言迁移

> **状态：已迁移到 Phase1.5 (P1.5-J5)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.5/postgresql-only-convergence.md` 为准。

### Purpose

将所有 13 个 repo 从 `SqliteDatabase` 迁移到基于 A01 定义的正式类型。

### Background

需要迁移的 repo 文件：

| 文件 | 特殊处理 |
|------|---------|
| `baseRepo.ts` | A01 已改签名，需实现双方言 CRUD |
| `courseRepo.ts` | 简单委托，无特殊查询 |
| `examRepo.ts` | 简单委托 |
| `questionRepo.ts` | 简单委托 |
| `candidateRepo.ts` | 有 `findByUserId` |
| `candidateFieldRepo.ts` | 简单委托 |
| `enrollmentRepo.ts` | 有 `findByExamAndCandidate` |
| `attemptRepo.ts` | **复杂** — join 查询用 `as any`，需消除 |
| `userRepo.ts` | **需修复 ctx 模式**，改为 AuthLookupRepo |
| `organizationRepo.ts` | PlatformRepo，无 organizationId |
| `settingsRepo.ts` | PlatformRepo，手动 CRUD |
| `auditLogRepo.ts` | 简单委托 |
| `systemStatsRepo.ts` | 已有双方言，需适配新类型 |

### Scope

逐个迁移所有 repo。建议顺序：
1. 简单 repo（course, exam, question, candidateField, auditLog）
2. 中等 repo（candidate, enrollment）
3. 复杂 repo（attempt, user, organization, settings）
4. 已适配 repo（systemStats）

### Explicit Non-goals

- 不修改路由层逻辑
- 不修改 domain / contracts
- 不拆 `attempt_answers` 表

### Allowed Changes

- `packages/db/src/repository/*.ts` — 所有 13 个 repo
- `packages/db/src/seed.ts` — 适配新类型
- `packages/db/src/demo-seed.ts` — 适配新类型或标记 dev-only
- `apps/api/src/plugins/db.ts` — 消除 `as unknown as SqliteDatabase`

### Forbidden Changes

- 禁止新增 `as any` / `as unknown as`
- 禁止为了让 PG 过测试而绕过类型系统
- 禁止只跑 SQLite 测试后宣称 PG 可用
- 禁止一次修改超过 3 个 repo 而不跑测试

### Acceptance Criteria

- [ ] `grep -r "as unknown as" packages/db/src/` 返回空
- [ ] `grep -r "as any" packages/db/src/repository/` 返回空
- [ ] `grep -r "SqliteDatabase" packages/db/src/repository/` 仅出现在注释或类型导入中
- [ ] 所有 repo 方法第一个参数是 Context 类型（TenantContext / PlatformContext / AuthLookupContext）
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 在 SQLite 下全部通过

### Required Tests

- 每个 repo 迁移后立即跑 `pnpm test` 确认无回归
- `attemptRepo` 的 join 查询必须有类型安全的测试

### Required Docs / Screenshots

- 迁移记录（哪个 repo 先迁，遇到什么问题）

### Dependencies

A01

### Estimated Duration

2 天

### Risk

Critical

---

## P1.4-A03: Docker + PostgreSQL Smoke Test

> **状态：已迁移到 Phase1.5 (P1.5-J2/J6)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.5/postgresql-only-convergence.md` 为准。

### Purpose

让 `docker-compose up --build` 使用 PostgreSQL 完成完整考试闭环。

### Background

| 问题 | 位置 |
|------|------|
| `pnpm@latest` 不确定 | Dockerfile:3,28 |
| Migration COPY 路径不存在 | Dockerfile:46 引用 `packages/db/src/migrations` |
| Schema 源码 COPY 无用 | Dockerfile:47 |
| drizzle config COPY 无用 | Dockerfile:48 |
| JWT_SECRET 默认 `change-me-in-production` | docker-compose.yml:8 |
| PG 版本不一致 | test 用 18，prod 用 16 |
| Seed 仅支持 SQLite | seed.ts:24-27 拒绝 PG |
| Migration 路径在容器中可能错位 | migrate.ts 相对路径 |

### Scope

- `Dockerfile` — 修复 COPY，固定 pnpm 版本，去掉无用 COPY
- `docker-compose.yml` — JWT_SECRET 无默认值或空值+启动检查
- `docker-compose.test.yml` — PG 版本对齐到 16
- `docker-compose.dev.yml` — 确认 dev SQLite 路径
- `docker-entrypoint.sh` — migration 路径修正
- `.env.example` — 更新说明

### Explicit Non-goals

- 不修改 migration 文件本身
- 不引入 docker-in-docker
- 不做 prod seed 自动执行

### Allowed Changes

- Dockerfile, docker-compose*.yml, docker-entrypoint.sh, .env.example

### Forbidden Changes

- 禁止在 prod compose 中保留 seed 自动执行
- 禁止硬编码密码
- 禁止修改业务代码

### Acceptance Criteria

- [ ] `docker-compose up --build` 成功启动
- [ ] 容器内 migration 自动执行成功（PG 表存在）
- [ ] 未设置 `JWT_SECRET` 时容器拒绝启动并打印明确错误
- [ ] 手动 smoke test：注册→创建考试→发布→答题→交卷→查看成绩
- [ ] `curl http://localhost:3000/api/health` 返回 200
- [ ] `docker-compose -f docker-compose.dev.yml up` 使用 SQLite 正常

### Required Tests

- 手动 Docker smoke test
- `docker-entrypoint.sh` migration 幂等性测试

### Required Docs / Screenshots

- Docker 部署 smoke test 截图（完整考试流程）
- 环境变量清单

### Dependencies

A02

### Estimated Duration

1 天

### Risk

High

---

## P1.4-A04: CI PostgreSQL Gate

> **状态：已迁移到 Phase1.5 (P1.5-J6)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.5/postgresql-only-convergence.md` 为准。

### Purpose

CI 增加 PostgreSQL service container job，确保每次 PR 都验证 PG 路径。

### Scope

- `.github/workflows/ci.yml` — 增加 PG job

### Acceptance Criteria

- [ ] CI 有 SQLite job + PG job 两个独立 job
- [ ] PG job 用 PostgreSQL 16 service container
- [ ] 两个 job 都 pass 才允许 merge
- [ ] `pnpm lint:arch` 作为独立 CI step

### Dependencies

A02（确保 PG 测试能跑）

### Estimated Duration

1 天

### Risk

Medium

---

## P1.4-A05: Redis / MQ ADR

> **状态：已迁移到 Phase1.5 (P1.5-J7)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.5/postgresql-only-convergence.md` 为准。

### Purpose

产出 ADR 文档，为 Phase2 技术选型提供决策依据。

### Scope

- `docs/archive/phase-1.4/adr-redis-mq.md` — 新建

### Acceptance Criteria

- [ ] 明确列出每类数据的归属：answers → DB sync, heartbeat → Redis, PDF → MQ, realtime → Redis pub/sub
- [ ] 明确列出 Phase2 引入顺序建议
- [ ] 明确禁止答案保存主链路走 MQ

### Dependencies

无

### Estimated Duration

0.5 天

### Risk

Low

---

# Job Cards — Security

---

## P1.4-S01: Multi-Tenant Isolation (tenant guard)

### Purpose

让多租户隔离在中间件层真实生效，而非仅依赖每个 route handler 手动传值。

### Background

- `plugins/tenant.ts:6-10` onRequest hook 是空函数 (`// TODO`)
- `packages/auth/src/tenantGuard.ts` 文件不存在
- 租户隔离完全依赖手动 `ctx.organizationId`
- SuperAdmin `targetOrganizationId` 可传入任意组织 ID，无校验
- `organizationRepo.resolveBrandingTenant()` 无 slug 时返回第一个组织
- `userRepo.findByOrganizationAndUsername()` 不接受 ctx

**Phase1.3 P0 跨组织数据泄露 — 全部未通过。**

### Scope

1. 实现真正的 `tenantGuard` 插件
2. 定义 SuperAdmin 跨组织访问策略：
   - org-scoped API：SuperAdmin **必须**带 `targetOrganizationId`，否则 400
   - SuperAdmin 带合法 `targetOrganizationId`：允许
   - SuperAdmin 带非法 `targetOrganizationId`：403
   - platform API（组织列表、系统管理）：SuperAdmin 可访问，不需要 targetOrg
3. public 端点 (branding, health) 走豁免路径
4. 修复 `userRepo` 到 AuthLookupRepo 模式（A01 定义的接口）
5. 修复 `organizationRepo.resolveBrandingTenant()` 安全问题

### Explicit Non-goals

- 不实现 SuperAdmin 可管理组织列表的动态白名单（Phase1.4 用静态校验：targetOrg 必须存在于 organizations 表）
- 不实现组织层级（Phase3）

### Allowed Changes

- `apps/api/src/plugins/tenant.ts` — 实现真实 tenant guard
- `packages/auth/src/tenantGuard.ts` — 新建
- `apps/api/src/routes/*.ts` — 所有路由确认 `ctx.organizationId` 来源
- `packages/db/src/repository/userRepo.ts` — 迁移到 AuthLookupRepo
- `packages/db/src/repository/organizationRepo.ts` — 安全修复

### Forbidden Changes

- 禁止 SuperAdmin 不带 targetOrg 时隐式 fallback 到自己组织
- 禁止 public 端点走 tenant guard
- 禁止去掉现有 repo 中已有的 organizationId 过滤

### Acceptance Criteria

- [ ] 组织 A Admin 调用 `GET /api/exams` 只返回 A 组织的考试
- [ ] 组织 A Candidate 无法 start 组织 B 的考试（403）
- [ ] SuperAdmin 不带 `targetOrganizationId` 调用 org-scoped API → 400
- [ ] SuperAdmin 带 `targetOrganizationId=B` → 可查看 B 数据
- [ ] SuperAdmin 带 `targetOrganizationId=不存在` → 403
- [ ] SuperAdmin 调用 platform API（`GET /api/organizations`）→ 正常
- [ ] `GET /api/settings/branding` (public) 不需要认证
- [ ] 所有 repo 查询包含 organizationId 条件

### Required Tests

- `tests/security/tenant-isolation.test.ts` — 覆盖上述全部场景

### Required Docs / Screenshots

- tenant guard 架构说明（1 页）

### Dependencies

A02

### Estimated Duration

2 天

### Risk

Critical

---

## P1.4-S02: RBAC Permission Matrix

### Purpose

让 22 个已定义的权限真正生效，替代当前仅靠 role name 的 `includes()` 检查。

### Background

- `domain/enums.ts` 定义了 22 个权限，但 `ctx.permissions` 永远 `[]`
- `packages/auth/src/rbac.ts` 文件不存在
- 当前授权仅靠 `requireRole()` 做 role 数组包含
- `system/health` 和 `system/dashboard` 任何认证角色可访问

Phase1.4 权限矩阵（Proctor 行仅定义权限枚举，**不新增业务路由**）：

| 操作 | SuperAdmin | Admin | Teacher | Proctor | Candidate |
|------|-----------|-------|---------|---------|-----------|
| 管理组织 | ✓ | - | - | - | - |
| 管理用户 | ✓ | ✓ | - | - | - |
| 管理 CandidateField | ✓ | ✓ | - | - | - |
| 管理课程 | ✓ | ✓ | ✓ | - | - |
| 管理题目 | ✓ | ✓ | ✓ | - | - |
| 创建考试 | ✓ | ✓ | ✓ | - | - |
| 发布考试 | ✓ | ✓ | ✓ | - | - |
| 归档考试 | ✓ | ✓ | ✓ | - | - |
| 删除考试 | ✓ | ✓ | ✓ | - | - |
| 管理报考 | ✓ | ✓ | ✓ | - | - |
| 参加考试 | - | - | - | - | ✓ |
| 查看自己成绩 | - | - | - | - | ✓ |
| 查看全部成绩 | ✓ | ✓ | ✓ | - | - |
| 导出成绩 | ✓ | ✓ | ✓ | - | - |
| 查看系统健康 | ✓ | ✓ | - | - | - |
| *(监考面板)* | *✓* | *✓* | *-* | *✓* | *-* |
| *(延长时间)* | *✓* | *✓* | *-* | *✓* | *-* |
| *(标记违规)* | *✓* | *✓* | *-* | *✓* | *-* |
| *(强制交卷)* | *✓* | *✓* | *-* | *✓* | *-* |

*斜体行：Phase1.4 只定义权限枚举，不实现业务路由。Phase2 再实现。*

### Scope

1. 创建 `packages/auth/src/rbac.ts`，定义 role → permissions 映射
2. `plugins/auth.ts` 加载 permissions 并注入 `ctx.permissions`
3. 提供 `requirePermission(permission)` 装饰器
4. 保留 `requireRole()` 作为快捷方式
5. 修复 `system/health` 和 `system/dashboard` 的角色限制
6. Proctor 权限枚举存在于矩阵中，但**不新增任何 Proctor 业务路由**

### Explicit Non-goals

- 不实现 Proctor 监考面板路由
- 不实现强制交卷 / 延时 / 标记违规路由
- 不把 permissions 存到数据库（Phase1.4 用代码硬编码映射）

### Allowed Changes

- `packages/auth/src/rbac.ts` — 新建
- `apps/api/src/plugins/auth.ts` — 加载 permissions
- `apps/api/src/routes/*.ts` — 增加 `requirePermission` 调用
- `packages/domain/src/enums.ts` — 确认权限定义

### Forbidden Changes

- 禁止去掉现有 `requireRole()` 调用
- 禁止在前端实现权限控制（前端只做 UI 展示隐藏）
- 禁止新增 Proctor 业务路由
- 禁止 Candidate 角色调用任何管理 API

### Acceptance Criteria

- [ ] Candidate 调用 `POST /api/exams` → 403
- [ ] Teacher 调用 `POST /api/organizations` → 403
- [ ] Teacher 调用 `DELETE /api/users/:id` → 403
- [ ] Admin 调用 `POST /api/organizations` → 403
- [ ] Candidate 调用 `GET /api/candidates` → 403
- [ ] Candidate 调用 `GET /api/system/health` → 403
- [ ] Proctor 调用 `GET /api/system/health` → 403（Proctor 无此权限）
- [ ] `ctx.permissions` 不再是空数组
- [ ] Proctor 权限枚举存在于 rbac 映射中（即使无对应路由）

### Required Tests

- `tests/security/rbac-matrix.test.ts` — 覆盖每种角色 × 每类端点

### Required Docs / Screenshots

- `docs/archive/phase-1.4/permission-matrix.md`

### Dependencies

A02, S01

### Estimated Duration

2 天

### Risk

High

---

## P1.4-S03a: Server-side Exam Protocol Hardening

### Purpose

让考试协议在服务端形成闭环：deadline 强制执行、答案保存事务保护、submit 幂等。

### Background

已实现（不动）：
- ✅ 答案版本控制 + clientSeq 幂等 + baseVersion 冲突检测
- ✅ submit 后状态变 graded，不能再次提交 (409)
- ✅ 服务端计算 deadlineAt
- ✅ questionSnapshot 冻结

必须修的缺口：
1. `submitAttempt()` 不拒绝超时提交 — 违反 SPEC 3.4
2. 答案保存无事务保护 — PG 并发写入丢数据
3. save 与 submit 并发无保护

### Scope

1. **Deadline 强制执行**（固定策略，不模糊）：

```
now <= deadlineAt: 允许 submit
now > deadlineAt: 返回 409 ATTEMPT_DEADLINE_EXCEEDED
  - 不计分
  - 不自动提交
  - 不 late submit
  - 不 proctor override
```

以下留给 Phase2：自动提交、超时标记、监考员延时、监考员 override、late submission policy

2. **答案保存事务保护**：
   - SQLite: `db.transaction()`
   - PG: Drizzle `db.transaction()`
   - answers 列的 read-modify-write 必须在事务内

3. **submit 幂等确认**：
   - submit 后状态 `graded`，再次 submit 返回 409（已实现）
   - 确认 `graded` 状态下 save 被拒绝（已实现）

### Explicit Non-goals

- 不实现自动提交超时试卷
- 不实现 `voidAttempt()`
- 不实现 `showResultImmediately` 服务端检查
- 不拆 `attempt_answers` 表
- 不实现多标签页会话锁（Phase2）
- 不实现前端 submit flush（那是 S03b）

### Allowed Changes

- `packages/exam-engine/src/attemptCommands.ts` — submit 增加 deadline 检查
- `apps/api/src/routes/attempts.ts` — answer save 增加事务包装
- `packages/contracts/src/attempt.ts` — submit response 增加 `deadlineExceeded` 错误类型
- `packages/domain/src/errors.ts` — 可能增加 `AttemptDeadlineExceededError`

### Forbidden Changes

- 禁止 deadline 策略留模糊空间（不接受 "409 或标记" 的写法）
- 禁止把 deadline 检查放到前端
- 禁止修改 answer save 的 versioning / idempotency 逻辑

### Acceptance Criteria

- [ ] `now > deadlineAt` 时 `submitAttempt()` 抛出 `AttemptDeadlineExceededError`（409）
- [ ] `now <= deadlineAt` 时 submit 正常
- [ ] 答案保存在 SQLite 和 PG 下有事务保护
- [ ] 并发 save + submit 不导致数据损坏
- [ ] `pnpm test` 全部通过

### Required Tests

- `attemptCommands.test.ts`：超时提交 → 409
- `attempts.test.ts`：PG 并发 answer save 事务测试
- Phase1.3 P0 场景复测：重复提交 → 409，修改已提交 → 失败，重放 → 拒绝

### Required Docs / Screenshots

- 考试协议安全审查报告

### Dependencies

A02

### Estimated Duration

1.5 天

### Risk

High

---

## P1.4-S03b: Client Submit Flush Protocol

> **状态：已迁移到 Phase1.7 (P1.7-S03b)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.7/security-completion-plan.md` 为准。

### Purpose

确保考生交卷前所有 pending answers 已发送到服务器并获得确认。

### Background

当前 `TakeExamPage.tsx` 的 submit 按钮直接发送 submit 请求，不等待可能的 pending saves。如果 save debounce 队列中有未发送答案，这些答案会丢失。

这不是纯 UI 美化，而是考试协议的前端半部分。

### Scope

1. submit 前 flush 所有 pending saves：
   - 等待所有 save promise resolve
   - 保存失败的题目标记为"保存失败"
2. 提交确认对话框显示：
   - 未答题数
   - 未保存题数（pending 中）
   - 保存失败题数
3. 有保存失败题目时阻止直接交卷：
   - 提示"以下题目保存失败，请重试或联系监考员"
   - 提供"仍然提交"选项（仅在有明确用户确认时）
   - 注意：这是考生在保存失败后自行选择提交，不是 Proctor Force Submit
   - Proctor Force Submit 属于 Phase2，Phase1.4 禁止实现
4. submit 请求发送前，所有 save promise 已 settled

### Explicit Non-goals

- 不修改 answer save protocol 本身
- 不修改 submit 路由逻辑
- 不做断网恢复（Phase2）

### Allowed Changes

- `apps/web/src/pages/exam/TakeExamPage.tsx` — submit flush 逻辑
- `apps/web/src/components/exam/SaveIndicator.tsx` — 显示保存失败状态
- 可能新增 `apps/web/src/components/exam/SubmitConfirmDialog.tsx`

### Forbidden Changes

- 禁止绕过 flush 直接 submit（除非用户明确选择"仍然提交"）
- 禁止把这件事伪装成 UI 美化
- 禁止修改后端
- 禁止实现 Proctor Force Submit（Phase2）

### Acceptance Criteria

- [ ] 点击"交卷"时先 flush pending saves
- [ ] 确认对话框显示：未答题 N 道、未保存 N 道、保存失败 N 道
- [ ] 有保存失败题目时，默认阻止交卷，需用户二次确认
- [ ] flush 全部成功后，submit 请求发送
- [ ] flush 超时（如 10 秒）后提示用户选择重试或"仍然提交"

### Required Tests

- `TakeExamPage.test.tsx` — submit flush 流程测试
- `SubmitConfirmDialog.test.tsx` — 确认对话框状态测试

### Required Docs / Screenshots

- 提交确认对话框截图

### Dependencies

S03a

### Estimated Duration

1 天

### Risk

High

---

## P1.4-S04: Auth Session Security

> **状态：已迁移到 Phase1.7 (P1.7-S04-lite)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.7/security-completion-plan.md` 为准。
> Phase1.7 中拆分为 baseline/lite 版本，full 版本 deferred 到 Phase2/1.8。

### Purpose

修复认证会话的基础安全问题：JWT secret、logout 失效、timing-safe 登录、cookie 配置。

### Background

| 问题 | 依据 |
|------|------|
| JWT secret 硬编码 fallback `"development-only-change-me"` | `session.ts:12` |
| Logout 清 cookie 不能让 JWT 失效 | `auth.ts:128-131` 仅清 cookie |
| Cookie secure flag 用 `NODE_ENV` 而非 `COOKIE_SECURE` | `auth.ts:110` |
| 登录 timing oracle：null user 不调 verifyPassword | `auth.ts:84-100` |
| `ctx.sessionId` 存完整 JWT | `plugins/auth.ts:36` |

### Scope

1. **JWT secret**：去掉 hardcoded fallback，所有环境启动时检查 `JWT_SECRET` 必须存在
2. **Logout 失效**：采用 sessionVersion 方案：

```
users 表增加 sessionVersion INT DEFAULT 0
JWT payload 携带 sessionVersion
auth plugin 验证 token 时比对 DB 中的 sessionVersion
logout / password change / force reset 时递增 sessionVersion
```

禁止：
- 禁止声称"清 cookie 后旧 JWT 失效"
- 禁止引入 Redis token blacklist
- 禁止缩短 JWT 过期时间当作 logout 失效

3. **Timing-safe 登录**：
   - 用户不存在时也执行 dummy password verify（用预生成的 dummy hash）
   - 错误用户名和错误密码返回相同 status 和相同 error shape
   - 测试中 mock verifyPassword，确认不存在用户路径也调用 dummy verify
   - **禁止用 wall-clock 毫秒差作为 CI 硬验收**

4. **Cookie secure flag**：读取 `COOKIE_SECURE` 环境变量

5. **sessionId**：不存完整 JWT，改为存 JWT 的 hash 或不存

### Explicit Non-goals

- 不引入 Redis
- 不实现 JWT refresh token
- 不改变 JWT 过期时间

### Allowed Changes

- `packages/auth/src/session.ts` — 去掉 hardcoded secret
- `packages/db/src/schema/sqlite.ts` + `pg.ts` — users 表增加 `sessionVersion`
- `apps/api/src/routes/auth.ts` — timing-safe login, sessionVersion logout
- `apps/api/src/plugins/auth.ts` — sessionVersion 验证, sessionId 改为 hash
- 新 migration 文件

### Forbidden Changes

- 禁止引入 Redis
- 禁止 JWT secret 可预测

### Acceptance Criteria

- [ ] 未设置 `JWT_SECRET` 时服务器拒绝启动
- [ ] 用户不存在时也执行 dummy password verify（mock 测试确认）
- [ ] 错误用户名和错误密码返回相同 status + 相同 error shape
- [ ] Logout 后旧 cookie 无法通过 `/api/auth/me` 验证（sessionVersion 机制）
- [ ] Password change 后旧 token 失效（sessionVersion 机制）
- [ ] `COOKIE_SECURE=true` 时 cookie 有 `secure` flag

### Required Tests

- `auth.test.ts`：JWT secret 未设置 → 启动失败
- `auth.test.ts`：mock verifyPassword 确认不存在用户路径调 dummy verify
- `auth.test.ts`：logout 后 token 失效
- `auth.test.ts`：password change 后 token 失效
- `auth.test.ts`：COOKIE_SECURE flag 切换

### Required Docs / Screenshots

- 认证安全审查清单

### Dependencies

A02

### Estimated Duration

1.5 天

### Risk

Medium

---

## P1.4-S05: CSV Injection + Security Headers + CSRF Origin Check

> **状态：已迁移到 Phase1.7 (P1.7-S05-lite)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.7/security-completion-plan.md` 为准。

### Purpose

修复 CSV 公式注入、补齐安全 Header、增加 CSRF Origin/Referer 校验。

### Background

- `escapeCSVValue()` 不处理 `=` `+` `-` `@` `\t` `\r` 开头的值
- 无 CSP、HSTS、Permissions-Policy header
- CSRF 防护仅靠 `sameSite: strict`

### Scope

1. **CSV 注入修复**：以 `=` `+` `-` `@` `\t` `\r` 开头的值前缀 `'`

2. **安全 Header**：
   - `Content-Security-Policy`：不含 `unsafe-eval`
     - Production CSP: `script-src 'self'`, `connect-src 'self'` plus configured API origin
     - Development CSP: may be relaxed for Vite HMR; must not be copied into production
   - `Strict-Transport-Security`：仅 `COOKIE_SECURE=true` 时启用
   - `Permissions-Policy`：禁用不必要的能力
   - 保留已有的 `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`

3. **CSRF 防护**（统一口径）：
   - 保留 `SameSite=strict`
   - 对所有 cookie-auth mutating API 增加 `Origin` / `Referer` 校验
   - Production browser requests must pass Origin/Referer allowlist check
   - Missing Origin/Referer is rejected in production
   - Test/development may allow explicit bypass under `NODE_ENV=test/development`
   - Allowed origins come from `APP_ORIGIN` / `ALLOWED_ORIGINS`
   - Non-browser service-token API is not cookie-auth and is out of scope for Phase1.4
   - Phase2 再评估 CSRF token 或 double-submit cookie
   - **禁止把 `SameSite=strict` 单独当作完整 CSRF 防护**
   - **禁止在 S09 验收时把未实现的 CSRF token 写成"已通过"**

4. **XSS 审查**：排查 `dangerouslySetInnerHTML` 使用

### Explicit Non-goals

- 不引入 CSRF token 库
- 不做 XSS sanitization library（React 默认转义）

### Allowed Changes

- `packages/import-export/src/csv.ts`
- `apps/api/src/plugins/security.ts`
- `apps/api/src/plugins/csrf.ts` — 新建 Origin/Referer 校验
- `apps/web/src/` — 排查 `dangerouslySetInnerHTML`

### Forbidden Changes

- 禁止 CSP 设为 `unsafe-inline` + `unsafe-eval`
- 禁止 HSTS 在 HTTP 内网部署时强制启用

### Acceptance Criteria

- [ ] CSV 导出中 `=CMD(...)` → `'=CMD(...)`
- [ ] `Content-Security-Policy` header 存在且不含 `unsafe-eval`
- [ ] HTTPS 部署时 `Strict-Transport-Security` header 存在
- [ ] HTTP 部署时无 `Strict-Transport-Security` header
- [ ] Production: cookie-auth mutating API 无 Origin/Referer → 拒绝
- [ ] Development/test: may allow explicit bypass under `NODE_ENV=test/development`
- [ ] Allowed origins from `APP_ORIGIN` / `ALLOWED_ORIGINS` env
- [ ] 前端无 `dangerouslySetInnerHTML` 或已确认安全
- [ ] Phase1.3 P1 XSS / CSRF / CSV 检查表通过

### Required Tests

- `csv.test.ts`：公式注入字符 escape 测试
- `security-headers.test.ts`：所有 header 存在且值正确
- `csrf-origin.test.ts`：Origin/Referer 校验测试

### Required Docs / Screenshots

- 安全 header 配置说明

### Dependencies

无（可与 A 系列并行）

### Estimated Duration

1 天

### Risk

Medium

---

## P1.4-S06: Audit Log Completion

> **状态：已迁移到 Phase1.7 (P1.7-S06-lite)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.7/security-completion-plan.md` 为准。
> Phase1.7 中完成 baseline，Proctor operation audit 留到 Phase2。

### Purpose

补齐缺失的审计事件，增加审计日志查询 API。

### Scope

1. 补齐事件：`login.success`, `login.failure`, `logout`, `password.change`
2. SuperAdmin 跨组织操作审计（`targetOrganizationId` 记入 metadata）
3. `GET /api/admin/audit-logs` 查询端点（Admin/SuperAdmin only，分页 + action 过滤）

### Acceptance Criteria

- [ ] 登录成功 → `login.success`
- [ ] 登录失败 → `login.failure`（含 attempted username，不含密码）
- [ ] 登出 → `logout`
- [ ] 修改密码 → `password.change`
- [ ] SuperAdmin 跨组织操作 → `metadata.targetOrganizationId` 有值
- [ ] `GET /api/admin/audit-logs` 返回分页结果
- [ ] Candidate 角色调用审计查询 → 403

### Required Tests

- `audit.test.ts`, `audit-api.test.ts`

### Dependencies

S01, S02

- login/logout/password audit events can be implemented independently
- cross-organization audit metadata (`targetOrganizationId`) depends on S01 tenant guard and S02 RBAC
- audit query API requires S02 RBAC for Admin/SuperAdmin permission check

### Estimated Duration

1 天

### Risk

Medium

---

## P1.4-S07: Password Policy + Account Security

> **状态：已迁移到 Phase1.7 (P1.7-S07-lite)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.7/security-completion-plan.md` 为准。
> Phase1.7 中拆分为 baseline/lite 版本（最小长度 8 + config 策略），full 版本 deferred 到 Phase2/1.8。

### Purpose

提高密码强度、增加账户锁定、首次登录强制改密。

### Scope

1. 密码最小长度 6 → 8
2. 新建用户标记 `mustChangePassword: true`，首次登录后清除
3. 5 次失败后锁定 15 分钟（`loginFailCount` + `lockedUntil` 字段）
4. SuperAdmin 最后账号不可被锁定（必须有恢复机制）

### Acceptance Criteria

- [ ] 密码 < 8 → 拒绝
- [ ] 5 次失败 → 锁定
- [ ] 锁定后正确密码 → 仍拒绝
- [ ] 15 分钟后 → 可登录
- [ ] 首次登录未改密 → 403 + 提示改密
- [ ] SuperAdmin 最后账号不被锁定

### Required Tests

- `auth.test.ts`：密码长度、锁定、首次改密

### Required Docs / Screenshots

- `docs/archive/phase-1.4/password-policy.md`

### Dependencies

A02（schema 变更）

### Estimated Duration

1 天

### Risk

Medium

---

## P1.4-S08: Red-Team Security Test Suite

> **状态：已迁移到 Phase1.7 (P1.7-S08-lite)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.7/security-completion-plan.md` 为准。
> Phase1.7 中改为 red-team baseline suite，不要求覆盖 full S04/S07。

### Purpose

创建自动化安全测试套件，覆盖 Phase1.3 安全清单的全部场景。

### Scope

- `tests/security/` 目录，包含：
  - `unauthorized-access.test.ts` — P0 未授权访问 6 场景
  - `tenant-isolation.test.ts` — P0 跨组织 5 场景
  - `exam-protocol-security.test.ts` — P0 考生提交 5 场景
  - `xss-csrf-csv.test.ts` — P1 XSS 3 + CSRF 2 + CSV 2 场景
  - `password-policy.test.ts` — P1 弱口令 3 场景

### Acceptance Criteria

- [ ] Phase1.3 全部 26+ 场景有自动化测试
- [ ] `pnpm test` 包含所有安全测试
- [ ] SQLite 和 PG 都通过

### Required Tests

即为本 Job 的产出。

### Dependencies

S01-S07 全部完成

### Estimated Duration

2 天

### Risk

High

---

## P1.4-S09: Phase1.3 Security Validation

> **状态：已迁移到 Phase1.7 (P1.7-S09-lite)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.7/security-completion-plan.md` 为准。
> Phase1.7 中改为 Phase1.7 security baseline validation，不是 Phase1.3 全量复测。

### Purpose

最终安全验收，确认 Phase1.3 安全清单全部通过。

### Scope

- 执行 S08 自动化套件
- 手动补充验证无法自动化的场景
- 产出验收报告

### Acceptance Criteria

- [ ] Phase1.3 P0 全部 ✓
- [ ] Phase1.3 P1 全部 ✓
- [ ] Phase1.3 P2 全部 ✓

### Required Docs / Screenshots

- `docs/archive/phase-1.4/phase1.3-validation-report.md`

### Dependencies

S08

### Estimated Duration

1 天

### Risk

High

---

# Job Cards — UI

---

## P1.4-U01: UI Design System Baseline

### Purpose

提取共享常量、统一 semantic token 使用、增加 ErrorBoundary，为样板页建立基础。

### Scope

1. 新建 `apps/web/src/lib/constants.ts`：提取 `statusLabels`, `typeLabels`, `difficultyLabels` 等重复定义
2. 统一颜色到 semantic token（`bg-green-500` → `bg-success` 等）
3. 修复 `BrandProvider.tsx` fallback 硬编码中文 → 通用英文
4. 新建 `ErrorBoundary.tsx` 组件，包裹 App
5. 修复 `/exam/settings` 不可达路由
6. `CandidateFieldsPage.tsx` 原生 select → shadcn Select

### Explicit Non-goals

- 不做 dark mode
- 不引入新 UI 框架
- 不做全站重写

### Acceptance Criteria

- [ ] `statusLabels` 无本地重复定义
- [ ] `bg-green-500` / `bg-yellow-500` / `bg-red-500` 从 components/ 中消除
- [ ] ErrorBoundary 包裹 App，render crash 显示友好错误页
- [ ] `/exam/settings` 路由可达或链接移除
- [ ] BrandProvider fallback 无中文场景词
- [ ] `pnpm typecheck` + `pnpm lint:copy` 通过

### Dependencies

无

### Estimated Duration

1 天

### Risk

Medium

---

## P1.4-U02: Admin Dashboard Sample

### Purpose

以 Dashboard 为样板建立 Admin 页面视觉基准。

### Scope

- Dashboard：Stats 一行 4 个、状态 Badge、快捷操作按钮、1280px 检查
- 修复 `AttemptDetailPage.tsx:114` 分数 bug（显示 totalScore 而非得分）

### Explicit Non-goals

- 不新增后端筛选 API
- 不引入图表库

### Acceptance Criteria

- [ ] Dashboard 截图 review 通过
- [ ] 1280px 下 stats 一行 4 个
- [ ] 状态 badge 有统一颜色
- [ ] AttemptDetailPage 分数正确
- [ ] Loading / Empty / Error 三态正常

### Dependencies

U01

### Estimated Duration

1.5 天

### Risk

Medium

---

## P1.4-U03: Exam Detail Sample

### Purpose

以 Exam Detail 为样板建立详情页模式。

### Scope

- 分区布局：Stats → Config → Tabs（报考/成绩）
- 修复 `ScoreListPage.tsx:129` export URL 缺 `/api` 前缀
- 操作日志 Tab 可以 placeholder，不提前实现完整审计 UI

### Explicit Non-goals

- 不实现完整审计日志 UI（操作日志 tab 可 placeholder）
- 不增加新 API 调用

### Acceptance Criteria

- [ ] Exam Detail 截图 review 通过
- [ ] 页面分 Stats → Config → Tabs 三区
- [ ] ScoreListPage CSV export 可正常下载

### Dependencies

U01

### Estimated Duration

1.5 天

### Risk

Medium

---

## P1.4-U04: Take Exam Sample

### Purpose

以 Take Exam 为样板建立考生端体验基准。

### Scope

- 安静高可读布局、1024px 适配、Timer 醒目、保存状态强反馈
- 修复 `ExamConfigForm.tsx:85` useEffect 缺依赖
- **submit flush 和确认对话框属于 S03b，不在本 Job 中**

### Explicit Non-goals

- 不实现 submit flush（S03b）
- 不引入动画库
- 不做全屏模式

### Acceptance Criteria

- [ ] Take Exam 截图 review 通过
- [ ] 1024px 下答题区可用
- [ ] Timer 剩余 5 分钟变红
- [ ] 保存状态有明显图标变化
- [ ] ExamConfigForm useEffect 依赖完整

### Dependencies

U01

U04 must not implement submit flush. S03b owns submit flush and may update TakeExamPage later. Final Take Exam acceptance may require both U04 visual baseline and S03b protocol behavior.

### Estimated Duration

1.5 天

### Risk

Medium

---

# Job Card — Validation

---

## P1.4-V01: Phase2 Entry Gate Check

### Purpose

执行最终门禁检查，确认所有 Phase1.4 目标达成。

### Scope

- 执行 Phase2 Entry Gate 清单
- 产出 gate check 报告

### Dependencies

All

### Estimated Duration

0.5 天

### Risk

High

---

# Dependency Graph

> **更新（2026-06-11）**：A00-A05 已迁移到 Phase1.5，S03b-S09 已迁移到 Phase1.7。
> 详见 `docs/archive/phase-1.4/05-dependency-graph.md` 获取完整跨阶段依赖图。

```
Phase1.4
  S01 (2d) → S02 (2d)
  S03a (1.5d)
  U01 (1d) → U02 (1.5d) ── parallel
           → U03 (1.5d) ── parallel
           → U04 (1.5d) ── parallel

Phase1.5 (after Phase1.4)
  J1 (0.5d) → J5 (2d) → J6 (1d)
  J2 (1d) ── parallel
  J3 (1d) ── parallel
  J4 (1d) ── parallel

Phase1.6 (after Phase1.5)
  J1 (2d) → J2 (2d)

Phase1.7 (after Phase1.6)
  S03b (1d) ── parallel
  S04-lite (1d) ── parallel
  S05-lite (1d) ── parallel
  S06-lite (1d) ── parallel
  S07-lite (1d) ── parallel
  S08-lite (2d) → S09-lite (1d)
```

**Critical path**: S01(2) → S02(2) → Phase1.5(J5:2) → Phase1.6(J2:2) → Phase1.7(S08:2→S09:1) = **~11 days**

With parallel execution: **~15-16 working days total** (含 Phase1.4 UI 并行)

---

# Phase2 Entry Gate

Phase2 can start only if:

- [ ] Phase1.4 UI Jobs U01-U04 complete
- [ ] Phase1.5 PostgreSQL-only convergence complete
- [ ] Phase1.6 PostgreSQL correctness hardening complete
- [ ] Phase1.7 security baseline complete
- [ ] S03b submit flush complete
- [ ] S01 tenant isolation complete
- [ ] S02 RBAC matrix complete
- [ ] S03a server-side exam protocol complete
- [ ] PG seed stable
- [ ] PG migrations clean
- [ ] PG integration tests pass
- [ ] `pnpm verify` pass

### Phase2 依赖 Phase1.7 的 baseline

Phase2 可以安全地假设以下 Phase1.7 baseline 已完成：

- [ ] tenant guard
- [ ] RBAC
- [ ] audit baseline（login/logout/audit-logs API）
- [ ] CSV / security header baseline
- [ ] account / session baseline（JWT secret fallback removed, cookie secure, dummy verify）
- [ ] password baseline（最小长度 8，config 驱动）

### Phase2 Entry Gate 不再要求以下内容

以下 full 安全内容不属于 Phase2 Entry Criteria，将在 Phase2 或 Phase1.8 中完成：

- [ ] ~~sessionVersion full revocation（logout 后旧 JWT 服务端失效）~~ → Phase2/1.8
- [ ] ~~password change 后旧 token 全部失效~~ → Phase2/1.8
- [ ] ~~5 次失败锁定 15 分钟~~ → Phase2/1.8
- [ ] ~~mustChangePassword~~ → Phase2/1.8
- [ ] ~~首次登录强制改密~~ → Phase2/1.8
- [ ] ~~Phase1.3 P0/P1/P2 全量通过~~ → 改为 Phase1.7 S09-lite baseline validation

---

# Phase2 Handoff Notes

## Phase2 Can Now Safely Build

- ExamRoom model + IP restriction (track 2A)
- Proctor Panel polling MVP (track 2B)
- Proctor 业务路由（基于 S02 定义的 Proctor 权限枚举扩展）
- Redis presence ADR implementation (based on A05)
- WebSocket event model (track 2B)
- Random paper snapshot policy (track 2C)
- timed_sync / deadline / untimed timing modes (track 2C)
- Export worker design (PDF/Excel async) (track 2D)
- External integration token model / Pass Gate API (track 2D)
- Audit log auto-cleanup (track 2D)

## Phase2 Must Not Break

- Answer Save Protocol (versioned + idempotent + conflict detection)
- Server-side time authority (deadlineAt)
- Question snapshot (frozen at attempt creation)
- Tenant isolation (Phase1.4 tenant guard)
- RBAC (Phase1.4 permission matrix)
- sessionVersion logout invalidation
- Repository pattern:
  - tenant-scoped repos accept TenantContext
  - platform repos accept PlatformContext
  - auth/public lookup repos accept AuthLookupContext
  - route handlers must not pass naked organizationId except through explicit lookup context

## Phase2 Should Reuse

- `packages/auth/src/rbac.ts` — extend Proctor permission mapping
- `packages/auth/src/tenantGuard.ts` — extend ExamRoom-level isolation
- `packages/domain/src/errors.ts` — extend new domain error types
- `packages/exam-engine/src/attemptCommands.ts` — extend void/extend-time
- `apps/web/src/lib/constants.ts` — extend Proctor status labels
- `apps/web/src/components/shared/` — reuse StatsCard, EmptyState, ErrorState

## Phase2 Needs New ADRs

- WebSocket transport vs pure polling trade-off
- Redis data schema for presence + pub/sub
- Random paper algorithm (block random vs adaptive)
- Export worker architecture (in-process vs separate worker)
- External integration auth model (API Key vs OAuth client credentials)
- Multi-instance deployment (session stickiness vs shared state)

## Phase2 First Recommended Jobs

1. **P2A-J1: ExamRoom model** — 考场是 Phase2 所有操作的基础实体
2. **P2B-J1: WebSocket infrastructure** — Redis pub/sub 背板 + polling fallback
3. **P2B-J2: Proctor Panel polling MVP** — 先用 HTTP polling，不依赖 WebSocket
4. **P2C-J1: Random paper builder** — 基于 question bank 的随机组卷
5. **P2D-J2: Service Token / API Key** — 外部集成的基础认证模型
6. **P2D-J3: PDF export worker** — 异步导出架构设计
7. **P2A-J5: Proctor operations** — 强制交卷/延时/标记违规

以上仅作为 Phase2 建议，**不允许 Phase1.4 实现任何一项**。

---

# Minimum Viable Phase1.4 (P0 Set)

**重要更新（2026-06-11）**：Phase1.4 当前状态为 partial closeout。原 A00-A05 已迁移到 Phase1.5，原 S03b-S09 已迁移到 Phase1.7。

Phase1.4 的最小必须集：

**P0 Phase1.4 必须完成**：

| Job | 原因 |
|-----|------|
| S01 | 多租户隔离是空壳 |
| S02 | 权限系统不生效 |
| S03a | 考试协议服务端不闭环 |
| U01 | 设计系统基准，支撑后续 UI |
| U02 | Dashboard 样板页 |
| U03 | Exam Detail 样板页 |
| U04 | Take Exam 样板页 |

**P0 最小集预估**: ~6 个工作日

**不再属于 Phase1.4 的 Job**：

| Job | 新归属 | 原因 |
|-----|--------|------|
| A00-A05 | Phase1.5 | PostgreSQL-only convergence 独立成阶段 |
| S03b | Phase1.7 | 考试协议前端半部分，在 PG-only 后完成 |
| S04-S09 | Phase1.7 | 安全 Job 重新编排为 baseline/lite，避免破坏 seed/登录态 |

详见：
- `docs/archive/phase-1.5/postgresql-only-convergence.md`
- `docs/archive/phase-1.6/postgresql-correctness-hardening.md`
- `docs/archive/phase-1.7/security-completion-plan.md`
- `docs/archive/phase-1.4/phase1.4-closeout-and-deferral.md`

