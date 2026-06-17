import { cn } from "@/lib/utils";
import { BrandMark } from "./BrandMark";
import { useBranding } from "./BrandProvider";

/**
 * Displays the product logo mark and name. Supports a compact mode
 * (icon only, name hidden with sr-only) for collapsed sidebars.
 */
export function BrandHeader({
  compact = false,
  className,
  textClassName,
}: {
  compact?: boolean;
  className?: string;
  textClassName?: string;
}) {
  const branding = useBranding();

  return (
    <div
      data-testid="brand-header"
      className={cn(
        "flex min-w-0 items-center gap-2",
        compact && "justify-center",
        className,
      )}
    >
      <BrandMark />
      <span
        className={cn(
          "truncate text-sm font-semibold text-foreground",
          compact && "sr-only",
          textClassName,
        )}
      >
        {branding.productName}
      </span>
    </div>
  );
}
