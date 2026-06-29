import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
  "aria-label": ariaLabel,
  ...props
}: RowActionsProps) {
  const { t } = useTranslation();
  const resolvedAriaLabel = ariaLabel ?? t("common.rowActions");
  return (
    <div
      role="group"
      aria-label={resolvedAriaLabel}
      className={cn("flex items-center justify-end gap-1.5", className)}
      {...props}
    >
      {leading}
      {children}
      {trailing}
    </div>
  );
}
