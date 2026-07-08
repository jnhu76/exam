# Phase 3 模块作业卡

> **取代：** `job-cards.md` 与 `job-cards-large.md` 中的能力优先作业卡。两者作为主执行队列已退役。本文档是活动执行队列。
>
> **计划权威：** `docs/phase3/plan.md` — 模块闭环计划。下方每张作业卡实现该计划中的一个派生 Middle Job。
>
> **协议优先（2026-07-03 修订）：** 模块队列在 P0 之前新增 **P-1 考试协议与后端状态模型收敛**（P3-PROTO-0/1/2）。P-1 是 P0 前端运行时的硬前置：协议矩阵与后端一致性测试未完成前，不得推进前端作答状态机（P3-FSM-0）或主观题运行时。后端是业务真相源；前端只消费后端真相字段。

> **执行基线（2026-07-07）：**
>
> - P3-PROTO-0/1/2、P3-L0-1~5 已完成。
> - P3-L0-2 的后续 corrective closure（2C/2D/2E）已完成，并建立 materialized grading workset、durable manual queue、pending-only manual completion、grading-entry-only terminal aggregation。
> - P3-FSM-0 与 P3-MOD-P0-1~4 已完成；P0 已 CLOSED。
> - 当前活动模块是 P1。P3-MOD-P1-1 已完成 rebaseline，确认 grading detail 缺少 frozen `standardAnswer` / `rubric`。
> - 在继续 P1 前，必须先完成 **P3-PROTO-0C — Accepted Grading Model Mirror Closure**，把 `exam-protocol.md` 中尚未吸收 P3-L0-2E 的旧 grading 语义镜像到已接受模型。
>
> **Corrective ownership rule：** 后置模块暴露历史协议/依赖缺口时，回到真实 owner 做 corrective closure；闭包完成后必须返回原 Job Card。不得在后置模块增加 compatibility workaround。

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
- 新增或重设计租户/学校/组织作用域模型（**现有 organization/tenant isolation 必须保留，不得因“非目标”而绕过**）
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
| `评分流水线` | submit freeze 物化 `gradingMode=manual,status=pending_manual` 的 grading entry → 进入 durable PG manual queue |

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
18. GradingStatus 独立维度（attempt-level grading lifecycle）；manual queue work authority 由 materialized grading entries 决定，不从 attemptStatus/gradingStatus 反推
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

GradingStatus (independent dimension):
  exact enum / pure-objective terminal status — 由 P3-PROTO-0C 对照 current enum + contracts 镜像，Job Card 不再复制旧 `pending_auto` 假设
  pending_manual   — attempt-level manual grading lifecycle hold
  fully_graded     — manual/mixed grading complete

Completion paths:
  objective-only exam:  由 current production terminal path + P3-PROTO-0C 镜像；最终 score authority 必须是 grading entries
  manual-only exam:     submitted (gradingStatus=pending_manual) → graded (after all manual entries complete)
  mixed exam:           submitted (gradingStatus=pending_manual) → graded (completed_auto + completed_manual entries aggregate)

Answer:
  answers            draft, mutable before submit
  submitted_answers  frozen snapshot, immutable after submit

Result:
  resultVisibility   score/pass visibility (hidden | visible)
  answerVisibility   standardAnswer/rubric visibility (hidden | visible)
```

**已接受的 grading workset 修订（P3-L0-2E）：**

```text
submitted_answers + frozen QuestionSnapshot
        ↓ submitAttempt
attempt_grading_entries
        ├── completed_auto
        └── pending_manual → completed_manual
        ↓
aggregateGradingEntries
        ↓
terminal score / gradingResult / passed
```

- manual queue predicate：`grading_mode='manual' AND status='pending_manual'`
- `gradingStatus` 描述 attempt-level grading lifecycle，**不得用于重建 question-level queue work**
- `attempt.gradingResult` 仅为 terminal denormalized projection，绝不作为 scoring input
- `gradeQuestion` 只完成 pending manual work；`completed_manual` 与 `graded + fully_graded` 在当前协议下不可由普通 gradeQuestion 修改

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

### P3-PROTO-1：Backend State Consistency Tests（L0 扩展） ✅

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
| 13 | text_response grading uses frozen submitted truth | submit-time workset 从 submitted_answers 物化 frozen candidateAnswer；grading detail/command 不读 draft answers，terminal aggregation不重评 submitted_answers |
| 14 | grading queue uses materialized work | 人工评分队列直接查询 `attempt_grading_entries` 的 manual + pending_manual work，不从 attemptStatus/gradingStatus 重建题目工作 |

**完成标准：**

- 14 个场景全部有通过的集成测试
- 测试名清晰对应协议条目
- 无既有测试被削弱

**场景覆盖映射：**

| # | 场景 | 测试文件 |
|---|------|----------|
| 1 | save before submit allowed | `protocol-consistency.test.ts` #1 |
| 2 | save after submit rejected | `candidate-save-submit.test.ts:925` + `protocol-consistency.test.ts` #2 |
| 3 | double submit idempotency | `candidate-save-submit.test.ts:524` + `protocol-consistency.test.ts` #3 |
| 4 | save/submit race | `submitFreezeBarrier.test.ts` |
| 5 | refresh after submit | `protocol-consistency.test.ts` #5 |
| 6 | candidate cannot see score before release | `scores.test.ts:261` |
| 7 | candidate cannot see standardAnswer | `candidate-save-submit.test.ts:188` + `protocol-consistency.test.ts` #7 |
| 8 | grading view sees submitted answers | `gradingQueue.test.ts:728` + `protocol-consistency.test.ts` #8 |
| 9 | deadline reconciliation via take | `deadline-scanner.test.ts` (scanner) |
| 10 | deadline reconciliation idempotent | `deadline-scanner.test.ts:390` (scanner) |
| 11 | save after deadline rejected | `candidate-save-submit.test.ts:678` + `protocol-consistency.test.ts` #11 |
| 12 | submit after deadline returns existing | `candidate-save-submit.test.ts:764` + `protocol-consistency.test.ts` #12 |
| 13 | text_response grading frozen-answer provenance | `protocol-consistency.test.ts` #13 + grading workset/poison tests |
| 14 | grading queue uses materialized work | `gradingQueue.test.ts` durable queue tests + `attemptGradingEntryRepo` query tests + grading architecture structural tests |

**提交：**

```bash
git add apps/api/src/routes/attempts/protocol-consistency.test.ts docs/phase3/job-cards-phase3-modules.md docs/phase3/plan.md
git commit -m "test(P-1/L0): backend state consistency — 14 scenarios via protocol-consistency.test.ts + existing tests"
```

---

### P3-PROTO-2：API Contract Alignment（L0 升级为 CandidateTakeSnapshot） ✅

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
- answerSource 正确路由（draft / submitted / none）
- isEditable 考虑 deadline
- 测试覆盖 all answerSource 分支
- Cache-Control: no-store header

**变更文件：**

- `packages/contracts/src/attempt.ts`（CandidateTakeSnapshot schema + CandidateTakeQuestion schema + enums）
- `apps/api/src/routes/attempts.shared.ts`（buildCandidateTakeSnapshot serialization）
- `apps/api/src/routes/attempts.candidate.ts`（新端点）
- `apps/api/src/routes/attempts/candidate-take.test.ts`（4 tests）

**提交：**

```bash
git add apps/api/src/routes/attempts.candidate.ts packages/contracts/src/attempt.ts
git commit -m "feat(P-1/L0): CandidateTakeSnapshot endpoint with answerSource routing"
```

---

### P3-PROTO-0C：Accepted Grading Model Mirror Closure（CURRENT GATE）

**目标：** 仅修订 `docs/phase3/exam-protocol.md`，把 P3-L0-2C/2D/2E 已接受并被结构测试锁定的 grading 模型镜像回协议真相源。**这是 P1 的协议前置纠偏，不修改产品代码。**

**类型：** corrective documentation closure

**真实 owner：** P3-PROTO-0（协议规格）

**依赖：** P3-L0-2E Slice 5 closure (`85de459`)；P0 closeout

**已确认的协议漂移：**

1. §3.2 / Grading Tests 仍写 manual queue 按 `gradingStatus=pending_manual` 发现 work；当前权威 work source 是 `attempt_grading_entries(grading_mode=manual,status=pending_manual)`。
2. §4.2 Submit Freeze 只写 `submitted_answers` + gradingStatus，没有记录同事务 materialize exactly one grading entry per frozen question。
3. §3.4 / §11 仍使用 `completeManualGrading`；当前 one-way completion command 是 `gradeQuestion`，最终一条 pending manual entry 完成后由同一 command 路径进入 terminal aggregation。
4. §4.1 / §4.5 “grading/result 只读 submitted_answers” 已过宽。正确 phase boundary 是：`submitted_answers` 仅是 submit-time workset materialization input；terminal score authority exclusively comes from grading entries。
5. 协议未记录 `aggregateGradingEntries` 为唯一 production terminal score aggregation seam，也未明确 `attempt.gradingResult` 仅为 terminal projection。
6. `GradingQuestionDTO` 的字段命名/来源描述需与当前 API contract 做一次精确 mirror：无论保留 `candidateAnswer` 还是改为 `submittedAnswer`，都必须明确 provenance 是 frozen submitted truth；不得从 `attempt.answers` 读取。
7. GradingStatus 枚举/纯客观题 terminal status 描述必须对照当前 `packages/domain/src/enums.ts`、contracts 和已接受生产行为逐项校正；不得凭旧文档猜测 `pending_auto` / `auto_graded`。

**步骤：**

1. READ current production + contracts:
   - `packages/domain/src/enums.ts`
   - `packages/contracts/src/attempt.ts`
   - `packages/contracts/src/score.ts`
   - `packages/exam-engine/src/attemptCommands.ts`
   - `packages/exam-engine/src/gradingWorkset.ts`
   - `packages/exam-engine/src/grading.ts`
   - `packages/exam-engine/src/manualGrading.ts`
   - `packages/db/src/repository/attemptGradingEntryRepo.ts`
   - `apps/api/src/routes/gradingQueue.ts`
   - `apps/api/src/runtime/gradingArchitecture.structural.test.ts`

2. 只修改 `docs/phase3/exam-protocol.md`，同步：
   - AttemptStatus / GradingStatus 当前枚举与 reachable pairs
   - submit freeze + atomic grading-workset materialization
   - exactly one grading entry per frozen question
   - objective `completed_auto`; text_response `pending_manual`
   - durable manual queue predicate
   - `gradeQuestion` pending-only one-way transition
   - `aggregateGradingEntries` exclusive terminal score authority
   - `gradingResult` terminal projection only
   - no reconstruction / fill-gaps / persisted-wins / runtime fallback / post-terminal re-grade
   - GradingQuestionDTO frozen metadata + frozen submitted-answer provenance
   - grading audit trigger wording
   - grading test matrix

3. 禁止以文档为由修改生产代码来“匹配旧协议”。若 current production 与 accepted L0-2E structural locks 冲突，报告 BLOCKED，不得重设计。

**完成标准：**

- 协议不再出现 “manual queue queries gradingStatus to discover work”
- 协议不再出现 `completeManualGrading` 作为当前命令
- 协议明确 submit freeze owns workset materialization
- 协议明确 terminal score authority = `attempt_grading_entries`
- 协议明确 `attempt.gradingResult` = terminal projection only
- 协议明确 `submitted_answers` 的 phase boundary：materialization input, not terminal aggregation input
- 协议明确 strict terminal manual grading / no ordinary re-grade
- `git diff` only touches `docs/phase3/exam-protocol.md`

**提交：**

```bash
git add docs/phase3/exam-protocol.md
git commit -m "docs(P-1/L0): mirror accepted grading workset protocol"
```

---

### P3-L0-1：Schema Migration + Rubric 双层存储 ✅

**目标：** 实现数据库 schema 变更：新增 text_response 枚举值、submitted_answers 列、rubric 双层存储。

**类型：** 实现（migration + schema + contract）

**依赖：** P3-PROTO-0（协议矩阵）

**变更清单：**

| 表 | 变更 |
|---|---|
| `questions` | `type` 枚举新增 `'text_response'`；新增 `rubric text` |
| `exam_attempts` | 新增 `submitted_answers jsonb`；新增 `submission_reason text nullable`；`question_snapshot` JSONB 内嵌 `QuestionSnapshot` 含 `rubric` 字段（由 `buildQuestionSnapshot()` 在 attempt 创建时冻结写入，非独立表/列） |
| `question_snapshots` | **不存在独立表**；`QuestionSnapshot.rubric` 是 JSONB 快照内字段，通过 `buildQuestionSnapshot()` 从 `questions.rubric` 复制 |

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
- rubric 同时存在于 `questions.rubric` 编辑源与 `exam_attempts.question_snapshot` 内嵌 `QuestionSnapshot.rubric` 冻结源（无独立 question_snapshots 表）
- `pnpm typecheck` 通过

**提交：**

```bash
git add packages/db/src/schema.ts packages/db/src/migrations/ packages/domain/src/enums.ts
git commit -m "feat(L0): schema migration — text_response type, submitted_answers column, rubric dual-layer"
```

---

### P3-L0-2：Submit Freeze + Materialized Grading Workset ✅

**目标：** 在 authoritative submit/freeze seam 中原子冻结 `submitted_answers`，并为 frozen QuestionSnapshot 中每道题物化 exactly one grading entry。后续 queue、manual completion 与 terminal aggregation消费已物化 work，不重新解释题型或重建分数。

**类型：** 实现 + corrective architecture closure

**依赖：** P3-L0-1

**accepted final architecture（P3-L0-2C/2D/2E 后）：**

```text
draft answers
    ↓
buildSubmittedAnswersSnapshot
    ↓
submitAttempt (authoritative freeze seam)
    ├── freeze submitted_answers
    ├── materialize exactly one grading entry per frozen question
    │     ├── objective → completed_auto
    │     └── text_response → pending_manual
    └── establish attempt/grading lifecycle
             ↓
pending manual entries → durable PG queue
             ↓
gradeQuestion consumes pending_manual only
             ↓
all entries terminal
             ↓
aggregateGradingEntries
             ↓
score + gradingResult + passed + terminal state
```

**权威约束：**

- `submitAttempt` 必须拥有 freeze + workset materialization；caller 不得独立调用 materialization。
- materialization input 仅为 frozen `submitted_answers` + frozen `QuestionSnapshot`。
- fresh submit 前不得已有 grading entries；fresh materialization 一次性 bulk-create N rows for N frozen questions。
- idempotent re-entry 不创建、不 repair、不 fill gaps；必须 exact-validate count、question ID set、gradingMode、maxScore、objective earnedScore 与合法 manual progress。
- manual queue truth：`attempt_grading_entries WHERE grading_mode='manual' AND status='pending_manual'`。
- `gradeQuestion` 仅接受 `submitted + pending_manual` attempt 上的 manual + pending_manual entry；完成后 entry → completed_manual。
- completed_manual 与 `graded + fully_graded` 不可由普通 `gradeQuestion` 再修改。
- terminal score source exclusively = grading entries。
- `QuestionSnapshot` 只拥有 expected question universe / frozen metadata / canonical ordering。
- `attempt.gradingResult` 仅为 terminal denormalized projection，绝不作为 scoring input。
- 禁止 `reconcileScores` / `reconstructObjectiveScore` / persisted-wins / fill-gaps / missing→zero / runtime compatibility。
- `computeGradingResult` 仅保留为 pending_manual response-only transient calculation；不得持久化或进入 terminal aggregation。

**主要实现 seam：**

- `packages/exam-engine/src/attemptCommands.ts` — `submitAttempt`
- `packages/exam-engine/src/gradingWorkset.ts` — materialize / consistency validation
- `packages/db/src/repository/attemptGradingEntryRepo.ts`
- `packages/exam-engine/src/manualGrading.ts` — pending-only `gradeQuestion`
- `packages/exam-engine/src/grading.ts` — `aggregateGradingEntries` / grading-entry-owned finalization
- `apps/api/src/routes/gradingQueue.ts` — durable queue + manual completion API
- `apps/api/src/runtime/gradingArchitecture.structural.test.ts`

**完成标准：**

- submit 后 `submitted_answers` 是干净快照（无 clientSeq/baseVersion）
- successful submit commit ⇒ frozen answers + complete/consistent grading workset + matching lifecycle state
- exactly one grading entry per frozen question
- objective entries synchronously completed_auto
- text_response entries pending_manual
- manual queue from durable PG grading entries
- repeated submit exact-validates workset；partial/mismatched workset fail closed
- manual completion is one-way pending-only
- pure objective and manual/mixed terminal paths share `aggregateGradingEntries`（P3-FORMAL-P0-A: 收敛到唯一 canonical terminal closure `finalizeTerminalGrading`；auto 与 manual 路径都委托给它，closure 无 auto/manual 模式参数）
- terminal score exclusively from grading entries
- gradingResult never scoring input
- no runtime fallback/dual-read/dual-write/reconstruction
- structural + poison + score-identity tests lock the authority graph

**accepted corrective commits：**

```text
cb562a2  fix(L0): hold manual-grading attempts at submitted
4ec3f45  fix(L0): reconcile mixed scores through manual completion   [historical bridge; superseded as terminal authority by L0-2E]
6e818ed  feat(L0): add materialized attempt grading entries
3ad9615  feat(L0): materialize grading workset at submit freeze
f096e28  fix(L0): make grading workset part of submit freeze
f89162c  feat(L0): drive manual grading queue from grading entries
7af5d13  fix(L0): enforce pending-only manual grading completion
220bc18  fix(L0): aggregate final scores from grading entries only
85de459  test(L0): lock durable grading workset truth (Slice 5)
```

**状态：** CLOSED. 后续模块不得重开旧 reconciliation 模型；若新证据暴露 grading protocol 漂移，回 P3-PROTO-0 owner 做文档镜像，不在 P1/P3 增加兼容路径。

---

### P3-L0-3：Deadline Reconciliation（懒触发收口） ✅

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
- 覆盖 `exam-protocol` deadline reconciliation matrix；当前 focused `deadlineReconciliation.test.ts` + protocol consistency #9-#12 提供回归证据（不得把“14 个协议总场景”误写为“14 个 deadline 场景”）

**提交：**

```bash
git add apps/api/src/routes/attempts.candidate.ts packages/exam-engine/src/deadlineReconciliation.ts
git commit -m "feat(L0): lazy deadline reconciliation at candidate attempt entry points"
```

---

### P3-L0-4：Backfill 脚本（submitted_answers 回填） ✅

**目标：** 实现独立 TypeScript backfill 脚本，为已有 submitted/grading/graded/voided attempt 生成 submitted_answers。

**类型：** 实现（脚本）

**依赖：** P3-L0-1（schema）、P3-L0-2（buildSubmittedAnswersSnapshot 逻辑可复用）

**回填范围：** submitted / grading / graded / voided(with submittedAt)

**异常处理：** fail fast 默认；`--allow-quarantine` 可选

**待创建文件：**

- `apps/api/src/scripts/backfill-submitted-answers.ts`（位于 API workspace，因为脚本依赖 `@exam/db` 和 `@exam/exam-engine` 工作区包；通过 `pnpm --filter @exam/api backfill:submitted-answers` 调用）

**完成标准：**

- dry-run 输出统计（总attempt数、已回填、跳过、异常）
- 正式运行后 supported scope（submitted / grading / graded / voided-with-submittedAt）均按规则拥有 submitted_answers 或被明确 quarantine
- 异常 attempt 有明确记录
- 可重复运行（幂等）

**提交：**

```bash
git add apps/api/src/scripts/backfill-submitted-answers.ts
git commit -m "feat(L0): backfill submitted_answers for existing submitted/graded attempts"
```

---

### P3-L0-5：Publish Validation（text_response 发布校验） ✅

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

> **状态：P0 CLOSED。** 下方已完成卡中的“步骤/待检查文件”保留为 construction history，不得把其中的历史时态（例如“当前只测判断题”）重新当作 current repository fact。当前验收基线以 P3-MOD-P0-4 Resume Verification Closure 为准。
>
> **前置依赖：** P-1/L0（P3-PROTO-0/1/2 + P3-L0-1/2/3/4/5）必须先完成。P0 的前端运行时只消费 P-1 定义的 CandidateTakeSnapshot 端点，不发明业务规则。前端不是业务真相源，后端仍是真相源。

### P3-FSM-0：TakeExam Frontend Runtime Model（legacy ID preserved） ✅

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

### P3-MOD-P0-1：考生作答渲染审计 ✅

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

1. 确认 `packages/contracts/src/attempt.ts` 中的 `SaveAnswerRequestSchema` 把 `answer` 校验为 `z.unknown()` —— 在 API 边界无类型特定校验。这是一种设计选择（API 接受任意 JSON），不是 bug，但这意味着前端正确性完全依赖 `QuestionRenderer` 分发。

2. 确认 `packages/domain/src/enums.ts` 定义 5 个 `QuestionType` 值，且 `text_response` 是独立主观文本题型。

3. 记录历史 `SubjectiveAnswerInput.tsx`/旧 subjective encoding 仅作迁移背景；当前验收以 `text_response` + multi_line runtime path 为准，不得把历史孤儿组件重新定义为业务类型。

**输出：** `docs/phase3/audit/p0-candidate-answer-rendering-audit.md`

**验证：** 审计表覆盖 5 个题型（含 text_response），并精确识别渲染缺口。

**提交：** `docs: add P0 candidate answer rendering audit`

---

### P3-MOD-P0-2：text_response 作答运行时 ✅

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
- submit freeze 按 canonical QuestionType semantics 为 text_response 物化 manual + pending_manual grading entry；backend snapshot 反映 submitted + pending_manual，前端不自行分类

**提交：**

```bash
git add apps/web/src/components/exam/QuestionRenderer.tsx apps/web/src/components/exam/TextResponseInput.tsx
git commit -m "feat(P0): text_response textarea rendering with save/restore/submit"
```

---

### P3-MOD-P0-3：提交冻结 UI 证明 ✅

**目标：** 验证提交后考生 UI 由权威 `CandidateTakeSnapshot` 恢复为不可编辑状态，并阻止所有前端保存执行路径。后端 save-after-submit 拒绝协议已由 P3-PROTO-1 场景 2 证明，本卡不重复后端协议测试。

**类型：** 审计 + 少量 UI 测试补充

**依赖：**

- P3-FSM-0（`CandidateTakeSnapshot -> deriveTakeExamView -> TakeExamPage` 已真实接入）
- P3-PROTO-1（后端 save-after-submit 拒绝已证明）
- P3-PROTO-2（权威 CandidateTakeSnapshot 端点）

**设计约束：**

- 后端 `CandidateTakeSnapshot` 是业务真相源
- 不存在 frontend `submittedLocked` 业务状态
- 不引入完整 frontend business state machine
- `transientReducer` 不保存 submitted / graded / expired / locked 等业务状态
- durable submitted lock 必须由刷新后重新获取的 `CandidateTakeSnapshot` 恢复
- `deriveTakeExamView(snapshot)` 负责派生页面锁定、保存能力和 question disabled presentation
- 输入 disabled 不能替代 save execution guard 证明

**待检查文件：**

- `apps/web/src/pages/exam/TakeExamPage.tsx`
- `apps/web/src/exam/deriveTakeExamView.ts`
- `apps/web/src/exam/transientReducer.ts`
- TakeExamPage 当前测试文件
- CandidateTakeSnapshot web client/read path
- P3-PROTO-1 save-after-submit proof tests，仅用于确认后端证明已存在，不修改

**步骤：**

1. 阅读 `TakeExamPage.tsx`，确认生产读取路径直接消费 P3-PROTO-2 返回的 `CandidateTakeSnapshot`。

2. 确认生产页面实际调用：

```ts
deriveTakeExamView(snapshot)
```

且输入是后端返回的真实 `CandidateTakeSnapshot`，不存在：

```text
LoadAttemptResponse -> CandidateTakeSnapshot
```

语义适配器。

1. 确认提交成功后的 durable lock 流程为：

```text
submit request
    ↓
submit succeeds
    ↓
reload / consume authoritative CandidateTakeSnapshot
    ↓
deriveTakeExamView(snapshot)
    ↓
locked UI
```

不得由 `SUBMIT_SUCCESS` 或 frontend business status 永久保存 submitted 状态。

1. 审计所有保存执行路径，包括：

- immediate/manual save
- autosave
- debounced save
- retry save
- 已排队或延迟执行的 save callback

确认执行 save request 前消费当前 derived `canSave` authority。

要求：

```text
view.canSave === false
    =>
save endpoint is not called
```

1. 补充或确认 UI 测试：

```ts
it("disables answer inputs when the authoritative snapshot is submitted and non-editable", ...)
```

测试必须 mock P3-PROTO-2 CandidateTakeSnapshot endpoint。

给定 submitted/non-editable snapshot：

- question controls disabled
- disabled 状态来自 derived question view
- 不从 legacy attempt status 或本地 reducer 推导

1. 补充或确认 save guard 测试：

```ts
it("does not execute save when the current derived view cannot save", ...)
```

至少覆盖 TakeExamPage 实际存在的 autosave/debounce 路径。

断言：

```ts
expect(saveRequest).not.toHaveBeenCalled();
```

仅证明 input disabled 不足以满足此项。

1. 补充或确认 refresh restore 测试：

- 首次加载 submitted/non-editable CandidateTakeSnapshot
- 页面显示 locked
- unmount
- 重新 render/reload
- 再次从 CandidateTakeSnapshot endpoint 获取 submitted/non-editable snapshot
- 页面再次显示 locked

证明 frontend memory、transient reducer 和本地业务状态均不是 durable lock 来源。

1. 确认 `transientReducer` 只包含：

```text
idle
saving
save_failed
submitting
submit_failed
load_failed
```

不得存在：

```text
submitted
submittedLocked
graded
expired
locked
```

1. 不新增后端测试。确认 P3-PROTO-1 已存在 save-after-submit 拒绝证明即可。

**完成标准：**

- TakeExamPage 直接消费真实 CandidateTakeSnapshot
- submitted/non-editable snapshot 导致作答输入 disabled
- question disabled 由 `deriveTakeExamView` 派生结果驱动
- `view.canSave=false` 时所有实际可达 save execution path 都不能发起 save request
- 提交成功后的 durable lock 来自重新获取的 CandidateTakeSnapshot
- 页面刷新后由新 snapshot 恢复锁定态
- transientReducer 不保存业务状态
- 不存在 `submittedLocked` frontend business state
- 不新增重复的后端 save-after-submit 测试

**提交：**

```bash
git add apps/web/src/pages/exam/TakeExamPage.tsx \
        apps/web/src/exam/ \
        apps/web/src/
git commit -m "test(P0): prove submitted snapshot locks candidate answer UI"
```

---

### P3-MOD-P0-4：考生作答 E2E ✅

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

> **协议前置：** P3-PROTO-0C 必须先完成。P1 不得依据 stale `reconcileScores` / `manual_grading_entries` / attempt-level queue inference 恢复旧 grading 模型。
>
> **当前状态：** P3-MOD-P1-1 rebaseline 已完成并 BLOCKED：grading details API/UI 丢弃 frozen `standardAnswer` 与 `rubric`。Corrective owner = P3-MOD-P1-1。

### P3-MOD-P1-1：人工评分 API/UI 闭环修复与证明（CURRENT）

**目标：** 在不改变 L0 grading authority 的前提下，补齐 grader 所需 frozen grading metadata，并证明 durable queue → frozen grading detail → pending-only score completion → grading-entry-only terminal aggregation 的 API/UI 闭环。

**类型：** 实现 + 测试 + verification proof

**依赖：**

- P3-PROTO-0C（accepted grading model 已镜像到协议）
- P3-MOD-P0-4 ✅
- P3-L0-2E accepted grading baseline

**confirmed production defect：**

当前 `GradingDetailsQuestionSchema` / grading-details projection 丢弃：

```text
standardAnswer
rubric
```

两者均已存在于 frozen `QuestionSnapshot`。协议要求 grader 使用 frozen grading basis；不得 JOIN live questions。

**accepted P1 authority graph：**

```text
candidate submitted + pending_manual
        ↓
attempt_grading_entries
  manual + pending_manual
        ↓
durable PG grading queue
        ↓
GET grading-details
  question metadata  ← frozen QuestionSnapshot
  candidate answer   ← grading entry frozen candidateAnswer
                        (provenance: submitted_answers at materialization)
  standardAnswer     ← frozen QuestionSnapshot
  rubric             ← frozen QuestionSnapshot
        ↓
GradingDetailPage safe plain-text rendering
        ↓
POST grade-question
        ↓
gradeQuestion
  requires submitted + pending_manual
  requires manual + pending_manual entry
        ↓
same entry → completed_manual
        ↓
remaining pending?
  YES → hold submitted + pending_manual
  NO  → aggregateGradingEntries
        ↓
graded + fully_graded
```

**禁止恢复的历史 seam：**

```text
manual_grading_entries
attempt gradingStatus → reconstruct queue work
QuestionSnapshot scan → recreate manual work
attempt.answers as grader answer truth
standardAnswer == null manual classifier
reconcileScores
reconstructObjectiveScore
persisted gradingResult wins
fill gaps
post-terminal re-grade overwrite
```

**允许修改文件：**

- `packages/contracts/src/score.ts`
- `apps/api/src/routes/gradingQueue.ts`
- `apps/api/src/routes/gradingQueue.test.ts`
- `apps/web/src/pages/admin/GradingDetailPage.tsx`
- `apps/web/src/pages/admin/GradingDetailPage.test.tsx`
- `docs/phase3/audit/p1-manual-grading-proof.md`

只有 RED 证明需要时才修改上述最小集合。不得修改 grading workset schema、queue authority、manual completion lifecycle、terminal aggregation。

**TDD / 验收步骤：**

1. **RED — frozen grader metadata contract**
   - real `text_response`
   - frozen `QuestionSnapshot.standardAnswer` 有值时，grading-details API 返回该 frozen reference answer
   - frozen `QuestionSnapshot.rubric` 返回 grader
   - live question row 后续修改不得改变 grading detail
   - candidate take/result visibility rules不得因此泄漏 rubric/standardAnswer

2. **GREEN — contract + projection**
   - grading detail 从 frozen QuestionSnapshot projection `standardAnswer` / `rubric`
   - candidate answer 继续来自 materialized grading entry frozen answer provenance
   - 不 JOIN live questions
   - 不从 draft `attempt.answers` 读取

3. **RED/GREEN — UI**
   - GradingDetailPage 显示 applicable standard answer
   - text_response 显示 rubric
   - rubric/answer 作为 React plain text；禁止 `dangerouslySetInnerHTML`
   - real `text_response` fixture 证明 multiline `whitespace-pre-wrap`
   - real `text_response` fixture 证明 script-like payload 仅按文本显示

4. **score command evidence**
   - backend authoritative score bounds：`0 <= score <= entry.maxScore`
   - missing entry fail closed
   - auto entry reject
   - completed_manual reject 409
   - graded + fully_graded reject 409
   - 不要求/不恢复 re-grade overwrite

5. **partial/final completion**
   - two manual entries: q1 complete → q2 remains pending; attempt holds submitted+pending_manual; queue count=1
   - q2 complete → both completed_manual; queue absent; attempt graded+fully_graded
   - terminal path = `aggregateGradingEntries`

6. **mixed score identity**
   - distinct objective/manual scores
   - `attempt.score == SUM(gradingResult question earned) == SUM(grading entries earnedScore)`
   - `passed` from same canonical aggregate

7. **audit evidence**
   - accepted manual completion emits `grading.score_entered`
   - partial grade: `grading.finalized` absent
   - final pending completion: `grading.finalized` present
   - actor/attempt/org metadata follows existing audit conventions
   - no candidate answer/rubric leakage into audit metadata

8. **tenant boundary**
   - preserve existing organization isolation
   - no tenant model redesign

**完成标准：**

- grader sees frozen prompt, candidate answer, applicable standardAnswer, text_response rubric, maxScore, current score/status
- real text_response preserves line breaks and XSS-safe plain-text rendering
- queue source remains pending manual grading entries
- grading detail reads no draft answers and no live question metadata
- score command completes existing pending manual entry only
- partial hold / final completion semantics preserved
- mixed final score identity proven
- score-entered/finalized audit timing proven
- strict terminal grading preserved
- no L0 grading authority changes
- focused API + engine + web tests GREEN
- full `pnpm verify` GREEN

**输出：** `docs/phase3/audit/p1-manual-grading-proof.md`

**提交：**

```bash
git add packages/contracts/src/score.ts
git add apps/api/src/routes/gradingQueue.ts apps/api/src/routes/gradingQueue.test.ts
git add apps/web/src/pages/admin/GradingDetailPage.tsx apps/web/src/pages/admin/GradingDetailPage.test.tsx
git add docs/phase3/audit/p1-manual-grading-proof.md

git commit -m "fix(P1): expose frozen grading metadata in manual grading detail"
```

---

### P3-MOD-P1-2：主观评分 E2E

**目标：** 一条真实 E2E 证明：考生提交 `text_response` → pending manual work durable 入队 → Admin 打开评分详情并看到 frozen 作答/评分依据 → 完成 pending manual work → attempt 进入 `graded + fully_graded`，最终计算结果与 grading entries 一致。

**类型：** E2E 测试

**依赖：** P3-MOD-P1-1 DONE

**重要模块边界：**

- P1 证明 **score becomes computed / attempt grading completes**。
- **P1 不要求考生立即看到结果。**
- candidate result visibility / answer visibility / release policy 属于 P3。
- 若 E2E seed 恰好使用 immediate/visible policy，可额外观察 candidate result，但不得把“candidate sees result”作为 P1 acceptance requirement。

**待修改文件：**

- `apps/e2e/e2e/manual-grading.spec.ts`（读取当前状态；若 skipped 则按当前原因解除）

**步骤：**

1. 使用真实 `type: "text_response"` + non-empty frozen rubric；可选 standardAnswer。
2. Candidate 开始考试，用 multiline plain text 作答并提交。
3. 通过 authoritative take API 证明：
   - attemptStatus=`submitted`
   - gradingStatus=`pending_manual`
4. Admin 打开 manual grading queue：
   - queue item 来自 durable pending manual grading entry
   - objective work 不出现在 manual queue
5. Admin 打开 grading details：
   - candidate answer 与提交内容一致且保留换行
   - rubric 来自 frozen QuestionSnapshot
   - applicable standardAnswer 来自 frozen QuestionSnapshot
6. Admin 对 pending manual entry 录入合法得分并提交。
7. 若存在多个 manual questions：
   - first completion 后仍 submitted+pending_manual，queue pending count 减少
   - final completion 后 graded+fully_graded，queue item 消失
8. 通过 Admin grading/result surface 或 API 验证：
   - final score = grading-entry earnedScore sum
   - gradingResult earned sum = same score
   - passed = canonical aggregate policy
9. 验证 `grading.score_entered` / final `grading.finalized` audit evidence where E2E harness supports it；若 audit UI 不暴露，API/integration evidence由 P1-1承担，不在 E2E 造旁路。
10. 不调用 post-terminal gradeQuestion 做 re-grade。
11. 不把 candidate result release 作为 P1 gate。

**运行：**

```bash
pnpm test:e2e -- --grep "manual-grading"
```

使用仓库实际 E2E runner 参数；若项目要求 `bash scripts/e2e/run-wsl.sh ...`，按现有 E2E 约定执行。

**完成标准：**

```text
candidate text_response submit
→ submitted + pending_manual
→ durable manual queue
→ grader sees frozen answer + rubric/reference answer
→ pending manual entry completed
→ graded + fully_graded
→ final score identity proven
```

**提交：**

```bash
git add apps/e2e/e2e/manual-grading.spec.ts apps/e2e/lib/
git commit -m "test(P1): complete subjective grading E2E"
```

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
   - 验证 5 个 MVP 题型都能创建（single_choice、multiple_choice、true_false、fill_blank、text_response）。
   - **关键缺口检查：** UI 的 text_response 表单是否提供 rubric 编辑并符合 publish validation；standardAnswer 保持可选。

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

**目标：** 证明完整结果可见性流程：考试评分完成后，candidate score/pass 是否可见严格由 resultVisibility / result publication policy 决定。

**类型：** E2E 测试

**待修改文件：**

- `apps/e2e/e2e/result-publishing.spec.ts`

**步骤：**

1. 验证 immediate / manual publication 现有场景。
2. 验证 after_grading mixed exam：
   - candidate submit → submitted+pending_manual；result hidden
   - Admin completes final manual work → graded+fully_graded
   - result visibility 按 after_grading policy 变为 visible
3. 证明 `score_computed != result_released`：manual completion 本身不得绕过 configured visibility policy。
4. 运行 result-publishing E2E。

**完成标准：** score/pass visibility 与 grading completion 分层正确；candidate own-result boundary 保持。

---

### P3-MOD-P3-2：Candidate Result / Answer Visibility Boundary Proof

**目标：** 证明 candidate result projection 严格分别受 `resultVisibility` 与 `answerVisibility` 门控；不得把“永远剥离 standardAnswer”误当成协议。

**类型：** API + Web 测试验证

**待检查文件：**

- `apps/api/src/routes/scores.ts`
- `apps/api/src/routes/scores.test.ts`
- `apps/web/src/pages/exam/ResultPage.tsx`

**必须证明：**

| Gate | hidden | visible |
|---|---|---|
| resultVisibility | 不返回 score/pass | 返回 score/pass |
| answerVisibility | 不返回 standardAnswer/rubric | 按协议返回 standardAnswer/rubric |

并证明：

- Candidate 只能查看自己的 result
- answer visibility 不由 `standardAnswer == null` 推断
- text_response rubric 与 applicable standardAnswer 仅在 answerVisibility 允许时返回
- frontend 只消费 projection，不自行猜 release 状态
- no grading workset/internal teacher metadata leaks beyond ResultDTO contract

**输出：** `docs/phase3/audit/p3-candidate-result-answer-visibility-proof.md`

**提交：**

```bash
git add apps/api/src/routes/scores.test.ts
git add apps/web/src/pages/exam/ResultPage.test.tsx
git add docs/phase3/audit/p3-candidate-result-answer-visibility-proof.md
git commit -m "test(P3): prove candidate result and answer visibility boundaries"
```

---

### P3-MOD-P3-3：Admin 结果视图验证

**目标：** 验证 Admin 可在 candidate release 之前查看完整 frozen grading/result projection，包括 standardAnswer、rubric 与逐题得分。

**类型：** 测试验证

**备注：** Teacher 结果视图验证延后至 P4，在 Teacher 路由切换之后。

**待检查文件：**

- `apps/api/src/routes/scores.ts`
- `apps/api/src/routes/scores.test.ts`
- `apps/web/src/pages/admin/ScoreListPage.tsx`
- `apps/web/src/pages/admin/AttemptDetailPage.tsx`

**步骤：**

1. 确认 Admin result view 按 current contract 绕过 candidate resultVisibility 门控。
2. 确认 Admin 可在发布前查看 score/pass。
3. 确认逐题明细来自 terminal gradingResult projection / frozen metadata，并包含 applicable standardAnswer、rubric、逐题 earned score。
4. 确认不 JOIN live questions 作为既有 attempt 的 grading metadata truth。
5. 产出验证报告。

**输出：** `docs/phase3/audit/p3-admin-result-view-verification.md`

**提交：**

```bash
git add docs/phase3/audit/p3-admin-result-view-verification.md
git commit -m "docs(P3): verify admin frozen result view functionality"
```

---

## 模块 P4 — RBAC MVP 切换

### Phase 3 MVP 硬约束

- Admin 拥有完全访问。
- Teacher 是单租户/私有化部署内的**全局角色**。
- Candidate 只能访问自己的考生运行时与结果。
- 不新增 tenant-scoped role assignment / tenant RBAC scope；**现有 organization isolation 继续强制执行**。
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

```text
批次 0 — 协议与后端状态模型收敛
  ├── P3-PROTO-0   Exam Protocol Audit                         ✅
  ├── P3-PROTO-1   Backend Consistency Tests                    ✅
  ├── P3-PROTO-2   CandidateTakeSnapshot Endpoint               ✅
  ├── P3-L0-1      Schema Migration                             ✅
  ├── P3-L0-2      Submit Freeze + Materialized Grading Workset ✅
  ├── P3-L0-3      Deadline Reconciliation                      ✅
  ├── P3-L0-4      Backfill Script                              ✅
  └── P3-L0-5      Publish Validation                           ✅

批次 1 — Candidate Runtime
  ├── P3-FSM-0     deriveTakeExamView + transient reducer       ✅
  ├── P3-MOD-P0-1  Candidate rendering audit                    ✅
  ├── P3-MOD-P0-2  text_response runtime                        ✅
  ├── P3-MOD-P0-3  Submit-lock UI proof                         ✅
  └── P3-MOD-P0-4  Candidate happy-path E2E                     ✅
  P0 CLOSED

Corrective gate — return to protocol owner before P1
  └── P3-PROTO-0C  Mirror accepted grading workset protocol     ← CURRENT NEXT

批次 2 — Manual Grading
  ├── P3-MOD-P1-1  Manual grading API/UI closure                ← BLOCKED defect known; run after PROTO-0C
  └── P3-MOD-P1-2  Subjective grading E2E

批次 3 — Authoring (P2)
  ├── P3-MOD-P2-1  Authoring UI flow audit
  ├── P3-MOD-P2-2  MVP question creation proof
  └── P3-MOD-P2-3  Publish-to-candidate E2E

批次 4 — Result Publication (P3)
  ├── P3-MOD-P3-1  Result visibility E2E
  ├── P3-MOD-P3-2  Candidate result/answer visibility proof
  └── P3-MOD-P3-3  Admin frozen result view proof

批次 5 — RBAC MVP
  ├── P3-MOD-P4-1
  ├── P3-MOD-P4-2A
  ├── P3-MOD-P4-2B
  ├── P3-MOD-P4-2C
  ├── P3-MOD-P4-3
  └── P3-MOD-P4-4

批次 6 — Email minimum integration
  ├── P3-MOD-P5-0
  └── P3-MOD-P5-1

批次 7 — MVP closeout
  └── P3-MOD-P6-1
```

**执行纪律：**

- P-1/L0 与 P0 已 CLOSED；不得因为旧卡文字重新施工。
- P3-PROTO-0C 是当前 corrective protocol gate。完成后返回 P3-MOD-P1-1。
- P1 只证明 grading completion / score computed；candidate result release 属于 P3。
- 模块顺序遵循 `plan.md`：P1 → P2 → P3。不得把 P3 result tasks 提前到 P2 authoring closure 之前。
- P1/P2 当前验证 actor 可使用 Admin；Teacher route/capability switch 属于 P4。保留现有 tenant isolation，但不在这些卡中重设计 org model。
- 后置 E2E 暴露历史依赖缺口时，回真实 owner corrective closure；修完返回原 RED。
