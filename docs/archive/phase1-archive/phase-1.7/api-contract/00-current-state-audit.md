# Current State Audit

## 审计范围

本审计基于 2026-06-12 当前分支，检查了：

- `docs/api/reference.md`
- `docs/archive/phase-1.6/`
- `apps/api/src/routes/`
- `apps/api/src/plugins/errors.ts`
- `apps/api/src/plugins/auth.ts`
- `packages/contracts/src/`
- `packages/domain/src/errors.ts`
- API route / plugin tests
- `apps/web/src/lib/api.ts` 及其调用点
- `apps/api/package.json` 与 Fastify route schema 注册情况

## 已确认问题

### 1. 旧 API 文档是 MVP 参考，不是当前稳定契约

`docs/api/reference.md` 与当前实现存在可确认差异，例如：

- 文档把 save-answer 冲突原因写为自然语言 `"Server has newer version"`，当前
  contract/test 使用 `STALE_VERSION`。**(2026-06-14 已修复：`docs/api/reference.md` 已对齐 contract 真实 wire shape — `{ accepted, reason, message, serverVersion, savedAt, details? }`，不再使用嵌套 `conflict` 对象或自然语言 reason。)**
- 文档描述 heartbeat 为 `204 No Content`，当前路由返回 `{ "ok": true }`。**(2026-06-14 已修复：`docs/api/reference.md` 与 `07-endpoint-inventory.md` 已对齐为 `200 + { ok: true }`，不切换 204；前端按 200 成功处理。)**
- 文档描述 submit 后状态为 `completed`，当前测试断言返回 `graded`。**(已在 FIX-2 修复，`docs/api/reference.md:935` 已为 `graded`。)**
- 文档中的 candidate/import/export 示例固定使用学号、院系等部署场景字段，与当前
  `CandidateField` 通用化原则不一致。

因此该文件只能作为历史 endpoint 导览，不能作为 code review 或 client generation 的
唯一依据。

### 2. 成功响应形态客观上是多种类型

当前实现包含：

- 裸资源对象
- 裸数组
- `{ items, total, page, pageSize, totalPages }` 分页对象
- `{ items }` 非分页集合
- `{ success: true }`
- `{ ok: true }`
- `204 No Content`
- CSV 文件响应
- `{ accepted: true/false, ... }` command result
- 导入统计、批量 enrollment 等专用结果对象

这些差异不应被简单归类为“全部错误”。问题是尚无文档说明每种形态何时使用，以及
同类 endpoint 应遵循什么结构。

### 3. ErrorResponse 只有基础骨架，尚未全局收敛

`packages/contracts/src/common.ts` 已定义：

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "requestId": "optional string"
  }
}
```

但当前路由和插件大多手写 `{ error: { code, message } }`，未稳定返回
`requestId`，也没有统一 `details`。错误码还存在 `NOT_FOUND`、
`UNAUTHORIZED`、`FORBIDDEN`、`CONFLICT`、领域码等多套命名粒度。

### 4. 技术错误与业务拒绝缺少统一分类规则

当前系统同时存在：

- HTTP 4xx + `{ error: ... }`，例如验证失败、未授权、状态冲突。
- HTTP 200 + `accepted:false`，例如 stale answer version、已提交 attempt 的答案保存。
- HTTP 409 + 普通业务状态消息，例如 heartbeat 状态不允许。

这些行为各自可能合理，但 endpoint contract 尚未说明何时使用 ErrorResponse，何时使用
Command Result。

### 5. attempts save/submit 暴露了 command-result 语义缺口

`SaveAnswerResponseSchema` 当前使用：

```text
accepted + serverVersion + savedAt + optional conflict.reason
```

`conflict.reason` 已经是机器码，但 schema 没有把 accepted true/false 建模为可区分分支，
拒绝分支也没有统一的 `reason`、`message`、`details` 位置。submit 则返回 attempt 资源，
状态冲突走 HTTP 409。两者都需要在 endpoint contract 中明确，而不是靠调用方猜测。

### 6. 默认文案语言不一致

当前路由、domain error 和测试中同时存在英文与中文 message。Phase1.6 文档要求
candidate-facing 错误使用 zh-CN，但现有 deadline 测试仍精确断言英文
`"Attempt deadline exceeded"`。这说明语言策略和机器契约尚未分离。

### 7. 当前 API 没有可发现的 OpenAPI 集成

已确认：

- `apps/api/package.json` 未声明 `@fastify/swagger` 或 Swagger UI 依赖。
- `apps/api/src` 没有 Swagger 注册。
- route options 中没有 `schema.response` 定义。
- 仓库中未发现 `apps/api/openapi*`。

因此当前问题不只是“部分 response schema 缺失”，而是尚未建立从 route/contract 到
OpenAPI 的生成与一致性验证链路。

Fastify Swagger 官方文档确认：OpenAPI 可以从 route 的 status-code-specific response
schema 生成；204 可显式描述为空响应；OpenAPI 3 可按 content type 描述非 JSON 响应。
这些能力应在 A05 实施时验证，而不是在本次文档 Job 中引入依赖。

### 8. 前端错误对象丢失机器码

`apps/web/src/lib/api.ts` 当前从响应中读取 `error.message`，构造只包含
`status` 和 `message` 的 `ApiError`。已扫描生产前端代码，暂未发现通过完整 message
等值比较来分支的逻辑；但 client 丢失 `error.code/details/requestId`，会迫使未来业务
逻辑依赖 status 或 message。

### 9. 测试契约粒度不一致

部分测试断言稳定 code/reason，部分只断言存在字符串，部分精确绑定完整英文 message。
这会让文案调整与行为回归混在一起。

## 需要后续验证的问题

以下内容目前只有风险或局部证据，不能写成已确认缺陷：

- 是否有仓库外调用方依赖 `{ success: true }`、`{ ok: true }` 或现有裸数组。
- 是否有浏览器之外的 client 解析完整 message。
- 现有所有 endpoint 的真实响应是否都与 Zod contract 一致。
- OpenAPI 目标版本应选择 3.0.x 还是 3.1.x，以及当前工具链对 `const`、boolean
  discriminator、Zod discriminated union 的生成兼容性。
- submit 状态冲突最终应统一为 `409 ErrorResponse` 还是 `200 accepted:false`。
- `requestId` 的公开格式、是否复用 Fastify request id、反向代理下的信任边界。
- `details` 中哪些字段可能包含答案、身份字段或其他敏感数据。

这些问题分别进入 A01、A05、A06 的 discovery 和 acceptance criteria。

## 审计结论

当前系统不是“完全没有 contract”：`packages/contracts`、领域错误码和 attempts
command result 已经提供了基础。真正缺口是响应分类、稳定错误语义、OpenAPI 表达和
client 消费规则尚未形成同一套工程契约。
