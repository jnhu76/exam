# Migration Plan

## 双线总顺序

```text
Phase1.7-A: API Contract Convergence
  A00  API Contract Constitution + Endpoint Inventory
  A01  Attempts Save/Submit Contract Vertical Slice
Phase1.7-S: Security Completion Baseline（A01 强相关项前置）
  S03b Client Submit Flush Protocol
Phase1.7-A: API Contract Convergence（继续）
  A02  Auth/Users/Candidates ErrorResponse Vertical Slice
  A03  Exams/Questions Command/Resource Response Vertical Slice
  A04  Import/Export Response Vertical Slice
  A05  OpenAPI Schema Completion + Drift Test
  A06  Web API Client Error/Command Handling Convergence
Phase1.7-S: Security Completion Baseline
  S04-lite Auth Session Security Baseline
  S05-lite CSV + Security Headers + CSRF Origin Check
  S06-lite Audit Log Completion Baseline
  S07-lite Password Policy + Account Security Baseline
  S08-lite Red-Team Security Test Suite
  S09-lite Security Baseline Validation
Phase1.7-A: 收尾
  A07  i18n Systematization（optional/deferred，不阻塞 Phase2 Entry Gate）
```

依赖关系：

- **API contract 是安全 baseline 的前置**：S04-S09 复用 ErrorResponse v0、code/message registry 和 HTTP status 规则。不先固定这些规则，安全实现会引入新的 response shape 漂移。
- **S03b 前置于 A01 之后**：submit flush 与 save/submit contract 强相关，但不需要完整安全 baseline。
- **A07 在 A06 之后**：i18n 系统化依赖稳定的 code/reason 和 registry 基础。
- **A07 不阻塞 Phase2 Entry Gate**：只有产品明确要求完整多语言时才升级为前置。
- 如果发现安全任务必须提前做，必须说明它不会引入新的 response shape 漂移。

## 迁移方式：Endpoint Family 纵切

代码迁移**禁止**横向切层（先改全部 contract 再改全部 route）。必须按 endpoint family 纵切：

```text
选定 endpoint family（参考 07-endpoint-inventory.md）
  → contract schema（packages/contracts）
  → domain/protocol builder（packages/domain, packages/exam-engine）
  → message/code registry entry
  → route response（apps/api/src/routes）
  → route tests
  → affected frontend client（apps/web/src）
  → OpenAPI entry or pending marker
  → pnpm verify
```

每完成一个 endpoint family，系统必须保持可运行。

---

## A00: API Contract Constitution + Endpoint Inventory

### Purpose

建立响应分类、ErrorResponse v0、Command Result、i18n 边界、OpenAPI 规则、HTTP status 规则、message registry 概念和 endpoint inventory。

### Scope

- 新增本目录全部规划文档。
- 审计旧 API 参考与当前实现。
- 统计当前所有 endpoint 到 `07-endpoint-inventory.md`。
- 固定 HTTP status 规则、ErrorResponse v0 类型、Command Result rejected 类型。
- 固定 submit 冲突语义（409 ErrorResponse）。

### Non-goals

- 不修改生产代码、测试或现有接口行为。
- 不引入 OpenAPI 依赖。
- 不重写全部 endpoint 文档。

### Files likely affected

- `docs/phase1.7/api-contract/**`

### Acceptance criteria

- 文档覆盖六类 response shape。
- confirmed 与 pending verification 明确分开。
- A01-A07 和 S03b-S09 均有可执行 Job Card。
- Endpoint inventory 覆盖当前所有 endpoint。
- HTTP status 规则、ErrorResponse v0、Command Result rejected 类型已固定。
- Submit 冲突语义已固定并记录理由。
- 与 Phase1.7 security plan 无权威冲突。

### Tests / verification

- `git diff --check`
- `pnpm exec prettier --check docs/phase1.7/api-contract`
- `git diff --name-only` 只包含 `docs/`

### Risks

- Phase1.7 已有安全计划，需在总排期中避免编号和范围冲突。
- 文档目标可能被误读为当前已实现行为，必须持续标注 current/target。

## A01: Attempts Save/Submit Contract Vertical Slice

### Purpose

把 save-answer 与 submit 的并发/状态机语义表达为稳定 contract。

### Scope

- 将 save response 改为 accepted true/false 可判别分支。
- 将自然语言冲突原因迁移为稳定 reason + registry message。
- submit 冲突使用 409 ErrorResponse（已固定，见 03-command-result.md）。
- 保持 Phase1.6 事务、锁和 deadline 语义不变。
- 建立兼容策略，评估现有 `conflict.reason` 调用方。

### Non-goals

- 不改变 answer merge、幂等、row lock 或 grading 业务逻辑。
- 不实现 submit flush（S03b 负责）、自动提交或 Phase2 timing mode。
- 不暴露标准答案。

### Files likely affected

- `packages/contracts/src/attempt.ts`
- `packages/contracts/src/common.ts`
- `packages/domain/src/types.ts`
- `packages/exam-engine/src/answerProtocol.ts`
- `apps/api/src/routes/attempts.ts`
- `apps/api/src/plugins/errors.ts`
- message registry module
- attempts contract/route/concurrency tests
- `apps/web/src/pages/exam/TakeExamPage.tsx`

### Acceptance criteria

- accepted true/false 均有独立 schema 和测试。
- rejected 分支包含稳定 reason + message（来自 registry），不依赖 inline message。
- stale version 提供恢复所需的 serverVersion/serverAnswer。
- submit 冲突使用 409 ErrorResponse，理由已在 03-command-result.md 记录。
- Phase1.6 并发测试全部保持通过。

### Tests / verification

- contracts tests
- attempts route tests
- `pnpm test:pg`
- `pnpm verify`

### Risks

- autosave client 可能依赖现有 `conflict.reason` 路径。
- submit response 改动可能影响成绩页跳转和同步 grading 假设。
- details 不得泄露其他 candidate 或标准答案。

## S03b: Client Submit Flush Protocol

### Purpose

submit 前 flush 所有 pending saves，与 A01 的 save/submit contract 对齐。

### Scope

- submit 前 flush 所有 pending saves。
- 等待所有 save promise settled。
- 提交确认对话框显示：未答题数、未保存题数、保存失败题数。
- 有保存失败时默认阻止提交，需用户二次确认。
- flush 超时提示重试或"仍然提交"。

### Non-goals

- 不实现自动提交或 Phase2 timing mode。
- 不改变 submit 的 HTTP 语义（保持 409 ErrorResponse for conflict）。

### Acceptance criteria

- 点击"交卷"时先 flush pending saves。
- 确认对话框显示：未答/未保存/保存失败 题数。
- 有保存失败时默认阻止，需二次确认。
- flush 全部成功后发送 submit。
- flush 超时后提示重试或"仍然提交"。

### Security Job 门禁

- 是否新增或修改 ErrorResponse：否（复用 A01 submit 的 409）。
- 是否复用已有 code/message registry：是。
- 是否影响 API contract：否。
- 是否需要补充 endpoint inventory：否。

### Tests / verification

- `pnpm verify`

## A02: Auth/Users/Candidates ErrorResponse Vertical Slice

### Purpose

让认证、用户和 candidate 管理使用 ErrorResponse v0 与稳定通用错误码。

### Scope

- 收敛 400/401/403/404/409/429/500 响应，400 携带 ValidationErrorDetails（见 02-error-response.md）。
- 增加 requestId 和安全的 validation details。
- 建立旧 code 到目标 code 的兼容/迁移表（含 400 VALIDATION_ERROR → ValidationErrorDetails 映射）。
- 将 inline error message 收敛到 message registry。
- 与 Phase1.7 S04/S06/S07 安全 Job 协调。

### Non-goals

- 不实现完整 session revocation、账户锁定或 i18n。
- 不改变 tenant isolation 的 404/403 防泄露策略。
- 不改 candidate identity 模型。

### Files likely affected

- `packages/contracts/src/common.ts`
- `packages/domain/src/errors.ts`
- `apps/api/src/plugins/errors.ts`
- `apps/api/src/plugins/auth.ts`
- message registry module
- auth/user/candidate/candidateField routes and tests

### Acceptance criteria

- 目标模块错误均符合 ErrorResponse v0（含 required requestId）。
- frontend 可读取 code/details/requestId。
- 登录无效凭据使用稳定 code，且不泄露用户是否存在。
- 测试不再依赖完整自然语言 message。
- 所有 inline error message 已收敛到 registry。

### Tests / verification

- auth/user/candidate route tests
- error plugin tests
- tenant/RBAC security tests
- `pnpm verify`

### Risks

- 错误码改名可能影响已有 UI 或外部脚本。
- requestId 信任边界配置错误可能造成日志关联混乱。

## A03: Exams/Questions Command/Resource Response Vertical Slice

### Purpose

区分 exam/question 资源响应与 publish/archive/delete 等 command/empty 响应。

### Scope

- 为 publish、archive、enrollment mutation 等 endpoint 选择明确 response shape。
- 为状态冲突建立领域 code + registry message。
- 收敛 question/exam validation details。
- 保持状态变更继续通过 command function。

### Non-goals

- 不新增 Phase2 exam operation、随机组卷或监考功能。
- 不改变 exam 状态机允许的转换。
- 不做全系统 envelope。

### Files likely affected

- exam/question contracts
- `apps/api/src/routes/exam.ts`
- `apps/api/src/routes/question.ts`
- domain state/error definitions
- message registry module
- related tests

### Acceptance criteria

- 每个 command endpoint 的成功与拒绝形态明确。
- `EXAM_ALREADY_PUBLISHED`、`QUESTION_NOT_IN_EXAM` 等领域码按实际需要落地。
- 204 endpoint 无 body。
- 状态机和 tenant/RBAC 测试保持通过。

### Tests / verification

- exam/question route tests
- state-machine tests
- permission boundary tests
- `pnpm verify`

### Risks

- 把普通资源更新误改为 command result 会扩大 client 迁移面。
- 领域码过细会形成难维护枚举。

## A04: Import/Export Response Vertical Slice

### Purpose

明确批量导入专用结果、行级错误和文件下载 contract。

### Scope

- 统一 import summary 与 row error 结构。
- 行级错误提供稳定 code，message 仅用于展示。
- CSV/export 按 content type、header 和 ErrorResponse 描述。
- 保持 CandidateField 动态列语义。

### Non-goals

- 不实现 PDF、异步 export job 或 Phase2 export UI。
- 不改变导入 upsert 业务规则。
- 不把文件包装成 JSON。

### Files likely affected

- candidate/question import contracts and routes
- `apps/api/src/routes/export.ts`
- `packages/import-export/`
- message registry module
- import/export tests

### Acceptance criteria

- import result 可区分 created/updated/skipped/failed。
- 每个 row error 有稳定 code 和 row 定位。
- CSV 成功响应与 JSON 错误响应在 schema 中分开。
- CSV injection 与权限要求和 Phase1.7 security plan 对齐。

### Tests / verification

- candidate/question import tests
- export tests
- security CSV tests
- `pnpm verify`

### Risks

- 批量导入的部分成功语义可能被误当作 HTTP error。
- 文件名和 header 编码需兼容浏览器及 LAN 部署。

## A05: OpenAPI Schema Completion + Drift Test

### Purpose

建立可生成、可校验且与实际 Fastify 行为一致的 OpenAPI。

### Scope

- 选择 OpenAPI 3.0.x 或 3.1.x。
- 评估并接入 Fastify/OpenAPI 工具链。
- 为全部当前 endpoint 补成功与错误 response schema。
- 建立 shared components、规范校验和 drift test。

### Non-goals

- 不公开仅供内部使用的管理接口。
- 不部署外部云文档服务或 CDN。
- 不以手写静态 YAML 取代 contract source of truth，除非评估证明生成方案不适用。

### Files likely affected

- `apps/api/package.json`
- API server/plugin registration
- route schema adapters
- `packages/contracts`
- generated OpenAPI artifact or verification scripts
- CI configuration

### Acceptance criteria

- OpenAPI 在离线/LAN 环境可生成。
- 每个 endpoint 有成功与适用 ErrorResponse。
- command、204、CSV schema 正确。
- 规范校验和 contract drift test 进入 CI。

### Tests / verification

- OpenAPI schema validation
- generated artifact snapshot/diff
- representative Fastify inject contract tests
- `pnpm verify`

### Risks

- Zod 到 JSON Schema/OpenAPI 的特性映射不完整。
- OpenAPI 3.0/3.1 对 `const`、nullable、discriminator 的差异。
- response serializer 可能剔除未声明字段，必须分阶段启用。

## A06: Web API Client Error/Command Handling Convergence

### Purpose

让 Web client 保留并消费稳定 code/reason/details/requestId。

### Scope

- 扩展 `ApiError`。
- 为 Command Result 建立类型安全处理。
- 按模块迁移 UI 错误分支。
- 保留服务端 zh-CN message 作为 fallback。

### Non-goals

- 不实现完整前端 i18n。
- 不重写所有页面数据层。
- 不引入在线 client generation 服务。

### Files likely affected

- `apps/web/src/lib/api.ts`
- API client tests
- exam runtime save/submit pages
- affected admin pages
- generated client files（若 A05 采用生成）

### Acceptance criteria

- `ApiError` 暴露 status/code/message/details/requestId。
- 业务逻辑不比较 message。
- autosave 按 reason 执行刷新、停止重试或冲突恢复。
- 401 导航行为保持正确。

### Tests / verification

- API client unit tests
- exam runtime component/integration tests
- targeted E2E
- `pnpm verify`

### Risks

- 页面当前只捕获 message，迁移不完整会丢失用户提示。
- generated client 与现有轻量 wrapper 并存可能造成重复抽象。

## A07: i18n Systematization (optional / deferred)

### Status

**A07 不阻塞 Phase2 Entry Gate**。A07 可以在 Phase2 前任何时候完成，也可以推迟到 Phase2 内部按需启动。只有当产品明确要求完整多语言支持时，才将 A07 升级为 Phase2 前置。

### Purpose

在稳定 code/reason + message registry 基础上评估并实现真正需要的多语言策略。

### Scope

- 盘点产品语言需求。
- 决定前端映射、服务端 catalog 或 language negotiation。
- 扩展 message registry 为多语言 catalog。
- 建立缺失翻译 fallback。

### Non-goals

- 不在 API contract 收敛前启动。
- 不因翻译需求改变 code/reason。
- 不引入运行时云翻译服务。

### Files likely affected

- future i18n modules/catalogs
- web presentation layer
- API message mapping
- copy-focused tests and docs

### Acceptance criteria

- 语言选择与 fallback 有明确产品规则。
- 所有业务分支仍依赖 code/reason。
- 翻译缺失不影响协议处理。
- LAN/offline 部署不依赖外部服务。

### Tests / verification

- locale mapping tests
- fallback tests
- representative E2E
- `pnpm verify`

### Risks

- 过早系统化会扩大范围并阻塞核心 contract。
- server/client 双重 catalog 可能漂移。

---

## Phase1.7-S Security Job Cards

S03b-S09 的详细 scope 和 acceptance criteria 见 [`security-completion-plan.md`](../security-completion-plan.md)。以下仅列出每个 Job 与 API contract 的交叉要求。

### S03b: Client Submit Flush Protocol

与 A01 强相关，安排在 A01 之后。不新增 ErrorResponse，复用 submit 的 409 语义。

### S04-lite: Auth Session Security Baseline

可能修改 login/logout 的错误响应。必须复用 A02 建立的 ErrorResponse v0 和 code/message registry。不得引入独立错误格式。

### S05-lite: CSV + Security Headers + CSRF Origin Check

CSV injection escape 和 security headers 不影响 API response shape。CSRF origin check 的 403 必须使用 ErrorResponse v0。

### S06-lite: Audit Log Completion Baseline

新增 `GET /api/admin/audit-logs` endpoint。必须在 endpoint inventory 中登记。使用 A02/A03 建立的分页和错误响应格式。

### S07-lite: Password Policy + Account Security Baseline

密码策略 validation 的 400 错误必须使用 ErrorResponse v0 + ValidationErrorDetails。不得 inline message。

### S08-lite: Red-Team Security Test Suite

测试断言必须使用 stable code/reason，不依赖 message 文案。

### S09-lite: Security Baseline Validation

最终验收。验证所有安全 Job 复用了 API contract 格式。

---

## A01-A06 Job 完成门禁

每个 Job 完成时必须输出：

1. 修改文件列表
2. endpoint contract 变化表
3. HTTP status 变化表
4. JSON key/shape 变化表
5. code/reason/message registry 变化
6. details 字段安全审查
7. 受影响 frontend/client
8. 新增/更新测试
9. OpenAPI entry 或 pending marker
10. `pnpm verify` 结果
11. 已知兼容性影响

## S03b-S09 Job 完成门禁

每个安全 Job 完成时必须说明：

1. 是否新增或修改 ErrorResponse
2. 是否复用已有 code/message registry
3. 是否影响 API contract
4. 是否需要补充 endpoint inventory
5. `pnpm verify` 结果
