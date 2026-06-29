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
    - savedAt
  properties:
    accepted:
      type: boolean
      const: true
    serverVersion:
      type: integer
    savedAt:
      type: string
      format: date-time

SaveAnswerRejected:
  type: object
  required:
    - accepted
    - reason
    - message
    - serverVersion
    - savedAt
  properties:
    accepted:
      type: boolean
      const: false
    reason:
      type: string
      enum:
        - STALE_VERSION
        - ATTEMPT_ALREADY_SUBMITTED
        - ATTEMPT_CLOSED
        - DEADLINE_EXCEEDED
    message:
      type: string
    serverVersion:
      type: integer
    savedAt:
      type: string
      format: date-time
    details:
      type: object
      additionalProperties: false
      properties:
        serverAnswer:
          description: "服务端当前答案值"

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

## 开发文档面 (Swagger UI)

平台仅在开发与内网调试场景暴露 Swagger UI；生产环境硬关闭，且不通过 CDN 加载任何资源。

### 双闸门

启用条件 (必须同时满足)：

- `API_DOCS_ENABLED=true`
- `NODE_ENV !== "production"`

任一条件不满足，`/docs` 系列路由返回 404，与未注册等价。生产环境即便误设
`API_DOCS_ENABLED=true`，仍由 `NODE_ENV` 闸门兜底关闭。

### 暴露的端点

启用时仅暴露：

- `GET /docs/`：Swagger UI HTML 页面
- `GET /docs/json`：OpenAPI 3.0.3 spec
- `GET /docs/static/*`：UI 静态资源 (同源)

不暴露 `/docs/yaml` 或其它额外端点；`/api/health`、`/api/system/health`
不受影响。

### 安全约束

- `staticCSP: true` 由 `@fastify/swagger-ui` 在 `/docs/*` 路由上设置 scoped CSP
  (含 `script-src 'self'`、`img-src ... validator.swagger.io`)，仅对该 prefix
  生效，不影响其它路由的全局 CSP。
- 全局 `@fastify/rate-limit` 通过 `allowList` 函数对 `/docs` 与 `/docs/*` 进行
  bypass，避免开发期浏览 UI 时触发 429；该 bypass 同样受双闸门保护，生产环境
  不生效。
- `/docs/*` 默认未挂载 auth `preHandler`：闸门关闭时端点不存在，闸门开启时为
  内网开发可见，符合 LAN/on-premise 场景。

### 依赖位置

`@fastify/swagger-ui` 列在 `apps/api/package.json` 的 `dependencies` 而非
`devDependencies`，原因：

1. 注册逻辑位于运行时代码 `src/openapi/registerDocs.ts`，由 `server.ts` 在
   启动期 `await` 引入。即便生产构建中通过双闸门短路 (`if (!isDocsEnabled())
   return`)，仍需在运行时解析模块路径，因此不能仅作为 dev 依赖。
2. 双闸门保证生产部署不调用 `swaggerUiPlugin.register()`，未启用时不会加载
   `swagger-ui-dist` 静态资源。
3. 体积代价 (~2.5MB) 已知；如未来需要进一步收敛，可改为 dynamic
   `import()` + 懒加载，目前以最小变更优先。

### Spec drift 防护

- `apps/api/src/openapi/config.ts` 暴露唯一的 `openApiConfig`。
- A05 drift 测试 `openapi.test.ts` 通过 `buildSwaggerApp()` 构建独立实例消费
  该 config。
- 运行时 `registerOpenApiDocs()` 也消费同一 config。
- 任何配置变更同时影响两条路径，spec drift 在 CI 中暴露。
