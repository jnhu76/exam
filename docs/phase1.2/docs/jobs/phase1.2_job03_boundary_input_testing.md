# Phase1.2 Job03 - 边界输入测试

## 概述

本任务旨在编写边界输入条件的测试用例，验证系统在各种边界条件下的稳定性和正确性。

## 测试目标

- 测试各种边界输入条件
- 验证系统的数据验证和错误处理
- 发现潜在的边界条件问题
- 提高系统的鲁棒性

## 测试范围

### 1. 文本输入边界

- 空字符串输入
- 超长文本输入（超过字段限制）
- 特殊字符输入（包括 emoji、HTML 标签、SQL 注入式字符串）
- 空格和换行符输入
- Unicode 字符输入

### 2. 数值输入边界

- 最小值输入
- 最大值输入
- 零值输入
- 负数输入
- 小数输入（包括异常格式的小数）
- 超大数值输入

### 3. 日期时间输入边界

- 未来日期输入
- 过去日期输入
- 无效日期格式输入
- 时间戳边界值

### 4. 文件上传边界

- 空文件上传
- 超大文件上传（超过限制大小）
- 不支持的文件格式
- 文件内容边界测试

### 5. 数组和列表边界

- 空数组输入
- 超大数组输入
- 重复值输入
- 无效格式的数组

### 6. 组合边界条件

- 多个字段同时为边界值
- 边界值与正常值混合输入
- 边界条件的组合测试

## 测试方法

### 等价类划分

将输入数据分为有效等价类和无效等价类，测试每个等价类的边界值。

### 边界值分析

对每个字段的边界值进行测试：

- 最小值
- 最小值-1
- 最小值+1
- 最大值
- 最大值-1
- 最大值+1
- 空值

### 错误猜测

根据经验和系统特点，猜测可能导致错误的边界条件。

## 测试工具

- **Vitest**: 用于单元测试
- **Zod**: 用于数据验证
- **@faker-js/faker**: 用于生成测试数据

## 测试文件结构

```
packages/contracts/src/__tests__/
├── boundary-input.spec.ts
├── validation.spec.ts
└── helpers/
    ├── boundary-data.ts
    └── faker-helpers.ts
```

## 测试示例

```typescript
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createFaker } from "@faker-js/faker";

const faker = createFaker();

describe("边界输入测试", () => {
  it("应该拒绝空字符串作为用户名", async () => {
    const schema = z.object({
      username: z.string().min(1, "用户名不能为空"),
    });

    await expect(schema.parseAsync({ username: "" })).rejects.toThrow();
  });

  it("应该拒绝过长的用户名", async () => {
    const schema = z.object({
      username: z.string().max(50, "用户名不能超过50个字符"),
    });

    const longUsername = faker.string.alpha(51);
    await expect(
      schema.parseAsync({ username: longUsername }),
    ).rejects.toThrow();
  });

  it("应该拒绝小于0的年龄", async () => {
    const schema = z.object({
      age: z.number().min(0, "年龄不能小于0"),
    });

    await expect(schema.parseAsync({ age: -1 })).rejects.toThrow();
  });

  it("应该拒绝大于150的年龄", async () => {
    const schema = z.object({
      age: z.number().max(150, "年龄不能大于150"),
    });

    await expect(schema.parseAsync({ age: 151 })).rejects.toThrow();
  });
});
```

## 任务完成标准

- 所有输入字段都有对应的边界测试
- 每个边界条件都有至少一个测试用例
- 测试覆盖率达到预期目标
- 测试报告和分析结果可用
