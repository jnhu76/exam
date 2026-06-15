# Phase2 Readiness

> 本文档定义 Phase2 的文档准备，不实现任何 Phase2 功能。

---

## 1. Phase2 概述

### 1.1 Phase2 启动条件

Phase2 只能在以下条件完成后开始：

- Phase1.4 UI Foundation Reset 完成
- Phase1.5 完成
- Phase1.6 完成
- Phase1.7 完成

### 1.2 Phase2 范围

Phase2 包含以下模块：

| 模块 | 范围 |
|------|------|
| Phase2A Exam Operation | 考试运营 |
| Phase2B Proctor Panel | 监考面板 |
| Phase2C Exam Flexibility | 考试灵活性 |
| Phase2D Integration Export | 集成导出 |

---

## 2. Phase2A: Exam Operation

### 2.1 范围

- Detail page + right-side status panel + audit timeline

### 2.2 页面模板

```
Exam Operation Detail Page
├── PageHeader (标题 + 状态 + 操作按钮)
├── Main Content Area
│   ├── Stats Section (统计信息)
│   ├── Config Section (配置信息)
│   └── Tabs Section
│       ├── Tab: 报考信息
│       ├── Tab: 成绩
│       └── Tab: 操作日志 (audit timeline)
└── Right Panel
    ├── Status Panel (状态面板)
    ├── Risk Panel (风险面板)
    └── Timeline Panel (时间线面板)
```

### 2.3 组件

| 组件 | 用途 |
|------|------|
| ExamOperationDetail | 考试运营详情页 |
| StatusPanel | 状态面板 |
| RiskPanel | 风险面板 |
| TimelinePanel | 时间线面板 |
| AuditTimeline | 审计时间线 |

### 2.4 禁止事项

- 不暴露为 working routes during UI Reset
- 不创建 fake live dashboards
- 不创建 fake proctor actions

---

## 3. Phase2B: Proctor Panel

### 3.1 范围

- Dashboard page + status cards + event stream + action confirmation

### 3.2 页面模板

```
Proctor Dashboard
├── PageHeader (标题 + 操作按钮)
├── Status Cards
│   ├── Card: 总人数
│   ├── Card: 答题中
│   ├── Card: 断线
│   └── Card: 异常
├── Event Stream
│   ├── Event 1
│   ├── Event 2
│   └── Event 3
└── Action Panel
    ├── Button: 强制交卷
    ├── Button: 延长时间
    └── Button: 标记违纪
```

### 3.3 组件

| 组件 | 用途 |
|------|------|
| ProctorDashboard | 监考面板 |
| StatusCard | 状态卡片 |
| EventStream | 事件流 |
| ActionPanel | 操作面板 |
| ForceSubmitDialog | 强制交卷对话框 |
| ExtendTimeDialog | 延长时间对话框 |
| MisconductDialog | 标记违纪对话框 |

### 3.4 禁止事项

- 不暴露为 working routes during UI Reset
- 不创建 fake live dashboards
- 不创建 fake proctor actions
- 不创建 fake candidate live status cards

---

## 4. Phase2C: Exam Flexibility

### 4.1 范围

- Form sections + rule builder + snapshot preview

### 4.2 页面模板

```
Exam Flexibility Form
├── PageHeader (标题 + 操作按钮)
├── Form Section: Basic Information
│   ├── Field: 考试名称
│   ├── Field: 考试描述
│   └── Field: 考试时间
├── Form Section: Rules / Policy
│   ├── Field: 计时模式
│   ├── Field: 重考策略
│   └── Field: 取分策略
├── Form Section: Visibility / Access
│   ├── Field: 开放时间
│   ├── Field: 参与者
│   └── Field: 考场
└── Form Section: Actions
    ├── Button: 预览快照
    └── Button: 保存
```

### 4.3 组件

| 组件 | 用途 |
|------|------|
| ExamFlexibilityForm | 考试灵活性表单 |
| RuleBuilder | 规则构建器 |
| SnapshotPreview | 快照预览 |
| TimingModeSelector | 计时模式选择器 |
| RetakePolicySelector | 重考策略选择器 |
| ScoreStrategySelector | 取分策略选择器 |

### 4.4 禁止事项

- 不暴露为 working routes during UI Reset
- 不创建 real random paper builder
- 不创建 real timed_sync / deadline / untimed workflows

---

## 5. Phase2D: Integration Export

### 5.1 范围

- Settings page + key management table + export job status

### 5.2 页面模板

```
Integration Export Settings
├── PageHeader (标题 + 操作按钮)
├── Settings Section: API Key Management
│   ├── Table: API Key List
│   ├── Button: Create Key
│   └── Button: Revoke Key
├── Settings Section: Export Jobs
│   ├── Table: Export Job List
│   ├── Button: New Export
│   └── Button: Download
└── Settings Section: Pass Gate API
    ├── Field: API Endpoint
    ├── Field: API Key
    └── Button: Test Connection
```

### 5.3 组件

| 组件 | 用途 |
|------|------|
| IntegrationExportSettings | 集成导出设置页 |
| APIKeyTable | API Key 表格 |
| ExportJobTable | 导出任务表格 |
| PassGateConfig | Pass Gate 配置 |
| CreateKeyDialog | 创建 Key 对话框 |
| RevokeKeyDialog | 撤销 Key 对话框 |

### 5.4 禁止事项

- 不暴露为 working routes during UI Reset
- 不创建 fake export workflows
- 不创建 fake integration key management
- 不创建 real Pass Gate API UI
- 不创建 real API key / service token management

---

## 6. Phase2 与 UI Reset 的关系

### 6.1 UI Reset 可以做的

- 定义 Phase2 的页面模板
- 定义 Phase2 的组件结构
- 定义 Phase2 的状态语法
- 定义 Phase2 的文档

### 6.2 UI Reset 不能做的

- 不能实现 Phase2 功能
- 不能创建 Phase2 的 working routes
- 不能创建 fake live dashboards
- 不能创建 fake proctor actions
- 不能创建 fake export workflows

### 6.3 Phase2 启动标准

Phase2 只能在以下条件完成后开始：

1. UI Foundation Reset 完成（PR 1-9）
2. Phase1.5 完成
3. Phase1.6 完成
4. Phase1.7 完成
5. 所有 UI bug inventory 中的问题已修复
6. 所有页面符合新模板
7. 页面风格一致
8. 覆盖率达标

---

## 7. 文档准备清单

### 7.1 已完成

- [x] UI 宪法 (`00-ui-constitution.md`)
- [x] Design Tokens (`01-design-tokens.md`)
- [x] Layout System (`02-layout-system.md`)
- [x] Component Boundaries (`03-component-boundaries.md`)
- [x] State Grammar (`04-state-grammar.md`)
- [x] Page Templates (`05-page-templates.md`)
- [x] Accessibility Rules (`06-accessibility-rules.md`)
- [x] UI Bug Inventory (`07-ui-bug-inventory.md`)
- [x] Migration Plan (`08-migration-plan.md`)
- [x] Phase2 Readiness (`09-phase2-readiness.md`)

### 7.2 待完成

- [ ] Phase2A 页面模板详细设计
- [ ] Phase2B 页面模板详细设计
- [ ] Phase2C 页面模板详细设计
- [ ] Phase2D 页面模板详细设计
- [ ] Phase2 组件详细设计
- [ ] Phase2 状态语法详细设计
