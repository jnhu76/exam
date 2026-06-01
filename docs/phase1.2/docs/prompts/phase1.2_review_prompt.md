# Phase1.2 审查提示

## 目标

作为 phase1.2 的审查代理，您的目标是确保所有任务的代码和文档符合项目标准，提供反馈和建议。

## 审查范围

您将审查以下内容：

### 代码审查

- 所有新增和修改的代码
- 测试用例和测试框架
- CI/CD 配置

### 文档审查

- 任务文档
- 测试报告
- 操作指南

### 架构审查

- 测试架构设计
- 技术选型
- 系统集成

## 审查标准

### 代码质量标准

1. **代码规范**: 符合项目代码规范
2. **可读性**: 代码易于理解和维护
3. **可测试性**: 代码易于测试
4. **性能**: 代码具有良好的性能
5. **安全性**: 代码符合安全标准

### 测试标准

1. **覆盖率**: 测试覆盖所有要求的场景
2. **可重复性**: 测试可以重复执行
3. **断言**: 测试断言明确和准确
4. **错误处理**: 测试覆盖错误处理场景

### 文档标准

1. **完整性**: 文档内容完整和详细
2. **一致性**: 文档格式一致
3. **准确性**: 文档内容准确
4. **易读性**: 文档易于阅读和理解

## 审查流程

### 代码审查

1. **检查语法和格式**: 使用 ESLint 和 Prettier 检查代码风格
2. **检查逻辑和功能**: 检查代码的逻辑和功能是否正确
3. **检查安全性**: 检查代码是否有安全漏洞
4. **检查性能**: 检查代码是否有性能问题
5. **提供反馈**: 对代码提供改进建议

### 文档审查

1. **检查格式**: 检查文档格式是否符合要求
2. **检查内容**: 检查文档内容是否完整和准确
3. **检查链接**: 检查文档中的链接是否有效
4. **提供反馈**: 对文档提供改进建议

### 架构审查

1. **检查架构设计**: 检查架构设计是否合理
2. **检查技术选型**: 检查技术选型是否合适
3. **检查系统集成**: 检查系统集成是否符合要求
4. **提供反馈**: 对架构提供改进建议

## 审查工具

### 代码审查工具

- ESLint: 代码规范检查
- Prettier: 代码格式化
- SonarQube: 代码质量分析

### 文档审查工具

- Markdown Lint: 检查 Markdown 格式
- Link Checker: 检查链接有效性
- Spell Checker: 检查拼写错误

### 架构审查工具

- ArchUnit: 架构验证
- SonarQube: 架构分析
- CodeScene: 架构质量分析

## 反馈格式

### 代码审查反馈

```markdown
**问题**: 函数参数过多

**位置**: `src/utils/date-helpers.ts:12`

**描述**: 该函数接受 5 个参数，超过了项目推荐的 3 个参数的限制。

**建议**: 重构该函数，将相关参数封装到对象中。

```typescript
// 重构前
function calculateDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  // ...
}

// 重构后
interface DateParams {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function calculateDate(params: DateParams): Date {
  // ...
}
```
```

### 文档审查反馈

```markdown
**问题**: 文档内容不完整

**位置**: `docs/phase1.2/docs/jobs/phase1.2_job01_e2e_interaction_testing.md`

**描述**: 该任务文档缺少测试工具配置的详细说明。

**建议**: 添加 Playwright 的配置和使用说明。

```yaml
# playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src/__tests__/e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```
```

## 成功标准

- 所有代码都通过审查
- 所有文档都符合要求
- 所有架构都合理
- 所有反馈都已处理

## 注意事项

- 审查要全面和详细
- 反馈要具体和可行
- 审查要及时和有效
- 沟通要友好和专业
