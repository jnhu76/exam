# Exam Phase 3 Plan

> Phase 3 目标：从 Phase 2 的"功能闭环"推进到真实考试运行时：
> 可授权、可审计、可监考、可评分、可证明提交、可运维诊断。

---

## 0. Current Status

> **Currency note (2026-07-01).** This table reflects the merged state on
> `master`. RBAC and Email foundation work has progressed well past the
> pre-migration snapshot described in earlier revisions; see §3 / §4 and
> `docs/phase3/rbac/RBAC-JOB-QUEUE.md` for per-job detail.

| Area | Status |
| ---- | ------ |
| Small Jobs (S1–S10) | **Completed.** 基线审计、文档 scaffold、grillme 问题清单已就位。 |
| Email Outbox Backend (M3) | **Completed (incl. M8 retry tests).** outbox 表、repo、3 senders (Disabled/Fake/Smtp)、retry policy、`EmailNotificationService`、`EmailOutboxService.processDueEmails`、`POST /api/email/test`、full test suite 均已合并。**Remaining real gap:** 无业务集成（no route 实例化 `EmailNotificationService`）、无常驻 worker daemon（`processDueEmails` 仅测试调用）、无 `users.email` 列、无密码重置/邀请流程。详见 `docs/phase3/emails/email.md` §Status。 |
| RBAC / Backend Permission Model | **Foundation merged; enforcement partial.** ADR + permission matrix accepted (PR #149)；M1–M9 + SYSTEM-M1 + AUDIT-M1/M2 + shadow mode 合并 (PR #149–#153)；`requireCapability` decorator + 11 routes flipped (proctor/grading/attempts-admin) + attempt/exam resolvers 实现并测试 (enforcement PRs)。**Remaining real gap:** scope resolvers 尚未接入请求生命周期 — 当前 `requireCapability` 只是 flat 6-role-preset 校验；~50 routes 仍在 legacy `requireRole`。详见 `docs/phase3/rbac/RBAC-JOB-QUEUE.md`。 |
| Frontend State Machine | **Deferred to Large Job.** ADR-009 已提出 (Proposed)，runtime integration 待 L4/L5/L13 结论。 |
| Exam Lifecycle State Model | **Not started.** 作为独立 Large Job 保留，不应被 ADR-009 覆盖。 |
| Answer Protocol v2 | **Not started.** 作为独立 Large Job 保留。 |
| 当前策略 | Middle Job 持续合 master；Large Job 只做设计和拆分；补齐 Large Job 全景图。 |

**核心原则：**

```text
Large Job 不直接施工。
Large Job 必须先 grillme / ADR / matrix / spec。
Large Job 完成设计后，再拆成 Middle Job 落地。
```

```text
RBAC 和 Frontend State Machine 都重要，但不应该独占 Phase 3 计划。
Answer Protocol、Final Barrier、Question Versioning、Exam Lifecycle 是更底层的考试正确性基础。
```

---

## 1. Phase 3 Strategy

| Job Size | Current Status | Usage |
| -------- | -------------- | ----- |
| **Small** | Completed baseline | 新 Large 需要事实审计时再新增 |
| **Middle** | Active implementation unit | 可以独立施工、测试、合并 |
| **Large** | Design backlog | 先 grillme / ADR / spec，再拆 Middle |

### Job size rules

- **Small Jobs** are low-risk documentation, audit, checklist, or narrow-scope fix tasks. They can be done at any time and merged quickly.
- **Middle Jobs** are bounded implementation units with clear scope, tests, and non-goals. They can be developed in a feature branch and merged to master independently.
- **Large Jobs** are architecture-heavy design units. They must NOT be directly implemented. Each Large Job must first produce an ADR, spec, permission matrix, or state diagram. Only after the design is accepted can it be拆成 Middle Jobs for implementation.

---

## 2. Completed Small Jobs

All Small Jobs from the initial Phase 3 batch are completed.

| ID | Job | Output | Status |
| -- | --- | ------ | ------ |
| S1 | Phase 3 README scaffold | `docs/phase3/README.md` (note: file not yet created; verify during closeout) | Completed |
| S2 | Phase 3 plan | `docs/phase3/plan.md` | Completed |
| S3 | Current role check audit | `docs/phase3/audit/audit-current-role-checks.md` | Completed |
| S4 | Current grading API audit | `docs/phase3/audit/audit-current-grading-api.md` | Completed |
| S5 | Current Redis usage audit | `docs/phase3/audit/audit-current-redis.md` | Completed |
| S6 | Current audit event map | `docs/phase3/audit/audit-current-events.md` | Completed |
| S7 | Current candidate runtime audit | `docs/phase3/audit/audit-current-candidate-runtime.md` | Completed |
| S8 | Current answer payload audit | `docs/phase3/audit/audit-current-answer-payload.md` | Completed |
| S9 | E2E parallelization constraints audit | `docs/phase3/audit/audit-e2e-parallelization.md` | Completed |
| S10 | Large grillme question list | `docs/phase3/grillme-question-list.md` | Completed |

Small Jobs are removed from the active execution queue. They will only be re-opened if a new Large Job requires a fresh fact-finding audit that the existing documents do not cover.

---

## 3. Completed / Mostly Completed Middle Jobs

| ID | Job | Status | Notes |
| -- | --- | ------ | ----- |
| M1 | Manual grading candidate-answer visibility | **Needs verification** | Grading detail page already shows candidate answer (`GradingDetailPage.tsx:209`). Verify if full scope (API contract + frontend rendering + tests) is complete. |
| M3 | Email outbox backend | **Completed** | Outbox table + migration, repo, 3 senders (Disabled/Fake/Smtp), retry policy, `sanitizeEmailError`, `EmailNotificationService`, `EmailOutboxService.processDueEmails`, `POST /api/email/test`, full test suite. See `docs/phase3/emails/email.md` §Status for remaining gaps (business integration, worker daemon, `users.email` column). |
| M8 | Email send failure retry tests | **Completed** | `apps/api/src/email/outboxService.test.ts` covers pending→sent / pending→retry / pending→failed at maxAttempts, single-failure-no-block, disabled-sender drains to sent, injected clock, secret-scrub into `lastError`. Also covered by `retryPolicy.test.ts`, `sanitizeError.test.ts`, `notificationService.test.ts`. |

Do not claim completion for items that have not been verified against the codebase. Use "Needs verification" for uncertain status.

---

## 4. Active Middle Job Backlog

These Middle Jobs remain actionable and can be developed independently.

| ID | Job | Current Recommendation |
| -- | --- | ---------------------- |
| M2 | Redis health / fallback / diagnostics | **Active.** Redis integration exists; verify health check and fallback coverage. |
| M4 | Audit / monitoring event expansion v0 | **Active.** First batch of Phase 3 events (grading, force-submit, email, Redis). |
| M5 | Diagnostics infrastructure status | **Active.** System diagnostics page should show Redis / email / worker status. (Email M3 is complete — this no longer depends on it; depends only on wiring the existing outbox/redis status into the diagnostics surface.) |
| M6 | Grading answer rendering tests | **Active.** Tests for candidate answer display in grading page. Depends on M1 verification. |
| M7 | Redis unavailable fallback tests | **Active.** Tests ensuring Redis failure does not corrupt PG authoritative state. |
| M9 | Proctor incident event logging v0 | **Active but scoped.** Lightweight incident recording only. Do NOT expand to full proctor authority. |
| M10 | CI / E2E parallelization readiness report | **Active.** Documentation task; no code changes. |
| M11 | Phase 3 readiness closeout report | **Deferred to batch closeout.** Generate after first Middle batch completes. |

> **Note on M8.** Email send failure retry tests are complete (see §3). M8 is
> removed from the active backlog. The next email-adjacent work is **not** a
> Middle Job under the current numbering — it is either (a) L15 Notification /
> Email Policy (Large, deferred) or (b) targeted business-integration /
> worker-daemon Middle Jobs to be defined when a real email trigger (password
> reset, invitation, result release) enters scope.

### Middle Job principles

- Each Middle Job must have clear scope, non-goals, required tests, and review standards.
- Middle Jobs should be merged to master independently; do not batch multiple Middle Jobs in one PR.
- Migration-only Middle Jobs (e.g., M3) must be merged on a separate branch to avoid migration conflicts.

---

## 5. Complete Large Job Queue

Large Jobs are architecture-heavy design units. They must NOT be directly implemented.

```text
Large Job 不直接施工。
Large Job 必须先 grillme / ADR / matrix / spec / state diagram。
Large Job 完成设计后，再拆成 Middle Job 落地。
```

| ID | Large Job | Status | Why Large | Expected Output |
| -- | --------- | ------ | --------- | --------------- |
| L1 | Teacher / Proctor / Grader Account Model | **Design accepted; foundation merged.** Account/role infrastructure (6-role `RoleKey`, `userRoleAssignments` table + repo + `roleAssignments.ts` API, `users.role` sync, frontend nav, SYSTEM actor) merged via PR #149–#153. Remaining work is enforcement refinement (resolver-wiring), tracked as Middle — not new Large design. | 账号、身份、角色、scope 关系复杂 | account model ADR |
| L2 | Backend Permission Model | **Design accepted; foundation merged; enforcement partial.** ADR + permission matrix accepted; catalog/presets/registry/shadow/scope-resolver-contract merged (M1–M6, AUDIT-M1/2). `requireCapability` flipped on 11 routes. **Open Middle work (not Large design):** wire scope resolvers into request path + flip remaining ~50 `requireRole` routes per-domain (RBAC-M10-finish, see `RBAC-JOB-QUEUE.md`). | 影响所有敏感 API，不能用简单 role string | permission matrix / RBAC ADR |
| L3 | Custom Role / Custom RBAC | Later | 极容易过度设计，Phase 3 只预留 | custom role ADR |
| L4 | Answer Protocol v2 | **Priority** | 影响保存、提交、评分、审计、前端状态机 | answer protocol spec |
| L5 | WYSIWYG Submit / Final Answer Barrier | **Priority** | 需要证明学生看到的最终答案等于后端冻结答案 | final barrier ADR |
| L6 | Frontend Exam State Machine | Deferred (ADR-009 started) | 涉及保存、提交、断线、恢复、deadline、force submit | state machine spec |
| L7 | Proctor Runtime Authority Boundary | **Priority** | 决定监考员能看什么、能操作什么、不能做什么 | proctor authority matrix |
| L8 | UI Design / Workbench UI Contract | Deferred | 影响整站视觉、组件语义、表格/表单/状态表达 | UI contract |
| L9 | Audit / Monitoring Full Event Taxonomy | **Priority** | 涉及追责、观测、隐私、事件分层 | event taxonomy ADR |
| L10 | E2E Full Parallelization Implementation | Later | 涉及 DB 隔离、seed 隔离、worker 隔离 | E2E isolation ADR |
| L11 | Subjective / Rich Text / Drawing Answer Architecture | **Priority** | 涉及主观题、富文本、画图、附件答案结构 | subjective answer ADR |
| L12 | Tenant / Organization / School Scope Model | **Priority** | 影响账号、权限、考试归属、数据隔离 | tenant scope ADR |
| L13 | Exam Lifecycle State Model | **Priority** | 定义 draft/published/open/closed/canceled/archived 合法流转 | lifecycle state ADR / diagram |
| L14 | Result Visibility / Release Policy | **Priority** | 影响成绩发布、复核、学生可见性 | result release policy ADR |
| L15 | Notification / Email Policy | New / Later | 邮箱后端完成后，需要决定触发规则、模板、隐私、重试策略 | notification policy ADR |
| L16 | Question Bank / Paper Versioning Model | **New / High Priority** | 决定发布后题目修改、试卷快照、评分版本依据 | paper versioning ADR |
| L17 | Import / Export / Bulk Operation Contract | New / Later | 涉及批量导入导出、错误报告、权限、审计 | import/export contract |
| L18 | Deployment / On-Prem Ops Contract | New / Later | LAN/on-premise 部署需要配置、备份、诊断、升级策略 | ops contract |
| L19 | Data Retention / Privacy / Audit Redaction | New / Later | 涉及答案、日志、邮件、审计记录保存和脱敏 | retention/privacy ADR |
| L20 | Reporting / Analytics / Score Statistics Model | New / Later | 成绩统计、报表、导出、排名策略 | reporting model ADR |

### Why L16 is high priority

Question Bank / Paper Versioning must be designed before Answer Protocol v2, because answer payloads must reference stable question and paper versions. Without versioning, answer snapshots and grading comparisons become ambiguous when questions are edited after exam publication.

### Why L13 is high priority

Exam Lifecycle State Model defines the legal state transitions for exams (draft → published → open → closed → canceled → archived). This is a prerequisite for Admin Exam Operation Machine (ADR-009 PR 5) and for Proctor authority boundary (L7). It must not be conflated with the frontend interaction state machine (L6).

### Why L15 is not current priority

Email backend / outbox infrastructure is already completed. L15 (Notification / Email Policy) becomes relevant only when the project is ready to define which events trigger emails, what templates are used, and what privacy constraints apply. This is a product policy decision, not a technical foundation.

---

## 6. Large Job Priority Groups

### Group A — Exam Correctness Foundation

These jobs define "what is the exam content, how answers are saved, what is frozen at final submission, how exam states flow, and when results become visible." They are the foundation for state machines, proctoring, grading, and auditing.

| ID | Large Job | Priority |
| -- | --------- | -------- |
| L16 | Question Bank / Paper Versioning Model | **1st** |
| L4 | Answer Protocol v2 | **2nd** |
| L5 | WYSIWYG Submit / Final Answer Barrier | **3rd** |
| L13 | Exam Lifecycle State Model | **4th** |
| L14 | Result Visibility / Release Policy | **5th** |

### Group B — Authority / Scope / Security Foundation

These jobs define "who can do what, in what scope." Custom RBAC is deferred; first stabilize built-in roles.

| ID | Large Job | Priority |
| -- | --------- | -------- |
| L12 | Tenant / Organization / School Scope Model | 6th |
| L1 | Teacher / Proctor / Grader Account Model | 7th |
| L2 | Backend Permission Model | 8th |
| L7 | Proctor Runtime Authority Boundary | 9th |
| L3 | Custom Role / Custom RBAC | Deferred |

### Group C — Runtime / Frontend / UI

Frontend State Machine depends on Answer Protocol, Final Barrier, and Exam Lifecycle conclusions. UI Contract can be designed in parallel but must not block exam correctness foundation.

| ID | Large Job | Priority |
| -- | --------- | -------- |
| L9 | Audit / Monitoring Full Event Taxonomy | 10th |
| L6 | Frontend Exam State Machine | 11th |
| L11 | Subjective / Rich Text / Drawing Answer Architecture | 12th |
| L8 | UI Design / Workbench UI Contract | Parallel |

### Group D — Ops / Scale / Productization

These jobs become relevant after the core exam correctness and authority foundations are stable.

| ID | Large Job | Priority |
| -- | --------- | -------- |
| L10 | E2E Full Parallelization Implementation | Later |
| L15 | Notification / Email Policy | Later |
| L17 | Import / Export / Bulk Operation Contract | Later |
| L18 | Deployment / On-Prem Ops Contract | Later |
| L19 | Data Retention / Privacy / Audit Redaction | Later |
| L20 | Reporting / Analytics / Score Statistics Model | Later |

---

## 7. Dependency Notes

```text
L16 Question Bank / Paper Versioning Model
  should be done BEFORE L4 Answer Protocol v2,
  because answer payloads must reference stable question/paper versions.
```

```text
L4 Answer Protocol v2
  is a prerequisite for L5 Final Barrier,
  because the final answer freeze mechanism depends on the answer payload contract.
```

```text
L6 Frontend Exam State Machine
  depends on L4 Answer Protocol v2,
  L5 Final Barrier,
  and L13 Exam Lifecycle State Model.
  ADR-009 is the adoption strategy; runtime integration waits for these conclusions.
```

```text
L7 Proctor Runtime Authority Boundary
  depends on L1 Account Model,
  L2 Backend Permission Model,
  and L13 Exam Lifecycle State Model.
```

```text
L14 Result Visibility / Release Policy
  depends on L13 Exam Lifecycle
  and interacts with L2 Permission Model.
```

```text
L11 Subjective / Rich Text / Drawing Answer Architecture
  depends on L4 Answer Protocol v2
  and L16 Paper Versioning.
```

```text
L15 Notification / Email Policy
  depends on completed Email Outbox backend (M3),
  L9 Event Taxonomy,
  and L14 Result Release Policy.
```

```text
L12 Tenant / Organization / School Scope Model
  is independent of Group A but must be designed before L1 Account Model
  and L2 Permission Model, because scope determines role boundaries.
```

---

## 8. Recommended Next Large Design Order

```text
 1. L16 Question Bank / Paper Versioning Model
 2. L4  Answer Protocol v2
 3. L5  WYSIWYG Submit / Final Answer Barrier
 4. L13 Exam Lifecycle State Model
 5. L14 Result Visibility / Release Policy
 6. L12 Tenant / Organization / School Scope Model
 7. L1  Teacher / Proctor / Grader Account Model
 8. L2  Backend Permission Model
 9. L7  Proctor Runtime Authority Boundary
10. L9  Audit / Monitoring Full Event Taxonomy
11. L6  Frontend Exam State Machine
12. L8  UI Design / Workbench UI Contract
```

**Rationale:**

- RBAC is important but does not need to be designed first. Exam correctness foundation (answer protocol, final barrier, lifecycle) must be solid before layering permission complexity on top.
- Frontend State Machine has ADR-009 (Proposed) but runtime integration depends on L4/L5/L13 conclusions. The adoption strategy is settled; the design inputs are not.
- Email backend is completed, so L15 is not a current Large priority unless notification policy becomes a product requirement.

---

## 9. Near-Term Execution Plan

### Track 1 — Middle Closeout

Continue merging determined Middle Jobs to master:

- M2 Redis health / fallback / diagnostics
- M4 Audit / monitoring event expansion v0
- M5 Diagnostics infrastructure status
- M6 Grading answer rendering tests
- M7 Redis unavailable fallback tests
- M8 Email send failure retry tests (if not yet verified)
- M9 Proctor incident event logging v0
- M10 CI / E2E parallelization readiness report
- M11 Phase 3 readiness closeout report (after first batch)

### Track 2 — Large Design (first wave)

Begin design for the Exam Correctness Foundation group:

1. L16 grillme / ADR — Question Bank / Paper Versioning
2. L4 + L5 grillme — Answer Protocol v2 + Final Barrier
3. L13 lifecycle state ADR — Exam Lifecycle State Model

### Track 3 — Large Design (second wave)

After Group A design stabilizes:

4. L12 grillme — Tenant / Scope Model
5. L1 grillme — Account Model
6. L2 permission matrix — Backend Permission Model
7. L7 proctor authority matrix — Proctor Runtime Authority

### Track 4 — Deferred Heavy Work

These are explicitly deferred and should not be started until the foundations above are designed:

- RBAC scope-resolver wiring (RBAC-M10-finish) — per-domain Middle Jobs; do NOT wire resolvers or flip remaining routes without a per-route plan (see `RBAC-JOB-QUEUE.md`)
- Frontend state machine runtime integration (ADR-009 PR 4)
- UI full redesign
- E2E full parallelization implementation
- Custom RBAC (L3)
- Notification / email policy (L15)
- Import/export contract (L17)
- Deployment ops contract (L18)
- Data retention / privacy (L19)
- Reporting / analytics (L20)

---

## 10. What Not To Do Next

- Do NOT wire RBAC scope resolvers into the request path or flip remaining `requireRole` routes without a per-domain RBAC-M10-finish plan. (The foundation — catalog, presets, registry, shadow, resolvers, 11 flipped routes — is merged; the remaining work is incremental enforcement, not a fresh start. See `docs/phase3/rbac/RBAC-JOB-QUEUE.md`.)
- Do NOT directly rewrite TakeExamPage or other exam pages.
- Do NOT introduce XState or other state machine libraries.
- Do NOT directly change the answer protocol without L4 design.
- Do NOT directly implement rich text / drawing answers without L11 design.
- Do NOT expand email backend into a complex notification system (no business integration / templates / worker daemon until L15 policy or a scoped Middle Job defines the trigger).
- Do NOT混入 Large Job 设计到 Middle PR 中. Each Middle Job must be independently scoped.
- Do NOT combine migration + frontend + state machine + permission in a single PR.
- Do NOT claim Exam Lifecycle State Model is covered by ADR-009. ADR-009 covers frontend interaction state machines only.

---

## 11. Plan Maintenance Rules

- **Large Job addition**: Any new Large Job must enter the L queue with a clear explanation of why it is Large (architecture-heavy, cross-cutting, or high-risk). Do not inflate Middle Jobs into Large Jobs.
- **Large Job implementation**: Large Jobs must NEVER be directly implemented. They must first produce an ADR, spec, matrix, or state diagram. Only after design acceptance can they be拆成 Middle Jobs.
- **Middle Job拆分**: When a Large Job design is accepted, it must be decomposed into Middle Jobs with clear scope, non-goals, and test requirements. Each derived Middle Job gets its own ID (e.g., M12, M13, ...).
- **Small Job re-open**: Small Jobs are only re-opened when a Large Job design phase reveals that a new fact-finding audit is needed and the existing audit documents are insufficient.
- **Completed job tracking**: Completed Middle Jobs must be moved to the "Completed / Mostly Completed" section. Do not leave them in the active backlog.
- **plan.md is the master plan**: Specific executable job cards belong in `docs/phase3/job-cards.md`. This document is the strategic overview, not the implementation spec.
- **Status updates**: When a Middle Job is merged, update this document's status tables within the same PR or the next PR.

---

## 12. ADR-009 Relationship

ADR-009 (`docs/adr/ADR-009-frontend-state-machine-adoption.md`) covers the **frontend interaction state machine adoption strategy**:

- Phase A-C: reducer + transition table + tests, no XState.
- Candidate Exam Machine is the first machine.
- Admin Exam Operation Machine is the second machine.
- Backend business state remains source of truth.

ADR-009 does **NOT** cover:

- Backend Exam Lifecycle State Model (this is L13).
- Backend Answer Protocol (this is L4).
- Backend Permission Model (this is L2).
- Frontend RBAC / route guards (this is L6 dependency on L1/L2).

L13 (Exam Lifecycle State Model) is a separate Large Job that defines the backend-side legal state transitions for exams. It must be designed independently from the frontend interaction state machine, though the frontend machine will consume the lifecycle states as read-only business state.
