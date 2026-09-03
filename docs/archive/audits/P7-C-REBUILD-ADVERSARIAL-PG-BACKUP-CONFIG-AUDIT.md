# P7-C Rebuild — Adversarial Audit: PG Backup Simplicity & Config Sync

Repository: `jnhu76/exam`
Branch: `feat/p7-c-portable-backup-recovery`
Audit target: P7-C rebuild (C1 portable + cold + Launchpad, C2 logical, C3 physical + PITR)
Commits audited (`2a1a9eb3..0ebdf6eb`):

```
0ebdf6eb docs(p7-c): close portable backup and recovery program
0df4ba72 feat(p7-c3): physical backup and PITR
e164fd30 feat(p7-c2): logical backup and verified clean restore
df2d07df feat(p7-c1): portable persistence, cold backup and launchpad
```

Audit date: 2026-08-10
Audit method: adversarial code/proof review focused on (a) whether the
PostgreSQL backup/restore tooling follows PostgreSQL's documented contract
and is as simple as it can be, and (b) whether the configuration surface
(`.env`* / `docker-compose*.yml` / scripts / docs) is internally
synchronized. PostgreSQL behavior was verified against the official
PostgreSQL 18 documentation via Context7; the `docker-entrypoint.sh`
extension handling was verified against the official postgres image source.

Scope note: this is **not** a re-run of the earlier PR #273 audit
(`docs/audits/P7-C1-ADVERSARIAL-PORTABLE-DEPLOYMENT-AUDIT.md`, which targets
a different, abandoned PR). That document is retained as history. This audit
covers the rebuilt C1/C2/C3 on this branch only.

---

## 1. Executive verdict

**Request changes** — the backup/restore *mechanics* are sound and follow
PostgreSQL's documented contract, but two configuration-synchronization
defects make a documented operator path silently inert:

1. **Critical (config sync) — PITR initdb seed is silently dead.**
   `docker-compose.pitr.yml` mounts `docker/pitr/wal-archive.conf` into
   `/docker-entrypoint-initdb.d/99-pitr-wal-archive.conf`. The official
   postgres image **ignores `.conf` files** in that directory (verified
   against the image's `docker-entrypoint.sh`: only `.sh`, `.sql`,
   `.sql.gz`, `.sql.xz`, `.sql.zst` are processed; `.conf` hits the `*)`
   branch → `ignoring`). The documented fresh-start path
   (`docker compose -f docker-compose.yml -f docker-compose.pitr.yml up -d`)
   therefore **does not enable WAL archiving at first init**. The drills
   bypass this by applying the same settings via `ALTER SYSTEM`, so the
   broken compose path is never exercised. An operator following the docs
   for a fresh PITR-enabled deployment will believe archiving is on when it
   is not — the first base backup taken will have **no WAL chain forward**
   and PITR will silently not be possible. (§3.1)

2. **Critical (config sync) — Launchpad token is never forwarded to the app
   container (P2-1, carried over from the prior audit).** `docker-compose.yml`
   has **no** `LAUNCHPAD_SETUP_TOKEN` in the `app` service `environment:`
   block and no `env_file:`. The README, the runbook, and
   `docs/deployment/backup-and-recovery.md` §11.1 all instruct the operator
   to "set `LAUNCHPAD_SETUP_TOKEN` in `.env`". Compose uses `.env` for
   **interpolation only** — a value there is never injected into a container
   unless an `environment:` entry references it. With the token in `.env`,
   the app container sees `LAUNCHPAD_SETUP_TOKEN` unset, so
   `runtimeConfig.ts` disables launchpad (`setupToken: ""`), and
   `POST /api/launchpad/bootstrap` always returns 403
   `LAUNCHPAD_INVALID_SETUP_TOKEN`. The headline C1.6 first-install UX is
   **inert in the bundled deployment**; only the `bootstrap-admin` CLI path
   works. (§4.1)

The backup scripts themselves (C1 cold copy, C2 `pg_dump -Fc` + clean
restore, C3 `pg_basebackup` + `pg_verifybackup`) are faithful to PostgreSQL's
documented patterns and are simpler than the rebuilt program claims to be —
see §2. Several lower-severity config-sync and PG-convention issues are in
§3/§4.

---

## 2. PostgreSQL backup simplicity & PG-convention review

### 2.1 What is genuinely good (and simple)

| Tool | PG-contract adherence | Notes |
| --- | --- | --- |
| `cold-filesystem-backup.sh` / `-restore.sh` | Correct | Refuses a live copy; validates `PG_VERSION` + `postgresql.conf`; container-assisted `cp -a` to preserve uid-999 ownership; refuses to overwrite; path-guarded. Matches PG's "cold physical backup = stopped server + complete PGDATA copy" contract. |
| `postgres-logical-backup.sh` (`pg_dump -Fc`) | Correct | `-Fc` (custom format) + `-X stream`-equivalent self-consistency + `--no-owner`; never puts the password on argv; verifies artifact with non-empty + `PGDMP` magic + `pg_restore --list`. This is the routine online backup PG documents. |
| `postgres-logical-restore.sh` | Correct & notably well-reasoned | `DROP DATABASE` + `CREATE DATABASE ... TEMPLATE template0` before `pg_restore` is the PG-documented way to get an **exact** match of the dump (avoids the `--clean --if-exists` merge trap where dump-absent objects survive). `--exit-on-error` fails fast. Refuses `postgres`/`template0`/`template1`. |
| `pg-basebackup.sh` | Correct | `-X stream -c fast -Fp --manifest-checksums SHA256`; `pg_verifybackup` on the manifest before success; `--no-sync` deliberately not used. |
| WAL `archive_command` | Correct | `test ! -f /wal-archive/%f && cp %p /wal-archive/%f` is the PG-documented idiom that **refuses to silently overwrite** a colliding segment. |
| PITR recovery config | Correct | `recovery.signal` + `postgresql.auto.conf` (`restore_command` + `recovery_target_lsn` + `recovery_target_inclusive = on` + `recovery_target_action = 'promote'`). `recovery_target_lsn` is the clock-skew-independent choice PG documents. Verified against PG18 docs. |

The program is appropriately **simple**: it uses PG-native tools, adds no
custom protocol, and the negative-space contract (§9 of the closeout) is
honest. This is the right shape.

### 2.2 PG-convention issues (ordered by severity)

**(Required) — `pg-basebackup.sh` claims "no replication password needed"
but connects over TCP (`-h 127.0.0.1`), which the official image authenticates
with `scram-sha-256` by default.** `scripts/backup/pg-basebackup.sh:96-100,
119-122`:

```
# The local connection uses peer/trust auth for the bootstrap superuser
# (POSTGRES_USER), so no replication password is needed for the bundled
# single-node path.
...
docker run --rm \
  --network "container:${DB_CONTAINER}" \
  -e PGPASSWORD="${PGPASSWORD:-}" \
  postgres:18.4-bookworm \
  pg_basebackup -h 127.0.0.1 -U "${PGUSER:-exam}" ...
```

The comment is wrong. The official postgres image's default `pg_hba.conf`
authenticates TCP connections (`host all all all scram-sha-256`); **trust**
applies only to Unix-socket local connections. `-h 127.0.0.1` is TCP, so
`pg_basebackup` **will** be challenged for a password. The script reads
`PGPASSWORD` from the **host** environment (`${PGPASSWORD:-}`); if the
operator has not `export PGPASSWORD=<POSTGRES_PASSWORD>` on the host, the
connection fails with `password authentication failed`. The drill works only
because the drill exports `POSTGRES_PASSWORD` and the operator would have to
also export `PGPASSWORD` — but the script header explicitly tells them they
do not need to. Two clean fixes, either is fine:

- connect over the Unix socket (`-h /var/run/postgresql`, no `-h`, or
  `PGHOST=/var/run/postgresql`) inside the db container's network namespace
  — then `trust`/`peer` actually applies and the comment becomes true; or
- drop the "no password needed" claim and document that the operator must
  `export PGPASSWORD=<POSTGRES_PASSWORD>` on the host (and use
  `PGUSER="${PGUSER:-$POSTGRES_USER}"` — see next item).

Note: `pg_basebackup` requires a role with `REPLICATION` or `SUPERUSER`
(verified against PG18 `app-pgbasebackup.html` + `warm-standby.html`). The
`POSTGRES_USER` superuser satisfies this, so authority is fine; the defect is
purely the auth-method/password claim.

**(Nit) — `PGUSER` default `exam` diverges from `POSTGRES_USER` when the
operator customizes the latter.** `pg-basebackup.sh:122` hardcodes
`-U "${PGUSER:-exam}"`. The C2 backup script correctly reads
`-U "$POSTGRES_USER"` from inside the container. If the deployment uses
`POSTGRES_USER=appdb`, `pg-basebackup.sh` connects as the wrong/nonexistent
role. Mirror the C2 pattern or default `PGUSER="${PGUSER:-exam}"` and
document that `PGUSER` must equal `POSTGRES_USER`.

**(Nit) — cosmetic `POSTGRES_INITDB_ARGS: ""` in the PITR override is dead
config.** `docker-compose.pitr.yml:34` sets `POSTGRES_INITDB_ARGS: ""`. The
base compose does not set it, so the official image default (empty) already
applies. Setting `""` is a no-op that reads as if an arg (e.g.
`--data-checksums`) was intended and dropped. Remove it or document why it is
there. (This is not the cause of the `.conf`-ignored defect in §3.1 — that is
the file extension.)

**(FYI) — cold backup does not explicitly check `postmaster.pid` absence.**
A clean `docker compose down` removes it, and the restore script refuses a
populated destination, so this is not reachable in the supported flow. PG
will refuse to start on a stale `postmaster.pid` anyway (loud). Recorded as a
known-safe gap; no action required.

---

## 3. Critical config-sync defect: PITR initdb seed is silently ignored

### 3.1 The defect

`docker-compose.pitr.yml:45`:

```yaml
- ./docker/pitr/wal-archive.conf:/docker-entrypoint-initdb.d/99-pitr-wal-archive.conf:ro
```

`docker/pitr/wal-archive.conf` contains `ALTER SYSTEM SET archive_mode = 'on';`
etc. The official postgres image's `docker-entrypoint.sh` processes
`/docker-entrypoint-initdb.d/` files with this `case` (verified verbatim
against `docker-library/postgres` master):

```bash
case "$f" in
    *.sh)      ... ;;
    *.sql)     ... docker_process_sql -f "$f" ... ;;
    *.sql.gz)  ... gunzip -c "$f" | docker_process_sql ... ;;
    *.sql.xz)  ... xzcat "$f" | docker_process_sql ... ;;
    *.sql.zst) ... zstd -dc "$f" | docker_process_sql ... ;;
    *)         printf '%s: ignoring %s\n' "$0" "$f" ;;
esac
```

A `.conf` file matches `*)` and is **ignored** with a log line. `archive_mode`
is **not** enabled. The override's own header even hedges: "For a
fresh start with this override, the entrypoint-init WAL config below seeds it
at first init." — but it does not, because of the extension.

### 3.2 Why the drills do not catch it

Both PITR drills (`p7-c3-pitr-drill.sh`, `p7-c3-pitr-failure-drill.sh`)
**ignore the compose override entirely** and instead apply archiving via
`ALTER SYSTEM` against the running cluster:

```bash
psql_src -c "ALTER SYSTEM SET archive_mode = 'on';"
psql_src -c "ALTER SYSTEM SET archive_command = 'test ! -f /wal-archive/%f && cp %p /wal-archive/%f';"
```

So the documented operator path (`docker compose -f docker-compose.yml -f
docker-compose.pitr.yml up -d`) is **never exercised by any test or drill**.
The closeout's §7 "5/5 drills PASS" claim is true but the drills prove a
different code path than the one the docs tell operators to use.

### 3.3 Impact (operator-visible)

1. Operator sets up a fresh PITR-enabled deployment per the docs.
2. `archive_mode` is silently `off`. `SHOW archive_mode` would reveal `off`,
   but nothing prompts the operator to check.
3. Operator takes a base backup via `pg-basebackup.sh`. `-X stream` makes the
   base backup internally consistent, so `pg_verifybackup` passes.
4. Some time later, operator needs PITR. They restore the base backup + point
   `restore_command` at the WAL archive. The archive is **empty** (archiving
   was never on). Recovery cannot replay forward and PITR fails — or, worse,
   recovers only to the base-backup checkpoint and the operator does not
   immediately notice the data loss.

### 3.4 Fix (smallest acceptable)

Rename the seed file so the extension is processed:

```bash
git mv docker/pitr/wal-archive.conf docker/pitr/wal-archive.sql
# update the mount in docker-compose.pitr.yml:
#   ./docker/pitr/wal-archive.sql:/docker-entrypoint-initdb.d/99-pitr-wal-archive.sql:ro
```

`ALTER SYSTEM ... ;` is valid SQL and runs fine through `docker_process_sql`.
Then add a **fresh-start drill** (or extend the existing one) that actually
boots `docker compose -f docker-compose.yml -f docker-compose.pitr.yml up -d`
on an empty data root and asserts `SHOW archive_mode` returns `on`. Until
that drill exists, the documented PITR init path is unverified.

---

## 4. Critical config-sync defect: Launchpad token never reaches the container

### 4.1 The defect (P2-1, carried over and still present)

`docker-compose.yml` `app` service `environment:` block (lines 41-64) has
**no** `LAUNCHPAD_SETUP_TOKEN` entry and the service has no `env_file:`. Yet:

- `README.md:215`: "set `LAUNCHPAD_SETUP_TOKEN=<openssl rand -hex 32>` in
  `.env` ... navigate to `/launchpad`".
- `docs/deployment/backup-and-recovery.md:524`: "Set `LAUNCHPAD_SETUP_TOKEN`
  in `.env` before the first `docker compose up`".
- `docs/deployment/mvp-deployment-runbook.md:180`: "LAUNCHPAD_SETUP_TOKEN=...
  in .env BEFORE step 4".
- `apps/api/src/config/runtimeConfig.ts:902`:
  `setupToken: (env.LAUNCHPAD_SETUP_TOKEN ?? "").trim()` — empty → disabled.

Compose reads `.env` for **variable substitution** only. A value in `.env`
is injected into a container **only** when an `environment:` entry references
it (e.g. `LAUNCHPAD_SETUP_TOKEN: ${LAUNCHPAD_SETUP_TOKEN:-}`). With no such
entry, the token stays on the host and the container sees nothing.

### 4.2 Runtime consequence

- `LAUNCHPAD_SETUP_TOKEN` set in `.env` → app container env unset →
  `runtimeConfig.launchpad.setupToken === ""` → launchpad disabled.
- `GET /api/launchpad/status` → `{ initialized: false }` (renders the form).
- `POST /api/launchpad/bootstrap` with the correct token →
  `!configuredToken` is true → **403 LAUNCHPAD_INVALID_SETUP_TOKEN**.

The documented first-install UX cannot succeed. The operator must either
hand-edit the compose (undocumented) or fall back to the `bootstrap-admin`
CLI. The C1.6 deliverable is inert in the bundled deployment.

### 4.3 Fix (one line + contract awareness)

In `docker-compose.yml` `app` service `environment:`:

```yaml
LAUNCHPAD_SETUP_TOKEN: ${LAUNCHPAD_SETUP_TOKEN:-}
```

The empty default keeps launchpad disabled for a bare `docker compose up`
(preserves the "not fail-fast at boot" contract in `runtimeConfig.ts`). Then
add a smoke assertion that a token-bearing `.env` yields a working
`/launchpad/bootstrap`. Also add `LAUNCHPAD_SETUP_TOKEN` (commented, with the
`openssl rand -hex 32` guidance) to `.env.example` so the single source of
configuration truth actually lists it — today `.env.example` does not mention
it at all, while the README/runbook/backup-guide do.

**Check the topology contract** (`scripts/repository-contract/...`) does not
reject new `environment:` keys before/after this change; if it does, extend
the allowlist rather than weakening the guard.

---

## 5. Other config-sync & doc-consistency findings

**(Required) — `.env.example` is missing `LAUNCHPAD_SETUP_TOKEN` while three
docs reference it.** `.env.example` is the documented single source of
runtime configuration (`AGENTS.md` local-DB-discipline: "copy from
`.env.example`"). Its absence there while the README, runbook, and
backup-guide all instruct setting it is a config-surface desynchronization.
Add it (commented, with entropy guidance), alongside the fix in §4.3.

**(Nit) — `pg_isready -U exam -d exam` is hardcoded in restore/backup scripts
while the real connection uses `$POSTGRES_USER`/`$POSTGRES_DB`.**
`postgres-logical-restore.sh:83`, `postgres-logical-backup.sh:89`,
`pg-basebackup.sh:85`, and the PITR drills. `pg_isready` does not actually
authenticate (it only checks the postmaster accepts connections), so this is
cosmetic, not functional — but it misleads readers about which user/db the
script targets. Either parameterize (`-U "${POSTGRES_USER:-exam}"`) or add a
comment that the ready-check user is arbitrary.

**(Nit) — PITR drills hardcode `-U exam -d exam` for source and recovery
probes.** `p7-c3-pitr-drill.sh:72,78,228,240-242` and the failure drill. The
drills set `POSTGRES_PASSWORD` but never `POSTGRES_USER`, so the default
`exam` is correct for the bundled path — but the recovery cluster's
`POSTGRES_USER` is inherited from the base compose (`${POSTGRES_USER:-exam}`)
and would diverge if an operator customized it. Low priority (drills are
throwaway), but worth a note.

**(Nit) — `archive_timeout` differs between the compose seed (60s), the docs
(§8.2: 60s), and the drills (30s).** Not a correctness issue (both satisfy
"bounded archive window for low-write clusters"), but the drills do not
exercise the documented value. Pick one and align, or document that the drill
uses an aggressive value for speed.

**(FYI) — `docker-compose.pitr.yml` mounts the postgres bind a second time
identically to the base.** Line 43 (`${EXAM_DATA_ROOT:-./data}/postgres:/var/lib/postgresql`)
duplicates the base `db` volume. Compose merges these (same target path), so
it is harmless, but it is noise. The only additions the override needs are
the WAL archive mount and the initdb seed. Consider dropping the duplicated
postgres line.

---

## 6. Drill-vs-documented-path gap (process finding)

The five drills are well-constructed and path-isolated, but **none of them
boots the documented operator compose invocation**. The drills:

- boot `docker compose -p <project> -f docker-compose.yml up -d` (base only);
- enable archiving via `ALTER SYSTEM` + a temp WAL-mount override;
- never apply `-f docker-compose.pitr.yml`.

This is why §3.1 went undetected. The closeout's "5/5 drills PASS" is
accurate for what the drills test, but the drills test a **different PITR
activation path** than the one operators are told to use. Recommendation:
add a sixth drill (or extend the happy-path drill) that boots the literal
`-f docker-compose.yml -f docker-compose.pitr.yml` on an empty data root and
asserts `archive_mode = on`. This is the single highest-leverage process fix.

---

## 7. Summary table

| Area | Verdict | Severity |
| --- | --- | --- |
| C1 cold backup/restore PG contract | Sound, simple | — |
| C2 `pg_dump`/`pg_restore` clean-target contract | Sound, well-reasoned | — |
| C3 `pg_basebackup` + `pg_verifybackup` PG contract | Sound | — |
| C3 WAL `archive_command` (non-overwrite idiom) | Correct | — |
| C3 PITR `recovery_target_lsn` + `recovery.signal` | Correct (PG18-verified) | — |
| `pg-basebackup.sh` "no password needed" claim vs TCP/scram | Misleading / will fail without host `PGPASSWORD` | **Required** |
| `wal-archive.conf` mounted into initdb.d is **ignored** (`.conf` extension) | Documented fresh-PITR path silently dead | **Critical** |
| `LAUNCHPAD_SETUP_TOKEN` not forwarded to app container | Documented first-install UX inert | **Critical** |
| `LAUNCHPAD_SETUP_TOKEN` absent from `.env.example` | Config-surface desync | **Required** |
| `PGUSER` default `exam` vs `POSTGRES_USER` | Diverges on customization | Nit |
| `POSTGRES_INITDB_ARGS: ""` dead config | Noise | Nit |
| `pg_isready -U exam -d exam` hardcoded | Cosmetic | Nit |
| `archive_timeout` 60s (docs/compose) vs 30s (drills) | Align or document | Nit |
| Duplicated postgres bind in PITR override | Noise | Nit |
| No drill exercises the documented PITR compose path | Process gap (masks the `.conf` bug) | **Required** |

---

## 8. Required corrective actions

1. **(Critical)** Rename `docker/pitr/wal-archive.conf` → `.sql` (or `.sh`)
   and update the mount in `docker-compose.pitr.yml`. Add a drill that boots
   `-f docker-compose.yml -f docker-compose.pitr.yml` on an empty root and
   asserts `SHOW archive_mode = on`. (§3)
2. **(Critical)** Add `LAUNCHPAD_SETUP_TOKEN: ${LAUNCHPAD_SETUP_TOKEN:-}` to
   the `app` service `environment:` in `docker-compose.yml`; verify the
   topology contract still passes. Add a smoke assertion that a token-bearing
   `.env` yields a working `/launchpad/bootstrap`. (§4)
3. **(Required)** Add `LAUNCHPAD_SETUP_TOKEN` (commented, entropy guidance) to
   `.env.example`. (§5)
4. **(Required)** Fix `pg-basebackup.sh`: either connect over the Unix socket
   (so the "trust/no password" claim becomes true) or correct the comment and
   require the operator to `export PGPASSWORD`. (§2.2)
5. **(Required)** Add a drill that exercises the documented PITR compose
   invocation (closes the drill-vs-doc gap that hid #1). (§6)

Nits (§5) are optional cleanup; address at author discretion.

---

## 9. Verification notes

- PostgreSQL behavior (`archive_command`, `restore_command`, `recovery_target_*`,
  `recovery.signal`, `pg_basebackup` replication authority, `template0`
  restore contract) verified against the PostgreSQL 18 documentation via
  Context7 (`/websites/postgresql_18`, `continuous-archiving.html`,
  `runtime-config-wal.html`, `app-pgbasebackup.html`, `warm-standby.html`).
- `docker-entrypoint.sh` extension handling verified against the official
  `docker-library/postgres` master `docker-entrypoint.sh` source — only
  `.sh/.sql/.sql.gz/.sql.xz/.sql.zst` are processed; `*)` logs `ignoring`.
- No runtime mutations were performed. All findings are from source/config
  inspection + official-doc cross-check. The two Critical findings are
  statically determinable and do not require a live cluster to confirm
  (though a live check of `SHOW archive_mode` after the documented compose up
  would refute or confirm §3.1 directly).
