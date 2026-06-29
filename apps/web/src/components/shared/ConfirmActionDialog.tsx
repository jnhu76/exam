import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "./ConfirmDialog";

/** Props for the ConfirmActionDialog component. */
type ConfirmActionDialogProps = {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  disabled?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

/**
 * Convenience wrapper around ConfirmDialog for destructive or confirmable
 * actions, accepting a trigger element and forwarding confirm/cancel callbacks.
 */
export function ConfirmActionDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  disabled = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t("common.confirm");
  const resolvedCancelLabel = cancelLabel ?? t("common.cancel");
  return (
    <ConfirmDialog
      trigger={trigger}
      title={title}
      description={description}
      confirmLabel={resolvedConfirmLabel}
      cancelLabel={resolvedCancelLabel}
      destructive={destructive}
      confirmDisabled={disabled || confirmDisabled}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
