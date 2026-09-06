import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { MobileRecordCard } from "@/components/shared/MobileRecordCard";
import {
  columnPriority,
  type ColumnPriority,
  type DataTableColumnRole,
} from "@/components/shared/DataTableContract";
import type { DataViewColumnDef } from "@/components/shared/DesktopDataTable";

/**
 * Mobile card slots a participating column can land in (issue 457). The frozen
 * priority→slot mapping — a pure function of the column declaration:
 *
 *   low                        → omitted
 *   actions role               → actions slot (the RowActions declaration is
 *                                 reused verbatim; at most one such column)
 *   high + primary-text/long-text → primary area (declaration order)
 *   high + any other role      → header cluster
 *   normal                     → meta line (label + content span)
 *
 * Declaration order is preserved inside every slot; the buckets carry no
 * page-local mobile field maps — the same DataViewColumnDef array (including
 * its cell renderers) feeds the desktop table AND this list.
 */
export type MobileCardSlot = "header" | "primary" | "meta" | "actions";

const PRIMARY_AREA_ROLES: readonly DataTableColumnRole[] = [
  "primary-text",
  "long-text",
];

export interface MobileCardField {
  /** Stable column id (explicit `id` or string `accessorKey`; see
   * {@link stableColumnId} — positional names are not legal identities). */
  id: string;
  role: DataTableColumnRole;
  priority: ColumnPriority;
  slot: MobileCardSlot;
}

/**
 * The stable lookup identity of a card field: the column's explicit `id` or
 * its string `accessorKey`. A positional fallback (`${role}-${index}`) is NOT
 * a legal identity — the card renders cells by TanStack's column id, so a
 * made-up positional name silently breaks the cell lookup.
 */
function stableColumnId<TData>(
  column: DataViewColumnDef<TData>,
): string | undefined {
  if (column.id !== undefined) return column.id;
  if ("accessorKey" in column && typeof column.accessorKey === "string") {
    return column.accessorKey;
  }
  return undefined;
}

/**
 * The priority→card mapping (frozen rule, unit-tested directly). Pure: takes
 * the single-source column declarations, returns the participating fields in
 * declaration order with their card slot. `low` is dropped here; a second
 * actions column is a contract violation (fail-loud in dev/test). A
 * participating column without a stable id fails loud in dev/test and is
 * omitted in production — it can never render under a positional identity.
 */
export function deriveMobileCardFields<TData>(
  columns: DataViewColumnDef<TData>[],
): MobileCardField[] {
  const fields: MobileCardField[] = [];
  columns.forEach((column) => {
    const role = column.meta?.role ?? "primary-text";
    const priority = columnPriority({ role, priority: column.meta?.priority });
    if (priority === "low") return;
    const id = stableColumnId(column);
    if (id === undefined) {
      if (import.meta.env.DEV) {
        throw new Error(
          "MobileRecordList contract violation: a participating column needs an explicit `id` or string `accessorKey` (no positional fallback)",
        );
      }
      return;
    }
    let slot: MobileCardSlot;
    if (role === "actions") {
      if (import.meta.env.DEV && fields.some((f) => f.slot === "actions")) {
        throw new Error(
          "MobileRecordList contract violation: at most one actions column may participate in the card mapping",
        );
      }
      slot = "actions";
    } else if (priority === "high") {
      slot = PRIMARY_AREA_ROLES.includes(role) ? "primary" : "header";
    } else {
      slot = "meta";
    }
    fields.push({ id, role, priority, slot });
  });
  return fields;
}

export interface MobileRecordListProps<TData> {
  /** The same DataViewColumnDef array the desktop table renders from. */
  columns: DataViewColumnDef<TData>[];
  /** The page slice to render as cards. */
  rows: TData[];
  /** Row key resolver. */
  getRowId?: (row: TData) => string;
  /** Card-level activation (mirrors DesktopDataTable.onRowClick). */
  onRowClick?: (row: TData) => void;
  /** Body state — exactly one of these renders below the header. */
  loading?: boolean;
  empty?: boolean;
  error?: string | null;
  /** Optional empty-state copy override (defaults resolve from i18n). */
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

/**
 * Vertical list of mobile record cards, DERIVED from the single-source column
 * declarations (issue 457). Renders only at small viewports — the container
 * (DataTableShell `mobile` slot / DataWorkbench `mobileList`) owns the
 * `lg:hidden` visibility switch; the desktop table owns `hidden lg:block`.
 *
 * Empty/loading/error states are handled here so card mode and table mode
 * show the same body facts.
 */
export function MobileRecordList<TData>({
  columns,
  rows,
  getRowId,
  onRowClick,
  loading = false,
  empty = false,
  error = null,
  emptyTitle,
  emptyDescription,
  className,
}: MobileRecordListProps<TData>) {
  const { t } = useTranslation();

  const table = useReactTable<TData>({
    data: rows,
    columns: columns as ColumnDef<TData>[],
    getCoreRowModel: getCoreRowModel(),
    getRowId,
  });
  const fields = deriveMobileCardFields(columns);

  if (loading) {
    return <div data-slot="mobile-record-list" className={className} />;
  }
  if (error) {
    return (
      <div
        data-slot="mobile-record-list"
        className={["flex flex-col gap-3", className].filter(Boolean).join(" ")}
      >
        <MobileRecordCard
          primary={t("common.loading.loadFailed" as never)}
          meta={error}
        />
      </div>
    );
  }
  if (empty) {
    return (
      <div
        data-slot="mobile-record-list"
        className={["flex flex-col gap-3", className].filter(Boolean).join(" ")}
      >
        <MobileRecordCard
          primary={emptyTitle ?? t("common.empty" as never)}
          meta={emptyDescription}
        />
      </div>
    );
  }

  return (
    <div
      data-slot="mobile-record-list"
      className={["flex flex-col gap-3", className].filter(Boolean).join(" ")}
    >
      {table.getRowModel().rows.map((row) => {
        const cellById = new Map(
          row.getVisibleCells().map((cell) => [cell.column.id, cell]),
        );
        const bySlot = (slot: MobileCardSlot) =>
          fields.filter((f) => f.slot === slot && cellById.has(f.id));
        const header = bySlot("header");
        const primary = bySlot("primary");
        const meta = bySlot("meta");
        const actions = bySlot("actions");
        const render = (id: string) => {
          const cell = cellById.get(id);
          return cell
            ? flexRender(cell.column.columnDef.cell, cell.getContext())
            : null;
        };
        return (
          <MobileRecordCard
            key={row.id}
            onClick={onRowClick ? () => onRowClick(row.original) : undefined}
            header={
              header.length > 0 ? (
                <>
                  {header.map((f) => (
                    <span key={f.id} data-field-id={f.id}>
                      {render(f.id)}
                    </span>
                  ))}
                </>
              ) : undefined
            }
            primary={
              primary.length > 0 ? (
                <>
                  {primary.map((f) => (
                    <div
                      key={f.id}
                      data-field-id={f.id}
                      className="min-w-0 break-words"
                    >
                      {render(f.id)}
                    </div>
                  ))}
                </>
              ) : undefined
            }
            meta={
              meta.length > 0 ? (
                <>
                  {meta.map((f) => {
                    const cell = cellById.get(f.id);
                    const label = cell?.column.columnDef.header;
                    return (
                      <span key={f.id} data-field-id={f.id}>
                        {typeof label === "string" ? `${label}: ` : null}
                        {render(f.id)}
                      </span>
                    );
                  })}
                </>
              ) : undefined
            }
            actions={actions.length > 0 ? render(actions[0]!.id) : undefined}
          />
        );
      })}
    </div>
  );
}
