# Phase 2 Implementation Reality Audit

**Generated:** 2026-06-26  
**Method:** READ-ONLY codebase audit across 11 layers  
**Scope:** Phase 2 Minimal Deliverable Exam System real implementation check

---

## 1. Executive Summary

### Phase 2 审计结论：CONDITIONAL — 可收口

Phase 2 核心考试闭环（保存、恢复、提交、deadline、阅卷、成绩、导出、审计、监控、错误状态）**基本全部实现**。存在少数可修复缺口，但没有架构级阻拦项。

**5 条总结：**

1. **Phase 2 可收口** — 核心考试闭环完整：Candidate 考试链路、Admin 管理链路、人工阅卷、成绩发布、CSV/JSON 导出、审计日志、monitoring dashboard、系统诊断全部可用。没有单个功能完全缺失的硬缺口。

2. **最大非阻塞缺口（P2-MUST）：**
   - `ResultPage.tsx` 不解析 `hiddenReason` — 考生看到统一文案"成绩尚未公布"，无法区分 `pending_publish` vs `not_graded`（P2D-J5a 实现不完整）
   - `ScoreListPage.tsx` CSV 导出使用 `<a>` 标签，跨域部署时无法发送 cookie auth（P2E-J3 前端层 bug）
   - `GradingDetailPage.tsx` / `ExamDetailPage.tsx` / `ScoreListPage.tsx` / `AttemptDetailPage.tsx` 在 `data === null` 时 `return null` 导致白屏（4 处页码级防御性编码）
   - `CandidatesPage.tsx` 创建考生后缺少 `toast.success()` 成功反馈

3. **最大测试缺口：** P2E-J5 (import job logs) 和 P2E-J6 (diagnostics page) 无任何测试覆盖。安全协议测试（`exam-protocol-security.test.ts`）只有 4 个 AC 测试，覆盖面不足。但无测试缺口单独构成的 blocker。

4. **最大 UI 缺口：** 没有"前端隐藏按钮但后端仍可非法操作"的问题——后端状态机和行锁提供了独立防御层。UI 保守但安全。4 个 `return null` 白屏场景可在 2 天内修复。

5. **Redis 边界：** 严格合规。生产代码仅使用 `PING` 用于诊断。答案/提交/分数/审计事实全部只存在于 PostgreSQL。

6. **文档漂移：** 存在中度漂移。`SPEC.md` §3.3 声明的 "draft→published only" 与实际（6 状态全实现）严重不符。`ADR-005` 声称 cancel 已推迟但实际已实现。这些是文档过时，不是代码问题。

### 推荐修复顺序

1. P2-MUST: `ResultPage.tsx` `hiddenReason` + CSV 导出 cookie auth
2. P2-MUST: 4 处 `return null` 白屏兜底
3. P2-MUST: CandidatesPage 成功 toast
4. P2-TEST-GAP: importLogs + diagnostics 测试
5. P2-TEST-GAP: security 协议测试扩展
6. P2-SHOULD: 文档漂移修复
7. P2-SHOULD: AuditLogPage actorName 解析
8. P2-SHOULD: ProctorMonitoringPage UI 测试

---

## 2. Phase 2 Gate Result

| Gate | Result | Evidence | Notes |
|------|--------|----------|-------|
| logger / telemetry / monitoring merged | **PASS** | `logger.ts`, `examTelemetry.ts`, `clientEventBuffer.ts`, `sanitizeClientEvent.ts`, `clientEvents.ts`, `ExamMonitoringPage.tsx`, `SystemDiagnosticsPage.tsx` | 所有 21 项检查通过。双端脱敏、批量上报、stale UX、RBAC 边界、Redis 无关 |
| Candidate exam E2E | **PASS** | `attempts.candidate.ts`, `attemptCommands.ts`, `answerProtocol.ts`, `attemptStateMachine.ts` | start/save/restore/submit/heartbeat 全实现，版本化、幂等、行锁 |
| Admin exam management E2E | **PASS** | `exam.ts`, `examCommands.ts`, `examStateMachine.ts`, `examTransitionExecutor.ts`, `attempts.admin.ts` | 6 状态 + 7 迁移 + 4 Admin 操作（force-submit/extend/misconduct/export），全部 audit 记录 |
| save / submit / deadline / heartbeat semantics | **PASS** | `answerProtocol.ts:110-142`, `attemptCommands.ts:235-290`, `deadlineScanner.ts`, `heartbeat.ts` | 版本冲突检测 + 幂等 + deadline 拒绝 + 行锁 + auto-submit + disruption detection |
| manual grading sees candidate answer | **PASS** | `GradingDetailPage.tsx:182-188`, `gradingQueue.ts:150-164`, `manualGrading.ts`, `manualGradingRepo.ts` | 三端（UI/API/DB）全部正确显示候选人答案。有 `data-testid` |
| result publish / candidate view | **PARTIAL** | `exam.ts:1110-1162`, `scores.ts`, `ResultPage.tsx:196-212` | 后端 `publishResults` + 生成绩效门完整。但 `ResultPage.tsx` 不解析 `hiddenReason`，考生看到统一文案 |
| export / audit / import logs | **PASS** | `export.ts`, `scores.ts`, `audit.ts`, `importLogs.ts`, `auditLogRepo.ts` | CSV 导出含 BOM + CSV 注入防御 + audit 记录。但 CSV 前端使用 `<a>` tag，跨域部署 cookie auth 无效 |
| UI loading / empty / error / stale | **PARTIAL** | 15 页审计 | 15 页检查：loading/empty/error 覆盖良好。4 处 `return null` 白屏。AuditLogPage actorId 为 UUID |
| candidate cannot access admin / monitoring | **PASS** | `proctorMonitoring.ts:55`, `proctorMonitoring.test.ts:163-172`, `candidate-start.test.ts` | 所有 admin 路由 `requireRole(["Admin"])`。UI 路由层面分 AdminLayout/ExamLayout。E2E 和 API 测试确认 403 |
| Redis boundary | **PASS** | `redis.ts`, `system.ts:199-211`, ADR-001 | 生产代码仅 `PING`。答案/提交/分数/审计不存在 Redis 中。7 项禁止用途全部零发现 |
| docs aligned with code | **PARTIAL** | `SPEC.md`, `ADR-005` | SPEC.md §3.3 严重过时。ADR-005 cancel 声称推迟但已实现。`phase-roadmap.md` 有 minor wording |
| full tests pass | **CONDITIONAL** | 见测试审计 | DB test isolation 测试需要运行中 PG（本地 ECONNREFUSED）。核心领域/引擎/API 测试通过。E2E 需要 Docker |

---

## 3. Findings

### F-001: `ResultPage.tsx` 不解析 `hiddenReason`

* **Category:** UI 缺口
* **Severity:** P2-MUST
* **Phase:** Phase 2
* **Area:** Candidate Result View
* **Evidence:** `apps/web/src/pages/exam/ResultPage.tsx:196-212` — 只检查 `result.status`，不使用 `hiddenReason` 字段
* **Current behavior:** 无论 `hiddenReason` 是 `pending_publish` 还是 `not_graded`，考生都看到相同的"成绩尚未公布"文案
* **Expected Phase 2 behavior:** 应解析 `hiddenReason` 并展示区分信息：`pending_publish` → "成绩正在审核中，将在公布后可见"；`not_graded` → "考试尚未完成评分，请等待"
* **Why it matters:** 考生体验——无法区分"正在阅卷中"和"成绩已阅卷但管理员未发布"
* **Suggested fix:** 在 `ResultPage.tsx` 中添加 `hiddenReason` 解析逻辑，在 status switch 中增加对 `hiddenReason` 的差异化处理
* **Required tests:** 更新 `ResultPage.test.tsx` 增加 `hiddenReason` 测试用例（`pending_publish`, `not_graded`）
* **Is this Phase 2 or Phase 3:** Phase 2（P2D-J5a 实现不完整）

---

### F-002: CSV 导出 `<a>` tag 缺少 cookie auth

* **Category:** 功能 bug
* **Severity:** P2-MUST
* **Phase:** Phase 2
* **Area:** Scores CSV Export
* **Evidence:** `apps/web/src/pages/admin/ScoreListPage.tsx:131-138` — 使用 `<a target="_blank" href={url}>` 下载 CSV，不发送 cookie
* **Current behavior:** 跨域部署时（如 `VITE_API_BASE_URL` 与页面不同源），浏览器不会发送 cookie，API 返回 401
* **Expected Phase 2 behavior:** 使用 `fetch` 或 `api.get` 携带 `credentials: "include"`，然后通过 Blob 触发下载
* **Why it matters:** 实际 LAN 部署可能有不同的前端/API 域名。导出是核心功能
* **Suggested fix:** 改用 `api.get` + `downloadFile` 辅助函数（已有 `apps/web/src/lib/download.ts`），或改用 `fetch` 手动处理响应
* **Required tests:** E2E 测试确认跨域部署时 CSV 导出可用
* **Is this Phase 2 or Phase 3:** Phase 2（P2E-J3 实现不完整）

---

### F-003: 4 处 `return null` 白屏

* **Category:** UI 缺口
* **Severity:** P2-MUST
* **Phase:** Phase 2
* **Area:** 4 个 Admin 页面
* **Evidence:**
  - `GradingDetailPage.tsx:152` — `if (!data) return null;`
  - `ExamDetailPage.tsx:304` — `if (!exam) return null;`
  - `ScoreListPage.tsx:120` — `if (!scores) return null;`
  - `AttemptDetailPage.tsx:488` — `if (!result && !liveAttempt) return null;`
* **Current behavior:** API 返回 200 但 body 为 null（或意外竞态）时，页面渲染空白 div，管理员无法操作
* **Expected Phase 2 behavior:** 显示 `ErrorState` 组件或至少一个可操作的"数据异常，请重试"状态
* **Why it matters:** 白屏是最差的用户体验（无反馈、无重试）
* **Suggested fix:** 将 `return null` 替换为 `return <ErrorState message="数据加载异常" onRetry={loadFn} />`
* **Required tests:** 增加 mock API 返回 null 的测试验证
* **Is this Phase 2 or Phase 3:** Phase 2

---

### F-004: CandidatesPage 缺少创建成功 Toast

* **Category:** UI 缺口
* **Severity:** P2-MUST
* **Phase:** Phase 2
* **Area:** CandidatesPage
* **Evidence:** `apps/web/src/pages/admin/CandidatesPage.tsx:191` — 保存成功后仅 `await load()`，无 `toast.success()`
* **Current behavior:** 保存候选人后没有任何成功反馈，管理员不确定操作是否生效
* **Expected Phase 2 behavior:** 显示 `toast.success("考生已保存")`
* **Why it matters:** 可用性——创建/编辑操作需要明确反馈
* **Suggested fix:** 在 `load()` 后添加 `<code>toast.success("考生已创建/更新")</code>`
* **Required tests:** 在 CandidatesPage 测试中添加 toast 验证
* **Is this Phase 2 or Phase 3:** Phase 2

---

### F-005: AuditLogPage 显示 actorId UUID 非可读名称

* **Category:** UI 可用性
* **Severity:** P2-SHOULD
* **Phase:** Phase 2
* **Area:** AuditLogPage
* **Evidence:** `apps/web/src/pages/admin/AuditLogPage.tsx:257` — 直接显示 `item.actorId`（raw UUID）
* **Current behavior:** 管理员看到 UUID 而非人类可读的操作人名称
* **Expected Phase 2 behavior:** 审计日志 API 返回 `actorName`，前端显示人类可读名称
* **Why it matters:** 审计日志核心用途是问责——需要知道谁做了什么
* **Suggested fix:** 审计日志 API 增加 `actorName` 字段（通过 LEFT JOIN users）。前端显示名称并在 hover 时显示 UUID
* **Required tests:** 更新 audit 测试验证 `actorName` 字段
* **Is this Phase 2 or Phase 3:** Phase 2

---

### F-006: 文档漂移 — SPEC.md §3.3 严重过时

* **Category:** 文档/实现不一致
* **Severity:** P2-DOC-DRIFT
* **Phase:** Phase 2
* **Area:** SPEC.md
* **Evidence:** `docs/SPEC.md:457-460` 声称"仅 draft→published 接线"，但 `examStateMachine.ts` 实现了全部 6 状态
* **Current behavior:** 新开发者阅读 SPEC 时会错误认为 exam lifecycle 不完整
* **Expected Phase 2 behavior:** SPEC.md 准确反映当前 6 状态实现
* **Why it matters:** 声誉文档是项目权威。漂移降低信任
* **Suggested fix:** 更新 SPEC.md §3.3 的 exam lifecycle 章节
* **Required tests:** 无
* **Is this Phase 2 or Phase 3:** Phase 2

---

### F-007: 文档漂移 — ADR-005 cancel 声称推迟但已实现

* **Category:** 文档/实现不一致
* **Severity:** P2-DOC-DRIFT
* **Phase:** Phase 2
* **Area:** ADR-005
* **Evidence:** `docs/adr/ADR-005-exam-operation-state-baseline.md:280-293` 声称 cancel 推迟
* **Current behavior:** cancelExam 命令、路由、分数门、导出门、错误类型全部实现
* **Expected Phase 2 behavior:** ADR-005 更新以匹配实现，或按实际实现决定后续
* **Why it matters:** DR / 计划文件不能锁定实现状态
* **Suggested fix:** 更新 ADR-005 标记 cancel 已在 Slice 4 之外实现，保持设计决策记录准确
* **Required tests:** 无
* **Is this Phase 2 or Phase 3:** Phase 2

---

### F-008: P2E-J5 Import Logs 无测试覆盖

* **Category:** 测试缺口
* **Severity:** P2-TEST-GAP
* **Phase:** Phase 2
* **Area:** ImportLogsPage
* **Evidence:** importLogs.test.ts 仅 4 个基础测试（100 行），无 E2E 或 UI 测试
* **Current behavior:** 导入日志功能存在但无足够测试验证其正确性
* **Expected Phase 2 behavior:** 至少有 API 集成测试覆盖过滤、分页、错误场景。建议 E2E 覆盖 UI 展示
* **Why it matters:** 导入日志是核心运维入口
* **Suggested fix:** 编写 API 集成测试覆盖 type 过滤、分页、空结果。可选 E2E 测试 UI 展示
* **Required tests:** API 集成：过滤、分页、错误。E2E：UI 展示
* **Is this Phase 2 or Phase 3:** Phase 2

---

### F-009: P2E-J6 Diagnostics 无测试覆盖

* **Category:** 测试缺口
* **Severity:** P2-TEST-GAP
* **Phase:** Phase 2
* **Area:** SystemDiagnosticsPage
* **Evidence:** SystemDiagnosticsPage.test.tsx 仅测试了 stale warning 和 logger.warn
* **Current behavior:** 存在系统诊断页面，API 测试已覆盖
* **Expected Phase 2 behavior:** 增加前端测试覆盖健康/诊断数据正确渲染、Redis 状态、DB 状态、Scanner 状态
* **Suggested fix:** 扩展 Frontend test
* **Required tests:** 渲染健康/诊断指标、Redis/DB/scanner 状态、空数据回退
* **Is this Phase 2 or Phase 3:** Phase 2

---

### F-010: 安全协议测试覆盖面不足

* **Category:** 测试缺口
* **Severity:** P2-TEST-GAP
* **Phase:** Phase 2
* **Area:** exam-protocol-security
* **Evidence:** `exam-protocol-security.test.ts` 仅 4 个 AC 测试（360 行）。缺少：replay attack、enrollment manipulation、rate limiting、standardAnswer exposure 等
* **Current behavior:** 协议安全性仅经过基本验收标准检查
* **Expected Phase 2 behavior:** 增加至少 replay attack（clientSeq replay 跨 session）、enrollment manipulation（已取消报名者尝试）、rate limiting 测试
* **Why it matters:** 考试系统安全是核心非功能性需求（SPEC.md §6）
* **Suggested fix:** 增加 replay、enrollment manipulation、rate limit 测试
* **Required tests:** replay attack + enrollment manipulation + rate limit
* **Is this Phase 2 or Phase 3:** Phase 2

---

### F-011: 前端 E2E 测试仅覆盖单题型

* **Category:** 测试覆盖缺口
* **Severity:** P2-TEST-GAP
* **Phase:** Phase 2
* **Area:** E2E tests
* **Evidence:** 所有 E2E 测试仅使用 single_choice 或 true_false。fill_blank、multi_select、matching 等题型无 E2E 覆盖
* **Current behavior:** 多题型在 API 测试（candidate-save-submit.test.ts）中有覆盖，E2E 层无
* **Expected Phase 2 behavior:** 至少增加 fill_blank + multi_select E2E 覆盖完整 answer/save/submit/grade 链路
* **Suggested fix:** 增加 fill_blank（keyword matching）和 multi_select（partial half）E2E 测试
* **Required tests:** fill_blank "keyword" matching E2E + multi_select partial scoring E2E
* **Is this Phase 2 or Phase 3:** Phase 2

---

### F-012: ProctorMonitoringPage UI 无 Playwright 测试

* **Category:** 测试覆盖缺口
* **Severity:** P2-TEST-GAP
* **Phase:** Phase 2
* **Area:** E2E proctor
* **Evidence:** `proctor-runtime.spec.ts` 是 API-only，无 Playwright 浏览器测试
* **Current behavior:** Proctor monitoring UI（Admin）存在并经过单元测试，但无 E2E 覆盖
* **Expected Phase 2 behavior:** E2E 测试确认 monitoring 页面在候选人在线时显示正确状态、事件时间线加载、stale warning 渲染
* **Suggested fix:** 添加 Playwright 测试：登录 admin → 选择考试 → monitoring 页面 → 验证状态
* **Required tests:** status display + event timeline + stale warning
* **Is this Phase 2 or Phase 3:** Phase 2

---

## 4. Candidate Path Audit

| Capability | Status | Evidence | Gaps | Tests |
|------------|--------|----------|------|-------|
| exam list | **PASS** | `attempts.candidate.ts:356` GET `/candidate/exams` 返回可用考试列表 | 无 | `candidate-start.test.ts` + E2E happy path |
| start | **PASS** | `attempts.candidate.ts:604` POST `/attempts/:examId/start` | 无 | `candidate-start.test.ts` (450 lines) + E2E double-click |
| restore | **PASS** | `attemptCommands.ts:152-163` 隐式 + `attempts.candidate.ts:1011` 显式 restore | 无 | E2E `disconnect-restore.spec.ts` + API restore test |
| load attempt | **PASS** | `attempts.candidate.ts:715` GET `/attempts/:id` | 无 | `candidate-save-submit.test.ts` |
| save answer | **PASS** | `answerProtocol.ts:110-142` 版本控制 + 幂等 + 冲突检测 + deadline 拒绝 | 无 | `candidate-save-submit.test.ts` + E2E save-submit-race |
| autosave | **PASS** | `TakeExamPage.tsx` `useSubmitFlush` + 30s timer | 无 | E2E `submit-flush.spec.ts` |
| heartbeat | **PASS** | `attempts.candidate.ts:967` POST `/attempts/:attemptId/heartbeat` | 无 | `heartbeat.test.ts` (470 lines) |
| submit | **PASS** | `attemptCommands.ts:235-290` 幂等 + `submitAndGradeAttempt.ts` | 无 | E2E `save-submit-race.spec.ts` + API tests |
| deadline | **PASS** | `deadlineScanner.ts` auto-submit + `answerProtocol.ts:110` deadline 拒绝 | 无 | E2E `deadline-crash.spec.ts` + `deadline-scanner.test.ts` |
| force submit visibility | **PASS** | `attempts.admin.ts:120` force-submit -> `graded` | 前端无 force-submit 按钮（Phase 2C 不要求） | `admin-force-submit.test.ts` + E2E proctor-runtime |
| result view | **PARTIAL** | `ResultPage.tsx` | 不解析 `hiddenReason` (F-001) | `ResultPage.test.tsx` 缺少 hiddenReason 测试 |

---

## 5. Admin Path Audit

| Capability | Status | Evidence | Gaps | Tests |
|------------|--------|----------|------|-------|
| questions CRUD | **PASS** | `question.ts` + `QuestionForm.tsx` + `QuestionPage.tsx` | 无 | `question.test.ts` |
| candidates CRUD | **PASS** | `candidate.ts` + `CandidatesPage.tsx` | 创建后无 toast (F-004) | `candidate.test.ts` + `CandidatesPage.test.tsx` |
| candidate fields | **PASS** | `candidateField.ts` + `CandidateFieldsPage.tsx` | 无 | `candidateField.test.ts` |
| imports | **PASS** | `CandidatesPage.tsx` ImportWizard + CSV 解析 | 无 | `ImportWizard.test.tsx` + `candidateImport.test.ts` |
| exam create/edit | **PASS** | `exam.ts:420-628` + `examCommands.ts` | 无 | `exam.test.ts` |
| publish/open/close/extend/archive/cancel | **PASS** | `exam.ts:630-1086` + `examCommands.ts` | 无 | `exam.test.ts` + E2E `admin-flow.spec.ts` |
| enrollments | **PASS** | `exam.ts:1200-1408` batch + single | 无 | `enrollment.test.ts` + E2E admin-flow |
| audit logs | **PASS** | `audit.ts` + `auditLogRepo.ts` | actorName 缺失 (F-005) | `audit.test.ts` + E2E `audit-log.spec.ts` |

---

## 6. Manual Grading Audit

### Grading Detail Page 是否能看候选人答案？**是**

| 层 | 状态 | 证据 |
|-----|--------|----------|
| **Frontend UI** | 有——`formatAnswer(q.candidateAnswer)` 渲染在"考生作答"标签区域 | `GradingDetailPage.tsx:182-188`，`data-testid="grading-candidate-answer-${q.questionId}"` |
| **API** | 有——从 `attempt.answers` 构建 `answerByQuestion` Map | `gradingQueue.ts:150-164` |
| **Contract** | 有——`candidateAnswer: z.unknown().nullable()` | `score.ts:124` |
| **Integration test** | 有——Test block 12 验证 `candidateAnswer` 返回 | `gradingQueue.test.ts:679-720` |
| **E2E test** | 有——Playwright 断言 `grading-candidate-answer-{id}` 包含文本 | `manual-grading.spec.ts:90-93` |

| Capability | Status | Evidence | Gaps | Tests |
|------------|--------|----------|------|-------|
| grading queue | **PASS** | `gradingQueue.ts:41-99` + `GradingQueuePage.tsx` | 无 | E2E `manual-grading.spec.ts` + `GradingQueuePage.test.tsx` |
| grading detail shows candidate answer | **PASS** | `GradingDetailPage.tsx:182-188` + `gradingQueue.ts:150-164` | 无 | Block 12 in `gradingQueue.test.ts` + E2E |
| score input | **PASS** | 前端 `validateScore()` + 引擎 `manualGrading.ts:182` + DB CHECK | `null` data 白屏 (F-003) | `GradingDetailPage.test.tsx` |
| score validation | **PASS** | 三层：前端/contract/engine+DB | 无 | 单元 + 集成测试 |
| regrading | **PASS** | `gradeQuestion()` 幂等 + `reconcileScores()` 完全重建 | 无 | `manualGrading.test.ts:267-318` + E2E |
| score publish | **PASS** | `examCommands.ts:publishResults` + `exam.ts:1110-1162` | 无 | `resultPublishing.test.ts` 13 slices |
| audit | **PASS** | `grading.score_entered` + `grading.finalized` | 尽力而为（try/catch） | `gradingQueue.test.ts` block 10-11 |

### **P2-BLOCKER 判定：无**。人工阅卷在候选人答案可见性方面全部通过。

---

## 7. Result / Export / Audit Audit

| Capability | Status | Evidence | Gaps | Tests |
|------------|--------|----------|------|-------|
| scores list | **PASS** | `scores.ts:232-339` + `ScoreListPage.tsx` | CSV 导出 cookie auth 问题 (F-002) | `scores.test.ts` |
| admin score summary | **PASS** | `ResultsOverviewPage.tsx` + `scores.ts` | 无 | `scores.test.ts` |
| result publish state | **PASS** | `exam.ts:publishResults` + score gate | 无 | `resultPublishing.test.ts` 13 slices |
| candidate result visible after publish | **PASS** | `ResultPage.tsx` + `scores.ts` visibility gate | `hiddenReason` 未解析 (F-001) | `ResultPage.test.tsx` 缺少 hiddenReason |
| candidate result hidden before publish | **PASS** | `scores.ts:166-218` 三种 visibility gate | 无 | `resultPublishing.test.ts` |
| CSV export | **PASS** | `export.ts` BOM + injection defense + audit | 前端 cookie auth 缺失 (F-002) | `export.test.ts` (737 lines) |
| attempt detail | **PASS** | `AttemptDetailPage.tsx` + `attempts.admin.ts` timeline | 无 | `timeline.test.ts` |
| attempt JSON/CSV export | **PASS** | `attempts.admin.ts:394-489` | 无 | `admin-export.test.ts` |
| export audit | **PASS** | `attempt.exported` audit entry | 无 | `admin-export.test.ts` |
| sensitive fields in export | **PASS** | 仅候选字段 + 分数 | 无 | 手动验证 |
| Phase 3 evidence semantics | **NOT FOUND** | 无 evidence ZIP/manifest/digital signature | 正确——Phase 3 | 无 |

---

## 8. Telemetry / Monitoring Audit

| Capability | Status | Evidence | Gaps | Tests |
|------------|--------|----------|------|-------|
| frontend logger | **PASS** | `logger.ts` unified + 替代 console.log | 无 | `check-code-quality.mjs` 强制执行 |
| client-events POST | **PASS** | `/api/client-events` + `clientEventBuffer.ts` batch (size=20, interval=5s) | 无 | `clientEvents.test.ts` + `clientEventBuffer.test.ts` |
| client_events table | **PASS** | `pg.ts:437-493` 含 5 个索引 | 无 | DB schema |
| sanitize answer | **PASS** | 双端脱敏（client `logger.ts:71` + server `clientEvents.ts:89`） | 无 | 3 个测试文件确认 |
| sanitize question | **PASS** | denylist: content/body/questionText | 无 | 同上 |
| exam telemetry events | **PASS** | save_failed/submit_failed/heartbeat_failed/offline/online/visibility 全部上报 | 无 | `proctorMonitoringService.ts:32-39` |
| monitoring online/stale/offline | **PASS** | `ExamMonitoringPage.tsx` status badge | 无 | `ExamMonitoringPage.test.tsx` |
| monitoring lastHeartbeatAt/lastSaveAt | **PASS** | `ExamMonitoringPage.tsx:265,268` | 无 | 组件渲染 |
| monitoring event counts | **PASS** | visibilityLost/browserOffline/saveFailed/submitFailed 计数 | 无 | 组件渲染 |
| monitoring event timeline | **PASS** | `ExamMonitoringPage.tsx:312-364` dialog | 无 | 单元测试 |
| monitoring API no answer/question | **PASS** | `projectSafeMetadata` allowlist-only | 无 | `proctorMonitoringService.test.ts:135-145` |
| stale warning | **PASS** | `ExamMonitoringPage.tsx:110-115` + `SystemDiagnosticsPage.tsx:98-108` | 无 | E2E poll failure 测试 |
| candidate cannot access monitoring | **PASS** | `requireRole(["Admin"])` + 测试确认 403 | 无 | `proctorMonitoring.test.ts:163-172` |
| Redis not fact source | **PASS** | 零 Redis 在 monitoring/heartbeat/scanner | 无 | 全代码搜索 |

---

## 9. Redis Boundary Audit

| File | Redis usage | Allowed in Phase 2 | Risk | Verdict |
|------|-------------|--------------------|------|---------|
| `apps/api/src/plugins/redis.ts` | 创建/连接/关闭客户端 | **是**（基础设施） | 低：lazyConnect + 可选 | **合规** |
| `apps/api/src/routes/system.ts:199-211` | `PING` 延迟检测 | **是**（诊断） | 低：仅在 admin 端 | **合规** |
| `apps/api/src/config/runtimeConfig.ts` | URL/prefix 配置解析 | **是**（配置） | 低 | **合规** |
| `apps/api/src/plugins/rateLimit.ts` | 未传递 Redis 给 rate-limit | **合规**（使用内存） | 低 | **合规** |
| `apps/api/src/plugins/heartbeat.ts` | **无 Redis** — 仅 PG | **合规** | 低 | **合规** |
| `apps/api/src/plugins/deadlineScanner.ts` | **无 Redis** — 仅 PG + 行锁 | **合规** | 低 | **合规** |
| `apps/api/src/lib/proctorMonitoringService.ts` | **无 Redis** — 仅 PG | **合规** | 低 | **合规** |
| 所有 answer/submit/score 路径 | **无 Redis** — 仅 PG | **合规** | 低 | **合规** |

**Redis 不得用于答案/提交/分数/审计/权限/身份事实：全部零发现。**
**Redis 仅用于 `PING` 诊断 + 测试隔离前缀。**

---

## 10. Test Coverage Audit

| Required Test | Exists | Evidence | Gap |
|---------------|--------|----------|-----|
| Admin create exam → assign → publish | **YES** | `admin-flow.spec.ts` E2E + `exam.test.ts` API | 无 |
| Candidate start → save → submit | **YES** | `candidate-happy-path.spec.ts` E2E + `candidate-save-submit.test.ts` API | 无 |
| Candidate restore exam | **YES** | `resume-attempt.spec.ts` + `disconnect-restore.spec.ts` E2E | 无 |
| Save conflict detection | **YES** | `candidate-save-submit.test.ts` stale version + `save-submit-race.spec.ts` E2E | 无 |
| Submit idempotency | **YES** | `candidate-save-submit.test.ts` + `save-submit-race.spec.ts` E2E | 无 |
| Deadline auto-submit | **YES** | `deadline-crash.spec.ts` E2E + `deadline-scanner.test.ts` API | 无 |
| Force submit | **YES** | `admin-force-submit.test.ts` API + `proctor-runtime.spec.ts` E2E | 无 |
| Manual grading (detail sees answer) | **YES** | `manual-grading.spec.ts` E2E + `gradingQueue.test.ts` API | 无 |
| Subjective question scoring | **YES** | `manualGrading.test.ts` + `GradingDetailPage.test.tsx` | 无 |
| Result publishing | **YES** | `result-publishing.spec.ts` E2E + `resultPublishing.test.ts` API | 无 |
| Candidate view result | **YES** | `ResultPage.test.tsx` + `scores.test.ts` API | `hiddenReason` 未覆盖 |
| CSV export | **YES** | `export.test.ts` API (737 lines) + `admin-flow.spec.ts` E2E | 前端 cookie auth 测试 |
| JSON export | **YES** | `admin-export.test.ts` API | 无 |
| Audit logs | **YES** | `audit-log.spec.ts` E2E + `audit.test.ts` API | 无 |
| Client events | **YES** | `clientEvents.test.ts` + `clientEventBuffer.test.ts` + sanitize 测试 | 无 |
| Monitoring status | **YES** | `ExamMonitoringPage.test.tsx` + `proctorMonitoring.test.ts` API | 无 Proctor UI E2E |
| Candidate cannot access admin API | **YES** | `unauthorized-access.test.ts` + `proctorMonitoring.test.ts` + `candidate-start.test.ts` | 无 |
| Import logs | **NO** | 仅 4 个基础测试 (100 行) | **P2-TEST-GAP** |
| Diagnostics page | **PARTIAL** | `SystemDiagnosticsPage.test.tsx` 仅 stale warning | **P2-TEST-GAP** |
| Redis no answer facts | **YES** | 全域搜索零发现 | 无 |
| Fill blank E2E | **NO** | API 有覆盖，E2E 无 | **P2-TEST-GAP** |
| Multi select E2E | **NO** | API 有覆盖，E2E 无 | **P2-TEST-GAP** |
| Proctor UI E2E | **NO** | API-only | **P2-TEST-GAP** |
| Retake policy all strategies | **PARTIAL** | `max_attempts` 覆盖好，`pass_then_stop`/`unlimited` 不足 | **P2-TEST-GAP** |

---

## 11. Fix Order

### 1. P2-MUST — 4 项

| # | Fix | Why Phase 2 | Affects | Don't extend to |
|---|-----|-------------|---------|-----------------|
| F-001 | `ResultPage.tsx` 解析 `hiddenReason` | P2D-J5a 实现不完整 | `ResultPage.tsx`, `ResultPage.test.tsx` | 不增加 SSO / LDAP / RBAC |
| F-002 | CSV 导出改用 `api.get` + Blob | P2E-J3 前端 bug | `ScoreListPage.tsx` | 不增加 PDF / 异步导出 / 选项排序 |
| F-003 | 4 处 `return null` 替换为 `ErrorState` | 用户可见的空白页属于 P2 必须 | `GradingDetailPage.tsx`, `ExamDetailPage.tsx`, `ScoreListPage.tsx`, `AttemptDetailPage.tsx` | 不批量重构页面 |
| F-004 | CandidatesPage 增加 toast.success | 可用性基础 | `CandidatesPage.tsx` | 不增加批量操作 |

### 2. P2-TEST-GAP — 5 项

| # | Gap | Why Phase 2 | Affects | Don't extend to |
|---|-----|-------------|---------|-----------------|
| F-008 | Import logs 测试 | 核心运维功能 | `importLogs.test.ts` + 新增 E2E | 不增加导入格式扩展 |
| F-009 | Diagnostics 测试 | 系统运维基础 | `SystemDiagnosticsPage.test.tsx` | 不增加健康检查自定义 |
| F-010 | Security protocol 扩展 | SPEC §6 安全要求 | `exam-protocol-security.test.ts` | 不增加 OIDC/LDAP/SSO |
| F-011 | Multi question type E2E | 核心考试链路 | 新增 E2E test file | 不增加 AI 评分 |
| F-012 | Proctor UI E2E | 监测面板测试 | `proctor-runtime.spec.ts` | 不增加 WebSocket/实时更新 |

### 3. P2-SHOULD — 3 项

| # | Fix | Why Phase 2 | Affects | Don't extend to |
|---|-----|-------------|---------|-----------------|
| F-005 | AuditLogPage actorName | 审计可用性 | `audit.ts` + `auditLogRepo.ts` + `AuditLogPage.tsx` | 不增加姓名搜索/导出 |
| F-006 | SPEC.md §3.3 更新 | 文档权威 | `docs/SPEC.md` | 不重写整个 SPEC |
| F-007 | ADR-005 cancel 更新 | 文档准确性 | `docs/adr/ADR-005-*.md` | 不创建新 ADR |

---

## 12. Final Verdict

```text
Phase 2 can close: CONDITIONAL
```

### 最小必修清单（P2-BLOCKER: none, P2-MUST: 4 项）

以下 4 项 P2-MUST 修复后 Phase 2 可收口：

1. **F-001**: `ResultPage.tsx` 解析 `hiddenReason` — 1 小时
2. **F-002**: CSV 导出改用 `api.get` + Blob 下载 — 1 小时
3. **F-003**: 4 处 `return null` 替换为 `ErrorState` — 2 小时
4. **F-004**: CandidatesPage 增加 `toast.success()` — 10 分钟

总计约 **4.5 小时**开发 + 1 小时测试 + 1 小时验证。无架构级重构。

### 修完最小清单后 Phase 2 状态

- Candidate 考试链路：完整可用
- Admin 管理链路：完整可用
- 人工阅卷：完整可用（候选人答案可见 ✔）
- 成绩发布：后端完整，前端 `hiddenReason` 解析补充后可关闭
- 导出：CSV 后端完整，前端 cookie auth 补充后可关闭
- 审计：日志记录完整，actorName 为 should-have
- 监控：功能完整，Proctor E2E 为 should-have
- 系统诊断：功能完整，测试为 should-have
- Redis 边界：**零发现** ✔
- 文档：SPCE.md + ADR-005 更新为 should-have
