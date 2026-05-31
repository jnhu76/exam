import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";

export function SaveIndicator({
  status,
}: {
  status: "saving" | "saved" | "error";
}) {
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        保存中...
      </span>
    );
  }

  if (status === "saved") {
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
