<div align="center">

# Exam

**面向受控考试、评分与本地部署的自托管考试与测评平台。**

从出题、考试交付到评分、恢复、审计与日常运维，都运行在你自己的基础设施上。

[![CI](https://github.com/jnhu76/exam/actions/workflows/ci.yml/badge.svg)](https://github.com/jnhu76/exam/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Self-hosted](https://img.shields.io/badge/deployment-self--hosted-success.svg)](INSTALL.zh-CN.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg?logo=docker&logoColor=white)](INSTALL.zh-CN.md)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1.svg?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

[**安装**](INSTALL.zh-CN.md) · [**文档**](docs/README.md) · [**路线图**](docs/roadmap/current.md) · [**贡献指南**](CONTRIBUTING.md)

**简体中文** · [English](README.md)

</div>

---

> [!NOTE]
> 本文是 `README.md` 的简体中文阅读版本，不是独立的运行时或产品事实权威。
> 若本文与当前实现、契约或 Accepted ADR 出现冲突，应按 [`docs/README.md`](docs/README.md)
> 定义的 authority 模型处理；实际命令与接线以代码、`package.json` scripts、Docker 配置和 CI workflow 为准。

## ✨ Exam 是什么？

Exam 是一个面向局域网 / 本地部署、当前采用单租户运行模式的考试与测评平台。
一个机构部署一个实例，考生通过局域网参加考试。产品运行时不依赖云端服务、外部 API 或遥测服务。

系统支持开放式测验和严格监考场景，提供客观题自动评分、主观题人工评分，以及结果发布与站内通知。

## 🧩 核心能力

- **考试生命周期** — 草稿、发布、开放、关闭、归档、取消
- **计时模式** — 时间窗口、截止时间、不限时
- **答案保存协议** — 带版本号、幂等与冲突检测的答案持久化，并包含客户端离线兜底
- **自动评分** — 单选、多选、判断、填空
- **人工评分** — 主观文本题与基于 rubric 的评分
- **结果发布** — 即时发布、评分完成后发布或人工发布；支持站内通知和可选邮件投递
- **考生恢复** — 心跳检测中断、考生自助恢复、管理员 Recovery Center
- **身份生命周期** — 员工邀请、邮件密码重置、账号启用 / 停用
- **基于角色与能力的访问控制** — Admin、Teacher、Candidate、Proctor、Grader、Maintainer，并支持作用域权限
- **运维控制面** — 诊断、备份证据台账、恢复就绪状态、结构化审计日志
- **邮件投递** — 进程内 outbox loop、重试、锁恢复和可选 SMTP
- **Docker 部署** — 预构建镜像、单命令启动、可选 Redis

## 🚀 快速开始

### Docker — 推荐方式

```bash
git clone https://github.com/jnhu76/exam.git && cd exam
node scripts/generate-env.mjs                      # 生成 .env.deploy，并填写必要密钥
docker compose --env-file .env.deploy up -d        # 拉取预构建镜像并启动 app + db
docker compose --env-file .env.deploy ps           # 等待 app / db 进入 healthy
```

初始化第一个 Admin。系统没有公开自助注册入口：

```bash
docker compose --env-file .env.deploy exec app \
  node dist/scripts/bootstrap-admin.js \
  --username admin --password '<STRONG_PASSWORD>' \
  --name 'System Admin' --organization-name 'My Organization'
```

打开 `http://localhost:3000` 并登录。

### 本地开发

```bash
pnpm install
pnpm db:up           # 启动开发用 PostgreSQL + Redis
pnpm db:migrate      # 执行迁移
pnpm db:seed         # 写入测试用户（admin / candidate）
pnpm dev             # API :3000，Web :5173
```

> **需要完整安装流程？** 请阅读 [INSTALL.zh-CN.md](INSTALL.zh-CN.md)，其中包含局域网访问、Redis、邮件、首次初始化与故障排查。

## 📚 文档导航

仓库文档的统一入口是 [`docs/README.md`](docs/README.md)。

| 文档 | 用途 |
| --- | --- |
| [INSTALL.zh-CN.md](INSTALL.zh-CN.md) | 首次安装：从零到可运行 |
| [`docs/deployment/`](docs/deployment/) | 生产部署、拓扑与 runbook |
| [`docs/operations/`](docs/operations/) | 备份、升级、诊断、邮件 |
| [`docs/development/README.zh-CN.md`](docs/development/README.zh-CN.md) | 本地开发、测试、E2E 与常用命令 |
| [`docs/SPEC.md`](docs/SPEC.md) | 产品规范：不变量与领域模型 |
| [`docs/roadmap/current.md`](docs/roadmap/current.md) | 当前阶段状态与下一步 |
| [`docs/standards/code-quality.md`](docs/standards/code-quality.md) | 代码质量、门禁与 AI 编码规则 |
| [`docs/standards/testing.md`](docs/standards/testing.md) | 测试与 CI 契约 |
| [`docs/architecture/authorization.md`](docs/architecture/authorization.md) | 基于 capability 的授权模型 |
| [`docs/adr/README.md`](docs/adr/README.md) | Architecture Decision Records 索引 |

历史规划、审计与阶段记录位于 [`docs/archive/`](docs/archive/)，仅作为历史证据，不是当前实施指导。

## 🧱 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19 + Vite + TypeScript + shadcn/ui + TailwindCSS v4 |
| 后端 | Node.js 24.15 + Fastify + TypeScript + Zod |
| 数据库 | PostgreSQL 18.4 + Drizzle ORM |
| 缓存 | Redis 7 — 可选，用于共享限流 |
| 认证 | HTTP-only Cookie + JWT，argon2 密码哈希 |
| Monorepo | pnpm 11 + Turborepo 2.9.16 |

## 🗺️ 项目状态

| 阶段 | 状态 | 摘要 |
| --- | --- | --- |
| Phase 1 — Minimal Deliverable | ✅ 已完成 | Admin + Candidate 可靠考试闭环 |
| Phase 2 — Exam Operation | ✅ MVP 子集已完成 | 生命周期、恢复、评分、诊断 |
| Phase 3 — Collaboration / Permissions | 🚧 进行中 | 授权基础设施与 scoped roles 已具备；剩余产品工作由 [#333](https://github.com/jnhu76/exam/issues/333) 跟踪 |
| P7 — System Readiness | ✅ 已完成 | Hardening、备份 / DR、运维控制、RBAC remediation |
| Phase 4 — Platformization | ⏳ 未开始 | 多租户、API Key、Webhook 等暂缓 |

详细阶段摘要见 [`docs/roadmap/current.md`](docs/roadmap/current.md)，当前实现事实见
[`docs/status/implementation-status.md`](docs/status/implementation-status.md)。

## 🤝 参与贡献

如何查找 Issue、配置环境和提交 Pull Request，请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

AI 编码代理在修改仓库前必须阅读并遵守 [AGENTS.md](AGENTS.md)。

## ⚖️ 许可证

本项目采用 [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）。
法律条款以 `LICENSE` 为唯一权威文本。
