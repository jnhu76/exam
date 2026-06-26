import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AdminTableShellProps {
  children: ReactNode;
  className?: string;
}

export function AdminTableShell({ children, className }: AdminTableShellProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-card shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}
