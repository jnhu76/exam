# Phase1.2 Job04 - 冒烟测试

## 概述

本任务旨在创建快速验证系统核心功能的冒烟测试套件，用于每次部署后的快速验证。

## 测试目标

- 快速验证系统核心功能
- 提供部署后的快速反馈
- 检测严重的功能问题
- 确保系统的基本可用性

## 测试原则

### 1. 核心功能覆盖

只测试系统的核心功能，忽略次要功能。

### 2. 快速执行

测试套件应该能够在短时间内完成执行，通常在 5-10 分钟内。

### 3. 高风险优先

优先测试高风险功能和模块。

### 4. 稳定性

测试用例应该稳定可靠，减少误报。

### 5. 维护成本

测试套件应该易于维护，避免复杂的测试场景。

## 测试范围

### 1. 核心功能

- 用户登录/登出
- 考试创建和发布
- 考生报名和考试
- 成绩查询

### 2. 核心接口

- 登录接口
- 考试列表接口
- 题目接口
- 成绩接口

### 3. 系统可用性

- 系统响应时间
- 页面加载时间
- 服务器健康检查

## 测试设计

### 测试场景

1. **用户登录**: 测试用户是否能够正常登录系统
2. **考试创建**: 测试管理员是否能够创建和发布考试
3. **考生报名**: 测试考生是否能够报名考试
4. **考试进行**: 测试考生是否能够正常进行考试
5. **成绩查询**: 测试考生是否能够查询成绩
6. **系统健康**: 测试系统的基本健康状态

### 测试用例

每个测试场景只包含最基本的测试步骤，避免复杂的操作。

## 测试工具

- **Vitest**: 用于单元测试和集成测试
- **Playwright**: 用于简单的 E2E 测试
- **Supertest**: 用于 API 测试
- **Health Check**: 用于系统健康检查

## 测试文件结构

```
apps/web/src/__tests__/
├── smoke/
│   ├── login.spec.ts
│   ├── exam.spec.ts
│   ├── candidate.spec.ts
│   └── grading.spec.ts
└── api/
    ├── health.spec.ts
    └── core-endpoints.spec.ts
```

## 测试执行

### 本地执行

```bash
cd apps/web
npm run test:smoke
```

### CI/CD 执行

测试将在 CI/CD 流程中自动执行：

- 每个提交后执行 API 冒烟测试
- 每个部署后执行完整的冒烟测试
- 每日定时执行

## 测试报告

- 生成简单的测试报告
- 包含测试结果和执行时间
- 提供失败测试的详细信息

## 任务完成标准

- 所有核心功能都有对应的冒烟测试
- 测试套件能够在 10 分钟内完成执行
- 测试覆盖率达到预期目标
- 测试报告清晰易读
- 测试在 CI/CD 流程中稳定执行

## 示例测试用例

```typescript
import { describe, it, expect } from 'vitest';
import { app } from '../src/app';
import request from 'supertest';

describe('API 冒烟测试', () => {
  it('应该能够访问健康检查接口', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('应该能够获取考试列表', async () => {
    const response = await request(app).get('/api/exams');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('应该能够登录系统', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'admin',
        password: 'password'
      });
    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
  });
});
```
