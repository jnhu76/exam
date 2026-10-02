# ADR-022: Bounded product capability composition

- **Status:** ACCEPTED
- **Date:** 2026-10-02
- **Decision owner:** repository maintainer / product owner
- **Normative architecture:**
  [`docs/architecture/product-capability-composition.md`](../architecture/product-capability-composition.md)
- **Tracking:** [Issue #678](https://github.com/jnhu76/exam/issues/678)

## Context

Exam 已有一套统一的考试语义内核：Exam/Attempt lifecycle、答案协议、提交冻结、
评分工作集、终态聚合、结果发布、安全授权与恢复。与此同时，真实部署希望组合出
差异很大的产品表面，例如：

- 企业内部部分员工的资格考试；
- 花名册/名单准入的学校考试；
- 现场 LAN 考试；
- 只有少量题型和 Plain 主观题的低复杂度考试；
- Rich/Math + 人工阅卷的学术考试；
- 未来由 OA/LMS 联邦发起的认证考试；
- 有物理或数字完整性观察但不改变评分权威的考试。

此前 #678 用 `Simple / General` 描述 Deployment Product Profile，正确地要求单一
engine、server enforcement、dashboard filtering 与 downgrade protection，但把
`Simple` 固定为 objective-only，错误地把“产品/界面复杂度”和“assessment/grading
capability”耦合在一起。

2026-10-02 的独立架构评审在 `master@eb5d580` 上确认：Plain `text_response` +
基础 manual grading 已经存在；因此 Minimal/简单产品包含主观题在当前语义上完全
成立。同时，产品 capability 与现有 `Permission.*` / Web actor capability 是两个
不同 authority，不能共用命名空间或推导关系。

## Decision

### D1 — One semantic kernel, bounded capability composition

Exam 采用：

```text
ONE EXAM SEMANTIC KERNEL
+ BOUNDED PRODUCT CAPABILITY COMPOSITION
+ POLICY
+ AUTHORIZATION / ADMISSION
+ PRESENTATION
```

不得建立 Simple/General 专属 Attempt、answer、grading、result 状态机或 API。

### D2 — `Simple / General` cease to be domain modes

近期产品 preset 使用：

```text
Minimal
Standard
```

Preset 只提供默认 capability composition 与 presentation complexity；preset 名称
不得成为 runtime semantic discriminator。

**Minimal 可以包含 Plain `text_response` 与基础人工阅卷。**

### D3 — Product capability and Permission are independent authorities

产品能力回答：

> 当前部署是否允许新增这种产品操作？

Permission / resource scope 回答：

> 当前 actor 是否有权在该资源上执行这种操作？

两者必须同时成立，但产品 enable 不得自动 grant actor permission。

### D4 — Capability composition is server-authoritative and typed

建立单一 server composition root：

```text
SupportedProductCatalog
+ ProductPreset defaults
+ bounded explicit configuration
→ ResolvedProductConfiguration
```

消费者依赖 resolved capability/result，不应散布：

```text
if (profile === "minimal") ...
```

Unknown/reserved/future capability 必须 fail closed，不得静默忽略或自动扩权。

### D5 — Capability controls new commitments; accepted obligations remain fulfillable

关闭 capability 首先阻止新的 authoring/import/copy/publish commitment。它不能使
已有：

- published exams；
- active attempts；
- pending manual grading；
- historical Rich content；
- 已接受的 future delivery obligation

失去读取、保存、提交、完成或安全投影能力。

无法安全 downgrade 时必须 reject 或显式 draining，不得改写历史事实。

### D6 — Capability, policy, profile and presentation remain distinct

- `ProductPreset`：产品默认组合；
- `DeploymentProductConfiguration`：部署允许的新产品操作；
- `ExamPolicyProfile`：作者期运行策略 recipe / copy-on-apply；
- `PresentationPreferences`：渐进 UI；
- frozen exam/attempt facts：继续由现有 semantic authority 拥有。

现有 `basic_quiz` / `standard_online` 不改成产品 SKU。

### D7 — Modules are internal static boundaries, not a plugin ecosystem

近期采用：逻辑 capability boundary、静态 module/import、有限 typed catalogue/
provider registry。

明确不采用：动态第三方 plugin ABI、marketplace、通用 policy language、按 profile
拆微服务或多套 frontend。

### D8 — Proctoring is evidence/authorized action, not grading truth

未来完整性能力遵循：

```text
observation
→ policy recommendation / authorized judgment
→ existing guarded command
→ legal kernel fact
```

`observation ≠ violation ≠ grading fact`。Camera/mic/AI provider 不因产品组合设计
自动成为 supported capability。

### D9 — LAN/on-premise is not durable offline acceptance

当前本地/LAN 部署与未来 durable offline client、持久 outbox、分区提交是不同保证。
产品 preset 不得绕过 ADR-016 或服务器接受真相。

## Consequences

### Positive

1. 同一 engine 可以表达 Minimal objective、Minimal subjective、Rich academic、现场
   LAN、未来 federation 等场景，而不产生 mode explosion。
2. Product surface、RBAC、admission、policy、delivery 与 proctoring 可以按各自
   authority 演进。
3. Disabled capability 可以在 server write boundary 真正 enforce，而不是只隐藏 UI。
4. Capability downgrade 有明确历史履约原则，不会因为产品“变简单”而卡死 pending
   grading 或破坏历史 Rich reader。
5. 测试可用 module contract + high-risk interaction + 少量 preset E2E，而不是所有轴
   的笛卡尔积。

### Costs

1. 需要新增一个 typed product catalogue / resolver 与 authoritative write guards。
2. 需要审计 CRUD/import/copy/publish/navigation/dashboard 等真实入口，防止绕过。
3. 未来配置可写后需要 revision/CAS、impact preview、audit 和 draining/reject 语义。
4. 必须持续区分“UI 不展示”和“产品 capability 真正 disabled”。

## Presets accepted for initial design

只接受两个近期 preset：

### Minimal

默认强调低认知/运维复杂度，可包含：

- `single_choice`、`true_false`；
- 可批准 `multiple_choice`；
- **Plain `text_response` + 基础 manual grading**；
- 默认不要求 Rich/Math；
- browser + LAN/on-premise；
- 不要求 digital proctoring；
- 必要 pending/recovery/incident work 仍必须可见。

### Standard

表示当前完整已支持产品能力的行为等价组合：当前五题型、既有 Rich slot、manual
workflow、现有 queue/operator/recovery surface（仍受各自 capability 与 Permission
约束）。Standard 不自动激活 reserved/future capability。

## Implementation ordering

本 ADR 与 normative architecture document 完成 Phase 0 authority freeze。

工程排期：**Phase 1 及以后默认在 Rich correctness umbrella #669 完成其当前
protocol/backend closure 与 Gate-1 对账后启动。** 这是 sequencing gate，不表示本
架构在语义上依赖 Rich。

后续：

1. Phase 1 — behavior-equivalent Standard catalogue/resolver；
2. Phase 2 — authoritative CRUD/import/copy/publish guards；
3. Phase 3 — Minimal objective + Minimal Plain subjective E2E；
4. Phase 4 — bounded configuration persistence/UI/impact preview/CAS；
5. Phase 5 — #645 federation/roster、#679 Math UX、structured rubric、new proctoring、
   durable offline 等各自独立接入。

## Relationships

- **depends on:** ADR-021 / `exam-semantic-boundaries.md` for cross-boundary exam truth;
- **depends on:** ADR-010 and current authorization architecture for actor/resource authority;
- **depends on:** ADR-019 for current Rich `ContentDocumentV1` representation;
- **related:** ADR-016 for deferred offline-resilient client semantics;
- **related:** ADR-017 for Host Operator / Maintainer operational boundary;
- **related:** Issues #645, #669, #673, #679 for independent admission, Rich correctness,
  evidence and Math UX work.

This ADR does **not** amend EXSEM, QuestionType grading classification, submission freeze,
result authority, authorization semantics, or offline acceptance authority.

## Rejected alternatives

### Fixed Simple / General semantic modes

Rejected: couples unrelated dimensions and creates profile-name branching / future SKU
explosion.

### `Simple = objective-only`

Rejected: Plain subjective + manual grading is already a legitimate low-complexity product
path; presentation complexity does not own QuestionType truth.

### Frontend-only feature flags

Rejected: hidden controls do not prevent API/import/publish creation of unsupported new
commitments.

### Completely free composition

Rejected for now: arbitrary predicates/providers/schema subsets turn configuration into a
programming language and enlarge the correctness matrix.

### Dynamic plugin marketplace

Rejected for current scope: no present need justifies ABI, sandbox, signature, lifecycle and
version ecosystem complexity.

## Acceptance / stop conditions

Implementation under #678 must preserve all of the following:

- one product resolver, no parallel semantic source;
- current Standard behavior equivalence before introducing Minimal differences;
- Minimal objective and Minimal subjective both expressible;
- disabled capability rejected at authoritative new-write boundaries;
- manual demand and Rich use derived from actual frozen materials, not profile name;
- product capability and Permission/scope remain separate;
- downgrade never strands accepted execution obligations;
- `basic_quiz` / `standard_online` remain orthogonal policy recipes;
- future roster/federation/offline/surveillance are not exposed as enabled before their own
  authority and implementation exist.

If implementation requires modifying EXSEM, accepted grading truth, stable ownership,
terminal score semantics, or offline acceptance authority, stop and create an explicit focused
superseding/amending decision instead of expanding this ADR implicitly.
