import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AdminShellProps {
  children: ReactNode;
  className?: string;
}

export function AdminShell({ children, className }: AdminShellProps) {
  // Wegent page semantic: page-level background + consistent section gap.
  return <div className={cn("flex flex-col gap-5", className)}>{children}</div>;
}

interface AdminShellHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function AdminShellHeader({
  title,
  description,
  actions,
  className,
}: AdminShellHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
