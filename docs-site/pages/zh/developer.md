---
title: 开发者与架构
description: 内部架构、契约、测试与治理文档的权威入口。
breadcrumb:
  - text: 首页
    link: /zh/
  - text: 开发者与架构
outline: [2, 3]
---

# 开发者与架构

本门户刻意**不**投影内部文档树。它是面向读者的产品表面，不是第二套架构权威。请使用以下固定入口——每个链接都固定在产品证据提交上，不会被编译进本站。

## 规范内部入口

| 主题 | 规范入口 |
| --- | --- |
| 文档索引与权威映射 | [docs/README.md](repo:docs/README.md) |
| 跨边界考试语义（EXSEM-001..020） | [exam-semantic-boundaries.md](repo:docs/architecture/exam-semantic-boundaries.md) |
| 运行时、状态、交卷与评分协议 | [exam-runtime.md](repo:docs/architecture/exam-runtime.md) |
| 契约与 API 政策 | [docs/contracts/](repo:docs/contracts/) |
| 测试、环境与数据库生命周期 | [docs/standards/testing.md](repo:docs/standards/testing.md) |
| 代码质量与 workspace 依赖边界 | [docs/standards/code-quality.md](repo:docs/standards/code-quality.md) |
| 当前实现状态 | [implementation-status.md](repo:docs/status/implementation-status.md) |
| 代理执行契约 | [AGENTS.md](repo:AGENTS.md) |

## 本站如何构建

本站是一个有界的 repo-only 试点：

- **生成器：** VitePress `1.6.4`，在根 `devDependencies` 中精确固定。
- **来源模型：** 构建期 allowlist 投影，仅来自四个规范文件（`docs/product/standard-supported-capabilities.md` 及其 `zh-CN` 版本、`docs/guides/first-exam.md` 及其 `zh-CN` 版本）。仓库中的其他 Markdown 不会被编译。
- **读者页面：** 首页、概览、本页与常见问题为站点自撰导航页，不定义产品能力。
- **发布边界：** 未配置 GitHub Pages、Wiki、托管、域名或遥测。维护契约位于本仓库的 `docs-site/README.md`。
