# Review Context Pack

## 1. What Was Implemented

`<short summary>`

## 2. PR Boundary

### Primary Goal

`<primary goal>`

### In Scope

- `<in scope item>`

### Out of Scope

- `<out of scope item>`

### Allowed Files

```text
<path>
```

### Forbidden Expansion

Reviewer must not require this PR to handle:

- `<forbidden expansion>`

### Merge Gate

- `<merge gate>`

## 3. Loaded Review Profiles

- `docs/ai/review-profiles/<profile>.md`

Relevant sections only:

- `<section>`

## 4. Git Range

- Base: `<base>`
- Head: `<head>`

Changed files:

```text
<git diff --name-only>
```

Diff stat:

```text
<git diff --stat>
```

## 5. Required Review Focus

Reviewer must check:

- `<risk area>`

## 6. Forbidden Review Expansion

Do not turn these into current PR blockers:

- `<deferred area>`

## 7. Required Finding Format

| 文件/位置 | 问题 | 严重程度 | 当前 PR 引入？ | 是否 blocking | 处理决策 | 最小修复 |
|---|---|---|---|---|---|---|

Allowed decisions:

- `Fix now`
- `Add test now`
- `Defer issue`
- `Investigate`
- `Reject`

## 8. Decision Rules

- Current PR introduced correctness / security / data integrity bug -> `Fix now`
- Current PR introduced behavior or error contract without tests -> `Add test now`
- Real issue outside current PR boundary -> `Defer issue`
- Insufficient evidence -> `Investigate`
- False positive, over-classified, or not applicable -> `Reject`

## 9. Handoff

Now use superpowers `requesting-code-review` with this Review Context Pack.
Do not use the full conversation history as review context.
Do not expand beyond the PR Boundary Doc.
