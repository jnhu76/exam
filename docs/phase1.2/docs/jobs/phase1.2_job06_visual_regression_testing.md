# Phase1.2 Job06 - 视觉/回归测试

## 概述

本任务旨在配置视觉回归测试工具，用于比较系统在不同版本之间的视觉差异，防止 UI 回归。

## 测试目标

- 检测 UI 组件的视觉变化
- 防止 UI 回归
- 验证用户界面的一致性
- 确保设计规范的遵循

## 测试原理

视觉回归测试通过比较页面截图来检测 UI 变化：
1. 在基准版本上捕获页面截图
2. 在新版本上捕获相同页面的截图
3. 比较两幅截图的差异
4. 标记显著的差异

## 测试范围

### 1. 核心页面

- 登录页面
- 仪表盘页面
- 考试管理页面
- 考生答题页面
- 成绩查询页面

### 2. 常用组件

- 按钮和链接
- 表单和输入框
- 卡片和表格
- 弹窗和对话框
- 导航栏和菜单

### 3. 响应式设计

- 不同屏幕尺寸的视觉效果
- 移动设备和桌面设备的差异

## 测试工具

### 1. JavaScript/TypeScript 工具

- **Playwright**: 支持视觉回归测试
- **Puppeteer**: 支持页面截图和比较
- **Storybook**: 配合 @storybook/addon-storyshots 进行组件测试
- **BackstopJS**: 专门的视觉回归测试工具

### 2. 其他工具

- **BrowserStack**: 跨浏览器和设备的视觉测试
- **Applitools**: 智能视觉测试平台

## 测试配置

### 使用 Playwright 进行视觉测试

```typescript
import { test, expect } from '@playwright/test';

test('登录页面视觉测试', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveScreenshot('login-page.png', {
    maxDiffPixels: 100,
    maxDiffPixelRatio: 0.1
  });
});

test('仪表盘页面视觉测试', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveScreenshot('dashboard-page.png', {
    mask: [
      page.locator('.dynamic-content') // 忽略动态内容
    ]
  });
});

test('不同屏幕尺寸的视觉测试', async ({ page, viewportSize }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveScreenshot(`dashboard-${viewportSize.width}x${viewportSize.height}.png`);
});
```

### 使用 BackstopJS 进行视觉测试

```javascript
// backstop.config.js
module.exports = {
  id: 'exam-platform-visual-test',
  viewports: [
    {
      label: 'desktop',
      width: 1440,
      height: 900
    },
    {
      label: 'mobile',
      width: 375,
      height: 667
    }
  ],
  scenarios: [
    {
      label: 'login',
      url: 'http://localhost:3000/login',
      selectors: ['document'],
      readyEvent: 'DOMContentLoaded',
      delay: 500
    },
    {
      label: 'dashboard',
      url: 'http://localhost:3000/dashboard',
      selectors: ['document'],
      readyEvent: 'DOMContentLoaded',
      delay: 500,
      hideSelectors: ['.dynamic-content']
    }
  ],
  paths: {
    bitmaps_reference: 'backstop_data/bitmaps_reference',
    bitmaps_test: 'backstop_data/bitmaps_test',
    engine_scripts: 'backstop_data/engine_scripts',
    html_report: 'backstop_data/html_report',
    ci_report: 'backstop_data/ci_report'
  },
  engine: 'puppeteer',
  report: ['browser'],
  asyncCaptureLimit: 5,
  asyncCompareLimit: 50,
  debug: false,
  debugWindow: false
};
```

### 使用 Storybook 进行组件测试

```typescript
// .storybook/test-runner.ts
import { TestRunnerConfig } from '@storybook/test-runner';

const config: TestRunnerConfig = {
  async setup() {
    // 配置故事测试
  },
  async preRender(page, context) {
    // 渲染前的操作
  },
  async postRender(page, context) {
    // 渲染后的操作，例如截图
    await page.screenshot({
      path: `screenshots/${context.storyId}.png`
    });
  }
};

export default config;
```

## 测试执行

### 本地执行

#### 使用 Playwright
```bash
cd apps/web
npm run test:visual
```

#### 使用 BackstopJS
```bash
cd apps/web
npm run backstop:reference
npm run backstop:test
npm run backstop:approve
```

#### 使用 Storybook
```bash
cd apps/web
npm run storybook:test
```

### CI/CD 执行

视觉回归测试将在 CI/CD 流程中自动执行：
1. 在基准分支（如 main）上运行并保存基准截图
2. 在 PR 上运行并与基准截图比较
3. 标记显著的差异

## 测试结果分析

### 自动分析

- 自动比较截图
- 计算差异百分比
- 标记显著差异
- 生成报告

### 人工审核

- 审核差异报告
- 确认真实的 UI 变化
- 标记已知差异为可接受

### 处理差异

- 对于真实的 UI 变化，更新基准截图
- 对于回归问题，修复代码
- 对于误报，调整比较参数

## 任务完成标准

- 核心页面和组件都有对应的视觉测试
- 测试能够稳定运行
- 差异报告清晰易读
- 测试在 CI/CD 流程中稳定执行

## 注意事项

- 视觉测试可能会产生误报（如动态内容）
- 应该使用适当的差异阈值
- 应该定期更新基准截图
- 应该处理动态内容的差异
- 应该在稳定的环境中执行

## 示例报告

视觉回归测试将生成详细的报告，包括：
1. 截图对比
2. 差异区域高亮
3. 差异百分比
4. 测试结果统计
