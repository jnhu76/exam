# Installation

**English** · [简体中文](INSTALL.zh-CN.md)

This guide takes you from zero to a running Exam deployment. For
advanced configuration, upgrade procedures, and operations, see the
[Deployment](docs/deployment/) and [Operations](docs/operations/)
documentation.

## Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Docker Engine | ≥ 25.x | Linux host or Docker Desktop |
| Docker Compose | v2 | Included with Docker Desktop |
| Node.js | 24.15.x | Only needed for `generate-env.mjs` |

The platform is designed for **LAN/on-premise single-instance**
deployment. Windows and macOS via Docker Desktop are acceptable for
evaluation; Linux is recommended for production.

## Standard Docker Installation

### 1. Clone and configure

```bash
git clone <repo-url> exam && cd exam
node scripts/generate-env.mjs
```

This creates `.env.deploy` from the example template and fills
`JWT_SECRET` and `POSTGRES_PASSWORD` with random values. Existing
secrets are never rotated on re-run.

### 2. Start the stack

```bash
docker compose --env-file .env.deploy up -d
```

This pulls the prebuilt release image and starts the app and PostgreSQL.
No local build is required. Watch the startup logs:

```bash
docker compose --env-file .env.deploy logs --tail=50 -f app
```

Wait until you see `Server listening at http://0.0.0.0:3000`.

### 3. Verify health

```bash
docker compose --env-file .env.deploy ps
```

Expected: `app` (healthy), `db` (healthy).

### 4. Bootstrap the first Admin

```bash
docker compose --env-file .env.deploy exec app \
  node dist/scripts/bootstrap-admin.js \
  --username admin --password '<STRONG_PASSWORD>' \
  --name 'System Admin' --organization-name 'My Organization'
```

Replace `<STRONG_PASSWORD>` with a real password. This also creates the
internal default organization, which unblocks the email outbox loop.

### 5. Open the application

Navigate to `http://localhost:3000` and log in with the credentials you
just created.

### Alternative: Launchpad first-install page

Instead of the CLI, you can use the browser-based Launchpad flow:

1. Set `LAUNCHPAD_SETUP_TOKEN=<openssl rand -hex 32>` in `.env.deploy`
   **before** starting the stack.
2. Start the stack (`docker compose --env-file .env.deploy up -d`).
3. Navigate to `http://localhost:3000/launchpad` and complete the form.
4. Once initialized, `/launchpad` redirects to `/login` and never
   reopens.

## Verify Installation

```bash
# API liveness
curl -s http://localhost:3000/api/health
# Expected: {"status":"ok"}

# Public config
curl -s http://localhost:3000/api/system/public-config
```

Then log in through the web UI and create a test candidate, course,
question, and exam to confirm the full flow.

## LAN Access

For machines on your local network, set these in `.env.deploy` before
starting the stack:

```bash
EXAM_PORT=3000
CORS_ORIGIN=http://192.168.1.5:3000
PUBLIC_WEB_ORIGIN=http://192.168.1.5:3000
```

Replace `192.168.1.5` with your machine's actual LAN address. The
browser uses `PUBLIC_WEB_ORIGIN` for email action links, so set it to
the address users will access.

For HTTPS, place a reverse proxy (nginx, Caddy) in front of the app.
The application does not terminate TLS itself.

## Optional Capabilities

### Redis (shared rate limiting)

Redis is optional. When disabled (the default), the rate limiter runs
in local in-memory mode.

To enable:

```bash
# Add to .env.deploy:
REDIS_PASSWORD=<secret>
REDIS_URL=redis://:<same-secret>@redis:6379

# Start with the redis profile:
docker compose --env-file .env.deploy --profile redis up -d
```

See [`docs/deployment/mvp-deployment-runbook.md`](docs/deployment/mvp-deployment-runbook.md)
section 10 for details.

### Email (SMTP)

Email delivery is optional. When disabled (the default), the outbox
drains to `sent` status without external delivery.

To enable real email:

```bash
# Add to .env.deploy:
EMAIL_ENABLED=true
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp.your-org.internal
SMTP_USER=<username>
SMTP_PASSWORD=<password>
```

See [`docs/operations/email-config.md`](docs/operations/email-config.md)
for the full SMTP configuration reference.

## Troubleshooting

- **Port conflict**: Change `EXAM_PORT` in `.env.deploy`.
- **Container won't start**: Check `docker compose --env-file .env.deploy logs app`.
- **WSL2 / Docker Desktop issues**: See
  [`docs/docker-troubleshooting.md`](docs/docker-troubleshooting.md).
- **China mainland mirrors**: Build with `--build-arg NPM_REGISTRY=https://registry.npmmirror.com`.
  See [`Dockerfile`](Dockerfile) for all build args.

## Next Steps

- [Deployment Guide](docs/deployment/README.md) — production topology,
  image acquisition, network configuration
- [Operations Guide](docs/operations/README.md) — backup, upgrade,
  diagnostics, email recovery
- [Development Guide](docs/development/README.md) — local setup, testing,
  E2E, code quality
