# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
for repository releases from `v0.0.1` onward.

## [Unreleased]

### Added

- Added a reusable release-notes template and an ancestry-based issue/PR
  traceability contract so future maintainers or local AI agents can produce
  auditable releases without relying on memory or close dates.

### Changed

### Fixed

### Removed

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

[Unreleased]: https://github.com/jnhu76/exam/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/jnhu76/exam/releases/tag/v0.0.1
