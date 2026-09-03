# Post-MVP Repository Hygiene — Closeout (Phase B1/B2)

> Repository: `jnhu76/exam` · Audit basis: GitHub Issue #266 (Phase A audit)
> · Execution: bounded Phase B per the human-reviewed plan (post-MVP
> repository hygiene, 2026-08-09).
>
> **No product behavior changed. No verification layer was weakened. No
> historical archive was rewritten.**

## Baseline / head

| Item | Value |
| --- | --- |
| Baseline SHA | `e3f19d8b2774574b6969b5058ce4b0cb28599bbd` (master, merge PR #265) |
| Head SHA | Immutable final SHA to be recorded at commit time (branch `chore/post-mvp-repository-hygiene`, see PR #267). The mutable `HEAD` reference is intentionally not used: audit evidence must freeze the exact commit verified, not a moving pointer. |
| PR | PR #267 (links Issue #266) |

## Deleted fossils (4)

- `scripts/check-e2e-artifacts.mjs` — unwired AND failing on master (guarded
  a CI blob-merge contract that no longer exists); zero current consumers
  (archive mentions only).
- `scripts/check-docstring-coverage.mjs` — zero consumers
  (package.json / CI / hooks / current docs); archive mentions only.
- `tasks/plan.md` — fossilized J5 PR scaffolding (all checkboxes `[x]`);
  J5 closed with evidence in `docs/audits/J5-ADMIN-RECOVERY-CENTER-CLOSEOUT.md`.
- `tasks/todo.md` — same scaffolding family.

Each deletion was preceded by `git grep` for current consumers (none found);
archive-only references were intentionally not rewritten.

## Fixed dormant guard

`scripts/check-stale-ui-docs.mjs` was a **permanent no-op**: `readFile(path)`
without `utf8` returns a Buffer, `typeof s === "string"` is always false, so
every target was treated as a directory and never scanned.

Fix: read files explicitly as UTF-8 (`stat`-based file/directory dispatch),
extract the pure scanner (`findViolations`), keep the `docs/archive/**`
exclusion policy, and add a test-only `STALE_UI_DOCS_TARGETS_OVERRIDE` escape
hatch (same pattern as the migration-journal checker).

Regression coverage: new `scripts/check-stale-ui-docs.test.mjs` (wired as
`pnpm test:stale-ui-docs`, part of `verify:static`):

- golden — the real repository scans clean (proves the scanner is not a no-op);
- 4 mutation tests — one per forbidden pattern, injected into a temp fixture
  → guard exits 1 with path/line/reason;
- directory-target test — active file detected, `docs/archive/**` wording
  ignored per policy;
- missing-target test — skipped, not an error.

If the scan branch ever becomes unreachable again, the mutation tests fail
(the injected wording goes undetected and the checker exits 0).

## Docs updated (current truth → master)

- `README.md` — scope line (Teacher active MVP role since P4; Phase 3
  product work open), Redis claims (shared rate limiter is the adopted
  business path, ADR-001 P7 decision), `REDIS_URL`/tech-stack wording.
- `AGENTS.md` — Gate 0.5 PENDING → PASS (with pointer); Phase 3 wording
  restated (fill_blank runtime + text_response + self-service restore ARE
  implemented; remaining product work is precise).
- `docs/SPEC.md` — three stale "no self-service restore" claims → productized
  reality (REC-I3 / ADR-012 candidate restore, J5 Admin Recovery Center
  closed; J6 + system incidents remain open).
- `docs/README.md` — 15 ADRs (ADR-015 added to index), ADR-014 entry no
  longer "runtime NOT STARTED".
- `docs/roadmap/current.md` — P7 row 🟣 PLANNING → 🟡 IN PROGRESS (P7-D1
  accepted; shared rate limit shipped); J5 closure narrative compressed to a
  concise summary + pointer to `recovery-operations-jobs.md` (the closure
  tracker); J4/J5 open-work contradictions removed; "P7 has not started
  implementation" removed; P7 workstream 1 marked closed.
- `docs/roadmap/phase-roadmap.md` — P7 rows → PARTIALLY IMPLEMENTED with
  shipped-items note.
- `docs/archive/roadmap/P7-system-readiness-and-exam-modes.md` — status block
  NOT STARTED → PARTIALLY IMPLEMENTED (P7-D1 accepted; P7-D2/D3 shipped);
  §1.1 Redis line; §2.2 pointer-ized to implementation-status /
  phase3-open-items / recovery-operations-jobs; Workstream B P7-D1 gate
  records the accepted decision + shipped adoption sequence items.
- `docs/archive/roadmap/phase3-open-items.md` — P7 PLANNING → IN PROGRESS; M11
  Proctor→Exam slice CONTRACT ACCEPTED + J4-I1 NEXT → **CLOSED** (runtime
  implemented, `exam_proctor_assignments` exists); Teacher/Grader slices
  remain deferred.
- `docs/archive/roadmap/recovery-operations-jobs.md` — J5 index row + §6 "J5 is
  NEXT" → CLOSED (J6 next); Redis framing updated (P7-D1 accepted); J8
  section carries the decision record; dated snapshot clarified.
- `docs/adr/README.md` — ADR-001 row (baseline + shared-rate-limiting
  adoption amended 2026-08-08); ADR-011 PROPOSED → ACCEPTED (2026-07-25);
  ADR-014/015 runtime NOT STARTED → runtime implemented (J3 / J4-I1).
- `docs/adr/ADR-014-exam-incident-authority.md` — history preserved
  verbatim; explicit current implementation/status amendment added
  (J3 closed PR #242; J5 closed 2026-08-08).
- `docs/deployment/mvp-deployment-runbook.md` — §RATE_LIMIT_* row: shared
  Redis store when enabled, in-memory fallback otherwise.
- `docs/architecture/email-config.md` — three archive citations re-pointed to
  ADR-011 (normative) / API tests; archived doc explicitly framed as history.
- `docs/audits/P7-R0-REDIS-CAPABILITY-STUDY.md` — SUPERSEDED FOR CURRENT
  IMPLEMENTATION banner added (points to the accepted P7-D1 decision /
  shared-rate-limit closeout); historical content untouched below.
- `docs/status/implementation-status.md` — "only skipped E2E spec is
  fill-blank" → re-enabled; no E2E specs skipped.

Every replacement was verified against repository implementation (grading
engine, contracts, routes, UI, ADR-001, implementation-status, runbook §10),
not inferred from another stale document. `docs/archive/**` was not modified.

## Enum-test consolidation

`packages/domain/src/__tests__/questionType.spec.ts` +
`state-lifecycle.spec.ts` → **`enums.spec.ts`** (same domain enum family).

- Every assertion preserved (1 + 5 = 6 tests; 39 domain tests pass).
- Phase/milestone test descriptions renamed toward the invariants they
  protect (e.g. `"QuestionType — text_response 扩展 (P3-L0-1)"` →
  `"QuestionType contains the supported closed question-type set"`);
  historical codes retained in comments where useful.
- No other test files merged (per scope: auditLogRepo timeline/list,
  DataTable, PageContainer, rateLimit.abuse, errorResponse, recovery suites
  all deferred).

## fill_blank E2E — current truth

`apps/e2e/e2e/fill-blank-e2e.spec.ts` rewritten, `test.skip` removed:

- Inspected current contracts: `gradingEngine.gradeFillBlank` (exact |
  keyword, `|`-separated accepted answers, case-insensitive default),
  question contract (string standardAnswer required for fill_blank; `____`
  placeholder), attempt answer protocol (versioned save), result
  publication (`immediate`).
- Scenario: seeds a fill_blank with `standardAnswer: "红色|绿色"` +
  `fillBlankMatchMode: "exact"`, candidate answers "绿色" in the take UI,
  save protocol persists it, submit → auto-graded; asserts server truth
  (attempt `status=graded`, saved answer retained, `getCandidateResult`
  totalScore 100 / passed) AND browser truth (result page 已通过 + 100).
- No production behavior changed. `apps/e2e/lib/flow.ts` `answerFillBlank`
  doc comment updated (it described fill_blank as subjective-only).
- E2E result: **passed** via `bash scripts/e2e/run-wsl.sh fill-blank`
  (see verification).

## Explicit KEEP decisions (per human review)

- `scripts/check-high-font-weight.mjs` — KEPT unchanged (not semantically
  equivalent to the ESLint rule; guards raw font-weight in business UI where
  the ESLint rule permits `font-bold` with large metric sizes).
- `scripts/test-docker-config.mjs` — KEPT unchanged (unwired but contains
  unique Dockerfile/package-manager pinning checks; fate is a separate
  decision: wire / merge invariants / explicitly retire).
- `apps/api/src/routes/smoke-tests/api-smoke.test.ts` — KEPT separate from
  `smoke.test.ts` (isolated unknown-route/fallback oracle vs stateful
  critical product-path suite).
- No broad test-name cleanup (deferred; only tests touched by this job were
  renamed).

## Deferred decisions (recorded, not acted on)

- `scripts/check-frontend-primitives.mjs` — manual heuristic currently
  produces legitimate `aria-haspopup` false positives (AdminLayout
  `aria-haspopup="dialog"`, CourseSearchSelect `aria-haspopup="listbox"`).
  Future decision: fix the heuristic and wire it intentionally, or retire
  it. It is NOT a clean passing oracle today.
- `test-docker-config.mjs` long-term fate (see above).
- Audit's MEDIUM test-merge candidates (auditLogRepo timeline/list,
  DataTable Migration/Contract, PageContainer/shared, rateLimit.abuse,
  errorResponse) — deferred to a later cleanup if fixture duplication
  justifies it.
- Splitting the oversized recovery test suites (recoveryRepo.test.ts /
  recovery.admin.test.ts) — explicitly out of scope for this job.

## Verification

| Gate | Result |
| --- | --- |
| `pnpm format:check` | ✅ |
| `pnpm lint` (code-quality) | ✅ |
| `pnpm lint:copy` | ✅ |
| `pnpm lint:arch` | ✅ |
| `pnpm lint:env-contract` | ✅ |
| `pnpm lint:repo-contract` | ✅ |
| `pnpm lint:ui-gates` (incl. fixed stale-ui-docs guard) | ✅ |
| `pnpm lint:eslint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm lint:md` | ⚠️ pre-existing failures only — 87 errors at baseline (10 files) vs 42 on this branch (7 files; −44 from deleted fossils, −1 fixed in current.md). No regression. |
| `pnpm test:stale-ui-docs` (new) | ✅ 7/7 |
| domain enums (`enums.spec.ts`) | ✅ 6/6 |
| fill_blank E2E (`bash scripts/e2e/run-wsl.sh fill-blank`) | ✅ passed |
| `pnpm verify` | ✅ full run green (17/17 turbo tasks; coverage: db 559/559, domain 39/39, contracts 335/335, exam-engine 564/564, authz 70/70, auth 13/13, import-export 17/17, api, web; build) |

**Verification note (BUG-FLAKE-001, not a regression):** intermediate `pnpm
verify` runs failed on `packages/db/src/migrations/0027-convergence.test.ts`
("fails closed when a required column is missing") with the default 5 s
`testTimeout` under full parallel coverage. Evidence this is the documented
BUG-FLAKE-001 I/O-contention subclass (`docs/standards/test-flakes.md`),
host/DB-state bound and NOT a code regression:

- the same test passes standalone in both isolation modes (559/559) and
  passes inside the full `verify` coverage run once the database is clean;
- the same coverage run on baseline master (same host, same env) passes;
- root cause on this host: each timed-out worker leaves its `test_*` schemas
  behind; the debris accumulated to 66 leftover schemas in `exam_test`,
  degrading catalog performance until the migration test exceeded its 5 s
  budget — and every retry added more debris. Dropping the leftover schemas
  (`scripts/db/drop-test-schemas.sh` policy: `test_*` only, never
  public/drizzle) restored the full green run;
- this branch contains zero `packages/db` / migration changes.

## Git hygiene

- `git status` clean of generated artifacts (no logs, no mutation fixtures,
  no playwright outputs committed).
- `git diff --check` clean.
- `git grep` for deleted filenames: no current consumers.

## Final verdict

```text
POST-MVP REPOSITORY HYGIENE READY FOR HUMAN REVIEW
```
