import { cn } from "@/lib/utils";
import { BrandMark } from "./BrandMark";
import { useBranding } from "./BrandProvider";

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
