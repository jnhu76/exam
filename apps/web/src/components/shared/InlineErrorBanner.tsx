import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type InlineErrorBannerProps = {
  children: ReactNode;
  className?: string;
};

export function InlineErrorBanner({
  children,
  className,
}: InlineErrorBannerProps) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive",
        className,
      )}
    >
      {children}
    </div>
  );
}
