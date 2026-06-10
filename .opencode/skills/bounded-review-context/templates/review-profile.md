# Review Profile: <profile-name>

## 1. Applicable Scope

This profile applies to:

- `<module type>`
- `<path pattern>`
- `<risk area>`

## 2. Technology Context

Relevant stack:

- `<technology>`
- `<technology>`
- `<technology>`

## 3. Core Risk Areas

### 3.1 <Risk Area Name>

Check:

- `<check item>`
- `<check item>`

Dangerous pattern:

```ts
<dangerous pattern>
```

Requirement:

- `<requirement>`
- `<requirement>`

### 3.2 <Risk Area Name>

Check:

- `<check item>`
- `<check item>`

Dangerous pattern:

```ts
<dangerous pattern>
```

Requirement:

- `<requirement>`
- `<requirement>`

## 4. Known Historical Failure Patterns

Confirmed long-lived project risks:

- `<failure pattern>`
- `<failure pattern>`

Do not record one-off PR tasks or unverified findings here.

## 5. Test Contract

Check whether tests cover:

- null return;
- DB error;
- async rejection;
- dialect branch;
- specific error class;
- concurrency / stale state / recovery / import / batch scenarios.

Dangerous pattern:

```ts
await expect(fn()).rejects.toThrow();
```

Preferred:

```ts
await expect(fn()).rejects.toThrow(SpecificDomainError);
```

## 6. Review Output Requirement

When this profile is loaded, reviewer must output:

| 文件/位置 | 问题 | 严重程度 | 当前 PR 引入？ | 是否 blocking | 处理决策 | 最小修复 |
|---|---|---|---|---|---|---|

Allowed decisions:

- `Fix now`
- `Add test now`
- `Defer issue`
- `Investigate`
- `Reject`

## 7. Scope Discipline

Do not:

- mark historical debt as current PR blocker;
- mark Critical without evidence;
- require broad refactors for performance debt;
- put architecture speculation into the current PR;
- store false positives as long-lived rules;
- load unrelated profile sections.
