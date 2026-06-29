# Phase 1.7 Exam Lifecycle — Non-E2E Closeout Decisions

**Date**: 2026-06-14
**Branch**: `phase1.7-config-baseline-review`
**Scope**: 文档 / 契约 / 测试层面的收口与裁决记录。
**Out of scope**: 任何对 `apps/e2e/**`、`playwright.config.ts`、auth.setup、candidate browser flow、`tests/e2e/helpers/seed.ts` 的修改。

## 目的

`docs/archive/phase-1.7/exam-lifecycle-global-consistency-scan.md` 列出的不一致与"需要裁决"项，本文档对其中**非 E2E、非新功能、非状态机重构**的问题给出最终裁决，并把无法在 Phase 1.7 范围内解决的项目归入 Phase 2 backlog。

本文档不修改 SPEC.md 状态图（`docs/SPEC.md:111-138, 407-423`），但记录"图与代码当前偏差"，以便 Phase 2 团队入场即知。

---

## 1. 已修复的文档 drift（API 契约对齐）

### 1.1 Heartbeat 响应：204 No Content → 200 + { ok: true }

- **症状**：`docs/api/reference.md` 此前文档化为 `204 No Content`；实际路由 `apps/api/src/routes/attempts.ts:861-890` 返回 `200 { ok: true }`，前端 `apps/web/src/pages/exam/TakeExamPage.tsx` 已按 200 成功处理。
- **裁决**：保留运行时行为不变（`200 + { ok: true }`），文档对齐到代码。**不切到 204** —— 切换会触发前端兼容性回归，且没有客户端要求 204。
- **修改文件**：
  - `docs/api/reference.md`：heartbeat 段重写为 200 + `{ ok: true }`，并补充心跳与 deadline 解耦说明、后台扫描器存在但前端 restore UI 未接入的现状。
  - `docs/archive/phase-1.7/api-contract/07-endpoint-inventory.md`：heartbeat target status 从 `204 / Empty Response` 修正为 `200 / { ok: true }`，状态从 `pending verification` 改为 `resolved`。
  - `docs/archive/phase-1.7/api-contract/00-current-state-audit.md`：drift 条目标记已修复。
  - `apps/api/src/routes/attempts.test.ts`：`heartbeat updates lastActivityAt` 测试追加 `expect(res.json()).toEqual({ ok: true })` 与 Content-Type 断言。

### 1.2 Save-answer 拒绝响应：自然语言 reason → 稳定枚举 + 扁平结构

- **症状**：`docs/api/reference.md` 把冲突响应写成嵌套 `conflict: { reason: "Server has newer version", serverAnswer }`；实际契约（`packages/contracts/src/attempt.ts` `SaveAnswerRejectedSchema` strict）是扁平结构 `{ accepted:false, reason, message, serverVersion, savedAt, details?:{ serverAnswer? } }`，`reason` 来自稳定枚举 `SaveAnswerRejectReasonEnum = ["STALE_VERSION","ATTEMPT_ALREADY_SUBMITTED","ATTEMPT_CLOSED","DEADLINE_EXCEEDED"]`。
- **裁决**：文档对齐到契约 schema 真实形态；明确说明客户端**必须**按稳定 `reason` 分支处理，**不得**对 `message`（i18n 文案）做字符串匹配。
- **修改文件**：
  - `docs/api/reference.md`：save-answer 段重写，新增四个 `reason` 的语义表与字段说明，明示 strict schema 禁止 legacy `conflict: {...}` 嵌套结构。
- **不新增测试**：契约真实 wire shape 已在三处覆盖：
  - `packages/contracts/src/__tests__/contracts.test.ts:463-561`（含 `rejects conflict field (strict)` 与 `rejects unknown key (strict)`）
  - `packages/exam-engine/src/answerProtocol.test.ts:69-80`（STALE_VERSION 单元）
  - `apps/api/src/routes/attempts.test.ts:562-616`（route 层 STALE_VERSION 端到端）

---

## 2. 归入 Phase 2 Backlog 的项目（不在 Phase 1.7 范围）

### 2.1 INC-03: disrupted 状态前端 restore UI 缺失

- **当前实现真相**：
  - 后端能力**完整**：`apps/api/src/plugins/heartbeat.ts` 已注册到 `apps/api/src/server.ts:14,47`，30 秒周期扫描，60 秒无心跳的 `in_progress` attempt 会被 `markDisrupted` 真实写入 `disrupted` 状态；restore 路由 `apps/api/src/routes/attempts.ts:892-930` 也已存在。
  - 前端能力**未接入**：`apps/web/src/pages/exam/TakeExamPage.tsx:64-96` 在 `status !== in_progress` 时直接跳到 `/result`；`apps/web/src/pages/exam/ResultPage.tsx:175-185` 仅对 `disrupted` 显示静态提示"答题中断，请联系监考或重新进入"，**无 restore 按钮、无候考人自助恢复入口**。
- **裁决**：Phase 1.7 不实现 restore UI。`disrupted` 即使被真实触发，候考人也只能看到提示页，需要监考人介入或重新分配 attempt —— 这与 Phase 1 "无监考面板" 的范围一致。
- **风险**：若生产环境网络抖动频繁，候考人有可能被错误标记为 `disrupted` 且无自助恢复通道。**Phase 2A-J3 / Phase 2A-J4 必须优先实施**，否则不应在大规模真实考场启用。
- **Phase 2 锚点**：
  - `docs/todo.md` Phase 2A — `P2A-J3 Attempt Heartbeat`（含心跳调参 / 超时阈值评估）
  - `docs/todo.md` Phase 2A — `P2A-J4 disrupted 检测与恢复`（含前端 restore 按钮 / 监考介入）

### 2.2 INC-04: Heartbeat 与 deadline 解耦的设计裁决

- **现象**：心跳路由不读 deadline、不强制 deadline 终止 attempt；deadline 仅在 save-answer 路径里被检查（`processSaveAnswer` 收到 `attempt.deadlineAt + fastify.now()`，超时返回 `accepted:false, reason:"DEADLINE_EXCEEDED"`）。Submit 路径**不受 deadline 限制**，已在 `docs/api/reference.md` submit 段文档化。
- **裁决**：保留现状。心跳与 deadline 解耦是有意设计 —— deadline 之后候考人仍允许提交已保存的答案，避免临界时间点丢分。
- **不需 Phase 2 改动**：除非业务方明确要求"deadline 后强制收卷"。

### 2.3 INC-06: Score list 提前开放控制

- **现象**：成绩查询当前对所有已 `graded` 的 attempt 立即可见；没有"统一放榜时间" / "在 N 时刻之前不可见"的开关。
- **裁决**：Phase 1.7 不引入 score release control。需求未定义、未在 SPEC §3 的考试控制矩阵中出现。
- **Phase 2 锚点**：归入未来 Phase 2C 或 Phase 2D 的 admin 控制扩展，待业务方提需求。

### 2.4 INC-07: Admin 手动 open / close exam 按钮

- **现象**：当前 admin UI 仅有 publish 按钮；没有"在已发布状态下手动开启/关闭考试入口"的操作。`Exam.status` 状态机仅 `draft → published → archived`，无 `paused`。
- **裁决**：Phase 1.7 不增加新状态或手动操作按钮。这是 SPEC §3 timing 控制的扩展点（`timed_sync` / `deadline` / `untimed` 模式），归入 Phase 2C。
- **Phase 2 锚点**：
  - `docs/todo.md` Phase 2C — `P2C-J3 timed_sync`
  - `docs/todo.md` Phase 2C — `P2C-J4 deadline`
  - `docs/todo.md` Phase 2C — `P2C-J5 untimed`

---

## 3. Ghost States — 文档化但不修改 enum

### 3.1 当前实现的真实主路径

```
not_started   (无入口)

in_progress  --submit-->  submitted  --finalizeGrading-->  graded
     ^                                                       |
     |                                                       v
   restore                                            (终态，可重考)
     |
   disrupted   <-- 后台扫描器（60 秒 timeout 触发 markDisrupted）
```

### 3.2 AttemptStatusEnum 完整 8 个值的实际触发情况

| status | 后端能否真实触发 | 前端是否处理 | Phase 1.7 处理 |
| --- | --- | --- | --- |
| `not_started` | 否，无入口 | N/A | enum 保留，无写入路径 |
| `queued` | 仅在 `requireQueue` 内存路径中存在；不持久化 | N/A | 保留为占位，不持久化 |
| `in_progress` | 是，`startAttempt` 入口 | 是，TakeExamPage 主路径 | 保留 |
| `disrupted` | 是，heartbeat plugin 60 秒超时触发 | 仅 ResultPage 显示提示，无 restore 按钮 | 见 §2.1 |
| `submitted` | 是，submit 4-phase 改造后存在；幂等 submit 在 grading 失败时停在此状态 | 视作"等待评分"，前端跳 ResultPage | 保留 |
| `grading` | 否，**已被替代**：当前 submit 内联调用 `finalizeGrading`，attempt 直接从 `submitted → graded`，不再经过 `grading` | N/A | enum 保留，但**已无写入路径** —— 废弃但不删除 |
| `graded` | 是，submit 成功后终态 | 是，ResultPage 主路径 | 保留 |
| `voided` | 否，需 admin void，Phase 1 未实现 | N/A | enum 保留，无写入路径 |

### 3.3 SPEC.md 与代码的当前偏差（不修复）

`docs/SPEC.md:111-138` 与 `docs/SPEC.md:407-423` 的状态图仍画 8 状态，包含 `grading`、`voided`、`not_started` 这三个目前**无写入路径**的 ghost state。

- **不在 Phase 1.7 修复**：修改 SPEC 状态图属于规范级变更，需主审模型与人类决策。
- **不修改 enum**：删除 `AttemptStatusEnum` 中的 ghost states 会触发 contracts / db schema / 历史数据迁移连锁改动，超出 Phase 1.7 收口范围。
- **Phase 2 入场前请阅本节**：避免新代码错把 `grading` 当成正常中间状态写入；新功能（admin void / 监考强制结束等）需要触发 `voided` 时，应先评估是否需要修订 SPEC 与状态机命令。

---

## 4. 验证与限制

### 4.1 验收命令

- `pnpm --filter @exam/api test`
- `pnpm --filter @exam/exam-engine test`
- `pnpm --filter @exam/contracts test`
- `pnpm --filter @exam/web test`
- `pnpm verify`

### 4.2 已知限制

- SPEC.md 状态图与代码偏差（§3.3）未修复，留作 Phase 2 规范级裁决。
- `disrupted` 状态在生产真实可触发，但候考人无自助恢复入口（§2.1）—— 大规模启用前必须先实施 P2A-J3 / P2A-J4。
- `grading` enum 值在数据库与 contracts 中保留，但当前 submit 4-phase 改造后**没有写入路径**；如有新代码意图写入，请先阅读 §3。
- 本轮不动 E2E 区域，相关 `tests/e2e/**` 行为由独立 PR 收敛。

---

## 5. SPEC.md follow-up applied

### 5.1 本轮 follow-up 范围

本节是 closeout 第二轮收尾，**只修正规格表达，不改变实现**。所有改动仅落在文档：

- `docs/SPEC.md` §1 不变原则：在保留"答卷可恢复"等长期不变契约前提下，新增"当前实现边界（Phase 1.7）"说明，明确恢复能力当前只覆盖服务端层面，restore UI 属 P2A-J3 / P2A-J4 前置条件。
- `docs/SPEC.md` §2.2 ExamAttempt 状态机：状态表新增"当前实现接线"列，对 `not_started` / `queued` / `in_progress` / `disrupted` / `submitted` / `grading` / `graded` / `voided` 八个状态逐一标注是 _Phase 1.7 已接线_、_保留但当前无写入路径_，还是 _Phase 2 / planned_。
- `docs/SPEC.md` §2.5 计时模式：表格新增"当前接line"列，明确仅 `timed_window` 已接线，`timed_sync` / `deadline` / `untimed` 属 Phase 2。
- `docs/SPEC.md` §2.6 管控表：`requireQueue` / `batchSize` / `batchInterval` 标注 Phase 2 / planned（依赖 `timed_sync`）。
- `docs/SPEC.md` §3.3 Exam State Machine：command function 列表逐项标注当前接线情况；`markDisrupted` / `restoreAttempt` 标后端已接线但前端 UI 未接入；`voidAttempt` / `openExam` / `closeExam` 标 Phase 2 / planned。
- `docs/SPEC.md` §3.5 宕机恢复表：在保留目标合约前提下，明确 disrupted 一旦被触发则前端无自助 restore 入口，需 P2A-J3 / P2A-J4 收口。
- `docs/SPEC.md` §3.8 Audit Log：表格保留作为长期目标覆盖面，新增"当前实现边界"块明确监考类操作（延长考试时间、标记违纪、强制交卷、恢复 disrupted attempt）的审计随 P2A-J4 / Phase 2 监考能力一起落地，禁止据此提前补实现 proctor intervention。
- `docs/SPEC.md` §1 / §2.2 / §3.3 disrupted 表述统一收口径：心跳扫描器在 API 启动时**默认注册并运行**（30s 扫描周期 / 60s 超时，可由 `HEARTBEAT_SCAN_INTERVAL_MS` / `HEARTBEAT_TIMEOUT_MS` 调整），后端能力已接线；但**前端恢复入口与监考裁决仍未产品化**，生产大规模启用前仍依赖 P2A-J3 / P2A-J4。
- `docs/SPEC.md` §4.4 排队分批：整段标 Phase 2 / planned，避免被误读为 Phase 1.7 已实现的子流程。
- `docs/todo.md`：P2A-J3 / P2A-J4 增加生产启用前置条件标题与验收口径锚点。

### 5.2 本轮没有触碰的对象

为防止越界，明确列出：

- **未触碰路由 / schema / 状态机 / 数据库 / 测试代码**：无任何 `*.ts` 实现文件、Drizzle schema、Zod schema、状态机命令或测试被修改。
- **未删除任何 enum 值**：`AttemptStatusEnum` 八个值全部保留，仅在 SPEC.md 中标注接线情况。
- **未实现任何 disrupted restore UI / 监考面板 / Phase 2 功能**：所有 Phase 2 项目仅在文档中被标 _planned_。
- **未修改 SPEC.md 状态机的目标设计**：长期合约保持不变，只是补充"当前实现接线"维度避免读者把目标当现状。

### 5.3 仍未解决的真实风险

- **restore UI 未完成**：disrupted 状态在生产可被触发，但候考人无自助恢复路径。生产大规模启用前必须先完成 P2A-J3 + P2A-J4。
- **proctor intervention 未完成**：`voidAttempt` / 监考强制结束 / 延时等命令仅作为目标设计存在，没有任何 admin / proctor 入口；任何"作弊处理"或"运维介入"流程目前只能依赖 DBA 直连。
- **仓库级 `pnpm verify` 仍可能被其他工作树格式残留阻塞**：本轮（以及前一轮）只保证自身 6+1 个修改文件 prettier 通过；主模型 FIX-1 / FIX-2 / grading 重构在 `apps/web/src/pages/admin/AttemptDetailPage.test.tsx`、`apps/web/src/pages/exam/TakeExamPage.test.tsx`、`apps/web/src/pages/exam/TakeExamPage.tsx`、`packages/exam-engine/src/grading.ts`、`packages/exam-engine/src/gradingRefactor.test.ts` 留下的格式问题不在本轮范围。
- **SPEC.md 状态图本身**：本轮通过新增"当前实现接线"列把语义收窄到诚实表达；但若后续 Phase 2 决定**永久删除** `grading` / `voided` / `not_started` / `queued`，需要主审模型与人类裁决重新修订状态图、enum、contracts、db schema 与历史数据迁移。本轮不做此决策。
