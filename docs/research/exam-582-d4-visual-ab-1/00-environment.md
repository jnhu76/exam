# 00 — Environment

EXAM-582-D4-VISUAL-AB-1 · blind A/B evidence generation for D4 (table-header typography), Stage B of the #582 campaign. Evidence only — no D4 value is chosen here, no production visual file changes, D2 is treated as frozen upstream authority, D5–D7 not touched.

## SHA authorities

| Field | Value |
| --- | --- |
| PRODUCT_UNDER_TEST_SHA | `3f5bd9c4c757daec2554de98ed06e4d4e2784c8b` — the product tree actually rendered by the server (`git diff` against it is empty for every `apps/web`, `apps/api`, `packages/**` production file on this branch; the branch adds audit/evidence files only). Byte-identical product to the D2 evidence pack. |
| UPSTREAM_D2_FREEZE_SHA | `42ef848fb3feb78a7fdfc60bec01a0f7932c5afc` — tip of `research/582-d2-visual-ab-1`, sealing **D2 FINAL = 15px**; this branch's parent and the experiment's frozen baseline authority |
| D4_BRANCH | `research/582-d4-visual-ab-1` (temporary evidence branch; not a production authority) |
| D4_CAPTURE_SHA | `beb347062385d105f0980311dcbd02d324559b2c` — the commit holding the A/B harness; the branch tip additionally carries this evidence pack (tip SHA published in the handoff message, as in D2/Phase-1) |

## Lifecycle (repository-owned, canonical)

```text
DEV_API_PORT=3001 E2E_WORKERS=1 \
bash scripts/e2e/run-wsl.sh --keep-server -- \
  --config=playwright.patrol.config.ts patrol/ui-d4-visual-ab-582.spec.ts
```

- Canonical reseed (`exam_e2e`, APP_MODE=e2e) + spec-seeded fixtures through real Admin product APIs: 1 exam (timed_window, 60min), 12 questions (5 true_false / 2 single_choice / 1 multiple_choice / 2 fill_blank / 2 text_response, tagged `D4-<stamp>`), 4 Teachers (`对照教师` course-assigned + `监考教师1–3`) so the users table carries real role-badge and row-actions content.
- Server kept after run: API dev server :3001 serving the built SPA (`pnpm --filter @exam/web build` → `apps/api/public`).
- Three earlier runs of this harness were invalidated during bring-up and never packaged: run 1 hard-failed the 1023 boundary (the representation change surfaced as an error instead of a record, exposing the hidden-table state), run 2 used a wrap detector whose +2px cell-height slack false-flagged the product's fixed-height headers, run 3 fixed the detector (Range line boxes) but exposed the users table with only 2 body rows — below the 3-row micro-evidence minimum — so the fixture was enriched. The packaged run carries the corrected representation gate, line-box detector and fixture set; invalidated run outputs stayed in `.tmp/`.

## Runtime capture conditions

| Field | Value |
| --- | --- |
| Browser | Chromium, Playwright 1.61.0 (chromium revision 1228) |
| Viewports | 1440×900 (primary), 1100×800 (density repeat), 1023×800 (boundary probe — valid for audit-logs only, see 01-protocol.md) |
| DPR | 1 (`deviceScaleFactor: 1` explicitly per context) |
| Zoom | 100% (default) |
| Theme | Light (supported default) |
| Motion | `reducedMotion: reduce` |
| Font | Production HarmonyOS Sans SC self-hosted path (cn-font-split subsets); per-capture font gate: `document.fonts.ready` + `fonts.check` 400/500 + computed stack contains `HarmonyOS Sans SC` — 24/24 captures PASS (see `validity/font-gate.json`) |
| User | Same admin account for all four admin surfaces |

## Variant assignment (sealed)

- Two arms: table-header `font-size` 13px and 14px (D4 authority, issue #582), judged against the frozen 15px body/control baseline established in BOTH arms.
- Which letter (X/Y) carries which px value is persisted ONLY in `validity/variant-map.json` (independent crypto coin flip at pack creation; no forward assumption from the D2 assignment).
- Capture order interleaves per surface (X then Y back-to-back in fresh contexts) so temporal drift inside a pair is seconds; both variants see the same build, seed, routes, DOM state, user, browser, viewport, DPR, zoom and font path.
- **Blinding discipline (hardened)**: judge-facing files live under `judge/` and carry letters only; mapping-revealing artifacts live under `validity/` and open with an explicit do-not-provide warning. This closes the D2 defect where the adjudicator environment could receive `style-proof.json`.
