import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";

export type SaveState = "idle" | "saving" | "saved" | "error";

export function SaveIndicator({
  state,
  status,
}: {
  state?: SaveState;
  status?: "saving" | "saved" | "error";
}) {
  const effectiveStatus = state
    ? state === "idle"
      ? undefined
      : state
    : status;

  if (!effectiveStatus) {
    return null;
  }

  if (effectiveStatus === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        保存中...
      </span>
    );
  }

  if (effectiveStatus === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-green-600">
        <CircleCheck className="size-4" aria-hidden="true" />
        已保存
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-sm text-red-600">
      <TriangleAlert className="size-4" aria-hidden="true" />
      保存失败
    </span>
  );
}
