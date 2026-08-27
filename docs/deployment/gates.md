# Deployment verification gates

Authority for which deployment suite runs where, why, and how it isolates
itself. Issue #327: deployment drift must not stay green solely because
unit/E2E tests bypass the production Compose topology — but not every
destructive/slow suite belongs in every PR.

## The one Compose entry point

Every gate runs against `docker-compose.yml` (sole operator entry point,
enforced by `scripts/repository-contract/deployment-topology-contract.mjs`).
Source-build acceptance merges `-f docker-compose.build.yml` / uses
`up --build`; a cached or registry image can never satisfy acceptance —
build cache is performance only. When `DEPLOY_ENV_FILE` is set,
`tests/deployment/lib.sh` passes Compose's explicit `--env-file` (the exact
runbook invocation), so the repo-root `.env` is never read for
interpolation.

## Gate inventory

| Gate | Script | Trigger | Runtime class (measured) | Isolation |
| --- | --- | --- | --- | --- |
| Fresh-install acceptance (PR-blocking) | `pnpm test:deployment:fresh` (`tests/deployment/fresh-install.sh`) | every PR (`deployment-fresh-install` CI job) | ~1:45 warm cache locally; CI pays a full cold image build on every run (no runner layer cache; p50 est. 12–20 min, bounded by the 30 min job timeout — re-baseline after the first CI runs) | mktemp env file (never repo-root `.env.deploy`; dev file proven untouched via checksum), mktemp `EXAM_DATA_ROOT`, unique Compose project + canary host port, `down` + guarded temp-root removal (removal is best-effort with a WARN; the compose-project residue assert is the hard gate), INT/TERM routed through the EXIT trap |
| Compose smoke | `pnpm test:deployment:compose` (`compose-smoke.sh`) | every PR, inside the fresh-install gate; also runnable standalone | ~2–3 min warm | same as above (its own temp root + project) |
| Launchpad bootstrap | `pnpm test:deployment:launchpad` | release / manual | not yet measured; bootstrap-only flow | isolated project + temp root (suite-owned) |
| Persistence & cold restore | `pnpm test:deployment:persistence` | release / manual | not yet measured; multi-recreation flow | isolated project + temp root |
| Logical backup & restore | `pnpm test:deployment:logical` | release / manual | destructive pg_restore inside its own stack | isolated project + temp root |
| PITR | `pnpm test:deployment:pitr` | nightly / manual (WAL archive + basebackup cycles) | slowest of the suite | isolated project + temp root + dedicated WAL archive path |

PR-blocking set = fresh-install gate only (it composes the compose smoke).
The launchpad/persistence/logical/PITR suites keep their destructive
multi-minute flows out of every PR; they are the release/manual evidence
layer. Promoting any of them to PR-blocking requires a measured runtime
under ~10 min CI and a review of its destructive surface.

## What the fresh-install gate proves (and how it fails)

Stages, each with a tagged failure (`[env]` `[smoke]` `[persist]` `[cleanup]`):

1. `[env]` — `node scripts/generate-env.mjs <mktemp>/.env.deploy <absent
   legacy file>`; asserts the file is created with non-empty
   `JWT_SECRET`/`POSTGRES_PASSWORD`, that the developer's repo-root
   `.env.deploy` (if any) is byte-identical before/after, and that
   `docker compose config` interpolates THE FILE. A canary `EXAM_PORT` is
   appended; any later stage that stops consuming the file fails the port
   assertion — the env-authority contract is executable, not prose.
2. `[smoke]` — the authoritative `compose-smoke.sh` runs under the
   generated file: required-secret expansion, default topology (app + db +
   email-worker), first migration applied exactly once, worker
   `bootstrap_pending → success` transition on the same container, first
   Admin bootstrap + second-Admin refusal, admin login, SPA served as
   `text/html`, baseline-seed production refusal, redis profile guards.
3. `[persist]` — second stack on a unique data root: `up --build`, first
   Admin bootstrap, login; `down` WITHOUT deleting data (bind-mounted
   `EXAM_DATA_ROOT` persists); `up --build` again with new container
   identities; asserts user state persists, the migration journal is
   unchanged by the rerun, login still works, and the published host port
   equals the env-file canary.
4. `[cleanup]` — teardown, then asserts the Compose project is no longer
   registered (`docker compose ls` scans all projects; names are
   timestamp-unique, so a match is unambiguous residue evidence). Temp-root
   removal is best-effort with a WARN — container-owned PGDATA files can
   survive a failed removal without turning the gate red.

## Failure semantics

- Any stage failure exits non-zero with the stage prefix as the first
  diagnostic; cleanup runs via `EXIT` trap regardless (residue can only
  warn, never mask a red gate).
- The gate never reads or writes the developer's `.env.deploy`, dev `.env`,
  or repo-root `./data`; the checksum + canary + unique-project mechanics
  make cross-contamination a hard failure instead of an assumption.
