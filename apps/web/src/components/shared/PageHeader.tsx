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
      <div>
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="type-page-title">{title}</h1>
          {status}
        </div>
        {description && (
          <p className="type-page-description mt-1">{description}</p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}
