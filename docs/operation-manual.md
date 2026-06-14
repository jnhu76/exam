# Phase 1 操作手册

本手册适用于 **Phase 1 Minimal Deliverable Exam System**。Phase 1 是单租户、多用户的最小可交付考试系统，当前产品路径只面向 Admin 和 Candidate。

Teacher / Proctor / 权限包 / 邮件邀请 / 邮件找回密码是后续阶段能力，不属于本手册的当前操作流程。

---

## 目录

1. [管理员操作](#管理员操作)
   - [首次初始化系统](#首次初始化系统)
   - [创建或重置 Admin](#创建或重置-admin)
   - [配置考生字段](#配置考生字段)
   - [批量导入考生](#批量导入考生)
   - [创建课程](#创建课程)
   - [批量导入试题](#批量导入试题)
   - [创建考试](#创建考试)
   - [发布考试](#发布考试)
   - [分配考生](#分配考生)
   - [导出成绩](#导出成绩)
2. [考生操作](#考生操作)
   - [登录系统](#登录系统)
   - [查看我的考试](#查看我的考试)
   - [参加考试](#参加考试)
   - [查看成绩](#查看成绩)
3. [常见问题](#常见问题)
4. [Future capabilities](#future-capabilities)

---

## 管理员操作

### 首次初始化系统

**前置条件**：首次使用系统。

**步骤**：

1. 系统内部已有 default organization，无需创建组织。
2. 创建第一个管理员账号（用户名 + 密码）。
3. 使用管理员账号登录系统。

**注意事项**：

- 管理员无需创建组织。
- 登录只需要 username/password，不需要组织标识。
- Phase 1 没有 SuperAdmin 操作入口。
- Admin 可以多个，是 Phase 1 当前部署内最高产品角色。

---

### 创建或重置 Admin

**场景**：新增管理员或管理员忘记密码。

**步骤**：

1. 已登录 Admin 可在用户管理中创建或停用其他 Admin。
2. 如果所有 Admin 都无法登录，在服务器本地执行 reset-password script。
3. 本地脚本执行应记录最小 AuditLog，并在 server log 中包含 requestId / actor 或 operator 信息。

**注意事项**：

- Phase 1 不提供邮件找回密码。
- reset-password script 是本地运维恢复机制，不是公网自助找回密码。

---

### 配置考生字段

**场景**：自定义考生身份字段（如姓名、编号、部门等）。

**步骤**：

1. 登录系统 → 进入“设置” → “考生字段”。
2. 点击“添加字段”。
3. 填写字段信息：
   - 字段名称：如 `candidateNo`
   - 字段标签：如“编号”
   - 字段类型：文本 / 下拉框
   - 是否必填
   - 是否唯一
   - 排序
4. 点击“保存”。
5. 重复添加其他字段。
6. 点击“下载模板”获取 CSV 导入模板。

**注意事项**：

- 字段名称使用英文，字段标签可使用中文。
- 排序决定导入模板中的列顺序。
- 唯一字段不能重复。
- 字段属于当前部署 / default organization。

---

### 批量导入考生

**前置条件**：已配置考生字段，已下载模板。

**步骤**：

1. 准备 CSV 文件（使用模板，UTF-8 编码）。
2. 打开“考生管理”页面。
3. 点击“导入考生”。
4. 上传 CSV 文件。
5. 系统显示验证结果：
   - 总行数
   - 新建
   - 更新
   - 错误
6. 点击“确认导入”。

**示例 CSV 内容**：

```csv
编号,姓名,部门
CAND001,张三,研发部
CAND002,李四,运营部
CAND003,王五,培训部
```

**错误处理**：

| 错误信息                | 解决方法                       |
| ----------------------- | ------------------------------ |
| Missing required fields | 检查必填字段是否填写           |
| Unique field exists     | 修改重复的唯一字段             |
| Invalid CSV format      | 使用 UTF-8 编码，检查列分隔符  |

**注意事项**：

- 重复导入会根据唯一标识更新已有考生信息。
- 若未提供 password，新建时使用临时密码；生产环境应要求首次登录修改密码。
- Candidate 不自助注册，由 Admin 创建或导入。

---

### 创建课程

**步骤**：

1. 进入“课程管理”页面。
2. 点击“新建课程”。
3. 填写课程信息：
   - 课程名称
   - 课程代码
   - 课程描述
4. 点击“保存”。

**注意事项**：

- 课程代码在系统内唯一。
- 试题归属于课程，考试归属于课程。

---

### 批量导入试题

**前置条件**：已创建课程。

**步骤**：

1. 准备 CSV 文件（见 `docs/import-export-format.md`）。
2. 进入“试题管理” → 选择课程 → 点击“导入试题”。
3. 上传 CSV 文件。
4. 系统显示验证结果。
5. 点击“确认导入”。

**示例 CSV 内容**：

```csv
type,content,optionA,optionB,optionC,optionD,standardAnswer,score,difficulty,tags
single_choice,下列哪个是质数？,2,3,5,7,B,5,3,基础
single_choice,1+1=?,1,2,3,4,B,5,2,基础
```

**注意事项**：

- Phase 1 由 Admin 导入试题。
- 题目类型：single_choice, multiple_choice, fill_blank, true_false。
- 标准答案：选择题用选项 id，填空题为文本，判断题为布尔值。
- 分值必须为正整数。

---

### 创建考试

**前置条件**：已创建课程，已导入试题。

**Phase 1 主路径**：`timed_window`。

**步骤**：

1. 进入“考试管理” → 点击“新建考试”。
2. 填写考试信息：
   - 考试名称
   - 所属课程
   - 考试时长
   - 开放时间
   - 结束时间
   - 及格分数
3. 配置题目：
   - Phase 1 使用手动选题。
   - 从试题库中勾选题目。
   - 查看总分。
4. 配置 Phase 1 控制项：
   - 题目顺序：打乱 / 原序
   - 选项顺序：打乱 / 原序
   - 是否显示结果
5. 点击“保存”。

**注意事项**：

- Phase 1 不把队列入场、限制 IP、锁定浏览器写成当前可用操作。
- 完整重考策略、成绩策略工作流如果当前未稳定，按 Phase 2 处理。
- 题目分数总和即为考试总分。

---

### 发布考试

**前置条件**：已创建考试。

**步骤**：

1. 进入“考试管理” → 选择考试 → 点击“发布”。
2. 确认考试配置、题目和开放时间。
3. 点击“发布”。

**发布后状态**：

- 考生被分配后可在“我的考试”中查看。
- 考生可在开放时间内开始考试。
- 发布后的题目快照不受题库后续修改影响。

---

### 分配考生

**前置条件**：已导入 Candidate，考试已创建或已发布。

**步骤**：

1. 进入考试详情页。
2. 点击“分配考生”或“添加考生”。
3. 从考生列表中勾选需要参加考试的考生。
4. 点击“确认”。

**注意事项**：

- Candidate 只有被分配后才能看到对应考试。
- 分配记录属于当前部署 / default organization。

---

### 导出成绩

**前置条件**：考试已有提交并完成批改。

**步骤**：

1. 进入“考试管理” → 选择考试 → 点击“导出成绩”。
2. 系统生成 CSV 文件并下载。
3. 用 Excel / WPS / 文本编辑器打开 CSV。

**CSV 内容示例**：

```csv
考生姓名,编号,部门,成绩,及格状态,尝试次数,提交时间
张三,CAND001,研发部,85,及格,1,2024-06-01T10:05:00.000Z
李四,CAND002,运营部,72,不及格,1,2024-06-01T10:08:00.000Z
```

**注意事项**：

- Phase 1 支持同步 CSV 导出。
- 大文件 export job / job log 属于 Phase 2。
- 列标题根据当前部署 / default organization 的 CandidateField 动态生成。
- 导出成绩应写入最小 AuditLog。

---

## 考生操作

### 登录系统

**步骤**：

1. 访问系统首页。
2. 输入用户名。
3. 输入密码。
4. 点击“登录”。

**注意事项**：

- 登录只需要 username/password。
- 不需要组织标识。
- 系统内部已有 default organization。

---

### 查看我的考试

**步骤**：

1. 登录系统。
2. 进入“我的考试”。
3. 查看考试列表：
   - 考试名称
   - 所属课程
   - 状态
   - 开放时间 / 结束时间
   - 我的成绩（如果允许显示）
4. 点击考试进入详情页。

---

### 参加考试

**前置条件**：考试已发布、已分配给当前 Candidate，且在开放时间内。

**步骤**：

1. 进入“我的考试” → 选择考试 → 点击“开始考试”。
2. 查看考试剩余时间（倒计时）。
3. 浏览题目。
4. 回答题目。
5. 系统按 Answer Save Protocol 自动保存答案。
6. 点击“提交”。
7. 在确认对话框中确认提交。
8. 如允许即时显示结果，提交后查看成绩。

**注意事项**：

- 服务端是计时权威。
- 自动保存不是只在提交时发生。
- 提交后不能修改答案。
- disrupted recovery UI 属于 Phase 2，Phase 1 只保证服务端恢复基础能力和诊断证据。

---

### 查看成绩

**步骤**：

1. 进入“我的考试”。
2. 查看考试列表中的“我的成绩”列。
3. 点击考试进入详情页。
4. 查看成绩详情：
   - 总分
   - 及格状态
   - 尝试次数
   - 提交时间
   - 各题得分（如允许显示）

---

## 常见问题

### Q: 如何重置考生密码？

A: Phase 1 应允许 Admin 重置 Candidate 密码，作为账户恢复机制。Candidate 忘记密码时应联系 Admin。

### Q: Admin 忘记密码怎么办？

A: 在服务器本地执行 reset-password script。该操作应记录最小 AuditLog，并保留 server log 证据。

### Q: 邮件找回密码什么时候支持？

A: 邮件找回密码属于 Phase 3 账号生命周期能力。

### Q: 如何重考？

A: 完整 retake policy / score strategy 工作流属于 Phase 2。Phase 1 只保证最小可靠提交、批改和结果展示路径。

### Q: 考试过程中断网了怎么办？

A: 系统会按 Answer Save Protocol 保存答案。网络恢复后应以服务端记录为权威。完整 disrupted recovery UI 与运营裁决属于 Phase 2。

### Q: 考试倒计时结束但未提交怎么办？

A: 以服务端时间和提交规则为准。Phase 1 主路径是 `timed_window`。

### Q: 如何导入大批量考生？

A: 使用 CSV 批量导入。确保 CSV 文件使用 UTF-8 编码，列标题与字段配置一致。

### Q: 如何删除考试？

A: 考试发布后不建议物理删除。Phase 1 至少保留结果和诊断可追溯；归档工作流在 Phase 2 完善。

### Q: 如何修改考试题目？

A: 考试发布后题目快照冻结。题库后续修改不影响已发布考试和历史答卷。

### Q: 如何查看考生切屏次数？

A: Phase 1 可保留 minimal behavior / warning / diagnostics。完整切屏统计、审计和处置属于 Phase 2。

### Q: 如何限制考试 IP？

A: IP 限制属于 Phase 2 Exam Operation。

### Q: 如何使用队列入场？

A: Queue admission 属于 Phase 2 Exam Operation。

### Q: 如何使用锁定浏览器？

A: Electron lockdown / 锁定浏览器属于 Phase 2 Exam Operation。

---

## Future capabilities

- Phase 2: proctor workflow、force submit、extend time、misconduct marking、queue admission、restrict IP、lockdown、disrupted recovery UI。
- Phase 3: Teacher-like scoped access、permission registry、role bundles、staff invitation、SMTP、email password reset。
- Phase 4: pass-to-proceed API、service token / API key、webhook、optional multiTenant、SuperAdmin、tenant switcher、organizationSlug login。
