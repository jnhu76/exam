# Upgrade & Uninstall Lifecycle Guide

> **Authority:** canonical operator guide for upgrading an existing
> deployment to a new release and for uninstalling (preserving or deleting
> data). Companion to
> [`mvp-deployment-runbook.md`](./mvp-deployment-runbook.md) (first install,
> operations, and the backup/restore contract via `scripts/db-backup.sh`).
>
> **Scope:** LAN/on-premise, single-tenant, single-node Docker Compose
> deployments (the reference stack). Multi-tenant / cloud / Phase 4 modes
> are not implemented. Every `docker compose` command below runs against
> the deployment env file exactly as the runbook documents:
> `docker compose --env-file .env.production ...`.
>
> **Prebuilt images (#321):** the stack runs `ghcr.io/jnhu76/exam:vX.Y.Z`
> (API) and `ghcr.io/jnhu76/exam-web:vX.Y.Z` (static SPA, #585), pinned in
> `.env.production` as `EXAM_IMAGE` / `EXAM_WEB_IMAGE` (derived from
> `.release-version` by `node scripts/init-production-env.mjs`; an explicit
> non-canonical value — mirror / offline load — wins). There is no
> `latest` tag; the semantic pin is the upgrade/rollback authority. Image acquisition (online pull,
> offline `docker save`/`docker load`) is documented in the runbook §3.

---

## 1. Persistent state inventory

Only TWO things carry state between deployments, and both live OUTSIDE the
containers:

| What | Where | Contents | Survives `down` | Removed by full uninstall (below) |
|---|---|---|---|---|
| Data root (`EXAM_DATA_ROOT`, default `./data`) | `data/postgres` | PostgreSQL PGDATA — ALL business data | yes | yes (deleted) |
| | `data/redis` | Redis persistence (`redis` profile only) | yes | yes |
| Deployment env file | `.env.production` | `JWT_SECRET`, `POSTGRES_PASSWORD`, `EXAM_IMAGE` / `EXAM_WEB_IMAGE` pins, `EXAM_PORT`, `TRUSTED_PROXY_CIDRS`, overrides | yes | yes (deleted) |

Containers, the `exam-net` network, and the Compose project carry NO state
(`docker compose down` removes them; PostgreSQL data lives in the bind
mount). The dev `.env` file is unrelated to the deployment and is never
read with `--env-file`.

> **`down -v` note:** with bind mounts there are no named volumes, so
> `down -v` removes nothing extra — the data root is retained either way.
> Deleting data is an explicit `rm` (see §3.2).

---

## 2. Upgrade guide

### 2.1 Supported path

Single supported flow: **new checkout → `init-production-env` re-pin (or manual
`EXAM_IMAGE`) → `docker compose pull` → `up -d`. Containers migrate
automatically on start.** All upgrades run against the bundled `db`
service (the app's `DATABASE_URL` is composed from `POSTGRES_*` — the
bundled Postgres is required; external Postgres is not a supported path).

Upgrade prerequisites:

1. Read the release notes (`CHANGELOG.md` / `docs/releases/vX.Y.Z.md`) for
   the TARGET version — upgrade-blocking obligations (mandatory
   intermediate version, `db` image major bump, manual steps) are always
   stated in the release notes.
2. **Back up the database first** (mandatory): canonical path is
   `pg_dump -Fc` via the operator tool —
   `./scripts/db-backup.sh backup /mnt/nas/exam-$(date +%Y%m%d).dump`
   (see the runbook backup section). A pre-upgrade backup is the rollback
   precondition (§2.4).
3. Ensure the target image is available: online installs `pull` it
   automatically; air-gapped installs must `docker load` it beforehand
   (runbook §3 — the loaded references must equal `EXAM_IMAGE` /
   `EXAM_WEB_IMAGE`).

### 2.2 Step-by-step

```bash
# 0. Get the new release (repository + release artifacts).
git pull                      # master now carries the new .release-version
# (air-gapped: transfer the checkout + image archive; docker load it)

# 0b. ONE-TIME migration (installs made before the env-file rename):
#     the deployment env file is now .env.production. Rename the old
#     .env.deploy BEFORE running init-production-env, or it would create a
#     fresh file with NEW secrets against the kept PGDATA:
mv .env.deploy .env.production   # only if .env.production does not exist yet

# 1. Re-pin the image (operator image pin follows .release-version):
node scripts/init-production-env.mjs
#   - canonical pin (ghcr.io/jnhu76/exam:vX.Y.Z) -> re-derived to the NEW
#     version automatically;
#   - explicit non-canonical value (registry mirror / offline load) ->
#     update EXAM_IMAGE / EXAM_WEB_IMAGE by hand in .env.production.

# 2. Pre-upgrade backup (runbook backup section).
./scripts/db-backup.sh backup /mnt/nas/exam-$(date +%Y%m%d).dump

# 3. Pull the new pinned image (no-op when already loaded locally):
docker compose --env-file .env.production pull

# 4. Upgrade (migrations run automatically on app start — see §2.3):
docker compose --env-file .env.production up -d
```

### 2.3 What the entrypoint does on upgrade

- The `app` container runs `dist/scripts/migrate.js` before binding: the
  drizzle journal applies every not-yet-applied migration in order, then
  the API starts. Re-runs are idempotent (`NOTICE: schema "drizzle" already
  exists, skipping` is expected).
- The email outbox delivery loop runs in-process inside the `app`
  container (#320 CONVERGE — there is no dedicated email-worker service);
  it waits for the first organization to be bootstrapped before polling.
- `up -d` **recreates** `app` when its image reference changed; the `db`
  container is untouched when the `db` image did not change (state and
  container continuity).
- No seed runs in production: the baseline seed refuses
  `APP_MODE=production` (bootstrap/`bootstrap-admin.js` is the only
  account-creation path).

### 2.4 Version-skipping policy

- **Skipping intermediate releases is supported by default.** Migrations
  are forward-append-only (no down migrations); the journal applies any
  backlog in order, so a jump `v0.0.2 → v0.0.4` replays `v0.0.3`'s
  migrations then `v0.0.4`'s.
- A release whose upgrade REQUIRES an intermediate version (e.g. a data
  migration that must observe a prior version's schema) must say so
  explicitly in its release notes; until then, the default (skip allowed)
  governs.
- **`db` image major bumps are breaking upgrades**: the PGDATA is tied to
  the PostgreSQL major version (currently 18). A release that changes the
  `db` image major must announce it and require the dump/restore path
  (`./scripts/db-backup.sh backup` + `restore` against the new cluster) —
  never boot a newer major against an old PGDATA.

### 2.5 Rollback contract

- Migrations are **forward-only**; there are no generated down migrations.
  Rollback = **restore the pre-upgrade DB backup + redeploy the previous
  image tag**:
  ```bash
  # 1. Restore the pre-upgrade backup (stops the app, rebuilds the DB,
  #    restarts, waits for health):
  ./scripts/db-backup.sh restore /mnt/nas/exam-<date>.dump

  # 2. Point EXAM_IMAGE / EXAM_WEB_IMAGE at the previous release — CAREFUL:
  #    a canonical `ghcr.io/jnhu76/exam{,-web}:vX.Y.Z` value follows
  #    .release-version on the NEXT init-production-env run, which would silently
  #    revert the rollback. Options:
  #    - edit .env.production AFTER the last init-production-env run (edit wins); or
  #    - pin by digest: EXAM_IMAGE=ghcr.io/jnhu76/exam@sha256:<digest>
  sed -i 's|^EXAM_IMAGE=.*|EXAM_IMAGE=ghcr.io/jnhu76/exam:v<PREVIOUS>|' .env.production
  sed -i 's|^EXAM_WEB_IMAGE=.*|EXAM_WEB_IMAGE=ghcr.io/jnhu76/exam-web:v<PREVIOUS>|' .env.production

  # 3. Pull + start the previous image:
  docker compose --env-file .env.production pull
  docker compose --env-file .env.production up -d
  ```
- After an upgrade has applied migrations, the OLD binary is only safe
  against the restored pre-upgrade backup (schema from the future may be
  incompatible with the old image). Never roll back the image while
  keeping an already-migrated database.

### 2.6 Post-upgrade verification checklist

```text
[ ] docker compose --env-file .env.production ps      # nginx running; app + web + db healthy (no worker service — email delivery is in-process, #320 CONVERGE)
[ ] curl -s http://localhost:${EXAM_PORT:-80}/api/health   # {"status":"ok"} (through the nginx edge, #585)
[ ] Log in as an existing Admin; open a candidate + a recent result.
[ ] Watch migration logs (first boot):
    docker compose --env-file .env.production logs app | grep -i migrat
[ ] Diagnostics sane: /api/system/diagnostics (db latency, worker heartbeat,
    scanner metrics).
[ ] For a planned rollback window: keep the pre-upgrade dump until the
    deployment is verified.
```

---

## 3. Uninstall guide

Choose the mode that matches the intent:

- **Preserve data** (`down`): stops the stack, keeps the data root and the
  env file. Reinstall (same or new version) resumes with all state.
- **Full removal**: additionally deletes the data root and the env file —
  a genuinely fresh deployment afterwards (new secrets, empty database,
  re-bootstrap).

### 3.1 Preserve mode (data kept)

```bash
# Stop everything (containers + network removed; data + env file kept):
docker compose --env-file .env.production down

# Later, resume:
docker compose --env-file .env.production up -d
```

Verified properties: `down` keeps `${EXAM_DATA_ROOT}/postgres` intact;
`up` afterwards recreates containers and the database still holds every
row (users, courses, exams, attempts, journal). Services carry
`restart: unless-stopped`, so a host reboot brings the stack back
automatically; `up -d` recomputes desired state and is the safe resume
command after any manual `stop`/`down`.

### 3.2 Full removal (data deleted)

```bash
# 1. Review what will be lost. If any doubt: back up first (mandatory for
#    production data):
./scripts/db-backup.sh backup /mnt/nas/exam-final-$(date +%Y%m%d).dump

# 2. Stop and remove the stack:
docker compose --env-file .env.production down

# 3. Delete the data root (default ./data — PGDATA, redis dir). This is the ONLY step that actually destroys business data:
rm -rf "${EXAM_DATA_ROOT:-./data}"

# 4. Delete the deployment env file (secrets: JWT_SECRET, POSTGRES_PASSWORD
#    — treat the file as a credential):
rm -f .env.production

# 5. Optional: prune now-orphaned Docker resources:
docker system prune   # -a --volumes for everything; confirm the prompt
```

> **The data root and the env file are coupled.** `POSTGRES_PASSWORD` is
> baked into an existing PGDATA at cluster creation; `init-production-env` fills
> it only when blank (never rotates). Bootstrapping a kept PGDATA with a
> regenerated (different) password makes the API unable to authenticate
> against the existing cluster. Full removal therefore deletes BOTH (steps
> 3 + 4); keep-data reinstalls must keep the env file too (preserve mode
> keeps both automatically).

What full removal does NOT touch: the repository checkout (source code,
docs), the dev `.env`, `docker-compose.yml`, and any backups you took —
they are deliberately kept so a fresh install can follow the runbook with
zero remaining state. The Compose project/network are already gone after
`down`; images remain on disk (`docker image prune` to remove them).

### 3.3 Verifying a truly fresh state

After full removal, install again (runbook §3):
`node scripts/init-production-env.mjs` derives NEW secrets and the current
`EXAM_IMAGE` / `EXAM_WEB_IMAGE` pins, then
`docker compose --env-file .env.production up -d`.
Properties of the resulting deployment:

- the database has 0 organizations before bootstrap (no rows from the old
  install survive);
- the first-Admin bootstrap (`bootstrap-admin.js`) succeeds and old
  credentials are rejected;
- migration journal starts empty and replays all migrations once.

---

## 4. Evidence (direct, not advisory)

The lifecycle contracts in this guide are proven by running the documented
commands themselves — the real Compose execution IS the acceptance surface:

| Contract | How to prove it |
|---|---|
| Pin re-derivation / explicit override / stale-canonical re-pin | run `node scripts/init-production-env.mjs` twice; the pin follows `.release-version`, explicit overrides are preserved, the file is byte-stable |
| Preserve mode: `down` keeps PGDATA; re-`up` restores state | §3.1 commands + login with existing credentials |
| Upgrade mechanics: image-pin swap → `up -d` recreates app, db untouched | §2.2 commands + §2.6 checklist (health, migrations, login) |
| Full removal: data + env file deleted → fresh DB, fresh bootstrap | §3.2/§3.3 commands + 0-organization bootstrap |
| Backup/restore round-trip | `./scripts/db-backup.sh backup` → `restore` → app healthy + data present |