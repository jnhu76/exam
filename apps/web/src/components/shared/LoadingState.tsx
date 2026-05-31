import { LoaderCircle } from "lucide-react";

export function LoadingState({ label = "加载中..." }: { label?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col items-center gap-3 p-8 text-center"
    >
      <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
