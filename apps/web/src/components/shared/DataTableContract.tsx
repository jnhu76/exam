import type { ComponentProps } from "react";
import { TableCell, TableHead } from "@/components/ui/table";

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

type DataTableWrapPolicy = "atomic" | "flexible";

const atomicRoles = new Set<DataTableColumnRole>([
  "status",
  "date",
  "date-range",
  "duration",
  "number",
  "score",
  "short-id",
  "type",
  "actions",
]);

function wrapPolicy(role: DataTableColumnRole): DataTableWrapPolicy {
  return atomicRoles.has(role) ? "atomic" : "flexible";
}

export function DataTableColumns({
  columns,
}: {
  columns: readonly { role: DataTableColumnRole; key?: string }[];
}) {
  return (
    <colgroup data-slot="data-table-columns">
      {columns.map((column, index) => (
        <col
          key={column.key ?? `${column.role}-${index}`}
          data-column-role={column.role}
          data-column-width={column.role}
          data-column-wrap={wrapPolicy(column.role)}
        />
      ))}
    </colgroup>
  );
}

export function DataTableHead({
  role,
  ...props
}: Omit<ComponentProps<typeof TableHead>, "data-column-role"> & {
  role: DataTableColumnRole;
}) {
  return (
    <TableHead
      data-column-role={role}
      data-column-wrap={wrapPolicy(role)}
      {...props}
    />
  );
}

export function DataTableCell({
  role,
  ...props
}: Omit<ComponentProps<typeof TableCell>, "data-column-role"> & {
  role: DataTableColumnRole;
}) {
  return (
    <TableCell
      data-column-role={role}
      data-column-wrap={wrapPolicy(role)}
      {...props}
    />
  );
}
