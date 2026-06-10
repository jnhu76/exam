# Review Profile: State Machine

## 1. Applicable Scope

本 profile 适用于：

- exam / attempt / task 状态机；
- command handler；
- transition function；
- recovery / stale state；
- invalid transition test。

典型路径：

- `packages/exam-engine/src/**`
- `frontend/src/features/**/state/**`
- `*.test.ts`

## 2. Core Risk Areas

### 2.1 Transition Integrity

重点检查：

- 是否绕过 `transition()` 直接写状态；
- 是否跳过中间状态；
- terminal state 是否还能变化；
- invalid transition 是否抛具体错误类型。

危险模式：

```ts
transition(attempt.status, "grade");
await attemptRepo.update(id, { status: "graded" });
```

要求：

- 状态变化必须符合 transition table；
- 如果存在中间状态，测试应验证中间状态的写入契约；
- 不能只验证最终状态。

### 2.2 Repository Update Contract

状态机 command 中的 repo update 必须处理 null：

```ts
const updated = await repo.update(id, patch);
if (!updated) throw new ValidationError(...);
```

新增 null 分支必须有测试。

### 2.3 Test Contract

重点检查：

- `rejects.toThrow()` 是否太宽；
- 是否断言 `InvalidStateTransitionError` / `ValidationError`；
- 是否覆盖 update 返回 null；
- 是否覆盖状态已 terminal 的情况；
- 是否覆盖状态恢复 / stale state。

## 3. Known Historical Failure Patterns

- 测试只断言最终 `graded`，没有检查中间 `grading`；
- `repo.update()` 返回 null 分支新增后缺少回归测试；
- `rejects.toThrow()` 太泛，可能掩盖错误类型变化。

## 4. Review Output Requirement

| 文件/位置 | 问题 | 严重程度 | 当前 PR 引入？ | 是否 blocking | 处理决策 | 最小修复 |
|---|---|---|---|---|---|---|

处理决策只能是：

- `Fix now`
- `Add test now`
- `Defer issue`
- `Investigate`
- `Reject`
