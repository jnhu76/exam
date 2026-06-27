import {
  CircleCheck,
  CircleDashed,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";

/** Visual save-status states for the answer save indicator. */
export type SaveState = "idle" | "saving" | "saved" | "error";

/** Configuration mapping each save state to its icon, label, and CSS classes. */
const statusConfig = {
  idle: {
    icon: CircleDashed,
    text: "等待保存",
    className: "border-border bg-card text-muted-foreground",
  },
  saving: {
    icon: LoaderCircle,
    text: "保存中...",
    className: "border-primary/30 bg-primary/10 text-primary",
  },
  saved: {
    icon: CircleCheck,
    text: "已保存",
    className: "border-success/30 bg-success/10 text-success",
  },
  error: {
    icon: TriangleAlert,
    text: "保存失败",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
} satisfies Record<
  SaveState,
  {
    icon: typeof CircleCheck;
    text: string;
    className: string;
  }
>;

/**
 * Inline indicator showing the current answer save status
 * (idle, saving, saved, or error) with an icon and label.
 */
export function SaveIndicator({
  state,
  status,
}: {
  state?: SaveState;
  status?: "saving" | "saved" | "error";
}) {
  const effectiveStatus = state ? state : status;

  const config = statusConfig[effectiveStatus ?? "idle"];
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex h-8 min-w-28 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium ${config.className}`}
    >
      <Icon
        className={`size-4 ${effectiveStatus === "saving" ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      {config.text}
    </span>
  );
}
