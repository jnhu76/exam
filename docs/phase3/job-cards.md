# Exam Phase 3 — Small / Middle Job Cards

> 本文档只包含可直接施工或可验证收口的 Small / Middle Job。
> Small Job baseline 已完成。
> Large Job 不在本文档展开，详见 `docs/phase3/plan.md` 和 `docs/phase3/job-cards-large.md`。

---

## Current Status

> **Currency note (2026-07-01).** Status refreshed against merged `master` state.
> RBAC and Email foundation work has progressed past earlier revisions; see
> `docs/phase3/plan.md` §0/§3/§4 and `docs/phase3/rbac/RBAC-JOB-QUEUE.md` for
> per-job detail.

| Area | Status | Notes |
| ---- | ------ | ----- |
| Small Jobs (S1–S10) | **Completed baseline** | S1–S10 已作为 Phase 3 事实审计和 scaffold 基线完成 |
| Email backend / outbox | **Completed (M3 + M8)** | M3 outbox foundation + M8 retry tests both merged. Remaining (not yet scoped as jobs): business integration, worker daemon, `users.email` column — see `docs/phase3/emails/email.md` §Status |
| RBAC | **Foundation merged; enforcement partial** | ADR + permission matrix accepted; M1–M9 + SYSTEM-M1 + shadow merged (PR #149–#153); 11 routes flipped to `requireCapability`. Open work = RBAC-M10-finish (resolver wiring + ~50 remaining route flips) — tracked in `docs/phase3/rbac/RBAC-JOB-QUEUE.md`, not redefined here |
| Frontend State Machine | **Deferred Large / ADR started** | ADR-009 Proposed；runtime integration 待 L4/L5/L13 结论 |
| Large Jobs | **Design backlog** | 单独维护；详见 `docs/phase3/plan.md` §5 |

---

# 0. Current Boundary

## What this batch allows

* Documentation scaffold and audit (completed)
* Localized real-gap fixes (e.g., M1 grading answer visibility)
* Infrastructure closeout (Redis diagnostics, email retry tests, audit events)
* Test补齐
* No changes to core product models

## What this batch forbids

* Do NOT implement full backend permission model
* Do NOT implement teacher / proctor / grader account model
* Do NOT implement custom RBAC
* Do NOT implement answer protocol v2
* Do NOT implement WYSIWYG final answer barrier
* Do NOT rewrite frontend exam state machine
* Do NOT redo UI system
* Do NOT define complete proctor runtime authority boundary
* Do NOT silently implement any Large Job decision
* Do NOT redefine RBAC in Small/Middle scope — RBAC enters this document ONLY as Derived Middle Jobs拆自 ADR / permission matrix design

---

# 1. Completed Small Job Cards

All Small Jobs from the initial Phase 3 batch are completed. They are retained here as a record and for closeout verification.

| ID | Job | Status | Output |
| -- | --- | ------ | ------ |
| S1 | Phase 3 README Scaffold | Completed baseline | `docs/phase3/README.md` (verify path during closeout) |
| S2 | Phase 3 Plan Document | Completed baseline | `docs/phase3/plan.md` |
| S3 | Current Role Check Audit | Completed baseline | `docs/phase3/audit/audit-current-role-checks.md` |
| S4 | Current Grading API Audit | Completed baseline | `docs/phase3/audit/audit-current-grading-api.md` |
| S5 | Current Redis Usage Audit | Completed baseline | `docs/phase3/audit/audit-current-redis.md` |
| S6 | Current Audit / Monitoring Event Map | Completed baseline | `docs/phase3/audit/audit-current-events.md` |
| S7 | Current Candidate Runtime Audit | Completed baseline | `docs/phase3/audit/audit-current-candidate-runtime.md` |
| S8 | Current Answer Payload Audit | Completed baseline | `docs/phase3/audit/audit-current-answer-payload.md` |
| S9 | E2E Parallelization Constraints Audit | Completed baseline | `docs/phase3/audit/audit-e2e-parallelization.md` |
| S10 | Large Grillme Question List | Completed baseline | `docs/phase3/grillme-question-list.md` |

Small Jobs are removed from the active execution queue. They will only be re-opened if a new Large Job design phase reveals a fact-finding audit need that existing documents do not cover.

---

# 2. Middle Job Status Overview

| ID | Job | Status | Recommendation |
| -- | --- | ------ | -------------- |
| M1 | Manual grading candidate-answer visibility | **Verify needed** | GradingDetailPage already renders candidate answer; verify if full scope (API + frontend + tests) is complete |
| M2 | Redis health / fallback / diagnostics | **Active** | Redis integration exists; verify health check and fallback test coverage |
| M3 | Email outbox backend | **Completed** | Outbox table + migration, repo, 3 senders, retry policy, `sanitizeEmailError`, `EmailNotificationService`, `EmailOutboxService`, `POST /api/email/test`, full test suite. Remaining gaps (not M3 scope): business integration, worker daemon, `users.email`. See `docs/phase3/emails/email.md` §Status |
| M4 | Audit / monitoring event expansion v0 | **Active** | First batch of Phase 3 events |
| M5 | Diagnostics infrastructure status | **Active** | System diagnostics page should show Redis / email / worker status |
| M6 | Grading answer rendering tests | **Active** | Tests for candidate answer display in grading page |
| M7 | Redis unavailable fallback tests | **Deferred (N/A Phase 1)** | Audit found Redis is diagnostics-only; "PG state unaffected by Redis failure" holds by construction. See `docs/phase3/audit/audit-redis-fallback-guard-m7.md`. Re-open when Redis gains exam-state responsibility. |
| M8 | Email send failure retry tests | **Completed** | `apps/api/src/email/outboxService.test.ts` + `retryPolicy.test.ts` + `sanitizeError.test.ts` + `notificationService.test.ts` cover pending→sent/retry/failed, single-failure-no-block, disabled no-op, injected clock, secret-scrub into `lastError` |
| M9 | Proctor incident event logging v0 | **Active** | Lightweight incident recording only; scoped to not expand into full proctor authority |
| M10 | CI / E2E parallelization readiness report | **Active** | Documentation task only |
| M11 | Phase 3 readiness closeout report | **Closeout only** | Generate after first Middle batch completes |

### Status definitions

- **Completed**: Work is done and merged.
- **Backend done**: Backend infrastructure is implemented; remaining work is tests / diagnostics / verification only.
- **Active**: Can be developed in a feature branch and merged independently.
- **Verify needed**: Work may already be complete; verify against codebase before starting new implementation.
- **Deferred**: Blocked on Large Job design or other dependency.
- **Closeout only**: Report-generation task; run after other items complete.

---

# 3. Middle Job Cards

---

## M1 — Manual Grading Candidate-Answer Visibility

### Type

Middle

### Current Status

**Verify needed.** `GradingDetailPage.tsx` already renders `candidateAnswer` (line 209). Verify that the full scope — API contract, frontend rendering, empty-state handling, and tests — is complete. If complete, move to completed status.

### Goal

修复真实评分缺口：授权评分员在评分详情页必须能看到考生答案。

### Scope

* contract response 增加 candidate answer 字段
* API route / service 查询 candidate answer
* grading detail page 渲染 candidate answer
* 对空答案 / 未作答有明确 UI
* tests 覆盖 authorized grading detail access
* 不记录敏感 answer 内容到日志

### Non-goals

* 不实现完整 grader 权限模型
* 不实现 answer protocol v2
* 不实现 WYSIWYG submit barrier
* 不改变评分流程
* 不改变 proctor 权限

### Required Tests

* contract/schema test: `candidateAnswer` field exists
* API test: authorized grader can access candidate answer
* API test: empty answer returns empty state, not 500
* frontend test: grading page displays candidate answer

### Suggested Validation

```bash
pnpm --filter @exam/contracts test
pnpm --filter @exam/api test -- grading
pnpm --filter @exam/web test -- grading
pnpm verify
```

---

## M2 — Redis Health / Fallback / Diagnostics

### Type

Middle

### Current Status

**Active.** Redis integration exists in the codebase. Verify health check endpoint and fallback behavior coverage.

### Goal

打通 Redis 运行态基础设施：健康检查、不可用 fallback、诊断页展示。

### Scope

* Redis health check
* Redis unavailable fallback
* diagnostics 输出 Redis 状态
* Redis connection error 不导致核心考试状态损坏
* 文档说明 Redis 只做 runtime cache
* tests 覆盖 Redis unavailable

### Non-goals

* 不把 attempt status 放 Redis
* 不把 final answer 放 Redis
* 不把 score 放 Redis
* 不把 audit log 放 Redis
* 不引入复杂 Redis topology
* 不实现完整 presence 系统

### Required Behavior

Redis 不可用时：

* 核心 API 不应错误修改 PG 状态
* 可以降级 skip runtime cache
* diagnostics 应显示 degraded / unavailable
* 测试环境没有 Redis 时，相关测试应明确 skip 或使用 fake

### Required Tests

* Redis health check success / unavailable
* Redis unavailable 不影响 PG authoritative flow
* diagnostics response 包含 Redis 状态

### Suggested Validation

```bash
pnpm --filter @exam/api test -- redis
pnpm --filter @exam/api test -- diagnostics
pnpm verify
```

---

## M3 — Email Outbox Backend Closeout

### Type

Middle

### Current Status

**Completed.** The full M3 scope is delivered and merged: `email_outbox` table +
migration, `EmailOutboxRepo`, 3 senders (Disabled/Fake/Smtp), retry policy,
`sanitizeEmailError`, `EmailNotificationService`, `EmailOutboxService.processDueEmails`,
`POST /api/email/test`, and the complete test suite (incl. M8 retry tests). This
card is retained as a record. **Remaining gaps are NOT M3 scope** — they are
future work (business integration, worker daemon, `users.email` column); see
`docs/phase3/emails/email.md` §Status.

### Goal

Close out the email outbox backend: verify retry behavior, diagnostics visibility, and worker status. Do NOT re-implement the outbox backend.

### Scope

Verification and closeout only:

* Verify M8 email retry tests exist and pass
* Verify diagnostics page shows email worker status
* Verify email outbox events are captured in audit/monitoring
* Document email outbox behavior for future L15 Notification Policy

### Non-goals

* Do NOT re-create email_outbox table (already exists)
* Do NOT re-implement EmailOutboxRepo / EmailOutboxService (already exists)
* Do NOT re-implement worker skeleton (already exists)
* Do NOT do complex mail template system
* Do NOT do multi-tenant sender config
* Do NOT do email UI
* Do NOT接真实 SMTP 强依赖
* Do NOT do delivery analytics
* Do NOT change core exam transactions

### Migration Note

Original M3 migration was merged separately. No new migration needed for closeout.

### Required Tests

Closeout verification — confirm these exist:

* worker sends pending email via fake sender
* success marks sent
* failure marks failed or retry scheduled
* email failure does not rollback business transaction
* config disabled → worker safe no-op

### Suggested Validation

```bash
pnpm --filter @exam/db test -- email
pnpm --filter @exam/api test -- email
pnpm --filter @exam/api test -- outbox
pnpm verify
```

---

## M4 — Audit / Monitoring Event Expansion v0

### Type

Middle

### Current Status

**Active.** Can be developed in a feature branch.

### Goal

补齐 Phase 3 第一批必要事件，为评分、Redis、Email、监考事件提供审计和观测基础。

### Scope

新增或整理事件：

Audit events:

* `grading.detail_viewed`
* `grading.score_submitted`
* `attempt.force_submitted`
* `proctor.incident_marked`
* `email.outbox_created`

Monitoring events:

* `redis.unavailable`
* `redis.recovered`
* `email.send_failed`
* `email.send_retried`
* `email.worker_unavailable`
* `diagnostics.health_checked`

### Non-goals

* 不设计完整 event taxonomy (this is L9)
* 不改 audit log 表大结构
* 不记录答案正文
* 不做监控平台
* 不做指标 dashboard

### Required Privacy Rule

事件中不得写入：candidate answer content, password, token, secret, raw email content, sensitive headers.

允许记录：actorId, candidateId, attemptId, examId, event type, timestamp, traceId, status/reason code.

### Required Tests

* grading score submit 产生 audit event
* email outbox created 产生 audit event
* Redis unavailable 产生 monitoring event
* sensitive content 不进入 audit payload

### Suggested Validation

```bash
pnpm --filter @exam/api test -- audit
pnpm --filter @exam/api test -- diagnostics
pnpm --filter @exam/api test -- grading
pnpm verify
```

---

## M5 — Diagnostics Infrastructure Status

### Type

Middle

### Current Status

**Active.** System diagnostics page exists. Verify it shows Redis / email / worker status.

### Goal

让系统诊断页能看到 Phase 3 基础设施状态：Redis、worker、email outbox。

### Scope

* diagnostics API 返回 Redis 状态
* diagnostics API 返回 email outbox / worker 状态
* 前端 diagnostics 页面展示基础设施状态
* degraded / unavailable 有明确文案
* tests 覆盖 response 和 UI

### Non-goals

* 不做完整 observability 平台
* 不引入 Grafana / Prometheus
* 不做实时推送
* 不做复杂告警系统

### Required Tests

* diagnostics response schema test
* API test: Redis unavailable 显示 degraded
* API test: email disabled 显示 disabled
* UI test: 基础设施状态可见

### Suggested Validation

```bash
pnpm --filter @exam/contracts test -- diagnostics
pnpm --filter @exam/api test -- diagnostics
pnpm --filter @exam/web test -- diagnostics
pnpm verify
```

---

## M6 — Grading Answer Rendering Tests

### Type

Middle

### Current Status

**Active.** Tests for candidate answer display in grading page. **Note:** L4 (Answer Protocol v2) will change the answer schema. M6 tests current answer rendering and may need a revisit pass after L4 is designed. This does not block M6 — proceed now, revisit after L4.

### Goal

专门补评分页 candidate answer 渲染测试，避免 M1 只是 API 有字段但 UI 没展示。

### Scope

补测试：

* short text answer 渲染
* empty answer 空态
* long answer 展示
* JSON answer 安全展示
* 不使用 unsafe HTML 渲染

### Non-goals

* 不改后端 API
* 不改 answer protocol
* 不做 rich text renderer
* 不做完整主观题架构

### Required Tests

* candidate answer visible
* empty answer state visible
* answer content does not execute HTML/script
* page still shows score input

### Suggested Validation

```bash
pnpm --filter @exam/web test -- grading
pnpm verify
```

---

## M7 — Redis Unavailable Fallback Tests

### Type

Middle

### Current Status

**Deferred (N/A for Phase 1).** Full audit in
`docs/phase3/audit/audit-redis-fallback-guard-m7.md` found Redis is
diagnostics-only (one read-only `ping()`); no exam-state code path reads or
writes Redis, so "PG state unaffected by Redis failure" holds **by
construction**, not by test. Existing candidate tests already run Redis-absent.
Writing vacuous "Redis-disabled candidate flow" tests would satisfy the old card
textually but prove nothing new.

**Re-open when** Redis gains any heartbeat / presence / rate-limit-store /
exam-state responsibility (see audit §8 revisit triggers).

### Goal

专门补 Redis 不可用时的 fallback 测试，避免后续 Redis 接入破坏考试一致性。

### Scope

补测试：

* Redis client connect failed
* presence write failed
* heartbeat cache failed
* rate limit fallback
* diagnostics degraded
* core PG state unaffected

### Non-goals

* 不新增 Redis 功能
* 不改变业务状态机
* 不把 Redis 接入 answer / score / final submit

### Required Tests

* Redis unavailable 不导致 start/resume/save/submit 权威状态损坏
* Redis unavailable 时 diagnostics 可见
* fallback 有日志或 monitoring event

### Suggested Validation

```bash
pnpm --filter @exam/api test -- redis
pnpm --filter @exam/api test -- candidate
pnpm verify
```

---

## M8 — Email Send Failure Retry Tests

### Type

Middle

### Current Status

**Completed.** Retry / failure behavior is fully tested in
`apps/api/src/email/outboxService.test.ts` (pending→sent, pending→retry with
backoff, pending→failed at maxAttempts, single-failure-no-block, disabled sender
drains to sent, injected clock, secret-scrub into `lastError`), plus
`retryPolicy.test.ts` (exponential backoff determinism),
`sanitizeError.test.ts` (password/pass/bearer scrubbing), and
`notificationService.test.ts` (`enqueueBestEffort` swallows errors; audit row
persists when outbox write fails). No further work under M8.

### Goal

验证 email outbox 的失败和重试行为，保证邮箱基础设施不会影响主业务。

### Scope

补测试：

* fake sender success
* fake sender failure
* retry count 增加
* last error 记录
* next retry time 更新
* disabled config no-op
* 业务事务不 rollback

### Non-goals

* 不接真实 SMTP
* 不做邮件模板
* 不做 UI
* 不做 delivery analytics
* 不重新实现 outbox backend (already done)

### Required Tests

* pending → sent
* pending → failed / retry scheduled
* failure does not rollback business transaction
* disabled email worker does not throw

### Suggested Validation

```bash
pnpm --filter @exam/api test -- email
pnpm --filter @exam/db test -- email
pnpm verify
```

---

## M9 — Proctor Incident Event Logging v0

### Type

Middle

### Current Status

**Active.** Lightweight incident recording only.

### Goal

先实现轻量级监考异常事件记录，为后续完整 proctor authority boundary 做准备。

### Scope

* proctor incident event 类型
* API 或 service 层记录 incident
* audit event 写入
* 不记录答案正文
* tests 覆盖 incident created

可能事件：

* `suspicious_behavior_marked`
* `network_issue_marked`
* `identity_check_failed`
* `manual_note_added`

### Non-goals

* 不定义完整 proctor 权限模型 (this is L7)
* 不实现 force submit 权限边界
* 不实现 proctor dashboard 重构
* 不影响成绩判定
* 不做作弊裁决流程

### Required Tests

* authorized existing proctor/admin path can create incident
* incident 写入 audit
* incident 不包含答案正文
* invalid incident type rejected

### Suggested Validation

```bash
pnpm --filter @exam/api test -- proctor
pnpm --filter @exam/api test -- audit
pnpm verify
```

---

## M10 — CI / E2E Parallelization Readiness Report

### Type

Middle

### Current Status

**Active.** Documentation task only; no code changes.

### Goal

生成可执行的 E2E 并行化准备报告，为后续 Large E2E implementation 决策提供依据。

### Scope

输出 `docs/phase3/e2e-parallelization-readiness-report.md`，内容包括：

* 当前 workers=1 的原因
* spec 文件共享数据矩阵
* candidate / attempt 冲突矩阵
* 可并行 spec 候选
* 必须串行 spec 列表
* 方案 A / B / C
* 推荐路线
* 风险和测试成本

### Non-goals

* 不改 Playwright workers
* 不改 seed
* 不改 DB lifecycle
* 不让 CI 直接并行

### Acceptance Criteria

* 报告能支撑后续 Large grillme / ADR
* 明确哪些 spec 写共享 attempt
* 明确推荐路线
* 不改变代码行为

### Suggested Validation

```bash
git diff -- docs/phase3/e2e-parallelization-readiness-report.md
```

---

## M11 — Phase 3 Readiness Closeout Report

### Type

Middle

### Current Status

**Closeout only.** Generate after first Middle batch completes.

### Goal

在完成第一批 Small / Middle 后，生成 Phase 3 进入 Large grillme 的基线报告。

### Scope

输出 `docs/phase3/readiness-closeout-report.md`，内容包括：

* 已完成 Small Job
* 已完成 Middle Job
* 未完成 Middle Job
* 当前真实缺口
* Large Job 输入材料
* 风险清单
* 下一批推荐任务

### Non-goals

* 不声称 Phase 3 完成
* 不做代码修改
* 不替代 Large ADR

### Acceptance Criteria

* grading candidate answer visibility 状态
* Redis diagnostics 状态
* email outbox 状态
* audit event expansion 状态
* E2E parallelization 状态
* Large grillme 准备度

### Suggested Validation

```bash
git diff -- docs/phase3/readiness-closeout-report.md
```

---

# 4. Current Recommended Middle Execution

## Track A — Middle Closeout

Items that are verification / closeout oriented:

1. **M8** Email Send Failure Retry Tests — **completed** (see card)
2. **M5** Diagnostics Infrastructure Status — especially email / worker / Redis visibility
3. **M7** Redis Unavailable Fallback Tests — **deferred (N/A Phase 1)**; see `audit/audit-redis-fallback-guard-m7.md`
4. **M6** Grading Answer Rendering Tests
5. **M11** Phase 3 Readiness Closeout Report — generate after Track A items complete

## Track B — Still Active Functional Middle

Items that are new implementation or active development:

1. **M1** Manual Grading Candidate-Answer Visibility — verify first; if complete, skip
2. **M2** Redis Health / Fallback / Diagnostics — verify first; if complete, skip
3. **M4** Audit / Monitoring Event Expansion v0
4. **M9** Proctor Incident Event Logging v0 — scoped to lightweight only
5. **M10** CI / E2E Parallelization Readiness Report

### Notes

- Track A items are lower risk and can be merged quickly.
- Track B items require more implementation but are still bounded Middle Jobs.
- Do not start any Track B item before verifying whether it is already complete.
- M11 should be the last item in this batch, after all other Middle Jobs are merged or verified.

---

# 5. Relationship to Large Jobs

```text
This document does not define Large Job architecture.
Large Jobs are tracked in `docs/phase3/plan.md` and `docs/phase3/job-cards-large.md`.
No Middle Job may silently implement a Large Job decision.
```

### Forbidden scope creep

The following boundaries must not be crossed in any Middle Job:

* **M1 / M6**: Do NOT implement answer protocol v2 (that is L4)
* **M2 / M7**: Do NOT make Redis an authoritative state source (Redis is runtime cache only)
* **M3 / M8**: Do NOT implement full notification policy (that is L15). M3 + M8 are complete; business integration / worker daemon are separate future jobs, not M3 closeout.
* **M4 / M9**: Do NOT implement full audit event taxonomy or proctor authority (those are L9 / L7)
* **M10**: Do NOT directly start E2E parallelization implementation (that is L10)
* **Any Middle**: Do NOT wire RBAC scope resolvers or flip remaining `requireRole` routes without a per-domain RBAC-M10-finish plan — the foundation is merged; remaining work is incremental enforcement tracked in `docs/phase3/rbac/RBAC-JOB-QUEUE.md` ("Current real gap")
* **Any Middle**: Do NOT directly rewrite TakeExamPage state machine (that is L6)

### RBAC entry rule

RBAC design (ADR + permission matrix) is **accepted** and the **foundation is merged**
(catalog/presets/registry/shadow/resolvers/M7-M9/SYSTEM-M1 + 11 flipped routes,
PR #149–#153 + enforcement series). This Small / Middle document does NOT redefine
RBAC. The remaining RBAC work — **RBAC-M10-finish** (wire scope resolvers into the
`requireCapability` request path; flip the remaining ~50 `requireRole` routes
per-domain) — is tracked in `docs/phase3/rbac/RBAC-JOB-QUEUE.md` and enters this
document only as explicitly-scoped per-domain Middle Jobs (e.g. "flip `user.*`
routes", "wire attempt-scope into candidate-runtime routes"), each behind shadow
parity for that domain. No Middle Job may silently add role checks, permission
guards, or RBAC-related migrations outside that tracker.

### What Middle Jobs CAN do

* Close out已完成 backend infrastructure (e.g., M3 email outbox)
* Add targeted tests for existing functionality (e.g., M6, M7, M8)
* Expand event coverage within the existing audit schema (e.g., M4)
* Generate readiness / status reports (e.g., M10, M11)
* Fix localized real gaps (e.g., M1 grading answer visibility)
* Record lightweight incidents without authority changes (e.g., M9)

### Middle Job → Large Job Dependency Analysis

**No Middle Job is blocked by L16/L4/L5/L13/L14.** All 11 Middle Jobs can proceed immediately. One caveat:

| Middle Job | Related Large | Risk | Action |
| ---------- | ------------- | ---- | ------ |
| M6 Grading rendering tests | L4 Answer Protocol | L4 changes answer schema; M6 tests may need update | Do now; revisit after L4 |

All other Middle Jobs (M1–M5, M7–M11) have no dependency on the Top 5 Large design tasks.
