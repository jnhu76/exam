# 文档归档

本目录包含已归档的 Phase 1.0–1.7 及 UI 设计文档。

## 归档原因

这些文档已完成实施、验收、阶段性关闭，或已被当前 Phase Roadmap 取代。保留用于历史参考，不再作为活跃开发文档。

当前阶段边界以以下文档为准：

- `docs/SPEC.md` — 产品规范（权威）
- `docs/phase-roadmap.md` — Phase 1/2/3/4 路线权威
- `docs/code-quality.md` — 代码质量指南

## 目录结构

```txt
archive/
├── dev/                          # 开发文档归档（测试基线、配置、种子数据、
│                                 #   ADR-007 audit companions、openapi-audit 等）
├── audit/                        # 2026-07-21 Wave 1 归档：docs/audit/ 与
│                                 #   docs/phase3/audit/ 下的时点审查与纠正报告
├── phase3-rbac/                  # 2026-07-21 Wave 1 归档：docs/phase3/rbac/ 下的
│                                 #   RBAC M10 系列自评、对抗审查、纠正与旧 job-queue 计划
├── phase3-plans/                 # 2026-07-21 Wave 1 归档：docs/phase3/ 旧实施计划、
│                                 #   architecture/、emails/
├── frontend-rollouts/            # 2026-07-21 Wave 1 归档：docs/frontend/ 下已被
│                                 #   权威文档取代的 P3 closeout/review/corrective/
│                                 #   per-wave 迁移报告与 job 计划
├── followups/                    # 2026-07-21 Wave 1 归档：docs/followups/ 时点跟进项
├── phase1-archive/               # Phase 1.0–1.8 实施文档
│   ├── phase-1.0/ … phase1.8/
│   └── ui-20260610/
├── phase2-archive/               # Phase 2 实施文档
│   └── phase2/
├── audits/                       # 历史 UI/前端契约审查
├── frontend/                     # 历史 UI 交互规范
└── known-test-isolation-issues.md
```

> 注：当前活跃权威文档索引已迁移至 `docs/README.md`。最终阶段关闭证据（如
> `phase2-closeout-report.md`、`phase2-baseline.md`、
> `RBAC-M10-F-FINAL-VERIFICATION-1.md`、`RBAC-M10-FINISH-BASELINE-1.md`）
> 已移至 `docs/evidence/`，不再放在 archive 下。

## 参考指南

- **Phase 1.0**: 核心功能实现（考试流程、基础管理、安全约束）
- **Phase 1.1**: 功能补全（API 错误处理、发布刷新、考生考试列表、密码设置、烟雾测试）
- **Phase 1.2**: 体验增强（考试配置联动、分页、搜索、状态反馈、UI/UX 优化、烟雾测试）
- **Phase 1.3**: 安全加固（身份认证、权限边界、数据隔离、审计日志）
- **Phase 1.4**: 架构、安全、UI foundation reset 与阶段性收口文档
- **Phase 1.5**: PostgreSQL-only database convergence 文档
- **Phase 1.6**: PostgreSQL correctness hardening 与考试协议事务硬化文档
- **Phase 1.7**: Security baseline、API contract、exam lifecycle non-E2E closeout 文档
- **UI 20260610**: UI 审计与重构（设计原则、组件清单、页面迁移计划）

## 活跃文档

当前活跃文档位于 `docs/` 根目录或对应活跃子目录：

- `docs/CURRENT.md` — 当前活跃文档索引
- `docs/SPEC.md` — 产品规范（权威）
- `docs/phase-roadmap.md` — Phase 1/2/3/4 路线权威
- `docs/code-quality.md` — 代码质量指南
- `docs/api/reference.md` — API 参考
- `docs/api/contract.md` — API 契约
- `docs/import-export-format.md` — CSV 导入导出格式
- `docs/mock-data.md` — Mock 数据
- `docs/dev/i18n-copy-policy.md` — i18n 文案策略

## 归档时间

- Phase 1.0: 2026-06-01
- Phase 1.1: 2026-06-01
- Phase 1.2: 2026-06-02
- Phase 1.3: 2026-06-03
- UI 20260610: 2026-06-10
- Phase 1.4: 2026-06-14
- Phase 1.5: 2026-06-14
- Phase 1.6: 2026-06-14
- Phase 1.7: 2026-06-14

## 注意事项

1. 归档文档仅供参考，不应作为当前实施计划。
2. 如需查看历史实施细节或设计决策，请查阅归档文档。
3. 当前开发以 `docs/SPEC.md`、`docs/phase-roadmap.md` 和 `docs/code-quality.md` 为准。
4. 如归档文档与当前权威文档冲突，以当前权威文档为准。
