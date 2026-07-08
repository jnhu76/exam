# 考试协议地基 — P3-L0-EXAM-PROTOCOL-FOUNDATION

> **本文档是 Phase 3 P-1/L0 的正式协议规格，是 Exam / Attempt / Answer / Submit / Grading / Result Visibility 的权威协议真相源。** 所有实现必须遵循本文档；实现与本文档冲突时，以本文档为准。
>
> **协议覆盖**：本文档覆盖 21 项协议（14 原有 + 7 L0 扩展），涵盖题型模型、attempt 生命周期、答案协议、提交冻结、deadline reconciliation、DTO 边界、前端状态模型、渲染、migration 与测试矩阵。

---

## 协议覆盖索引

| # | 协议项 | 所在章节 |
|---|--------|----------|
| 1 | Exam lifecycle | §2.1 |
| 2 | Attempt lifecycle | §3 |
| 3 | Draft answers vs submitted_answers | §4.1, §4.4 |
| 4 | Save/restore protocol | §4.3 |
| 5 | Submit/freeze protocol | §4.2 |
| 6 | Double submit idempotency | §4.4.1 |
| 7 | Save after submit rejection | §4.4.2 |
| 8 | Save vs submit race | §4.4.3 |
| 9 | Refresh/resume after submit | §4.4.4, §7.4 |
| 10 | Grading workset + terminal aggregation authority | §4.2, §4.4, §6.2 |
| 11 | Result visibility | §6.3 |
| 12 | Standard answer visibility | §6.3 |
| 13 | Candidate own-result boundary | §6.4 |
| 14 | Teacher/admin grading visibility | §6.2, §6.5 |
| 15 | text_response 题型 + rubric 双层存储 | §1.5, §1.6 |
| 16 | CandidateTakeSnapshot 统一端点 | §6.1 |
| 17 | Deadline reconciliation（懒触发收口） | §5 |
| 18 | GradingStatus 独立维度 | §3.2 |
| 19 | inputMode / gradingMode 派生 | §1.2, §1.3 |
| 20 | submitted_answers 格式 | §2.3 |
| 21 | Migration 策略 | §9 |

---

## 1. 题型模型

### 1.1 QuestionType

```ts
type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'text_response';
```

| QuestionType    | 语义 | inputMode   | gradingMode | options        | standardAnswer   | rubric           |
| --------------- | ---- | ----------- | ----------- | -------------- | ---------------- | ---------------- |
| single_choice   | 选一 | choice      | auto        | required       | required         | N/A              |
| multiple_choice | 多选 | choice      | auto        | required       | required         | N/A              |
| true_false      | 判断 | boolean     | auto        | empty or fixed | required         | N/A              |
| fill_blank      | 填空 | single_line | auto        | empty          | required         | N/A              |
| text_response   | 主观文本 | multi_line | manual   | empty          | optional/null    | required at publish |

**关键约束**：`text_response` 是独立 `QuestionType`，**不是** fill_blank 变体。旧编码方式 `type=fill_blank + standardAnswer=null` 不再作为主观文本题的正式编码。

### 1.2 InputMode（派生，不存储）

由 `getInputMode(type)` 在 API 层计算，不存 DB。

```ts
function getInputMode(type: QuestionType): InputMode {
  switch (type) {
    case 'single_choice':
    case 'multiple_choice': return 'choice';
    case 'true_false': return 'boolean';
    case 'fill_blank': return 'single_line';
    case 'text_response': return 'multi_line';
  }
}
```

### 1.3 GradingMode（派生，不存储）

由 `getGradingMode(type)` 在 API 层计算，不存 DB。

```ts
function getGradingMode(type: QuestionType): GradingMode {
  switch (type) {
    case 'single_choice':
    case 'multiple_choice':
    case 'true_false':
    case 'fill_blank': return 'auto';
    case 'text_response': return 'manual';
  }
}
```

### 1.4 standardAnswer

自动评分题（single_choice / multiple_choice / true_false / fill_blank）的 standardAnswer **必填**。text_response 的 standardAnswer **可选**。`standardAnswer == null` 不再作为主观性判断依据。

### 1.5 rubric 双层存储

| 层级 | 字段 | 用途 |
| ---- | ---- | ---- |
| `questions.rubric` | 命题编辑源 | 教师创建/编辑题目时写入 |
| `QuestionSnapshot.rubric` | 冻结评分源 | attempt 创建时从 questions 复制，评分只从此处读取 |

**关键约束**：grading 视图必须从 `QuestionSnapshot` 读取 rubric，禁止 JOIN live `questions` 表。

### 1.6 发布校验

| 题型 | 发布前必须满足 |
| ---- | -------------- |
| auto 题（非 text_response） | standardAnswer 非空且不是占位符（如"暂无"） |
| text_response | rubric 非空且不是占位符；standardAnswer 可选 |

创建草稿时允许空值；发布时强制校验。

---

## 2. Exam 生命周期

### 2.1 Exam 状态（6 个值，Phase 2 已实现）

```ts
type ExamStatus =
  | 'draft'
  | 'published'
  | 'open'
  | 'closed'
  | 'canceled'
  | 'archived';
```

| 状态 | 含义 | Candidate 可开 attempt | Candidate 可见考试 |
| ---- | ---- | ---------------------- | ------------------ |
| draft | 教师/Admin 编辑中 | 否 | 否 |
| published | 已发布，未到 openAt | **是** | 是 |
| open | 已开放，now ≥ openAt | **是** | 是 |
| closed | 已结束（now ≥ closeAt 或 admin close），不再接受新 attempt | 否 | 是（仅结果，受 resultVisibility 门控） |
| canceled | **异常取消**（≠ closed） | 否 | 是（受 cancellation marker + 可见性门控，Phase 3 完整语义） |
| archived | 终态归档 | 否 | 是（结果可追溯） |

**关键语义：**
- `published` 与 `open` **不可合并**：`published` = 已发布但未到开放时间；`open` = 已到 openAt。两者都允许开 attempt（见 §2.4）。
- `canceled` ≠ `closed`：`closed` 是正常结束；`canceled` 是异常取消。canceled 考试的结果/导出需带 cancellation marker（Phase 3 完整语义）。
- `archived` 是唯一终态，只能从 `closed` 或 `canceled` 进入。

### 2.2 Transition 表（权威，镜像 `examStateMachine.ts`）

```
draft      → [published]
published  → [draft, open, canceled, archived]
open       → [closed, canceled]
closed     → [archived]
canceled   → [archived]
archived   → []  (terminal)
```

> 与 `packages/exam-engine/src/examStateMachine.ts` 的 `EXAM_VALID_TRANSITIONS` 完全一致。SPEC.md §(457–499) 明确标注 Phase 2 已实现全部 6 个状态和上述所有迁移——这是已落地行为，**不是未来设计**。

### 2.3 命令函数（9 个，全部已实现）

所有状态变化通过集中命令函数执行（`packages/exam-engine/src/examCommands.ts`），**禁止在 route 中直接 update status**。每个命令用 `assertTransition()` 校验后落库。

| 命令 | from → to | 业务 guard | 备注 |
| ---- | --------- | ---------- | ---- |
| `publishExam` | draft → published | ≥1 题；passingScore>0；duration>0；timingMode=timed_window；questionSelectionMode=manual；retakePolicy 合法；openAt<closeAt；totalScore 匹配题分和；passingScore≤totalScore | 同时构建 QuestionSnapshot |
| `openExam` | published → open | （无额外 guard，仅 transition 校验） | 手动开放 |
| `closeExam` | open → closed | | **幂等**：已 closed 原样返回（不抛错）；未解决 attempt 的 guard 在 route 层 |
| `cancelExam` | published\|open → canceled | | **不幂等**：canceled→canceled 被拒；不 void/force-submit attempt（guard 在 route 层，错误码 `EXAM_CANCEL_NOT_ALLOWED`/`UNRESOLVED_ATTEMPTS_EXIST`） |
| `unpublishExam` | published → draft | route 先 reconcile-by-now；published 但已过 openAt（逻辑上已 open）被拒（`EXAM_UNPUBLISH_NOT_ALLOWED`） | 永不接受 open→draft |
| `extendExam` | open → open（仅改 closeAt） | extendMinutes 为正整数；新 closeAt = 旧 closeAt + extendMinutes（保留剩余窗口语义） | route 先 reconcile；已过 closeAt 的 open 被拒（`EXAM_EXTEND_NOT_ALLOWED`），不可复活 |
| `archiveExam` | closed\|canceled → archived | | |
| `publishResults` | （非状态迁移） | | 设 `resultsPublishedAt`，触发 resultVisibility → visible（见 §6.3） |
| `checkAndUpdateExamStatus` | 懒触发 reconcile-by-now | published→open（now ≥ openAt）/ open→closed（now ≥ closeAt） | 在 admin 操作和 candidate 入口前调用，保证读到的是按当前时间校正后的状态 |

### 2.4 考生 attempt 边界（OPEN_STATUSES）

```ts
// packages/exam-engine/src/attemptCommands.ts:76
const OPEN_STATUSES = new Set(["published", "open"]);
// 只有 published 或 open 的 exam 才能开 attempt
```

**Candidate 可开始 attempt 的 Exam 状态：`published` 或 `open`。** 二者都允许（见 §2.1），区别仅在"是否到了 openAt"。`closed/canceled/archived/draft` 下开 attempt 被拒。

### 2.5 MVP UI 暴露范围（非协议约束）

- **协议层**：保留完整 6 态 + 全部迁移 + 9 命令——这是已实现的真相，不可收窄。
- **MVP UI**：可只暴露主路径 `draft → published → open → closed`（cancel/extend/unpublish/archive/checkAndUpdateExamStatus 可在 Admin 高级操作或仅后端触发，不强求 MVP 界面）。
- **不得**因 UI 收窄而修改协议表或删除 `canceled/archived` 状态。

### 2.6 Exam → Attempt 关系

- Exam 处于 `published` 或 `open` 时，被分配/合格的 Candidate 可以开始 attempt。
- 一个 Exam 可以有多个 Attempt（取决于 retake 策略）。
- Attempt 创建时冻结 QuestionSnapshot（含 rubric）。
- Exam 进入 `closed/canceled/archived` 后不再接受新 attempt；已有 attempt 的生命周期不受 Exam 状态变化影响（attempt 状态机独立，见 §3）。

---

## 3. Attempt 生命周期

### 3.1 AttemptStatus（8 个值）

```ts
type AttemptStatus =
  | 'not_started'
  | 'queued'
  | 'in_progress'
  | 'disrupted'
  | 'submitted'
  | 'grading'
  | 'graded'
  | 'voided';
```

| 状态 | 含义 | 下一步 |
| ---- | ---- |--------|
| not_started | 已分配但未开始 | → in_progress |
| queued | 等待批量入场（Phase 2） | → in_progress |
| in_progress | 考生正在作答，answers 可写 | → submitted, disrupted |
| disrupted | 心跳超时，考生断连 | → in_progress (resume) |
| submitted | 考生已提交，submitted_answers 已冻结 | → grading, graded |
| grading | 自动评分进行中（瞬态） | → graded |
| graded | 所有评分完成 | terminal |
| voided | 终态覆盖；`submitted_answers` **可有可无**（取决于 void 前是否提交过） | terminal |

### 3.2 GradingStatus（独立维度）

```ts
type GradingStatus =
  | 'auto_graded'
  | 'pending_manual'
  | 'fully_graded';
```

镜像 `packages/domain/src/enums.ts` `GradingStatus`。**注意**：当前协议枚举**没有** `pending_auto` 值——历史文档出现的 `pending_auto` 已被移除。纯客观 attempt 在 submit 冻结屏障即定为 `auto_graded`。

**两个维度独立**：`attemptStatus` 表示作答生命周期，`gradingStatus` 表示评分生命周期。

**关键规则（P3-L0-2E）**：`gradingStatus` 是 attempt 级评分生命周期/展示态，**不是**人工评分队列发现权威。人工评分队列的工作真相源是物化的 `attempt_grading_entries`（见 §6.2），`gradingStatus` 单独不能凭空制造队列工作项。`QuestionSnapshot` 扫描也不能重建缺失的人工工作项。

### 3.3 主路径状态流转（P3-L0-2E workset 模型）

P3-L0-2E 收口后，`grading` 态不再是人工评分的等待态。含 text_response 的 attempt 在 submit 后停在 `submitted`（`gradingStatus=pending_manual`），等待人工评分完成才进 `graded`。submit 冻结屏障在每个冻结题目物化恰好一条 `attempt_grading_entry`，作为队列与终态分数的唯一权威。

```
纯客观题：
  in_progress → submitted (gradingStatus=auto_graded)
              → graded (gradingStatus=auto_graded 或 fully_graded)
  （submit 冻结屏障物化全部 completed_auto 条目；submit 事务后由 finalizeGrading 聚合为终态；
    `grading` 态可作瞬态经过，但持久化真相是 submitted → graded）

纯 text_response：
  in_progress → submitted (gradingStatus=pending_manual)
              → graded (gradingStatus=fully_graded)
  （submit 冻结屏障物化 pending_manual 条目；停在 submitted 等待人工评分；
    最后一条 pending_manual 完成时由 gradeQuestion 终态分支聚合为 graded + fully_graded）

混合题：
  in_progress → submitted (gradingStatus=pending_manual)
              → graded (gradingStatus=fully_graded)
  （客观题物化为 completed_auto、text_response 物化为 pending_manual；
    停在 submitted；最后一条 pending_manual 完成时由 gradeQuestion 终态分支聚合为 graded + fully_graded）

Deadline 触发：
  in_progress/disrupted → submitted (submissionReason='deadline')
  （deadline reconcile 走同一 submit 冻结屏障 + 工作集物化；之后按纯客观 / 纯 text / 混合走对应路径）
```

> **`grading` 态落地语义：** `grading` 是瞬态、仅机器自动评分指示，**不**作为人工评分等待态。P3-L0-2E 之前文档把含主观题的 attempt 停在 `grading` 是历史模型，已废弃。

> **人工评分完成单向性（P3-L0-2E Slice 3C/4）：** `gradeQuestion` 是"完成一个已存在的 pending_manual 工作项"的单向命令，**不是**改分/重评命令。前置：`attempt.status=submitted && attempt.gradingStatus=pending_manual && entry.gradingMode=manual && entry.status=pending_manual`。允许的迁移：`pending_manual → completed_manual`。某条目一旦变为 `completed_manual`，普通评分命令不得再次修改（同值不视为幂等，异值不视为改分——两者均被拒）。attempt 一旦到达 `graded + fully_graded`，普通人工评分调用不得修改评分条目或终态分数/结果字段。终态后的改分/重评不在当前协议范围内，需另行定义 revision 能力。

### 3.4 命令函数

所有状态变化通过集中命令函数执行，禁止在 route 中直接 update status：

| 命令函数 | 允许的前置状态 | 事务行为 |
| -------- | -------------- | -------- |
| `startAttempt` | not_started | 锁 attempt，设 in_progress |
| `resumeAttempt` | disrupted | 锁 attempt，设 in_progress |
| `submitAttempt` | in_progress | 锁 attempt，冻结 submitted_answers，物化 grading workset，设 submitted（见 §4.2） |
| `saveAnswer` | in_progress | 锁 attempt，更新 answers（draft；submit 后永不为评分真相） |
| `markDisrupted` | in_progress | 锁 attempt，设 disrupted |
| `gradeQuestion` | attempt.status=submitted ∧ attempt.gradingStatus=pending_manual ∧ entry.gradingMode=manual ∧ entry.status=pending_manual | 单向完成一个 pending_manual 工作项：pending_manual → completed_manual；剩余 pending>0 则保持 submitted+pending_manual；剩余 pending=0 则 `aggregateGradingEntries` 聚合并写 graded+fully_graded（见 §6.6） |
| `voidAttempt` | any | 设 voided |
| `ensureAttemptDeadlineReconciled` | in_progress/disrupted | 过期则走同一 submit 冻结屏障 + 工作集物化 |

每个命令使用 transition matrix + business guard，在数据库事务内用 `FOR UPDATE` row lock 落库。

> **历史命令已移除**：旧的 `completeManualGrading` 不存在于当前生产代码。当前协议唯一的人工评分完成命令是 `gradeQuestion`（`packages/exam-engine/src/manualGrading.ts`）。任何对 `completeManualGrading` 的引用都是历史文档漂移。

---

## 4. 答案协议与提交冻结

### 4.1 两列模型

| 列 | 用途 | 可变窗口 |
| -- | ---- | -------- |
| `answers` | 草稿，Candidate 作答时写入 | `in_progress` 状态下可写 |
| `submitted_answers` | 冻结快照，评分和结果读取 | submit 事务一次性写入，之后不可变 |

> **概念态 vs 物理列名：** 下文出现的"draft answers / final answers"是**概念层**术语；统一语言以 CONTEXT.md 列名为准——`answers`（draft）与 `submitted_answers`（final）。draft/final 概念词不得用于数据库列名、DTO 字段名或 API 契约。

**SubmittedAnswersSnapshot 形状**（`submitted_answers` 列的存储格式）：

```ts
interface SubmittedAnswersSnapshot {
  schemaVersion: 1;
  answers: { questionId: string; value: unknown }[];
}
```

由 draft answers 按 question snapshot 规范化而来，**剥离协议元数据**（clientSeq / baseVersion / 时间戳）。

> **阶段边界（P3-L0-2E）**：`submitted_answers` = 冻结的提交答案真相 **+** submit 时 grading-workset 物化输入。物化之后，`attempt_grading_entries` 是权威评分真相，终态聚合不再重评 `submitted_answers`。draft `answers` 在 submit 之后永不为评分真相。详见 §4.2 与 §6.6。

### 4.2 Submit 冻结屏障（P3-L0-2E）

`submitAttempt` 是 submitted_answers 冻结 **和** grading-workset 物化的唯一权威（生产调用见 `packages/exam-engine/src/attemptCommands.ts`；结构性锁见 `apps/api/src/runtime/gradingArchitecture.structural.test.ts`）。事务内执行：

```
 1. FOR UPDATE 锁 attempt
 2. 校验 fresh submit（零已存在 grading entries）或认可的幂等重入
 3. 读取 draft answers (AnswerRecord[])
 4. 用冻结的 QuestionSnapshot 规范化为 SubmittedAnswersSnapshot
 5. 写入 submitted_answers（冻结的提交答案真相）
 6. 用冻结 submitted_answers + 冻结 QuestionSnapshot 推导预期 grading workset
 7. 物化恰好一条 attempt_grading_entry per 冻结题目：
      - objective 题 → gradingMode=auto, status=completed_auto（同步自动评分）
      - text_response → gradingMode=manual, status=pending_manual
 8. 设置 attempt.status='submitted', submittedAt=serverNow
 9. 设置 submissionReason='manual'（deadline 路径为 'deadline'）
10. 设置 attempt.gradingStatus（纯客观 → auto_graded；含 text_response → pending_manual）
11. 插入 audit log: attempt.submitted
12. 整个过程原子提交
```

**原子不变量**：

```text
成功 submit 提交
⇒
submitted_answers 已冻结
AND 完整 grading workset 已存在
AND workset 与冻结题目宇宙一致（恰好一条 entry per 冻结题目）
AND attempt 生命周期与 workset 匹配
```

**幂等重入**：不创建、不修复、不填缺。它对已存在 workset 做精确校验（条目数、题目 ID 集合、gradingMode/status/maxScore 一致）。部分/不匹配的 workset fail closed。

**禁止**：`missing → zero`、填缺、忽略多余条目、重评 submittedAnswers、reconstructObjectiveScore、reconcileScores、persisted-wins、dual-read、dual-write。这些历史语义在当前协议中均不存在。

### 4.3 Save/Restore 协议

**Save**：`POST /candidate/attempts/:attemptId/answers/save`

- 前端在每次作答变更后调用 save。
- 后端校验 `attemptStatus === 'in_progress'`，否则返回 `ATTEMPT_NOT_EDITABLE`。
- Save 是幂等的：相同 `clientSeq` + `baseVersion` 的重复 save 不产生副作用。
- Save 不触发评分，不写 `submitted_answers`。
- Save 不改变 `attemptStatus`。

**Restore**：`GET /candidate/attempts/:attemptId/take`

- 考生打开/刷新考试页面时调用 take。
- 返回 `CandidateTakeSnapshot`，其中 `answerValue` 根据 attemptStatus 路由（见 §6.1）。
- 页面刷新后，前端从 snapshot 恢复答案，不依赖本地状态。
- `isEditable=false` 时自动进入锁定态。

### 4.4 幂等性与边界规则

#### 4.4.1 Double Submit 幂等

| 场景 | 行为 |
| ---- | ---- |
| 重复 submit | 返回已有 submitted snapshot，不重新生成，不覆盖 submitted_answers，不改 submittedAt |
| double submit 不重新评分 | 已 graded 的 attempt 不因 double submit 重新计算 |

#### 4.4.2 Save After Submit 拒绝

| 场景 | 行为 |
| ---- | ---- |
| save after submit | 返回确定错误 `ATTEMPT_ALREADY_SUBMITTED`，不修改 submitted_answers |
| save after deadline | 先 reconcile（冻结为 deadline-submitted）→ 返回 `ATTEMPT_ALREADY_SUBMITTED`（attempt 已被 deadline 冻结，等价于"已提交"）。L0-3 实现决定：reconcile 在 save 入口事务内执行，冻结后 attemptStatus 已是 submitted/graded，故拒绝原因从 legacy `DEADLINE_EXCEEDED` 收敛为 `ATTEMPT_ALREADY_SUBMITTED`。两者表达同一不变量：deadline 后不接受 save。 |

#### 4.4.3 Save/Submit Race

| 场景 | 行为 |
| ---- | ---- |
| 并发 save + submit | submit 拿锁后读取当时 draft answers 并冻结；之后到达的 save 被拒绝 |
| submitted_answers 稳定性 | race 后 submitted_answers 是一组确定性快照，不再变化 |

#### 4.4.4 Refresh/Resume After Submit

| 场景 | 行为 |
| ---- | ---- |
| 刷新已提交 attempt | take 返回 `isEditable=false`，`answerSource='submitted'`，`answerValue` 来自 `submitted_answers` |
| resume disrupted | `resumeAttempt` 设 `in_progress`，take 返回 `isEditable=true`，`answerSource='draft'` |
| 刷新已 graded attempt | take 返回 `isEditable=false`，`answerSource='submitted'`，score 受 resultVisibility 门控 |

### 4.5 Draft / Final 语义（概念层）

> 术语遵循 §4.1：概念态 draft/final 对应物理列 `answers`/`submitted_answers`（CONTEXT.md 列名为统一语言真相）。draft answers = `answers` 列；final answers = `submitted_answers` 列。`answers` 列的 `_Avoid_: draft column`；`submitted_answers` 列的 `_Avoid_: final answers / locked answers / grading answers`。

- grading 读取 `submitted_answers`，**不读** `answers`
- CandidateTakeSnapshot 在 submitted 后返回 `submitted_answers` 的值，**不再返回** draft `answers`
- 前端提交成功后必须用服务端返回的新 snapshot 覆盖本地显示

---

## 5. Deadline Reconciliation

### 5.1 触发条件

```
attemptStatus in ('in_progress', 'disrupted')
&& serverNow >= effectiveDeadline
```

`effectiveDeadline` = min(exam deadline, attempt deadline, extension-adjusted deadline)，从现有字段派生，不新建 deadline 模型。

**P0-C 可空 deadline 语义（权威）**：`attempt.deadlineAt = NULL` 是合法的 active 协议状态，其 Effective Deadline 为 `exam.closeAt`。即：

```
EffectiveDeadline(exam, attempt) =
  attempt.deadlineAt == NULL
    ? exam.closeAt
    : min(exam.closeAt, attempt.deadlineAt)
```

此语义为内联 reconciliation 与 deadline scanner 候选发现的**共同权威**。Scanner 候选发现谓词为：

```
exam.closeAt <= now
OR
(attempt.deadlineAt IS NOT NULL AND attempt.deadlineAt <= now)
```

对全部 scanner-eligible active attempt 满足 `CanonicalExpired <=> ScannerCandidate`（含 NULL deadline 情形）。Phase 1 `timed_window` 下普通生产路径在 attempt 创建时即写入非空 `deadlineAt`（`startedAt + durationMinutes`），故 NULL active attempt 当前不可经普通生产达到；本语义同时作为对未来 timing mode / legacy 数据的防御性兜底。

### 5.2 入口

以下 4 个 candidate 端点共享 `ensureAttemptDeadlineReconciled(attemptId, serverNow)`：

| 端点 | 写副作用 |
| ---- | -------- |
| `GET /candidate/attempts/:attemptId/take` | 可能触发 reconciliation |
| `POST /candidate/attempts/:attemptId/answers/save` | 可能触发 reconciliation |
| `POST /candidate/attempts/:attemptId/submit` | 可能触发 reconciliation |
| `POST /candidate/attempts/:attemptId/resume` | 可能触发 reconciliation |

**GET 写副作用警告**：`GET /take` 是 command-style GET，可能触发事务写入。响应必须包含 `Cache-Control: no-store`。SWR、prefetch、CDN、HTTP cache 禁用此端点。

### 5.3 事务行为

```ts
async function ensureAttemptDeadlineReconciled(attemptId: string, now: Date) {
  return db.transaction(async (tx) => {
    const attempt = await getAttemptForUpdate(tx, attemptId);

    if (!isExpired(attempt, now)) return attempt;

    if (['submitted', 'grading', 'graded'].includes(attempt.status)) return attempt;
    if (['voided', 'not_started', 'queued'].includes(attempt.status)) return attempt;

    const questionSnapshot = await loadAttemptQuestionSnapshot(tx, attemptId);
    const submittedAnswers = buildSubmittedAnswersSnapshot({
      draftAnswerRecords: attempt.answers,
      questionSnapshot,
    });
    const gradingPlan = deriveGradingPlan(questionSnapshot);

    // P3-L0-2E: deadline reconcile 走与手动 submit 相同的冻结屏障 +
    // grading-workset 物化。submitAttempt 是唯一物化权威，故此处调用
    // submitAttempt（submissionReason='deadline'）而非直接 mark。
    const next = await submitAttempt(tx, {
      attemptId,
      submittedAnswers,
      submittedAt: effectiveDeadline(attempt),
      submissionReason: 'deadline',
    });
    // submitAttempt 在事务内冻结 submitted_answers、物化 workset、
    // 设置 attempt.status='submitted'、gradingStatus（auto_graded 或
    // pending_manual）。纯客观 attempt 之后由 finalizeGrading 聚合到 graded；
    // 含 text_response 的 attempt 停在 submitted+pending_manual 等人工评分。

    await audit(tx, {
      action: 'attempt.deadline_reconciled',
      attemptId,
      effectiveAt: effectiveDeadline(attempt),
      occurredAt: now,
    });

    return next;
  });
}
```

### 5.4 时间语义

- `submittedAt` = `effectiveDeadline`（业务生效时间）
- `audit.occurredAt` = 实际 reconciliation 时间（系统收口时间）
- `submissionReason` = `'deadline'`（区分考生手动提交）

### 5.5 Save/Submit 过期行为

| 操作 | 行为 |
| ---- | ---- |
| save 过期 | 先 reconcile（冻结为 deadline-submitted）→ 返回 `ATTEMPT_ALREADY_SUBMITTED`（L0-3 实现决定：reconcile 在 save 入口事务内冻结，attemptStatus 已是 submitted/graded）。可附带最新 CandidateTakeSnapshot。 |
| submit 过期 | 先 reconcile → 返回已有 deadline-submitted snapshot；不接受新答案 payload |

### 5.6 不处理的状态

| 状态 | 行为 |
| ---- | ---- |
| not_started / queued | 不生成 submitted_answers；返回 cannot start / deadline locked |
| submitted / grading / graded | 已冻结，返回现有 submitted_answers |
| voided | terminal，不做 reconciliation；`submitted_answers` 可有可无（void 前是否提交过而定），下游 grading/backfill 必须容错处理 |

---

## 6. DTO 边界与可见性

### 6.1 CandidateTakeSnapshot

`GET /candidate/attempts/:attemptId/take` 的统一响应。后端安全投影层根据 attemptStatus 选择返回哪个答案。

**派生能力字段公式（服务端计算，前端只消费）：**

```ts
// isEditable 钉死公式（CONTEXT.md:68），服务端计算，前端不得自行推断
isEditable = attemptStatus === 'in_progress' && serverNow < effectiveDeadline;

// 字段关系
canSave ⊆ isEditable;        // canSave 是 isEditable 的子集（CONTEXT.md:71）
canResume 仅当 attemptStatus === 'disrupted';
canSubmit 仅当 attemptStatus in ('in_progress', 'disrupted') && serverNow < effectiveDeadline;
lockReason 仅当 isEditable === false 时存在（'deadline' | 'submitted' | 'voided' | 'disrupted'）;
```

```ts
interface CandidateTakeSnapshot {
  attemptId: string;
  examId: string;
  attemptStatus: AttemptStatus;
  gradingStatus: GradingStatus;
  isEditable: boolean;
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
  inputMode: InputMode;  // 派生值
  maxScore: number;
  answerValue: unknown | null;
  answerSource: 'draft' | 'submitted' | 'none';
}
```

**安全投影规则**：
- 不返回 `standardAnswer`
- 不返回 `rubric`
- 不返回 `gradingMode`
- 不返回 `correctOption`
- 不返回未发布的 score
- 不返回 teacher notes

**答案来源路由**：
- `in_progress` → `answerValue` 来自 draft `answers`，`answerSource = 'draft'`
- `submitted` / `grading` / `graded` → `answerValue` 来自 `submitted_answers`，`answerSource = 'submitted'`
- `not_started` / `queued` / `voided` → `answerValue = null`，`answerSource = 'none'`
- `disrupted` → 返回 draft answers，但 `isEditable = false`

### 6.2 GradingDetails（人工评分详情）

`GET /admin/attempts/:attemptId/grading-details` 的响应。生产 contract 为 `GradingDetailsResponseSchema`（`packages/contracts/src/score.ts`）。

**实际 wire 字段**（镜像当前 contract，请勿按偏好重命名）：

```ts
interface GradingDetailsQuestion {
  questionId: string;          // 来自冻结 QuestionSnapshot.originalQuestionId
  type: QuestionType;          // 来自冻结 QuestionSnapshot
  content: string;             // 题目 prompt，来自冻结 QuestionSnapshot
  maxScore: number;            // 来自冻结 QuestionSnapshot.score
  candidateAnswer: unknown | null;   // 来自 attempt_grading_entries.candidateAnswer
  entry: {                     // null 直到该题已评分
    score: number;             //   entry.earnedScore
    comment: string;
    gradedBy: string;
    gradedAt: string;
  } | null;
}
```

**candidateAnswer 溯源**：DTO 字段名 `candidateAnswer` 来自 **`attempt_grading_entries.candidateAnswer`**（在 submit 冻结屏障从 `submitted_answers` 物化写入），**不**意味着 draft `attempt.answers`。draft `answers` 永不为评分真相。graded detail 不读取 draft `attempt.answers`，也不 JOIN live `questions` 表。

**评分者可见元数据要求（协议级，P3-L0-1 + 当前 P1 模块要求）**：评分者需要看到：

```text
prompt（content）
冻结的 candidate answer
适用的 standardAnswer
text_response 的 rubric
maxScore
当前评分分数/状态
```

上述元数据必须来自冻结 `QuestionSnapshot`（`QuestionSnapshot.standardAnswer`、`QuestionSnapshot.rubric`），不得 JOIN live `questions` 表。协议级要求 `rubric` 为 text_response 的冻结评分元数据（§1.5）。Candidate 可见性由 result/answer visibility 单独控制（§6.3），grader 元数据不通过 CandidateTakeSnapshot 泄漏（§6.1 安全投影）。

> **实现差距记录**：当前 `GradingDetailsQuestionSchema` 与 grading-details 路由投影**尚未**投影 `standardAnswer` 与 `rubric`（两者在冻结 `QuestionSnapshot` 中已存在）。这是 P3-MOD-P1-1 已确认的生产缺陷（评分者缺少冻结评分依据），由 P1-1 修复——本协议要求不变。

**教师/管理员评分可见性**：教师/管理员在评分视图中能看到考生已提交答案（来自冻结 entry 的 candidateAnswer），不受考生可见性策略约束。

### 6.3 ResultDTO

`GET /candidate/attempts/:attemptId/result` 的响应。受 resultVisibility / answerVisibility 门控。

| 条件 | 返回 |
| ---- | ---- |
| resultVisibility = hidden | 不返回 score / pass |
| resultVisibility = visible | 返回 score / pass |
| answerVisibility = hidden | 不返回 standardAnswer / rubric |
| answerVisibility = visible | 返回 standardAnswer / rubric |

### 6.4 Candidate Own-Result 边界

- 考生**只能**看到自己的分数/结果，且仅在发布策略允许时。
- `GET /candidate/attempts/:attemptId/result` 强制归属校验：attempt 必须属于当前 Candidate。
- 考生**不能**通过任何 API 路径访问其他考生的 attempt、答案或结果。
- `score_computed` ≠ `result_released`：评分完成只产生可计算的分数；是否对考生可见由发布策略与发布动作决定。

### 6.5 Teacher/Admin 结果视图

- 教师/管理员可查看所有考生的评分结果。
- Admin 视图绕过 resultVisibility 门控（发布前也可查看）。
- 教师/管理员视图包含 standardAnswer、rubric、逐题得分明细。

### 6.6 终态分数聚合权威（P3-L0-2E Slice 4）

```text
aggregateGradingEntries
=
唯一的生产终态分数聚合 seam
```

生产实现：`packages/exam-engine/src/gradingWorkset.ts` `aggregateGradingEntries`。结构性锁：`apps/api/src/runtime/gradingArchitecture.structural.test.ts`。

P3-FORMAL-P0-A 收敛（2026-07-07）：`aggregateGradingEntries` 现在只有 **1 个** 生产调用点 —— `finalizeTerminalGrading`（`packages/exam-engine/src/grading.ts`）。此前有两个直接调用点（`finalizeGrading` 与 `gradeQuestion` 终态分支）；两者现在都委托给同一个 canonical terminal closure。closure 不接受 auto/manual 模式参数，其唯一前置条件是「权威终态 workset 已就绪」（由 `aggregateGradingEntries` 自身的逐条终态校验保证）。同一结构性测试还断言：`enrollment.{finalScore, finalPassed, finalAttemptId}` 的运行期写入点唯一来自 `finalizeTerminalGrading`（writer-inventory allowlist = `{ grading.ts }`）。

历史调用点计数（2）在此修订前有效；本节描述的「终态分数聚合权威」语义不变，只是收敛到单一 closure seam 以修复 manual 路径下 `enrollment` 投影从未被写入的缺陷。

**输入**：

```text
attempt_grading_entries（终态、已物化）
冻结的 QuestionSnapshot（题目宇宙/元数据/排序）
passingScore / 当前规范的 pass 策略输入
```

**分数来源**：

```text
grading entry earnedScore（仅此一项）
```

**题目宇宙/排序/元数据来源**：

```text
冻结的 QuestionSnapshot
```

**聚合前校验（fail closed）**：

```text
entry count == 冻结题目数
题目 ID 集合精确匹配
每个冻结题目恰好一条有效 entry
entry.maxScore == 冻结 maxScore
gradingMode 与题目规范语义匹配
auto entry status == completed_auto
manual entry status == completed_manual
earnedScore != null
0 <= earnedScore <= maxScore
```

**禁止**：

```text
missing → zero
填缺
忽略多余 entry
reconstruct objective score
reconcileScores（已删除）
persisted gradingResult wins
```

缺失 entry → fail closed。多余 entry → fail closed。pending_manual entry → 不是终态聚合输入。

最终投影 `questionResults` 按冻结 QuestionSnapshot 排序。`attempt.score = aggregated.totalScore`、`attempt.gradingResult = aggregated.questionResults`、`attempt.passed = aggregated.passed`。

**`attempt.gradingResult` 角色**：

```text
attempt.gradingResult = 终态去规范化投影
```

允许：candidate/admin 结果读取、export/read 投影、终态投影持久化。

禁止：评分输入、人工分数来源、workset 物化来源、队列发现来源、终态聚合输入。

> 生产结构性证明：`gradingArchitecture.structural.test.ts` 断言 `aggregateGradingEntries` 函数体永不读取 `attempt.answers` / `attempt.submittedAnswers` / `attempt.gradingResult`，只读 `attempt.id` + `attempt.questionSnapshot`。stale `gradingResult` poison 测试（`gradingPoison.test.ts`）证明零分投影不能覆盖 entry 真相。

**`computeGradingResult` 保留语义**：`computeGradingResult` 仅保留为非持久的 `pending_manual` 响应计算（`gradeAttemptIdempotent` 的部分分数响应分支）。它**不是**终态分数权威，永不持久化。

### 6.7 人工评分队列权威（P3-L0-2E）

人工评分队列的工作真相源是物化的 `attempt_grading_entries`，**不是** `gradingStatus`、**不是** `QuestionSnapshot` 扫描。

**精确谓词**：

```text
attempt_grading_entries.grading_mode = 'manual'
AND attempt_grading_entries.status = 'pending_manual'
AND organization_id = <caller org>   -- tenant 边界
```

生产实现：`packages/db/src/repository/attemptGradingEntryRepo.ts` `listPendingManualQueue` / `countPendingManualQueue`。公共形状按 attempt 分组（`GradingQueueItem`：每 attempt 一行，含 `pendingQuestionCount`）。

**关键约束**：

```text
attempt.gradingStatus 可描述 attempt 级生命周期/展示态
但它不能凭空制造或重建人工队列工作项
```

`gradingStatus=pending_manual` 但无 `pending_manual` grading entry 的 attempt **不**出现在队列中（生产测试 `gradingQueue.test.ts` ghost-attempt 守卫）。`QuestionSnapshot` 扫描不能重建缺失的人工工作项。

**队列持久性**：队列由 PostgreSQL `attempt_grading_entries` 表支撑，进程/请求重载后工作不丢（durable）。

---

## 7. 前端状态模型

### 7.1 原则

**四层事实源链（CONTEXT.md:63）：**
1. **DB 是事实源**——`answers`/`submitted_answers`/`status` 等列是真相；
2. **领域状态机定义允许的转换**——`examStateMachine.ts`/`attemptStateMachine.ts` 决定哪些迁移合法；
3. **API 返回派生能力**——CandidateTakeSnapshot 暴露 `isEditable`/`canSubmit`/`resultVisibility` 等派生字段；
4. **前端消费派生能力，不读原始 DB 状态**——前端永不直接读 status/answers 列，只消费 snapshot 的派生字段。

**前端运行时约束：**
- 后端 CandidateTakeSnapshot 是**业务真相源**
- 前端用纯函数 `deriveTakeExamView(snapshot)` 计算页面展示态
- 前端 reducer **只管瞬态**，不复制后端 AttemptStatus

### 7.2 派生视图

```ts
function deriveTakeExamView(snapshot: CandidateTakeSnapshot) {
  return {
    questions: snapshot.questions.map(q => ({
      ...q,
      disabled: !snapshot.isEditable,
      inputMode: q.inputMode,  // 后端已派生
    })),
    canSave: snapshot.isEditable,
    canSubmit: snapshot.canSubmit,
    isLocked: !snapshot.isEditable,
    lockReason: snapshot.lockReason,
    showResult: snapshot.resultVisibility === 'visible',
    showAnswers: snapshot.answerVisibility === 'visible',
    answerSource: snapshot.answerSource,
  };
}
```

### 7.3 瞬态 Reducer

```ts
type TransientState =
  | 'idle'
  | 'saving'
  | 'save_failed'
  | 'submitting'
  | 'submit_failed'
  | 'load_failed';

type TransientEvent =
  | 'SAVE_REQUEST'
  | 'SAVE_SUCCESS'
  | 'SAVE_FAILED'
  | 'SUBMIT_REQUEST'
  | 'SUBMIT_SUCCESS'
  | 'SUBMIT_FAILED'
  | 'LOAD_FAILED'
  | 'RESET';
```

转换规则：
- `idle` + `SAVE_REQUEST` → `saving`
- `saving` + `SAVE_SUCCESS` → `idle`
- `saving` + `SAVE_FAILED` → `save_failed`
- `idle` + `SUBMIT_REQUEST` → `submitting`
- `submitting` + `SUBMIT_SUCCESS` → `idle`（然后用 snapshot 重算 derived）
- `submitting` + `SUBMIT_FAILED` → `submit_failed`
- 任何状态 + `RESET` → `idle`

**禁止的转换**：
- `submitting` 状态下不能再次触发 `SUBMIT_REQUEST`（防重复点击）
- `submitted` snapshot 下不能触发 `SAVE_REQUEST`

### 7.4 刷新恢复

页面刷新后，前端调用 `GET /candidate/attempts/:attemptId/take` 获取最新 snapshot。`isEditable=false` 时自动进入锁定态。前端不靠本地状态判断 attempt 是否可编辑。

---

## 8. 前端运行时渲染

### 8.1 题型 → 控件映射

| QuestionType | inputMode | 渲染控件 |
| ------------ | --------- | -------- |
| single_choice | choice | radio |
| multiple_choice | choice | checkbox |
| true_false | boolean | true/false toggle |
| fill_blank | single_line | `<input type="text">` |
| text_response | multi_line | `<textarea>` |

### 8.2 text_response 要求

- 保留换行（textarea 默认行为）
- 保存/恢复后换行不丢
- 提交后纯文本展示（`white-space: pre-wrap`）
- 禁止 `dangerouslySetInnerHTML`
- 评分视图按纯文本显示，防 XSS

---

## 9. Migration 策略

### 9.1 Drizzle Migration（仅结构变更）

- `questions` 表：`type` 枚举新增 `'text_response'`，新增 `rubric text`
- `exam_attempts` 表：新增 `submitted_answers jsonb`，`submission_reason text nullable`
- **无独立 `question_snapshots` 表**：`QuestionSnapshot.rubric` 作为 JSONB 内嵌字段存储在 `exam_attempts.question_snapshot` 列中，由 `buildQuestionSnapshot()` 在 attempt 创建时从 `questions.rubric` 冻结写入

### 9.2 Backfill 脚本（独立 TypeScript）

**回填范围**：所有具有提交语义的 attempt — `submitted` / `grading` / `graded` / `voided`（with non-null `submittedAt`）。

**格式转换**：从 `AnswerRecord[]` 规范化为 `SubmittedAnswersSnapshot`，复用 `buildSubmittedAnswersSnapshot()` 逻辑。

**异常处理**：
- 合法 AnswerRecord[] → 按 snapshot 规范化
- 考生确实没作答 → 生成包含所有题目的 null/empty value 快照（合法空作答）
- answers 格式异常 → **fail fast 默认**，记录 attemptId + 原因
- `--allow-quarantine` 模式下，异常 attempt 写入 quarantine 报告

**上线顺序**：
1. schema migration 加列
2. 代码兼容读取（优先 submitted_answers，fallback answers + warning）
3. dry-run backfill，输出统计
4. 正式 backfill
5. 测试确认 submitted/grading/graded 都有 submitted_answers
6. 后续移除 fallback

---

## 10. 测试矩阵

### Question Model Tests
- [ ] 可以创建 text_response
- [ ] text_response 必须是 multi_line + manual
- [ ] fill_blank 默认是 single_line + auto
- [ ] 自动评分题缺少 standardAnswer 时不能发布
- [ ] text_response 发布时 rubric 必填

### Candidate API Tests
- [ ] candidate take exam API 不返回 standardAnswer
- [ ] candidate take exam API 不返回 rubric
- [ ] text_response 返回 inputMode=multi_line
- [ ] submitted attempt 返回 isEditable=false
- [ ] submitted attempt 返回 canSubmit=false

### Save/Restore Tests
- [ ] text_response 可以保存
- [ ] text_response 刷新/恢复后内容一致
- [ ] text_response 保留换行
- [ ] 空字符串/超长字符串/畸形 payload 有确定行为
- [ ] save 在 in_progress 外被拒绝
- [ ] 幂等 save（相同 clientSeq+baseVersion）不产生副作用

### Submit/Freeze Tests
- [ ] submit 冻结 submitted_answers
- [ ] submit 后 save 被拒绝
- [ ] double submit 幂等
- [ ] double submit 不改变 submitted_answers
- [ ] double submit 不改变 submittedAt
- [ ] save/submit race 后 submitted_answers 稳定
- [ ] submit 后 answerSource 切换为 'submitted'
- [ ] submit 后 CandidateTakeSnapshot 不返回 draft answers

### Deadline Reconciliation Tests
- [ ] in_progress + before deadline → isEditable=true
- [ ] in_progress + after deadline via take → reconciled to submitted
- [ ] disrupted + after deadline via take/resume → reconciled to submitted
- [ ] reconciliation writes submitted_answers
- [ ] reconciliation uses draft answers saved before deadline
- [ ] reconciliation does not accept new save payload after deadline
- [ ] save after deadline returns locked snapshot/error
- [ ] submit after deadline returns existing deadline-submitted snapshot
- [ ] reconciliation is idempotent
- [ ] repeated take after reconciliation does not rewrite submittedAt/submitted_answers
- [ ] pure objective expired attempt can be auto-graded
- [ ] text_response expired attempt becomes submitted + pending_manual
- [ ] CandidateTakeSnapshot after reconciliation returns answerSource='submitted'
- [ ] CandidateTakeSnapshot after reconciliation never returns standardAnswer/rubric

### Grading Tests（P3-L0-2E workset 模型）
- [x] submit 冻结屏障物化恰好一条 grading entry per 冻结题目（`gradingWorkset.test.ts`）
- [x] objective 题 → completed_auto；text_response → pending_manual（`gradingWorkset.test.ts`）
- [x] partial workset fail closed（`gradingAggregation.test.ts` C/D/E）
- [x] pending_manual 条目不是终态聚合输入（`gradingAggregation.test.ts` F）
- [x] submitted_answers 提供冻结提交答案溯源 at workset 物化（`gradingWorkset.test.ts` "uses submittedAnswers exclusively"）
- [x] grading detail 消费物化的冻结 candidateAnswer（`gradingQueue.test.ts:997`）
- [x] 终态聚合只消费 grading entries（`gradingScoreIdentity.test.ts`、`gradingAggregation.test.ts`）
- [x] draft answers 不能影响终态（`gradingPoison.test.ts` draft-answer poison）
- [x] submittedAnswers 终态 poison（`gradingPoison.test.ts` submittedAnswers poison）
- [x] stale gradingResult poison（`gradingPoison.test.ts` stale-gradingResult poison）
- [x] 人工评分队列使用物化的 pending_manual grading entries（`gradingQueue.test.ts:307`）
- [x] gradingStatus 单独不能凭空制造队列工作项（`gradingQueue.test.ts:381` ghost-attempt 守卫）
- [x] 人工 text_response 可以录入分数（`gradingQueue.test.ts:641`）
- [x] 最后一条 pending_manual 完成后 attempt graded+fully_graded（`gradingQueue.test.ts:1200`）
- [x] 部分 pending_manual 完成保持 submitted+pending_manual（`manualGradingCompletion.test.ts:512`）
- [x] strict terminal：completed_manual 不可被普通 gradeQuestion 重写；graded+fully_graded 不可重评（`gradingQueue.test.ts:1348/1418`）
- [x] grading rubric 来自 QuestionSnapshot，不 JOIN live questions（结构性：grading-detail 路由无 questionRepo）
- [x] 混合总分身份：attempt.score == SUM(gradingResult earned) == SUM(entries earnedScore)（`gradingScoreIdentity.test.ts`）
- [x] 冻结题目排序投影（`gradingAggregation.test.ts` frozen-order 守卫）

### 已移除的历史证据（不再作为当前协议要求）
- ~~人工评分队列查询 gradingStatus=pending_manual~~ → REPLACED：队列谓词是 `attempt_grading_entries` WHERE `grading_mode='manual' AND status='pending_manual'`
- ~~grading reads submitted_answers only~~ → REPLACED：阶段准确——submitted_answers 在物化时是输入，之后 attempt_grading_entries 是权威
- ~~reconcileScores 折叠客观+人工~~ → REMOVED：reconcileScores 已删除，权威是 aggregateGradingEntries
- ~~completeManualGrading~~ → REMOVED：当前命令是 gradeQuestion
- ~~post-terminal re-grade idempotency~~ → STALE：终态后普通改分被拒，不是幂等

### Result Visibility Tests
- [ ] graded 但未 release 时 candidate 不能看分数
- [ ] release score 后 candidate 能看分数
- [ ] 未 release answers 时 candidate 不能看 standardAnswer
- [ ] release answers 后 candidate 才能看 standardAnswer
- [ ] candidate 只能看自己的 result（own-result boundary）
- [ ] teacher/admin 结果视图仍可用
- [ ] admin 发布前可查看分数（绕过 resultVisibility）

### Frontend Tests
- [ ] text_response 渲染 textarea
- [ ] fill_blank 渲染 input
- [ ] textarea 保存/恢复换行
- [ ] submit 后控件 disabled
- [ ] submit 后 save 不再触发
- [ ] 刷新 submitted attempt 后进入 locked state
- [ ] deriveTakeExamView 覆盖所有 snapshot 组合
- [ ] disrupted 状态显示恢复按钮

### E2E Happy Path

```
教师/Admin 创建包含 text_response 的考试
→ 发布
→ 考生开始
→ 作答单选/多选/判断/填空/text_response
→ 保存
→ 刷新恢复
→ 提交
→ 提交后不可编辑
→ 教师/阅卷员评分 text_response
→ 结果发布
→ 考生查看结果
→ 未允许时看不到 standardAnswer
```

---

## 11. 审计事件

关键状态变化必须发出已知 audit action：

| 事件 | 触发时机 |
| ---- | -------- |
| `exam.published` | publishExam 成功 |
| `exam.closed` | closeExam 成功 |
| `attempt.started` | startAttempt 成功 |
| `attempt.resumed` | resumeAttempt 成功 |
| `attempt.saved` | saveAnswer 成功 |
| `attempt.submitted` | submitAttempt 成功 |
| `attempt.deadline_reconciled` | ensureAttemptDeadlineReconciled 触发冻结 |
| `attempt.voided` | voidAttempt 成功 |
| `grading.detail_viewed` | grading-details 路由被访问（敏感读取审计，仅记录 FACT，元数据不含 candidateAnswer/rubric） |
| `grading.score_entered` | gradeQuestion 成功（每次接受的 pending_manual 完成都发出，含部分完成与最终完成） |
| `grading.finalized` | 仅当最后一条 pending_manual 完成、attempt 从 submitted+pending_manual → graded+fully_graded 时发出（由 gradeQuestion 终态分支触发；部分完成**不**发出） |
| `result.released` | publishResults 成功 |

> **审计元数据边界**：除非当前 contract 显式包含，审计元数据不包含 candidateAnswer / rubric 内容（生产 `gradingQueue.test.ts` 隐私断言）。终态后改分/重评不在当前协议范围内，故无对应的 revision 审计事件。

---

## 12. 已知限制与延后

| 限制 | 说明 |
| ---- | ---- |
| text_response 仅 multi_line | 未来可扩展 short answer / essay，通过 responseConfig 或拆分题型 |
| rubric 仅纯文本 | 结构化 rubric / criteria / 分档评分延后 |
| per-attempt snapshot 时序 | 不同考生可能因开始时间不同拿到不同 rubric 版本 |
| 不做后台 deadline scheduler | 仅懒触发 |
| `submitted_answers_hash` 非数据库列 | hash 工具 `hashSubmittedAnswers()` 存在，用于测试 / backfill 校验 / 可选审计日志；但**不是 DB 列**，幂等性靠事务 + 状态 guard + `submitted_answers` 不可变性保证（不经 hash 比较） |
| 不做完整 RBAC 迁移 | MVP 三个角色 |
| 不做富文本 / 画图 / 文件上传 | MVP 范围外 |
| 不做 Proctor / Email / Redis 业务路径 | MVP 范围外 |
