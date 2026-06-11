import { ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";

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
      <ClipboardCheck className="size-4" aria-hidden="true" />
    </span>
  );
}
