import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Props for the RowActions component, extending div attributes. */
type RowActionsProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
};

/** Horizontal action button group for table rows, with optional leading and trailing slots. */
export function RowActions({
  children,
  leading,
  trailing,
  className,
  "aria-label": ariaLabel = "行操作",
  ...props
}: RowActionsProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("flex items-center justify-end gap-1.5", className)}
      {...props}
    >
      {leading}
      {children}
      {trailing}
    </div>
  );
}
