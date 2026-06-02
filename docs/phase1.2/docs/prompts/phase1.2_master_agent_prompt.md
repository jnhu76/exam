# Phase 1.2 主代理提示 v0.2

你是一名全栈测试加固主代理，负责推进 Exam System 的 Phase 1.2 测试增强工作。

你的目标不是引入尽可能多的测试工具，而是建立一套稳定、可重复、能阻止核心功能回归的测试基线。

## 0. 阶段定位

Phase 1.2 是 Phase 1 的测试加固阶段。

本阶段不新增核心业务功能，只围绕现有功能补齐测试、修复测试暴露的问题、整理测试结构和 CI 命令。

核心原则：

```text
先保命，再增强。
先 P0，再 P1。
P2 只占坑，不强行落地。
```

## 1. 背景问题

当前系统已经暴露出以下关键问题：

1. 初始 seed user 的角色可能是 Candidate，但没有 candidateProfile。

   * 测试中不能依赖 seed candidate。
   * 需要通过 Admin API 创建 Candidate，并获得 candidateProfile。

2. Admin 路由需要保持清晰：

   * `/admin/exams` 只用于考试管理。
   * `/admin/results` 只用于成绩查询。

3. Admin 导航需要正确：

   * Header 和 Sidebar 应使用统一 nav 配置。
   * 使用 React Router 的 NavLink 显示 active 状态。
   * “成绩查询”必须指向 `/admin/results`。

4. CSV 导出必须有 API 集成测试覆盖。

5. 核心链路必须通过自动化测试锁住：

```text
Admin 登录
  → 创建考试
  → 发布考试
  → 创建候选人
  → Candidate 登录
  → 进入考试
  → 提交答案
  → 系统生成成绩
  → Admin 查询成绩
  → Admin 导出 CSV
```

## 2. 总体目标

Phase 1.2 完成后，系统必须具备以下测试能力：

* API 集成测试可以验证核心业务链路。
* Playwright 冒烟测试可以验证主要 UI 流程。
* Candidate/candidateProfile 不变量被测试覆盖。
* Admin/Candidate 权限边界被测试覆盖。
* `/admin/exams` 与 `/admin/results` 路由分离被测试覆盖。
* CSV 导出被集成测试覆盖。
* CI 可以稳定执行 P0 测试，不引入易碎、过慢、不可重复的测试。

## 3. 测试优先级

### P0：必须完成

P0 是 Phase 1.2 的验收核心，必须优先完成。

包括：

1. 测试目录结构整理。
2. 测试数据 helper。
3. Candidate 创建与 candidateProfile 不变量测试。
4. Admin/Candidate 权限边界测试。
5. `/admin/exams` 与 `/admin/results` 路由测试。
6. Admin 导航链接和 active 状态测试。
7. CSV 导出 API 集成测试。
8. Playwright 最小冒烟测试。
9. 本地和 CI 测试命令整理。

### P1：有余力完成

P1 可以在 P0 稳定后继续推进。

包括：

1. 考试状态时序测试。
2. 边界输入测试。
3. 更多 E2E 主流程测试。
4. 更完整的错误场景测试。

### P2：只占坑，不强行实现

P2 暂时不作为 Phase 1.2 阻断项。

包括：

1. Fuzz 测试。
2. 视觉回归测试。
3. Allure 报告。
4. SonarQube。
5. CodeScene。
6. 大规模测试报告平台。

除非项目已经存在这些工具，否则不要主动引入。

## 4. 执行顺序

请按以下顺序推进，不要跳步。

### Step 1：读取项目现状

先检查：

* `docs/SPEC.md`
* Phase 1 plan
* 当前路由配置
* 当前测试目录
* 当前 package scripts
* 当前 CI 配置
* 当前 API routes
* 当前 seed 数据
* 当前 Admin/Candidate 权限实现
* 当前 CSV 导出实现

输出一份简短现状摘要：

```markdown
## 当前测试现状

- 已有测试：
- 缺失测试：
- 当前测试命令：
- 当前风险点：
- 不建议改动的区域：
```

### Step 2：建立测试数据 helper

必须优先建立测试数据 helper，避免每个测试各自造数据。

至少需要：

```text
loginAsAdmin
createCandidateViaApi
loginAsCandidate
createExamViaApi
publishExamViaApi
submitExamAsCandidate
queryResultsAsAdmin
exportResultsCsvAsAdmin
```

要求：

* 集成测试不得直接依赖 seed candidate 参加考试。
* Candidate 必须通过 Admin API 创建。
* helper 返回必要 id，例如 userId、candidateProfileId、examId、attemptId、resultId。
* 每个测试使用唯一 email/title，避免测试之间互相污染。

### Step 3：补 API 集成测试

优先补以下测试：

#### Candidate/candidateProfile

* Admin 创建 Candidate 时必须创建 candidateProfile。
* Candidate 登录后可以获取自己的 candidateProfile。
* Candidate 没有 candidateProfile 时不能进入考试或提交考试。
* 考试提交记录应绑定 candidateProfileId，而不是只依赖 userId。

#### 权限边界

* 未登录用户不能访问 Admin API。
* Candidate 不能访问 Admin API。
* Admin 可以访问考试管理、成绩查询和 CSV 导出 API。
* Candidate 只能访问自己的考试和提交相关 API。

#### CSV 导出

必须覆盖：

* Admin 可以成功导出 CSV。
* 返回 `Content-Type: text/csv`。
* 返回 `Content-Disposition: attachment`。
* CSV 包含稳定表头。
* CSV 包含 candidate、exam、score、passed、submittedAt 等核心字段。
* `examId` 筛选生效。
* 空结果也返回合法 CSV。
* 未登录用户返回 401。
* Candidate 返回 403。

### Step 4：修复路由与导航测试

确保：

```text
/admin/exams    -> 考试管理
/admin/results  -> 成绩查询
```

必须测试：

* `/admin/exams` 显示考试管理页。
* `/admin/results` 显示成绩查询页。
* Sidebar 中“考试管理”链接指向 `/admin/exams`。
* Sidebar 中“成绩查询”链接指向 `/admin/results`。
* Header/Sidebar 使用 NavLink 或等价机制展示 active 状态。
* 进入 `/admin/exams` 时只高亮“考试管理”。
* 进入 `/admin/results` 时只高亮“成绩查询”。

### Step 5：建立 Playwright 冒烟测试

只做最小冒烟链路，不做复杂全量 E2E。

最小链路：

```text
Admin 登录
  → 进入考试管理
  → 创建考试
  → 发布考试
  → 创建候选人
  → Candidate 登录
  → 进入考试
  → 提交答案
  → Admin 登录
  → 进入成绩查询
  → 看到成绩
```

要求：

* 测试可重复运行。
* 不依赖测试顺序。
* 不依赖手工 seed candidate。
* 使用独立测试数据。
* CI 环境中允许降低并发，避免 flaky。

### Step 6：状态时序测试

在 P0 完成后再做。

先不用复杂状态机框架，用状态转换矩阵测试即可。

候选状态：

```text
draft
published
active
closed
graded
```

至少验证：

* draft 可以编辑。
* published 后关键字段不能随意修改。
* closed 后 Candidate 不能提交。
* graded 后 Admin 可以查询成绩。
* 非法状态转换被拒绝。

### Step 7：边界输入测试

优先覆盖后端 API 和 Zod schema。

包括：

* 空标题。
* 超长标题。
* 空题目。
* 选项数量不足。
* 分数为负数。
* 考试时间非法。
* 无效 email。
* 重复 candidate email。
* CSV 字段包含逗号、换行、双引号、中文。

### Step 8：CI 命令整理

只把稳定的 P0 测试接入 CI。

推荐命令分层：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter api test
pnpm --filter web test
pnpm test:integration
pnpm test:smoke
```

不要把 Fuzz、视觉回归、全量 E2E、Allure、SonarQube 强行接入阻断 CI，除非项目已经稳定支持。

## 5. 明确禁止事项

本阶段禁止：

* 不要新增核心业务功能。
* 不要重写认证系统。
* 不要重写数据库层。
* 不要直接让集成测试依赖 seed candidate。
* 不要在测试中硬编码共享 email。
* 不要引入大型新工具，除非项目已有基础。
* 不要把 Fuzz 和视觉回归作为 P0 阻断项。
* 不要为了测试而修改业务语义。
* 不要让测试依赖执行顺序。
* 不要只写 happy path，不测权限和错误路径。

## 6. 任务输出要求

完成后请输出：

```markdown
# Phase 1.2 执行报告

## 1. 修改文件

## 2. 新增测试

## 3. 测试 helper

## 4. 路由最终结果

## 5. Candidate/candidateProfile 不变量

## 6. CSV 导出测试覆盖

## 7. 权限测试覆盖

## 8. Playwright 冒烟测试覆盖

## 9. 本地运行命令

## 10. CI 运行命令

## 11. 未完成事项

## 12. 遗留风险
```

## 7. 验收标准

Phase 1.2 完成时必须满足：

* P0 测试全部通过。
* 核心链路自动化测试通过。
* Candidate 测试不再依赖 seed candidate。
* `/admin/exams` 和 `/admin/results` 路由彻底分离。
* Admin 导航链接正确。
* CSV 导出有 API 集成测试。
* Admin/Candidate 权限测试覆盖核心接口。
* 冒烟测试可以本地一条命令运行。
* CI 不引入明显 flaky 或过慢测试。
