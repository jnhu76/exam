import "@tanstack/react-table";
import type { DataViewColumnMeta } from "@/components/shared/DesktopDataTable";

/**
 * TanStack Table v8 module augmentation: attach our role-based column meta to
 * ColumnDef.meta. This lets pages declare `meta: { role: "long-text" }` on a
 * ColumnDef and have DesktopDataTable read it in a type-safe way, reusing the
 * existing role-based column-tagging contract (the visual authority in
 * table/recipes.css) instead of inventing a parallel column model.
 */
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ColumnMeta<TData, TValue> extends DataViewColumnMeta {}
}
