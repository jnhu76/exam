# 考试协议地基 — P3-L0-EXAM-PROTOCOL-FOUNDATION

> 本文档是 Phase 3 Large Job P3-L0 的正式协议规格。所有实现必须遵循本文档；实现与本文档冲突时，以本文档为准。

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
| `questions.rubric` |命题编辑源 | 教师创建/编辑题目时写入 |
| `QuestionSnapshot.rubric` | 冻结评分源 | attempt 创建时从 questions 复制，评分只从此处读取 |

**关键约束**：grading 视图必须从 `QuestionSnapshot` 读取 rubric，禁止 JOIN live `questions` 表。

### 1.6 发布校验

| 题型 | 发布前必须满足 |
| ---- | -------------- |
| auto 题（非 text_response） | standardAnswer 非空且不是占位符（如"暂无"） |
| text_response | rubric 非空且不是占位符；standardAnswer 可选 |

创建草稿时允许空值；发布时强制校验。

---

## 2. Schema 变更

### 2.1 新增列

**`questions` 表：**
- `rubric text` — 命题编辑源
- `type` 枚举新增 `'text_response'`

**`question_snapshots` 表（或等价 JSONB 列）：**
- `rubric text` — 冻结评分源

**`exam_attempts` 表：**
- `submitted_answers jsonb` — 提交时冻结的答案快照
- `submission_reason text nullable` — `'manual'` 或 `'deadline'`

### 2.2 不新增的列

- `inputMode` — 派生值，不存储
- `gradingMode` — 派生值，不存储
- `submitted_answers_hash` — MVP 不加列

### 2.3 SubmittedAnswersSnapshot 格式

```ts
interface SubmittedAnswersSnapshot {
  schemaVersion: 1;
  answers: Array<{
    questionId: string;
    value: unknown;  // 单选: string; 多选: string[]; 判断: boolean; 填空: string; 主观: string
  }>;
}
```

从 draft `answers`（`AnswerRecord[]`）规范化生成：按 exam question snapshot 过滤有效 questionId，提取 value，丢弃 clientSeq/baseVersion。

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

### 3.2 GradingStatus（独立维度）

```ts
type GradingStatus =
  | 'pending_auto'
  | 'pending_manual'
  | 'fully_graded';
```

**两个维度独立**：`attemptStatus` 表示作答生命周期，`gradingStatus` 表示评分生命周期。

**关键规则**：人工评分队列查询 `gradingStatus = 'pending_manual'`，**不是** `attemptStatus = 'grading'`。

### 3.3 主路径状态流转

```
纯客观题：
  in_progress → submitted → graded
  （自动评分可在 submit 事务内同步完成）

纯 text_response：
  in_progress → submitted (gradingStatus=pending_manual) → graded (gradingStatus=fully_graded)

混合题：
  in_progress → submitted (gradingStatus=pending_manual) → graded (gradingStatus=fully_graded)
  （客观题可先算分，但必须等主观题完成后才进 graded）

Deadline 触发：
  in_progress/disrupted → submitted (submissionReason='deadline')
```

### 3.4 命令函数

所有状态变化通过集中命令函数执行，禁止在 route 中直接 update status：

| 命令函数 | 允许的前置状态 | 事务行为 |
| -------- | -------------- | -------- |
| `startAttempt` | not_started | 锁 attempt，设 in_progress |
| `resumeAttempt` | disrupted | 锁 attempt，设 in_progress |
| `submitAttempt` | in_progress | 锁 attempt，冻结 submitted_answers，设 submitted |
| `saveAnswer` | in_progress | 锁 attempt，更新 answers |
| `markDisrupted` | in_progress | 锁 attempt，设 disrupted |
| `completeManualGrading` | submitted (gradingStatus=pending_manual) | 合并分数，设 graded |
| `voidAttempt` | any | 设 voided |
| `ensureAttemptDeadlineReconciled` | in_progress/disrupted | 过期则冻结 submitted_answers |

每个命令使用 transition matrix + business guard，在数据库事务内用 `FOR UPDATE` row lock 落库。

---

## 4. 答案协议与提交冻结

### 4.1 两列模型

| 列 | 用途 | 可变窗口 |
| -- | ---- | -------- |
| `answers` | 草稿，Candidate 作答时写入 | `in_progress` 状态下可写 |
| `submitted_answers` | 冻结快照，评分和结果读取 | submit 事务一次性写入，之后不可变 |

### 4.2 Submit 冻结屏障

`submitAttempt` 事务内执行：

```
1. FOR UPDATE 锁 attempt
2. 确认 status = 'in_progress'
3. 读取 draft answers (AnswerRecord[])
4. 按 question snapshot 规范化为 SubmittedAnswersSnapshot
5. 写入 submitted_answers
6. 设置 status = 'submitted', submittedAt = serverNow
7. 设置 submissionReason = 'manual'
8. 决定 gradingStatus（纯客观 → fully_graded；含 text_response → pending_manual）
9. 插入 audit log: attempt.submitted
10. 整个过程原子完成
```

### 4.3 幂等性

| 场景 | 行为 |
| ---- | ---- |
| 重复 submit | 返回已有 submitted snapshot，不重新生成，不覆盖 submitted_answers，不改 submittedAt |
| save after submit | 返回确定错误 `ATTEMPT_ALREADY_SUBMITTED`，不修改 submitted_answers |
| save/submit race | submit 拿锁后读取当时 draft answers 并冻结；之后到达的 save 被拒绝 |
| double submit 不重新评分 | 已 graded 的 attempt 不因 double submit 重新计算 |

### 4.4 Draft/Final 语义

- grading 读取 `submitted_answers`，**不读** `answers`
- CandidateTakeSnapshot 在 submitted 后返回 `submitted_answers` 的值，**不再返回** draft answers
- 前端提交成功后必须用服务端返回的新 snapshot 覆盖本地显示

---

## 5. Deadline Reconciliation

### 5.1 触发条件

```
attemptStatus in ('in_progress', 'disrupted')
&& serverNow >= effectiveDeadline
```

`effectiveDeadline` = min(exam deadline, attempt deadline, extension-adjusted deadline)，从现有字段派生，不新建 deadline 模型。

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

    const next = await markDeadlineSubmitted(tx, {
      attemptId,
      submittedAnswers,
      submittedAt: effectiveDeadline(attempt),
      submissionReason: 'deadline',
      attemptStatus: gradingPlan.fullyAutoGradable ? 'graded' : 'submitted',
      gradingStatus: gradingPlan.fullyAutoGradable ? 'fully_graded' : 'pending_manual',
    });

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
| save 过期 | 先 reconcile → 返回 `ATTEMPT_DEADLINE_EXPIRED` 或 `ATTEMPT_NOT_EDITABLE`；可附带最新 CandidateTakeSnapshot |
| submit 过期 | 先 reconcile → 返回已有 deadline-submitted snapshot；不接受新答案 payload |

### 5.6 不处理的状态

| 状态 | 行为 |
| ---- | ---- |
| not_started / queued | 不生成 submitted_answers；返回 cannot start / deadline locked |
| submitted / grading / graded | 已冻结，返回现有 submitted_answers |
| voided | terminal，不做 reconciliation |

---

## 6. DTO 边界

### 6.1 CandidateTakeSnapshot

`GET /candidate/attempts/:attemptId/take` 的统一响应。后端安全投影层根据 attemptStatus 选择返回哪个答案。

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

### 6.2 GradingQuestionDTO

`GET /admin/attempts/:attemptId/grading-details` 的响应。从 `QuestionSnapshot` + `submitted_answers` 构建。

```ts
interface GradingQuestionDTO {
  id: string;
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
  inputMode: InputMode;
  gradingMode: GradingMode;
  standardAnswer: unknown | null;
  rubric: string | null;
  submittedAnswer: unknown;  // 从 submitted_answers 读取
  maxScore: number;
}
```

**关键约束**：`submittedAnswer` 来自 `submitted_answers`，**不读** draft `answers`。`rubric` 来自 `QuestionSnapshot`，**不 JOIN** live `questions` 表。

### 6.3 ResultDTO

`GET /candidate/attempts/:attemptId/result` 的响应。受 resultVisibility / answerVisibility 门控。

| 条件 | 返回 |
| ---- | ---- |
| resultVisibility = hidden | 不返回 score / pass |
| resultVisibility = visible | 返回 score / pass |
| answerVisibility = hidden | 不返回 standardAnswer / rubric |
| answerVisibility = visible | 返回 standardAnswer / rubric |

---

## 7. 前端状态模型

### 7.1 原则

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
- `question_snapshots`：新增 `rubric text`
- `exam_attempts` 表：新增 `submitted_answers jsonb`，`submission_reason text nullable`

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

### Submit/Freeze Tests
- [ ] submit 冻结 submitted_answers
- [ ] submit 后 save 被拒绝
- [ ] double submit 幂等
- [ ] double submit 不改变 submitted_answers
- [ ] double submit 不改变 submittedAt
- [ ] save/submit race 后 submitted_answers 稳定

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

### Grading Tests
- [ ] grading detail 读取 submitted_answers
- [ ] grading detail 展示 text_response 纯文本答案
- [ ] manual text_response 可以录入分数
- [ ] all manual scores complete 后 attempt 可 graded
- [ ] grading 不读取 draft answers
- [ ] 人工评分队列查询 gradingStatus=pending_manual

### Result Visibility Tests
- [ ] graded 但未 release 时 candidate 不能看分数
- [ ] release score 后 candidate 能看分数
- [ ] 未 release answers 时 candidate 不能看 standardAnswer
- [ ] release answers 后 candidate 才能看 standardAnswer
- [ ] candidate 只能看自己的 result
- [ ] teacher/admin 结果视图仍可用

### Frontend Tests
- [ ] text_response 渲染 textarea
- [ ] fill_blank 渲染 input
- [ ] textarea 保存/恢复换行
- [ ] submit 后控件 disabled
- [ ] submit 后 save 不再触发
- [ ] 刷新 submitted attempt 后进入 locked state
- [ ] deriveTakeExamView 覆盖所有 snapshot 组合

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

## 11. 已知限制与延后

| 限制 | 说明 |
| ---- | ---- |
| text_response 仅 multi_line | 未来可扩展 short answer / essay，通过 responseConfig 或拆分题型 |
| rubric 仅纯文本 | 结构化 rubric / criteria / 分档评分延后 |
| per-attempt snapshot 时序 | 不同考生可能因开始时间不同拿到不同 rubric 版本 |
| 不做后台 deadline scheduler | 仅懒触发 |
| 不做 submitted_answers_hash | 幂等性靠事务+状态 guard |
| 不做完整 RBAC 迁移 | MVP 三个角色 |
| 不做富文本 / 画图 / 文件上传 | MVP 范围外 |
| 不做 Proctor / Email / Redis 业务路径 | MVP 范围外 |
