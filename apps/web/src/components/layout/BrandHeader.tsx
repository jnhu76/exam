import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranding } from "./BrandProvider";

export function BrandHeader({ compact = false }: { compact?: boolean }) {
  const branding = useBranding();

  return (
    <div className={cn("flex items-center gap-2", compact && "justify-center")}>
      <PanelLeft className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className={cn("text-sm font-semibold", compact && "sr-only")}>
        {branding.productName}
      </span>
    </div>
  );
}
