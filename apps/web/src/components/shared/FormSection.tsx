import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Bordered card section with a title, optional description, action slot,
 * and a content grid. Used to group related form controls.
 */
export function FormSection({
  title,
  description,
  children,
  actions,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const sectionId = useId();
  const titleId = `${sectionId}-title`;
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
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description && (
            <p
              id={descriptionId}
              className="mt-1 text-sm text-muted-foreground"
            >
              {description}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className={cn("grid gap-4 p-5", contentClassName)}>{children}</div>
    </section>
  );
}
