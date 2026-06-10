# Exam System - 规格文档 (Specification)

> 本文档定义系统的**不变原则**和**当前推荐实现**。
> 不变原则是宪法——任何实现不得违背。推荐实现是当前默认方案，可随技术演进替换。
> 所有 agent session 开始前必须理解本文内容。

---

## 一、系统定位

**通用型内网考试平台。**

部署在校园/机构内网（LAN），服务多种考试场景：实验室准入考试、学院考试、培训确认测验、闭卷期末考试等。核心链路——

```txt
机构/租户 → 题库 → 组卷 → 考试执行 → 答案保存 → 自动批改 → 出分 → 达标放行
```

各院系/实验室/部门作为租户接入，各自管理题库和考试。考生不限于学生——由各机构自己定义考生身份。

### 不变原则

- 考试数据不丢——已作答内容在任何故障场景下都必须可恢复
- 租户隔离——A 机构看不到 B 机构的任何数据
- 服务端计时——倒计时、超时判定以服务端时间为准
- 答卷可恢复——断线/崩溃后考生可从服务端恢复答案和剩余时间
- 题目快照——组卷后题目冻结，题库修改不影响历史答卷
- 服务端是数据权威——客户端是展示层，答案以服务端记录为准

---

## 二、核心领域模型

### 2.1 实体关系

```
Organization (机构/租户)
 ├── 支持平铺（多个独立机构）和树形层级（大学→学院→实验室）
 ├── 每个租户有自己的 Admin、题库、考试、考生字段定义
 └── 数据隔离：A 机构看不到 B 机构的题目和成绩

SuperAdmin (平台管理员)
 └── 跨租户管理所有机构

Organization 内部：
 User (用户)
  ├── Admin    → 管理本机构、用户管理、考场管理、考生字段配置
  ├── Teacher  → 出题、组卷、审卷、查看成绩
  ├── Proctor  → 监考（查看考场状态、处理异常、标记违纪）
  │             注：教师可以兼任监考，监考权限是教师权限的子集
  └── Candidate → 参加考试（通用身份，不绑定"学生"语义）
                  考生属性由机构自定义（学号/工号/身份证号等）
                  内部 ID 用 UUID，用户可见标识由机构定义

Course (课程/科目)
 └── 属于某个 Organization

QuestionBank (题库)
 └── 按 Course 组织（各机构题库隔离）
      └── Question (题目)
           ├── type: single_choice | multiple_choice | fill_blank | true_false
           ├── content: 题干（支持文字 + 图片引用）
           ├── attachments[]: 图片/附件 URL
           ├── options[]: 选项（选择题）
           ├── standardAnswer: 标准答案（自动批改的依据）
           ├── score: 分值
           └── tags[]: 标签（知识点、难度）

Exam (考试)
 ├── 从 QuestionBank 中抽题组卷
 ├── passingScore: 及格线
 ├── timing: timed_sync | timed_window | deadline | untimed（见 §2.4）
 ├── durationMinutes: 考试时长（timed 模式必填）
 ├── 管控细项（每项可独立开关，见 §2.5）
 └── startTime / endTime: 开放时间窗口

ExamRoom (考场) [Phase 2]
 ├── name: 考场名称
 ├── ipRange: 允许的 IP 段（LAN 安全）
 └── capacity: 容量

ExamEnrollment (考试资格)
 ├── 某考生被允许参加某场考试
 ├── status: assigned | started | completed | blocked
 ├── finalScore / finalPassed: 最终认定成绩（按 scoreStrategy 选）
 └── finalAttemptId: 最终认定的那次 attempt

ExamAttempt (答题记录)
 ├── 某考生 × 某考试 × 第 N 次尝试
 ├── attemptNo: 第几次尝试（从 1 开始）
 ├── questionSnapshot: 题目快照（组卷时冻结，不随题库修改变化）
 ├── answers: 考生的作答（带版本号）
 ├── score / passed: 本次得分与通过状态
 └── lastActivityAt: 心跳时间（断线检测）
```

### 2.2 ExamAttempt 模型（核心）

ExamAttempt 是考试系统的核心实体，取代原来的"一份答卷"概念。系统支持多次考试、多种重考策略、多种取分策略，因此必须区分：

```
考试资格 (ExamEnrollment)  — 这个考生是否被允许参加
考试次数 (attemptNo)       — 这是第几次尝试
单次答题记录 (ExamAttempt) — 这次答题的具体内容
最终认定成绩               — 按 scoreStrategy 从多次中选
```

**ExamAttempt 状态机**：

```
not_started → queued → in_progress → submitted → grading → graded
                                     ↑                    ↓
                                     └── disrupted   voided
```

| 状态 | 含义 |
|------|------|
| `not_started` | 已创建，尚未开始 |
| `queued` | 排队中（requireQueue 时） |
| `in_progress` | 正在答题 |
| `disrupted` | 心跳超时自动标记（60s 无心跳） |
| `submitted` | 已交卷，等待批改 |
| `grading` | 正在批改 |
| `graded` | 批改完成 |
| `voided` | 已作废（监考员或管理员操作） |

**ExamAttempt 数据结构**：

```ts
ExamAttempt {
  id: string
  organizationId: string
  examId: string
  candidateId: string
  attemptNo: number

  status: "not_started" | "queued" | "in_progress" | "disrupted"
         | "submitted" | "grading" | "graded" | "voided"

  startedAt?: Date
  submittedAt?: Date
  deadlineAt?: Date
  lastActivityAt?: Date

  questionSnapshot: QuestionSnapshot[]
  answers: AnswerRecord[]

  score?: number
  passed?: boolean
}
```

**ExamEnrollment 状态**：

```
assigned → started → completed
                  ↘ blocked（违反规则被禁止继续）
```

**ExamEnrollment 数据结构**：

```ts
ExamEnrollment {
  id: string
  organizationId: string
  examId: string
  candidateId: string
  status: "assigned" | "started" | "completed" | "blocked"
  attemptCount: number
  finalScore?: number
  finalPassed?: boolean
  finalAttemptId?: string
}
```

Enrollment 职责：

- 表达"某考生被允许参加某考试"的资格
- 跟踪该考生的考试次数（用于 retakePolicy 判断）
- 按 scoreStrategy 从多次 ExamAttempt 中选择最终认定成绩
- 与 ExamAttempt 是 1:N 关系

**ExamAttempt 时间模型**：

```ts
deadlineAt = startedAt + durationMinutes
remainingSeconds = deadlineAt - serverNow
```

- 客户端只负责显示倒计时
- 交卷是否超时以服务端为准
- 离线期间计时不停
- 客户端时间不可信

### 2.3 考生模型

系统不预设"考生是学生"——每个机构自己定义考生的身份字段。

```
化学学院可能定义：
  - 姓名（必填）、学号（必填，唯一标识）、班级、实验室

安全培训部可能定义：
  - 姓名（必填）、工号（必填，唯一标识）、部门、手机号

外部培训机构可能定义：
  - 姓名（必填）、身份证号（必填，唯一标识）、单位
```

**CandidateField（考生字段模板）**：

- 每个 Organization 可自定义 N 个考生字段
- 每个字段可配置：名称、类型（text/number/select）、是否必填、是否作为唯一标识
- 考生导入模板根据字段定义动态生成
- 成绩导出时按该机构的字段输出对应列

**标识规则**：

- 系统内部 ID 统一用 UUID
- 用户可见的"考号/学号/工号"是机构自定义的唯一标识字段
- 标识可以是数字、字母、混合（如 `s2024001`、`b2024001`、`2024010001`）
- 系统不假设标识的格式，只保证唯一性

### 2.4 角色权限矩阵

| 能力 | SuperAdmin | Admin | Teacher | Proctor | Candidate |
|------|:----------:|:-----:|:-------:|:-------:|:---------:|
| 跨租户管理 | ✅ | - | - | - | - |
| 机构设置 / 考生字段 | - | ✅ | - | - | - |
| 用户管理 | - | ✅ | - | - | - |
| 考场管理 | - | ✅ | - | - | - |
| 出题 / 题库 | - | ✅ | ✅ | - | - |
| 组卷 / 发布考试 | - | ✅ | ✅ | - | - |
| 查看所有成绩 | - | ✅ | ✅ | - | - |
| 监考：查看考场实时状态 | - | ✅ | ✅ | ✅ | - |
| 监考：延长个人时间 | - | ✅ | ✅ | ✅ | - |
| 监考：标记违纪 | - | ✅ | ✅ | ✅ | - |
| 监考：强制交卷 | - | ✅ | ✅ | ✅ | - |
| 参加考试 | - | - | - | - | ✅ |
| 查看自己成绩 | - | - | - | - | ✅ |

### 2.5 考试计时模式

四种计时方式，覆盖从"严格统考"到"随到随考"的全部场景：

| 模式 | 时间规则 | 典型场景 |
|------|----------|----------|
| **定时统考** `timed_sync` | 监考员统一触发开考，所有人同时开始倒计时，到时强制交卷 | 期末考试、软考机考 |
| **窗口限时** `timed_window` | 在开放窗口内考生自选时间开始，开始后倒计时 | 实验室准入、随堂测验 |
| **纯截止日** `deadline` | 只有截止时间，不计时，做完就交 | 培训确认、课后作业 |
| **不限时** `untimed` | 永久开放，随时做随时交（或管理员手动关闭） | 练习题、模拟考试 |

```
timed_sync 示例：
  Proctor 点击"开考" → 考生排队分批进入 → 开始 90 分钟倒计时
  窗口：周一 9:00-11:00，最迟 10:30 可开始（预留 buffer）

timed_window 示例：
  开放窗口：周一到周五
  考生周三 14:00 点"开始" → 开始 60 分钟倒计时
  周五 23:59 窗口关闭，未开始的不能再进入

deadline 示例：
  截止时间：本周日 23:59
  不计时，做完点交卷，没做的话到截止日自动提交

untimed 示例：
  长期开放的练习题，不限时
  管理员可随时手动关闭
```

### 2.6 管控与考试模式

管控强度独立于计时方式，两者正交组合。Teacher 组卷时先选计时方式，再逐项勾选管控选项。系统提供"开卷预设"和"闭卷预设"快速填充默认值，但每一项都能单独改。

| 管控项 | 开卷预设 | 闭卷预设 | 说明 |
|--------|:--------:|:--------:|------|
| `shuffleQuestions` | 关 | 开 | 题目乱序 |
| `shuffleOptions` | 关 | 开 | 选项乱序 |
| `detectTabSwitch` | 关 | 开 | 切屏检测（Phase 1 仅记录+报告监考员） |
| `disableCopyPaste` | 关 | 开 | 前端禁用右键/选择/复制 |
| `requireQueue` | 关 | 开 | 排队分批进入 |
| `batchSize` | - | 10 | 每批放行人数 |
| `batchInterval` | - | 3 | 批次间隔秒数 |
| `restrictIp` | 关 | 开 | 仅允许考场 IP 段 [Phase 2] |
| `requireLockdown` | 关 | 关 | 强制 Electron 锁屏 [Phase 2] |
| `showResultImmediately` | 开 | 可配置 | 交卷后是否立即显示成绩 |
| `retakePolicy` | unlimited | max_attempts | 重考策略 |
| `maxRetakeAttempts` | - | 1 | 最大重考次数 |
| `retakeCooldown` | 0 | 60 | 重考冷却时间（分钟） |
| `scoreStrategy` | highest | latest | 多次考试取分策略 |
| `passThenStop` | 开 | 关 | 通过后不能再考 |

### 2.7 考试次数限制

| retakePolicy | 说明 |
|-------------|------|
| `unlimited` | 不限次数 |
| `max_attempts` | 最多 N 次 |
| `daily_limit` | 每天最多 N 次 |
| `weekly_limit` | 每周最多 N 次 |
| `pass_then_stop` | 通过后不能再考 |

| scoreStrategy | 说明 |
|--------------|------|
| `highest` | 取最高分（默认） |
| `latest` | 取最近一次 |
| `first` | 取第一次 |

多次考试的 ExamAttempt 记录都保留，只是 ExamEnrollment 的最终认定成绩按策略选。

### 2.8 多租户与"达标放行"

```
Organization (机构/租户)
  ├── 拥有自己的 Admin、Teacher、题库、考试、考生字段定义
  ├── 数据隔离：A 机构看不到 B 机构的题目和成绩
  ├── 支持平铺 + 树形层级（大学→学院→实验室，上级可看下级）[Phase 3]
  └── SuperAdmin 跨租户管理

"达标放行"流程：
  考试发布 → 考生参加 → 自动批改 → score >= passingScore → passed=true
       ↓
  外部系统可通过 API 查询"某人是否通过了某考试" [Phase 2]
  （如：实验室门禁系统调接口确认已通过安全考试才放行）
```

租户隔离规则：

- 数据库层面：所有表都有 `organizationId` 字段，查询时强制过滤
- 一个 Candidate 可以属于多个 Organization
- 树形层级中，上级 Organization 的 Admin 可查看下级数据 [Phase 3]

### 2.9 客户端架构

系统提供两种客户端，共享同一套 React 代码：

| 客户端 | 场景 | 特性 |
|--------|------|------|
| **Web（浏览器）** | Teacher/Proctor/Admin 后台、开卷考试、Phase 1 全场景 | 标准浏览器 |
| **Electron 桌面端** | 闭卷考试锁屏 [Phase 2] | 禁止切应用、全屏强制、设备指纹 |

---

## 三、考试系统底座原则

> 这 8 项是考试系统的技术底座，不是业务功能，而是所有业务功能的安全网。任何实现必须遵循。

### 3.1 Tenant Guard：多租户隔离底座

所有业务请求必须生成 `RequestContext`：

```ts
RequestContext {
  actorId: string
  organizationId: string
  role: Role
  permissions: Permission[]
  sessionId: string
}
```

规则：

- 没有 RequestContext，不能访问业务数据
- 没有 organizationId，不能查询租户数据
- Route 层禁止直接访问 db
- 所有 repository 方法必须显式接收 ctx
- SuperAdmin 跨租户操作必须显式声明 targetOrganizationId

**必须**：

```ts
questionRepo.findById(ctx, questionId)
examRepo.listByOrganization(ctx, filters)
attemptRepo.saveAnswer(ctx, attemptId, payload)
```

**禁止**：

```ts
db.select().from(question).where(eq(question.id, id))
```

### 3.2 RBAC Guard：权限底座

规则：

- 权限判断不散落在 route handler 里
- 每个 API endpoint 必须声明 requiredPermission
- Teacher / Proctor / Admin 的权限边界必须由中间件统一检查
- 考试期间的特殊权限（强制交卷、延时、标记违纪）必须写入 AuditLog

### 3.3 Exam State Machine：考试状态机

考试不是普通 CRUD。所有状态变更必须通过 command function，禁止 route 直接改状态字段。

**Exam 状态**：

```
draft → published → open → closed → archived
```

**ExamAttempt 状态**（见 §2.2）：

```
not_started → queued → in_progress → submitted → grading → graded
                                     ↑                    ↓
                                     └── disrupted   voided
```

**Command functions**：

```ts
publishExam(ctx, examId)
openExam(ctx, examId)
closeExam(ctx, examId)
startAttempt(ctx, examId, candidateId)
saveAnswer(ctx, attemptId, questionId, payload)
submitAttempt(ctx, attemptId)
gradeAttempt(ctx, attemptId)
markDisrupted(ctx, attemptId)
restoreAttempt(ctx, attemptId)
voidAttempt(ctx, attemptId, reason)
```

### 3.4 Server Time Authority：服务端权威计时

规则：

- 客户端只负责显示倒计时
- 服务端保存 startedAt、deadlineAt、submittedAt
- remainingSeconds 由服务端时间计算
- 交卷是否超时以服务端为准
- 离线期间计时不停
- 客户端时间不可信

模型：

```ts
deadlineAt = startedAt + durationMinutes
remainingSeconds = deadlineAt - serverNow
```

### 3.5 Answer Save Protocol：答案保存协议

答案保存接口：

```
POST /attempts/:attemptId/answers/:questionId
```

请求体：

```ts
SaveAnswerRequest {
  attemptId: string
  questionId: string
  answer: unknown
  clientSeq: number
  clientSavedAt: string
  baseVersion: number
}
```

响应体：

```ts
SaveAnswerResponse {
  accepted: boolean
  serverVersion: number
  savedAt: string
  conflict?: {
    reason: "STALE_VERSION" | "SUBMITTED" | "ATTEMPT_CLOSED"
    latestAnswer?: unknown
  }
}
```

规则：

- 同一个 clientSeq 重放必须幂等
- 旧版本不能覆盖新版本
- submitted / graded 状态不允许再保存答案
- 离线恢复时按 serverVersion 合并
- 服务端是最终权威

**多层级保存**：

| 层级 | 触发时机 | 说明 |
|------|----------|------|
| 客户端内存 | 每次按键/选择 | 即时响应 |
| 服务端持久化 | 每次作答变更（去抖 1-2s）或每 30s 自动保存 | 已保存题目标记 ✓ |
| 客户端本地缓存 | 每次保存时同步写入 localStorage / IndexedDB | 断网兜底 |

**宕机恢复**：

| 场景 | 恢复方式 |
|------|----------|
| 客户端崩溃 | 重新登录 → 服务端找到 in_progress 的 ExamAttempt → 恢复答案 + 剩余时间 |
| 服务端重启 | 答案已实时持久化到数据库 → 所有 in_progress 的 attempt 保持原状态 → 考生继续 |
| 网络中断 | 客户端切入离线模式 → 答案暂存本地 → 恢复后按 serverVersion 批量同步 |

### 3.6 Question Snapshot：题目快照底座

组卷后必须冻结以下内容，题库后续修改不能影响历史答卷：

```ts
QuestionSnapshot {
  originalQuestionId: string
  type: QuestionType
  content: string
  attachments: Attachment[]
  options: OptionSnapshot[]
  standardAnswer: unknown
  score: number
  gradingRule: GradingRule
  order: number
}
```

冻结内容：题目内容、选项、题目顺序、选项顺序、标准答案、分值、批改规则、附件。

### 3.7 Grading Engine：批改引擎

自动批改是独立引擎，不写在 route 里。

```ts
gradeAttempt(attempt, snapshot, answers, gradingPolicy): ScoreResult
```

Phase 1 仅支持客观题：

| 题型 | 批改规则 |
|------|----------|
| 单选 / 判断 | 精确匹配标准答案 |
| 多选 | 全对满分，少选半分，错选零分（可配置） |
| 填空 | 精确匹配或关键词匹配（可配置模糊度） |

批改结果：

```ts
ScoreResult {
  attemptId: string
  totalScore: number
  passed: boolean
  questionResults: QuestionScoreResult[]
  gradedAt: Date
}
```

### 3.8 Audit Log：审计日志

所有敏感操作必须写入 AuditLog。

至少覆盖以下操作：

| 类别 | 操作 |
|------|------|
| 认证 | 登录失败 |
| 考试管理 | 发布考试、关闭考试、修改考试 |
| 考试执行 | 开始考试、交卷、强制交卷 |
| 监考操作 | 延长考试时间、标记违纪、恢复 disrupted attempt |
| 成绩 | 修改成绩、导出成绩 |
| 数据管理 | 导入考生、导入题库、删除题目、修改题目 |

审计模型：

```ts
AuditLog {
  id: string
  organizationId: string
  actorId: string
  action: string
  targetType: string
  targetId: string
  metadata: JSON
  ipAddress?: string
  userAgent?: string
  createdAt: Date
}
```

---

## 四、核心工作流

### 4.1 出题与题库管理

**题目导入格式**：

| 格式 | 用途 | 说明 |
|------|------|------|
| Excel (.xlsx) | 批量导入 | 固定模板：题型、题干、选项A-D、标准答案、分值、标签 |
| CSV | 批量导入 | 同 Excel 逻辑的纯文本版本 |
| JSON | API/程序导入 | 完整 Question 结构，供脚本调用 |
| 手动录入 | 单题创建 | Web 端表单，支持预览 |

导入流程：

1. 上传文件 → 服务端解析校验 → 预览（展示识别出的题目，标记异常行）
2. Teacher 确认 → 批量写入 QuestionBank
3. 校验规则：题型必填、选择题必须有选项和标准答案、分值 > 0
4. 重复检测：基于题干相似度标记，不阻断

**题目内容**：

- 题干支持文字 + 图片引用（图片 URL）
- Phase 1 不做 LaTeX / 公式编辑器，纯文本 + 图片
- 简答题/论文/画图等主观题型留 Phase 2

### 4.2 组卷

```
Teacher 新建 Exam → 选择 Course
       ↓
 选题方式：手动选题（Phase 1）/ 随机抽题（Phase 2，按规则：题型、难度、标签分布）
       ↓
 配置计时方式（§2.5）+ 管控选项（§2.6）
       ↓
 预览考试（查看题目、配置确认）
       ↓
 发布 → 状态变为 Published
```

### 4.3 考生管理

**考生信息导入**：

| 方式 | 说明 |
|------|------|
| Excel/CSV | 下载动态模板（根据机构自定义的考生字段生成列头），填写后上传 |
| 手动录入 | Web 端表单，按机构字段动态渲染 |
| API | 供教务系统/外部系统自动同步 |
| CAS/OAuth | 统一身份认证自动拉取 [Phase 2] |

导入流程：

1. Admin 配置本机构的 CandidateField（定义有哪些字段、哪些必填、哪个是唯一标识）
2. 下载导入模板（列头 = 已定义的字段名）
3. 填写上传 → 校验（必填项、唯一标识重复检测）
4. 确认入库
5. 同一唯一标识重复导入时：更新已有信息，不创建重复记录

### 4.4 考试执行

**考生答题界面**（参考软考机考设计）：

```
┌─────────────────────────────────────────────────────┐
│  考试名称  │  剩余时间: 78:32  │  已答 15/50  │ 交卷 │
├──────────┬──────────────────────────────────────────┤
│ 题号导航  │  题目区域                                │
│          │                                          │
│ ① ●     │  16. 以下关于化学实验安全...             │
│ ② ●     │                                          │
│ ③ ○     │  A. 选项一                               │
│ ...      │  B. 选项二  ← 当前选中                   │
│ 16 ←    │  C. 选项三                               │
│ 17 ○    │  D. 选项四                               │
│ ...      │                                          │
│ 50 ○    │  ◀ 上一题    标记本题    下一题 ▶         │
│          │                                          │
│ ●=已答   │                                          │
│ ○=未答   │                                          │
│ ◉=已标记 │                                          │
├──────────┴──────────────────────────────────────────┤
│  已答: 15  │  未答: 35  │  已标记: 3  │  总分: 100   │
└─────────────────────────────────────────────────────┘
```

核心交互：

- 题号导航栏：颜色标记状态（已答/未答/已标记），可点击跳转
- 标记功能：对不确定的题打标记，交卷前可查看标记列表
- 自动保存：每次选择/输入后按 Answer Save Protocol 保存（§3.5），已保存题目标记 ✓
- 交卷确认：弹出确认框，显示未答和已标记题数

**答题组件**（Phase 1 仅客观题）：

| 题型 | 答题组件 | 说明 |
|------|----------|------|
| 单选 | Radio 按钮组 | 点选即保存 |
| 多选 | Checkbox 组 | 每次变更实时保存 |
| 判断 | 二选一 Radio | 同单选 |
| 填空 | 文本输入框（支持多个空） | 每个空独立，blur 时保存 |

**排队分批进入**（用于闭卷统考）：

```
Proctor 点击"开考"
      ↓
考生端显示："考试即将开始，排队中... 前面还有 X 人"
      ↓
每批放行 N 人（batchSize 配置，默认 10），间隔 3-5 秒
      ↓
轮到时自动跳转到考试页面，倒计时开始
```

### 4.5 监考端 [Phase 2]

监考面板、考场实时状态、座位图、实时事件流等，依赖 WebSocket。Phase 1 不实现。

监考能力保留规划：

| 功能 | 说明 | 实时性 |
|------|------|--------|
| 考场总览 | 在线/断线/异常/已交卷人数 | WebSocket / 轮询 |
| 考生状态卡片 | 每人进度（已答 N/M）、剩余时间、连接状态 | WebSocket / 轮询 |
| 断线告警 | 心跳超时自动高亮 + 声音提示 | 即时 |
| 切屏记录 | 超阈值标红 | 即时 |
| 单人操作 | 延长某人时间 / 强制交卷 / 标记违纪 | 按钮 |
| 违纪记录 | 标记原因，写入 AuditLog，可导出 | 持久化 |

### 4.6 批改

**Phase 1：自动批改**（通过 Grading Engine，见 §3.7）

| 题型 | 批改规则 |
|------|----------|
| 单选 / 判断 | 精确匹配标准答案 |
| 多选 | 全对满分，少选半分，错选零分（可配置） |
| 填空 | 精确匹配或关键词匹配（可配置模糊度） |

**Phase 2：AI 辅助**

- 短答题 / 简答题：本地部署 LLM 语义批改
- AI 批改结果可被 Teacher 覆盖
- 不依赖外部 API

### 4.7 数据导入导出

**Phase 1 导出**：

| 导出类型 | Excel | CSV | PDF |
|----------|:-----:|:---:|:---:|
| 成绩单（原始数据） | ✅ | ✅ | - |
| 题库备份 | ✅ | - | - |
| 考生名单 | ✅ | ✅ | - |

**Phase 2 导出**：

| 导出类型 | Excel | CSV | PDF | Word | JSON |
|----------|:-----:|:---:|:---:|:----:|:----:|
| 成绩单（正式打印） | - | - | ✅ | - | - |
| 答卷详情 | ✅ | - | ✅ | - | - |
| 统计分析报告 | ✅ | - | ✅ | ✅ | - |
| 审计日志 | - | ✅ | - | - | ✅ |
| 达标证明（单人） | - | - | ✅ | - | - |

导出原则：

- 成绩单列头按该机构的 CandidateField 动态生成（不是固定输出"学号"）
- 所有导出操作写入 AuditLog
- 导出文件名含时间戳和考试名称

---

## 五、架构方案

> 本章是**当前推荐实现**，不是不变原则。技术栈可随演进替换，但领域模型和底座原则不变。

### 5.1 技术栈

| 层 | 当前推荐 | 备选 |
|----|----------|------|
| 前端 | React 19 + Vite + TypeScript | - |
| UI | shadcn/ui + TailwindCSS v4 | - |
| 桌面端 | Electron [Phase 2] | - |
| API 框架 | Fastify | - |
| 运行时 | Node.js LTS | - |
| Schema 校验 | Zod | TypeBox |
| ORM | Drizzle ORM | - |
| 数据库 | PostgreSQL（生产默认） | SQLite（仅 dev/demo） |
| 认证 | HTTP-only Cookie + JWT，argon2 密码哈希 | bcrypt |
| 实时通信 | 轮询（Phase 1）/ WebSocket（Phase 2） | - |
| 包管理 | pnpm workspace | - |
| 构建 | Turbo 或 Nx | - |

### 5.2 项目结构

```
exam/
├── apps/
│   ├── web/                # React + Vite + Tailwind + shadcn/ui
│   │   └── src/
│   │       ├── components/ui/    # shadcn 组件（自动生成，勿手改）
│   │       ├── components/shared/ # 共享业务组件
│   │       ├── pages/            # 路由级组件
│   │       ├── lib/              # 工具函数、API client
│   │       └── hooks/            # 共享 React hooks
│   ├── api/                # Fastify API server
│   │   └── src/
│   │       ├── routes/           # 路由处理器（一个文件一个领域）
│   │       ├── plugins/          # Fastify 插件（auth、CORS、security）
│   │       └── server.ts         # Fastify 入口
│   └── desktop/            # Electron shell [Phase 2]
│
├── packages/
│   ├── domain/             # 领域模型、状态机、策略，不依赖 Fastify
│   │   └── src/
│   │       ├── types.ts          # 领域类型（唯一数据源）
│   │       ├── examStateMachine.ts
│   │       ├── gradingEngine.ts
│   │       └── retakePolicy.ts
│   ├── contracts/          # API schema、DTO、Zod schema
│   │   └── src/
│   │       ├── auth.ts
│   │       ├── exam.ts
│   │       └── question.ts
│   ├── db/                 # Drizzle schema、migration、repository
│   │   └── src/
│   │       ├── schema.ts
│   │       ├── migrations/
│   │       └── repository/       # 每个实体一个 repo，必须接收 ctx
│   ├── auth/               # session、RBAC、tenant guard
│   │   └── src/
│   │       ├── session.ts
│   │       ├── rbac.ts
│   │       └── tenantGuard.ts
│   ├── exam-engine/        # 计时、答题保存、交卷、批改
│   │   └── src/
│   │       ├── timer.ts
│   │       ├── answerProtocol.ts
│   │       └── grading.ts
│   ├── import-export/      # CSV/Excel/PDF 导入导出
│   └── ui/                 # Web/Electron 共用 UI 组件 [Phase 2]
│
├── docs/
│   ├── SPEC.md             # 本文档
│   ├── jobs/               # Phase 实施计划
│   └── ...
│
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

**依赖规则**：

- `domain` 不能依赖 `fastify`
- `contracts` 不能依赖 `fastify`
- `exam-engine` 不能依赖 `fastify`
- `db` repository 必须通过 ctx 访问，不允许裸 SQL
- `fastify` 只能出现在 `apps/api`

### 5.3 自适应降级

系统持续自检（CPU / 内存 / DB 响应时间），三档自动切换：

| 档位 | 触发条件 | 行为 |
|------|----------|------|
| **正常** | 资源充裕 | 答案即时持久化、统计即时算 |
| **省电** | CPU>70% 或 内存>80% 或 DB>500ms | 答案批量写入、心跳间隔拉长(30s→60s) |
| **极限** | CPU>90% 或 内存>95% 或 DB>2s | 仅核心考试 API、答案攒批(最多延迟10s)、非考试请求限流 |

关键原则：

- 降级不丢数据——答案仍然保证持久化，只是攒批写入
- 回弹要缓——必须先经过省电模式稳定一段时间
- 考生端无感——答题界面不受影响
- 三档通过 `.env` 配置阈值

**实时通信策略**：

- Phase 1：轮询优先（答案保存走 HTTP API，不依赖 WebSocket）
- Phase 2：WebSocket 增强（监考面板、实时状态推送）

### 5.4 部署方案

| 场景 | 方式 | 数据库 | 说明 |
|------|------|--------|------|
| 开发演示 | `pnpm dev` | SQLite | 零配置，单命令启动 |
| 单机演示 | Docker 单容器 | SQLite | 快速体验 |
| 正式生产 | Docker Compose | PostgreSQL | app + DB 一键部署 |
| 手动部署 | systemd + Nginx | PostgreSQL | 不用 Docker，传统方式 |

**Phase 1 数据库落地节奏**：

- J1-J8：SQLite-first。开发、CI、集成测试和单机演示默认使用 SQLite，优先完成业务闭环。
- J9：增加 PostgreSQL schema、migration 和 Docker Compose 生产部署，执行 PostgreSQL 兼容性验证。
- Phase 1 正式发布：PostgreSQL 是生产默认数据库；SQLite 仅保留给本地开发、测试和单机演示。
- Phase 2 不承担首次 PostgreSQL 切换。Phase 2 在已经验证过的 PostgreSQL 生产基线上继续开发。

**Docker Compose（正式生产）**：

```yaml
services:
  app:        # Node.js server（API + 静态文件）
  db:         # PostgreSQL
```

通过 `.env` 配置切换：

- `DATABASE_URL` 指向 PostgreSQL 或 SQLite 文件路径
- `DEGRADATION_THRESHOLDS` 调整降级阈值
- `AUTH_MODE` 选择认证方式（local / cas / oauth）

---

## 六、安全原则

> 考试系统的安全不是锦上添花，是核心需求。

### 6.1 认证与授权

- HTTP-only Cookie + JWT，不使用 localStorage 存 token
- 密码使用 argon2 或 bcrypt 哈希
- 五种角色（SuperAdmin / Admin / Teacher / Proctor / Candidate），API 按角色鉴权
- 教师可兼任监考
- 考试期间一个 Candidate 只能有一个 active exam session
- 考试 session 绑定 attemptId、candidateId、organizationId、ip、userAgent
- 认证方式可配：本地密码 / CAS / OAuth（通过 `.env` 切换）[CAS/OAuth Phase 2]

### 6.2 考试执行安全

| 措施 | 说明 |
|------|------|
| 服务端计时 | 倒计时以服务端时间为准 |
| IP 白名单 | 考场 IP 段限制 [Phase 2] |
| 题目乱序 | 每人题目和选项顺序不同 |
| 防切屏 | Phase 1: 检测+记录+报告监考员。Phase 2: Electron 系统级锁屏 |
| 禁复制粘贴 | 前端禁用右键/选择/复制 |
| 答案实时同步 | 每次作答按 Answer Save Protocol 提交服务端 |
| 排队分批 | 防止开考洪峰 |
| 试卷不可逆 | 交卷后不可修改（可配置是否允许重考） |

### 6.3 数据安全

- 密码使用 argon2 或 bcrypt 哈希
- 答卷数据在考试期间不可被任何人（包括 Admin）查看
- 所有敏感操作写入 AuditLog（见 §3.8）
- ID 用 UUID，不暴露自增 ID

### 6.4 网络安全

- CORS 严格限制为 LAN 域名/IP
- Rate limiting：登录严格限制，考试接口适度限制
- 所有 API 输入用 Zod 校验
- 安全响应头（X-Content-Type-Options, X-Frame-Options 等）

---

## 七、分阶段交付

### Phase 1（MVP）— 可证明闭环

> 目标：一个 Teacher 能完整走通"出题→组卷→学生考试→出分→导出成绩"的全流程。

核心链路：**出题 → 组卷 → 考试 → 出分 → 导出**

- [ ] 单机构或轻量多租户（平铺 Organization，不做树形层级）
- [ ] 本地账号登录（用户名 + 密码）
- [ ] Admin / Teacher / Candidate 三类角色
- [ ] 题库 CRUD（手动创建 + CSV 导入）
- [ ] CSV 导入考生（按 CandidateField 动态模板）
- [ ] 手动组卷（从题库选题）
- [ ] timed_window 一种计时模式
- [ ] 客观题答题界面（单选/多选/判断/填空）
- [ ] 答案自动保存（Answer Save Protocol）
- [ ] 服务端计时
- [ ] 自动批改（Grading Engine）
- [ ] 成绩 CSV 导出
- [ ] Docker Compose 部署（app + PostgreSQL）

### Phase 1 暂缓

> 以下功能从原 Phase 1 中移出，避免范围膨胀。

- 树形 Organization → Phase 3
- 随机抽题 → Phase 2
- PDF / Word 导出 → Phase 2
- WebSocket 监考面板 → Phase 2
- Electron 锁屏 → Phase 2
- CAS / OAuth → Phase 2
- AI 批改 → Phase 3
- 复杂重考策略（daily_limit / weekly_limit）→ Phase 2
- 自适应三档降级 → Phase 2（Phase 1 仅做基本健康检查）
- 题库共享 → Phase 3
- 移动端 → Phase 3
- timed_sync / deadline / untimed 计时模式 → Phase 2（先只做 timed_window）

### Phase 2

- [ ] 考场管理 + IP 限制
- [ ] 监考面板 + WebSocket 实时监控
- [ ] Electron 锁屏客户端
- [ ] 随机抽题（按规则：题型、难度、标签分布）
- [ ] timed_sync / deadline / untimed 计时模式
- [ ] 复杂重考策略（daily_limit / weekly_limit）
- [ ] 简答题 + AI 辅助批改
- [ ] 外部系统对接（CAS/OAuth）
- [ ] 达标放行 API
- [ ] PDF / Word 导出 + 可定制模板
- [ ] 自适应三档降级
- [ ] 审计日志导出

### Phase 3

- [ ] 树形组织层级
- [ ] 题干富内容（LaTeX、化学方程式、代码块）
- [ ] 文件上传题 / 编程题 / 画图题
- [ ] 题库共享与跨租户协作
- [ ] 移动端适配

---

## 八、不做什么（明确排除）

- 不做远程考试 / 公网部署（场景是 LAN）
- 不做视频监考 / 摄像头监控（物理考场有真人监考）
- Phase 1 不做富文本编辑器（出题端纯文本 + 图片）
- Phase 1 不做主观题（简答/论文/画图）
- Phase 1 不做移动端 App
- Phase 1 不做 Electron 锁屏（先保证 Web 端完整可用）
- Phase 1 不做 WebSocket（答案保存走 HTTP API，不依赖实时连接）
- 不接外部 AI API（AI 批改必须本地部署模型）
- 答案保存不依赖 WebSocket 作为唯一通道
