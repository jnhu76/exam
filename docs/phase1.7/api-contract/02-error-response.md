# ErrorResponse v0

## 目标结构

```typescript
type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
};
```

与前一版本的变化：`requestId` 从 optional 升级为 **required**；`details` 保持 optional。

## 字段语义

### `code`

- 稳定的机器契约。
- 使用大写 `UPPER_SNAKE_CASE`。
- 前端分支、测试断言、日志聚合和未来本地化依赖此字段。
- 文案调整不得改变 code。

### `message`

- 默认 zh-CN 的人类可读文案。
- 用于直接展示或作为无本地化映射时的 fallback。
- 不是业务逻辑字段，前端不得解析、包含匹配或等值比较。
- 不暴露数据库错误、堆栈、token、标准答案或敏感身份数据。

### `details`

- 可选的结构化上下文；没有安全且有用的详情时可省略。
- 可承载字段校验错误、冲突版本、允许状态等。
- 字段错误建议使用：

```json
{
  "fields": [
    {
      "field": "durationMinutes",
      "code": "TOO_SMALL",
      "message": "考试时长必须大于 0"
    }
  ]
}
```

- `details` 不是任意调试信息出口，必须经过敏感数据审查。

### `requestId`

- 用于关联 API 响应与服务端结构化日志。
- 应复用可信的服务端 request id。
- **所有错误响应必须提供**，不限于 500。
- A02 实施时确定具体格式（Fastify request id 或自定义），调用方不得解析其内部结构。

## 技术错误与业务拒绝

### 使用 ErrorResponse

- 认证缺失或凭据无效
- 权限不足
- 请求格式或字段校验失败
- 资源不存在或对当前租户不可见
- 限流
- 未处理的服务端错误
- 唯一约束冲突（当 endpoint 未将该冲突定义为可恢复业务拒绝时）
- 资源状态冲突（当 endpoint 未将该冲突定义为可恢复业务拒绝时）

唯一约束或资源状态冲突如果被 endpoint 定义为可恢复的业务拒绝（如 autosave 版本冲突、
attempt 已提交后保存），应使用 Command Result（见 03-command-result.md）。

### 使用 Command Result

请求合法且完成了协议处理，但命令被业务状态机拒绝，并且 endpoint 明确定义该拒绝为
正常协议分支。例如 autosave 遇到旧版本或 attempt 已提交。

Command Result 不能取代 401、403、404、429、500。

## 通用错误码建议

| Code | 常见 HTTP status | 含义 |
| --- | ---: | --- |
| `AUTH_REQUIRED` | 401 | 缺少有效认证 |
| `AUTH_INVALID_CREDENTIALS` | 401 | 登录凭据无效 |
| `PERMISSION_DENIED` | 403 | 已认证但无权限 |
| `VALIDATION_ERROR` | 400 | 请求参数或 body 无效 |
| `RESOURCE_NOT_FOUND` | 404 | 资源不存在或不可见 |
| `RESOURCE_CONFLICT` | 409 | 通用资源冲突 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |
| `INTERNAL_ERROR` | 500 | 未处理的服务端错误 |

## 领域错误码示例

以下码用于 ErrorResponse（如 submit 的 409）。Command Result（如 save answer 的 200 accepted:false）使用独立的 reason 枚举，见 03-command-result.md。

- `ATTEMPT_ALREADY_SUBMITTED`
- `ATTEMPT_CLOSED`
- `ATTEMPT_DEADLINE_EXCEEDED`
- `ANSWER_VERSION_CONFLICT`
- `EXAM_NOT_OPEN`
- `EXAM_ALREADY_PUBLISHED`
- `QUESTION_NOT_IN_EXAM`
- `CANDIDATE_FIELD_IN_USE`

领域码应在调用方需要采取不同动作时使用。不要为每一句文案创建新 code。

### ErrorResponse 与 Command Result 的 code 区分

同一业务概念在 ErrorResponse 和 Command Result 中可以使用不同的 code：

| 场景 | ErrorResponse (submit 409) | Command Result (save 200) |
| --- | --- | --- |
| 版本冲突 | `ANSWER_VERSION_CONFLICT` | `STALE_VERSION` |
| 截止时间 | `ATTEMPT_DEADLINE_EXCEEDED` | `DEADLINE_EXCEEDED` |
| attempt 状态 | `ATTEMPT_NOT_IN_PROGRESS` | `ATTEMPT_CLOSED` |

原因：两个路径的调用方不同（submit 的调用方需要展示错误，save 的调用方需要执行恢复），code 的粒度和命名可以按各自调用方需求优化。

## 现有 code 的迁移

A02 在 API 边界统一执行以下映射。服务端不返回双 code；旧 domain code 仅作为内部兼容输入，
前端只消费新 code。

| 旧 code | 新 code |
| --- | --- |
| `UNAUTHORIZED` | `AUTH_REQUIRED` |
| `INVALID_CREDENTIALS` | `AUTH_INVALID_CREDENTIALS` |
| `FORBIDDEN`, `TENANT_ACCESS_DENIED` | `PERMISSION_DENIED` |
| `NOT_FOUND`, `USER_NOT_FOUND` | `RESOURCE_NOT_FOUND` |
| `CONFLICT`, `DUPLICATE` | `RESOURCE_CONFLICT` 或调用方需要区分的领域 code |
| `USER_EXISTS` | `USER_ALREADY_EXISTS` |
| `INVALID_PASSWORD` | `CURRENT_PASSWORD_INVALID` |
| `TOO_MANY_REQUESTS` | `RATE_LIMITED` |
| `INTERNAL_SERVER_ERROR` | `INTERNAL_ERROR` |

`requestId` 直接使用 Fastify 的 `request.id`。Zod 校验错误使用 `issues.path/code/message`
生成 `ValidationErrorDetails.fields`，不包含原始输入值。

## HTTP status 规则

| Status | 含义 | 典型 code |
| ---: | --- | --- |
| 200 | 成功（含 Command Result accepted:false） | — |
| 201 | 资源创建成功 | — |
| 204 | 成功但无 body | — |
| 400 | 请求结构或字段校验失败 | `VALIDATION_ERROR` |
| 401 | 未认证或凭据无效 | `AUTH_REQUIRED`, `AUTH_INVALID_CREDENTIALS` |
| 403 | 已认证但无权限 | `PERMISSION_DENIED` |
| 404 | 资源不存在或按安全策略隐藏 | `RESOURCE_NOT_FOUND` |
| 409 | 资源状态冲突（除非 endpoint 选择 200 Command Result） | `RESOURCE_CONFLICT`, 领域码 |
| 429 | 限流 | `RATE_LIMITED` |
| 500 | 未预期服务端错误 | `INTERNAL_ERROR` |

规则：

- status 表示 HTTP/协议层结果，code 表示稳定错误类别。
- 相同 code 应尽量使用相同 status。
- 404 可同时承担"资源不存在"和"跨租户不可见"，避免泄露资源存在性。
- 500 统一返回安全文案和 requestId，详细错误只进入日志。
- validation details 应结构化，不把所有字段错误拼成单个机器不可读字符串作为最终形态。
- 安全 Job 的所有错误响应必须复用此规则，不得引入独立格式。
