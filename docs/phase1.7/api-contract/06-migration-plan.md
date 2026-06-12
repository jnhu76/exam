# Migration Plan

## 总体顺序

```text
A00 文档规则
  → A01 attempts save/submit
  → A02 auth/users/candidates errors
  → A03 exams/questions commands
  → A04 import/export
  → A05 OpenAPI 完整化
  → A06 Web API client
  → A07 i18n 系统化（后续）
```

迁移以 endpoint contract 为单位。每个 Job 同步修改 contract schema、route、测试、
OpenAPI 和受影响 client，禁止只改其中一层。

## A00: API Contract 文档落地

### Purpose

建立响应分类、ErrorResponse v0、Command Result、i18n 边界、OpenAPI 规则和迁移顺序。

### Scope

- 新增本目录全部规划文档。
- 审计旧 API 参考与当前实现。

### Non-goals

- 不修改生产代码、测试或现有接口行为。
- 不引入 OpenAPI 依赖。
- 不重写全部 endpoint 文档。

### Files likely affected

- `docs/phase1.7/api-contract/**`

### Acceptance criteria

- 文档覆盖六类 response shape。
- confirmed 与 pending verification 明确分开。
- A01-A07 均有可执行 Job Card。
- 与 Phase1.7 security plan 无权威冲突。

### Tests / verification

- `git diff --check`
- `pnpm exec prettier --check docs/phase1.7/api-contract`
- `git diff --name-only` 只包含 `docs/`

### Risks

- Phase1.7 已有安全计划，需在总排期中避免编号和范围冲突。
- 文档目标可能被误读为当前已实现行为，必须持续标注 current/target。

## A01: Attempts Save/Submit Schema 修复

### Purpose

把 save-answer 与 submit 的并发/状态机语义表达为稳定 contract。

### Scope

- 将 save response 改为 accepted true/false 可判别分支。
- 将自然语言冲突原因迁移为稳定 reason。
- 决定 submit 冲突使用 409 ErrorResponse 或 Command Result。
- 保持 Phase1.6 事务、锁和 deadline 语义不变。
- 建立兼容策略，评估现有 `conflict.reason` 调用方。

### Non-goals

- 不改变 answer merge、幂等、row lock 或 grading 业务逻辑。
- 不实现 submit flush、自动提交或 Phase2 timing mode。
- 不暴露标准答案。

### Files likely affected

- `packages/contracts/src/attempt.ts`
- `packages/contracts/src/common.ts`
- `packages/exam-engine/src/answerProtocol.ts`
- `apps/api/src/routes/attempts.ts`
- attempts contract/route/concurrency tests
- `apps/web/src/pages/exam/TakeExamPage.tsx`

### Acceptance criteria

- accepted true/false 均有独立 schema 和测试。
- rejected 分支包含稳定 reason，不依赖 message。
- stale version 提供恢复所需的 serverVersion/serverAnswer。
- submit 冲突语义在 endpoint contract 中唯一确定，并记录选择理由。
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

## A02: Auth/Users/Candidates Error Response 收敛

### Purpose

让认证、用户和 candidate 管理使用 ErrorResponse v0 与稳定通用错误码。

### Scope

- 收敛 401/403/404/409/429/500 响应。
- 增加 requestId 和安全的 validation details。
- 建立旧 code 到目标 code 的兼容/迁移表。
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
- auth/user/candidate/candidateField routes and tests

### Acceptance criteria

- 目标模块错误均符合 ErrorResponse v0。
- frontend 可读取 code/details/requestId。
- 登录无效凭据使用稳定 code，且不泄露用户是否存在。
- 测试不再依赖完整自然语言 message。

### Tests / verification

- auth/user/candidate route tests
- error plugin tests
- tenant/RBAC security tests
- `pnpm verify`

### Risks

- 错误码改名可能影响已有 UI 或外部脚本。
- requestId 信任边界配置错误可能造成日志关联混乱。

## A03: Exams/Questions Command Response 收敛

### Purpose

区分 exam/question 资源响应与 publish/archive/delete 等 command/empty 响应。

### Scope

- 为 publish、archive、enrollment mutation 等 endpoint 选择明确 response shape。
- 为状态冲突建立领域 code。
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

## A04: Import/Export Response 收敛

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

## A05: OpenAPI Schema 补齐

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

## A06: 前端 API Client 和错误处理迁移

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

## A07: i18n 系统化处理

### Purpose

在稳定 code/reason 基础上评估并实现真正需要的多语言策略。

### Scope

- 盘点产品语言需求。
- 决定前端映射、服务端 catalog 或 language negotiation。
- 集中管理默认 zh-CN copy。
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

## 跨 Job 门禁

每个 A01-A07 Job 完成时必须输出：

1. 修改文件列表
2. 新增/更新测试列表
3. coverage 结果
4. `pnpm verify` 结果
5. 已知限制与兼容性影响

涉及 endpoint 行为变化时，还必须提供迁移说明和 OpenAPI diff。
