import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Props for the InlineErrorBanner component. */
type InlineErrorBannerProps = {
  children: ReactNode;
  className?: string;
};

/** Styled inline error message banner with a destructive feedback tone. */
export function InlineErrorBanner({
  children,
  className,
}: InlineErrorBannerProps) {
  return (
    <div
      role="alert"
      data-feedback-tone="destructive"
      className={cn("surface-attention border px-4 py-3 text-sm", className)}
    >
      {children}
    </div>
  );
}
