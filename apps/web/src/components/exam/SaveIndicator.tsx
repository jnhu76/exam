import { useTranslation } from "react-i18next";
import {
  CircleCheck,
  CircleDashed,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppIcon } from "@/components/shared/AppIcon";

/** Visual save-status states for the answer save indicator. */
export type SaveState = "idle" | "saving" | "saved" | "error";

/** i18n key mapping for each save state's label. */
const stateKeyMap: Record<SaveState, string> = {
  idle: "candidateRuntime.save.idle",
  saving: "candidateRuntime.save.saving",
  saved: "candidateRuntime.save.saved",
  error: "candidateRuntime.save.error",
};

/**
 * Feedback tone per save state. The soft color triple (bg/border/text) is
 * owned by the semantic feedback layer (feedback/recipes.css,
 * data-feedback-tone); this component owns only the chip geometry.
 */
const stateToneMap: Record<SaveState, string> = {
  idle: "neutral",
  saving: "info",
  saved: "positive",
  error: "destructive",
};

/** Icon mapping for each save state. */
const stateIconMap: Record<SaveState, LucideIcon> = {
  idle: CircleDashed,
  saving: LoaderCircle,
  saved: CircleCheck,
  error: TriangleAlert,
};

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
  const { t } = useTranslation();
  const effectiveStatus = state ? state : status;
  const resolved = effectiveStatus ?? "idle";
  const Icon = stateIconMap[resolved];

  return (
    <span
      data-feedback-tone={stateToneMap[resolved]}
      className="inline-flex min-w-28 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium"
    >
      <AppIcon
        icon={Icon}
        size="inline"
        className={resolved === "saving" ? "animate-spin" : undefined}
      />
      {t(stateKeyMap[resolved] as never)}
    </span>
  );
}
