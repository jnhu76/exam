import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page-level header with a title, optional description, status badge,
 * and action buttons. Responsive layout stacks vertically on small screens.
 */
export function PageHeader({
  title,
  description,
  status,
  actions,
  className,
}: {
  title: string;
  description?: string;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-3">
          {/* Titles carry domain data (exam/course/candidate names) that can
              contain long unbroken tokens; without overflow-wrap they force
              document-level horizontal escape at narrow viewports. */}
          <h1 className="type-page-title min-w-0 break-words">{title}</h1>
          {status}
        </div>
        {description && (
          <p className="type-page-description mt-1 break-words">
            {description}
          </p>
        )}
      </div>
      {actions && (
        // INVARIANT: the actions slot must wrap at mobile widths — pages pass
        // grouped button rows (`<div className="flex gap-2">`) as a single
        // node, so flex-wrap on this container alone cannot reach them.
        <div className="flex shrink-0 flex-wrap gap-2 [&_button]:min-h-11 [&_div]:flex-wrap sm:[&_button]:min-h-9">
          {actions}
        </div>
      )}
    </header>
  );
}
