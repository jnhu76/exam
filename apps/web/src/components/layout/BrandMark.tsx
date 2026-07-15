import { ClipboardCheck } from "lucide-react";
import { AppIcon } from "@/components/shared/AppIcon";
import { cn } from "@/lib/utils";

/** Decorative logo mark icon used in the brand header and sidebar.
 * ClipboardCheck is the brand silhouette — no other surface may reuse it
 * for grading or empty states (UI-ICON-REFINE-1 brand authority). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      data-testid="brand-mark"
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary",
        className,
      )}
    >
      <AppIcon icon={ClipboardCheck} size="inline" />
    </span>
  );
}
