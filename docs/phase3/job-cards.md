# Exam Phase 3 — Small / Middle Job Cards

> 本文档只包含可直接推进的 Small / Middle Job。
> Large Job 暂不施工，等后续 grillme 拷问清楚后再拆成 Middle Job。

---

# 0. 当前边界

## 本批允许做

* 文档 scaffold
* 当前实现审计
* 局部真实缺口修复
* Redis / Email / Audit / Diagnostics 基础设施
* 测试补齐
* 不改变核心产品模型的安全小改

## 本批禁止做

* 不实现完整后端权限模型
* 不实现 teacher / proctor / grader account model
* 不实现 custom RBAC
* 不实现 answer protocol v2
* 不实现 WYSIWYG final answer barrier
* 不重写前端考试状态机
* 不重做 UI 体系
* 不定义完整 proctor runtime authority boundary

---

# 1. Small Job Cards

---

## S1 — Phase 3 README Scaffold

### Type

Small

### Goal

建立 Phase 3 文档入口，让后续任务有统一落点。

### Scope

创建或更新：

```txt
docs/phase3/README.md
```

内容包括：

* Phase 3 目标
* S / M / L job 分类入口
* 当前推荐推进顺序
* 已知 Large deferred topics
* 当前第一批可施工任务链接

### Non-goals

* 不写完整规则手册
* 不做代码修改
* 不做权限/协议设计

### Acceptance Criteria

* `docs/phase3/README.md` 存在
* 能看到 Small / Middle / Large 三类任务入口
* 明确说明 Large 暂不施工，需要 grillme 后再拆分
* 不影响任何测试

### Validation

```bash
git diff -- docs/phase3/README.md
```

---

## S2 — Phase 3 Plan Document

### Type

Small

### Goal

把 Phase 3 当前计划固化成可追踪文档。

### Scope

创建：

```txt
docs/phase3/plan.md
```

内容包括：

* Small Job 表
* Middle Job 表
* Large Job 表
* 推荐执行批次
* 当前第一优先级

### Non-goals

* 不新增 job-size-policy 规则文档
* 不做代码修改
* 不承诺 Phase 3 已实现

### Acceptance Criteria

* `plan.md` 能直接指导后续施工
* Large Job 明确标记为 deferred / grillme required
* Small / Middle Job 能直接进入 worktree 施工

### Validation

```bash
git diff -- docs/phase3/plan.md
```

---

## S3 — Current Role Check Audit

### Type

Small

### Goal

梳理当前代码里所有角色 / 权限判断位置，为后续 Large 权限模型 grillme 准备事实基础。

### Scope

审计以下内容：

* route handler 中的 role check
* auth middleware
* admin / teacher / candidate 判断
* proctor / grader 相关判断
* error code / forbidden response
* 是否存在 hard-coded role string

输出：

```txt
docs/phase3/audit-current-role-checks.md
```

### Non-goals

* 不重构权限
* 不新增 permission helper
* 不改 API 行为
* 不设计完整 RBAC

### Acceptance Criteria

文档至少包含：

* 发现的 role check 文件列表
* 当前角色类型
* 当前授权模式总结
* 明显风险点
* 后续 Large Job 输入问题

### Suggested Commands

```bash
rg "role|admin|teacher|proctor|grader|candidate|forbidden|unauthorized|authorize|auth" apps packages
```

### Validation

```bash
git diff -- docs/phase3/audit-current-role-checks.md
```

---

## S4 — Current Grading API Audit

### Type

Small

### Goal

梳理当前评分详情 API 是否返回 candidate answer，为 M1 施工准备事实基础。

### Scope

审计：

* grading detail route
* grading service / repo
* contracts schema
* grading detail frontend page
* existing tests
* manual grading seed / fixtures

输出：

```txt
docs/phase3/audit-current-grading-api.md
```

### Non-goals

* 不修 bug
* 不改 schema
* 不改 UI
* 不做完整 grader 权限模型

### Acceptance Criteria

文档至少包含：

* 当前 grading detail response 字段
* 是否包含 candidate answer
* candidate answer 当前存储位置
* grading page 当前展示字段
* M1 需要修改的文件清单
* M1 需要新增的测试清单

### Suggested Commands

```bash
rg "GradingDetails|grading detail|candidateAnswer|answer" apps packages docs
rg "manual grading|grading queue|score" apps packages
```

### Validation

```bash
git diff -- docs/phase3/audit-current-grading-api.md
```

---

## S5 — Current Redis Usage Audit

### Type

Small

### Goal

梳理当前 Redis 接入点、fallback 行为、诊断状态，为 M2 施工准备事实基础。

### Scope

审计：

* Redis client / config
* presence
* heartbeat
* rate limit
* job queue
* diagnostics
* tests with Redis unavailable

输出：

```txt
docs/phase3/audit-current-redis.md
```

### Non-goals

* 不新增 Redis 功能
* 不改变 Redis 语义
* 不把 Redis 变成权威状态源

### Acceptance Criteria

文档至少包含：

* Redis 当前用途
* Redis 不可用时当前行为
* 哪些路径必须 fallback
* 哪些路径可以 skip
* 哪些状态必须仍以 PG 为准
* M2 修改建议

### Suggested Commands

```bash
rg "redis|ioredis|rateLimit|presence|heartbeat|queue" apps packages docs
```

### Validation

```bash
git diff -- docs/phase3/audit-current-redis.md
```

---

## S6 — Current Audit / Monitoring Event Map

### Type

Small

### Goal

梳理当前 audit event / monitoring event，为 M4 事件扩展准备基础。

### Scope

审计：

* audit log schema
* audit event enum / string literals
* monitoring / diagnostics event
* proctor event
* grading event
* candidate submit event
* Redis / worker / email 相关事件

输出：

```txt
docs/phase3/audit-current-events.md
```

### Non-goals

* 不新增事件
* 不改 audit schema
* 不做完整 event taxonomy

### Acceptance Criteria

文档至少包含：

* 当前事件列表
* 事件来源文件
* audit event 与 monitoring event 是否区分
* 缺失事件列表
* M4 第一批建议新增事件

### Suggested Commands

```bash
rg "audit|Audit|event|Event|monitor|diagnostic|log" apps packages docs
```

### Validation

```bash
git diff -- docs/phase3/audit-current-events.md
```

---

## S7 — Current Candidate Runtime Audit

### Type

Small

### Goal

梳理当前前端考试运行时页面的状态变量，为后续 Large 前端状态机 grillme 准备事实基础。

### Scope

审计：

* candidate exam page
* save / submit 状态
* loading / error 状态
* deadline 状态
* reconnect / restore 状态
* button disabled 逻辑
* E2E 对这些状态的断言

输出：

```txt
docs/phase3/audit-current-candidate-runtime.md
```

### Non-goals

* 不引入状态机
* 不重构页面
* 不改变 UI 行为

### Acceptance Criteria

文档至少包含：

* 当前状态变量列表
* 状态之间的隐含关系
* 容易冲突的状态组合
* E2E 已覆盖路径
* 状态机 Large Job 输入问题

### Suggested Commands

```bash
rg "isLoading|isSaving|isSubmitting|submitted|deadline|disconnect|restore|resume|disabled" apps/web
rg "candidate|submit|deadline|resume|disconnect" apps/web tests
```

### Validation

```bash
git diff -- docs/phase3/audit-current-candidate-runtime.md
```

---

## S8 — Current Answer Payload Audit

### Type

Small

### Goal

梳理当前答案保存 / 提交 payload，为 answer protocol v2 grillme 做准备。

### Scope

审计：

* answer schema
* save answer API
* submit API
* frontend answer state
* grading answer read path
* deadline / force submit 是否复用同一路径

输出：

```txt
docs/phase3/audit-current-answer-payload.md
```

### Non-goals

* 不实现 Answer Protocol v2
* 不改 submit 行为
* 不改 grading schema

### Acceptance Criteria

文档至少包含：

* 当前 answer payload 结构
* 当前 save / submit 差异
* 当前 final answer 存储位置
* 是否存在 answer snapshot
* 是否存在 hash / revision / canonicalization
* L4 / L5 grillme 输入问题

### Suggested Commands

```bash
rg "answer|answers|save|submit|snapshot|revision|hash|canonical" apps packages docs
```

### Validation

```bash
git diff -- docs/phase3/audit-current-answer-payload.md
```

---

## S9 — E2E Parallelization Constraints Audit

### Type

Small

### Goal

固化当前 E2E 不能并行的真实原因，为后续 L10 / Middle 拆分准备依据。

### Scope

审计：

* Playwright config
* workers 配置
* seed 数据
* shared candidates
* shared attempts
* write-heavy specs
* beforeAll / afterAll
* database reset 策略

输出：

```txt
docs/phase3/audit-e2e-parallelization.md
```

### Non-goals

* 不改 E2E 并行策略
* 不重构 seed
* 不创建 worker database

### Acceptance Criteria

文档至少包含：

* 当前 workers 配置
* 共享 seed 冲突点
* 哪些 spec 写同一个 candidate / attempt
* 可并行化选项
* 推荐后续拆分方案

### Suggested Commands

```bash
rg "workers|playwright|seed|candidate1|attempt|beforeAll|afterAll" apps tests playwright.config.* docker-compose*
```

### Validation

```bash
git diff -- docs/phase3/audit-e2e-parallelization.md
```

---

## S10 — Large Grillme Question List

### Type

Small

### Goal

提前准备 Large Job 的拷问问题，明天额度够时直接进入 grillme。

### Scope

创建：

```txt
docs/phase3/grillme-question-list.md
```

覆盖：

* account model
* backend permission model
* custom roles
* answer protocol v2
* WYSIWYG submit barrier
* frontend state machine
* proctor authority boundary
* UI design
* audit / monitoring taxonomy
* tenant / school / organization scope
* exam lifecycle
* result release policy

### Non-goals

* 不回答这些问题
* 不做 ADR
* 不做代码实现

### Acceptance Criteria

* 每个 Large Job 至少 8 个问题
* 问题要能暴露产品边界和技术边界
* 能直接作为 grillme 输入

### Validation

```bash
git diff -- docs/phase3/grillme-question-list.md
```

---

# 2. Middle Job Cards

---

## M1 — Manual Grading Candidate-Answer Visibility

### Type

Middle

### Goal

修复真实评分缺口：授权评分员在评分详情页必须能看到考生答案。

### Background

当前 manual grading 如果只展示题目、标准答案、最高分，而不展示 candidate answer，则评分功能不完整。

### Scope

实现：

* contract response 增加 candidate answer 字段
* API route / service 查询 candidate answer
* grading detail page 渲染 candidate answer
* 对空答案 / 未作答有明确 UI
* tests 覆盖 authorized grading detail access
* 不记录敏感 answer 内容到日志

可能涉及：

```txt
packages/contracts
apps/api
packages/db
apps/web
e2e / component tests
```

### Non-goals

* 不实现完整 grader 权限模型
* 不实现 answer protocol v2
* 不实现 WYSIWYG submit barrier
* 不改变评分流程
* 不改变 proctor 权限

### Suggested Implementation Notes

* 先从当前 grading task / attempt / answer 存储关系出发。
* 如果当前 DB 中 answer 是按 questionId 存储，则只返回当前待评分题目的 candidate answer。
* 如果当前 API 是按 grading task 取详情，则 candidate answer 应跟随 grading detail response 返回。
* 如果答案内容可能是 JSON，应以安全方式渲染，不直接 dangerouslySetInnerHTML。
* 不要在 audit log 中写入完整答案内容。

### Required Tests

至少补：

* contract/schema test：`candidateAnswer` 字段存在
* API test：authorized grader/detail reader 能拿到 candidate answer
* API test：未作答时返回空态而不是 500
* frontend test：评分页展示考生答案
* 如已有 E2E 主观题 seed，则补 E2E；没有则记录 deferred

### Review Standard

必须满足：

* 评分员能看到答案
* 未作答显示明确空态
* 不泄露答案到日志
* 不扩大权限模型
* 现有 grading tests 仍通过
* Phase 2 行为不回退

### Suggested Validation

```bash
pnpm --filter @exam/contracts test
pnpm --filter @exam/api test -- grading
pnpm --filter @exam/web test -- grading
pnpm verify:fast
```

如命令名称不同，以项目实际脚本为准，并在结果中说明。

---

## M2 — Redis Health / Fallback / Diagnostics

### Type

Middle

### Goal

打通 Redis 运行态基础设施：健康检查、不可用 fallback、诊断页展示。

### Background

Phase 3 会逐步使用 Redis 做 presence、heartbeat、rate limit、runtime fanout、worker dedupe 等运行态能力。但 Redis 不能成为考试一致性的权威状态源。

### Scope

实现或完善：

* Redis health check
* Redis unavailable fallback
* diagnostics 输出 Redis 状态
* Redis connection error 不导致核心考试状态损坏
* 文档说明 Redis 只做 runtime cache
* tests 覆盖 Redis unavailable

可能涉及：

```txt
apps/api
packages/db
apps/web diagnostics page
docs/phase3
```

### Non-goals

* 不把 attempt status 放 Redis
* 不把 final answer 放 Redis
* 不把 score 放 Redis
* 不把 audit log 放 Redis
* 不引入复杂 Redis topology
* 不实现完整 presence 系统

### Required Behavior

Redis 不可用时：

* 核心 API 不应错误修改 PG 状态
* 可以降级 skip runtime cache
* diagnostics 应显示 degraded / unavailable
* 测试环境没有 Redis 时，相关测试应明确 skip 或使用 fake

### Required Tests

至少补：

* Redis health check success / unavailable
* Redis unavailable 不影响 PG authoritative flow
* diagnostics response 包含 Redis 状态
* 如前端 diagnostics 页已存在，则补 UI test

### Review Standard

必须满足：

* Redis 不可用不会破坏考试状态
* PG 仍是权威状态源
* diagnostics 能看到 Redis 状态
* 没有新增 flake
* 文档明确 Redis 边界

### Suggested Validation

```bash
pnpm --filter @exam/api test -- redis
pnpm --filter @exam/api test -- diagnostics
pnpm --filter @exam/web test -- diagnostics
pnpm verify:fast
```

---

## M3 — Email Outbox Skeleton

### Type

Middle

### Goal

建立邮箱 outbox 基础设施，为后续考试通知、成绩通知、异常提醒做准备。

### Background

邮箱不能在 API 请求里直接发送。应该通过 outbox 模式：业务事务写入 outbox，worker 异步发送，失败可重试。

### Scope

实现：

* `email_outbox` 表或等价结构
* EmailOutboxRepo
* EmailOutboxService
* fake email sender
* worker skeleton
* pending / sent / failed 状态
* retry count / last error / next retry time
* disabled-by-default email config
* tests 验证 email 失败不 rollback 主业务

可能涉及：

```txt
packages/db
apps/api
packages/contracts
docs/phase3
```

### Non-goals

* 不做复杂邮件模板系统
* 不做多租户发件人配置
* 不做邮件 UI
* 不接真实 SMTP 强依赖
* 不做投递追踪 analytics
* 不改变核心考试事务

### Migration Note

该 job 涉及 DB migration 时，必须单独分支、单独合并。不要和其他 migration job 并行合并。

### Required Tests

至少补：

* repo insert pending outbox
* worker sends pending email via fake sender
* success 后标记 sent
* failure 后标记 failed 或 retry scheduled
* email failure 不 rollback 已提交业务事务
* config disabled 时 worker 安全 no-op

### Review Standard

必须满足：

* outbox 表结构清楚
* worker 可测试
* 默认安全关闭真实发送
* 失败不影响业务事务
* 没有真实 SMTP secret 写入代码
* migration 可重复应用

### Suggested Validation

```bash
pnpm --filter @exam/db test -- email
pnpm --filter @exam/api test -- email
pnpm --filter @exam/api test -- outbox
pnpm verify:fast
```

---

## M4 — Audit / Monitoring Event Expansion v0

### Type

Middle

### Goal

补齐 Phase 3 第一批必要事件，为评分、Redis、Email、监考事件提供审计和观测基础。

### Scope

新增或整理事件：

Audit events:

* `grading.detail_viewed`
* `grading.score_submitted`
* `attempt.force_submitted`
* `proctor.incident_marked`
* `email.outbox_created`

Monitoring events:

* `redis.unavailable`
* `redis.recovered`
* `email.send_failed`
* `email.send_retried`
* `email.worker_unavailable`
* `diagnostics.health_checked`

根据现有代码结构决定使用 enum、string union、schema 或常量文件。

### Non-goals

* 不设计完整 event taxonomy
* 不改 audit log 表大结构
* 不记录答案正文
* 不做监控平台
* 不做指标 dashboard

### Required Privacy Rule

事件中不得写入：

* candidate answer content
* password / token / secret
* raw email content
* sensitive headers

允许记录：

* actorId
* candidateId
* attemptId
* examId
* gradingTaskId
* event type
* timestamp
* traceId / requestId
* status / reason code

### Required Tests

至少补：

* grading score submit 产生 audit event
* email outbox created 产生 audit event
* Redis unavailable 产生 monitoring event 或 diagnostics degraded record
* sensitive content 不进入 audit payload

### Review Standard

必须满足：

* audit / monitoring 语义尽量分开
* 关键事件可追踪
* 不记录敏感正文
* 不引入大平台
* 不破坏现有 audit tests

### Suggested Validation

```bash
pnpm --filter @exam/api test -- audit
pnpm --filter @exam/api test -- diagnostics
pnpm --filter @exam/api test -- grading
pnpm verify:fast
```

---

## M5 — Diagnostics Infrastructure Status

### Type

Middle

### Goal

让系统诊断页能看到 Phase 3 基础设施状态：Redis、worker、email outbox。

### Scope

实现或完善：

* diagnostics API 返回 Redis 状态
* diagnostics API 返回 email outbox / worker 状态
* 前端 diagnostics 页面展示基础设施状态
* degraded / unavailable 有明确文案
* tests 覆盖 response 和 UI

可能涉及：

```txt
apps/api diagnostics route
apps/web SystemDiagnosticsPage
packages/contracts diagnostics schema
```

### Non-goals

* 不做完整 observability 平台
* 不引入 Grafana / Prometheus
* 不做实时推送
* 不做复杂告警系统

### Required Tests

至少补：

* diagnostics response schema test
* API test：Redis unavailable 显示 degraded
* API test：email disabled 显示 disabled
* UI test：基础设施状态可见

### Review Standard

必须满足：

* 用户能知道 Redis / email / worker 是否可用
* 状态不会误导为业务失败
* disabled 和 unavailable 区分
* 现有 diagnostics tests 仍通过

### Suggested Validation

```bash
pnpm --filter @exam/contracts test -- diagnostics
pnpm --filter @exam/api test -- diagnostics
pnpm --filter @exam/web test -- diagnostics
pnpm verify:fast
```

---

## M6 — Grading Answer Rendering Tests

### Type

Middle

### Goal

专门补评分页 candidate answer 渲染测试，避免 M1 只是 API 有字段但 UI 没展示。

### Scope

补测试：

* short text answer 渲染
* empty answer 空态
* long answer 展示
* JSON answer 安全展示
* 不使用 unsafe HTML 渲染

可能涉及：

```txt
apps/web grading page tests
apps/web test fixtures
```

### Non-goals

* 不改后端 API
* 不改 answer protocol
* 不做 rich text renderer
* 不做完整主观题架构

### Required Tests

至少补：

* candidate answer visible
* empty answer state visible
* answer content does not execute HTML/script
* page still shows score input / rubric

### Review Standard

必须满足：

* 测试能防止 UI 漏展示 candidate answer
* 测试不依赖脆弱中文硬编码，除非项目当前策略允许
* 不引入 snapshot 大噪音

### Suggested Validation

```bash
pnpm --filter @exam/web test -- grading
pnpm verify:fast
```

---

## M7 — Redis Unavailable Fallback Tests

### Type

Middle

### Goal

专门补 Redis 不可用时的 fallback 测试，避免后续 Redis 接入破坏考试一致性。

### Scope

补测试：

* Redis client connect failed
* presence write failed
* heartbeat cache failed
* rate limit fallback
* diagnostics degraded
* core PG state unaffected

### Non-goals

* 不新增 Redis 功能
* 不改变业务状态机
* 不把 Redis 接入 answer / score / final submit

### Required Tests

至少补：

* Redis unavailable 不导致 start/resume/save/submit 权威状态损坏
* Redis unavailable 时 diagnostics 可见
* fallback 有日志或 monitoring event，但不泄露敏感信息

### Review Standard

必须满足：

* Redis 失败路径被真实模拟
* 测试不是 fake zero
* PG authoritative assertions 存在
* 不引入环境依赖 flake

### Suggested Validation

```bash
pnpm --filter @exam/api test -- redis
pnpm --filter @exam/api test -- candidate
pnpm verify:fast
```

---

## M8 — Email Send Failure Retry Tests

### Type

Middle

### Goal

专门补 email outbox 的失败和重试测试，保证邮箱基础设施不会影响主业务。

### Scope

补测试：

* fake sender success
* fake sender failure
* retry count 增加
* last error 记录
* next retry time 更新
* disabled config no-op
* 业务事务不 rollback

### Non-goals

* 不接真实 SMTP
* 不做邮件模板
* 不做 UI
* 不做 delivery analytics

### Required Tests

至少补：

* pending -> sent
* pending -> failed / retry scheduled
* failure does not rollback business transaction
* disabled email worker does not throw

### Review Standard

必须满足：

* 失败路径可重复测试
* 无真实外部服务依赖
* 不需要 secret
* retry 行为明确

### Suggested Validation

```bash
pnpm --filter @exam/api test -- email
pnpm --filter @exam/db test -- email
pnpm verify:fast
```

---

## M9 — Proctor Incident Event Logging v0

### Type

Middle

### Goal

先实现轻量级监考异常事件记录，为后续完整 proctor authority boundary 做准备。

### Scope

实现：

* proctor incident event 类型
* API 或 service 层记录 incident
* audit event 写入
* 不记录答案正文
* tests 覆盖 incident created

可能事件：

* suspicious_behavior_marked
* network_issue_marked
* identity_check_failed
* manual_note_added

### Non-goals

* 不定义完整 proctor 权限模型
* 不实现 force submit 权限边界
* 不实现 proctor dashboard 重构
* 不影响成绩判定
* 不做作弊裁决流程

### Required Tests

至少补：

* authorized existing proctor/admin path can create incident, if current auth supports it
* incident 写入 audit
* incident 不包含答案正文
* invalid incident type rejected

### Review Standard

必须满足：

* incident 是记录，不是裁决
* 不改变 attempt final state
* 不扩大 proctor 权限
* 可被后续 L7 接管

### Suggested Validation

```bash
pnpm --filter @exam/api test -- proctor
pnpm --filter @exam/api test -- audit
pnpm verify:fast
```

---

## M10 — CI / E2E Parallelization Readiness Report

### Type

Middle

### Goal

生成可执行的 E2E 并行化准备报告，为后续 Large E2E implementation 决策提供依据。

### Scope

输出：

```txt
docs/phase3/e2e-parallelization-readiness-report.md
```

内容包括：

* 当前 workers=1 的原因
* spec 文件共享数据矩阵
* candidate / attempt 冲突矩阵
* 可并行 spec 候选
* 必须串行 spec 列表
* 方案 A：worker 独立 DB
* 方案 B：唯一 seed
* 方案 C：只读测试并行
* 推荐路线
* 风险和测试成本

### Non-goals

* 不改 Playwright workers
* 不改 seed
* 不改 DB lifecycle
* 不让 CI 直接并行

### Acceptance Criteria

* 报告能支撑后续 Large grillme / ADR
* 明确哪些 spec 写共享 attempt
* 明确推荐路线
* 不改变代码行为

### Suggested Commands

```bash
rg "candidate1|candidate2|attempt|start|submit|resume|force|deadline|seed" apps tests e2e
rg "workers|fullyParallel|playwright" .
```

### Validation

```bash
git diff -- docs/phase3/e2e-parallelization-readiness-report.md
```

---

## M11 — Phase 3 Readiness Closeout Report

### Type

Middle

### Goal

在完成第一批 Small / Middle 后，生成 Phase 3 进入 Large grillme 的基线报告。

### Scope

输出：

```txt
docs/phase3/readiness-closeout-report.md
```

内容包括：

* 已完成 Small Job
* 已完成 Middle Job
* 未完成 Middle Job
* 当前真实缺口
* Large Job 输入材料
* 风险清单
* 下一批推荐任务

### Non-goals

* 不声称 Phase 3 完成
* 不做代码修改
* 不替代 Large ADR

### Acceptance Criteria

报告包含：

* grading candidate answer visibility 状态
* Redis diagnostics 状态
* email outbox 状态
* audit event expansion 状态
* E2E parallelization 状态
* Large grillme 准备度

### Validation

```bash
git diff -- docs/phase3/readiness-closeout-report.md
```

---

# 3. Recommended First Execution Order

## Cycle 1

### 2-hour window

```txt
S1 Phase 3 README Scaffold
S2 Phase 3 Plan Document
S4 Current Grading API Audit
```

### 5-hour window

```txt
M1 Manual Grading Candidate-Answer Visibility
```

---

## Cycle 2

### 2-hour window

```txt
S5 Current Redis Usage Audit
S6 Current Audit / Monitoring Event Map
```

### 5-hour window

```txt
M2 Redis Health / Fallback / Diagnostics
```

---

## Cycle 3

### 2-hour window

```txt
M4 scope review
M5 diagnostics scope review
```

### 5-hour window

```txt
M4 Audit / Monitoring Event Expansion v0
M5 Diagnostics Infrastructure Status
```

If M4 grows too large, split M5 into the next cycle.

---

## Cycle 4

### 2-hour window

```txt
Email/outbox current state review
M3 migration impact review
```

### 5-hour window

```txt
M3 Email Outbox Skeleton
```

---

## Cycle 5

### 2-hour window

```txt
S7 Current Candidate Runtime Audit
S8 Current Answer Payload Audit
```

### 5-hour window

```txt
S10 Large Grillme Question List
L1/L2 grillme prep only
```

Large implementation remains deferred.

---

# 4. First Batch Recommended Branches

```txt
p3/s-readme-plan
p3/s-grading-api-audit
p3/m-grading-answer-visibility
p3/s-redis-event-audit
p3/m-redis-diagnostics
p3/m-audit-events-v0
p3/m-email-outbox
p3/s-large-grillme-prep
```

---

# 5. Immediate Priority

Start with:

```txt
S1 + S2 + S4
```

Then implement:

```txt
M1 manual grading candidate-answer visibility
```

This gives Phase 3 an immediate real improvement without entering unresolved Large design.
