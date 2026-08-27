# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
for repository releases from `v0.0.1` onward.

## [Unreleased]

### Added

### Changed

### Fixed

### Removed

## [0.0.2] - 2026-08-28

### Added

- Added a reusable release-notes template and an ancestry-based issue/PR
  traceability contract so future maintainers or local AI agents can produce
  auditable releases without relying on memory or close dates.
- Added prebuilt semantic-version Exam image distribution (#321): the release
  workflow publishes `ghcr.io/jnhu76/exam:vX.Y.Z` (plus a `sha-<commit>`
  alias tag, no `latest`) from the exact release commit, and
  `generate-env` derives the operator `EXAM_IMAGE` pin from
  `.release-version` (a canonical pin follows the release authority;
  an explicit mirror value wins, enabling offline
  `docker save`/`docker load` transfers).
- Added the operator upgrade & uninstall lifecycle guide
  (`docs/deployment/upgrade-and-uninstall.md`): supported upgrade path,
  entrypoint auto-migration expectations, version-skipping policy,
  forward-only rollback contract, uninstall preserve/full-removal modes,
  and an executable lifecycle suite (`pnpm test:deployment:upgrade`) that
  proves pin-flip upgrade, data/journal continuity, and clean reinstall
  (#329).
- Added the disposable fresh-install acceptance gate as a PR-blocking CI
  job: env-file generation authority, compose smoke, persistence across
  container recreation, and residue assertions (#327).
- Added real process-boundary restart and deadline evidence: the API is
  spawned as a real child process and SIGKILLed, proving deadline
  durability across restart, scanner convergence, and disruption recovery
  (#326).

### Changed

- Operator Compose defaults to the prebuilt pinned image
  (`image: ${EXAM_IMAGE:?...}` on app and email-worker, `up -d` with no
  local build); contributor/PR-acceptance source builds are the explicit
  `docker-compose.build.yml` override, which the deployment acceptance
  suites always merge (#321).
- Runbook shutdown section: `down -v` no longer claims to destroy data —
  with bind mounts there are no named volumes; deletion is the explicit
  `rm` in the lifecycle guide (pre-P7-C1 text corrected).

### Fixed

- Release image tag derivation traps: the metadata action would have
  published a `v`-less tag (semver `{{version}}` strips the prefix, never
  matching the operator pin) and a `latest` tag (default flavor for stable
  semver) — both are pinned with `type=raw` + explicit `latest=false`,
  verified against upstream source (#321).
- Lifecycle-suite credential probe: an old-credentials assertion could
  false-pass on a CSRF-403 origin rejection; it now sends the stack's
  allowed origin and asserts a genuine `401` (#329).
- A quoted stale `EXAM_IMAGE` value beside a blank key could survive as a
  duplicate (last-wins), silently keeping the stack on an old image after
  an upgrade — `generate-env` now classifies unquoted values, rewrites
  every `EXAM_IMAGE` line on re-pin, and stays byte-idempotent when the
  pin is current.

### Security

- Logout and password changes revoke previously issued authentication
  tokens through a durable per-user credential epoch (#325).

### Notes

- `v0.0.2` is a pre-1.0 development baseline. The prebuilt image and the
  S1 closeout issues (#326/#327/#321/#329) are captured in this release;
  roadmap work continues under Issue #333.
- The first GHCR package publish is PRIVATE by default even though the
  repository is public — the one-time Public flip and anonymous-pull
  verification are part of this release's publication closeout.

## [0.0.1] - 2026-08-27

### Added

- First formally versioned baseline of the generic Exam project.
- End-to-end exam workflows for administration, candidate participation,
  submission/recovery, grading, result publication, and supporting operational
  flows already present in the repository.
- LAN-first deployment and verification paths around PostgreSQL, Docker Compose,
  migrations, backup/restore, CI, coverage, and end-to-end acceptance.

### Changed

- Converged PostgreSQL test ownership and bootstrap semantics: explicit test
  databases are operator-owned, while the implicit local `exam_test` database
  is harness-owned and may self-provision.
- Rebound slot-scoped test resources to `VITEST_POOL_ID`, keeping physical
  worker-database cardinality bounded by `maxWorkers` instead of worker-instance
  count.
- Moved worker-database run ownership to a cluster-scoped Vitest `globalSetup`
  lease and kept one lifecycle advisory lock for heavy PostgreSQL test DDL.
- Made Turbo test routing and cache identity reflect the environment variables
  that actually change database/test topology.
- Removed obsolete worker-database sweeping and Docker initdb ownership that
  were compensating for older test-lifecycle assumptions.

### Fixed

- Closed candidate result-visibility leaks around manual result publication and
  unified the candidate-facing visibility contract across result projections.
- Fixed the file-schema P1-3 concurrency regression fixture: its lock-holder now
  uses a dedicated auxiliary PostgreSQL connection instead of starving the
  application's single-connection pool.
- Hardened test-infrastructure authority propagation, worker identity, run
  exclusion, slot reuse, and fixture-only child-run contracts with deterministic
  regressions and mutation proofs.

### Notes

- `v0.0.1` is a pre-1.0 development baseline, not a claim that the generic
  product roadmap is complete.
- S0 simplification/test-infrastructure convergence is complete at this baseline;
  roadmap work continues under Issue #333.

[Unreleased]: https://github.com/jnhu76/exam/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/jnhu76/exam/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/jnhu76/exam/releases/tag/v0.0.1
