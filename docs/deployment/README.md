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

## Production Topology (#585)

```text
                    host :EXAM_PORT (default 80)
                              │
┌─────────────────────────────┼───────────────────────────┐
│  Docker Compose (nginx is the ONLY public ingress)      │
│  ┌─────────┐   /api/** ──► ┌─────────┐                  │
│  │  nginx  │──────────────►│   app   │  API (Fastify)   │
│  │ (edge)  │   /* ──────►  └────┬────┘  :3000          │
│  └────┬────┘              ┌────┴────┐                  │
│       │            /* ──► │   web   │  static SPA      │
│       │                   │ (nginx) │  :4173           │
│       │                   └─────────┘                  │
│  ┌─────────┐  ┌─────────┐  ┌───────────┐               │
│  │   db    │  │  redis  │  │ app runs  │                │
│  │ (PG 18) │  │ (7, opt)│  │ migrations│                │
│  └─────────┘  └─────────┘  └───────────┘               │
│                                                        │
│  Services: nginx + web + app + db (default)            │
│            + redis (--profile redis)                   │
│                                                        │
│  Host port: EXAM_PORT → nginx 80 (nothing else published)│
│  Data: ${EXAM_DATA_ROOT}/postgres (bind mount)         │
└────────────────────────────────────────────────────────┘
```

- `nginx` is the sole public ingress (`deploy/nginx/edge.conf`,
  runtime-mounted read-only): `/api/**` → app:3000, `/*` → web:4173.
  Upstreams resolve through Docker DNS at request time, so app/web
  recreations never strand the edge on a stale address.
- The `web` service is a dedicated static runtime: nginx serving the
  built SPA from the `web-runner` image (`deploy/nginx/web.conf` is
  baked in; never `vite preview`).
- The `app` container runs the API only (no bundled SPA), database
  migrations on startup, and the in-process email outbox loop. There is
  no separate email worker service.
- `app`, `web`, and `db` publish no host ports; `nginx` health-gates its
  startup on both upstreams being healthy.

## Deployment Paths

### Prebuilt image (recommended for operators)

The `app` and `web` services run prebuilt release images pinned by
`EXAM_IMAGE` / `EXAM_WEB_IMAGE` in `.env.deploy`. The `generate-env.mjs`
script derives both pins from `.release-version`
(`ghcr.io/jnhu76/exam{,-web}:vX.Y.Z`).

```bash
node scripts/generate-env.mjs
docker compose --env-file .env.deploy up -d
```

### Source build (contributors / PR acceptance)

Build the current checkout explicitly (both targets) and run the
canonical operator Compose against the local tags (#626 — no build
overlay):

```bash
docker build --target runner -t exam-local:dev .
docker build --target web-runner -t exam-local:web-dev .
EXAM_IMAGE=exam-local:dev EXAM_WEB_IMAGE=exam-local:web-dev \
  docker compose --env-file .env.deploy -f docker-compose.yml up -d
```

### Offline / air-gapped transfer

Pull on a connected machine, `docker save`, transfer, `docker load`:

```bash
docker pull ghcr.io/jnhu76/exam:vX.Y.Z
docker pull ghcr.io/jnhu76/exam-web:vX.Y.Z
docker save ghcr.io/jnhu76/exam:vX.Y.Z | gzip > exam-image.tar.gz
docker save ghcr.io/jnhu76/exam-web:vX.Y.Z | gzip > exam-web-image.tar.gz
# transfer, then on the target:
docker load < exam-image.tar.gz
docker load < exam-web-image.tar.gz
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

## Network / TLS (#585)

- The bundled `nginx` edge is the only public ingress and terminates
  plain HTTP on `EXAM_PORT` (default 80).
- The application does **not** terminate TLS. HTTPS is a commented
  template inside `deploy/nginx/edge.conf`: mount the certificate chain
  at `/etc/nginx/certs/fullchain.pem` and the key at
  `/etc/nginx/certs/privkey.pem`, uncomment the 443 server block, and
  publish 443 in `docker-compose.yml`. No ACME/Certbot is bundled.
- `TRUSTED_PROXY_CIDRS` must name the nginx→app hop **only — never the
  candidate client network**. In the bundled topology the client-visible
  peer of the app is the Compose bridge; resolve the actual subnet with
  `docker network inspect <project>_exam-net` and set e.g.
  `TRUSTED_PROXY_CIDRS=172.19.0.0/16`. The edge **replaces**
  `X-Forwarded-For` with the real client address (appending would let a
  client forge its audit/rate-limit identity), so with the narrow CIDR
  `request.ip` is the true client and a client-sent `X-Forwarded-For`
  is ignored. See the runbook §2 "Rate-limit identity, trusted proxies,
  and sizing".
- Set `CORS_ORIGIN` and `PUBLIC_WEB_ORIGIN` to the address users will
  access. The default is `http://localhost` (nginx owns public 80); a
  remapped `EXAM_PORT` or LAN address must set both explicitly (e.g.
  `http://192.168.1.5:8080`).

## Deployment Validation

After first install, run the smoke test described in
[`mvp-deployment-runbook.md`](mvp-deployment-runbook.md) section 11.

Automated deployment verification suites are in `tests/deployment/`
(`pnpm test:deployment`); the release-blocking gate is the fresh-install
acceptance inside the `release` workflow (see
[`gates.md`](gates.md)).

## Runbooks

| Document | Purpose |
| --- | --- |
| [`mvp-deployment-runbook.md`](mvp-deployment-runbook.md) | Complete operator runbook: env, install, bootstrap, email, Redis, scanners, health, backup, upgrade |
| [`backup-and-recovery.md`](backup-and-recovery.md) | Backup procedures (C1 cold, C2 logical, C3 PITR), restore, evidence ledger |
| [`upgrade-and-uninstall.md`](upgrade-and-uninstall.md) | Version upgrade, rollback, uninstall |
| [`gates.md`](gates.md) | Deployment gate definitions and evidence |
