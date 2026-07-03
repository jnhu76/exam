# 考试平台 Phase 3 计划 — MVP 模块闭环

> **Phase 3 目标：** 停止扩展孤立的基础设施，闭环真正的 MVP 考试流程：
>
> **教师创建题目/试卷 → 教师发布考试 → 考生开始考试 → 考生作答 → 考生提交 → 后端冻结最终答案 → 教师/阅卷员评分 → 结果发布 → 考生查看结果 → 可选通知发送。**
>
> **计划模式变更：** Phase 3 不再由 RBAC / Email / Redis / Proctor 等能力队列驱动。Phase 3 现在由**模块闭环**驱动。一个模块只有在真实用户流程贯穿前端、API、契约、持久化、审计、权限和测试之后才算完成。

---

## 0. 状态快照

> **时效性说明（2026-07-03）。** 本计划取代早先的能力优先 Phase 3 计划。旧计划正确地跟踪了许多基础设施作业，但在核心产品模块尚未完成时仍在催生更多 Middle Job。新计划把现有基础设施当作构建块，把执行重心放到 MVP 模块闭环上。
>
> **协议优先修订（2026-07-03）。** 在 P0 考生作答运行时之前新增 **P-1 考试协议与后端状态模型收敛**，后升级为 **P3-L0-EXAM-PROTOCOL-FOUNDATION**。L0 不仅文档化协议，还实现 text_response 题型、submitted_answers 物理列、submit freeze 重写、CandidateTakeSnapshot 统一端点、deadline reconciliation 懒触发收口、rubric 双层存储、publish validation 和 backfill 脚本。任何人不得在 L0 完成前推进前端作答状态机或 text_response 运行时。

| 领域 | 修订后状态 | 计划决策 |
| ---- | -------------- | ------------- |
| 考试协议/后端状态模型 | **L0 升级：不仅文档化，还实现基础设施变更。** text_response 题型、submitted_answers 物理列、submit freeze、CandidateTakeSnapshot、deadline reconciliation。 | **P-1/L0：当前最高优先级。** 协议矩阵 + schema + submit freeze + reconciliation + 测试。 |
| 考生作答运行时 | **未完成。** 客观题作答路径已存在；主观题作答运行时尚未达到 MVP 就绪。 | P-1 之后的第一模块（P0）。 |
| 人工评分 | **后端基本就绪；前端/E2E 闭环待补。** 评分队列/详情和人工打分已存在，但被作答渲染/运行时缺口阻塞。 | 紧随考生作答运行时之后闭环。 |
| 考试命题 | **部分可用。** 题目 CRUD、考试配置、发布流程已存在；需要产品流程验证。 | 作为 MVP 命题模块闭环。 |
| 结果发布 | **后端就绪；需 E2E 证明。** 结果发布模式与考生可见性门控已存在。 | 通过完整 MVP 流程验证。 |
| RBAC | **基础设施已合并；MVP 落地未完成。** `requireCapability` 已存在，但大量路由仍使用 legacy `requireRole`；scoped 角色尚未端到端打通。 | 先收敛到 MVP 角色：Admin / Teacher / Candidate。Proctor 与 scoped 派单延后。 |
| Email | **基础设施就绪；无业务调用方。** Outbox/retry/test endpoint 已存在，但没有产品触发点调用它。 | 仅在核心流程稳定后接入最小 MVP 触发点。 |
| Redis | **仅用于诊断。** 任何考生/考试业务路径都不应依赖 Redis。 | 业务逻辑层面保持休眠。 |
| Proctor | **监控 v0 已存在；产品角色/权限缺失。** | 暂缓，直到 RBAC MVP 切换稳定。 |
| 审计 / 诊断 | **足以支撑 MVP。** 应当复用既有审计与诊断，而非随机扩张。 | 仅补充模块闭环所必需的事件。 |
| 大型设计队列 | **范围过广，无法立即执行。** 许多 Large Job 有用，但并非 MVP 闭环前所需。 | 重新分类为：阻塞、模块本地、延后。 |

---

## 1. 核心原则

```text
Phase 3 不靠堆砌更多基础设施前进。

Phase 3 只有在一个对用户可见的 MVP 模块可被证明地完成时，才向前推进。
```

一个模块只有同时满足以下全部条件才算完成：

1. **存在前端入口** — 真实用户能够触达并使用它。
2. **存在后端 API** — 动作经由真实 API 路由，而非 mock。
3. **存在契约/模式** — 请求/响应形状是显式且被测试的。
4. **存在持久化路径** — 数据按要求在刷新/恢复/重启后留存。
5. **审计行为已定义** — 重要的状态变化会发出已知 audit action。
6. **权限边界已定义** — 明确 MVP 角色能否执行该动作。
7. **存在测试证明** — 单元/集成/Web/E2E 测试证明该流程。
8. **非目标显式声明** — 富功能不会泄漏进 MVP 闭环。

---

## 2. MVP 模块队列

Phase 3 执行队列现在是模块优先的。

| 优先级 | 模块 | 目标 | 状态 |
| -------- | ------ | ---- | ------ |
| **P-1/L0** | **考试协议与后端状态模型收敛（L0 升级）** | 协议矩阵 + text_response 题型 + submitted_answers 物理列 + submit freeze + CandidateTakeSnapshot + deadline reconciliation + rubric 双层 + backfill。**P0 前端运行时的硬前置。** | **下一步进行中** |
| P0 | **考生作答运行时闭环** | 考生能作答所有 MVP 题型并安全提交。**依赖 P-1/L0 完成。** | P-1/L0 之后 |
| P1 | **人工评分闭环** | 教师/阅卷员能查看考生作答、为主观题打分、完成评分。 | P0 之后 |
| P2 | **考试命题闭环** | 教师能创建题目、组装/发布考试并向考生开放。 | P1 之后 |
| P3 | **结果发布闭环** | 结果按策略可见；考生只看到自己的结果。 | P2 之后 |
| P4 | **RBAC MVP 切换** | Admin / Teacher / Candidate 权限在 MVP 流程中被强制执行。 | MVP 闭环证明启动后 |
| P5 | **Email 最小接入** | 考试发布和/或结果发布的可选通知。 | P0–P4 之后 |
| P6 | **MVP 就绪收尾** | 一份报告证明整个流程可用并列举延后能力。 | 最终批次 |

> **执行顺序硬约束：** P-1/L0 必须先于 P0 完成。任何人不得在 L0 的协议矩阵、schema migration、submit freeze、CandidateTakeSnapshot 和 deadline reconciliation 完成前推进前端作答状态机（P3-FSM-0）或 text_response 运行时（P3-MOD-P0-*）。

---

## 3. 模块 P-1 — 考试协议与后端状态模型收敛（升级为 P3-L0-EXAM-PROTOCOL-FOUNDATION）

### 为什么先做协议+基础设施

考生作答运行时（P0）的正确性依赖一组协议真相：attempt 处于什么状态？提交后还能不能保存？刷新后看到什么？考生能否看到分数/标准答案？这些问题的真相存在于后端的状态模型、API 契约与边界规则中。若先做前端 UI 再补协议，前端会逐步变成"业务真相源"，提交冻结、幂等、可见性、标准答案泄漏等核心边界会以隐性 bug 形式反复出现。

**L0 升级**：不仅文档化协议，还实现关键基础设施变更：
- 新增 `text_response` 题型（独立于 fill_blank）
- 新增 `submitted_answers` 物理列（干净快照，不是逻辑等价）
- 重写 submit freeze（生成 SubmittedAnswersSnapshot）
- 新增 CandidateTakeSnapshot 统一端点
- 实现 deadline reconciliation 懒触发收口
- rubric 双层存储（questions.rubric → QuestionSnapshot.rubric）
- publish validation（text_response 必须有 rubric）
- backfill 脚本（回填已有 submitted_answers）

### 目标

明确 Exam / Attempt / Answer / Submit / Grading / Result Visibility 的状态、API 契约、幂等、并发与字段可见性边界，并实现必要的基础设施变更。

### 必须覆盖的协议

- exam lifecycle
- attempt lifecycle
- draft answers vs final answers
- save/restore protocol
- submit/freeze protocol
- double submit idempotency
- save after submit rejection
- save vs submit race
- refresh/resume after submit
- grading input uses submitted_answers only
- result visibility
- standard answer visibility
- candidate own-result boundary
- teacher/admin grading visibility

### 状态分层（协议矩阵的真相源）

```
Exam:
  draft -> published/open -> closed

AttemptStatus (8 values):
  not_started -> in_progress -> submitted -> grading -> graded
                                   ↑           ↓
                               disrupted     voided (terminal)

GradingStatus (independent dimension):
  pending_auto | pending_manual | fully_graded

Answer:
  answers            draft, mutable before submit
  submitted_answers  frozen snapshot, immutable after submit

Result:
  score_computed      与 result_released 分离
  standardAnswer visibility 与 score visibility 分离
```

- **`score_computed` ≠ `result_released`。** 评分完成只产生可计算的分数；是否对考生可见由发布策略与发布动作决定。
- **`standardAnswer` 可见性 ≠ 分数可见性。** 即使分数已发布，考生能否看到标准答案仍由独立的答案可见性策略控制。
- **考生 own-result 边界：** 考生只能看到自己的分数/结果，且仅在发布策略允许时。
- **教师/管理员评分可见性：** 教师/管理员在评分视图中能看到考生已提交答案（`submitted_answers`），不受考生可见性策略约束。

### 范围

| 领域 | 要求 |
| ---- | -------- |
| 协议文档 | `docs/phase3/exam-protocol.md` 含 21 项协议（14 原有 + 7 L0 扩展）。 |
| Schema 变更 | text_response 枚举值、submitted_answers 列、rubric 双层存储。 |
| Submit Freeze 重写 | 提交时生成 SubmittedAnswersSnapshot，评分从 submitted_answers 读取。 |
| CandidateTakeSnapshot | 统一端点返回 attempt 元数据 + 派生能力 + 安全题目 + answerValue + answerSource + serverNow + effectiveDeadline。 |
| Deadline Reconciliation | 懒触发收口，4 个 candidate 入口共享 ensureAttemptDeadlineReconciled()。 |
| Publish Validation | text_response 发布时 rubric 必填；auto 题 standardAnswer 必填。 |
| Backfill 脚本 | 回填已有 submitted/grading/graded attempt 的 submitted_answers。 |
| 后端一致性测试 | 覆盖 14 个场景（含 deadline reconciliation、text_response、gradingStatus 查询）。 |
| 非重写 | 不重设计保存协议为 L4 v2；不发起 L5 冻结重设计——除非矩阵暴露真实阻塞。 |

### 非目标

- 不重写答案保存协议或冻结屏障实现（除非矩阵暴露真实缺口）。
- 不引入新的状态机库到后端。
- 不改 RBAC；可见性边界以现有角色表述。
- 不做前端运行时（属于 P0）。
- 不做主观题作答渲染（属于 P0）。

### 完成标准

```text
docs/phase3/exam-protocol.md 存在并覆盖全部 14 项协议；
后端一致性测试证明 save/submit/race/refresh/visibility 边界；
candidate attempt API 契约包含 7 个真相字段；
任何人读完协议后不会误以为可以先做 TakeExam UI 再补协议。
```

### 派生 Middle Job

| ID | 作业 | 产出 |
| -- | --- | ------ |
| P3-PROTO-0 | Exam Protocol Audit (L0) | `docs/phase3/exam-protocol.md`（21 项协议） |
| P3-PROTO-1 | Backend State Consistency Tests (L0) | 14 个场景的集成测试 |
| P3-PROTO-2 | CandidateTakeSnapshot Endpoint | 统一端点 + 安全投影 + 测试 |
| P3-L0-1 | Schema Migration | text_response + submitted_answers + rubric 双层存储 |
| P3-L0-2 | Submit Freeze Rewrite | SubmittedAnswersSnapshot 冻结 + 评分读取路径 |
| P3-L0-3 | Deadline Reconciliation | 懒触发收口 + 4 入口 + 测试 |
| P3-L0-4 | Backfill Script | submitted_answers 回填脚本 |
| P3-L0-5 | Publish Validation | text_response rubric 校验 + auto 题 standardAnswer 校验 |

---

## 4. 模块 P0 — 考生作答运行时闭环

> **前置依赖：** P-1/L0 必须先完成。P0 的前端运行时只消费 CandidateTakeSnapshot 端点返回的真相字段，不得发明业务规则。前端**不是**业务真相源，后端仍是真相源。

### 目标

考生能使用 MVP 支持的题型作答考试：

- 单选
- 多选
- 判断
- 填空
- text_response（主观文本）

考生能保存、刷新、恢复、提交，并看到已提交答案被冻结。

### 范围

| 领域 | 要求 |
| ---- | -------- |
| 前端状态模型 | **P0 以 `P3-FSM-0` 起步**——`deriveTakeExamView(snapshot)` 纯函数 + 瞬态 reducer。不引入 XState。消费 CandidateTakeSnapshot，不维护完整业务状态机。 |
| 渲染 | 所有 MVP 题型在 `TakeExamPage` 或等价运行时组件中渲染。 |
| text_response 作答 | 使用独立 `QuestionType: 'text_response'`。textarea 渲染，保留换行，纯文本提交。**不再使用** `type=fill_blank + standardAnswer=null` 编码。 |
| 自动保存 | 对每种支持的作答类型都使用既有保存协议。 |
| 恢复 | 已保存答案在刷新/恢复后重新水合。 |
| 提交 | 提交冻结 submitted_answers 并阻止后续编辑。 |
| 校验 | 空/畸形的作答载荷被确定性处理。 |
| 测试 | 组件测试 + API 测试 + 一条考生 E2E happy path。 |

### 非目标

- 富文本编辑器
- Markdown 编辑器
- 画图/画布作答
- 文件上传作答
- AI 评分
- 批量答案保存
- 答案加密/压缩

### 完成标准

```text
考生能打开发布的考试，作答客观题与 text_response 题，
刷新页面，看到答案被恢复，提交一次，且提交后无法修改最终答案；
前端状态模型只消费 CandidateTakeSnapshot，后端仍是真相源。
```

### 派生 Middle Job

| ID | 作业 | 产出 |
| -- | --- | ------ |
| P3-FSM-0 | deriveTakeExamView + transient reducer | 纯函数 + 瞬态 reducer，消费 CandidateTakeSnapshot（依赖 L0 完成） |
| P3-MOD-P0-1 | 考生作答渲染审计 | 每个题型的精确运行时缺口清单 |
| P3-MOD-P0-2 | text_response 运行时 | textarea 渲染 + 保存/恢复/提交支持 |
| P3-MOD-P0-3 | 提交冻结 UI 证明 | UI 禁用态 + 后端冲突证明 |
| P3-MOD-P0-4 | 考生作答 E2E | 完整考生作答 happy path |

---

## 5. 模块 P1 — 人工评分闭环

### 目标

教师/阅卷员能为包含主观文本作答的已提交 attempt 评分。

### 范围

| 领域 | 要求 |
| ---- | -------- |
| 队列 | 已提交/待人工的 attempt 出现在评分队列。 |
| 详情 | 评分详情展示题干、考生作答、适用的标准答案、满分、当前分。 |
| 作答渲染 | 主观文本保留换行，且为安全的纯文本。 |
| 打分录入 | 阅卷员能保存主观题得分。 |
| 收尾 | 在所有必需得分齐备后，attempt 可进入 graded/最终状态。 |
| 审计 | 打分录入与收尾事件被发出。 |
| 测试 | API + Web 测试 + 从考生提交到阅卷员收尾的 E2E。 |

### 非目标

- 匿名评分
- 多阅卷员仲裁
- 评分细则构建器
- 行内标注
- 耗时跟踪
- 超出纯文本的富作答渲染

### 完成标准

```text
已提交的主观文本作答出现在评分 UI 中，
阅卷员能打分、完成评分，结果变得可计算。
```

### 派生 Middle Job

| ID | 作业 | 产出 |
| -- | --- | ------ |
| P3-MOD-P1-1 | 人工评分 API/UI 证明 | 考生作答展示 + 打分保存/收尾测试（合并了早先的渲染验证与打分保存/收尾作业） |
| P3-MOD-P1-2 | 主观评分 E2E | 考生提交 → 阅卷员打分 → 已评分 attempt |

---

## 6. 模块 P2 — 考试命题闭环

### 目标

教师能从 UI 创建可用考试并发布给考生。

### 范围

| 领域 | 要求 |
| ---- | -------- |
| 题目创建 | 教师/Admin 能创建 MVP 题型。 |
| 试卷组装 | 教师/Admin 能为一份试卷选题。 |
| 考试设置 | 时间窗口、时长/截止时间、结果发布模式可配置。 |
| 发布 | 发布的考试对被分配/合格的考生可见。 |
| 快照 | attempt 创建使用稳定的题目快照。 |
| 测试 | 命题流程测试 + 一条从命题到考生可见的 E2E。 |

### 非目标

- 随机出卷
- 题目标签/分类
- 题目版本历史 UI
- 批量导入/导出重设计
- 考试模板/克隆

### 完成标准

```text
教师能创建题目、创建考试、挂载题目、发布，
而考生能开始由此产生的考试。
```

### 派生 Middle Job

| ID | 作业 | 产出 |
| -- | --- | ------ |
| P3-MOD-P2-1 | 命题 UI 流程审计 | 缺失页面/API/契约缺口 |
| P3-MOD-P2-2 | MVP 题目创建测试 | 客观题 + 主观文本题测试 |
| P3-MOD-P2-3 | 考试发布到考生 E2E | 教师发布 → 考生看到考试 |

---

## 7. 模块 P3 — 结果发布闭环

### 目标

结果按配置的发布策略发布，考生只看到被允许看到的内容。

### 范围

| 领域 | 要求 |
| ---- | -------- |
| 立即模式 | 纯客观题考试若如此配置，可立即揭示结果。 |
| 评分后模式 | 混合/主观题考试在评分完成后揭示结果。 |
| 手动模式 | 结果在显式发布前保持隐藏。 |
| 考生视图 | 考生看到自己的分数/通过状态，除非策略允许否则看不到标准答案。 |
| Admin/Teacher 视图 | Admin/Teacher 能查看可计算的结果。 |
| 测试 | E2E 至少覆盖评分后或手动模式。 |

### 非目标

- 申诉/争议
- PDF 成绩单
- 定时结果发布
- 排名/统计/报表看板
- 本模块不做邮件通知

### 完成标准

```text
评分完成且发布策略允许后，
考生能查看自己的结果，且看不到被隐藏的标准答案。
```

### 派生 Middle Job

| ID | 作业 | 产出 |
| -- | --- | ------ |
| P3-MOD-P3-1 | 结果可见性 E2E | 手动或评分后的结果发布流程 |
| P3-MOD-P3-2 | 考生作答/标准答案泄漏测试 | 考生结果剔除受保护字段 |
| P3-MOD-P3-3 | Admin/Teacher 结果视图验证 | 授权员工视图保持可用 |

---

## 8. 模块 P4 — RBAC MVP 切换

### 目标

RBAC 应服务于 MVP 流程，而非主导它。第一次切换只需三个角色：

| 角色 | MVP 职责 |
| ---- | ------------------ |
| Admin | 全系统管理，兼兼容兜底。 |
| Teacher | 题目/考试命题、评分、结果发布。**Teacher 是单租户/私有化部署内的全局角色。** |
| Candidate | 开始被分配的考试、作答、提交、查看自己的结果。 |

### 范围

| 领域 | 要求 |
| ---- | -------- |
| 路由规划 | 仅针对 MVP 路由的逐域迁移计划。 |
| 后端落地 | 仅在需要 MVP 角色行为处，用 `requireCapability` 替换 legacy `requireRole`。 |
| 作用域 | 仅使用 Teacher/Candidate 所需的最小归属/分配校验。 |
| 前端门控 | 仅隐藏/禁用明显未授权的 MVP 入口。 |
| Shadow 模式 | 迁移期间继续使用 shadow 比对。 |
| 测试 | Admin/Teacher/Candidate 的允许/禁止路径权限测试。 |

> **MVP 作用域约束：** Teacher 是全局角色。Candidate 只看到自己的 attempt/结果（`own_attempt` / `own_score`）。**无租户作用域、无课程作用域、无 `teacher_exam_assignments`、无 scoped 角色派单（如 teacher@course、proctor@exam）、无自定义角色、无 Proctor 角色激活。** 后端仍是安全真相源；前端导航门控仅为 UX。

### 非目标

- Proctor 角色激活
- 独立 Grader 角色激活
- 自定义角色
- 完整租户/学校层级
- 细粒度前端能力框架
- 在一个 PR 内迁移全部 legacy admin 路由

### 完成标准

```text
Admin、Teacher、Candidate 各自能完成其 MVP 职责，
且对 MVP 路由的未授权访问被后端落地拒绝。
```

### 派生 Middle Job

| ID | 作业 | 产出 |
| -- | --- | ------ |
| P3-MOD-P4-1 | MVP RBAC 路由矩阵 | 路由 → 能力 → 角色 → 作用域的表 |
| P3-MOD-P4-2A | 评分路由切换 | 评分路由迁移到 `requireCapability` |
| P3-MOD-P4-2B | 题目 CRUD 路由切换 | 题目路由迁移到 `requireCapability` |
| P3-MOD-P4-2C | 考试命题/生命周期路由切换 | MVP Teacher 考试路由迁移到 `requireCapability` |
| P3-MOD-P4-3 | 考生路由保护验证 | 考生专属访问与归属校验测试 |
| P3-MOD-P4-4 | 前端导航门控最小通过 | 隐藏不可能的入口；后端仍是真相源 |

---

## 9. 模块 P5 — Email 最小接入

### 目标

仅在核心流程稳定后，复用既有 outbox 做最小产品通知。

### 候选 MVP 触发点

| 触发点 | 优先级 | 备注 |
| ------- | -------- | ----- |
| 结果发布 | 高 | P3 稳定后有用。 |
| 考试发布/分配可用 | 中 | 有用但非 LAN/私有化 MVP 必需。 |
| 密码重置/邀请 | 视情况 | 仅在 auth/账户流程需要时。 |

### 范围

| 领域 | 要求 |
| ---- | -------- |
| 触发点规格 | 明确的事件、收件人来源、模板、隐私约束。 |
| 业务调用方 | 仅一两个显式调用点。 |
| 模板 v0 | 纯 zh-CN 文本主题/正文。 |
| Worker 行为 | 决定手动触发 vs 守护进程；不要静默引入后台行为。 |
| 测试 | 真实业务动作下 outbox 行入队。 |

### 非目标

- 复杂模板引擎
- 邮件偏好中心
- 通知历史 UI
- 诊断告警邮件
- Proctor/事件通知
- 超出所需触发点的新邮件 schema 类型

### 完成标准

```text
一个真实业务事件能通过既有 outbox 入队最小邮件通知，
而不使核心考试事务依赖 SMTP 可用性。
```

---

## 10. 模块 P6 — MVP 就绪收尾

### 目标

产出一份收尾报告，证明 Phase 3 MVP 模块闭环。

### 必需证据

| 证据 | 要求 |
| -------- | -------- |
| 完整 MVP E2E | 教师创建/发布 → 考生作答/提交 → 教师评分 → 结果发布 → 考生查看结果 |
| 后端测试 | 保存/提交/冻结/评分/结果权限路径 |
| 前端测试 | 考生运行时、评分详情、结果视图 |
| 权限测试 | Admin/Teacher/Candidate 的允许/禁止行为 |
| 审计证明 | publish、start、save、submit、grade、release 关键事件被发出 |
| 延后清单 | 显式搁置的能力及原因 |
| 已知限制 | 仅纯文本主观题；无 proctor 权限；无富文本/上传 |

---

## 11. 已完成/强基础设施

这些能力应被视为可用的构建块。除非模块需要，否则不要再继续扩张。

> **P-1/L0 关系：** 下方"答案保存协议"、"提交冻结屏障"、"考试生命周期命令"、"结果可见性模式"在实现层面是强基础设施。**L0 升级后**：submit freeze 已重写为生成 SubmittedAnswersSnapshot；CandidateTakeSnapshot 已实现统一端点；deadline reconciliation 已实现懒触发收口；text_response 已作为独立题型。强基础设施已通过 L0 的协议矩阵与一致性测试显式化。

| 能力 | 状态 | 计划决策 |
| ---------- | ------ | ------------- |
| 答案保存协议 | 强 | L0 已显式化为协议矩阵与一致性测试；在 P0 中消费；除非矩阵暴露真实缺口，否则不要重设计为 L4 v2。 |
| 提交冻结屏障 | 强 | L0 已重写为生成 SubmittedAnswersSnapshot；评分从 submitted_answers 读取；默认不要发起 L5 新设计。 |
| submitted_answers | **L0 新增** | 物理列，干净快照格式；submit 事务写入；评分/结果只从此读取。 |
| CandidateTakeSnapshot | **L0 新增** | 统一端点，返回 attempt 元数据 + 派生能力 + 安全题目 + answerValue + answerSource + serverNow + effectiveDeadline。 |
| Deadline Reconciliation | **L0 新增** | 懒触发收口，4 个 candidate 入口共享 ensureAttemptDeadlineReconciled()。 |
| 考试生命周期命令 | 足够强 | 在 P2/P3 中使用；除非生命周期歧义阻塞模块闭环，否则不发起 L13。 |
| 题目快照 | 足够强 | L0 已扩展 rubric 双层存储；在 P2 中使用；延后完整题目版本化。 |
| 结果可见性模式 | 足够强 | L0 已分离 resultVisibility / answerVisibility；在 P3 中验证；延后申诉/导出/定时发布。 |
| 人工评分引擎 | 强后端 | 在 P1 中闭环前端/E2E。 |
| 审计基础设施 | 强 | 仅补充模块所需事件。 |
| 诊断 | 强 | 保留为运维面；不再随机扩张诊断。 |
| Email outbox | 强基础设施 | 仅在 P0–P4 之后接入最小触发点。 |
| Redis 插件 | 仅诊断 | 保持业务逻辑 Redis 无关。 |
| RBAC catalog/shadow 模式 | 强基础 | 先只切换 MVP 路由。 |

---

## 12. 退役的旧活动 Middle Backlog

旧计划列出了诸如 Redis 诊断、审计事件扩张、诊断基础设施、评分渲染测试、Proctor 事件日志、收尾报告等 Middle Job 作为持续队列。现在这些作为主执行模型退役。

| 旧作业 | 新处理 |
| ------- | ------------- |
| M2 Redis 健康/降级/诊断 | 仅诊断；除非故障否则无新工作。 |
| M4 审计/监控事件扩张 v0 | 仅添加模块闭环所要求的审计事件。 |
| M5 诊断基础设施状态 | 除非验证发现回归，否则视为完成/强。 |
| M6 评分作答渲染测试 | 并入 P1 人工评分闭环。 |
| M7 Redis 不可用降级测试 | Redis 仅诊断时保持 N/A。 |
| M8 Email 重试测试 | 已完成；不再活跃。 |
| M9 Proctor 事件日志 v0 | 搁置；除非已合并，否则不属于 MVP 闭环。 |
| M10 CI/E2E 并行化就绪 | 之后；不阻塞 MVP 模块 E2E。 |
| M11 Phase 3 就绪收尾 | 被 P6 MVP 就绪收尾取代。 |

---

## 13. 重新分类的 Large Job

Large Job 不再是主执行队列。仅在模块无法安全推进、必须做架构决策时才开启 Large 设计。

### 阻塞/模块本地设计

| 旧 ID | 设计 | 新状态 |
| --------- | ------ | ---------- |
| L11 | 主观/富文本/画图作答架构 | 拆分：**纯主观文本 v0 属于 P0 Middle**，富文本/画图/上传延后。 |
| L2 | 后端权限模型 | 基础已接受；**MVP 路由切换属 P4 Middle**。 |
| L1 | Teacher/Proctor/Grader 账户模型 | 收敛到 Admin/Teacher/Candidate MVP；Proctor/Grader 专业化延后。 |
| L14 | 结果可见性/发布策略 | 使用既有模式；在 P3 中验证，先不做新设计。 |

### 延后设计

| 旧 ID | 设计 | 延后至 |
| --------- | ------ | -------------- |
| L3 | 自定义角色/自定义 RBAC | 待 MVP 角色在类生产流程中可用后。 |
| L7 | Proctor 运行时权限边界 | 待 P4 RBAC MVP 切换之后。 |
| L8 | UI 设计/工作台 UI 契约 | 仅并行；绝不可阻塞 P0–P3。 |
| L10 | E2E 全量并行化实施 | 待 MVP E2E 存在并稳定后。 |
| L12 | 租户/组织/学校作用域模型 | 多校部署之前，非 MVP 闭环之前。 |
| L15 | 通知/邮件策略 | 待 P3/P4 之后；先用 P5 最小接入。 |
| L16 | 题库/试卷版本化模型 | 待 MVP 命题暴露快照缺口后。 |
| L17 | 导入/导出/批量操作契约 | 待命题 MVP 之后。 |
| L18 | 部署/私有化运维契约 | 待 MVP 流程可演示后。 |
| L19 | 数据留存/隐私/审计脱敏 | 合规阶段。 |
| L20 | 报表/分析/分数统计模型 | 产品化阶段。 |

### 设计升级规则

```text
不要因为某个话题重要就开启 Large Job。
仅当某个具体模块离不开该设计才能继续时，才开启 Large Job。
```

---

## 14. 近期执行计划

### Step 0 — 替换计划

- 用本模块闭环计划替换旧 `docs/phase3/plan.md`。
- 在任意旧 job-card 索引中加一条短注：能力优先队列已退役。
- 保留旧审计文档作参考；不要删除。

### Step 1 — P-1/L0 考试协议与后端状态模型收敛

**这是 P0 之前必须完成的协议+基础设施阶段。** 不仅文档化协议，还实现 text_response 题型、submitted_answers 物理列、submit freeze、CandidateTakeSnapshot、deadline reconciliation、rubric 双层存储、publish validation 和 backfill 脚本。

```text
P3-PROTO-0  Exam Protocol Audit (L0)           [文档：exam-protocol.md，21 项协议]
P3-PROTO-1  Backend Consistency Tests (L0)      [测试：14 个场景]
P3-PROTO-2  CandidateTakeSnapshot Endpoint     [代码：统一端点]
P3-L0-1     Schema Migration                   [代码：text_response + submitted_answers + rubric]
P3-L0-2     Submit Freeze Rewrite              [代码：SubmittedAnswersSnapshot 冻结]
P3-L0-3     Deadline Reconciliation            [代码：懒触发收口]
P3-L0-4     Backfill Script                    [脚本：submitted_answers 回填]
P3-L0-5     Publish Validation                 [代码：text_response rubric 校验]
```

Step 1 的验收应狭窄：

- 产出 `docs/phase3/exam-protocol.md`，覆盖 21 项协议
- text_response 题型在 DB/API/Web 全链可用
- submitted_answers 物理列在 submit 时写入，评分从其读取
- CandidateTakeSnapshot 端点返回安全投影
- deadline reconciliation 在 4 个入口懒触发
- rubric 双层存储（questions.rubric → QuestionSnapshot.rubric）
- backfill 脚本可回填已有数据
- 不重写保存协议/冻结屏障实现（除非矩阵暴露真实阻塞）
- 不引入状态机库到后端
- 不做前端运行时

### Step 2 — 启动 P0（前端运行时，依赖 P-1/L0 完成）

在 P-1/L0 完成后：

```text
P3-FSM-0     deriveTakeExamView + transient reducer（消费 CandidateTakeSnapshot）
P3-MOD-P0-1  考生作答渲染审计
P3-MOD-P0-2  text_response 运行时
```

P0 的验收应狭窄：

- 前端状态模型只消费 CandidateTakeSnapshot，不发明业务规则
- 不引入 XState
- text_response 渲染 textarea，保留换行
- 不做富文本
- 不做文件上传
- 文本作答保存/恢复/提交的测试

### Step 3 — 立即推进 P1

在考生文本作答可用之后：

```text
P3-MOD-P1-1 人工评分 API/UI 证明
P3-MOD-P1-2 主观评分 E2E   （在考生主观作答可用之后）
```

### Step 4 — 闭环命题与结果流程

然后：

```text
P3-MOD-P2-3 考试发布到考生 E2E
P3-MOD-P3-1 结果可见性 E2E
```

### Step 5 — RBAC MVP 切换

仅在流程存在之后：

```text
P3-MOD-P4-1  MVP RBAC 路由矩阵
P3-MOD-P4-2A 评分路由切换
P3-MOD-P4-2B 题目 CRUD 路由切换
P3-MOD-P4-2C 考试命题/生命周期路由切换
P3-MOD-P4-3  考生路由保护验证
```

### Step 6 — 可选 Email 最小接入

在结果发布稳定之后：

```text
P3-MOD-P5-0 邮件收件人来源 + outbox 入队设计 v0
P3-MOD-P5-1 结果发布邮件触发 v0   （依赖 P5-0）
```

---

## 15. 下一步不要做的事

- **不要**仅因为基础设施存在就继续随机 Middle Job。
- **不要**把 Proctor 扩展为派单、权限动作、WebSocket/SSE 或事件生命周期。
- **不要**把 Redis 加入考生/考试/评分业务路径。
- **不要**在 MVP 中为主观作答做富文本、画图或文件上传。
- **不要**继续把 text_response 伪装成 `type=fill_blank + standardAnswer=null`。
- **不要**在 L0 完成前推进前端作答状态机或 text_response 运行时。
- **不要**在 P2/P3 暴露具体阻塞前重设计考试生命周期。
- **不要**在 Admin/Teacher/Candidate MVP 路由矩阵被接受前尝试完整 RBAC 迁移。
- **不要**在选定最小业务触发点前构建邮件模板/守护进程/偏好中心。
- **不要**在一个 PR 内同时改协议、前端运行时、RBAC 和邮件。
- **不要**把前端隐藏当作安全；后端落地仍是真相源。
- **不要**把诊断/审计/proctor/redis 当作 MVP 阻塞项，除非它们破坏核心流程。

---

## 16. 计划维护规则

- `docs/phase3/plan.md` 是战略计划。
- 可执行作业卡位于 `docs/phase3/job-cards-phase3-modules.md`。早先的 `job-cards.md` / `job-cards-large.md` 已退役至 `docs/archive/phase3-archive/`。
- 每个模块 PR 必须更新模块状态表。
- 一个模块没有测试证据不得标记完成。
- 一个 Large Job 未命名阻塞模块与决策不得开启。
- 已完成基础设施应列为构建块，而非活动 backlog。
- 延后工作必须保持延后，除非模块完成标准要求。
- 状态标签：
  - **Active** — 当前正在执行。
  - **Next** — 模块队列中的下一个。
  - **Strong** — 可用构建块。
  - **Parked** — 有意不纳入 MVP。
  - **Deferred** — 后续产品化/设计。
  - **Blocked** — 未命名决策无法推进。

---

## 17. ADR-009 关系

ADR-009 仍有用，但不应驱动即时运行时重写。

ADR-009 涉及前端交互状态机采纳：

- reducer + 转换表 + 测试
- 默认不引入 XState
- 后端业务状态仍是真相源

对于新模块优先计划：

| 话题 | 处理 |
| ----- | --------- |
| 考生前端状态机 | **属于 P0 的 `P3-FSM-0`**，升级为 `deriveTakeExamView` 纯函数 + 瞬态 reducer，消费 CandidateTakeSnapshot。**必须在 P-1/L0 完成后才执行**。不维护完整业务状态机；后端仍是真相源。 |
| Admin 考试运营机 | 延后到 P2 命题流程暴露状态 bug。 |
| 后端考试生命周期 | 除非 P2/P3 暴露歧义，否则使用既有命令函数。 |
| 答案协议 | 在 P-1 中显式化为协议矩阵与后端一致性测试；不重写实现，除非矩阵暴露真实阻塞。 |
| RBAC 前端门控 | 属于 P4，在后端路由矩阵之后。 |

---

## 18. 最终方向

```text
Phase 3 的下一步不是又一个基础设施 PR。

Phase 3 的下一步是让 MVP 考试流程真正跑通：
教师命题 → 考生作答 → 考生提交 → 教师评分 → 结果发布。

但考生作答运行时的正确性依赖协议真相与基础设施变更。
因此先做 P-1/L0（协议矩阵 + text_response + submitted_answers + submit freeze
+ CandidateTakeSnapshot + deadline reconciliation + rubric + backfill），
后做前端状态模型与 text_response 运行时。
```

执行从以下开始：

```text
P-1/L0 考试协议与后端状态模型收敛（L0 升级）
```

第一张具体作业卡应为：

```text
P3-PROTO-0 Exam Protocol Audit (L0)
```

然后：

```text
P3-PROTO-1 Backend Consistency Tests (L0)
P3-PROTO-2 CandidateTakeSnapshot Endpoint
P3-L0-1    Schema Migration
P3-L0-2    Submit Freeze Rewrite
P3-L0-3    Deadline Reconciliation
P3-L0-4    Backfill Script
P3-L0-5    Publish Validation
```

在 P-1/L0 完成后，才进入 P0：

```text
P3-FSM-0    deriveTakeExamView + transient reducer（消费 CandidateTakeSnapshot）
P3-MOD-P0-1 考生作答渲染审计
P3-MOD-P0-2 text_response 运行时
```

只有在 P0 之后，才应按顺序推进评分、命题、结果发布、RBAC 与邮件。
