# Command Result

## 定义

Command Result 用于有明确状态机或并发协议的 endpoint。它描述“命令是否被当前业务状态
接受”，而不是描述 HTTP 请求是否成功到达服务器。

## 通用拒绝形态

```json
{
  "accepted": false,
  "reason": "ATTEMPT_ALREADY_SUBMITTED",
  "message": "考试已提交，不能继续保存答案",
  "details": {}
}
```

规则：

- `accepted`：命令是否被业务状态机接受。
- `reason`：稳定机器码，前端和测试依赖它。
- `message`：默认 zh-CN 人类可读文案。
- `details`：冲突信息、`serverVersion`、`serverAnswer`、允许状态等结构化上下文。
- 不得把 `"Server has newer version"` 之类自然语言作为机器判断依据。

## Save Answer

Save answer 是 Command Result 的首个迁移目标，因为 autosave 需要把可恢复的业务拒绝
作为正常协议分支处理。

### Accepted

```json
{
  "accepted": true,
  "serverVersion": 2,
  "savedAt": "2026-06-12T08:00:00.000Z"
}
```

### Rejected

```json
{
  "accepted": false,
  "reason": "ANSWER_VERSION_CONFLICT",
  "message": "服务器上存在更新的答案版本",
  "serverVersion": 5,
  "details": {
    "serverAnswer": true
  }
}
```

推荐 reason：

- `ATTEMPT_ALREADY_SUBMITTED`
- `ATTEMPT_NOT_IN_PROGRESS`
- `ANSWER_VERSION_CONFLICT`
- `QUESTION_NOT_IN_EXAM`
- `ATTEMPT_DEADLINE_EXCEEDED`，仅当 endpoint contract 明确把 deadline 作为可恢复拒绝

### HTTP 语义

Save answer 适合 `HTTP 200 + accepted:false`：

- 请求已认证、格式合法、目标 attempt 可见。
- 服务端已完成版本/状态检查。
- 调用方应基于 reason 合并、停止重试或刷新 attempt。

以下情况仍应返回 ErrorResponse：

- 401/403：认证或权限失败
- 400：请求结构无效、path/body identifier 不一致
- 404：attempt 不存在或不可见
- 429：限流
- 500：服务端错误

## Submit Attempt

Submit 的状态冲突有两种可接受设计：

1. `409 + ErrorResponse`
2. `200 + accepted:false` Command Result

本阶段不替代码作最终选择。A01 必须根据以下因素固定单一 endpoint contract：

- 是否把重复 submit 定义为幂等成功、业务拒绝或冲突错误。
- Web UI 在 flush 后如何处理 deadline 与已提交状态。
- 外部调用方是否已经依赖当前 409。
- grading 是否同步发生，以及 accepted 成功分支返回 attempt 资源还是 command receipt。

同一 endpoint 不得在没有 schema 区分的情况下随机使用两种设计。

## OpenAPI 要求

每个 command endpoint 必须：

- 定义 accepted true 分支。
- 定义 accepted false 分支。
- 让 `accepted` 成为可判别字段。
- 对 `reason` 尽量使用 enum。
- 另行声明 400/401/403/404/409/429/500 等 ErrorResponse。

## Client 与测试规则

- 前端使用 `accepted` 决定成功/拒绝，使用 `reason` 决定恢复动作。
- 前端可以直接展示 `message`，但不得解析 message。
- 测试必须断言 `accepted`、`reason` 和关键 `details`。
- 除专门的 copy 测试外，不精确绑定完整中文句子。
- 版本冲突测试必须断言 server version/answer 的结构，而不只断言出现“冲突”文字。
