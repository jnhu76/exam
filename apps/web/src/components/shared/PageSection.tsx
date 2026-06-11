import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageSection({
  title,
  description,
  actions,
  children,
  footer,
  className,
  headerClassName,
  contentClassName,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
}) {
  const sectionId = useId();
  const titleId = title ? `${sectionId}-title` : undefined;
  const descriptionId = description ? `${sectionId}-description` : undefined;

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn(
        "rounded-lg border bg-card text-card-foreground",
        className,
      )}
    >
      {(title || description || actions) && (
        <div
          className={cn(
            "flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between",
            headerClassName,
          )}
        >
          <div className="min-w-0">
            {title && (
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
            )}
            {description && (
              <p
                id={descriptionId}
                className={cn("text-sm text-muted-foreground", title && "mt-1")}
              >
                {description}
              </p>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cn("p-5", contentClassName)}>{children}</div>
      {footer && <div className="border-t px-5 py-4">{footer}</div>}
    </section>
  );
}
