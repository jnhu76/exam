import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Standard shell for data table pages, providing an optional title, description,
 * toolbar slot, content area, and footer within a bordered card container.
 */
export function DataTableShell({
  title,
  description,
  toolbar,
  children,
  footer,
  className,
  contentClassName,
}: {
  title?: string;
  description?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const shellId = useId();
  const titleId = title ? `${shellId}-title` : undefined;
  const descriptionId = description ? `${shellId}-description` : undefined;

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-slot="admin-table-shell"
      className={cn("surface-content overflow-hidden", className)}
    >
      {(title || description || toolbar) && (
        <div className="flex flex-col gap-3 border-b bg-surface-subtle px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
          {(title || description) && (
            <div className="min-w-0">
              {title && (
                <h2 id={titleId} className="type-section-title">
                  {title}
                </h2>
              )}
              {description && (
                <p
                  id={descriptionId}
                  className={cn("type-secondary", title && "mt-1")}
                >
                  {description}
                </p>
              )}
            </div>
          )}
          {toolbar && <div className="shrink-0">{toolbar}</div>}
        </div>
      )}
      <div className={cn("min-w-0", contentClassName)}>{children}</div>
      {footer && (
        <div className="border-t bg-surface-subtle px-4 py-3">{footer}</div>
      )}
    </section>
  );
}
