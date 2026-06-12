# OpenAPI Rules

## 当前状态

当前 API 未接入 `@fastify/swagger`，route 也没有 `schema.response`。本文件定义目标规则，
不表示 A00 已生成 OpenAPI。

Fastify Swagger 官方文档确认：

- route 可以按 HTTP status 声明 response schema。
- OpenAPI 3 response 可以按 media type 声明 `content`。
- 204 等空响应可以显式声明为空。

A05 必须选择并固定 OpenAPI 版本、schema 来源和生成验证方式。选择标准：
- 工具链兼容性（Zod → JSON Schema 输出版本、`@fastify/swagger` 支持范围）。
- `const` / nullable / discriminator 支持差异。
- 生成 client 是否需要特定版本。
- LAN/offline 环境下工具可用性。

## 必须规则

1. 每个 endpoint 必须声明成功 response schema。
2. 每个 endpoint 必须声明适用的 ErrorResponse。
3. command endpoint 必须声明 accepted true / accepted false 分支。
4. `reason` / `code` 应尽量 enum 化。
5. `message` 始终是 string，不作为逻辑判别字段。
6. 分页列表使用统一 pagination schema。
7. 文件下载按 content type 描述，不套 JSON。
8. 204 明确 no content，不声明 JSON body。
9. OpenAPI schema 必须与实际 status、header、body 一致。
10. candidate-facing attempt schema 不得暴露 `standardAnswer`。

## Shared Components

至少应建立：

- `ErrorResponse`
- `ValidationErrorDetails`
- `Pagination`
- `SaveAnswerAccepted`
- `SaveAnswerRejected`
- 常用 auth errors

共享 schema 应由 `packages/contracts` 或明确的 OpenAPI adapter 生成/引用，避免 routes 和
文档各维护一份 DTO。

## Save Answer 示例

以下是 OpenAPI 3.1 目标表达。若 A05 选择 OpenAPI 3.0.x，`const: true/false` 需改为
`enum: [true]` / `enum: [false]`。部分生成器对 boolean discriminator 支持不一致；
工具兼容性不足时，保留 `oneOf` + 固定 accepted 值，discriminator 可不作为生成前提。

```yaml
SaveAnswerAccepted:
  type: object
  required:
    - accepted
    - serverVersion
  properties:
    accepted:
      type: boolean
      const: true
    serverVersion:
      type: integer
    savedAt:
      type: string
      format: date-time
    conflict:
      nullable: true

SaveAnswerRejected:
  type: object
  required:
    - accepted
    - reason
    - message
  properties:
    accepted:
      type: boolean
      const: false
    reason:
      type: string
      enum:
        - ATTEMPT_ALREADY_SUBMITTED
        - ATTEMPT_NOT_IN_PROGRESS
        - ANSWER_VERSION_CONFLICT
        - QUESTION_NOT_IN_EXAM
    message:
      type: string
    serverVersion:
      type: integer
      nullable: true
    details:
      type: object
      additionalProperties: true

SaveAnswerResponse:
  oneOf:
    - $ref: "#/components/schemas/SaveAnswerAccepted"
    - $ref: "#/components/schemas/SaveAnswerRejected"
  discriminator:
    propertyName: accepted
```

## ErrorResponse 示例

```yaml
ErrorResponse:
  type: object
  required:
    - error
  properties:
    error:
      type: object
      required:
        - code
        - message
        - requestId
      properties:
        code:
          type: string
        message:
          type: string
        details:
          type: object
          additionalProperties: true
        requestId:
          type: string
```

## 文件响应

```yaml
"200":
  description: CSV export
  headers:
    Content-Disposition:
      schema:
        type: string
  content:
    text/csv:
      schema:
        type: string
"400":
  description: Invalid export request
  content:
    application/json:
      schema:
        $ref: "#/components/schemas/ErrorResponse"
```

## 204 响应

OpenAPI 文档中 204 只写 description，不声明 content。若 Fastify Swagger 的运行时
schema 需要空 schema，应按所选插件版本的官方方式配置，并用生成结果测试确认。

```yaml
"204":
  description: No Content
```

## 验证要求

A05 至少验证：

- 生成的 OpenAPI 文档通过规范校验。
- 关键 endpoint 的 status/content-type/schema 与 inject 集成测试一致。
- accepted true/false 都有 contract test。
- 204 没有 response body。
- CSV 不被错误描述为 JSON。
- ErrorResponse 的 `requestId` 与实现一致。
- 生成 client 不把 command result 合并成无法判别的宽泛对象。
