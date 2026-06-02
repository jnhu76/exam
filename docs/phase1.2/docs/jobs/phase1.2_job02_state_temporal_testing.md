# Phase1.2 Job02 - 状态时序测试

## 概述

本任务旨在实现状态时序测试，验证系统在各种状态转换下的行为，特别是考试状态生命周期的正确性。

## 测试目标

- 验证系统在各种状态转换下的行为
- 测试考试状态生命周期
- 确保状态转换的一致性和正确性
- 发现潜在的状态转换问题

## 测试范围

### 1. 考试状态生命周期

- 考试创建 → 草稿
- 考试草稿 → 发布
- 考试发布 → 开始
- 考试开始 → 进行中
- 考试进行中 → 提交
- 考试提交 → 批改
- 考试批改 → 已完成

### 2. 边界状态转换

- 考试创建 → 删除
- 考试发布 → 删除
- 考试进行中 → 中断
- 考试中断 → 恢复
- 考试进行中 → 超时

### 3. 考生状态管理

- 考生报名 → 未开始
- 考生未开始 → 开始考试
- 考生开始考试 → 考试中
- 考生考试中 → 交卷
- 考生交卷 → 成绩查询

## 测试工具

- **State Machine Testing Framework**: 用于状态时序测试
- **Vitest**: 用于单元测试
- **@xstate/test**: XState 测试库（如果使用状态机）

## 测试设计

### 状态模型

使用状态机定义考试状态：

```typescript
import { createMachine } from "xstate";

export const examStateMachine = createMachine({
  id: "exam",
  initial: "draft",
  states: {
    draft: {
      on: {
        PUBLISH: "published",
        DELETE: "deleted",
      },
    },
    published: {
      on: {
        START: "inProgress",
        DELETE: "deleted",
        EDIT: "draft",
      },
    },
    inProgress: {
      on: {
        SUBMIT: "submitted",
        INTERRUPT: "disrupted",
        TIMEOUT: "timedOut",
      },
    },
    disrupted: {
      on: {
        RECOVER: "inProgress",
        SUBMIT: "submitted",
      },
    },
    timedOut: {
      type: "final",
    },
    submitted: {
      on: {
        GRADE: "graded",
      },
    },
    graded: {
      type: "final",
    },
    deleted: {
      type: "final",
    },
  },
});
```

### 测试场景

每个状态转换都需要测试：

1. 成功转换
2. 失败转换
3. 边界条件
4. 错误处理

## 测试文件结构

```
packages/domain/src/__tests__/
├── state-machine.spec.ts
├── exam-state.spec.ts
└── candidate-state.spec.ts
```

## 测试原则

1. **状态隔离**: 每个测试应该从已知的初始状态开始
2. **明确的断言**: 每个测试应该有明确的状态断言
3. **边界测试**: 测试边界状态转换
4. **错误处理**: 测试错误状态转换

## 任务完成标准

- 所有状态转换都有对应的测试
- 边界状态转换都有测试
- 测试覆盖率达到预期目标
- 测试报告和分析结果可用
