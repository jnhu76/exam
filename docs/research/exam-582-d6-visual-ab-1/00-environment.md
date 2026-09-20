# 00 — Environment

EXAM-582-D6-VISUAL-AB-1 · blind A/B evidence generation for D6 (TagBadge font weight 400 vs 500), Stage B of the #582 campaign. Evidence only — no D6 value is chosen here, no production visual file changes, D2/D4/D5 are treated as frozen upstream authorities, D3/D7 not touched, #590 (dense-table cell fitting) not exercised.

## SHA authorities

| Field | Value |
| --- | --- |
| D6_BASE_SHA (product under test) | `09bf4c46562a26f92c1f0a5fc508558d4d70e913` — current master at task handoff (merge of PR #591); the branch carries this evidence pack plus the D6 harness only; every `apps/web`, `apps/api`, `packages/**` production file is byte-identical to master |
| UPSTREAM FREEZE AUTHORITY | D2 = 15px body/control (PR #589), D4 = 13px/20px/500 table header (PR #588/#589), D5 = 22px StatusBadge (PR #591) — all merged into the base SHA |
| D6_BRANCH | `research/582-d6-visual-ab-1` (temporary evidence branch; not a production authority) |
| D6_HEAD_SHA | recorded at commit time in the final handoff |

## Component / recipe authority (verified on the base SHA)

- Component: `apps/web/src/components/shared/TagBadge.tsx` — renders `data-slot="tag-badge"`, `data-tag-tone="neutral"`, `data-tag-geometry="compact"`, `data-tag-variant="default|compact-table"`.
- Recipe: `apps/web/src/badge/recipes.css` — base block: height 1.375rem (22px), padding-inline 0.375rem (6px), radius 0.25rem (4px), font-size 0.75rem (12px), **font-weight 400**, line-height 1rem (16px). compact-table block: radius 0.1875rem (3px), **font-weight 400**, line-height 1.125rem (18px), color text-muted. Weight ownership lives in BOTH blocks, so the experiment injects the candidate onto both (§7 of the task law).
- Production consumer inventory: exactly one — `apps/web/src/pages/admin/QuestionPage.tsx`, `/admin/questions` tags column, `variant="compact-table"`, `maxVisible=3` with the local `[data-slot="tag-overflow"]` `+N` chip. `DEFAULT_VARIANT_RUNTIME_COVERAGE = GAP` (no real default-variant instance); D6 is decided from the actual compact-table runtime. Full inventory: `validity/instance-inventory.json`.

## Lifecycle (repository-owned, canonical)

```text
DEV_API_PORT=3001 E2E_WORKERS=1 \
bash scripts/e2e/run-wsl.sh --keep-server -- \
  --config=playwright.patrol.config.ts patrol/ui-d6-visual-ab-582.spec.ts
```

- Canonical reseed (`exam_e2e`, APP_MODE=e2e) + spec-seeded fixtures through real product APIs: one course + 8 deterministic `true_false` questions tagged through the question API with the required vocabulary — short Chinese (安全, 设备, 电气, 应急, 基础), medium Chinese (消防安全, 设备维护, 安全培训, 应急处置), Latin (safety, equipment, PPE); rows carry 1/2/3/4/5/6 tags so the `+N` chip renders on the dense rows. No exams, no candidates, no attempts — the evidence surface is static between the back-to-back arm captures.
- The harness filters the workbench with the REAL server-side content search (`D6`, contained in every fixture stem) so the header band plus all 8 fixture rows fit one viewport; the identical filter runs in both arms and pairwise DOM identity is re-proved per capture (same questions, same tag arrays, same order, same `+1/+2/+3` chips; 18 rendered badges + 3 chips per arm — the product's `maxVisible=3` truncation, identical X/Y).
- Server kept after run: API dev server :3001 serving the built SPA.
- **Invalidated bring-up runs (never packaged)**:
  1. Run 1 (`d6-1789914778880`, outputs kept in `.tmp/`) captured the full dense-table set with every gate green, then hard-failed at the 1023 card context: the harness treated "no TagBadge in the card representation" as an invalid condition. Root cause (as-built, not a defect): the MobileRecordList card mapping omits the tags column — role `tag-list` resolves to priority `low` (`DataTableContract.ROLE_PRIORITY`), and low-priority columns are dropped from cards. Per §14 this is a classification, not an invalidation trigger: the harness now records `RESPONSIVE_REPRESENTATION_CHANGE / TAGBADGE_CONTINUES = NO` and excludes 1023 from D6. The run was discarded per §31 so the packaged evidence comes from the committed harness.

## Runtime capture conditions

| Field | Value |
| --- | --- |
| Browser | Chromium, Playwright 1.61.0 |
| Viewports | 1440×900 (primary), 1100×800 (density repeat); 1023×800 classified out of D6 (see above) |
| DPR | 1 (`deviceScaleFactor: 1` explicitly per context) |
| Zoom | 100% (default) |
| Theme | Light (supported default) |
| Motion | `reducedMotion: reduce` |
| Font | Production HarmonyOS Sans SC self-hosted path (cn-font-split subsets, 246 subset faces registered, weights 400/500/700); per-capture font gate: `document.fonts.ready` + force-load of the subsets covering the actual CJK tag vocabulary at both weights + `fonts.check` 400/500 + computed stack contains `HarmonyOS Sans SC` — 8/8 captures PASS (see `validity/font-gate.json`) |
| User | Same admin account for all surfaces |
| Capture scale | 4 judged captures (questions × 2 arms × 2 viewports) + 2 validity-only probe records (exam-list StatusBadge, 1023 card classification; no screenshots); 20 native-pixel band crops + 8 tight badge-context crops |

## Variant assignment (sealed)

- Two arms: TagBadge `font-weight` 400 and 500 (D6 authority, issue #582), judged against the frozen 15px body/control baseline (upstream D2, injected identically in both arms), the as-built 13px/20px/500 table header (upstream D4) and the 22px StatusBadge (upstream D5), all re-verified per capture.
- Which letter (X/Y) carries which weight is persisted ONLY in `validity/variant-map.json` (independent crypto coin flip at pack creation; no forward assumption from the D2/D4/D5 assignments).
- Capture order interleaves per viewport (X then Y back-to-back in fresh contexts) so temporal drift inside a pair is seconds; both variants see the same build, seed, routes, filtered row set, DOM state, user, browser, viewport, DPR, zoom and font path.
- **Blinding discipline**: judge-facing files live under `judge/` and carry letters only — no candidate values, no "current/candidate" language, no weight-direction hints (permanent rule after the D4 interpretation-direction incident). Mapping-revealing artifacts live under `validity/` and open with an explicit do-not-provide warning.
