# Container Runtime Baseline

Exam treats the Linux C runtime as part of the production platform contract, not
as an image-size implementation detail.

## Active baseline

| Surface | Image | Runtime family |
| --- | --- | --- |
| API build + runtime | `node:24.22.1-bookworm-slim` | Debian 12 / glibc |
| Web edge | `nginx:1.30.5-trixie` | Debian 13 / glibc |
| PostgreSQL | `postgres:18.4-bookworm` | Debian 12 / glibc |
| Redis | `redis:7.4.12-bookworm` | Debian 12 / glibc |
| Local E2E cleanup helper | `debian:bookworm-slim` | Debian 12 / glibc |

The production, development, and CI Redis services intentionally use the same
Debian/glibc image family. Active Docker/Compose/CI/E2E runtime configuration
must not introduce Alpine/musl images. `pnpm lint:container-runtime` enforces
that boundary.

Historical material under `docs/archive/**` and frozen research evidence under
`docs/research/**` may still name earlier Alpine baselines. Those records are
evidence and are not rewritten when the active runtime changes.

## Why the API runner is not distroless yet

The current production API entrypoint is an executable shell contract. Before
starting the server it:

1. rejects the removed `RUN_SEED` / `FORCE_APP_MODE` interface;
2. checks required startup configuration;
3. runs the canonical database migration; and
4. replaces itself with `node dist/server.js`.

A distroless Node image has no general-purpose shell, so changing the API runner
to distroless is not a base-image-only change. It requires a Node-native
launcher (or an application-owned startup sequence) that preserves those
behaviors, plus explicit verification of the native `argon2` load path,
signals/graceful shutdown, migration failure semantics, CA/timezone behavior,
and the production module-resolution oracle.

Until that migration is independently implemented and proven, the pinned
`node:24.22.1-bookworm-slim` runner is the production baseline.
