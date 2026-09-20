# 00 — Environment

EXAM-582-VISUAL-CORRECTNESS-FONT-1 · prerequisite audit for issue #582 (D2–D7 A/B adjudication).

## Baseline

| Field | Value |
| --- | --- |
| Repository | jnhu76/exam |
| PRODUCT_UNDER_TEST_SHA | `3f5bd9c4c757daec2554de98ed06e4d4e2784c8b` — the origin/master commit whose rendered UI was actually audited (audit spec + probe are additive; no production file changed) |
| EVIDENCE_HEAD_SHA | `PENDING_SEAL_STAMP` — the `research/582-visual-correctness-font-1` commit holding the audit harness + retained evidence + reports |
| Branch | `research/582-visual-correctness-font-1` |
| Issue authority | #582 (created against `fbf5bd41`; reality-audited against current master per AGENTS.md §4) |

The branch tip is the Phase-1 seal commit carrying this stamp; a commit cannot contain its own SHA, so the exact tip SHA is published as `PHASE1_EVIDENCE_SHA` in the PR #588 seal comment and recorded in `docs/research/exam-582-d2-visual-ab-1/00-environment.md` (whose parent commit is this tip).

Note: `#582` says "refresh current master before branching"; current master `3f5bd9c4` additionally contains PR #583 (capacity reproof). No #579 authority repair was reverted; `apps/web/src/index.css` still declares HarmonyOS Sans SC as primary UI family truth.

## Lifecycle (repository-owned, canonical)

```text
DEV_API_PORT=3001 E2E_BASE_URL=http://localhost:3001 E2E_WORKERS=1 \
bash scripts/e2e/run-wsl.sh --keep-server -- \
  --config=playwright.patrol.config.ts patrol/ui-visual-correctness-582.spec.ts
```

- DB: dev compose PostgreSQL (`exam_e2e` database, APP_MODE=e2e), migrate + canonical e2e seed before run.
- Redis: dev compose.
- Server: API dev server on :3001 serving the built SPA (`pnpm --filter @exam/web build` → `apps/api/public`).
- Auth: real `/login` UI flow (`loginAsAdmin` / `loginViaUi`), plus real API start of one attempt for the candidate-runtime surface.
- Reused harness: `apps/e2e/patrol/` (patrol-fixtures `collectShellFacts`, seed helpers, `playwright.patrol.config.ts`). New file: `apps/e2e/patrol/ui-visual-correctness-582.spec.ts` (evidence collector only — changes no production visual value). Confirmatory DOM probe: `apps/e2e/scripts/probe-badge-overflow-582.mjs`.

## Runtime capture conditions

| Field | Value |
| --- | --- |
| Browser | Chromium, Playwright 1.61.0 (chromium revision 1228) |
| Viewports | 1440×900 (desktop wide), 1100×800 (desktop narrow), 1023×800 (critical below-lg boundary), 700×800 (below-lg overflow probe) |
| DPR | 1 (`devicePixelRatio` recorded per capture = 1) |
| Zoom | 100% (default) |
| OS | Linux 6.18.33.2-microsoft-standard-WSL2 x64 |
| Theme | Light (supported default) |
| Motion | `reducedMotion: reduce` (patrol config context option) |

## Seed state under audit

Canonical e2e seed + audit-seeded entities (created through real Admin product APIs, unique stamps per run):

- 1 exam `E2E-vis-audit-take-*` (timed_window) + course + candidate; attempt started via real API for the take surface.
- 12 questions on that course: 5 true_false, 2 single_choice, 1 multiple_choice, 2 fill_blank, 2 text_response — tagged `审计-<stamp>` so the QuestionsPage table renders type badges + tags.
- 1 Teacher user assigned to the course (assignment-dialog target on UsersPage).

Question table density at capture time: 20 body rows (canonical-seed questions accumulated over runs + audit seed).

## Tooling notes

- Browser Use (`agent.browsers`) was requested for interactive inspection but the environment advertises **no browser backend** (`agent.browsers.list()` → `[]`). Recorded as **SKIPPED**; interactive verification was covered by the Playwright run (real login, real clicks for the assignment dialog, programmatic scroll) + visual-judge review of real screenshots. Wheel-ergonomics was therefore not proven by real wheel input — see 06-adversarial-review.md.
- Data growth: the audit spec re-seeds 12 questions per invocation (idempotent via unique stamps); density grows slightly per rerun. The final run's numbers are what the reports cite.
