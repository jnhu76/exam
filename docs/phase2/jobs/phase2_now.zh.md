# Phase 2 全部 Job — 决策摘要

> 给项目负责人看的一页纸，不是实现细节。28 个 Job 按模块分组。

---

## 全局依赖关系图

```
P2-PLAN-J1 → P2.0-J1 → P2A-J1 → P2A-J2 → P2A-J3
                              ↓         ↓         ↓
                            P2A-J4    P2A-J5    P2A-J6（验证全部 P2A）
                              ↓                   ↓
                            P2B-J1 → P2B-J2 → P2C-J1 → P2C-J2/J3/J4 → P2C-J5 → P2C-J8（验证全部 P2C）
                                                                              ↓
                                              P2D-J1 → P2D-J2 → P2D-J3 → P2D-J4 → P2D-J6 → P2E-J1/J2/J3/J4/J5/J6
                                                       ↕
                                                     P2D-J5（可与 P2D-J2~J4 并行）
P2F-J1（ADR 文档）与所有 Job 并行，无依赖
```

---

## P2 前置层（0 个运行时风险）

### P2-PLAN-J1：Phase 2 计划定稿

**这是什么：** 纯文档 Job。对齐 `phase2.plan.md` 与 6 份 discovery 文档，确认计划是唯一执行权威。

**为什么现在做：** 所有后续 Job 都引用这份计划。

**不做什么：** 不改代码。只动 markdown。

**验收：** plan 引用 discovery 01-06；Job ID 与索引一致；依赖链无环。`pnpm format:check` 通过。

---

### P2.0-J1：OpenAPI 契约基线

**这是什么：** 把 42 个 API 端点的 OpenAPI 从 `{}` 占位补全为真实 schema，注册 Zod 到 Fastify，加安全标注。**不改运行时行为。**

**为什么现在做：** Phase 2 所有新 API 都基于这份基线，不补会累积契约漂移。

**不做什么：** 不改 handler 逻辑、不改状态机、不改前端。

**关键概念：** `packages/contracts` 的 Zod schema 是唯一源，同时用于运行时校验和 OpenAPI 文档。

**验收：** 无 `{}` 占位；`oneOf` 表示联合响应；快照测试防回退。`pnpm verify` 通过。

**Reviewer：** 有没有混入 handler 修改；schema 是否与 contracts 包一致。

---

## P2A 候考人运行时（P0 核心）

### P2A-J1：startAttempt 原子化 ⭐ P0

**这是什么：** 给"开始考试"加事务 + 行锁（`SELECT ... FOR UPDATE`），防止并发请求创建重复活跃 attempt。

**为什么现在做：** P0 数据完整性。双击/网络抖动会创建两个 `in_progress` attempt，破坏核心不变量。

**不做什么：** 不改前端、不改评分、不改心跳。

**关键概念：** FOR UPDATE 锁住 enrollment 行；幂等——已存在活跃 attempt 则直接返回。

**验收：** 并发 start 不创建重复 attempt；事务失败完整回滚。并发测试通过。

**Reviewer：** 事务范围；FOR UPDATE 在正确表列上；并发测试是否真实模拟双击。

---

### P2A-J2：deadline 自动提交 ⭐ P0

**这是什么：** 新增服务端 deadline 扫描器，`now >= deadlineAt` 时自动 `submitAttempt()` + `gradeAttempt()`。

**为什么现在做：** P0 生产可用性。浏览器崩溃 + 考试截止 = 考生永久丢失成绩。heartbeat 只管 disrupted 不管 deadline。

**不做什么：** 不改前端、不改 exam open/close、不改 restore、不改 heartbeat 超时。

**关键概念：** 幂等扫描器（事务内 status 检查）；`attempt.autoSubmit` 审计事件。

**验收：** 过期 attempt 自动提交评分；幂等不重复处理；`pnpm verify` 通过。

**Reviewer：** 事务边界；幂等检查位置；与人工提交的竞争处理；大批量到期性能。

---

### P2A-J3：客户端 deadline 感知

**这是什么：** TakeExamPage 在 `now >= deadlineAt` 时禁用输入、显示不可关闭遮罩、flush 待保存答案、自动提交。

**为什么现在做：** 目前服务端拒绝保存但前端仍在允许编辑，用户体验混乱。

**不做什么：** 不改后端、不改 save protocol、不改 submit endpoint。

**验收：** deadline 后输入禁用；pending save 被 flush；遮罩不可关闭。`pnpm verify` 通过。

---

### P2A-J4：exam open/close 语义

**这是什么：** 实现 check-on-access 自动状态转换——考生/管理员访问时，`published → open → closed` 自动触发。

**为什么现在做：** 当前 openExam()/closeExam() 存在但无触发机制，考试永远停在 published。

**不做什么：** 不改前端（已处理多状态）、不加 scheduler/cron、不改 heartbeat。

**关键概念：** 惰性转换——只在有人访问时触发，不需要定时器。

**验收：** 考生访问时 `published → open`；`open → closed` 自动触发；管理员仍可手动归档。`pnpm verify` 通过。

---

### P2A-J5：恢复运行时语义

**这是什么：** `restoreAttempt` 恢复 disrupted attempt 时，调整 `deadlineAt` 为原截止时间 + 断线时长，确保考生不丢失时间。

**为什么现在做：** 当前 restore 只更新 `lastActivityAt` 不调整 deadline，断线考生损失考试时间，不公平。

**不做什么：** 不改前端、不改 heartbeat 超时、不改 disrupted 检测。

**验收：** restore 后 `deadlineAt` 正确延长；不超过 `exam.closeAt`。`pnpm verify` 通过。

---

### P2A-J6：候选考人运行时 E2E 矩阵

**这是什么：** 创建 E2E 覆盖异常路径：刷新、断线、双击 start、deadline 崩溃、save/submit 竞争。

**为什么现在做：** 当前 E2E 只覆盖 happy path，P0 正确性无法在异常条件下验证。

**不做什么：** 不改生产代码（纯测试）。

**验收：** 5 个新 spec 通过；全部在 PostgreSQL 下通过。`pnpm verify` 通过。

---

## P2B 管理员操作循环

### P2B-J1：管理员操作流程审计

**这是什么：** 验证管理员完整操作循环（setup → assignment → publish → result → export），通过 E2E 和文档识别缺口。

**为什么现在做：** 必须先知道缺口在哪，才能在 P2B-J2 修复。

**不做什么：** 除非发现关键缺口，不改生产代码。

**验收：** 完整循环 E2E 通过；缺口记录在 P2B-J2。

---

### P2B-J2：管理员操作加固

**这是什么：** 修复 P2B-J1 发现的缺口：考试设置验证、分配可靠性、publish/open/close/archive 语义、成绩导航。

**为什么现在做：** 管理员在实际操作中会遇到验证错误、缺失转换或死路。

**不做什么：** 不改候选考人运行时、不改 heartbeat、不改评分。

**验收：** 管理员可完成完整操作循环；状态转换正确且有审计。`pnpm verify` 通过。

---

## P2C 监考运行时

### P2C-J1：心跳 + disrupted 检测加固

**这是什么：** 给 heartbeat 扫描器加事务安全、审计日志、可配置扫描间隔和超时。

**为什么现在做：** 当前扫描器无事务、无审计，disrupted 检测是尽力而为。

**不做什么：** 不改前端、不改 deadline 扫描器、不改 force-submit/extend-time/misconduct。

**验收：** markDisrupted 在事务内执行；disruption 写入审计日志；失败重试。`pnpm verify` 通过。

---

### P2C-J2：强制提交

**这是什么：** 新增管理员 API + UI，可对 in_progress/disrupted 的 attempt 强制提交并评分，记录审计。

**为什么现在做：** 管理员无法干预放弃考试的考生。需要 P2C-J1 的 disrupted 检测先稳定。

**不做什么：** 不改候选考人页面、不改 heartbeat 扫描器。

**关键概念：** 复用现有 `submitAttempt` + `gradeAttempt`（幂等）。

**验收：** 管理员可强制提交 in_progress/disrupted attempt；幂等；审计记录管理员身份和原因。`pnpm verify` 通过。

**API：** `POST /admin/attempts/:id/force-submit`，仅 Admin。

---

### P2C-J3：延长考试时间

**这是什么：** 新增管理员 API + UI，可延长候选考人的 deadline，候选考人 UI 通过轮询获取更新。

**为什么现在做：** deadlineAt 创建后不可变，管理员无法为特殊情况延长。

**不做什么：** 不加 WebSocket/SSE 推送、不改 heartbeat 间隔。

**验收：** 管理员可延长 in_progress/disrupted attempt 的 deadline；候选考人在轮询间隔内看到更新；审计记录。`pnpm verify` 通过。

**API：** `POST /admin/attempts/:id/extend-time`，仅 Admin。

---

### P2C-J4：违纪标记

**这是什么：** 新增管理员 API + UI，可对 attempt 标记违纪（含备注和严重程度），持久化并在 dashboard 显示 badge。

**为什么现在做：** RBAC 里有 `MARK_MISCONDUCT` 权限但无 API/UI，无法记录违纪事件。

**不做什么：** 不做自动违纪检测（无 AI、无摄像头）、不做候选考人通知（Phase 3）。

**验收：** 管理员可标记违纪；badge 在 dashboard 和 detail 可见；审计记录。`pnpm verify` 通过。

**DB 变更：** 需要 migration 加违纪字段。

**API：** `POST /admin/attempts/:id/misconduct`，仅 Admin。

---

### P2C-J5：轮询监考 Dashboard

**这是什么：** 新建管理员监考 dashboard 页面，轮询显示候选考人状态卡片（active/disrupted/submitted/graded），暴露 force-submit、extend-time、misconduct 操作按钮。

**为什么现在做：** 当前无 dashboard，管理员无法实时监控考试或干预。

**不做什么：** 不加 WebSocket/SSE 实时推送、不做摄像头/屏幕监控。

**关键概念：** HTTP 轮询（5 秒间隔），不是 WebSocket。

**验收：** 管理员可查看 dashboard；状态卡片分组；操作按钮连接 P2C-J2/J3/J4 API。`pnpm verify` 通过。

**API：** `GET /admin/exams/:id/candidates/status`，仅 Admin。

---

### P2C-J8：监考运行时 E2E

**这是什么：** 创建 E2E 覆盖监考流程：disrupted 检测、强制提交、延长违纪标记。

**为什么现在做：** 无 E2E 则监考实现可能无感回归。

**不做什么：** 不改生产代码（纯测试）。

**验收：** 4 个场景的 E2E 通过。`pnpm verify` 通过。

---

## P2D 评分与成绩

### P2D-J1：客观题评分稳定化

**这是什么：** 为现有自动评分补全回归测试（所有题型边界用例、分策略交互、报名完成逻辑）。

**为什么现在做：** 必须先建立评分基线，再加手动评分时才不会无意破坏客观题评分。

**不做什么：** 不改评分逻辑（除非发现 bug）。

**验收：** 所有题型有边界用例测试；分策略（highest/latest/first）验证；E2E happy path 通过。`pnpm verify` 通过。

---

### P2D-J2：手动评分模型

**这是什么：** 定义手动评分的领域模型、Zod schema 和 DB schema：`ManualGradingEntry`（per question per attempt）、`gradingStatus` 枚举。

**为什么现在做：** 无标准答案的主观题无法自动评分，需要手动评分模型。

**不做什么：** 不实现评分 API（P2D-J3）、不实现评分 UI（P2D-J4）。

**验收：** 模型定义在 domain 和 contracts；migration 创建 `manual_grading_entries` 表；`gradingStatus` 枚举定义。`pnpm verify` 通过。

**DB 变更：** 新表 `manual_grading_entries`，枚举 `gradingStatus`。

---

### P2D-J3：评分队列 API

**这是什么：** 新增管理员 API：列出待手动评分的 attempt、查看评分详情、按题输入分数和评语。

**为什么现在做：** 手动评分工作流需要后端 API 支撑。

**不做什么：** 不改前端 UI（P2D-J4）、不改自动评分引擎、不改成绩发布策略（P2D-J5）。

**验收：** 管理员可列出待评分 attempt；可按题输入分数；全部评分后 attempt 转为 `fully_graded`。`pnpm verify` 通过。

**API：**
- `GET /admin/grading-queue`
- `GET /admin/attempts/:id/grading-details`
- `POST /admin/attempts/:id/grade-question`

---

### P2D-J4：手动评分 UI

**这是什么：** 构建管理员评分 UI：评分队列列表、按题输入分数和评语、结果预览。

**为什么现在做：** 有 API 但无 UI，管理员无法进行手动评分。

**不做什么：** 不改后端评分逻辑、不改成绩发布策略。

**验收：** 评分队列列表可见；可输入分数和评语；分数校验 maxScore 范围；全部评分后状态更新。`pnpm verify` 通过。

---

### P2D-J5：成绩发布策略

**这是什么：** 将 `showResultImmediate` 布尔替换为 `resultPublicationMode` 枚举（immediate / after_grading / manual），控制候选考人何时可见成绩。

**为什么现在做：** 管理员无法控制成绩可见时机。

**不做什么：** 不改评分引擎、不改监考 dashboard。

**验收：** immediate 模式评分后立即可见；after_grading 模式全部评分后可见；manual 模式需管理员手动发布。`pnpm verify` 通过。

**DB 变更：** 加 `resultPublicationMode` 和 `resultsPublishedAt` 字段。

**API：** `POST /admin/exams/:id/publish-results`。

---

### P2D-J6：评分审计

**这是什么：** 确保所有分数变更和评分人身份都记录在审计日志中。

**为什么现在做：** 当前评分决策不可审计，无法追溯分数变更到具体评分人。

**不做什么：** 不改审计日志 UI（P2E-J1）、不改评分队列逻辑。

**验收：** 手动评分记录 `grading.score_entered`；全部评分记录 `grading.finalized`；成绩发布记录 `result.published`；元数据含评分人身份和分数差值。`pnpm verify` 通过。

---

## P2E 运维与导出

### P2E-J1：审计日志查看器

**这是什么：** 构建审计日志前端 UI，利用已有 `GET /api/admin/audit-logs` API。

**为什么现在做：** API 存在但无前端页面，管理员无法在 UI 中浏览审计追踪。

**不做什么：** 不改后端 API、不改审计 schema。

**验收：** 管理员可查看分页审计日志；可按 action 和 target type 筛选；可展开元数据。`pnpm verify` 通过。

---

### P2E-J2：尝试时间线

**这是什么：** 新增 API + 前端，按时间线展示 attempt 生命周期事件（start、save、heartbeat、disrupt、restore、submit、grade）。

**为什么现在做：** 审计追踪存在但未结构化为可视化时间线，管理员/监考人无法快速诊断 attempt 问题。

**不做什么：** 不改审计日志 schema、不改 attempt 状态机。

**验收：** 时间线按序展示关键事件；事件有可读标签；元数据可展开。`pnpm verify` 通过。

**API：** `GET /admin/attempts/:id/timeline`。

---

### P2E-J3：成绩 CSV 导出加固

**这是什么：** 加固 CSV 导出端点：正确性、权限检查、大数据集处理、UTF-8 BOM 编码。

**为什么现在做：** 当前导出基础，无大数据集测试，可能在大规模考试时失败。

**不做什么：** 不改前端 UI、不加 PDF 导出、不加异步队列。

**验收：** CSV 列正确；1000+ 记录无错；仅 Admin；UTF-8 BOM。`pnpm verify` 通过。

---

### P2E-J4：单次尝试导出

**这是什么：** 新增 API + 前端按钮，可导出单个 attempt 的答案和评分结果（JSON 或 CSV）。

**为什么现在做：** AttemptDetailPage 是只读的，管理员无法导出单次 attempt 数据。

**不做什么：** 不做批量导出、不做 PDF 导出。

**验收：** 管理员可导出 JSON/CSV；含答案和评分结果；审计记录。`pnpm verify` 通过。

**API：** `GET /admin/attempts/:id/export`。

---

### P2E-J5：导入任务日志

**这是什么：** 新增 `import_job_logs` 表持久化导入摘要，让管理员可查看导入历史和诊断问题。

**为什么现在做：** 当前导入返回摘要但不持久化，历史丢失。

**不做什么：** 不改导入逻辑本身、不改导入验证规则。

**验收：** 导入操作写入日志；管理员可查看分页导入历史；日志含状态、计数、错误。`pnpm verify` 通过。

**DB 变更：** 新表 `import_job_logs`。

**API：** `GET /admin/import-logs`。

---

### P2E-J6：诊断页面

**这是什么：** 构建管理员诊断页面，展示运行时配置、DB 状态、heartbeat/deadline 扫描器状态、版本信息。

**为什么现在做：** 当前 SystemHealthPage 基础，无心跳/配置可见性，管理员无法在考试期间诊断系统健康。

**不做什么：** 不暴露密钥/DB URL 等敏感配置。

**验收：** 版本/运行时间/DB 延迟可见；heartbeat/deadline 扫描器状态可见；无敏感配置泄露。`pnpm verify` 通过。

**API：** `GET /api/system/diagnostics`。

---

## P2F 基础设施 ADR

### P2F-J1：基础设施 ADR 文档

**这是什么：** 为可选基础设施升级（Redis、Job Queue、WebSocket/SSE、Desktop/Electron）编写架构决策记录，**不实现**。

**为什么现在做：** 明确 Phase 3+ 的升级标准和权衡，避免过早引入复杂性。

**不做什么：** 不改任何代码。

**验收：** 4 个 ADR 各回答：痛点、为什么 PG+HTTP 不够、最小采用方案、运维负担、故障模式、回滚路径。`pnpm format:check` 通过。

---

## 模块总览

| 模块 | Job 数 | 核心解决 | DB 变更 | 新 API |
|------|--------|----------|---------|--------|
| P2 前置 | 2 | 计划 + 契约基线 | 无 | 无 |
| P2A 考试运行时 | 6 | P0 原子性 + deadline + 恢复 + E2E | 无 | 无 |
| P2B 管理员操作 | 2 | 操作循环完整性 | 无 | 无 |
| P2C 监考 | 5 | 心跳加固 + 强制提交/延时/违纪 + Dashboard | 违纪字段 | 4 个 Admin API |
| P2D 评分 | 6 | 客观题基线 + 手动评分全链路 + 成绩发布 + 审计 | 手动评分表 + 成绩发布字段 | 4 个 Admin API |
| P2E 运维 | 6 | 审计 UI + 时间线 + 导出 + 导入日志 + 诊断 | 导入日志表 | 3 个 API |
| P2F 基础设施 | 1 | ADR 决策文档 | 无 | 无 |

**总 DB 变更：** 3 个 migration（违纪字段、手动评分表 + 成绩发布字段、导入日志表）
**总新表：** 2 个（`manual_grading_entries`、`import_job_logs`）
**总新 API：** ~11 个端点
**总 E2E 覆盖：** 3 个新 E2E spec 文件（候选考人异常路径、监考流程、评分/成绩/导出）
