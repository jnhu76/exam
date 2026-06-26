import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AdminPageCardProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  padding?: boolean;
}

export function AdminPageCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  padding = true,
}: AdminPageCardProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border bg-card shadow-sm",
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div className="min-w-0">
            {title && (
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="ml-4 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cn(padding && "p-5", contentClassName)}>{children}</div>
    </section>
  );
}
