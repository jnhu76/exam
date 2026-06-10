# Bounded Review Context

## 一句话定位

**为 `superpowers` 的代码审查技能增加"边界控制"能力 —— 防止 PR 范围蔓延，自动分类遗留问题，沉淀项目风险库。**

## 核心价值

- ✅ 审查前：明确定义本次 PR 的 **In Scope / Out of Scope**，禁止审查者提出超范围意见。
- ✅ 审查后：自动将审查发现分类为 `Fix now` / `Defer issue` / `Reject` 等，超范围问题自动进入 `followup-jobs/`。
- ✅ 长期积累：将反复出现的风险模式写入 `review-profiles/`，后续 PR 自动加载相关 profile。

## 与 `superpowers` 技能的关系

| 技能 | 职责 | 本技能的角色 |
| :--- | :--- | :--- |
| `requesting-code-review` | 发起一次代码审查请求 | 本技能生成 **Review Context Pack** 后，**调用** `requesting-code-review` 并附上该 context |
| `receiving-code-review` | 处理审查意见（分析、回应、修改） | 本技能的 `absorb-review-findings` 先对意见**分类 + 路由**，再把需要作者决策的部分交给 `receiving-code-review` |
| `chinese-code-review` | 作为审查者写出中文 CR 评论 | 本技能不干预 —— 边界控制对审查者的输出格式无要求 |

> 简单说：**你用本技能划界 + 路由，用 superpowers 技能执行具体的审查和回应。**

---

## 快速开始（10 分钟体验完整工作流）

### 前置条件
- 项目已有 `git` 仓库。
- 你已准备好一个待审查的 PR（或一个已完成的功能分支）。

### Step 1: 初始化目录结构
```bash
# 让 AI 执行以下指令（在对话中说出即可）
"使用 bounded-review-context 的 init 模式，在 docs/ai 下创建目录，并实例化 starter profiles: backend-db-async, api-auth-tenant"
```
AI 会在项目根目录下创建：
```
docs/ai/
  pr-boundaries/
  review-profiles/
  review-decisions/
  followup-jobs/
```
并将选中的 profile 模板复制到 `review-profiles/`。

### Step 2: 为当前 PR 创建边界文档
```bash
"当前分支名 feature/add-login，基准分支 main。这是我的 Job Card / PR 描述：[粘贴内容]。请使用 bounded-review-context create-boundary 模式，生成 docs/ai/pr-boundaries/feat-login.md"
```
AI 会根据模板生成一份边界文档，包含：
- Primary Goal
- In Scope
- Out of Scope
- Allowed Files
- Forbidden Expansion
- Required Review Profiles

> **关键**：如果 AI 发现 diff 中包含了不在 `Allowed Files` 里的文件，会在边界文档中标注 `Boundary Drift`。

### Step 3: 构建审查上下文包（Review Context Pack）
```bash
"使用 bounded-review-context build-review-context 模式，基于刚才的边界文档和相关 profile，生成 Review Context Pack"
```
AI 会输出一个精简的上下文包，包含：
- 当前边界摘要
- 相关的 profile 片段
- 强制要求的审查输出表格模板
- 最后一句指令：**"Now use superpowers requesting-code-review with this Review Context Pack"**

### Step 4: 发起审查
此时 AI 会自动调用 `requesting-code-review` 并附上该上下文包。  
审查者（人或 AI）收到的指示中明确写着：**禁止超出边界提出意见**。

### Step 5: 收到审查意见后，吸收并分类
假设你收到了 CodeRabbit 或同事的 10 条评论：
```bash
"请使用 bounded-review-context absorb-review-findings 模式，审查意见如下：[粘贴评论]。当前边界文档是 docs/ai/pr-boundaries/feat-login.md"
```
AI 会将每条评论分类：
- `Fix now` → 必须本次 PR 修复
- `Add test now` → 必须本次 PR 补充测试
- `Defer issue` → 真实问题但超出边界，生成 `followup-jobs/xxx.md`
- `Investigate` → 证据不足，需要进一步分析
- `Reject` → 误报或无效意见

分类结果写入 `docs/ai/review-decisions/feat-login-review.md`。  
**超范围的遗留问题自动生成 followup job，不会阻塞当前 PR。**

### Step 6: 处理需要你回应的意见
对于 `Fix now` / `Add test now` 类意见：
```bash
"现在使用 superpowers 的 receiving-code-review 技能，帮我处理这些需要修复的意见"
```
你继续用 `receiving-code-review` 的标准流程（先验证、再修改、后回复）。

### 一次 PR 的完整推进流（图示）
```text
[写代码] 
   ↓
init 目录 + profiles（仅首次）
   ↓
create-boundary（基于 job card + diff）
   ↓
build-review-context → Review Context Pack
   ↓
requesting-code-review（superpowers） → 审查者输出意见
   ↓
absorb-review-findings（分类 + 路由）
   ↓
├─ Fix now / Add test now → receiving-code-review（你处理）
├─ Defer issue → 自动生成 followup job
└─ Reject → 记录决策，不做事
   ↓
[修改代码 → 验证 → 合并]
```

---

## 各模式详解

### `init` – 初始化目录和 starter profiles
**何时用**：第一次在项目中使用本技能时。

**输入**（可选）：
- 目标根目录（默认 `docs/ai`）
- 要实例化的 starter profile 列表（例如 `backend-db-async, api-auth-tenant`）
- 当前 phase/job 名称（若需要立即创建第一个边界文档）

**行为**：
- 创建 `pr-boundaries/`, `review-profiles/`, `review-decisions/`, `followup-jobs/`
- 将选中的 starter profile 从 `skills/bounded-review-context/templates/review-profiles/` 复制到项目 `review-profiles/`
- 如果提供了 job 名称，同时创建第一个边界文档

### `create-boundary` – 为当前 PR 创建边界文档
**何时用**：每个新 PR / 新功能分支开始前（或 diff 已存在时）。

**输入**：
- 边界文档输出路径（例如 `docs/ai/pr-boundaries/phase1-auth.md`）
- Job Card 或 PR 描述
- 分支名、基准分支
- `git diff --stat` 和 `git diff --name-only`（AI 可自动获取）
- 可选：指定要使用的 review profiles

**输出**：
- 边界文档，其中包含明确的 **Boundary Drift** 标注（如果 diff 包含不相关文件）

### `update-boundary` – 当 PR 发生变化时更新边界
**何时用**：你在 PR 中新增了 commit，改变了 diff。

**行为**：
- 检查新增文件是否仍在允许范围内
- 如果超出，输出 `Boundary Drift Detected`，建议拆分 PR 或回退

### `create-or-update-profile` – 维护长期 review profiles
**何时用**：
- 新发现一个反复出现的风险模式（例如"所有异步数据库操作必须设置超时"）
- 需要更新现有 profile 的检查项

**输入**：
- profile 路径
- 确认的长期风险事实（非一次性任务）

**行为**：
- 从模板或 starter profile 创建新 profile
- 或更新现有 profile 的检查清单
- **不会**添加临时 PR 细节或误报

### `absorb-review-findings` – 吸收审查意见并分类
**何时用**：收到外部审查意见后，合并代码前。

**输入**：
- 审查意见列表
- 当前边界文档
- 相关 review profiles
- （可选）当前 diff

**输出**：
- `review-decisions/<job>-review.md` – 每条意见的分类和决策
- 可能更新 `review-profiles/*.md` – 新发现的长期模式
- 可能新建 `followup-jobs/*.md` – 超范围的遗留问题

### `build-review-context` – 生成最终 review context pack
**何时用**：紧接在 `create-boundary` 之后，调用 `requesting-code-review` 之前。

**行为**：
- 读取边界文档、相关 profiles、job card、diff 统计
- 生成一个精简的 **Review Context Pack**（不含无关历史对话）
- 在末尾添加强制指令：**要求审查者按表格输出，禁止超出边界**

---

## 常见问题

### Q1: 我必须使用所有模式吗？可以只用"边界控制"部分吗？
**A**: 可以。最低有效组合是：`create-boundary` + `build-review-context` + `absorb-review-findings`（仅做分类，不自动生成 followup job）。  
`init` 和 `update-boundary` 和 `create-or-update-profile` 都是可选的。

### Q2: 边界文档写得太死板，PR 过程中发现必须改一个边界外的文件怎么办？
**A**: 使用 `update-boundary` 模式，它会让你确认这是合法的范围扩展还是意外漂移。如果是合法扩展，更新边界文档并重新走流程。

### Q3: 审查意见中有很多"历史债务"建议，我不想本次修，怎么处理？
**A**: `absorb-review-findings` 会自动将超范围的真问题分类为 `Defer issue` 并生成 followup job。你只需在 PR 描述里引用这个 job 即可。

### Q4: 我既想用本技能控制边界，又希望审查者（人类）能自由提改进建议，怎么办？
**A**: 在 Review Context Pack 的"禁止扩展"部分改为："允许提出 Out of Scope 的建议，但须明确标记为 [Future Improvement]，且不 blocking 当前 PR"。  
本技能的模板支持自定义规则。

### Q5: 这个技能会影响 `receiving-code-review` 的使用方式吗？
**A**: 不影响。`absorb-review-findings` 分类后，只有 `Fix now` 和 `Add test now` 会进入 `receiving-code-review` 流程。你在 `receiving-code-review` 中的行为与原先完全一致。

---

## 文件与目录结构（示例）

```text
<project-root>/
  docs/ai/
    pr-boundaries/
      feat-login.md               # 当前 PR 边界
      fix-payment-timeout.md
    review-profiles/
      backend-db-async.md         # 长期 profile：数据库异步规范
      api-auth-tenant.md          # 长期 profile：租户认证
      state-machine.md
    review-decisions/
      feat-login-review.md        # 本次 PR 的审查决策记录
    followup-jobs/
      add-global-timeout-config.md
  .claude.md                      # 可在此配置自动加载本技能
  skills/
    bounded-review-context/       # 本技能所在目录
      templates/                  # 不要手动编辑项目内的模板
```

---

## 与 `superpowers` 的最终协作方式

| 你在对话中说 | 实际调用的技能链 |
| :--- | :--- |
| "为这个 PR 准备边界审查" | `bounded-review-context` (build-review-context) → `requesting-code-review` |
| "帮我分类这些审查意见" | `bounded-review-context` (absorb-review-findings) → 人类阅读 `review-decisions/` → 对于 `Fix now` 条目，人工触发 `receiving-code-review` |
| "用中文审查同事的 PR #123" | `chinese-code-review`（本技能不介入） |

> **建议**：在项目根目录的 `.claude.md` 或 `AGENTS.md` 中加入一句：
> "在发起代码审查前，优先使用 `bounded-review-context` 构建边界；在接收审查意见后，优先使用 `bounded-review-context absorb-review-findings` 分类。"

---

## 贡献与反馈

本技能是 `superpowers-zh` 方法论体系的一部分。如需改进边界模板、增加 starter profiles，请修改 `skills/bounded-review-context/templates/` 下的文件，并提交 PR。
