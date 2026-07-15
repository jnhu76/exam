import type { ReactNode } from "react";

/**
 * Vertical list of mobile record cards. Renders only at the small breakpoint;
 * the desktop DataTable is hidden there (see DataView). This is the mobile
 * analogue of the table body — empty/loading/error states are handled here too.
 */
export function MobileRecordList({
  children,
  loading,
  empty,
  error,
  emptyNode,
  loadingNode,
  errorNode,
  className,
}: {
  children?: ReactNode;
  loading?: boolean;
  empty?: boolean;
  error?: string | null;
  emptyNode?: ReactNode;
  loadingNode?: ReactNode;
  errorNode?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="mobile-record-list"
      className={["flex flex-col gap-3", className].filter(Boolean).join(" ")}
    >
      {loading
        ? (loadingNode ?? null)
        : error
          ? (errorNode ?? null)
          : empty
            ? (emptyNode ?? null)
            : children}
    </div>
  );
}
