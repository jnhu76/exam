# 文档归档

本目录包含已归档的 Phase 1、Phase 1.1、Phase 1.2、Phase 1.3 及 UI 设计文档。

## 归档原因

这些文档已完成实施和验收，保留用于参考，不再作为活跃开发文档。

## 目录结构

```txt
archive/
├── phase-1.0/
│   ├── jobs/                    # Phase 1 任务文档 (J0–J10)
│   ├── phase1-plan.md           # Phase 1 实施计划
│   └── phase1-ui-design.md      # Phase 1 UI 设计规范
├── phase-1.1/
│   ├── jobs/                    # Phase 1.1 任务文档 (J01–J06)
│   ├── phase1.1-api-contracts.md
│   ├── phase1.1-boundary.md
│   ├── phase1.1-smoke-test.md
│   ├── phase1.1-stabilization-plan.md
│   ├── prompts/
│   └── scripts/
├── phase-1.2/
│   ├── docs/
│   │   ├── branch-comparison.md
│   │   ├── conflict-report.md
│   │   └── prompts/
│   ├── enhancement.md
│   ├── manual-test-plan.md
│   ├── phase1.2-flow-test.md
│   ├── phase1.2-plan.md
│   ├── plan.md
│   └── todo.md
├── phase-1.3/
│   └── phase1.3-security-plan.md
└── ui-20260610/
    ├── archive/
    │   └── phase1-ui-design-archived.md
    ├── jobs/                    # UI 任务文档 (J00–J06)
    ├── 00–08 design docs
    └── README.md
```

## 参考指南

- **Phase 1.0**: 核心功能实现（考试流程、基础管理、安全约束）
- **Phase 1.1**: 功能补全（API 错误处理、发布刷新、考生考试列表、密码设置、烟雾测试）
- **Phase 1.2**: 体验增强（考试配置联动、分页、搜索、状态反馈、UI/UX 优化、烟雾测试）
- **Phase 1.3**: 安全加固（身份认证、权限边界、数据隔离、审计日志）
- **UI 20260610**: UI 审计与重构（设计原则、组件清单、页面迁移计划）

## 活跃文档

当前活跃文档位于 `docs/` 根目录：

- `docs/SPEC.md` — 产品规范（权威）
- `docs/code-quality.md` — 代码质量指南
- `docs/api/reference.md` — API 参考
- `docs/import-export-format.md` — CSV 导入导出格式
- `docs/mock-data.md` — Mock 数据
- `docs/phase1.4/` — Phase 1.4 架构升级文档

## 归档时间

- Phase 1.0: 2026-06-01
- Phase 1.1: 2026-06-01
- Phase 1.2: 2026-06-02
- Phase 1.3: 2026-06-03
- UI 20260610: 2026-06-10

## 注意事项

1. 归档文档仅供参考，不应修改
2. 如需查看实施细节或设计决策，请查阅归档文档
3. 当前开发以 `docs/SPEC.md` 和 `docs/code-quality.md` 为准
