import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AdminTableShellProps {
  children: ReactNode;
  className?: string;
}

/**
 * Bordered table card (koi-style): 8px radius, 1px hairline border, no heavy
 * shadow. The inner Table should rely on its own row hover; header tint is
 * applied via the `--admin-bg-table-header` token on TableHead.
 */
export function AdminTableShell({ children, className }: AdminTableShellProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--admin-radius)] border border-admin-border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}
