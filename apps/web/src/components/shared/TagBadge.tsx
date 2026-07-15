import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function TagBadge({ className, ...props }: ComponentProps<"span">) {
  return (
    <Badge
      variant="outline"
      data-slot="tag-badge"
      data-tag-tone="neutral"
      data-tag-geometry="compact"
      className={cn("font-normal", className)}
      {...props}
    />
  );
}
