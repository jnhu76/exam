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
3. **`contact-sheet-gates.spec.ts`** — permanent proofs of the contact-sheet
   artifact contract (image-load gate, label integrity gate, table coverage
   classification). Needs no running server.

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

Set D (table siblings) additionally classifies every declared sibling
through `collectShellFacts(page).tables`:

- **`TABLE_PRESENT`** — a rendered table matches the declared archetype; the
  tile is eligible for table-geometry visual review. The recorded `tables`
  facts keep archetype/tier and the width/overflow measurements.
- **`TABLE_COVERAGE_GAP`** — the page was captured but rendered no table
  (typically an empty state under the canonical seed). The tile figcaption
  is suffixed `[TABLE_COVERAGE_GAP]`, and `comparison-sets.json` records the
  status plus a per-set `tableCoverageSummary` (declared / present / gaps /
  contract failures). A gap never fails the patrol — but it is never a
  table visual PASS either.
- **Contract failure (RED)** — the page renders tables but none matches the
  declared archetype: the comparison set has drifted from the product and
  the run fails (`classifyTableCoverage` in `patrol-fixtures.ts`).

## Contact-sheet artifact contract (frozen)

All contact sheets are rendered through the single owner
`contact-sheet.ts` → `renderContactSheet` (read PNG → base64 → HTML →
image gate → screenshot → self-proof). Three rules are frozen; each has a
permanent proof in `contact-sheet-gates.spec.ts`:

1. Comparison-tile image load failure → **PATROL FAIL** (missing file,
   corrupt file, or `<img>` without decoded pixels; the sheet is never
   captured with broken tiles).
2. Tile `id`/`label`/`route` null/undefined/empty or the literal strings
   `"undefined"`/`"null"` → **PATROL FAIL** (applied both at capture —
   `assertComparisonItem` — and at render time).
3. A declared table sibling that renders no expected table →
   **TABLE_COVERAGE_GAP**, reported honestly (figcaption suffix + metadata
   + summary), never a table visual PASS.

Contact-sheet source images are passed as FILE PATHS; base64 encoding
happens only inside `renderContactSheet`. Callers passing pre-encoded data
or hand-building sheet HTML is the defect class that produced broken
NAV-HIERARCHY sheets once already — don't.

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
