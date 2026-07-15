import type { ReactNode } from "react";

/**
 * A single record's mobile card. Flat, touch-friendly, no fixed action column.
 * Layout: a header row (type/status + actions), the primary content, and a
 * metadata row. Surfaces only the most important fields — NOT every table
 * column as a gray box. Uses semantic tokens (surface-content, border-row) so
 * it shares the table's visual language without re-implementing it.
 */
export function MobileRecordCard({
  children,
  header,
  primary,
  meta,
  actions,
  className,
}: {
  children?: ReactNode;
  /** Top-right actions cluster (e.g. a primary action + More menu). */
  header?: ReactNode;
  /** Primary content (e.g. the question stem). */
  primary?: ReactNode;
  /** Secondary metadata row (course, score, tags, …). */
  meta?: ReactNode;
  /** Optional explicit body (overrides primary/meta composition). */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="mobile-record-card"
      className={["surface-content flex flex-col gap-2 p-4", className]
        .filter(Boolean)
        .join(" ")}
    >
      {(header || actions) && (
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">{header}</div>
          {actions && (
            <div className="flex shrink-0 items-center gap-1">{actions}</div>
          )}
        </div>
      )}
      {primary && (
        <div className="type-body line-clamp-3 min-w-0 break-words">
          {primary}
        </div>
      )}
      {meta && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-text-muted">
          {meta}
        </div>
      )}
      {children}
    </div>
  );
}
