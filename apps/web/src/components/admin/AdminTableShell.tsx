import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AdminTableShellProps {
  children: ReactNode;
  className?: string;
}

/**
 * Bordered table card (Wegent-style): rounded-lg, surface background,
 * subtle shadow. The inner Table relies on its own row hover.
 */
export function AdminTableShell({ children, className }: AdminTableShellProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}
