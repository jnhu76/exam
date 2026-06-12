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

## 6. Error Response

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
| 参数校验失败 | Error Response |
| 删除成功且无需 body | 204 |
| 导出 CSV | File Response |

## 不允许的混淆

- 用 `message` 文案代替 `code` / `reason`。
- 用 `accepted:false` 表示未认证、JSON 解析失败或服务端异常。
- 文件成功响应套 JSON，再把文件放进字符串字段。
- 204 同时返回 `{ ok: true }`。
- 把所有资源响应改成 `{ data, error, meta }` 作为本阶段目标。
