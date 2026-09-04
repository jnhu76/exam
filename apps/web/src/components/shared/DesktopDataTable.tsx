import { useMemo } from "react";
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
  type DataTableColumnRole,
} from "@/components/shared/DataTableContract";
import { AppIcon } from "@/components/shared/AppIcon";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { BookOpen } from "lucide-react";

/**
 * Column meta: the existing role-based column-tagging contract, lifted onto a
 * TanStack ColumnDef. The role drives width/wrap/alignment via table/recipes.css
 * (the visual authority). Desktop and mobile may read different meta fields.
 */
export interface DataViewColumnMeta {
  /** The semantic column role — drives CSS width/wrap/alignment. */
  role: DataTableColumnRole;
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
  /** Total row count on the server (for pagination; the table renders the page slice). */
  rowCount: number;
  /** Controlled pagination state: 1-based page + page size. */
  page: number;
  pageSize: number;
  onPaginationChange?: (table: TanStackTable<TData>) => void;
  /** Row key resolver. */
  getRowId?: (row: TData) => string;
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
  loading = false,
  empty = false,
  error = null,
  emptyTitle,
  emptyDescription,
  colSpan,
}: DesktopDataTableProps<TData>) {
  const { t } = useTranslation();
  const span = colSpan ?? columns.length;

  const table = useReactTable<TData>({
    data,
    columns: columns as ColumnDef<TData>[],
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualFiltering: true,
    pageCount: Math.max(1, Math.ceil(rowCount / Math.max(pageSize, 1))),
    rowCount,
    state: { pagination: { pageIndex: page - 1, pageSize } },
    getRowId,
  });

  // Role list for the <colgroup>, preserving the existing contract.
  const roleColumns = useMemo(
    () =>
      columns.map((c, i) => ({
        role: c.meta?.role ?? "primary-text",
        key: (c.id as string | undefined) ?? `${c.meta?.role ?? "col"}-${i}`,
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
              const role = header.column.columnDef.meta?.role ?? "primary-text";
              return (
                <DataTableHead key={header.id} role={role}>
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
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => {
                const role = cell.column.columnDef.meta?.role ?? "primary-text";
                return (
                  <DataTableCell key={cell.id} role={role}>
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
