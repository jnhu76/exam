import { cn } from "@/lib/utils";
import { BrandMark } from "./BrandMark";
import { useBranding } from "./BrandProvider";

export function BrandHeader({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
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
      <span className={cn("text-sm font-semibold", compact && "sr-only")}>
        {branding.productName}
      </span>
    </div>
  );
}
