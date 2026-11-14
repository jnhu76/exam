import { useTranslation } from "react-i18next";
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
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
 *
 * idle and saved share the same claim ("the server has everything shown")
 * and icon; idle is the QUIET steady state (neutral tone), saved the brief
 * positive acknowledgment right after an ACK.
 */
const stateToneMap: Record<SaveState, string> = {
  idle: "neutral",
  saving: "info",
  saved: "positive",
  error: "destructive",
};

/** Icon mapping for each save state. */
const stateIconMap: Record<SaveState, LucideIcon> = {
  idle: CircleCheck,
  saving: LoaderCircle,
  saved: CircleCheck,
  error: TriangleAlert,
};

/**
 * Inline indicator showing the current answer save status
 * (idle, saving, saved, or error) with an icon and label.
 *
 * Accessibility (F-08 #971): role="status" + aria-live="polite" — the chip
 * is the screen reader's only answer-persistence channel on the take page,
 * so every state change is announced. polite (not assertive): saves retry
 * automatically, so announcements must not trample the candidate's current
 * task.
 *
 * INVARIANT: h-9 is the Button system's control height (#675) — the
 * take-page topbar row aligns this chip, the exam timer, and the submit
 * button on one shared geometry. States change only data-feedback-tone
 * (color), never geometry.
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
      role="status"
      aria-live="polite"
      data-feedback-tone={stateToneMap[resolved]}
      className="inline-flex h-9 min-w-28 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium"
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
