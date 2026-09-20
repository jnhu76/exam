# 00 — Environment

EXAM-582-D5-VISUAL-AB-1 · blind A/B evidence generation for D5 (StatusBadge physical height), Stage B of the #582 campaign. Evidence only — no D5 value is chosen here, no production visual file changes, D2/D4 are treated as frozen upstream authorities, D3/D6/D7 not touched.

## SHA authorities

| Field | Value |
| --- | --- |
| D5_BASE_SHA (product under test) | `9b08f9561856e021ad2ee92629e38c00f80dea60` — current master at task handoff (merge of PR #589); the branch carries this evidence pack plus the D5 harness only; every `apps/web`, `apps/api`, `packages/**` production file is byte-identical to master |
| UPSTREAM FREEZE AUTHORITY | PR #588 (Phase-1 visual correctness/font truth) + PR #589 (D2 = 15px freeze, D4 = 13px/20px/500 freeze) — merged into the base SHA |
| D5_BRANCH | `research/582-d5-visual-ab-1` (temporary evidence branch; not a production authority) |

## Component / recipe authority (verified on the base SHA)

- Component: `apps/web/src/components/shared/StatusBadge.tsx` — renders `data-slot="status-badge"`, `data-status-tone`, `data-status-geometry="compact"`; `text-xs font-medium` typography, `px-2`, `gap-1.5`, `border`, `rounded-md`; icon by default only when `statusMeta.iconPolicy === "show"`.
- Recipe: `apps/web/src/badge/recipes.css` — `[data-slot="status-badge"] { height: 1.375rem; border-radius: 0.375rem; }` (22px / 6px). 22px is therefore the CURRENT value; 24px is the candidate.
- Icon vocabulary: `apps/web/src/lib/statusMeta.ts` (iconPolicy "show" = urgency/destructive/live statuses render `AppIcon` by default).

## Lifecycle (repository-owned, canonical)

```text
DEV_API_PORT=3001 E2E_WORKERS=1 \
bash scripts/e2e/run-wsl.sh --keep-server -- \
  --config=playwright.patrol.config.ts patrol/ui-d5-visual-ab-582.spec.ts
```

- Canonical reseed (`exam_e2e`, APP_MODE=e2e) + spec-seeded fixtures through real product APIs: 4 exams (`d5-man` text_response, 3 candidates each submitting one attempt — as-built, the grading queue lists only pending-manual attempts · `d5-live` carrying 3 unlinked incidents (no live attempt — see invalidated runs 4/5) · `d5-closed` (close API) · `d5-draft` (created, never published)), a second objective exam `d5-score` submitted by 3 candidates and then closed (scores API rejects an open exam: `EXAM_NOT_FINISHED`), 4 teachers for the users rows, and 2 tagged questions for the TagBadge probe.
- Server kept after run: API dev server :3001 serving the built SPA.
- **Invalidated bring-up runs (never packaged)**:
  1. Run 1 captured round 1 and the recovery-queue/users captures successfully but hard-failed at `scores/X@1440x900` with `EXPERIMENT_INVALID: governed table not rendered` — root cause: the scores API returns `RESOURCE_CONFLICT / EXAM_NOT_FINISHED` for an open exam, so the score-list page rendered its error state and no governed table. Fix: a dedicated `d5-score` exam is closed after its submissions (hypothesis verified directly against the kept server before re-run).
  2. Run 2 captured all 22 judged captures + probe with every D5/D2/D4/contamination gate green, but the §18 TagBadge guard recorded 2 violations — root cause: the harness's own absolute constant was wrong (the questions workbench tag column uses the `compact-table` TagBadge variant, whose recipe radius is `0.1875rem` = 3px, not the default variant's 4px). The recorded TagBadge values themselves were identical across arms (22px / 400 / 3px, zero cross-arm diffs); the guard expectation, not the product, was defective. The constant was corrected and the run discarded per §27 so the packaged evidence comes from the committed harness.
  3. Run 3 captured every gate green, but the grading queue rendered only ONE body row — root cause (as-built fixture yield): the grading queue lists only attempts awaiting manual grading; auto-graded attempts never appear, so the objective-exam submissions were invisible there. The fixture was enriched (3 candidates each submitting a text_response attempt → 3 pending_manual rows, satisfying the §20 three-body-row micro context) and the run discarded per §27.
  4. Runs 4–6 all hit the same environmental churn with escalating clarity: the recovery-queue pairs captured different row sets in the two arms (4/5 rows). Root cause (definitively established in run 6 by correlating incident timestamps with capture log timestamps): the churn source is NOT the spec's fixtures — it is the **canonical E2E demo seed's own live candidate attempts** (安全培训考核 A, 考生甲/丙), which the environment's fast heartbeat disruption scanner re-alerts on an escalating cadence (15s → 60s → …), APPENDING new system incidents to the recovery queue for as long as a heartbeat-less attempt stays on the books. The queue in this environment is inherently time-varying until every live attempt is terminated. An interim wait-and-poll "settle barrier" (runs 5) was also defective in its own right — it read a pagination field the endpoint does not return, so it settled immediately. Structural fix (run 7): before any capture, the harness walks the recovery queue and terminates every exposed live attempt through the REAL recovery force-submit command (idempotent, operationId-keyed, canonical reason), then requires two consecutive scanner periods (16s) with zero live attempts. The incidents already raised remain in the queue as static rows; nothing can append during captures. Runs 4–6 were discarded per §27.
  - All earlier runs' outputs stayed in `.tmp/`.

## Runtime capture conditions

| Field | Value |
| --- | --- |
| Browser | Chromium, Playwright 1.61.0 |
| Viewports | 1440×900 (primary), 1100×800 (density repeat), 1023×800 (boundary probe — valid for recovery-queue only, see 01-protocol.md) |
| DPR | 1 (`deviceScaleFactor: 1` explicitly per context) |
| Zoom | 100% (default) |
| Theme | Light (supported default) |
| Motion | `reducedMotion: reduce` |
| Font | Production HarmonyOS Sans SC self-hosted path (cn-font-split subsets); per-capture font gate: `document.fonts.ready` + `fonts.check` 400/500 + computed stack contains `HarmonyOS Sans SC` — 22/22 captures PASS (see `validity/font-gate.json`) |
| User | Same admin account for all surfaces |
| Capture scale | 22 judged captures (5 surfaces × 2 arms: exam-list/grading-queue/users/scores ×2 viewports + recovery-queue ×3 viewports) + 4 probe records (TagBadge, no screenshots); 44 native-pixel micro crops (22 table-context + 22 tight badge-context) |

## Variant assignment (sealed)

- Two arms: StatusBadge `height` 22px and 24px (D5 authority, issue #582), judged against the frozen 15px body/control baseline (upstream D2) and the as-built 13px/20px/500 table header (upstream D4), both established/verified per capture in BOTH arms.
- Which letter (X/Y) carries which px value is persisted ONLY in `validity/variant-map.json` (independent crypto coin flip at pack creation; no forward assumption from the D2/D4 assignments).
- Capture order interleaves per surface (X then Y back-to-back in fresh contexts) so temporal drift inside a pair is seconds; both variants see the same build, seed, routes, DOM state, user, browser, viewport, DPR, zoom and font path.
- **Blinding discipline**: judge-facing files live under `judge/` and carry letters only — no candidate values, no "current/candidate" language, no size-direction hints (permanent rule after the D4 interpretation-direction incident). Mapping-revealing artifacts live under `validity/` and open with an explicit do-not-provide warning.
