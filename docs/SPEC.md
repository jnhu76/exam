# Exam System - 规格文档 (Specification)

> 本文档定义系统的**不变原则**和**当前推荐实现**。
> 不变原则是宪法——任何实现不得违背。推荐实现是当前默认方案，可随技术演进替换。
> 所有 agent session 开始前必须理解本文内容。

---

## 一、系统定位

**Phase 1 单机构/单租户内网考试平台。**

部署在校园/机构内网（LAN），一个部署代表一个机构。Phase 1 是 Admin + Candidate 的 Minimal Deliverable Exam System，不是完整教务平台、协作平台或多租户平台。核心链路——

```txt
题库 → 组卷 → 考试执行 → 答案保存 → 自动批改 → 出分
```

Phase 1 当前产品角色为 Admin + Candidate。Teacher / Proctor / Grader 是未来协作与权限模型，不进入 Phase 1 核心路径。考生不限于学生——由机构自己定义考生身份。

> **Phase 1 是单租户、多用户系统。** organization 表仅作为内部 default organization 数据归属边界。multiTenant / SuperAdmin / tenant switcher 是 Phase 4 platformization，不属于 Phase 1。"达标放行" / pass-to-proceed 属于 Phase 4 integration。

### 不变原则

- 考试数据不丢——已作答内容在任何故障场景下都必须可恢复
- 数据归属边界——所有业务数据归属于内部 default organization（Phase 1 单租户）
- 服务端计时——倒计时、超时判定以服务端时间为准
- 答卷可恢复——断线/崩溃后考生可从服务端恢复答案和剩余时间
- 题目快照——组卷后题目冻结，题库修改不影响历史答卷
- 服务端是数据权威——客户端是展示层，答案以服务端记录为准

> **Phase 1 数据归属说明**：当前系统为单租户模式，所有业务数据归属于内部 default organization。route / repository 仍携带 organizationId，但 organizationId 来自 default organization，不允许产品路径中切换 organization。Phase 4 如启用 optional multiTenant，数据归属边界才扩展为租户隔离。

> **当前实现边界**：
>
> 上述原则是系统**长期不变契约**。但需要明确当前接线深度：
>
> - "答卷可恢复"已**产品化**：答案持久化、`disrupted` 自动标记、`restoreAttempt` 后端路由、以及候考人端**自助恢复入口**（`TakeExamPage` REC-I3 restore 流程，ADR-012）均已就绪。心跳扫描器（`apps/api/src/plugins/heartbeat.ts`）在 API 启动时**默认注册并运行**（30 秒扫描周期 / 60 秒超时，可由 `HEARTBEAT_SCAN_INTERVAL_MS` / `HEARTBEAT_TIMEOUT_MS` 调整），会真实把超时的 `in_progress` attempt 写为 `disrupted`。
> - Admin 侧恢复工作台（J5 Recovery Center：事件队列、事件详情、attempt/exam 恢复上下文与操作面板）已交付（2026-08-08，见 `docs/roadmap/recovery-operations-jobs.md`）。**尚未产品化**的是 Proctor 恢复工作台（J6）、系统级 incident 的自动生成、以及心跳调参与超时阈值的生产评估。

---

## 二、核心领域模型

### 2.1 实体关系

```
Organization (机构)
  └── Phase 1 只有一个 internal default organization
      ├── 用户不创建 organization
      ├── 登录不传 organizationSlug
      └── Web 不显示组织选择

Organization 内部：
  User (用户)
   ├── Admin     → Phase 1 内最高产品角色；管理考生字段、课程、题库、考试、分配、成绩与导出
   └── Candidate → 参加被分配考试（通用身份，不绑定"学生"语义）
                   考生属性由机构自定义（学号/工号/身份证号等）
                   内部 ID 用 UUID，用户可见标识由机构定义

Course (课程/科目)
  └── 属于某个 Organization

QuestionBank (题库)
  └── 按 Course 组织
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
  ├── timing: timed_sync | timed_window | deadline | untimed（见 §2.5）
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

**Phase 1 角色说明**：

- **Admin**：Phase 1 内最高产品角色，可以多个。管理 default organization 内的候选人字段、候选人、课程、题库、考试、分配、成绩与导出。
- **Candidate**：参加被分配考试并查看自己允许查看的成绩，可以多个。
- **Teacher**：不进入 Phase 1 核心路径；Phase 3 由 permission + scope 组合为 Teacher-like scoped role。
- **Proctor**：Phase 2/3 后续能力；Phase 2 提供考试运营工作流，Phase 3 提供角色包与授权边界。
- **Grader / ContentManager / ResultViewer**：Phase 3 scoped role bundles。
- **SuperAdmin**：Phase 4 optional multiTenant/platformization；Phase 1 不 seed、不登录、不展示。

### 2.2 ExamAttempt 模型（核心）

ExamAttempt 是考试系统的核心实体，取代原来的"一份答卷"概念。系统支持多次考试、多种重考策略、多种取分策略，因此必须区分：

```
考试资格 (ExamEnrollment)  — 这个考生是否被允许参加
考试次数 (attemptNo)       — 这是第几次尝试
单次答题记录 (ExamAttempt) — 这次答题的具体内容
最终认定成绩               — 按 scoreStrategy 从多次中选
```

**ExamAttempt 状态机（目标设计）**：

```
not_started → queued → in_progress → submitted → grading → graded
                                     ↑                    ↓
                                     └── disrupted   voided
```

> 上图是状态机的**长期目标设计**。当前实现并未让所有状态都进入运行时主流程；下表给出每个状态在当前实现中的真实接线情况，避免后续读者把目标设计误读为已完成能力。状态机收敛策略与裁决记录见 `docs/archive/phase1-archive/phase-1.7/exam-lifecycle-non-e2e-closeout.md` §3。

| 状态 | 含义 | 当前实现接线 |
|------|------|------|
| `not_started` | 已创建，尚未开始 | 保留，**当前无写入路径**（attempt 在 `startAttempt` 时直接进入 `in_progress`） |
| `queued` | 排队中（requireQueue 时） | **Phase 2 / planned**：`requireQueue` 入口属于 timed_sync 计时模式（§2.5），仅在内存路径上短暂出现，不持久化 |
| `in_progress` | 正在答题 | **已接线**：`startAttempt` 命令写入 |
| `disrupted` | 心跳超时自动标记（60s 无心跳） | **后端已接线**：心跳扫描器默认注册并运行，到达超时阈值会真实写入 `disrupted` 状态。**候考人自助恢复入口已产品化**（REC-I3 / ADR-012，详见 §3.5）；Proctor 恢复工作台（J6）未实现 |
| `submitted` | 已交卷，等待批改 | **已接线**：`submitAttempt` 内部 4-phase 改造的中间态，幂等可重入 |
| `grading` | 正在批改 | 保留，**当前无写入路径**：`submitAttempt` 内联调用批改后直接落 `graded`；该状态保留以便 Phase 2 异步批改/AI 批改场景启用 |
| `graded` | 批改完成 | **已接线** |
| `voided` | 已作废（监考员或管理员操作） | **Phase 2+ / planned**：`voidAttempt` command 仅作为目标设计，未提供管控入口 |

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

- Phase 1 由 Admin 为 internal default organization 配置 N 个考生字段
- 每个字段可配置：名称、类型（text/number/select）、是否必填、是否作为唯一标识
- 考生导入模板根据字段定义动态生成
- 成绩导出时按当前部署 / default organization 的字段输出对应列

**标识规则**：

- 系统内部 ID 统一用 UUID
- 用户可见的"考号/学号/工号"是机构自定义的唯一标识字段
- 标识可以是数字、字母、混合（如 `s2024001`、`b2024001`、`2024010001`）
- 系统不假设标识的格式，只保证唯一性

### 2.4 Phase 1 角色权限矩阵

| 能力 | Admin | Candidate |
|------|:-----:|:---------:|
| 系统初始化 / Admin bootstrap | ✅ | - |
| 本地 Admin reset-password 脚本执行记录 | ✅ | - |
| 部署设置 / 考生字段 | ✅ | - |
| Admin / Candidate 账号管理 | ✅ | - |
| Candidate 创建 / 批量导入 | ✅ | - |
| Course 创建 | ✅ | - |
| Question CSV 导入 | ✅ | - |
| Exam 创建 / 发布 | ✅ | - |
| Candidate enrollment / assignment | ✅ | - |
| 查看考试结果 | ✅ | 仅本人 |
| Result CSV export | ✅ | - |
| 参加被分配考试 | - | ✅ |
| 查看允许展示的本人结果 | - | ✅ |

> **Phase 1 说明**：当前产品角色只有 Admin / Candidate。Teacher-like roles、Proctor、Grader、ContentManager、ResultViewer 均不是 Phase 1 当前角色。

### 2.4.1 Future Roles（Phase 3）

Phase 3 才引入基于 permission + scope 的协作角色：

- Teacher-like roles
- Proctor
- Grader
- ContentManager
- ResultViewer

这些角色通过 Course / Exam / CandidateGroup 等 scope 授权，不是 multiTenant，也不进入 Phase 1 当前矩阵。

### 2.5 考试计时模式

四种计时方式，覆盖从"严格统考"到"随到随考"的全部场景：

| 模式 | 时间规则 | 典型场景 | 当前接线 |
|------|----------|----------|------|
| **定时统考** `timed_sync` | 监考员统一触发开考，所有人同时开始倒计时，到时强制交卷 | 期末考试、软考机考 | **Phase 2 / planned**（依赖监考面板） |
| **窗口限时** `timed_window` | 在开放窗口内考生自选时间开始，开始后倒计时 | 实验室准入、随堂测验 | **已接线** |
| **纯截止日** `deadline` | 只有截止时间，不计时，做完就交 | 培训确认、课后作业 | **Phase 2 / planned** |
| **不限时** `untimed` | 永久开放，随时做随时交（或管理员手动关闭） | 练习题、模拟考试 | **Phase 2 / planned** |

> Phase 1 仅实现 `timed_window`。其它三种模式作为目标设计保留，**未在当前代码中接线**——后续 agent 不应把缺失视作状态机或排队逻辑的实现缺陷来"补全"，需要等待 Phase 2+ 硬化阶段显式启动（详见 §七 Phase 2 列表）。

```
timed_sync 示例：
  Phase 2 运营人员点击"开考" → 考生排队分批进入 → 开始 90 分钟倒计时
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

管控强度独立于计时方式，两者正交组合。Phase 1 由 Admin 创建考试并选择 `timed_window` 主路径；Phase 2 再引入完整考试运营管控。系统长期目标提供"开卷预设"和"闭卷预设"快速填充默认值，但每一项都能单独改。

| 管控项 | 开卷预设 | 闭卷预设 | 说明 |
|--------|:--------:|:--------:|------|
| `shuffleQuestions` | 关 | 开 | 题目乱序 |
| `shuffleOptions` | 关 | 开 | 选项乱序 |
| `detectTabSwitch` | 关 | 开 | Phase 1 minimal behavior；完整审计与处置进入 Phase 2 |
| `disableCopyPaste` | 关 | 开 | 前端禁用右键/选择/复制 |
| `requireQueue` | 关 | 开 | 队列入场（依赖 `timed_sync`，**Phase 2 / planned**） |
| `batchSize` | - | 10 | 每批放行人数（同上） |
| `batchInterval` | - | 3 | 批次间隔秒数（同上） |
| `restrictIp` | 关 | 开 | 仅允许考场 IP 段 [Phase 2] |
| `requireLockdown` | 关 | 关 | 强制 Electron 锁屏 [Deferred] |
| `showResultImmediately` | 开 | 可配置 | 交卷后是否立即显示成绩 |
| `retakePolicy` | unlimited | max_attempts | 重考策略 |
| `maxRetakeAttempts` | - | 1 | 最大重考次数 |
| `retakeCooldown` | 0 | 60 | 重考冷却时间（分钟） |
| `scoreStrategy` | highest | latest | 多次考试取分策略 |
| `passThenStop` | 开 | 关 | 通过后不能再考 |

> Phase 1 操作手册只描述 `timed_window`、手动选题、基础显示结果与一次可靠提交路径。队列入场、限制 IP、锁定浏览器、强制锁屏、独立监考、force submit、extend time、misconduct marking、完整 disrupted recovery UI、完整 retake policy / score strategy 工作流均为 Phase 2。

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

### 2.8 达标放行 / Pass-to-proceed [Phase 4]

```
"达标放行"流程：
  考试发布 → 考生参加 → 自动批改 → score >= passingScore → passed=true
       ↓
  外部系统可通过 API 查询"某人是否通过了某考试" [Phase 4]
```

> Phase 1 只产生成绩并导出 CSV，不提供 pass-to-proceed API、service token、API key 或 webhook。外部集成属于 Phase 4 platformization/integration。

### 2.8.1 Phase 1 数据归属边界

Phase 1 为单租户模式：

- 数据库层面：所有表都有 `organizationId` 字段，查询时强制过滤
- organizationId 来自内部 default organization
- 不允许产品路径中切换 organization
- 所有业务数据归属于内部 default organization

### 2.8.2 Future / Multi-tenant Extension（Phase 4）

> 以下内容不属于 Phase 1 当前实现要求，仅作为 Phase 4 platformization 愿景保留。

- **Multi-tenant**：多租户模式，每个组织独立运行
- **Tenant hierarchy**：树形组织层级（大学→学院→实验室）
- **SuperAdmin**：跨租户管理所有机构
- **Cross-tenant admin**：跨租户管理员
- **OrganizationSlug login**：基于组织标识的登录
- **Tenant switcher**：租户切换器

### 2.9 客户端架构

系统提供两种客户端，共享同一套 React 代码：

| 客户端 | 场景 | 特性 |
|--------|------|------|
| **Web（浏览器）** | Admin 后台、Candidate 考试、Phase 1 全场景 | 标准浏览器 |
| **Electron 桌面端** | 闭卷考试锁屏 [Deferred] | 禁止切应用、全屏强制、设备指纹 |

---

## 三、考试系统底座原则

> 这 8 项是考试系统的技术底座，不是业务功能，而是所有业务功能的安全网。任何实现必须遵循。

### 3.1 Organization Data Boundary Guard：数据归属边界底座

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
- 没有 organizationId，不能查询业务数据
- Route 层禁止直接访问 db
- 所有 repository 方法必须显式接收 ctx

**Phase 1 单租户说明**：

- organizationId 来自内部 default organization
- 不允许产品路径中切换 organization
- 不暴露 organizationSlug 登录
- 不实现 tenant switcher

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
- Phase 1 只暴露 Admin / Candidate 产品权限边界
- Phase 2 的 force submit、extend time、misconduct marking 等考试运营权限必须写入 AuditLog
- Phase 3 的 Teacher-like / Proctor / Grader 等角色必须由 permission + scope 统一检查

### 3.3 Exam State Machine：考试状态机

考试不是普通 CRUD。所有状态变更必须通过 command function，禁止 route 直接改状态字段。

**Exam 状态**（6 个，全部已实现）：

```
draft → published → open → closed → archived
                ↘           ↘
                 → canceled → archived
```

状态迁移规则：

| From | Operation | To | Guard | Side effects |
|---|---|---|---|---|
| draft | publish | published | exam has ≥1 question, valid schedule | QuestionSnapshot built, audit event |
| published | unpublish | draft | exam not yet open | audit event |
| published | open | open | now ≥ openAt (auto) or admin operation | audit event |
| published | cancel | canceled | admin cancels, no terminal state | candidate/result/export gates apply |
| published | archive | archived | admin archives | audit event |
| open | close | closed | admin closes or now ≥ closeAt (auto) | attempt gates apply, audit event |
| open | extend | open | admin extends closeAt | audit event, deadline updated |
| open | cancel | canceled | admin cancels | candidate/result/export gates apply |
| closed | archive | archived | admin archives | audit event |
| canceled | archive | archived | admin archives | audit event |

> Phase 2 已实现全部 6 个状态和上述所有迁移。`canceled` 状态表示考试被异常取消，不等于 `closed`（正常结束）。`canceled` 考试的结果/导出需要明确的 cancellation marker（Phase 3 语义）。

**ExamAttempt 状态**（见 §2.2）：

```
not_started → queued → in_progress → submitted → grading → graded
                                     ↑                    ↓
                                     └── disrupted   voided
```

> 当前实现仅有 `in_progress / submitted / disrupted / graded` 四个状态进入运行时主流程；`not_started / queued / grading / voided` 保留为目标设计但**当前无写入路径**。完整接线表见 §2.2。

**Command functions**（Phase 2 全部已实现）：

```ts
publishExam(ctx, examId)        // draft → published
openExam(ctx, examId)           // published → open
closeExam(ctx, examId)          // open → closed（幂等）
cancelExam(ctx, examId)         // published/open → canceled
archiveExam(ctx, examId)        // closed/canceled → archived
extendExam(ctx, examId, minutes) // open → open（仅更新 closeAt）
unpublishExam(ctx, examId)      // published → draft
publishResults(ctx, examId)     // 设置 resultsPublishedAt（非状态迁移）
startAttempt(ctx, examId, candidateId)
saveAnswer(ctx, attemptId, questionId, payload)
submitAttempt(ctx, attemptId)
gradeAttempt(ctx, attemptId)
markDisrupted(ctx, attemptId)
restoreAttempt(ctx, attemptId)
voidAttempt(ctx, attemptId, reason) // Phase 3 / planned（无 admin / proctor 入口）
```

> `voidAttempt` 是唯一仍标注为 Phase 3 / planned 的命令。其余 command 均已在 Phase 2 实现。

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
  accepted: true
  serverVersion: number
  savedAt: string
} | {
  accepted: false
  reason: "STALE_VERSION" | "ATTEMPT_ALREADY_SUBMITTED"
        | "ATTEMPT_CLOSED" | "DEADLINE_EXCEEDED"
  message: string
  serverVersion: number
  savedAt: string
  details?: {
    serverAnswer?: unknown
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

> **实现边界**：上表是恢复能力的**目标合约**。当前实现：
>
> - "客户端崩溃 / 网络中断"在 attempt 仍处于 `in_progress` 时可正常恢复（前端在加载 attempt 时拉取服务端答案版本）。
> - 一旦 attempt 被心跳扫描器置为 `disrupted`，候考人可通过**自助 restore 入口**（`TakeExamPage` REC-I3 流程）恢复答案与剩余时间；Admin 恢复工作台（J5）提供队列、事件详情与操作面板。Proctor 恢复工作台（J6）仍未实现。
> - "服务端重启"路径不依赖前端 UI，已具备能力。

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

### 3.8 Observability, Audit, and Diagnostics

Phase 1 必须区分三类证据：

- **AuditLog**：谁在什么时候做了什么，用于业务审计。
- **App log**：系统运行、错误、认证失败内部原因、并发冲突等运行证据。
- **Trace / requestId**：单次请求链路定位，连接 HTTP 响应、应用日志和 E2E artifacts。

#### Phase 1 必须覆盖

- `requestId`：每个 API 请求都应有稳定 requestId。
- Structured pino logs。
- auth failure internal reason 只写入日志，不直接暴露给前端。
- E2E artifacts：`server.log`、screenshot、video、Playwright trace。
- health endpoint。
- stable machine-readable error codes。
- Minimal AuditLog：
  - login failure
  - exam publish
  - candidate import
  - attempt submit
  - result export
  - local admin reset-password script execution

#### Phase 2 扩展

- exam operation timeline
- attempt timeline
- proctor operation audit
- disrupted recovery audit
- import/export job logs

#### Phase 3 扩展

- permission audit
- user lifecycle audit
- invitation audit
- SMTP configuration audit
- audit query/export UI

#### Phase 4 扩展

- optional external log shipping
- syslog / OTLP-compatible export
- optional SIEM
- tenant-scoped audit if optional multiTenant returns

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
2. Admin 确认 → 批量写入 QuestionBank
3. 校验规则：题型必填、选择题必须有选项和标准答案、分值 > 0
4. 重复检测：基于题干相似度标记，不阻断

**题目内容**：

- 题干支持文字 + 图片引用（图片 URL）
- Phase 1 不做 LaTeX / 公式编辑器，纯文本 + 图片
- 简答题/论文/画图等主观题型留 Phase 2

### 4.2 组卷

```
Admin 新建 Exam → 选择 Course
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
| Excel/CSV | 下载动态模板（根据当前部署 / default organization 的考生字段生成列头），填写后上传 |
| 手动录入 | Web 端表单，按系统配置字段动态渲染 |
| API | 供脚本或后续集成使用 [Phase 4] |
| CAS/OAuth | 统一身份认证自动拉取 [Phase 4] |

导入流程：

1. Admin 配置当前部署 / default organization 的 CandidateField（定义有哪些字段、哪些必填、哪个是唯一标识）
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

**排队分批进入**（用于闭卷统考，**Phase 2 / planned**）：

> 该子流程依赖 `timed_sync` 计时模式与监考面板触发"开考"动作，两者均归属 Phase 2+ 硬化（见 §2.5、§4.5）。当前不实现该流程，下文为目标设计示意。

```
Phase 2 运营人员点击"开考"
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

**Future：AI 辅助**

- 短答题 / 简答题：本地部署 LLM 语义批改
- AI 批改结果可被具备 scoped grading permission 的角色覆盖 [Phase 3+]
- 不依赖外部 API

### 4.7 数据导入导出

**Phase 1 导出**：

| 导出类型 | Excel | CSV | PDF |
|----------|:-----:|:---:|:---:|
| 成绩单（原始数据） | - | ✅ | - |
| 题库备份 | - | - | - |
| 考生名单 | - | ✅ | - |

**Phase 2 导出 / job 化**：

| 导出类型 | Excel | CSV | PDF | Word | JSON |
|----------|:-----:|:---:|:---:|:----:|:----:|
| 成绩单（正式打印） | - | - | ✅ | - | - |
| 答卷详情 | ✅ | - | ✅ | - | - |
| 统计分析报告 | ✅ | - | ✅ | ✅ | - |
| 审计日志 | - | ✅ | - | - | ✅ |

> 达标证明、pass-to-proceed 查询、service token/API key、webhook 等属于 Phase 4 platformization/integration。

导出原则：

- 成绩单列头按当前部署 / default organization 的 CandidateField 动态生成（不是固定输出"学号"）
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
| 桌面端 | Electron [Deferred] | - |
| API 框架 | Fastify | - |
| 运行时 | Node.js LTS | - |
| Schema 校验 | Zod | TypeBox |
| ORM | Drizzle ORM | - |
| 数据库 | PostgreSQL | - |
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
│   └── desktop/            # Electron shell [Deferred]
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
│   ├── auth/               # session、RBAC、organization data boundary guard
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
│   └── ui/                 # Web/Electron 共用 UI 组件
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
| 开发演示 | `pnpm dev` | PostgreSQL | 需本地或 Docker PostgreSQL |
| 单机演示 | Docker Compose | PostgreSQL | app + DB 一键部署 |
| 正式生产 | Docker Compose | PostgreSQL | app + DB 一键部署 |
| 手动部署 | systemd + Nginx | PostgreSQL | 不用 Docker，传统方式 |

**数据库说明**：

- PostgreSQL 是唯一受支持的数据库。
- 所有开发、测试和部署均使用 PostgreSQL。

**Docker Compose（正式生产）**：

```yaml
services:
  app:        # Node.js server（API + 静态文件）
  db:         # PostgreSQL
```

通过 `.env` 配置切换：

- `DATABASE_URL` 指向 PostgreSQL 连接字符串
- `DEGRADATION_THRESHOLDS` 调整降级阈值
- `AUTH_MODE` 选择认证方式（local / cas / oauth）

---

## 六、安全原则

> 考试系统的安全不是锦上添花，是核心需求。

### 6.1 认证与授权

- HTTP-only Cookie + JWT，不使用 localStorage 存 token
- 密码使用 argon2 或 bcrypt 哈希
- Phase 1 两种产品角色（Admin / Candidate），API 按角色鉴权
- 考试期间一个 Candidate 只能有一个 active exam session
- 考试 session 绑定 attemptId、candidateId、organizationId、ip、userAgent
- 认证方式可配：本地密码 / CAS / OAuth（通过 `.env` 切换）[CAS/OAuth Phase 2]

### 6.2 考试执行安全

| 措施 | 说明 |
|------|------|
| 服务端计时 | 倒计时以服务端时间为准 |
| IP 白名单 | 考场 IP 段限制 [Phase 2] |
| 题目乱序 | 每人题目和选项顺序不同 |
| 防切屏 | Phase 1 minimal behavior；Phase 2 完整记录、审计与处置 |
| 禁复制粘贴 | 前端禁用右键/选择/复制 |
| 答案实时同步 | 每次作答按 Answer Save Protocol 提交服务端 |
| 排队分批 | Phase 2 queue admission，防止开考洪峰 |
| 试卷不可逆 | 交卷后不可修改；完整重考策略进入 Phase 2 |

### 6.3 数据安全

- 密码使用 argon2 或 bcrypt 哈希
- 答卷数据在考试期间不可被任何人（包括 Admin）查看
- 所有敏感操作写入 AuditLog（见 §3.8）
- ID 用 UUID，不暴露自增 ID

### 6.4 Data Lifecycle

Phase 1 最小规则：

- Candidate 删除规则：已参加考试或已有 attempt/result 的 Candidate 不应物理删除；可先采用停用/隐藏或后续归档策略。
- Exam 发布后删除/归档规则：发布后的 Exam 不应直接删除；Phase 1 至少保留结果可追溯，Phase 2 完善 archived 工作流。
- Question 被 snapshot 引用后的修改规则：QuestionBank 修改不得影响既有 `QuestionSnapshot` 与历史 attempt。
- Attempt / Result 保留策略：Phase 1 保留完整 attempt/result 以支持诊断与导出；Phase 2 再定义归档与保留周期。
- AuditLog 保留策略：Phase 1 最小审计不应被普通业务操作删除；Phase 3/4 再定义查询、导出与合规保留。
- Export 记录：Phase 1 result CSV export 写入最小 AuditLog；Phase 2 引入 export job logs。

### 6.5 网络安全

- CORS 严格限制为 LAN 域名/IP
- Rate limiting：登录严格限制，考试接口适度限制
- 所有 API 输入用 Zod 校验
- 安全响应头（X-Content-Type-Options, X-Frame-Options 等）
- S04-S09 安全 Job 的 API 错误必须复用 ErrorResponse v0 和共享错误码 registry，不得新增独立错误格式

---

## 七、分阶段交付

> 阶段边界以 `docs/roadmap/phase-roadmap.md` 为权威。本节只保留摘要。

### Phase 1: Minimal Deliverable Exam System

目标：Admin + Candidate 在单租户部署中跑通可靠考试闭环。

- Admin + Candidate 两类产品角色
- internal default organization
- Admin bootstrap / local admin reset-password script
- CandidateField 配置、Candidate 创建/批量导入
- Course 创建、Question CSV 导入
- Exam 创建、发布、Candidate enrollment / assignment
- Candidate 登录、开始考试、Answer Save Protocol、Submit Attempt、Auto grading
- Result visible to Admin and Candidate
- Result CSV export
- Minimal AuditLog、structured logs、requestId、health endpoint
- E2E happy path / resume / submit-flush 恢复为 blocking CI
- Docker Compose / health / basic deployment notes

### Phase 2: Exam Operation

目标：真实考试运营能力，不是权限系统。

- open / closed / archived lifecycle
- disrupted attempt recovery UI
- proctor intervention workflow
- force submit / extend time / misconduct marking
- timed_sync / deadline / untimed
- queue admission
- retake policy / score strategy
- exam operation timeline / attempt timeline
- import/export job logs / larger result export
- diagnostics page

> **注意**：Phase 2 不实现 multiTenant、SuperAdmin、tenant switcher、organizationSlug login，也不默认做完整 custom role system。

### Phase 3: Collaboration, Permissions, and Account Lifecycle

目标：单部署内多人协作、权限和账号生命周期。

- permission registry
- built-in role bundles
- scoped role assignment
- Teacher-like roles built from permission + scope
- Course / Exam / CandidateGroup scope
- Proctor / Grader / ContentManager role bundles
- staff invitation、SMTP email management、email password reset
- user activation / deactivation
- permission audit、audit log search/export UI

### Phase 4: Platformization and Integration

目标：平台化与外部集成；optional multiTenant 是其中一部分，不是全部。

- pass-to-proceed API
- service token / API key
- webhook / external integration
- optional multiTenant
- SuperAdmin
- tenant hierarchy / tenant switcher / organizationSlug login
- cross-tenant audit
- tenant settings / quota / backup / restore

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
