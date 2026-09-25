import type { DataTableColumnRole } from "@/components/shared/DataTableContract";
import { headerCapacityPx } from "@/table/headerCapacity";
import {
  calibratedFloorPx,
  isCompressibleRole,
  tokenGrid,
} from "@/table/roleCalibration";

/**
 * The single column-allocation authority.
 *
 * Two meanings share one number: the hard structural floor, the preferred
 * width and the proportional-growth weight.
 * The Data View Geometry Census measured where they diverge — /admin/recovery
 * scrolled horizontally at every viewport while 438px of its region went
 * unused, and the exam-edit inline picker scrolled with its actions column
 * entirely off-screen — because a *preferred* width was being used as the
 * scroll trigger. This module separates them:
 *
 *   floor — the hard structural minimum. Below it the current declared
 *           representation is no longer acceptably usable and local horizontal
 *           overflow is justified.
 *   basis — the preferred semantic geometry. It is the basis of proportional
 *           growth and the width at which headers fit (headerCapacity.ts).
 *
 * The allocation has exactly three semantic regimes, in this order:
 *
 *   A < Σfloor                 OVERFLOW    rendered_i = floor_i, table = Σfloor
 *   Σfloor ≤ A < Σbasis        COMPRESSED  rendered_i = floor_i + t·(basis_i − floor_i)
 *                                          t = (A − Σfloor) / (Σbasis − Σfloor)
 *   Σbasis ≤ A                 PREFERRED/  rendered_i = basis_i × scale, scale =
 *                              EXPANDED    min(A, cap·Σbasis) / Σbasis
 *
 * Non-compressible roles (floor == basis) do not shrink in the compressed
 * regime — the interpolation is the identity for them — while a compressible
 * role absorbs exactly as much compression as its own declared representation
 * allows (wrap / break-token / truncate / line-clamp-2). Local horizontal
 * scroll is therefore reserved for the case the affordance promises: the hard
 * floors genuinely do not fit.
 *
 * Expansion is bounded by ONE table-level cap. The census measured
 * proportional growth as visually reasonable while the scale stayed near 1.2
 * (exams 1.17, questions 1.22) and increasingly poor above it (users 1.54,
 * courses 1.83, dashboard 2.27 — a 296px column holding `admin`), so a table
 * stops growing at EXPANSION_CAP × its preferred width and the region keeps
 * the remainder as its own surface. There is no per-role maxWidth and no
 * per-page tuning.
 *
 * `widthMode` is the COMPOSITION's width intent, not the archetype's: a page
 * data view fills the region it was given, while an embedded picker dialog
 * renders at its preferred width (cap = 1) inside whatever container it has.
 * The archetype describes the semantic table kind only.
 *
 * Accounting: every width is border-box px — cell padding (2 × 1rem) and the
 * 1px cell border live INSIDE the column width, exactly the accounting the
 * recipes.css role tokens used. Σfloor / Σbasis therefore need no extra chrome
 * term.
 */

/** Actions column value bound (UI-ACTION-CAPACITY-1, issue 453). */
export const ACTIONS_MIN_FINE = 96;
export const ACTIONS_MIN_COARSE = 120;

/**
 * The one table-level expansion cap (× Σbasis). Chosen from a measured
 * comparison of 1.25 / 1.33 / 1.50 on the representative pages — see the
 * growth measurements in the module header.
 */
export const EXPANSION_CAP = 1.33;

export interface RoleGeometry {
  /**
   * Hard structural floor in border-box px: the width below which this role's
   * declared representation stops being acceptably usable, so the table takes
   * local horizontal scroll instead of squeezing further.
   */
  floor: number;
  /**
   * Preferred semantic geometry in border-box px: the basis of proportional
   * growth, and the width at which both the role's value vocabulary and its
   * supported header vocabulary fit. `floor == basis` for a non-compressible
   * (fixed-capacity) role; `floor < basis` for a role with a narrower legal
   * representation.
   */
  basis: number;
}

/**
 * VALUE geometry — the role's cell-value capacity. These are the derived tokens
 * (rem × 16); the allocator is their single consumer. Fixture provenance of the
 * vocabulary-bound tokens:
 *
 *   status 136px (8.5rem) — widest legal badge across
 *     statusMeta × SUPPORTED_LOCALES measures 100.02px (offline, icon); token
 *     content box 104px ≥ 100.02 + slack. See statusFixture.ts.
 *
 *   date-range 232px (14.5rem) — fixed 23-char grammar
 *     `YYYY-MM-DD — YYYY-MM-DD` rendered nowrap in the frozen 15px cell font:
 *     widest legal form measures 195.5px; content box 199px ≥ 195.5 + slack.
 *
 *   type 116px (7.25rem) — widest bounded enumerated-label badge across
 *     the typeFixture.ts families estimates 80px; content box 83px ≥ 80 + slack.
 *
 *   action-label 152px (9.5rem) — @exam/authz AuditAction registry ×
 *     `admin.audit.filterActions.*` copy; widest derived label estimates
 *     117.2px; content box 119px. Raw machine action keys render through the
 *     truncate-middle presenter channel (ROLE_MACHINE_VALUE_OVERFLOW).
 *
 *   actions 96px fine / 120px coarse (#453 UI-ACTION-CAPACITY-1) — the inline
 *     row-action vocabulary is icon-only and count-bounded (N ≤ 2 inline;
 *     N > 2 → 1 primary + kebab).
 *
 * The remaining tokens are the bounded-vocabulary roles (date grammar,
 * duration, number, score, short-id) whose presenters/policies are pinned by
 * table-presenter-guards.test.ts.
 */
export const VALUE_GEOMETRY: Record<DataTableColumnRole, number> = {
  "primary-text": 192,
  "secondary-text": 144,
  "long-text": 256,
  description: 208,
  "tag-list": 160,
  status: 136,
  date: 168,
  "date-range": 232,
  duration: 80,
  number: 72,
  score: 80,
  "short-id": 120,
  type: 116,
  "action-label": 152,
  actions: ACTIONS_MIN_FINE,
};

/**
 * The role geometry table. `floor` is the calibrated hard floor (the fixed-
 * capacity value token for non-compressible roles, the calibrated
 * smallest readable line for the compressible ones); `basis` is the larger of
 * the value token and the role's header capacity, so a role whose values are
 * short can never carry a header that does not fit at preferred geometry.
 *
 * A floor is a MINIMUM CONTENT CAPACITY, never an exact rendered width: at
 * preferred/expanded geometry every column renders at basis × the table's
 * scale.
 */
export const ROLE_GEOMETRY: Record<DataTableColumnRole, RoleGeometry> =
  Object.fromEntries(
    (Object.keys(VALUE_GEOMETRY) as DataTableColumnRole[]).map((role) => {
      const value = VALUE_GEOMETRY[role];
      const floor = isCompressibleRole(role) ? calibratedFloorPx(role) : value;
      return [
        role,
        { floor, basis: tokenGrid(Math.max(value, headerCapacityPx(role))) },
      ];
    }),
  ) as Record<DataTableColumnRole, RoleGeometry>;

/** Host pointer context, evaluated once (a pointer type does not change at runtime). */
export function isCoarsePointerContext(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

/**
 * The allocator's regime decision, published by the scroll region
 * (`data-geometry-state`) so runtime probes and the route-wide acceptance
 * sweep read the same classification the allocation used.
 *
 *   overflow   — A < Σfloor: the hard floors do not fit; local scroll is the
 *                honest affordance.
 *   compressed — Σfloor ≤ A < Σbasis: every column renders between its floor
 *                and its basis; nothing scrolls.
 *   preferred  — Σbasis ≤ A ≤ cap·Σbasis: the table fills the region and grows
 *                within the cap.
 *   expanded   — A > cap·Σbasis: the table stops at the cap and the region
 *                keeps the remainder (in `intrinsic` width mode the cap is 1,
 *                i.e. the table renders at its preferred width).
 */
export type GeometryState =
  | "overflow"
  | "compressed"
  | "preferred"
  | "expanded";

export interface ColumnAllocation {
  /**
   * Σ of the rendered column widths — exactly what the colgroup accounts for.
   * The table's columns always sum to this number, so the allocation is what
   * paints.
   */
  tableWidth: number;
  /**
   * The width the table ELEMENT renders at. Equal to `tableWidth` in every
   * regime except `expanded`, where the element keeps the region's full width
   * and the remainder is taken by an empty trailing cell (recipes.css
   * `tr::after`, present only in that state) — so the shell's grid stays
   * complete instead of stopping mid-surface, while the declared columns keep
   * their capped widths exactly.
   */
  elementWidth: number;
  /** Σ role floors — the hard content floor and the overflow trigger. */
  floorWidth: number;
  /** Σ role bases — the preferred table width. */
  basisWidth: number;
  /** Which regime produced this allocation. */
  state: GeometryState;
  /** Total space distributed beyond Σfloor (0 in the overflow regime). */
  residual: number;
  /**
   * Whole-pixel column widths in declaration order; Σ === `tableWidth` exactly
   * (largest-remainder rounding — see roundToExactSum). This is what the
   * colgroup renders, so the allocation is what paints.
   */
  columnWidths: number[];
  /**
   * The resolved geometry of every declared column, in declaration order — the
   * band `[floor, basis]` the rendered width was drawn from. Published by the
   * contract as `data-geometry-roles` so a runtime fixture can assert each
   * column against its own band without restating this table.
   */
  roleGeometry: RoleGeometry[];
}

export interface AllocateOptions {
  /**
   * The composition's width intent (see the module contract). Page data views
   * fill their region; an embedded picker dialog renders at its preferred
   * width. Defaults to fill.
   */
  widthMode?: "fill" | "intrinsic";
  /**
   * Pointer context for the actions-column bound. Defaults to the host's
   * `(pointer: coarse)` evaluation; tests inject it explicitly.
   */
  pointerCoarse?: boolean;
}

function roleGeometry(
  role: DataTableColumnRole,
  pointerCoarse: boolean,
): RoleGeometry {
  const geometry = ROLE_GEOMETRY[role];
  if (role !== "actions" || !pointerCoarse) return geometry;
  return { floor: ACTIONS_MIN_COARSE, basis: ACTIONS_MIN_COARSE };
}

/** Σ visible-column hard floors (the overflow trigger). */
export function requiredMinWidth(
  roles: readonly DataTableColumnRole[],
  options: AllocateOptions = {},
): number {
  const pointerCoarse = options.pointerCoarse ?? isCoarsePointerContext();
  return roles.reduce(
    (sum, role) => sum + roleGeometry(role, pointerCoarse).floor,
    0,
  );
}

/** Σ visible-column preferred widths (the preferred table width). */
export function preferredWidth(
  roles: readonly DataTableColumnRole[],
  options: AllocateOptions = {},
): number {
  const pointerCoarse = options.pointerCoarse ?? isCoarsePointerContext();
  return roles.reduce(
    (sum, role) => sum + roleGeometry(role, pointerCoarse).basis,
    0,
  );
}

/**
 * Deterministic allocation from declarations + the measured container — the
 * three-regime rule in the module contract. Whole-pixel columns always sum to
 * exactly `tableWidth`; in the compressed regime every column lies inside
 * [floor, basis]; below the floors every column renders at exactly its floor.
 */
export function allocateTableColumns(
  roles: readonly DataTableColumnRole[],
  availableWidth: number,
  options: AllocateOptions = {},
): ColumnAllocation {
  const pointerCoarse = options.pointerCoarse ?? isCoarsePointerContext();
  const geometry = roles.map((role) => roleGeometry(role, pointerCoarse));
  const floors = geometry.map((g) => g.floor);
  const bases = geometry.map((g) => g.basis);
  const floorWidth = floors.reduce((sum, value) => sum + value, 0);
  const basisWidth = bases.reduce((sum, value) => sum + value, 0);
  if (floorWidth === 0) {
    return {
      tableWidth: 0,
      elementWidth: 0,
      columnWidths: [],
      floorWidth: 0,
      basisWidth: 0,
      state: "overflow",
      residual: 0,
      roleGeometry: [],
    };
  }

  // The measured box is fractional; columns are whole pixels. Floor it: a
  // rounded-up target makes the column sum exceed the box by a fraction of a
  // pixel, which Chromium answers with a classic scrollbar on a table that
  // visibly fits (measured: box 1394.67px, allocation 1395px, 16px scrollbar,
  // scrollWidth − clientWidth = 0 — invisible to the integer overflow facts).
  const available = Math.floor(availableWidth);

  if (available < floorWidth) {
    return {
      tableWidth: floorWidth,
      elementWidth: floorWidth,
      columnWidths: floors,
      floorWidth,
      basisWidth,
      state: "overflow",
      residual: 0,
      roleGeometry: geometry,
    };
  }

  // Σfloor ≤ available < Σbasis. B > F holds here (available < Σbasis and
  // available ≥ Σfloor would otherwise contradict), so the interpolation is
  // well-defined.
  if (available < basisWidth) {
    const t = (available - floorWidth) / (basisWidth - floorWidth);
    const raw = floors.map(
      (floor, index) => floor + t * ((bases[index] ?? floor) - floor),
    );
    return {
      tableWidth: available,
      elementWidth: available,
      columnWidths: roundToExactSum(raw, available),
      floorWidth,
      basisWidth,
      state: "compressed",
      residual: available - floorWidth,
      roleGeometry: geometry,
    };
  }

  const cap = options.widthMode === "intrinsic" ? 1 : EXPANSION_CAP;
  // Floored, so the rendered table can never exceed cap × Σbasis (the bound is
  // the contract, not an approximation of it).
  const capWidth = Math.floor(basisWidth * cap);
  const tableWidth = Math.min(available, capWidth);
  const scale = tableWidth / basisWidth;

  const capped = tableWidth < available;
  return {
    tableWidth,
    // A capped table keeps the region's full width so the shell's grid stays
    // complete: the columns stop at the cap and the empty trailing cell takes
    // the remainder (recipes.css, keyed on data-geometry-state="expanded").
    elementWidth: available,
    columnWidths: roundToExactSum(
      bases.map((basis) => basis * scale),
      tableWidth,
    ),
    floorWidth,
    basisWidth,
    state: capped ? "expanded" : "preferred",
    residual: tableWidth - floorWidth,
    roleGeometry: geometry,
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
