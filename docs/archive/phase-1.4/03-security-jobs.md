# Security Job Cards (S01–S09)

> 本文档是 `phase1.4-bridge-plan.md` 的展开。若发生冲突，以 bridge plan 为准。
> Phase1.3 安全计划全部未执行，以下 Job 覆盖其全部检查项。

---

## 重要状态更新（2026-06-11）

经最新决策，Phase1.4 的当前状态为 **partial closeout**：

- **S01 / S02 / S03a 仍归属 Phase1.4**（已完成或基础完成）
- **S03b / S04 / S05 / S06 / S07 / S08 / S09 已迁移到 Phase1.7**

这些 Job 的历史背景、Scope、Acceptance Criteria 等详细内容在本文档中**保留**，仅供追溯。当前执行以 `docs/archive/phase-1.7/security-completion-plan.md` 为准，其中 S04-S09 被重新编排为 baseline/lite 版本。

Phase1.7 定位：**Security Completion / Account & Browser Security Baseline**

---

---

## P1.4-S01: Multi-Tenant Isolation / Tenant Guard

### Purpose

让多租户隔离在中间件层真实生效。

### Background

- `plugins/tenant.ts:6-10` 空函数 (`// TODO`)
- `packages/auth/src/tenantGuard.ts` 不存在
- SuperAdmin `targetOrganizationId` 可传入任意 ID，无校验
- `organizationRepo.resolveBrandingTenant()` 无 slug 时返回第一个组织
- `userRepo.findByOrganizationAndUsername()` 不接受 ctx

### Scope

1. 实现真正的 tenant guard 插件
2. SuperAdmin 跨组织策略：
   - org-scoped API：**必须**带 `targetOrganizationId`，否则 **400 Bad Request**
   - 带合法 `targetOrganizationId`：允许
   - 带非法 `targetOrganizationId`：**403**
   - platform API（`GET /api/organizations` 等）：不需要 targetOrg
3. public 端点豁免（`/api/health`, `/api/settings/branding`）
4. 修复 userRepo 到 AuthLookupRepo 模式
5. 修复 `organizationRepo.resolveBrandingTenant()`

### Explicit Non-goals

- 不实现 SuperAdmin 可管理组织列表动态白名单（Phase1.4 用静态校验：targetOrg 必须存在于 organizations 表）
- 不实现组织层级（Phase3）

### Allowed Changes

- `apps/api/src/plugins/tenant.ts`
- `packages/auth/src/tenantGuard.ts` — 新建
- `apps/api/src/routes/*.ts`
- `packages/db/src/repository/userRepo.ts`
- `packages/db/src/repository/organizationRepo.ts`

### Forbidden Changes

- 禁止 SuperAdmin 不带 targetOrg 时隐式 fallback 到自己组织
- 禁止 public 端点走 tenant guard
- 禁止去掉现有 repo 的 organizationId 过滤

### Acceptance Criteria

- [ ] 组织 A Admin 调用 `GET /api/exams` 只返回 A 组织考试
- [ ] 组织 A Candidate 无法 start 组织 B 考试（403）
- [ ] SuperAdmin 不带 `targetOrganizationId` 调用 org-scoped API → 400
- [ ] SuperAdmin 带 `targetOrganizationId=B` → 可查看 B 数据
- [ ] SuperAdmin 带 `targetOrganizationId=不存在` → 403
- [ ] SuperAdmin 调用 platform API → 正常
- [ ] `GET /api/health` (public) 不需要认证
- [ ] `GET /api/system/health` (protected) 需要 Admin/SuperAdmin

### Required Tests

- `tests/security/tenant-isolation.test.ts`

### Required Docs / Screenshots

- tenant guard 架构说明

### Dependencies

A02

### Estimated Duration

2 天

### Risk

Critical

---

## P1.4-S02: RBAC Permission Matrix

### Purpose

让 22 个已定义权限真正生效。Proctor 权限枚举可定义，**不新增 Proctor 业务路由**。

### Background

- `ctx.permissions` 永远 `[]`
- `packages/auth/src/rbac.ts` 不存在
- 仅靠 `requireRole()` 做 role.includes
- `system/health` 任何角色可访问

Phase1.4 权限矩阵：

| 操作 | SuperAdmin | Admin | Teacher | Proctor | Candidate |
|------|-----------|-------|---------|---------|-----------|
| 管理组织 | ✓ | - | - | - | - |
| 管理用户 | ✓ | ✓ | - | - | - |
| 管理 CandidateField | ✓ | ✓ | - | - | - |
| 管理课程 | ✓ | ✓ | ✓ | - | - |
| 管理题目 | ✓ | ✓ | ✓ | - | - |
| 创建/发布/归档/删除考试 | ✓ | ✓ | ✓ | - | - |
| 管理报考 | ✓ | ✓ | ✓ | - | - |
| 参加考试 | - | - | - | - | ✓ |
| 查看自己成绩 | - | - | - | - | ✓ |
| 查看全部成绩 | ✓ | ✓ | ✓ | - | - |
| 导出成绩 | ✓ | ✓ | ✓ | - | - |
| 查看系统健康 | ✓ | ✓ | - | - | - |
| *(监考面板/延时/违规/强制交卷)* | *✓/✓/-/✓* | *✓/✓/-/✓* | *-/-/-/-* | *✓/✓/✓/✓* | *-/-/-/-* |

*斜体行：Phase1.4 只定义权限枚举，不实现业务路由。*

### Scope

1. 创建 `packages/auth/src/rbac.ts`
2. `plugins/auth.ts` 加载 permissions
3. 提供 `requirePermission(permission)` 装饰器
4. 保留 `requireRole()` 快捷方式（内部调 requirePermission）
5. 修复 `system/health` 和 `system/dashboard` 角色限制

### Explicit Non-goals

- 不实现 Proctor 监考面板路由
- 不实现强制交卷 / 延时 / 标记违规路由
- 不把 permissions 存到数据库

### Allowed Changes

- `packages/auth/src/rbac.ts` — 新建
- `apps/api/src/plugins/auth.ts`
- `apps/api/src/routes/*.ts`
- `packages/domain/src/enums.ts`

### Forbidden Changes

- 禁止去掉现有 `requireRole()`
- 禁止前端实现权限控制
- 禁止新增 Proctor 业务路由
- 禁止 Candidate 访问管理 API

### Acceptance Criteria

- [ ] Candidate 调用 `POST /api/exams` → 403
- [ ] Teacher 调用 `POST /api/organizations` → 403
- [ ] Teacher 调用 `DELETE /api/users/:id` → 403
- [ ] Admin 调用 `POST /api/organizations` → 403
- [ ] Candidate 调用 `GET /api/candidates` → 403
- [ ] Candidate/Proctor 调用 `GET /api/system/health` → 403
- [ ] `ctx.permissions` 不再为空
- [ ] Proctor 权限枚举存在于 rbac 映射

### Required Tests

- `tests/security/rbac-matrix.test.ts`

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

服务端 deadline 强制执行、答案保存事务保护。

### Background

- `submitAttempt()` 不拒绝超时提交（违反 SPEC 3.4）
- 答案保存无事务保护（PG 并发丢数据）
- `ExamTimeExpiredError` error code `EXAM_TIME_EXPIRED` 语义不准确，需改为 `ATTEMPT_DEADLINE_EXCEEDED`

### Database Policy (PG-only Transaction)

S03a 的事务保护以 PostgreSQL 为权威后端：

- **生产**：PG `SELECT ... FOR UPDATE` 行级锁 + `db.transaction()` 保证并发安全
- **事务路由**：`saveAnswers`、`submitAttempt` 的 read→validate→write 在单个事务内完成
- **双方言策略**：
  - PG：`executeInTransaction()` 调用 `db.transaction()`，`findByIdForUpdate()` 使用 `.for("update")`
  - SQLite：`executeInTransaction()` 直接调 `fn(db)` 不包事务（单线程无需），`findByIdForUpdate()` 做 regular select
- **现有测试全绿**：SQLite 下事务保护透传，所有 route-level tests 正常通过
- **Phase 1.5/1.6 负责**：建立 PG test helper，验证并发行为，最终移除 SQLite

### Scope

1. **Error code 重命名**：

   - `ExamTimeExpiredError` → `AttemptDeadlineExceededError`
   - Error code `EXAM_TIME_EXPIRED` → `ATTEMPT_DEADLINE_EXCEEDED`
   - 保留 re-export alias `ExamTimeExpiredError` 供外部兼容

2. **Deadline 固定策略**（不模糊）：

```
now <= deadlineAt → 允许 submit
now > deadlineAt → 409 ATTEMPT_DEADLINE_EXCEEDED
  - 不计分
  - 不自动提交
  - 不 late submit
  - 不 proctor override
```

Phase2 才做：自动提交、超时标记、监考员延时、override、late policy

3. **答案保存事务保护**：
   - `saveAnswers` route：整个 read→validate→compute→write 包在 `executeInTransaction()` 内
   - 使用 `attemptRepo.findByIdForUpdate()` (PG: `SELECT ... FOR UPDATE`) 锁定 attempt 行
   - 防止并发 save + submit 导致数据损坏

4. **submit 事务保护**：
   - `submitAttempt` route：deadline check + status update 包在 `executeInTransaction()` 内
   - `gradeAttempt` 在事务外执行（不持有锁做业务计算）

5. **submit 幂等确认**：graded 状态下 save 被拒绝（已实现）

### Explicit Non-goals

- 不实现自动提交超时试卷
- 不实现 voidAttempt
- 不实现 showResultImmediately 服务端检查
- 不拆 attempt_answers 表
- 不实现多标签页会话锁
- 不做前端 submit flush（S03b）
- 不建立 PG test helper（Phase 1.5 负责）
- 不修改 answer save versioning / idempotency 逻辑

### Allowed Changes

- `packages/domain/src/errors.ts`（重命名 + re-export alias）
- `packages/exam-engine/src/attemptCommands.ts`
- `apps/api/src/routes/attempts.ts`
- `packages/contracts/src/attempt.ts`
- `packages/db/src/types.ts`（`executeInTransaction()` helper）
- `packages/db/src/repository/attemptRepo.ts`（`findByIdForUpdate()`）
- `apps/api/src/routes/*.test.ts`（skip PG-only tests）

### Forbidden Changes

- 禁止 deadline 策略留模糊空间（不接受 "409 或标记"）
- 禁止把 deadline 检查放到前端
- 禁止修改 answer save versioning / idempotency 逻辑
- 禁止为 SQLite 写 transaction workaround（以 PG 行为为准）

### Acceptance Criteria

- [ ] `now > deadlineAt` 时 submit → 409 ATTEMPT_DEADLINE_EXCEEDED
- [ ] `now <= deadlineAt` 时 submit 正常
- [ ] Error code 为 `ATTEMPT_DEADLINE_EXCEEDED`（非 `EXAM_TIME_EXPIRED`）
- [ ] `saveAnswers` route 使用 `executeInTransaction()` + `findByIdForUpdate()` 事务保护
- [ ] `submitAttempt` route deadline check + status update 在事务内
- [ ] `executeInTransaction()`：PG 包 `db.transaction()`，SQLite 透传 `fn(db)`
- [ ] `findByIdForUpdate()`：PG 用 `FOR UPDATE`，SQLite 做 regular select
- [ ] `pnpm verify` 通过（SQLite + PG 双方言全绿）

### Required Tests

- `attemptCommands.test.ts`：超时提交 → 409 ATTEMPT_DEADLINE_EXCEEDED
- Phase1.3 P0 考生提交场景复测
- Phase 1.5/1.6 新增 PG 并发事务测试

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

当前 `TakeExamPage.tsx` submit 不等待 pending saves，可能丢最后一笔答案。

### Scope

1. submit 前 flush 所有 pending saves
2. 等待所有 save promise settled
3. 提交确认对话框显示：未答题数、未保存题数、保存失败题数
4. 有保存失败时阻止默认提交
5. 提供"仍然提交"选项（candidate self-submit after warning，不是 Proctor Force Submit）
6. flush 超时提示重试或"仍然提交"

### Explicit Non-goals

- 不修改 answer save protocol
- 不修改 submit 路由逻辑
- 不做断网恢复
- **不实现 Proctor Force Submit**（Phase2）

### Allowed Changes

- `apps/web/src/pages/exam/TakeExamPage.tsx`
- `apps/web/src/components/exam/SaveIndicator.tsx`
- 可能新增 `SubmitConfirmDialog.tsx`

### Forbidden Changes

- 禁止绕过 flush 直接 submit（除非用户选"仍然提交"）
- 禁止把这件事伪装成 UI 美化
- 禁止修改后端
- 禁止实现 Proctor Force Submit

### Acceptance Criteria

- [ ] 点击"交卷"时先 flush pending saves
- [ ] 确认对话框显示：未答/未保存/保存失败 题数
- [ ] 有保存失败时默认阻止，需二次确认
- [ ] flush 全部成功后发送 submit
- [ ] flush 超时后提示重试或"仍然提交"

### Required Tests

- `TakeExamPage.test.tsx` — flush 流程
- `SubmitConfirmDialog.test.tsx` — 状态测试

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
> Phase1.7 中拆分为 baseline/lite 版本，full 版本（sessionVersion full revocation 等）deferred 到 Phase2/1.8。

### Purpose

修复 JWT secret、logout 失效、timing-safe 登录、cookie 配置。

### Background

- JWT secret 硬编码 fallback `"development-only-change-me"` (session.ts:12)
- Logout 清 cookie 不能让 JWT 失效
- Cookie secure 用 `NODE_ENV` 而非 `COOKIE_SECURE`
- 登录 timing oracle
- `ctx.sessionId` 存完整 JWT

### Scope

1. **JWT secret**：去掉 fallback，所有环境启动时检查
2. **sessionVersion 方案**：
   - users 表增加 `sessionVersion INT DEFAULT 0`
   - JWT payload 携带 sessionVersion
   - auth plugin 验证时比对 DB sessionVersion
   - logout / password change / force reset 时递增 sessionVersion
   - 禁止声称"清 cookie 后旧 JWT 失效"
   - 禁止引入 Redis token blacklist
   - 禁止缩短 JWT 过期时间当作 logout
3. **Timing-safe 登录**：
   - 用户不存在时执行 dummy password verify
   - 错误用户名和错误密码返回相同 status + error shape
   - 测试中 mock verifyPassword 确认不存在路径也调 dummy verify
   - **禁止用 wall-clock 毫秒差做 CI 硬验收**
4. **Cookie**: `COOKIE_SECURE` 读 env
5. **sessionId**: 不存完整 JWT

### Explicit Non-goals

- 不引入 Redis
- 不实现 JWT refresh token

### Allowed Changes

- `packages/auth/src/session.ts`
- schema (sqlite.ts + pg.ts) — users 表加 sessionVersion
- `apps/api/src/routes/auth.ts`
- `apps/api/src/plugins/auth.ts`
- 新 migration

### Forbidden Changes

- 禁止引入 Redis
- 禁止 JWT secret 可预测

### Acceptance Criteria

- [ ] 未设 `JWT_SECRET` → 拒绝启动
- [ ] 用户不存在时也执行 dummy verify（mock 测试确认）
- [ ] 错误用户名/密码返回相同 status + error shape
- [ ] Logout 后旧 cookie 无法通过 `/api/auth/me`
- [ ] Password change 后旧 token 失效
- [ ] `COOKIE_SECURE=true` 时 cookie 有 secure flag

### Required Tests

- JWT secret 未设置 → 启动失败
- mock verifyPassword 确认 dummy verify 调用
- logout/password change 后 token 失效
- COOKIE_SECURE 切换

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

CSV 注入修复 + 安全 Header + Origin/Referer CSRF 校验。

### Background

- `escapeCSVValue()` 不处理 `=` `+` `-` `@` `\t` `\r`
- 无 CSP / HSTS / Permissions-Policy
- CSRF 仅靠 sameSite=strict

### Scope

1. **CSV 注入**：危险字符前缀 `'`
2. **安全 Header**：
   - CSP：production 无 `unsafe-eval`，dev 可为 Vite HMR 放松但不可进入 production
   - HSTS：仅 `COOKIE_SECURE=true`
   - Permissions-Policy
3. **CSRF Origin/Referer**：
   - 保留 sameSite=strict
   - Production: cookie-auth mutating API 无 Origin/Referer → 拒绝
   - Dev/test: 可在 `NODE_ENV=test/development` 下显式 bypass
   - Allowed origins 来自 `APP_ORIGIN` / `ALLOWED_ORIGINS`
   - Service-token API 不走 cookie，不在 Phase1.4 scope
   - 禁止把 sameSite=strict 单独当作完整 CSRF 防护
   - 禁止在 S09 验收时把未实现的 CSRF token 写成"已通过"
4. **XSS**：排查 `dangerouslySetInnerHTML`

### Explicit Non-goals

- 不引入 CSRF token 库
- 不做 XSS sanitization library

### Allowed Changes

- `packages/import-export/src/csv.ts`
- `apps/api/src/plugins/security.ts`
- `apps/api/src/plugins/csrf.ts` — 新建
- `apps/web/src/` — 排查

### Forbidden Changes

- 禁止 CSP 设为 `unsafe-inline` + `unsafe-eval`（production）
- 禁止 HSTS 在 HTTP 内网部署时强制启用

### Acceptance Criteria

- [ ] CSV `=CMD(...)` → `'=CMD(...)`
- [ ] Production CSP 无 `unsafe-eval`
- [ ] HTTPS 部署有 HSTS，HTTP 部署无 HSTS
- [ ] Production: mutating API 无 Origin/Referer → 拒绝
- [ ] Dev/test: bypass allowed under explicit NODE_ENV
- [ ] Allowed origins from env
- [ ] 无 `dangerouslySetInnerHTML`

### Required Tests

- `csv.test.ts`, `security-headers.test.ts`, `csrf-origin.test.ts`

### Required Docs / Screenshots

- 安全 header 配置说明

### Dependencies

无（可在基本 API plugin 稳定后开始）

### Estimated Duration

1 天

### Risk

Medium

---

## P1.4-S06: Audit Log Completion

> **状态：已迁移到 Phase1.7 (P1.7-S06-lite)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.7/security-completion-plan.md` 为准。
> Phase1.7 中完成 baseline（login/logout/audit-logs API），Proctor operation audit 留到 Phase2。

### Purpose

补齐审计事件，增加查询 API。

### Background

缺失：login.success/failure, logout, password.change, SuperAdmin 跨组织, 查询 API。

### Scope

1. 补齐事件
2. SuperAdmin 跨组织审计（targetOrganizationId 记入 metadata）
3. `GET /api/admin/audit-logs`（Admin/SuperAdmin only）

### Explicit Non-goals

- 不实现审计日志自动清理

### Allowed Changes

- `apps/api/src/routes/auth.ts`
- `apps/api/src/routes/audit.ts`
- `packages/contracts/src/audit.ts`

### Forbidden Changes

- 禁止记录密码明文
- 禁止 Candidate 查看审计
- 禁止审计 API 支持删除/修改

### Acceptance Criteria

- [ ] login.success/failure/logout/password.change 有审计
- [ ] SuperAdmin 跨组织操作有 targetOrganizationId
- [ ] `GET /api/admin/audit-logs` 返回分页结果
- [ ] Candidate 调用审计查询 → 403

### Required Tests

- `audit.test.ts`, `audit-api.test.ts`

### Required Docs / Screenshots

- 审计事件清单

### Dependencies

S01, S02

- login/logout/password audit 可独立实现
- cross-organization audit metadata 依赖 S01 tenant guard 和 S02 RBAC
- audit query API 需要 S02 RBAC 权限检查

### Estimated Duration

1 天

### Risk

Medium

---

## P1.4-S07: Password Policy + Account Security

> **状态：已迁移到 Phase1.7 (P1.7-S07-lite)**
> 本文档保留历史背景，当前执行以 `docs/archive/phase-1.7/security-completion-plan.md` 为准。
> Phase1.7 中拆分为 baseline/lite 版本（最小长度 8 + config 策略），full 版本（锁定、mustChangePassword 等）deferred 到 Phase2/1.8。

### Purpose

密码强度 + 账户锁定 + 首次改密。

### Background

当前：密码最小 6 字符，无锁定，无首次改密。

### Scope

1. 密码最小长度 8
2. `mustChangePassword` 字段
3. 5 次失败锁定 15 分钟
4. SuperAdmin 最后账号不可被永久锁死

### Explicit Non-goals

- 不实现 Candidate vs Admin 不同登录策略

### Allowed Changes

- `packages/contracts/src/auth.ts`, `user.ts`, `candidate.ts`
- schema (sqlite.ts + pg.ts)
- `apps/api/src/routes/auth.ts`
- 新 migration

### Forbidden Changes

- 禁止硬编码密码策略正则
- 禁止存储密码明文

### Acceptance Criteria

- [ ] 密码 < 8 → 拒绝
- [ ] 5 次失败 → 锁定 15 分钟
- [ ] 锁定后正确密码 → 仍拒绝
- [ ] 15 分钟后 → 可登录
- [ ] 首次登录未改密 → 403
- [ ] SuperAdmin 最后账号不被永久锁死

### Required Tests

- `auth.test.ts`：密码长度、锁定、首次改密

### Required Docs / Screenshots

- `docs/archive/phase-1.4/password-policy.md`

### Dependencies

A02

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

自动化安全测试覆盖 Phase1.3 全部场景。

### Background

S01-S07 的修改需要系统化验证。Phase1.3 安全清单的 26+ 场景必须自动化。

### Scope

- `tests/security/` 目录：
  - `unauthorized-access.test.ts` — P0 未授权 6 场景
  - `tenant-isolation.test.ts` — P0 跨组织 5 场景
  - `exam-protocol-security.test.ts` — P0 提交 5 场景
  - `xss-csrf-csv.test.ts` — P1 XSS 3 + CSRF 2 + CSV 2
  - `password-policy.test.ts` — P1 弱口令 3

### Explicit Non-goals

- 不修改生产代码来通过测试

### Allowed Changes

- 新建测试文件

### Forbidden Changes

- 禁止手动测试代替自动化
- 禁止降低安全标准

### Acceptance Criteria

- [ ] 26+ 场景有自动化测试
- [ ] `pnpm test` 包含所有安全测试
- [ ] SQLite 和 PG 都通过

### Required Tests

即为本 Job 产出。

### Required Docs / Screenshots

- Phase1.3 安全测试报告（自动化版）

### Dependencies

S01-S07, A04（红队测试必须跑 SQLite + PG）

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

最终安全验收。

### Background

S01-S08 完成后，确认 Phase1.3 全部检查项通过。

### Scope

- 执行 S08 自动化套件
- 手动补充验证
- 产出验收报告

### Explicit Non-goals

- 不新增测试

### Allowed Changes

- 文档更新

### Forbidden Changes

- 禁止手动勾选未测试项
- 禁止跳过 P0 检查项

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
