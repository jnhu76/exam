# Phase 3 模块作业卡

> **取代：** `job-cards.md` 与 `job-cards-large.md` 中的能力优先作业卡。两者作为主执行队列已退役。本文档是活动执行队列。
>
> **计划权威：** `docs/phase3/plan.md` — 模块闭环计划。下方每张作业卡实现该计划中的一个派生 Middle Job。
>
> **协议优先（2026-07-03 修订）：** 模块队列在 P0 之前新增 **P-1 考试协议与后端状态模型收敛**（P3-PROTO-0/1/2）。P-1 是 P0 前端运行时的硬前置：协议矩阵与后端一致性测试未完成前，不得推进前端作答状态机（P3-FSM-0）或主观题运行时。后端是业务真相源；前端只消费后端真相字段。

---

## 全局非目标

本批作业卡不含：

- 富文本作答
- 画图/画布作答
- 文件上传作答
- 试卷随机化
- 题目版本历史
- Proctor 角色激活
- Proctor 派单/scoped 监考
- WebSocket/SSE 监考
- 租户/学校/组织作用域
- 自定义 RBAC 角色
- Scoped 角色派单（teacher@course、proctor@exam）
- 邮件模板引擎
- 邮件后台 worker 守护进程
- 邮件偏好中心
- 结果 PDF 导出
- 审计留存/归档
- E2E 全量并行化
- `submitted_answers_hash` 列（MVP 不需要，幂等性靠事务+状态 guard）
- 后台 deadline scheduler（仅懒触发 reconciliation）
- InputMode / GradingMode 存储列（派生值，不存 DB）

---

## text_response 题型约定（取代旧 subjective_text 约定）

**旧约定已废弃**：`type=fill_blank + standardAnswer=null + options=[]` 不再是主观文本题的正式编码。

**新约定**：`text_response` 是独立的 `QuestionType`。

| 字段 | 取值 |
|-------|-------|
| `type` | `text_response` |
| `inputMode` | `multi_line`（派生，不存 DB） |
| `gradingMode` | `manual`（派生，不存 DB） |
| `standardAnswer` | 可选（null 或有效参考答案） |
| `rubric` | 发布时必填（评分依据） |
| `options` | 空 |
| `前端渲染` | `<textarea>`（纯文本，保留换行，无富文本） |
| `评分流水线` | `gradingMode=manual` → 进入人工评分队列（`gradingStatus=pending_manual`） |

**rubric 双层存储**：`questions.rubric`（命题编辑源）→ `QuestionSnapshot.rubric`（冻结评分源）。grading 视图从 snapshot 读取，不 JOIN live questions 表。

---

## 模块 P-1 — 考试协议与后端状态模型收敛（升级为 P3-L0-EXAM-PROTOCOL-FOUNDATION）

> **执行顺序硬约束：** 本模块的全部作业卡必须在 P0（考生作答运行时）的任何作业卡之前完成。
>
> **原则：** 后端是业务真相源。P-1/L0 不仅是协议文档化，而是把题型模型、答案冻结、提交屏障、deadline 收口、DTO 边界和前端状态模型一次性做正确。

### 协议覆盖清单（P3-PROTO-0 必须覆盖全部 14 项 + L0 扩展）

原有 14 项：
1. exam lifecycle
2. attempt lifecycle
3. draft answers vs submitted_answers（原 final_answers）
4. save/restore protocol
5. submit/freeze protocol
6. double submit idempotency
7. save after submit rejection
8. save vs submit race
9. refresh/resume after submit
10. grading input uses submitted_answers only
11. result visibility
12. standard answer visibility
13. candidate own-result boundary
14. teacher/admin grading visibility

L0 扩展项：
15. text_response 题型与 rubric 双层存储
16. CandidateTakeSnapshot 统一端点
17. Deadline reconciliation（懒触发收口）
18. GradingStatus 独立维度（人工评分队列查 gradingStatus，不查 attemptStatus）
19. inputMode / gradingMode 派生（不存储）
20. submitted_answers 格式（SubmittedAnswersSnapshot，干净快照）
21. Migration 策略（schema + backfill 脚本）

### 状态分层（协议矩阵的真相源）

```
Exam:
  draft -> published/open -> closed

AttemptStatus (8 values):
  not_started -> in_progress -> submitted -> grading -> graded
                                   ↑           ↓
                               disrupted     voided (terminal)

GradingStatus (3 independent values):
  pending_auto     — auto-grading queued or in progress
  pending_manual   — manual grading needed (text_response questions exist)
  fully_graded     — all scoring complete

Completion paths:
  objective-only exam:  submitted → grading → graded (auto-grade in submit transaction)
  manual-only exam:     submitted (gradingStatus=pending_manual) → graded (after human scoring)
  mixed exam:           submitted (gradingStatus=pending_manual) → graded (auto + manual complete)

Answer:
  answers            draft, mutable before submit
  submitted_answers  frozen snapshot, immutable after submit

Result:
  resultVisibility   score/pass visibility (hidden | visible)
  answerVisibility   standardAnswer/rubric visibility (hidden | visible)
```

---

### P3-PROTO-0：Exam Protocol Audit（升级为 L0 协议文档）

**目标：** 产出 `docs/phase3/exam-protocol.md`，作为 Exam / Attempt / Answer / Submit / Grading / Result Visibility 的权威协议真相源。**L0 升级后**：不仅记录现有行为，还要记录新增的 text_response 题型、submitted_answers 物理列、CandidateTakeSnapshot 端点、deadline reconciliation、GradingStatus 独立维度。

**类型：** 审计 + 文档（无产品代码改动）

**依赖：** 无（P-1 的起点）

**覆盖协议：** 上述全部 21 项（14 原有 + 7 L0 扩展）

**待检查文件：**
- `packages/domain/src/enums.ts`（QuestionType / AttemptStatus / GradingStatus / ExamStatus 枚举 — 新增 text_response）
- `packages/exam-engine/src/examStateMachine.ts`（exam lifecycle transition 表）
- `packages/exam-engine/src/examCommands.ts`（exam 命令函数：publishExam/openExam/closeExam/cancelExam/unpublishExam/extendExam/archiveExam/publishResults/checkAndUpdateExamStatus）
- `packages/exam-engine/src/attemptStateMachine.ts`（attempt transition 表）
- `packages/exam-engine/src/attemptCommands.ts`（attempt 命令函数 + OPEN_STATUSES）
- `packages/exam-engine/src/answerProtocol.ts`（save/restore/submit/freeze）
- `packages/exam-engine/src/timer.ts`（server-side time authority）
- `packages/exam-engine/src/grading.ts`、`packages/exam-engine/src/manualGrading.ts`（grading input）
- `apps/api/src/routes/attempts/attempts.candidate.ts`（candidate attempt API）
- `apps/api/src/routes/scores.ts`（result/standard-answer visibility）
- `apps/api/src/routes/exam.ts`（exam publish/close）
- `packages/contracts/src/attempt.ts`（SaveAnswerRequestSchema 等）
- `packages/db/src/schema/pg.ts`（attempt status / answers / submitted_answers 形状）
- `CONTEXT.md`（统一语言真相源 — QuestionType / AttemptStatus / GradingStatus / Exam lifecycle / 可见性）
- `docs/SPEC.md` §455–499（Exam 状态机权威说明，Phase 2 已实现全 6 态）

**步骤：**

1. 阅读上述文件，记录现有行为。

2. 产出 `docs/phase3/exam-protocol.md`，覆盖全部 21 项协议，包含：
   - 题型模型（5 个 QuestionType + InputMode/GradingMode 派生）
   - submitted_answers 物理列 + SubmittedAnswersSnapshot 格式
   - CandidateTakeSnapshot 端点规格
   - Deadline reconciliation 事务伪代码
   - GradingStatus 独立维度
   - rubric 双层存储
   - Migration 策略（schema + backfill）

**输出：** `docs/phase3/exam-protocol.md`

**完成标准：**
- 文档覆盖全部 21 项协议
- 明确 text_response 是独立题型，不是 fill_blank 变体
- 明确 submitted_answers 是物理列，不是逻辑等价
- 明确 CandidateTakeSnapshot 是统一端点
- 明确 deadline reconciliation 是懒触发收口
- 任何人读完后不会误以为可以先做 TakeExam UI 再补协议

**提交：**
```bash
git add docs/phase3/exam-protocol.md
git commit -m "docs(P-1/L0): exam protocol — 21-item matrix including text_response, submitted_answers, deadline reconciliation"
```

---

### P3-PROTO-1：Backend State Consistency Tests（L0 扩展）

**目标：** 用后端集成测试证明协议矩阵中的关键边界。**L0 扩展后**：增加 deadline reconciliation、text_response、submitted_answers 冻结、double submit 幂等的测试。

**类型：** 测试（集成测试，针对 `exam_test`）

**依赖：** P3-PROTO-0（协议矩阵被接受）

**必须覆盖的场景（14 项）：**

| # | 场景 | 预期 |
|---|------|------|
| 1 | save before submit allowed | in_progress attempt 的 save 成功 |
| 2 | save after submit rejected | submitted attempt 的 save 返回错误，submitted_answers 不变 |
| 3 | double submit idempotency | 第二次 submit 返回稳定 submitted attempt，不覆盖 submitted_answers |
| 4 | save/submit race | 并发 save + submit 冻结一组确定性 submitted_answers |
| 5 | refresh after submit | GET attempt 返回 locked、answerSource='submitted' |
| 6 | candidate cannot see score before release | 发布前考生视图不含 score |
| 7 | candidate cannot see standardAnswer | 考生视图按 answerVisibility 剥离 standardAnswer |
| 8 | teacher/admin grading view sees submitted answers | 评分视图从 submitted_answers 读取 |
| 9 | deadline reconciliation via take | in_progress + expired → submitted + submitted_answers 冻结 |
| 10 | deadline reconciliation idempotent | 重复 take 不覆盖已有 submitted_answers |
| 11 | save after deadline rejected | 过期后 save 返回错误 |
| 12 | submit after deadline returns existing | 过期后 submit 返回已有 deadline-submitted snapshot |
| 13 | text_response grading reads submitted_answers | 人工评分从 submitted_answers 读取，不读 draft answers |
| 14 | grading queue queries gradingStatus | 人工评分队列查 gradingStatus='pending_manual'，不查 attemptStatus |

**完成标准：**
- 14 个场景全部有通过的集成测试
- 测试名清晰对应协议条目
- 无既有测试被削弱

**提交（若加测试）：**
```bash
git add apps/api/src/routes/attempts.candidate.test.ts
git commit -m "test(P-1/L0): backend state consistency — 14 scenarios including deadline reconciliation and text_response"
```

---

### P3-PROTO-2：API Contract Alignment（L0 升级为 CandidateTakeSnapshot）

**目标：** 实现 `GET /candidate/attempts/:attemptId/take` 统一端点，返回 attempt 元数据 + 派生能力 + 安全题目 + answerValue + answerSource。**取代旧的 7 个真相字段补丁方案**。

**类型：** 实现（新端点 + 契约 schema + 测试）

**依赖：** P3-PROTO-0（协议矩阵）、P3-PROTO-1（一致性测试）

**CandidateTakeSnapshot 结构：**

```ts
interface CandidateTakeSnapshot {
  attemptId: string;
  examId: string;
  attemptStatus: AttemptStatus;
  gradingStatus: GradingStatus;
  isEditable: boolean;        // attemptStatus==='in_progress' && serverNow < deadline
  canStart: boolean;
  canResume: boolean;
  canSave: boolean;
  canSubmit: boolean;
  lockReason?: 'deadline' | 'submitted' | 'voided' | 'disrupted';
  resultVisibility: 'hidden' | 'visible';
  answerVisibility: 'hidden' | 'visible';
  submittedAt: string | null;
  serverNow: string;           // 服务端当前时间，前端倒计时的唯一真相源
  effectiveDeadline: string | null;  // 考试有效截止时间（含延期调整）
  serverRevision: string | number;
  questions: CandidateQuestion[];
}

interface CandidateQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
  inputMode: InputMode;  // 派生自 type
  maxScore: number;
  answerValue: unknown | null;
  answerSource: 'draft' | 'submitted' | 'none';
}
```

**安全投影规则：**
- 不返回 standardAnswer / rubric / gradingMode / correctOption / teacher notes / 未发布 score
- `answerSource` 由后端根据 attemptStatus 路由：in_progress → draft；submitted/grading/graded → submitted；其他 → none
- `Cache-Control: no-store`（GET 可能触发 deadline reconciliation 写副作用）

**待创建/修改文件：**
- `apps/api/src/routes/attempts.candidate.ts`（新端点）
- `packages/contracts/src/attempt.ts`（CandidateTakeSnapshot schema）
- 测试文件

**完成标准：**
- 端点返回完整 CandidateTakeSnapshot
- 安全投影不泄漏 standardAnswer/rubric
- answerSource 正确路由
- isEditable 考虑 deadline
- 测试覆盖 all answerSource 分支

**提交：**
```bash
git add apps/api/src/routes/attempts.candidate.ts packages/contracts/src/attempt.ts
git commit -m "feat(P-1/L0): CandidateTakeSnapshot endpoint with answerSource routing"
```

---

### P3-L0-1：Schema Migration + Rubric 双层存储

**目标：** 实现数据库 schema 变更：新增 text_response 枚举值、submitted_answers 列、rubric 双层存储。

**类型：** 实现（migration + schema + contract）

**依赖：** P3-PROTO-0（协议矩阵）

**变更清单：**

| 表 | 变更 |
|---|---|
| `questions` | `type` 枚举新增 `'text_response'`；新增 `rubric text` |
| `question_snapshots` | 新增 `rubric text` |
| `exam_attempts` | 新增 `submitted_answers jsonb`；新增 `submission_reason text nullable` |

**不新增：** `inputMode`、`gradingMode`、`submitted_answers_hash`

**待修改文件：**
- `packages/db/src/schema.ts`（Drizzle schema）
- `packages/db/src/migrations/`（新 migration）
- `packages/domain/src/enums.ts`（QuestionType 新增 text_response）
- `packages/contracts/src/`（question/attempt schema 更新）

**完成标准：**
- migration 在 exam_test 上运行成功
- text_response 可以创建并保存
- submitted_answers 列可写入 SubmittedAnswersSnapshot
- rubric 在 questions 和 question_snapshots 上都存在
- `pnpm typecheck` 通过

**提交：**
```bash
git add packages/db/src/schema.ts packages/db/src/migrations/ packages/domain/src/enums.ts
git commit -m "feat(L0): schema migration — text_response type, submitted_answers column, rubric dual-layer"
```

---

### P3-L0-2：Submit Freeze 重写（submitted_answers 冻结）

**目标：** 重写 submit 事务，在提交时生成 `SubmittedAnswersSnapshot` 并写入 `submitted_answers` 列。评分从 `submitted_answers` 读取。

**类型：** 实现

**依赖：** P3-L0-1（schema 就绪）

**核心变更：**
- `submitAttempt` 事务内：读 draft answers → `buildSubmittedAnswersSnapshot()` → 写 submitted_answers → 设 status/submittedAt/submissionReason
- `gradeQuestion` / `reconcileScores` 从 submitted_answers 读取，不读 draft answers
- double submit：返回已有 submitted_answers，不重新生成
- save after submit：返回确定错误

**待修改文件：**
- `apps/api/src/orchestrators/submitAndGradeAttempt.ts`
- `packages/exam-engine/src/manualGrading.ts`（读取路径）
- `packages/exam-engine/src/grading.ts`（读取路径）
- 相关测试

**完成标准：**
- submit 后 submitted_answers 是干净快照（无 clientSeq/baseVersion）
- 评分从 submitted_answers 读取
- double submit 幂等
- save after submit 拒绝
- 所有既有测试通过

**提交：**
```bash
git add apps/api/src/orchestrators/submitAndGradeAttempt.ts packages/exam-engine/src/
git commit -m "feat(L0): submit freeze writes SubmittedAnswersSnapshot, grading reads from submitted_answers"
```

---

### P3-L0-3：Deadline Reconciliation（懒触发收口）

**目标：** 实现 `ensureAttemptDeadlineReconciled()`，在 candidate 入口事务性冻结过期 attempt。

**类型：** 实现

**依赖：** P3-L0-2（submitted_answers 冻结就绪）

**入口：**
- `GET /candidate/attempts/:attemptId/take`（Cache-Control: no-store）
- `POST /candidate/attempts/:attemptId/answers/save`
- `POST /candidate/attempts/:attemptId/submit`
- `POST /candidate/attempts/:attemptId/resume`

**事务行为：** 见 `docs/phase3/exam-protocol.md` §5.3 伪代码。

**待修改文件：**
- `apps/api/src/routes/attempts.candidate.ts`（4 个入口调用 ensureAttemptDeadlineReconciled）
- `packages/exam-engine/src/deadlineReconciliation.ts`（新文件，核心逻辑）
- 测试文件

**完成标准：**
- 4 个入口都调用 ensureAttemptDeadlineReconciled
- in_progress + expired → submitted + submitted_answers 冻结
- submittedAt = effectiveDeadline
- submissionReason = 'deadline'
- 幂等：重复调用不覆盖
- save/submit 过期返回确定错误
- 测试覆盖 14 个 deadline 场景

**提交：**
```bash
git add apps/api/src/routes/attempts.candidate.ts packages/exam-engine/src/deadlineReconciliation.ts
git commit -m "feat(L0): lazy deadline reconciliation at candidate attempt entry points"
```

---

### P3-L0-4：Backfill 脚本（submitted_answers 回填）

**目标：** 实现独立 TypeScript backfill 脚本，为已有 submitted/grading/graded/voided attempt 生成 submitted_answers。

**类型：** 实现（脚本）

**依赖：** P3-L0-1（schema）、P3-L0-2（buildSubmittedAnswersSnapshot 逻辑可复用）

**回填范围：** submitted / grading / graded / voided(with submittedAt)

**异常处理：** fail fast 默认；`--allow-quarantine` 可选

**待创建文件：**
- `scripts/backfill-submitted-answers.ts`

**完成标准：**
- dry-run 输出统计（总attempt数、已回填、跳过、异常）
- 正式运行后所有 submitted/grading/graded attempt 都有 submitted_answers
- 异常 attempt 有明确记录
- 可重复运行（幂等）

**提交：**
```bash
git add scripts/backfill-submitted-answers.ts
git commit -m "feat(L0): backfill submitted_answers for existing submitted/graded attempts"
```

---

### P3-L0-5：Publish Validation（text_response 发布校验）

**目标：** 实现题目发布前校验：text_response 必须有 rubric；auto 题必须有 standardAnswer。

**类型：** 实现 + 测试

**依赖：** P3-L0-1（schema）

**校验规则：**
- auto 题（非 text_response）：standardAnswer 非空且不是占位符
- text_response：rubric 非空且不是占位符；standardAnswer 可选
- 创建草稿时允许空值；发布时强制校验

**待修改文件：**
- 命题创建/发布相关 route 或 service
- 测试文件

**完成标准：**
- text_response 无 rubric 时发布被拒绝
- auto 题无 standardAnswer 时发布被拒绝
- "暂无" 不算有效值
- 测试覆盖所有校验分支

**提交：**
```bash
git add ...
git commit -m "feat(L0): publish validation — text_response requires rubric, auto questions require standardAnswer"
```

---

## 模块 P0 — 考生作答运行时闭环

> **前置依赖：** P-1/L0（P3-PROTO-0/1/2 + P3-L0-1/2/3/4/5）必须先完成。P0 的前端运行时只消费 P-1 定义的 CandidateTakeSnapshot 端点，不发明业务规则。前端不是业务真相源，后端仍是真相源。

### P3-FSM-0：TakeExam Frontend State Machine（L0 升级）

**目标：** 实现 TakeExam 前端状态模型：`deriveTakeExamView(snapshot)` 纯函数 + 瞬态 reducer。**L0 升级后**：消费 CandidateTakeSnapshot，不维护完整业务状态机。

**类型：** 实现

**依赖：** P3-PROTO-2（CandidateTakeSnapshot 端点）

**设计约束：**
- 后端 CandidateTakeSnapshot 是业务真相源
- `deriveTakeExamView(snapshot)` 纯函数计算页面展示态
- 瞬态 reducer 只管：idle / saving / save_failed / submitting / submit_failed / load_failed
- **不引入 XState**
- **不做完整业务 transition table**

**待创建/修改文件：**
- `apps/web/src/exam/deriveTakeExamView.ts`（纯函数）
- `apps/web/src/exam/deriveTakeExamView.test.ts`
- `apps/web/src/exam/transientReducer.ts`（瞬态 reducer）
- `apps/web/src/exam/transientReducer.test.ts`
- `apps/web/src/pages/exam/TakeExamPage.tsx`（接入）

**完成标准：**
- deriveTakeExamView 从 snapshot 派生所有 UI 态
- 瞬态 reducer 覆盖 saving/submitting/error 流程
- submitted 状态下不能 save
- submitting 状态下防重复提交
- 刷新后由 snapshot 恢复锁定态
- 测试覆盖关键边界

**提交：**
```bash
git add apps/web/src/exam/ apps/web/src/pages/exam/TakeExamPage.tsx
git commit -m "feat(P0): deriveTakeExamView + transient reducer consuming CandidateTakeSnapshot"
```

---

### P3-MOD-P0-1：考生作答渲染审计

**目标：** 为每个 MVP 题型的渲染、保存、恢复、提交行为产出精确缺口清单，包括 text_response 题型。

**类型：** 审计（无代码改动）

**待检查文件：**
- `apps/web/src/components/exam/QuestionRenderer.tsx`
- `apps/web/src/components/exam/SingleChoiceInput.tsx`
- `apps/web/src/components/exam/MultipleChoiceInput.tsx`
- `apps/web/src/components/exam/TrueFalseInput.tsx`
- `apps/web/src/components/exam/FillBlankInput.tsx`
- `apps/web/src/components/exam/SubjectiveAnswerInput.tsx`
- `apps/web/src/pages/exam/TakeExamPage.tsx`
- `apps/web/src/hooks/useSubmitFlush.ts`
- `packages/contracts/src/attempt.ts`
- `packages/domain/src/enums.ts`
- `packages/domain/src/gradingEngine.ts`

**步骤：**

1. 阅读 `QuestionRenderer.tsx` 并记录精确的分发逻辑。注意 `SubjectiveAnswerInput.tsx` 存在但**未**接入 `QuestionRenderer`。

2. 对每个渲染用例，记录：

| 渲染用例 | 编码方式 | 组件 | 作答形状 | 保存 | 恢复 | 提交 | 缺口 |
|---|---|---|---|---|---|---|---|
| `single_choice` | `type=single_choice` | `SingleChoiceInput` | `string`（option ID） | | | | |
| `multiple_choice` | `type=multiple_choice` | `MultipleChoiceInput` | `string[]`（已排序 option ID） | | | | |
| `true_false` | `type=true_false` | `TrueFalseInput` | `boolean` | | | | |
| `fill_blank`（客观） | `type=fill_blank`，`standardAnswer != null` | `FillBlankInput` | `string` 或 `Record<string,string>` | | | | |
| `text_response` | `type=text_response` | `TextResponseInput`（textarea） | `string` | | | | |

3. 确认 `packages/contracts/src/attempt.ts` 中的 `SaveAnswerRequestSchema` 把 `answer` 校验为 `z.unknown()` —— 在 API 边界无类型特定校验。这是一种设计选择（API 接受任意 JSON），不是 bug，但这意味着前端正确性完全依赖 `QuestionRenderer` 分发。

4. 确认 `packages/domain/src/enums.ts` 仅定义 4 个 `QuestionType` 值。不存在主观类型。

5. 记录 `SubjectiveAnswerInput.tsx`（78 行、完整 i18n、已测试）是孤儿——从未被 `QuestionRenderer` import。

**输出：** `docs/phase3/audit/p0-candidate-answer-rendering-audit.md`

**验证：** 审计表覆盖 5 个题型（含 text_response），并精确识别渲染缺口。

**提交：** `docs: add P0 candidate answer rendering audit`

---

### P3-MOD-P0-2：text_response 作答运行时

**目标：** 考生能用 textarea 作答 text_response 题。作答能保存、恢复并正确提交。

**类型：** 实现

**依赖：** P3-L0-1（text_response 枚举值存在）、P3-MOD-P0-1（缺口清单确认方案）

**设计决策：** text_response 是独立 `QuestionType`，不再是 fill_blank 变体。前端通过 `inputMode === 'multi_line'` 决定渲染 textarea，**不通过** `standardAnswer === null` 判断。

**待修改文件：**
- `apps/web/src/components/exam/QuestionRenderer.tsx`（新增 text_response 分支）
- `apps/web/src/components/exam/TextResponseInput.tsx`（新组件或复用 SubjectiveAnswerInput）
- `apps/web/src/components/exam/QuestionRenderer.test.tsx`

**步骤：**

1. 在 `QuestionRenderer.tsx` 的 switch 中新增 `case 'text_response'` 分支，渲染 textarea。

2. textarea 要求：
   - 保留换行（默认行为）
   - 保存/恢复后换行不丢
   - 提交后纯文本展示（`white-space: pre-wrap`）
   - 禁止 `dangerouslySetInnerHTML`

3. 加测试：text_response 渲染 textarea、保存/恢复换行、提交后锁定。

4. 运行：`pnpm --filter web test -- QuestionRenderer`

**完成标准：**
- 考生能用 textarea 作答 text_response 题
- 作答经既有协议保存
- 作答在页面刷新后恢复
- 作答正确提交
- 评分引擎正确识别其为待人工评分（gradingStatus=pending_manual）

**提交：**
```bash
git add apps/web/src/components/exam/QuestionRenderer.tsx apps/web/src/components/exam/TextResponseInput.tsx
git commit -m "feat(P0): text_response textarea rendering with save/restore/submit"
```

---

### P3-MOD-P0-3：提交冻结 UI 证明

**目标：** 验证提交后考生 UI 阻止进一步作答修改（UI 侧）。后端拒绝提交后保存的协议已由 P3-PROTO-1 场景 2 证明，本卡不重复后端测试，只补 UI 侧证明。

**类型：** 审计 + 少量 UI 测试补充

**依赖：** P3-FSM-0（前端状态机）、P3-PROTO-1（后端 save-after-submit 拒绝已证明）

**待检查文件：**
- `apps/web/src/pages/exam/TakeExamPage.tsx`（提交后 UI 状态，由 P3-FSM-0 状态机驱动）
- `apps/web/src/exam/takeExamStateMachine.ts`（P3-FSM-0 产出，确认 `submittedLocked` 态下 SAVE 被拒）

**步骤：**

1. 阅读 `TakeExamPage.tsx` 与 `takeExamStateMachine.ts`——确认提交后状态机进入 `submittedLocked`，UI 禁用作答输入，不存在"提交后编辑"路径。

2. 后端拒绝保存已由 P3-PROTO-1 场景 2 覆盖——**不重复**。仅在 UI 测试中证明：后端返回 `isEditable=false` 时，状态机进入 `submittedLocked` 且输入组件禁用。

3. 加一个 UI 测试（若不存在）：

```typescript
it("disables answer inputs when backend reports isEditable=false (submitted)", () => {
  // 后端真相：attemptStatus=submitted, isEditable=false
  render(<TakeExamPage attempt={submittedAttempt} />);
  expect(screen.getByRole("textbox")).toBeDisabled();
});
```

4. 运行：`pnpm --filter web test -- TakeExamPage`

**输出：** 确认提交冻结在 UI 侧端到端工作，且由后端真相字段驱动。

**提交（若加测试）：**
```bash
git add apps/api/src/routes/attempts/submit-freeze-proof.test.ts
git commit -m "test(P0): prove answer save rejected after submit"
```

---

### P3-MOD-P0-4：考生作答 E2E

**目标：** 一条 E2E spec 证明完整考生 happy path，包含 text_response 作答。

**类型：** E2E 测试

**依赖：** P3-MOD-P0-2（text_response 作答必须可用）

**待修改文件：**
- `apps/e2e/e2e/candidate-happy-path.spec.ts`（扩展现有 spec）

**待检查文件：**
- `apps/e2e/lib/seed.ts`（测试数据播种）
- `apps/e2e/lib/flow.ts`（可复用流程辅助）

**步骤：**

1. 阅读 `candidate-happy-path.spec.ts`。它当前只测判断题。

2. 阅读 `apps/e2e/lib/seed.ts`——理解测试考试如何播种。

3. 扩展种子数据，纳入 text_response 题：
   - 创建一个 `type: "text_response"` 的题
   - 加入考试的 `questionIds`

4. 扩展 E2E spec：
   - 在 textarea 中用自由文本作答 text_response 题
   - 验证 textarea 可见
   - 提交并验证 attempt 进入人工评分路径（`gradingStatus` 为 `pending_manual`）

5. 运行：`pnpm test:e2e -- --grep "candidate-happy-path"`

**提交：**
```bash
git add apps/e2e/e2e/candidate-happy-path.spec.ts apps/e2e/lib/seed.ts
git commit -m "test(P0): extend candidate happy path E2E with text_response answer"
```

**完成标准：** E2E 证明考生能作答客观题 + text_response 题、提交、且 attempt 进入正确的提交后状态。

---

## 模块 P1 — 人工评分闭环

### P3-MOD-P1-1：人工评分 API/UI 证明

**目标：** 证明既有人工评分 API 与 UI 能渲染 text_response 作答、保留换行、避免 XSS、保存得分、完成评分、对账总分、发出审计事件。

**类型：** 测试验证（测试已存在——运行并确认）

**待检查文件：**
- `apps/web/src/pages/admin/GradingDetailPage.tsx`（作答渲染、得分录入、保存）
- `apps/web/src/pages/admin/GradingDetailPage.test.tsx`（16 个测试：换行、XSS、作答类型）
- `apps/web/src/pages/admin/GradingQueuePage.tsx`（队列列表）
- `apps/api/src/routes/gradingQueue.ts`（API：队列、详情、grade-question）
- `apps/api/src/routes/gradingQueue.test.ts`（831 行：集成测试）
- `packages/exam-engine/src/manualGrading.ts`（gradeQuestion、reconcileScores）
- `packages/exam-engine/src/manualGrading.test.ts`（385 行）
- `packages/db/src/repository/manualGradingRepo.test.ts`（312 行）

**验证清单——确认每项被既有测试覆盖：**

| 检查项 | 预期 | 来源 |
|-------|----------|--------|
| 评分详情 API 返回 `candidateAnswer` | 来自 `attempt.answers` 的原始作答 | `gradingQueue.ts:162-186` |
| 前端把 `candidateAnswer` 显示为文本内容 | `formatAnswer()` 原样返回字符串 | `GradingDetailPage.tsx` |
| 保留换行 | `whitespace-pre-wrap` CSS 类 | `GradingDetailPage.tsx:212` |
| XSS 安全 | 无 `dangerouslySetInnerHTML`；React 文本内容 | `GradingDetailPage.test.tsx:436` |
| 空/null/数组/布尔/对象作答安全 | `formatAnswer()` 处理所有类型 | `GradingDetailPage.test.tsx` |
| 得分边界校验 | 客户端 `validateScore()` + 服务端 check 约束 | `GradingDetailPage.tsx` + DB schema |
| 得分保存 | `POST /admin/attempts/:id/grade-question` | `gradingQueue.test.ts` |
| 完全评分翻转 | `gradingStatus` 翻转为 `fully_graded` | `gradingQueue.test.ts` + `manualGrading.test.ts` |
| 对账总分 | `reconcileScores()` 折叠人工 + 自动得分 | `manualGrading.test.ts` |
| `grading.score_entered` 审计 | grade-question handler 中的 `recordAudit` | `gradingQueue.test.ts` |
| `grading.finalized` 审计 | 在 fully_graded 翻转时发出 | `gradingQueue.test.ts` |

**步骤：**

1. 运行既有测试：
   ```bash
   pnpm --filter api test -- gradingQueue
   pnpm --filter exam-engine test -- manualGrading
   pnpm --filter web test -- GradingDetailPage
   ```

2. 若全部通过，产出验证报告确认全链可用。

3. 若有任何测试损坏或缺失上表中的检查项，补上。

**输出：** `docs/phase3/audit/p1-manual-grading-proof.md`

**提交（若加/修测试）：**
```bash
git add ...
git commit -m "test(P1): verify manual grading API/UI proof"
```

---

### P3-MOD-P1-2：主观评分 E2E

**目标：** 一条 E2E spec 证明：考生提交 text_response 作答 → admin 在评分队列看到 → admin 打分 → 考生看到对账后结果。

**类型：** E2E 测试

**依赖：** P3-MOD-P0-2（text_response 作答）、P3-MOD-P1-1（评分 API/UI 证明）

**待修改文件：**
- `apps/e2e/e2e/manual-grading.spec.ts`（当前 SKIPPED——取消跳过并更新）

**步骤：**

1. 阅读既有跳过的 `manual-grading.spec.ts`。记录它测什么、为什么跳过。

2. 更新种子数据，纳入 text_response 题（`type: "text_response"`）。

3. 取消跳过 spec。更新测试流程：
   - 考生开始考试、用文本作答 text_response 题、提交
   - Admin 进入评分队列、看到待评分 attempt
   - Admin 打开评分详情、看到考生文本作答（保留换行）
   - Admin 录入得分并保存
   - Admin 完成评分（若所有题已评分）
   - 考生查看结果——看到对账后总分

4. 运行：`pnpm test:e2e -- --grep "manual-grading"`

**提交：**
```bash
git add apps/e2e/e2e/manual-grading.spec.ts
git commit -m "test(P1): unskip and complete manual grading E2E spec"
```

**完成标准：** E2E 证明完整主观评分闭环端到端可用。

---

## 模块 P2 — 考试命题闭环

### P3-MOD-P2-1：命题 UI 流程审计

**目标：** 文档化从题目创建到考试发布的完整命题流程，识别任何缺口。尤其验证 text_response 题能通过 UI 创建。

**类型：** 审计

**待检查文件：**
- `apps/web/src/pages/admin/QuestionEditPage.tsx`（题目创建表单）
- `apps/web/src/pages/admin/QuestionPage.tsx`（题库列表）
- `apps/web/src/pages/admin/ExamCreatePage.tsx`（考试创建表单）
- `apps/web/src/pages/admin/ExamEditPage.tsx`（考试编辑表单）
- `apps/web/src/pages/admin/ExamDetailPage.tsx`（考试详情 + 发布）
- `apps/web/src/components/settings/ExamConfigForm.tsx`（考试设置表单）

**步骤：**

1. 追踪题目创建流程：
   - `QuestionEditPage` → API `POST /questions` → 题目出现在 `QuestionPage` 列表
   - 验证 4 个题型都能创建（single_choice、multiple_choice、true_false、fill_blank）
   - **关键缺口检查：** UI 能创建 text_response 题吗？即：type=`text_response`。若表单不支持 text_response 类型，记录为缺口。

2. 追踪考试创建流程：
   - `ExamCreatePage` → `ExamConfigForm` → API `POST /exams`
   - 验证 `resultPublicationMode` 可配置
   - 验证 `questionIds` 可选
   - 验证 `durationMinutes`、`passingScore`、`openAt`、`closeAt` 可配置

3. 追踪发布流程：
   - `ExamDetailPage` → "发布"按钮 → API `POST /exams/:id/publish`
   - 验证发布考试出现在考生考试列表

4. 检查缺口：
   - Teacher 角色能创建题吗？（当前仅 Admin 通过 `requireRole` —— 这是预期的，Teacher 切换在 P4）
   - text_response 是否存在题目内容校验缺口？
   - 考试表单是否正确处理 text_response 题？

5. 产出流程图与缺口清单。

**输出：** `docs/phase3/audit/p2-authoring-ui-flow-audit.md`

**提交：**
```bash
git add docs/phase3/audit/p2-authoring-ui-flow-audit.md
git commit -m "docs(P2): audit exam authoring UI flow end-to-end"
```

---

### P3-MOD-P2-2：MVP 题目创建测试

**目标：** 确保题目创建与校验测试覆盖所有 MVP 题型，包括 text_response。

**类型：** 测试验证 + 补充

**待检查文件：**
- `apps/api/src/routes/question.test.ts`（既有测试）
- `apps/web/src/pages/admin/QuestionEditPage.test.tsx`（既有测试）

**步骤：**

1. 阅读 `question.test.ts`——记录创建/更新流程中测了哪些题型。

2. 检查是否测了 text_response 题创建：`type: "text_response"`。

3. 若缺失，加测试：
   ```typescript
   it("creates text_response question", async () => {
     const res = await app.inject({
       method: "POST",
       url: "/api/questions",
       payload: {
         type: "text_response",
         content: "请阐述你的观点",
         standardAnswer: null,
         rubric: "按逻辑完整性、关键概念、论证质量给分",
         options: [],
         score: 20,
       },
       cookies: { session: adminToken },
     });
     expect(res.statusCode).toBe(201);
   });
   ```

4. 运行：`pnpm --filter api test -- question`

**提交（若加测试）：**
```bash
git add apps/api/src/routes/question.test.ts
git commit -m "test(P2): add text_response question creation test"
```

---

### P3-MOD-P2-3：考试发布到考生 E2E

**目标：** 一条 E2E spec 证明：admin 创建考试 → 发布 → 考生在考试列表看到。

**类型：** E2E 测试

**待修改文件：**
- `apps/e2e/e2e/admin-flow.spec.ts`（扩展现有 spec，或新建）

**步骤：**

1. 阅读 `admin-flow.spec.ts`——它已有 4 个切片。检查是否测了发布到考生可见性。

2. 若未测，加一个测试切片：
   - Admin 通过 API 创建新考试
   - Admin 给考试加题
   - Admin 发布考试
   - 考生登录并在考试列表看到该考试
   - 考生能开始考试

3. 运行：`pnpm test:e2e -- --grep "admin-flow"`

**提交：**
```bash
git add apps/e2e/e2e/admin-flow.spec.ts
git commit -m "test(P2): add exam publish-to-candidate E2E slice"
```

---

## 模块 P3 — 结果发布闭环

### P3-MOD-P3-1：结果可见性 E2E

**目标：** 证明完整结果可见性流程：考试评分完成 → 考生看到结果（或不看到，取决于发布模式）。

**类型：** E2E 测试

**待修改文件：**
- `apps/e2e/e2e/result-publishing.spec.ts`（已存在 2 个场景——验证覆盖）

**步骤：**

1. 阅读 `result-publishing.spec.ts`——它已覆盖：
   - 场景 A：立即发布——考生提交后看到结果
   - 场景 B：手动发布——admin 发布前隐藏，之后可见
   - 幂等再发布

2. 检查是否测了 after_grading 模式。若未测，加场景：
   - 创建 `resultPublicationMode: "after_grading"` 的考试
   - 考试同时有客观题与 text_response 题
   - 考生提交 → 结果隐藏（待人工评分）
   - Admin 评主观题 → 结果变可见

3. 运行：`pnpm test:e2e -- --grep "result-publishing"`

**提交（若加测试）：**
```bash
git add apps/e2e/e2e/result-publishing.spec.ts
git commit -m "test(P3): add after_grading result visibility E2E scenario"
```

---

### P3-MOD-P3-2：考生作答/标准答案泄漏测试

**目标：** 证明考生结果视图剥离 `standardAnswer`，只展示考生被允许看到的内容。

**类型：** 测试验证

**待检查文件：**
- `apps/api/src/routes/scores.ts`（考生 vs admin 视图）
- `apps/api/src/routes/scores.test.ts`（既有测试）
- `apps/web/src/pages/exam/ResultPage.tsx`（前端展示逻辑）

**步骤：**

1. 阅读 `scores.ts`——确认考生视图剥离 `standardAnswer`：
   - Admin 看到完整 `gradingResult` 含 `standardAnswer`
   - 考生视图从响应中移除 `standardAnswer`

2. 阅读 `scores.test.ts`——确认测试验证：
   - 考生看不到 `standardAnswer`
   - 考生能看到自己的分数与通过/不通过
   - 考生看不到其他考生的结果

3. 阅读 `ResultPage.tsx`——确认前端处理被剥离的响应：
   - `standardAnswer` 为 null 时显示"manual"标签
   - 显示分数与通过/不通过状态
   - `standardAnswer` 未提供时不展示

4. 产出验证报告。

**输出：** `docs/phase3/audit/p3-candidate-answer-leak-test.md`

**提交：**
```bash
git add docs/phase3/audit/p3-candidate-answer-leak-test.md
git commit -m "docs(P3): verify candidate answer/standard-answer leak protection"
```

---

### P3-MOD-P3-3：Admin 结果视图验证

**目标：** 验证 admin 能查看完整评分结果，含标准答案。

**类型：** 测试验证

**备注：** Teacher 结果视图验证延后至 P4，在 Teacher 路由切换之后。

**待检查文件：**
- `apps/api/src/routes/scores.ts`（`computeResultVisibility` 中的 admin 绕过）
- `apps/web/src/pages/admin/ScoreListPage.tsx`（admin 分数列表）
- `apps/web/src/pages/admin/AttemptDetailPage.tsx`（admin attempt 详情）

**步骤：**

1. 阅读 `scores.ts`——确认 admin 绕过：`computeResultVisibility` 对 admin 无论发布模式都返回 visible。

2. 阅读 `scores.test.ts`——确认 admin 能在发布前查看分数。

3. 阅读 `AttemptDetailPage.tsx`——确认它展示含 `standardAnswer` 的逐题明细。

4. 产出验证报告。

**输出：** `docs/phase3/audit/p3-admin-result-view-verification.md`

**提交：**
```bash
git add docs/phase3/audit/p3-admin-result-view-verification.md
git commit -m "docs(P3): verify admin result view functionality"
```

---

## 模块 P4 — RBAC MVP 切换

### Phase 3 MVP 硬约束

- Admin 拥有完全访问。
- Teacher 是单租户/私有化部署内的**全局角色**。
- Candidate 只能访问自己的考生运行时与结果。
- 无租户作用域。
- 无课程作用域。
- 无 `teacher_exam_assignments`。
- 无 scoped 角色派单。
- 无自定义角色。
- 无 Proctor 角色激活。
- 后端仍是安全真相源；前端导航门控仅为 UX。

---

### P3-MOD-P4-1：MVP RBAC 路由矩阵

**目标：** 产出 MVP 落地的权威路由 → 权限 → 角色 → 作用域表。

**类型：** 审计 + 设计

**待检查文件：**
- `apps/api/src/authz/routeRegistry.ts`（77 个已注册路由）
- `packages/authz/src/presets.ts`（Teacher 预设含 19 个权限）
- `apps/api/src/routes/registerApiRoutes.ts`（所有路由注册）

**步骤：**

1. 阅读 `routeRegistry.ts`——提取全部 77 个路由及其计划权限与作用域。

2. 对每个 MVP 路由（命题、评分、考生运行时、结果发布），确定：
   - 当前使用的 legacy `requireRole` 门控
   - 应使用的 `requireCapability` 权限
   - 应允许的角色（Admin、Teacher、Candidate）
   - 适用的 MVP 作用域（Teacher 为全局/单租户；Candidate 为 own-attempt）

3. 按域分组：
   - **题目 CRUD：** Admin + Teacher 可创建/编辑/删除。Candidate 拒绝。
   - **考试生命周期：** Admin + Teacher 可创建/发布/关闭。Candidate 只见已发布。
   - **评分：** Admin + Teacher 可查看队列、查看详情、录入得分。
   - **考生运行时：** 仅 Candidate。强制归属。
   - **结果：** Admin + Teacher 可查看/发布。Candidate 只看自己。

4. 输出表格：

| 路由 | 当前门控 | 目标权限 | MVP 允许角色 | MVP 作用域 | 延后作用域备注 |
|---|---|---|---|---|---|

**MVP 作用域** 对 Teacher 路由应为全局/单租户，对 Candidate 路由为 `own_attempt`/`own_score`。不要设计租户/课程/考试分配作用域。

**输出：** `docs/phase3/audit/p4-mvp-rbac-route-matrix.md`

**提交：**
```bash
git add docs/phase3/audit/p4-mvp-rbac-route-matrix.md
git commit -m "docs(P4): produce MVP RBAC route → permission → role matrix"
```

---

### P3-MOD-P4-2A：评分路由切换

**目标：** 把评分路由从 `requireRole(["Admin"])` 迁移到 `requireCapability`，支持 Teacher 角色。

**类型：** 实现

**依赖：** P3-MOD-P4-1（路由矩阵被接受）

**待修改文件：**
- `apps/api/src/routes/gradingQueue.ts`（3 个 handler）

**步骤：**

1. 阅读 P3-MOD-P4-1 中评分域的路由矩阵。

2. 把 `fastify.requireRole(["Admin"])` 替换为 `fastify.requireCapability(Permission.XXX)`：
   - `GET /admin/grading-queue` → `grading.queue.view`
   - `GET /admin/attempts/:attemptId/grading-details` → `grading.detail.view`
   - `POST /admin/attempts/:attemptId/grade-question` → `grading.score.write`

3. 保留 `fastify.authenticate` 为第一个 preHandler。

4. 运行 shadow parity 测试：
   ```bash
   pnpm --filter api test -- shadowParity
   ```

5. 为 Teacher 角色加权限测试：
   ```typescript
   it("Teacher can access grading queue", async () => {
     const res = await app.inject({
       method: "GET",
       url: "/api/admin/grading-queue",
       cookies: { session: teacherToken },
     });
     expect(res.statusCode).toBe(200);
   });

   it("Candidate cannot access grading queue", async () => {
     const res = await app.inject({
       method: "GET",
       url: "/api/admin/grading-queue",
       cookies: { session: candidateToken },
     });
     expect(res.statusCode).toBe(403);
   });
   ```

6. 运行完整测试套件：`pnpm verify`

**提交：**
```bash
git add apps/api/src/routes/gradingQueue.ts
git commit -m "feat(P4-2A): cutover grading routes to requireCapability"
```

---

### P3-MOD-P4-2B：题目 CRUD 路由切换

**目标：** 把题目 CRUD 路由从 `requireRole(["Admin"])` 迁移到 `requireCapability`，支持 Teacher 角色。

**类型：** 实现

**依赖：** P3-MOD-P4-1（路由矩阵被接受）

**待修改文件：**
- `apps/api/src/routes/question.ts`（6 个 handler：list、detail、create、update、delete、import）

**步骤：**

1. 阅读题目域的路由矩阵。

2. 把每个 handler 的 `fastify.requireRole(["Admin"])` 替换为 `fastify.requireCapability(Permission.XXX)`：
   - `GET /questions` → `question.view`
   - `GET /questions/:id` → `question.view`
   - `POST /questions` → `question.create`
   - `PATCH /questions/:id` → `question.update`
   - `DELETE /questions/:id` → `question.delete`
   - `POST /questions/import` → `question.import`

3. 运行 shadow parity 测试。

4. 加权限测试：Teacher 允许、Candidate 拒绝。

5. 运行完整测试套件：`pnpm verify`

**提交：**
```bash
git add apps/api/src/routes/question.ts
git commit -m "feat(P4-2B): cutover question CRUD routes to requireCapability"
```

---

### P3-MOD-P4-2C：考试命题/生命周期路由切换

**目标：** 仅迁移 Teacher 所需的 MVP 考试命题/生命周期路由。不迁移 proctor/admin 专属操作。

**类型：** 实现

**依赖：** P3-MOD-P4-1（路由矩阵被接受）

**待修改文件：**
- `apps/api/src/routes/exam.ts`（仅选定的 handler）

**步骤：**

1. 阅读考试域的路由矩阵。识别 Teacher 需要哪些考试路由：
   - 考试 CRUD：list、detail、create、update
   - 考试发布/取消发布
   - 考试报名管理

2. **不要**迁移这些（admin 专属，延后）：
   - Proctor 监控路由
   - 考试 cancel/archive/delete
   - force-submit、extend-time、misconduct
   - 考试关闭（除非 Teacher MVP 需要）

3. 为选定 handler 把 `fastify.requireRole(["Admin"])` 替换为 `fastify.requireCapability(Permission.XXX)`。

4. 运行 shadow parity 测试。

5. 加权限测试：命题 Teacher 允许、admin 专属操作拒绝。

6. 运行完整测试套件：`pnpm verify`

**提交：**
```bash
git add apps/api/src/routes/exam.ts
git commit -m "feat(P4-2C): cutover exam authoring/lifecycle routes to requireCapability"
```

---

### P3-MOD-P4-3：考生路由保护验证

**目标：** 证明考生专属路由拒绝非考生访问，且考生只能访问自己的 attempt。

**类型：** 测试验证

**待检查文件：**
- `apps/api/src/routes/attempts.candidate.ts`（9 个 handler）
- `apps/api/src/routes/scores.ts`（考生视图）

**步骤：**

1. 阅读 `attempts.candidate.ts`——确认所有 handler 用 `requireRole(["Candidate"])`。

2. 检查归属强制：考生 A 能访问考生 B 的 attempt 吗？

3. 加/验证测试：
   ```typescript
   it("candidate cannot access another candidate's attempt", async () => {
     const res = await app.inject({
       method: "POST",
       url: `/api/attempts/${otherCandidateAttemptId}/answers/${questionId}`,
       payload: { answer: "hacked", baseVersion: 1, clientSeq: 1 },
       cookies: { session: candidateAToken },
     });
     expect(res.statusCode).toBe(403);
   });
   ```

4. 运行：`pnpm --filter api test -- attempts.candidate`

**提交（若加测试）：**
```bash
git add apps/api/src/routes/attempts.candidate.test.ts
git commit -m "test(P4): verify candidate route ownership enforcement"
```

---

### P3-MOD-P4-4：前端导航门控最小通过

**目标：** 隐藏当前用户角色不能使用的导航条目。这仅是 UX——后端落地仍是真相源。

**类型：** 实现

**依赖：** P3-MOD-P4-2A、P3-MOD-P4-2B、P3-MOD-P4-2C（后端路由已迁移）

**待修改文件：**
- `apps/web/src/components/layout/AppSidebar.tsx`（侧边栏导航）

**步骤：**

1. 阅读 `AppSidebar.tsx`——记录当前导航结构。

2. 检查前端如何获知当前用户角色（很可能来自 `GET /api/auth/me`）。

3. 加最小门控：
   - 对非 Teacher/Admin 角色隐藏"评分队列"导航项
   - 对非 Teacher/Admin 角色隐藏"题目管理"导航项
   - 对非 Admin 角色隐藏"Proctor"导航项
   - 对 Admin 保持所有项可见（兼容兜底）

4. **关键：** 这仅是 UX 隐藏。不做任何安全声明。直接 URL 访问必须依赖后端 403。

5. 验证被隐藏导航项在直接 URL 访问时仍返回 403。

**提交：**
```bash
git add apps/web/src/components/layout/AppSidebar.tsx
git commit -m "feat(P4): hide nav entries for unauthorized MVP roles (UX only)"
```

---

## 模块 P5 — Email 最小接入

### P3-MOD-P5-0：邮件收件人来源 + Outbox 入队设计 v0

**目标：** 在写任何邮件触发代码前，回答前置设计问题。

**类型：** 审计/设计（无代码改动）

**依赖：** P0–P4 完成（核心流程稳定）

**必须回答的问题：**

1. **考生邮件来源：** 考生邮箱从哪来？
   - `users.email` 列？（检查 schema 中是否存在）
   - 考生 profile/自定义字段？
   - 报名元数据？
   - 不可用 → P5-1 必须延后。

2. **EmailType 检查：** `packages/domain/src/email.ts` 是否已含 `grade_notification` 或 `result_published` 类型？
   - 若有，使用它。
   - 若无，定义所需的最小枚举新增。不要发明多个类型。
   - 实测：当前 EmailType 含 `grade_notification`，但**不含** `result_published`。

3. **服务接线：** 路由应如何访问 `EmailNotificationService`？
   - 它是否装饰在 Fastify 实例上？
   - 是否需要带 db repo/context 的工厂？
   - 除非符合既有架构，否则不要直接用 `emailSender` 实例化。
   - 实测：`apps/api/src/plugins/email.ts` 仅装饰 `emailSender`，未装饰 notificationService。

4. **事务边界：** outbox 行应与 `publishResults` 同 DB 事务插入，还是提交后尽力而为？
   - 不得让 SMTP/发送失败破坏结果发布。
   - MVP 用提交后尽力而为更安全。

5. **若无可靠收件人邮箱来源：** P5-1 必须标记为**延后**，而非实现。

**输出：** `docs/phase3/audit/p5-email-recipient-source-design.md`

**提交：**
```bash
git add docs/phase3/audit/p5-email-recipient-source-design.md
git commit -m "docs(P5): email recipient source and enqueue design v0"
```

---

### P3-MOD-P5-1：结果发布邮件触发 v0

**目标：** 当 admin 发布结果时，通过既有 outbox 入队最小邮件通知。考试事务无 SMTP 依赖。

**类型：** 实现

**依赖：** P3-MOD-P5-0（设计被接受、收件人邮箱来源已确认）

**待修改文件：**
- `apps/api/src/routes/exam.ts`（publish-results 端点）

**待检查文件：**
- `packages/domain/src/email.ts`（EmailType 枚举）
- `apps/api/src/email/notificationService.ts`（enqueueBestEffort）
- `apps/api/src/plugins/email.ts`（emailSender 装饰）

**步骤：**

1. 阅读 publish-results 端点。在 `publishResults()` 成功后，入队一封尽力而为邮件。

2. 阅读 `notificationService.ts`——确认 `enqueueBestEffort` 吞掉失败（不破坏考试事务）。

3. 用 P5-0 的设计解析收件人。不得假设 `recipientEmail` 存在——使用已确认来源。

4. 仅入队 outbox。不要内联发 SMTP。不要加后台 worker 守护进程。不要加模板引擎。仅纯文本。

5. 加测试：
   ```typescript
   it("enqueues email on publish-results", async () => {
     const res = await app.inject({ ... publish-results ... });
     expect(res.statusCode).toBe(200);
     const outbox = await emailOutboxRepo.findDuePending(ctx);
     expect(outbox.length).toBeGreaterThanOrEqual(1);
     expect(outbox[0].type).toBe("grade_notification"); // 或所选类型
   });
   ```

6. 运行：`pnpm --filter api test -- exam`

**本作业非目标：**
- 无后台 worker 守护进程
- 无邮件模板渲染（仅纯文本）
- 无邮件偏好中心
- 无多种通知类型
- 无通知历史 UI

**提交：**
```bash
git add apps/api/src/routes/exam.ts apps/api/src/routes/resultPublishing.test.ts
git commit -m "feat(P5): enqueue best-effort email on result publish"
```

---

## 模块 P6 — MVP 就绪收尾

### P3-MOD-P6-1：MVP 就绪报告

**目标：** 产出一份报告，用证据证明 Phase 3 MVP 模块闭环。

**类型：** 审计/文档

**依赖：** P0–P5 全部完成

**步骤：**

1. 运行完整 MVP E2E 套件：
   ```bash
   pnpm test:e2e
   ```

2. 运行完整单元/集成测试套件：
   ```bash
   pnpm verify
   ```

3. 对每个模块（P0–P5），按 8 点清单核对：
   - 前端入口存在
   - 后端 API 存在
   - 契约/schema 存在
   - 持久化路径可用
   - 审计事件已发出
   - 权限边界已定义
   - 测试证明存在
   - 非目标已文档化

4. 汇编报告，含：
   - 完整 MVP E2E 证据
   - 后端测试覆盖
   - 前端测试覆盖
   - 权限测试结果
   - 审计证明（关键事件）
   - 延后能力清单
   - 已知限制

**输出：** `docs/phase3/mvp-readiness-closeout.md`

**提交：**
```bash
git add docs/phase3/mvp-readiness-closeout.md
git commit -m "docs(P6): Phase 3 MVP readiness closeout report"
```

---

## 执行顺序汇总

```
批次 0 — 协议与后端状态模型收敛（P-1/L0，前端运行时的前置条件）
  ├── P3-PROTO-0  Exam Protocol Audit (L0)          [文档：exam-protocol.md]
  ├── P3-PROTO-1  Backend Consistency Tests (L0)     [测试：14 个场景]
  ├── P3-PROTO-2  CandidateTakeSnapshot Endpoint     [代码：统一端点]
  ├── P3-L0-1     Schema Migration                   [代码：text_response + submitted_answers + rubric]
  ├── P3-L0-2     Submit Freeze Rewrite              [代码：SubmittedAnswersSnapshot 冻结]
  ├── P3-L0-3     Deadline Reconciliation            [代码：懒触发收口]
  ├── P3-L0-4     Backfill Script                    [脚本：submitted_answers 回填]
  └── P3-L0-5     Publish Validation                 [代码：text_response rubric 校验]

批次 1 — 核心考试闭环（仅 Admin，依赖 P-1/L0 完成）
  ├── P3-FSM-0     deriveTakeExamView + transient    [代码：纯函数 + 瞬态 reducer]
  ├── P3-MOD-P0-1  渲染审计                           [审计]
  ├── P3-MOD-P0-2  text_response 运行时               [代码：textarea 渲染]
  ├── P3-MOD-P0-3  提交冻结证明                       [审计/测试]
  ├── P3-MOD-P0-4  考生作答 E2E                       [e2e]
  ├── P3-MOD-P1-1  人工评分 API/UI 证明               [审计/测试]
  ├── P3-MOD-P1-2  主观评分 E2E                       [e2e]
  ├── P3-MOD-P3-1  结果可见性 E2E                     [e2e]
  ├── P3-MOD-P3-2  作答/标准答案泄漏测试              [测试]
  └── P3-MOD-P3-3  Admin 结果视图验证                 [测试]

批次 2 — 命题闭环（仅 Admin）
  ├── P3-MOD-P2-1  命题流程审计                       [审计]
  ├── P3-MOD-P2-2  题目创建测试                       [测试]
  └── P3-MOD-P2-3  发布到考生 E2E                     [e2e]

批次 3 — RBAC MVP（此处起支持 Teacher）
  ├── P3-MOD-P4-1  MVP RBAC 路由矩阵                  [审计/设计]
  ├── P3-MOD-P4-2A 评分路由切换                       [代码]
  ├── P3-MOD-P4-2B 题目 CRUD 路由切换                 [代码]
  ├── P3-MOD-P4-2C 考试命题路由切换                   [代码]
  ├── P3-MOD-P4-3  考生归属证明                       [测试]
  └── P3-MOD-P4-4  前端导航门控                       [代码]

批次 4 — Email 最小接入
  ├── P3-MOD-P5-0  收件人来源 + 入队设计              [审计/设计]
  └── P3-MOD-P5-1  结果发布邮件触发                   [代码]

批次 5 — 收尾
  └── P3-MOD-P6-1  MVP 就绪报告                       [审计/文档]
```

**合计：跨 8 个模块（P-1/L0 + P0–P6）、6 个批次的 30 张作业卡。**

- **批次 0（P-1/L0）是硬前置。** 协议矩阵、schema migration、submit freeze、deadline reconciliation、CandidateTakeSnapshot 未完成前，不得开始批次 1。
- **批次 1** 从 `P3-FSM-0` 前端状态模型起步（消费 CandidateTakeSnapshot），再做 text_response 渲染。可仅 Admin 执行。
- **批次 2** 继续仅 Admin 命题验证。
- **批次 3** 通过 RBAC 切换开始支持 Teacher。
- **批次 4** 仅在核心流程稳定后开始邮件接入。
- **批次 5** 产出收尾报告。
