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
> (API) and `ghcr.io/jnhu76/exam-web:vX.Y.Z` (nginx edge + static SPA,
> #585), pinned in
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
3. Ensure the target release images are available: online installs `pull`
   them automatically; air-gapped installs must `docker load` them beforehand
   (runbook §3 — the loaded references must equal `EXAM_IMAGE` /
   `EXAM_WEB_IMAGE`).

### 2.2 Step-by-step

```bash
# 0. Get the new release (repository + release artifacts).
git pull                      # master now carries the new .release-version
# (air-gapped: transfer the checkout + image archive; docker load it)

# 0b. ONE-TIME migration — BREAKING RENAME (installs made before the
#     env-file rename): the deployment env file is now .env.production.
#     Rename the old .env.deploy BEFORE running init-production-env, or
#     it would create a fresh file with NEW secrets against the kept
#     PGDATA (JWT logins and DB auth would break):
mv .env.deploy .env.production   # only if .env.production does not exist yet
#
#     INVARIANT (safe to re-run): an existing .env.production is NEVER
#     re-secreted. init-production-env only FILLS BLANK values; a value
#     already present — JWT_SECRET, POSTGRES_PASSWORD, or any explicit
#     operator override — is never regenerated or rotated, so no upgrade
#     run can invalidate sessions or database credentials.

# 0c. ONE-TIME migration — BREAKING RENAME (installs made before the
#     Compose project identities were pinned, #631): the production stack
#     now runs as project `exam-prod` (dev stack: `exam-dev`). The next
#     `up -d` creates NEW containers under that name; the old stateless
#     `exam` containers keep holding the published ports and must be
#     removed once, or the new web container cannot bind:
docker compose -p exam -f docker-compose.yml down --remove-orphans
#
#     Data safety: the data root is a bind mount outside the containers
#     (§1) — `down` never touches it. Idempotent: a no-op once no old
#     `exam` containers remain.

# 1. Re-pin the release images (canonical pins follow .release-version):
node scripts/init-production-env.mjs
#   - canonical pin (ghcr.io/jnhu76/exam:vX.Y.Z) -> re-derived to the NEW
#     version automatically;
#   - explicit non-canonical value (registry mirror / offline load) ->
#     update EXAM_IMAGE / EXAM_WEB_IMAGE by hand in .env.production.

# 2. Pre-upgrade backup (runbook backup section).
./scripts/db-backup.sh backup /mnt/nas/exam-$(date +%Y%m%d).dump

# 3. Pull the new pinned release images (no-op when already loaded locally):
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
  release image pair**:
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

  # 3. Pull + start the previous release images:
  docker compose --env-file .env.production pull
  docker compose --env-file .env.production up -d
  ```
- After an upgrade has applied migrations, the OLD binary is only safe
  against the restored pre-upgrade backup (schema from the future may be
  incompatible with the old image). Never roll back the release images while
  keeping an already-migrated database.

### 2.6 Post-upgrade verification checklist

```text
[ ] docker compose --env-file .env.production ps      # web + app + db healthy (no worker service — email delivery is in-process, #320 CONVERGE)
[ ] curl -s http://localhost:${EXAM_PORT:-80}/api/health   # {"status":"ok"} (through the web nginx edge, #585)
[ ] Log in as an existing Admin; open a candidate + a recent result.
[ ] Watch migration logs (first boot):
    docker compose --env-file .env.production logs app | grep -i migrat
[ ] Diagnostics sane: /api/system/diagnostics (db latency, worker heartbeat,
    scanner metrics).
[ ] For a planned rollback window: keep the pre-upgrade dump until the
    deployment is verified.
```

---

### 2.7 ADR-023 upgrade gate — backup-evidence preservation before 0045

ADR-023 removed the product-owned backup-evidence subsystem; the release
carrying migration `0045_drop_backup_evidence_tables` drops the five
tables that applied migrations 0031–0034 created (`backup_runs`,
`backup_run_events`, `restore_drill_runs`, `retention_runs`,
`backup_operational_policy`).

**Why an upgrade can intentionally fail to start:** the entrypoint
migrates on every boot (§2.3), and 0045 carries a built-in
evidence-preservation gate — if ANY of the five tables still holds rows,
the migration aborts BEFORE any DROP, the whole migrate transaction rolls
back, no journal entry is recorded, and the `app` container stays down
with the gate error in its logs (`docker compose ... logs app`). Tables
and rows are intact. That abort is the designed outcome: a deployment
cannot silently lose backup evidence by upgrading. Deployments that never
used the feature (all five tables empty) pass the gate and need nothing
from this section.

Gate workflow for deployments holding rows. INVARIANT — source stability:
from step 3 until the TRUNCATE in step 9 completes, the application stays
stopped; every manifest and the backup are captured inside that quiesced
window, and any write that reaches the five tables inside the window
invalidates the manifests and blocks cleanup. Count parity between the
source and restored manifests is a NECESSARY condition, not a content-level
proof: it proves the dump is current w.r.t. the five tables (a valid but
stale dump fails the comparison), while the whole-database restore itself
remains the preservation mechanism. This workflow operates on the
PRE-0045 database — it must not require the new release to be running.

1. **Inventory (read-only reconnaissance, for the owner decision).**
   ```bash
   PROD="docker compose --env-file .env.production -f docker-compose.yml"
   PGUSER="$($PROD exec -T db printenv POSTGRES_USER < /dev/null)"
   PGDB="$($PROD exec -T db printenv POSTGRES_DB < /dev/null)"
   for t in backup_runs backup_run_events restore_drill_runs \
            retention_runs backup_operational_policy; do
     $PROD exec -T db psql -U "$PGUSER" -d "$PGDB" -tAc \
       "SELECT '$t =', count(*) FROM $t"
   done
   ```
   These counts are reconnaissance only — the authoritative counts are
   the source manifest captured in step 5, inside the quiesced window.
2. **Owner decision.** The deployment owner records the evidence
   disposition (preserve-then-drop, or discard). No production DELETE or
   TRUNCATE runs before this disposition is recorded — the migration
   itself never deletes rows (it refuses non-empty tables), so any
   deletion is always a human-executed, owner-authorized step, in this
   workflow.
3. **Quiesce the evidence writers — Source Stability Gate, part 1.** The
   app is the only writer to the five tables. Stop it, then prove nothing
   else holds a client session on the database — as an executable
   assertion, not an eyeball check (background processes cannot write user
   rows; every client that can — the app, cron jobs, pooled connections,
   foreign tools — appears as a `client backend`):
   ```bash
   $PROD stop app
   WRITERS="$($PROD exec -T db psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -tAc \
     "SELECT count(*) FROM pg_stat_activity
      WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()")"
   [ "$WRITERS" = "0" ] || {
     $PROD exec -T db psql -U "$PGUSER" -d "$PGDB" -c \
       "SELECT pid, usename, application_name, client_addr FROM pg_stat_activity
        WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()"
     echo "ABORT: $WRITERS client backend(s) still connected — SOURCE_STABILITY = UNKNOWN" >&2
     exit 1
   }
   ```
   A nonzero answer means an unidentified writer is connected:
   `SOURCE_STABILITY = UNKNOWN`, and every later step is BLOCKED until it
   is resolved (identify and stop the client, then re-run this check).
   Do NOT proceed on the theory that "it is probably read-only".
4. **Fresh full backup — the authoritative preservation material.** Take
   a whole-database custom dump NOW, inside the quiesced window (a dump
   taken before the feature was ever used does not contain the rows):
   ```bash
   DUMP=/mnt/nas/exam-evidence-$(date +%F).dump
   ./scripts/db-backup.sh backup "$DUMP"
   DUMP_SHA256="sha256:$(sha256sum "$DUMP" | cut -d' ' -f1)"
   ```
   This same dump satisfies the upgrade checklist's mandatory pre-upgrade
   backup (runbook §15). Whole-database is deliberately the ONLY export
   format this gate treats as verifiable preservation evidence: the five
   tables carry foreign keys to `organizations` (migrations 0031–0033),
   and PostgreSQL table-scoped dumps (`pg_dump -t`) do not include
   referenced tables — a five-table-only dump cannot be restored into an
   empty database (its FK constraints have nothing to bind to), so it
   cannot be verified by restore and cannot stand alone as evidence. If
   a table-scoped copy is kept anyway, treat it as a non-authoritative
   convenience artifact; it is not the preservation record.
5. **Capture the SOURCE_MANIFEST** — the authoritative expected counts,
   recorded after the dump (equivalent to at-dump-time counts only
   because the writers are quiesced):
   ```bash
   ./scripts/verify-evidence-preservation.sh capture \
     --label "source:$PGDB" \
     --database-source "production db (compose project exam-prod)" \
     --dump-checksum "$DUMP_SHA256" \
     --expect-database "$PGDB" \
     --output evidence-source.manifest \
     -- $PROD exec -T db psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -tAc
   ```
   The validator aborts nonzero (and writes no manifest) on a missing
   table, connection failure, a non-integer count, or a capture aimed at
   the wrong database.
6. **Verify by isolated drill (runbook §17.2) — executable comparison.**
   First assert the dump file under test IS the checksum-recorded
   artifact from step 4 (the checksum binds the manifests to one
   artifact; restore a different file and that binding is a fiction):
   ```bash
   [ "sha256:$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA256" ] || {
     echo "ABORT: $DUMP is not the dump recorded in step 4" >&2; exit 1; }
   ```
   Then run the §17.2 drill with `DUMP` pointing at this dump. Between
   the drill's acceptance queries and the end of the block (its teardown
   is the ownership-checked EXIT trap), capture the RESTORED_MANIFEST
   from the drill container and run the comparison:
   ```bash
   ./scripts/verify-evidence-preservation.sh capture \
     --label "restored:exam_drill" \
     --database-source "drill container $DRILL" \
     --dump-checksum "$DUMP_SHA256" \
     --expect-database exam_drill \
     --output evidence-restored.manifest \
     -- docker exec "$DRILL" psql -U postgres -d exam_drill -v ON_ERROR_STOP=1 -tAc
   ./scripts/verify-evidence-preservation.sh compare \
     evidence-source.manifest evidence-restored.manifest
   ```
   `compare` prints `PRESERVATION_COUNT_PARITY=PASS` and exits 0 only
   when every one of the five counts matches and both manifests record
   the same dump checksum (an unrecorded checksum fails closed — the
   gate never decides on counts alone); any mismatch (a valid but STALE
   dump that restores cleanly yet misses recent evidence rows fails
   exactly here), missing table, or malformed manifest names the exact
   table/reason, exits nonzero, and prints `CLEANUP=BLOCKED`. The
   drill's fail-closed contract carries over unchanged: a run that
   aborts at any step (§17.2) means the preservation material is NOT
   verified, and step 9 must not run. Printing counts and comparing them
   by eye is not verification.
7. **Source Stability Gate, part 2 — re-check before cleanup.** Re-run
   the step-3 writer assertion (still zero client backends) and
   re-capture + re-compare the source manifest; anything but an exact
   PASS means an unknown writer acted inside the window:
   ```bash
   ./scripts/verify-evidence-preservation.sh capture \
     --label "source-recheck:$PGDB" \
     --database-source "production db (compose project exam-prod)" \
     --dump-checksum "$DUMP_SHA256" \
     --expect-database "$PGDB" \
     --output evidence-source-recheck.manifest \
     -- $PROD exec -T db psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -tAc
   ./scripts/verify-evidence-preservation.sh compare \
     evidence-source.manifest evidence-source-recheck.manifest
   ```
   Two equal counts alone never prove "no writes happened" — the writer
   isolation from step 3 is the control; this re-check is the tripwire
   that detects a broken one.
8. **STOP if anything failed.** If any step from 3 through 7 aborted or
   returned anything but PASS: `PRESERVATION_GATE = FAIL`,
   `AUTHORIZED_CLEANUP = BLOCKED`. Keep the dump, the manifests, and the
   untouched source database; restart the app (`$PROD up -d` with the old
   release) and re-run the workflow from step 3 with a fresh dump. Never
   resolve a failed gate by weakening the comparison.
9. **Authorized cleanup — locked, re-asserted, atomic.** Only with the
   disposition recorded, the drill comparison PASSED, and the stability
   re-check PASSED. The final stability check and the TRUNCATE run as ONE
   transaction: the five tables are locked `ACCESS EXCLUSIVE`, the counts
   are re-asserted against the VERIFIED source manifest (read back from
   `evidence-source.manifest`, so the numbers cannot drift from what was
   compared), and any mismatch rolls everything back with nothing
   truncated — closing the gap between a re-check and a separate cleanup
   command, where a last-instant write would be silently truncated. The
   SQL is piped via `printf` (not a heredoc) so the block pastes safely
   with this section's indentation, and the manifest values are
   re-validated as pure integers before they are interpolated into the
   SQL:
   ```bash
   declare -A EXPECTED
   while IFS='=' read -r k v; do
     case "$k" in
       backup_runs|backup_run_events|restore_drill_runs|retention_runs|backup_operational_policy)
         case "$v" in
           '' | *[!0-9]*)
             echo "ABORT: manifest value for $k is not an integer — manifest was not produced by the validator" >&2
             exit 1 ;;
         esac
         EXPECTED[$k]="$v" ;;
     esac
   done < evidence-source.manifest
   printf '%s\n' \
     "BEGIN;" \
     "LOCK TABLE backup_run_events, backup_runs, restore_drill_runs, retention_runs, backup_operational_policy IN ACCESS EXCLUSIVE MODE;" \
     "DO \$do\$" \
     "BEGIN" \
     "  IF (SELECT count(*) FROM backup_runs) <> ${EXPECTED[backup_runs]} THEN RAISE EXCEPTION 'source stability violated: backup_runs changed since the verified manifest'; END IF;" \
     "  IF (SELECT count(*) FROM backup_run_events) <> ${EXPECTED[backup_run_events]} THEN RAISE EXCEPTION 'source stability violated: backup_run_events changed since the verified manifest'; END IF;" \
     "  IF (SELECT count(*) FROM restore_drill_runs) <> ${EXPECTED[restore_drill_runs]} THEN RAISE EXCEPTION 'source stability violated: restore_drill_runs changed since the verified manifest'; END IF;" \
     "  IF (SELECT count(*) FROM retention_runs) <> ${EXPECTED[retention_runs]} THEN RAISE EXCEPTION 'source stability violated: retention_runs changed since the verified manifest'; END IF;" \
     "  IF (SELECT count(*) FROM backup_operational_policy) <> ${EXPECTED[backup_operational_policy]} THEN RAISE EXCEPTION 'source stability violated: backup_operational_policy changed since the verified manifest'; END IF;" \
     "END" \
     "\$do\$;" \
     "TRUNCATE backup_run_events, backup_runs, restore_drill_runs, retention_runs, backup_operational_policy;" \
     "COMMIT;" \
     | $PROD exec -T db psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1
   ```
   A failed assertion aborts with `ON_ERROR_STOP` before the TRUNCATE
   statement executes, and the open transaction rolls back regardless;
   only a clean run through `COMMIT` reports success. A non-integer
   manifest value (a hand-edited manifest) aborts before any SQL is sent.
10. **Recheck empty.** Re-run step 1 — all five counts must be `0`.
11. **Apply 0045.** `docker compose --env-file .env.production up -d` with
   the new release: the entrypoint migrates, the gate passes, the journal
   records 0045, the tables are dropped, the app restarts.
12. **Post-verify.** §2.6 checklist plus:
   ```bash
   $PROD exec -T db psql -U "$PGUSER" -d "$PGDB" -tAc \
     "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN
        ('backup_runs','backup_run_events','restore_drill_runs','retention_runs','backup_operational_policy')"
   # expected: 0
   ```

Declining the upgrade (keeping the evidence in place): restart the app
with the previous release. The aborted 0045 recorded no journal entry, so
the database is still at the pre-0045 schema and runs unchanged under the
old image. After step 11 has succeeded, rollback is only the §2.5
restore path — in the migrated database the tables are gone.

Record the gate outcome per deployment, in the operator's own records
(never in this repository): deployment identifier, environment type,
whether a production database exists, current schema/migration head, the
five table counts, whether historical evidence is present, the
preservation backup path and checksum, the source/restored manifests and
the `PRESERVATION_COUNT_PARITY` verdict (the comparison is executed by
`scripts/verify-evidence-preservation.sh`, never by eye), the
source-stability gate results, the data-destruction authorization (who,
when), and 0045 rollout readiness. Production record contents,
credentials, and sensitive paths stay out of GitHub.

The DO gate inside 0045 is the LAST line of defense, not a deployment
approval system: the disposition workflow above is the actual gate, and
blocking the rollout before `up -d` (runbook §15) is the primary control.
An operator who sees the gate error has skipped the workflow, not hit a
tooling failure.

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