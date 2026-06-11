# Phase 1.7 — Security Completion / Account & Browser Security Baseline

**日期**: 2026-06-11
**前置**: Phase1.5 / Phase1.6 完成
**定位**: Phase1 最终安全收口层，承接 Phase1.4 中暂停的安全 Job
**核心原则**: 拆分为 baseline / full 两层，避免再次破坏 seed、登录态、前端流程和开发体验

---

## Why Phase1.7 Exists

Phase1.4 原计划完成 S01–S09 全部安全 Job，但实际执行中发现：

1. 安全 Job 全量并行会严重干扰 seed、登录态、前端流程和开发体验
2. S04（Auth Session Security）、S07（Password Policy）的 full 实现（sessionVersion 完整失效链、mustChangePassword、首次登录强制改密、账户锁定）与开发/测试效率冲突
3. S08/S09 如果要求覆盖 full S04/S07 才能验收，会导致验收标准无法达成
4. 必须先有稳定的 PostgreSQL-only 基础（Phase1.5/1.6），才能在可信基础上完成剩余安全验证

Phase1.7 的目标：
- 完成 S03b（Client Submit Flush Protocol）— 这是考试协议前端半部分，必须在 Phase2 前完成
- 完成 S04–S07 的 **baseline/lite** 版本，建立安全基线但不阻塞开发体验
- 将 S04–S07 的 **full** 版本 deferred 到 Phase2 安全加固或 Phase1.8 独立安全阶段
- 完成 S08-lite / S09-lite，作为 Phase1.7 安全 baseline validation，不要求覆盖 full S04/S07

---

## Key Decision

```text
Phase1.7 不做全量安全重写。

Phase1.7 做 baseline：
- JWT_SECRET production fallback removed
- COOKIE_SECURE env-based
- sessionId 不存完整 JWT
- login failure error shape unified
- dummy password verify mock test
- CSV injection escape
- security headers (CSP, HSTS conditional, Permissions-Policy)
- Origin/Referer CSRF check (aligned with dev/test/proxy)
- login.success / login.failure / logout audit
- SuperAdmin cross-org metadata
- GET /api/admin/audit-logs
- Candidate 403 on audit
- 密码最小长度 8
- seed 密码全部 >= 8
- 密码策略从 config 读取
- red-team baseline suite
- Phase1.7 security baseline validation

Phase1.7 不做 full：
- sessionVersion full revocation（logout 后旧 JWT 服务端失效、password change 后旧 token 全部失效、force reset 后旧 token 全部失效）
- 5 次失败锁定 15 分钟
- mustChangePassword
- 首次登录强制改密
- 最后 SuperAdmin 不被永久锁死
- Phase1.3 P0/P1/P2 全量通过（除非 full S04/S07 也已完成）
```

---

## Phase1.7 Scope

### P1.7-S03b: Client Submit Flush Protocol

**定位**: 考试协议前端半部分，必须在 Phase2 前完成。

**目标**:
- submit 前 flush 所有 pending saves
- 等待所有 save promise settled
- 提交确认对话框显示：未答题数、未保存题数、保存失败题数
- 有保存失败时默认阻止提交，需用户二次确认
- flush 超时提示重试或"仍然提交"

**验收**:
- [ ] 点击"交卷"时先 flush pending saves
- [ ] 确认对话框显示：未答/未保存/保存失败 题数
- [ ] 有保存失败时默认阻止，需二次确认
- [ ] flush 全部成功后发送 submit
- [ ] flush 超时后提示重试或"仍然提交"

**风险**: High — 考试协议完整性

**依赖**: S03a（server-side deadline + transaction）已在 Phase1.4/1.6 完成

---

### P1.7-S04-lite: Auth Session Security Baseline

**做（baseline）**:
- [ ] JWT_SECRET production fallback removed
- [ ] COOKIE_SECURE env-based
- [ ] sessionId 不存完整 JWT
- [ ] login failure error shape unified
- [ ] dummy password verify mock test

**暂缓（full，deferred to Phase2/1.8）**:
- [ ] sessionVersion full revocation
- [ ] logout 后旧 JWT 服务端失效
- [ ] password change 后旧 token 全部失效
- [ ] force reset 后旧 token 全部失效

**原因**: sessionVersion 完整链需要 schema migration + 所有 auth 路径改造，容易破坏 seed 和开发登录态。baseline 先移除硬编码 secret 和修复基础问题。

---

### P1.7-S05-lite: CSV Injection + Security Headers + CSRF Origin Check

**做（baseline）**:
- [ ] CSV injection escape（`=` `+` `-` `@` `\t` `\r` 前缀 `'`）
- [ ] security headers（CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy）
- [ ] production CSP 不含 `unsafe-eval`
- [ ] HSTS 只在 secure/HTTPS 配置下启用
- [ ] dangerouslySetInnerHTML 排查

**Origin/Referer CSRF**:
- [ ] 可以做，但必须和 dev/test/proxy 配置明确对齐
- [ ] Production: cookie-auth mutating API 无 Origin/Referer → 拒绝
- [ ] Dev/test: 可在 `NODE_ENV=test/development` 下显式 bypass
- [ ] Allowed origins 来自 `APP_ORIGIN` / `ALLOWED_ORIGINS` env

---

### P1.7-S06-lite: Audit Log Completion Baseline

**做（baseline）**:
- [ ] login.success audit
- [ ] login.failure audit
- [ ] logout audit
- [ ] SuperAdmin cross-org metadata（`targetOrganizationId` 记入 metadata）
- [ ] `GET /api/admin/audit-logs`（Admin/SuperAdmin only，分页 + action 过滤）
- [ ] Candidate 403 on audit query

**暂缓（Phase2）**:
- [ ] Proctor operation audit（force submit / extend time / mark misconduct）
- [ ] Audit log auto-cleanup
- [ ] Audit log export

---

### P1.7-S07-lite: Password Policy + Account Security Baseline

**做（baseline）**:
- [ ] 新建用户 / 重置密码最小长度 8
- [ ] seed 密码全部 >= 8
- [ ] 密码策略从 config 读取
- [ ] password policy docs

**暂缓（full，deferred to Phase2/1.8）**:
- [ ] 5 次失败锁定 15 分钟
- [ ] mustChangePassword
- [ ] 首次登录强制改密
- [ ] 最后 SuperAdmin 不被永久锁死

**原因**: 账户锁定和 mustChangePassword 会严重干扰 seed 数据、测试登录态、开发体验。baseline 先提高最小长度和统一策略配置。

---

### P1.7-S08-lite: Red-Team Security Test Suite Baseline

**定位**: red-team baseline suite，不要求覆盖 full S04/S07。

**目标**:
- `tests/security/` 目录，覆盖 baseline 安全场景：
  - `unauthorized-access.test.ts` — 未授权访问 baseline
  - `tenant-isolation.test.ts` — 跨组织隔离 baseline
  - `exam-protocol-security.test.ts` — 考生提交 baseline（deadline 409, submit idempotency）
  - `xss-csrf-csv.test.ts` — XSS 排查 + CSV escape + security headers
  - `password-policy.test.ts` — 最小长度 8 + config 策略
  - `auth-session-baseline.test.ts` — JWT secret fallback removed + dummy verify + cookie secure

**验收**:
- [ ] baseline 场景有自动化测试
- [ ] `pnpm test` 包含所有安全测试
- [ ] PG-only 下通过

**依赖**: S01-S07-lite, A04（CI PG Gate）

---

### P1.7-S09-lite: Phase1.7 Security Baseline Validation

**定位**: Phase1.7 最终验收，不是 Phase1.3 全量复测。

**目标**:
- 执行 S08-lite 自动化套件
- 手动补充验证无法自动化的场景
- 产出验收报告

**验收**:
- [ ] S01 tenant isolation complete
- [ ] S02 RBAC matrix complete
- [ ] S03a server-side exam protocol complete
- [ ] S03b submit flush complete
- [ ] S04-lite baseline complete（JWT secret, cookie secure, dummy verify, sessionId）
- [ ] S05-lite baseline complete（CSV escape, security headers, CSP）
- [ ] S06-lite baseline complete（login/logout audit, audit-logs API）
- [ ] S07-lite baseline complete（min length 8, seed password, config policy）
- [ ] S08-lite red-team baseline suite pass
- [ ] `pnpm verify` pass

**明确不做**:
- [ ] 不要求 Phase1.3 P0/P1/P2 全量通过（除非 full S04/S07 也已完成）
- [ ] 不要求 sessionVersion full revocation 验收
- [ ] 不要求账户锁定验收
- [ ] 不要求 mustChangePassword 验收

---

## Phase1.7 Non-goals

Phase1.7 **明确不**实现以下功能：

- [ ] 不实现 Proctor Panel / 监考面板
- [ ] 不实现 Redis / WebSocket 实现
- [ ] 不实现强制交卷 / 延时 / 标记违规
- [ ] 不实现自动提交超时试卷
- [ ] 不实现随机组卷
- [ ] 不实现 PDF / Excel async worker
- [ ] 不实现外部系统集成 / Pass Gate API / Service Token
- [ ] 不实现新的 timing mode（timed_sync / deadline / untimed）
- [ ] 不实现 `voidAttempt()` 命令
- [ ] 不实现 `showResultImmediately` 服务端检查
- [ ] 不拆 `attempt_answers` 表
- [ ] 不恢复 SQLite correctness backend
- [ ] 不做 UI 样板页（U01-U04 已归 Phase1.4）

---

## Phase1.7 Acceptance Criteria

Phase1.7 完成时必须满足：

- [ ] S03b submit flush complete
- [ ] S04-lite auth session baseline complete
- [ ] S05-lite CSV + security headers + CSRF baseline complete
- [ ] S06-lite audit baseline complete
- [ ] S07-lite password policy baseline complete
- [ ] S08-lite red-team baseline suite pass
- [ ] S09-lite security baseline validation pass
- [ ] PG integration tests pass
- [ ] `pnpm verify` pass

---

## Phase1.7 Dependencies

### Blocking

- Phase1.4: S01, S02, S03a 必须已完成
- Phase1.5: PostgreSQL-only convergence 必须已完成
- Phase1.6: PostgreSQL correctness hardening 必须已完成

### Blocks

- **Phase2 Entry Gate**: Phase2 必须依赖 Phase1.7 security baseline

---

## Handoff Notes to Phase2

Phase1.7 完成后，Phase2 可以安全地假设：

- tenant guard 已生效
- RBAC 权限矩阵已生效
- 考试协议（S03a + S03b）已闭环
- 审计日志 baseline 已建立
- CSV / security header baseline 已建立
- 账号 / session baseline 已建立
- 密码策略 baseline 已建立（最小长度 8，config 驱动）

Phase2 自己负责的安全内容：

- [ ] Proctor operation audit
- [ ] force submit permission
- [ ] extend time permission
- [ ] mark misconduct permission
- [ ] WebSocket auth
- [ ] WebSocket organization scope
- [ ] service token / API key security
- [ ] export access control
- [ ] integration audit

Phase2 或 Phase1.8 负责的 full 安全内容：

- [ ] sessionVersion full revocation
- [ ] logout 后旧 JWT 服务端失效
- [ ] password change 后旧 token 全部失效
- [ ] force reset 后旧 token 全部失效
- [ ] 5 次失败锁定 15 分钟
- [ ] mustChangePassword
- [ ] 首次登录强制改密
- [ ] 最后 SuperAdmin 不被永久锁死
