# Exam Phase 3 Plan — S / M / L Job Queue

> Phase 3 目标：从 Phase 2 的“功能闭环”推进到“可授权、可审计、可监考、可评分、可证明提交”的真实考试运行时。

Phase 3 不按模块一次性大改，而按 Job 大小拆分：

* **Small Job**：低风险、文档/审计/清单/窄修，可随时做。
* **Middle Job**：边界清楚、可独立施工、可测试，可合入 master。
* **Large Job**：涉及角色、权限、协议、状态机、UI 体系等核心设计，必须先 grillme 拷问，再拆成 Middle Job 落地。

---

# 1. Phase 3 总任务池

## Small Jobs

Small Job 主要用于铺地基、做审计、写清单、准备后续施工。

| ID  | Job                                   | 目标                                  | 产物                                               |
| --- | ------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| S1  | Phase 3 README scaffold               | 建立 Phase 3 入口                       | `docs/phase3/README.md`                          |
| S2  | Phase 3 plan                          | 建立 S/M/L 计划表                        | `docs/phase3/plan.md`                            |
| S3  | Current role check audit              | 梳理当前后端角色/权限检查位置                     | `docs/phase3/audit-current-role-checks.md`       |
| S4  | Current grading API audit             | 梳理评分详情 API 当前返回内容                   | `docs/phase3/audit-current-grading-api.md`       |
| S5  | Current Redis usage audit             | 梳理 Redis 当前接入点和 fallback 行为         | `docs/phase3/audit-current-redis.md`             |
| S6  | Current audit event map               | 梳理现有 audit event / monitoring event | `docs/phase3/audit-current-events.md`            |
| S7  | Current candidate runtime audit       | 梳理前端考试页面散状态                         | `docs/phase3/audit-current-candidate-runtime.md` |
| S8  | Current answer payload audit          | 梳理当前 answer save / submit payload   | `docs/phase3/audit-current-answer-payload.md`    |
| S9  | E2E parallelization constraints audit | 梳理当前 E2E 不能并行的原因                    | `docs/phase3/audit-e2e-parallelization.md`       |
| S10 | Grillme question list                 | 为 Large Job 准备问题清单                  | `docs/phase3/grillme-question-list.md`           |

---

## Middle Jobs

Middle Job 是 Phase 3 的主要施工单位。它们边界清楚，可以独立分支施工，做完测试后合入 master。

| ID  | Job                                        | 目标                              | 注意                 |
| --- | ------------------------------------------ | ------------------------------- | ------------------ |
| M1  | Manual grading candidate-answer visibility | 评分详情页展示考生答案                     | 不扩大到完整权限模型         |
| M2  | Redis health / fallback / diagnostics      | Redis 联通、健康检查、不可达 fallback      | Redis 不作为权威状态源     |
| M3  | Email outbox skeleton                      | 邮箱 outbox 基础设施                  | migration 单独合      |
| M4  | Audit / monitoring event expansion v0      | 补 Phase 3 第一批事件                 | 不做完整事件治理体系         |
| M5  | Diagnostics infra status                   | 诊断页展示 Redis / worker / email 状态 | 不做复杂监控平台           |
| M6  | Grading answer rendering tests             | 补评分页答案展示测试                      | 不改 answer protocol |
| M7  | Redis unavailable fallback tests           | Redis 不可用时不破坏考试状态               | 以 PG 为权威           |
| M8  | Email send failure retry tests             | 邮件失败可重试，不 rollback 主业务          | outbox 模式          |
| M9  | Proctor incident event logging v0          | 监考异常事件记录第一版                     | 不定义完整 proctor 权限边界 |
| M10 | CI / E2E parallelization readiness report  | 给 E2E 并行化做准备                    | 先报告，后施工            |
| M11 | Phase 3 readiness closeout report          | 汇总已完成的 S/M 任务                   | 进入 Large 前的基线      |

---

## Large Jobs

Large Job 不能直接开写。需要先 grillme 拷问清楚边界，再形成 ADR / matrix / spec / state diagram，最后拆成 Middle Job。

| ID  | Job                                                  | 为什么是 Large                                          | 预期前置产物                    |
| --- | ---------------------------------------------------- | --------------------------------------------------- | ------------------------- |
| L1  | Teacher / Proctor / Grader Account Model             | 需要决定账号、身份、角色、scope 的关系                              | account model ADR         |
| L2  | Backend Permission Model                             | 影响所有敏感 API，不能用简单 role string 糊过去                    | permission matrix         |
| L3  | Custom Role / Custom RBAC                            | 极容易过度设计，需要决定 Phase 3 是否只预留                          | custom role ADR           |
| L4  | Answer Protocol v2                                   | 影响保存、提交、评分、审计、前端状态                                  | answer protocol spec      |
| L5  | WYSIWYG Submit / Final Answer Barrier                | 需要证明学生看到的最终答案等于后端冻结答案                               | final submit barrier ADR  |
| L6  | Frontend Exam State Machine                          | 涉及保存、提交、断线、恢复、deadline、force submit                 | state diagram             |
| L7  | Proctor Runtime Authority Boundary                   | 需要决定监考员能看什么、能操作什么、不能做什么                             | proctor permission matrix |
| L8  | UI Design / Workbench UI Contract                    | 影响整站视觉、组件语义、表格/表单/状态表达                              | UI contract               |
| L9  | Audit / Monitoring Full Event Taxonomy               | 涉及追责、观测、隐私、事件分层                                     | event taxonomy ADR        |
| L10 | E2E Full Parallelization Implementation              | 涉及 DB 隔离、seed 隔离、worker 隔离                          | E2E isolation ADR         |
| L11 | Subjective / Rich Text / Drawing Answer Architecture | 涉及主观题、富文本、画图、附件答案结构                                 | subjective answer ADR     |
| L12 | Tenant / Organization / School Scope Model           | 影响账号、权限、考试归属、数据隔离                                   | tenant scope ADR          |
| L13 | Exam Lifecycle State Model                           | 影响 draft / published / open / closed / archived 等状态 | lifecycle state diagram   |
| L14 | Result Visibility / Release Policy                   | 影响学生何时看成绩、老师何时发布结果、复核流程                             | result release policy ADR |

---

# 2. 推荐执行顺序

## Batch 0 — Phase 3 Ground Setup

目标：先建立 Phase 3 工作台，不改核心代码。

| 顺序 | Job                          | 类型    |
| -- | ---------------------------- | ----- |
| 1  | S1 Phase 3 README scaffold   | Small |
| 2  | S2 Phase 3 plan              | Small |
| 3  | S3 Current role check audit  | Small |
| 4  | S4 Current grading API audit | Small |
| 5  | S5 Current Redis usage audit | Small |
| 6  | S6 Current audit event map   | Small |

完成后，Phase 3 有清楚入口和当前代码基线。

---

## Batch 1 — First Mergeable Middle Jobs

目标：先做确定性高、不会牵扯 Large 设计的功能。

| 顺序 | Job                                           | 类型     | 说明             |
| -- | --------------------------------------------- | ------ | -------------- |
| 1  | M1 Manual grading candidate-answer visibility | Middle | 真实评分缺口，优先修     |
| 2  | M2 Redis health / fallback / diagnostics      | Middle | 打通 Redis 运行态基础 |
| 3  | M4 Audit / monitoring event expansion v0      | Middle | 补第一批事件         |
| 4  | M5 Diagnostics infra status                   | Middle | 诊断页展示基础设施状态    |

---

## Batch 2 — Email / Worker / Outbox

目标：接入邮箱基础设施，但不做复杂模板系统。

| 顺序 | Job                               | 类型     | 说明                 |
| -- | --------------------------------- | ------ | ------------------ |
| 1  | S5 Current Redis usage audit      | Small  | 如已完成可跳过            |
| 2  | M3 Email outbox skeleton          | Middle | migration 单独合      |
| 3  | M8 Email send failure retry tests | Middle | 确认失败不影响主业务         |
| 4  | M5 Diagnostics infra status       | Middle | 展示 email worker 状态 |

---

## Batch 3 — Large Grillme Round 1

目标：先拷问角色和权限，不直接施工。

| 顺序 | Job                                            | 类型    | 输出                       |
| -- | ---------------------------------------------- | ----- | ------------------------ |
| 1  | L1 Teacher / Proctor / Grader Account Model    | Large | account model ADR        |
| 2  | L2 Backend Permission Model                    | Large | permission matrix        |
| 3  | L7 Proctor Runtime Authority Boundary          | Large | proctor authority matrix |
| 4  | L12 Tenant / Organization / School Scope Model | Large | tenant scope ADR         |

完成后，再拆出 Middle Job，例如：

| Derived Middle Job                        | 来源  |
| ----------------------------------------- | --- |
| account table / role assignment migration | L1  |
| permission helper / authorize API         | L2  |
| route-level permission tests              | L2  |
| proctor scope assignment                  | L7  |
| cross-scope denial tests                  | L12 |

---

## Batch 4 — Large Grillme Round 2

目标：拷问答案协议和最终提交屏障。

| 顺序 | Job                                                      | 类型    | 输出                       |
| -- | -------------------------------------------------------- | ----- | ------------------------ |
| 1  | L4 Answer Protocol v2                                    | Large | answer protocol spec     |
| 2  | L5 WYSIWYG Submit / Final Answer Barrier                 | Large | final submit barrier ADR |
| 3  | L11 Subjective / Rich Text / Drawing Answer Architecture | Large | subjective answer spec   |
| 4  | L13 Exam Lifecycle State Model                           | Large | lifecycle state diagram  |

完成后，再拆出 Middle Job，例如：

| Derived Middle Job             | 来源  |
| ------------------------------ | --- |
| AnswerPayloadV2 schema         | L4  |
| answer canonicalization helper | L4  |
| final answer snapshot          | L5  |
| submit hash / audit hash       | L5  |
| rich text answer renderer      | L11 |
| lifecycle status contract      | L13 |

---

## Batch 5 — Large Grillme Round 3

目标：拷问前端状态机和 UI 体系。

| 顺序 | Job                                       | 类型    | 输出                        |
| -- | ----------------------------------------- | ----- | ------------------------- |
| 1  | L6 Frontend Exam State Machine            | Large | state machine diagram     |
| 2  | L8 UI Design / Workbench UI Contract      | Large | UI contract               |
| 3  | L9 Audit / Monitoring Full Event Taxonomy | Large | event taxonomy ADR        |
| 4  | L14 Result Visibility / Release Policy    | Large | result release policy ADR |

完成后，再拆出 Middle Job，例如：

| Derived Middle Job                    | 来源  |
| ------------------------------------- | --- |
| candidate runtime state machine core  | L6  |
| save / submit / deadline state tests  | L6  |
| disconnected / restoring UI states    | L6  |
| UI tokens / status badge contract     | L8  |
| table / form / action layout contract | L8  |
| audit event schema expansion          | L9  |
| result release API policy             | L14 |

---

# 3. 推荐日程

## Cycle 1

| 窗口         | 做什么                                           |
| ---------- | --------------------------------------------- |
| 第一个 2 小时窗口 | Batch 0：S1 / S2 / S4                          |
| 第二个 5 小时窗口 | M1：manual grading candidate-answer visibility |

---

## Cycle 2

| 窗口         | 做什么                                      |
| ---------- | ---------------------------------------- |
| 第一个 2 小时窗口 | S5 / S6：Redis + event 当前审计               |
| 第二个 5 小时窗口 | M2：Redis health / fallback / diagnostics |

---

## Cycle 3

| 窗口         | 做什么                                      |
| ---------- | ---------------------------------------- |
| 第一个 2 小时窗口 | M4 prompt / event map review             |
| 第二个 5 小时窗口 | M4：audit / monitoring event expansion v0 |

---

## Cycle 4

| 窗口         | 做什么                      |
| ---------- | ------------------------ |
| 第一个 2 小时窗口 | Email/outbox 当前状态审计      |
| 第二个 5 小时窗口 | M3：Email outbox skeleton |

---

## Cycle 5

| 窗口         | 做什么                      |
| ---------- | ------------------------ |
| 第一个 2 小时窗口 | L1 / L2 grillme 问题准备     |
| 第二个 5 小时窗口 | L1：account model grillme |

---

## Cycle 6

| 窗口         | 做什么                                 |
| ---------- | ----------------------------------- |
| 第一个 2 小时窗口 | L2 permission matrix draft          |
| 第二个 5 小时窗口 | L2：backend permission model grillme |

---

## Cycle 7

| 窗口         | 做什么                           |
| ---------- | ----------------------------- |
| 第一个 2 小时窗口 | L4 answer protocol 问题准备       |
| 第二个 5 小时窗口 | L4：answer protocol v2 grillme |

---

## Cycle 8

| 窗口         | 做什么                                              |
| ---------- | ------------------------------------------------ |
| 第一个 2 小时窗口 | L5 final barrier 问题准备                            |
| 第二个 5 小时窗口 | L5：WYSIWYG submit / final answer barrier grillme |

---

# 4. Phase 3 第一优先级

建议第一阶段先做这三个：

| 优先级 | Job                                           | 原因              |
| --- | --------------------------------------------- | --------------- |
| 1   | M1 manual grading candidate-answer visibility | 真实功能缺口，确定性最高    |
| 2   | M2 Redis health / fallback / diagnostics      | Phase 3 后续运行态依赖 |
| 3   | M4 audit / monitoring event expansion v0      | 先补证据链，不做大平台     |

然后再做：

| 优先级 | Job                                 | 原因            |
| --- | ----------------------------------- | ------------- |
| 4   | M3 Email outbox skeleton            | 标准基础设施，适合独立合  |
| 5   | L1 account model grillme            | 权限模型前置        |
| 6   | L2 backend permission model grillme | Phase 3 核心地基  |
| 7   | L4 answer protocol v2 grillme       | 提交、评分、状态机前置   |
| 8   | L5 WYSIWYG submit barrier grillme   | 最终答案证明核心      |
| 9   | L6 frontend state machine grillme   | 依赖协议和提交屏障     |
| 10  | L8 UI design grillme                | 统一考试端和后台工作台体验 |

---

# 5. 当前 Large Job 补充清单

用户已明确 Large：

* 后端权限模型
* 前端状态机
* 提交答案的所见即所得问题
* UI 设计

建议补充为完整 Large 队列：

| Large Job                                            | 是否必须      |
| ---------------------------------------------------- | --------- |
| Teacher / Proctor / Grader Account Model             | 必须        |
| Backend Permission Model                             | 必须        |
| Custom Role / Custom RBAC                            | 可预留，不急着实现 |
| Answer Protocol v2                                   | 必须        |
| WYSIWYG Submit / Final Answer Barrier                | 必须        |
| Frontend Exam State Machine                          | 必须        |
| Proctor Runtime Authority Boundary                   | 必须        |
| UI Design / Workbench UI Contract                    | 必须        |
| Audit / Monitoring Full Event Taxonomy               | 建议        |
| E2E Full Parallelization Implementation              | 建议        |
| Subjective / Rich Text / Drawing Answer Architecture | 建议        |
| Tenant / Organization / School Scope Model           | 建议        |
| Exam Lifecycle State Model                           | 建议        |
| Result Visibility / Release Policy                   | 建议        |

---

# 6. 当前结论

Phase 3 先按这个顺序推进：

```txt
Small 文档 / 审计铺地基
  ↓
Middle 确定性功能持续合 master
  ↓
Large 只做 grillme / ADR / matrix
  ↓
Large 拆成 Middle 后再施工
```

近期不碰大重构。

第一批直接做：

```txt
S1 Phase 3 README scaffold
S2 Phase 3 plan
S4 current grading API audit
M1 manual grading candidate-answer visibility
```

然后接：

```txt
S5 current Redis usage audit
S6 current audit event map
M2 Redis health / fallback / diagnostics
M4 audit / monitoring event expansion v0
```
