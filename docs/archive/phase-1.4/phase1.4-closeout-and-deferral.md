# Phase 1.4 Closeout & Deferral

**日期**: 2026-06-11
**定位**: Phase1.4 当前状态记录与剩余工作移交

---

## Phase1.4 当前状态：Partial Closeout

Phase1.4 原计划完成 Architecture Jobs A00-A05、Security Jobs S01-S09、UI Jobs U01-U04、Validation V01。

经最新决策校准后，Phase1.4 的当前状态为 **partial closeout**：

### 已完成 / 作为基础收口完成

| Job | 状态 | 说明 |
|-----|------|------|
| S01 Multi-Tenant Isolation / Tenant Guard | 已完成或基础完成 | tenant guard 插件生效，组织隔离真实可用 |
| S02 RBAC Permission Matrix | 已完成或基础完成 | 22 个权限生效，ctx.permissions 不再为空 |
| S03a Server-side Exam Protocol Hardening | 已完成或基础完成 | deadline 强制 409，submit 幂等，基础状态机保护 |
| U01 UI Design System Baseline | 继续归属 Phase1.4 | 共享常量 + ErrorBoundary + semantic token |
| U02 Admin Dashboard Sample | 继续归属 Phase1.4 | Dashboard 样板页 |
| U03 Exam Detail Sample | 继续归属 Phase1.4 | Exam Detail 样板页 |
| U04 Take Exam Sample | 继续归属 Phase1.4 | Take Exam 视觉样板 |

### 从 Phase1.4 迁移出的 Job

| Job | 原归属 | 新归属 | 迁移原因 |
|-----|--------|--------|----------|
| S03b Client Submit Flush Protocol | Phase1.4 | **Phase1.7** | 考试协议完整性，需在 PG-only 基础上完成 |
| S04 Auth Session Security | Phase1.4 | **Phase1.7 (S04-lite)** | 全量实现破坏 seed/登录态/开发体验，拆 baseline/full |
| S05 CSV Injection + Security Headers + CSRF | Phase1.4 | **Phase1.7 (S05-lite)** | 可归入 security baseline，但需与 dev/test/proxy 配置对齐 |
| S06 Audit Log Completion | Phase1.4 | **Phase1.7 (S06-lite)** | 基础审计先完成，Proctor operation audit 留 Phase2 |
| S07 Password Policy + Account Security | Phase1.4 | **Phase1.7 (S07-lite)** | 全量实现破坏 seed/测试登录态，拆 baseline/full |
| S08 Red-Team Security Test Suite | Phase1.4 | **Phase1.7 (S08-lite)** | 从 full S04/S07 覆盖改为 baseline validation |
| S09 Phase1.3 Security Validation | Phase1.4 | **Phase1.7 (S09-lite)** | 从 Phase1.3 全量通过改为 Phase1.7 baseline validation |
| A00-A03, A05 | Phase1.4 | **Phase1.5/1.6** | PostgreSQL-only convergence 和 correctness hardening 独立成阶段 |
| A04 CI PostgreSQL Gate | Phase1.4 | **Phase1.5/1.6** | CI PG 切换归入 PG-only 收敛阶段 |
| V01 Phase2 Entry Gate Check | Phase1.4 | **Phase1.7** | 最终门禁在 Phase1.7 完成后执行 |

---

## 明确声明

### Phase1.4 仍包含

- UI Jobs U01-U04
- S01 Multi-Tenant Isolation
- S02 RBAC Permission Matrix
- S03a Server-side Exam Protocol Hardening

### Phase1.4 不包含

- Phase1.5 / Phase1.6 的数据库拆分工作
- S03b-S09 安全 Job（已迁移到 Phase1.7）

### Phase1.4 不继续完成所有安全 Job

剩余安全 Job（S03b-S09）已在 Phase1.7 重新编排为 baseline/full 两层，避免再次破坏 seed、登录态、前端流程和开发体验。

---

## 各阶段新边界

```text
Phase1.4 = Release Hardening / 基础收口层
  ├─ S01 多租户隔离
  ├─ S02 RBAC 权限矩阵
  ├─ S03a 服务端考试协议硬化
  ├─ U01 UI 设计系统基准
  ├─ U02 Admin Dashboard 样板
  ├─ U03 Exam Detail 样板
  └─ U04 Take Exam 样板

Phase1.5 = PostgreSQL-only database convergence / remove SQLite correctness backend

Phase1.6 = PostgreSQL-only correctness hardening / PG transaction, seed, migration, CI, concurrency verification

Phase1.7 = Security Completion / Account & Browser Security Baseline
  ├─ S03b Client Submit Flush Protocol
  ├─ S04-lite Auth Session Security Baseline
  ├─ S05-lite CSV + Security Headers + CSRF Baseline
  ├─ S06-lite Audit Log Baseline
  ├─ S07-lite Password Policy Baseline
  ├─ S08-lite Red-Team Baseline Suite
  └─ S09-lite Phase1.7 Security Baseline Validation

Phase2 = Exam Operation / Proctor Panel / Exam Flexibility / Integration Export
```

---

## 历史背景保留说明

本文档仅调整 Phase 归属、状态、依赖和 Entry Gate，不删除原始 Job 的历史背景。

原始 Job Cards 中的以下历史背景仍然有效：

- S01: `plugins/tenant.ts:6-10` 空函数历史
- S02: `ctx.permissions` 永远 `[]` 的历史
- S03a: `submitAttempt()` 不拒绝超时提交的历史
- S03b: `TakeExamPage.tsx` submit 不等待 pending saves 的历史
- S04: JWT secret 硬编码 fallback 的历史
- S05: CSV 公式注入漏洞历史
- S06: 登录/登出/失败无审计的历史
- S07: 密码最小长度 6 的历史
- S08/S09: Phase1.3 安全清单未执行的历史

这些历史背景在原始文档（`phase1.4-bridge-plan.md`、`03-security-jobs.md`）中保留，仅供追溯。当前执行以 Phase1.7 的 baseline/lite 定义为准。

---

## 已知风险

1. **S03b 延迟到 Phase1.7**：考试协议前端半部分（submit flush）在 Phase1.4 不完成，意味着 Phase1.4 的 UI U04 只完成视觉样板，不完成协议行为。最终 Take Exam 体验需等 Phase1.7 S03b 完成后才能完整验收。

2. **S04/S07 baseline/full 拆分**：Phase1.7 完成后，sessionVersion full revocation、账户锁定、mustChangePassword 仍未实现。这些必须在 Phase2 或 Phase1.8 补充。

3. **Phase2 Entry Gate 降低要求**：不再要求完整 S04/S07/S08/S09，但要求 Phase1.7 baseline 完成。Phase2 启动时需清楚知道哪些安全能力尚未 full 实现。
