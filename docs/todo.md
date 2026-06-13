# TODO

## Phase 1 Follow-ups

- [ ] Remove the remaining explicit `any` annotations from API route handlers and keep RF-009 architecture checks green.
- [ ] Add interaction tests for the expanded Job 4 management dialogs, candidate CSV preview-confirm flow, and Job 5 list/detail controls.
- [ ] Split the Web production bundle by route or feature to remove the Vite chunk-size warning (`536.77 kB` main JavaScript chunk after J7). The current production build succeeds; treat this as a Phase 1 release-polish item.
- [ ] Expand Job 6 page-level interaction tests for `ExamListPage`, `StartExamPage`, and `TakeExamPage`. Component coverage already exists for `QuestionNav`, `ExamTimer`, and `TrueFalseInput`; add end-to-end page behavior around queue polling, per-question auto-save, restore, and submit confirmation.
- [ ] **Repo 统一重构**：`userRepo.findByOrganizationAndUsername` 和 `findByOrganizationAndId` 不接收 `ctx`，违反 AGENTS.md "所有 repo 方法必须接收 ctx" 规则。当前导入循环已改用预加载 Set 规避，但其他调用点仍使用旧签名。需统一改为 `findByUsername(ctx, username)` 模式并更新所有调用方。
- [ ] **前端 detectDuplicate 防御性加固**：当前依赖后端 `validateCandidateFields` 强制恰好一个 unique 字段。如果后续放宽此约束，前端应遍历所有 unique 字段而非只取第一个。低优先级，待 CandidateField 规则变更时再处理。

## Phase 1.7 — Exam Lifecycle Non-E2E Closeout

> 详细范围：`docs/phase1.7/exam-lifecycle-non-e2e-closeout.md`
>
> 本轮已完成的文档/契约对齐：heartbeat `204 → 200 + { ok: true }`、save-answer 拒绝响应迁移到稳定 `reason` 枚举 + 扁平结构、ghost states 文档化（不删 enum）。E2E 区域不在本轮范围。
>
> 已归入 Phase 2 backlog 的事项：disrupted 前端 restore UI（P2A-J3 / P2A-J4 前置条件）、score list 提前开放控制、admin 手动 open/close 按钮（Phase 2C）。
>
> **Restore 可达性判定（Phase 1.7 复核）**：`disrupted` 状态在真实流程中可达——后台心跳扫描（`apps/api/src/plugins/heartbeat.ts`，`HEARTBEAT_TIMEOUT_MS` 默认 60s）会将长时间无 `lastActivityAt` 的 `in_progress` attempt 标记为 `disrupted`；后端 `POST /attempts/:id/restore` 端点已实现（`disrupted → in_progress`）。但前端 Phase 1.7 不接入 restore UI：`TakeExamPage` 对非 `in_progress` 状态直接跳转 ResultPage，`/restore` 端点无前端调用方。**结论：前端 restore 路径留 Phase 2 接入（不补 UI、不补 e2e），仅保留后端契约与文档标注。**


## Phase 1.4 — Release Hardening / 基础收口层

> 详细范围：`docs/phase1.4/phase1.4-bridge-plan.md`
>
> 当前状态：Partial Closeout。S01/S02/S03a 和 U01-U04 仍归属 Phase1.4。S03b-S09 已迁移到 Phase1.7。数据库收敛工作（原 A00-A04）已迁移到 Phase1.5/1.6。

### S01 — Multi-Tenant Isolation / Tenant Guard

- [x] tenant guard 插件生效，组织隔离真实可用

### S02 — RBAC Permission Matrix

- [x] 22 个权限生效，ctx.permissions 不再为空

### S03a — Server-side Exam Protocol Hardening (Phase1.4 部分)

- [x] deadline 后禁止继续保存答案（save-answer 返回 `DEADLINE_EXCEEDED`），但允许提交服务器已保存答案（submit 不受 deadline 限制）
- [x] submit 幂等（in_progress/disrupted→submitted；submitted→retry grading；graded→幂等返回）
- [x] 基础状态机保护

> S03a 的事务硬化部分（saveAnswers transaction boundary、attempt-level serialization、PG concurrency tests）已迁移到 Phase1.6。

### U01 — UI Design System Baseline

- [ ] 共享常量 + ErrorBoundary + semantic token

### U02 — Admin Dashboard Sample

- [ ] Dashboard 样板页

### U03 — Exam Detail Sample

- [ ] Exam Detail 样板页

### U04 — Take Exam Sample

- [ ] Take Exam 视觉样板

### 从 Phase1.4 迁移出的 Job（仅供参考）

| Job | 新归属 | 说明 |
|-----|--------|------|
| S03b Client Submit Flush Protocol | Phase1.7 | 考试协议前端半部分 |
| S04 Auth Session Security | Phase1.7 (S04-lite) | baseline/full 拆分 |
| S05 CSV Injection + Security Headers + CSRF | Phase1.7 (S05-lite) | baseline |
| S06 Audit Log Completion | Phase1.7 (S06-lite) | Proctor audit 留 Phase2 |
| S07 Password Policy + Account Security | Phase1.7 (S07-lite) | baseline/full 拆分 |
| S08 Red-Team Security Test Suite | Phase1.7 (S08-lite) | baseline validation |
| S09 Phase1.3 Security Validation | Phase1.7 (S09-lite) | baseline validation |
| A00-A03, A05 | Phase1.5/1.6 | PostgreSQL-only convergence |
| A04 CI PostgreSQL Gate | Phase1.5/1.6 | CI PG 切换 |
| V01 Phase2 Entry Gate Check | Phase1.7 | 最终门禁 |

## Phase 1.5 — PostgreSQL-only Database Convergence

> 详细范围：`docs/phase1.5/jobs.md`
>
> 定位：将项目数据库运行时、测试环境、CI 环境统一收敛到 PostgreSQL，为 Phase1.6 的事务硬化和 Phase2 的并发控制提供可信基础。

### P1.5-A01 — PostgreSQL Baseline

- [ ] 确定目标 PostgreSQL 版本（推荐 PostgreSQL 18）
- [ ] 更新 `docker-compose.yml` 使用固定版本标签
- [ ] 更新 `docker-compose.test.yml` 使用相同 PG 版本
- [ ] 更新 `.github/workflows/ci.yml` 使用相同 PG 版本
- [ ] 更新 Dockerfile 使用相同 PG 版本
- [ ] 更新文档声明数据库版本策略
- [ ] 验证 migration 可在空 PG 数据库上完整运行
- [ ] 验证 dev / test / production 使用一致的数据库名称

### P1.5-A02 — Remove SQLite Test Backend

- [ ] 审查所有 repository tests，识别哪些需要保留为 integration test
- [ ] 审查所有 API integration tests，识别哪些需要迁移到 PG
- [ ] 审查所有 transaction / locking / concurrency tests，迁移到 PG
- [ ] 为 pure unit tests 创建 fake repository 或 in-memory object
- [ ] 删除或废弃 SQLite-specific test setup
- [ ] 更新 CI 配置，移除 SQLite test service

### P1.5-A03 — ORM Dialect Simplification

- [ ] 审查所有 exam 相关 SQLite 特判
- [ ] 移除或重构 SQLite-specific repository 逻辑
- [ ] 收敛 ORM 配置到 PostgreSQL dialect
- [ ] 收敛 test setup 到 PostgreSQL
- [ ] 移除或重构 schema 双文件同步
- [ ] 验证所有 PG integration tests 通过

### P1.5-A04 — Database Command Standardization

- [ ] 审查现有 package.json 脚本
- [ ] 确定统一的 database 命名（`pnpm db:up`、`pnpm db:down`、`pnpm db:reset`、`pnpm db:migrate`、`pnpm db:seed`、`pnpm test:pg`）
- [ ] 更新 package.json 脚本
- [ ] 确保 dev / test database 隔离
- [ ] 更新 README.md 或开发文档说明 database 命令

### P1.5-A05 — PG-only Integration Test Gate

- [ ] 审查所有 PG integration tests
- [ ] 确认 `pnpm test` 通过（所有 tests 都使用 PG 或 fake repo）
- [ ] 确认 `pnpm test:pg` 或等价命令通过
- [ ] 更新 CI 配置，确保 CI 会启动 PostgreSQL
- [ ] 更新 Phase2 entry gate 文档，明确依赖 PG integration tests

## Phase 1.6 — PostgreSQL Correctness Hardening

> 详细范围：`docs/phase1.6/jobs.md`
>
> 定位：在 Phase1.5 完成的 PostgreSQL-only 基础上，完成 S03a 的考试协议事务硬化。

### P1.6-S03a-1 — Deadline Error Code Convergence

- [ ] 审查所有 deadline 相关错误码
- [ ] 统一为 `ATTEMPT_DEADLINE_EXCEEDED`（409 Conflict）
- [ ] 更新 domain errors 定义
- [ ] 更新 contracts schemas
- [ ] 更新 route handlers
- [ ] 更新 tests
- [ ] 验证错误码一致性

### P1.6-S03a-2 — saveAnswers PostgreSQL Transaction Boundary

- [ ] 审查 saveAnswers 的调用链
- [ ] 重构 saveAnswers，将 read → merge/compute → write 放在同一个 `db.transaction()` 内
- [ ] 确保 route 不直接裸写 repository
- [ ] Command/service 层负责 transaction boundary
- [ ] 修改 repository 方法签名，支持 tx client 参数
- [ ] 添加 `findByIdForUpdate` 等 repository 方法（`SELECT ... FOR UPDATE`）
- [ ] 更新 tests
- [ ] 验证 transaction 边界正确

### P1.6-S03a-3 — saveAnswers and submitAttempt Attempt-level Serialization

- [ ] 选择 serialization strategy（推荐 row-level lock / `SELECT ... FOR UPDATE`）
- [ ] 确保 saveAnswers 和 submitAttempt 使用相同的 serialization strategy
- [ ] 在 graded/submitted 状态下拒绝 save
- [ ] 防止 submit 后旧 save 覆盖答案
- [ ] 防止 grading 使用的答案与最终保存答案不一致
- [ ] 更新 tests
- [ ] 验证 serialization 正确

### P1.6-S03a-4 — PostgreSQL Concurrency Tests

- [ ] 设计并发测试策略（barrier、delayed repository、transaction lock、controlled interleaving）
- [ ] 实现 saveAnswers rollback 测试
- [ ] 实现 graded/submitted 后 save 被拒绝测试
- [ ] 实现 concurrent save + submit 不损坏数据测试
- [ ] 实现 submit 使用的答案与事务提交顺序一致测试
- [ ] 确保测试可靠（不 flaky）
- [ ] 验证所有 PG integration tests 通过

### P1.6-S03a-5 — Phase1.3 P0 Student Submit Scenario Regression

- [ ] 复测正常考生提交场景（答题 → 保存答案 → submit → graded/submitted）
- [ ] 确认 graded/submitted 状态符合既有预期
- [ ] 确认 deadline 新逻辑不误伤正常提交（`now <= deadlineAt`）
- [ ] 运行现有 Phase1.3 smoke tests
- [ ] 运行现有 Phase1.3 integration tests
- [ ] 验证所有 tests 通过

## Phase 1.7 — Security Completion / Account & Browser Security Baseline

> 定位：将 Phase1.4 迁移出的安全 Job 重新编排为 baseline/full 两层。
>
> 详细范围：`docs/phase1.4/phase1.4-closeout-and-deferral.md`

### S03b — Client Submit Flush Protocol

- [ ] 实现 submit 前 flush pending saves
- [ ] 确保 submit 时等待所有 pending save 完成

### S04-lite — Auth Session Security Baseline

- [ ] JWT secret fallback removed
- [ ] Cookie secure 配置
- [ ] Dummy verify baseline

### S05-lite — CSV + Security Headers + CSRF Baseline

- [ ] CSV 公式注入防护
- [ ] Security headers baseline
- [ ] CSRF baseline

### S06-lite — Audit Log Baseline

- [ ] 登录/登出/失败审计
- [ ] 基础审计日志 API

### S07-lite — Password Policy Baseline

- [ ] 最小长度 8，config 驱动
- [ ] 密码策略 baseline

### S08-lite — Red-Team Baseline Suite

- [ ] Baseline security validation

### S09-lite — Phase1.7 Security Baseline Validation

- [ ] Phase1.7 安全基线验证

### V01 — Phase2 Entry Gate Check

- [ ] Phase1.7 全部完成后执行最终门禁，验证 Phase 2 Entry Criteria 全部满足

## Phase 2 — Exam Operation / Proctor Panel / Exam Flexibility / Integration Export

> 详细范围：`docs/phase2/phase2.plan.md`
>
> Phase 2 只能在 Phase 1.4 + 1.5 + 1.6 + 1.7 完成后启动。

### Phase 2 Entry Criteria

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
- [ ] pnpm verify pass

### Phase 2A — Exam Operation

| Job    | 名称                 | 状态   |
| ------ | -------------------- | ------ |
| P2A-J1 | ExamRoom 管理        | 待开始 |
| P2A-J2 | IP 限制              | 待开始 |
| P2A-J3 | Attempt Heartbeat    | 待开始 |
| P2A-J4 | disrupted 检测与恢复 | 待开始 |
| P2A-J5 | Proctor Operations   | 待开始 |
| P2A-J6 | AuditLog 扩展        | 待开始 |

> **入场前提（来自 Phase 1.7 closeout）**：P2A-J3 与 P2A-J4 是 disrupted 状态在生产真实启用前的硬前置条件。后端心跳扫描器（`apps/api/src/plugins/heartbeat.ts`）与 restore 路由（`apps/api/src/routes/attempts.ts:892-930`）已存在，缺失项是前端 restore UI 与监考介入入口。详见 `docs/phase1.7/exam-lifecycle-non-e2e-closeout.md` §2.1。
>
> **P2A-J3 Attempt Heartbeat — 验收口径**
>
> - 前端在 attempt 进入 `disrupted` 时显示 restore 入口（不是直接跳结果页）。
> - 前端调用既有后端 restore 路由（POST `/attempts/:attemptId/restore`），成功后从服务端拉取最新答案与剩余时间，恢复到 `in_progress`。
> - 心跳超时阈值（默认 60s）/ 扫描周期（默认 30s）至少做一次基于真实考场场景的调参评估，结论落入 `docs/phase2/` 对应文档。
> - 单元测试与组件测试覆盖：disrupted → restore → in_progress 的前端状态切换；心跳超时阈值的服务端边界测试。
>
> **P2A-J4 disrupted 检测与恢复 — 验收口径**
>
> - 在监考面板（属 P2B）或临时 admin 入口提供"恢复某 attempt"操作，写入 AuditLog。
> - 给出"误标 disrupted"场景下的人工裁决流程，并落到 SPEC.md 监考职责段。
> - 端到端验证一次：候考人离线 → disrupted → 监考介入恢复 → 候考人继续答题 → 提交并出分。
>
> 完成上述两项后再讨论是否在生产环境放开 disrupted 触发条件；在此之前不应在大规模真实考场启用心跳扫描器。

### Phase 2B — Proctor Panel

| Job    | 名称                     | 状态   |
| ------ | ------------------------ | ------ |
| P2B-J1 | WebSocket Infrastructure | 待开始 |
| P2B-J2 | Proctor Dashboard        | 待开始 |
| P2B-J3 | Candidate Status Cards   | 待开始 |
| P2B-J4 | Event Stream             | 待开始 |
| P2B-J5 | Realtime Proctor Actions | 待开始 |
| P2B-J6 | Fallback Polling         | 待开始 |

### Phase 2C — Exam Flexibility

| Job    | 名称                   | 状态   |
| ------ | ---------------------- | ------ |
| P2C-J1 | Random Paper Builder   | 待开始 |
| P2C-J2 | Random Snapshot Freeze | 待开始 |
| P2C-J3 | timed_sync             | 待开始 |
| P2C-J4 | deadline               | 待开始 |
| P2C-J5 | untimed                | 待开始 |
| P2C-J6 | Retake Policies        | 待开始 |
| P2C-J7 | Score Strategies       | 待开始 |

### Phase 2D — Integration & Export

| Job    | 名称                    | 状态   |
| ------ | ----------------------- | ------ |
| P2D-J1 | Pass Gate API           | 待开始 |
| P2D-J2 | API Key / Service Token | 待开始 |
| P2D-J3 | Score PDF Export        | 待开始 |
| P2D-J4 | Attempt Detail Export   | 待开始 |
| P2D-J5 | AuditLog Export         | 待开始 |
| P2D-J6 | CAS/OAuth Spike         | 待开始 |

### Phase 2 Deployment Enhancement

- [ ] Replace the Job 6 in-memory exam admission queue with persistent shared storage before supporting multi-instance API deployment.

## Job 8 — Score Management

> Detailed scope: `docs/jobs/phase1_job8.md`
>
> J7 already provides the canonical single-attempt result endpoint: `GET /api/scores/attempts/:attemptId`. J8 extends the management workflow and must reuse this endpoint instead of creating a parallel detail API.

- [ ] **J8-A Contracts + score list API** — add tenant-scoped pagination, pass/fail filtering, search, sorting, statistics, and CandidateField-driven columns.
- [ ] **J8-B Attempt review API alignment** — confirm the J7 detail response supports teacher review; extend the shared Zod response only when the review UI requires additional fields.
- [ ] **J8-C Score management page** — implement `/admin/exams/:id/scores` with filters, dynamic columns, statistics, pagination, states, and detail navigation.
- [ ] **J8-D Teacher attempt detail page** — implement `/admin/attempts/:id` with answer review, partial-credit explanation, and return navigation.
- [ ] **J8-E CSV score export** — implement dynamic CandidateField headers, CSV escaping, authorization, tenant isolation, download headers, and AuditLog recording.
- [ ] **J8-F End-to-end verification** — run migrations, integration tests, `pnpm verify`, and browser smoke checks for list → detail → return and CSV download.

## Job 6 Follow-ups

> Full report: `docs/jobs/phase1_job6_review.md`

### Blocking

- [x] **B1** Add Zod schema validation to `apps/api/src/routes/attempts.ts` — all attempt endpoints validate params and payloads with `@exam/contracts` schemas.

### Important

- [x] **I1** Wire heartbeat background scheduler in server.ts — native `setInterval` scanner registered through the Fastify plugin lifecycle.
- [x] **I2** Implement queue UI in StartExamPage for `requireQueue` exams — wait count, estimated time, progress bar, polling, and auto-redirect.
- [x] **I6** Wrap `ExamTimer` `onTimeout` callback in `useCallback` to prevent unnecessary `setInterval` restarts on parent re-render.

### Low Priority

- [x] **L1** Deduplicate `QuestionSnapshot` type — derive the candidate-safe type from `@exam/contracts`.
- [x] **L2** Remove the runtime re-export of unimplemented `declare function` APIs.
- [x] **L3** Store true/false answers as booleans.
- [x] **L4** Replace `.filter(Boolean)` with an explicit type-narrowing predicate.
