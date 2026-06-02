# Phase1.2 Job07 - 集成测试到 CI/CD 流程

## 概述

本任务旨在将所有测试集成到 CI/CD 流程中，确保每次部署和 PR 都经过完整的测试，提高系统的质量和可靠性。

## 测试目标

- 确保每次代码变更都经过测试
- 防止未通过测试的代码进入主分支
- 提供快速的反馈机制
- 自动化测试执行和报告

## 测试阶段

### 1. 提交阶段

- 代码格式检查
- 类型检查
- 单元测试
- 代码质量检查

### 2. PR 阶段

- 所有提交阶段的测试
- 集成测试
- 端到端测试
- 视觉回归测试

### 3. 部署阶段

- 冒烟测试
- 系统健康检查
- 性能测试

## CI/CD 配置

### 使用 GitHub Actions

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main, dev]

jobs:
  # 代码检查阶段
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm ci

      - name: Format check
        run: npm run format:check

      - name: Type check
        run: npm run typecheck

      - name: Lint
        run: npm run lint

  # 单元测试阶段
  unit-test:
    runs-on: ubuntu-latest
    needs: check
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test
        env:
          CI: true

  # 集成测试阶段
  integration-test:
    runs-on: ubuntu-latest
    needs: unit-test
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm ci

      - name: Run integration tests
        run: npm run test:integration
        env:
          CI: true

  # 端到端测试阶段（Playwright）
  e2e-test:
    runs-on: ubuntu-latest
    needs: integration-test
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npm run test:playwright:install

      - name: Run E2E tests
        run: npm run test:e2e
        env:
          CI: true

  # 视觉回归测试阶段
  visual-test:
    runs-on: ubuntu-latest
    needs: e2e-test
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm ci

      - name: Run visual regression tests
        run: npm run test:visual
        env:
          CI: true

  # 部署阶段
  deploy:
    runs-on: ubuntu-latest
    needs: [e2e-test, visual-test]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Deploy to production
        run: npm run deploy
```

### 使用 GitLab CI

```yaml
# .gitlab-ci.yml
image: node:20

stages:
  - check
  - test
  - deploy

# 代码检查阶段
check:
  stage: check
  script:
    - npm ci
    - npm run format:check
    - npm run typecheck
    - npm run lint

# 单元测试阶段
unit-test:
  stage: test
  needs: [check]
  script:
    - npm ci
    - npm run test
  artifacts:
    reports:
      junit: coverage/unit-junit-report.xml

# 集成测试阶段
integration-test:
  stage: test
  needs: [unit-test]
  script:
    - npm ci
    - npm run test:integration
  artifacts:
    reports:
      junit: coverage/integration-junit-report.xml

# 端到端测试阶段
e2e-test:
  stage: test
  needs: [integration-test]
  script:
    - npm ci
    - npm run test:playwright:install
    - npm run test:e2e
  artifacts:
    reports:
      junit: coverage/e2e-junit-report.xml

# 视觉回归测试阶段
visual-test:
  stage: test
  needs: [e2e-test]
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
  script:
    - npm ci
    - npm run test:visual
  artifacts:
    reports:
      junit: coverage/visual-junit-report.xml

# 部署阶段
deploy:
  stage: deploy
  needs: [e2e-test, visual-test]
  rules:
    - if: $CI_COMMIT_BRANCH == 'main' && $CI_PIPELINE_SOURCE == 'push'
  script:
    - npm ci
    - npm run build
    - npm run deploy
```

## 测试报告和通知

### 使用 Allure 报告

```yaml
# GitHub Actions 配置
- name: Generate Allure report
  run: npm run allure:generate

- name: Upload Allure report
  uses: actions/upload-artifact@v4
  with:
    name: allure-report
    path: allure-report

- name: Display Allure report URL
  run: echo "Allure report uploaded to: ${{ steps.upload.outputs.artifact-url }}"
```

### 使用 Slack 通知

```javascript
// .github/workflows/slack-notification.js
const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

const sendSlackNotification = (testResult) => {
  const message = {
    text: "测试结果通知",
    attachments: [
      {
        color: testResult.passed ? "#36a64f" : "#dc3545",
        title: `测试结果: ${testResult.passed ? "通过" : "失败"}`,
        fields: [
          {
            title: "总测试数",
            value: testResult.total,
            short: true,
          },
          {
            title: "通过数",
            value: testResult.passed,
            short: true,
          },
          {
            title: "失败数",
            value: testResult.failed,
            short: true,
          },
          {
            title: "跳过数",
            value: testResult.skipped,
            short: true,
          },
          {
            title: "报告链接",
            value: testResult.reportUrl,
            short: false,
          },
        ],
        ts: Date.now() / 1000,
      },
    ],
  };

  fetch(slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
};
```

## 部署策略

### 蓝绿部署

```yaml
# GitHub Actions 蓝绿部署配置
- name: Deploy to blue environment
  run: npm run deploy:blue

- name: Run smoke tests on blue environment
  run: npm run test:smoke -- --environment blue

- name: Switch traffic to blue environment
  run: npm run deploy:switch

- name: Clean up green environment
  run: npm run deploy:cleanup:green
```

### 滚动部署

```yaml
# GitHub Actions 滚动部署配置
- name: Deploy to staging
  run: npm run deploy:staging

- name: Run integration tests on staging
  run: npm run test:integration -- --environment staging

- name: Deploy to production
  run: npm run deploy:production

- name: Run health check
  run: npm run test:health
```

## 任务完成标准

- 所有测试都已集成到 CI/CD 流程中
- 每个阶段的测试都能稳定运行
- 测试报告清晰易读
- 通知机制正常工作
- 部署策略符合要求

## 注意事项

- 测试阶段的顺序和依赖关系要正确
- 测试超时时间要合理配置
- 资源分配要充分考虑测试需求
- 环境变量和密钥管理要安全
- 测试报告和通知要及时发送
