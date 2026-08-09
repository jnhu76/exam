# Portable Single-Node Deployment (P7-C1)

The portable-deployment invariant:

> **A compatible clean Docker host + deployment config (compose + `.env`)
> + canonical persistent data (`./data/postgres`) + the same prebuilt image
> = the SAME Exam deployment, via the ORDINARY `docker compose up -d` path.**

P7-C1 makes a deployment behave like an appliance: you can move it to a
different machine and it comes up as the same deployment — same
organization, users, questions, exams, attempts, enrollments, settings,
audit trail — without re-seeding, re-configuring, or rebuilding.

This document is the operator guide. The proof scripts are:

- `pnpm drill:p7-c1-relocation` — local **clean-root** drill (projects A→B
  on one host; `scripts/deployment/p7-c1-relocation-drill.sh`).
- `.github/workflows/p7-c1-relocation.yml` — CI **clean-host** drill (two
  separate runners; workflow_dispatch / C1 branch).
- `pnpm proof:p7-c1-redis-nonauthority` — Redis-non-authority proof with
  Redis ENABLED (`scripts/deployment/p7-c1-redis-nonauthority-proof.sh`).

## 1. The three operations are different

| Operation | What it is | Status |
|---|---|---|
| **Relocation** | Move the deployment (compose + `.env` + `./data/postgres` + the same image) to a compatible clean host; boot via the ordinary path. The server's data was always one coherent snapshot. | **P7-C1 — implemented + drilled** |
| **Historical restore** | Put the database back to an exact earlier point in time (dump restore). NOT the same as relocation: an older dump into a newer DB may leave drift unless the target is recreated under an explicit restore contract. | P7-C2/C3 — NOT implemented (see runbook §17) |
| **PITR** | Point-in-time recovery from a base backup + WAL archive. | P7-C5 — NOT implemented (`wal_level=replica` is ready; archive_mode / archive_command / retention / recovery are not) |

Do not use the relocation procedure as a backup/restore procedure. Relocation
moves the current state; it does not go back in time.

## 2. What is authoritative, what is not

| Store | Location | Authority |
|---|---|---|
| PostgreSQL | `${EXAM_DATA_ROOT:-./data}/postgres` (bind mount; PGDATA is NOT overridden — the image owns `/var/lib/postgresql/18/docker`) | **AUTHORITATIVE** — this is Exam truth |
| Redis | `${EXAM_DATA_ROOT:-./data}/redis` (optional profile) | **NOT authoritative** — only rate-limit counters (C0 §8 / ADR-001). Dropping it is always safe; counters simply reset |

Deleting `${EXAM_DATA_ROOT}/postgres` deletes the deployment.
`docker compose down` preserves it; `down -v` removes only named volumes (of
which the production topology has none) — it does NOT delete `./data`.
`rm -rf ${EXAM_DATA_ROOT}` is the destructive action.

## 3. Deployment config = compose + `.env`

- `docker-compose.yml` is **image-only**: `app` and `email-worker` consume
  `${EXAM_IMAGE}` (required). A bare `docker compose up -d` NEVER rebuilds
  source — relocation never silently builds "whatever is checked out".
- Local source builds use the override file:
  `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`
- `.env` holds POSTGRES_PASSWORD, JWT_SECRET, CORS_ORIGIN,
  PUBLIC_WEB_ORIGIN, EXAM_IMAGE, EXAM_DATA_ROOT (optional), APP_PORT
  (optional), REDIS_* (optional).

## 4. Image identity (three layers)

1. `EXAM_VERSION` — human release version (build arg → OCI label
   `org.opencontainers.image.version`). Evidence, not identity.
2. `EXAM_REVISION` — git SHA (build arg → OCI label
   `org.opencontainers.image.revision`). Evidence, not identity.
3. **The actual identity is the `EXAM_IMAGE` reference.** Pin it
   immutably for relocation: `EXAM_IMAGE=registry.example/exam@sha256:...`
   (digest) or at minimum an immutable release tag. The drill records
   `docker image inspect ... RepoDigests` alongside the invariant hashes.

```bash
# Local source build with identity labels (one-time):
EXAM_VERSION=$(node -p "require('./package.json').version") \
EXAM_REVISION=$(git rev-parse HEAD) \
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## 5. Schema/image compatibility preflight (C1.3)

Before migrating, the app entrypoint runs `node dist/scripts/preflight.js`:

- **FRESH_INSTALL** (no migration journal) → proceed.
- **NORMAL** (DB migration history == image history) → proceed.
- **FORWARD_UPGRADE** (DB is behind the image; image has the newer
  migrations) → proceed — this is a normal upgrade.
- **STALE_IMAGE_DB_AHEAD** (DB has migrations the image does not know) →
  REFUSE. Use a newer image or restore an older data root.
- **DIVERGENT** (rows whose `(when, hash)` are not in the image set and are
  not newer than the image frontier) → REFUSE. The DB history does not
  match the image; do not let drizzle mutate it.

The comparison is history-aware (frontier + membership on `(when, hash)`,
mirroring the migration journal's own semantics), so known historical
convergence cases (the `0004`/`0022`/`0024` omissions repaired by later
convergence migrations) classify as NORMAL, not DIVERGENT. A PostgreSQL
major check (`SHOW server_version_num` vs the pinned `postgres:18`) refuses
a PGDATA from another PG major — raw PGDATA is tied to a major version.

Break-glass (operator emergencies only, documented here because this is the
emergency section): `EXAM_UNSAFE_SKIP_SCHEMA_PREFLIGHT=1` skips the gate
with a loud WARN on every startup and is surfaced in
`/api/system/diagnostics` as `preflightBypassed: true`. It is DISALLOWED in
the relocation drills and must never be a routine setting.

## 6. Relocation procedure (PG stopped or fully flushed)

1. **Prepare the source host** — stop the stack (data is preserved):
   ```bash
   docker compose down
   ```
2. **Copy the deployment** (metadata-preserving; the PGDATA tree is owned
   by uid 999 — copy as uid 999 or chown after copying):
   ```bash
   sudo chown -R 999:999 ./data/postgres          # if ownership is wrong
   rsync -a ./data/postgres <target>:<path>/data/postgres
   rsync -a docker-compose.yml .env <target>:<path>/
   ```
   `.env` is deployment config: same EXAM_IMAGE, same secrets. Do NOT copy
   `./data/redis` — Redis is non-authoritative.
3. **On the target host** (compatible clean Docker host, same PostgreSQL
   major via the pinned `postgres:18.4-bookworm` image):
   ```bash
   # same .env (EXAM_IMAGE pinned), then the ORDINARY path:
   docker compose up -d
   ```
   The preflight classifies the relocated DB **NORMAL** and proceeds; the
   server comes up as the same deployment. There is no seed, no rebuild.

### First-install from scratch (no data to relocate)

```bash
# Build/tag the image (§4), write .env with EXAM_IMAGE, then:
docker compose up -d
# FRESH_INSTALL preflight → migrate → server up.
# Create the first Admin via the launchpad (recommended) or the CLI:
#   LAUNCHPAD_SETUP_TOKEN=<high-entropy secret>  (in .env)
#   open http://<host>:<port>/launchpad
#   -- or --
#   docker compose exec app node dist/scripts/bootstrap-admin.js \
#     --username admin --password '<STRONG>' --name 'System Admin' \
#     --organization-name 'My Organization'
```

## 7. Launchpad operator handoff (C1.6)

- `LAUNCHPAD_SETUP_TOKEN` is a deployment secret set by the operator in
  `.env`. The launchpad page is usable ONLY while the installation is
  genuinely fresh (no organization AND no user has ever existed) AND the
  token is set.
- The business administrator opens `/launchpad`, enters the setup code +
  organization name + first-Admin credentials. The first user is ALWAYS an
  Admin; the caller cannot request roles or organization ids. There is NO
  auto-login after bootstrap.
- The token is compared constant-time, the route is rate-limited, and the
  token is never written to audit/log.
- **After the first Admin exists, the installation is permanently COMPLETED**
  — the launchpad never reopens, even if the token is still set or all
  Admins are later disabled/deleted (no privilege takeover). `/register`
  stays 403 forever.
- The operator SHOULD remove `LAUNCHPAD_SETUP_TOKEN` from `.env` after
  handoff. `GET /api/launchpad/status` reports READY /
  OPERATOR_ACTIVATION_REQUIRED / COMPLETED only.

## 8. Redis is optional — even when enabled

With the `redis` profile enabled (REDIS_URL + REDIS_PASSWORD set), the
shared rate limiter writes its counters to Redis. Redis persistence is
still OPTIONAL: relocate PostgreSQL only (no `./data/redis`) and Redis
starts empty — all Exam business invariants are identical, only the
rate-limit counters reset. Proven by `pnpm proof:p7-c1-redis-nonauthority`
(C1.5). Never treat `./data/redis` as data to back up or relocate.

## 9. Verification after relocation

```bash
docker compose ps                      # app/db healthy
docker compose logs --tail=50 app      # preflight NORMAL + migrations
docker compose exec db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM users;"'
# compare counts/md5 against the source host (the drill does this exactly)
```

The drills verify, byte-for-byte, that the relocation preserved: migration
count, per-table counts and content md5 for organizations / users /
questions / exams / exam_enrollments / exam_attempts, and that the seeded
admin login works.

## 10. Non-goals (do NOT use this guide for)

- Backups / off-host retention (P7-C4, not implemented — runbook §17).
- Historical restore (P7-C2/C3, not implemented — runbook §17).
- PITR / WAL archiving (P7-C5, not implemented).
- Multi-node / HA / Kubernetes (out of scope).
- The CI drill's transport tar is a two-runner handoff artifact, NOT a
  documented product backup format.
