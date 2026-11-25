# ADR-030 — Candidate Identity, Admission Binding and Answer-Lease Device Takeover

## Status

**PROPOSED (2026-11-23).** 本 ADR 为评审草案，尚不具约束力。在 Owner 显式采纳
（转 ACCEPTED）之前：

- 不得据此实现任何数据模型、Schema 变更、名册、准考凭证、作答租约或换机功能；
- 不得将本文件中的任何"获准后义务"引用为已支持能力（EXSEM-019 纪律）；
- 各待裁决项（§Open questions）须由 Owner 逐项裁决；裁决结果以 ACCEPTED 修订
  形式落回本文件后才成为权威。

2026-11-24 增量修订（均为 as-built 精确化与裁决面扩展，不改变任何决定方向，
状态保持 PROPOSED）：as-built 第 9 条按代码实查补全考生侧归属核对点全景
（save / take / heartbeat 三处事务内核对；start 引擎入口 candidateId 绑定；
restore 独立双路径——路由事务外投影读 + 事务内恢复命令，签名无 candidateId）；
D8 受保护入口表补 `client-events` advisory 行（归属链核验主体为 user）并新增
待裁决项 Q11；D6 读面清单补管理端候选搜索的 `users` EXISTS 第 6 处耦合，并将
"实现时全库重扫"义务化。同日评审退修：初版修订误将 restore 写为
`startOrRestoreAttempt` 同一入口，已按实查改为双路径事实（grep 全库证实该
命令唯一生产调用点为 start 路由 `attempts.candidate.ts:709`；restore 路由
`attempts.candidate.ts:1373` 直调 `restoreInterruptedAttempt`）。

## Metadata

| Field | Value |
| --- | --- |
| Date | 2026-11-23（proposed；2026-11-24 增量修订见 Status） |
| Decision owners | jnhu76 |
| Tracking | [#645](https://github.com/jnhu76/exam/issues/645)（产品问题）、[#678](https://github.com/jnhu76/exam/issues/678)（能力组合载体。本草案引用的设计素材原文出自其正文折叠的**工程演进基线 r3**（2026-11-20）§7.1/§7.2/§8；r4（2026-11-23）将该基线保留为历史依据，其现行验收口径是正文无编号的"#645 身份与换机"段，两者语义一致。下文引作"#678 r3 基线 §x.y"） |
| Related | #587（账号登录 Argon2 包络，正交）、#316（受控/严格入场的二次身份核验，`related`，不吸收其 scope） |

## Relationships

按 [`docs/adr/README.md`](README.md) 关系词表显式声明：

- **depends on [ADR-010](ADR-010-scoped-rbac-architecture.md)** — 能力 × 资源
  关系的授权权威不变。本 ADR 不新增授权系统，不把名册凭证或租约变成影子
  RBAC；租约是**作答会话持有证明**，不是权限来源。
- **depends on [ADR-012](ADR-012-candidate-recovery-contract.md)** — 其并发
  客户端语义的冻结规则（"Device takeover must invalidate or supersede the
  previous active writer"、"High-risk supervised device takeover may require
  operator approval"）是本 ADR 作答租约与授权换机协议的上游决策；本 ADR 将其
  具体化为可实现的租约对象、交接事务与受保护入口清单。
- **specializes [ADR-021](ADR-021-exam-semantic-authority-adoption.md)**（即
  EXSEM 语料）— 本 ADR **依赖并细化 EXSEM-015**：`(organizationId,
  candidateId)` 仍是 attempt 的稳定历史归属权威（见 D1）。本 ADR 不 supersede
  任何 EXSEM 条款；`REPORTING_IDENTITY_POLICY` 与
  `AUDIT_GRADE_IDENTITY_POLICY` 保持原语义。若 Owner 未来改选路径②（见 Q1），
  必须按 [`exam-semantic-boundaries.md`](../architecture/exam-semantic-boundaries.md)
  §6 的五步程序走显式 superseding decision，不得以本 ADR 的修订悄悄替代。
- **related [ADR-022](ADR-022-product-capability-composition.md)** — 入场机制
  与 Deployment Product Profile 是正交轴：任何获准的入场机制都不得被固定为
  Minimal/Standard 的判别条件。

## Context

### 产品问题（#645）

当前考生流是账号中心的：认证账号 → Candidate 档案 → enrollment → attempt。
真实部署还需要名册入场（考场/机房，考生已知但未必有账号）、临时参与与外部
系统联邦启动。#645 要求统一入场模型服务**同一条作答路径**，且明确禁止：

- 伪造成长期 `users` 行来冒充无账号考生；
- `candidateId = NULL` 扩散出的隐藏双语义；
- 用 `PERMANENT / ROSTER / EPHEMERAL` 之类单一枚举同时控制档案生命周期、考试
  报名与本次身份证明来源三件事；
- 学号/座位/URL 参数被当作秘密或持有证明。

#678 的工程演进基线（r3 §7.1/§7.2，被 r4 保留为历史依据；r4 现行"#645 身份与
换机"段同义保留）进一步把"身份归属路径选择"与"换机的提交顺序"定为本 ADR
必须裁决的两大决策面，并给出了建议默认值。本 ADR 将其成文化为可评审的决策
与待裁决项。

### As-built 硬约束（裁决输入；全部经当前 master 侧工作树代码核实）

以下事实构成本 ADR 的起点，任何裁决都必须解释如何对待它们：

1. **档案与账号强耦合。** `candidate_profiles.user_id` 为
   `NOT NULL REFERENCES users(id)`，并有 `(organization_id, user_id)` 唯一索引
   （`packages/db/src/schema/pg.ts`，`candidateProfiles` 表定义）。管理端
   `POST /candidates` 在同一事务内创建 User 行与档案行（`apps/api/src/routes/candidate.ts`
   的路由文档注释与其事务实现）。**当前不存在没有账号的档案。**
2. **成绩导出经账号二次内联。** `listGradedByExam` 以
   `examAttempts → candidateProfiles → users` 双 `innerJoin` 组装考生展示字段
   （`packages/db/src/repository/attemptRepo.ts`）。**无账号考生会在导出结果中
   结构性缺席**，即使其 attempt、评分与终态投影完整存在。
3. **审计 actor 无 FK，命令回执 actor 有复合 FK。** `audit_logs.actor_id` 是
   **无外键的非空 `text`**（表约束仅一个索引）。`attempt_command_receipts.actor_id`
   虽也是非空 `text`，但受**复合外键 `(organization_id, actor_id) →
   users(organization_id, id)`** 的数据库强制（`attempt_command_receipts_actor_fk`，
   已落迁移 `0028_attempt_command_receipts.sql`），且该表 `command_type` 被
   CHECK 限定为 `('force_submit', 'misconduct_mark')`——它今天是**工作人员
   命令**的回执表，身份图（跨机构 actor 不可入账）由 DB 强制。带可空
   `REFERENCES users(id)` 的 actor 仅存在于 `attempt_time_adjustments` 与
   `attempt_interruption_events`（记录工作人员动作）。因此"非 users 的审计
   主体"在 `audit_logs` **零迁移即可表示**；命令回执侧若要承载考生主体，必须
   放宽/改造该复合 FK 或另建结构化存储——且考生侧命令今天并不落此表——这是
   须呈报 Owner 的显式取舍（见 D4、Q3），不是零迁移。
4. **附件无服务端通道。** 题目附件是自由 URL（`packages/domain/src/types.ts`
   的 `Attachment { url, type, name }`），在考生快照响应中原样透传
   （`apps/api/src/routes/attempts.shared.ts`），由浏览器直读。API 路由层无
   任何上传/下载/代理附件端点。**换机后无法在服务端收回已展示或已直读的附件**；
   是否补建受保护通道是 scope 决策（Q4），本 ADR 不预判。
5. **账号会话无考试连续性特化。** 登录签发 HS256 JWT、固定 24h 有效期，载荷
   含 `authEpoch` 吊销代际（`packages/auth/src/session.ts`）；无滑动刷新。
   #645 的"自然到期 vs 显式吊销"区分今天靠 24h 窗口覆盖大部分考试时长。
6. **单次身份令牌已有范式。** 员工邀请与邮件重置令牌：256-bit CSPRNG、仅存
   SHA-256 摘要、单语句 CAS 消费（`packages/auth/src/tokens.ts`），且其注释
   已论证高熵令牌用 SHA-256 而非 Argon2 是正确的。**这是准考凭证的现成机制
   范式**，但当前不存在任何考试凭证实体。
7. **准入事实已有载体。** `exam_admissions` 承载"该考生是否被允许 START"
   （唯一活跃成员 partial unique index；`docs/architecture/exam-runtime.md`
   §3.1.1，#292）。准入只管 START，不管重入。名册凭证必须与它收敛，不得成为
   第二套准入权威。
8. **合成审计主体已有先例。** 后台扫描器使用闭集合成 id（`system:deadline-scanner`
   等）+ 专用 Role + 编译期/运行期越界即抛（`packages/authz/src/systemActor.ts`）。
   这是"非 users 审计主体"的仓库内既有模式。
9. **考生入口的归属核对点已定位。** 事务内核对有三处：save 在锁后核对
   `currentAttempt.candidateId !== candidateProfile.id`（`apps/api/src/routes/attempts.candidate.ts`
   的 save 路由）；take 快照在同一事务内 `ensureAttemptDeadlineReconciled`
   截止对账之后核对 `reconciled.candidateId`（同文件 take 路由）；heartbeat
   先经 `getOwnedAttempt` 归属投影读、再以状态条件写
   `refreshLastActivityIfInProgress` 落笔（同文件）。start 入口由引擎命令
   `startOrRestoreAttempt`（`packages/exam-engine/src/attemptCommands.ts`，
   唯一生产调用点为 start 路由）以 candidateId 参数在同一事务内绑定归属，
   其 disrupted 分支转入恢复命令。恢复入口是独立路径：`POST
   /attempts/:attemptId/restore` 在**事务外**经 `getOwnedAttempt`
   （`findByIdAndCandidate`）做归属投影读，事务内 `lockEnrollmentAndAttempt`
   取得锁定 capability 后调 `restoreInterruptedAttempt`
   （`packages/exam-engine/src/restoreInterruption.ts`，签名无 candidateId，
   归属经 capability 传递）。恢复因此有两条调用路径（restore 直连与 start 的
   disrupted 分支），未来加入"作答代际"条件时两条路径的落点都必须覆盖。

### 为什么现在决策

#645 的 21 条验收全部未勾选，其第 21 条明确要求：**设计经独立语义/安全评审前
不得实现**。#678 r3 基线 §7.1 建议优先评审路径①，r4 现行"#645 身份与换机"段
同义保留（"先评审身份 ADR：优先考虑稳定 `(organizationId, candidateId)`"）。
本 ADR 把路径①成文为 PROPOSED
决策，供 Owner 评审；同时保留路径②为显式 fallback 及其 supersession 程序。

## Decision（全部 PROPOSED，未生效）

### D1 — 稳定作答归属保持 `(organizationId, candidateId)`（路径①）

`candidateId` 继续作为 attempt 的稳定历史主体（EXSEM-015、
`CANDIDATE_IDENTITY_AUTHORITY = STABLE_ORGANIZATION_SCOPED_CANDIDATE_ID` 不变）。
本 ADR 对 EXSEM-015 的唯一细化是：

> **candidateId 的授予不再以先存在 `users` 行为前提。** 名册核验可以在不存在
> （或不使用）长期账号的情况下创建考生档案；"档案必有账号"从产品不变量降级
> 为一种可选绑定状态（D2）。

由此：

- attempt、答案、评分、回执的归属字段全部不变；
- 已有账号考生的历史数据零迁移；
- "临时身份不得污染机构级档案"通过档案创建的授权边界保证：无账号档案只能由
  获授权的名册/考务入口创建，且其字段语义与账号档案一致（同一
  `candidate_profiles` 行类型，不建第二套"考生"表）。

**不采纳**在本 ADR 中引入考试范围持久参与者并把 candidateId 降为映射（路径②）。
路径②保留为 fallback：若产品要求临时记录完全独立于机构档案（#678 r3 基线 §7.1 的
触发条件），则按 EXSEM §6 程序走显式 superseding decision（Q1）。

### D2 — 账号关联改为可选绑定，绑定单调

目标形状（获准后实现）：

```text
档案绑定状态：UNBOUND ──bind(proof)──▶ BOUND(account)   （单调，普通路径单向）
特权更正：BOUND(A) → BOUND(B) 仅经显式授权命令 + 审计证据
认领（claim）已有档案：必须先通过归属验证，成功后也是一次 bind 事件
```

- 绑定是**显式状态转换**，不是隐式登录副作用；每次 bind/unbind/更正都是可审计
  事件（操作者、依据、前后指向）。
- 普通考生路径禁止 `BOUND(A) → BOUND(B)`；两个历史档案的归并走明确的归并决策
  （保留原记录 + 授权人员裁决），不做自动合并。
- 绑定不重写历史归属：`BOUND(A)` 期间产生的 attempt 永久归属该 candidateId，
  账号变化不追溯（D5）。
- **获准后的实现义务（数据模型决策见 Q5）**：解除
  `candidate_profiles.user_id NOT NULL`（或将绑定移入独立表），并核对所有默认
  "档案必有账号"的调用者——已知的结构性调用点是第 2 条 as-built 硬约束
  （成绩导出、阅卷队列与监考面板共 5 处经 `candidateProfiles.userId → users`
  的 innerJoin，清单见 D6 的义务化）与管理端列表组装（含管理端候选搜索对
  `users` 的 EXISTS 过滤，同见 D6）。

在获准前，现有 `POST /candidates` 行为不变。

### D3 — 名册入场与单场准考凭证

名册入场是第二条入场机制（首个新能力切片：一场考试、一个考点、一个名册）。
它表示"某次考试接受了谁参加"；学号、座位等可预测值只用于**定位**名册记录，
不是秘密，也不是持有证明（#645：identity ≠ proof）。

**单场准考凭证（admission credential）**是名册场景的持有证明，约束：

```text
凭证范围 = organization + exam + 名册记录（enrollment/admission）+ 操作范围
开始后再绑定具体 attempt
不授予跨考试历史读取权（同一考生的其他考试、同场他人、其他机构数据不可达）
```

- **机制范式（推荐，见 Q2）**：高熵随机码 + SHA-256 摘要存储 + 单语句 CAS
  消费（复用 `packages/auth/src/tokens.ts` 范式）。**不使用 Argon2**：凭证是
  高熵能力令牌，不是低熵口令；#587 的口令包络不适用于此路径。
- **生命周期**：机构/考务核验后发放 → 首次兑换签发作答租约（D8）→ 已消费的
  凭证不兑换成绩、不签发第二份活跃租约 → 撤销（考务显式吊销）后下一个受保护
  操作被拒，扫码重放无法重建已撤销授权。
- **与 `exam_admissions` 的关系**：凭证兑换最终收敛到同一 start/attempt 命令
  与准入事实；凭证是名册场景下的发放/持有/撤销账本，不建立第二套准入权威。
- 学号重号、复用、已有档案冲突由获授权人员处理；认领已有档案走 D2 的归属验证。

### D4 — 无账号考生的审计主体

考生侧命令回执与审计必须能把"经名册核验的考生"表示为一等主体，且：

- **禁止伪造成工作人员**（不写 `users.role` 行、不借用任何 staff actor id）——
  #678 r3 基线 §8 明令；
- **禁止把 candidateId 写入 `users` 外键**；
- 系统动作（截止收卷等）继续走 `systemActor` 闭集。

表示机制（推荐，见 Q3）：在 `audit_logs.actor_id`——无 FK 的非空 `text`
（as-built 第 3 条）——使用**闭集前缀约定**，如 `candidate:<candidateId>`
（与 `system:<scanner>` 同构）；该字段零迁移即可承载。命令回执表
`attempt_command_receipts` 则不同：其 actor 受复合 FK `(organization_id,
actor_id) → users` 的 DB 强制、`command_type` 被 CHECK 限定为工作人员命令
（`force_submit`/`misconduct_mark`），考生侧命令今天并不落此表。若获准后需要
考生侧命令回执的主体归属，须在"放宽/改造该复合 FK"与"另建结构化存储/列"之间
做显式取舍（Q3）；不得把 `candidate:<id>` 静默写入现有复合 FK 列——INSERT 会被
数据库拒绝。
时间调整与中断事件的 `actorId`（可空 FK users）语义不变——它们仍只记录工作
人员动作。本条款**不引入**"审计级历史身份重放"能力；`AUDIT_GRADE_IDENTITY_POLICY
= NOT_CURRENTLY_SUPPORTED` 保持不变（D5）。

### D5 — 历史归属与不可变身份证据

- **归属永不重写**：绑定、认领、特权更正、归并都不修改既有 attempt 的
  `candidateId` 或任何已冻结事实。
- **不可变身份证据（最小充分集，推荐，见 Q6）**：
  1. 名册行在入场时登记的标识字段（机构确认的参与者记录）；
  2. 凭证发放、兑换、撤销与换机交接的审计记录（append-only）；
  3. 绑定/认领/更正事件账本（操作者、依据、前后指向）。
- 普通展示与报表仍读**当前**身份资料与字段定义（EXSEM-015 后半句、
  `REPORTING_IDENTITY_POLICY` 不变）；"重现考试当时姓名/字段定义"的审计级
  重放仍是独立的未来能力，需要时另走显式决策。

### D6 — 结果交付默认值

首个切片的默认交付路径（#678 r3 基线 §7.1 建议值的成文化；r4 现行段同义保留
"首个无账号考生须有获授权的结果交付路径"）：

```text
交卷 → 本次交卷确认（所有考生，含无账号）
成绩定稿 → 发布门（EXSEM-018 权威不变）
无账号考生 → 由获授权机构人员经现有成绩导出流程线下交付
```

- **获准后的实现义务**：成绩导出与阅卷工作面必须包含无账号考生。已知的结构性
  障碍是经 `candidateProfiles.userId → users` 的 innerJoin——全库考生路径
  （排除测试）共 5 处：`attemptRepo.ts` 两处（`listGradedByExam` 成绩列表与
  `listByExam` 监考面板全状态列表）、`attemptGradingEntryRepo.ts` 两处
  （`listPendingManualQueue` 阅卷待办队列与 `countPendingManualQueue` 队列
  计数）、`gradingQueueRepo.ts` 一处（`findCandidateWithUser` 档案+用户解析）。
  另有第 6 处不同性质的耦合：管理端候选搜索以 EXISTS 子查询按
  `users.name`/`users.username` 过滤（`candidateRepo.ts` 的分页列表），无账号
  考生在该搜索面结构性不可见。上述清单是起草时点快照；实现时必须以全库重扫
  （`innerJoin(users`、对 `users` 的 EXISTS 子查询等耦合模式）代替硬编码
  清单逐点核对。无账号考生在这些读面同样结构性缺席；改造时不得弱化机构隔离
  与发布可见性语义。
- 已消费的准考凭证不兑换成绩；自助查分默认**不开放**（若开放，另行核验并签发
  只读结果凭证，独立定义有效期与撤销——见 Q8）。
- 已有账号考生的查分遵循原有权限与可见性。

### D7 — 迁移顺序与两段回退

迁移顺序（每步独立可验证，获准后按切片实施）：

```text
1. 收敛现有账号路径的主体解析与资源授权（不新增表）
2. 补可选绑定表示，核对现有一对一假设的调用者
3. 切换读取（导出等调用点支持无账号档案）
4. 最后才开放创建无账号档案与名册凭证发放
```

**两段回退门槛（每段都可独立退回而不破坏已提交事实）：**

- **R1（无账号数据出现前）**：新表示只有读侧扩展时，可整体恢复旧读取路径；
  此时不存在需要保留的新事实。
- **R2（首位无账号考生出现后）**：可以关闭新的无账号入场与凭证发放入口，但
  **必须保留**已开考人员的恢复（restore）、阅卷与查分/交付路径——关闭入口不
  是撤销已接受的履约义务（与 ADR-022 D5 的 downgrade 原则同构）。

回退不要求删除已提交事实（不可变），只关闭新写入入口。

### D8 — 作答租约（answer lease）与授权换机

对要求单端作答的考试，以**作答租约**同时控制作答期的读取与写入。租约是
attempt 上的**作答会话持有证明**，与账号层 `authEpoch`（其吊销范围是用户凭据）
正交；作答写入代际按 attempt 管理。

**租约语义：**

```text
签发：首次入场（账号路径或凭证兑换）至多产生一个活跃租约（首并发兑换亦然）
持有：服务端以请求携带的有效租约识别作答会话
持有当前租约时：刷新、重连、扫码重试沿用原授权
拿不出当前租约时（清 Cookie、换浏览器、换机）：即使坐在原机位，
  也须经考务重新核验与授权交接
设备指纹、IP、扫码动作均不能证明持有原租约
静态准考码在有活跃租约时不得兑换出第二份活跃租约
```

**授权换机（authorized takeover）事务：**

```text
换机命令携带唯一操作标识（operationId 幂等；同一操作重复送达只产生一次交接）
事务内核对：资格 + attempt 当前状态 + 预期旧代际
提交时：推进作答代际 + 记录交接（操作人、受影响考生、授权依据）
两个针对同一旧代际的不同换机指令至多一个生效（其余进入冲突分支）
```

**失效边界 = 交接事务提交时刻。** 此后，该 attempt 的所有受保护入口都必须
校验当前租约：

| 受保护入口 | 现有落点 |
| --- | --- |
| 题面 / 状态 / 剩余时间读取（`GET /attempts/:id` 等） | 归属核对处 |
| take 快照（`GET /candidate/attempts/:attemptId/take`） | 截止对账同一入口 |
| 保存 | 锁内主体核对处（`attempts.candidate.ts` 已定位）加代际条件 |
| 心跳 | 状态条件写处（同文件已定位）加代际条件 |
| 恢复（restore） | 两条调用路径均须校验：`POST /attempts/:attemptId/restore`（事务外 `getOwnedAttempt` 投影读 + 事务内 `restoreInterruptedAttempt`，锁 enrollment → attempt）与 start 路由 `startOrRestoreAttempt` 的 disrupted 分支（转入同一恢复命令） |
| 提交 | `submitAttempt`/`submitAndGradeAttempt` 锁内复核 |
| 附件读取 | 当前无服务端通道；若建通道必须经租约校验（Q4） |
| 客户端遥测（`POST /client-events`） | advisory 写入口：attempt 归属链按 owner user 与当前登录 user 比对（`clientEventReferenceNormalizer.ts` 的 `ownerUserId === actorId`；当前 user↔profile 一对一下与 candidate 核验等价），事件本身非权威（`clientEvents.ts` 契约注释）；换机后是否加代际条件见 Q11 |

**分支语义：**

- 可验证为**该作答的旧租约** → 统一进入撤销分支（线协议状态码见 Q7；
  `409 LEASE_REVOKED` 为候选），前端得到专用冲突响应后停止该卷的写入与重试，
  提示"本次作答已在另一设备继续"，忽略晚到的旧响应；
- 未知凭证或越权资源 → 继续走现有认证、授权与资源隐藏规则（不泄露存在性）；
- 服务端截止收卷以**系统身份**按领域规则执行，不受考生租约影响。

**交错语义：**

- 旧端先提交成功 → 新端读取已交卷状态（幂等已交卷路径不变）；
- 换机先提交（代际已推进）→ 旧端的后续写入失效；
- 服务端已确认的旧答案可恢复；旧端尚未获得服务器确认的草稿只能提示"未获确认"；
- **同代际内**，EXSEM-007 的版本、幂等与冲突协议及不可变命令回执完全保留——
  租约不改变保存协议语义，只在写入并发边界多核验一个"当前代际"条件。

**手动提交 × 换机 × 截止收卷**：全部在既有事务与并发协议内对账（EXSEM-013/014
纪律），恰有一个冻结答案集与一份评分工作集；租约不引入新的计时真相
（EXSEM-011/012 不变）。

**与 ADR-012 的关系**：本条款将其"Device takeover must invalidate or supersede
the previous active writer / High-risk supervised device takeover may require
operator approval"具体化为上述事务与入口清单；换机的遥测沿用其
`device_takeover_requested/succeeded/failed` 事件词汇与字段白名单。

## Independent boundaries（本 ADR 不吸收、不授权）

以下议题各有自己的权威入口，本 ADR 的采纳不预设其结论：

1. **答案保存协议自身的锁/并发优化（"保存去锁"，#678 r4 现行段列为
   "autosave 去锁另列性能候选"）。** 本 ADR 只在写入并发边界
   追加代际条件；EXSEM-007/008 的版本、幂等、冲突检测与交卷锁序
   （enrollment → attempt）原样保留。任何保存路径的锁结构调整由其独立议题
   决策，不得借本 ADR 落地。
2. **公开临时身份（#645 Mode C，provisional）。** 留待定义考试范围、保留期限、
   导出与查分规则后再裁（#678 r3 基线 §7.1）。本 ADR 的名册条款**不**预置公开链接
   入场；若未来要求临时记录完全独立于机构档案，触发 Q1 的路径②复审。
3. **外部联邦启动（#645 Mode D）。** LaunchGrant、`(issuer, subject)` 绑定、
   JIT enrollment 与结果回传是独立设计与评审单元；本 ADR 不定义其 wire 格式，
   也不让名册凭证充当联邦令牌。
4. **二次身份核验（#316）。** Controlled/Strict 入场的显式核验步骤与本 ADR 的
   凭证/租约正交；`related` 关系不吸收其 scope（#316 non-goals 明确
   "No device/session binding"）。
5. **#587 账号登录包络。** Argon2 口令验证的成本与运行包络不因名册/租约路径
   改变；反之，高熵凭证也不得被口令硬化语义拖累。

## Open questions（待 Owner 裁决；每项含选项与推荐）

| # | 待裁决项 | 选项 | 推荐 |
| --- | --- | --- | --- |
| Q1 | 归属路径确认 | ① 保留 `(organizationId, candidateId)` + 账号改可选绑定（本 ADR 主路径）；② 引入考试范围持久参与者，candidateId 降为映射，分阶段迁移 | **①**。对 EXSEM-015 仅依赖+细化，历史数据零迁移；②须按 EXSEM §6 显式 superseding，且"迁移中只有一个权威、旧记录可读"的证明成本高。触发②的条件：产品要求临时记录完全独立于机构档案 |
| Q2 | 准考凭证载体 | a. 高熵随机码 + SHA-256 + CAS（tokens.ts 范式）；b. HMAC 结构化码（可离线校验但引入密钥分发）；c. 无码、纯考务人工核验 | **a**，首个切片单机制；与 #645 "高熵令牌用 fast hash/HMAC 而非口令硬化"一致，且复用已验证范式 |
| Q3 | 无账号审计主体表示 | a. `audit_logs.actor_id` 用闭集前缀约定 `candidate:<candidateId>`（该字段无 FK，零迁移）；命令回执保持 staff-only 语义；b. 考生侧命令归属出现需求时，为回执另建结构化存储/列；c. 放宽/改造回执复合 FK（`attempt_command_receipts_actor_fk`）；d. 仅写 metadata JSON | **a** 起步，需要时 **b**；**c** 仅在证明需要 DB 级一致性/检索时评估——放宽会拆掉迁移 0028 落地的"跨机构 actor 不可入账"身份图强制，属须呈报 Owner 的显式取舍；d 不利于检索与约束，不推荐 |
| Q4 | 附件受保护通道 | a. 服务端代理通道，经租约校验后回源/回存储；b. 短时效签名 URL，换机提交时失效；c. 维持自由 URL 直读（Owner 接受正式机考验收缺口） | **a**（与租约同一校验点，失效语义最干净）；b 需要额外签名基础设施；c 与 #678 r3 基线 §7.2 "附件等直读通道若允许旧授权继续下载，则正式机考的验收尚未完成"相抵触（r4 现行段同义要求"交接提交后旧端的新请求覆盖题面、附件、详情/状态、恢复、保存、心跳、提交"），仅可作为非正式考试场景的显式接受 |
| Q5 | 账号绑定表示与认领验证 | a. `candidate_profiles.user_id` 改可空（保留一对一唯一索引）；b. 独立绑定表（保留绑定历史/归并证据）；认领验证：授权人员核验 vs 自动化（已有联系方式验证码） | **a** 为最小迁移 + 认领先走获授权人员核验，自动化认领在 a 落地后按需追加；b 保留为需要绑定历史审计时的演进方向 |
| Q6 | 身份证据粒度（D5 最小集确认） | D5 列出的三件套（名册登记字段 / 凭证与交接审计 / 绑定事件账本）vs 更强的考试当时档案字段冻结 | **三件套**。普通报表仍按 EXSEM-015 读 live；字段冻结等于引入审计级身份重放，须翻转 `AUDIT_GRADE_IDENTITY_POLICY`，成本另评 |
| Q7 | 租约失效线协议 | a. `409` + 语义码 `LEASE_REVOKED`（#678 r3 基线 §7.2 候选；r4 现行段未定状态码）；b. `403`；c. `404` 折叠进资源隐藏 | **a**：显式冲突语义驱动前端"停止写入与重试"的专用分支；b 混淆权限语义；c 无法区分"未持有"与"已失效"，前端无法给出正确提示 |
| Q8 | 无账号考生自助查分 | a. 默认不开放，仅授权人员导出交付；b. 开放只读结果凭证（独立有效期/撤销） | **a**（首个切片）；b 另立设计评审后再裁 |
| Q9 | 回退门槛确认 | D7 两段（R1 旧读取可恢复；R2 关新入场但保留恢复/阅卷/查分）vs 单段（整体开关） | **两段**：R2 是履约义务边界，单段会把"已开考人员"误伤为可丢弃状态 |
| Q10 | 名册登记字段是否入场冻结 | a. 冻结登记快照（作为准入事实的一部分）；b. 只存引用、读时取 live 档案 | **a**：名册行是机构在入场时刻确认的事实，冻结才可解释"当时是谁在考"；live 投影语义（EXSEM-015 普通报表）不变 |
| Q11 | 换机后旧端 `client-events` 遥测写入 | a. 加代际条件：交接提交后旧端遥测随其他入口一并失效（该入口归属核验主体是 user——`ownerUserId === actorId`——D2 解绑后不随 candidate 绑定状态变化，代际条件落点同以 user 会话为载体）；b. 保持 advisory 无条件接受，旧端换机后产生的遥测作为其继续操作的取证证据留存 | **b**：该入口契约是 advisory 非权威（事件从不单独构成处罚/状态/截止依据），拒绝写入会改动"接受无条件"契约；交接后旧端的遥测恰是旧端仍存活、仍在操作的证据，对取证有价值。若 Owner 要求失效面整齐覆盖遥测，选 a 并同步修订 `client-events` 契约注释 |

## Consequences

### Positive

- 无账号考生获得**正面、显式**的归属与审计表示，消除 `candidateId = NULL`
  双语义与伪账号两类漂移源。
- 四种入场机制（账号/名册/临时/联邦）收敛到同一条 attempt 路径，符合
  #645 "ONE ENGINE / MULTIPLE ADMISSION"目标；本 ADR 只落地前两者，后两者有
  明确的独立入口。
- 换机获得可证明的失效边界（交接事务提交）与完整的受保护入口清单，满足
  ADR-012 的接管规则而无需改状态机。
- 审计主体条款的 `audit_logs` 侧零迁移成本（该字段无 FK）；命令回执侧的归属
  是显式取舍而非零成本——其复合 FK 与 staff-only CHECK 是既有 DB 强制
  （见 Q3）。
- 两段回退把"关入口"与"弃履约"解耦，与 ADR-022 D5 的降级原则同构。

### Costs / risks

- `candidate_profiles.user_id` 可空化（Q5-a）触及现有唯一索引与若干组装查询，
  需要迁移与调用点核对（已定位导出双 join 为第一处）。
- 租约给每个受保护入口增加一次代际校验；已知热点是保存与心跳（条件写处），
  需在实现时验证真实 PG 下的并发语义（见验收条款）。
- 附件通道（Q4）在裁决前，正式机考的换机验收在该维度不完整——这是**现状**，
  不是本 ADR 引入的缺口。

## Rejected alternatives

- **为无账号考生伪造长期 `users` 行**：制造假账号主体，破坏审计真实性与
  授权模型；#645/#678 r3 基线 §8 明令禁止。
- **`candidateId = NULL` 扩散**：把双语义藏进所有权、心跳、恢复、提交、评分、
  结果可见性的每一处判断；#645 明令禁止。
- **`PERMANENT / ROSTER / EPHEMERAL` 单一枚举**：用一个判别符同时控制档案
  生命周期、考试报名与身份证明来源三件正交的事；#678 r3 基线 §7.1 明令分开记录。
- **设备指纹 / IP / 扫码动作作为租约持有证明**：均可伪造/共享；#678 r3 基线 §7.2
  明令不能证明持有原租约。
- **`Argon2(studentId + examId + seatNo)` 伪密码**：可预测标识不因哈希硬化成为
  秘密；#645 明令禁止。
- **影子授权系统 / 第二套作答评分引擎**：租约不是权限来源；attempt/答案/评分
  语义只有一套（ADR-022 D1、#645 non-goals）。
- **路径②作为主路径**：见 Q1；保留为 fallback 并绑定 EXSEM §6 程序。

## Acceptance / stop conditions

**获准前（本 ADR 为 PROPOSED 期间）的停止条件：**

- 名册、准考凭证、作答租约、换机在产品代码中零写入、零 schema 变更；
- 不得以任何保留值/预留字段的存在（EXSEM-019）声称上述能力"已支持"。

**获准后，首个切片（一场考试、一个考点、一个名册）实现时必须以真实 PostgreSQL
逐条证明：**

1. 授权换机操作幂等：同一 operationId 重复送达只产生一次交接；
2. 两个针对同一旧代际的换机指令至多一个生效；
3. 换机提交后，新端恢复原 attempt、已确认答案与原有效截止；旧端新发起的题面、
   附件、状态、恢复、保存、心跳、提交全部失效；
4. 清 Cookie 后重扫不能取得第二份活跃租约；有活跃租约时静态准考码兑换不产生
   第二租约；
5. 同代际内的版本、幂等与不可变回执语义与既有账号路径完全一致；
6. 旧端先提交 / 换机先提交、手动提交与截止收卷的交错各自收敛到恰一个冻结
   答案集与一份评分工作集；
7. 无账号考生的结果可由授权人员按发布规则经导出交付（导出包含无账号者）；
8. 现有账号路径回归通过（入场、作答、恢复、提交、查分、导出）。

以上任何一条要求修改 EXSEM 冻结语义或 Accepted ADR 时，停止并走显式
superseding/amending 决策，不得在本 ADR 内隐式扩张。
