# 00 — Environment

EXAM-582-D2-VISUAL-AB-1 · blind A/B evidence generation for D2 (body / control text size), Stage B of the #582 campaign. Evidence only — no D2 value is chosen here, no production visual file changes, D4–D7 not touched.

## SHA authorities

| Field | Value |
| --- | --- |
| PRODUCT_UNDER_TEST_SHA | `3f5bd9c4c757daec2554de98ed06e4d4e2784c8b` — the product tree actually rendered by the server (this branch adds audit/evidence files only; every `apps/web`, `apps/api`, `packages/**` production file is byte-identical to this commit) |
| PHASE1_EVIDENCE_SHA | `fe7662acda60a51c4ab0467ce10217dc0b3cc924` — head of sealed Phase-1 (`research/582-visual-correctness-font-1`, PR #588); this branch's parent |
| D2_BRANCH | `research/582-d2-visual-ab-1` (temporary evidence branch; not a production authority) |
| D2_HEAD_SHA | `788349f3260998df5bbc8e8e8d6ad1a7300f2260` — the commit holding the A/B harness + captured evidence; the tip additionally carries this report (tip SHA published in the handoff message, as in Phase-1) |

## Lifecycle (repository-owned, canonical)

```text
DEV_API_PORT=3001 E2E_WORKERS=1 \
bash scripts/e2e/run-wsl.sh --keep-server -- \
  --config=playwright.patrol.config.ts patrol/ui-d2-visual-ab-582.spec.ts
```

- Canonical reseed (`exam_e2e`, APP_MODE=e2e) + spec-seeded fixtures through real Admin product APIs: 1 exam (timed_window, 60min), 12 questions (5 true_false / 2 single_choice / 1 multiple_choice / 2 fill_blank / 2 text_response, tagged `D2-<stamp>`), 1 Teacher (`对照教师`) assigned to the course (assignment-dialog target), 1 candidate attempt started via real API for the runtime surface.
- Server kept after run: API dev server :3001 serving the built SPA (`pnpm --filter @exam/web build` → `apps/api/public`).

## Runtime capture conditions

| Field | Value |
| --- | --- |
| Browser | Chromium, Playwright 1.61.0 (chromium revision 1228) |
| Viewports | 1440×900 (primary adjudication), 1100×800 (density-sensitive repeat) |
| DPR | 1 (`deviceScaleFactor: 1` explicitly per context) |
| Zoom | 100% (default) |
| Theme | Light (supported default) |
| Motion | `reducedMotion: reduce` (patrol config context option) |
| Font | Production HarmonyOS Sans SC self-hosted path (cn-font-split subsets); per-capture font gate: `document.fonts.ready` + `fonts.check` 400/500 + computed stack contains `HarmonyOS Sans SC` — 24/24 captures PASS (see `artifacts/font-gate.json`) |
| User | Same admin account for admin surfaces; same seeded candidate for the runtime surface |

## Variant assignment (sealed)

- Two arms: 14px and 15px body/control text tier (D2 authority, issue #582).
- Which letter (X/Y) carries which px value is persisted ONLY in
  `artifacts/variant-map.json` (crypto coin-flip at pack creation).
- Capture order interleaves per surface (X then Y back-to-back in fresh
  contexts) so temporal drift inside a pair is seconds; both variants see the
  same build, seed, routes, DOM state, user, browser, viewport, DPR, zoom and
  font path.
- The baseline product splits the D2 tier (body recipes/table cells 14px,
  `text-sm` control tier 15px); each arm converges the whole tier at one
  size — see 01-protocol.md.
