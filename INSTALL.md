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
| Node.js | 24.15.x | Only needed for `init-production-env.mjs` |

The platform is designed for **LAN/on-premise single-instance**
deployment. Windows and macOS via Docker Desktop are acceptable for
evaluation; Linux is recommended for production.

## Standard Docker Installation

### 1. Clone and configure

```bash
git clone <repo-url> exam && cd exam
node scripts/init-production-env.mjs
```

This creates `.env.production` from the example template and fills
`JWT_SECRET` and `POSTGRES_PASSWORD` with random values. Existing
secrets are never rotated on re-run.

### 2. Start the stack

```bash
docker compose --env-file .env.production up -d
```

This pulls the prebuilt release images and starts `web` (nginx edge +
static SPA), the API, and PostgreSQL (#585 topology; `web` is the
only published service, on `EXAM_PORT`, default 80).
No local build is required.

Each Exam release publishes a matched image pair — the API image and the
Web image under one version tag. `init-production-env.mjs` already pinned
both in `.env.production` (`EXAM_IMAGE` / `EXAM_WEB_IMAGE`), so a normal
install never chooses between them; manually editing the pins is an
advanced override (registry mirror, offline `docker load`) covered in the
[deployment guide](docs/deployment/README.md).

Watch the startup logs:

```bash
docker compose --env-file .env.production logs --tail=50 -f app
```

Wait until you see `Server listening at http://0.0.0.0:3000`.

### 3. Verify health

```bash
docker compose --env-file .env.production ps
```

Expected: `web` (healthy), `app` (healthy),
`db` (healthy).

### 4. Bootstrap the first Admin

```bash
docker compose --env-file .env.production exec app \
  node dist/scripts/bootstrap-admin.js \
  --username admin --password '<STRONG_PASSWORD>' \
  --name 'System Admin' --organization-name 'My Organization'
```

Replace `<STRONG_PASSWORD>` with a real password. This also creates the
internal default organization, which unblocks the email outbox loop.

### 5. Open the application

Navigate to `http://localhost` (the `web` nginx edge on `EXAM_PORT`, default
80) and log in with the credentials you just created.

### Alternative: Launchpad first-install page

Instead of the CLI, you can use the browser-based Launchpad flow:

1. Set `LAUNCHPAD_SETUP_TOKEN=<openssl rand -hex 32>` in `.env.production`
   **before** starting the stack.
2. Start the stack (`docker compose --env-file .env.production up -d`).
3. Navigate to `http://localhost/launchpad` and complete the form.
4. Once initialized, `/launchpad` redirects to `/login` and never
   reopens.

## Verify Installation

```bash
# API liveness
curl -s http://localhost/api/health
# Expected: {"status":"ok"}

# Public config
curl -s http://localhost/api/system/public-config
```

Then log in through the web UI and create a test candidate, course,
question, and exam to confirm the full flow.

## LAN Access

For machines on your local network, set these in `.env.production` before
starting the stack:

```bash
EXAM_PORT=8080
CORS_ORIGIN=http://192.168.1.5:8080
PUBLIC_WEB_ORIGIN=http://192.168.1.5:8080
```

Replace `192.168.1.5` with your machine's actual LAN address. The
browser uses `PUBLIC_WEB_ORIGIN` for email action links, so set it to
the address users will access. Its scheme is also the transport-policy
authority: an `http://` origin ships auth cookies without `Secure` and
no HSTS (supported on a controlled or appropriately trusted LAN — on
HTTP an attacker able to observe or modify LAN traffic can capture
credentials, sessions, and exam content); an `https://` origin keeps
all HTTPS hardening.

For HTTPS, the bundled `web` nginx carries a commented HTTPS template —
but that configuration is **baked into the `exam-web` image**, so editing
`deploy/nginx/web.conf` in the checkout never changes an already-pulled
image. To activate: copy `deploy/nginx/web.conf`, uncomment its 443 server
block, mount the edited copy over `/etc/nginx/conf.d/default.conf` on the
`web` service together with the certificate chain at
`/etc/nginx/certs/fullchain.pem` and the key at
`/etc/nginx/certs/privkey.pem`, and publish 443 — a compose override file
(`docker-compose.override.yml`, merged automatically by `docker compose`)
is the cleanest place for the mounts and the 443 port. The
application does not terminate TLS itself.

## Optional Capabilities

### Redis (shared rate limiting)

Redis is optional. When disabled (the default), the rate limiter runs
in local in-memory mode.

To enable:

```bash
# Add to .env.production:
REDIS_PASSWORD=<secret>
REDIS_URL=redis://:<same-secret>@redis:6379

# Start with the redis profile:
docker compose --env-file .env.production --profile redis up -d
```

See [`docs/deployment/mvp-deployment-runbook.md`](docs/deployment/mvp-deployment-runbook.md)
section 10 for details.

### Email (SMTP)

Email delivery is optional. When disabled (the default), the outbox
drains to `sent` status without external delivery.

To enable real email:

```bash
# Add to .env.production:
EMAIL_ENABLED=true
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp.your-org.internal
SMTP_USER=<username>
SMTP_PASSWORD=<password>
```

See [`docs/operations/email-config.md`](docs/operations/email-config.md)
for the full SMTP configuration reference.

## Troubleshooting

- **Port conflict**: Change `EXAM_PORT` in `.env.production`.
- **Container won't start**: Check `docker compose --env-file .env.production logs app`.
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
