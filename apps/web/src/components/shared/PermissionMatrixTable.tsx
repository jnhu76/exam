import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Table, TableHeader, TableRow, TableHead } from "@/components/ui/table";
import { TableScrollSurface } from "@/components/shared/TableScrollSurface";
import {
  matrixKeyColumnPx,
  matrixRoleColumnPx,
  matrixTableWidth,
} from "@/table/permissionMatrix";

/**
 * The role × capability permission matrix.
 *
 * The only production data table whose semantics are not a record list. It
 * composes the SHARED surface —
 *
 *   TableScrollSurface   scroll region, overflow facts, local-scroll affordance
 *   ui Table primitives  cell/header padding (recipes.css keys on data-slot)
 *   recipes.css          typography, grid borders, row states
 *   detail-comparison    pins the capability-key column during local scroll
 *
 * — while its own column semantics live in ONE named authority
 * (table/permissionMatrix.ts). The page supplies the role labels and the
 * grouped rows; it owns no width.
 */
export function PermissionMatrixTable({
  roleLabels,
  children,
  "aria-label": ariaLabel,
}: {
  /** The matrix's role columns, in order (assignable presets). */
  roleLabels: readonly string[];
  /** The grouped rows: category rows + capability rows, from the page. */
  children: ReactNode;
  "aria-label"?: string;
}) {
  const { t } = useTranslation();
  const keyWidth = matrixKeyColumnPx();
  const roleWidth = matrixRoleColumnPx(roleLabels);
  const label = ariaLabel ?? t("admin.permissions.roles.title");

  return (
    <TableScrollSurface archetype="detail-comparison">
      <Table
        data-table-matrix="permissions"
        aria-label={label}
        style={{ width: `${matrixTableWidth(roleLabels)}px` }}
      >
        <colgroup data-slot="data-table-columns">
          <col
            data-column-role="matrix-key"
            data-column-overflow="nowrap"
            style={{ width: `${keyWidth}px` }}
          />
          {roleLabels.map((roleLabel) => (
            <col
              key={roleLabel}
              data-column-role="matrix-grant"
              data-column-overflow="nowrap"
              style={{ width: `${roleWidth}px` }}
            />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead className="font-mono text-xs">
              {t("admin.permissions.roles.columnPermission")}
            </TableHead>
            {roleLabels.map((roleLabel) => (
              <TableHead key={roleLabel} className="text-center">
                {roleLabel}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        {children}
      </Table>
    </TableScrollSurface>
  );
}
