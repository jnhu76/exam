# 安装指南

[English](INSTALL.md) · **简体中文**

本指南用于把 Exam 从零部署到可运行状态。高级配置、升级与日常运维请继续阅读
[部署文档](docs/deployment/) 和 [运维文档](docs/operations/)。

## 前置要求

| 要求 | 版本 | 说明 |
| --- | --- | --- |
| Docker Engine | ≥ 25.x | Linux 主机或 Docker Desktop |
| Docker Compose | v2 | Docker Desktop 已包含 |
| Node.js | 24.15.x | 仅用于运行 `init-production-env.mjs` |

平台面向 **LAN / on-premise（本地部署）的单实例部署**。Windows 和 macOS 可通过 Docker Desktop 用于评估；生产环境推荐 Linux。

## 标准 Docker 安装

### 1. 克隆并生成配置

```bash
git clone <repo-url> exam && cd exam
node scripts/init-production-env.mjs
```

该命令会基于示例模板生成 `.env.production`，并为 `JWT_SECRET` 和 `POSTGRES_PASSWORD`
写入随机值。重复运行不会自动轮换已经存在的密钥。

### 2. 启动服务

```bash
docker compose --env-file .env.production up -d
```

该命令会拉取预构建发布镜像，并启动 `web`（nginx 公共入口 + 静态 SPA）、API 与 PostgreSQL
（#585 拓扑；`web` 是唯一对外发布的服务，监听 `EXAM_PORT`，默认 80）。无需本地构建。

每个 Exam 版本都会发布一个版本匹配的 API / Web 镜像对，并使用同一个版本标签。
`init-production-env.mjs` 已经把两个镜像引用写入 `.env.production`
（`EXAM_IMAGE` / `EXAM_WEB_IMAGE`），正常安装不需要在两者之间做选择；
手动修改镜像引用属于高级覆盖场景（registry mirror、离线 `docker load`），
详见[部署指南](docs/deployment/README.md)。

可以查看启动日志：

```bash
docker compose --env-file .env.production logs --tail=50 -f app
```

等待日志出现：

```text
Server listening at http://0.0.0.0:3000
```

### 3. 检查健康状态

```bash
docker compose --env-file .env.production ps
```

预期看到：`web`、`app`、`db` 均为 healthy。

### 4. 初始化第一个 Admin

```bash
docker compose --env-file .env.production exec app \
  node dist/scripts/bootstrap-admin.js \
  --username admin --password '<STRONG_PASSWORD>' \
  --name 'System Admin' --organization-name 'My Organization'
```

请把 `<STRONG_PASSWORD>` 替换成真实的强密码。该命令还会创建内部默认组织，
使邮件 outbox 处理循环能够开始工作。

### 5. 打开应用

访问 `http://localhost`（`web` nginx 公共入口，监听 `EXAM_PORT`，默认 80），使用刚刚创建的账号登录。

### 另一种方式：Launchpad 首次安装页

如果不想使用 CLI，也可以通过浏览器完成首次初始化：

1. 在启动服务前，把 `LAUNCHPAD_SETUP_TOKEN=<openssl rand -hex 32>` 写入 `.env.production`。
2. 执行 `docker compose --env-file .env.production up -d`。
3. 打开 `http://localhost/launchpad` 并完成表单。
4. 初始化完成后，`/launchpad` 会跳转到 `/login`，不会再次开放。

## 验证安装

```bash
# API 存活检查
curl -s http://localhost/api/health
# 预期：{"status":"ok"}

# 公共配置
curl -s http://localhost/api/system/public-config
```

然后通过 Web UI 登录，并创建一个测试 Candidate、Course、Question 和 Exam，验证完整流程。

## 局域网访问

如果局域网内其他设备需要访问，请在启动服务前设置 `.env.production`：

```bash
EXAM_PORT=8080
CORS_ORIGIN=http://192.168.1.5:8080
PUBLIC_WEB_ORIGIN=http://192.168.1.5:8080
```

把 `192.168.1.5` 替换成部署机器的真实局域网地址。浏览器生成邮件操作链接时会使用
`PUBLIC_WEB_ORIGIN`，因此它应当填写用户实际访问的地址。它的 scheme 同时是传输策略的
唯一权威：`http://` 源下认证 cookie 不带 `Secure`、无 HSTS（在受控或适当可信的局域网上
受支持——HTTP 下能够窃听或篡改局域网流量的攻击者可以捕获凭据、会话与考试内容）；
`https://` 源保留全部 HTTPS 加固。

如果需要 HTTPS，内置的 `web` nginx 已提供带注释的 HTTPS 模板——但该配置
**烘焙在 `exam-web` 镜像内**，修改 checkout 里的 `deploy/nginx/web.conf`
不会改变已经拉取的镜像。启用方式：复制 `deploy/nginx/web.conf`，取消其中 443
`server` 块的注释，把修改后的副本覆盖挂载到 `web` 服务的
`/etc/nginx/conf.d/default.conf`，同时挂载证书链到 `/etc/nginx/certs/fullchain.pem`、
私钥到 `/etc/nginx/certs/privkey.pem`，并发布 443 端口。建议把这些挂载和 443 端口
放在 Compose override 文件 `docker-compose.override.yml` 中；`docker compose` 会自动合并它。
应用本身不负责 TLS 终止。

## 可选能力

### Redis（共享限流）

Redis 是可选组件。默认关闭时，限流器使用本地内存模式。

启用方式：

```bash
# 加入 .env.production：
REDIS_PASSWORD=<secret>
REDIS_URL=redis://:<same-secret>@redis:6379

# 使用 redis profile 启动：
docker compose --env-file .env.production --profile redis up -d
```

详情见 [`docs/deployment/mvp-deployment-runbook.md`](docs/deployment/mvp-deployment-runbook.md) 第 10 节。

### 邮件（SMTP）

邮件投递是可选能力。默认关闭时，outbox 仍会处理到 `sent` 状态，但不会向外部 SMTP 投递。

开启真实邮件：

```bash
# 加入 .env.production：
EMAIL_ENABLED=true
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp.your-org.internal
SMTP_USER=<username>
SMTP_PASSWORD=<password>
```

完整 SMTP 配置见 [`docs/operations/email-config.md`](docs/operations/email-config.md)。

## 故障排查

- **端口冲突**：修改 `.env.production` 中的 `EXAM_PORT`。
- **容器无法启动**：查看 `docker compose --env-file .env.production logs app`。
- **WSL2 / Docker Desktop 问题**：见 [`docs/docker-troubleshooting.md`](docs/docker-troubleshooting.md)。
- **中国大陆 npm 镜像源**：构建时可使用 `--build-arg NPM_REGISTRY=https://registry.npmmirror.com`；完整构建参数见 [`Dockerfile`](Dockerfile)。

## 下一步

- [部署指南](docs/deployment/README.md) — 生产拓扑、镜像获取、网络配置
- [运维指南](docs/operations/README.md) — 备份、升级、诊断、邮件恢复
- [开发指南（中文）](docs/development/README.zh-CN.md) — 本地开发、测试、E2E、代码质量
