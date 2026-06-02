# Phase1.2 Job01 - E2E 交互测试

## 概述

本任务旨在创建完整的集成级 E2E 交互测试套件，使用 Vitest + Testing Library + MSW 框架覆盖系统的主要用户流程。测试在 jsdom 环境中运行，无需真实浏览器，完全兼容 WSL 和 headless Linux 环境。

## 测试目标

- 覆盖主要用户流程
- 验证用户界面的交互和响应
- 在 jsdom 模拟环境中验证系统功能正确性
- 通过 MSW 模拟 API 层实现前后端集成测试
- 提供可重复的测试套件

## 测试范围

### 1. 登录/登出流程

- 正确登录
- 错误密码登录
- 空用户名/密码登录
- 登录后跳转到正确页面
- 登出功能

### 2. 考试管理流程

- 管理员创建考试
- 管理员发布考试
- 管理员编辑考试
- 管理员结束考试
- 管理员查看考试详情

### 3. 考生流程

- 考生报名考试
- 考生进入考试
- 考生答题
- 考生交卷
- 考生查看成绩

### 4. 成绩管理流程

- 教师批改试卷
- 教师查看答卷详情
- 教师导出成绩
- 教师查看考生列表

## 测试工具

- **Vitest**: 测试运行器（已有）
- **Testing Library** (`@testing-library/react`, `@testing-library/user-event`): 组件渲染和用户交互模拟（已有）
- **MSW** (`msw`): API 请求拦截和模拟（需新增）
- **jsdom**: DOM 环境（已有）

## 测试环境

- jsdom（Vitest 内置，无需真实浏览器）
- 兼容 WSL、headless Linux、CI 环境

## 测试文件结构

```
apps/web/src/__tests__/integration/
├── login.integration.test.tsx
├── exam-management.integration.test.tsx
├── candidate.integration.test.tsx
├── grading.integration.test.tsx
└── fixtures/
    ├── msw-handlers.ts       # MSW 请求处理器
    ├── msw-server.ts         # MSW 服务端设置
    ├── test-data.ts          # 测试数据
    └── helpers.ts            # 测试辅助函数
```

## 测试设计原则

1. **独立测试**: 每个测试场景应该是独立的，MSW handlers 在每个测试前后重置
2. **可重复**: 测试应该可以多次运行而不影响结果
3. **明确的断言**: 每个测试应该有明确的断言
4. **错误处理**: 测试应该验证错误处理的正确性
5. **性能考虑**: 测试应该尽可能高效地运行（jsdom 比真实浏览器快）
6. **API 隔离**: 通过 MSW mock API 层，前后端解耦测试

## 测试执行

### 本地执行

```bash
pnpm --filter @exam/web test                 # 所有测试（含集成测试）
pnpm --filter @exam/web test -- --testPathPattern="integration"  # 仅集成测试
```

### CI/CD 执行

测试将在 CI/CD 流程中自动执行，包括：

- 每个提交
- 每个 PR
- 每日定时执行

## MSW 使用模式

```typescript
// fixtures/msw-handlers.ts - 定义 API mock
import { http, HttpResponse } from "msw";
import { AUTH_API } from "@/lib/api-client";

export const authHandlers = [
  http.post(`${AUTH_API}/login`, async ({ request }) => {
    const body = await request.json();
    if (body.username === "admin" && body.password === "password") {
      return HttpResponse.json({
        token: "mock-token",
        user: { role: "admin" },
      });
    }
    return HttpResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }),
];
```

```typescript
// 测试文件示例
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from '@/pages/LoginPage';
import { server } from './fixtures/msw-server';

beforeEach(() => server.resetHandlers());
afterAll(() => server.close());

test('登录成功后跳转', async () => {
  render(<LoginPage />);
  await userEvent.type(screen.getByLabelText(/用户名/), 'admin');
  await userEvent.type(screen.getByLabelText(/密码/), 'password');
  await userEvent.click(screen.getByRole('button', { name: /登录/ }));
  await waitFor(() => {
    expect(screen.getByText(/欢迎/)).toBeInTheDocument();
  });
});
```

## 报告和分析

- 生成详细的测试报告
- 收集测试覆盖率数据
- 分析测试结果和失败原因
- 提供修复建议

## 任务完成标准

- 所有主要用户流程都有对应的集成级 E2E 测试
- MSW handlers 覆盖所有相关 API 端点
- 测试在 jsdom 环境中全部通过（兼容 WSL）
- 测试覆盖率达到预期目标
- 测试报告和分析结果可用

## 需新增依赖

```
msw  # API 请求模拟（仅 devDependencies）
```
