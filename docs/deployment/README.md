# Deployment

> Production deployment reference for Exam. For first installation, see
> [INSTALL.md](../../INSTALL.md).

## Supported Deployment Model

- **LAN/on-premise**, single-tenant, single-instance
- One deployment = one institution (`organizationId` is the internal data
  boundary)
- No cloud dependencies; the platform must remain offline-capable
- Multi-instance deployment is **not** supported (in-process scanners
  assume a single API owner)

## Production Topology

```text
┌─────────────────────────────────────────────┐
│  Docker Compose (default stack)             │
│                                             │
│  ┌─────────┐  ┌─────────┐  ┌───────────┐  │
│  │   app   │  │   db    │  │   redis   │  │
│  │ (Fastify│  │ (PG 18) │  │  (7, opt) │  │
│  │  + SPA) │  │         │  │           │  │
│  └─────────┘  └─────────┘  └───────────┘  │
│                                             │
│  Services: app + db (default)               │
│            app + db + redis (--profile redis)│
│                                             │
│  Host port: EXAM_PORT → container 3000      │
│  Data: ./data/postgres (bind mount)         │
└─────────────────────────────────────────────┘
```

The app container runs the API, serves the built SPA, runs database
migrations on startup, and executes the in-process email outbox loop.
There is no separate email worker service.

## Deployment Paths

### Prebuilt image (recommended for operators)

The `app` service runs a prebuilt release image pinned by `EXAM_IMAGE`
in `.env.deploy`. The `generate-env.mjs` script derives the pin from
`.release-version` (`ghcr.io/jnhu76/exam:vX.Y.Z`).

```bash
node scripts/generate-env.mjs
docker compose --env-file .env.deploy up -d
```

### Source build (contributors / PR acceptance)

Merge the build override to force a build from the current checkout:

```bash
docker compose --env-file .env.deploy \
  -f docker-compose.yml -f docker-compose.build.yml \
  up -d --build
```

### Offline / air-gapped transfer

Pull on a connected machine, `docker save`, transfer, `docker load`:

```bash
docker pull ghcr.io/jnhu76/exam:vX.Y.Z
docker save ghcr.io/jnhu76/exam:vX.Y.Z | gzip > exam-image.tar.gz
# transfer, then on the target:
docker load < exam-image.tar.gz
```

## Configuration

Deployment settings live in `.env.deploy` (created by
`generate-env.mjs`). Development settings live in `.env`. They are
separate files; no dev tooling reads `.env.deploy`.

Production-required variables (`docker compose` fails if unset):

| Variable | Purpose |
| --- | --- |
| `POSTGRES_PASSWORD` | Database superuser password |
| `JWT_SECRET` | JWT signing secret |

See
[`mvp-deployment-runbook.md`](mvp-deployment-runbook.md) section 2 for
the full environment variable reference.

## Image Acquisition

See
[`mvp-deployment-runbook.md`](mvp-deployment-runbook.md) section 3 for
the complete image acquisition guide (online pull, offline transfer,
source build, contributor verification).

## Network / TLS

- The application does **not** terminate TLS
- Place a reverse proxy (nginx, Caddy) in front for HTTPS
- Set `CORS_ORIGIN` and `PUBLIC_WEB_ORIGIN` to the address users will
  access (e.g. `http://192.168.1.5:3000` for LAN)

## Deployment Validation

After first install, run the smoke test described in
[`mvp-deployment-runbook.md`](mvp-deployment-runbook.md) section 11.

Automated deployment verification suites are in `tests/deployment/` and
gated by CI (`pnpm test:deployment`).

## Runbooks

| Document | Purpose |
| --- | --- |
| [`mvp-deployment-runbook.md`](mvp-deployment-runbook.md) | Complete operator runbook: env, install, bootstrap, email, Redis, scanners, health, backup, upgrade |
| [`backup-and-recovery.md`](backup-and-recovery.md) | Backup procedures (C1 cold, C2 logical, C3 PITR), restore, evidence ledger |
| [`upgrade-and-uninstall.md`](upgrade-and-uninstall.md) | Version upgrade, rollback, uninstall |
| [`gates.md`](gates.md) | Deployment gate definitions and evidence |
