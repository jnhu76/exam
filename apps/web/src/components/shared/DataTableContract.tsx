import type { ComponentProps } from "react";
import { TableCell, TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

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
  | "tag-list"
  | "actions";

/**
 * Closed overflow vocabulary (issue 445 P3-Corrective §16). A column either
 * resolves its overflow from the role default (`ROLE_OVERFLOW`) or declares an
 * explicit override on the column declaration.
 *
 * Pure-CSS policies: `nowrap`, `wrap`, `break-token`, `line-clamp-2`.
 * Content-presenter policies: `truncate`, `truncate-middle` — these keep the
 * full value accessible (title + keyboard focus) and are realized through
 * {@link DataTableOverflowText}, never through silent cell-level clipping.
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

const ROLE_OVERFLOW: Record<DataTableColumnRole, ColumnOverflow> = {
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
  "tag-list": "wrap",
  actions: "nowrap",
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
  "tag-list": "low",
  actions: "high",
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
  return column.overflow ?? ROLE_OVERFLOW[column.role];
}

export function columnPriority(column: {
  role: DataTableColumnRole;
  priority?: ColumnPriority;
}): ColumnPriority {
  return column.priority ?? ROLE_PRIORITY[column.role];
}

export function DataTableColumns({
  columns,
}: {
  columns: readonly DataTableColumnDeclaration[];
}) {
  return (
    <colgroup data-slot="data-table-columns">
      {columns.map((column, index) => (
        <col
          key={column.key ?? `${column.role}-${index}`}
          data-column-role={column.role}
          data-column-width={column.role}
          data-column-overflow={columnOverflow(column)}
          data-column-priority={columnPriority(column)}
        />
      ))}
    </colgroup>
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
  return (
    <TableCell
      data-column-role={role}
      {...overflowAttributes({ role, overflow, priority })}
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
 * Visible = recognizable head + ellipsis + tail (≥4 visible glyphs); the full
 * value stays available via title/aria-label on the focusable presenter.
 *
 * The budget is glyph-count based (not measured): machine identifiers are
 * ASCII-dominated, and 6+4 visible glyphs fit the short-id 7.5rem content box
 * (~88px ≈ 12 ASCII glyphs) without cell clipping. Strings short enough to
 * fit are never truncated.
 */
const MIDDLE_TRUNCATE_HEAD = 6;
const MIDDLE_TRUNCATE_TAIL = 4;
const MIDDLE_TRUNCATE_THRESHOLD =
  MIDDLE_TRUNCATE_HEAD + MIDDLE_TRUNCATE_TAIL + 2;

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
 * A11y contract (issue 445 P3 §20): the complete value is never lost. `truncate` /
 * `line-clamp-2` keep the full text in the DOM (screen readers read it) and
 * the focusable title makes it reachable for keyboard users; `truncate-middle`
 * renders the shortened form but exposes the full value via aria-label, title
 * and keyboard focus.
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
      tabIndex={0}
    >
      {value}
    </span>
  );
}
