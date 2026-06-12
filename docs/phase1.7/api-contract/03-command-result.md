# Command Result

## 定义

Command Result 用于有明确状态机或并发协议的 endpoint。它描述“命令是否被当前业务状态
接受”，而不是描述 HTTP 请求是否成功到达服务器。

## 通用拒绝形态

```typescript
type CommandResultRejected = {
  accepted: false;
  reason: string;
  message: string;
  details?: unknown;
};
```

endpoint 可以把高频字段提升到顶层（如 `serverVersion`、`savedAt`），但必须在 endpoint contract 中明确声明。

规则：

- `accepted`：命令是否被业务状态机接受。
- `reason`：稳定机器码，前端和测试依赖它。
- `message`：默认 zh-CN 人类可读文案。
- `details`：额外结构化上下文（如 `serverAnswer`、允许状态等）；endpoint schema 可将高频字段（如 `serverVersion`）提升至顶层。
- 不得把 `"Server has newer version"` 之类自然语言作为机器判断依据。

## Save Answer

Save answer 是 Command Result 的首个迁移目标，因为 autosave 需要把可恢复的业务拒绝
作为正常协议分支处理。

### Wire Types

```typescript
type SaveAnswerAccepted = {
  accepted: true;
  serverVersion: number;
  savedAt: string;
};

type SaveAnswerRejected = {
  accepted: false;
  reason: SaveAnswerRejectReason;
  message: string;
  serverVersion?: number;
  savedAt?: string;
  details?: {
    serverAnswer?: unknown;
    serverVersion?: number;
  };
};
```

### Accepted 示例

```json
{
  "accepted": true,
  "serverVersion": 2,
  "savedAt": "2026-06-12T08:00:00.000Z"
}
```

Accepted 分支不含 `conflict` 字段。

### Rejected 示例

```json
{
  "accepted": false,
  "reason": "STALE_VERSION",
  "message": "服务器上存在更新的答案版本",
  "serverVersion": 5,
  "details": {
    "serverAnswer": true
  }
}
```

Rejected 分支规则：

- `reason`：稳定机器码，前端和测试依赖它做分支处理。
- `message`：默认 zh-CN 人类可读文案，来自 message registry。
- `serverVersion`/`savedAt`：可选提升字段，当拒绝原因携带服务端版本信息时提供。
- `details`：可选结构化上下文（如 `serverAnswer`、`serverVersion`）。

### Reason Enum

Save answer rejected 的 reason 枚举（与 `packages/contracts/src/attempt.ts` 当前实现一致）：

```typescript
type SaveAnswerRejectReason =
  | "STALE_VERSION"
  | "ATTEMPT_ALREADY_SUBMITTED"
  | "ATTEMPT_CLOSED"
  | "DEADLINE_EXCEEDED";
```

来源对应（code → 实际使用位置）：

| Reason | 含义 | 来源 |
| --- | --- | --- |
| `STALE_VERSION` | 客户端 baseVersion 落后于服务端 | `answerProtocol.ts` version check |
| `ATTEMPT_ALREADY_SUBMITTED` | attempt 已提交，不能再保存 | `answerProtocol.ts` state check |
| `ATTEMPT_CLOSED` | attempt 已关闭 | `answerProtocol.ts` state check |
| `DEADLINE_EXCEEDED` | 考试截止时间已过 | `answerProtocol.ts` deadline check |

**注意**：`errors.ts` 中存在 `ANSWER_VERSION_CONFLICT` 和 `ATTEMPT_DEADLINE_EXCEEDED`，它们用于 submit 的 409 ErrorResponse（不是 save 的 Command Result）。Command Result 路径和 ErrorResponse 路径的 code 可以不同，但同一文档内不应混用。

### Reason Migration（如需改名）

如果未来需要改名（如 `STALE_VERSION` → `ANSWER_VERSION_CONFLICT`），必须：

1. 建立 migration table 记录 old → new 映射。
2. 评估 breaking change 影响面（前端、测试、客户端脚本）。
3. 走 A01 Job 的完整验收流程。
4. A01 阶段不改名，直接使用当前实现已有的 reason。

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

**固定语义：submit 冲突使用 `409 + ErrorResponse`。**

选择理由：

1. submit 是最终状态迁移操作。失败不是"可恢复的业务拒绝"，而是命令执行失败。HTTP 409 正确表达"状态冲突导致命令无法执行"。
2. Web UI 在 S03b flush 后，如果 submit 仍然 409（deadline 或 double submit），应展示错误并允许用户重试或放弃，不需要像 autosave 那样执行冲突恢复。
3. 当前前端和测试已经依赖 409 + error.code 语义。改为 200 + accepted:false 会破坏现有行为且无收益。
4. grading 同步发生在 submit 成功后；成功分支返回 attempt 资源（graded 状态），不是 command receipt。

save answer 与 submit 的区别总结：

| 方面 | save answer | submit attempt |
| --- | --- | --- |
| 冲突性质 | 乐观并发冲突，可恢复 | 状态迁移失败，不可恢复 |
| HTTP status | 200 | 409 |
| 响应类型 | Command Result | ErrorResponse |
| 调用方动作 | 合并/刷新/停止重试 | 展示错误/重试/放弃 |
| 成功返回数据 | serverVersion, savedAt | attempt resource (graded) |
| 失败返回数据 | reason, message, details? | error.code, error.message |

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
