import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Metadata tag chip. Geometry/typography (height, radius, size, weight) is
 * owned by the single `[data-slot="tag-badge"]` recipe in badge/recipes.css —
 * including the compact-table variant for the Question Management workbench
 * tag columns (issue 577 m2: previously split across badge/recipes.css and a second
 * conflicting workbench.css block). The 400-vs-500 weight choice stays a
 * deferred visual decision; the recipe records the current 400.
 */
export type TagBadgeVariant = "default" | "compact-table";

export function TagBadge({
  variant = "default",
  className,
  ...props
}: ComponentProps<"span"> & { variant?: TagBadgeVariant }) {
  return (
    <Badge
      variant="outline"
      data-slot="tag-badge"
      data-tag-tone="neutral"
      data-tag-geometry="compact"
      data-tag-variant={variant}
      className={cn(className)}
      {...props}
    />
  );
}
