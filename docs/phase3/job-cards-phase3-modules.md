# Phase 3 模块作业卡

> **取代：** `job-cards.md` 与 `job-cards-large.md` 中的能力优先作业卡。两者作为主执行队列已退役。本文档是活动执行队列。
>
> **计划权威：** `docs/phase3/plan.md` — 模块闭环计划。下方每张作业卡实现该计划中的一个派生 Middle Job。

---

## 全局非目标

本批作业卡不含：

- 富文本作答
- 画图/画布作答
- 文件上传作答
- 新增 `QuestionType` 枚举值（subjective_text 是一种作答模式，不是新题型）
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

---

## 主观文本作答约定 (MVP v0)

对 Phase 3 MVP v0，主观文本题表示为：

| 字段 | 取值 |
|-------|-------|
| `type` | `fill_blank` |
| `standardAnswer` | `null` |
| `options` | 空或缺失 |
| `answer value` | `string` |
| `前端渲染` | `<textarea>`（纯文本，无富文本） |
| `评分流水线` | `standardAnswer == null` → 待人工评分 |

这**不是**新的 `QuestionType`。它是由既有 `fill_blank` 类型 + `standardAnswer: null` 编码的一种作答模式。4 个 MVP `QuestionType` 取值保持不变：`single_choice`、`multiple_choice`、`true_false`、`fill_blank`。

---

## 模块 P0 — 考生作答运行时闭环

### P3-MOD-P0-1：考生作答渲染审计

**目标：** 为每个 MVP 题型的渲染、保存、恢复、提交行为产出精确缺口清单，外加 subjective_text 作答模式。

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
| `subjective_text` v0 | `type=fill_blank`，`standardAnswer == null`，`options` 空/缺失 | 当前无组件——存在孤儿 `SubjectiveAnswerInput` | `string` | | | | |

3. 确认 `packages/contracts/src/attempt.ts` 中的 `SaveAnswerRequestSchema` 把 `answer` 校验为 `z.unknown()` —— 在 API 边界无类型特定校验。这是一种设计选择（API 接受任意 JSON），不是 bug，但这意味着前端正确性完全依赖 `QuestionRenderer` 分发。

4. 确认 `packages/domain/src/enums.ts` 仅定义 4 个 `QuestionType` 值。不存在主观类型。

5. 记录 `SubjectiveAnswerInput.tsx`（78 行、完整 i18n、已测试）是孤儿——从未被 `QuestionRenderer` import。

**输出：** `docs/phase3/audit/p0-candidate-answer-rendering-audit.md`

**验证：** 审计表覆盖 4 个题型 + 1 个 subjective_text 作答模式，并精确识别渲染缺口。

**提交：** `docs: add P0 candidate answer rendering audit`

---

### P3-MOD-P0-2：主观文本作答 v0

**目标：** 考生能用普通 textarea 作答 subjective_text 题。作答能保存、恢复并正确提交。

**类型：** 实现

**依赖：** P3-MOD-P0-1（缺口清单确认方案）

**设计决策：** 使用 MVP subjective_text 约定（`type=fill_blank`、`standardAnswer==null`、`options` 空/缺失）触发 textarea 渲染。无新枚举、无 schema 改动、无契约改动。

**推荐做法：** 在 `QuestionRenderer.tsx` 中加一个辅助函数：

```typescript
function isSubjectiveTextQuestion(question: QuestionSnapshot): boolean {
  return question.type === "fill_blank"
    && question.standardAnswer == null
    && (!question.options || question.options.length === 0);
}
```

当其返回 true 时，渲染 `<SubjectiveAnswerInput>` 而非 `<FillBlankInput>`。在读完代码后把辅助函数适配为实际 `QuestionSnapshot` 形状——若 `options` 总是作为数组存在，检查 `options.length === 0`；若可能 undefined，先检查 falsy。

**待修改文件：**
- `apps/web/src/components/exam/QuestionRenderer.tsx`（用上述辅助函数加 subjective_text 分支）
- `apps/web/src/components/exam/SubjectiveAnswerInput.tsx`（核对 props 与 QuestionRenderer 接口一致）

**待创建文件（若不存在）：**
- `apps/web/src/components/exam/QuestionRenderer.test.tsx`

**步骤：**

**步骤 1：阅读既有 SubjectiveAnswerInput**

阅读 `apps/web/src/components/exam/SubjectiveAnswerInput.tsx`。记录其 props 接口。与 `QuestionRenderer` 传给其他输入组件的内容对比。

**步骤 2：为 subjective_text 渲染写失败测试**

在 `QuestionRenderer.test.tsx` 中加一个用 MVP 约定的测试：

```typescript
it("renders SubjectiveAnswerInput for subjective_text (fill_blank + null standardAnswer + no options)", () => {
  const question = makeQuestion({
    type: "fill_blank",
    standardAnswer: null,
    options: [],
  });
  render(<QuestionRenderer question={question} value={undefined} onChange={vi.fn()} />);
  expect(screen.getByRole("textbox")).toBeInTheDocument(); // textarea
});
```

运行：`pnpm --filter web test -- QuestionRenderer`
预期：FAIL——尚无 subjective_text 分支。

**步骤 3：在 QuestionRenderer 加 subjective_text 分支**

加 `isSubjectiveTextQuestion` 辅助函数，并在基于类型的 switch 之前加检查：

```typescript
if (isSubjectiveTextQuestion(question)) {
  return <SubjectiveAnswerInput ... />;
}
```

**步骤 4：运行测试验证通过**

运行：`pnpm --filter web test -- QuestionRenderer`
预期：PASS

**步骤 5：验证保存/恢复集成**

既有 `TakeExamPage` 保存/恢复流程使用 `useSubmitFlush`，后者直接发送原始作答值。对 subjective_text，作答是 `string`。既有协议正确处理字符串——无需后端改动。

通过阅读 `TakeExamPage.tsx` 验证，确认 `saveAnswer` 直接传递输入组件的值。

**步骤 6：加作答格式测试**

```typescript
it("subjective_text answer emits string value on change", () => {
  const onChange = vi.fn();
  const question = makeQuestion({ type: "fill_blank", standardAnswer: null, options: [] });
  render(<QuestionRenderer question={question} value={undefined} onChange={onChange} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "My answer" } });
  expect(onChange).toHaveBeenCalledWith("My answer");
});
```

**步骤 7：验证评分引擎兼容性**

评分引擎（`packages/domain/src/gradingEngine.ts`）已通过 `hasSubjectiveQuestions()`（检查 `standardAnswer == null`）处理主观题。人工评分流水线（`packages/exam-engine/src/manualGrading.ts`）已从 attempt 的 answers 提取 `candidateAnswer`。除非 P0-1 审计暴露缺口，否则无需后端改动。

**步骤 8：运行完整测试套件**

运行：`pnpm verify`
预期：全部通过。

**步骤 9：提交**

```bash
git add apps/web/src/components/exam/QuestionRenderer.tsx apps/web/src/components/exam/QuestionRenderer.test.tsx
git commit -m "feat(P0): wire SubjectiveAnswerInput for fill_blank+null standardAnswer convention"
```

**完成标准：**
- 考生能用 textarea 作答 subjective_text 题（fill_blank、null standardAnswer、无 options）
- 作答经既有协议保存
- 作答在页面刷新后恢复
- 作答正确提交
- 评分引擎正确识别其为待人工评分

---

### P3-MOD-P0-3：提交冻结 UI 证明

**目标：** 验证提交后考生 UI 阻止进一步作答修改。证明后端拒绝提交后保存。

**类型：** 审计 + 少量测试补充

**待检查文件：**
- `apps/web/src/pages/exam/TakeExamPage.tsx`（提交后 UI 状态）
- `apps/api/src/routes/attempts.candidate.ts`（提交后保存拒绝）

**步骤：**

1. 阅读 `TakeExamPage.tsx`——提交后页面导航到 `ResultPage`。确认不存在"提交后编辑"路径。

2. 阅读答案保存端点——`packages/exam-engine/src/answerProtocol.ts` 的 `processSaveAnswer()` 在 attempt 状态为 `submitted` 或 `graded` 时拒绝保存。

3. 若 `submitFreezeBarrier.test.ts` 已覆盖此场景，记录即可。否则加一个 API 级测试：

```typescript
it("rejects answer save after submit", async () => {
  await submitAttempt(app, attemptId, candidateToken);
  const res = await app.inject({
    method: "POST",
    url: `/api/attempts/${attemptId}/answers/${questionId}`,
    payload: { answer: "new answer", baseVersion: 1, clientSeq: 100 },
    cookies: { session: candidateToken },
  });
  expect(res.statusCode).toBe(409);
});
```

4. 运行测试确认拒绝。

**输出：** 确认提交冻结端到端工作。

**提交（若加测试）：**
```bash
git add apps/api/src/routes/attempts/submit-freeze-proof.test.ts
git commit -m "test(P0): prove answer save rejected after submit"
```

---

### P3-MOD-P0-4：考生作答 E2E

**目标：** 一条 E2E spec 证明完整考生 happy path，包含 subjective_text 作答。

**类型：** E2E 测试

**依赖：** P3-MOD-P0-2（subjective_text 作答必须可用）

**待修改文件：**
- `apps/e2e/e2e/candidate-happy-path.spec.ts`（扩展现有 spec）

**待检查文件：**
- `apps/e2e/lib/seed.ts`（测试数据播种）
- `apps/e2e/lib/flow.ts`（可复用流程辅助）

**步骤：**

1. 阅读 `candidate-happy-path.spec.ts`。它当前只测判断题。

2. 阅读 `apps/e2e/lib/seed.ts`——理解测试考试如何播种。

3. 扩展种子数据，纳入 subjective_text 题：
   - 创建一个 `type: "fill_blank"`、`standardAnswer: null`、`options: []` 的题
   - 加入考试的 `questionIds`

4. 扩展 E2E spec：
   - 在 textarea 中用自由文本作答 subjective_text 题
   - 验证 textarea 可见
   - 提交并验证 attempt 进入人工评分路径（如 `gradingStatus` 为 `pending_manual`，或按既有产品行为隐藏考生结果并给出待人工评分原因）

5. 运行：`pnpm test:e2e -- --grep "candidate-happy-path"`

**提交：**
```bash
git add apps/e2e/e2e/candidate-happy-path.spec.ts apps/e2e/lib/seed.ts
git commit -m "test(P0): extend candidate happy path E2E with subjective_text answer"
```

**完成标准：** E2E 证明考生能作答客观题 + subjective_text 题、提交、且 attempt 进入正确的提交后状态。

---

## 模块 P1 — 人工评分闭环

### P3-MOD-P1-1：人工评分 API/UI 证明

**目标：** 证明既有人工评分 API 与 UI 能渲染 subjective_text 作答、保留换行、避免 XSS、保存得分、完成评分、对账总分、发出审计事件。

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

**目标：** 一条 E2E spec 证明：考生提交 subjective_text 作答 → admin 在评分队列看到 → admin 打分 → 考生看到对账后结果。

**类型：** E2E 测试

**依赖：** P3-MOD-P0-2（subjective_text 作答）、P3-MOD-P1-1（评分 API/UI 证明）

**待修改文件：**
- `apps/e2e/e2e/manual-grading.spec.ts`（当前 SKIPPED——取消跳过并更新）

**步骤：**

1. 阅读既有跳过的 `manual-grading.spec.ts`。记录它测什么、为什么跳过。

2. 更新种子数据，纳入 subjective_text 题（`type: "fill_blank"`、`standardAnswer: null`、`options: []`）。

3. 取消跳过 spec。更新测试流程：
   - 考生开始考试、用文本作答 subjective_text 题、提交
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

**目标：** 文档化从题目创建到考试发布的完整命题流程，识别任何缺口。尤其验证 subjective_text 题能通过 UI 创建。

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
   - **关键缺口检查：** UI 能创建 subjective_text 题吗？即：type=`fill_blank`、standardAnswer=`null`、无 options。若表单对 fill_blank 强制要求 standardAnswer 或 options，记录为缺口。

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
   - subjective_text 是否存在题目内容校验缺口？
   - 考试表单是否正确处理 subjective_text 题？

5. 产出流程图与缺口清单。

**输出：** `docs/phase3/audit/p2-authoring-ui-flow-audit.md`

**提交：**
```bash
git add docs/phase3/audit/p2-authoring-ui-flow-audit.md
git commit -m "docs(P2): audit exam authoring UI flow end-to-end"
```

---

### P3-MOD-P2-2：MVP 题目创建测试

**目标：** 确保题目创建与校验测试覆盖所有 MVP 题型，包括 subjective_text 约定。

**类型：** 测试验证 + 补充

**待检查文件：**
- `apps/api/src/routes/question.test.ts`（既有测试）
- `apps/web/src/pages/admin/QuestionEditPage.test.tsx`（既有测试）

**步骤：**

1. 阅读 `question.test.ts`——记录创建/更新流程中测了哪些题型。

2. 检查是否测了 subjective_text 题创建：`type: "fill_blank"`、`standardAnswer: null`、`options: []`。

3. 若缺失，加测试：
   ```typescript
   it("creates subjective_text question (fill_blank + null standardAnswer + no options)", async () => {
     const res = await app.inject({
       method: "POST",
       url: "/api/questions",
       payload: {
         type: "fill_blank",
         content: "请阐述你的观点",
         standardAnswer: null,
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
git commit -m "test(P2): add subjective_text question creation test"
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
   - 考试同时有客观题与 subjective_text 题
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
批次 1 — 核心考试闭环（仅 Admin）
  ├── P3-MOD-P0-1  渲染审计                  [审计]
  ├── P3-MOD-P0-2  主观文本 v0               [代码：QuestionRenderer.tsx]
  ├── P3-MOD-P0-3  提交冻结证明              [审计/测试]
  ├── P3-MOD-P0-4  考生作答 E2E              [e2e]
  ├── P3-MOD-P1-1  人工评分 API/UI 证明      [审计/测试]
  ├── P3-MOD-P1-2  主观评分 E2E              [e2e]
  ├── P3-MOD-P3-1  结果可见性 E2E            [e2e]
  ├── P3-MOD-P3-2  作答/标准答案泄漏测试     [测试]
  └── P3-MOD-P3-3  Admin 结果视图验证        [测试]

批次 2 — 命题闭环（仅 Admin）
  ├── P3-MOD-P2-1  命题流程审计              [审计]
  ├── P3-MOD-P2-2  题目创建测试              [测试]
  └── P3-MOD-P2-3  发布到考生 E2E            [e2e]

批次 3 — RBAC MVP（此处起支持 Teacher）
  ├── P3-MOD-P4-1  MVP RBAC 路由矩阵         [审计/设计]
  ├── P3-MOD-P4-2A 评分路由切换              [代码]
  ├── P3-MOD-P4-2B 题目 CRUD 路由切换        [代码]
  ├── P3-MOD-P4-2C 考试命题路由切换          [代码]
  ├── P3-MOD-P4-3  考生归属证明              [测试]
  └── P3-MOD-P4-4  前端导航门控              [代码]

批次 4 — Email 最小接入
  ├── P3-MOD-P5-0  收件人来源 + 入队设计     [审计/设计]
  └── P3-MOD-P5-1  结果发布邮件触发          [代码]

批次 5 — 收尾
  └── P3-MOD-P6-1  MVP 就绪报告              [审计/文档]
```

**合计：跨 7 个模块、5 个批次的 21 张作业卡。**

- **批次 1** 可仅 Admin 执行。无需 Teacher 角色。
- **批次 2** 继续仅 Admin 命题验证。
- **批次 3** 通过 RBAC 切换开始支持 Teacher。
- **批次 4** 仅在核心流程稳定后开始邮件接入。
- **批次 5** 产出收尾报告。
