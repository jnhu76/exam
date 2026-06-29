# Phase1.4 Overall Assessment

> 本文档是 `phase1.4-bridge-plan.md` 的概要视图。若发生冲突，以 bridge plan 为准。

---

## Current Verdict

**结论：Phase1.4 bridge plan 已完成，但执行文档必须与 bridge 收敛后才能开始代码实现。**

系统当前处于"能跑的 MVP"状态：本地 SQLite 开发环境下可完成注册→创建考试→发布→答题→交卷→查看成绩的完整闭环。但生产 Docker + PostgreSQL 链路不可用，安全边界不生效，考试协议有缺口。

---

## Why Phase1.4 Exists

Phase1–1.3 产出了 MVP，但留下了四类结构性债务：

1. **生产部署不可用** — PostgreSQL 链路从类型到运行时 crash
2. **安全边界不生效** — 多租户隔离、RBAC、认证会话都是空壳
3. **考试协议不闭环** — 服务端不拒绝超时提交，答案保存无事务
4. **UI 缺少产品基准** — 没有统一设计系统

如果不解决就直接进 Phase2，这些问题会被放大到监考、导出、集成等更复杂场景。

---

## What Phase1–1.3 Already Provided

| 领域 | 已完成 |
|------|--------|
| 考试闭环 | 完整的注册→创建→发布→答题→交卷→评分→查分流程 |
| 答案保存协议 | 版本化 + clientSeq 幂等 + baseVersion 冲突检测 |
| 服务端时间 | deadlineAt 在服务端计算 |
| 题目快照 | questionSnapshot 在 attempt 创建时冻结 |
| 状态机 | exam/attempt 状态通过 command 函数转换 |
| 自动评分 | 单选/多选/判断/填空 + 部分得分 |
| 审计日志基础 | CRUD + 考试操作 12 种 action |
| UI 页面 | Admin 16 页 + Candidate 5 页 |
| 多组织模型 | 11 张表含 organizationId |
| 密码哈希 | argon2id |

---

## What Still Blocks Phase2

| 阻塞项 | 严重性 | 依据 |
|--------|--------|------|
| PostgreSQL 生产环境 crash | Critical | 所有 repo 强类型 SqliteDatabase, `as unknown as` |
| 多租户隔离空壳 | Critical | tenant plugin 空函数, rbac.ts/tenantGuard.ts 不存在 |
| 权限系统不生效 | Critical | ctx.permissions 永远 [] |
| 超时提交不拒绝 | High | submitAttempt() 接受超时提交 |
| 答案保存无事务 | High | PG 并发写入丢数据 |
| JWT secret 硬编码 fallback | High | session.ts:12 |
| CSV 公式注入 | High | escapeCSVValue 不处理 = + - @ |
| 前端 submit 不 flush | High | 可能丢最后一笔答案 |
| Logout 不注销 JWT | Medium | 仅清 cookie |
| CI 无 PG 测试 | Medium | PG 回归无门禁 |

---

## Phase1.4 Allows

- 修复 PostgreSQL / Docker / Repository 不一致
- 实现多租户 tenant guard 和 RBAC 权限矩阵
- 修复考试协议服务端缺口（deadline 409 + 事务 + flush）
- 补齐安全基础（JWT sessionVersion, CSV, headers, Origin, 审计, 密码）
- 建立 UI Design System 基准 + 3 个样板页
- 创建自动化安全测试套件
- 编写 Redis / MQ ADR 文档
- schema 增加安全字段

### Public vs Protected Endpoints

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /api/health` | None | Public liveness. No sensitive data. |
| `GET /api/settings/branding` | None | Public branding. Resolved by slug. |
| `GET /api/system/health` | Required | Admin/SuperAdmin only. Candidate/Proctor → 403. |
| `GET /api/system/dashboard` | Required | Admin/SuperAdmin only. |

---

## Phase1.4 Forbids

- Proctor Panel / 监考面板
- Redis / WebSocket 代码（ADR 可以写）
- Proctor Force Submit / 延时 / 标记违规
- 自动提交超时试卷
- 随机组卷
- PDF / Excel async worker
- 外部系统集成
- UI 全站重写
- 大型 UI 框架 / 图表库 / 动画库
- 答案保存走 MQ
- 新 timing mode / voidAttempt / showResultImmediately
- Proctor 业务路由（枚举可定义，路由不新增）
- dark mode
- attempt_answers 拆表

---

## Corrected Job Summary

### Architecture (A00–A05)

| Job ID | Name | Risk | Duration | Depends On |
|--------|------|------|----------|------------|
| A00 | DB Reality Check Spike | Critical | 0.5d | - |
| A01 | DB Context / Repository Contract | Critical | 1d | A00 |
| A02 | Repository 双方言迁移 | Critical | 2d | A01 |
| A03 | Docker + PostgreSQL Smoke Test | High | 1d | A02 |
| A04 | CI PostgreSQL Gate | Medium | 1d | A02 |
| A05 | Redis / MQ ADR | Low | 0.5d | - |

### Security (S01–S09)

| Job ID | Name | Risk | Duration | Depends On |
|--------|------|------|----------|------------|
| S01 | Multi-Tenant Isolation / Tenant Guard | Critical | 2d | A02 |
| S02 | RBAC Permission Matrix | High | 2d | A02, S01 |
| S03a | Server-side Exam Protocol | High | 1.5d | A02 |
| S03b | Client Submit Flush Protocol | High | 1d | S03a |
| S04 | Auth Session Security | Medium | 1.5d | A02 |
| S05 | CSV + Security Headers + CSRF Origin | Medium | 1d | - |
| S06 | Audit Log Completion | Medium | 1d | S01, S02 |
| S07 | Password Policy + Account Security | Medium | 1d | A02 |
| S08 | Red-Team Security Test Suite | High | 2d | S01-S07, A04 |
| S09 | Phase1.3 Security Validation | High | 1d | S08 |

### UI (U01–U04)

| Job ID | Name | Risk | Duration | Depends On |
|--------|------|------|----------|------------|
| U01 | UI Design System Baseline | Medium | 1d | - |
| U02 | Admin Dashboard Sample | Medium | 1.5d | U01 |
| U03 | Exam Detail Sample | Medium | 1.5d | U01 |
| U04 | Take Exam Sample | Medium | 1.5d | U01 |

### Validation (V01)

| Job ID | Name | Risk | Duration | Depends On |
|--------|------|------|----------|------------|
| V01 | Phase2 Entry Gate Check | High | 0.5d | All |

---

## Recommended Execution Order

```
Wave 0 (Spike + Contract, serial, blocks all)
  A00 → A01 → A02 → A03
                    → A04 (parallel with Wave 1)
  A05 (any time)

Wave 1 (Security boundary, serial after A02)
  A02 → S01 → S02
  A02 → S03a → S03b

Wave 2 (Security hardening, parallel)
  A02 → S04 — parallel
  S01+S02 → S06 — parallel
  S05 — parallel
  S07 — parallel

Wave 3 (UI, parallel with Wave 1-2)
  U01 → U02 — parallel
       → U03 — parallel
       → U04 — parallel

Wave 4 (Validation, last)
  S01-S07 + A04 → S08 → S09 → V01
```

---

## Minimum Viable Phase1.4

**P0 Immediate**:
- A00 → A01 → A02 (PostgreSQL 不可用阻塞一切)
- A03 (生产部署不可用)

**P0 Before Phase2**:
- A04 (CI PG Gate — Phase2 Entry Gate 要求 CI PG 通过)
- S01, S02, S03a, S03b, S04 (安全边界)
- S08 (安全测试)
- V01 (门禁)

**可延后**:
- A05 (纯文档), S05 (CSV+Headers), S06 (审计), S07 (密码)
- U01-U04 (UI 不阻塞 Phase2 功能但影响产品体验)

**P0 最小集预估**: ~9 个工作日

---

## Phase2 Entry Gate Summary

Phase2 can start only if:

- [ ] Docker + PostgreSQL smoke test passes
- [ ] SQLite test suite passes
- [ ] PostgreSQL CI job passes (A04 completed)
- [ ] No `as unknown as` / `as any` in repo layer
- [ ] Tenant isolation tests pass
- [ ] RBAC matrix tests pass
- [ ] Deadline → 409, submit flush works
- [ ] Auth session: JWT secret mandatory, sessionVersion, timing-safe
- [ ] CSV / headers / Origin tests pass
- [ ] Audit log tests pass
- [ ] Password policy tests pass
- [ ] Phase1.3 P0/P1/P2 all pass
- [ ] UI screenshots accepted (Dashboard, Exam Detail, Take Exam)
- [ ] Redis / MQ ADR accepted
- [ ] No Phase2 functionality implemented early
- [ ] `pnpm verify` passes
