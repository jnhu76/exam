import type { DataTableColumnRole } from "@/components/shared/DataTableContract";

/**
 * #601 Phase F — the single column-allocation authority.
 *
 * #454 asserted that `table-layout: fixed` + `<col>` min-width physically
 * enforces per-column minima. Runtime evidence disproved that: Chromium
 * consults col `min-width` only when deriving the TABLE-level minimum width,
 * then distributes the remaining space by its own rule (measured: long-text
 * floor 256px rendering at 186.7px). Phase F first replaced it with a
 * locked/flexible split; that rule had its own defect — residual space went to
 * the set of `width: auto` columns EQUALLY, so a page whose declaration had
 * exactly one flexible column (e.g. /admin/exams) watched it balloon to 626px
 * while every other column sat at its minimum, and turning a `description`
 * into a `status` changed a sibling column's width by hundreds of px. The
 * residual must belong to the SEMANTIC GEOMETRY, not to however many
 * `width: auto` columns happen to exist.
 *
 * The allocation contract (#601 Phase F, user-ratified):
 *
 *   requiredMin = Σ semanticMin(column)
 *
 *   available < requiredMin → rendered_i = semanticMin_i,
 *                             tableWidth = requiredMin, local horizontal scroll
 *   available ≥ requiredMin → scale = available / requiredMin,
 *                             rendered_i = semanticMin_i × scale,
 *                             tableWidth = available
 *
 * Every governed column therefore keeps its semantic floor AND shares the
 * container's residual proportionally to that same floor — one mechanism for
 * Narrow (scroll at Σ minima), Normal and Wide (uniform proportional fill).
 * Whether a table fills its container at all is the ARCHETYPE's decision, not
 * the allocator's: page shells fill, the embedded picker renders at its
 * intrinsic width (`fill: false`). Deliberately NOT part of this module:
 * preferredWidth, maxWidth, grow/shrink weights, soft caps, solvers — none of
 * them has a fixture that the two-state rule cannot satisfy.
 *
 * Accounting: every width is border-box px — cell padding (2 × 1rem) and the
 * 1px cell border live INSIDE the column width, exactly the accounting the
 * recipes.css role tokens used. requiredMin therefore needs no extra chrome
 * term.
 */

export interface RoleGeometry {
  /**
   * Semantic floor in border-box px. It is both the column's guaranteed
   * minimum and its weight in the proportional residual distribution.
   */
  min: number;
}

/** Actions column bound (UI-ACTION-CAPACITY-1, issue 453): fine vs coarse pointer. */
export const ACTIONS_MIN_FINE = 96;
export const ACTIONS_MIN_COARSE = 120;

/**
 * Role geometry table. Values are the #454/#590/#598-derived tokens
 * (rem × 16) — migration note: these numbers previously lived as CSS width
 * rules in recipes.css; Phase F moved them here so the allocator is their
 * single consumer. Fixture provenance of the vocabulary-bound tokens:
 *
 *   status 136px (8.5rem, #445 P3-Corrective K1) — widest legal badge across
 *     statusMeta × SUPPORTED_LOCALES measures 100.02px (offline, icon); token
 *     content box 104px ≥ 100.02 + slack. See statusFixture.ts.
 *
 *   date-range 232px (14.5rem, #590) — fixed 23-char grammar
 *     `YYYY-MM-DD — YYYY-MM-DD` rendered nowrap in the frozen 15px cell font:
 *     widest legal form measures 195.5px; content box 199px ≥ 195.5 + slack.
 *
 *   type 116px (7.25rem, #590) — widest bounded enumerated-label badge across
 *     the typeFixture.ts families estimates 80px (5 × 12.4px CJK + 16px badge
 *     padding + 2px border); content box 83px ≥ 80 + slack.
 *
 *   action-label 152px (9.5rem, #598) — @exam/authz AuditAction registry ×
 *     `admin.audit.filterActions.*` copy; widest derived label estimates
 *     117.2px (8 CJK glyphs × 12.4px + pill padding); content box 119px.
 *     Raw machine action keys render through the truncate-middle presenter
 *     channel (ROLE_MACHINE_VALUE_OVERFLOW), not this token.
 *
 *   actions 96px fine / 120px coarse (#453 UI-ACTION-CAPACITY-1) — the inline
 *     row-action vocabulary is icon-only and count-bounded (N ≤ 2 inline;
 *     N > 2 → 1 primary + kebab): 2 × iconBtn(2rem) + gap + 2 × cell padding
 *     + slack ≈ 6rem fine; 2 × iconBtn(2.75rem) ≈ 7.5rem coarse.
 *
 * A floor is a MINIMUM CONTENT CAPACITY, never an exact rendered width: at
 * wide containers every column's rendered width is its floor × the table's
 * scale, so status 136 → ~197 and actions 96 → ~139 on a 1440 admin-dense
 * page are the contract working, not a defect.
 *
 * The fixtures are structural-test oracles (table-contract-guards.test.ts): a
 * new status/type/action or locale grows the fixture and reds the gate until
 * the token here is revisited. The runtime halves are the
 * dense-table-cell-fitting / ui-governance / data-view E2E assertions.
 */
export const ROLE_GEOMETRY: Record<DataTableColumnRole, RoleGeometry> = {
  "primary-text": { min: 192 },
  "secondary-text": { min: 144 },
  "long-text": { min: 256 },
  description: { min: 208 },
  "tag-list": { min: 160 },
  status: { min: 136 },
  date: { min: 168 },
  "date-range": { min: 232 },
  duration: { min: 80 },
  number: { min: 72 },
  score: { min: 80 },
  "short-id": { min: 120 },
  type: { min: 116 },
  "action-label": { min: 152 },
  actions: { min: ACTIONS_MIN_FINE },
};

/** Host pointer context, evaluated once (a pointer type does not change at runtime). */
export function isCoarsePointerContext(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

export interface ColumnAllocation {
  /** The exact width the table element renders at. */
  tableWidth: number;
  /** Per-declaration border-box column widths, in declaration order. */
  columnWidths: number[];
  /** Σ role minima — the table-level content floor. */
  requiredMin: number;
  /** Total space distributed beyond the minima (0 below requiredMin). */
  residual: number;
}

export interface AllocateOptions {
  /**
   * Whether the table fills its measured container (page shells) or renders
   * at its intrinsic width (the embedded picker). The archetype owns this —
   * see the module contract. Defaults to fill.
   */
  fill?: boolean;
  /**
   * Pointer context for the actions-column bound. Defaults to the host's
   * `(pointer: coarse)` evaluation; tests inject it explicitly.
   */
  pointerCoarse?: boolean;
}

function roleMin(role: DataTableColumnRole, pointerCoarse: boolean): number {
  if (role === "actions" && pointerCoarse) return ACTIONS_MIN_COARSE;
  return ROLE_GEOMETRY[role].min;
}

/** Σ visible-column role minima (the content half of the fit equation). */
export function requiredMinWidth(
  roles: readonly DataTableColumnRole[],
  options: AllocateOptions = {},
): number {
  const pointerCoarse = options.pointerCoarse ?? isCoarsePointerContext();
  return roles.reduce((sum, role) => sum + roleMin(role, pointerCoarse), 0);
}

/**
 * Deterministic allocation from declarations + the measured container — the
 * two-state rule in the module contract. Whole-pixel columns always sum to
 * exactly `tableWidth`, and every column keeps `width ≥ semanticMin` in both
 * states (scale ≥ 1 whenever the table is wider than requiredMin).
 */
export function allocateTableColumns(
  roles: readonly DataTableColumnRole[],
  availableWidth: number,
  options: AllocateOptions = {},
): ColumnAllocation {
  const pointerCoarse = options.pointerCoarse ?? isCoarsePointerContext();
  const mins = roles.map((role) => roleMin(role, pointerCoarse));
  const requiredMin = mins.reduce((sum, min) => sum + min, 0);
  if (requiredMin === 0) {
    return { tableWidth: 0, columnWidths: [], requiredMin: 0, residual: 0 };
  }

  // The measured box is fractional; columns are whole pixels. Floor it: a
  // rounded-up target makes the column sum exceed the box by a fraction of a
  // pixel, which Chromium answers with a classic scrollbar on a table that
  // visibly fits (measured: box 1394.67px, allocation 1395px, 16px scrollbar,
  // scrollWidth − clientWidth = 0 — invisible to the integer overflow facts).
  const available = Math.floor(availableWidth);
  const tableWidth =
    (options.fill ?? true) && available > requiredMin ? available : requiredMin;
  const scale = tableWidth / requiredMin;

  return {
    tableWidth,
    columnWidths: roundToExactSum(
      mins.map((min) => min * scale),
      tableWidth,
    ),
    requiredMin,
    residual: tableWidth - requiredMin,
  };
}

/**
 * Largest-remainder rounding to whole pixels with Σ == tableWidth exactly:
 * the colgroup must account for the table's full width, otherwise Chromium
 * re-distributes the difference by its own rule and the rendered columns stop
 * matching the allocation the contract asserts. Deterministic: ties break by
 * declaration order.
 */
function roundToExactSum(widths: number[], tableWidth: number): number[] {
  const floors = widths.map((w) => Math.floor(w));
  let remainder = tableWidth - floors.reduce((sum, w) => sum + w, 0);
  const order = widths
    .map((w, i) => ({ i, frac: w - Math.floor(w) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    remainder -= 1;
  }
  return out;
}
