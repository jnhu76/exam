import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Centered loading indicator with a spinning icon and customizable label text. */
export function LoadingState({
  label = "加载中...",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn(
        "flex flex-col items-center gap-3 p-8 text-center",
        className,
      )}
    >
      <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
