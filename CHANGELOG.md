# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
for repository releases from `v0.0.1` onward.

## [Unreleased]

## [0.0.14] - 2026-11-13

### Changed

- Temporal timestamp semantics (#961 H-04/R-04, PR #966): scanner
  terminalization now records `submittedAt` at the canonical effective
  deadline — the same semantics as lazy on-read reconciliation — instead of
  the scan tick, separates the submission effective time from the
  terminalization observation, and samples terminalization processing time
  per candidate instead of once per scan round; heartbeat
  `lastActivityAt` writes are monotonic so a late-arriving older heartbeat
  can no longer rewind a candidate's activity.
- ADR-006, `exam-runtime` and `state-and-authority` documentation aligned
  with the as-built temporal semantics (#961 H-05 partial, PRs #966/#968).

### Fixed

- Attempt start is serialized against exam close/cancel (#961 H-08, PR
  #963): the start path takes the Exam row write lock and re-checks the
  OPEN gates on the locked authoritative snapshot before creating the
  attempt, and the admin transition executor runs READ COMMITTED so the
  unresolved-attempt guard observes attempts committed while it waited —
  the two non-serializable schedules (attempt created on a closed exam,
  close misreading the unresolved count) are closed by deterministic
  real-PostgreSQL concurrency tests.
- Front-end stale-response and stale-commit family (PRs #955/#957/#959/
  #965): superseded responses and stale debounced commits can no longer
  overwrite the current view or rewrite the history entry the user
  navigated to — QuestionPage search (#953), RecoveryQueuePage filters
  (#956), ScoreListPage (#958), ExamMonitoringPage timeline and attempt
  polling (#961 H-02), PermissionRegistryPage authority (#961 H-03), and
  StartExamPage single-flight entry ownership with route-identity guards
  (#961 H-07).
- Deadline auto-submit no longer trusts client display rounding (#961
  R-02, PR #967): expiry is judged on the un-rounded server-adjusted time,
  and the deadline episode submits only after a server-side frozen-snapshot
  verification, deferring with telemetry when the server deadline has not
  been reached — a client clock forward-jump can no longer freeze a
  candidate's remaining time as a manual submit.
- The real-PostgreSQL 40P01 deadlock coverage fixture is victim-agnostic —
  it no longer assumes the first-queued waiter always gets blame, which
  PostgreSQL does not guarantee (#960, PR #962).
- The A12(c) Back-debounce and hook external-reset tests are deterministic
  under CI load and fail when the rule they pin is removed (#953 test
  defects, PR #954).

## [0.0.13] - 2026-11-11

### Added

- Server-owned `x-request-id` response header on every Fastify-managed
  response (ADR-025 fourth correlation carrier, scope 865-C): one root-scope
  hook reusing the existing request id — no second id is minted — with CORS
  exposing it only to the configured web origin; opt-in
  `api.getWithMeta`/`api.postWithMeta` client reads, and the TakeExamPage
  save path surfaces the rejection correlation id in candidate alerts and
  client telemetry (#865, PR #924). A save-failure investigation worked
  example (200 `accepted:false` → X-Request-Id → pino WARN → receipt/domain
  verification) ships in `docs/operations/save-failure-evidence.md`.
- Security-audit evidence archive for the secure-observability remediation
  (SHA256-pinned, sanitized copies; `docs/research/…-remediation/`)
  (#800 evidence basis, PR #922).
- Build-graph drift guards wired into `pnpm lint:arch` via the single policy
  module `config/build-graph-policy.mjs`: the production Dockerfile build
  manifest must equal the workspace buildable-package set, workspace build
  helpers must be registered in turbo `globalDependencies`, and unsupported
  Dockerfile `RUN` forms fail closed as named violations instead of being
  silently skipped (#938, PR #939).
- Additive machine error code `UNRESOLVED_ATTEMPTS_EXIST` on the results
  access path, alongside the shared `resolveAdminResultsAccess` verdict
  (#927, PR #929).
- Minute-precision `formatDateTimeMinute` in the product date/time
  authority — seconds dropped, not rounded; second precision remains the
  default for ordering-documenting surfaces (#932, PR #943).

### Changed

- Client-event `route` is projected onto a closed vocabulary of 49 SPA route
  templates at BOTH the ingest boundary and the proctor-timeline read
  (legacy rows re-projected on read; no data migration; unknown routes and
  malformed/non-http(s) URLs fail closed to `null`) (#864, PR #923).
- Log privacy: pino request lines and the 19 authz/error log sites no longer
  persist raw client URLs — matched route templates or a fixed
  `(unrouted)` placeholder everywhere; the nginx access log uses an explicit
  privacy format (no `$request`/`$request_uri`/raw `$uri`/referer) recording
  the upstream `x-request-id`; the root 404 boundary replaces Fastify's
  URL-logging default (#925, PR #926). The nginx `error_log` keeps the
  Owner-decided `error` level (native upstream diagnostics; the bounded
  raw-request-line risk is accepted and documented).
- Dev rail: `pnpm dev` is now the canonical managed entry (`turbo watch
  dev`) — the first run builds the full workspace dependency closure before
  the API/web dev tasks start, and source changes rebuild only the affected
  closure before managed tasks restart; new explicit `dev:once` (one-shot
  full build) and `watch:dist` (unmanaged build watch with a documented
  same-worktree concurrency boundary) entries. On the build rail
  `noEmitOnError` now holds: a failed build emits no new artifacts, surfaces
  loudly in the watch output, and the managed tasks stay down until the
  failing source is fixed and a rebuild succeeds — a failed build is never
  a silent partial release. Contract, failure semantics and execution
  evidence are recorded in ADR-027 (ACCEPTED, with errata E1–E3) (#938,
  PR #940).
- Admin dashboard order is todo → 资产概览 KPI → 近期考试 with quick actions
  in the page header; section order pinned by document-position tests
  (#932, PR #945).
- Candidate exam list: visible page h1 我的考试, historical-best badge whose
  trophy renders only at `bestScore >= passingScore` (server-projected,
  below-passing demotes to secondary), mobile-only badge wrap keeping titles
  full-width at 320px, minute-precision exam windows, and an empty state
  naming cause and next step; server projections untouched (#932,
  PRs #943/#944).
- CI runs the API/Web PR checks in plain test mode (`web-tests`/`api-tests`
  instead of coverage lanes); redundant test suites pruned via a
  detection-owner audit (PR #931).

### Fixed

- The #927 implicit state-machine audit's five state-authority findings:
  exam-list scores affordance shares the canonical results-access verdict
  with the scores API and CSV export; deadline auto-submit is one
  attempt-scoped episode that stale outcomes cannot misuse; disrupt/restore
  use a canonical transition table; force-submit parity pinned
  biconditionally; repository update inputs narrowed with a guarded PATCH
  cast (PR #929).
- `rich-content-overflow` E2E geometry flake under 2-shard CI load (#878):
  root cause causally proven (Chromium's internal key-scroll animation can
  commit its first frame 59ms–1078ms after the press under contention, and
  the lazy KaTeX fallback swap transiently flips the derived tab-stop
  state). All five fixed 150ms waits were replaced by an explicit
  trigger → state-change → settle oracle; registration in
  `docs/standards/test-flakes.md` (CASE-2026-11-09-878-KEYSCROLL-ORACLE)
  (PR #923).
- Silent stale-dist E2E boots: the E2E entry (`scripts/e2e/run.sh`
  `build_assets()`) now rebuilds the complete workspace dependency closure
  (`pnpm build`) instead of only the `web`/`api` package builds, so servers
  can no longer start against stale internal-package `dist` — the
  build-side face of the stale-dist mixed-runtime class reported in #920
  (that issue's HTTP 500 causality remains under its own RESEARCH_FIRST
  gate) (#938, PR #941).

### Security

- Raw client URLs no longer reach disk in pino request lines, authz/error
  log sites or the nginx access log (#925, PR #926).
- Local agent state/config directories and common credential file patterns
  are ignored by Git (PR #936).

### Deployment / operations

- No database migration; no environment-variable or Compose topology
  change. The nginx privacy access-log format and the `/healthz` loopback
  healthcheck are baked into the published `exam-web` image; log consumers
  should expect route templates or `(unrouted)` in pino request lines and
  the new access-log format carrying `x-request-id` (PR #926).

### Internal / infrastructure

- ADR-027 (build-first development execution) accepted with errata E1–E3
  (PR #940); E2E runner build closure guarded in `lint:arch` by call-order
  proof and `@exam/db#build` narrowed to its product dependency edge
  (#947, PRs #950/#951); script surface converged to single semantic
  entries for E2E, integration and lint (#948, PR #949).
- Test-evidence consolidation: Recovery detail collapsed to the
  error/loading two-way split (#933), TakeExamPage test harness
  consolidated (#934), recovery i18n vocabulary and error-key catalog
  resolution pinned (#935), obsolete phase/milestone labels removed from
  test titles (#917).

## [0.0.12] - 2026-11-07

### Added

- Investigation surfaces for the observability campaign (#800 first merged
  wave): frontend capture of render crashes, unhandled errors and transport
  failures into the client-event pipeline with category identifiers and
  stable error codes only (#854, PR #853); exam-save fault correlation
  across client telemetry, proctor timeline and server logs (#855, PR #850);
  a read-only telemetry investigation UI with paging, server receive time,
  precise filters and deep links (#856, PRs #851, #880); and failure
  counters plus scanner/dead-letter diagnostics on the diagnostics surface
  (#857, PR #852).
- Client-event upload idempotency: a client-generated event key with a
  unique `(organization, user, event_id)` index — migration `0046` — so
  ACK-loss batch resends no longer duplicate low-trust telemetry
  (#863, PR #889).
- Persistent background-loop failures now escalate: `operability.business_failure`
  for consecutive business-failure ticks (#862, PR #884) and
  `operability.tick_failure` for persistent tick-level throws (#885, PR #896,
  ADR-024), with run-length counters projected in diagnostics
  (#886, PR #893) and client-event retention loop liveness/stall
  observability (#871, PR #890).
- A read-only answer-save receipt summary projection (count, max clientSeq,
  last savedAt) for admin investigation (#866, PR #891).

### Changed

- HTTP request correlation identity is a server-generated UUIDv4 per
  request (ADR-025): production ignores client request-id headers, and the
  same id flows through error envelopes and structured logs, making
  cross-process/restart correlation unambiguous (#860, PR #912).
- The client-events at-rest surface is minimized: credential-shaped values
  are rejected under any key name, the top-level route string is
  structured, and query strings no longer persist into the proctor
  timeline (#875, PR #888).
- Client-event temporal integrity: the proctor timeline projects client
  `occurredAt` as exact UTC text so extreme client dates cannot make an
  attempt timeline unusable (#874, PR #904); unrepresentable client dates
  are rejected at the schema boundary with per-event client isolation
  instead of failing the whole batch (#903, PR #911, ADR-026); and
  client-claimed metadata is labeled as unverified next to server facts
  (#901, PR #902).
- System audit identity: background operations persist their operation id
  under `metadata.operationId`, separated from HTTP `metadata.requestId`
  (#905, PR #906), and the candidate-import audit target names a real
  entity even when the import log write fails (#908, PR #910).
- Refused answer saves emit exactly one structured WARN line keyed by the
  request id, and save-failure evidence reading is codified with an
  explicit UNKNOWN boundary (#861, #867, PR #892).
- CI builds are job-local (zero-artifact), pinned-docs fetches are
  authenticated, and README release badges must match `.release-version`
  by release-workflow enforcement (PRs #894, #881, #899).

### Fixed

- Audit keyset pagination carries the cursor at epoch-µs precision
  (cursor v3), ending silent row loss on µs-truncated timestamps; the
  client resets the cursor path on error retry (#877, PR #887).
- Role-assignment not-found responses satisfy the declared 404 error
  envelope instead of failing serialization into a 500 (#907, PR #909).
- The MathLive virtual keyboard no longer buries the formula dialog
  (#882, PR #883), and the coverage-lane timing races behind repeated CI
  flakes were fixed at their proven layers (#858, PR #859).

### Security

- client_events persistence denies credential-shaped values regardless of
  key name and stops persisting raw query strings (#875, PR #888); the
  production request-id header is untrusted by construction (guarded at
  boot) (#901, PR #902).

### Deployment / operations

- Migration `0046` is the only schema change (additive column + unique
  index; NULL event ids stay outside the constraint, preserving legacy
  append-only senders). No environment or configuration change is
  required; log consumers should expect UUIDv4 request ids instead of
  `req-<base36>`.

### Internal / infrastructure

- Naming cleanup retired stale phase-era and RBAC-migration-era vocabulary
  across production code, tests and tools (PRs #915, #916); ADR-024,
  ADR-025 and ADR-026 were adopted and their provenance recorded (PRs
  #896, #913, #914).

## [0.0.11] - 2026-11-02

### Added

- Candidate exam list and detail responses project the authored
  `retakePolicy` (`max_attempts` | `unlimited` | `pass_then_stop`), and
  attempts copy keys on the real policy — unlimited exams render as
  不限次数 instead of a sentinel count (#834, PR #839).
- Grading details resolve the grader's display name (`gradedByName`) and
  the grading session gains a continue-with-next-pending action (PR #842).
- Operator tooling for the ADR-023 evidence-preservation gate:
  `scripts/verify-evidence-preservation.sh` manifest capture/compare with
  a fail-closed contract and self-test (PR #816).
- Bounded repo-only VitePress documentation pilot with a CI build check,
  plus truthful Standard product documentation (PRs #829, #830, #832).

### Changed

- Retake is reachable from the exam list once a final score exists when the
  retake policy still admits it (failed with attempts remaining, unlimited,
  or pass-then-stop not yet passed), matching the start command's authority;
  the published result stays viewable on the card (#834, PR #839).
- The save indicator's idle chip now means actually-synced, skipped saves
  surface an error, offline banners separate connection loss from save
  state, and the submit dialog weights facts by risk (PR #841).
- Formula rendering emits MathML alongside the visual HTML; the MathML tree
  is the accessible representation of every formula (PR #848).
- The dashboard "today" stat is labeled as an attempt count with
  test-pinned counting semantics (PR #844).

### Fixed

- Fill-blank questions with JSON-like scalar standard answers (`"42"`,
  `"true"`, `"1e3"`, …) are graded against the authored string instead of a
  double-parsed value (#845, PR #846).
- The Admin dashboard reports real enrollment counts in recent exams
  instead of a hardcoded 0 (#833, PR #835).
- Missing health telemetry renders an explicit no-data state instead of
  0%/0ms (#836), and unresolvable user references fail closed instead of
  rendering empty identities (#837) (PR #838).
- Candidate result page: shared question-type dictionary, contentless
  correct-answer column removed, long answers behind a keyboard-operable
  disclosure, and a mobile per-question view (PR #840).
- Candidate exam card touch targets reach 44px on mobile and
  passing-requirement copy is unified across pages (PR #843).
- Rich content no longer clips at the document level: overflow is local to
  the content viewport, un-clamped answers stay wrapped, and re-measure is
  reliable after resize (#847, PR #848).
- Governance drift repaired: false gate claims and dependency facts
  corrected (#821, PRs #822, #823).

### Removed

- **Breaking (ADR-023, #739):** the backup-evidence subsystem — API
  endpoints `GET /system/backups`, `GET /system/restore-readiness`,
  `GET /system/retention-readiness`, `GET+PUT /system/ops-policy`;
  permission keys `system.backup.view`, `system.restore_readiness.view`,
  `system.ops.policy.view`, `system.ops.policy.manage`; the evidence CLI,
  repositories, contracts, and OperationsPage sections; and the five
  database tables via forward-only migration `0045` with a pre-drop
  evidence-preservation gate (PRs #815, #816). The Maintainer preset is
  re-baselined to exactly `system.health.view` +
  `system.diagnostics.view`. Backup/DR evidence is a host-operator
  obligation; health/diagnostics are unchanged.

### Deployment / operations

- Migration `0045` is the only schema change; applied migrations 0031–0034
  are untouched. Deployments with non-empty backup-evidence tables will
  intentionally fail to start until the §2.7 preservation workflow
  (upgrade-and-uninstall.md) is completed; empty-table deployments migrate
  silently. Pre-upgrade backup remains mandatory.
- No environment-variable, Docker Compose, or configuration changes.

### Internal / infrastructure

- Forbidden workspace runtime dependencies are machine-enforced from
  `config/architecture-policy.mjs` (#824, PR #825); agent authority and
  execution contract consolidated (PR #826).
- E2E: admin Back oracle made behavior-authoritative (PR #811); four
  rich-content overflow journeys and ~50 component tests (PR #848); JSONB
  grading regression through the real repository (PR #846).
- Flake-evidence records OBS-2026-10-23-001/-002 (PR #809, direct
  `c5814def`); README badge refresh (PR #810).

## [0.0.10] - 2026-10-23

### Added

- Admin exam/candidate/course/results lists gain real server-side
  pagination with server-side search and status filters; candidates accept
  an optional `search` query parameter and exams an optional validated
  `statuses` filter, both applied before pagination so list and count
  agree (#785, PR #786).
- The question and exam lists keep their submitted query (page + filters)
  in the URL, restore it on refresh/direct link, and detail/import/create
  pages return to the exact originating list view through validated
  same-origin history state (#784 A3, PR #787).
- The Admin dashboard shows capability-gated todo queues for grading and
  unresolved recovery incidents, loaded once with manual refresh and
  bounded-count labeling (#784 B3, PR #788).
- `GET /api/system/public-config` projects the deployment's resolved
  product capability set (`product`: closed Standard catalog, revision 1)
  from a fail-closed Standard preset resolver (#678 Phase 1, PR #802).

### Changed

- Candidate deadline reconciliation and answer saves read the exam
  authority under `FOR SHARE` instead of `FOR UPDATE`, so same-exam
  readers coexist while writer exclusion, linearization and 40001 retry
  semantics are unchanged (#668, PR #804).
- Workspace `@exam/*` packages declare unified exports: tests resolve
  workspace source directly, production resolves `dist`, with permanent
  source-freshness oracles (#794, PR #797).
- Runtime base image and `.nvmrc` move to Node.js 24.22.1 (PR #803).

### Fixed

- Admin list records beyond the default first page are reachable again;
  totals and page counts reflect the filtered server result set (#785,
  PR #786).
- Extending an already-closed exam explains the conflict, refreshes the
  exam view and closes the dialog instead of leaving a raw 409 (#792,
  PR #796).

### Security

- Node.js runtime updated 24.15.0 → 24.22.1 (October 2026 security
  release, PR #803).
- `/.env.deploy` (local deployment credentials) is ignored by Git (PR
  #793).

### Deployment / operations

- The API production image payload is restricted to a declared allowlist
  (application `dist` plus PostgreSQL migrations) with a fail-closed CI
  oracle over the real image tree and a no-network production-resolution
  verification (#798, PR #799).
- Both E2E shards and the production transport regression run in one
  pinned Playwright browser image from a single version authority, with
  fail-closed identity-drift checks replacing duplicated browser installs
  (PRs #805, #806).

### Internal / infrastructure

- Permanent oracles for exam transitions (#784 C2), grader assignment
  revocation/regrant and closed-exam projection (#791), and the
  isolated-schema test lifecycle (BUG-FLAKE-005, #771).
- Documentation and research: Atlas R0 semantic IR (#763), #719
  test-evidence-adequacy closeout, flake register epistemic v2, R0.5
  doc/code reconciliation, #668 serialization evidence.
- No database migration in this release.

## [0.0.9] - 2026-10-09

### Fixed

- Rich answer drafts no longer register false edits or autosave new answer
  versions merely because Tiptap editability is synchronized on mount,
  restore, or disabled-state changes (#697, PR #755). Real user document
  edits still flow through the canonical save path.
- Candidate result-page copy reflects the attempt's actual lifecycle after
  deadline-driven submission or disruption, instead of telling an already
  submitted candidate the exam has not started. Existing result-visibility
  and hidden-score contracts remain unchanged (#698, PR #753).
- Candidate Rich answer UI fits narrow viewports without page-level
  horizontal overflow or hiding commands in an inaccessible toolbar scroller;
  command overflow follows measured container width, and long Rich prompt/
  option tokens wrap (#699, PR #752).

### Changed

- Repository-level configuration helpers moved from the repository root into
  `config/`, preserving their admission, parsing, and test-environment
  authorities. Vitest environment guidance was reconciled with actual
  consumers without changing runtime configuration semantics (PR #750).
- Current documentation no longer presents the closed #584/#587 program as
  the active universal execution authority; future work is selected through
  specifically authorized open Issues. High-assurance profiles remain future
  gated capabilities (PR #754).

## [0.0.8] - 2026-10-08

### Added

- Candidate rich-text answer editor UX (#669 Phase U, #700): a governed
  toolbar (canonical command registry, roving tabindex keyboard traversal,
  narrow-viewport overflow menu), a MathLive formula surface with expert
  LaTeX source and live KaTeX preview, explicit keyboard contracts, and
  write-side list/table clamps. Absorbs the take-page lock-presentation
  fix (#674): disrupted connectivity is no longer mislabeled as deadline
  auto-submit, and failed answer saves retry.
- `exam_answer_save_receipts` — an append-only answer replay-receipt table
  (migration `0044_answer_save_receipts.sql`) with a full in-transaction
  legacy backfill and sha256 answer-identity digests, replacing the O(N)
  full-answers-JSONB rewrite per accepted save (#691).
- Root-only env-file policy, enforced by a new `lint:env-surface` gate in
  `pnpm verify:static`: exactly one admitted application source (the
  repository-root `.env`); package-local `.env` files are no longer
  configuration sources (#741, #743).
- Direct cross-package Vitest/typecheck domain-source resolution
  (`vitest.sourceAliases.ts`, `tsconfig.typecheck.json`): editing
  `packages/domain/src` no longer requires a domain rebuild before direct
  runs measure the change (#689, #746), with the workflow documented in
  CONTRIBUTING.md.

### Changed

- Configuration guards converge on single authorities (#733): unified
  `TEST_DB_ISOLATION` authority (#735), no implicit JWT configuration
  authority (#736), runtime-mode guards routed through `parseAppMode`
  (#738), the seed dotenv admission fork removed (#740), and shell
  test-schema tooling resolved through the canonical test target (#742).
  The configuration authority DAG, precedence, and consumers are
  documented (#745).
- The test suite is materially smaller while owning more: repository-wide
  owner-layer reduction of semantically dominated tests (#706–#717),
  deterministic real-PostgreSQL concurrency proofs with discriminating
  oracles (#718, #721, #722, #727), E2E slimmed to material browser
  boundaries with semantic names (#705), CI E2E shards 4 → 2.
- Process tests run explicit hermetic profiles in the worker-database
  isolation lane; readiness is bound to the spawned child identity
  (#723, #725, #734).

### Fixed

- Production image build: the Docker builder now copies the root
  `envFilePolicy.ts` required by the web vite config (#747, via #746 and
  the content-identical re-landing #748).
- Block math silently lost on save (#676); remaining math selection and
  table fidelity gaps (#673); first keystroke after caret relocation into
  a trailing-table region silently lost (#701).
- Rich content trust chain (#669): canonical closure at the durable
  acceptance boundary (#687), fail-closed persisted-read adoption (#690),
  take-snapshot `clientSeq` restored from replay receipts (#691),
  export trust boundaries (#692), fail-closed render trust for untrusted
  static prompts with KaTeX safety evidence (#693), publish-boundary
  validation (#694), durable Rich string closure (#696), and consolidated
  permanent regression ownership (#703).
- Take-page navigator current-question ring clipped on narrow viewports
  (#683); topbar controls aligned on shared h-9 geometry (#675).

### Removed

- Package-local implicit env-file families (12 vite/vitest configs set
  `envDir: false`; `apps/api/.env` leaves the application source set) —
  superseded by the root-only policy (#743).
- Semantically dominated/duplicate test suites, proven-dead internal web
  surface, and the dev seed dotenv admission fork (#708–#717, #705, #722,
  #740).

## [0.0.7] - 2026-09-30

### Added

- `EXAM_DOCKER_SUBNET` (default `172.28.0.0/24`) as the single bundled
  topology override: `docker-compose.yml` derives both the `exam-net` IPAM
  subnet and the bundled `TRUSTED_PROXY_CIDRS` default from the same value,
  so LAN/VPN/Docker-subnet collisions are fixed in one place (#665).
- A production LAN HTTP browser regression
  (`apps/e2e/e2e/production-lan-http.spec.ts`) with a dedicated CI job: it
  drives launchpad bootstrap, real UI login, and cookie assertions against a
  real production Compose stack through a non-localhost HTTP origin (#665).
- Deployment documentation for the one-release/two-image model
  (`ghcr.io/jnhu76/exam:vX.Y.Z` + `ghcr.io/jnhu76/exam-web:vX.Y.Z`) and the
  bind-mounted PostgreSQL data root (#659).

### Changed

- Production edge topology (#662, #661): the standalone edge nginx is merged
  into the web runtime. `exam-web` serves the static SPA **and** is the sole
  public production edge; the default stack is `web + app + db` (redis
  optional via `--profile redis`). The `nginx` service, the `web:4173` hop,
  and `deploy/nginx/edge.conf` are deleted — no parallel nginx authority
  remains. Release artifacts are unchanged (same `exam` + `exam-web` image
  pair), and the #585 edge security semantics (single public ingress,
  `X-Forwarded-For` replace, request-time upstream DNS, one published host
  port) are preserved, now baked into the image.
- Transport policy derives from the canonical public origin (#665):
  auth-cookie `Secure`, HSTS, and CSP `upgrade-insecure-requests` follow the
  `PUBLIC_WEB_ORIGIN` scheme instead of `APP_MODE`. Plain-HTTP LAN
  deployments (isolated or appropriately trusted LAN) work again; TLS
  remains an ingress property and `APP_MODE` stays `production` for both
  transports.
- The bundled `TRUSTED_PROXY_CIDRS` default is deployment-derived from
  `EXAM_DOCKER_SUBNET` (#665); an explicit operator value still wins, and
  the empty default no longer collapses every client onto the edge bridge
  IP under the bundled topology.
- Deployment documentation converged to the shipped topology (#659):
  zh-CN README/INSTALL synced to the nginx public-entrypoint shape,
  image-pair and persistence wording corrected, external-PostgreSQL wording
  removed, ADR-011's stale topology sentence corrected. zh-CN semantic
  parity repaired across README/INSTALL/development guide (#664).
- Development Compose boundaries tightened (#663): PostgreSQL/Redis host
  publication is loopback-only, the silent `repeatable read` server
  override is removed, and `pnpm db:down` tears down the disposable stack
  with `down -v`.

### Fixed

- Plain-HTTP LAN production login: browsers discarded the forced-`Secure`
  auth cookie, so login returned 200 but the session never persisted (#665).
- Rate-limit identity and audit IP collapsed onto the edge bridge IP under
  the bundled topology with an empty `TRUSTED_PROXY_CIDRS` (#665).
- HSTS and CSP `upgrade-insecure-requests` followed production mode instead
  of the actual browser-visible transport (#665).

### Removed

- The standalone production `nginx` service, the `web:4173` hop, and
  `deploy/nginx/edge.conf` (#662).
- `COOKIE_SECURE` (#665); a stale value in the environment is inert and
  pinned by test.
- The dev `postgres -c default_transaction_isolation='repeatable read'`
  server override (#663).

## [0.0.6] - 2026-09-29

### Added

- Frozen Exam semantic authority (EXSEM-001..020) with ADR-021 as the
  adoption/supersession record, plus the production conformance repair that
  enforces it (#642, #643).
- Production nginx reverse-proxy edge with an operator-declared trusted
  client-IP profile (`TRUSTED_PROXY_CIDRS`) and a dedicated static-Web image
  and service (`EXAM_WEB_IMAGE`) (#585, PR #628).
- `.env.production.example` replaces `.env.deploy.example` as the production
  deployment env template.
- Worker-scoped migrated-database reuse for ordinary `@exam/db` tests (#648).

### Changed

- Compose project identities are pinned (#631): the dev stack
  (`docker-compose.dev.yml`) runs as project `exam-dev` and production
  (`docker-compose.yml`) as `exam-prod`, so a production rehearsal from a
  developer checkout can no longer recreate dev containers under the
  directory-derived `exam` project. Existing deployments remove the old
  `exam` containers once before `up -d` (upgrade guide §2.2 step 0c);
  contributor source-build rehearsals set `EXAM_DATA_ROOT` outside the
  checkout.
- The deployment env file is renamed to `.env.production`; an existing
  `.env.deploy` must be renamed before `init-production-env` runs, and that
  script only fills blank values — it never re-secrets an existing file
  (upgrade guide §2.2 step 0b).
- Configuration authority is consolidated to one owner per runtime concern;
  invalid explicit values fail fast instead of silently defaulting (#632).
- Candidate-facing result and export contracts use the submitted-answer and
  secret-safe authority (EXSEM-007/008/009/017); missing draft-question
  references are distinguished from absent ones (EXSEM-004); demo seed
  grading facts align with the durable workset (EXSEM-020).
- Production ingress is a single edge: `/` proxies to the static Web runtime
  and only `/api/` reaches Fastify, with request-time upstream resolution so
  an upgrade cannot leave a stale upstream address.
- AttemptDetail capability composition reflects the actor's effective
  capability set for Proctor-reachable flows (#612).
- The recovery TLA+ model treats an applied `CandidateTakeSnapshot` as the
  page business authority and models canonical deadline crossing without
  materializing durable state (#656).

### Fixed

- Recovery scope discoverability mismatch between the admin and candidate
  projections (#606).
- Worker-DB bootstrap lifetime for the API-coverage hook-timeout family
  (#604).
- The `testDbWorkerScoped.failurePath` beforeAll `pg_stat_activity` race
  (#650).
- Test evidence and authority/comment drift across the #609–#625 wave
  (#613/#614/#615/#620/#621/#624).
- Formal-model drift against the frozen semantic authority, including an
  over-constrained recovery invariant that had erased a legitimate
  asynchronous deadline window (#656).

### Removed

- Image automatic-seed interface (#636): `docker-entrypoint.sh` no longer
  runs a seed or derives `APP_MODE` from `RUN_SEED` / `FORCE_APP_MODE`; any
  non-empty value now fails the container before migration. E2E/test data:
  run `pnpm --filter @exam/api db:seed:e2e` against the e2e/test database
  (the host runner and CI already do). Production first admin:
  `bootstrap-admin` (deployment runbook §5).
- Residual deployment/backup/contract infrastructure beyond the minimal
  operator surface, including the PITR enablement helper and two superseded
  `docs/deployment/` documents.
- `docker-compose.build.yml`, `docker-compose.test.yml`, and
  `.env.test.example`; the dev-test topology is host-native (#626).
- Stale `timeGrant` / `GrantExtension` / `TimeGrantNeverDecreases` formal
  scaffold and the dead recovery actions `MarkDisrupted`, `NetworkDown`, and
  `NetworkUp`.

## [0.0.5] - 2026-09-22

### Added

- Durable PostgreSQL-backed exam admission state (#292, PR #521): restart-safe
  queue membership, deterministic ordering, write-once admission, atomic
  consumption at attempt start, and a fail-closed start gate. The old
  process-local queue authority is gone.
- Persisted-state value-set backstops (#542, PR #555): migration `0043` adds
  fail-closed CHECK constraints for exam, enrollment, attempt, and grading
  status vocabularies while keeping engine commands as the transition
  authority. Historical `status='grading'` residue is never silently rewritten
  and has an explicit operator recovery runbook.
- Semantic table value ownership for audit actions (#598, PR #599): a dedicated
  `action-label` role with vocabulary/copy completeness, accessible raw-key
  fallback, machine-token ownership for `targetType`, and product date/time
  formatting for invitation expiry.

### Changed

- HTTP API/docs/static/SPA routing now has one Fastify routing authority
  (#429/#500, PR #499). API rate limiting is scope-owned, the API-reference
  namespace never escapes into SPA fallback, and raw-URL policy classifiers
  were removed (ADR-020).
- Managed test/e2e profiles no longer inherit developer `.env` state, and the
  WSL runner explicitly owns its API shard port/origin projection (PR #565).
- Configuration semantics were tightened across #566–#570 (PRs #573–#578):
  invalid explicit port/rate-limit values fail fast, production/no-op settings
  were narrowed, and dead feature-flag plumbing was removed with bidirectional
  contract gates.
- Assignment and export affordances now reflect target active roles and actor
  capabilities rather than cache/role surrogates; large catalogs use real
  reachability via pagination/search (#548, PR #581).
- Admin visual baseline converged through #582/#590/#598: governed body/table
  text is 15px, primary controls use 6px radius, tags use 500 weight,
  modal/panel backgrounds use the surface token, and dense-table allocation /
  value-grammar ownership has dedicated regression coverage (PRs #594–#599).

### Fixed

- Restart and multi-process admission divergence from the legacy in-memory
  queue, including ordering reset and over-admission across processes (#292).
- API-reference requests falling through to the SPA shell when docs are
  disabled (#499).
- WSL E2E port collisions / mismatched health probes caused by developer `.env`
  contamination (#565).
- Silent fallback from invalid explicit numeric configuration (#566).
- Staff assignment, proctor assignment, and score-export UI affordances that
  could be shown when the canonical server capability would reject them (#548).
- Dense-table role-pill, date-range, audit-action, audit-target, and invitation
  expiry cells that could crowd or cross neighboring column boundaries
  (#590/#598).

### Removed

- Process-local exam queue authority (`examQueues` and related in-memory queue
  semantics) in favor of durable PostgreSQL admission state (#292).
- Dead `FEATURE_*` configuration surface with no product consumer (#570).
- Raw-URL policy classification that duplicated router identity (#499).

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

[Unreleased]: https://github.com/jnhu76/exam/compare/v0.0.14...HEAD
[0.0.14]: https://github.com/jnhu76/exam/compare/v0.0.13...v0.0.14
[0.0.13]: https://github.com/jnhu76/exam/compare/v0.0.12...v0.0.13
[0.0.12]: https://github.com/jnhu76/exam/compare/v0.0.11...v0.0.12
[0.0.11]: https://github.com/jnhu76/exam/compare/v0.0.10...v0.0.11
[0.0.10]: https://github.com/jnhu76/exam/compare/v0.0.9...v0.0.10
[0.0.9]: https://github.com/jnhu76/exam/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/jnhu76/exam/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/jnhu76/exam/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/jnhu76/exam/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/jnhu76/exam/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/jnhu76/exam/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/jnhu76/exam/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/jnhu76/exam/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/jnhu76/exam/releases/tag/v0.0.1
