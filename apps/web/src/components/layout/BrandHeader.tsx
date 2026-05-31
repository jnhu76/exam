import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranding } from "./BrandProvider";

export function BrandHeader({ compact = false }: { compact?: boolean }) {
  const branding = useBranding();

  return (
    <div className="flex items-center gap-2">
      <GraduationCap className="size-5 shrink-0" aria-hidden="true" />
      <span className={cn("font-semibold", compact && "sr-only")}>
        {branding.productName}
      </span>
    </div>
  );
}
