# ErrorResponse v0

## 目标结构

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数无效",
    "details": {},
    "requestId": "req_xxx"
  }
}
```

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
- 所有错误响应必须提供，不限于 500。
- 具体格式由 A02/A05 实施时确定，调用方不得解析其内部结构。

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

- `ATTEMPT_ALREADY_SUBMITTED`
- `ATTEMPT_NOT_IN_PROGRESS`
- `ATTEMPT_DEADLINE_EXCEEDED`
- `ANSWER_VERSION_CONFLICT`
- `EXAM_NOT_OPEN`
- `EXAM_ALREADY_PUBLISHED`
- `QUESTION_NOT_IN_EXAM`
- `CANDIDATE_FIELD_IN_USE`

领域码应在调用方需要采取不同动作时使用。不要为每一句文案创建新 code。

## 现有 code 的迁移

当前存在 `UNAUTHORIZED`、`FORBIDDEN`、`NOT_FOUND`、`CONFLICT` 等 code。A02/A03
必须先建立映射和兼容策略，再决定是否改名。本文档定义目标命名，不在 A00 改变现有响应。

## HTTP status 规则

- status 表示 HTTP/协议层结果，code 表示稳定错误类别。
- 相同 code 应尽量使用相同 status。
- 404 可同时承担“资源不存在”和“跨租户不可见”，避免泄露资源存在性。
- 500 统一返回安全文案和 requestId，详细错误只进入日志。
- validation details 应结构化，不把所有字段错误拼成单个机器不可读字符串作为最终形态。
