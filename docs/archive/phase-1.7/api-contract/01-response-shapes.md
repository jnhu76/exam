# Response Shapes

## 原则

API 不做全系统 envelope 化。响应结构按 endpoint 语义分类，同类 endpoint 保持一致。

禁止仅为了“看起来统一”把资源、文件或 204 强行包装成 `{ data: ... }`。稳定 contract
来自明确分类和 schema，而不是所有响应拥有相同顶层字段。

## 1. Resource Response

用于读取、创建或更新单个资源。

```json
{
  "id": "resource_uuid",
  "name": "示例"
}
```

规则：

- 普通资源可以继续裸返回资源对象。
- 创建通常使用 201，读取/更新通常使用 200。
- 返回字段必须由 endpoint response schema 明确声明。
- 不返回仅为数据库内部使用的字段或 candidate 不应看到的标准答案。

## 2. List Response

### 分页列表

统一使用：

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 20,
  "totalPages": 0
}
```

规则：

- `page` 从 1 开始。
- `total` 是过滤条件下的总条数，不是当前页条数。
- `totalPages` 由 `total/pageSize` 得出。
- 同一列表不能一部分场景返回裸数组、另一部分返回分页对象。

### 非分页集合

配置项、枚举型数据或有明确小规模上限的集合可以返回裸数组或 `{ items }`。endpoint
必须明确选择其一；一旦公开，迁移需按兼容性变更处理。

## 3. Command Result Response

用于执行状态机命令、协议写入或可能被业务状态拒绝的操作。

```json
{
  "accepted": false,
  "reason": "ATTEMPT_ALREADY_SUBMITTED",
  "message": "考试已提交，不能继续保存答案",
  "details": {}
}
```

规则：

- `accepted` 表示业务状态机是否接受命令，不等同于 HTTP 请求是否成功传输。
- `accepted:false` 只用于合法、已认证、已解析，但被当前业务状态拒绝的请求。
- 认证失败、参数无效、资源不可见、服务故障等技术/协议错误走 ErrorResponse。
- command 的成功结果可以附带资源、版本、时间戳或专用统计，但必须有 endpoint schema。

详见 [`03-command-result.md`](./03-command-result.md)。

## 4. Empty Response / 204

用于成功完成且调用方不需要响应体的操作。

规则：

- 返回 204 时不得再发送 JSON body。
- OpenAPI 明确标注 no content。
- 不在 200 `{ ok: true }` 与 204 之间随意切换；改变既有 endpoint 需评估调用方兼容性。
- 删除操作并不天然必须是 204，选择取决于是否需要返回删除结果或审计信息。

## 5. File Response

用于 CSV、Excel 或其他文件下载。

规则：

- 不套 JSON envelope。
- 使用准确的 `Content-Type`。
- 需要下载文件名时设置 `Content-Disposition`。
- OpenAPI 在对应 status 下声明 media type；错误 status 仍使用 JSON ErrorResponse。
- 文件内容和动态 CandidateField 列应遵守数据导出与权限规则。

## 6. Batch Operation Result / Import Result

用于批量导入、批量操作等"部分成功"语义的 endpoint。

```json
{
  "created": 5,
  "updated": 3,
  "skipped": 1,
  "failed": 2,
  "errors": [
    {
      "row": 3,
      "code": "DUPLICATE_IDENTIFIER",
      "message": "第 3 行标识符重复"
    }
  ]
}
```

规则：

- 响应使用 200（即使是部分失败），因为批量操作的结果是"成功处理了请求并返回汇总"。
- 顶层的 `created`/`updated`/`skipped`/`failed` 必须为非负整数，且 `created + updated + skipped + failed` 等于总行数。
- `errors` 数组中每个元素必须有 `row`（行号）、`code`（稳定机器码）和 `message`（人类可读文案）。
- 如果整个请求在进入行级处理前就失败（如文件格式错误、权限不足），走 ErrorResponse。
- 这是 Command Result 的子类：操作本身被接受（HTTP 200），但行级结果包含失败。
- endpoint 必须在 schema 中声明完整结构，不得用裸 `{ success, message }` 替代。

## 7. Error Response

用于请求不能按 contract 正常处理的情况。

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

规则见 [`02-error-response.md`](./02-error-response.md)。

## 选择表

| 场景 | 响应类型 |
| --- | --- |
| 获取单个 exam | Resource Response |
| 创建 question | Resource Response |
| 分页查询 users | List Response |
| 小规模配置列表 | 明确的非分页 List Response |
| save answer 业务拒绝 | Command Result Response |
| 批量导入 candidates | Batch Operation Result / Import Result |
| 参数校验失败 | Error Response |
| 删除成功且无需 body | 204 |
| 导出 CSV | File Response |

## HTTP Status 总规则

| Status | 语义 | 适用 Response Shape |
| ---: | --- | --- |
| 200 | 成功读取、更新、列表查询、Command Result（含 accepted:false）或文件下载 | Resource / List / Command Result / File |
| 201 | 资源创建成功 | Resource |
| 204 | 成功完成但无响应体 | 无 body |
| 400 | 请求结构或字段校验失败 | ErrorResponse |
| 401 | 未认证或凭据无效 | ErrorResponse |
| 403 | 已认证但无权限 | ErrorResponse |
| 404 | 资源不存在或按安全策略隐藏 | ErrorResponse |
| 409 | 资源状态冲突（除非 endpoint 明确选择 200 Command Result） | ErrorResponse |
| 429 | 限流 | ErrorResponse |
| 500 | 未预期服务端错误 | ErrorResponse |

规则：

- status 表示 HTTP/协议层结果，code 表示稳定错误类别。
- 相同 code 应尽量使用相同 status。
- 404 可同时承担"资源不存在"和"跨租户不可见"，避免泄露资源存在性。
- 500 统一返回安全文案和 requestId，详细错误只进入日志。
- 204 必须无 body，不得返回 `{ ok: true }`。
- `accepted:false` 使用 200，不得用 4xx/5xx 表示业务拒绝。

## 不允许的混淆

- 用 `message` 文案代替 `code` / `reason`。
- 用 `accepted:false` 表示未认证、JSON 解析失败或服务端异常。
- 文件成功响应套 JSON，再把文件放进字符串字段。
- 204 同时返回 `{ ok: true }`。
- 把所有资源响应改成 `{ data, error, meta }` 作为本阶段目标。
