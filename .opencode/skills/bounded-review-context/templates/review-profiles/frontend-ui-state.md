# Review Profile: Frontend UI State

## 1. Applicable Scope

本 profile 适用于：

- React / Preact / Signals UI 状态；
- async UI action；
- websocket / streaming / task recovery；
- stale closure；
- loading / disabled / optimistic update；
- error boundary 与 toast。

典型路径：

- `frontend/src/**`
- `frontend/src/features/**`
- `frontend/src/contexts/**`
- `*.test.tsx`

## 2. Core Risk Areas

### 2.1 Stale State / Race

重点检查：

- async callback 是否捕获旧 state；
- websocket reconnect 后本地状态是否过期；
- loading / stopping / streaming 状态是否能恢复；
- 用户重复点击是否造成重复提交。

危险模式：

```ts
setState({ ...state, value });
await action();
setLoading(false);
```

要求：

- 使用 functional update 或明确状态来源；
- async action 失败必须恢复 UI；
- terminal state 与 local pending state 要有清理逻辑。

### 2.2 Optimistic UI / Recovery

重点检查：

- optimistic update 失败是否回滚；
- reconnect 后是否以 server state 为准；
- stale stream / stale task 是否被终结；
- stop/cancel 操作是否处理 ack 缺失。

### 2.3 Test Contract

重点检查：

- 是否覆盖 ack payload 为空；
- 是否覆盖 reconnect；
- 是否覆盖 stop/cancel 后 stale state；
- 是否覆盖 repeated click；
- 是否覆盖 server error。

## 3. Known Historical Failure Patterns

- ack payload 为空时访问 `response.success` 导致 promise 不 resolve；
- stale streaming 被错误标记为 completed；
- recovery 后 UI 仍处于 loading / stopping；
- 测试没有覆盖 reconnect 后状态重建。

## 4. Review Output Requirement

| 文件/位置 | 问题 | 严重程度 | 当前 PR 引入？ | 是否 blocking | 处理决策 | 最小修复 |
|---|---|---|---|---|---|---|

处理决策只能是：

- `Fix now`
- `Add test now`
- `Defer issue`
- `Investigate`
- `Reject`
