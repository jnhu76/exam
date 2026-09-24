import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { useContext, useMemo } from "react";
import { TableCell, Table, TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { TableAllocationContext } from "@/components/shared/TableScrollSurface";
import {
  allocateTableColumns,
  type GeometryState,
} from "@/table/columnAllocation";

export type DataTableColumnRole =
  | "primary-text"
  | "secondary-text"
  | "long-text"
  | "description"
  | "status"
  | "date"
  | "date-range"
  | "duration"
  | "number"
  | "score"
  | "short-id"
  | "type"
  | "action-label"
  | "tag-list"
  | "actions";

/**
 * Closed overflow vocabulary (issue 445 P3-Corrective §16). A column either
 * resolves its overflow from the role default (`ROLE_OVERFLOW`) or declares an
 * explicit override on the column declaration.
 *
 * Pure-CSS policies: `nowrap`, `wrap`, `break-token`. `nowrap` is single-line
 * and clips at the cell (recipes.css), so its value can never paint outside
 * the column; the cell reveals the full value on hover when it does not fit
 * (see {@link DataTableCell}).
 * Content-presenter policies: `truncate`, `truncate-middle`, `line-clamp-2` —
 * these keep the full value accessible (title + keyboard focus) and are
 * realized through {@link DataTableOverflowText}.
 */
export type ColumnOverflow =
  | "nowrap"
  | "wrap"
  | "break-token"
  | "truncate"
  | "truncate-middle"
  | "line-clamp-2";

/** Column importance, metadata only in this issue (issue 445 P3 §5; consumed by
 * UI-TABLE-MOBILE-1 for card field selection — never by desktop tier logic). */
export type ColumnPriority = "high" | "normal" | "low";

export const ROLE_OVERFLOW: Record<DataTableColumnRole, ColumnOverflow> = {
  "primary-text": "wrap",
  "secondary-text": "wrap",
  "long-text": "wrap",
  description: "truncate",
  status: "nowrap",
  date: "nowrap",
  "date-range": "nowrap",
  duration: "nowrap",
  number: "nowrap",
  score: "nowrap",
  "short-id": "truncate-middle",
  type: "nowrap",
  "action-label": "nowrap",
  "tag-list": "wrap",
  actions: "nowrap",
};

/**
 * Per-role legal overflow domains (issue 454 review corrective C1). An
 * explicit override is only legal inside its role's domain; the
 * never-silent-truncate roles (status, score, actions, primary-text) accept
 * no truncating mode, so a declaration can never silently truncate them.
 * INVARIANT: every `ROLE_OVERFLOW` default belongs to its own role's set
 * (pinned by the structural test).
 */
export const ROLE_ALLOWED_OVERFLOW: Record<
  DataTableColumnRole,
  readonly ColumnOverflow[]
> = {
  "primary-text": ["wrap", "break-token"],
  "secondary-text": ["wrap", "break-token"],
  "long-text": ["wrap", "break-token", "truncate"],
  description: ["truncate", "line-clamp-2", "wrap"],
  status: ["nowrap"],
  date: ["nowrap"],
  "date-range": ["nowrap"],
  duration: ["nowrap"],
  number: ["nowrap"],
  score: ["nowrap"],
  "short-id": ["truncate-middle"],
  type: ["nowrap"],
  "action-label": ["nowrap"],
  "tag-list": ["wrap"],
  actions: ["nowrap"],
};

const ROLE_PRIORITY: Record<DataTableColumnRole, ColumnPriority> = {
  "primary-text": "high",
  "secondary-text": "normal",
  "long-text": "normal",
  description: "low",
  status: "high",
  date: "normal",
  "date-range": "low",
  duration: "low",
  number: "normal",
  score: "high",
  "short-id": "normal",
  type: "low",
  "action-label": "low",
  "tag-list": "low",
  actions: "high",
};

/**
 * Machine-value compatibility channel, per role (issue 598). A role may own a
 * second content class that no finite vocabulary fixture can bound — machine
 * tokens reaching the cell from historical rows or version skew — rendered
 * through {@link DataTableOverflowText} with the mode named here. The column's
 * declared overflow still governs the role's enumerable channel, and the
 * presenter-pairing guard accepts a presenter inside a non-presenter column
 * ONLY when it matches this channel's mode exactly: an unlisted role can never
 * grow a second, contradictory containment policy.
 *
 * INVARIANT: a listed mode is a presenter policy, and the role's own
 * `ROLE_OVERFLOW` default is not (the two channels must not collapse into one
 * policy) — pinned by the structural test.
 */
export const ROLE_MACHINE_VALUE_OVERFLOW: Partial<
  Record<DataTableColumnRole, ColumnOverflow>
> = {
  "action-label": "truncate-middle",
};

/**
 * One column declaration: the semantic role plus optional overflow/priority
 * overrides. Pages declare semantics; the contract derives the DOM attributes
 * (`data-column-overflow` / `data-column-priority`) from the single
 * declaration — headers and cells never repeat the metadata (P3 §18).
 */
export interface DataTableColumnDeclaration {
  role: DataTableColumnRole;
  key?: string;
  overflow?: ColumnOverflow;
  priority?: ColumnPriority;
}

export function columnOverflow(column: {
  role: DataTableColumnRole;
  overflow?: ColumnOverflow;
}): ColumnOverflow {
  if (column.overflow === undefined) return ROLE_OVERFLOW[column.role];
  // INVARIANT: an override outside the role's domain is an illegal internal
  // declaration, never a runtime input — every build fails loud (the
  // allocation-scope guard holds the same contract), so no build can
  // reinterpret a declaration into a different containment policy.
  if (!ROLE_ALLOWED_OVERFLOW[column.role].includes(column.overflow)) {
    throw new Error(
      `DataTable contract violation: role "${column.role}" forbids overflow "${column.overflow}" (allowed: ${ROLE_ALLOWED_OVERFLOW[column.role].join(", ")})`,
    );
  }
  return column.overflow;
}

export function columnPriority(column: {
  role: DataTableColumnRole;
  priority?: ColumnPriority;
}): ColumnPriority {
  return column.priority ?? ROLE_PRIORITY[column.role];
}

export function DataTableColumns({
  columns,
  widths,
}: {
  columns: readonly DataTableColumnDeclaration[];
  /** Explicit per-column border-box px from the allocation authority. */
  widths?: readonly number[];
}) {
  return (
    <colgroup data-slot="data-table-columns">
      {columns.map((column, index) => (
        <col
          key={column.key ?? `${column.role}-${index}`}
          data-column-role={column.role}
          data-column-overflow={columnOverflow(column)}
          data-column-priority={columnPriority(column)}
          {...(widths ? { style: { width: `${widths[index]}px` } } : {})}
        />
      ))}
    </colgroup>
  );
}

/**
 * Props spread onto the table element when the allocation authority governs
 * it: the exact computed width, the marker that scopes `table-layout: fixed`
 * (recipes.css) to allocated tables only, and the allocation's own facts —
 * its regime (`data-geometry-state`) and the two contract sums
 * (`data-geometry-floor` / `data-geometry-basis`). The facts are published so
 * the route-wide acceptance sweep and the E2E fixtures assert the contract
 * directly instead of re-deriving Σfloor/Σbasis from the colgroup outside the
 * authority that computed them.
 */
export interface AllocatedTableProps {
  style: { width: string };
  "data-column-allocation": "computed";
  "data-geometry-state": GeometryState;
  "data-geometry-floor": string;
  "data-geometry-basis": string;
  /** The empty trailing cell's width (0 outside the expanded regime). */
  "data-geometry-spacer": string;
  /**
   * Per-column `floor:basis` pairs in declaration order (the role itself is
   * already on the colgroup). The sums above are enough to classify a table's
   * regime; the pairs let a runtime fixture assert each column against ITS OWN
   * contract band (compressed: inside [floor, basis]; preferred: basis × scale;
   * overflow: exactly floor) without restating the geometry table in the test —
   * the numbers stay owned here.
   */
  "data-geometry-roles": string;
}

/**
 * Resolve the column allocation for one declaration set from the enclosing
 * scroll surface's measured scope (issue 601 Phase F). Returns the colgroup and
 * the table-element props; both renderers of governed tables
 * (DataTableSurface for contract-direct pages, DesktopDataTable for the
 * TanStack row model) consume this — there is no third path.
 *
 * Outside an allocation scope this FAILS LOUD — in every build, not only in
 * development. A governed table outside a scroll surface is an illegal
 * composition (nothing has measured a container for it), and the alternative —
 * silently rendering the colgroup without widths and letting the browser run a
 * second, ungoverned layout system — is exactly the dual-authority defect this
 * module exists to prevent.
 */
export function useColumnAllocation(
  columns: readonly DataTableColumnDeclaration[],
): {
  colgroup: ReactNode;
  tableProps: AllocatedTableProps | Record<string, never>;
} {
  const scope = useContext(TableAllocationContext);
  const allocation = useMemo(
    () =>
      scope === null
        ? null
        : allocateTableColumns(
            columns.map((column) => column.role),
            scope.availableWidth,
            { widthMode: scope.widthMode },
          ),
    [scope, columns],
  );

  if (scope === null) {
    throw new Error(
      "DataTable contract violation: a governed table must render inside a TableScrollSurface (DataTableShell / DataWorkbench / an allocation provider) — the column allocator has no measured container here",
    );
  }

  return {
    colgroup: (
      <DataTableColumns columns={columns} widths={allocation?.columnWidths} />
    ),
    tableProps:
      allocation === null
        ? {}
        : {
            style: { width: `${allocation.elementWidth}px` },
            "data-column-allocation": "computed",
            "data-geometry-state": allocation.state,
            "data-geometry-floor": String(allocation.floorWidth),
            "data-geometry-basis": String(allocation.basisWidth),
            "data-geometry-spacer": String(
              allocation.elementWidth - allocation.tableWidth,
            ),
            "data-geometry-roles": allocation.roleGeometry
              .map((g) => `${g.floor}:${g.basis}`)
              .join(","),
          },
  };
}

/**
 * The table element for contract-direct pages: the ui Table primitive bound
 * to the allocation authority (computed colgroup + exact table width +
 * computed-layout marker). Pages declare semantics through the column
 * declarations and render their own header/body rows — this component owns
 * only the table element + colgroup wiring, so there is exactly one width
 * authority for both composition styles.
 */
export function DataTableSurface({
  columns,
  children,
  ...props
}: Omit<ComponentProps<typeof Table>, "children"> & {
  columns: readonly DataTableColumnDeclaration[];
  children: ReactNode;
}) {
  const { colgroup, tableProps } = useColumnAllocation(columns);
  return (
    <Table {...tableProps} {...props}>
      {colgroup}
      {children}
    </Table>
  );
}

function overflowAttributes(column: {
  role: DataTableColumnRole;
  overflow?: ColumnOverflow;
  priority?: ColumnPriority;
}) {
  return {
    "data-column-overflow": columnOverflow(column),
    "data-column-priority": columnPriority(column),
  };
}

export function DataTableHead({
  role,
  overflow,
  priority,
  ...props
}: Omit<ComponentProps<typeof TableHead>, "data-column-role"> & {
  role: DataTableColumnRole;
  overflow?: ColumnOverflow;
  priority?: ColumnPriority;
}) {
  return (
    <TableHead
      data-column-role={role}
      {...overflowAttributes({ role, overflow, priority })}
      {...props}
    />
  );
}

/**
 * INVARIANT: a clipped single-line cell keeps its full value reachable.
 *
 * Clipping a value wider than its column is what the visual authority does —
 * Element Plus, koi-ui's table engine, puts `overflow: hidden` on every
 * `.el-table .cell` — and it is the only way a cell can never paint over its
 * neighbours. Clipping alone is not that policy though: Element Plus pairs it
 * with `show-overflow-tooltip`, which reveals the full text on hover exactly
 * when the text overflows the cell (measured there as the text range against
 * the cell width). This is that reveal, on the platform's own tooltip: the
 * annotation is derived from the cell's own layout facts at hover time —
 * nothing is stored, observed or re-rendered, a cell that fits stays silent,
 * and a cell whose value changed re-annotates itself on the next hover.
 *
 * The full value is never only in the tooltip: the text stays in the DOM, so
 * it is still selectable, copyable and announced by assistive technology.
 */
function revealClippedValue(event: MouseEvent<HTMLTableCellElement>) {
  const cell = event.currentTarget;
  if (cell.scrollWidth > cell.clientWidth) {
    const value = cell.textContent ?? "";
    if (value && cell.title !== value) cell.title = value;
    return;
  }
  if (cell.title) cell.removeAttribute("title");
}

export function DataTableCell({
  role,
  overflow,
  priority,
  ...props
}: Omit<ComponentProps<typeof TableCell>, "data-column-role"> & {
  role: DataTableColumnRole;
  overflow?: ColumnOverflow;
  priority?: ColumnPriority;
}) {
  const clipped = columnOverflow({ role, overflow }) === "nowrap";
  return (
    <TableCell
      data-column-role={role}
      {...overflowAttributes({ role, overflow, priority })}
      {...(clipped && role !== "actions"
        ? { onMouseOver: revealClippedValue }
        : {})}
      {...props}
    />
  );
}

/**
 * A cell that spans the full table width, for empty-state / loading rows
 * that do not belong to any single column role. Carries the contract's
 * data-slot so it stays within the DataTable visual authority, and marks
 * itself with data-column-role="span" so the table recipes do not apply a
 * column width or overflow policy to it.
 *
 * Use only for the special "no rows" / "loading" row inside a DataTableShell
 * table body; never use it as a regular data cell.
 */
export function DataTableSpanCell({
  colSpan,
  ...props
}: Omit<ComponentProps<typeof TableCell>, "data-column-role"> & {
  colSpan: number;
}) {
  return (
    <TableCell
      data-column-role="span"
      data-column-overflow="wrap"
      colSpan={colSpan}
      {...props}
    />
  );
}

/**
 * Deterministic middle truncation for machine identifiers (short-id role).
 * Visible = recognizable head + ellipsis + tail; the full value stays available
 * via title/aria-label on the focusable presenter.
 *
 * The budget is glyph-count based (not measured at runtime) and is DERIVED from
 * the rendered geometry of the frozen short-id token, in the product font at
 * the governed 15px cell tier (issue 601 Phase F): the column is 7.5rem (120px) and
 * the cell's px-4 leaves 104px of paintable text width, while a glyph in the
 * product stack advances ~9.5px (letters/underscore; hex digits are narrower).
 * The former 6+4 form (11 glyphs ≈ 97–105px) was budgeted against a 95px
 * content box that does not exist — measured, it overflowed the text area and
 * crossed the cell border by 1px for letter/underscore-heavy tokens (caught by
 * the issue 439 V3 runtime gate on /admin/audit-logs). A 10-glyph form (≈95px) is
 * the largest budget that fits with margin; values within it render whole —
 * e.g. the 10-char `employeeId` key must never truncate.
 */
const MIDDLE_TRUNCATE_HEAD = 5;
const MIDDLE_TRUNCATE_TAIL = 4;
const MIDDLE_TRUNCATE_THRESHOLD =
  MIDDLE_TRUNCATE_HEAD + MIDDLE_TRUNCATE_TAIL + 1;

export function middleTruncate(value: string): string {
  if (value.length <= MIDDLE_TRUNCATE_THRESHOLD) return value;
  return `${value.slice(0, MIDDLE_TRUNCATE_HEAD)}…${value.slice(
    -MIDDLE_TRUNCATE_TAIL,
  )}`;
}

/**
 * The table-contract-owned content presenter for the overflow policies that
 * need presentation logic (`truncate`, `truncate-middle`, `line-clamp-2`).
 *
 * A11y contract (issue 445 P3 §20): the complete value is never lost. Every
 * mode exposes the full value via aria-label + title and is keyboard-focusable;
 * `truncate` / `line-clamp-2` also keep the full text in the DOM, while
 * `truncate-middle` renders the shortened head…tail form as visible text.
 * The aria-label is load-bearing: consumers target the cell by its full value
 * (getByLabel in authoring product-loop e2e), so truncate cannot drop it.
 */
export function DataTableOverflowText({
  value,
  mode,
  className,
}: {
  value: string;
  mode: "truncate" | "truncate-middle" | "line-clamp-2";
  className?: string;
}) {
  if (mode === "truncate-middle") {
    return (
      <span
        data-overflow-policy="truncate-middle"
        className={cn(
          "data-table-overflow-text data-table-overflow-middle",
          className,
        )}
        title={value}
        aria-label={value}
        tabIndex={0}
      >
        {middleTruncate(value)}
      </span>
    );
  }
  return (
    <span
      data-overflow-policy={mode}
      className={cn(
        "data-table-overflow-text",
        mode === "line-clamp-2"
          ? "data-table-overflow-clamp"
          : "data-table-overflow-truncate",
        className,
      )}
      title={value}
      aria-label={value}
      tabIndex={0}
    >
      {value}
    </span>
  );
}
