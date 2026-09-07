# UI Multimodal Patrol

Visual patrol harness for the admin/candidate UI. Two complementary layers:

1. **`ui-multimodal-patrol.spec.ts`** — full-coverage screenshot sweep with a
   per-screenshot DOM manifest (`manifest.json`): document overflow, NAV
   shell facts (sidebar/nav/footer rects, `aria-current`, group + href
   order, overflow state), and table facts (archetype, tier, container /
   client / scroll width, overflow state, scroll-hint viewport presence).
2. **`ui-comparison-suites.spec.ts`** — comparison sets (`#494`): screenshots
   are captured so equivalent states can be reviewed *against each other*
   instead of independently. Each set holds persona, viewport, shell state,
   browser, and seed constant and varies exactly one dimension.

## Usage

The patrol reuses the canonical `run-wsl.sh` lifecycle on dedicated ports so
it never collides with the standard E2E stack:

```bash
DEV_API_PORT=3001 DB_HOST_PORT=5433 REDIS_HOST_PORT=6380 \
E2E_BASE_URL=http://localhost:3001 E2E_WORKERS=1 \
bash scripts/e2e/run-wsl.sh --keep-server -- --config=playwright.patrol.config.ts
```

Output lands in `.tmp/ui-patrol/<run-id>/`:

| Path | Content |
| --- | --- |
| `manifest.json` | per-screenshot entries + DOM facts |
| `runtime-findings.json` | deterministic findings (console errors, …) |
| `route-coverage.json` | route × role coverage matrix |
| `comparison-sets.json` | comparison metadata (held-constant vs varied) |
| `sheets/` | contact sheets + per-tile screenshots + sidebar crops |
| `REVIEW-PROMPT.md` | the permanent multimodal comparison prompt |

## Comparison sets

| Set | Held constant | Varies | Sheets |
| --- | --- | --- | --- |
| A — Admin shell continuity | persona, 1280×800, full sidebar | route (14-stop ordered sequence) | `NAV-COMPARE-admin-1280x800(.png/-sidebars.png)` |
| B — Responsive shell | persona, `/admin/exams` | viewport band | `NAV-COMPARE-breakpoints-exams.png` |
| C — Role shell | 1440×900 | persona (capability filter) | `ROLE-SHELL-COMPARE-1440x900.png` |
| D — Table siblings | persona, 1280×800, archetype | route within archetype | `TABLE-COMPARE-management-1280.png`, `TABLE-COMPARE-diagnostic-1280.png` |

Tile order preserves set ordering; labels sit outside the application UI.
The harness proves itself deterministically in-test (`#494` §42): ordered
route sequence, existing non-empty sidebar crops, and non-null DOM metadata
— no LLM response is ever a CI assertion.

## Review discipline

- Multimodal review is **discovery, not conviction** (`#494` §41): feed the
  sheet + `comparison-sets.json` + `REVIEW-PROMPT.md` to the reviewer; every
  HIGH/MEDIUM candidate must then be confirmed by deterministic DOM probes
  (rects, scroll metrics, `aria-current`, overflow state) before it is
  called a defect.
- **No pixel-diff CI** (`#494` §45): permanent gates are semantic/geometry
  (see `apps/e2e/e2e/admin-nav-continuity.spec.ts`); the patrol stays a
  high-recall visual sweep.
- **Graduation rule** (`#494` §46): when the patrol surfaces a stable failure
  class, translate it into a deterministic DOM invariant and a permanent
  Playwright gate. Precedent: "nav looks different" → current destination
  can leave the nav viewport → `admin-nav-continuity.spec.ts`.

The normative navigation contract enforced here is
`docs/standards/ui-system.md` §Navigation shell continuity (NAV-1…NAV-6).
