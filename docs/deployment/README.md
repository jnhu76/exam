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
┌───────────────────────┼──────────────────────────────┐
│  Docker Compose (web is the ONLY public ingress)     │
│                                                      │
│  ┌──────────────────┐  /api/** ──► ┌─────────┐       │
│  │       web        │───────────► │   app   │       │
│  │   nginx edge +   │             │  (API)  │ :3000 │
│  │   static SPA     │  /* ──►     └────┬────┘       │
│  │ (deep-link       │   local files    │            │
│  │  fallback)       │                  │            │
│  └──────────────────┘      ┌───────────┴──────────┐ │
│                            │  app runs migrations │ │
│                            └──────────────────────┘ │
│  ┌─────────┐   ┌─────────┐                           │
│  │   db    │   │  redis  │                           │
│  │ (PG 18) │   │ (7,opt) │                           │
│  └─────────┘   └─────────┘                           │
│                                                      │
│  Services: web + app + db (default)                  │
│            + redis (--profile redis)                 │
│                                                      │
│  Host port: EXAM_PORT → web 80 (nothing else published)│
│  Data: ${EXAM_DATA_ROOT}/postgres (bind mount)       │
└──────────────────────────────────────────────────────┘
```

- `web` is the sole public ingress: one nginx serving the built SPA with
  deep-link fallback and routing `/api/**` → app:3000. Its configuration
  (`deploy/nginx/web.conf`) is baked into the `web-runner` image (never
  `vite preview`); the API upstream resolves through Docker DNS at request
  time, so app recreations never strand the edge on a stale address.
- The `app` container runs the API only (no bundled SPA), database
  migrations on startup, and the in-process email outbox loop. There is
  no separate email worker service.
- `app` and `db` publish no host ports; `web` health-gates its startup on
  the app being healthy.
- Compose project identities are pinned (#631): production runs as project
  `exam-prod`, the dev stack (`docker-compose.dev.yml`) as `exam-dev` — a
  production rehearsal from a developer checkout can never recreate dev
  containers.

## Deployment Paths

### Prebuilt image (recommended for operators)

Each Exam release publishes two coordinated images as one version-matched
pair: `ghcr.io/jnhu76/exam:vX.Y.Z` (API) and
`ghcr.io/jnhu76/exam-web:vX.Y.Z` (nginx edge + static SPA). A normal
install never chooses between them — `init-production-env.mjs` derives
both pins (`EXAM_IMAGE` / `EXAM_WEB_IMAGE`) in `.env.production` from
`.release-version`, and Compose starts the pair together. Manually editing
the pins is an advanced override (registry mirror, offline `docker load`,
rollback pinning) — see the runbook §3 "Image acquisition".

> Non-normative future-compatibility note: the built SPA is the Web product
> artifact. The `exam-web` OCI image is the current LAN/on-premise packaging
> of that artifact with nginx. No CDN or horizontal-scaling mechanism is
> part of the supported deployment today; the independently built SPA
> remains the future extraction seam.

```bash
node scripts/init-production-env.mjs
docker compose --env-file .env.production up -d
```

### Source build (contributors / PR acceptance)

Build the current checkout explicitly (both targets) and run the
canonical operator Compose against the local tags (#626 — no build
overlay). Rehearsing from a dev checkout must point `EXAM_DATA_ROOT`
outside the source tree (#631): the `./data` default is the operator
deployment model, and a rehearsal that creates Docker-owned state
inside the checkout breaks `pnpm format:check`:

```bash
docker build --target runner -t exam-local:dev .
docker build --target web-runner -t exam-local:web-dev .
EXAM_IMAGE=exam-local:dev EXAM_WEB_IMAGE=exam-local:web-dev \
  EXAM_DATA_ROOT="${TMPDIR:-/tmp}/exam-prod-rehearsal" \
  docker compose --env-file .env.production -f docker-compose.yml up -d
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

Deployment settings live in `.env.production` (created by
`init-production-env.mjs`). Development settings live in `.env`. They are
separate files; no dev tooling reads `.env.production`.

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

There is ONE application runtime: `APP_MODE=production` supports both HTTP
and HTTPS ingress, and TLS remains an ingress concern — the application
never terminates it and no certificate automation is bundled.

- **Mode A — controlled / isolated LAN HTTP.** The bundled edge terminates
  plain HTTP on `EXAM_PORT` (default 80). SUPPORTED with no certificate:
  set `PUBLIC_WEB_ORIGIN` (and `CORS_ORIGIN`) to the exact `http://...`
  origin users browse. On HTTP, transport confidentiality/integrity is
  absent — an attacker able to observe or modify LAN traffic can capture
  credentials, sessions, exam content, and answers — so reserve it for a
  controlled or appropriately trusted LAN (runbook §2 "Transport modes").
- **Mode B — HTTPS ingress.** TLS terminates at the `web` nginx edge. Set
  `PUBLIC_WEB_ORIGIN` to the exact `https://...` origin; the application
  stays `APP_MODE=production` and the internal app hop remains HTTP.
  HTTPS activation is a commented template inside
  `deploy/nginx/web.conf`, which is **baked into the `exam-web` image** —
  editing the checkout file never changes an already-pulled image. To
  activate: mount the certificate chain at
  `/etc/nginx/certs/fullchain.pem` and the key at
  `/etc/nginx/certs/privkey.pem`, mount an overriding nginx configuration
  (a copy of `web.conf` with the 443 server block uncommented) over
  `/etc/nginx/conf.d/default.conf`, and publish 443 on the `web` service
  — for example via a compose override file.
- **Transport policy.** The `PUBLIC_WEB_ORIGIN` scheme is the ONE
  transport-policy authority: an `http://` canonical origin ships auth
  cookies WITHOUT `Secure` and no HSTS / CSP `upgrade-insecure-requests`;
  an `https://` canonical origin keeps all of them. Note the operator
  migration constraint: a hostname whose HSTS policy browsers have learned
  cannot be downgraded to HTTP-only until the policy expires (runbook §2).
- `TRUSTED_PROXY_CIDRS` must never cover the candidate client network.
  The bundled topology needs no operator value: `docker-compose.yml` pins
  the `exam-net` bridge subnet (`EXAM_DOCKER_SUBNET`, default
  `172.28.0.0/24`) and derives the `TRUSTED_PROXY_CIDRS` default from the
  same value, so `request.ip` is the real LAN client out of the box.
  Precise scope: the bundled default trusts every container on the bridge
  (web, app, db, redis, and any future service attached to `exam-net`) —
  wider than the web→app hop alone. External clients cannot exploit that:
  the web edge **replaces** `X-Forwarded-For` with the real client address
  (appending would let a client forge its audit/rate-limit identity) and
  overwrites `X-Forwarded-Host` / `X-Forwarded-Proto`, so client-supplied
  forwarding headers never survive as authoritative identity — but any
  container attached to `exam-net` is a trusted peer, so the bridge must
  remain stack infrastructure only. If the default subnet overlaps the
  host's LAN, VPN, or existing Docker networks, set `EXAM_DOCKER_SUBNET`
  to a free subnet — the bridge and the trust default follow it together
  (runbook §2). Override `TRUSTED_PROXY_CIDRS` itself ONLY when candidates
  reach the API through an external proxy (runbook §2 "Rate-limit
  identity, trusted proxies, and sizing").
- Set `CORS_ORIGIN` and `PUBLIC_WEB_ORIGIN` to the address users will
  access. The default is `http://localhost` (web owns public 80); a
  remapped `EXAM_PORT` or LAN address must set both explicitly (e.g.
  `http://192.168.1.5:8080`).

## Deployment Validation

The production deployment itself is the acceptance surface:
`docker compose config` proves interpolation, `up -d` + the runbook §11
smoke test (health and public-config curls, admin login, and an
admin/candidate walkthrough) prove real HTTP behavior.
The release workflow builds both images before any irreversible publication
step; it runs no deployment simulation.

## Runbooks

| Document | Purpose |
| --- | --- |
| [`mvp-deployment-runbook.md`](mvp-deployment-runbook.md) | Complete operator runbook: env, install, bootstrap, email, Redis, scanners, health, backup/restore, upgrade |
| [`upgrade-and-uninstall.md`](upgrade-and-uninstall.md) | Version upgrade, rollback, uninstall |
