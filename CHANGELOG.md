# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
for repository releases from `v0.0.1` onward.

## [Unreleased]

## [0.0.4] - 2026-09-07

### Added

- A frozen user-facing message and error contract (#413): one documented
  authority (`docs/contracts/api-contract.md` D0.1–D0.13) backed by
  machine-readable error semantics across API routes and shared contracts,
  localized web rendering of known machine errors, semantic authority cleanup,
  tooling enforcement, and residual hygiene (C0–C6).
- Shared Admin UI spatial contracts backed by browser-level regression gates:
  unified overflow measurement, row action capacity, dialog and form spatial
  vocabularies, table role matrix with tier negotiation and the fit equation,
  semantic toolbar control sizing, page-role geometry vocabulary, and a mobile
  card representation for management lists (#452, #453, #454, #455, #457,
  #458, #459, #460).
- Structural route→page metadata coverage enforcement, so routed pages can no
  longer silently fall back to a generic title, plus navigation
  current-location and scroll-continuity contracts across route families
  (#490, #494).
- Candidate notification when a new exam is assigned (#299), with production
  email renderers converged onto one authority (#300).
- A multi-role visual patrol harness with contact-sheet artifact-integrity
  gates and a periodic Docker black-box discovery campaign (test/operations
  infrastructure) (#466, #476).

### Changed

- The timing-mode umbrella #291 is closed: `deadline` and `untimed` candidate
  runtime is covered by end-to-end tests; `timed_sync` remains a latent,
  non-authorable mode pending durable admission queue work.
- Enrollment bulk import classifies duplicate `candidateIds` within one
  payload as `DUPLICATE` skips instead of failing the request (#408).
- Documentation authority was consolidated: ADR authority precedence, an ADR
  architecture map with grouped convergence, snapshot-timing and RBAC/queue
  ADR alignment, Docker black-box campaign authority, and an agent-governance
  corrective (#414, #442, #469, #472, and related docs PRs).
- Admin pages now render coherently at a 390px baseline for both candidate and
  Admin surfaces, and primary buttons preserve the keyboard focus ring
  (#306, #412).
- Test infrastructure: `@exam/db` vitest workers are capped at the
  lifecycle-lane knee (#463), and the fresh-install gate uses a deterministic
  send-entered witness with the ADR-011 claim-vs-execution boundary (#482).

### Fixed

- Grading-queue and other routed pages no longer fall back to the generic
  "页面" title (#439 V5 and pageMeta coverage gaps).
- Admin navigation preserves a single discoverable current destination across
  list/detail/edit route families and stays coherent when the sidebar must
  scroll (#494).
- Duplicate candidates in one enrollment payload no longer produce a confusing
  failure (#408).

### Removed

- The unused `@fastify/jwt` dependency (#436).

## [0.0.3] - 2026-09-03

### Added

- Scoped Teacher@Course authority (#286): a persisted
  `teacher_course_assignments` carrier (migration 0036), an Admin
  assignment API (`GET/POST /admin/users/:userId/course-assignments`,
  revoke subpath), course/question scope resolvers with a
  `teacherAccess: "course_assignment_scoped"` enforcement stage, and
  SQL-side LIST scope filtering for courses, questions (and the tag
  vocabulary), exams, candidates, and score lists. Authority is
  `capability × assignment`: the scope row alone grants no capability,
  Admin keeps its org-wide short-circuit, out-of-scope probes fold into
  the canonical 404 (anti-enumeration), and revocation takes effect on
  the next request. Admin UI: per-Teacher course-assignment dialog in
  UsersPage (assign, list, revoke).
- Scoped Grader@Exam authority (#296): the same episode-semantics carrier
  model (`grader_exam_assignments`, migration 0037), an Admin assignment
  API (`GET/POST /admin/users/:userId/exam-assignments`, revoke subpath),
  a `graderAccess: "exam_assignment_scoped"` enforcement stage on grading
  detail/write, and grading-queue LIST scope filtering applied in SQL
  before pagination AND before the total count (list and count always
  agree). Teacher course assignments grant no grading scope and Grader
  exam assignments grant no course authority. Admin UI: per-Grader
  exam-assignment dialog in UsersPage.
- Staff invitation, email password reset, and account lifecycle (#297):
  invitation with role choice, a public forgot-password flow that sends
  an email reset link, and canonical credential lock ordering with
  audited actors.
- Permission registry and permission audit (#298): permission display
  metadata and audit action vocabulary, keyset audit search/export
  (actor/target filters), effective-authority projection, and an audit
  search/export UI.
- Plain/Rich content model and WYSIWYG authoring V1 (#301): a
  `ContentDocumentV1` kernel with limits/normalize/projection, rich
  question/option/answer slots with answer-shape validation, lazy
  Tiptap rich editor with a canonical Plain/Rich adapter, a static
  content renderer with a lazy KaTeX math seam, rich rendering in
  grading/result/attempt views, and rich content frozen into exam
  snapshots (migration 0039).
- `deadline` and `untimed` exam timing modes (#291 Phase A): nullable
  `duration_minutes`/`close_at` on exams and policy profiles, a per-profile
  `timing_mode` (migration 0040), author-and-take support in the web UI,
  and null-safe deadline authority in the engine (#387, #388, #390).
- Synchronized-timing kernel preparation (#291 Phase B1, #392):
  `exams.sync_started_at` persistence and an engine timer kernel
  (migration 0041). This is latent kernel work — the `timed_sync` product
  mode is not authorable or takable in this release.
- Public repository entry points: a code-first README, focused installation,
  deployment, operations, and development guides, a standard AGPL-3.0
  license and contribution guide, plus Simplified Chinese README,
  installation, and development entry guides (#398, #400).

### Changed

- Email delivery now runs in-process inside the API; the dedicated
  email-worker service is removed from the deployment topology (#320).
  The delivery loop has an explicit shutdown budget, timer ownership, and
  fail-closed backup evidence (#351).
- Email runtime/Compose env parity: the seven SMTP/TLS/timeout
  configuration variables now actually reach the app container, with
  fallback defaults equal to the runtime defaults (#368).
- Application settings unified behind a semantic settings model; profile
  env contracts replaced by a settings-driven gate (#372).
- Documentation authority and history are physically separated: current
  contracts/architecture/roadmap remain active, while superseded plans,
  audits, and closeouts live under `docs/archive/` without competing with
  current guidance (#399).
- E2E: `run-wsl` binds `PUBLIC_WEB_ORIGIN` per API shard so web-origin
  dependent flows work in WSL E2E runs (#364, #365).
- Governed business-UI scan roots centralized into a single authority
  (notifications/features no longer unscanned), and every verifier script
  is now gate-wired or explicitly declared manual (#379, #380, #383,
  #384, #385, #386).
- Docker E2E runner (`run.sh`) cleanup failures now fail loud instead of
  being swallowed (#375, #376).

### Fixed

- Attempt starts that cannot satisfy the minimum manual-submit duration
  are now rejected up front, instead of starting an attempt that can
  never reach a valid manual submit (#395).
- Admin exam detail page now fully supports nullable timing modes
  (bare unit rendering, no epoch close-at leak, mode-keyed projections)
  (#389, #390).
- Deadline authority is null-safe for no-deadline exams (#387).
- Concurrent duplicate staff invitations now accept both legal
  interleavings deterministically (one wins, the other fails cleanly)
  (#374, #381).
- Queue-participant DB test lifecycle hook budgets completed, closing
  indirect cleanup gaps (Guard 5) (#373).

### Removed

- Dedicated email-worker service (delivery is in-process) (#320).
- `rebuild-all.sh`, whose hand-mirrored build order duplicated the
  workspace topology authority (#378, #382).
- Unused attempt time-extend permission (#363) and the obsolete shadow
  permission mode (#366).
- Roughly 1,900 lines of duplicated, visual-only, or over-minimized
  recovery/incident and rich-content test evidence (anti-decay campaign,
  #357/#359/#361/#362).

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

[Unreleased]: https://github.com/jnhu76/exam/compare/v0.0.4...HEAD
[0.0.4]: https://github.com/jnhu76/exam/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/jnhu76/exam/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/jnhu76/exam/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/jnhu76/exam/releases/tag/v0.0.1
