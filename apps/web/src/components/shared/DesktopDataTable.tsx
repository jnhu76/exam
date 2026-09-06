import { useMemo, type ComponentProps } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Table as TanStackTable,
} from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import {
  DataTableCell,
  DataTableColumns,
  DataTableHead,
  DataTableSpanCell,
  type ColumnOverflow,
  type ColumnPriority,
  type DataTableColumnRole,
} from "@/components/shared/DataTableContract";
import { AppIcon } from "@/components/shared/AppIcon";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { BookOpen } from "lucide-react";

/**
 * Column meta: the role-based column contract (role + overflow + priority),
 * lifted onto a TanStack ColumnDef. The role drives width/alignment and the
 * overflow default via table/recipes.css (the visual authority); overflow and
 * priority are single-source declarations the table derives DOM attributes
 * from — headers/cells never repeat them (P3 §18).
 *
 * TanStack stays a row/header model only: no column-size state, no header
 * sizing calls, no inline widths. Width authority is DataTableContract +
 * recipes.css exclusively (P3-Corrective §5.5).
 */
export interface DataViewColumnMeta {
  /** The semantic column role — drives CSS width/wrap/alignment. */
  role: DataTableColumnRole;
  /** Optional overflow override (role default otherwise). */
  overflow?: ColumnOverflow;
  /** Optional priority override (role default otherwise). Metadata only. */
  priority?: ColumnPriority;
}

/**
 * A data-table column definition: a TanStack ColumnDef carrying the role meta.
 * Each page owns its own column array; DesktopDataTable consumes it.
 */
export type DataViewColumnDef<TData> = ColumnDef<TData> & {
  meta?: DataViewColumnMeta;
};

/** Props for the DesktopDataTable — server-side data, headless table engine. */
export interface DesktopDataTableProps<TData> {
  columns: DataViewColumnDef<TData>[];
  data: TData[];
  /**
   * Total row count on the server (for pagination; the table renders the page
   * slice). Omit for fully-local tables — `page`/`pageSize` are then omitted
   * too and the body renders the whole `data` array.
   */
  rowCount?: number;
  /** Controlled pagination state: 1-based page + page size. */
  page?: number;
  pageSize?: number;
  onPaginationChange?: (table: TanStackTable<TData>) => void;
  /** Row key resolver. */
  getRowId?: (row: TData) => string;
  /** Row interactivity: navigates (or opens) a row on click. */
  onRowClick?: (row: TData) => void;
  /** Stable per-row test anchor (e.g. GradingQueuePage queue rows). */
  getRowTestId?: (row: TData) => string;
  /**
   * Page-specific row attributes (e.g. CandidateFieldsPage drag-reorder).
   * Spread after the shared click/testid props — page-specific wins.
   */
  rowProps?: (row: TData) => Omit<ComponentProps<typeof TableRow>, "key">;
  /** Body state — exactly one of these renders below the header. */
  loading?: boolean;
  empty?: boolean;
  error?: string | null;
  /** Optional empty-state copy override (defaults resolve from i18n). */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Number of columns (for the span cell). Falls back to columns.length. */
  colSpan?: number;
}

/**
 * Desktop data table built on TanStack Table (headless: it provides the
 * row/header model only — no visuals). Visuals come from the existing shadcn
 * <Table> primitives + the role-based DataTable contract + table/recipes.css.
 *
 * Server-side mode: only getCoreRowModel is registered; filtering/pagination
 * are the consumer's responsibility (the API returns the already-paginated,
 * already-filtered page). The shell stays mounted across loading/empty/error
 * transitions — only the body content swaps — so there is no layout jitter.
 */
export function DesktopDataTable<TData>({
  columns,
  data,
  rowCount,
  page,
  pageSize,
  getRowId,
  onRowClick,
  getRowTestId,
  rowProps,
  loading = false,
  empty = false,
  error = null,
  emptyTitle,
  emptyDescription,
  colSpan,
}: DesktopDataTableProps<TData>) {
  const { t } = useTranslation();
  const span = colSpan ?? columns.length;

  const paginated =
    rowCount !== undefined && page !== undefined && pageSize !== undefined;
  if (
    import.meta.env.DEV &&
    (rowCount ?? page ?? pageSize) !== undefined &&
    !paginated
  ) {
    throw new Error(
      "DesktopDataTable contract violation: rowCount, page and pageSize must be passed together (or all omitted for a fully-local table)",
    );
  }

  const table = useReactTable<TData>({
    data,
    columns: columns as ColumnDef<TData>[],
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualFiltering: true,
    pageCount: paginated
      ? Math.max(1, Math.ceil(rowCount! / Math.max(pageSize!, 1)))
      : undefined,
    rowCount: paginated ? rowCount : undefined,
    state: paginated
      ? { pagination: { pageIndex: page! - 1, pageSize: pageSize! } }
      : undefined,
    getRowId,
  });

  // Role list for the <colgroup>, preserving the existing contract and
  // carrying the single-source overflow/priority declarations.
  const roleColumns = useMemo(
    () =>
      columns.map((c, i) => ({
        role: c.meta?.role ?? "primary-text",
        key: (c.id as string | undefined) ?? `${c.meta?.role ?? "col"}-${i}`,
        overflow: c.meta?.overflow,
        priority: c.meta?.priority,
      })),
    [columns],
  );

  return (
    <Table>
      <DataTableColumns columns={roleColumns} />
      <TableHeader>
        <TableRow>
          {table.getHeaderGroups().map((hg) =>
            hg.headers.map((header) => {
              const meta = header.column.columnDef.meta as
                | DataViewColumnMeta
                | undefined;
              return (
                <DataTableHead
                  key={header.id}
                  role={meta?.role ?? "primary-text"}
                  overflow={meta?.overflow}
                  priority={meta?.priority}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </DataTableHead>
              );
            }),
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow aria-hidden="true">
            <DataTableSpanCell colSpan={span} className="h-32 p-0" />
          </TableRow>
        ) : error ? (
          <TableRow>
            <DataTableSpanCell colSpan={span} className="h-32">
              <div className="flex flex-col items-center gap-2 text-center">
                <p className="font-medium">
                  {t("common.loading.loadFailed" as never)}
                </p>
                <p className="text-sm text-text-muted">{error}</p>
              </div>
            </DataTableSpanCell>
          </TableRow>
        ) : empty ? (
          <TableRow>
            <DataTableSpanCell colSpan={span} className="h-32">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="text-muted-foreground" aria-hidden="true">
                  <AppIcon icon={BookOpen} size="state" />
                </div>
                <div>
                  <p className="font-medium">
                    {emptyTitle ?? t("common.empty" as never)}
                  </p>
                  {emptyDescription && (
                    <p className="text-sm text-text-muted">
                      {emptyDescription}
                    </p>
                  )}
                </div>
              </div>
            </DataTableSpanCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              data-testid={getRowTestId?.(row.original)}
              className={onRowClick ? "cursor-pointer" : undefined}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              {...(rowProps?.(row.original) ?? {})}
            >
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta as
                  | DataViewColumnMeta
                  | undefined;
                return (
                  <DataTableCell
                    key={cell.id}
                    role={meta?.role ?? "primary-text"}
                    overflow={meta?.overflow}
                    priority={meta?.priority}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </DataTableCell>
                );
              })}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
