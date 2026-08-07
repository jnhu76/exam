import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AppIcon } from "@/components/shared/AppIcon";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { CircleAlert } from "lucide-react";

/**
 * J5-I1C1 — controlled dialog shell for ONE Recovery Center dangerous
 * command (attempt / incident / exam operations).
 *
 * Uniform dangerous-command UX per J5-R0 §8.2:
 *   - the form (`children`) is rendered read-only once the command is frozen
 *     (`submitting` / `indeterminate`) so a retry can never drift the payload
 *     away from the first POST (a drifted payload under the SAME operationId
 *     would be an idempotency conflict);
 *   - `submitting` blocks closing (the outcome is unknown — the admin must
 *     not believe the command was dismissed);
 *   - `indeterminate` (lost response / 5xx) turns the confirm button into a
 *     RETRY of the same frozen operationId, surfaces the ambiguity inline,
 *     and offers an explicit abandon affordance (`onDismissIndeterminate`)
 *     that clears the durable pending authority — abandoning is an explicit
 *     user decision, never implicit;
 *   - the accessible name of the confirm button is the operation (never a
 *     bare "确认"), and the description names the command target.
 */
export interface RecoveryCommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Describes the command target + consequence (candidate, exam, …). */
  description: string;
  /** Accessible confirm-button name (the operation itself). */
  confirmLabel: string;
  /** Command is frozen + in flight — closing is blocked, form is read-only. */
  submitting: boolean;
  /** Command outcome is unknown — retry affordance + inline ambiguity banner. */
  indeterminate: boolean;
  /** Form-level validation (empty required fields, …). */
  confirmDisabled?: boolean;
  /** Destructive-tone confirm (force submit, resolve, dismiss, revoke). */
  destructive?: boolean;
  onConfirm: () => void;
  /** Explicitly abandons the frozen command (clears the pending authority). */
  onDismissIndeterminate?: () => void;
  children: ReactNode;
}

export function RecoveryCommandDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  submitting,
  indeterminate,
  confirmDisabled = false,
  destructive = false,
  onConfirm,
  onDismissIndeterminate,
  children,
}: RecoveryCommandDialogProps) {
  const { t } = useTranslation();
  const frozen = submitting || indeterminate;

  // Focus return on close (a11y): the trigger is a plain Button, NOT a Radix
  // DialogTrigger — Radix's modal close handler focuses `triggerRef`, which is
  // only populated by DialogTrigger, so without this the focus would fall to
  // <body> after Escape / close. Capture the element focused at open and
  // restore it after the close animation.
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      lastFocusedRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      return;
    }
    const lastFocused = lastFocusedRef.current;
    lastFocusedRef.current = null;
    if (!lastFocused || typeof lastFocused.focus !== "function") return;
    const id = window.setTimeout(() => lastFocused.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // While submitting the outcome is unknown — closing would make the
        // admin believe the command was dismissed.
        if (!next && submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {indeterminate && (
          <InlineErrorBanner>
            <span className="flex items-center gap-2">
              <AppIcon icon={CircleAlert} size="inline" />
              {t("admin.recoveryOps.indeterminateHint")}
            </span>
          </InlineErrorBanner>
        )}

        {/* Form fields — read-only once the command is frozen (a retry must
            resend the exact original bytes under the same operationId). */}
        <fieldset disabled={frozen} className="flex flex-col gap-3">
          {children}
        </fieldset>

        <DialogFooter>
          {indeterminate && onDismissIndeterminate && (
            <Button
              type="button"
              variant="outline"
              onClick={onDismissIndeterminate}
            >
              {t("admin.recoveryOps.abandonCommand")}
            </Button>
          )}
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            data-variant={destructive ? "destructive" : "default"}
            disabled={confirmDisabled || submitting}
            onClick={onConfirm}
          >
            {submitting
              ? t("admin.recoveryOps.submitting")
              : indeterminate
                ? `${t("admin.recoveryOps.retry")} · ${confirmLabel}`
                : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
